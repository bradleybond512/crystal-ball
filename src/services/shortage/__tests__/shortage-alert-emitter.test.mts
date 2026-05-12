import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emitShortageAlerts,
  severityFromScore,
  SHORTAGE_HIGH_THRESHOLD,
  SHORTAGE_CRITICAL_THRESHOLD,
} from '../shortage-alert-emitter.ts';
import type { ShortageSummaryEntry, FullSetCommodity, RiskLevel, Trend } from '../shortage-fullset.ts';

function entry(
  commodity: FullSetCommodity,
  riskScore: number,
  riskLevel: RiskLevel = 'HIGH',
  drivers: string[] = ['benchmark driver'],
  trend: Trend = 'stable',
): ShortageSummaryEntry {
  return {
    commodity,
    riskScore,
    riskLevel,
    primaryDrivers: drivers,
    timeToImpact: '30d',
    trend,
    forecast: {} as unknown as ShortageSummaryEntry['forecast'],
  };
}

test('severityFromScore: <=49 = low, ≥50 = medium, >70 = high, >85 = critical', () => {
  assert.equal(severityFromScore(0), 'low');
  assert.equal(severityFromScore(49), 'low');
  assert.equal(severityFromScore(50), 'medium');
  assert.equal(severityFromScore(70), 'medium');
  assert.equal(severityFromScore(71), 'high');
  assert.equal(severityFromScore(85), 'high');
  assert.equal(severityFromScore(86), 'critical');
  assert.equal(severityFromScore(100), 'critical');
});

test('emitShortageAlerts: first observation above HIGH threshold emits a high alert', () => {
  const { alerts } = emitShortageAlerts(
    [entry('wheat', 75)],
    new Map(),
    1_000,
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.severity, 'high');
  assert.equal(alerts[0]?.source, 'resource');
  assert.match(alerts[0]?.title ?? '', /Wheat shortage risk: HIGH/);
});

test('emitShortageAlerts: first observation above CRITICAL threshold emits a critical alert (not high)', () => {
  const { alerts } = emitShortageAlerts(
    [entry('corn', 92)],
    new Map(),
    1_000,
  );
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.severity, 'critical');
  assert.match(alerts[0]?.title ?? '', /Corn shortage risk: CRITICAL/);
});

test('emitShortageAlerts: stays-high does not re-emit on consecutive renders', () => {
  let prev = new Map<FullSetCommodity, number>();
  const first = emitShortageAlerts([entry('wheat', 75)], prev, 1_000);
  prev = first.nextPreviousScores;
  assert.equal(first.alerts.length, 1);
  const second = emitShortageAlerts([entry('wheat', 78)], prev, 2_000);
  assert.equal(second.alerts.length, 0);
});

test('emitShortageAlerts: a drop below HIGH then re-cross fires again', () => {
  let prev = new Map<FullSetCommodity, number>();
  prev = emitShortageAlerts([entry('wheat', 75)], prev, 1_000).nextPreviousScores;
  prev = emitShortageAlerts([entry('wheat', 40)], prev, 2_000).nextPreviousScores;
  const third = emitShortageAlerts([entry('wheat', 80)], prev, 3_000);
  assert.equal(third.alerts.length, 1);
  assert.equal(third.alerts[0]?.severity, 'high');
});

test('emitShortageAlerts: high → critical promotes by emitting a critical alert', () => {
  let prev = new Map<FullSetCommodity, number>();
  prev = emitShortageAlerts([entry('diesel', 75)], prev, 1_000).nextPreviousScores;
  const next = emitShortageAlerts([entry('diesel', 90)], prev, 2_000);
  assert.equal(next.alerts.length, 1);
  assert.equal(next.alerts[0]?.severity, 'critical');
});

test('emitShortageAlerts: scores at or below threshold do NOT cross', () => {
  const { alerts } = emitShortageAlerts(
    [entry('wheat', SHORTAGE_HIGH_THRESHOLD)],
    new Map(),
    1_000,
  );
  assert.equal(alerts.length, 0);
});

test('emitShortageAlerts: timestamp is reflected in alert id and timestamp', () => {
  const { alerts } = emitShortageAlerts(
    [entry('wheat', 80)],
    new Map(),
    1_700_000_000_000,
  );
  assert.ok(alerts[0]?.id.endsWith('1700000000000'));
  assert.equal(alerts[0]?.timestamp, 1_700_000_000_000);
});

test('emitShortageAlerts: handles many commodities at once and one transition per commodity per call', () => {
  const { alerts } = emitShortageAlerts(
    [
      entry('wheat', 75),
      entry('corn', 95),
      entry('rice', 30),
    ],
    new Map(),
    1_000,
  );
  assert.equal(alerts.length, 2);
  assert.equal(alerts.find((a) => a.title.includes('Wheat'))?.severity, 'high');
  assert.equal(alerts.find((a) => a.title.includes('Corn'))?.severity, 'critical');
});

test('emitShortageAlerts: nextPreviousScores includes EVERY observed commodity (not just the alerting ones)', () => {
  const { nextPreviousScores } = emitShortageAlerts(
    [entry('wheat', 20), entry('corn', 75)],
    new Map(),
    1_000,
  );
  assert.equal(nextPreviousScores.get('wheat'), 20);
  assert.equal(nextPreviousScores.get('corn'), 75);
});

test('SHORTAGE thresholds are 70 and 85 (constants)', () => {
  assert.equal(SHORTAGE_HIGH_THRESHOLD, 70);
  assert.equal(SHORTAGE_CRITICAL_THRESHOLD, 85);
});

test('emitShortageAlerts: existing critical that lingers is not re-emitted', () => {
  const prev = new Map<FullSetCommodity, number>([['corn', 92]]);
  const { alerts } = emitShortageAlerts([entry('corn', 95)], prev, 1_000);
  assert.equal(alerts.length, 0);
});
