// R4-BUG-005 step 2: static gates for the Quota Governor. Every governed
// provider is reached only through the governed transport, the budgets agree
// with step 1's TTLs, and the module ships in the packaged sidecar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { QUOTA_BUDGETS, QUOTA_RULES, worstCaseUse } from '../src-tauri/sidecar/quota-policy.mjs';
import { backgroundCeiling } from '../src-tauri/sidecar/quota-governor.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sidecarDir = path.join(root, 'src-tauri/sidecar');
const server = readFileSync(path.join(sidecarDir, 'local-api-server.mjs'), 'utf8');
const tauriConf = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const hosts = [...new Set(QUOTA_RULES.map((r) => r.host))];

test('governed hosts are reached only through fetchWithTimeout', () => {
  for (const name of readdirSync(sidecarDir)) {
    if (!name.endsWith('.mjs') || name.includes('.test.') || name === 'local-api-server.mjs' || name.startsWith('quota-')) continue;
    const source = readFileSync(path.join(sidecarDir, name), 'utf8');
    for (const host of hosts) assert.ok(!source.includes(`//${host}`), `${name} calls ${host} outside the governor`);
  }
  for (const [index, line] of server.split('\n').entries()) {
    if (!/(?<![\w.])fetch\(|https\.(?:request|get)\(|hostname:\s*['"`]/.test(line)) continue;
    for (const host of hosts) assert.ok(!line.includes(host), `line ${index + 1} reaches ${host} without the governor`);
  }
  for (const host of hosts) assert.ok(!server.includes(`http://${host}`), `${host} only over https`);
});

test('the transport admits before sending, throws on a denial and observes after', () => {
  const start = server.indexOf('async function fetchWithTimeout(url, options = {}, timeoutMs = 12_000) {');
  const body = server.slice(start, server.indexOf('async function transportFetchWithTimeout', start));
  const order = ['_quotaGovernor.admit(url', 'if (!ticket.allowed) throw new QuotaExhaustedError(ticket);', 'await transportFetchWithTimeout(url, options, timeoutMs)', '_quotaGovernor.observe(ticket'];
  let last = -1;
  for (const step of order) {
    const at = body.indexOf(step);
    assert.ok(at > last, `${step} in order`);
    last = at;
  }
  assert.equal((server.match(/transportFetchWithTimeout\(/g) ?? []).length, 2, 'only fetchWithTimeout calls the raw transport');
});

test('key tests and manual lookups run in the interactive scope', () => {
  assert.match(server, /await runInteractiveQuota\(\(\) => validateSecretAgainstProvider\(key, value, safeContext\)\)/);
  assert.match(server, /runInteractiveQuota\(\(\) => fetchWithTimeout\(\n `https:\/\/www\.virustotal\.com\/api\/v3\//);
  assert.match(server, /runInteractiveQuota\(\(\) => fetchWithTimeout\(\n `https:\/\/api\.greynoise\.io\/v3\/community\/\$\{ip\}`/);
  assert.equal((server.match(/runInteractiveQuota\(\(\) =>/g) ?? []).length, 3, 'three call sites; nothing background is interactive');
});

test('rules are well formed and agree with step 1 budgets', () => {
  assert.equal(new Set(QUOTA_RULES.map((r) => r.id)).size, QUOTA_RULES.length);
  for (const rule of QUOTA_RULES) {
    assert.equal(rule.host, rule.host.toLowerCase());
    assert.ok(rule.pathPrefix.startsWith('/'));
    assert.ok(rule.windows.length > 0);
    for (const w of rule.windows) if (w.limit != null) assert.ok(backgroundCeiling(w.limit) >= 1, `${rule.id} ceiling`);
    for (const key of rule.secretKeys) assert.ok(server.includes(`'${key}'`), `${rule.id}: ${key} is a known setting`);
  }
  const byLabel = { 'GreyNoise Community': 'greynoise', 'AbuseIPDB blacklist': 'abuseipdb-blacklist', NewsAPI: 'newsapi', 'OpenSky global states': 'opensky-states' };
  for (const budget of QUOTA_BUDGETS) {
    const rule = QUOTA_RULES.find((r) => r.id === byLabel[budget.provider]);
    const window = rule.windows.find((w) => w.ms === budget.windowMs);
    assert.equal(window.limit, budget.limit, `${budget.provider} limit`);
    assert.ok(worstCaseUse(budget) <= backgroundCeiling(window.limit), `${budget.provider} TTL fits the background ceiling`);
  }
  assert.ok(QUOTA_RULES.find((r) => r.id === 'purpleair').windows.every((w) => w.limit === null), 'PurpleAir: no app cap (Bradley)');
  assert.ok(QUOTA_RULES.find((r) => r.id === 'anthropic').windows.every((w) => w.limit === null), 'Anthropic: Console limit is the guard (Bradley)');
});

test('the governor starts with the data dir and ships in the bundle', () => {
  assert.match(server, /initQuotaGovernor\(explicitDataDir \? path\.join\(context\.dataDir, QUOTA_LEDGER_FILE\) : null\);/);
  assert.ok(tauriConf.bundle.resources.includes('sidecar/quota-governor.mjs'));
});
