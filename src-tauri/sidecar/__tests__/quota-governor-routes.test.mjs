// Bounded runtime slice: actual mocked HTTPS admission and recording.
// Denial opens no socket; NewsAPI preserves tracked cached acquisition on
// exhaustion. Interactive probes/lookups retain their scope and ledger counts
// survive restart. All upstream HTTPS is mocked; no provider is contacted.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import https from 'node:https';
import { QUOTA_RULES } from '../quota-policy.mjs';
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

process.env.CB_SIDECAR_FILE_LOG = '0';
process.env.LOCAL_API_TOKEN ??= 'test-token-quota-governor-routes';
const { createLocalApiServer, _resetSidecarCacheForTests, _quotaGovernorForTests, initQuotaGovernor, _fetchWithTimeoutForTests } = await import('../local-api-server.mjs');

const quiet = { log() {}, warn() {}, error() {} };
const ABUSE_URL = 'https://api.abuseipdb.com/api/v2/blacklist?limit=50';
const OPENSKY_URL = 'https://opensky-network.org/api/states/all';
const GREY_URL = 'https://api.greynoise.io/v3/community/1.2.3.4';

function mockHttps(respond) {
  const original = https.request;
  const requests = [];
  https.request = (options, onResponse) => {
    const url = new URL(`https://${options.hostname}${options.path}`);
    requests.push(url);
    const req = new PassThrough();
    req.setTimeout = () => req;
    req.end = () => {
      queueMicrotask(async () => {
        const { status, payload, headers = {} } = await respond(url, options);
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
  const app = await createLocalApiServer({ port: 0, apiDir: path.resolve('api'), dataDir, resourceDir: dataDir, agentMonitorStatePath: path.join(dataDir, "monitor-state.json"), agentMonitorEventsPath: path.join(dataDir, "monitor-events.json"), littleSnitchExportPath: null, littleSnitchBaselinePath: null, logger: quiet });
  const { port } = await app.start();
  const auth = { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` };
  async function call(route, init = {}) {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, { ...init, headers: { ...auth, ...init.headers } });
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  }
  return {
    call,
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
  t.after(() => { initQuotaGovernor(null); rmSync(dir, { recursive: true, force: true }); });
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

test('NewsAPI fresh cache precedes admission, quota denial opens no socket and never refreshes acquisition', async (t) => {
  withEnv(t, { NEWSAPI_KEY: 'fixture-news' });
  const advance = shiftClock(t);
  const mock = mockHttps(() => ({ status: 200, payload: { articles: [{ title: 'Fixture', url: 'https://example.com/story', source: { name: 'Fixture Wire' }, publishedAt: new Date(Date.now() - 60_000).toISOString() }] } }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const route = '/api/newsapi-headlines?responseMode=tracked-v1&q=fixture';
  const fresh = await server.get(route);
  assert.equal(fresh.body.items.length, 1);
  const governor = _quotaGovernorForTests();
  const news = () => governor.status().providers.find(p => p.id === 'newsapi');
  assert.equal(news().windows[0].used, 1);
  for (let i = 0; i < 79; i++) governor.admit('https://newsapi.org/v2/everything');
  const cached = await server.get(route);
  assert.equal(cached.body.acquisition.outcome, 'ok');
  assert.equal(hostCalls(mock, 'newsapi.org'), 1);
  assert.equal(news().windows[0].used, 80);
  advance(21 * 60_000);
  const paced = await server.get(route);
  assert.equal(paced.body.acquisition.outcome, 'ok', 'original double-TTL pacing applies at the background ceiling');
  assert.equal(hostCalls(mock, 'newsapi.org'), 1);
  advance(20 * 60_000);
  const stale = await server.get(route);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers.get('x-quota-state'), 'stale_quota');
  assert.equal(stale.body.acquisition.outcome, 'rate_limited');
  assert.equal(stale.body.acquisition.delivery, 'memory_cache');
  assert.equal(stale.body.acquisition.acquiredAt, fresh.body.acquisition.acquiredAt);
  assert.equal(stale.body.acquisition.cacheStoredAt, fresh.body.acquisition.cacheStoredAt);
  assert.deepEqual(stale.body.items[0].provenance.publishedAt, fresh.body.items[0].provenance.publishedAt);
  assert.equal(hostCalls(mock, 'newsapi.org'), 1);
  const other = await server.get('/api/newsapi-headlines?responseMode=tracked-v1&q=other-scope');
  assert.equal(other.status, 503);
  assert.equal(other.body.acquisition.outcome, 'rate_limited');
  assert.deepEqual(other.body.items, []);
  const health = await server.get('/api/health');
  assert.equal(health.body.feeds.find(f => f.key === 'newsapi')?.lastError, 'quota_exhausted');
  const feed = await server.get('/api/feeds/health/newsapi');
  assert.equal(feed.body.lastError, 'quota_exhausted');
});

test('interactive manual lookup and coalesced credential verification remain counted during provider cooldown', async (t) => {
  withEnv(t, { GREYNOISE_API_KEY: 'fixture-grey' });
  const mock = mockHttps(async url => {
    if (url.hostname === 'api.groq.com') { await new Promise(resolve => setTimeout(resolve, 25)); return { status: 200, payload: { object: 'list', data: [{ id: 'model', object: 'model' }] } }; }
    return { status: 200, payload: { ip: '203.0.113.7', noise: false } };
  });
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const governor = _quotaGovernorForTests();
  governor.observe(governor.admit(GREY_URL), { status: 429, headers: { get: () => null } });
  const lookup = await server.get('/api/greynoise-lookup?ip=203.0.113.7');
  assert.equal(lookup.status, 200);
  assert.equal(hostCalls(mock, 'api.greynoise.io'), 1);
  governor.observe(governor.admit('https://api.groq.com/openai/v1/models'), { status: 429, headers: { get: () => null } });
  const request = { key: 'GROQ_API_KEY', value: 'typed-fixture' };
  const responses = await Promise.all([server.post('/api/local-validate-secret', request), server.post('/api/local-validate-secret', request)]);
  for (const response of responses) assert.equal(response.body.outcome, 'verified');
  assert.equal(hostCalls(mock, 'api.groq.com'), 1, 'only actual coalesced transport is charged');
  await server.post('/api/local-validate-secret', request);
  assert.equal(hostCalls(mock, 'api.groq.com'), 1, 'verifier recent-attempt cooldown is not charged');
  assert.equal(governor.status().providers.find(p => p.id === 'greynoise').windows[0].used, 2);
  assert.equal(governor.admit(GREY_URL).allowed, false, 'interactive scope does not leak');
});

test('completed response headers pause background transport and close persists charged attempts', async (t) => {
  withEnv(t, { NEWSAPI_KEY: 'fixture-news' });
  const dir = tempDataDir(t);
  const mock = mockHttps(() => ({ status: 429, headers: { 'retry-after': '120' }, payload: {} }));
  t.after(() => mock.restore());
  let server = await startServer(dir);
  t.after(() => server?.close());
  const denied = await server.get('/api/newsapi-headlines?responseMode=tracked-v1');
  assert.equal(denied.status, 503);
  assert.equal(denied.body.acquisition.outcome, 'rate_limited');
  assert.ok(denied.body.acquisition.attemptedAt > 0, 'actual upstream attempt stays recorded');
  assert.equal(hostCalls(mock, 'newsapi.org'), 1);
  await server.get('/api/newsapi-headlines?responseMode=tracked-v1');
  assert.equal(hostCalls(mock, 'newsapi.org'), 1, 'provider cooldown prevents second socket');
  await server.close(); server = null;
  const ledger = JSON.parse(readFileSync(path.join(dir, 'quota-ledger.json'), 'utf8'));
  assert.equal(ledger.rules.newsapi.windows[0].reduce((sum, entry) => sum + entry[1], 0), 1, 'close flushes immediately before restart');
  server = await startServer(dir);
  const news = _quotaGovernorForTests().status().providers.find(p => p.id === 'newsapi');
  assert.equal(news.windows[0].used, 1);
  await server.get('/api/newsapi-headlines?responseMode=tracked-v1');
  assert.equal(hostCalls(mock, 'newsapi.org'), 1, 'persisted cooldown retained');
});

test('all thirteen original governed HTTPS rules deny before opening any socket', async (t) => {
  _resetSidecarCacheForTests();
  const mock = mockHttps(() => ({ status: 200, payload: {} }));
  t.after(() => mock.restore());
  const governor = _quotaGovernorForTests();
  for (const rule of QUOTA_RULES) {
    const url = `https://${rule.host}${rule.pathPrefix}fixture`;
    governor.observe(governor.admit(url), { status: 429, headers: { get: () => null } });
    await assert.rejects(_fetchWithTimeoutForTests(url), { name: 'QuotaExhaustedError' }, rule.id);
  }
  assert.equal(mock.requests.length, 0);
});

test('admission preserves pinned IPv4 transport, completed body observation and failed-attempt charges', async (t) => {
  _resetSidecarCacheForTests();
  const seen = [];
  const mock = mockHttps((url, options) => {
    seen.push(options);
    return { status: 200, payload: url.hostname === 'api.anthropic.com' ? { usage: { input_tokens: 7, output_tokens: 11 } } : { data: [[1], [2], [3]] } };
  });
  t.after(() => mock.restore());
  const response = await _fetchWithTimeoutForTests('https://api.anthropic.com/v1/messages', { method: 'POST', resolvedAddress: '203.0.113.9', maxResponseBytes: 262_144, body: '{"fixture":true}' });
  assert.equal(seen[0].family, 4);
  assert.equal(seen[0].method, 'POST');
  seen[0].lookup('api.anthropic.com', {}, (_error, address, family) => { assert.equal(address, '203.0.113.9'); assert.equal(family, 4); });
  const responseBody = await response.json();
  assert.equal(responseBody.usage.output_tokens, 11, 'governor does not consume caller response');
  await _fetchWithTimeoutForTests('https://api.purpleair.com/v1/sensors?fields=latitude,longitude');
  const providers = _quotaGovernorForTests().status().providers;
  assert.equal(providers.find(p => p.id === 'anthropic').tokens, 18);
  assert.equal(providers.find(p => p.id === 'purpleair').windows[0].used, 6);
  mock.restore();
  const original = https.request;
  https.request = () => { throw new Error('synthetic transport failure'); };
  t.after(() => { https.request = original; });
  await assert.rejects(_fetchWithTimeoutForTests('https://newsapi.org/v2/everything'), /synthetic transport failure/);
  assert.equal(_quotaGovernorForTests().status().providers.find(p => p.id === 'newsapi').windows[0].used, 1, 'failed admitted attempt is not refunded');
});

test('stale disk NewsAPI acquisition keeps disk origin and legacy projection without cache rewrite', async (t) => {
  withEnv(t, { NEWSAPI_KEY: 'fixture-news' });
  const advance = shiftClock(t);
  const dir = tempDataDir(t);
  const mock = mockHttps(() => ({ status: 200, payload: { articles: [{ title: 'Saved', url: 'https://example.org/saved', source: { name: 'Wire' } }] } }));
  t.after(() => mock.restore());
  let server = await startServer(dir);
  t.after(() => server?.close());
  const route = '/api/newsapi-headlines?q=disk&responseMode=tracked-v1';
  const fresh = await server.get(route);
  for (let i = 0; i < 79; i++) _quotaGovernorForTests().admit('https://newsapi.org/v2/everything');
  await server.close(); server = null;
  advance(41 * 60_000);
  server = await startServer(dir);
  const stale = await server.get(route);
  assert.equal(stale.body.acquisition.delivery, 'persistent_cache');
  assert.equal(stale.body.acquisition.outcome, 'rate_limited');
  assert.equal(stale.body.acquisition.acquiredAt, fresh.body.acquisition.acquiredAt);
  assert.equal(stale.body.acquisition.attemptedAt, fresh.body.acquisition.attemptedAt);
  const legacy = await server.get('/api/newsapi-headlines?q=disk');
  assert.ok(Array.isArray(legacy.body));
  assert.equal(legacy.body[0].title, 'Saved');
  assert.equal('provenance' in legacy.body[0], false);
  assert.equal(legacy.headers.get('x-quota-state'), 'stale_quota');
  assert.equal(hostCalls(mock, 'newsapi.org'), 1);
});

test('key rotation clears provider signals without resetting attempted counts', async (t) => {
  withEnv(t, { GREYNOISE_API_KEY: 'old-fixture' });
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const governor = _quotaGovernorForTests();
  governor.observe(governor.admit(GREY_URL), { status: 429, headers: { get: () => null } });
  assert.equal(governor.admit(GREY_URL).allowed, false);
  const update = await server.post('/api/local-env-update', { key: 'GREYNOISE_API_KEY', value: 'new-fixture' });
  assert.equal(update.status, 200);
  assert.equal(governor.status().providers.find(p => p.id === 'greynoise').windows[0].used, 1);
  assert.equal(governor.admit(GREY_URL).allowed, true);
});

test('governed transport retains response-size bounds and still charges a rejected oversized response', async (t) => {
  _resetSidecarCacheForTests();
  const mock = mockHttps(() => ({ status: 200, payload: { data: 'x'.repeat(1000) } }));
  t.after(() => mock.restore());
  await assert.rejects(_fetchWithTimeoutForTests('https://newsapi.org/v2/everything', { maxResponseBytes: 100 }), /limit|size|exceed|large/i);
  assert.equal(_quotaGovernorForTests().status().providers.find(p => p.id === 'newsapi').windows[0].used, 1);
});

test('pending interactive credential work never grants concurrent background requests its priority', async (t) => {
  const url = 'https://api.groq.com/openai/v1/models';
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let responses = 0;
  const mock = mockHttps(async () => {
    entered();
    if (++responses === 1) await gate;
    return { status: 200, payload: { object: 'list', data: [{ id: 'model', object: 'model' }] } };
  });
  t.after(() => { release(); mock.restore(); });
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const governor = _quotaGovernorForTests();
  governor.observe(governor.admit(url), { status: 429, headers: { get: () => null } });
  const interactive = server.post('/api/local-validate-secret', { key: 'GROQ_API_KEY', value: 'overlap-fixture' });
  await Promise.race([started, interactive.then(() => { throw new Error('interactive probe never entered mocked transport'); })]);
  await assert.rejects(_fetchWithTimeoutForTests(url), { name: 'QuotaExhaustedError' });
  assert.equal(mock.requests.length, 1);
  release();
  const result = await interactive;
  assert.equal(result.body.outcome, 'verified');
  assert.equal(governor.status().providers.find(p => p.id === 'groq').windows[0].used, 2);
});

test('credential governed hosts use the injected bounded transport, never an alternate native/global fetch', () => {
  const root = new URL('../', import.meta.url);
  const server = readFileSync(new URL('local-api-server.mjs', root), 'utf8');
  const verifier = readFileSync(new URL('credential-verification.mjs', root), 'utf8');
  assert.match(server, /createCredentialVerifier\(\{ fetch: fetchWithTimeout \}\)/);
  assert.match(server, /runInteractiveQuota\(\(\) => validateSecretAgainstProvider\(key, candidate, safeContext\)\)/);
  assert.match(verifier, /export function createCredentialVerifier\(\{ fetch,/);
  assert.match(verifier, /probeWithDeadline\(fetch, request, key,/);
  assert.doesNotMatch(verifier, /(?:globalThis|global|https|http)\s*\.|import\s.*(?:https|undici|node:net)/);
  const hosts = [...new Set(QUOTA_RULES.map(rule => rule.host))];
  for (const name of readdirSync(root)) {
    if (!name.endsWith('.mjs') || name.includes('.test.') || name.startsWith('quota-') || ['local-api-server.mjs', 'credential-verification.mjs'].includes(name)) continue;
    const source = readFileSync(new URL(name, root), 'utf8');
    for (const host of hosts) assert.equal(source.includes(`//${host}`), false, `${name} contains a governed host outside the verified transport graph`);
  }
  assert.equal((server.match(/transportFetchWithTimeout\(/g) ?? []).length, 2, 'raw transport has exactly the governed caller and declaration');
  assert.equal((server.match(/runInteractiveQuota\(\(\) =>/g) ?? []).length, 3, 'only original credential and two explicit lookups are interactive');
});

test('startup without an explicit data directory keeps the governor memory-only', async (t) => {
  const dir = tempDataDir(t);
  const saved = process.env.LOCAL_API_DATA_DIR;
  delete process.env.LOCAL_API_DATA_DIR;
  t.after(() => { if (saved === undefined) delete process.env.LOCAL_API_DATA_DIR; else process.env.LOCAL_API_DATA_DIR = saved; });
  const mock = mockHttps(() => ({ status: 200, payload: {} }));
  t.after(() => mock.restore());
  _resetSidecarCacheForTests();
  const app = await createLocalApiServer({ port: 0, apiDir: path.resolve('api'), resourceDir: dir, agentMonitorStatePath: path.join(dir, 'monitor-state.json'), agentMonitorEventsPath: path.join(dir, 'monitor-events.json'), littleSnitchExportPath: null, littleSnitchBaselinePath: null, logger: quiet });
  await app.start();
  await _fetchWithTimeoutForTests('https://newsapi.org/v2/everything');
  await app.close();
  assert.equal(_quotaGovernorForTests().status().providers.find(p => p.id === 'newsapi').windows[0].used, 1);
  assert.equal(existsSync(path.join(dir, 'quota-ledger.json')), false);
});

test('explicit VirusTotal lookup retains counted interactive scope during cooldown', async (t) => {
  withEnv(t, { VIRUSTOTAL_API_KEY: 'fixture-vt' });
  const mock = mockHttps(() => ({ status: 200, payload: { data: { attributes: { last_analysis_stats: { malicious: 2 } } } } }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const governor = _quotaGovernorForTests();
  const url = 'https://www.virustotal.com/api/v3/ip_addresses/203.0.113.7';
  governor.observe(governor.admit(url), { status: 429, headers: { get: () => null } });
  const result = await server.get('/api/virustotal-lookup?type=ip&indicator=203.0.113.7');
  assert.equal(result.status, 200);
  assert.equal(result.body.malicious, 2);
  assert.equal(hostCalls(mock, 'www.virustotal.com'), 1);
  assert.equal(governor.status().providers.find(p => p.id === 'virustotal').windows[0].used, 2);
  await assert.rejects(_fetchWithTimeoutForTests(url), { name: 'QuotaExhaustedError' });
});

test('governed transport retains caller cancellation without refund or completed-response observation', async (t) => {
  _resetSidecarCacheForTests();
  const mock = mockHttps(async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    return { status: 200, payload: { usage: { input_tokens: 99 } } };
  });
  t.after(() => mock.restore());
  const controller = new AbortController();
  controller.abort(new DOMException('synthetic cancellation', 'AbortError'));
  await assert.rejects(_fetchWithTimeoutForTests('https://api.anthropic.com/v1/messages', { signal: controller.signal, maxResponseBytes: 262_144 }), { name: 'AbortError' });
  const provider = _quotaGovernorForTests().status().providers.find(p => p.id === 'anthropic');
  assert.equal(provider.windows[0].used, 1);
  assert.equal(provider.tokens, 0);
});

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


test('GreyNoise preflights the full batch and never starts one that cannot fit', async (t) => {
  withEnv(t, { GREYNOISE_API_KEY: 'fixture-grey' });
  const mock = mockHttps(() => ({ status: 200, payload: { ip: '203.0.113.7' } }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  for (let i = 0; i < 21; i++) _quotaGovernorForTests().admit(GREY_URL);
  const result = await server.get('/api/greynoise-scanners');
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'quota_exhausted');
  assert.equal(mock.requests.length, 0);
});

test('GreyNoise concurrent headroom loss keeps per-send admission and never publishes healthy partial results', async (t) => {
  withEnv(t, { GREYNOISE_API_KEY: 'fixture-grey' });
  let consumed = false;
  const mock = mockHttps(url => {
    if (!consumed) {
      consumed = true;
      for (let i = 0; i < 35; i++) _quotaGovernorForTests().admit(GREY_URL, { priority: 'interactive' });
    }
    return { status: 200, payload: { ip: url.pathname.split('/').at(-1), noise: false } };
  });
  t.after(() => mock.restore());
  const dir = tempDataDir(t);
  const server = await startServer(dir);
  t.after(() => server.close());
  const result = await server.get('/api/greynoise-scanners');
  assert.equal(result.status, 503);
  assert.equal(result.body.error, 'quota_exhausted');
  assert.equal(mock.requests.length, 5);
  const cachePath = path.join(dir, 'quota-cache.json');
  const entries = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')).entries : {};
  assert.equal('greynoise-scanners' in entries, false);
  const health = await server.get('/api/feeds/health/greynoise-scanners');
  assert.equal(health.body.status, 'down');
  assert.equal(health.body.lastError, 'quota_exhausted');
});

test('PurpleAir cooldown returns only its matching stale scope and never upgrades it to fresh', async (t) => {
  withEnv(t, { PURPLEAIR_API_KEY: 'fixture-purple' });
  const advance = shiftClock(t);
  const mock = mockHttps(() => ({ status: 200, payload: { fields: ['sensor_index','pm2.5','latitude','longitude','location_type','confidence','name','last_seen'], data: [[1,12,41,-86,0,95,'Fixture',1_700_000_000]] } }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const route = '/api/airquality/purpleair?nwlng=-87&nwlat=42&selng=-86&selat=41';
  const fresh = await server.get(route);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.sensors.length, 1);
  const sent = mock.requests.find(url => url.hostname === 'api.purpleair.com');
  assert.equal(sent.searchParams.has('max_age'), false);
  assert.equal(sent.searchParams.get('fields').split(',').length, 8);
  assert.ok(sent.searchParams.get('fields').split(',').includes('location_type'));
  assert.equal(_quotaGovernorForTests().status().providers.find(p => p.id === 'purpleair').windows[0].used, 8, 'estimate follows the actual eight requested fields');
  advance(6 * 60_000);
  const governor = _quotaGovernorForTests();
  governor.observe(governor.admit('https://api.purpleair.com/v1/sensors'), { status: 402, headers: { get: () => null } });
  const stale = await server.get(route);
  assert.equal(stale.headers.get('x-quota-state'), 'stale_quota');
  assert.deepEqual(stale.body, fresh.body);
  for (const other of ['/api/airquality/purpleair', '/api/airquality/purpleair?nwlng=0&nwlat=1&selng=1&selat=0']) {
    const missing = await server.get(other);
    assert.equal(missing.status, 503);
    assert.equal(missing.body.error, 'quota_exhausted');
    assert.deepEqual(missing.body.sensors, []);
  }
  assert.equal(hostCalls(mock, 'api.purpleair.com'), 1);
  const health = await server.get('/api/feeds/health/purpleair');
  assert.equal(health.body.lastError, 'quota_exhausted');
});

test('three concurrent global OpenSky consumers share a request and stale transformations never refresh observation time', async (t) => {
  const advance = shiftClock(t);
  let status = 200;
  const state = ['ae0001','RCH1','United States',1,1,-86,41,1000,false,200,90,0,null,1000,'1200',false,0];
  const mock = mockHttps(async () => { await new Promise(resolve => setTimeout(resolve, 10)); return { status, payload: status === 200 ? { time: 1, states: [state] } : {}, headers: status === 429 ? { 'retry-after': '300' } : {} }; });
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const routes = ['/api/adsb', '/api/adsb-military', '/api/aviation/flights'];
  const fresh = await Promise.all(routes.map(route => server.get(route)));
  assert.equal(mock.requests.length, 1);
  assert.equal(fresh[0].body.states.length, 1);
  assert.equal(fresh[1].body.length, 1);
  assert.equal(fresh[2].body.flights.length, 1);
  status = 429;
  advance(11 * 60_000);
  const stale = await Promise.all(routes.map(route => server.get(route)));
  assert.equal(mock.requests.length, 2);
  for (const response of stale) assert.equal(response.headers.get('x-quota-state'), 'stale_quota');
  assert.deepEqual(stale[0].body, fresh[0].body);
  assert.deepEqual(stale[1].body, fresh[1].body);
  assert.equal(stale[2].body.degraded, true);
  assert.ok(stale[2].body.fetchedAt <= fresh[2].body.fetchedAt, 'stale transformation must not fabricate a fresh observation');
  const repeated = await Promise.all(routes.map(route => server.get(route)));
  for (const response of repeated) assert.equal(response.headers.get('x-quota-state'), 'stale_quota', 'failed refresh was not cached as a fresh derived result');
  assert.equal(mock.requests.length, 2);
});

const openskyFixtureRow = id => [id,'DAL1','United States',1,1,-86,41,1000,false,200,90,0,null,1000,'1200',false,0];

test('bounded fourth OpenSky query never consumes or supplies the shared global snapshot', async (t) => {
  const advance = shiftClock(t);
  const mock = mockHttps(url => ({ status: 200, payload: url.hostname === 'opensky-network.org' ? { time: 1, states: [openskyFixtureRow(url.search ? 'bbbbbb' : 'aaaaaa')] } : { ac: [] } }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const global = await server.get('/api/adsb');
  assert.equal(global.body.states[0][0], 'aaaaaa');
  const bounded = await server.get('/api/adsb-aggregate?lat=41&lon=-86&dist=20');
  assert.deepEqual(bounded.body.aircraft.map(row => row.icao), ['bbbbbb']);
  assert.equal(hostCalls(mock, 'opensky-network.org'), 2);
  advance(31_000);
  const governor = _quotaGovernorForTests();
  governor.observe(governor.admit(OPENSKY_URL), { status: 429, headers: { get: () => null } });
  const denied = await server.get('/api/adsb-aggregate?lat=40&lon=-85&dist=20');
  assert.equal(denied.body.sources.opensky.ok, false);
  assert.deepEqual(denied.body.aircraft, []);
  assert.equal(hostCalls(mock, 'opensky-network.org'), 2);
});

test('shared global OpenSky pacing doubles only its original TTL and malformed responses never seed it', async (t) => {
  const advance = shiftClock(t);
  let payload = {};
  const mock = mockHttps(() => ({ status: 200, payload }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const invalid = await server.get('/api/adsb');
  assert.match(invalid.body.error, /malformed/);
  payload = { time: 1, states: null };
  const validEmpty = await server.get('/api/adsb');
  assert.equal(validEmpty.body.states, null);
  assert.equal('error' in validEmpty.body, false);
  assert.equal(mock.requests.length, 2);
  for (let i = 0; i < 638; i++) _quotaGovernorForTests().admit(OPENSKY_URL);
  advance(3 * 60_000);
  await server.get('/api/adsb');
  assert.equal(mock.requests.length, 2, '64%-total pacing keeps the original snapshot through minute3');
  advance(2 * 60_000);
  await server.get('/api/adsb');
  assert.equal(mock.requests.length, 3, 'paced four-minute cache still expires');
});

test('GreyNoise quota stop is a real batch break and stale preflight never rewrites the last good list', async (t) => {
  withEnv(t, { GREYNOISE_API_KEY: 'fixture-grey' });
  const advance = shiftClock(t);
  let status = 429;
  const mock = mockHttps(url => ({ status, payload: { ip: url.pathname.split('/').at(-1), noise: false } }));
  t.after(() => mock.restore());
  const dir = tempDataDir(t);
  const server = await startServer(dir);
  t.after(() => server.close());
  const governor = _quotaGovernorForTests();
  const originalAdmit = governor.admit;
  let admissions = 0;
  governor.admit = (...args) => { admissions++; return originalAdmit(...args); };
  const denied = await server.get('/api/greynoise-scanners');
  assert.equal(denied.status, 503);
  assert.equal(admissions, 5, 'no later batch even attempts admission after provider429');
  assert.equal(mock.requests.length, 5);
  governor.resetSignalsForSecret('GREYNOISE_API_KEY');
  status = 200;
  const fresh = await server.get('/api/greynoise-scanners');
  assert.equal(fresh.body.length, 20);
  const file = path.join(dir, 'quota-cache.json');
  const saved = readFileSync(file, 'utf8');
  advance(8 * 24 * 60 * 60_000);
  for (let i = 0; i < 21; i++) governor.admit(GREY_URL);
  const count = mock.requests.length;
  const stale = await server.get('/api/greynoise-scanners');
  assert.equal(stale.headers.get('x-quota-state'), 'stale_quota');
  assert.deepEqual(stale.body, fresh.body);
  assert.equal(mock.requests.length, count);
  assert.equal(readFileSync(file, 'utf8'), saved);
  const health = await server.get('/api/health');
  assert.equal(health.body.feeds.find(f => f.key === 'greynoise-scanners')?.lastError, 'quota_exhausted');
});

test('AbuseIPDB valid-empty stale remains marked stale while missing data is503', async (t) => {
  withEnv(t, { ABUSEIPDB_API_KEY: 'fixture-abuse' });
  const advance = shiftClock(t);
  let status = 200;
  const mock = mockHttps(() => ({ status, payload: { data: [] } }));
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const fresh = await server.get('/api/abuseipdb-reports');
  assert.deepEqual(fresh.body, []);
  advance(9 * 60 * 60_000);
  status = 429;
  const stale = await server.get('/api/abuseipdb-reports');
  assert.equal(stale.status, 200);
  assert.deepEqual(stale.body, []);
  assert.equal(stale.headers.get('x-quota-state'), 'stale_quota');
  _resetSidecarCacheForTests();
  const governor = _quotaGovernorForTests();
  governor.observe(governor.admit(ABUSE_URL), { status: 429, headers: { get: () => null } });
  const none = await server.get('/api/abuseipdb-reports');
  assert.equal(none.status, 503);
  assert.equal(none.body.error, 'quota_exhausted');
  assert.equal(mock.requests.length, 2);
});

const recoveryCases = [
  { name: 'newsapi', feed: 'newsapi', key: 'NEWSAPI_KEY', route: '/api/newsapi-headlines?responseMode=tracked-v1', good: () => ({ articles: [] }), bad: () => ({ articles: [{ title: '', url: 'bad' }] }) },
  { name: 'abuse', feed: 'abuseipdb-reports', key: 'ABUSEIPDB_API_KEY', route: '/api/abuseipdb-reports', good: () => ({ data: [] }), bad: () => ({ data: [{}] }) },
  { name: 'purple', feed: 'purpleair', key: 'PURPLEAIR_API_KEY', route: '/api/airquality/purpleair', good: () => ({ fields: ['sensor_index','pm2.5','latitude','longitude'], data: [] }), bad: () => ({ fields: ['sensor_index','pm2.5','latitude','longitude'], data: [['bad',null,null,null]] }) },
  { name: 'opensky', feed: 'opensky-states', key: 'OPENSKY_CLIENT_ID', route: '/api/adsb', good: () => ({ time: 1, states: null }), bad: () => ({ time: 1, states: [['ae0001','RCH1','US',1,1,null,null,1000,false,200,90,0,null,1000,'1200',false,0]] }) },
  { name: 'grey', feed: 'greynoise-scanners', key: 'GREYNOISE_API_KEY', route: '/api/greynoise-scanners', good: url => ({ ip: url.pathname.split('/').at(-1), noise: false }), bad: () => ({}) },
];
for (const fixture of recoveryCases) {
  test(`${fixture.name} recovers both health surfaces only after validated fresh upstream success`, async (t) => {
    const advance = shiftClock(t);
    withEnv(t, { [fixture.key]: 'recovery-fixture', OPENSKY_CLIENT_SECRET: 'recovery-partner' });
    let status = 429;
    const mock = mockHttps(url => ({ status, payload: fixture.good(url) }));
    t.after(() => mock.restore());
    const server = await startServer(tempDataDir(t));
    t.after(() => server.close());
    await server.get(fixture.route);
    const failed = await server.get(`/api/feeds/health/${fixture.feed}`);
    assert.equal(failed.body.status, 'down');
    _quotaGovernorForTests().resetSignalsForSecret(fixture.key);
    status = 200;
    const fresh = await server.get(fixture.route);
    assert.equal(fresh.status, 200);
    const recovered = await server.get(`/api/feeds/health/${fixture.feed}`);
    assert.equal(recovered.body.status, 'up');
    assert.equal(recovered.body.lastError, null);
    const other = await server.get('/api/health');
    assert.equal(other.body.feeds.find(row => row.key === fixture.feed)?.lastError, null);
    const receivedAt = recovered.body.lastSuccess;
    advance(1000);
    await server.get(fixture.route);
    const cached = await server.get(`/api/feeds/health/${fixture.feed}`);
    assert.equal(cached.body.lastSuccess, receivedAt, 'cache hit cannot refresh successful-acquisition clock');
  });
  test(`${fixture.name} rejected rows never clear a prior quota failure`, async (t) => {
    withEnv(t, { [fixture.key]: 'recovery-fixture', OPENSKY_CLIENT_SECRET: 'recovery-partner' });
    let status = 429;
    const mock = mockHttps(() => ({ status, payload: fixture.bad() }));
    t.after(() => mock.restore());
    const server = await startServer(tempDataDir(t));
    t.after(() => server.close());
    await server.get(fixture.route);
    _quotaGovernorForTests().resetSignalsForSecret(fixture.key);
    status = 200;
    await server.get(fixture.route);
    const health = await server.get(`/api/feeds/health/${fixture.feed}`);
    assert.equal(health.body.status, 'down');
    const other = await server.get('/api/health');
    assert.equal(other.body.feeds.find(row => row.key === fixture.feed)?.lastError, 'quota_exhausted');
    if (fixture.name === 'opensky') {
      const beforeRetry = mock.requests.length;
      await server.get(fixture.route);
      assert.equal(mock.requests.length, beforeRetry + 1, 'all-rejected snapshot must not poison the fresh cache');
    }
  });
}

test('a non-quota partial GreyNoise result cannot generate a new healthy recovery vote', async (t) => {
  withEnv(t, { GREYNOISE_API_KEY: 'partial-fixture' });
  let phase = 'quota';
  let seen = 0;
  const mock = mockHttps(url => {
    let status = 429;
    if (phase !== 'quota') status = ++seen <= 5 ? 200 : 500;
    return { status, payload: { ip: url.pathname.split('/').at(-1), noise: false } };
  });
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  await server.get('/api/greynoise-scanners');
  _quotaGovernorForTests().resetSignalsForSecret('GREYNOISE_API_KEY');
  phase = 'partial';
  await server.get('/api/greynoise-scanners');
  assert.equal(seen, 20);
  const health = await server.get('/api/feeds/health/greynoise-scanners');
  assert.equal(health.body.status, 'down');
  assert.equal(health.body.lastError, 'quota_exhausted');
});


test('quota status is authenticated GET-only private detached metadata with no provider traffic', async (t) => {
  const mock = mockHttps(() => { throw new Error('status must not fetch providers'); });
  t.after(() => mock.restore());
  const server = await startServer(tempDataDir(t));
  t.after(() => server.close());
  const unauthenticated = await server.raw('/api/quota/status');
  assert.equal(unauthenticated.status, 401);
  for (const authorization of ['Bearer wrong', 'Bearer ééé']) {
    const rejected = await server.call('/api/quota/status', { headers: { authorization } });
    assert.equal(rejected.status, 401);
  }
  const preflight = await server.call('/api/quota/status', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  const wrongMethod = await server.post('/api/quota/status', {});
  assert.equal(wrongMethod.status, 405);
  const governor = _quotaGovernorForTests();
  governor.admit('https://newsapi.org/v2/top-headlines?apiKey=never-expose-fixture');
  const result = await server.get('/api/quota/status');
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.body.providers.length, 13);
  assert.equal(result.body.targetShare, 0.8);
  assert.equal(result.body.providers.find(p => p.id === 'newsapi').windows[0].used, 1);
  assert.deepEqual(Object.keys(result.body).sort(), ['asOf','providers','targetShare','throttledHosts']);
  const serialized = JSON.stringify(result.body);
  for (const forbidden of ['never-expose-fixture', 'apiKey=', 'https://', process.env.LOCAL_API_TOKEN, 'filePath', 'NEWSAPI_KEY']) assert.equal(serialized.includes(forbidden), false);
  result.body.providers[0].windows[0].used = 999;
  const refreshed = await server.get('/api/quota/status');
  assert.notEqual(refreshed.body.providers[0].windows[0].used, 999);
  assert.equal(mock.requests.length, 0);
});
