// R4-BUG-005 step 2: the governor is wired into every outbound sidecar call.
// A denied call opens no socket; an out-of-quota feed serves its last good
// data marked stale or a 503, never an empty "all clear"; key tests and manual
// lookups use the reserve; the ledger survives a restart. Upstream HTTPS is
// mocked; nothing leaves the machine.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import https from 'node:https';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

process.env.LOCAL_API_TOKEN ??= 'test-token-quota-governor-routes';
const { createLocalApiServer, _resetSidecarCacheForTests, _quotaGovernorForTests } = await import('../local-api-server.mjs');

const quiet = { log() {}, warn() {}, error() {} };
const ABUSE_URL = 'https://api.abuseipdb.com/api/v2/blacklist?limit=50';
const GREY_URL = 'https://api.greynoise.io/v3/community/1.2.3.4';
const OPENSKY_URL = 'https://opensky-network.org/api/states/all';

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
        const { status, payload, headers = {} } = respond(url);
        const body = JSON.stringify(payload);
        const response = Readable.from([Buffer.from(body)]);
        response.statusCode = status;
        response.statusMessage = '';
        response.headers = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), ...headers };
        onResponse(response);
      });
    };
    return req;
  };
  return { requests, restore() { https.request = original; } };
}

async function startServer(dataDir, { reset = true } = {}) {
  if (reset) _resetSidecarCacheForTests();
  const app = await createLocalApiServer({ port: 0, apiDir: path.resolve('api'), dataDir, logger: quiet });
  const { port } = await app.start();
  const auth = { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` };
  async function call(route, init = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, { ...init, headers: { ...auth, ...init.headers } });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  }
  return {
    get: (route) => call(route),
    post: (route, body) => call(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    raw: (route) => fetch(`http://127.0.0.1:${port}${route}`),
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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cb-quota-gov-routes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Shift Date.now() forward for the rest of the test (TTL expiry without sleeping). */
function shiftClock(t) {
  const real = Date.now;
  let offset = 0;
  Date.now = () => real() + offset;
  t.after(() => { Date.now = real; });
  return (ms) => { offset += ms; };
}

const hostCalls = (mock, host) => mock.requests.filter((u) => u.hostname === host).length;

test('an exhausted budget sends nothing and serves the last good list marked stale_quota', async (t) => {
  withEnv(t, { ABUSEIPDB_API_KEY: 'test-abuseipdb' });
  const advance = shiftClock(t);
  const mock = mockHttps(() => ({ status: 200, payload: { data: [{ ipAddress: '203.0.113.7', abuseConfidenceScore: 100 }] } }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());

  const fresh = await server.get('/api/abuseipdb-reports');
  assert.equal(fresh.body[0].ipAddress, '203.0.113.7');
  const governor = _quotaGovernorForTests();
  for (let i = 0; i < 3; i += 1) governor.admit(ABUSE_URL);
  // 8 h TTL, doubled to 16 h by pacing at this usage: step past both.
  advance(17 * 60 * 60 * 1000);
  const before = hostCalls(mock, 'api.abuseipdb.com');
  const stale = await server.get('/api/abuseipdb-reports');
  assert.equal(hostCalls(mock, 'api.abuseipdb.com'), before, 'no socket opened');
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get('x-quota-state'), 'stale_quota');
  assert.deepEqual(stale.body, fresh.body);

  const health = await server.get('/api/health');
  assert.equal(health.body.feeds.find((f) => f.key === 'abuseipdb-reports')?.lastError, 'quota_exhausted');
  const feeds = await server.get('/api/feeds/health/abuseipdb-reports');
  assert.equal(feeds.body.lastError, 'quota_exhausted');
  assert.equal(feeds.body.status, 'down', 'never a healthy vote');
});

test('pacing: near the ceiling a cached list lives twice as long instead of spending budget', async (t) => {
  withEnv(t, { ABUSEIPDB_API_KEY: 'test-abuseipdb' });
  const advance = shiftClock(t);
  const mock = mockHttps(() => ({ status: 200, payload: { data: [{ ipAddress: '203.0.113.9' }] } }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  await server.get('/api/abuseipdb-reports');
  const governor = _quotaGovernorForTests();
  for (let i = 0; i < 3; i += 1) governor.admit(ABUSE_URL);
  advance(9 * 60 * 60 * 1000);
  const res = await server.get('/api/abuseipdb-reports');
  assert.equal(res.headers.get('x-quota-state'), null, 'still fresh: 8 h TTL doubled to 16 h');
  assert.equal(hostCalls(mock, 'api.abuseipdb.com'), 1);
});

test('a GreyNoise refresh that would not fit the budget is not started', async (t) => {
  withEnv(t, { GREYNOISE_API_KEY: 'test-greynoise' });
  const mock = mockHttps(() => ({ status: 200, payload: { ip: '203.0.113.7', noise: false } }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const governor = _quotaGovernorForTests();
  for (let i = 0; i < 30; i += 1) governor.admit(GREY_URL);
  const res = await server.get('/api/greynoise-scanners');
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'quota_exhausted');
  assert.equal(hostCalls(mock, 'api.greynoise.io'), 0, 'no partial week of lookups');
});

test('with nothing saved, an exhausted feed is a 503 with a retry time, never []', async (t) => {
  withEnv(t, { ABUSEIPDB_API_KEY: 'test-abuseipdb' });
  const mock = mockHttps(() => ({ status: 200, payload: { data: [] } }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const governor = _quotaGovernorForTests();
  for (let i = 0; i < 4; i += 1) governor.admit(ABUSE_URL);
  const res = await server.get('/api/abuseipdb-reports');
  assert.equal(hostCalls(mock, 'api.abuseipdb.com'), 0);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('x-quota-state'), 'exhausted');
  assert.equal(res.body.error, 'quota_exhausted');
  assert.equal(res.body.provider, 'abuseipdb-blacklist');
  assert.ok(Date.parse(res.body.retryAt) > Date.now());
});

test("a provider's 429 + Retry-After pauses background calls until then", async (t) => {
  withEnv(t, { NEWSAPI_KEY: 'test-newsapi' });
  const mock = mockHttps(() => ({ status: 429, payload: { code: 'rateLimited' }, headers: { 'retry-after': '600' } }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const first = await server.get('/api/newsapi-headlines');
  assert.equal(first.status, 503, 'a 429 is not an empty headline list');
  assert.equal(first.body.error, 'quota_exhausted');
  const retryIn = Date.parse(first.body.retryAt) - Date.now();
  assert.ok(retryIn > 9 * 60_000 && retryIn <= 10 * 60_000, `retry in ${retryIn} ms`);
  await server.get('/api/newsapi-headlines?q=other');
  assert.equal(hostCalls(mock, 'newsapi.org'), 1, 'the cooldown covers every NewsAPI query');
  const status = await server.get('/api/quota/status');
  const newsapi = status.body.providers.find((p) => p.id === 'newsapi');
  assert.equal(newsapi.state, 'cooldown');
  assert.equal(newsapi.cooldownReason, 'provider_429');
  assert.equal(newsapi.windows[0].used, 1);
});

test('key tests and manual lookups use the reserve; a new key clears the cooldown', async (t) => {
  withEnv(t, { GREYNOISE_API_KEY: 'test-greynoise' });
  const mock = mockHttps(() => ({ status: 200, payload: { ip: '203.0.113.7', noise: false } }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const governor = _quotaGovernorForTests();
  governor.observe(governor.admit(GREY_URL), { status: 429, headers: { get: () => null } });

  const scanners = await server.get('/api/greynoise-scanners');
  assert.equal(scanners.status, 503);
  assert.equal(hostCalls(mock, 'api.greynoise.io'), 0, 'background refresh is paused');

  const lookup = await server.get('/api/greynoise-lookup?ip=203.0.113.7');
  assert.equal(lookup.status, 200);
  assert.equal(hostCalls(mock, 'api.greynoise.io'), 1, 'a manual lookup still goes out');

  const keyTest = await server.post('/api/local-validate-secret', { key: 'GREYNOISE_API_KEY', value: 'typed-key' });
  assert.equal(keyTest.body.valid, true);
  assert.equal(hostCalls(mock, 'api.greynoise.io'), 2, 'a key test still goes out');

  await server.post('/api/local-env-update', { key: 'GREYNOISE_API_KEY', value: 'new-key' });
  const status = await server.get('/api/quota/status');
  const grey = status.body.providers.find((p) => p.id === 'greynoise');
  assert.equal(grey.state, 'ok', 'the new key is not held to the old key\'s cooldown');
  assert.equal(grey.windows[0].used, 3, 'counts are kept');
});

test('OpenSky routes share one snapshot: stale when out of quota, a 503 without one', async (t) => {
  const advance = shiftClock(t);
  let status = 200;
  const mock = mockHttps(() => (status === 200
    ? { status: 200, payload: { time: 1, states: [['abc123', 'DAL1  ', 'United States', 1, 1, -86, 41, 1000, false, 200, 90, 0, null, 1000, '1200', false, 0]] } }
    : { status: 429, payload: {}, headers: { 'x-rate-limit-retry-after-seconds': '300' } }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());

  const fresh = await server.get('/api/adsb');
  assert.equal(fresh.body.states.length, 1);
  status = 429;
  advance(3 * 60_000);
  const stale = await server.get('/api/adsb');
  assert.equal(stale.headers.get('x-quota-state'), 'stale_quota');
  assert.deepEqual(stale.body, fresh.body);
  const flights = await server.get('/api/aviation/flights');
  assert.equal(flights.headers.get('x-quota-state'), 'stale_quota');
  assert.equal(flights.body.degraded, true);
  assert.equal(hostCalls(mock, 'opensky-network.org'), 2, 'one refresh attempt, then the cooldown');

  _resetSidecarCacheForTests();
  const governor = _quotaGovernorForTests();
  governor.observe(governor.admit(OPENSKY_URL), { status: 429, headers: { get: () => null } });
  const none = await server.get('/api/adsb');
  assert.equal(none.status, 503);
  assert.equal(none.body.rateLimited, true);
  assert.equal(none.body.states, null);
  const military = await server.get('/api/adsb-military');
  assert.equal(military.status, 503);
  assert.equal(military.body.error, 'quota_exhausted');
});

test('the ledger survives a sidecar restart', async (t) => {
  withEnv(t, { ABUSEIPDB_API_KEY: 'test-abuseipdb' });
  const dataDir = tempDataDir(t);
  const mock = mockHttps(() => ({ status: 200, payload: { data: [] } }));
  t.after(() => mock.restore());
  const first = await startServer(dataDir);
  await first.get('/api/abuseipdb-reports');
  await first.close();
  const second = await startServer(dataDir);
  t.after(() => second.close());
  const status = await second.get('/api/quota/status');
  assert.equal(status.body.providers.find((p) => p.id === 'abuseipdb-blacklist').windows[0].used, 1);
});

test('the budgets route needs the token and exposes no secrets', async (t) => {
  withEnv(t, { ABUSEIPDB_API_KEY: 'test-abuseipdb-secret-value' });
  const mock = mockHttps(() => ({ status: 200, payload: { data: [] } }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const anonymous = await server.raw('/api/quota/status');
  assert.equal(anonymous.status, 401);
  await server.get('/api/abuseipdb-reports');
  const status = await server.get('/api/quota/status');
  assert.equal(status.status, 200);
  assert.ok(status.body.providers.length >= 10);
  assert.doesNotMatch(JSON.stringify(status.body), /secret-value|https?:\/\//);
});
