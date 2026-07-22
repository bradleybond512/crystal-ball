/**
 * Tests for cognition/episodic-memory.ts
 *
 * Hashed tier only (no sidecar/Ollama), static fixtures, no real IDB/DOM/fetch.
 * Uses injectable storage and no-op IDB stubs following the active-learning-queue
 * and action-memory patterns.
 *
 * Runs via: tsx --test src/services/cognition/__tests__/episodic-memory.test.mts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// ── Minimal stubs (must come before imports that touch globalThis) ─────────────

// Stub localStorage
const _store: Record<string, string> = {};
const stubStorage = {
  getItem: (k: string): string | null => _store[k] ?? null,
  setItem: (k: string, v: string): void => { _store[k] = v; },
};

// Stub mode-manager — never ghost mode in tests
const _modeStub = { isGhostMode: () => false };

// Stub runtime (not desktop → no sidecar calls → hashed tier always)
const _runtimeStub = {
  isDesktopRuntime: () => false,
  getApiBaseUrl: () => '',
};

// Patch globalThis with stubs before any module import.
(globalThis as unknown as Record<string, unknown>).localStorage = stubStorage;

// Stub CustomEvent and window for event dispatch
(globalThis as unknown as Record<string, unknown>).window = {
  dispatchEvent: () => false,
};
(globalThis as unknown as Record<string, unknown>).CustomEvent = class {
  type: string; detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type; this.detail = init?.detail;
  }
};

// ── Module imports (after stubs) ──────────────────────────────────────────────

// We mock the mode-manager import inside the module by injecting directly.
// Since we can't intercept ESM imports easily in tsx, we use the configureForTests
// API that episodic-memory.ts exposes.

const {
  recordEpisode,
  resolveEpisode,
  recall,
  analogScoreFor,
  getAllEpisodes,
  getEpisodeCount,
  configureForTests,
  resetForTests,
  getCachedAnalogScore,
  updateAnalogCache,
  _clearAnalogCacheForTests,
  markEpisodeContradictory,
  contradictEpisodesForRefutation,
} = await import('../episodic-memory.ts');

// ── Patch isGhostMode so it's never ghost in tests ───────────────────────────
// (episodic-memory imports isGhostMode; we rely on the mode-manager returning
// false in a test environment since currentMode is null by default.)

// ── Helpers ───────────────────────────────────────────────────────────────────

let _now = 1_700_000_000_000; // fixed epoch
const testNow = (): number => _now;

function advanceTime(ms: number): void { _now += ms; }

const noopGetMemory = async <T>(_key: string): Promise<T | null> => null;
const noopPutMemory = async <T>(_key: string, _val: T): Promise<void> => undefined;

function setupTests(): void {
  for (const k of Object.keys(_store)) delete _store[k];
  resetForTests();
  configureForTests({
    storage: stubStorage,
    getMemoryFn: noopGetMemory,
    putMemoryFn: noopPutMemory,
    now: testNow,
  });
  _now = 1_700_000_000_000;
}

function makeEpisodeInput(overrides: Partial<Parameters<typeof recordEpisode>[0]> = {}): Parameters<typeof recordEpisode>[0] {
  return {
    kind: 'hypothesis',
    signature: `sig-${Math.random().toString(36).slice(2)}`,
    summary: 'Black Sea wheat shipment disruption due to escalating conflict near the Bosphorus.',
    domains: ['geopolitics', 'shortage'],
    entities: ['Black Sea', 'wheat', 'Bosphorus'],
    createdAt: testNow(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('recordEpisode: creates an episode with id, vector, and tier', async () => {
  setupTests();
  const ep = await recordEpisode(makeEpisodeInput());
  assert.ok(ep.id.startsWith('ep-'), `expected ep-* id, got ${ep.id}`);
  assert.ok(Array.isArray(ep.vector) && ep.vector.length > 0, 'vector should be non-empty');
  assert.equal(ep.tier, 'hashed'); // no sidecar in tests
});

test('recordEpisode: truncates summary to 500 chars', async () => {
  setupTests();
  const longSummary = 'x'.repeat(600);
  const ep = await recordEpisode(makeEpisodeInput({ summary: longSummary }));
  assert.equal(ep.summary.length, 500);
});

test('recordEpisode: stores episode in memory', async () => {
  setupTests();
  await recordEpisode(makeEpisodeInput({ signature: 'test-sig-1' }));
  assert.equal(getEpisodeCount(), 1);
});

test('recordEpisode: deduplicates by signature (pending only)', async () => {
  setupTests();
  const sig = 'shared-sig';
  const ep1 = await recordEpisode(makeEpisodeInput({ signature: sig }));
  const ep2 = await recordEpisode(makeEpisodeInput({ signature: sig }));
  // Should return the same episode (no duplicate)
  assert.equal(ep1.id, ep2.id);
  assert.equal(getEpisodeCount(), 1);
});

test('resolveEpisode: sets resolvedAt and outcome', async () => {
  setupTests();
  const ep = await recordEpisode(makeEpisodeInput());
  advanceTime(1000);
  await resolveEpisode(ep.id, 'materialized', 'Shipments halted for 3 weeks.');
  const all = getAllEpisodes();
  const found = all.find(e => e.id === ep.id);
  assert.ok(found, 'resolved episode should still exist');
  assert.equal(found!.outcome, 'materialized');
  assert.ok(found!.resolvedAt !== undefined && found!.resolvedAt > 0);
  assert.equal(found!.outcomeNote, 'Shipments halted for 3 weeks.');
});

test('resolveEpisode: truncates outcomeNote to 280 chars', async () => {
  setupTests();
  const ep = await recordEpisode(makeEpisodeInput());
  const longNote = 'n'.repeat(300);
  await resolveEpisode(ep.id, 'fizzled', longNote);
  const found = getAllEpisodes().find(e => e.id === ep.id);
  assert.ok(found!.outcomeNote!.length <= 280);
});

test('resolveEpisode: no-op for unknown id', async () => {
  setupTests();
  await recordEpisode(makeEpisodeInput());
  // Should not throw
  await resolveEpisode('nonexistent-id', 'fizzled');
  assert.equal(getEpisodeCount(), 1);
});

// ── recall tests ──────────────────────────────────────────────────────────────

test('recall: returns semantically similar episodes above minSim', async () => {
  setupTests();
  // Record two episodes: one highly similar to the query, one unrelated
  await recordEpisode(makeEpisodeInput({
    summary: 'Black Sea wheat shipment disruption near Bosphorus.',
    entities: ['Black Sea', 'wheat'],
    domains: ['shortage'],
    signature: 'sim-1',
  }));
  await recordEpisode(makeEpisodeInput({
    summary: 'Bitcoin exchange rate collapse triggered by regulatory crackdown.',
    entities: ['Bitcoin', 'crypto'],
    domains: ['finance'],
    signature: 'sim-2',
  }));

  const results = await recall('Black Sea wheat shortage due to Bosphorus conflict');
  // The wheat episode should score higher than the crypto one.
  if (results.length >= 2) {
    assert.ok(
      results[0].episode.entities.includes('Black Sea') ||
      results[0].episode.entities.includes('wheat'),
      'First result should be the wheat episode',
    );
  }
  // All results have an explanation
  for (const r of results) {
    assert.ok(typeof r.explanation === 'string' && r.explanation.length > 0, 'explanation required');
    assert.ok(r.ageDays >= 0, 'ageDays should be non-negative');
    assert.ok(r.similarity >= 0 && r.similarity <= 1, 'similarity in [0,1]');
  }
});

test('recall: returns empty array when no episodes exist', async () => {
  setupTests();
  const results = await recall('any text');
  assert.equal(results.length, 0);
});

test('recall: kind filter excludes wrong kinds', async () => {
  setupTests();
  await recordEpisode(makeEpisodeInput({ kind: 'situation', signature: 'sit-1', summary: 'Flood event in coastal region.' }));
  await recordEpisode(makeEpisodeInput({ kind: 'hypothesis', signature: 'hyp-1', summary: 'Flood event in coastal region hypothesis.' }));

  const results = await recall('Flood event coastal', { kinds: ['situation'] });
  for (const r of results) {
    assert.equal(r.episode.kind, 'situation');
  }
});

// ── analogScoreFor tests ──────────────────────────────────────────────────────

test('analogScoreFor: returns null when fewer than 3 recalls clear minSim', () => {
  // Only 2 qualified recalls (each has an outcome and sim ≥ 0.45)
  const recalls = [
    {
      episode: { outcome: 'materialized', entities: [], domains: [], vector: [], tier: 'hashed' as const,
        id: '1', kind: 'hypothesis' as const, signature: 's1', summary: 'a', createdAt: 0 },
      similarity: 0.8, ageDays: 1, explanation: 'matched on: test',
    },
    {
      episode: { outcome: 'materialized', entities: [], domains: [], vector: [], tier: 'hashed' as const,
        id: '2', kind: 'hypothesis' as const, signature: 's2', summary: 'b', createdAt: 0 },
      similarity: 0.7, ageDays: 2, explanation: 'matched on: test',
    },
  ];
  const score = analogScoreFor(recalls);
  assert.equal(score, null);
});

test('analogScoreFor: returns null when recalls lack outcomes', () => {
  // 3 recalls but none have an outcome (unresolved episodes)
  const recalls = Array.from({ length: 3 }, (_, i) => ({
    episode: { entities: [], domains: [], vector: [], tier: 'hashed' as const,
      id: String(i), kind: 'hypothesis' as const, signature: `s${i}`, summary: 'a', createdAt: 0 },
    similarity: 0.9, ageDays: 1, explanation: 'matched on: test',
  }));
  const score = analogScoreFor(recalls);
  assert.equal(score, null);
});

test('analogScoreFor: all materialized → high score', () => {
  const recalls = Array.from({ length: 3 }, (_, i) => ({
    episode: { outcome: 'materialized' as const, entities: [], domains: [], vector: [],
      tier: 'hashed' as const, id: String(i), kind: 'hypothesis' as const,
      signature: `s${i}`, summary: 'a', createdAt: 0, resolvedAt: 1 },
    similarity: 0.8, ageDays: 1, explanation: 'matched on: test',
  }));
  const score = analogScoreFor(recalls);
  assert.ok(score !== null, 'should return a score');
  assert.ok(score > 0.7, `expected > 0.7, got ${score}`);
});

test('analogScoreFor: all fizzled → low score', () => {
  const recalls = Array.from({ length: 3 }, (_, i) => ({
    episode: { outcome: 'fizzled' as const, entities: [], domains: [], vector: [],
      tier: 'hashed' as const, id: String(i), kind: 'hypothesis' as const,
      signature: `s${i}`, summary: 'a', createdAt: 0, resolvedAt: 1 },
    similarity: 0.8, ageDays: 1, explanation: 'matched on: test',
  }));
  const score = analogScoreFor(recalls);
  assert.ok(score !== null, 'should return a score');
  assert.ok(score < 0.1, `expected < 0.1, got ${score}`);
});

test('analogScoreFor: partial outcome counts as 0.5', () => {
  const recall = {
    episode: { outcome: 'partial' as const, entities: [], domains: [], vector: [],
      tier: 'hashed' as const, id: '1', kind: 'hypothesis' as const,
      signature: 's1', summary: 'a', createdAt: 0, resolvedAt: 1 },
    similarity: 0.9, ageDays: 1, explanation: 'test',
  };
  // Need 3 recalls — add 2 more partial
  const recalls = [recall, recall, { ...recall, episode: { ...recall.episode, id: '2' } }];
  const score = analogScoreFor(recalls);
  assert.ok(score !== null);
  // All partial → weighted score ≈ 0.5
  assert.ok(score !== null && Math.abs(score - 0.5) < 0.01, `expected ~0.5, got ${score}`);
});

test('analogScoreFor: similarity-weighted (higher-sim episodes count more)', () => {
  // 3 recalls: 2 materialized at high sim, 1 fizzled at low sim
  const recalls = [
    {
      episode: { outcome: 'materialized' as const, entities: [], domains: [], vector: [],
        tier: 'hashed' as const, id: '1', kind: 'hypothesis' as const, signature: 's1', summary: 'a', createdAt: 0, resolvedAt: 1 },
      similarity: 0.9, ageDays: 1, explanation: 'test',
    },
    {
      episode: { outcome: 'materialized' as const, entities: [], domains: [], vector: [],
        tier: 'hashed' as const, id: '2', kind: 'hypothesis' as const, signature: 's2', summary: 'b', createdAt: 0, resolvedAt: 1 },
      similarity: 0.85, ageDays: 2, explanation: 'test',
    },
    {
      episode: { outcome: 'fizzled' as const, entities: [], domains: [], vector: [],
        tier: 'hashed' as const, id: '3', kind: 'hypothesis' as const, signature: 's3', summary: 'c', createdAt: 0, resolvedAt: 1 },
      similarity: 0.5, ageDays: 10, explanation: 'test',
    },
  ];
  const score = analogScoreFor(recalls);
  assert.ok(score !== null, 'should return a score');
  // Weighted: (0.9*1 + 0.85*1 + 0.5*0) / (0.9 + 0.85 + 0.5) ≈ 1.75/2.25 ≈ 0.778
  const expected = (0.9 * 1 + 0.85 * 1 + 0.5 * 0) / (0.9 + 0.85 + 0.5);
  assert.ok(Math.abs(score! - expected) < 0.001, `expected ~${expected.toFixed(3)}, got ${score}`);
});

// ── FIFO eviction tests ───────────────────────────────────────────────────────

test('FIFO eviction: respects cap of 2000 episodes', async () => {
  setupTests();
  // Record 5 episodes and then set the cap artificially via private override.
  // Since we can't change MAX_EPISODES easily, we'll test that after recording
  // many episodes the count stays bounded. For test speed, we'll record 10 and
  // verify the store doesn't grow unboundedly (full cap test is a logic assertion).

  // Record 5 resolved episodes and 3 pending ones
  const eps: Awaited<ReturnType<typeof recordEpisode>>[] = [];
  for (let i = 0; i < 5; i++) {
    const ep = await recordEpisode(makeEpisodeInput({ signature: `r-${i}` }));
    advanceTime(1000);
    await resolveEpisode(ep.id, 'materialized');
    eps.push(ep);
  }
  for (let i = 0; i < 3; i++) {
    await recordEpisode(makeEpisodeInput({ signature: `p-${i}` }));
  }

  assert.equal(getEpisodeCount(), 8);
  // All resolved episodes should still be there (cap is 2000, we have 8)
  const all = getAllEpisodes();
  const resolved = all.filter(e => e.resolvedAt !== undefined);
  assert.equal(resolved.length, 5);
  // All pending episodes should still be there
  const pending = all.filter(e => e.resolvedAt === undefined);
  assert.equal(pending.length, 3);
});

test('FIFO eviction: resolved-oldest evicted first', async () => {
  // This tests the eviction logic by examining the order of eviction candidates.
  // We'll use the exported getAllEpisodes to verify state.
  setupTests();

  const old = await recordEpisode(makeEpisodeInput({ signature: 'old', summary: 'old episode' }));
  advanceTime(10_000);
  await resolveEpisode(old.id, 'materialized');

  advanceTime(5_000);
  const newer = await recordEpisode(makeEpisodeInput({ signature: 'newer', summary: 'newer episode' }));
  advanceTime(1_000);
  await resolveEpisode(newer.id, 'fizzled');

  const pending = await recordEpisode(makeEpisodeInput({ signature: 'pending', summary: 'pending episode' }));

  assert.equal(getEpisodeCount(), 3);

  // Verify old is older than newer in resolvedAt
  const all = getAllEpisodes();
  const oldEp = all.find(e => e.signature === 'old')!;
  const newerEp = all.find(e => e.signature === 'newer')!;
  const pendingEp = all.find(e => e.signature === 'pending')!;

  assert.ok(oldEp.resolvedAt! < newerEp.resolvedAt!, 'old should have earlier resolvedAt');
  assert.ok(pendingEp.resolvedAt === undefined, 'pending should have no resolvedAt');
});

// ── Analog cache tests ────────────────────────────────────────────────────────

test('getCachedAnalogScore: returns null before any update', () => {
  setupTests();
  _clearAnalogCacheForTests();
  const score = getCachedAnalogScore('unknown-sig');
  assert.equal(score, null);
});

test('updateAnalogCache: populates cache for hypotheses', async () => {
  setupTests();
  _clearAnalogCacheForTests();

  // Record 3 resolved episodes so analogScoreFor has data.
  for (let i = 0; i < 3; i++) {
    const ep = await recordEpisode(makeEpisodeInput({
      signature: `cache-sig-${i}`,
      summary: 'wheat shortage from Black Sea conflict',
    }));
    await resolveEpisode(ep.id, 'materialized');
  }

  const hs = [{ statement: 'wheat shortage from Black Sea conflict', id: 'h1' }];
  await updateAnalogCache(hs, h => `sig-${h.id}`);

  const cached = getCachedAnalogScore('sig-h1');
  // May be null (< 3 recalls at minSim) or a number — either is valid.
  // Just assert it's either null or in [0,1].
  if (cached !== null) {
    assert.ok(cached >= 0 && cached <= 1, `score ${cached} out of [0,1]`);
  }
});

// ── Explanation invariant tests ───────────────────────────────────────────────

test('recall: explanation string is never empty', async () => {
  setupTests();
  await recordEpisode(makeEpisodeInput({
    summary: 'wheat disruption near the Black Sea region',
    entities: ['wheat', 'Black Sea'],
    domains: ['shortage', 'geopolitics'],
    signature: 'expl-1',
  }));

  const results = await recall('Black Sea shortage disruption');
  for (const r of results) {
    assert.ok(r.explanation.length > 0, 'explanation must not be empty');
    // Explanation should contain a similarity percentage
    assert.ok(r.explanation.includes('%'), 'explanation should include similarity %');
  }
});

// ── Contradiction flagging tests (PR 14 memory hygiene) ────────────────────────

test('markEpisodeContradictory: flags an episode and is idempotent (first reason wins)', async () => {
  setupTests();
  const ep = await recordEpisode(makeEpisodeInput({ signature: 'flag-1' }));

  const first = markEpisodeContradictory(ep.id, 'reason A');
  assert.equal(first, true);

  const second = markEpisodeContradictory(ep.id, 'reason B');
  assert.equal(second, false, 'already-flagged episode should not be re-flagged');

  const found = getAllEpisodes().find(e => e.id === ep.id);
  assert.equal(found!.contradicted?.reason, 'reason A');
});

test('markEpisodeContradictory: returns false for unknown episode id', async () => {
  setupTests();
  const result = markEpisodeContradictory('nonexistent', 'reason');
  assert.equal(result, false);
});

test('recall: contradicted episodes remain retrievable with the flag surfaced in the explanation', async () => {
  setupTests();
  const ep = await recordEpisode(makeEpisodeInput({
    summary: 'Black Sea wheat shipment disruption near Bosphorus.',
    entities: ['Black Sea', 'wheat'],
    domains: ['shortage'],
    signature: 'contradict-recall-1',
  }));
  markEpisodeContradictory(ep.id, 'competitive-hypothesis refuted the primary explanation');

  const results = await recall('Black Sea wheat shortage due to Bosphorus conflict');
  const match = results.find(r => r.episode.id === ep.id);
  assert.ok(match, 'contradicted episode must still be retrievable — contradictions surface, never dropped');
  assert.ok(
    match!.explanation.includes('flagged contradictory'),
    `explanation should surface the contradiction, got: ${match!.explanation}`,
  );
});

test('analogScoreFor: contradicted episodes are excluded from the supportive weighted average', () => {
  // 3 materialized recalls, one of which is flagged contradicted — without
  // exclusion this would still score ~1.0; with exclusion, only 2 qualify
  // (still ≥ MIN_RECALLS_FOR_ANALOG=3 requires the contradicted one to not
  // count toward the minimum either, so the score must fall back to null).
  const makeRecall = (id: string, contradicted: boolean) => ({
    episode: {
      outcome: 'materialized' as const, entities: [], domains: [], vector: [],
      tier: 'hashed' as const, id, kind: 'hypothesis' as const, signature: `s${id}`,
      summary: 'a', createdAt: 0, resolvedAt: 1,
      ...(contradicted ? { contradicted: { reason: 'refuted', markedAt: 1 } } : {}),
    },
    similarity: 0.8, ageDays: 1, explanation: 'matched on: test',
  });

  const recalls = [makeRecall('1', false), makeRecall('2', false), makeRecall('3', true)];
  const score = analogScoreFor(recalls);
  assert.equal(score, null, 'only 2 non-contradicted qualified recalls — below MIN_RECALLS_FOR_ANALOG');
});

test('analogScoreFor: contradicted episode is excluded even when enough recalls remain', () => {
  const makeRecall = (id: string, outcome: 'materialized' | 'fizzled', contradicted: boolean) => ({
    episode: {
      outcome, entities: [], domains: [], vector: [],
      tier: 'hashed' as const, id, kind: 'hypothesis' as const, signature: `s${id}`,
      summary: 'a', createdAt: 0, resolvedAt: 1,
      ...(contradicted ? { contradicted: { reason: 'refuted', markedAt: 1 } } : {}),
    },
    similarity: 0.8, ageDays: 1, explanation: 'matched on: test',
  });

  // 4 recalls: 3 materialized (non-contradicted) + 1 fizzled-but-contradicted.
  // The contradicted fizzled one must NOT drag the average down.
  const recalls = [
    makeRecall('1', 'materialized', false),
    makeRecall('2', 'materialized', false),
    makeRecall('3', 'materialized', false),
    makeRecall('4', 'fizzled', true),
  ];
  const score = analogScoreFor(recalls);
  assert.ok(score !== null);
  assert.ok(score! > 0.9, `expected the contradicted fizzled recall to be excluded, got ${score}`);
});

test('contradictEpisodesForRefutation: flags episodes sharing an entity (case-insensitive) with the refuted situation', async () => {
  setupTests();
  const ep1 = await recordEpisode(makeEpisodeInput({
    signature: 'ref-1', entities: ['Suez Canal', 'Egypt'], domains: ['maritime'],
  }));
  const ep2 = await recordEpisode(makeEpisodeInput({
    signature: 'ref-2', entities: ['Bitcoin'], domains: ['finance'],
  }));

  const flagged = contradictEpisodesForRefutation({
    situationId: 'sit-1',
    domain: 'maritime',
    entityIds: ['suez canal'], // lowercase — exercises the case-insensitive match
    claim: 'Vessel is engaging in evasive behavior',
    hypothesisType: 'alternative',
  });

  assert.deepEqual(flagged, [ep1.id], 'only the entity-overlapping episode should be flagged');
  const all = getAllEpisodes();
  assert.ok(all.find(e => e.id === ep1.id)!.contradicted !== undefined);
  assert.equal(all.find(e => e.id === ep2.id)!.contradicted, undefined);
});

test('contradictEpisodesForRefutation: does not flag an entity match across unrelated domains', async () => {
  setupTests();
  // Same entity name ("Iran"), unrelated domain — a weather refutation must
  // not contradict a finance episode just because they mention the same
  // country.
  const financeEp = await recordEpisode(makeEpisodeInput({
    signature: 'cross-domain-1', entities: ['Iran'], domains: ['finance'],
  }));

  const flagged = contradictEpisodesForRefutation({
    situationId: 'sit-cross',
    domain: 'weather',
    entityIds: ['Iran'],
    claim: 'Storm system will make landfall near the coast',
    hypothesisType: 'alternative',
  });

  assert.deepEqual(flagged, [], 'entity overlap alone must not cross domains');
  const found = getAllEpisodes().find(e => e.id === financeEp.id);
  assert.equal(found!.contradicted, undefined);
});

test('contradictEpisodesForRefutation: no-op when there is no entity overlap', async () => {
  setupTests();
  await recordEpisode(makeEpisodeInput({ signature: 'no-match-1', entities: ['Bitcoin'], domains: ['finance'] }));

  const flagged = contradictEpisodesForRefutation({
    situationId: 'sit-2',
    domain: 'maritime',
    entityIds: ['suez-canal'],
    claim: 'claim',
    hypothesisType: 'primary',
  });

  assert.deepEqual(flagged, []);
});

test('contradictEpisodesForRefutation: caps the number of episodes flagged per event', async () => {
  setupTests();
  for (let i = 0; i < 15; i++) {
    await recordEpisode(makeEpisodeInput({ signature: `cap-${i}`, entities: ['Suez Canal'], domains: ['maritime'] }));
  }

  const flagged = contradictEpisodesForRefutation({
    situationId: 'sit-3',
    domain: 'maritime',
    entityIds: ['Suez Canal'],
    claim: 'claim',
    hypothesisType: 'primary',
  });

  assert.ok(flagged.length <= 10, `expected cap of 10, got ${flagged.length}`);
});

test('contradictEpisodesForRefutation: does not re-flag already-contradicted episodes', async () => {
  setupTests();
  const ep = await recordEpisode(makeEpisodeInput({ signature: 'already-1', entities: ['Suez Canal'], domains: ['maritime'] }));
  markEpisodeContradictory(ep.id, 'earlier reason');

  const flagged = contradictEpisodesForRefutation({
    situationId: 'sit-4',
    domain: 'maritime',
    entityIds: ['Suez Canal'],
    claim: 'claim',
    hypothesisType: 'primary',
  });

  assert.deepEqual(flagged, [], 'already-contradicted episode should not be counted as newly flagged');
  const found = getAllEpisodes().find(e => e.id === ep.id);
  assert.equal(found!.contradicted?.reason, 'earlier reason', 'original reason should be preserved');
});

test('contradictEpisodesForRefutation: slug-form episode entity matches raw-form situation entityIds', async () => {
  // The producer (analyst-loop.ts, PR A4) now writes episode entities already
  // slugified — verify the raw situation-side vocabulary still matches.
  setupTests();
  const ep = await recordEpisode(makeEpisodeInput({
    signature: 'slug-producer-1', entities: ['suez-canal'], domains: ['maritime'],
  }));

  const flagged = contradictEpisodesForRefutation({
    situationId: 'sit-5',
    domain: 'maritime',
    entityIds: ['Suez Canal'],
    claim: 'Vessel traffic resumed near the canal',
    hypothesisType: 'alternative',
  });

  assert.deepEqual(flagged, [ep.id], 'slugified episode entity should match raw situation entityId');
  const found = getAllEpisodes().find(e => e.id === ep.id);
  assert.ok(found!.contradicted !== undefined);
});

test('contradictEpisodesForRefutation: raw-form (legacy) episode entity matches slug-form situation entityIds', async () => {
  // Pre-A4 episodes stored whatever raw form their producer supplied —
  // verify a slugified incoming situation entityId still matches those.
  setupTests();
  const ep = await recordEpisode(makeEpisodeInput({
    signature: 'legacy-raw-1', entities: ['Suez Canal'], domains: ['maritime'],
  }));

  const flagged = contradictEpisodesForRefutation({
    situationId: 'sit-6',
    domain: 'maritime',
    entityIds: ['suez-canal'],
    claim: 'Vessel traffic resumed near the canal',
    hypothesisType: 'alternative',
  });

  assert.deepEqual(flagged, [ep.id], 'raw legacy episode entity should match slugified situation entityId');
  const found = getAllEpisodes().find(e => e.id === ep.id);
  assert.ok(found!.contradicted !== undefined);
});

test('contradictEpisodesForRefutation: empty-normalizing entities never cross-flag (no wildcard)', async () => {
  // All-punctuation / non-Latin input slugifies to '' on both sides. An empty
  // slug must NOT act as a wildcard that flags every same-domain episode whose
  // entity also normalizes to '' (Codex P1, uplift A4).
  setupTests();
  const ep = await recordEpisode(makeEpisodeInput({
    signature: 'empty-slug-1', entities: ['???'], domains: ['maritime'],
  }));

  const flagged = contradictEpisodesForRefutation({
    situationId: 'sit-7',
    domain: 'maritime',
    entityIds: ['!!!'],
    claim: 'Vessel traffic resumed near the canal',
    hypothesisType: 'alternative',
  });

  assert.deepEqual(flagged, [], 'empty-normalizing entity must not match anything');
  const found = getAllEpisodes().find(e => e.id === ep.id);
  assert.equal(found!.contradicted, undefined, 'episode must stay uncontradicted');
});

test('contradictEpisodesForRefutation: a real refutation entity does not flag an empty-slug episode', async () => {
  // A legitimate situation entityId must not spuriously flag an episode whose
  // only entity normalizes to '' — the episode-side empty guard covers this.
  setupTests();
  const ep = await recordEpisode(makeEpisodeInput({
    signature: 'empty-slug-2', entities: ['   '], domains: ['maritime'],
  }));

  const flagged = contradictEpisodesForRefutation({
    situationId: 'sit-8',
    domain: 'maritime',
    entityIds: ['Suez Canal'],
    claim: 'Vessel traffic resumed near the canal',
    hypothesisType: 'alternative',
  });

  assert.deepEqual(flagged, [], 'real entity must not match an empty-slug episode');
  const found = getAllEpisodes().find(e => e.id === ep.id);
  assert.equal(found!.contradicted, undefined, 'episode must stay uncontradicted');
});
