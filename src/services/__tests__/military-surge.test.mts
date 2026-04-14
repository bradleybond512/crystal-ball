import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectMultiTheaterCoordination,
  multiTheaterToSignal,
} from '../military-surge.ts';
import type { SurgeAlert } from '../military-surge.ts';

function makeSurge(overrides: Partial<SurgeAlert> = {}): SurgeAlert {
  return {
    id: 'fighter-iran-theater',
    theater: { id: 'iran-theater', name: 'Iran Theater', baseIds: [], centerLat: 27, centerLon: 51 },
    type: 'fighter',
    currentCount: 10,
    baselineCount: 3,
    surgeMultiple: 3.3,
    aircraftTypes: new Map([['F-15', 6], ['F-16', 4]]),
    nearbyBases: ['Al Udeid'],
    firstDetected: new Date(),
    lastUpdated: new Date(),
    ...overrides,
  };
}

test('returns empty when fewer than 2 theaters', () => {
  const surges = [makeSurge()];
  const result = detectMultiTheaterCoordination(surges);
  assert.equal(result.length, 0);
});

test('detects coordination across 2 theaters within 4h window', () => {
  const now = new Date();
  const surges = [
    makeSurge({ id: 'fighter-iran', theater: { id: 'iran-theater-a', name: 'Iran Theater', baseIds: [], centerLat: 27, centerLon: 51 }, firstDetected: now }),
    makeSurge({ id: 'fighter-taiwan', theater: { id: 'taiwan-theater-a', name: 'Taiwan Strait', baseIds: [], centerLat: 24, centerLon: 121 }, firstDetected: new Date(now.getTime() + 60 * 60 * 1000) }),
  ];
  const result = detectMultiTheaterCoordination(surges);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.theaters.length, 2);
  assert.equal(result[0]!.severity, 'critical');
});

test('does not detect coordination outside 4h window', () => {
  const now = new Date();
  const surges = [
    makeSurge({ id: 'fighter-iran', theater: { id: 'iran-theater-b', name: 'Iran Theater', baseIds: [], centerLat: 27, centerLon: 51 }, firstDetected: now }),
    makeSurge({ id: 'fighter-taiwan', theater: { id: 'taiwan-theater-b', name: 'Taiwan Strait', baseIds: [], centerLat: 24, centerLon: 121 }, firstDetected: new Date(now.getTime() + 5 * 60 * 60 * 1000) }),
  ];
  const result = detectMultiTheaterCoordination(surges);
  assert.equal(result.length, 0);
});

test('multiTheaterToSignal produces valid signal', () => {
  const now = new Date();
  const surges = [
    makeSurge({ id: 'fighter-iran', theater: { id: 'iran-theater-c', name: 'Iran Theater', baseIds: [], centerLat: 27, centerLon: 51 }, firstDetected: now }),
    makeSurge({ id: 'fighter-taiwan', theater: { id: 'taiwan-theater-c', name: 'Taiwan Strait', baseIds: [], centerLat: 24, centerLon: 121 }, firstDetected: now }),
  ];
  const alerts = detectMultiTheaterCoordination(surges);
  assert.equal(alerts.length, 1);
  const signal = multiTheaterToSignal(alerts[0]!);
  assert.equal(signal.type, 'military_surge');
  assert.equal(signal.severity, 'critical');
  assert.equal(signal.category, 'military');
  assert.ok(signal.confidence > 0 && signal.confidence <= 1);
});
