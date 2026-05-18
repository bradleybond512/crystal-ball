/**
 * Tests for TemporalAnomalyDetectorService — z-score based temporal
 * anomaly detection over per-domain hourly/daily/weekly baselines.
 *
 * The service is built with injectable storage + clock so the tests
 * never touch real localStorage or Date.now. Bucket math is verified
 * via the exported `bucketHourOfDay` / `bucketDayOfWeek` /
 * `bucketWeekOfYear` helpers so the tests document the expected
 * calendar mapping.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANOMALIES_STORAGE_KEY,
  BASELINES_STORAGE_KEY,
  MAX_ANOMALIES,
  MIN_STDDEV,
  TemporalAnomalyDetectorService,
  __internals,
  __resetTemporalAnomalyDetectorServiceSingleton,
  bucketDayOfWeek,
  bucketHourOfDay,
  bucketWeekOfYear,
  getTemporalAnomalyDetectorService,
  type StorageLike,
  type TemporalAnomaly,
} from '../../src/services/intelligence/temporal-anomaly-detector.ts';

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
const TS_HOUR_14 = Date.UTC(2025, 5, 15, 14, 0, 0); // Sunday 14:00 UTC
const TS_HOUR_3 = Date.UTC(2025, 5, 18, 3, 0, 0); // Wednesday 03:00 UTC

// ── Bucket math ─────────────────────────────────────────────────────

test('bucketHourOfDay returns 0..23 from UTC hours', () => {
  assert.equal(bucketHourOfDay(Date.UTC(2025, 0, 1, 0, 0, 0)), 0);
  assert.equal(bucketHourOfDay(Date.UTC(2025, 0, 1, 23, 59, 59)), 23);
  assert.equal(bucketHourOfDay(TS_HOUR_14), 14);
  assert.equal(bucketHourOfDay(TS_HOUR_3), 3);
});

test('bucketDayOfWeek returns 0..6 with Sunday=0', () => {
  assert.equal(bucketDayOfWeek(Date.UTC(2025, 5, 15, 12, 0, 0)), 0, 'June 15 2025 was Sunday');
  assert.equal(bucketDayOfWeek(Date.UTC(2025, 5, 18, 12, 0, 0)), 3, 'June 18 2025 was Wednesday');
});

test('bucketWeekOfYear clamps to 0..51', () => {
  for (let m = 0; m < 12; m += 1) {
    for (const d of [1, 15, 28]) {
      const idx = bucketWeekOfYear(Date.UTC(2025, m, d, 12, 0, 0));
      assert.ok(idx >= 0 && idx < 52, `week bucket ${idx} for ${m}/${d} out of [0,51]`);
    }
  }
});

// ── Seeding ──────────────────────────────────────────────────────────

test('built-in domains have seeded uniform baselines at init', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  for (const domain of __internals.SEEDED_DOMAINS) {
    const hourly = svc.getBaseline(domain, 'hourly');
    assert.equal(hourly.buckets.length, 24);
    assert.ok(hourly.buckets.every((v) => v === 1), `${domain} hourly should seed all 1s`);
    assert.equal(svc.getBaseline(domain, 'daily').buckets.length, 7);
    assert.equal(svc.getBaseline(domain, 'weekly').buckets.length, 52);
  }
});

test('seeding is idempotent — repeated calls do not double-add', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const before = svc.getBaseline('earthquake', 'hourly');
  svc.getBaseline('earthquake', 'hourly');
  const after = svc.getBaseline('earthquake', 'hourly');
  assert.deepEqual(before.buckets, after.buckets);
});

test('getBaseline auto-creates a baseline for an unseen domain', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const b = svc.getBaseline('custom-domain', 'daily');
  assert.equal(b.buckets.length, 7);
  assert.equal(b.sampleCount, 0);
});

// ── updateBaseline / Welford ─────────────────────────────────────────

test('updateBaseline updates running mean for the bucket', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  for (const value of [2, 4, 6, 8]) svc.updateBaseline('earthquake', 'hourly', 5, value);
  const b = svc.getBaseline('earthquake', 'hourly');
  assert.equal(b.buckets[5], 5, 'mean of 2,4,6,8 should be 5');
});

test('updateBaseline ignores out-of-range bucketIndex', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  svc.updateBaseline('earthquake', 'hourly', 25, 99);
  svc.updateBaseline('earthquake', 'hourly', -1, 99);
  const b = svc.getBaseline('earthquake', 'hourly');
  assert.ok(b.buckets.every((v) => v === 1), 'no bucket should have been touched');
});

test('updateBaseline tracks sampleCount across all buckets', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  svc.updateBaseline('earthquake', 'daily', 0, 1);
  svc.updateBaseline('earthquake', 'daily', 3, 2);
  svc.updateBaseline('earthquake', 'daily', 5, 3);
  assert.equal(svc.getBaseline('earthquake', 'daily').sampleCount, 3);
});

// ── detect ───────────────────────────────────────────────────────────

test('detect returns null when z-score is below the detection floor', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  // Pre-train the (3, daily=Wednesday=3, weekly) bucket with constant
  // count=1 so stddev → MIN_STDDEV (0.1). Then detect count=1.05 →
  // z = 0.5 → below floor 1.0 → null.
  for (let i = 0; i < 10; i += 1) {
    svc.updateBaseline('earthquake', 'hourly', 3, 1);
    svc.updateBaseline('earthquake', 'daily', 3, 1);
    svc.updateBaseline('earthquake', 'weekly', bucketWeekOfYear(TS_HOUR_3), 1);
  }
  const out = svc.detect('earthquake', 'obs-1', TS_HOUR_3, 1.05);
  assert.equal(out, null);
});

test('detect classifies mild for z in [1, 2)', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  for (let i = 0; i < 10; i += 1) {
    svc.updateBaseline('earthquake', 'hourly', 3, 1);
    svc.updateBaseline('earthquake', 'daily', 3, 1);
    svc.updateBaseline('earthquake', 'weekly', bucketWeekOfYear(TS_HOUR_3), 1);
  }
  // count 1.15 → z = (1.15-1)/0.1 = 1.5 → mild
  const out = svc.detect('earthquake', 'obs-1', TS_HOUR_3, 1.15)!;
  assert.equal(out.strength, 'mild');
  assert.ok(Math.abs(out.zScore) >= 1 && Math.abs(out.zScore) < 2);
});

test('detect classifies moderate for z in [2, 3)', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  for (let i = 0; i < 10; i += 1) {
    svc.updateBaseline('earthquake', 'hourly', 3, 1);
    svc.updateBaseline('earthquake', 'daily', 3, 1);
    svc.updateBaseline('earthquake', 'weekly', bucketWeekOfYear(TS_HOUR_3), 1);
  }
  // count 1.25 → z = 2.5 → moderate
  const out = svc.detect('earthquake', 'obs-1', TS_HOUR_3, 1.25)!;
  assert.equal(out.strength, 'moderate');
});

test('detect classifies strong for z in [3, 4)', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  for (let i = 0; i < 10; i += 1) {
    svc.updateBaseline('earthquake', 'hourly', 3, 1);
    svc.updateBaseline('earthquake', 'daily', 3, 1);
    svc.updateBaseline('earthquake', 'weekly', bucketWeekOfYear(TS_HOUR_3), 1);
  }
  // count 1.35 → z = 3.5 → strong
  const out = svc.detect('earthquake', 'obs-1', TS_HOUR_3, 1.35)!;
  assert.equal(out.strength, 'strong');
});

test('detect classifies extreme for z >= 4', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  for (let i = 0; i < 10; i += 1) {
    svc.updateBaseline('earthquake', 'hourly', 3, 1);
    svc.updateBaseline('earthquake', 'daily', 3, 1);
    svc.updateBaseline('earthquake', 'weekly', bucketWeekOfYear(TS_HOUR_3), 1);
  }
  // count 1.5 → z = 5 → extreme
  const out = svc.detect('earthquake', 'obs-1', TS_HOUR_3, 1.5)!;
  assert.equal(out.strength, 'extreme');
});

test('detect returns the strongest of three patterns', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  // hourly bucket 3: mean ~ 1 (default), so any spike will fire
  // daily bucket 3 (Wed): pre-train to mean 10 → spike of 1 is normal there
  for (let i = 0; i < 20; i += 1) svc.updateBaseline('earthquake', 'daily', 3, 1);
  for (let i = 0; i < 20; i += 1) svc.updateBaseline('earthquake', 'weekly', bucketWeekOfYear(TS_HOUR_3), 1);
  // hourly bucket 3 stays at default mean=1, stddev=0.1
  const out = svc.detect('earthquake', 'obs-strong', TS_HOUR_3, 2)!;
  assert.equal(out.pattern, 'hourly', 'hourly should win because of the steepest deviation');
});

test('detect picks correct bucket index per pattern', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  const out = svc.detect('earthquake', 'obs-1', TS_HOUR_3, 5)!;
  // Wednesday at 03:00 UTC. The strongest pattern should be hourly,
  // bucket 3.
  assert.equal(out.pattern, 'hourly');
  assert.equal(out.bucketIndex, 3);
});

test('detect records the anomaly in the ledger', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.detect('earthquake', 'obs-1', TS_HOUR_3, 5);
  const list = svc.getAnomalies({});
  assert.equal(list.length, 1);
  assert.equal(list[0]!.observationId, 'obs-1');
});

test('detect uses MIN_STDDEV when variance is zero', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  // No updates → stddev is 0, replaced by MIN_STDDEV=0.1.
  // count 1.5 over mean 1 → z = 5 → extreme.
  const out = svc.detect('earthquake', 'obs-1', TS_HOUR_3, 1.5)!;
  assert.ok(MIN_STDDEV > 0);
  assert.equal(out.strength, 'extreme');
});

test('detect populates expectedRate and observedCount accurately', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  for (let i = 0; i < 10; i += 1) svc.updateBaseline('earthquake', 'hourly', 3, 1);
  const out = svc.detect('earthquake', 'obs-1', TS_HOUR_3, 1.5)!;
  assert.equal(out.expectedRate, 1);
  assert.equal(out.observedCount, 1.5);
});

// ── Acknowledge ──────────────────────────────────────────────────────

test('acknowledge flips the flag', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const out = svc.detect('earthquake', 'obs-1', TS_HOUR_3, 5)!;
  const acked = svc.acknowledge(out.id)!;
  assert.equal(acked.acknowledged, true);
});

test('acknowledge is idempotent', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const out = svc.detect('earthquake', 'obs-1', TS_HOUR_3, 5)!;
  svc.acknowledge(out.id);
  const again = svc.acknowledge(out.id);
  assert.equal(again?.acknowledged, true);
});

test('acknowledge returns undefined for unknown id', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  assert.equal(svc.acknowledge('tan-nope'), undefined);
});

// ── Reads / filters ──────────────────────────────────────────────────

test('getAnomalies filters by domain', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.detect('earthquake', 'a', TS_HOUR_3, 5);
  svc.detect('cyber', 'b', TS_HOUR_3, 5);
  const eq = svc.getAnomalies({ domain: 'earthquake' });
  assert.ok(eq.every((a) => a.domain === 'earthquake'));
  assert.equal(eq.length, 1);
});

test('getAnomalies filters by strength', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  for (let i = 0; i < 10; i += 1) svc.updateBaseline('earthquake', 'hourly', 3, 1);
  svc.detect('earthquake', 'mild', TS_HOUR_3, 1.15);   // mild
  svc.detect('earthquake', 'ext', TS_HOUR_3, 5);       // extreme
  assert.equal(svc.getAnomalies({ strength: 'mild' }).length, 1);
  assert.equal(svc.getAnomalies({ strength: 'extreme' }).length, 1);
});

test('getAnomalies filters by acknowledged', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const out = svc.detect('earthquake', 'a', TS_HOUR_3, 5)!;
  svc.acknowledge(out.id);
  assert.equal(svc.getAnomalies({ acknowledged: true }).length, 1);
  assert.equal(svc.getAnomalies({ acknowledged: false }).length, 0);
});

test('getAnomalies is newest-first with optional limit', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const a = svc.detect('earthquake', 'a', TS_HOUR_3, 5)!;
  const b = svc.detect('earthquake', 'b', TS_HOUR_3, 5)!;
  const c = svc.detect('earthquake', 'c', TS_HOUR_3, 5)!;
  const all = svc.getAnomalies({});
  assert.deepEqual(all.map((x) => x.id), [c.id, b.id, a.id]);
  assert.equal(svc.getAnomalies({}, 2).length, 2);
});

test('getAnomalies returns defensive copies', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  svc.detect('earthquake', 'a', TS_HOUR_3, 5);
  const list = svc.getAnomalies({});
  list[0]!.acknowledged = true;
  assert.equal(svc.getAnomalies({})[0]!.acknowledged, false);
});

// ── Summary ──────────────────────────────────────────────────────────

test('getSummary totals + topDomain reflect recorded anomalies', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  for (let i = 0; i < 3; i += 1) svc.detect('earthquake', `e-${i}`, TS_HOUR_3, 5);
  svc.detect('cyber', 'c-1', TS_HOUR_3, 5);
  const s = svc.getSummary();
  assert.equal(s.total, 4);
  assert.equal(s.topDomain, 'earthquake');
  assert.equal(s.byStrength.extreme, 4);
});

test('getSummary.unacknowledged decrements after acknowledge', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const out = svc.detect('earthquake', 'a', TS_HOUR_3, 5)!;
  assert.equal(svc.getSummary().unacknowledged, 1);
  svc.acknowledge(out.id);
  assert.equal(svc.getSummary().unacknowledged, 0);
});

test('getSummary.topDomain is null when no anomalies have been recorded', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: fixedClock(NOW) });
  assert.equal(svc.getSummary().topDomain, null);
});

// ── Ring buffer ──────────────────────────────────────────────────────

test('ring buffer evicts oldest anomalies past MAX_ANOMALIES', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const total = MAX_ANOMALIES + 10;
  for (let i = 0; i < total; i += 1) svc.detect('earthquake', `a-${i}`, TS_HOUR_3, 5);
  assert.equal(svc.getSummary().total, MAX_ANOMALIES);
});

// ── Subscribe ─────────────────────────────────────────────────────────

test('subscribe fires on each new anomaly', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  const seen: TemporalAnomaly[] = [];
  const off = svc.subscribe((a) => seen.push(a));
  svc.detect('earthquake', 'a', TS_HOUR_3, 5);
  svc.detect('earthquake', 'b', TS_HOUR_3, 5);
  off();
  svc.detect('earthquake', 'c', TS_HOUR_3, 5);
  assert.equal(seen.length, 2);
});

test('a listener that throws does not stop other listeners', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  let good = 0;
  svc.subscribe(() => { throw new Error('bad'); });
  svc.subscribe(() => { good += 1; });
  svc.detect('earthquake', 'a', TS_HOUR_3, 5);
  assert.equal(good, 1);
});

test('unsubscribe removes the listener', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: makeFakeStorage(), clock: tickingClock(NOW) });
  let count = 0;
  const cb = (): void => { count += 1; };
  svc.subscribe(cb);
  svc.unsubscribe(cb);
  svc.detect('earthquake', 'a', TS_HOUR_3, 5);
  assert.equal(count, 0);
});

// ── Persistence ───────────────────────────────────────────────────────

test('anomalies survive a fresh service instance', () => {
  const storage = makeFakeStorage();
  const svc1 = new TemporalAnomalyDetectorService({ storage, clock: tickingClock(NOW) });
  svc1.detect('earthquake', 'a', TS_HOUR_3, 5);
  svc1.detect('earthquake', 'b', TS_HOUR_3, 5);
  const svc2 = new TemporalAnomalyDetectorService({ storage, clock: tickingClock(NOW) });
  assert.equal(svc2.getSummary().total, 2);
});

test('baselines survive a fresh service instance', () => {
  const storage = makeFakeStorage();
  const svc1 = new TemporalAnomalyDetectorService({ storage, clock: fixedClock(NOW) });
  for (const v of [2, 4, 6, 8]) svc1.updateBaseline('earthquake', 'hourly', 5, v);
  const svc2 = new TemporalAnomalyDetectorService({ storage, clock: fixedClock(NOW) });
  assert.equal(svc2.getBaseline('earthquake', 'hourly').buckets[5], 5);
});

test('corrupt anomalies blob is ignored', () => {
  const storage = makeFakeStorage({ [ANOMALIES_STORAGE_KEY]: 'not-json' });
  const svc = new TemporalAnomalyDetectorService({ storage, clock: fixedClock(NOW) });
  assert.equal(svc.getSummary().total, 0);
});

test('corrupt baselines blob is ignored', () => {
  const storage = makeFakeStorage({ [BASELINES_STORAGE_KEY]: 'not-json' });
  const svc = new TemporalAnomalyDetectorService({ storage, clock: fixedClock(NOW) });
  // Should still return a seeded baseline rather than throw.
  assert.equal(svc.getBaseline('earthquake', 'hourly').buckets.length, 24);
});

test('null storage works (no-op persistence)', () => {
  const svc = new TemporalAnomalyDetectorService({ storage: null, clock: tickingClock(NOW) });
  const out = svc.detect('earthquake', 'a', TS_HOUR_3, 5);
  assert.ok(out);
});

test('resetForTesting clears anomalies + persisted blobs and re-seeds baselines', () => {
  const storage = makeFakeStorage();
  const svc = new TemporalAnomalyDetectorService({ storage, clock: tickingClock(NOW) });
  svc.detect('earthquake', 'a', TS_HOUR_3, 5);
  svc.resetForTesting();
  assert.equal(svc.getSummary().total, 0);
  assert.equal(storage.raw.has(ANOMALIES_STORAGE_KEY), false);
  // Seeded baselines should still be present (re-created during reset).
  assert.equal(svc.getBaseline('earthquake', 'hourly').buckets.length, 24);
});

// ── Singleton ─────────────────────────────────────────────────────────

test('getTemporalAnomalyDetectorService returns a stable singleton', () => {
  __resetTemporalAnomalyDetectorServiceSingleton();
  const a = getTemporalAnomalyDetectorService();
  const b = getTemporalAnomalyDetectorService();
  assert.equal(a, b);
  __resetTemporalAnomalyDetectorServiceSingleton();
});

test('singleton reset returns a fresh instance', () => {
  const a = getTemporalAnomalyDetectorService();
  __resetTemporalAnomalyDetectorServiceSingleton();
  const b = getTemporalAnomalyDetectorService();
  assert.notEqual(a, b);
  __resetTemporalAnomalyDetectorServiceSingleton();
});
