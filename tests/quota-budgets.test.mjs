// R4-BUG-005: refresh cadence x cost must stay within 80% of each provider's
// documented free limit, and the quota-limited routes must actually use the
// persisted cache and these TTLs. A future TTL change that breaks a budget
// fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  QUOTA_BUDGETS,
  QUOTA_TARGET_SHARE,
  QUOTA_TTL_MS,
  worstCaseUse,
} from '../src-tauri/sidecar/quota-policy.mjs';

const server = readFileSync(new URL('../src-tauri/sidecar/local-api-server.mjs', import.meta.url), 'utf8');
const tauriConf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

test('worst-case use stays within 80% of every documented free limit', () => {
  for (const budget of QUOTA_BUDGETS) {
    const use = worstCaseUse(budget);
    assert.ok(use <= budget.limit * QUOTA_TARGET_SHARE, `${budget.provider}: ${use} of ${budget.limit} per window`);
  }
  assert.equal(worstCaseUse(QUOTA_BUDGETS.find((b) => b.provider.startsWith('GreyNoise'))), 20);
  assert.equal(worstCaseUse(QUOTA_BUDGETS.find((b) => b.provider.startsWith('AbuseIPDB'))), 3);
  assert.equal(worstCaseUse(QUOTA_BUDGETS.find((b) => b.provider === 'NewsAPI')), 72);
  assert.equal(worstCaseUse(QUOTA_BUDGETS.find((b) => b.provider.startsWith('OpenSky'))), 2880);
});

function route(pathname) {
  const start = server.indexOf(`requestUrl.pathname === '${pathname}'`);
  assert.ok(start >= 0, pathname);
  const end = server.indexOf('requestUrl.pathname ===', start + 30);
  return server.slice(start, end);
}

test('quota-limited routes read and write the persisted cache with the policy TTLs', () => {
  for (const [pathname, ttl] of [
    ['/api/greynoise-scanners', 'QUOTA_TTL_MS.greynoiseSeeds'],
    ['/api/abuseipdb-reports', 'QUOTA_TTL_MS.abuseipdbBlacklist'],
    ['/api/newsapi-headlines', 'QUOTA_TTL_MS.newsapi'],
    ['/api/airquality/purpleair', 'QUOTA_TTL_MS.purpleairBbox : QUOTA_TTL_MS.purpleairGlobal'],
  ]) {
    const body = route(pathname);
    assert.match(body, new RegExp(`_quotaCache\\.get\\([^\\n]*${ttl.replace(/[.?:]/g, (c) => `\\${c}`)}`), `${pathname} reads with its TTL`);
    assert.match(body, /_quotaCache\.set\(/, `${pathname} persists`);
    assert.doesNotMatch(body, /\bsetCached\((?!'greynoise-scanners:backoff')/, `${pathname} must not bypass the persisted cache`);
  }
  assert.equal((server.match(/const OPENSKY_TTL = QUOTA_TTL_MS\.openskyStates;/g) ?? []).length, 3);
  assert.doesNotMatch(server, /OPENSKY_TTL = \d/);
});

test('GreyNoise never persists an empty (all-failed) refresh', () => {
  const body = route('/api/greynoise-scanners');
  const empty = body.indexOf('if (results.length === 0) {');
  const persist = body.indexOf("_quotaCache.set('greynoise-scanners', results);");
  assert.ok(empty >= 0 && persist > empty, 'empty check precedes the persist');
  assert.match(body.slice(empty, persist), /return json\(/);
});

test('PurpleAir keeps confidence, drops the redundant location_type field and filters silent sensors', () => {
  const body = route('/api/airquality/purpleair');
  assert.match(body, /const fields = 'sensor_index,pm2\.5,latitude,longitude,confidence,name,last_seen';/);
  assert.match(body, /&max_age=\$\{PURPLEAIR_MAX_AGE_S\}/);
  assert.equal(QUOTA_TTL_MS.purpleairGlobal, 24 * 60 * 60 * 1000, 'worldwide snapshot once a day (Bradley)');
  assert.equal(QUOTA_TTL_MS.purpleairBbox, 60 * 60 * 1000);
});

test('the cache is pointed at the data dir at startup and both modules ship in the bundle', () => {
  assert.match(server, /const explicitDataDir = options\.dataDir \?\? process\.env\.LOCAL_API_DATA_DIR;\s*initQuotaCache\(explicitDataDir \? path\.join\(context\.dataDir, QUOTA_CACHE_FILE\) : null\);/);
  for (const file of ['sidecar/quota-cache.mjs', 'sidecar/quota-policy.mjs']) {
    assert.ok(tauriConf.bundle.resources.includes(file), `${file} in bundle.resources`);
  }
});
