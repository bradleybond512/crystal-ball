import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyHazard } from '../weather-threat-types.ts';

test('wildfire smoke: Air Quality / Dense Smoke → wildfire_smoke (not "other")', () => {
  assert.equal(classifyHazard('Air Quality Alert'), 'wildfire_smoke');
  assert.equal(classifyHazard('Dense Smoke Advisory'), 'wildfire_smoke');
  assert.equal(classifyHazard('Blowing Dust and Smoke'), 'wildfire_smoke');
});

test('fire danger stays distinct from smoke', () => {
  assert.equal(classifyHazard('Red Flag Warning'), 'fire_weather');
  assert.equal(classifyHazard('Fire Weather Watch'), 'fire_weather');
});

test('order preserved — flash flood before flood', () => {
  assert.equal(classifyHazard('Flash Flood Warning'), 'flash_flood');
  assert.equal(classifyHazard('Flood Warning'), 'flood');
});

test('unrecognized events fall through to other', () => {
  assert.equal(classifyHazard('Rip Current Statement'), 'other');
});
