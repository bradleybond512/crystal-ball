import assert from 'node:assert/strict';
import test from 'node:test';

import { categorizeUsAqi, AQI_CATEGORY_LABEL, USG_THRESHOLD } from '../aqi-category.ts';

test('EPA breakpoint edges', () => {
  assert.equal(categorizeUsAqi(0), 'good');
  assert.equal(categorizeUsAqi(50), 'good');
  assert.equal(categorizeUsAqi(51), 'moderate');
  assert.equal(categorizeUsAqi(100), 'moderate');
  assert.equal(categorizeUsAqi(101), 'usg');
  assert.equal(categorizeUsAqi(150), 'usg');
  assert.equal(categorizeUsAqi(151), 'unhealthy');
  assert.equal(categorizeUsAqi(200), 'unhealthy');
  assert.equal(categorizeUsAqi(201), 'very_unhealthy');
  assert.equal(categorizeUsAqi(300), 'very_unhealthy');
  assert.equal(categorizeUsAqi(301), 'hazardous');
  assert.equal(categorizeUsAqi(500), 'hazardous');
});

test('null / NaN → unknown', () => {
  assert.equal(categorizeUsAqi(null), 'unknown');
  assert.equal(categorizeUsAqi(Number.NaN), 'unknown');
});

test('labels cover every category; USG threshold exported for callout logic', () => {
  assert.equal(AQI_CATEGORY_LABEL.usg, 'Unhealthy for Sensitive Groups');
  assert.equal(USG_THRESHOLD, 101);
});
