import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';

process.env.LOCAL_API_TOKEN ??= 'test-token-openaq-v3';
const sidecar = await import('../local-api-server.mjs');

const NOW = Date.UTC(2026, 7, 25, 12, 0, 0);
const OPENAQ_NEARBY_PATH = '/api/local-airquality/openaq';
const OPENAQ_WORST_PATH = '/api/local-airquality/openaq/worst';

function latestRow(overrides = {}) {
  return {
    datetime: {
      utc: '2026-08-25T11:30:00Z',
      local: '2026-08-25T06:30:00-05:00',
    },
    value: 35.4,
    coordinates: { latitude: 41.8781, longitude: -87.6298 },
    sensorsId: 4_272_103,
    locationsId: 12_345,
    ...overrides,
  };
}

function page(pageNumber, found, results, overrides = {}) {
  return {
    meta: {
      name: 'openaq-api',
      website: '/',
      page: pageNumber,
      limit: 1000,
      found,
      ...overrides,
    },
    results,
  };
}

function normalizePages(pages) {
  assert.equal(typeof sidecar.normalizeOpenaqLatestPages, 'function');
  return sidecar.normalizeOpenaqLatestPages(pages, NOW);
}

async function neverResolvingFetch(_url, options) {
  return new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
}

async function failedLaterPageFetch(url) {
  const pageNumber = Number(new URL(String(url)).searchParams.get('page'));
  if (pageNumber === 1) {
    return Response.json(page(1, 1001, Array.from({ length: 1000 }, (_, index) => latestRow({
      sensorsId: index + 1,
      locationsId: index + 1,
    }))));
  }
  return Response.json({}, { status: 503 });
}

test('normalizer accepts the official /v3/parameters/2/latest response shape', () => {
  const out = normalizePages([page(1, 1, [latestRow()])]);
  assert.equal(out.error, null);
  assert.equal(out.acceptedRows, 1);
  assert.equal(out.droppedRows, 0);
  assert.deepEqual(out.readings[0], {
    id: 'openaq:4272103',
    sensorId: 4_272_103,
    locationId: 12_345,
    station: 'OpenAQ location 12345',
    city: null,
    country: null,
    lat: 41.8781,
    lon: -87.6298,
    parameter: 'pm25',
    value: 35.4,
    unit: 'µg/m³',
    observedAt: Date.UTC(2026, 7, 25, 11, 30, 0),
  });
});

test('normalizer accepts zero coordinates and deduplicates sensor IDs deterministically', () => {
  const duplicate = latestRow({
    coordinates: { latitude: 0, longitude: 0 },
    datetime: { utc: '2026-08-25T11:00:00Z', local: '2026-08-25T11:00:00Z' },
  });
  const out = normalizePages([page(1, 2, [latestRow({ coordinates: { latitude: 0, longitude: 0 } }), duplicate])]);
  assert.equal(out.acceptedRows, 1);
  assert.equal(out.droppedRows, 1);
  assert.equal(out.readings[0].lat, 0);
  assert.equal(out.readings[0].lon, 0);
  assert.equal(out.readings[0].observedAt, Date.UTC(2026, 7, 25, 11, 30, 0));
});

test('normalizer allowlists safe IDs, nonnegative readings, coordinates, and nonfuture timestamps', () => {
  const out = normalizePages([page(1, 7, [
    latestRow({ sensorsId: '4272103' }),
    latestRow({ locationsId: 0 }),
    latestRow({ value: -0.1 }),
    latestRow({ value: Number.POSITIVE_INFINITY }),
    latestRow({ coordinates: { latitude: 91, longitude: 0 } }),
    latestRow({ datetime: { utc: 'not-a-date', local: 'not-a-date' } }),
    latestRow({ datetime: { utc: '2026-08-25T12:00:00.001Z', local: '2026-08-25T12:00:00.001Z' } }),
  ])]);
  assert.equal(out.error, 'no_usable_readings');
  assert.equal(out.acceptedRows, 0);
  assert.equal(out.droppedRows, 7);
});

test('normalizer accepts only canonical UTC RFC3339 seconds or exactly milliseconds', () => {
  const accepted = [
    '2026-08-25T11:30:00Z',
    '2026-08-25T11:30:00.123Z',
  ];
  for (const [index, utc] of accepted.entries()) {
    const out = normalizePages([page(1, 1, [latestRow({ sensorsId: index + 1, datetime: { utc, local: utc } })])]);
    assert.equal(out.error, null, utc);
    assert.equal(out.acceptedRows, 1, utc);
    assert.equal(out.readings[0].observedAt, Date.parse(utc), utc);
  }
});

test('normalizer rejects noncanonical or impossible upstream timestamps', () => {
  const rejected = [
    '2026-08-25T11:30:00+00:00',
    '2026-08-25T06:30:00-05:00',
    '2026-08-25T11:30:00z',
    ' 2026-08-25T11:30:00Z',
    '2026-08-25T11:30:00Z ',
    '2026-08-25T11:30Z',
    '2026-08-25T11:30:00.1Z',
    '2026-08-25T11:30:00.12Z',
    '2026-08-25T11:30:00.1234Z',
    '2026-02-30T11:30:00Z',
  ];
  for (const [index, utc] of rejected.entries()) {
    const out = normalizePages([page(1, 1, [latestRow({ sensorsId: index + 1, datetime: { utc, local: utc } })])]);
    assert.equal(out.error, 'no_usable_readings', utc);
    assert.equal(out.acceptedRows, 0, utc);
    assert.equal(out.sample.rejectionReasons.invalidTimestamp, 1, utc);
  }
});

test('normalizer rejects malformed metadata and missing planned pages', () => {
  for (const pages of [
    [{ meta: { page: 1, limit: 1000, found: 1 }, results: null }],
    [page(1, 1001, Array.from({ length: 1000 }, (_, index) => latestRow({ sensorsId: index + 1 })))],
    [page(1, 25_001, [])],
  ]) {
    const out = normalizePages(pages);
    assert.equal(out.error, 'incomplete_or_malformed');
    assert.equal(out.acceptedRows, 0);
  }
});

test('normalizer distinguishes a complete reported-empty corpus from all rows dropped', () => {
  const empty = normalizePages([page(1, 0, [])]);
  assert.equal(empty.error, null);
  assert.equal(empty.coverage, 'best_effort_sample');
  assert.equal(empty.acceptedRows, 0);

  const dropped = normalizePages([page(1, 1, [latestRow({ value: -1 })])]);
  assert.equal(dropped.error, 'no_usable_readings');
  assert.equal(dropped.acceptedRows, 0);
});

test('sample normalizer retains newest duplicates and discloses best-effort coverage', () => {
  const older = latestRow({ sensorsId: 7, datetime: { utc: '2026-08-25T10:00:00Z', local: '2026-08-25T10:00:00Z' }, value: 10 });
  const newer = latestRow({ sensorsId: 7, datetime: { utc: '2026-08-25T11:00:00Z', local: '2026-08-25T11:00:00Z' }, value: 20 });
  const out = normalizePages([page(1, 2, [older, newer])]);
  assert.equal(out.coverage, 'best_effort_sample');
  assert.equal(out.complete, false);
  assert.equal(out.readings.length, 1);
  assert.equal(out.readings[0].value, 20);
  assert.equal(out.sample.rawRows, 2);
  assert.equal(out.sample.uniqueSensorRows, 1);
  assert.equal(out.sample.acceptedRows, 1);
  assert.equal(out.sample.duplicateRows, 1);
  assert.equal(out.sample.invalidRows, 0);
});

test('equal-timestamp conflicting rows invalidate the sensor and keep arithmetic consistent', () => {
  const timestamp = { utc: '2026-08-25T11:00:00Z', local: '2026-08-25T11:00:00Z' };
  const out = normalizePages([page(1, 3, [
    latestRow({ sensorsId: 7, datetime: timestamp, value: 10 }),
    latestRow({ sensorsId: 7, datetime: timestamp, value: 20 }),
    latestRow({ sensorsId: 8, value: -1 }),
  ])]);
  assert.equal(out.error, 'no_usable_readings');
  assert.equal(out.sample.acceptedRows, 0);
  assert.equal(out.sample.duplicateRows, 0);
  assert.equal(out.sample.invalidRows, 3);
  assert.equal(out.sample.rawRows, out.sample.acceptedRows + out.sample.duplicateRows + out.sample.invalidRows);
  assert.equal(out.sample.rejectionReasons.equalTimestampConflict, 2);
  assert.equal(out.sample.rejectionReasons.invalidValue, 1);
});

test('sample normalizer enforces timestamps inside the declared window', () => {
  const out = sidecar.normalizeOpenaqLatestPages([
    page(1, 3, [
      latestRow({ sensorsId: 1, datetime: { utc: '2026-08-25T09:59:59.999Z', local: '2026-08-25T09:59:59.999Z' } }),
      latestRow({ sensorsId: 2, datetime: { utc: '2026-08-25T10:00:00Z', local: '2026-08-25T10:00:00Z' } }),
      latestRow({ sensorsId: 3, datetime: { utc: '2026-08-25T12:00:00.001Z', local: '2026-08-25T12:00:00.001Z' } }),
    ]),
  ], NOW, NOW - 2 * 60 * 60 * 1000);
  assert.equal(out.sample.acceptedRows, 1);
  assert.equal(out.sample.invalidRows, 2);
  assert.equal(out.sample.rejectionReasons.outsideWindow, 2);
});

test('metadata drift is disclosed as sampled when every planned page succeeds', () => {
  const rows = Array.from({ length: 1000 }, (_, index) => latestRow({ sensorsId: index + 1, locationsId: index + 1 }));
  const out = normalizePages([page(1, 1001, rows), page(2, 1002, [latestRow({ sensorsId: 1001, locationsId: 1001 })])]);
  assert.equal(out.error, null);
  assert.equal(out.complete, false);
  assert.equal(out.sample.reportedFoundAtStart, 1001);
  assert.equal(out.sample.plannedPages, 2);
  assert.equal(out.sample.fetchedPages, 2);
});

test('corpus fetch completes pagination with at most three page requests in flight', async () => {
  assert.equal(typeof sidecar.fetchOpenaqLatestCorpus, 'function');
  let active = 0;
  let peak = 0;
  const pages = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(String(url));
    const pageNumber = Number(parsed.searchParams.get('page'));
    assert.equal(parsed.searchParams.get('datetime_min'), new Date(NOW - 2 * 60 * 60 * 1000).toISOString());
    pages.push(pageNumber);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    const count = pageNumber < 5 ? 1000 : 1;
    const start = (pageNumber - 1) * 1000;
    return Response.json(page(pageNumber, 4001, Array.from({ length: count }, (_, index) => latestRow({
      sensorsId: start + index + 1,
      locationsId: start + index + 1,
    }))));
  };
  const out = await sidecar.fetchOpenaqLatestCorpus?.('test-key', { fetchImpl, now: NOW });
  assert.equal(out?.ok, true);
  assert.equal(out?.corpus.acceptedRows, 4001);
  assert.deepEqual(pages.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.ok(peak <= 3);
});

test('corpus fetch retries one rate-limited page and succeeds', async () => {
  assert.equal(typeof sidecar.fetchOpenaqLatestCorpus, 'function');
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return Response.json({ detail: 'rate limited' }, { status: 429, headers: { 'retry-after': '0' } });
    return Response.json(page(1, 1, [latestRow()]));
  };
  const out = await sidecar.fetchOpenaqLatestCorpus?.('test-key', { fetchImpl, now: NOW });
  assert.equal(out?.ok, true);
  assert.equal(calls, 2);
});

test('corpus fetch reports timeout without returning partial rows', async () => {
  assert.equal(typeof sidecar.fetchOpenaqLatestCorpus, 'function');
  const out = await sidecar.fetchOpenaqLatestCorpus?.('test-key', { fetchImpl: neverResolvingFetch, now: NOW, deadlineMs: 5 });
  assert.equal(out?.ok, false);
  assert.equal(out?.error, 'timeout');
  assert.equal(out?.corpus, undefined);
});

test('corpus fetch distinguishes auth, rate-limit, oversized, and malformed failures', async () => {
  assert.equal(typeof sidecar.fetchOpenaqLatestCorpus, 'function');
  const cases = [
    [async () => Response.json({}, { status: 401 }), 'auth_401'],
    [async () => Response.json({}, { status: 403 }), 'auth_403'],
    [async () => Response.json({}, { status: 429 }), 'rate_limited'],
    [async () => { throw new Error('Upstream response exceeded byte limit'); }, 'oversized'],
    [async () => new Response(new ReadableStream({
      start(controller) {
        const chunk = new Uint8Array(1024 * 1024);
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    }), { headers: { 'content-type': 'application/json' } }), 'oversized'],
    [async () => new Response('<html>challenge</html>', { headers: { 'content-type': 'text/html' } }), 'malformed'],
  ];
  for (const [fetchImpl, error] of cases) {
    const out = await sidecar.fetchOpenaqLatestCorpus?.('test-key', { fetchImpl, now: NOW, retryDelayMs: 0 });
    assert.equal(out?.ok, false);
    assert.equal(out?.error, error);
  }
});

test('corpus fetch disables redirects before sending the API key', async () => {
  let calls = 0;
  const out = await sidecar.fetchOpenaqLatestCorpus?.('redirect-secret', {
    now: NOW,
    retryDelayMs: 0,
    fetchImpl: async (_url, options) => {
      calls += 1;
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['X-API-Key'], 'redirect-secret');
      return new Response(null, { status: 302, headers: { location: 'https://example.invalid/leak' } });
    },
  });
  assert.equal(out?.ok, false);
  assert.equal(out?.error, 'upstream');
  assert.equal(calls, 1);
});

test('corpus fetch cancels every rejected response body', async (t) => {
  const cases = [
    ['authentication', 401, { 'content-type': 'application/json' }],
    ['authorization', 403, { 'content-type': 'application/json' }],
    ['rate limit', 429, { 'content-type': 'application/json', 'retry-after': '0' }],
    ['non-ok', 500, { 'content-type': 'application/json' }],
    ['wrong content type', 200, { 'content-type': 'text/html' }],
    ['oversized content length', 200, { 'content-type': 'application/json', 'content-length': String(3 * 1024 * 1024) }],
  ];
  for (const [name, status, headers] of cases) {
    await t.test(name, async () => {
      let calls = 0;
      let cancelled = 0;
      const out = await sidecar.fetchOpenaqLatestCorpus?.('test-key', {
        now: NOW,
        retryDelayMs: 0,
        fetchImpl: async () => {
          calls += 1;
          return new Response(new ReadableStream({ cancel() { cancelled += 1; } }), { status, headers });
        },
      });
      assert.equal(out?.ok, false);
      assert.equal(cancelled, calls);
    });
  }
});

test('corpus fetch rejects a failed later page without returning page-one rows', async () => {
  assert.equal(typeof sidecar.fetchOpenaqLatestCorpus, 'function');
  const out = await sidecar.fetchOpenaqLatestCorpus?.('test-key', { fetchImpl: failedLaterPageFetch, now: NOW, retryDelayMs: 0 });
  assert.equal(out?.ok, false);
  assert.equal(out?.error, 'upstream');
  assert.equal(out?.corpus, undefined);
});

test('corpus fetch enforces the aggregate byte cap across individually bounded pages', async () => {
  const padded = 'x'.repeat(950);
  const fetchImpl = async (url) => {
    const pageNumber = Number(new URL(String(url)).searchParams.get('page'));
    const count = pageNumber < 9 ? 1000 : 1;
    const start = (pageNumber - 1) * 1000;
    return Response.json(page(pageNumber, 8001, Array.from({ length: count }, (_, index) => latestRow({
      sensorsId: start + index + 1,
      locationsId: start + index + 1,
      padding: padded,
    }))));
  };
  const out = await sidecar.fetchOpenaqLatestCorpus('test-key', { fetchImpl, now: NOW });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'oversized');
  assert.equal(out.corpus, undefined);
});

test('terminal page failure aborts sibling requests and awaits their settlement', async () => {
  let failedPageCalls = 0;
  let siblingAborted = false;
  let siblingSettled = false;
  const fetchImpl = async (url, options) => {
    const pageNumber = Number(new URL(String(url)).searchParams.get('page'));
    if (pageNumber === 1) {
      return Response.json(page(1, 2001, Array.from({ length: 1000 }, (_, index) => latestRow({
        sensorsId: index + 1,
        locationsId: index + 1,
      }))));
    }
    if (pageNumber === 2) {
      failedPageCalls += 1;
      return Response.json({}, { status: 503 });
    }
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        siblingAborted = true;
        siblingSettled = true;
        reject(options.signal.reason);
      }, { once: true });
    });
  };
  const out = await sidecar.fetchOpenaqLatestCorpus('test-key', { fetchImpl, now: NOW, retryDelayMs: 0 });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'upstream');
  assert.equal(failedPageCalls, 2);
  assert.equal(siblingAborted, true);
  assert.equal(siblingSettled, true);
});

async function startSidecar() {
  const app = await sidecar.createLocalApiServer({
    port: 0,
    apiDir: undefined,
    remoteBase: 'http://127.0.0.1:1',
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();
  return { base: `http://127.0.0.1:${port}`, close: () => app.close() };
}

function httpJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = httpRequest({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${process.env.LOCAL_API_TOKEN}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, body: JSON.parse(raw) });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('legacy OpenAQ paths no longer serve the provider or call upstream', async () => {
  const originalFetch = globalThis.fetch;
  const saved = process.env.OPENAQ_API_KEY;
  process.env.OPENAQ_API_KEY = 'test-key';
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return Response.json(page(1, 1, [latestRow()]));
  };
  const app = await startSidecar();
  try {
    for (const path of ['/api/airquality/openaq/worst', '/api/airquality/openaq?lat=0&lon=0&radius=25000']) {
      const response = await httpJson(`${app.base}${path}`);
      assert.equal(response.status, 200, path);
      assert.equal(response.body.degraded, true, path);
      assert.equal(response.body.provider, undefined, path);
      assert.equal(response.body.schemaVersion, undefined, path);
    }
    assert.equal(upstreamCalls, 0);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
    if (saved === undefined) delete process.env.OPENAQ_API_KEY;
    else process.env.OPENAQ_API_KEY = saved;
  }
});

test('OpenAQ routes fail explicitly when the API key is missing', async () => {
  const saved = process.env.OPENAQ_API_KEY;
  delete process.env.OPENAQ_API_KEY;
  const app = await startSidecar();
  try {
    for (const path of [OPENAQ_WORST_PATH, `${OPENAQ_NEARBY_PATH}?lat=0&lon=0&radius=25000`]) {
      const response = await httpJson(`${app.base}${path}`);
      assert.equal(response.status, 400);
      assert.equal(response.body.error, 'OPENAQ_API_KEY not configured');
    }
  } finally {
    await app.close();
    if (saved !== undefined) process.env.OPENAQ_API_KEY = saved;
  }
});

test('nearby route validates coordinates and radius before fetching upstream', async () => {
  const saved = process.env.OPENAQ_API_KEY;
  process.env.OPENAQ_API_KEY = 'test-key';
  const app = await startSidecar();
  try {
    for (const query of ['lat=&lon=0', 'lat=91&lon=0', 'lat=0&lon=181', 'lat=0&lon=0&radius=25001']) {
      const response = await httpJson(`${app.base}${OPENAQ_NEARBY_PATH}?${query}`);
      assert.equal(response.status, 400, query);
      assert.equal(response.body.error, 'invalid OpenAQ nearby query');
    }
  } finally {
    await app.close();
    if (saved === undefined) delete process.env.OPENAQ_API_KEY;
    else process.env.OPENAQ_API_KEY = saved;
  }
});

test('OpenAQ routes preserve sanitized upstream 401 and 403 semantics', async () => {
  const originalFetch = globalThis.fetch;
  const saved = process.env.OPENAQ_API_KEY;
  process.env.OPENAQ_API_KEY = 'test-key';
  const app = await startSidecar();
  try {
    for (const status of [401, 403]) {
      sidecar._setSidecarCachedForTests('openaq-v3-pm25-corpus', null, 1);
      globalThis.fetch = async () => Response.json({ detail: `secret upstream detail ${status}` }, { status });
      const response = await httpJson(`${app.base}${OPENAQ_WORST_PATH}`);
      assert.equal(response.status, status);
      assert.deepEqual(response.body, { error: `OpenAQ authentication ${status === 401 ? 'required' : 'forbidden'}` });
      assert.doesNotMatch(JSON.stringify(response.body), /secret upstream detail/);
    }
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
    if (saved === undefined) delete process.env.OPENAQ_API_KEY;
    else process.env.OPENAQ_API_KEY = saved;
  }
});

test('worst and nearby routes share one complete normalized corpus', async () => {
  const originalFetch = globalThis.fetch;
  const saved = process.env.OPENAQ_API_KEY;
  process.env.OPENAQ_API_KEY = 'test-key';
  let upstreamCalls = 0;
  const recent = new Date(Date.now() - 60_000).toISOString();
  globalThis.fetch = async (url, options) => {
    upstreamCalls += 1;
    assert.match(String(url), /^https:\/\/api\.openaq\.org\/v3\/parameters\/2\/latest\?/);
    assert.equal(new URL(String(url)).searchParams.get('limit'), '1000');
    assert.equal(options.headers['X-API-Key'], 'test-key');
    assert.equal(options.maxResponseBytes, 2 * 1024 * 1024);
    return Response.json(page(1, 2, [
      latestRow({ sensorsId: 1, locationsId: 10, value: 55, coordinates: { latitude: 0, longitude: 0 }, datetime: { utc: recent, local: recent } }),
      latestRow({ sensorsId: 2, locationsId: 20, value: 10, coordinates: { latitude: 45, longitude: 45 }, datetime: { utc: recent, local: recent } }),
    ]));
  };
  sidecar._setSidecarCachedForTests('openaq-v3-pm25-corpus', null, 1);
  const app = await startSidecar();
  try {
    const worst = await httpJson(`${app.base}${OPENAQ_WORST_PATH}`);
    assert.equal(worst.status, 200);
    assert.equal(worst.body.readings.length, 2);
    assert.equal(worst.body.readings[0].locationId, 10);

    const nearby = await httpJson(`${app.base}${OPENAQ_NEARBY_PATH}?lat=0&lon=0&radius=25000`);
    assert.equal(nearby.status, 200);
    assert.equal(nearby.body.readings.length, 1);
    assert.equal(nearby.body.readings[0].lat, 0);
    assert.equal(nearby.body.readings[0].lon, 0);
    assert.equal(upstreamCalls, 1);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
    if (saved === undefined) delete process.env.OPENAQ_API_KEY;
    else process.env.OPENAQ_API_KEY = saved;
  }
});

test('route reports metadata drift as sampled and caches the positive normalized sample', async () => {
  const originalFetch = globalThis.fetch;
  const saved = process.env.OPENAQ_API_KEY;
  process.env.OPENAQ_API_KEY = 'test-key';
  let upstreamCalls = 0;
  const recent = new Date(Date.now() - 60_000).toISOString();
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return Response.json(page(1, 2, [latestRow({ datetime: { utc: recent, local: recent } })]));
  };
  sidecar._setSidecarCachedForTests('openaq-v3-pm25-corpus', null, 1);
  const app = await startSidecar();
  try {
    const first = await httpJson(`${app.base}${OPENAQ_WORST_PATH}`);
    const second = await httpJson(`${app.base}${OPENAQ_WORST_PATH}`);
    assert.equal(first.status, 200);
    assert.equal(first.body.complete, false);
    assert.equal(first.body.coverage, 'best_effort_sample');
    assert.equal(second.status, 200);
    assert.equal(upstreamCalls, 1);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
    if (saved === undefined) delete process.env.OPENAQ_API_KEY;
    else process.env.OPENAQ_API_KEY = saved;
  }
});

test('credential rotation aborts the old generation and deletion clears its cache', async () => {
  const originalFetch = globalThis.fetch;
  const saved = process.env.OPENAQ_API_KEY;
  process.env.OPENAQ_API_KEY = 'generation-a';
  const seenKeys = [];
  const recent = new Date(Date.now() - 60_000).toISOString();
  globalThis.fetch = async (_url, options) => {
    seenKeys.push(options.headers['X-API-Key']);
    if (options.headers['X-API-Key'] === 'generation-a') {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    }
    return Response.json(page(1, 1, [latestRow({ datetime: { utc: recent, local: recent } })]));
  };
  sidecar._setSidecarCachedForTests('openaq-v3-pm25-corpus', null, 1);
  const app = await startSidecar();
  try {
    const oldRequest = httpJson(`${app.base}${OPENAQ_WORST_PATH}`);
    while (seenKeys.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    const rotated = await httpJson(`${app.base}/api/local-env-update`, {
      method: 'POST', body: { key: 'OPENAQ_API_KEY', value: 'generation-b' },
    });
    assert.equal(rotated.status, 200);
    const oldResponse = await oldRequest;
    assert.equal(oldResponse.status, 409);

    const fresh = await httpJson(`${app.base}${OPENAQ_WORST_PATH}`);
    assert.equal(fresh.status, 200);
    assert.deepEqual(seenKeys, ['generation-a', 'generation-b']);
    const cached = await httpJson(`${app.base}${OPENAQ_WORST_PATH}`);
    assert.equal(cached.status, 200);
    assert.deepEqual(seenKeys, ['generation-a', 'generation-b']);
    assert.equal(cached.body.fetchedAt, fresh.body.fetchedAt);

    const deleted = await httpJson(`${app.base}/api/local-env-update`, {
      method: 'POST', body: { key: 'OPENAQ_API_KEY', value: '' },
    });
    assert.equal(deleted.status, 200);
    const missing = await httpJson(`${app.base}${OPENAQ_WORST_PATH}`);
    assert.equal(missing.status, 400);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
    if (saved === undefined) delete process.env.OPENAQ_API_KEY;
    else process.env.OPENAQ_API_KEY = saved;
  }
});

test('worst route rejects a complete corpus when every reading is stale', async () => {
  const originalFetch = globalThis.fetch;
  const saved = process.env.OPENAQ_API_KEY;
  process.env.OPENAQ_API_KEY = 'test-key';
  const stale = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
  globalThis.fetch = async () => Response.json(page(1, 1, [latestRow({ datetime: { utc: stale, local: stale } })]));
  sidecar._setSidecarCachedForTests('openaq-v3-pm25-corpus', null, 1);
  const app = await startSidecar();
  try {
    const response = await httpJson(`${app.base}${OPENAQ_WORST_PATH}`);
    assert.equal(response.status, 502);
    assert.equal(response.body.error, 'OpenAQ returned no usable readings');
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
    if (saved === undefined) delete process.env.OPENAQ_API_KEY;
    else process.env.OPENAQ_API_KEY = saved;
  }
});
