import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_MODES, allModes, modeForLayer, toggleMode, isolateMode,
  activeLayers, resolveLayerVisibility, UNMANAGED_LAYERS, type MapLayerId,
} from '../map-modes.ts';
import { SURVIVAL_AXES } from '../survival-types.ts';

// Every MapLayers key must be either owned by exactly one mode or explicitly
// unmanaged — kept in sync with the MapLayers interface. tsc guards each id is a
// valid key; this list guards completeness (a new unassigned layer fails below).
const ALL_MAP_LAYER_IDS: readonly MapLayerId[] = [
  'conflicts', 'bases', 'cables', 'pipelines', 'hotspots', 'ais', 'nuclear', 'irradiators',
  'sanctions', 'weather', 'economic', 'waterways', 'outages', 'cyberThreats', 'datacenters',
  'protests', 'flights', 'military', 'natural', 'spaceports', 'minerals', 'fires', 'ucdpEvents',
  'airstrikes', 'strikePackages', 'displacement', 'climate', 'startupHubs', 'cloudRegions',
  'accelerators', 'techHQs', 'techEvents', 'stockExchanges', 'financialCenters', 'centralBanks',
  'commodityHubs', 'gulfInvestments', 'positiveEvents', 'kindness', 'happiness', 'speciesRecovery',
  'renewableInstallations', 'tradeRoutes', 'iranAttacks', 's2pimu', 'gpsJamming', 'dayNight',
  'faaWeatherCams', 'airSmoke', 'adsb', 'acledEvents', 'militaryFlights', 'aviationIntel',
  'diseaseIntel', 'forecastOverlay', 'theaterPolygons', 'convergenceRings', 'threatHeatmap',
  'sigintConvergence', 'weatherRadar', 'weatherSatellite', 'lightning', 'owmTemperature',
  'owmPrecipitation', 'owmClouds', 'owmWind', 'redFlagWarnings', 'weatherHazards', 'wastewaterStates',
  'buildings3d', 'satellites', 'aircraft3d', 'streetTiles', 'navigationRoute', 'volcanoMonitor',
  'severeWeatherPolygons', 'shakemapOverlay',
];

test('there is exactly one map mode per survival axis', () => {
  assert.equal(allModes().length, SURVIVAL_AXES.length);
  for (const axis of SURVIVAL_AXES) {
    assert.ok(MAP_MODES[axis], `mode for ${axis}`);
    assert.equal(MAP_MODES[axis].axis, axis);
    assert.ok(MAP_MODES[axis].layers.length > 0, `${axis} has layers`);
  }
});

test('modes are disjoint — no layer belongs to two modes', () => {
  const seen = new Map<MapLayerId, string>();
  for (const axis of SURVIVAL_AXES) {
    for (const layer of MAP_MODES[axis].layers) {
      assert.equal(seen.get(layer), undefined, `${layer} in both ${seen.get(layer)} and ${axis}`);
      seen.set(layer, axis);
    }
  }
});

test('modeForLayer returns the owning axis, or null for unmanaged layers', () => {
  assert.equal(modeForLayer('cables'), 'comms');
  assert.equal(modeForLayer('stockExchanges'), 'financial');
  assert.equal(modeForLayer('conflicts'), 'security');
  assert.equal(modeForLayer('dayNight'), null); // base furniture, no mode
});

test('coverage: every MapLayers key is mode-managed or explicitly unmanaged (no gaps)', () => {
  const managed = new Set<MapLayerId>(SURVIVAL_AXES.flatMap((a) => MAP_MODES[a].layers));
  const unmanaged = new Set<MapLayerId>(UNMANAGED_LAYERS);
  const uncovered = ALL_MAP_LAYER_IDS.filter((id) => !managed.has(id) && !unmanaged.has(id));
  assert.deepEqual(uncovered, [], `unassigned layers: ${uncovered.join(', ')}`);
  // ...and the two sets are disjoint (a layer can't be both managed and unmanaged).
  const overlap = [...unmanaged].filter((id) => managed.has(id));
  assert.deepEqual(overlap, [], `layers both managed and unmanaged: ${overlap.join(', ')}`);
});

test('toggleMode adds a mode when absent', () => {
  assert.deepEqual(toggleMode([], 'security'), ['security']);
});

test('toggleMode removes a mode when present', () => {
  assert.deepEqual(toggleMode(['security', 'health'], 'security'), ['health']);
});

test('toggleMode returns the active set in registry order', () => {
  // security is registered after health; the result stays registry-ordered
  // regardless of toggle order.
  assert.deepEqual(toggleMode(toggleMode([], 'security'), 'health'), ['health', 'security']);
  assert.deepEqual(toggleMode(toggleMode([], 'health'), 'security'), ['health', 'security']);
});

test('isolateMode solos a single axis', () => {
  assert.deepEqual(isolateMode('mobility'), ['mobility']);
});

test('activeLayers unions the active modes (and is empty when nothing active)', () => {
  assert.equal(activeLayers([]).size, 0);
  const comms = activeLayers(['comms']);
  assert.ok(comms.has('cables') && comms.has('gpsJamming'));
  const both = activeLayers(['comms', 'health']);
  assert.ok(both.has('cables') && both.has('diseaseIntel'));
  assert.equal(both.size, MAP_MODES.comms.layers.length + MAP_MODES.health.layers.length);
});

test('resolveLayerVisibility: empty active → no overrides (keep base state)', () => {
  assert.deepEqual(resolveLayerVisibility([]), {});
});

test('resolveLayerVisibility: active mode layers true, other mode layers false', () => {
  const vis = resolveLayerVisibility(['comms']);
  assert.equal(vis.cables, true);
  assert.equal(vis.gpsJamming, true);
  // A security layer is mode-managed but not active → explicitly hidden.
  assert.equal(vis.conflicts, false);
  // A financial layer likewise hidden.
  assert.equal(vis.stockExchanges, false);
});

test('resolveLayerVisibility never touches non-mode (base-furniture) layers', () => {
  const vis = resolveLayerVisibility(['security']);
  assert.ok(!('dayNight' in vis));
  assert.ok(!('satellites' in vis));
  assert.ok(!('buildings3d' in vis));
});

test('resolveLayerVisibility with multiple active modes turns all their layers on', () => {
  const vis = resolveLayerVisibility(['comms', 'health']);
  assert.equal(vis.cables, true);
  assert.equal(vis.diseaseIntel, true);
  assert.equal(vis.wastewaterStates, true);
  assert.equal(vis.conflicts, false); // security not active
});
