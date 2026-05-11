import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshot, diff } from '../what-changed.ts';
import type { ObservationEvent, Correlation } from '../observation-types.ts';

function makeEvent(overrides: Partial<ObservationEvent> & { id: string }): ObservationEvent {
  return {
    domain: 'weather',
    eventType: 'storm',
    title: 'Storm',
    severity: 5,
    occurredAt: 1000,
    entities: [],
    sourceIds: [],
    active: true,
    ...overrides,
  };
}

function makeCorrelation(id: string): Correlation {
  return {
    id,
    events: [],
    type: 'temporal',
    confidence: 0.8,
    title: 'Test correlation',
    detectedAt: 1000,
  };
}

test('snapshot counts events by domain', () => {
  const events = [
    makeEvent({ id: 'e1', domain: 'weather' }),
    makeEvent({ id: 'e2', domain: 'weather' }),
    makeEvent({ id: 'e3', domain: 'earthquake' }),
  ];
  const snap = snapshot(events, []);
  assert.equal(snap.domainCounts['weather'], 2);
  assert.equal(snap.domainCounts['earthquake'], 1);
});

test('snapshot finds max severity per domain', () => {
  const events = [
    makeEvent({ id: 'e1', domain: 'weather', severity: 3 }),
    makeEvent({ id: 'e2', domain: 'weather', severity: 7 }),
    makeEvent({ id: 'e3', domain: 'weather', severity: 5 }),
  ];
  const snap = snapshot(events, []);
  assert.equal(snap.severityByDomain['weather'], 7);
});

test('snapshot only includes active events', () => {
  const events = [
    makeEvent({ id: 'e1', active: true }),
    makeEvent({ id: 'e2', active: false }),
    makeEvent({ id: 'e3', active: true }),
  ];
  const snap = snapshot(events, []);
  assert.equal(snap.eventIds.length, 2);
  assert.ok(snap.eventIds.includes('e1'));
  assert.ok(snap.eventIds.includes('e3'));
  assert.ok(!snap.eventIds.includes('e2'));
});

test('diff finds new events in curr that were not in prev', () => {
  const evPrev = [makeEvent({ id: 'e1', domain: 'aviation' })];
  const evCurr = [
    makeEvent({ id: 'e1', domain: 'aviation' }),
    makeEvent({ id: 'e2', domain: 'aviation' }),
    makeEvent({ id: 'e3', domain: 'earthquake' }),
  ];
  const prev = snapshot(evPrev, []);
  const curr = snapshot(evCurr, []);
  const report = diff(prev, curr);
  assert.deepEqual(report.newEventsByDomain['aviation'], ['e2']);
  assert.deepEqual(report.newEventsByDomain['earthquake'], ['e3']);
  assert.equal(report.totalNewEvents, 2);
});

test('diff finds resolved events (in prev, not in curr)', () => {
  const evPrev = [
    makeEvent({ id: 'e1' }),
    makeEvent({ id: 'e2' }),
  ];
  const evCurr = [
    makeEvent({ id: 'e1' }),
  ];
  const prev = snapshot(evPrev, []);
  const curr = snapshot(evCurr, []);
  const report = diff(prev, curr);
  assert.deepEqual(report.resolvedEventIds, ['e2']);
  assert.equal(report.totalResolved, 1);
});

test('diff detects severity escalation', () => {
  const evPrev = [makeEvent({ id: 'e1', domain: 'weather', severity: 4 })];
  const evCurr = [makeEvent({ id: 'e1', domain: 'weather', severity: 8 })];
  const prev = snapshot(evPrev, []);
  const curr = snapshot(evCurr, []);
  const report = diff(prev, curr);
  assert.equal(report.severityEscalations.length, 1);
  assert.equal(report.severityEscalations[0].domain, 'weather');
  assert.equal(report.severityEscalations[0].from, 4);
  assert.equal(report.severityEscalations[0].to, 8);
});

test('diff detects no escalation when severity stays same', () => {
  const evPrev = [makeEvent({ id: 'e1', domain: 'weather', severity: 6 })];
  const evCurr = [makeEvent({ id: 'e1', domain: 'weather', severity: 6 })];
  const prev = snapshot(evPrev, []);
  const curr = snapshot(evCurr, []);
  const report = diff(prev, curr);
  assert.equal(report.severityEscalations.length, 0);
});

test('diff finds new correlations since prev snapshot', () => {
  const prev = snapshot([], [makeCorrelation('c1')]);
  const curr = snapshot([], [makeCorrelation('c1'), makeCorrelation('c2'), makeCorrelation('c3')]);
  const report = diff(prev, curr);
  assert.deepEqual(report.newCorrelationIds.sort(), ['c2', 'c3']);
});

test('empty diff when snapshots are identical', () => {
  const events = [
    makeEvent({ id: 'e1', domain: 'weather' }),
    makeEvent({ id: 'e2', domain: 'earthquake' }),
  ];
  const corrs = [makeCorrelation('c1')];
  const snap1 = snapshot(events, corrs);
  const snap2 = snapshot(events, corrs);
  const report = diff(snap1, snap2);
  assert.equal(report.totalNewEvents, 0);
  assert.equal(report.totalResolved, 0);
  assert.equal(report.severityEscalations.length, 0);
  assert.equal(report.newCorrelationIds.length, 0);
  assert.deepEqual(report.resolvedEventIds, []);
});

test('totalNewEvents and totalResolved match array lengths', () => {
  const evPrev = [
    makeEvent({ id: 'e1', domain: 'weather' }),
    makeEvent({ id: 'e2', domain: 'weather' }),
  ];
  const evCurr = [
    makeEvent({ id: 'e2', domain: 'weather' }),
    makeEvent({ id: 'e3', domain: 'aviation' }),
    makeEvent({ id: 'e4', domain: 'earthquake' }),
  ];
  const prev = snapshot(evPrev, []);
  const curr = snapshot(evCurr, []);
  const report = diff(prev, curr);
  const sumNew = Object.values(report.newEventsByDomain).reduce((s, ids) => s + ids.length, 0);
  assert.equal(report.totalNewEvents, sumNew);
  assert.equal(report.totalResolved, report.resolvedEventIds.length);
  assert.equal(report.totalNewEvents, 2); // e3, e4
  assert.equal(report.totalResolved, 1);  // e1
});
