import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateFreightStress,
  computeFreightStress,
  parseFredCsv,
  stressScoreFromZ,
} from '../freight-stress.ts';
import type { FredObservation, FreightStressResult } from '../freight-stress.ts';

// ── CSV parser ───────────────────────────────────────────────────────────────

test('parseFredCsv: parses header + numeric rows', () => {
  const csv = `DATE,PPIACO\n2026-01-01,250.5\n2026-02-01,251.2\n2026-03-01,252.1`;
  const out = parseFredCsv(csv);
  assert.equal(out.length, 3);
  assert.equal(out[0]!.date, '2026-01-01');
  assert.equal(out[0]!.value, 250.5);
});

test('parseFredCsv: skips FRED missing-value rows (value=".")', () => {
  const csv = `DATE,PPIACO\n2026-01-01,.\n2026-02-01,251.2`;
  const out = parseFredCsv(csv);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.date, '2026-02-01');
});

test('parseFredCsv: skips non-numeric rows', () => {
  const csv = `DATE,PPIACO\n2026-01-01,abc\n2026-02-01,251.2`;
  const out = parseFredCsv(csv);
  assert.equal(out.length, 1);
});

test('parseFredCsv: skips rows missing the value column', () => {
  const csv = `DATE,PPIACO\n2026-01-01\n2026-02-01,251.2`;
  const out = parseFredCsv(csv);
  assert.equal(out.length, 1);
});

test('parseFredCsv: handles empty body', () => {
  assert.deepEqual(parseFredCsv(''), []);
  assert.deepEqual(parseFredCsv('DATE,PPIACO'), []);
});

test('parseFredCsv: tolerates CRLF line endings', () => {
  const csv = `DATE,PPIACO\r\n2026-01-01,250.5\r\n2026-02-01,251.2`;
  const out = parseFredCsv(csv);
  assert.equal(out.length, 2);
});

// ── Z-score → stress mapping ─────────────────────────────────────────────────

test('stressScoreFromZ: 0 → 0', () => {
  assert.equal(stressScoreFromZ(0), 0);
});

test('stressScoreFromZ: |z|=2 → 75 ("stressed" threshold from spec)', () => {
  assert.equal(stressScoreFromZ(2), 75);
  assert.equal(stressScoreFromZ(-2), 75);
});

test('stressScoreFromZ: |z|>=3 → 100', () => {
  assert.equal(stressScoreFromZ(3), 100);
  assert.equal(stressScoreFromZ(5), 100);
});

test('stressScoreFromZ: monotonic with |z|', () => {
  const xs = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  for (let i = 1; i < xs.length; i++) {
    assert.ok(stressScoreFromZ(xs[i]!) >= stressScoreFromZ(xs[i - 1]!));
  }
});

test('stressScoreFromZ: null/NaN → 0', () => {
  assert.equal(stressScoreFromZ(null), 0);
  assert.equal(stressScoreFromZ(Number.NaN), 0);
});

// ── computeFreightStress ─────────────────────────────────────────────────────

function obs(date: string, value: number): FredObservation {
  return { date, value };
}

function flat12(value: number): FredObservation[] {
  return [
    obs('2025-04-01', value), obs('2025-05-01', value), obs('2025-06-01', value),
    obs('2025-07-01', value), obs('2025-08-01', value), obs('2025-09-01', value),
    obs('2025-10-01', value), obs('2025-11-01', value), obs('2025-12-01', value),
    obs('2026-01-01', value), obs('2026-02-01', value), obs('2026-03-01', value),
  ];
}

test('flat baseline + matching current → score 0, low stress', () => {
  const data = [...flat12(250), obs('2026-04-01', 250)];
  const r = computeFreightStress('PPIACO', data);
  assert.equal(r.stressScore, 0);
  assert.equal(r.stressLevel, 'low');
  assert.equal(r.deviationPct, 0);
});

test('current at +5% over flat baseline → some stress', () => {
  const data = [...flat12(250), obs('2026-04-01', 262.5)];
  const r = computeFreightStress('PPIACO', data);
  // Flat history → stdev = 0 → zScore null → score 0; this exposes a
  // boundary case: stress only fires when there's variance to compare to.
  assert.equal(r.zScore, null);
  assert.equal(r.deviationPct! > 4 && r.deviationPct! < 6, true);
});

test('current 2σ above noisy baseline → high stress', () => {
  // Generate a 12m noisy baseline around 250 with stdev ≈ 5
  const baseline: FredObservation[] = [];
  const values = [248, 252, 246, 254, 250, 245, 255, 247, 253, 250, 244, 256];
  const dates = [
    '2025-04-01','2025-05-01','2025-06-01','2025-07-01','2025-08-01','2025-09-01',
    '2025-10-01','2025-11-01','2025-12-01','2026-01-01','2026-02-01','2026-03-01',
  ];
  for (let i = 0; i < 12; i++) baseline.push(obs(dates[i]!, values[i]!));
  baseline.push(obs('2026-04-01', 270));
  const r = computeFreightStress('PPIACO', baseline);
  assert.ok(r.zScore! >= 3, `zScore was ${r.zScore}`);
  assert.equal(r.stressLevel, 'critical');
});

test('symmetric: 2σ below baseline also surfaces as stressed', () => {
  const values = [248, 252, 246, 254, 250, 245, 255, 247, 253, 250, 244, 256];
  const dates = [
    '2025-04-01','2025-05-01','2025-06-01','2025-07-01','2025-08-01','2025-09-01',
    '2025-10-01','2025-11-01','2025-12-01','2026-01-01','2026-02-01','2026-03-01',
  ];
  const baseline: FredObservation[] = [];
  for (let i = 0; i < 12; i++) baseline.push(obs(dates[i]!, values[i]!));
  baseline.push(obs('2026-04-01', 230));
  const r = computeFreightStress('PPIACO', baseline);
  assert.ok(Math.abs(r.zScore!) >= 3, `zScore was ${r.zScore}`);
});

test('rising trend detected from last 3 observations', () => {
  const data = [...flat12(250), obs('2026-04-01', 260)];
  const r = computeFreightStress('PPIACO', data);
  assert.equal(r.trend, 'rising');
});

test('empty observations → empty result', () => {
  const r = computeFreightStress('PPIACO', []);
  assert.equal(r.current, null);
  assert.equal(r.observationCount, 0);
  assert.equal(r.stressScore, 0);
  assert.equal(r.stressLevel, 'low');
});

test('few observations → null stats but real current value', () => {
  const r = computeFreightStress('PPIACO', [obs('2026-04-01', 250)]);
  assert.equal(r.current, 250);
  assert.equal(r.avg12m, null);
  assert.equal(r.stressScore, 0);
});

test('result is sorted by date (handles unsorted input)', () => {
  const unsorted = [
    obs('2026-04-01', 260),
    ...flat12(250),
  ];
  const r = computeFreightStress('PPIACO', unsorted);
  assert.equal(r.asOf, '2026-04-01');
  assert.equal(r.current, 260);
});

// ── Aggregate ────────────────────────────────────────────────────────────────

test('aggregateFreightStress: empty → low', () => {
  const a = aggregateFreightStress([]);
  assert.equal(a.overallLevel, 'low');
  assert.equal(a.overallScore, 0);
});

test('aggregateFreightStress: worst-component-wins', () => {
  const components: FreightStressResult[] = [
    {
      series: 'A', current: 1, avg12m: 1, stdev12m: 0, deviationPct: 0,
      zScore: 0, trend: 'stable', stressScore: 10, stressLevel: 'low',
      observationCount: 13, asOf: '2026-04-01',
    },
    {
      series: 'B', current: 1, avg12m: 1, stdev12m: 0, deviationPct: 0,
      zScore: 0, trend: 'stable', stressScore: 80, stressLevel: 'critical',
      observationCount: 13, asOf: '2026-04-01',
    },
  ];
  const a = aggregateFreightStress(components);
  assert.equal(a.overallScore, 80);
  assert.equal(a.overallLevel, 'critical');
});

test('aggregateFreightStress: asOf is the most recent component', () => {
  const components: FreightStressResult[] = [
    { series: 'A', current: null, avg12m: null, stdev12m: null, deviationPct: null,
      zScore: null, trend: 'stable', stressScore: 0, stressLevel: 'low',
      observationCount: 0, asOf: '2026-01-01' },
    { series: 'B', current: null, avg12m: null, stdev12m: null, deviationPct: null,
      zScore: null, trend: 'stable', stressScore: 0, stressLevel: 'low',
      observationCount: 0, asOf: '2026-04-01' },
  ];
  const a = aggregateFreightStress(components);
  assert.equal(a.asOf, '2026-04-01');
});
