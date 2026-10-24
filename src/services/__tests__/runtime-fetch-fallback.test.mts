import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntimeFetch, createWebApiFetch, isRetiredAppUrl, type RuntimeFetchDeps } from '../runtime.ts';

// R4-BUG-004: the desktop fetch router sends /api/* only to a CONFIRMED
// sidecar port and falls back to the cloud only on a connection failure or a
// 5xx, with coordinates coarsened and personal parameters/bodies never sent.

interface Call { url: string; auth: string | null; cloudKey: string | null; method: string }

const REMOTE = 'https://cloud.example';

function harness(opts: {
  local?: (url: string) => Response | Promise<Response>;
  ports?: Array<number | null>;
  remote?: string;
  cloudKey?: string | null;
  tokens?: string[];
  localBase?: string;
} = {}) {
  const calls: Call[] = [];
  let invalidations = 0;
  const ports = [...(opts.ports ?? [46_200])];
  const tokens = [...(opts.tokens ?? ['tok-1'])];
  const nativeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get('Authorization'), cloudKey: headers.get('X-CrystalBall-Key'), method: init?.method ?? 'GET' });
    if (url.startsWith(REMOTE)) return new Response('cloud', { status: 200 });
    return (opts.local ?? (() => new Response('ok', { status: 200 })))(url);
  }) as typeof fetch;
  const deps: RuntimeFetchDeps = {
    resolvePort: async () => (ports.length > 1 ? ports.shift()! : ports[0] ?? null),
    invalidatePort: () => { invalidations += 1; },
    localBaseUrl: (port) => opts.localBase ?? `http://127.0.0.1:${port}`,
    fetchToken: async () => (tokens.length > 1 ? tokens.shift()! : tokens[0] ?? null),
    remoteBaseUrl: () => opts.remote ?? REMOTE,
    cloudApiKey: async () => (opts.cloudKey === undefined ? 'cloud-key' : opts.cloudKey),
    debug: () => false,
  };
  return { fetch: createRuntimeFetch(nativeFetch, deps), calls, invalidations: () => invalidations };
}

const status = (code: number) => () => new Response('x', { status: code });
const refused = () => { throw new TypeError('fetch failed: ECONNREFUSED'); };

test('a 4xx from the sidecar is returned and never reaches the cloud', async () => {
  for (const code of [400, 403, 404, 429]) {
    const h = harness({ local: status(code) });
    const res = await h.fetch('/api/gdacs?limit=5');
    assert.equal(res.status, code);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0]!.url, 'http://127.0.0.1:46200/api/gdacs?limit=5');
    assert.equal(h.calls[0]!.auth, 'Bearer tok-1');
  }
});

test('a 5xx falls back with coordinates coarsened and without the bearer token', async () => {
  const h = harness({ local: status(503) });
  const res = await h.fetch('/api/weather/local-forecast?lat=41.6123456&lon=-86.7289');
  assert.equal(await res.text(), 'cloud');
  const cloud = h.calls.at(-1)!;
  assert.equal(cloud.url, `${REMOTE}/api/weather/local-forecast?lat=41.61&lon=-86.73`);
  assert.equal(cloud.cloudKey, 'cloud-key');
  assert.equal(cloud.auth, null, 'the local bearer token never goes to the cloud');
});

test('personal parameters and request bodies never reach the cloud, even on 5xx', async () => {
  for (const [target, init] of [
    ['/api/signal-watch?q=my%20term', undefined],
    ['/api/geonames-search?q=Home', undefined],
    ['/api/new-feed?home_label=x', undefined],
    ['/api/claude-agent', { method: 'POST', body: '{"prompt":"my saved places"}' }],
  ] as Array<[string, RequestInit | undefined]>) {
    const h = harness({ local: status(500) });
    const res = await h.fetch(target, init);
    assert.equal(res.status, 500, target);
    assert.equal(h.calls.some((c) => c.url.startsWith(REMOTE)), false, target);
  }
});

test('no remote base or no cloud key means no cloud request', async () => {
  for (const opts of [{ remote: '' }, { cloudKey: null }]) {
    const h = harness({ local: status(502), ...opts });
    const res = await h.fetch('/api/gdacs');
    assert.equal(res.status, 502);
    assert.equal(h.calls.length, 1);
  }
});

test('a connection failure invalidates the port and may fall back', async () => {
  const h = harness({ local: refused });
  const res = await h.fetch('/api/gdacs?limit=5');
  assert.equal(await res.text(), 'cloud');
  assert.ok(h.invalidations() >= 1, 'port re-resolved on the next request');
  assert.equal(h.calls.at(-1)!.url, `${REMOTE}/api/gdacs?limit=5`);
});

test('a caller abort neither invalidates the port nor falls back', async () => {
  for (const target of ['/api/gdacs', '/api/health', '/api/diag', '/api/local-traffic-log']) {
    const controller = new AbortController();
    const error = new DOMException('aborted', 'AbortError');
    const h = harness({ local: () => { controller.abort(); throw error; } });
    await assert.rejects(h.fetch(target, { signal: controller.signal }), (actual) => actual === error);
    assert.equal(h.invalidations(), 0, target);
    assert.equal(h.calls.length, 1, 'caller cancellation stops the startup retries');
    assert.equal(h.calls.some((c) => c.url.startsWith(REMOTE)), false, target);
  }
});

for (const target of ['/api/health', '/api/diag', '/api/local-traffic-log']) {
  test(`a ${target} connection failure invalidates its port without cloud fallback`, async () => {
    const error = new TypeError('fetch failed: ECONNREFUSED');
    const h = harness({ local: () => { throw error; } });
    await assert.rejects(h.fetch(target), (actual) => actual === error);
    assert.equal(h.invalidations(), 1, 'the next request must resolve a fresh confirmed port');
    assert.equal(h.calls.length, 4, 'the existing startup retries are preserved');
    assert.ok(h.calls.every((c) => c.url === `http://127.0.0.1:46200${target}`));
  });
}

test('with no confirmed port nothing is sent to localhost', async () => {
  const h = harness({ ports: [null] });
  const res = await h.fetch('/api/gdacs?limit=5');
  assert.equal(await res.text(), 'cloud');
  assert.equal(h.calls.some((c) => c.url.includes('127.0.0.1')), false, 'no bearer token to an unconfirmed port');

  const local = harness({ ports: [null] });
  await assert.rejects(local.fetch('/api/local-env-update', { method: 'POST', body: '{}' }), /not confirmed/);
  assert.equal(local.calls.length, 0);
});

test('a 401 re-resolves the port and retries once with a fresh token', async () => {
  const h = harness({
    ports: [46_200, 51_000],
    tokens: ['tok-old', 'tok-new'],
    local: (url) => (url.includes(':46200') ? new Response('foreign', { status: 401 }) : new Response('ok', { status: 200 })),
  });
  const res = await h.fetch('/api/gdacs');
  assert.equal(await res.text(), 'ok');
  assert.equal(h.invalidations(), 1);
  assert.deepEqual(h.calls.map((c) => [c.url, c.auth]), [
    ['http://127.0.0.1:46200/api/gdacs', 'Bearer tok-old'],
    ['http://127.0.0.1:51000/api/gdacs', 'Bearer tok-new'],
  ]);
});

test('local health and local-* targets never fall back', async () => {
  for (const target of ['/api/health', '/api/diag', '/api/local-traffic-log']) {
    const h = harness({ local: status(503) });
    const res = await h.fetch(target);
    assert.equal(res.status, 503, target);
    assert.equal(h.calls.length, 1, target);
    assert.equal(h.invalidations(), 0, 'an HTTP response is not a connection failure');
  }
});

test('a caller-supplied Authorization header is never forwarded to the cloud', async () => {
  const h = harness({ local: status(500) });
  await h.fetch('/api/gdacs', { headers: { Authorization: 'Bearer caller-secret' } });
  const cloud = h.calls.at(-1)!;
  assert.ok(cloud.url.startsWith(REMOTE));
  assert.equal(cloud.auth, null);
});

const RETIRED_URLS = [
  'https://crystalball.app/api/health',
  'https://api.crystalball.app/api/news/v1/list',
  'https://nested.tech.crystalball.app/ordinary-path',
  'http://CRYSTALBALL.APP./api/health',
  'https://api.CRYSTALBALL.APP.:443/api/health',
  '//happy.crystalball.app/api/health',
  'wss://relay.crystalball.app/feed',
];

test('retired hosts are recognized by parsed hostname without rejecting lookalikes', () => {
  for (const url of RETIRED_URLS) assert.equal(isRetiredAppUrl(url), true, url);
  for (const url of ['https://crystalball.app.evil.example/api/x', '/api/health', 'http://localhost:3000']) {
    assert.equal(isRetiredAppUrl(url), false, url);
  }
});

test('desktop rejects retired URL input forms before any native fetch', async () => {
  const inputs: Array<RequestInfo | URL> = [
    ...RETIRED_URLS,
    new URL('https://TECH.CRYSTALBALL.APP./api/health'),
    new Request('https://finance.crystalball.app/api/health'),
  ];
  for (const input of inputs) {
    const h = harness();
    await assert.rejects(h.fetch(input), /Retired app domain/);
    assert.deepEqual(h.calls, [], String(input));
  }
});

test('retired configured cloud bases never receive a fallback request or key', async () => {
  for (const remote of ['https://crystalball.app', 'https://API.CRYSTALBALL.APP.', '//tech.crystalball.app']) {
    const h = harness({ local: status(503), remote });
    assert.equal((await h.fetch('/api/gdacs?limit=5')).status, 503);
    assert.equal(h.calls.length, 1);
    assert.ok(h.calls.every((call) => !isRetiredAppUrl(call.url)));
    assert.equal(h.calls[0]?.cloudKey, null);
  }
});

test('a retired local-base override never receives the sidecar bearer', async () => {
  const h = harness({ localBase: 'https://crystalball.app', remote: '' });
  await assert.rejects(h.fetch('/api/health'), /Retired app domain/);
  assert.deepEqual(h.calls, []);
});

test('web rejects retired URLs even when no redirect is configured', async () => {
  for (const remote of ['', 'https://api.crystalball.app']) {
    const calls: string[] = [];
    const webFetch = createWebApiFetch((async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response('local');
    }) as typeof fetch, remote, 'http://localhost:3000');
    for (const input of [
      ...RETIRED_URLS,
      new URL('https://tech.crystalball.app/api/health'),
      new Request('https://CRYSTALBALL.APP./api/health'),
    ]) await assert.rejects(webFetch(input), /Retired app domain/);
    assert.deepEqual(calls, []);
    await webFetch('/api/news/v1/list');
    assert.deepEqual(calls, ['/api/news/v1/list']);
  }
});

test('relative web requests cannot target a page served from the retired domain', async () => {
  let calls = 0;
  const webFetch = createWebApiFetch((async () => {
    calls++;
    return new Response('unexpected');
  }) as typeof fetch, '', 'https://crystalball.app');
  await assert.rejects(webFetch('/api/health'), /Retired app domain/);
  assert.equal(calls, 0);
});
