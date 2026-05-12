import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STORE_LIMIT,
  __reset,
  createSituation,
  findByDomain,
  findNear,
  getActive,
  getAll,
  getSituation,
  haversineKm,
  linkCorrelation,
  linkObservation,
  mergeIds,
  resolveSituation,
  updateSituation,
} from '../situation-store.ts';

const NOW = Date.parse('2026-05-11T12:00:00Z');

function seed(over: Partial<Parameters<typeof createSituation>[0]> = {}) {
  return createSituation({
    name: 'Test situation',
    status: 'active',
    severity: 'high',
    domain: 'natural',
    observationIds: [],
    correlationIds: [],
    summary: 'A test situation',
    tags: [],
    confidence: 0.7,
    startedAt: NOW,
    ...over,
  });
}

// ── Pure helpers ──────────────────────────────────────────────────────────

test('haversineKm: ~111km per degree along the equator', () => {
  const km = haversineKm(0, 0, 0, 1);
  assert.ok(km > 110 && km < 112, `expected ~111km, got ${km}`);
});

test('haversineKm: equal points → 0', () => {
  assert.equal(haversineKm(41, -86, 41, -86), 0);
});

test('mergeIds: preserves order and dedupes', () => {
  assert.deepEqual(mergeIds(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(mergeIds([], ['a']), ['a']);
  assert.deepEqual(mergeIds(['a'], []), ['a']);
});

// ── CRUD ──────────────────────────────────────────────────────────────────

test('createSituation: returns a row with auto id + timestamps and copies arrays', () => {
  __reset();
  const tags = ['storm'];
  const obsIds = ['obs-1'];
  const sit = seed({ tags, observationIds: obsIds });
  assert.match(sit.id, /^sit-/);
  assert.equal(sit.startedAt, NOW);
  assert.equal(sit.updatedAt, NOW);
  // Mutating the caller's array must not bleed into the store.
  tags.push('mutated');
  obsIds.push('mutated');
  assert.deepEqual(getSituation(sit.id)?.tags, ['storm']);
  assert.deepEqual(getSituation(sit.id)?.observationIds, ['obs-1']);
});

test('updateSituation: merges observationIds + correlationIds + tags, refreshes updatedAt', () => {
  __reset();
  const sit = seed({ observationIds: ['obs-1'], tags: ['a'] });
  const updated = updateSituation(sit.id, {
    observationIds: ['obs-1', 'obs-2'], // dedupe on existing
    correlationIds: ['cor-1'],
    tags: ['b'],
    summary: 'new summary',
    updatedAt: NOW + 1000,
  });
  assert.deepEqual(updated.observationIds, ['obs-1', 'obs-2']);
  assert.deepEqual(updated.correlationIds, ['cor-1']);
  assert.deepEqual(updated.tags, ['a', 'b']);
  assert.equal(updated.summary, 'new summary');
  assert.equal(updated.updatedAt, NOW + 1000);
  assert.equal(updated.startedAt, NOW, 'startedAt is immutable');
});

test('updateSituation: throws when id not found', () => {
  __reset();
  assert.throws(() => updateSituation('does-not-exist', { summary: 'x' }), /not found/);
});

test('resolveSituation: flips status to resolved but keeps the row in the store', () => {
  __reset();
  const sit = seed();
  resolveSituation(sit.id, NOW + 500);
  const stored = getSituation(sit.id);
  assert.equal(stored?.status, 'resolved');
  assert.equal(stored?.updatedAt, NOW + 500);
  assert.equal(getAll().length, 1);
});

// ── Eviction ─────────────────────────────────────────────────────────────

test('createSituation: evicts oldest entries past STORE_LIMIT (FIFO)', () => {
  __reset();
  for (let i = 0; i < STORE_LIMIT + 10; i += 1) {
    seed({ name: `s-${i}`, startedAt: NOW + i });
  }
  const all = getAll();
  assert.equal(all.length, STORE_LIMIT);
  // Newest entry survives, oldest are gone.
  assert.equal(all[all.length - 1]?.name, `s-${STORE_LIMIT + 9}`);
  assert.equal(all[0]?.name, 's-10');
});

// ── Queries ──────────────────────────────────────────────────────────────

test('getActive: excludes resolved situations', () => {
  __reset();
  const a = seed({ name: 'active-1' });
  seed({ name: 'monitor-1', status: 'monitoring' });
  const res = seed({ name: 'will-resolve' });
  resolveSituation(res.id);
  const active = getActive().map((s) => s.name);
  assert.deepEqual(active.sort(), ['active-1', 'monitor-1']);
  // Ensure caller can't mutate the stored entry through the snapshot.
  const snapshot = getActive();
  snapshot[0]!.name = 'tampered';
  assert.equal(getSituation(a.id)?.name, 'active-1');
});

test('findByDomain: returns active situations matching the requested domain', () => {
  __reset();
  seed({ name: 'storm', domain: 'natural' });
  seed({ name: 'market', domain: 'finance' });
  const resolved = seed({ name: 'resolved-natural', domain: 'natural' });
  resolveSituation(resolved.id);
  const out = findByDomain('natural').map((s) => s.name);
  assert.deepEqual(out, ['storm']);
});

test('findNear: returns active situations whose location falls within the radius', () => {
  __reset();
  seed({ name: 'in-range',
    location: { lat: 41.6, lon: -86.7, radiusKm: 50 } });   // La Porte, IN-ish
  seed({ name: 'out-of-range',
    location: { lat: -33, lon: 151, radiusKm: 50 } });      // Sydney
  seed({ name: 'no-location' });                            // skipped
  const hits = findNear(41.6, -86.7, 100).map((s) => s.name);
  assert.deepEqual(hits, ['in-range']);
});

test('findNear: rejects invalid lat/lon or non-positive radius', () => {
  __reset();
  seed({ location: { lat: 0, lon: 0, radiusKm: 50 } });
  assert.deepEqual(findNear(Number.NaN, 0, 100), []);
  assert.deepEqual(findNear(0, 0, 0), []);
  assert.deepEqual(findNear(0, 0, -10), []);
});

// ── Linking helpers ──────────────────────────────────────────────────────

test('linkObservation / linkCorrelation: append-and-dedupe via the merger', () => {
  __reset();
  const sit = seed({ observationIds: ['obs-1'], correlationIds: ['cor-1'] });
  linkObservation(sit.id, 'obs-2');
  linkObservation(sit.id, 'obs-1'); // duplicate must be ignored
  linkCorrelation(sit.id, 'cor-2');
  const stored = getSituation(sit.id)!;
  assert.deepEqual(stored.observationIds, ['obs-1', 'obs-2']);
  assert.deepEqual(stored.correlationIds, ['cor-1', 'cor-2']);
});

test('linkObservation: throws when situation id is unknown', () => {
  __reset();
  assert.throws(() => linkObservation('nope', 'obs-1'), /not found/);
});
