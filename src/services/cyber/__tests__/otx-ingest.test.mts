/**
 * Pure-transformer tests for src/services/cyber/otx-ingest.ts
 *
 * Verifies that pulses → AptActivityEvent[] dispatches through
 * matchPulseToGroup correctly: matched pulses produce events with the
 * group's TLP severity, unmatched pulses are dropped silently.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AptGroup } from '../apt-tracker.ts';
import { pulsesToActivityEvents } from '../otx-ingest.ts';

const APT28: AptGroup = {
  id: 'G0007', name: 'APT28', aliases: ['Fancy Bear', 'Sofacy'],
  country: 'Russia', targetSectors: [], recentTechniques: [], activityScore: 0,
};

const LAZARUS: AptGroup = {
  id: 'G0032', name: 'Lazarus Group', aliases: ['HIDDEN COBRA'],
  country: 'North Korea', targetSectors: [], recentTechniques: [], activityScore: 0,
};

const pulse = (id: string, adversary: string, modified = '2026-05-01T00:00:00Z') => ({
  id, modified, adversary,
  name: `Pulse on ${adversary}`,
  tags: [adversary],
  industries: ['Government'],
  indicators: [{ indicator: '1.2.3.4', type: 'IPv4' }],
  TLP: 'amber',
});

test('pulsesToActivityEvents: matched pulse → activity event with group fields', () => {
  const events = pulsesToActivityEvents([pulse('p1', 'APT28')], [APT28, LAZARUS]);
  assert.equal(events.length, 1);
  assert.equal(events[0].groupId, 'G0007');
  assert.equal(events[0].source, 'otx');
  assert.equal(events[0].severity, 'high');     // TLP amber → high
});

test('pulsesToActivityEvents: unmatched pulse is silently dropped', () => {
  const events = pulsesToActivityEvents([pulse('p1', 'NotATrackedActor')], [APT28]);
  assert.equal(events.length, 0);
});

test('pulsesToActivityEvents: matches by alias as well as primary name', () => {
  const events = pulsesToActivityEvents([pulse('p1', 'Fancy Bear')], [APT28]);
  assert.equal(events.length, 1);
  assert.equal(events[0].groupId, 'G0007');
});

test('pulsesToActivityEvents: handles mixed matched + unmatched batch', () => {
  const batch = [
    pulse('p1', 'APT28'),
    pulse('p2', 'Unknown'),
    pulse('p3', 'HIDDEN COBRA'),     // alias of Lazarus
  ];
  const events = pulsesToActivityEvents(batch, [APT28, LAZARUS]);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.groupId).sort(), ['G0007', 'G0032']);
});

test('pulsesToActivityEvents: empty inputs return empty', () => {
  assert.deepEqual(pulsesToActivityEvents([], [APT28]), []);
  assert.deepEqual(pulsesToActivityEvents([pulse('p1', 'APT28')], []), []);
});
