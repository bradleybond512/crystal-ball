import assert from 'node:assert/strict';
import test from 'node:test';

import { mapToggleDomain, GLOBE_HEATMAP_CHANGED_EVENT } from '../GlobeHeatmapRenderer.ts';

// ── mapToggleDomain ───────────────────────────────────────────────────

test('mapToggleDomain: seismic stays seismic', () => {
  assert.equal(mapToggleDomain('seismic'), 'seismic');
});

test('mapToggleDomain: legacy "fire" maps to wildfire', () => {
  assert.equal(mapToggleDomain('fire'), 'wildfire');
});

test('mapToggleDomain: native "wildfire" passes through', () => {
  assert.equal(mapToggleDomain('wildfire'), 'wildfire');
});

test('mapToggleDomain: weather + infrastructure pass through', () => {
  assert.equal(mapToggleDomain('weather'), 'weather');
  assert.equal(mapToggleDomain('infrastructure'), 'infrastructure');
});

test('mapToggleDomain: legacy unmapped tags (cyber/conflict) → null', () => {
  assert.equal(mapToggleDomain('cyber'), null);
  assert.equal(mapToggleDomain('conflict'), null);
});

test('mapToggleDomain: null / undefined / empty → null', () => {
  assert.equal(mapToggleDomain(null), null);
  assert.equal(mapToggleDomain(undefined), null);
  assert.equal(mapToggleDomain(''), null);
});

test('GLOBE_HEATMAP_CHANGED_EVENT: stable event name', () => {
  assert.equal(GLOBE_HEATMAP_CHANGED_EVENT, 'wm:globe-heatmap-changed');
});
