import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptChokepointInfoToStatus } from '../chokepoint-mobility-adapter.ts';
import { makeMobilityContributor } from '../mobility-contributor.ts';
import type { ChokepointInfo } from '../../supply-chain';

const NOW = 1_700_000_000_000;

function info(over: Partial<ChokepointInfo> = {}): ChokepointInfo {
  return {
    id: '0', name: 'Strait of Hormuz', lat: 0, lon: 0,
    disruptionScore: 80, status: 'Disrupted', activeWarnings: 0,
    congestionLevel: 'High', affectedRoutes: ['crude oil'], description: '~20% of global oil',
    ...over,
  };
}

test('empty input → no statuses', () => {
  assert.deepEqual(adaptChokepointInfoToStatus([]), []);
});

test('disruptionScore maps to closureRisk with the monitor threat bands', () => {
  const bands: Array<[number, string]> = [
    [10, 'green'], [15, 'green'], [16, 'yellow'], [40, 'yellow'],
    [41, 'orange'], [70, 'orange'], [71, 'red'], [95, 'red'],
  ];
  for (const [score, expected] of bands) {
    const [s] = adaptChokepointInfoToStatus([info({ disruptionScore: score })]);
    assert.equal(s!.closureRisk, score);
    assert.equal(s!.threatLevel, expected, `score ${score} → ${expected}`);
  }
});

test('closureRisk is clamped to 0..100 and rounded; non-finite → 0', () => {
  assert.equal(adaptChokepointInfoToStatus([info({ disruptionScore: 140 })])[0]!.closureRisk, 100);
  assert.equal(adaptChokepointInfoToStatus([info({ disruptionScore: -5 })])[0]!.closureRisk, 0);
  assert.equal(adaptChokepointInfoToStatus([info({ disruptionScore: 62.7 })])[0]!.closureRisk, 63);
  assert.equal(adaptChokepointInfoToStatus([info({ disruptionScore: Number.NaN })])[0]!.closureRisk, 0);
});

test('incidentCount7d is 0 (throughput source has no incident history)', () => {
  const [s] = adaptChokepointInfoToStatus([info()]);
  assert.equal(s!.incidentCount7d, 0);
  assert.equal(s!.militaryVesselCount, 0);
  assert.equal(s!.lastIncident, null);
});

test('drivers come from status + congestion; falls back to a generic driver', () => {
  const [withDrivers] = adaptChokepointInfoToStatus([info({ status: 'Blocked', congestionLevel: 'Severe' })]);
  assert.deepEqual(withDrivers!.drivers, ['Blocked', 'Severe']);
  const [noDrivers] = adaptChokepointInfoToStatus([info({ status: '', congestionLevel: '  ' })]);
  assert.deepEqual(noDrivers!.drivers, ['Reduced throughput']);
});

test('name, commodities and trade note are carried through', () => {
  const [s] = adaptChokepointInfoToStatus([info({ name: 'Suez Canal', affectedRoutes: ['a', 'b'], description: 'note' })]);
  assert.equal(s!.name, 'Suez Canal');
  assert.deepEqual(s!.primaryCommodities, ['a', 'b']);
  assert.equal(s!.globalTradePctNote, 'note');
});

test('id falls back to name when the feed id is empty', () => {
  const [s] = adaptChokepointInfoToStatus([info({ id: '', name: 'Bab-el-Mandeb' })]);
  assert.equal(s!.id, 'Bab-el-Mandeb');
});

// ── End-to-end: adapter → mobility contributor produces the expected threats ──

test('adapter output feeds the mobility contributor: red disruption → warning, medium confidence', () => {
  const statuses = adaptChokepointInfoToStatus([info({ id: 'h', disruptionScore: 80, status: 'Disrupted' })]);
  const threats = makeMobilityContributor(statuses).contribute(NOW);
  assert.equal(threats.length, 1);
  const t = threats[0]!;
  assert.equal(t.axis, 'mobility');
  assert.equal(t.threatLevel, 'warning'); // red < 90 closureRisk
  assert.equal(t.severity, 75);
  assert.equal(t.confidenceLabel, 'medium'); // incidentCount7d === 0
  assert.equal(t.sourceEventId, 'chokepoint-h');
});

test('green (low disruption) chokepoints produce no mobility threats', () => {
  const statuses = adaptChokepointInfoToStatus([
    info({ id: 'a', disruptionScore: 5 }),
    info({ id: 'b', disruptionScore: 12 }),
  ]);
  assert.deepEqual(makeMobilityContributor(statuses).contribute(NOW), []);
});

test('closureRisk >= 90 escalates to a mobility emergency through the contributor', () => {
  const statuses = adaptChokepointInfoToStatus([info({ id: 'h', disruptionScore: 95 })]);
  const [t] = makeMobilityContributor(statuses).contribute(NOW);
  assert.equal(t!.threatLevel, 'emergency');
  assert.equal(t!.severity, 95);
});
