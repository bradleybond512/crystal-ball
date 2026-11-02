import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';

const SOURCE = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert,update';
const NOW = Date.parse('2026-11-02T03:30:00Z');
let sequence = 0;
const request = () => new Request('https://crystalball-main-bradleybond512.vercel.app/api/nws-alerts', {
  headers: { origin: 'https://crystalball-main-bradleybond512.vercel.app' },
});
const feature = (index = 0) => ({
  type: 'Feature', id: `https://api.weather.gov/alerts/test-${index}`, geometry: null,
  properties: {
    id: `urn:oid:test-${index}`, event: 'Flood Warning', headline: 'Test warning',
    description: 'Synthetic evidence', areaDesc: 'Synthetic area', severity: 'Severe',
    urgency: 'Expected', status: 'Actual', messageType: 'Alert',
    sent: '2026-11-02T03:00:00Z', onset: '2026-11-02T04:00:00Z', expires: '2026-11-02T05:00:00Z',
  },
});
const collection = (features = [feature()]) => ({ type: 'FeatureCollection', features });

async function withApi(fetchFn, run) {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  globalThis.fetch = fetchFn;
  Date.now = () => NOW;
  try {
    const { default: handler } = await import(`../api/nws-alerts.js?test=${sequence++}`);
    await run(handler);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
}

test('web NWS provider returns every national row in one normalized complete snapshot', async () => {
  await withApi(async (url, options) => {
    assert.equal(String(url), SOURCE);
    assert.equal(options.maxResponseBytes, 8 * 1024 * 1024);
    return Response.json(collection(Array.from({ length: 201 }, (_, index) => feature(index))));
  }, async (handler) => {
    const response = await handler(request());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schemaVersion, 1);
    assert.equal(body.scope, 'national-active');
    assert.equal(body.completeness, 'complete');
    assert.equal(body.observedAt, NOW);
    assert.equal(body.alerts.length, 201);
    assert.equal(body.alerts[200].id, 'urn:oid:test-200');
    assert.equal(body.alerts[0].sent, '2026-11-02T03:00:00Z');
    assert.equal(body.alerts[0].onset, '2026-11-02T04:00:00Z');
    assert.equal(body.alerts[0].retrievedAt, NOW);
    assert.equal('properties' in body.alerts[0], false);
  });
});

test('web NWS complete empty remains distinguishable from unavailable evidence', async () => {
  await withApi(async () => Response.json(collection([])), async (handler) => {
    const response = await handler(request());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.completeness, 'complete');
    assert.deepEqual(body.alerts, []);
  });
});

for (const [name, invalid] of [
  ['missing features', { type: 'FeatureCollection' }],
  ['continuation', { ...collection([]), pagination: { next: 'https://api.weather.gov/alerts?cursor=next' } }],
  ['partial metadata', { ...collection([]), partial: true }],
  ['bad row', collection([{ ...feature(), properties: { ...feature().properties, id: null } }])],
  ['duplicate identity', collection([feature(), feature()])],
  ['row cap exceeded', collection(Array.from({ length: 2001 }, (_, index) => feature(index)))],
  ...[
    ['expiry before issuance', { expires: '2026-11-02T02:00:00Z' }],
    ['expiry equals issuance', { expires: '2026-11-02T03:00:00Z' }],
    ['issuance after acquisition', { sent: '2026-11-02T03:30:00.001Z' }],
    ['negative issuance epoch', { sent: '1969-12-31T23:59:59Z' }],
    ['oversized identity', { id: 'a'.repeat(1025) }],
  ].map(([name, fields]) => [name, collection([{ ...feature(), properties: { ...feature().properties, ...fields } }])]),
  ['oversized lifecycle identity metadata', collection(Array.from({ length: 700 }, (_, index) => ({ ...feature(index), properties: { ...feature(index).properties, id: `${index}-` + '界'.repeat(1020) } })))],
  ['unknown severity', collection([{ ...feature(), properties: { ...feature().properties, severity: 'Renamed' } }])],
]) {
  test(`web NWS rejects ${name} instead of caching an authoritative all-clear`, async () => {
    let calls = 0;
    await withApi(async () => Response.json(++calls === 1 ? invalid : collection()), async (handler) => {
      const failed = await handler(request());
      assert.equal(failed.status, 503);
      assert.equal((await failed.json()).completeness, undefined);
      const recovered = await handler(request());
      assert.equal(recovered.status, 200);
      assert.equal((await recovered.json()).alerts.length, 1);
      assert.equal(calls, 2);
    });
  });
}

test('web NWS caches the successful acquisition time without restamping a cache hit', async () => {
  let calls = 0;
  await withApi(async () => { calls += 1; return Response.json(collection()); }, async (handler) => {
    const first = await (await handler(request())).json();
    Date.now = () => NOW + 30_000;
    const cached = await (await handler(request())).json();
    assert.equal(first.observedAt, NOW);
    assert.deepEqual(cached, first);
    assert.equal(calls, 1);
  });
});

test('web NWS respects Retry-After without converting rate limiting into success', async () => {
  let calls = 0;
  await withApi(async () => { calls += 1; return new Response('', { status: 429, headers: { 'retry-after': '10' } }); }, async (handler) => {
    assert.equal((await handler(request())).status, 503);
    assert.equal((await handler(request())).status, 503);
    assert.equal(calls, 1);
    Date.now = () => NOW + 10_001;
    assert.equal((await handler(request())).status, 503);
    assert.equal(calls, 2);
  });
});

test('web NWS timeout and oversized bodies fail closed without exposing upstream errors', async () => {
  for (const fetchFn of [
    async () => { throw new Error('PRIVATE upstream timeout'); },
    async () => new Response(JSON.stringify(collection()), { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } }),
  ]) {
    await withApi(fetchFn, async (handler) => {
      const response = await handler(request());
      assert.equal(response.status, 503);
      assert.equal((await response.text()).includes('PRIVATE'), false);
    });
  }
});

test('packaged desktop includes the NWS snapshot helper imported by its sidecar', () => {
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  assert.ok(config.bundle.resources.includes('sidecar/nws-alert-snapshot.mjs'));
});

async function withDesktop(body, run) {
  const { createLocalApiServer, _resetSidecarCacheForTests } = await import('../src-tauri/sidecar/local-api-server.mjs');
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cb-nws-provider-'));
  const originalRequest = https.request;
  const originalToken = process.env.LOCAL_API_TOKEN;
  const token = randomUUID();
  const calls = [];
  process.env.LOCAL_API_TOKEN = token;
  https.request = (options, onResponse) => {
    calls.push(`https://${options.hostname}${options.path}`);
    const req = new PassThrough();
    req.setTimeout = () => req;
    req.end = () => queueMicrotask(() => {
      const bytes = Buffer.from(JSON.stringify(typeof body === 'function' ? body(calls.length) : body));
      const response = Readable.from([bytes]);
      response.statusCode = 200;
      response.statusMessage = 'OK';
      response.headers = { 'content-type': 'application/geo+json', 'content-length': String(bytes.length) };
      onResponse(response);
    });
    return req;
  };
  _resetSidecarCacheForTests();
  let app;
  try {
    app = await createLocalApiServer({
      port: 0, apiDir: path.resolve('api'), dataDir,
      agentMonitorStatePath: path.join(dataDir, 'monitor-state.json'),
      agentMonitorEventsPath: path.join(dataDir, 'monitor-events.json'),
      littleSnitchExportPath: null, littleSnitchBaselinePath: null,
      logger: { log() {}, warn() {}, error() {} },
    });
    const { port } = await app.start();
    const fetchSnapshot = () => fetch(`http://127.0.0.1:${port}/api/nws-alerts`, {
      headers: { Authorization: `Bearer ${token}`, Origin: 'http://127.0.0.1:3000' },
    });
    await run(await fetchSnapshot(), calls, fetchSnapshot);
  } finally {
    if (app) await app.close();
    https.request = originalRequest;
    if (originalToken === undefined) delete process.env.LOCAL_API_TOKEN;
    else process.env.LOCAL_API_TOKEN = originalToken;
    _resetSidecarCacheForTests();
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('desktop HTTP transport matches the complete national web snapshot without truncating 201 rows', async () => {
  const raw = collection(Array.from({ length: 201 }, (_, index) => feature(index)));
  let web;
  await withApi(async () => Response.json(raw), async (handler) => { web = await (await handler(request())).json(); });
  await withDesktop(raw, async (response, calls) => {
    assert.equal(response.status, 200);
    const desktop = await response.json();
    assert.deepEqual(calls, [SOURCE]);
    assert.equal(desktop.alerts.length, 201);
    assert.ok(Number.isSafeInteger(desktop.observedAt));
    assert.ok(desktop.alerts.every((alert) => alert.retrievedAt === desktop.observedAt));
    const withoutTime = (value) => ({ ...value, observedAt: 0, alerts: value.alerts.map((alert) => ({ ...alert, retrievedAt: 0 })) });
    assert.deepEqual(withoutTime(desktop), withoutTime(web));
  });
});

test('desktop HTTP transport rejects partial evidence instead of a successful all-clear', async () => {
  await withDesktop({ ...collection([]), pagination: { next: 'https://api.weather.gov/alerts?cursor=more' } }, async (response) => {
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'NWS national snapshot unavailable', stale: true });
  });
});


test('web NWS cancels streamed over-budget bodies and does not cache them', async () => {
  let calls = 0;
  let cancelled = false;
  await withApi(async () => {
    calls += 1;
    if (calls > 1) return Response.json(collection());
    return new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    }));
  }, async (handler) => {
    assert.equal((await handler(request())).status, 503);
    assert.equal(cancelled, true);
    assert.equal((await handler(request())).status, 200);
    assert.equal(calls, 2);
  });
});

test('web NWS abort deadline fails closed and clears in-flight work for recovery', async () => {
  const timeout = AbortSignal.timeout;
  let calls = 0;
  const timer = setTimeout(() => {}, 1000);
  AbortSignal.timeout = (milliseconds) => {
    assert.equal(milliseconds, 12_000);
    return timeout(1);
  };
  try {
    await withApi(async (_url, options) => {
      calls += 1;
      if (calls > 1) return Response.json(collection());
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    }, async (handler) => {
      assert.equal((await handler(request())).status, 503);
      assert.equal((await handler(request())).status, 200);
      assert.equal(calls, 2);
    });
  } finally {
    AbortSignal.timeout = timeout;
    clearTimeout(timer);
  }
});


test('desktop health and cache preserve the original successful acquisition time', async () => {
  const { getFeedStatus } = await import('../src-tauri/sidecar/feed-health-tracker.mjs');
  const originalNow = Date.now;
  Date.now = () => NOW;
  try {
    await withDesktop(collection(), async (response, calls, fetchSnapshot) => {
      const first = await response.json();
      Date.now = () => NOW + 30_000;
      const cached = await (await fetchSnapshot()).json();
      assert.deepEqual(cached, first);
      assert.equal(calls.length, 1);
      const health = getFeedStatus('nws-alerts');
      assert.equal(health.lastSuccess, first.observedAt);
      assert.equal(health.status, 'up');
      assert.equal(health.lastSource, 'primary');
    });
  } finally { Date.now = originalNow; }
});


test('desktop rejects incoherent chronology before health/cache and recovers on the next response', async () => {
  const { getFeedStatus } = await import('../src-tauri/sidecar/feed-health-tracker.mjs');
  const invalid = collection([{ ...feature(), properties: { ...feature().properties, expires: '2026-11-02T02:00:00Z' } }]);
  await withDesktop((attempt) => attempt === 1 ? invalid : collection(), async (response, calls, fetchSnapshot) => {
    assert.equal(response.status, 503);
    assert.equal(getFeedStatus('nws-alerts').status, 'down');
    const recovered = await fetchSnapshot();
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).alerts.length, 1);
    assert.equal(getFeedStatus('nws-alerts').status, 'up');
    assert.equal(calls.length, 2);
  });
});
