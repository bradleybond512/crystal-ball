import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSurvivalMapModes, type MapModeHost } from '../survival-map-modes.ts';
import { resolveLayerVisibility } from '../map-modes.ts';
import { SURVIVAL_AXES } from '../survival-types.ts';
import type { MapLayers } from '../../../types/index.ts';

function layers(over: Partial<MapLayers> = {}): MapLayers {
  const managed = resolveLayerVisibility([...SURVIVAL_AXES]);
  const base: Record<string, boolean> = {};
  for (const k of Object.keys(managed)) base[k] = false;
  base.dayNight = true; // an unmanaged base-map layer the user turned on
  return { ...base, ...over } as MapLayers;
}

function host(initial: MapLayers): MapModeHost & { current: MapLayers; sets: number; persists: boolean[] } {
  return {
    current: initial,
    sets: 0,
    persists: [],
    getLayers() { return this.current; },
    setLayers(next, persist) { this.current = next; this.sets += 1; this.persists.push(persist); },
  };
}

test('toggle: first mode snapshots baseline, lights its layers, dims others', () => {
  const h = host(layers({ conflicts: true })); // user had a security layer on
  const modes = createSurvivalMapModes(h);
  modes.toggle('physical_safety');
  assert.deepEqual([...modes.active()], ['physical_safety']);
  assert.equal(h.current.weather, true);
  assert.equal(h.current.conflicts, false); // security dimmed by isolation
  assert.equal(h.current.dayNight, true);    // unmanaged preserved
});

test('clear: restores the exact pre-mode baseline', () => {
  const h = host(layers({ conflicts: true, weather: false }));
  const modes = createSurvivalMapModes(h);
  modes.toggle('physical_safety'); // weather on, conflicts off
  modes.clear();
  assert.equal(modes.active().length, 0);
  assert.equal(h.current.conflicts, true);  // restored
  assert.equal(h.current.weather, false);   // restored
});

test('toggling the only active mode off clears + restores baseline', () => {
  const h = host(layers({ conflicts: true }));
  const modes = createSurvivalMapModes(h);
  modes.toggle('physical_safety');
  modes.toggle('physical_safety'); // back off
  assert.equal(modes.active().length, 0);
  assert.equal(h.current.conflicts, true); // restored, not left dimmed
});

test('two modes union their layers; baseline stays the first snapshot', () => {
  const h = host(layers());
  const modes = createSurvivalMapModes(h);
  modes.toggle('physical_safety');
  modes.toggle('security');
  assert.equal(h.current.weather, true);
  assert.equal(h.current.conflicts, true);
});

test('isolate: replaces active set with a single axis', () => {
  const h = host(layers());
  const modes = createSurvivalMapModes(h);
  modes.toggle('physical_safety');
  modes.toggle('security');
  modes.isolate('mobility');
  assert.deepEqual([...modes.active()], ['mobility']);
  assert.equal(h.current.ais, true);       // mobility layer
  assert.equal(h.current.weather, false);  // no longer active
});

test('subscribe: fires on changes, unsubscribes cleanly', () => {
  const h = host(layers());
  const modes = createSurvivalMapModes(h);
  let n = 0;
  const off = modes.subscribe(() => { n += 1; });
  modes.toggle('physical_safety');
  modes.clear();
  off();
  modes.toggle('security');
  assert.equal(n, 2); // toggle + clear, not the post-unsubscribe toggle
});

test('persistence: mode changes are transient (persist=false), only clear persists', () => {
  const h = host(layers({ conflicts: true }));
  const modes = createSurvivalMapModes(h);
  modes.toggle('physical_safety'); // apply mode → must NOT persist
  modes.toggle('security');        // still a mode view → must NOT persist
  assert.deepEqual(h.persists, [false, false]);
  modes.clear();                   // restore → persists the user's real layers
  assert.deepEqual(h.persists, [false, false, true]);
});

test('isActive reflects the active set', () => {
  const modes = createSurvivalMapModes(host(layers()));
  assert.equal(modes.isActive('health'), false);
  modes.toggle('health');
  assert.equal(modes.isActive('health'), true);
});
