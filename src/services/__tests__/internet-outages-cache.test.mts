import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchIodaOutages,
  getCachedIodaOutages,
  parseSidecarOutages,
} from '../internet-outages.ts';

// parseSidecarOutages is the pure sidecar→IodaOutage projection (no fetch/cache).
// getCachedIodaOutages/fetchIodaOutages cover the warm-cache + TTL read used by
// the survival comms axis. fetchIodaOutages routes through /api/internet-outages.

function sidecarAlert(over: Record<string, unknown> = {}) {
  return {
    entityType: 'country', entityCode: 'SD', entityName: 'Sudan',
    datasource: 'bgp', score: 42, historyValue: 100,
    from: 1_700_000_000, until: 1_700_000_000,
    level: 'critical', condition: 'below', method: 'threshold',
    ...over,
  };
}

// ── Pure projection ──────────────────────────────────────────────────────────

test('empty input → no outages', () => {
  assert.deepEqual(parseSidecarOutages([]), []);
});

test('critical alert maps to a critical, ongoing country outage', () => {
  const [o] = parseSidecarOutages([sidecarAlert({ level: 'critical' })]);
  assert.equal(o!.entityType, 'country');
  assert.equal(o!.entityName, 'Sudan');
  assert.equal(o!.severity, 'critical');
  assert.equal(o!.isOngoing, true);
  assert.equal(o!.score, 0.9); // level-derived proxy
  assert.equal(o!.bgpScore, null); // sidecar projection has no split sub-scores
  assert.match(o!.id, /^ioda-SD-1700000000$/);
});

test('warning maps to high severity; normal/other levels are filtered out', () => {
  const outages = parseSidecarOutages([
    sidecarAlert({ entityCode: 'A', level: 'warning' }),
    sidecarAlert({ entityCode: 'B', level: 'normal' }),
    sidecarAlert({ entityCode: 'C', level: null }),
  ]);
  assert.equal(outages.length, 1);
  assert.equal(outages[0]!.severity, 'high');
  assert.equal(outages[0]!.score, 0.6);
});

test('asn / region entity types map; unknown falls back to region', () => {
  const outages = parseSidecarOutages([
    sidecarAlert({ entityCode: '174', entityType: 'asn', level: 'critical' }),
    sidecarAlert({ entityCode: 'x', entityType: 'weird', level: 'warning' }),
  ]);
  assert.equal(outages.find((o) => o.entityCode === '174')!.entityType, 'asn');
  assert.equal(outages.find((o) => o.entityCode === 'x')!.entityType, 'region');
});

test('critical sorts ahead of warning by level-derived score', () => {
  const outages = parseSidecarOutages([
    sidecarAlert({ entityCode: 'W', level: 'warning' }),
    sidecarAlert({ entityCode: 'C', level: 'critical' }),
  ]);
  assert.deepEqual(outages.map((o) => o.entityCode), ['C', 'W']);
});

test('null entityCode/from still yield a stable id (index fallback)', () => {
  const [o] = parseSidecarOutages([sidecarAlert({ entityCode: null, from: null, level: 'critical' })]);
  assert.match(o!.id, /^ioda-0-0$/);
  assert.ok(o!.startTime instanceof Date);
});

test('output is capped at 50 outages', () => {
  const many = Array.from({ length: 60 }, (_, i) => sidecarAlert({ entityCode: `e${i}`, level: 'critical' }));
  assert.equal(parseSidecarOutages(many).length, 50);
});

// ── Warm-cache getter (fetch routes through the sidecar) ──────────────────────

test('getCachedIodaOutages() returns [] before any fetch (cold)', () => {
  assert.deepEqual(getCachedIodaOutages(), []);
});

test('after a fetch the getter reflects the warm cache, and TTL expiry clears it', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ alerts: [sidecarAlert({ level: 'critical' })], degraded: false }),
  })) as typeof globalThis.fetch;
  try {
    const fetched = await fetchIodaOutages();
    assert.ok(fetched.length >= 1);
    assert.deepEqual(getCachedIodaOutages(), fetched); // identity within TTL
    // Past the 10-min TTL the getter fails safe to [].
    assert.deepEqual(getCachedIodaOutages(Date.now() + 11 * 60 * 1000), []);
    assert.ok(getCachedIodaOutages(Date.now() + 9 * 60 * 1000).length >= 1);
  } finally { globalThis.fetch = realFetch; }
});
