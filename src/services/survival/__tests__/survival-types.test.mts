// src/services/survival/__tests__/survival-types.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SURVIVAL_AXES,
  bandForLevel,
  threatLevelToSeverity,
  axisLabel,
} from '../survival-types.ts';

test('there are 8 survival axes including physical_safety', () => {
  assert.equal(SURVIVAL_AXES.length, 8);
  assert.ok(SURVIVAL_AXES.includes('physical_safety'));
});

test('bandForLevel maps numeric level to the 5-band ladder', () => {
  assert.equal(bandForLevel(0), 'secure');
  assert.equal(bandForLevel(19), 'secure');
  assert.equal(bandForLevel(20), 'guarded');
  assert.equal(bandForLevel(40), 'elevated');
  assert.equal(bandForLevel(60), 'high');
  assert.equal(bandForLevel(80), 'critical');
  assert.equal(bandForLevel(100), 'critical');
});

test('threatLevelToSeverity escalates monotonically', () => {
  assert.equal(threatLevelToSeverity('none'), 0);
  assert.ok(threatLevelToSeverity('watch') < threatLevelToSeverity('warning'));
  assert.equal(threatLevelToSeverity('emergency'), 95);
});

test('axisLabel returns a human label', () => {
  assert.equal(axisLabel('physical_safety'), 'Physical safety');
  assert.equal(axisLabel('energy_water'), 'Energy & water');
});
