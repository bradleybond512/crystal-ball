// src/services/survival/map-modes.ts
/**
 * World Stage map-mode overlay system (Grand-Strategy Survival OS, E4). Promotes
 * the map's ~72 individual layers into 8 toggleable **map modes**, one per
 * survival axis — so the board becomes a set of survival lenses you switch
 * between ("show me the mobility picture", "isolate security") instead of a
 * checklist of layers.
 *
 * Pure state machine + registry; the DeckGL (MapLayers) and Cesium (God's Vision)
 * glue consume `resolveLayerVisibility` / `activeLayers` to flip the underlying
 * layers. Layers that belong to no mode (base-map furniture like dayNight,
 * satellites, buildings3d) are never touched by modes.
 *
 * Contract: an EMPTY active set means "no mode filter" — the map keeps its base
 * layer state. A non-empty active set shows the union of the active modes' layers
 * and hides every OTHER mode-managed layer; non-mode layers stay as they are.
 */
import type { SurvivalAxis } from './survival-types.ts';
import type { MapLayers } from '../../types/index.ts';

export type MapLayerId = keyof MapLayers;

export interface MapMode {
  axis: SurvivalAxis;
  label: string;
  layers: readonly MapLayerId[];
}

export const MAP_MODES: Record<SurvivalAxis, MapMode> = {
  physical_safety: {
    axis: 'physical_safety',
    label: 'Physical safety',
    layers: ['weather', 'weatherRadar', 'weatherSatellite', 'lightning', 'owmTemperature',
      'owmPrecipitation', 'owmClouds', 'owmWind', 'redFlagWarnings', 'weatherHazards',
      'severeWeatherPolygons', 'shakemapOverlay', 'volcanoMonitor', 'fires', 'hotspots',
      'airSmoke', 'smokeForecast', 'natural', 'climate', 'forecastOverlay'],
  },
  supply: {
    axis: 'supply',
    label: 'Supply',
    layers: ['commodityHubs', 'minerals', 'sanctions', 'gulfInvestments'],
  },
  financial: {
    axis: 'financial',
    label: 'Financial',
    layers: ['economic', 'stockExchanges', 'financialCenters', 'centralBanks'],
  },
  mobility: {
    axis: 'mobility',
    label: 'Mobility',
    layers: ['ais', 'flights', 'adsb', 'militaryFlights', 'aviationIntel', 'waterways',
      'tradeRoutes', 'faaWeatherCams', 'aircraft3d'],
  },
  comms: {
    axis: 'comms',
    label: 'Comms',
    layers: ['cables', 'gpsJamming'],
  },
  health: {
    axis: 'health',
    label: 'Health',
    layers: ['diseaseIntel', 'wastewaterStates'],
  },
  energy_water: {
    axis: 'energy_water',
    label: 'Energy & water',
    layers: ['pipelines', 'datacenters', 'cloudRegions', 'renewableInstallations', 'outages'],
  },
  security: {
    axis: 'security',
    label: 'Security',
    layers: ['conflicts', 'bases', 'nuclear', 'irradiators', 'cyberThreats', 'protests',
      'military', 'ucdpEvents', 'airstrikes', 'strikePackages', 'displacement', 'iranAttacks',
      'acledEvents', 'theaterPolygons', 'convergenceRings', 'threatHeatmap', 'spaceports',
      's2pimu', 'sigintConvergence'],
  },
};

/**
 * Layers that intentionally belong to NO survival mode, so mode isolation leaves
 * them untouched:
 *   - variant-specific: `startupHubs`/`accelerators`/`techHQs`/`techEvents`
 *     (tech build) and `positiveEvents`/`kindness`/`happiness`/`speciesRecovery`
 *     (happy build) aren't survival-axis signals;
 *   - base-map furniture: `dayNight`, `satellites`, `buildings3d`, `streetTiles`,
 *     `navigationRoute`.
 * Kept explicit (not just "absent") so the coverage test can prove every
 * MapLayers key is either mode-managed or deliberately excluded — no silent gaps.
 */
export const UNMANAGED_LAYERS: readonly MapLayerId[] = [
  'startupHubs', 'accelerators', 'techHQs', 'techEvents',
  'positiveEvents', 'kindness', 'happiness', 'speciesRecovery',
  'dayNight', 'satellites', 'buildings3d', 'streetTiles', 'navigationRoute',
];

const AXES: readonly SurvivalAxis[] = Object.keys(MAP_MODES) as SurvivalAxis[];

/** All 8 axis modes in registry order. */
export function allModes(): MapMode[] {
  return AXES.map((axis) => MAP_MODES[axis]);
}

/** The set of every layer that any mode manages (the "mode-managed" universe). */
const MODE_MANAGED: ReadonlySet<MapLayerId> = new Set(AXES.flatMap((a) => MAP_MODES[a].layers));

/** Reverse lookup: which axis mode owns a layer (first match), or null if none. */
export function modeForLayer(layer: MapLayerId): SurvivalAxis | null {
  for (const axis of AXES) {
    if (MAP_MODES[axis].layers.includes(layer)) return axis;
  }
  return null;
}

/** Toggle a mode on/off, returning a new active set in registry order. */
export function toggleMode(active: readonly SurvivalAxis[], axis: SurvivalAxis): SurvivalAxis[] {
  const set = new Set(active);
  if (set.has(axis)) set.delete(axis);
  else set.add(axis);
  return AXES.filter((a) => set.has(a));
}

/** Solo a single mode (isolate) — the classic "just show me X". */
export function isolateMode(axis: SurvivalAxis): SurvivalAxis[] {
  return [axis];
}

/** Union of the layers across the active modes (empty set when nothing active). */
export function activeLayers(active: readonly SurvivalAxis[]): Set<MapLayerId> {
  const out = new Set<MapLayerId>();
  for (const axis of active) {
    for (const layer of MAP_MODES[axis].layers) out.add(layer);
  }
  return out;
}

/**
 * Concrete visibility overrides the map glue applies. Empty active → `{}` (no
 * override; keep base state). Non-empty → every mode-managed layer gets `true`
 * (in an active mode) or `false` (in an inactive mode); non-mode layers are
 * absent (left untouched).
 */
export function resolveLayerVisibility(
  active: readonly SurvivalAxis[],
): Partial<Record<MapLayerId, boolean>> {
  if (active.length === 0) return {};
  const on = activeLayers(active);
  const out: Partial<Record<MapLayerId, boolean>> = {};
  for (const layer of MODE_MANAGED) {
    out[layer] = on.has(layer);
  }
  return out;
}
