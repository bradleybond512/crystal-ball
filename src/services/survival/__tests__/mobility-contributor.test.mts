import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMobilityContributor } from '../mobility-contributor.ts';
import type { ChokepointStatus, ChokepointId } from '../../maritime/chokepoint-monitor.ts';

const NOW = 1_700_000_000_000;

function status(over: Partial<ChokepointStatus> = {}): ChokepointStatus {
  return {
    id: 'hormuz' as ChokepointId,
    name: 'Strait of Hormuz',
    lat: 26.6,
    lon: 56.3,
    vesselCount24h: 40,
    militaryVesselCount: 0,
    incidentCount7d: 0,
    closureRisk: 0,
    primaryCommodities: ['crude oil'],
    globalTradePctNote: '~20% of global oil',
    lastIncident: null,
    threatLevel: 'green',
    drivers: [],
    ...over,
  };
}

test('all-green chokepoints produce no threats', () => {
  const c = makeMobilityContributor([status(), status({ id: 'suez', name: 'Suez Canal' })]);
  assert.deepEqual(c.contribute(NOW), []);
});

test('empty input produces no threats', () => {
  assert.deepEqual(makeMobilityContributor([]).contribute(NOW), []);
});

test('yellow -> one watch mobility threat (severity 30)', () => {
  const threats = makeMobilityContributor([status({ threatLevel: 'yellow', closureRisk: 25 })]).contribute(NOW);
  assert.equal(threats.length, 1);
  const t = threats[0]!;
  assert.equal(t.axis, 'mobility');
  assert.equal(t.threatLevel, 'watch');
  assert.equal(t.severity, 30);
  assert.equal(t.sourceEventId, 'chokepoint-hormuz');
});

test('orange -> advisory (severity 50)', () => {
  const threats = makeMobilityContributor([status({ threatLevel: 'orange', closureRisk: 55 })]).contribute(NOW);
  assert.equal(threats.length, 1);
  assert.equal(threats[0]!.threatLevel, 'advisory');
  assert.equal(threats[0]!.severity, 50);
});

test('red below emergency threshold -> warning (severity 75)', () => {
  const threats = makeMobilityContributor([status({ threatLevel: 'red', closureRisk: 80 })]).contribute(NOW);
  assert.equal(threats.length, 1);
  assert.equal(threats[0]!.threatLevel, 'warning');
  assert.equal(threats[0]!.severity, 75);
});

test('red at/above closureRisk 90 -> emergency (severity 95)', () => {
  const threats = makeMobilityContributor([status({ threatLevel: 'red', closureRisk: 92 })]).contribute(NOW);
  assert.equal(threats.length, 1);
  assert.equal(threats[0]!.threatLevel, 'emergency');
  assert.equal(threats[0]!.severity, 95);
});

test('red at exactly closureRisk 90 -> emergency (boundary)', () => {
  const threats = makeMobilityContributor([status({ threatLevel: 'red', closureRisk: 90 })]).contribute(NOW);
  assert.equal(threats[0]!.threatLevel, 'emergency');
});

test('red at closureRisk 89 -> warning (boundary just below)', () => {
  const threats = makeMobilityContributor([status({ threatLevel: 'red', closureRisk: 89 })]).contribute(NOW);
  assert.equal(threats[0]!.threatLevel, 'warning');
});

test('incidents in window -> high confidence; military-only -> medium', () => {
  const withIncidents = makeMobilityContributor([
    status({ threatLevel: 'orange', closureRisk: 50, incidentCount7d: 3 }),
  ]).contribute(NOW);
  assert.equal(withIncidents[0]!.confidenceLabel, 'high');

  const militaryOnly = makeMobilityContributor([
    status({ threatLevel: 'orange', closureRisk: 50, incidentCount7d: 0, militaryVesselCount: 6 }),
  ]).contribute(NOW);
  assert.equal(militaryOnly[0]!.confidenceLabel, 'medium');
});

test('why string carries the top driver, trade note and closure risk', () => {
  const t = makeMobilityContributor([
    status({ threatLevel: 'red', closureRisk: 82, drivers: ['2 attacks in 7d', 'military buildup'] }),
  ]).contribute(NOW)[0]!;
  assert.match(t.why, /2 attacks in 7d/);
  assert.match(t.why, /~20% of global oil/);
  assert.match(t.why, /closure risk 82\/100/);
});

test('driver-less status falls back to a generic reason', () => {
  const t = makeMobilityContributor([
    status({ threatLevel: 'yellow', closureRisk: 20, drivers: [] }),
  ]).contribute(NOW)[0]!;
  assert.match(t.why, /Elevated closure risk/);
});

test('multiple active chokepoints sort worst-first, ties broken by id', () => {
  const threats = makeMobilityContributor([
    status({ id: 'suez', name: 'Suez', threatLevel: 'yellow', closureRisk: 20 }),
    status({ id: 'hormuz', name: 'Hormuz', threatLevel: 'red', closureRisk: 95 }),
    status({ id: 'malacca', name: 'Malacca', threatLevel: 'orange', closureRisk: 50 }),
    status({ id: 'panama', name: 'Panama', threatLevel: 'red', closureRisk: 80 }),
  ]).contribute(NOW);
  assert.deepEqual(
    threats.map((t) => t.sourceEventId),
    ['chokepoint-hormuz', 'chokepoint-panama', 'chokepoint-malacca', 'chokepoint-suez'],
  );
  // Emergency first (95 severity), then the warning, advisory, watch.
  assert.deepEqual(threats.map((t) => t.severity), [95, 75, 50, 30]);
});

test('same-severity chokepoints tie-break on closure risk (higher leads)', () => {
  const threats = makeMobilityContributor([
    status({ id: 'suez', name: 'Suez', threatLevel: 'red', closureRisk: 80 }),
    status({ id: 'hormuz', name: 'Hormuz', threatLevel: 'red', closureRisk: 89 }),
  ]).contribute(NOW);
  // Both are sub-90 reds → both severity 75; the higher closure risk (89) leads.
  assert.deepEqual(threats.map((t) => t.severity), [75, 75]);
  assert.deepEqual(
    threats.map((t) => t.sourceEventId),
    ['chokepoint-hormuz', 'chokepoint-suez'],
  );
});

test('only stressed chokepoints surface; greens are dropped from a mixed set', () => {
  const threats = makeMobilityContributor([
    status({ id: 'suez', name: 'Suez', threatLevel: 'green', closureRisk: 5 }),
    status({ id: 'hormuz', name: 'Hormuz', threatLevel: 'orange', closureRisk: 45 }),
    status({ id: 'panama', name: 'Panama', threatLevel: 'green', closureRisk: 0 }),
  ]).contribute(NOW);
  assert.equal(threats.length, 1);
  assert.equal(threats[0]!.sourceEventId, 'chokepoint-hormuz');
});

test('every emitted threat is on the mobility axis with an "other" hazardKind', () => {
  const threats = makeMobilityContributor([
    status({ id: 'suez', threatLevel: 'yellow', closureRisk: 20 }),
    status({ id: 'hormuz', threatLevel: 'red', closureRisk: 95 }),
  ]).contribute(NOW);
  for (const t of threats) {
    assert.equal(t.axis, 'mobility');
    assert.equal(t.hazardKind, 'other');
    assert.equal(t.timeToImpactMins, null);
    assert.equal(t.arrivalLabel, null);
  }
});
