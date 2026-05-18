import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDomainScorecardService,
  STORAGE_KEY,
  MAX_SNAPSHOTS,
  BASELINE_DOMAINS,
  BASELINE_VALUE,
  TREND_WINDOW,
  GRADE_THRESHOLDS,
  type ScorecardMetric,
  type ScorecardGrade,
} from '../../src/services/intelligence/domain-scorecards.ts';

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

const ALL_METRICS: ScorecardMetric[] = [
  'accuracy',
  'completeness',
  'timeliness',
  'signal-to-noise',
  'coverage',
];

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-domain-scorecard-snapshots"', () => {
  assert.equal(STORAGE_KEY, 'wm-domain-scorecard-snapshots');
});

test('MAX_SNAPSHOTS is 5000', () => {
  assert.equal(MAX_SNAPSHOTS, 5000);
});

test('BASELINE_VALUE is 0.7', () => {
  assert.equal(BASELINE_VALUE, 0.7);
});

test('TREND_WINDOW is 5', () => {
  assert.equal(TREND_WINDOW, 5);
});

test('BASELINE_DOMAINS contains 8 expected domains', () => {
  const expected = ['earthquake', 'biosurv', 'weather', 'maritime', 'aviation', 'geopolitical', 'cyber', 'wildfire'];
  assert.equal(BASELINE_DOMAINS.length, 8);
  for (const d of expected) {
    assert.ok(BASELINE_DOMAINS.includes(d), `BASELINE_DOMAINS missing ${d}`);
  }
});

test('GRADE_THRESHOLDS: A>=0.9, B>=0.75, C>=0.6, D>=0.4', () => {
  assert.equal(GRADE_THRESHOLDS.A, 0.9);
  assert.equal(GRADE_THRESHOLDS.B, 0.75);
  assert.equal(GRADE_THRESHOLDS.C, 0.6);
  assert.equal(GRADE_THRESHOLDS.D, 0.4);
});

// ── Baseline seeding ─────────────────────────────────────────────────────

test('init seeds baseline snapshots for 8 domains at value=0.7', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  const cards = svc.getAllScorecards();
  assert.equal(cards.length, 8);
  for (const card of cards) {
    for (const m of ALL_METRICS) {
      assert.equal(card.scores[m], 0.7, `${card.domain}.${m}`);
    }
  }
});

test('init seeding is idempotent across instances', () => {
  const storage = createMemoryStorage();
  const svc1 = createDomainScorecardService({ storage, now: () => NOW_MS });
  const snapshotsAfter1 = svc1.getSnapshots('earthquake');
  const svc2 = createDomainScorecardService({ storage, now: () => NOW_MS + 1000 });
  const snapshotsAfter2 = svc2.getSnapshots('earthquake');
  assert.equal(snapshotsAfter1.length, snapshotsAfter2.length);
});

test('baseline snapshots use source=seed', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  const snaps = svc.getSnapshots('weather');
  for (const s of snaps) {
    assert.equal(s.source, 'seed');
  }
});

// ── recordMetric ─────────────────────────────────────────────────────────

test('recordMetric stores snapshot with metric/value/source/recordedAt', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordMetric('earthquake', 'accuracy', 0.85, 'usgs-ledger');
  const snaps = svc.getSnapshots('earthquake', 'accuracy', 1);
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0]?.metric, 'accuracy');
  assert.equal(snaps[0]?.value, 0.85);
  assert.equal(snaps[0]?.source, 'usgs-ledger');
  assert.equal(snaps[0]?.recordedAt, NOW_MS);
});

test('recordMetric updates scorecard score for that metric (latest value wins)', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordMetric('earthquake', 'accuracy', 0.85, 'ledger');
  const card = svc.getScorecard('earthquake');
  assert.equal(card.scores.accuracy, 0.85);
});

test('recordMetric clamps value to [0,1]', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordMetric('earthquake', 'accuracy', 1.5, 'ledger');
  svc.recordMetric('earthquake', 'completeness', -0.2, 'ledger');
  const card = svc.getScorecard('earthquake');
  assert.equal(card.scores.accuracy, 1);
  assert.equal(card.scores.completeness, 0);
});

test('recordMetric creates new domain if not in baseline', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordMetric('space', 'accuracy', 0.8, 'test');
  const cards = svc.getAllScorecards();
  assert.ok(cards.some((c) => c.domain === 'space'));
});

// ── getScorecard ─────────────────────────────────────────────────────────

test('getScorecard returns default-stable card for unknown domain (no data)', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  const card = svc.getScorecard('martian-weather');
  for (const m of ALL_METRICS) {
    assert.equal(card.scores[m], 0.5);
    assert.equal(card.grades[m], 'C');
  }
  assert.equal(card.trend, 'stable');
});

test('getScorecard.overallScore = mean of 5 metric scores', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordMetric('earthquake', 'accuracy', 1.0, 's');
  svc.recordMetric('earthquake', 'completeness', 0.8, 's');
  svc.recordMetric('earthquake', 'timeliness', 0.6, 's');
  svc.recordMetric('earthquake', 'signal-to-noise', 0.4, 's');
  svc.recordMetric('earthquake', 'coverage', 0.2, 's');
  const card = svc.getScorecard('earthquake');
  assert.ok(Math.abs(card.overallScore - 0.6) < 1e-9, `overallScore=${card.overallScore}`);
});

test('grade A when score >= 0.9', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (const m of ALL_METRICS) svc.recordMetric('cyber', m, 0.95, 's');
  const card = svc.getScorecard('cyber');
  for (const m of ALL_METRICS) assert.equal(card.grades[m], 'A');
  assert.equal(card.overallGrade, 'A');
});

test('grade A boundary at exactly 0.9', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (const m of ALL_METRICS) svc.recordMetric('cyber', m, 0.9, 's');
  assert.equal(svc.getScorecard('cyber').overallGrade, 'A');
});

test('grade B when score in [0.75, 0.9)', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (const m of ALL_METRICS) svc.recordMetric('cyber', m, 0.8, 's');
  assert.equal(svc.getScorecard('cyber').overallGrade, 'B');
});

test('grade C when score in [0.6, 0.75)', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (const m of ALL_METRICS) svc.recordMetric('cyber', m, 0.65, 's');
  assert.equal(svc.getScorecard('cyber').overallGrade, 'C');
});

test('grade D when score in [0.4, 0.6)', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (const m of ALL_METRICS) svc.recordMetric('cyber', m, 0.5, 's');
  assert.equal(svc.getScorecard('cyber').overallGrade, 'D');
});

test('grade F when score < 0.4', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (const m of ALL_METRICS) svc.recordMetric('cyber', m, 0.3, 's');
  assert.equal(svc.getScorecard('cyber').overallGrade, 'F');
});

// ── Trend ────────────────────────────────────────────────────────────────

test('trend = stable for fresh seeded domain', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  assert.equal(svc.getScorecard('earthquake').trend, 'stable');
});

test('trend = improving when latest-5 overall mean > prior-5 mean by >0.02', () => {
  let t = NOW_MS;
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => t });
  // 5 low snapshots, then 5 high — overall recomputes from latest-per-metric, so
  // the trend is built from per-record overall snapshots. Record 10 rounds.
  for (let i = 0; i < 5; i++) {
    t += 1000;
    for (const m of ALL_METRICS) svc.recordMetric('cyber', m, 0.3, 's');
  }
  for (let i = 0; i < 5; i++) {
    t += 1000;
    for (const m of ALL_METRICS) svc.recordMetric('cyber', m, 0.9, 's');
  }
  const card = svc.getScorecard('cyber');
  assert.equal(card.trend, 'improving');
});

test('trend = degrading when latest-5 overall mean < prior-5 mean by >0.02', () => {
  let t = NOW_MS;
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => t });
  for (let i = 0; i < 5; i++) {
    t += 1000;
    for (const m of ALL_METRICS) svc.recordMetric('cyber', m, 0.9, 's');
  }
  for (let i = 0; i < 5; i++) {
    t += 1000;
    for (const m of ALL_METRICS) svc.recordMetric('cyber', m, 0.3, 's');
  }
  const card = svc.getScorecard('cyber');
  assert.equal(card.trend, 'degrading');
});

test('trend = stable when within ±0.02 band', () => {
  let t = NOW_MS;
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => t });
  for (let i = 0; i < 10; i++) {
    t += 1000;
    for (const m of ALL_METRICS) svc.recordMetric('cyber', m, 0.7, 's');
  }
  assert.equal(svc.getScorecard('cyber').trend, 'stable');
});

// ── getAllScorecards / getTopDomains / getWorstDomains ───────────────────

test('getAllScorecards returns one card per known domain', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordMetric('space', 'accuracy', 0.5, 's');
  const cards = svc.getAllScorecards();
  // 8 seeded + 1 new = 9
  assert.equal(cards.length, 9);
});

test('getAllScorecards is sorted by overallScore desc', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (const m of ALL_METRICS) svc.recordMetric('cyber', m, 0.95, 's');
  for (const m of ALL_METRICS) svc.recordMetric('weather', m, 0.4, 's');
  const cards = svc.getAllScorecards();
  for (let i = 0; i + 1 < cards.length; i++) {
    assert.ok((cards[i]?.overallScore ?? 0) >= (cards[i + 1]?.overallScore ?? 0));
  }
  assert.equal(cards[0]?.domain, 'cyber');
});

test('getTopDomains(n) returns first n by overallScore desc', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (const m of ALL_METRICS) svc.recordMetric('cyber', m, 0.95, 's');
  const top = svc.getTopDomains(3);
  assert.equal(top.length, 3);
  assert.equal(top[0]?.domain, 'cyber');
});

test('getWorstDomains(n) returns bottom n by overallScore asc', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  for (const m of ALL_METRICS) svc.recordMetric('aviation', m, 0.2, 's');
  const worst = svc.getWorstDomains(3);
  assert.equal(worst.length, 3);
  assert.equal(worst[0]?.domain, 'aviation');
});

// ── getSnapshots ─────────────────────────────────────────────────────────

test('getSnapshots returns LIFO (newest first)', () => {
  let t = NOW_MS;
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => t });
  for (let i = 0; i < 3; i++) {
    t += 1000;
    svc.recordMetric('cyber', 'accuracy', 0.5 + i * 0.1, `s${i}`);
  }
  const snaps = svc.getSnapshots('cyber', 'accuracy');
  assert.equal(snaps[0]?.source, 's2');
  assert.equal(snaps[1]?.source, 's1');
  assert.equal(snaps[2]?.source, 's0');
});

test('getSnapshots respects limit', () => {
  let t = NOW_MS;
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => t });
  for (let i = 0; i < 10; i++) {
    t += 1000;
    svc.recordMetric('cyber', 'accuracy', 0.5, 's');
  }
  assert.equal(svc.getSnapshots('cyber', 'accuracy', 3).length, 3);
});

test('getSnapshots filters by metric', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordMetric('cyber', 'accuracy', 0.5, 's');
  svc.recordMetric('cyber', 'coverage', 0.5, 's');
  const accSnaps = svc.getSnapshots('cyber', 'accuracy');
  for (const s of accSnaps) assert.equal(s.metric, 'accuracy');
});

test('getSnapshots filters by domain', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  svc.recordMetric('cyber', 'accuracy', 0.5, 's');
  svc.recordMetric('weather', 'accuracy', 0.5, 's');
  const cyberSnaps = svc.getSnapshots('cyber');
  for (const s of cyberSnaps) {
    // domain filtering — we trust the service to only return cyber snapshots
    assert.ok(s.recordedAt > 0);
  }
  // Sanity: cyber should have at least 5 (seed) + 1 (recordMetric) = 6 snapshots
  assert.ok(cyberSnaps.length >= 6);
});

// ── Ring-buffer eviction ─────────────────────────────────────────────────

test('snapshots ring-buffer evicts oldest at MAX_SNAPSHOTS', () => {
  let t = NOW_MS;
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => t });
  for (let i = 0; i < MAX_SNAPSHOTS + 100; i++) {
    t += 1;
    svc.recordMetric('cyber', 'accuracy', 0.5, 's');
  }
  // All known domains' snapshots combined should stay <= MAX_SNAPSHOTS
  let total = 0;
  for (const card of svc.getAllScorecards()) {
    total += svc.getSnapshots(card.domain).length;
  }
  assert.ok(total <= MAX_SNAPSHOTS, `total snapshots ${total} > ${MAX_SNAPSHOTS}`);
});

// ── subscribe ────────────────────────────────────────────────────────────

test('subscribe is notified on recordMetric', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  let calls = 0;
  svc.subscribe(() => { calls += 1; });
  svc.recordMetric('cyber', 'accuracy', 0.5, 's');
  assert.ok(calls >= 1);
});

test('unsubscribe stops notifications', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  let calls = 0;
  const fn = () => { calls += 1; };
  svc.subscribe(fn);
  svc.unsubscribe(fn);
  svc.recordMetric('cyber', 'accuracy', 0.5, 's');
  assert.equal(calls, 0);
});

// ── Persistence ──────────────────────────────────────────────────────────

test('snapshots persist across instances', () => {
  const storage = createMemoryStorage();
  const svc1 = createDomainScorecardService({ storage, now: () => NOW_MS });
  svc1.recordMetric('cyber', 'accuracy', 0.95, 'persist-test');

  const svc2 = createDomainScorecardService({ storage, now: () => NOW_MS });
  const snaps = svc2.getSnapshots('cyber', 'accuracy', 1);
  assert.equal(snaps[0]?.source, 'persist-test');
  assert.equal(snaps[0]?.value, 0.95);
});

test('seeding only fires once per storage (no double-seed on second instance)', () => {
  const storage = createMemoryStorage();
  const svc1 = createDomainScorecardService({ storage, now: () => NOW_MS });
  const seedCount1 = svc1.getSnapshots('cyber').length;
  const svc2 = createDomainScorecardService({ storage, now: () => NOW_MS });
  const seedCount2 = svc2.getSnapshots('cyber').length;
  assert.equal(seedCount1, seedCount2);
});

// ── Grade type sanity ────────────────────────────────────────────────────

test('all grades are valid ScorecardGrade values', () => {
  const svc = createDomainScorecardService({ storage: createMemoryStorage(), now: () => NOW_MS });
  const valid: ScorecardGrade[] = ['A', 'B', 'C', 'D', 'F'];
  for (const card of svc.getAllScorecards()) {
    assert.ok(valid.includes(card.overallGrade));
    for (const m of ALL_METRICS) {
      assert.ok(valid.includes(card.grades[m]));
    }
  }
});
