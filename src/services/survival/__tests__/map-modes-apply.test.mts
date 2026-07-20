import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyModeVisibility, modeVisibilityDelta } from '../map-modes-apply.ts';
import { resolveLayerVisibility } from '../map-modes.ts';
import { SURVIVAL_AXES, type SurvivalAxis } from '../survival-types.ts';
import type { MapLayers } from '../../../types/index.ts';

// A complete all-managed-layers-off base (+ an unmanaged base-map layer) so the
// merge/delta assertions are exact.
function baseLayers(over: Partial<MapLayers> = {}): MapLayers {
  const allManaged = resolveLayerVisibility([...SURVIVAL_AXES]); // every mode-managed layer
  const off: Record<string, boolean> = {};
  for (const k of Object.keys(allManaged)) off[k] = false;
  off.dayNight = false; // an UNMANAGED base-map layer
  return { ...off, ...over } as MapLayers;
}

test('applyModeVisibility: no active modes → base passes through unchanged (same ref)', () => {
  const b = baseLayers({ conflicts: true });
  assert.equal(applyModeVisibility(b, []), b);
});

test('applyModeVisibility: a mode turns its axis layers on and other axes off', () => {
  const out = applyModeVisibility(baseLayers(), ['physical_safety']);
  assert.equal(out.weather, true);          // physical_safety layer
  assert.equal(out.conflicts, false);       // security layer
  assert.equal(out.ais, false);             // mobility layer
});

test('applyModeVisibility: two active modes union their layer sets', () => {
  const out = applyModeVisibility(baseLayers(), ['physical_safety', 'security'] as SurvivalAxis[]);
  assert.equal(out.weather, true);
  assert.equal(out.conflicts, true);
});

test('applyModeVisibility: unmanaged base-map layers are preserved', () => {
  const out = applyModeVisibility(baseLayers({ dayNight: true }), ['physical_safety']);
  assert.equal(out.dayNight, true); // untouched by mode isolation
});

test('applyModeVisibility: does not mutate the base object', () => {
  const b = baseLayers();
  applyModeVisibility(b, ['security']);
  assert.equal(b.conflicts, false); // base unchanged
});

test('modeVisibilityDelta: reports only the layers that change', () => {
  const delta = modeVisibilityDelta(baseLayers(), ['physical_safety']);
  assert.equal(delta.weather, true);           // false → true, present
  assert.equal('conflicts' in delta, false);   // false → false, absent
  assert.equal('dayNight' in delta, false);    // unmanaged, absent
});

test('modeVisibilityDelta: empty for no active modes', () => {
  assert.deepEqual(modeVisibilityDelta(baseLayers({ weather: true }), []), {});
});
