/**
 * Tests for SourceCredibilityTrackerService — per-source accuracy
 * tracking with tier classification and downstream weighting.
 *
 * The service is built with injectable storage + clock so the tests
 * never touch real localStorage or Date.now.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FEEDBACK_STORAGE_KEY,
  MAX_FEEDBACK,
  SOURCES_STORAGE_KEY,
  SourceCredibilityTrackerService,
  __internals,
  __resetSourceCredibilityTrackerServiceSingleton,
  classifyTier,
  getSourceCredibilityTrackerService,
  type CredibilityFeedback,
  type StorageLike,
} from '../../src/services/intelligence/source-credibility-tracker.ts';

// ── Fakes ─────────────────────────────────────────────────────────────

function makeFakeStorage(seed: Record<string, string> = {}): StorageLike & {
  raw: Map<string, string>;
} {
  const raw = new Map<string, string>(Object.entries(seed));
  return {
    raw,
    getItem(key: string): string | null { return raw.get(key) ?? null; },
    setItem(key: string, value: string): void { raw.set(key, value); },
    removeItem(key: string): void { raw.delete(key); },
  };
}

function fixedClock(t: number): () => number { return () => t; }
function tickingClock(start: number, step = 1): () => number {
  let t = start;
  return () => { t += step; return t; };
}

const NOW = 1_745_000_000_000;

function recordN(svc: SourceCredibilityTrackerService, sourceId: string, domain: string,
                 confirmed: number, refuted: number, neutral = 0): void {
  for (let i = 0; i < confirmed; i += 1) {
    svc.recordFeedback({ sourceId, domain, reportId: `c-${i}`, outcome: 'confirmed' });
  }
  for (let i = 0; i < refuted; i += 1) {
    svc.recordFeedback({ sourceId, domain, reportId: `r-${i}`, outcome: 'refuted' });
  }
  for (let i = 0; i < neutral; i += 1) {
    svc.recordFeedback({ sourceId, domain, reportId: `n-${i}`, outcome: 'neutral' });
  }
}

// ── Tier classification ──────────────────────────────────────────────

test('classifyTier returns tier-1 for score >= 0.8 with enough samples', () => {
  assert.equal(classifyTier(0.85, 12), 'tier-1');
  assert.equal(classifyTier(0.8, 12), 'tier-1');
});

test('classifyTier returns tier-2 for score in [0.6, 0.8)', () => {
  assert.equal(classifyTier(0.79, 12), 'tier-2');
  assert.equal(classifyTier(0.6, 12), 'tier-2');
});

test('classifyTier returns tier-3 for score in [0.4, 0.6)', () => {
  assert.equal(classifyTier(0.59, 12), 'tier-3');
  assert.equal(classifyTier(0.4, 12), 'tier-3');
});

test('classifyTier returns tier-3 for very low scores (floor tier)', () => {
  assert.equal(classifyTier(0.1, 12), 'tier-3');
});

test('classifyTier returns unrated when samples below RATED_MIN_REPORTS', () => {
  assert.equal(classifyTier(0.95, 9), 'unrated');
  assert.equal(classifyTier(0, 0), 'unrated');
});

// ── computeScore ─────────────────────────────────────────────────────

test('computeScore is confirms / (confirms + refutes)', () => {
  assert.equal(__internals.computeScore(7, 3), 0.7);
  assert.equal(__internals.computeScore(0, 0), 0);
  assert.equal(__internals.computeScore(1, 0), 1);
});

// ── Seeding ──────────────────────────────────────────────────────────

test('10 known sources are seeded at init with tier-2 + score 0.7', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  const all = svc.getAllSources();
  assert.equal(all.length, 10);
  for (const s of all) {
    assert.equal(s.credibilityScore, 0.7);
    assert.equal(s.tier, 'tier-2');
    assert.equal(s.confirmCount, 7);
    assert.equal(s.refuteCount, 3);
    assert.equal(s.totalReports, 10);
  }
});

test('seeding is idempotent — repeated hydration does not double counts', () => {
  const storage = makeFakeStorage();
  const svc1 = new SourceCredibilityTrackerService({ storage, clock: () => NOW });
  const seed = svc1.getSource('usgs-earthquake')!;
  const svc2 = new SourceCredibilityTrackerService({ storage, clock: () => NOW });
  const restored = svc2.getSource('usgs-earthquake')!;
  assert.equal(restored.totalReports, seed.totalReports);
  assert.equal(restored.credibilityScore, seed.credibilityScore);
});

// ── recordFeedback ───────────────────────────────────────────────────

test('recordFeedback confirmed increments confirmCount + totalReports', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  const before = svc.getSource('usgs-earthquake')!;
  svc.recordFeedback({ sourceId: 'usgs-earthquake', domain: 'earthquake', reportId: 'r-1', outcome: 'confirmed' });
  const after = svc.getSource('usgs-earthquake')!;
  assert.equal(after.confirmCount, before.confirmCount + 1);
  assert.equal(after.totalReports, before.totalReports + 1);
});

test('recordFeedback refuted increments refuteCount + totalReports', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  const before = svc.getSource('usgs-earthquake')!;
  svc.recordFeedback({ sourceId: 'usgs-earthquake', domain: 'earthquake', reportId: 'r-1', outcome: 'refuted' });
  const after = svc.getSource('usgs-earthquake')!;
  assert.equal(after.refuteCount, before.refuteCount + 1);
  assert.equal(after.totalReports, before.totalReports + 1);
});

test('recordFeedback neutral increments neutralCount but does not move the score', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  const before = svc.getSource('usgs-earthquake')!;
  svc.recordFeedback({ sourceId: 'usgs-earthquake', domain: 'earthquake', reportId: 'r-1', outcome: 'neutral' });
  const after = svc.getSource('usgs-earthquake')!;
  assert.equal(after.neutralCount, before.neutralCount + 1);
  assert.equal(after.credibilityScore, before.credibilityScore);
});

test('recordFeedback on a new source creates the source record', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  assert.equal(svc.getSource('new-source'), null);
  svc.recordFeedback({ sourceId: 'new-source', domain: 'd', reportId: 'r', outcome: 'confirmed' });
  const created = svc.getSource('new-source')!;
  assert.equal(created.confirmCount, 1);
  assert.equal(created.totalReports, 1);
  assert.equal(created.tier, 'unrated');
});

test('recordFeedback promotes a new source through tiers as samples accumulate', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  // First 9 confirmed → still unrated
  for (let i = 0; i < 9; i += 1) {
    svc.recordFeedback({ sourceId: 'climb', domain: 'd', reportId: `c-${i}`, outcome: 'confirmed' });
  }
  assert.equal(svc.getSource('climb')!.tier, 'unrated');
  // 10th confirmed → tier-1 (score 1.0)
  svc.recordFeedback({ sourceId: 'climb', domain: 'd', reportId: 'c-9', outcome: 'confirmed' });
  assert.equal(svc.getSource('climb')!.tier, 'tier-1');
});

test('recordFeedback returns a defensive copy with id + timestamp', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const event = svc.recordFeedback({
    sourceId: 'new-src', domain: 'd', reportId: 'r-1', outcome: 'confirmed',
  });
  assert.ok(event.id.startsWith('cred-'));
  assert.ok(event.recordedAt > NOW);
});

test('recordFeedback updates lastSeenAt on the source', () => {
  const clock = tickingClock(NOW, 1000);
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock });
  const before = svc.getSource('usgs-earthquake')!;
  svc.recordFeedback({ sourceId: 'usgs-earthquake', domain: 'earthquake', reportId: 'r-1', outcome: 'confirmed' });
  const after = svc.getSource('usgs-earthquake')!;
  assert.ok(after.lastSeenAt > before.lastSeenAt);
});

// ── getWeight ────────────────────────────────────────────────────────

test('getWeight returns 0.5 for unrated sources', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  svc.recordFeedback({ sourceId: 'unrated-src', domain: 'd', reportId: 'r', outcome: 'confirmed' });
  assert.equal(svc.getWeight('unrated-src'), 0.5);
});

test('getWeight returns the credibilityScore for rated sources', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  // Seeded usgs-earthquake = tier-2, score 0.7.
  assert.equal(svc.getWeight('usgs-earthquake'), 0.7);
});

test('getWeight returns 0.5 for unknown source ids', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  assert.equal(svc.getWeight('ghost'), 0.5);
});

test('getWeight matches credibility for a freshly-promoted tier-1', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  recordN(svc, 'climber', 'd', 10, 0);
  assert.equal(svc.getWeight('climber'), 1);
});

// ── Reads ─────────────────────────────────────────────────────────────

test('getAllSources sorted by credibilityScore descending', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  recordN(svc, 'best', 'd', 10, 0);   // score 1.0
  recordN(svc, 'worst', 'd', 1, 9);   // score 0.1
  const all = svc.getAllSources();
  assert.ok(all[0]!.credibilityScore >= all[1]!.credibilityScore);
});

test('getAllSources filters by domain', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  const earthquakes = svc.getAllSources({ domain: 'earthquake' });
  assert.ok(earthquakes.every((s) => s.domain === 'earthquake'));
});

test('getAllSources filters by tier', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  recordN(svc, 'tier1-src', 'd', 10, 0);
  const tier1 = svc.getAllSources({ tier: 'tier-1' });
  assert.ok(tier1.every((s) => s.tier === 'tier-1'));
  assert.ok(tier1.some((s) => s.sourceId === 'tier1-src'));
});

test('getAllSources returns defensive copies', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  const all = svc.getAllSources();
  all[0]!.credibilityScore = 0.01;
  const fresh = svc.getAllSources();
  assert.notEqual(fresh[0]!.credibilityScore, 0.01);
});

// ── getSummary ───────────────────────────────────────────────────────

test('getSummary tallies tiers and computes avgScore', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  const s = svc.getSummary();
  assert.equal(s.totalSources, 10);
  assert.equal(s.byTier['tier-2'], 10);
  assert.ok(Math.abs(s.avgScore - 0.7) < 1e-6);
});

test('getSummary topSources contains the highest-scoring eligible source', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  recordN(svc, 'tip-top', 'd', 10, 0);
  const s = svc.getSummary();
  assert.equal(s.topSources[0]!.sourceId, 'tip-top');
});

test('getSummary worstSources contains the lowest-scoring eligible source', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  recordN(svc, 'bottom', 'd', 0, 10);
  const s = svc.getSummary();
  assert.equal(s.worstSources[0]!.sourceId, 'bottom');
});

test('getSummary excludes sources with fewer than 5 samples from top/worst', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  recordN(svc, 'tiny', 'd', 4, 0); // 4 samples — below SUMMARY_BUCKET_MIN_REPORTS
  const s = svc.getSummary();
  assert.equal(s.topSources.some((x) => x.sourceId === 'tiny'), false);
  assert.equal(s.worstSources.some((x) => x.sourceId === 'tiny'), false);
});

test('getSummary caps top and worst at SUMMARY_BUCKET_SIZE (5)', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  // Seeded already has 10 sources; ensure top/worst are capped.
  const s = svc.getSummary();
  assert.ok(s.topSources.length <= 5);
  assert.ok(s.worstSources.length <= 5);
});

// ── getFeedback ──────────────────────────────────────────────────────

test('getFeedback is newest-first across all sources', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.recordFeedback({ sourceId: 'a', domain: 'd', reportId: 'r1', outcome: 'confirmed' });
  svc.recordFeedback({ sourceId: 'b', domain: 'd', reportId: 'r2', outcome: 'refuted' });
  const fb = svc.getFeedback();
  assert.equal(fb[0]!.sourceId, 'b');
  assert.equal(fb[1]!.sourceId, 'a');
});

test('getFeedback filters by sourceId', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.recordFeedback({ sourceId: 'a', domain: 'd', reportId: 'r1', outcome: 'confirmed' });
  svc.recordFeedback({ sourceId: 'b', domain: 'd', reportId: 'r2', outcome: 'refuted' });
  const onlyA = svc.getFeedback('a');
  assert.ok(onlyA.every((f) => f.sourceId === 'a'));
});

test('getFeedback honors limit', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  for (let i = 0; i < 10; i += 1) {
    svc.recordFeedback({ sourceId: 'a', domain: 'd', reportId: `r${i}`, outcome: 'confirmed' });
  }
  assert.equal(svc.getFeedback(undefined, 3).length, 3);
});

// ── Ring buffer ──────────────────────────────────────────────────────

test('feedback ring buffer evicts oldest past MAX_FEEDBACK', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const total = MAX_FEEDBACK + 5;
  for (let i = 0; i < total; i += 1) {
    svc.recordFeedback({ sourceId: 'a', domain: 'd', reportId: `r${i}`, outcome: 'confirmed' });
  }
  assert.equal(svc.getFeedback().length, MAX_FEEDBACK);
});

// ── Subscribe ─────────────────────────────────────────────────────────

test('subscribe receives both the feedback event and the updated source', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  const seen: CredibilityFeedback[] = [];
  let snapshotScore = -1;
  const off = svc.subscribe((event, source) => { seen.push(event); snapshotScore = source.credibilityScore; });
  svc.recordFeedback({ sourceId: 'usgs-earthquake', domain: 'earthquake', reportId: 'r-1', outcome: 'confirmed' });
  off();
  assert.equal(seen.length, 1);
  assert.ok(snapshotScore > 0);
});

test('listener that throws does not stop other listeners', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  let good = 0;
  svc.subscribe(() => { throw new Error('bad'); });
  svc.subscribe(() => { good += 1; });
  svc.recordFeedback({ sourceId: 'usgs-earthquake', domain: 'earthquake', reportId: 'r-1', outcome: 'confirmed' });
  assert.equal(good, 1);
});

test('unsubscribe stops further notifications', () => {
  const svc = new SourceCredibilityTrackerService({ storage: makeFakeStorage(), clock: () => NOW });
  let count = 0;
  const cb = (): void => { count += 1; };
  svc.subscribe(cb);
  svc.unsubscribe(cb);
  svc.recordFeedback({ sourceId: 'usgs-earthquake', domain: 'earthquake', reportId: 'r-1', outcome: 'confirmed' });
  assert.equal(count, 0);
});

// ── Persistence ───────────────────────────────────────────────────────

test('sources survive a fresh service instance', () => {
  const storage = makeFakeStorage();
  const svc1 = new SourceCredibilityTrackerService({ storage, clock: () => NOW });
  recordN(svc1, 'custom', 'd', 6, 4);
  const svc2 = new SourceCredibilityTrackerService({ storage, clock: () => NOW });
  const restored = svc2.getSource('custom')!;
  assert.equal(restored.confirmCount, 6);
  assert.equal(restored.refuteCount, 4);
});

test('feedback survives a fresh service instance', () => {
  const storage = makeFakeStorage();
  const svc1 = new SourceCredibilityTrackerService({ storage, clock: () => NOW });
  svc1.recordFeedback({ sourceId: 'usgs-earthquake', domain: 'earthquake', reportId: 'r-1', outcome: 'confirmed' });
  const svc2 = new SourceCredibilityTrackerService({ storage, clock: () => NOW });
  assert.ok(svc2.getFeedback().length >= 1);
});

test('corrupt sources blob is ignored but seeds still apply', () => {
  const storage = makeFakeStorage({ [SOURCES_STORAGE_KEY]: 'not-json' });
  const svc = new SourceCredibilityTrackerService({ storage, clock: () => NOW });
  assert.equal(svc.getAllSources().length, 10, 'seeded sources should still be present');
});

test('corrupt feedback blob is ignored', () => {
  const storage = makeFakeStorage({ [FEEDBACK_STORAGE_KEY]: 'not-json' });
  const svc = new SourceCredibilityTrackerService({ storage, clock: () => NOW });
  assert.equal(svc.getFeedback().length, 0);
});

test('null storage works (no-op persistence)', () => {
  const svc = new SourceCredibilityTrackerService({ storage: null, clock: () => NOW });
  svc.recordFeedback({ sourceId: 'usgs-earthquake', domain: 'earthquake', reportId: 'r-1', outcome: 'confirmed' });
  assert.equal(svc.getSource('usgs-earthquake')!.totalReports, 11);
});

test('resetForTesting clears state + persisted blobs and re-seeds', () => {
  const storage = makeFakeStorage();
  const svc = new SourceCredibilityTrackerService({ storage, clock: () => NOW });
  svc.recordFeedback({ sourceId: 'custom', domain: 'd', reportId: 'r-1', outcome: 'confirmed' });
  svc.resetForTesting();
  assert.equal(svc.getFeedback().length, 0);
  assert.equal(svc.getSource('custom'), null);
  // Seeded sources still present.
  assert.equal(svc.getAllSources().length, 10);
});

// ── Singleton ─────────────────────────────────────────────────────────

test('getSourceCredibilityTrackerService returns a stable singleton', () => {
  __resetSourceCredibilityTrackerServiceSingleton();
  const a = getSourceCredibilityTrackerService();
  const b = getSourceCredibilityTrackerService();
  assert.equal(a, b);
  __resetSourceCredibilityTrackerServiceSingleton();
});

test('singleton reset returns a fresh instance', () => {
  const a = getSourceCredibilityTrackerService();
  __resetSourceCredibilityTrackerServiceSingleton();
  const b = getSourceCredibilityTrackerService();
  assert.notEqual(a, b);
  __resetSourceCredibilityTrackerServiceSingleton();
});
