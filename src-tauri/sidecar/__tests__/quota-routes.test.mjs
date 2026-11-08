// R4-BUG-005 step 1: quota-limited routes keep their TTLs across a sidecar
// restart and never cache an all-failed GreyNoise refresh. PurpleAir
// remains outside this slice, preserving main behavior. Upstream HTTPS is mocked; nothing leaves the machine.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import https from 'node:https';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

process.env.CB_SIDECAR_FILE_LOG = '0';
process.env.LOCAL_API_TOKEN = 'test-token-quota-routes';
const { createLocalApiServer, _resetSidecarCacheForTests, initQuotaGovernor } = await import('../local-api-server.mjs');

const quiet = { log() {}, warn() {}, error() {} };

function mockHttps(respond) {
  const original = https.request;
  const requests = [];
  https.request = (options, onResponse) => {
    const url = new URL(`https://${options.hostname}${options.path}`);
    requests.push(url);
    const req = new PassThrough();
    req.setTimeout = () => req;
    req.end = () => {
      queueMicrotask(() => {
        const { status, payload } = respond(url);
        const body = JSON.stringify(payload);
        const response = Readable.from([Buffer.from(body)]);
        response.statusCode = status;
        response.statusMessage = '';
        response.headers = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) };
        onResponse(response);
      });
    };
    return req;
  };
  return { requests, restore() { https.request = original; } };
}

async function startServer(dataDir) {
  _resetSidecarCacheForTests();
  const app = await createLocalApiServer({ port: 0, apiDir: path.resolve('api'), dataDir, resourceDir: dataDir, agentMonitorStatePath: path.join(dataDir, 'monitor-state.json'), agentMonitorEventsPath: path.join(dataDir, 'monitor-events.json'), littleSnitchExportPath: null, littleSnitchBaselinePath: null, logger: quiet });
  const { port } = await app.start();
  return {
    async get(route) {
      const res = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` } });
      return { status: res.status, body: await res.json() };
    },
    close: () => app.close(),
  };
}

function withEnv(t, vars) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

function tempDataDir(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-quota-routes-'));
  t.after(() => { initQuotaGovernor(null); rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

test('AbuseIPDB blacklist is fetched once and survives a sidecar restart', async (t) => {
  withEnv(t, { ABUSEIPDB_API_KEY: 'test-abuseipdb' });
  const dataDir = tempDataDir(t);
  const mock = mockHttps(() => ({ status: 200, payload: { data: [{ ipAddress: '203.0.113.7', abuseConfidenceScore: 100, countryCode: 'ZZ', totalReports: 3 }] } }));
  t.after(() => mock.restore());
  const upstream = () => mock.requests.filter((u) => u.hostname === 'api.abuseipdb.com').length;

  const first = await startServer(dataDir);
  const a = await first.get('/api/abuseipdb-reports');
  await first.get('/api/abuseipdb-reports');
  await first.close();
  assert.equal(a.body[0].ipAddress, '203.0.113.7');
  assert.equal(upstream(), 1);

  const restarted = await startServer(dataDir);
  const b = await restarted.get('/api/abuseipdb-reports');
  await restarted.close();
  assert.deepEqual(b.body, a.body);
  assert.equal(upstream(), 1, 'the 8 h TTL survived the restart');
  assert.equal(lstatSync(path.join(dataDir, 'quota-cache.json')).mode & 0o777, 0o600);
});

test('an all-failed GreyNoise refresh is never cached and backs off instead of re-spending 20 lookups', async (t) => {
  withEnv(t, { GREYNOISE_API_KEY: 'test-greynoise' });
  const dataDir = tempDataDir(t);
  const mock = mockHttps(() => ({ status: 429, payload: { message: 'rate limited' } }));
  t.after(() => mock.restore());
  const upstream = () => mock.requests.filter((u) => u.hostname === 'api.greynoise.io').length;

  const server = await startServer(dataDir);
  const first = await server.get('/api/greynoise-scanners');
  const spent = upstream();
  const second = await server.get('/api/greynoise-scanners');
  await server.close();
  assert.equal(first.status, 503);
  assert.equal(first.body.error, 'quota_exhausted');
  assert.equal(second.status, 503);
  assert.equal(second.body.error, 'quota_exhausted');
  assert.equal(spent, 5, 'only the already-started concurrent batch reaches the provider');
  assert.equal(upstream(), 5, 'provider cooldown: no second round of lookups');
  const file = path.join(dataDir, 'quota-cache.json');
  const persisted = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).entries : {};
  assert.equal('greynoise-scanners' in persisted, false, 'an empty failure is not cached for a week');
});

function purpleAirFixture(t) {
  withEnv(t, { PURPLEAIR_API_KEY: 'test-purpleair' });
  const dataDir = tempDataDir(t);
  const mock = mockHttps(() => ({ status: 200, payload: {
    fields: ['sensor_index', 'pm2.5', 'latitude', 'longitude', 'location_type', 'confidence', 'name', 'last_seen'],
    data: [[1, 12.5, 41.6, -86.7, 0, 95, 'Porch', 1_700_000_000]],
  } }));
  t.after(() => mock.restore());
  return { dataDir, mock, route: '/api/airquality/purpleair?nwlng=-87&nwlat=42&selng=-86&selat=41' };
}

test('PurpleAir preserves main query and returned field request shape', async (t) => {
  const { dataDir, mock, route } = purpleAirFixture(t);
  const server = await startServer(dataDir);
  let res;
  try { res = await server.get(route); } finally { await server.close(); }
  assert.equal(mock.requests.length, 1);
  const url = mock.requests[0];
  assert.equal(url.searchParams.get('fields'), 'sensor_index,pm2.5,latitude,longitude,location_type,confidence,name,last_seen');
  assert.equal(url.searchParams.has('max_age'), false);
  assert.equal(url.searchParams.get('location_type'), '0');
  assert.equal(url.searchParams.get('nwlng'), '-87');
  assert.equal(res.body.sensors[0].confidence, 95);
});

test('PurpleAir preserves main five-minute in-memory cadence', async (t) => {
  const { dataDir, mock, route } = purpleAirFixture(t);
  const server = await startServer(dataDir);
  const originalNow = Date.now;
  const start = originalNow();
  try {
    Date.now = () => start;
    await server.get(route);
    Date.now = () => start + 5 * 60 * 1000 - 1;
    await server.get(route);
    assert.equal(mock.requests.length, 1, 'main cache remains fresh before five minutes');
    Date.now = () => start + 5 * 60 * 1000 + 1;
    await server.get(route);
    assert.equal(mock.requests.length, 2, 'main cadence refetches after five minutes');
  } finally { Date.now = originalNow; await server.close(); }
});

test('PurpleAir is not persisted and refetches after a sidecar restart', async (t) => {
  const { dataDir, mock, route } = purpleAirFixture(t);
  const first = await startServer(dataDir);
  try { await first.get(route); } finally { await first.close(); }
  const file = path.join(dataDir, 'quota-cache.json');
  const entries = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).entries : {};
  assert.equal(Object.keys(entries).some((key) => key.startsWith('purpleair-sensors')), false);
  const second = await startServer(dataDir);
  try { await second.get(route); } finally { await second.close(); }
  assert.equal(mock.requests.length, 2, 'PurpleAir does not acquire new disk-cache semantics');
});

test('PurpleAir ignores legacy persisted entries instead of acquiring disk provenance', async (t) => {
  const { dataDir, mock, route } = purpleAirFixture(t);
  const file = path.join(dataDir, 'quota-cache.json');
  const saved = JSON.stringify({ version: 1, entries: {
    'purpleair-sensors:-87,42,-86,41': { ts: Date.now(), data: { sensors: [], legacyDisk: true } },
  } });
  writeFileSync(file, saved);
  const server = await startServer(dataDir);
  let res;
  try { res = await server.get(route); } finally { await server.close(); }
  assert.equal(mock.requests.length, 1, 'PurpleAir must ignore old disk entries');
  assert.equal(res.body.sensors[0].confidence, 95);
  assert.equal(readFileSync(file, 'utf8'), saved, 'this isolation does not purge or rewrite old cache data');
});

test('without an explicit data dir (dev runs, tests) the quota cache is memory-only', async (t) => {
  withEnv(t, { ABUSEIPDB_API_KEY: 'test-abuseipdb' });
  const saved = process.env.LOCAL_API_DATA_DIR;
  delete process.env.LOCAL_API_DATA_DIR;
  t.after(() => { if (saved !== undefined) process.env.LOCAL_API_DATA_DIR = saved; });
  const mock = mockHttps(() => ({ status: 200, payload: { data: [{ ipAddress: '203.0.113.9' }] } }));
  t.after(() => mock.restore());
  _resetSidecarCacheForTests();
  const resourceDir = tempDataDir(t);
  const app = await createLocalApiServer({ port: 0, apiDir: path.resolve('api'), resourceDir, agentMonitorStatePath: path.join(resourceDir, 'monitor-state.json'), agentMonitorEventsPath: path.join(resourceDir, 'monitor-events.json'), littleSnitchExportPath: null, littleSnitchBaselinePath: null, logger: quiet });
  const { port } = await app.start();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/abuseipdb-reports`, { headers: { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` } });
    const body = await res.json();
    assert.equal(body[0].ipAddress, '203.0.113.9');
  } finally {
    await app.close();
  }
  assert.equal(existsSync(path.join(resourceDir, 'quota-cache.json')), false, 'nothing written into the working tree');
});

for (const empty of [false, true]) test(`NewsAPI ${empty ? 'empty' : 'populated'} tracked cache retains acquisition across memory and disk delivery`, async (t) => {
  withEnv(t, { NEWSAPI_KEY: 'fixture-newsapi' });
  const dataDir = tempDataDir(t);
  const mock = mockHttps(() => ({ status: 200, payload: { articles: empty ? [] : [{ title: 'Story', url: 'https://example.com/story' }] } }));
  t.after(() => mock.restore());
  const route = '/api/newsapi-headlines?responseMode=tracked-v1';
  const first = await startServer(dataDir);
  let a, b;
  try { a = await first.get(route); b = await first.get(route); } finally { await first.close(); }
  assert.equal(a.status, 200);
  assert.equal(a.body.acquisition.delivery, 'upstream');
  assert.deepEqual(b.body.acquisition, { ...a.body.acquisition, delivery: 'memory_cache' });
  const restarted = await startServer(dataDir);
  let c;
  try { c = await restarted.get(route); } finally { await restarted.close(); }
  assert.equal(mock.requests.filter(u => u.hostname === 'newsapi.org').length, 1);
  assert.deepEqual(c.body.acquisition, { ...a.body.acquisition, delivery: 'persistent_cache' });
  if (!empty) assert.deepEqual(c.body.items[0].provenance, { ...a.body.items[0].provenance, delivery: 'persistent_cache' });
});

for (const [label, bad] of [['legacy', []], ['missing fields', { format: 'tracked-v1' }]]) test(`invalid ${label} disk data cannot hide NewsAPI denial`, async (t) => {
  withEnv(t, { NEWSAPI_KEY: 'fixture-newsapi' });
  const dataDir = tempDataDir(t);
  writeFileSync(path.join(dataDir, 'quota-cache.json'), JSON.stringify({ version: 1, entries: { 'news-tracked-v1:newsapi:geopolitics:10': { ts: Date.now(), data: bad } } }));
  const mock = mockHttps(() => ({ status: 403, payload: {} }));
  t.after(() => mock.restore());
  const server = await startServer(dataDir);
  let response;
  try { response = await server.get('/api/newsapi-headlines?responseMode=tracked-v1'); } finally { await server.close(); }
  assert.equal(response.status, 403);
  assert.equal(response.body.acquisition.outcome, 'denied');
  assert.equal(response.body.acquisition.acquiredAt, null);
  assert.equal(mock.requests.filter(u => u.hostname === 'newsapi.org').length, 1);
});

test('NewsData stays memory-only across restart while NewsAPI persists', async (t) => {
  withEnv(t, { NEWSDATA_API_KEY: 'fixture-newsdata' });
  const dataDir = tempDataDir(t);
  const mock = mockHttps(() => ({ status: 200, payload: { results: [{ title: 'Story', link: 'https://example.com/story' }] } }));
  t.after(() => mock.restore());
  const route = '/api/newsdata-feed?responseMode=tracked-v1';
  const first = await startServer(dataDir);
  try {
    const fresh = await first.get(route);
    const cached = await first.get(route);
    assert.equal(fresh.body.acquisition.delivery, 'upstream');
    assert.equal(cached.body.acquisition.delivery, 'memory_cache');
  } finally { await first.close(); }
  const restarted = await startServer(dataDir);
  try {
    const fresh = await restarted.get(route);
    assert.equal(fresh.body.acquisition.delivery, 'upstream');
  } finally { await restarted.close(); }
  assert.equal(mock.requests.filter(u => u.hostname === 'newsdata.io').length, 2);
  assert.equal(existsSync(path.join(dataDir, 'quota-cache.json')), false);
});

for (const [ageMinutes, expectedCalls, delivery] of [[19, 0, 'persistent_cache'], [21, 1, 'upstream']]) test(`NewsAPI persisted TTL at ${ageMinutes} minutes`, async (t) => {
  withEnv(t, { NEWSAPI_KEY: 'fixture-newsapi' });
  const dataDir = tempDataDir(t);
  const time = Date.now() - ageMinutes * 60_000;
  const acquisition = { outcome: 'empty', delivery: 'upstream', attemptedAt: time, acquiredAt: time, cacheStoredAt: time, acceptedCount: 0 };
  writeFileSync(path.join(dataDir, 'quota-cache.json'), JSON.stringify({ version: 1, entries: { 'news-tracked-v1:newsapi:geopolitics:10': { ts: time, data: { format: 'tracked-v1', items: [], acquisition } } } }));
  const mock = mockHttps(() => ({ status: 200, payload: { articles: [] } }));
  t.after(() => mock.restore());
  const server = await startServer(dataDir);
  let response;
  try { response = await server.get('/api/newsapi-headlines?responseMode=tracked-v1'); } finally { await server.close(); }
  assert.equal(response.body.acquisition.delivery, delivery);
  assert.equal(mock.requests.filter(u => u.hostname === 'newsapi.org').length, expectedCalls);
  if (!expectedCalls) assert.equal(response.body.acquisition.acquiredAt, time);
});

for (const [status, payload, outcome, responseStatus] of [[429, {}, 'rate_limited', 503], [200, {}, 'malformed', 502], [500, {}, 'unavailable', 502]]) test(`invalid disk record preserves ${outcome} upstream failure`, async (t) => {
  withEnv(t, { NEWSAPI_KEY: 'fixture-newsapi' });
  const dataDir = tempDataDir(t);
  writeFileSync(path.join(dataDir, 'quota-cache.json'), JSON.stringify({ version: 1, entries: { 'news-tracked-v1:newsapi:geopolitics:10': { ts: Date.now(), data: { format: 'tracked-v1', items: [], acquisition: { outcome: 'ok' } } } } }));
  const mock = mockHttps(() => ({ status, payload }));
  t.after(() => mock.restore());
  const server = await startServer(dataDir);
  try {
    for (let i = 0; i < 2; i++) {
      const response = await server.get('/api/newsapi-headlines?responseMode=tracked-v1');
      assert.equal(response.status, responseStatus);
      assert.equal(response.body.acquisition.outcome, outcome);
      assert.equal(response.body.acquisition.acquiredAt, null);
      if (status === 429) {
        if (i === 0) assert.ok(response.body.acquisition.attemptedAt > 0, 'actual provider attempt retained');
        else assert.equal(response.body.acquisition.attemptedAt, null, 'cooldown denial invents no upstream attempt');
      }
    }
  } finally { await server.close(); }
  assert.equal(mock.requests.filter(u => u.hostname === 'newsapi.org').length, status === 429 ? 1 : 2, 'cooldown blocks repeated sends; failure never becomes cached healthy emptiness');
});

test('NewsAPI failed atomic write never claims disk-loaded delivery', async (t) => {
  withEnv(t, { NEWSAPI_KEY: 'fixture-newsapi' });
  const dataDir = tempDataDir(t);
  mkdirSync(path.join(dataDir, 'quota-cache.json')); // safe fixture: rename onto a directory fails
  const mock = mockHttps(() => ({ status: 200, payload: { articles: [{ title: 'Story', url: 'https://example.com/story' }] } }));
  t.after(() => mock.restore());
  const server = await startServer(dataDir);
  try {
    const route = '/api/newsapi-headlines?responseMode=tracked-v1';
    const first = await server.get(route);
    const second = await server.get(route);
    assert.deepEqual(second.body.acquisition, { ...first.body.acquisition, delivery: 'memory_cache' });
    assert.equal(second.body.items[0].provenance.delivery, 'memory_cache');
    assert.equal(mock.requests.filter(u => u.hostname === 'newsapi.org').length, 1);
  } finally { await server.close(); }
});
