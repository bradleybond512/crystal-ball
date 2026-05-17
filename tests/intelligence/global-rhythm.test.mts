/**
 * Tests for GlobalRhythmEngine — Phase 4 circadian/weekly/seasonal baseline.
 *
 * Run with: npx tsx --test tests/intelligence/global-rhythm.test.mts
 *
 * Pure-service tests against a localStorage stub + injectable clock.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const __storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => __storage.get(k) ?? null,
  setItem: (k: string, v: string) => { __storage.set(k, v); },
  removeItem: (k: string) => { __storage.delete(k); },
  clear: () => { __storage.clear(); },
  get length() { return __storage.size; },
  key: (i: number) => [...__storage.keys()][i] ?? null,
} as Storage;

import {
  ANOMALY_BANDS,
  BUILT_IN_SEEDS,
  GlobalRhythmEngine,
  MIN_LEARNED_SAMPLES,
  SEVERITY_TO_NUM,
  __internals as engineInternals,
  __resetGlobalRhythmSingleton,
  getGlobalRhythmEngine,
  severityToNumber,
} from '../../src/services/intelligence/global-rhythm.ts';
import type { ObservationEvent, ObservationSeverity } from '../../src/services/intelligence/observation-adapters.ts';

const NOW = 1_745_000_000_000;

// ── Fixtures ─────────────────────────────────────────────────────────

/** Build an observation timestamped at a specific UTC hour-of-day on
 *  2025-04-15 (a Tuesday — UTCDay 2 — month index 3). */
function obsAtHour(hour: number, overrides: Partial<ObservationEvent> = {}): ObservationEvent {
  const ts = Date.UTC(2025, 3, 15, hour, 0, 0);
  return {
    id: `obs-${hour}-${Math.random().toString(36).slice(2, 6)}`,
    sourceId: 'src',
    domain: 'earthquake',
    timestamp: ts,
    severity: 'MEDIUM',
    title: `event at ${hour}h`,
    raw: {},
    entityIds: [],
    tags: [],
    ...overrides,
  };
}

function freshEngine(now = NOW): GlobalRhythmEngine {
  __storage.clear();
  __resetGlobalRhythmSingleton();
  return new GlobalRhythmEngine({ clock: () => now });
}

// ── Welford running stats ────────────────────────────────────────────

test('welfordUpdate: single sample yields mean=value, stddev=floor', () => {
  const stats = { n: 0, mean: 0, m2: 0 };
  engineInternals.welfordUpdate(stats, 0.5);
  assert.equal(stats.n, 1);
  assert.equal(stats.mean, 0.5);
  assert.equal(stats.m2, 0);
  assert.equal(engineInternals.welfordStddev(stats), engineInternals.STDDEV_FLOOR);
});

test('welfordUpdate: stream produces correct mean + variance', () => {
  // [0.1, 0.3, 0.5, 0.7, 0.9] — mean = 0.5, sample variance = 0.1
  const stats = { n: 0, mean: 0, m2: 0 };
  for (const v of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    engineInternals.welfordUpdate(stats, v);
  }
  assert.ok(Math.abs(stats.mean - 0.5) < 1e-9);
  // variance = sum((x - mean)^2) / (n - 1) = 0.4 / 4 = 0.1
  const variance = stats.m2 / (stats.n - 1);
  assert.ok(Math.abs(variance - 0.1) < 1e-9);
  // stddev = sqrt(0.1) ≈ 0.3162
  assert.ok(Math.abs(engineInternals.welfordStddev(stats) - Math.sqrt(0.1)) < 1e-9);
});

test('welfordStddev: floors below STDDEV_FLOOR', () => {
  // Constant stream → 0 variance — should be clamped to STDDEV_FLOOR.
  const stats = { n: 0, mean: 0, m2: 0 };
  for (let i = 0; i < 5; i++) engineInternals.welfordUpdate(stats, 0.5);
  assert.equal(engineInternals.welfordStddev(stats), engineInternals.STDDEV_FLOOR);
});

test('welfordStddev: zero samples returns floor', () => {
  assert.equal(engineInternals.welfordStddev({ n: 0, mean: 0, m2: 0 }), engineInternals.STDDEV_FLOOR);
});

// ── Severity mapping ─────────────────────────────────────────────────

test('SEVERITY_TO_NUM is monotonic increasing', () => {
  const order: ObservationSeverity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  for (let i = 1; i < order.length; i++) {
    assert.ok(SEVERITY_TO_NUM[order[i]!]! > SEVERITY_TO_NUM[order[i - 1]!]!);
  }
});

test('severityToNumber matches the table', () => {
  assert.equal(severityToNumber('CRITICAL'), 1);
  assert.equal(severityToNumber('LOW'), 0.25);
});

// ── Built-in seeds ───────────────────────────────────────────────────

test('BUILT_IN_SEEDS has 8 domains', () => {
  assert.equal(BUILT_IN_SEEDS.length, 8);
});

test('every built-in seed has 24 hourly / 7 daily / 12 monthly entries', () => {
  for (const seed of BUILT_IN_SEEDS) {
    assert.equal(seed.hourly.length, 24, `${seed.domain} hourly`);
    assert.equal(seed.daily.length, 7, `${seed.domain} daily`);
    assert.equal(seed.monthly.length, 12, `${seed.domain} monthly`);
  }
});

test('every seed value is in [0, 1]', () => {
  for (const seed of BUILT_IN_SEEDS) {
    for (const v of [...seed.hourly, ...seed.daily, ...seed.monthly]) {
      assert.ok(v >= 0 && v <= 1, `${seed.domain} has out-of-range ${v}`);
    }
  }
});

test('seed names cover the spec-required domains', () => {
  const ids = BUILT_IN_SEEDS.map((s) => s.domain).sort();
  for (const required of ['earthquake', 'biosurveillance', 'weather', 'maritime', 'aviation', 'wildfire', 'space-weather', 'geopolitical']) {
    assert.ok(ids.includes(required), `missing seed: ${required}`);
  }
});

// ── ingestObservation ───────────────────────────────────────────────

test('ingestObservation creates per-domain state and increments sampleCount', () => {
  const eng = freshEngine();
  eng.ingestObservation(obsAtHour(10, { severity: 'HIGH' }));
  const pat = eng.getPattern('earthquake')!;
  assert.equal(pat.sampleCount, 1);
});

test('ingestObservation tracks separate domains independently', () => {
  const eng = freshEngine();
  eng.ingestObservation(obsAtHour(10, { domain: 'weather', severity: 'HIGH' }));
  eng.ingestObservation(obsAtHour(10, { domain: 'cyber', severity: 'LOW' }));
  assert.equal(eng.getPattern('weather')?.sampleCount, 1);
  assert.equal(eng.getPattern('cyber')?.sampleCount, 1);
});

test('repeated ingest on the same hour bucket updates the mean toward observed value', () => {
  const eng = freshEngine();
  // Ingest 10 CRITICAL observations at hour 14 — that bucket should
  // learn a mean near 1.0 once past MIN_LEARNED_SAMPLES.
  for (let i = 0; i < MIN_LEARNED_SAMPLES + 2; i++) {
    eng.ingestObservation(obsAtHour(14, { id: `o-${i}`, domain: 'cyber', severity: 'CRITICAL' }));
  }
  const pat = eng.getPattern('cyber')!;
  assert.equal(pat.expectedSeverityByHour?.[14], 1);
});

test('ingestObservation persists the new state to localStorage', () => {
  const eng = freshEngine();
  eng.ingestObservation(obsAtHour(8, { severity: 'HIGH' }));
  const raw = __storage.get(engineInternals.STORAGE_PATTERNS_KEY);
  assert.ok(raw);
});

// ── scoreAnomaly classification ──────────────────────────────────────

test('scoreAnomaly: severity matching the baseline is "none"', () => {
  const eng = freshEngine();
  // Default earthquake baseline = 0.30, seedStddev = 0.12.
  // Value 0.25 (LOW) → deviation -0.05, |z| ≈ 0.42 → none.
  const score = eng.scoreAnomaly(obsAtHour(3, { severity: 'LOW' }));
  assert.equal(score.anomalyStrength, 'none');
  assert.equal(score.isAnomaly, false);
});

test('scoreAnomaly: severity well above baseline is "strong"', () => {
  const eng = freshEngine();
  // Earthquake baseline 0.30 ± 0.12 → CRITICAL (1.0) is |z| ≈ 5.8 → strong.
  const score = eng.scoreAnomaly(obsAtHour(3, { severity: 'CRITICAL' }));
  assert.equal(score.anomalyStrength, 'strong');
  assert.equal(score.isAnomaly, true);
});

test('scoreAnomaly: classification bands match the documented thresholds', () => {
  for (const band of ANOMALY_BANDS) {
    if (band.min === 0) continue;
    // strengthForZ at exactly band.min returns the band itself.
    assert.equal(engineInternals.strengthForZ(band.min), band.strength);
    // Just below should fall through to the next-lower band.
    const justBelow = band.min - 0.0001;
    const expected = ANOMALY_BANDS.find((b) => b.min !== band.min && justBelow >= b.min)!.strength;
    assert.equal(engineInternals.strengthForZ(justBelow), expected);
  }
});

test('scoreAnomaly: |z| < 1 returns none', () => {
  assert.equal(engineInternals.strengthForZ(0), 'none');
  assert.equal(engineInternals.strengthForZ(0.5), 'none');
  assert.equal(engineInternals.strengthForZ(0.99), 'none');
});

test('scoreAnomaly: |z| in [1, 2) returns mild', () => {
  assert.equal(engineInternals.strengthForZ(1), 'mild');
  assert.equal(engineInternals.strengthForZ(1.5), 'mild');
  assert.equal(engineInternals.strengthForZ(1.99), 'mild');
});

test('scoreAnomaly: |z| in [2, 3) returns moderate', () => {
  assert.equal(engineInternals.strengthForZ(2), 'moderate');
  assert.equal(engineInternals.strengthForZ(2.5), 'moderate');
  assert.equal(engineInternals.strengthForZ(2.99), 'moderate');
});

test('scoreAnomaly: |z| >= 3 returns strong', () => {
  assert.equal(engineInternals.strengthForZ(3), 'strong');
  assert.equal(engineInternals.strengthForZ(5), 'strong');
});

test('scoreAnomaly: returns a ReplayScore with all required fields', () => {
  const eng = freshEngine();
  const score = eng.scoreAnomaly(obsAtHour(3, { id: 'spec-obs', severity: 'CRITICAL' }));
  assert.equal(score.observationId, 'spec-obs');
  assert.equal(typeof score.currentSeverityNum, 'number');
  assert.equal(typeof score.expectedSeverityNum, 'number');
  assert.equal(typeof score.deviation, 'number');
  assert.equal(typeof score.isAnomaly, 'boolean');
  assert.equal(typeof score.timestamp, 'number');
});

test('scoreAnomaly: stores the score in the anomaly history', () => {
  const eng = freshEngine();
  eng.scoreAnomaly(obsAtHour(3, { id: 'a' }));
  eng.scoreAnomaly(obsAtHour(3, { id: 'b' }));
  assert.equal(eng.getRecentAnomalies(10).length, 2);
});

test('scoreAnomaly: pulled from seed when the bucket has no learned data', () => {
  const eng = freshEngine();
  // earthquake's seed baseline at hour 3 = 0.30; expectedSeverityNum should match.
  const score = eng.scoreAnomaly(obsAtHour(3, { severity: 'MEDIUM' }));
  assert.ok(Math.abs(score.expectedSeverityNum - 0.30) < 1e-3);
});

test('scoreAnomaly: pulled from learned mean once past MIN_LEARNED_SAMPLES', () => {
  const eng = freshEngine();
  for (let i = 0; i < MIN_LEARNED_SAMPLES + 2; i++) {
    eng.ingestObservation(obsAtHour(7, { id: `seed-${i}`, domain: 'aviation', severity: 'CRITICAL' }));
  }
  const score = eng.scoreAnomaly(obsAtHour(7, { id: 'x', domain: 'aviation', severity: 'CRITICAL' }));
  assert.ok(Math.abs(score.expectedSeverityNum - 1) < 1e-6);
  assert.equal(score.deviation, 0);
});

// ── getPattern + getAllPatterns ──────────────────────────────────────

test('getPattern returns circadian array of 24 hours', () => {
  const eng = freshEngine();
  const pat = eng.getPattern('earthquake')!;
  assert.equal(pat.patternType, 'circadian');
  assert.equal(pat.expectedSeverityByHour?.length, 24);
});

test('getPattern returns undefined for an unseeded, unobserved domain', () => {
  const eng = freshEngine();
  assert.equal(eng.getPattern('totally-novel'), undefined);
});

test('getPattern returns the seeded pattern even before any observations', () => {
  const eng = freshEngine();
  const pat = eng.getPattern('weather')!;
  // weather seed peaks at hour 17 (0.45). Should match exactly when no learning.
  assert.equal(pat.expectedSeverityByHour?.[17], 0.45);
});

test('getAllPatterns returns 3 patterns per seeded domain', () => {
  const eng = freshEngine();
  const all = eng.getAllPatterns();
  // 8 seeds * 3 patterns = 24 records at minimum.
  assert.ok(all.length >= 24);
  // Each domain appears with circadian/weekly/seasonal.
  for (const seed of BUILT_IN_SEEDS) {
    const forDomain = all.filter((p) => p.domain === seed.domain);
    const types = forDomain.map((p) => p.patternType).sort();
    assert.deepEqual(types, ['circadian', 'seasonal', 'weekly']);
  }
});

test('weekly pattern has 7 entries', () => {
  const eng = freshEngine();
  const weekly = eng.getAllPatterns().find((p) => p.domain === 'earthquake' && p.patternType === 'weekly')!;
  assert.equal(weekly.expectedSeverityByDayOfWeek?.length, 7);
});

test('seasonal pattern has 12 entries', () => {
  const eng = freshEngine();
  const seasonal = eng.getAllPatterns().find((p) => p.domain === 'earthquake' && p.patternType === 'seasonal')!;
  assert.equal(seasonal.expectedSeverityByMonth?.length, 12);
});

// ── getRecentAnomalies + ring buffer ─────────────────────────────────

test('getRecentAnomalies returns last N in chronological order', () => {
  const eng = freshEngine();
  for (let i = 0; i < 5; i++) {
    eng.scoreAnomaly(obsAtHour(3, { id: `o-${i}` }));
  }
  const recent = eng.getRecentAnomalies(3);
  assert.equal(recent.length, 3);
  assert.equal(recent[0].observationId, 'o-2');
  assert.equal(recent[2].observationId, 'o-4');
});

test('getRecentAnomalies with limit=0 returns empty', () => {
  const eng = freshEngine();
  eng.scoreAnomaly(obsAtHour(3));
  assert.deepEqual(eng.getRecentAnomalies(0), []);
});

test('anomaly ring buffer evicts oldest at MAX_ANOMALIES + 1', () => {
  const eng = freshEngine();
  const max = engineInternals.MAX_ANOMALIES;
  for (let i = 0; i < max + 5; i++) {
    eng.scoreAnomaly(obsAtHour(i % 24, { id: `o-${i}` }));
  }
  const all = eng.getRecentAnomalies(max + 10);
  assert.equal(all.length, max);
  // Oldest 5 should have been evicted: first surviving id is o-5.
  assert.equal(all[0].observationId, 'o-5');
});

// ── Persistence ──────────────────────────────────────────────────────

test('patterns survive a fresh instance hydrating from localStorage', () => {
  const a = freshEngine();
  for (let i = 0; i < MIN_LEARNED_SAMPLES + 2; i++) {
    a.ingestObservation(obsAtHour(7, { id: `p-${i}`, domain: 'aviation', severity: 'CRITICAL' }));
  }
  const b = new GlobalRhythmEngine({ clock: () => NOW });
  const pat = b.getPattern('aviation')!;
  assert.ok(pat.sampleCount >= MIN_LEARNED_SAMPLES);
  assert.ok(Math.abs((pat.expectedSeverityByHour?.[7] ?? 0) - 1) < 1e-6);
});

test('anomaly history survives a fresh instance hydrating from localStorage', () => {
  const a = freshEngine();
  a.scoreAnomaly(obsAtHour(3, { id: 'a-1', severity: 'CRITICAL' }));
  const b = new GlobalRhythmEngine({ clock: () => NOW });
  const recent = b.getRecentAnomalies(10);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].observationId, 'a-1');
});

test('corrupt patterns blob does not crash hydrate', () => {
  __storage.clear();
  __resetGlobalRhythmSingleton();
  __storage.set(engineInternals.STORAGE_PATTERNS_KEY, '{not valid');
  const eng = new GlobalRhythmEngine({ clock: () => NOW });
  // Still returns seeded patterns even with the corrupt blob.
  assert.ok(eng.getPattern('earthquake'));
});

test('corrupt anomalies blob does not crash hydrate', () => {
  __storage.clear();
  __resetGlobalRhythmSingleton();
  __storage.set(engineInternals.STORAGE_ANOMALIES_KEY, '{not valid');
  const eng = new GlobalRhythmEngine({ clock: () => NOW });
  assert.deepEqual(eng.getRecentAnomalies(10), []);
});

// ── bucketsFromTimestamp helper ──────────────────────────────────────

test('bucketsFromTimestamp returns UTC hour / day / month', () => {
  // 2025-04-15T14:00:00Z → hour 14, day 2 (Tuesday), month 3 (April).
  const ts = Date.UTC(2025, 3, 15, 14, 0, 0);
  const b = engineInternals.bucketsFromTimestamp(ts);
  assert.equal(b.hour, 14);
  assert.equal(b.day, 2);
  assert.equal(b.month, 3);
});

// ── Subscribe / singleton ────────────────────────────────────────────

test('subscribe fires on ingestObservation and scoreAnomaly', () => {
  const eng = freshEngine();
  let calls = 0;
  eng.subscribe(() => { calls += 1; });
  eng.ingestObservation(obsAtHour(3));
  eng.scoreAnomaly(obsAtHour(3));
  assert.equal(calls, 2);
});

test('subscribe listener exception is isolated', () => {
  const eng = freshEngine();
  eng.subscribe(() => { throw new Error('boom'); });
  let secondCalled = false;
  eng.subscribe(() => { secondCalled = true; });
  eng.ingestObservation(obsAtHour(3));
  assert.equal(secondCalled, true);
});

test('getGlobalRhythmEngine() returns a stable singleton', () => {
  __storage.clear();
  __resetGlobalRhythmSingleton();
  const a = getGlobalRhythmEngine();
  const b = getGlobalRhythmEngine();
  assert.strictEqual(a, b);
});
