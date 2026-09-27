import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { GDACS_MAP_EVENT_TYPES, GDACS_COVERAGE_NOTE } from '../gdacs-coverage.ts';
import { rehydrateDate } from '../cache-hydration.ts';

const TYPES = ['EQ', 'FL', 'TC', 'WF', 'DR'];
const NOTE = 'Volcano coverage unavailable; verified coverage: EQ, FL, TC, WF, DR.';
const NOW = Date.parse('2026-09-26T12:00:00Z');
const source = readFileSync(new URL('../gdacs.ts', import.meta.url), 'utf8');
const breakerSource = readFileSync(new URL('../../utils/circuit-breaker.ts', import.meta.url), 'utf8');
// Captured 2026-09-26 MAP bodies: all representations and consumed fields retained;
// unused auxiliary coordinates and unconsumed properties omitted to bound fixture size.
const captured = JSON.parse(readFileSync(new URL('./fixtures/gdacs-map-captured.json', import.meta.url), 'utf8'));
function evaluate(source: string, bindings: Record<string, unknown>) {
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(bindings), compiled)(...Object.values(bindings));
}
function centroid(type = 'EQ', id = 1, changes: Record<string, unknown> = {}) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {
    Class: 'Point_Centroid', eventtype: type, eventid: id, name: `${type} disaster`, country: 'Test',
    alertlevel: 'Orange', fromdate: '2026-01-01T00:00:00Z', ...changes,
  } };
}
const body = (...features: unknown[]) => ({ type: 'FeatureCollection', features });
function harness() {
  let now = NOW;
  let respond = async (type: string, _signal: AbortSignal) => new Response(JSON.stringify(body(centroid(type))));
  const requests: { url: string; signal: AbortSignal }[] = [];
  const deadlines: number[] = [];
  let failures = 0;
  const controller = new AbortController();
  const Clock = class extends Date { static now() { return now; } };
  const CircuitBreaker = evaluate(`${breakerSource.replaceAll('export ', '').replaceAll('import.meta.env.DEV', 'false')}\nreturn CircuitBreaker;`, {
    Date: Clock, console: { warn() {}, error() {} },
  });
  const provider = evaluate(`${source.replace(/^import .*?;\n/gms, '').replaceAll('export ', '')}\nreturn { parseGDACSMapResponse, fetchGDACSEventsTracked, getGDACSSuccessfulUpdate, getGDACSStatus };`, {
    Date: Clock, GDACS_MAP_EVENT_TYPES, GDACS_COVERAGE_NOTE,
    AbortSignal: { timeout: (ms: number) => { deadlines.push(ms); return controller.signal; } },
    createCircuitBreaker: (options: unknown) => {
      const breaker = new CircuitBreaker({ ...options as object, persistCache: false });
      const recordFailure = breaker.recordFailure.bind(breaker);
      breaker.recordFailure = (error: string) => { failures += 1; recordFailure(error); };
      return breaker;
    },
    rehydrateDate,
    fetchWithContext: async (_context: string, input: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      requests.push({ url: input, signal });
      return respond(new URL(input).searchParams.get('eventtype') ?? '', signal);
    },
  });
  return { ...provider, requests, deadlines, get failures() { return failures; }, abort: () => controller.abort(), advance: (ms: number) => { now += ms; },
    respond: (fn: typeof respond) => { respond = fn; } };
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('five fixed MAP requests share one ten-second deadline and cache the complete aggregate', async () => {
  assert.deepEqual(GDACS_MAP_EVENT_TYPES, TYPES);
  assert.equal(GDACS_COVERAGE_NOTE, NOTE);
  const h = harness();
  const result = await h.fetchGDACSEventsTracked();
  assert.equal(result.dataState.mode, 'live');
  assert.deepEqual(result.events.map((e: any) => e.eventType), TYPES);
  assert.deepEqual(h.requests.map((r: any) => r.url), TYPES.map(t => `https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=${t}`));
  assert.deepEqual(h.deadlines, [10_000]);
  assert.equal(new Set(h.requests.map((r: any) => r.signal)).size, 1);
  h.advance(1000);
  const cached = await h.fetchGDACSEventsTracked();
  assert.equal(cached.dataState.mode, 'cached');
  assert.equal(cached.dataState.timestamp, NOW);
  assert.equal(h.getGDACSSuccessfulUpdate(cached), null);
  assert.equal(h.requests.length, 5);
  assert.match(h.getGDACSStatus(), /Volcano coverage unavailable; verified coverage: EQ, FL, TC, WF, DR\./);
});

test('captured MAP representations yield 49 centroids and six qualifying warnings without chronology heuristics', async () => {
  const h = harness();
  assert.deepEqual(TYPES.map(t => h.parseGDACSMapResponse(captured[t], t).length), [4, 7, 7, 18, 13]);
  h.respond(async t => new Response(JSON.stringify(captured[t])));
  const result = await h.fetchGDACSEventsTracked();
  assert.equal(result.dataState.mode, 'live');
  assert.equal(result.events.length, 6);
  assert.deepEqual(result.events.map((e: any) => e.eventType), ['TC', 'DR', 'DR', 'DR', 'DR', 'DR']);
  assert.ok(result.events.some((e: any) => e.fromDate.getTime() < NOW - 180 * 86_400_000));
  assert.ok(result.events.every((e: any) => e.retrievedAt === undefined));
});

test('valid empty collections are empty while overlays without their centroid fail', () => {
  const h = harness();
  assert.deepEqual(h.parseGDACSMapResponse(body(), 'EQ'), []);
  const overlay = { ...centroid(), geometry: { type: 'Polygon' }, properties: { Class: 'Poly_Circle', eventid: 1, eventtype: 'EQ' } };
  assert.throws(() => h.parseGDACSMapResponse(body(overlay), 'EQ'), /centroid/i);
  assert.equal(h.parseGDACSMapResponse(body(overlay, centroid()), 'EQ').length, 1);
});

test('representation classes and geometry are allowlisted per requested hazard', () => {
  const h = harness();
  for (const changes of [{ Class: undefined }, { Class: 'Future_Class' }, { Class: 'constructor' }, { eventtype: 'FL' }, { eventid: undefined }]) {
    assert.throws(() => h.parseGDACSMapResponse(body(centroid(), centroid('EQ', 1, changes)), 'EQ'));
  }
  for (const f of [
    { ...centroid(), geometry: { type: 'Polygon', coordinates: [] } },
    { ...centroid('EQ', 1, { Class: 'Poly_Circle' }), geometry: { type: 'Point', coordinates: [0, 0] } },
    centroid('EQ', 1, { Class: 'Point_Affected' }),
    { ...centroid('TC', 1, { Class: 'Line_Line_x' }), geometry: { type: 'LineString' } },
    { ...centroid('TC', 1, { Class: 'Line_Line_0' }), geometry: { type: 'Polygon' } },
  ]) assert.throws(() => h.parseGDACSMapResponse(body(centroid(f.properties.eventtype), f), f.properties.eventtype));
  assert.throws(() => h.parseGDACSMapResponse({ features: [] }, 'EQ'), /collection/i);
  assert.throws(() => h.parseGDACSMapResponse(body(), 'VO'), /event type/i);
});

test('eligible centroids retain strict validation and zero coordinates', () => {
  const h = harness();
  assert.deepEqual(h.parseGDACSMapResponse(body(centroid()), 'EQ')[0].coordinates, [0, 0]);
  for (const changes of [{ alertlevel: 'Purple' }, { fromdate: 'bad' }, { country: null }, { name: null }, { eventid: null }]) {
    assert.throws(() => h.parseGDACSMapResponse(body(centroid(), centroid('EQ', 1, changes)), 'EQ'));
  }
  for (const coordinates of [[181, 0], [0, 91], [null, 0], [0], [0, 0, 0]]) {
    assert.throws(() => h.parseGDACSMapResponse(body({ ...centroid(), geometry: { type: 'Point', coordinates } }), 'EQ'), /coordinates/);
  }
});

test('equivalent centroid duplicates collapse and conflicting same-ID data fail', () => {
  const h = harness();
  assert.equal(h.parseGDACSMapResponse(body(centroid(), centroid()), 'EQ').length, 1);
  assert.throws(() => h.parseGDACSMapResponse(body(centroid(), centroid('EQ', 1, { alertlevel: 'Red' })), 'EQ'), /conflict/i);
  assert.throws(() => h.parseGDACSMapResponse(body(centroid(), centroid('EQ', 1, { fromdate: '2026-02-01' })), 'EQ'), /conflict/i);
});

for (const [name, failure] of [
  ['HTTP failure', async () => new Response(JSON.stringify(body(centroid('DR'))), { status: 503 })],
  ['rate limit', async () => new Response(JSON.stringify(body(centroid('DR'))), { status: 429, headers: { 'Retry-After': '60' } })],
  ['malformed 200', async () => new Response('{"message":"not data"}')],
  ['invalid JSON', async () => new Response('<html>challenge</html>')],
  ['network failure', async () => { throw new TypeError('Load failed'); }],
] as const) {
  test(`one ${name} prevents a fresh aggregate and malformed data is never cached`, async () => {
    const h = harness();
    h.respond(async t => t === 'DR' ? failure() : new Response(JSON.stringify(body(centroid(t)))));
    const result = await h.fetchGDACSEventsTracked();
    assert.equal(result.dataState.mode, 'unavailable');
    assert.deepEqual(result.events, []);
    assert.equal(h.getGDACSSuccessfulUpdate(result), null);
    assert.equal(h.requests.length, 5);
    h.respond(async t => new Response(JSON.stringify(body(centroid(t)))));
    const recovered = await h.fetchGDACSEventsTracked();
    assert.equal(recovered.dataState.mode, 'live');
    assert.equal(recovered.events.length, 5);
    assert.equal(h.requests.length, 10);
  });
}

test('shared timeout rejects a partial aggregate before any freshness is recorded', async () => {
  const h = harness();
  h.respond(async (t, signal) => t === 'DR'
    ? new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'TimeoutError')), { once: true }))
    : new Response(JSON.stringify(body(centroid(t)))));
  const pending = h.fetchGDACSEventsTracked();
  await settle();
  h.abort();
  assert.ok(h.requests.every((request: { signal: AbortSignal }) => request.signal.aborted));
  const result = await pending;
  assert.equal(result.dataState.mode, 'unavailable');
  assert.equal(h.getGDACSSuccessfulUpdate(result), null);
  assert.deepEqual(result.events, []);
  assert.equal(h.requests.length, 5);
});

test('failed stale refresh preserves original cache timestamp and cannot renew observations', async () => {
  const h = harness();
  await h.fetchGDACSEventsTracked();
  h.advance(11 * 60_000);
  h.respond(async t => t === 'DR' ? new Response('{}', { status: 503 }) : new Response(JSON.stringify(body(centroid(t)))));
  const result = await h.fetchGDACSEventsTracked();
  await settle();
  assert.equal(result.dataState.mode, 'cached');
  assert.equal(result.dataState.timestamp, NOW);
  assert.equal(result.events.length, 5);
  assert.equal(h.getGDACSSuccessfulUpdate(result), null);
});

test('severity selection and 100-event limit remain after complete validation', async () => {
  const h = harness();
  h.respond(async t => new Response(JSON.stringify(body(...Array.from({ length: 30 }, (_, i) => centroid(t, i, { alertlevel: i === 0 ? 'Green' : 'Red' }))))));
  const result = await h.fetchGDACSEventsTracked();
  assert.equal(result.events.length, 100);
  assert.ok(result.events.every((e: any) => e.alertLevel === 'Red'));
});

test('five validated empty feeds are live zero-event evidence', async () => {
  const h = harness();
  h.respond(async () => new Response(JSON.stringify(body())));
  const result = await h.fetchGDACSEventsTracked();
  assert.equal(result.dataState.mode, 'live');
  assert.deepEqual(result.events, []);
  assert.deepEqual(h.getGDACSSuccessfulUpdate(result), { itemCount: 0, updatedAt: NOW });
  assert.equal(h.requests.length, 5);
});

test('one malformed eligible row invalidates the aggregate even beside valid rows', async () => {
  const h = harness();
  h.respond(async t => new Response(JSON.stringify(t === 'DR'
    ? body(centroid(t), centroid(t, 2, { alertlevel: 'Unknown' }))
    : body(centroid(t)))));
  const result = await h.fetchGDACSEventsTracked();
  assert.equal(result.dataState.mode, 'unavailable');
  assert.deepEqual(result.events, []);
  assert.equal(h.getGDACSSuccessfulUpdate(result), null);
});

test('each supported feed independently prevents incomplete fresh evidence on HTTP failure', async () => {
  for (const failingType of TYPES) {
    const h = harness();
    h.respond(async t => t === failingType ? new Response(JSON.stringify(body(centroid(t))), { status: 503 })
      : new Response(JSON.stringify(body(centroid(t)))));
    const result = await h.fetchGDACSEventsTracked();
    assert.equal(result.dataState.mode, 'unavailable', failingType);
    assert.deepEqual(result.events, [], failingType);
    assert.equal(h.getGDACSSuccessfulUpdate(result), null, failingType);
    assert.equal(h.requests.length, 5, failingType);
  }
});

test('five validated all-Green feeds preserve the supported-scope zero-warning result', async () => {
  const h = harness();
  h.respond(async t => new Response(JSON.stringify(body(centroid(t, 1, { alertlevel: 'Green' })))));
  const result = await h.fetchGDACSEventsTracked();
  assert.equal(result.dataState.mode, 'live');
  assert.deepEqual(result.events, []);
  assert.equal(h.requests.length, 5);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('overlapping cold callers share five requests and receive independent data and provenance', async () => {
  const h = harness();
  const gate = deferred();
  h.respond(async t => { await gate.promise; return new Response(JSON.stringify(body(centroid(t)))); });
  const first = h.fetchGDACSEventsTracked();
  const second = h.fetchGDACSEventsTracked();
  await settle();
  assert.equal(h.requests.length, 5);
  gate.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.dataState.mode, 'live');
  assert.deepEqual(a, b);
  a.events[0].name = 'Caller edit';
  a.events[0].coordinates[0] = 90;
  a.events[0].fromDate.setUTCFullYear(2000);
  a.dataState.mode = 'unavailable';
  assert.equal(b.events[0].name, 'EQ disaster');
  assert.deepEqual(b.events[0].coordinates, [0, 0]);
  assert.equal(b.events[0].fromDate.getUTCFullYear(), 2026);
  assert.equal(b.dataState.mode, 'live');
  const cached = await h.fetchGDACSEventsTracked();
  assert.equal(cached.dataState.mode, 'cached');
  assert.deepEqual(cached.events, b.events);
  assert.equal(h.requests.length, 5);
});

test('overlapping failed callers record one breaker failure and release for a later successful retry', async () => {
  const h = harness();
  const gate = deferred();
  h.respond(async t => {
    await gate.promise;
    return new Response(JSON.stringify(body(centroid(t))), { status: t === 'DR' ? 503 : 200 });
  });
  const first = h.fetchGDACSEventsTracked();
  const second = h.fetchGDACSEventsTracked();
  gate.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.dataState.mode, 'unavailable');
  assert.equal(b.dataState.mode, 'unavailable');
  assert.equal(h.requests.length, 5);
  assert.equal(h.failures, 1);
  h.respond(async t => new Response(JSON.stringify(body(centroid(t)))));
  const recovered = await h.fetchGDACSEventsTracked();
  assert.equal(recovered.dataState.mode, 'live');
  assert.equal(recovered.events.length, 5);
  assert.equal(h.requests.length, 10);
});

test('failed feed aborts and drains pending sibling fetch and body before releasing the shared batch', async () => {
  const h = harness();
  const failureGate = deferred();
  const aborted = new Set<string>();
  const finishAbort: (() => void)[] = [];
  const pending = (kind: string, signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      aborted.add(kind);
      finishAbort.push(() => reject(new DOMException('Cancelled', 'AbortError')));
    }, { once: true });
  });
  h.respond(async (t, signal) => {
    if (t === 'EQ') return pending('fetch', signal);
    if (t === 'FL') return { ok: true, json: () => pending('body', signal) } as Response;
    if (t === 'DR') { await failureGate.promise; return new Response('{}', { status: 503 }); }
    return new Response(JSON.stringify(body(centroid(t))));
  });
  let resolved = false;
  const first = h.fetchGDACSEventsTracked().then((value: unknown) => { resolved = true; return value; });
  await settle();
  failureGate.resolve();
  await settle();
  assert.deepEqual([...aborted].sort(), ['body', 'fetch']);
  assert.equal(resolved, false, 'failure must wait for sibling cleanup');
  assert.equal(h.failures, 0, 'breaker failure accounting waits for complete batch cleanup');
  const overlappingRetry = h.fetchGDACSEventsTracked();
  await settle();
  assert.equal(h.requests.length, 5, 'no new batch can overlap aborting requests');
  for (const finish of finishAbort) finish();
  const [a, b] = await Promise.all([first, overlappingRetry]);
  assert.equal(a.dataState.mode, 'unavailable');
  assert.equal(b.dataState.mode, 'unavailable');
  assert.equal(h.failures, 1);
  h.respond(async t => new Response(JSON.stringify(body(centroid(t)))));
  assert.equal((await h.fetchGDACSEventsTracked()).dataState.mode, 'live');
  assert.equal(h.requests.length, 10);
});

test('stale cache returns immediately while only one background batch refreshes it', async () => {
  const h = harness();
  await h.fetchGDACSEventsTracked();
  h.advance(11 * 60_000);
  const gate = deferred();
  h.respond(async t => { await gate.promise; return new Response(JSON.stringify(body(centroid(t)))); });
  const first = await h.fetchGDACSEventsTracked();
  const second = await h.fetchGDACSEventsTracked();
  assert.equal(first.dataState.mode, 'cached');
  assert.equal(second.dataState.timestamp, NOW);
  assert.equal(h.requests.length, 10);
  gate.resolve();
  await settle();
  const refreshed = await h.fetchGDACSEventsTracked();
  assert.equal(refreshed.dataState.mode, 'cached');
  assert.equal(refreshed.dataState.timestamp, NOW + 11 * 60_000);
  assert.equal(h.requests.length, 10);
});
