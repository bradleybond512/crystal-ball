import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoundedJson } from '../../../api/_bounded-json.js';
import { createUkpnSnapshotProvider, normalizeUkpnSnapshot, UKPN_METADATA_URL, UKPN_RECORDS_URL } from '../ukpn-live-faults.mjs';

const NOW = Date.parse('2026-11-20T04:30:00.000Z');
const metadata = (count = 1, at = NOW - 1000) => ({ metas: { default: { data_processed: new Date(at).toISOString(), records_count: count } } });
const row = (id = 'INCD-1', overrides = {}) => ({ incidentreference: id, powercuttype: 'Unplanned', nocustomeraffected: 0, restoreddatetime: null, ...overrides });
const records = (rows = [row()]) => ({ total_count: rows.length, results: rows });
const normalize = (rows, now = NOW) => normalizeUkpnSnapshot(metadata(rows.length), records(rows), metadata(rows.length), now);
function harness({ bodies = [metadata(), records(), metadata()], clock = () => NOW, fetchFn } = {}) {
  const calls = [];
  const provider = createUkpnSnapshotProvider({ clock, readJson: readBoundedJson, fetchFn: async (...args) => {
    calls.push(args);
    return fetchFn ? fetchFn(...args) : Response.json(bodies[(calls.length - 1) % bodies.length]);
  } });
  return { provider, calls };
}
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };

test('UKPN accepts zero customers without coordinates, emits only normalized fields and sorts IDs', () => {
  const result = normalize([row('B', { operatingzone: ' LONDON ', message: '<script>bad</script>' }), row('A', { nocustomeraffected: 8 })]);
  assert.equal(result.state, 'reported');
  assert.equal(result.provider, 'ukpn');
  assert.equal(result.scope, 'ukpn-regional');
  assert.equal(result.coverage, 'partial');
  assert.equal(result.apiConsistency, 'verified');
  assert.deepEqual(result.incidents, [{ id: 'A', customersAffected: 8 }, { id: 'B', customersAffected: 0, operatingZone: 'LONDON' }]);
  assert.deepEqual(result.counts, { raw: 2, accepted: 2, excluded: 0, invalid: 0 });
  assert.equal(result.expiresAt, new Date(NOW - 1000 + 900_000).toISOString());
});

test('UKPN status allowlist excludes every non-Unplanned type with explicit counters', () => {
  const result = normalize(['Restored', 'Planned', 'Multiple', 'unknown', undefined, 'unplanned'].map((powercuttype, i) => row(String(i), { powercuttype })));
  assert.equal(result.state, 'empty');
  assert.deepEqual(result.incidents, []);
  assert.deepEqual(result.counts, { raw: 6, accepted: 0, excluded: 6, invalid: 0 });
  assert.deepEqual(result.exclusions, { restored: 1, planned: 1, multiple: 1, unknown: 3 });
});

test('UKPN counts malformed rows and contradictory restoration dates without accepting them', () => {
  const bad = [null, row(''), row('x'.repeat(81)), row('bad\nID'), ...[-1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1].map((nocustomeraffected, i) => row(`count${i}`, { nocustomeraffected })), row('restored', { restoreddatetime: '2026-11-20T01:00:00' }), row('zone', { operatingzone: 'x'.repeat(81) })];
  const result = normalize([row('good'), ...bad]);
  assert.equal(result.state, 'reported');
  assert.equal(result.counts.accepted, 1);
  assert.equal(result.counts.invalid, bad.length);
  assert.equal(result.counts.raw, bad.length + 1);
});

test('UKPN rejects duplicate IDs even across excluded rows', () => {
  for (const rows of [[row(), row()], [row(), row('INCD-1', { powercuttype: 'Restored' })]]) {
    const result = normalize(rows);
    assert.equal(result.state, 'unavailable');
    assert.equal(result.reasonCode, 'malformed_response');
    assert.deepEqual(result.incidents, []);
  }
});

test('UKPN requires matching versions, exact totals and a maximum of 100 rows', () => {
  const hundred = Array.from({ length: 100 }, (_, i) => row(String(i)));
  assert.equal(normalize(hundred).counts.accepted, 100);
  assert.equal(normalize([]).state, 'empty');
  const cases = [
    [metadata(), { results: [row()] }, metadata(), 'incomplete_snapshot'],
    [metadata(2), records(), metadata(2), 'incomplete_snapshot'],
    [metadata(), { total_count: 0, results: [row()] }, metadata(), 'incomplete_snapshot'],
    [metadata(), records(), metadata(1, NOW - 500), 'version_changed'],
    [metadata(), records(), metadata(2), 'version_changed'],
    [metadata(101), records([...hundred, row('101')]), metadata(101), 'incomplete_snapshot'],
    [{}, records(), metadata(), 'malformed_response'],
    [metadata(), null, metadata(), 'malformed_response'],
  ];
  for (const [before, rows, after, reason] of cases) {
    const result = normalizeUkpnSnapshot(before, rows, after, NOW);
    assert.equal(result.reasonCode, reason);
    assert.equal(result.state, 'unavailable');
    assert.deepEqual(result.counts, { raw: 0, accepted: 0, excluded: 0, invalid: 0 });
  }
});

test('UKPN rejects stale, future, offset-free and invalid-calendar publication timestamps', () => {
  assert.equal(normalize([row()], NOW - 1001).reasonCode, 'publication_future');
  assert.equal(normalize([row()], NOW - 1000 + 900_000).state, 'stale');
  assert.equal(normalize([row()], NOW - 1000 + 899_999).state, 'reported');
  for (const date of ['2026-11-20T04:29:59', '2026-02-30T04:29:59Z', 'junk']) {
    const m = metadata(); m.metas.default.data_processed = date;
    assert.equal(normalizeUkpnSnapshot(m, records(), m, NOW).reasonCode, 'malformed_response');
  }
});

test('UKPN acquisition uses fixed metadata-records-metadata sequence, caps and redirect rejection', async () => {
  const { provider, calls } = harness();
  const result = await provider.get(); assert.equal(result.state, 'reported');
  assert.deepEqual(calls.map(([url]) => url), [UKPN_METADATA_URL, UKPN_RECORDS_URL, UKPN_METADATA_URL]);
  assert.deepEqual(calls.map(([, opts]) => opts.maxResponseBytes), [64 * 1024, 512 * 1024, 64 * 1024]);
  for (const [, opts, timeout] of calls) { assert.equal(opts.redirect, 'error'); assert.equal(timeout, 8000); assert.ok(opts.signal instanceof AbortSignal); }
});

test('UKPN cache retains original times, expires at 60 seconds and publication boundary', async () => {
  let now = NOW;
  const { provider, calls } = harness({ clock: () => now });
  const initial = await provider.get(); now += 59_999;
  assert.deepEqual(await provider.get(), initial); assert.equal(calls.length, 3);
  now += 1; await provider.get(); assert.equal(calls.length, 6);
  const near = harness({ clock: () => now, bodies: [metadata(1, now - 899_999), records(), metadata(1, now - 899_999)] });
  const fresh = await near.provider.get(); assert.equal(fresh.state, 'reported');
  now += 1;
  const stale = await near.provider.get(); assert.equal(stale.state, 'stale');
  assert.equal(near.calls.length, 6);
});

test('UKPN never caches invalid-row, malformed, rate-limited, redirected or failed responses', async () => {
  for (const response of [() => Response.json({ bad: true }), () => new Response('no', { status: 503 }), () => new Response('', { status: 429 }), () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1' } })]) {
    const { provider, calls } = harness({ fetchFn: response });
    const first = await provider.get(); assert.equal(first.state, 'unavailable');
    await provider.get(); assert.equal(calls.length, 2);
  }
  const partial = harness({ bodies: [metadata(2), records([row(), row('bad', { nocustomeraffected: -1 })]), metadata(2)] });
  const partialResult = await partial.provider.get(); assert.equal(partialResult.counts.invalid, 1);
  await partial.provider.get(); assert.equal(partial.calls.length, 6);
  const rate = harness({ fetchFn: () => new Response('', { status: 429 }) });
  const rateResult = await rate.provider.get(); assert.equal(rateResult.reasonCode, 'rate_limited'); assert.equal(rate.calls.length, 1);
});

test('UKPN rejects declared/streamed oversized valid bodies and malformed JSON without caching', async () => {
  for (const response of [
    () => Response.json(metadata(), { headers: { 'content-length': String(64 * 1024 + 1) } }),
    () => Response.json({ ...metadata(), padding: 'x'.repeat(64 * 1024) }),
    () => new Response('<html>challenge</html>'),
  ]) {
    let upstreamCalls = 0;
    const { provider, calls } = harness({ fetchFn: () => {
      upstreamCalls += 1;
      return upstreamCalls % 3 === 2 ? Response.json(records()) : response();
    } });
    const result = await provider.get(); assert.equal(result.reasonCode, 'malformed_response');
    await provider.get(); assert.equal(calls.length, 2);
  }
});

test('UKPN deadline includes stalled transport and body and clears failed acquisition', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const bodyStalls of [false, true]) {
    let signal;
    const { provider } = harness({ fetchFn: async (_url, options) => {
      signal = options.signal;
      return bodyStalls ? new Response(new ReadableStream({ start() {} })) : new Promise(() => {});
    } });
    t.after(() => provider.reset());
    let settled = false;
    const pending = provider.get(); pending.then(() => { settled = true; }); await flush();
    t.mock.timers.tick(7999); await flush(); assert.equal(settled, false);
    t.mock.timers.tick(1); await flush(); assert.equal(settled, true, 'deadline must settle stalled work at eight seconds');
    const result = await pending; assert.equal(result.reasonCode, 'timeout'); assert.equal(signal.aborted, true);
    provider.reset();
  }
});

test('UKPN concurrent callers share acquisition, one cancellation does not abort another', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0; let upstreamSignal;
  const { provider } = harness({ fetchFn: async (_url, options) => {
    upstreamSignal = options.signal; calls += 1; await gate;
    return Response.json(calls === 2 ? records() : metadata());
  } });
  const a = new AbortController(); const first = provider.get({ signal: a.signal });
  const second = provider.get(); a.abort();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(upstreamSignal.aborted, false); release();
  const result = await second; assert.equal(result.state, 'reported'); assert.equal(calls, 3);
});

test('UKPN final cancellation aborts shared work and allows a fresh acquisition immediately', async () => {
  let calls = 0; let firstSignal;
  const { provider } = harness({ fetchFn: async (_url, options) => {
    calls += 1;
    if (calls === 1) { firstSignal = options.signal; return new Promise(() => {}); }
    return Response.json(calls === 3 ? records() : metadata());
  } });
  const controller = new AbortController(); const first = provider.get({ signal: controller.signal });
  controller.abort(); await assert.rejects(first, { name: 'AbortError' });
  assert.equal(firstSignal.aborted, true);
  const result = await provider.get(); assert.equal(result.state, 'reported'); assert.equal(calls, 4);
});

test('UKPN pre-aborted caller does not acquire, and reset aborts pending work and drops cache', async () => {
  const aborted = new AbortController(); aborted.abort();
  const { provider, calls } = harness();
  await assert.rejects(provider.get({ signal: aborted.signal }), { name: 'AbortError' }); assert.equal(calls.length, 0);
  await provider.get(); provider.reset(); await provider.get(); assert.equal(calls.length, 6);
});

test('UKPN uses remaining overall budget and rejects completion beyond it', async () => {
  let now = NOW; let calls = 0; const budgets = [];
  const { provider } = harness({ clock: () => now, fetchFn: async (_url, _options, remaining) => {
    budgets.push(remaining); calls += 1; now += 3000;
    return Response.json(calls === 2 ? records() : metadata());
  } });
  const result = await provider.get(); assert.equal(result.reasonCode, 'timeout');
  assert.deepEqual(budgets, [8000, 5000, 2000]);
});
