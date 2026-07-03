import assert from 'node:assert/strict';
import test from 'node:test';

import { selectPostureCards } from '../storm-posture-view.ts';
import type {
  AxisState,
  PostureThreat,
  SurvivalAxis,
  SurvivalPosture,
} from '@/services/survival/survival-types.ts';

function makeThreat(): PostureThreat {
  return {
    sourceEventId: 'evt',
    axis: 'physical_safety',
    severity: 50,
    threatLevel: 'warning',
    hazardKind: 'severe_thunderstorm',
    hazardLabel: 'Severe Thunderstorm Warning',
    timeToImpactMins: 30,
    arrivalLabel: '30-40 min',
    why: 'polygon overlaps saved place',
    confidenceLabel: 'high',
  };
}

function makeAxis(axis: SurvivalAxis, level: number, threatCount: number): AxisState {
  return {
    axis,
    level,
    band: 'secure',
    trend: 'steady',
    threats: Array.from({ length: threatCount }, () => makeThreat()),
    confidence: { total: 0, max: 0, items: [] },
    explanation: { headline: '', lines: [], missingConfirmation: [] },
    drivers: [],
  };
}

function makePosture(specs: Array<{ axis: SurvivalAxis; level: number; threatCount: number }>): SurvivalPosture {
  return {
    axes: specs.map((s) => makeAxis(s.axis, s.level, s.threatCount)),
    overallLevel: 0,
    overallBand: 'secure',
    worstAxis: 'physical_safety',
    headline: '',
    capturedAtMs: 0,
    staleInputs: [],
  };
}

test('all-secure returns only physical_safety', () => {
  const posture = makePosture([
    { axis: 'physical_safety', level: 0, threatCount: 0 },
    { axis: 'supply', level: 0, threatCount: 0 },
    { axis: 'energy_water', level: 0, threatCount: 0 },
  ]);
  assert.deepEqual(selectPostureCards(posture).map((a) => a.axis), ['physical_safety']);
});

test('active supply axis surfaces after anchored physical_safety', () => {
  const posture = makePosture([
    { axis: 'physical_safety', level: 0, threatCount: 0 },
    { axis: 'supply', level: 60, threatCount: 2 },
  ]);
  assert.deepEqual(selectPostureCards(posture).map((a) => a.axis), ['physical_safety', 'supply']);
});

test('multiple active axes sort worst-first after physical anchor', () => {
  const posture = makePosture([
    { axis: 'physical_safety', level: 0, threatCount: 0 },
    { axis: 'supply', level: 70, threatCount: 1 },
    { axis: 'energy_water', level: 40, threatCount: 1 },
  ]);
  assert.deepEqual(
    selectPostureCards(posture).map((a) => a.axis),
    ['physical_safety', 'supply', 'energy_water'],
  );
});

test('active physical + active supply returns both', () => {
  const posture = makePosture([
    { axis: 'physical_safety', level: 50, threatCount: 1 },
    { axis: 'supply', level: 30, threatCount: 1 },
  ]);
  assert.deepEqual(selectPostureCards(posture).map((a) => a.axis), ['physical_safety', 'supply']);
});

test('non-physical axis with level but no threats is excluded', () => {
  const posture = makePosture([
    { axis: 'physical_safety', level: 0, threatCount: 0 },
    { axis: 'supply', level: 45, threatCount: 0 },
  ]);
  assert.deepEqual(selectPostureCards(posture).map((a) => a.axis), ['physical_safety']);
});
