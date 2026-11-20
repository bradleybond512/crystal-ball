import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createLocalApiServer,
  getFeedSnapshots,
  _resetFeedTracker,
  _resetSidecarCacheForTests,
  _quotaGovernorForTests,
} from '../local-api-server.mjs';
import { getFeedStatus, _resetFeedHealthTracker } from '../feed-health-tracker.mjs';

const DATASET = '/api/explore/v2.1/catalog/datasets/ukpn-live-faults';
const TOKEN = 'ukpn-route-test-token';
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const FEED = 'ukpn-live-faults';

function snapshot(rows = [{ incidentreference: 'INCD-test-1', powercuttype: 'Unplanned', nocustomeraffected: 0, restoreddatetime: null }], publishedAt = new Date(Date.now() - 1000).toISOString()) {
  const metadata = { metas: { default: { data_processed: publishedAt, records_count: rows.length } } };
  return {
    publishedAt,
    respond: ({ path: requestPath }) => ({ body: requestPath.endsWith('/records?limit=100') ? { total_count: rows.length, results: rows } : metadata }),
  };
}

function mockHttps(handler) {
  const original = https.request;
  const requests = [];
  https.request = (options, onResponse) => {
    const req = new PassThrough();
    const record = { ...options, req, destroyed: false };
    requests.push(record);
    req.setTimeout = () => req;
    req.on('close', () => { record.destroyed = true; });
    req.end = async () => {
      try {
        const { body, status = 200, headers = {}, chunks } = await handler(record);
        if (req.destroyed) return;
        const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
        const response = Readable.from(chunks ?? [bytes]);
        response.statusCode = status;
        response.headers = { 'content-type': 'application/json', 'content-length': String(bytes.length), ...headers };
        response.once('end', () => req.emit('close'));
        onResponse(response);
      } catch (error) {
        req.destroy(error);
      }
    };
    return req;
  };
  return { requests, restore() { https.request = original; } };
}

async function withRoute(handler, run) {
  const previousToken = process.env.LOCAL_API_TOKEN;
  process.env.LOCAL_API_TOKEN = TOKEN;
  _resetSidecarCacheForTests();
  _resetFeedTracker();
  _resetFeedHealthTracker();
  const mocked = mockHttps(handler);
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'crystalball-ukpn-route-'));
  const app = await createLocalApiServer({ port: 0, apiDir: path.resolve('api'), dataDir, logger: { log() {}, warn() {}, error() {} } });
  let received = 0;
  app.server.on('request', (req) => { if (req.url === '/api/ukpn-outages') received += 1; });
  const { port } = await app.start();
  try {
    await run({ url: `http://127.0.0.1:${port}/api/ukpn-outages`, requests: mocked.requests, received: () => received });
  } finally {
    await app.close();
    _resetSidecarCacheForTests();
    await rm(dataDir, { recursive: true, force: true });
    mocked.restore();
    if (previousToken === undefined) delete process.env.LOCAL_API_TOKEN;
    else process.env.LOCAL_API_TOKEN = previousToken;
  }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail('Expected route/transport event did not occur within one second');
}

test('UKPN route retains authentication and preflight without fetching', async () => {
  await withRoute(snapshot().respond, async ({ url, requests }) => {
    const rejected = await fetch(url);
    assert.equal(rejected.status, 401);
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:3000' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3000');
    assert.equal(requests.length, 0);
  });
});

test('UKPN route rejects methods and every query before acquisition', async () => {
  await withRoute(snapshot().respond, async ({ url, requests }) => {
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
      const response = await fetch(url, { method, headers: AUTH });
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.get('allow'), 'GET, OPTIONS');
    }
    for (const query of ['?url=http://127.0.0.1/', '?limit=100', '?x=', '?x=1&x=2']) {
      const response = await fetch(url + query, { headers: AUTH });
      assert.equal(response.status, 400, query);
    }
    assert.equal(requests.length, 0);
  });
});

test('UKPN route serves normalized zero-count reports using fixed endpoints and publication health', async () => {
  const fixture = snapshot();
  await withRoute(fixture.respond, async ({ url, requests }) => {
    const response = await fetch(url, { headers: AUTH });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.state, 'reported');
    assert.deepEqual(body.incidents, [{ id: 'INCD-test-1', customersAffected: 0 }]);
    assert.deepEqual(requests.map(({ hostname, path: requestedPath }) => [hostname, requestedPath]), [
      ['ukpowernetworks.opendatasoft.com', DATASET],
      ['ukpowernetworks.opendatasoft.com', `${DATASET}/records?limit=100`],
      ['ukpowernetworks.opendatasoft.com', DATASET],
    ]);
    for (const request of requests) assert.equal(request.headers.Authorization, undefined);
    assert.equal(getFeedSnapshots().find((feed) => feed.key === FEED)?.lastSuccessAt, Date.parse(fixture.publishedAt));
    assert.equal(getFeedStatus(FEED).lastSuccess, Date.parse(fixture.publishedAt));
    const cached = await fetch(url, { headers: AUTH });
    assert.deepEqual(await cached.json(), body);
    assert.equal(requests.length, 3);
    assert.equal(getFeedStatus(FEED).lastSuccess, Date.parse(fixture.publishedAt));
  });
});

test('UKPN empty accepted output never records successful feed health', async () => {
  await withRoute(snapshot([{ incidentreference: 'restored', powercuttype: 'Restored' }]).respond, async ({ url }) => {
    const response = await fetch(url, { headers: AUTH });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.state, 'empty');
    assert.deepEqual(body.incidents, []);
    assert.equal(getFeedSnapshots().find((feed) => feed.key === FEED)?.lastSuccessAt, null);
    assert.equal(getFeedStatus(FEED).status, 'down');
    assert.equal(getFeedStatus(FEED).lastSuccess, null);
  });
});

test('UKPN stale publication remains unavailable and never records healthy output', async () => {
  await withRoute(snapshot(undefined, new Date(Date.now() - 15 * 60_000).toISOString()).respond, async ({ url }) => {
    const response = await fetch(url, { headers: AUTH });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.state, 'stale');
    assert.equal(getFeedSnapshots().find((feed) => feed.key === FEED)?.lastSuccessAt, null);
    assert.equal(getFeedStatus(FEED).status, 'down');
  });
});

test('UKPN route rejects redirects without requesting the redirected destination', async () => {
  // eslint-disable-next-line sonarjs/no-clear-text-protocols -- synthetic insecure metadata redirect must be rejected without an outbound request
  await withRoute(() => ({ status: 302, body: '', headers: { location: 'http://169.254.169.254/latest/meta-data/' } }), async ({ url, requests }) => {
    const response = await fetch(url, { headers: AUTH });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.state, 'unavailable');
    assert.deepEqual(body.incidents, []);
    assert.equal(requests.length, 1);
    assert.equal(JSON.stringify(body).includes('169.254'), false);
    assert.equal(getFeedStatus(FEED).lastSuccess, null);
  });
});

test('UKPN route honors quota admission before opening an upstream socket', async () => {
  await withRoute(snapshot().respond, async ({ url, requests }) => {
    const governor = _quotaGovernorForTests();
    const originalAdmit = governor.admit;
    const admitted = [];
    governor.admit = (destination) => {
      admitted.push(destination);
      return { allowed: false, ruleId: FEED, reason: 'provider', retryAt: Date.now() + 60_000 };
    };
    try {
      const response = await fetch(url, { headers: AUTH });
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.state, 'unavailable');
      assert.deepEqual(admitted, [`https://ukpowernetworks.opendatasoft.com${DATASET}`]);
      assert.equal(requests.length, 0);
      assert.equal(getFeedStatus(FEED).lastSuccess, null);
    } finally {
      governor.admit = originalAdmit;
    }
  });
});

for (const kind of ['metadata-declared', 'metadata-streamed', 'records-declared', 'records-streamed']) {
  test(`UKPN route enforces ${kind} byte cap through the native transport`, async () => {
    const fixture = snapshot();
    await withRoute((request) => {
      const isRecords = request.path.endsWith('/records?limit=100');
      if (kind.startsWith('records') !== isRecords) return fixture.respond(request);
      const cap = isRecords ? 512 * 1024 : 64 * 1024;
      const { body } = fixture.respond(request);
      if (kind.endsWith('declared')) return { body, headers: { 'content-length': String(cap + 1) } };
      const json = JSON.stringify(body);
      const bytes = Buffer.from(json + ' '.repeat(cap + 1 - Buffer.byteLength(json)));
      assert.deepEqual(JSON.parse(bytes.toString()), body);
      return { body, headers: { 'content-length': undefined }, chunks: [bytes.subarray(0, cap), bytes.subarray(cap)] };
    }, async ({ url, requests }) => {
      const response = await fetch(url, { headers: AUTH });
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.state, 'unavailable');
      assert.equal(requests.length, kind.startsWith('records') ? 2 : 1);
      assert.equal(getFeedStatus(FEED).lastSuccess, null);
    });
  });
}

test('UKPN provider is included in the desktop resources', async () => {
  const config = JSON.parse(await readFile(new URL('../../tauri.conf.json', import.meta.url), 'utf8'));
  assert.equal(config.bundle.resources.filter((entry) => entry === 'sidecar/ukpn-live-faults.mjs').length, 1);
});

test('UKPN route detaches a cancelled caller while preserving another shared waiter', { timeout: 5000 }, async () => {
  const fixture = snapshot();
  let release;
  let calls = 0;
  await withRoute(async (request) => {
    calls += 1;
    if (calls === 1) await new Promise((resolve) => { release = resolve; });
    return fixture.respond(request);
  }, async ({ url, requests, received }) => {
    const controller = new AbortController();
    const first = fetch(url, { headers: AUTH, signal: controller.signal });
    const firstRejected = assert.rejects(first, { name: 'AbortError' });
    await waitFor(() => calls === 1);
    const second = fetch(url, { headers: AUTH });
    await waitFor(() => received() === 2);
    controller.abort();
    await firstRejected;
    await delay(10);
    assert.equal(requests[0].req.destroyed, false);
    release();
    const response = await second;
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.state, 'reported');
    assert.equal(requests.length, 3);
  });
});

test('UKPN route cancels upstream when the last caller leaves and permits a new acquisition', { timeout: 5000 }, async () => {
  const fixture = snapshot();
  let calls = 0;
  await withRoute(async (request) => {
    calls += 1;
    if (calls === 1) await new Promise(() => {});
    return fixture.respond(request);
  }, async ({ url, requests }) => {
    const controller = new AbortController();
    const pending = fetch(url, { headers: AUTH, signal: controller.signal });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await waitFor(() => calls === 1);
    controller.abort();
    await rejected;
    await waitFor(() => requests[0].req.destroyed);
    assert.equal(getFeedStatus(FEED).lastSuccess, null);
    const response = await fetch(url, { headers: AUTH });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.state, 'reported');
    assert.equal(requests.length, 4);
  });
});

test('UKPN cached reports expire by publication time and cannot renew health', async () => {
  const originalNow = Date.now;
  let now = originalNow();
  const fixture = snapshot(undefined, new Date(now - 15 * 60_000 + 1000).toISOString());
  Date.now = () => now;
  try {
    await withRoute(fixture.respond, async ({ url }) => {
      const first = await fetch(url, { headers: AUTH });
      assert.equal(first.status, 200);
      const accepted = await first.json();
      now += 1000;
      const second = await fetch(url, { headers: AUTH });
      assert.equal(second.status, 503);
      const expired = await second.json();
      assert.equal(expired.state, 'stale');
      assert.deepEqual(expired.incidents, []);
      assert.equal(getFeedStatus(FEED).status, 'down');
      assert.equal(getFeedStatus(FEED).lastSuccess, Date.parse(accepted.publishedAt));
    });
  } finally {
    Date.now = originalNow;
  }
});
