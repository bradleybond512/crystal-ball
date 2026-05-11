import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSeriesSnapshot,
  parseFredCsv,
  vixGaugeFor,
  type FredObservation,
} from '../macro-stress.ts';

test('vixGaugeFor: bands', () => {
  assert.equal(vixGaugeFor(10), 'calm');
  assert.equal(vixGaugeFor(19.99), 'calm');
  assert.equal(vixGaugeFor(20), 'elevated');
  assert.equal(vixGaugeFor(29.99), 'elevated');
  assert.equal(vixGaugeFor(30), 'stress');
  assert.equal(vixGaugeFor(39.99), 'stress');
  assert.equal(vixGaugeFor(40), 'crisis');
  assert.equal(vixGaugeFor(80), 'crisis');
});

test('vixGaugeFor: null/NaN → null', () => {
  assert.equal(vixGaugeFor(null), null);
  assert.equal(vixGaugeFor(Number.NaN), null);
});

test('parseFredCsv: parses header + rows, drops "." rows', () => {
  const csv = `DATE,VIXCLS\n2026-04-01,18.5\n2026-04-02,.\n2026-04-03,19.2`;
  const obs = parseFredCsv(csv);
  assert.equal(obs.length, 2);
  assert.deepEqual(obs[0], { date: '2026-04-01', value: 18.5 });
  assert.deepEqual(obs[1], { date: '2026-04-03', value: 19.2 });
});

test('parseFredCsv: tolerates CRLF + trailing blank lines', () => {
  const csv = `DATE,VIXCLS\r\n2026-04-01,18\r\n\r\n`;
  const obs = parseFredCsv(csv);
  assert.equal(obs.length, 1);
});

test('buildSeriesSnapshot: empty input → all-null snapshot', () => {
  const snap = buildSeriesSnapshot('VIXCLS', []);
  assert.equal(snap.current, null);
  assert.equal(snap.asOf, null);
  assert.equal(snap.zScore, null);
});

test('buildSeriesSnapshot: VIX gauge propagates when isVix', () => {
  const obs: FredObservation[] = [{ date: '2026-04-01', value: 35 }];
  const snap = buildSeriesSnapshot('VIXCLS', obs, { isVix: true });
  assert.equal(snap.vixGauge, 'stress');
});

test('buildSeriesSnapshot: FX series → vixGauge null', () => {
  const obs: FredObservation[] = [{ date: '2026-04-01', value: 1.08 }];
  const snap = buildSeriesSnapshot('DEXUSEU', obs);
  assert.equal(snap.vixGauge, null);
});

test('buildSeriesSnapshot: z-score on flat data is 0', () => {
  const obs: FredObservation[] = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-04-${String(i + 1).padStart(2, '0')}`,
    value: 18,
  }));
  const snap = buildSeriesSnapshot('VIXCLS', obs);
  assert.equal(snap.zScore, null); // stddev=0 → null
  assert.equal(snap.mean30, 18);
});

test('buildSeriesSnapshot: z-score positive when current spikes above mean', () => {
  const flat: FredObservation[] = Array.from({ length: 28 }, (_, i) => ({
    date: `2026-04-${String(i + 1).padStart(2, '0')}`,
    value: 18 + (i % 2 === 0 ? 0.5 : -0.5),
  }));
  const obs: FredObservation[] = [
    ...flat,
    { date: '2026-04-29', value: 35 },
    { date: '2026-04-30', value: 36 },
  ];
  const snap = buildSeriesSnapshot('VIXCLS', obs);
  assert.ok(snap.zScore !== null && snap.zScore > 1, `z too low: ${snap.zScore}`);
});

test('buildSeriesSnapshot: trend rising when last 5 > prior 5 by >5%', () => {
  const obs: FredObservation[] = [
    ...Array.from({ length: 5 }, (_, i) => ({ date: `d${i}`, value: 18 })),
    ...Array.from({ length: 5 }, (_, i) => ({ date: `d${i + 5}`, value: 25 })),
  ];
  const snap = buildSeriesSnapshot('VIXCLS', obs);
  assert.equal(snap.trend, 'rising');
});

test('buildSeriesSnapshot: trend falling when last 5 < prior 5 by >5%', () => {
  const obs: FredObservation[] = [
    ...Array.from({ length: 5 }, (_, i) => ({ date: `d${i}`, value: 25 })),
    ...Array.from({ length: 5 }, (_, i) => ({ date: `d${i + 5}`, value: 18 })),
  ];
  const snap = buildSeriesSnapshot('VIXCLS', obs);
  assert.equal(snap.trend, 'falling');
});

test('buildSeriesSnapshot: trend stable when within 5%', () => {
  const obs: FredObservation[] = [
    ...Array.from({ length: 5 }, (_, i) => ({ date: `d${i}`, value: 18 })),
    ...Array.from({ length: 5 }, (_, i) => ({ date: `d${i + 5}`, value: 18.4 })),
  ];
  const snap = buildSeriesSnapshot('VIXCLS', obs);
  assert.equal(snap.trend, 'stable');
});

test('buildSeriesSnapshot: insufficient data → trend stable', () => {
  const snap = buildSeriesSnapshot('VIXCLS', [{ date: 'd1', value: 18 }]);
  assert.equal(snap.trend, 'stable');
});
