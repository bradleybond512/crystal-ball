/**
 * Fire Intel Service — orchestrator that joins existing FIRMS hotspots and
 * InciWeb incidents with two new sources (NIFC perimeters + AirNow AQI for
 * saved places) and exposes a single snapshot the unified WildfireIntelPanel
 * consumes.
 *
 * Pure helpers (clustering / ranking / AQI categorization) live in
 * fire-intel-helpers.ts so they unit-test under tsx without dragging the
 * Vite-only `@/utils` chain.
 */

import { fetchAllFires, flattenFires, toMapFires } from './index';
import { fetchInciwebIncidents, type IncidentReport } from '../inciweb';
import type { SavedPlace } from '../saved-places';
import { getApiBaseUrl } from '../runtime';
import {
  clusterHotspots,
  rankIncidentsByThreat,
  categorizeAqi,
  type HotspotCluster,
  type RankedThreat,
  type AqiCategory,
} from './fire-intel-helpers';



// ── Types ────────────────────────────────────────────────────────────────

export interface ActiveFirePerimeter {
  irwinId: string;
  name: string;
  acres: number | null;
  containmentPct: number | null;
  state: string | null;
  lat: number;
  lon: number;
  /** Polygon / MultiPolygon when available; null when only a centroid is exposed. */
  geometry: GeoJsonPolygonLike | null;
  updatedAt: string | null;
}

export interface GeoJsonPolygonLike {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

export interface AirNowAqi {
  placeId: string;
  placeName: string;
  lat: number;
  lon: number;
  aqi: number | null;
  category: AqiCategory;
  /** EPA reporting parameter, e.g. 'PM2.5' / 'O3'. */
  parameter: string | null;
  observedAt: string | null;
  fetchedAt: number;
}

export interface FireIntelSnapshot {
  hotspotClusters: HotspotCluster[];
  perimeters: ActiveFirePerimeter[];
  incidents: IncidentReport[];
  rankedThreats: RankedThreat[];
  aqi: AirNowAqi[];
  fetchedAt: number;
}

// ── Sidecar fetch wrappers ───────────────────────────────────────────────

interface SidecarPerimeterFeature {
  type: 'Feature';
  // The WFIGS ArcGIS layer prefixes every field (poly_IncidentName,
  // attr_PercentContained, …). Keep this open and pick keys defensively below.
  properties: Record<string, string | number | null | undefined>;
  geometry: GeoJsonPolygonLike | { type: 'Point'; coordinates: [number, number] } | null;
}

/** First defined value among the given property keys. */
function pickProp(props: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = props[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/** Map one WFIGS geojson feature → ActiveFirePerimeter (null if unlocatable). */
function parsePerimeterFeature(feat: SidecarPerimeterFeature): ActiveFirePerimeter | null {
  const props = feat.properties ?? {};
  const geom = feat.geometry;
  const centroid = geometryCentroid(geom);
  if (!centroid) return null;
  const name = pickProp(props, 'attr_IncidentName', 'poly_IncidentName', 'IncidentName');
  const acresRaw = pickProp(props, 'poly_GISAcres', 'attr_CalculatedAcres', 'attr_IncidentSize', 'GISAcres');
  const containRaw = pickProp(props, 'attr_PercentContained', 'PercentContained');
  const irwin = pickProp(props, 'poly_IRWINID', 'attr_IrwinID', 'IrwinID');
  const state = pickProp(props, 'attr_POOState', 'attr_POOProtectingAgency', 'POOState');
  const updated = pickProp(props, 'poly_DateCurrent', 'attr_ModifiedOnDateTime', 'ModifiedOnDateTime_dt');
  return {
    irwinId: typeof irwin === 'string' ? irwin : `${centroid.lat.toFixed(3)},${centroid.lon.toFixed(3)}`,
    name: typeof name === 'string' ? name : 'Unknown incident',
    acres: typeof acresRaw === 'number' ? acresRaw : null,
    containmentPct: typeof containRaw === 'number' ? containRaw : null,
    state: typeof state === 'string' ? state : null,
    lat: centroid.lat,
    lon: centroid.lon,
    geometry:
      geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')
        ? (geom as GeoJsonPolygonLike)
        : null,
    updatedAt: typeof updated === 'string' ? updated : null,
  };
}

interface SidecarPerimetersResponse {
  features?: SidecarPerimeterFeature[];
  error?: string;
}

interface SidecarAqiResponse {
  observations?: {
    AQI?: number;
    Category?: { Number?: number; Name?: string };
    ParameterName?: string;
    DateObserved?: string;
    HourObserved?: number;
    LocalTimeZone?: string;
  }[];
  error?: string;
}

const PERIMETER_CACHE_MS = 15 * 60 * 1000;
const AQI_CACHE_MS = 30 * 60 * 1000;

let _perimeterCache: { perimeters: ActiveFirePerimeter[]; ts: number } | null = null;
const _aqiCache = new Map<string, { aqi: AirNowAqi; ts: number }>();

export async function fetchActivePerimeters(): Promise<ActiveFirePerimeter[]> {
  if (_perimeterCache && Date.now() - _perimeterCache.ts < PERIMETER_CACHE_MS) {
    return _perimeterCache.perimeters;
  }
  try {
    const resp = await fetch(`${getApiBaseUrl()}/api/wildfire/perimeters`);
    if (!resp.ok) return _perimeterCache?.perimeters ?? [];
    const data = (await resp.json()) as SidecarPerimetersResponse;
    const perimeters = (data.features ?? [])
      .map((feat) => parsePerimeterFeature(feat))
      .filter((p): p is ActiveFirePerimeter => p !== null);
    _perimeterCache = { perimeters, ts: Date.now() };
    return perimeters;
  } catch {
    return _perimeterCache?.perimeters ?? [];
  }
}

export async function fetchAqiForPlaces(places: SavedPlace[]): Promise<AirNowAqi[]> {
  if (places.length === 0) return [];
  const now = Date.now();
  const out: AirNowAqi[] = [];
  await Promise.all(
    places.map(async (place) => {
      const cacheKey = place.id;
      const cached = _aqiCache.get(cacheKey);
      if (cached && now - cached.ts < AQI_CACHE_MS) {
        out.push(cached.aqi);
        return;
      }
      const reading = await fetchSingleAqi(place);
      _aqiCache.set(cacheKey, { aqi: reading, ts: now });
      out.push(reading);
    }),
  );
  // Stable ordering — primary first, then by place id.
  return out.sort((a, b) => {
    const ap = places.find((p) => p.id === a.placeId)?.primary ? 1 : 0;
    const bp = places.find((p) => p.id === b.placeId)?.primary ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return a.placeId.localeCompare(b.placeId);
  });
}

async function fetchSingleAqi(place: SavedPlace): Promise<AirNowAqi> {
  const fallback: AirNowAqi = {
    placeId: place.id,
    placeName: place.name,
    lat: place.lat,
    lon: place.lon,
    aqi: null,
    category: 'unknown',
    parameter: null,
    observedAt: null,
    fetchedAt: Date.now(),
  };
  try {
    const url = new URL(`${getApiBaseUrl()}/api/wildfire/aqi`);
    url.searchParams.set('lat', String(place.lat));
    url.searchParams.set('lon', String(place.lon));
    const resp = await fetch(url.toString());
    if (!resp.ok) return fallback;
    const data = (await resp.json()) as SidecarAqiResponse;
    const obs = data.observations ?? [];
    const first = obs[0];
    if (!first) return fallback;
    // EPA reports overall AQI as the highest single-pollutant reading.
    let dominant = first;
    for (const o of obs) {
      if ((o.AQI ?? -1) > (dominant.AQI ?? -1)) dominant = o;
    }
    const aqi = typeof dominant.AQI === 'number' ? dominant.AQI : null;
    return {
      placeId: place.id,
      placeName: place.name,
      lat: place.lat,
      lon: place.lon,
      aqi,
      category: categorizeAqi(aqi),
      parameter: dominant.ParameterName ?? null,
      observedAt: dominant.DateObserved ? dominant.DateObserved.trim() : null,
      fetchedAt: Date.now(),
    };
  } catch {
    return fallback;
  }
}

// ── Top-level snapshot ───────────────────────────────────────────────────

export async function fetchFireIntelSnapshot(
  places: SavedPlace[] = [],
  opts: { gridDeg?: number; topN?: number } = {},
): Promise<FireIntelSnapshot> {
  const [firesResult, incidents, perimeters, aqi] = await Promise.all([
    fetchAllFires().catch(() => ({ regions: {}, totalCount: 0 })),
    fetchInciwebIncidents().catch(() => [] as IncidentReport[]),
    fetchActivePerimeters().catch(() => [] as ActiveFirePerimeter[]),
    fetchAqiForPlaces(places).catch(() => [] as AirNowAqi[]),
  ]);
  const flatFires = toMapFires(flattenFires(firesResult.regions));
  return {
    hotspotClusters: clusterHotspots(flatFires, opts),
    perimeters,
    incidents,
    rankedThreats: rankIncidentsByThreat(incidents),
    aqi,
    fetchedAt: Date.now(),
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────

function geometryCentroid(
  geom: SidecarPerimeterFeature['geometry'],
): { lat: number; lon: number } | null {
  if (!geom) return null;
  if (geom.type === 'Point') {
    const [lon, lat] = geom.coordinates;
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }
  if (geom.type === 'Polygon') {
    return ringCentroid(geom.coordinates[0] as number[][]);
  }
  if (geom.type === 'MultiPolygon') {
    const first = (geom.coordinates as number[][][][])[0]?.[0];
    return first ? ringCentroid(first) : null;
  }
  return null;
}

function ringCentroid(ring: number[][]): { lat: number; lon: number } | null {
  if (!ring || ring.length === 0) return null;
  let lat = 0;
  let lon = 0;
  let count = 0;
  for (const pt of ring) {
    if (pt.length < 2) continue;
    const x = pt[0];
    const y = pt[1];
    if (x === undefined || y === undefined) continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    lon += x;
    lat += y;
    count += 1;
  }
  if (count === 0) return null;
  return { lat: lat / count, lon: lon / count };
}

// Test-only escape hatch — clears module-level caches between runs.
export function _resetFireIntelCachesForTesting(): void {
  _perimeterCache = null;
  _aqiCache.clear();
}

export {clusterHotspots, rankIncidentsByThreat, categorizeAqi, type HotspotCluster, type RankedThreat, type AqiCategory} from './fire-intel-helpers';