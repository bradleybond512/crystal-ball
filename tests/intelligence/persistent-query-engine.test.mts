/**
 * Tests for PersistentQueryEngineService.
 *
 * Run with: npx tsx --test tests/intelligence/persistent-query-engine.test.mts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MATCHES_STORAGE_KEY,
  MAX_MATCHES,
  PersistentQueryEngineService,
  QUERIES_STORAGE_KEY,
  __internals,
  __resetPersistentQueryEngineSingleton,
  evaluateCondition,
  getPersistentQueryEngineService,
  type EvaluationSource,
  type QueryEngineStorage,
  type QueryInput,
} from '../../src/services/intelligence/persistent-query-engine.ts';

const NOW = 1_745_000_000_000;

function makeStorage(): { storage: QueryEngineStorage; map: Map<string, string> } {
  const map = new Map<string, string>();
  const storage: QueryEngineStorage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
  return { storage, map };
}

function tickingClock(start = NOW): () => number {
  let t = start;
  return () => {
    t += 1000;
    return t;
  };
}

function freshService(clock = () => NOW): PersistentQueryEngineService {
  const { storage } = makeStorage();
  return new PersistentQueryEngineService(storage, clock);
}

function source(overrides: Partial<EvaluationSource> = {}): EvaluationSource {
  return {
    id: 'obs-1',
    type: 'observation',
    domain: 'cyber',
    severity: 'high',
    region: 'EU',
    title: 'CVE-2026-1 mass exploitation',
    ...overrides,
  };
}

function queryInput(overrides: Partial<QueryInput> = {}): QueryInput {
  return {
    name: 'Default query',
    conditions: [{ field: 'domain', operator: 'equals', value: 'cyber' }],
    combinator: 'AND',
    enabled: true,
    ...overrides,
  };
}

// ── save() ────────────────────────────────────────────────────────────

test('save stamps id, createdAt, matchCount=0', () => {
  const svc = freshService();
  const q = svc.save(queryInput());
  assert.ok(q.id.startsWith('q-'));
  assert.equal(q.createdAt, NOW);
  assert.equal(q.matchCount, 0);
  assert.equal(q.lastMatchedAt, undefined);
});

test('save returns defensive copy — mutating result does not affect store', () => {
  const svc = freshService();
  const q = svc.save(queryInput({ name: 'X', conditions: [{ field: 'domain', operator: 'equals', value: 'cyber' }] }));
  q.conditions.push({ field: 'severity', operator: 'gte', value: 'critical' });
  q.name = 'Y';
  const stored = svc.getQueries()[0]!;
  assert.equal(stored.name, 'X');
  assert.equal(stored.conditions.length, 1);
});

// ── update() ─────────────────────────────────────────────────────────

test('update changes specified fields and preserves others', () => {
  const svc = freshService();
  const q = svc.save(queryInput({ name: 'old', enabled: true }));
  const u = svc.update(q.id, { name: 'new', enabled: false });
  assert.ok(u);
  assert.equal(u!.name, 'new');
  assert.equal(u!.enabled, false);
  assert.equal(u!.combinator, q.combinator);
});

test('update returns null on unknown id', () => {
  const svc = freshService();
  assert.equal(svc.update('does-not-exist', { name: 'x' }), null);
});

// ── delete() ─────────────────────────────────────────────────────────

test('delete removes the query and returns true', () => {
  const svc = freshService();
  const q = svc.save(queryInput());
  assert.equal(svc.delete(q.id), true);
  assert.equal(svc.getQueries().length, 0);
});

test('delete returns false on unknown id', () => {
  const svc = freshService();
  assert.equal(svc.delete('does-not-exist'), false);
});

// ── evaluate() AND ───────────────────────────────────────────────────

test('evaluate AND: all conditions must match for a hit', () => {
  const svc = freshService();
  svc.save(queryInput({
    name: 'cyber + EU',
    conditions: [
      { field: 'domain', operator: 'equals', value: 'cyber' },
      { field: 'region', operator: 'equals', value: 'EU' },
    ],
    combinator: 'AND',
  }));
  assert.equal(svc.evaluate(source({ domain: 'cyber', region: 'EU' })).length, 1);
  assert.equal(svc.evaluate(source({ domain: 'cyber', region: 'US' })).length, 0);
});

test('evaluate AND: zero conditions never matches', () => {
  const svc = freshService();
  svc.save(queryInput({ name: 'empty', conditions: [], combinator: 'AND' }));
  assert.equal(svc.evaluate(source()).length, 0);
});

// ── evaluate() OR ────────────────────────────────────────────────────

test('evaluate OR: any matching condition counts as a hit', () => {
  const svc = freshService();
  svc.save(queryInput({
    name: 'cyber OR EU',
    conditions: [
      { field: 'domain', operator: 'equals', value: 'aviation' },
      { field: 'region', operator: 'equals', value: 'EU' },
    ],
    combinator: 'OR',
  }));
  // Source matches second condition (region EU) but not first.
  assert.equal(svc.evaluate(source({ domain: 'cyber', region: 'EU' })).length, 1);
});

test('evaluate OR: zero conditions still does not match', () => {
  const svc = freshService();
  svc.save(queryInput({ name: 'empty-or', conditions: [], combinator: 'OR' }));
  assert.equal(svc.evaluate(source()).length, 0);
});

// ── evaluate() disabled ──────────────────────────────────────────────

test('evaluate skips disabled queries', () => {
  const svc = freshService();
  svc.save(queryInput({ enabled: false }));
  assert.equal(svc.evaluate(source()).length, 0);
});

// ── evaluate() operators ─────────────────────────────────────────────

test('operator equals is case-insensitive', () => {
  assert.equal(evaluateCondition(source({ domain: 'Cyber' }), { field: 'domain', operator: 'equals', value: 'cyber' }), true);
});

test('operator contains matches substrings case-insensitively (keyword field uses title)', () => {
  const s = source({ title: 'CVE-2026 mass exploit chain' });
  assert.equal(evaluateCondition(s, { field: 'keyword', operator: 'contains', value: 'mass exploit' }), true);
  assert.equal(evaluateCondition(s, { field: 'keyword', operator: 'contains', value: 'tsunami' }), false);
});

test('operator gte on severity: critical > high > medium > low', () => {
  const cond = { field: 'severity' as const, operator: 'gte' as const, value: 'high' };
  assert.equal(evaluateCondition(source({ severity: 'critical' }), cond), true);
  assert.equal(evaluateCondition(source({ severity: 'high' }), cond), true);
  assert.equal(evaluateCondition(source({ severity: 'medium' }), cond), false);
  assert.equal(evaluateCondition(source({ severity: 'low' }), cond), false);
});

test('operator gte on non-severity field returns false', () => {
  assert.equal(evaluateCondition(source(), { field: 'domain', operator: 'gte', value: 'aviation' }), false);
});

test('operator gte on unknown severity ranks as 0', () => {
  const cond = { field: 'severity' as const, operator: 'gte' as const, value: 'low' };
  assert.equal(evaluateCondition(source({ severity: 'unknown' }), cond), false);
});

test('keyword field on a source with no title yields empty string (no contains match)', () => {
  const s: EvaluationSource = { id: 'x', type: 'observation', domain: 'cyber', severity: 'high' };
  assert.equal(evaluateCondition(s, { field: 'keyword', operator: 'contains', value: 'anything' }), false);
});

// ── matchCount + lastMatchedAt ───────────────────────────────────────

test('evaluate increments matchCount and stamps lastMatchedAt on each hit', () => {
  let t = NOW;
  const { storage } = makeStorage();
  const svc = new PersistentQueryEngineService(storage, () => t);
  const q = svc.save(queryInput());
  t += 1000;
  svc.evaluate(source());
  t += 1000;
  svc.evaluate(source());
  const updated = svc.getQueries().find((x) => x.id === q.id)!;
  assert.equal(updated.matchCount, 2);
  assert.equal(updated.lastMatchedAt, t); // most recent tick
});

test('evaluate does not bump matchCount when no query matches', () => {
  const svc = freshService();
  svc.save(queryInput({ conditions: [{ field: 'domain', operator: 'equals', value: 'maritime' }] }));
  svc.evaluate(source({ domain: 'cyber' }));
  assert.equal(svc.getQueries()[0]!.matchCount, 0);
});

// ── QueryMatch fields ────────────────────────────────────────────────

test('match records sourceType, sourceId, queryId, queryName, fieldSnapshot', () => {
  const svc = freshService();
  const q = svc.save(queryInput({ name: 'cyber'}));
  const matches = svc.evaluate(source({ id: 'obs-XYZ', type: 'observation', domain: 'cyber', severity: 'critical', region: 'APAC', title: 'X' }));
  const m = matches[0]!;
  assert.equal(m.queryId, q.id);
  assert.equal(m.queryName, 'cyber');
  assert.equal(m.sourceId, 'obs-XYZ');
  assert.equal(m.sourceType, 'observation');
  assert.equal(m.fieldSnapshot.domain, 'cyber');
  assert.equal(m.fieldSnapshot.severity, 'critical');
  assert.equal(m.fieldSnapshot.region, 'APAC');
});

test('fieldSnapshot omits region/title when undefined on source', () => {
  const svc = freshService();
  svc.save(queryInput());
  const s: EvaluationSource = { id: 'obs-x', type: 'observation', domain: 'cyber', severity: 'high' };
  const matches = svc.evaluate(s);
  const m = matches[0]!;
  assert.ok(!('region' in m.fieldSnapshot));
  assert.ok(!('title' in m.fieldSnapshot));
});

// ── getMatches() ─────────────────────────────────────────────────────

test('getMatches returns matches LIFO', () => {
  let t = NOW;
  const { storage } = makeStorage();
  const svc = new PersistentQueryEngineService(storage, () => t);
  svc.save(queryInput());
  for (let i = 0; i < 3; i++) {
    svc.evaluate(source({ id: `obs-${i}` }));
    t += 1000;
  }
  const matches = svc.getMatches();
  assert.equal(matches.length, 3);
  assert.equal(matches[0]!.sourceId, 'obs-2');
});

test('getMatches filters by queryId', () => {
  const svc = freshService();
  const qA = svc.save(queryInput({ name: 'A', conditions: [{ field: 'domain', operator: 'equals', value: 'cyber' }] }));
  const qB = svc.save(queryInput({ name: 'B', conditions: [{ field: 'severity', operator: 'gte', value: 'high' }] }));
  svc.evaluate(source());
  assert.equal(svc.getMatches(qA.id).length, 1);
  assert.equal(svc.getMatches(qB.id).length, 1);
});

test('getMatches limit caps the result count', () => {
  const svc = freshService();
  svc.save(queryInput());
  for (let i = 0; i < 5; i++) svc.evaluate(source({ id: `obs-${i}` }));
  assert.equal(svc.getMatches(undefined, 2).length, 2);
});

// ── getStats() ───────────────────────────────────────────────────────

test('getStats reports total + enabled + total matches', () => {
  const svc = freshService();
  svc.save(queryInput({ enabled: true }));
  svc.save(queryInput({ enabled: false }));
  svc.save(queryInput({ enabled: true }));
  svc.evaluate(source());
  const stats = svc.getStats();
  assert.equal(stats.totalQueries, 3);
  assert.equal(stats.enabledQueries, 2);
  assert.equal(stats.totalMatches, 2); // both enabled queries match cyber
});

test('getStats.topQuery is the highest-matchCount query', () => {
  const svc = freshService();
  const qLight = svc.save(queryInput({ name: 'light', conditions: [{ field: 'domain', operator: 'equals', value: 'aviation' }] }));
  const qHeavy = svc.save(queryInput({ name: 'heavy', conditions: [{ field: 'domain', operator: 'equals', value: 'cyber' }] }));
  for (let i = 0; i < 4; i++) svc.evaluate(source());
  svc.evaluate(source({ domain: 'aviation' }));
  const stats = svc.getStats();
  assert.ok(stats.topQuery);
  assert.equal(stats.topQuery!.id, qHeavy.id);
  assert.equal(stats.topQuery!.matchCount, 4);
  assert.notEqual(stats.topQuery!.id, qLight.id);
});

test('getStats.topQuery is null when no matches yet', () => {
  const svc = freshService();
  svc.save(queryInput());
  assert.equal(svc.getStats().topQuery, null);
});

// ── Ring buffer ──────────────────────────────────────────────────────

test('matches ring buffer caps at MAX_MATCHES', () => {
  let t = NOW;
  const { storage } = makeStorage();
  const svc = new PersistentQueryEngineService(storage, () => t);
  svc.save(queryInput());
  for (let i = 0; i < MAX_MATCHES + 50; i++) {
    svc.evaluate(source({ id: `obs-${i}` }));
    t += 1;
  }
  assert.equal(svc.getMatches().length, MAX_MATCHES);
});

// ── subscribe() ──────────────────────────────────────────────────────

test('subscribe fires once per match (per matching query, per evaluate)', () => {
  const svc = freshService();
  svc.save(queryInput({ name: 'A' }));
  svc.save(queryInput({ name: 'B' }));
  let fires = 0;
  svc.subscribe(() => { fires += 1; });
  svc.evaluate(source());
  // Two queries match → two listener fires.
  assert.equal(fires, 2);
});

test('subscribe unsubscribe stops further fires', () => {
  const svc = freshService();
  svc.save(queryInput());
  let fires = 0;
  const off = svc.subscribe(() => { fires += 1; });
  svc.evaluate(source());
  off();
  svc.evaluate(source());
  assert.equal(fires, 1);
});

test('subscribe listener exception is isolated', () => {
  const svc = freshService();
  svc.save(queryInput());
  let goodFires = 0;
  svc.subscribe(() => { throw new Error('boom'); });
  svc.subscribe(() => { goodFires += 1; });
  svc.evaluate(source());
  assert.equal(goodFires, 1);
});

// ── Persistence ──────────────────────────────────────────────────────

test('queries + matches survive across instances via storage', () => {
  const { storage } = makeStorage();
  const a = new PersistentQueryEngineService(storage, () => NOW);
  a.save(queryInput({ name: 'persist me' }));
  a.evaluate(source());
  const b = new PersistentQueryEngineService(storage, () => NOW);
  assert.equal(b.getQueries().length, 1);
  assert.equal(b.getMatches().length, 1);
});

test('persistence keys are wm-saved-queries + wm-query-matches', () => {
  const { storage, map } = makeStorage();
  const svc = new PersistentQueryEngineService(storage, () => NOW);
  svc.save(queryInput());
  svc.evaluate(source());
  assert.ok(map.has(QUERIES_STORAGE_KEY));
  assert.ok(map.has(MATCHES_STORAGE_KEY));
  assert.equal(QUERIES_STORAGE_KEY, 'wm-saved-queries');
  assert.equal(MATCHES_STORAGE_KEY, 'wm-query-matches');
});

test('corrupt persisted blobs do not crash hydrate', () => {
  const { storage } = makeStorage();
  storage.setItem(QUERIES_STORAGE_KEY, 'not-json');
  storage.setItem(MATCHES_STORAGE_KEY, 'not-json');
  const svc = new PersistentQueryEngineService(storage, () => NOW);
  assert.equal(svc.getQueries().length, 0);
  assert.equal(svc.getMatches().length, 0);
});

// ── Singleton ────────────────────────────────────────────────────────

test('getPersistentQueryEngineService returns a stable singleton', () => {
  __resetPersistentQueryEngineSingleton();
  const a = getPersistentQueryEngineService();
  const b = getPersistentQueryEngineService();
  assert.equal(a, b);
  __resetPersistentQueryEngineSingleton();
});

// ── Internals ────────────────────────────────────────────────────────

test('internals.severityRank maps known severities + unknown to 0', () => {
  assert.equal(__internals.severityRank('critical'), 4);
  assert.equal(__internals.severityRank('high'), 3);
  assert.equal(__internals.severityRank('medium'), 2);
  assert.equal(__internals.severityRank('low'), 1);
  assert.equal(__internals.severityRank('made-up'), 0);
});

test('internals.matchesQuery returns false for queries with zero conditions', () => {
  const q = {
    id: 'q', name: 'n', conditions: [], combinator: 'AND' as const,
    enabled: true, createdAt: 0, matchCount: 0,
  };
  assert.equal(__internals.matchesQuery(source(), q), false);
});

test('internals.isValidQuery rejects malformed objects', () => {
  assert.equal(__internals.isValidQuery({}), false);
  assert.equal(__internals.isValidQuery({ id: 'x' }), false);
  assert.equal(__internals.isValidQuery(null), false);
});
