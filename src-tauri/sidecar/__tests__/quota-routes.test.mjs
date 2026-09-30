// R4-BUG-005 step 1: quota-limited routes keep their TTLs across a sidecar
// restart, never cache an all-failed GreyNoise refresh, and request fewer
// PurpleAir points. Upstream HTTPS is mocked; nothing leaves the machine.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import https from 'node:https';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

process.env.LOCAL_API_TOKEN ??= 'test-token-quota-routes';
const { createLocalApiServer, _resetSidecarCacheForTests } = await import('../local-api-server.mjs');

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
  const app = await createLocalApiServer({ port: 0, apiDir: path.resolve('api'), dataDir, logger: quiet });
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
  t.after(() => rmSync(dir, { recursive: true, force: true }));
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
  assert.deepEqual(first.body, []);
  assert.deepEqual(second.body, []);
  assert.equal(spent, 20);
  assert.equal(upstream(), 20, 'backoff: no second round of lookups');
  const file = path.join(dataDir, 'quota-cache.json');
  const persisted = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).entries : {};
  assert.equal('greynoise-scanners' in persisted, false, 'an empty failure is not cached for a week');
});

test('PurpleAir asks for fewer points and reuses a saved-place box for an hour', async (t) => {
  withEnv(t, { PURPLEAIR_API_KEY: 'test-purpleair' });
  const dataDir = tempDataDir(t);
  const mock = mockHttps(() => ({ status: 200, payload: {
    fields: ['sensor_index', 'pm2.5', 'latitude', 'longitude', 'confidence', 'name', 'last_seen'],
    data: [[1, 12.5, 41.6, -86.7, 95, 'Porch', 1_700_000_000]],
  } }));
  t.after(() => mock.restore());

  const server = await startServer(dataDir);
  const route = '/api/airquality/purpleair?nwlng=-87&nwlat=42&selng=-86&selat=41';
  const res = await server.get(route);
  await server.get(route);
  await server.close();
  const calls = mock.requests.filter((u) => u.hostname === 'api.purpleair.com');
  assert.equal(calls.length, 1);
  const fields = new Set(calls[0].searchParams.get('fields').split(','));
  assert.ok(fields.has('confidence'), 'confidence stays: the renderer gates on it');
  assert.equal(fields.has('location_type'), false);
  assert.equal(calls[0].searchParams.get('max_age'), '3600');
  assert.equal(calls[0].searchParams.get('location_type'), '0');
  assert.equal(res.body.sensors.length, 1);
  assert.equal(res.body.sensors[0].confidence, 95);
});

test('without an explicit data dir (dev runs, tests) the quota cache is memory-only', async (t) => {
  withEnv(t, { ABUSEIPDB_API_KEY: 'test-abuseipdb' });
  const saved = process.env.LOCAL_API_DATA_DIR;
  delete process.env.LOCAL_API_DATA_DIR;
  t.after(() => { if (saved !== undefined) process.env.LOCAL_API_DATA_DIR = saved; });
  const mock = mockHttps(() => ({ status: 200, payload: { data: [{ ipAddress: '203.0.113.9' }] } }));
  t.after(() => mock.restore());
  _resetSidecarCacheForTests();
  const app = await createLocalApiServer({ port: 0, apiDir: path.resolve('api'), logger: quiet });
  const { port } = await app.start();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/abuseipdb-reports`, { headers: { authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` } });
    const body = await res.json();
    assert.equal(body[0].ipAddress, '203.0.113.9');
  } finally {
    await app.close();
  }
  assert.equal(existsSync(path.join(process.cwd(), 'quota-cache.json')), false, 'nothing written into the working tree');
});
