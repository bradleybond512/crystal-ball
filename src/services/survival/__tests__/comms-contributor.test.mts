import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCommsContributor } from '../comms-contributor.ts';
import type { IodaOutage } from '../../internet-outages.ts';

const NOW = 1_700_000_000_000;

function outage(over: Partial<IodaOutage> = {}): IodaOutage {
  return {
    id: 'ioda-US-1700',
    entityType: 'country',
    entityName: 'United States',
    entityCode: 'US',
    score: 0.9,
    overallScore: 0.9,
    bgpScore: 0.9,
    activeScore: 0.8,
    darknetsScore: 0.7,
    startTime: new Date(NOW),
    endTime: null,
    isOngoing: true,
    severity: 'critical',
    ...over,
  };
}

test('empty input produces no threats', () => {
  assert.deepEqual(makeCommsContributor([]).contribute(NOW), []);
});

test('low-severity outage produces no threat', () => {
  const threats = makeCommsContributor([outage({ severity: 'low', score: 0.15 })]).contribute(NOW);
  assert.deepEqual(threats, []);
});

test('resolved (not ongoing) outage is dropped even if critical', () => {
  const threats = makeCommsContributor([outage({ isOngoing: false })]).contribute(NOW);
  assert.deepEqual(threats, []);
});

test('medium -> watch (severity 30)', () => {
  const t = makeCommsContributor([outage({ severity: 'medium', score: 0.3, entityType: 'asn' })]).contribute(NOW);
  assert.equal(t.length, 1);
  assert.equal(t[0]!.axis, 'comms');
  assert.equal(t[0]!.threatLevel, 'watch');
  assert.equal(t[0]!.severity, 30);
});

test('high -> advisory (severity 50)', () => {
  const t = makeCommsContributor([outage({ severity: 'high', score: 0.6, entityType: 'asn' })]).contribute(NOW);
  assert.equal(t[0]!.threatLevel, 'advisory');
  assert.equal(t[0]!.severity, 50);
});

test('critical AS/region outage -> warning (severity 75), not emergency', () => {
  const t = makeCommsContributor([outage({ severity: 'critical', entityType: 'asn', score: 0.85 })]).contribute(NOW);
  assert.equal(t[0]!.threatLevel, 'warning');
  assert.equal(t[0]!.severity, 75);
});

test('critical REGION-level outage -> warning (only country escalates to emergency)', () => {
  const t = makeCommsContributor([outage({ severity: 'critical', entityType: 'region', score: 0.9 })]).contribute(NOW);
  assert.equal(t[0]!.threatLevel, 'warning');
  assert.equal(t[0]!.severity, 75);
});

test('critical COUNTRY-level outage escalates to emergency (severity 95)', () => {
  const t = makeCommsContributor([outage({ severity: 'critical', entityType: 'country', score: 0.95 })]).contribute(NOW);
  assert.equal(t[0]!.threatLevel, 'emergency');
  assert.equal(t[0]!.severity, 95);
});

test('confidence: >=2 corroborating IODA sub-signals -> high, else medium', () => {
  const corroborated = makeCommsContributor([
    outage({ severity: 'high', entityType: 'asn', bgpScore: 0.6, activeScore: 0.5, darknetsScore: null }),
  ]).contribute(NOW);
  assert.equal(corroborated[0]!.confidenceLabel, 'high');

  const single = makeCommsContributor([
    outage({ severity: 'high', entityType: 'asn', bgpScore: 0.6, activeScore: null, darknetsScore: null }),
  ]).contribute(NOW);
  assert.equal(single[0]!.confidenceLabel, 'medium');
});

test('why string carries severity, scope and IODA score; asn scope reads "network"', () => {
  const t = makeCommsContributor([
    outage({ severity: 'high', entityType: 'asn', score: 0.62 }),
  ]).contribute(NOW)[0]!;
  assert.match(t.why, /high network-level internet outage/);
  assert.match(t.why, /IODA score 0\.62/);
  assert.match(t.why, /ongoing/);
});

test('sourceEventId is the IODA outage id; hazardKind is "other"', () => {
  const t = makeCommsContributor([outage({ id: 'ioda-IR-42' })]).contribute(NOW)[0]!;
  assert.equal(t.sourceEventId, 'ioda-IR-42');
  assert.equal(t.hazardKind, 'other');
  assert.equal(t.timeToImpactMins, null);
  assert.equal(t.arrivalLabel, null);
});

test('multiple ongoing outages sort worst-first, same-band tie-break on IODA score', () => {
  const threats = makeCommsContributor([
    outage({ id: 'a', severity: 'high', entityType: 'asn', score: 0.55 }),
    outage({ id: 'b', severity: 'critical', entityType: 'country', score: 0.95 }),
    outage({ id: 'c', severity: 'critical', entityType: 'asn', score: 0.88 }),
    outage({ id: 'd', severity: 'critical', entityType: 'asn', score: 0.82 }),
  ]).contribute(NOW);
  // emergency (country critical, 95) first, then the two asn-critical warnings by
  // descending score (0.88 before 0.82), then the high advisory.
  assert.deepEqual(threats.map((t) => t.sourceEventId), ['b', 'c', 'd', 'a']);
  assert.deepEqual(threats.map((t) => t.severity), [95, 75, 75, 50]);
});

test('only ongoing, above-none outages surface from a mixed set', () => {
  const threats = makeCommsContributor([
    outage({ id: 'past', isOngoing: false, severity: 'critical' }),
    outage({ id: 'low', severity: 'low', score: 0.1 }),
    outage({ id: 'live', severity: 'high', entityType: 'asn', score: 0.6 }),
  ]).contribute(NOW);
  assert.equal(threats.length, 1);
  assert.equal(threats[0]!.sourceEventId, 'live');
});
