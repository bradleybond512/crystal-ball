import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createIntelligenceIndexService,
  STORAGE_KEY,
  MAX_ENTRIES,
  TITLE_MATCH_SCORE,
  TAG_MATCH_SCORE,
  SUMMARY_MATCH_SCORE,
  DEFAULT_SEARCH_LIMIT,
  type IndexedArtifact,
} from '../../src/services/intelligence/intelligence-index.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    key(i: number) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

const NOW = new Date('2026-05-18T12:00:00Z');
const NOW_MS = NOW.getTime();

function makeArtifact(
  overrides: Partial<Omit<IndexedArtifact, 'id' | 'indexedAt'>> = {},
): Omit<IndexedArtifact, 'id' | 'indexedAt'> {
  return {
    artifactId: 'a-1',
    artifactType: 'situation',
    title: 'Earthquake near Tokyo',
    summary: 'M6.2 quake; aftershocks ongoing.',
    domain: 'earthquake',
    tags: ['seismic', 'pacific-rim'],
    ...overrides,
  };
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-intelligence-index"', () => {
  assert.equal(STORAGE_KEY, 'wm-intelligence-index');
});

test('MAX_ENTRIES is 5000', () => {
  assert.equal(MAX_ENTRIES, 5000);
});

test('DEFAULT_SEARCH_LIMIT is 20', () => {
  assert.equal(DEFAULT_SEARCH_LIMIT, 20);
});

test('TITLE_MATCH_SCORE is 3', () => {
  assert.equal(TITLE_MATCH_SCORE, 3);
});

test('TAG_MATCH_SCORE is 2', () => {
  assert.equal(TAG_MATCH_SCORE, 2);
});

test('SUMMARY_MATCH_SCORE is 1', () => {
  assert.equal(SUMMARY_MATCH_SCORE, 1);
});

// ── index ────────────────────────────────────────────────────────────────

test('index assigns id + indexedAt', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact());
  const result = svc.getByType('situation');
  assert.equal(result.length, 1);
  assert.ok(result[0]?.id);
  assert.equal(result[0]?.indexedAt, NOW_MS);
});

test('index upserts by (artifactId, artifactType)', () => {
  let t = NOW_MS;
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => t });
  svc.index(makeArtifact({ artifactId: 'shared', title: 'First' }));
  t += 1000;
  svc.index(makeArtifact({ artifactId: 'shared', title: 'Second' }));
  const list = svc.getByType('situation');
  assert.equal(list.length, 1);
  assert.equal(list[0]?.title, 'Second');
  assert.equal(list[0]?.indexedAt, NOW_MS + 1000);
});

test('upserting different artifactTypes with same artifactId keeps them separate', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({ artifactId: 'x', artifactType: 'situation', title: 'sit' }));
  svc.index(makeArtifact({ artifactId: 'x', artifactType: 'observation', title: 'obs' }));
  assert.equal(svc.getByType('situation').length, 1);
  assert.equal(svc.getByType('observation').length, 1);
});

// ── search: title scoring ────────────────────────────────────────────────

test('search title match yields TITLE_MATCH_SCORE', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({ artifactId: 'a', title: 'Tokyo earthquake report' }));
  const results = svc.search('tokyo');
  assert.equal(results.length, 1);
  assert.equal(results[0]?.score, TITLE_MATCH_SCORE);
  assert.ok(results[0]?.matchedFields.includes('title'));
});

test('search tag match yields TAG_MATCH_SCORE', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({
    artifactId: 'a',
    title: 'Generic title',
    summary: 'Generic summary',
    tags: ['seismic'],
  }));
  const results = svc.search('seismic');
  assert.equal(results.length, 1);
  assert.equal(results[0]?.score, TAG_MATCH_SCORE);
  assert.ok(results[0]?.matchedFields.includes('tags'));
});

test('search summary match yields SUMMARY_MATCH_SCORE', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({
    artifactId: 'a',
    title: 'Generic title',
    summary: 'A rare aftershock pattern observed.',
    tags: ['something-else'],
  }));
  const results = svc.search('aftershock');
  assert.equal(results.length, 1);
  assert.equal(results[0]?.score, SUMMARY_MATCH_SCORE);
  assert.ok(results[0]?.matchedFields.includes('summary'));
});

test('search multi-field scoring sums per-field points', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({
    artifactId: 'a',
    title: 'tokyo earthquake',
    summary: 'tokyo bay damage assessment',
    tags: ['tokyo'],
  }));
  const results = svc.search('tokyo');
  assert.equal(results.length, 1);
  assert.equal(results[0]?.score, TITLE_MATCH_SCORE + TAG_MATCH_SCORE + SUMMARY_MATCH_SCORE);
});

test('search is case-insensitive', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({ title: 'Massive Earthquake' }));
  const upper = svc.search('EARTHQUAKE').length;
  const lower = svc.search('earthquake').length;
  const mixed = svc.search('EarthQuake').length;
  assert.equal(upper, lower);
  assert.equal(lower, mixed);
});

test('search empty query returns no results', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact());
  assert.equal(svc.search('').length, 0);
  assert.equal(svc.search('   ').length, 0);
});

test('search no-match returns empty array', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({ title: 'Earthquake' }));
  assert.equal(svc.search('typhoon').length, 0);
});

test('search sorts by score desc', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({ artifactId: 'low', title: 'unrelated', summary: 'fire seen', tags: ['observed'] }));
  svc.index(makeArtifact({ artifactId: 'high', title: 'fire warning', summary: 'fire raging', tags: ['fire'] }));
  const results = svc.search('fire');
  assert.equal(results.length, 2);
  assert.ok((results[0]?.score ?? 0) >= (results[1]?.score ?? 0));
  assert.equal(results[0]?.artifact.artifactId, 'high');
});

test('search ties broken by indexedAt desc', () => {
  let t = NOW_MS;
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => t });
  svc.index(makeArtifact({ artifactId: 'old', title: 'fire alpha' }));
  t += 1000;
  svc.index(makeArtifact({ artifactId: 'new', title: 'fire beta' }));
  const results = svc.search('fire');
  assert.equal(results[0]?.artifact.artifactId, 'new');
});

test('search respects limit', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (let i = 0; i < 30; i++) svc.index(makeArtifact({ artifactId: `a${i}`, title: `fire ${i}` }));
  assert.equal(svc.search('fire', undefined, 5).length, 5);
});

test('search default limit is DEFAULT_SEARCH_LIMIT', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (let i = 0; i < 30; i++) svc.index(makeArtifact({ artifactId: `a${i}`, title: `fire ${i}` }));
  assert.equal(svc.search('fire').length, DEFAULT_SEARCH_LIMIT);
});

test('search filters by artifactType', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({ artifactId: 's1', artifactType: 'situation', title: 'fire situation' }));
  svc.index(makeArtifact({ artifactId: 'o1', artifactType: 'observation', title: 'fire observation' }));
  const filtered = svc.search('fire', { artifactType: 'observation' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.artifact.artifactType, 'observation');
});

test('search filters by domain', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({ artifactId: 'w', title: 'fire warning', domain: 'wildfire' }));
  svc.index(makeArtifact({ artifactId: 'c', title: 'fire alert', domain: 'cyber' }));
  const filtered = svc.search('fire', { domain: 'wildfire' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.artifact.domain, 'wildfire');
});

test('search matches domain field as title-class fallback', () => {
  // Domain is a structural facet; we don't require it to score directly in score
  // but the filter must use it. This test guards the filter behavior.
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({ artifactId: 'eq', title: 'M6 quake', domain: 'earthquake', tags: [], summary: '' }));
  // Title doesn't contain 'earthquake' but domain does — domain filter still includes it.
  const byDomain = svc.search('quake', { domain: 'earthquake' });
  assert.equal(byDomain.length, 1);
});

// ── getByType / getByDomain ──────────────────────────────────────────────

test('getByType returns LIFO (newest first)', () => {
  let t = NOW_MS;
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => t });
  svc.index(makeArtifact({ artifactId: 'older', title: 'older' }));
  t += 1000;
  svc.index(makeArtifact({ artifactId: 'newer', title: 'newer' }));
  const list = svc.getByType('situation');
  assert.equal(list[0]?.title, 'newer');
});

test('getByType respects limit', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (let i = 0; i < 10; i++) svc.index(makeArtifact({ artifactId: `a${i}` }));
  assert.equal(svc.getByType('situation', 3).length, 3);
});

test('getByDomain returns matching entries LIFO', () => {
  let t = NOW_MS;
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => t });
  svc.index(makeArtifact({ artifactId: 'eq1', domain: 'earthquake' }));
  t += 1000;
  svc.index(makeArtifact({ artifactId: 'wf', domain: 'wildfire' }));
  t += 1000;
  svc.index(makeArtifact({ artifactId: 'eq2', domain: 'earthquake' }));
  const eq = svc.getByDomain('earthquake');
  assert.equal(eq.length, 2);
  assert.equal(eq[0]?.artifactId, 'eq2');
});

// ── remove ───────────────────────────────────────────────────────────────

test('remove drops the matching entry', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({ artifactId: 'a' }));
  svc.remove('a', 'situation');
  assert.equal(svc.getByType('situation').length, 0);
});

test('remove with unknown artifactId is a no-op', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({ artifactId: 'a' }));
  assert.doesNotThrow(() => svc.remove('nope', 'situation'));
  assert.equal(svc.getByType('situation').length, 1);
});

test('remove with wrong artifactType is a no-op', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({ artifactId: 'a', artifactType: 'situation' }));
  svc.remove('a', 'observation');
  assert.equal(svc.getByType('situation').length, 1);
});

// ── getStats ─────────────────────────────────────────────────────────────

test('getStats.total reflects index count', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({ artifactId: 'a' }));
  svc.index(makeArtifact({ artifactId: 'b', artifactType: 'observation' }));
  assert.equal(svc.getStats().total, 2);
});

test('getStats.byType has per-type counts', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({ artifactId: 's1', artifactType: 'situation' }));
  svc.index(makeArtifact({ artifactId: 's2', artifactType: 'situation' }));
  svc.index(makeArtifact({ artifactId: 'o1', artifactType: 'observation' }));
  const stats = svc.getStats();
  assert.equal(stats.byType.situation, 2);
  assert.equal(stats.byType.observation, 1);
});

test('getStats.lastIndexedAt updates on index', () => {
  let t = NOW_MS;
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => t });
  svc.index(makeArtifact());
  t += 1000;
  svc.index(makeArtifact({ artifactId: 'b' }));
  assert.equal(svc.getStats().lastIndexedAt, NOW_MS + 1000);
});

test('getStats.lastIndexedAt is null for empty index', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  assert.equal(svc.getStats().lastIndexedAt, null);
});

// ── Ring buffer ──────────────────────────────────────────────────────────

test('ring-buffer evicts oldest at MAX_ENTRIES', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (let i = 0; i < MAX_ENTRIES + 30; i++) {
    svc.index(makeArtifact({ artifactId: `a${i}`, title: `entry ${i}` }));
  }
  assert.ok(svc.getStats().total <= MAX_ENTRIES);
});

// ── subscribe ────────────────────────────────────────────────────────────

test('subscribe is notified on index', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.index(makeArtifact());
  assert.ok(calls >= 1);
});

test('subscribe is notified on remove', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.index(makeArtifact({ artifactId: 'a' }));
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.remove('a', 'situation');
  assert.ok(calls >= 1);
});

test('unsubscribe stops notifications', () => {
  const svc = createIntelligenceIndexService({ storage: createMemoryStorage(), now: () => NOW_MS });
  let calls = 0;
  const fn = () => { calls += 1; };
  svc.subscribe(fn);
  svc.unsubscribe(fn);
  svc.index(makeArtifact());
  assert.equal(calls, 0);
});

// ── Persistence ──────────────────────────────────────────────────────────

test('entries persist across instances', () => {
  const storage = createMemoryStorage();
  const svc1 = createIntelligenceIndexService({ storage, now: () => NOW_MS });
  svc1.index(makeArtifact({ artifactId: 'persisted', title: 'survives reload' }));

  const svc2 = createIntelligenceIndexService({ storage, now: () => NOW_MS });
  const results = svc2.search('survives');
  assert.equal(results.length, 1);
  assert.equal(results[0]?.artifact.artifactId, 'persisted');
});
