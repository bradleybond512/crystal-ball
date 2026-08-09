import {
  CallbackProperty,
  Cartesian3,
  Cartographic,
  Color,
  CustomDataSource,
  HeightReference,
  HorizontalOrigin,
  VerticalOrigin,
  type Viewer,
  NearFarScalar,
  DistanceDisplayCondition,
  ColorMaterialProperty,
  ConstantProperty,
  PolygonHierarchy,
  PropertyBag,
  JulianDate,
  Math as CesiumMath,
  Ellipsoid,
  Rectangle,
  UrlTemplateImageryProvider,
  WebMapServiceImageryProvider,
  type ImageryLayer,
  PointPrimitiveCollection,
  PolylineCollection,
  HeadingPitchRoll,
  Transforms,
  Entity,
  PolygonGraphics,
} from 'cesium';

import { applyClustering } from '@/components/globeClustering';
import { GlobeHeatmapRenderer } from '@/components/globe/GlobeHeatmapRenderer';
import { coerceTimestampMs, opacityForEntity } from '@/components/globe/cursor-opacity';
import { escapeHtml } from '@/utils/sanitize';
import { modelLoader } from '@/services/model-loader';
import { boardEntityId } from '@/services/survival/board-events';
import { BuildingTileManager } from '@/services/building-tiles';
import { fetchSatelliteCatalog, filterNotable, type SatelliteTLE } from '@/services/satellite-catalog';
import { satellitePropagator, type SatellitePosition } from '@/services/satellite-propagator';
import { fetchLightningStrikes } from '@/services/lightning';
import { fetchRedFlagWarnings } from '@/services/red-flag-warnings';
import { getRadarTileUrl, fetchRadarFrames } from '@/services/rainviewer-radar';
import { getGoesWmsTileUrl } from '@/services/satellite-weather';
import { FIREWORK_WMS_BASE, FIREWORK_LAYER } from '@/services/firework-smoke';
import { getApiBaseUrl } from '@/services/runtime';
import { getSavedPlaces } from '@/services/saved-places';
import { resolveSiteConfig } from '@/services/datacenter/site-resolver';
import { loadGodsVisionLayers } from '@/config/gods-vision-layers';
import {
  computeAftershockForecast,
  computeCycloneCone,
  type AftershockForecast,
  type ForecastCone,
  type TrackPoint,
} from '@/services/forecast-engine';

import {
  UNDERSEA_CABLES,
  NUCLEAR_FACILITIES,
  MILITARY_BASES,
  STRATEGIC_WATERWAYS,
  SPACEPORTS,
  CRITICAL_MINERALS,
  INTEL_HOTSPOTS,
} from '@/config/geo';

import {
  VESSEL_ICONS,
  GDACS_ICONS,
  ICON_NUCLEAR,
  ICON_EARTHQUAKE,
  ICON_EXPLOSION,
  ICON_CROSSHAIR,
  ICON_CYBER,
  ICON_CYBER_CRITICAL,
  ICON_PROTEST,
  ICON_CABLE_LANDING,
  ICON_WARSHIP,
  ICON_FIRE,
  ICON_BASE,
  ICON_BASE_NAVAL,
  ICON_BASE_AIR,
  ICON_TRANSPORT,
  ICON_HELICOPTER,
  ICON_AIRSTRIKE,
  ICON_DARK_VESSEL,
  ICON_GPS_JAM,
  ICON_SAT_CHANGE,
  ICON_VOLCANO,
  ICON_CYCLONE,
  ICON_DISEASE,
  ICON_SPACEPORT,
  ICON_CHOKEPOINT,
  ICON_MINERAL,
  ICON_HOTSPOT,
  ICON_DISPLACEMENT,
  POWER_ICONS,
} from '@/config/globe-icons';

const ICON_SATELLITE = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path fill="white" d="M12 2L9 9H2l5.5 4-2.1 6.5L12 16l6.6 3.5L16.5 13 22 9h-7z"/>
</svg>
`);

// Triangle billboard for live AIS vessels — heading-rotated point.
// White fill so the per-vessel category color comes through via
// the billboard.color tint (Cesium multiplies alpha + RGB channels).
const VESSEL_TRIANGLE_DATAURI = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path fill="#ffffff" stroke="#000000" stroke-width="1.5" d="M12 2 L20 20 L12 16 L4 20 Z"/>
</svg>
`);

// ── Colors ──────────────────────────────────────────────────

/** Hurricane forecast track + uncertainty cone color (PR 3). */
const STORM_TRACK_COLOR_HEX = '#9333ea';


const C = {
  // Seismic
  earthquake: Color.ORANGERED,
  earthquakeMinor: Color.ORANGE.withAlpha(0.8),
  // Conflict
  conflict: Color.RED,
  conflictExplosion: Color.fromCssColorString('#ff6b35'),
  airstrike: Color.fromCssColorString('#ff3333'),
  // Nuclear
  nuclear: Color.YELLOW,
  nuclearWeapons: Color.fromCssColorString('#ff453a'),
  // Cables
  cable: Color.fromCssColorString('#60a5fa').withAlpha(0.4),
  cableMajor: Color.fromCssColorString('#60a5fa').withAlpha(0.7),
  cableLanding: Color.fromCssColorString('#60a5fa'),
  // Aviation
  flight: Color.fromCssColorString('#34d399'),
  flightTrail: Color.fromCssColorString('#34d399').withAlpha(0.3),
  // Maritime
  vessel: Color.fromCssColorString('#818cf8'),
  vesselDark: Color.fromCssColorString('#f87171'),
  vesselTrail: Color.fromCssColorString('#818cf8').withAlpha(0.25),
  vesselDarkTrail: Color.fromCssColorString('#f87171').withAlpha(0.3),
  darkVessel: Color.fromCssColorString('#ef4444'),
  darkVesselCritical: Color.fromCssColorString('#dc2626'),
  // Cyber
  cyber: Color.fromCssColorString('#a78bfa'),
  cyberCritical: Color.fromCssColorString('#ef4444'),
  cyberHigh: Color.fromCssColorString('#f97316'),
  // Disasters
  gdacs: Color.fromCssColorString('#fbbf24'),
  gdacsRed: Color.RED,
  volcanoWarning: Color.RED,
  volcanoWatch: Color.fromCssColorString('#f97316'),
  volcanoAdvisory: Color.YELLOW,
  volcanoNormal: Color.fromCssColorString('#22c55e'),
  cycloneCat5: Color.fromCssColorString('#ff0000'),
  cycloneCat3: Color.fromCssColorString('#ff6600'),
  cycloneCat1: Color.fromCssColorString('#ffcc00'),
  cycloneStorm: Color.fromCssColorString('#00ccff'),
  // Fires
  fireHigh: Color.fromCssColorString('#ff453a'),
  fireNominal: Color.fromCssColorString('#ff8c00'),
  fireLow: Color.fromCssColorString('#ffa500').withAlpha(0.6),
  // Protests
  protest: Color.fromCssColorString('#fb923c'),
  protestHigh: Color.fromCssColorString('#ef4444'),
  // GPS
  gpsHigh: Color.fromCssColorString('#ef4444'),
  gpsMedium: Color.fromCssColorString('#f97316'),
  // Bases
  baseUS: Color.fromCssColorString('#3b82f6'),
  baseRussia: Color.fromCssColorString('#ef4444'),
  baseChina: Color.fromCssColorString('#f59e0b'),
  baseOther: Color.fromCssColorString('#9ca3af'),
  // Satellite change
  satChangeCritical: Color.fromCssColorString('#ef4444'),
  satChangeHigh: Color.fromCssColorString('#f97316'),
  satChangeMedium: Color.fromCssColorString('#eab308'),
  satChangeLow: Color.fromCssColorString('#22c55e'),
  // Disease
  diseaseCritical: Color.fromCssColorString('#dc2626'),
  diseaseHigh: Color.fromCssColorString('#f97316'),
  diseaseMedium: Color.fromCssColorString('#eab308'),
  // Displacement
  displacement: Color.fromCssColorString('#f472b6'),
  displacementHigh: Color.fromCssColorString('#ec4899'),
  displacementFlow: Color.fromCssColorString('#f472b6').withAlpha(0.2),
  // Infrastructure
  spaceport: Color.fromCssColorString('#06b6d4'),
  chokepoint: Color.fromCssColorString('#38bdf8'),
  mineral: Color.fromCssColorString('#a3e635'),
  // Intel
  hotspotHigh: Color.fromCssColorString('#ef4444'),
  hotspotElevated: Color.fromCssColorString('#f97316'),
  hotspotLow: Color.fromCssColorString('#eab308'),
} as const;

// ── Color / scale lookup helpers (avoids nested ternaries) ──

function baseColor(type: string): Color {
  if (type === 'us-nato') return C.baseUS;
  if (type === 'russia') return C.baseRussia;
  if (type === 'china') return C.baseChina;
  return C.baseOther;
}

function hotspotColor(level: string | undefined): Color {
  if (level === 'high') return C.hotspotHigh;
  if (level === 'elevated') return C.hotspotElevated;
  return C.hotspotLow;
}

function hotspotScale(level: string | undefined): number {
  if (level === 'high') return 0.45;
  if (level === 'elevated') return 0.38;
  return 0.3;
}

function volcanoColor(alertLevel: string): Color {
  if (alertLevel === 'Warning') return C.volcanoWarning;
  if (alertLevel === 'Watch') return C.volcanoWatch;
  if (alertLevel === 'Advisory') return C.volcanoAdvisory;
  return C.volcanoNormal;
}

function volcanoScale(alertLevel: string): number {
  if (alertLevel === 'Warning') return 0.45;
  if (alertLevel === 'Watch') return 0.38;
  return 0.3;
}

function cycloneColor(category: string, isCat3Plus: boolean, isCat1Plus: boolean): Color {
  if (category === 'category_5') return C.cycloneCat5;
  if (isCat3Plus) return C.cycloneCat3;
  if (isCat1Plus) return C.cycloneCat1;
  return C.cycloneStorm;
}

function cycloneScale(isCat5: boolean, isCat3Plus: boolean, isCat1Plus: boolean): number {
  if (isCat5) return 0.6;
  if (isCat3Plus) return 0.5;
  if (isCat1Plus) return 0.4;
  return 0.35;
}

interface PerimeterLike {
  name: string;
  acres: number | null;
  containmentPct: number | null;
  state: string | null;
  lat: number;
  lon: number;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] } | null;
}

function renderPerimeterPolygons(layer: GlobeLayer, perimeters: PerimeterLike[]): void {
  for (const p of perimeters) {
    if (!p.geometry) continue;
    const rings = p.geometry.type === 'Polygon'
      ? [p.geometry.coordinates as number[][][]]
      : (p.geometry.coordinates as number[][][][]);
    for (const polygon of rings) {
      addPerimeterEntity(layer, p, polygon[0]);
    }
  }
}

function addPerimeterEntity(layer: GlobeLayer, p: PerimeterLike, outerRing: number[][] | undefined): void {
  const positions = polygonRingToCartesian(outerRing);
  if (positions.length < 3) return;
  const cont = p.containmentPct === null ? '—' : `${Math.round(p.containmentPct)}%`;
  const acresStr = p.acres === null ? '—' : p.acres.toLocaleString();
  const stateStr = p.state ?? '—';
  layer.source.entities.add({
    polygon: new PolygonGraphics({
      hierarchy: new PolygonHierarchy(positions),
      material: C.fireHigh.withAlpha(0.12),
      outline: true,
      outlineColor: C.fireHigh.withAlpha(0.85),
      heightReference: HeightReference.CLAMP_TO_GROUND,
    }),
    description: `<b>${escapeHtml(p.name)}</b><br/>State: ${escapeHtml(stateStr)}<br/>Acres: ${acresStr}<br/>Containment: ${cont}`,
  });
}

function polygonRingToCartesian(outerRing: number[][] | undefined): Cartesian3[] {
  if (!outerRing || outerRing.length < 3) return [];
  const positions: Cartesian3[] = [];
  for (const pt of outerRing) {
    const px = pt[0];
    const py = pt[1];
    if (px === undefined || py === undefined) continue;
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    positions.push(Cartesian3.fromDegrees(px, py));
  }
  return positions;
}

interface ClusterLike {
  lat: number;
  lon: number;
  fireCount: number;
  totalFrp: number;
  maxBrightness: number;
  highConfidence: boolean;
  region: string;
}

function renderHotspotClusters(
  layer: GlobeLayer,
  clusters: ClusterLike[],
  perimeters: PerimeterLike[],
  findNearest: (lat: number, lon: number, perims: PerimeterLike[], maxKm: number) => { perimeter: PerimeterLike; distanceKm: number } | null,
): void {
  for (const c of clusters) {
    const color = c.highConfidence ? C.fireHigh : C.fireNominal;
    const scale = c.highConfidence ? 0.65 : 0.5;
    const nearest = findNearest(c.lat, c.lon, perimeters, 50);
    const nearestNote = nearest
      ? `<br/><i>Near: ${escapeHtml(nearest.perimeter.name)} (${nearest.distanceKm.toFixed(1)} km)</i>`
      : '';
    const fireEntity = layer.source.entities.add({
      position: Cartesian3.fromDegrees(c.lon, c.lat),
      billboard: {
        image: ICON_FIRE,
        color,
        scale,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        scaleByDistance: new NearFarScalar(1e4, 1.2, 1e7, 0.15),
        verticalOrigin: VerticalOrigin.CENTER,
        horizontalOrigin: HorizontalOrigin.CENTER,
      },
      label: c.totalFrp >= 50 ? {
        text: `${c.fireCount}× ${c.totalFrp.toFixed(0)}MW`,
        font: '10px monospace',
        fillColor: color,
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style: 2,
        pixelOffset: LABEL_OFFSET_SM,
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
        scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 8e6),
      } : undefined,
      description: `<b>FIRMS hotspot cluster</b><br/>Pixels: ${c.fireCount}<br/>Total FRP: ${c.totalFrp.toFixed(1)} MW<br/>Max brightness: ${c.maxBrightness.toFixed(0)} K<br/>Confidence: ${c.highConfidence ? 'high' : 'nominal'}<br/>Region: ${escapeHtml(c.region)}${nearestNote}`,
    });
    setEntityTimestamp(fireEntity, new Date());
  }
}

interface PurpleAirSensorLike {
  id: number;
  name: string;
  lat: number;
  lon: number;
  pm25: number;
  aqi: number;
  category: 'good' | 'moderate' | 'sensitive' | 'unhealthy' | 'very_unhealthy' | 'hazardous';
}

const PURPLEAIR_DOT_COLORS: Record<PurpleAirSensorLike['category'], Color> = {
  good:           Color.fromCssColorString('#00e400'),
  moderate:       Color.fromCssColorString('#ffff00'),
  sensitive:      Color.fromCssColorString('#ff7e00'),
  unhealthy:      Color.fromCssColorString('#ff0000'),
  very_unhealthy: Color.fromCssColorString('#8f3f97'),
  hazardous:      Color.fromCssColorString('#7e0023'),
};

function renderPurpleAirDots(layer: GlobeLayer, sensors: PurpleAirSensorLike[]): void {
  for (const s of sensors) {
    layer.source.entities.add({
      position: Cartesian3.fromDegrees(s.lon, s.lat),
      point: {
        color: PURPLEAIR_DOT_COLORS[s.category],
        outlineColor: Color.BLACK,
        outlineWidth: 1,
        pixelSize: purpleAirDotSize(s.pm25),
        heightReference: HeightReference.CLAMP_TO_GROUND,
        scaleByDistance: new NearFarScalar(1e4, 1.4, 1e7, 0.4),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 5e6),
      },
      description: `<b>PurpleAir ${escapeHtml(s.name)}</b><br/>PM2.5: ${s.pm25.toFixed(1)} µg/m³<br/>AQI: ${s.aqi} (${s.category.replace('_', ' ')})`,
    });
  }
}

function purpleAirDotSize(pm25: number): number {
  if (pm25 >= 150) return 14;
  if (pm25 >= 55)  return 12;
  if (pm25 >= 35)  return 10;
  if (pm25 >= 12)  return 9;
  return 8;
}

function radnetDescription(hot: { name: string; cpm: number; severity: string; state: string | null }): string {
  const head = `<b>RadNet ${escapeHtml(hot.name)}</b>`;
  const body = `${hot.cpm.toFixed(1)} CPM (${hot.severity})`;
  const tail = hot.state ? ` · ${hot.state}` : '';
  return `${head}<br/>${body}${tail}`;
}

function cyberColor(severity: string): Color {
  if (severity === 'critical') return C.cyberCritical;
  if (severity === 'high') return C.cyberHigh;
  return C.cyber;
}

function satChangeColor(severity: string): Color {
  if (severity === 'critical') return C.satChangeCritical;
  if (severity === 'high') return C.satChangeHigh;
  if (severity === 'medium') return C.satChangeMedium;
  return C.satChangeLow;
}

function diseaseColor(casesPerM: number): Color {
  if (casesPerM > 1000) return C.diseaseCritical;
  if (casesPerM > 100) return C.diseaseHigh;
  return C.diseaseMedium;
}

function diseaseScale(casesPerM: number): number {
  if (casesPerM > 1000) return 0.35;
  if (casesPerM > 100) return 0.28;
  return 0.2;
}

const LABEL_OFFSET = new Cartesian3(0, -20, 0) as unknown as import('cesium').Cartesian2;
const LABEL_OFFSET_SM = new Cartesian3(0, -18, 0) as unknown as import('cesium').Cartesian2;

const COMMERCIAL_FLIGHT_HEX: Record<
  import('@/services/aviation/commercial-flights-classify').FlightCategory,
  string
> = {
  military: '#ffeb3b',
  commercial: '#4a9eff',
  cargo: '#9c27b0',
  helicopter: '#8bc34a',
  general_aviation: '#9e9e9e',
};

function categoryRank(
  category: import('@/services/aviation/commercial-flights-classify').FlightCategory,
): number {
  if (category === 'commercial') return 0;
  if (category === 'cargo') return 1;
  if (category === 'helicopter') return 2;
  if (category === 'general_aviation') return 3;
  return 4;
}

function commercialFlightDescriptionHtml(
  flight: import('@/services/aviation/commercial-flights-classify').LiveFlight,
): string {
  const lines: string[] = [
    `<h3>${escapeHtml(flight.callsign ?? flight.icao24)}</h3>`,
    `<div>Category: ${escapeHtml(flight.category.replace(/_/g, ' '))}</div>`,
    flight.operatorName ? `<div>Operator: ${escapeHtml(flight.operatorName)}</div>` : '',
    flight.originCountry ? `<div>Origin: ${escapeHtml(flight.originCountry)}</div>` : '',
    flight.altitudeFt === null ? '' : `<div>Altitude: ${flight.altitudeFt} ft</div>`,
    flight.velocityKts === null ? '' : `<div>Speed: ${flight.velocityKts} kt</div>`,
    flight.headingDeg === null ? '' : `<div>Heading: ${Math.round(flight.headingDeg)}°</div>`,
    flight.emergency
      ? `<strong style="color:#ff453a;">EMERGENCY squawk ${escapeHtml(flight.squawk ?? '')}</strong>`
      : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function setEntityTimestamp(entity: import('cesium').Entity, when: Date): void {
  entity.properties ??= new PropertyBag();
  entity.properties.addProperty('timestamp', new ConstantProperty(when));
}

function setEntityTimestampIfPresent(
  entity: import('cesium').Entity | undefined,
  when: string | number | null | undefined,
): void {
  if (entity && when) setEntityTimestamp(entity, new Date(when));
}

/** Read an entity's `timestamp` property and coerce to ms epoch.
 *  Returns null when no timestamp is set. Used by cursor-window
 *  opacity. Exported for tests. */
export function readEntityTimestampMs(entity: import('cesium').Entity): number | null {
  const props = entity.properties;
  if (!props) return null;
  // PropertyBag.getValue takes a JulianDate; pass a fresh one — the
  // timestamp is stored as a ConstantProperty so the time arg is
  // ignored, but the API requires it.
  const v = props.getValue(JulianDate.now()) as { timestamp?: unknown } | undefined;
  return coerceTimestampMs(v?.timestamp);
}

/** Apply an alpha multiplier to whatever color-bearing graphic an
 *  entity carries (point / billboard / rectangle / polygon / polyline).
 *  Reads the current color, swaps alpha, writes back. Cesium's
 *  `Color.withAlpha()` returns a fresh instance so we don't mutate
 *  shared color objects. */
export function applyEntityAlpha(entity: import('cesium').Entity, alpha: number): void {
  const a = Math.max(0, Math.min(1, alpha));
  const now = JulianDate.now();
  const setColorWithAlpha = (
    holder: { color?: import('cesium').Property } | undefined | null,
    setter: (next: ConstantProperty) => void,
  ): void => {
    if (!holder?.color) return;
    const raw: unknown = holder.color.getValue(now);
    if (raw instanceof Color) setter(new ConstantProperty(raw.withAlpha(a)));
  };
  setColorWithAlpha(entity.point, (p) => { entity.point!.color = p; });
  setColorWithAlpha(entity.billboard, (p) => { entity.billboard!.color = p; });
  if (entity.rectangle?.material instanceof ColorMaterialProperty) {
    const mat = entity.rectangle.material;
    setColorWithAlpha({ color: mat.color }, (p) => { mat.color = p; });
  }
  if (entity.polygon?.material instanceof ColorMaterialProperty) {
    const mat = entity.polygon.material;
    setColorWithAlpha({ color: mat.color }, (p) => { mat.color = p; });
  }
  if (entity.polyline?.material instanceof ColorMaterialProperty) {
    const mat = entity.polyline.material;
    setColorWithAlpha({ color: mat.color }, (p) => { mat.color = p; });
  }
}

interface GlobeLayer {
  source: CustomDataSource;
  load: () => void | Promise<void>;
  loaded: boolean;
}

/** Common shape of `entity.properties.getValue(julian)` for timestamp lookup. */
interface TimestampedProperties { timestamp?: Date | string | number }

/** Per-entity position+timestamp tuple for trail rendering. */
export interface EntityPositionSample {
  id: string;
  lat: number;
  lon: number;
  timeMs: number;
}

/** Per-entity sample with severity + description for pillars / degradation. */
export interface EntityTimestampedSample extends EntityPositionSample {
  severity: number;
  description: string;
}

/** A single time-range block for one swimlane lane. */
export interface EventBlock {
  id: string;
  layerName: string;
  category: 'conflicts' | 'disasters' | 'military' | 'seismic' | 'cyber' | 'weather';
  startMs: number;
  endMs: number;
  severity: number;
  name: string;
  lat?: number;
  lon?: number;
  isForecast: boolean;
}

/** Layer-name to severity multiplier for pillars + event blocks. */
const LAYER_BASE_SEVERITY: Record<string, number> = {
  airstrikes: 10,
  conflicts: 8,
  gdacs: 7,
  cyber: 6,
  cyclones: 6,
  earthquakes: 5,
  gpsJamming: 5,
  fires: 4,
};

/** Swimlane category → contributing layer names. */
const SWIMLANE_CATEGORY_MAP: Record<EventBlock['category'], string[]> = {
  conflicts: ['conflicts', 'airstrikes'],
  disasters: ['gdacs', 'cyclones'],
  military: ['flights', 'vessels', 'darkVessels'],
  seismic: ['earthquakes', 'volcanoes'],
  cyber: ['cyber', 'gpsJamming'],
  weather: ['fires'],
};

// Layers that get auto-clustered at low zoom, keyed by layer name → category color.
const CLUSTER_LAYERS: Record<string, Color> = {
  earthquakes: Color.fromCssColorString('#ff8c00'),
  fires: Color.fromCssColorString('#ff3300'),
  conflicts: Color.fromCssColorString('#dc143c'),
  airstrikes: Color.fromCssColorString('#8b0000'),
  cyber: Color.fromCssColorString('#ff00ff'),
  flights: Color.fromCssColorString('#00ffff'),
  vessels: Color.fromCssColorString('#1e90ff'),
  darkVessels: Color.fromCssColorString('#9400d3'),
  protests: Color.fromCssColorString('#ffd700'),
  disease: Color.fromCssColorString('#00ff7f'),
  lightningStrikes: Color.fromCssColorString('#ffff00'),
};

// Layers that should only load when the camera is below a certain altitude (meters).
// Static reference layers load eagerly; dynamic data layers are deferred until zoom.
const DEFERRED_LAYER_ALTITUDE: Record<string, number> = {
  fires: 8_000_000,
  protests: 6_000_000,
  lightningStrikes: 5_000_000,
  disease: 10_000_000,
  displacement: 10_000_000,
  gpsJamming: 8_000_000,
  satChange: 15_000_000,
  darkVessels: 6_000_000,
  // Local radius query against a rate-limited Overpass relay — only worth
  // loading once the camera is reasonably close to a site / region.
  powerInfrastructure: 2_000_000,
  redFlagWarnings: 5_000_000,
  weatherRadar: 5_000_000,
  weatherSatellite: 15_000_000,
  smokeForecast: 15_000_000,
};

// Settle delay before the power overlay fetches a new anchor cell, so an active
// camera pan doesn't fire an Overpass request for every cell crossed.
const POWER_FETCH_DEBOUNCE_MS = 600;

// Cesium's EntityCollection throws (and halts the ENTIRE render loop) if an
// id already exists in the collection. External feeds occasionally emit two
// records that map to the same id (e.g. a shared camera listed under two
// GeoNet volcanoes, or an upstream fusion glitch); skipping the duplicate
// here is cheap insurance against a whole-globe crash from one bad record.
function addEntitySafe<T extends { entities: { add: (e: Entity.ConstructorOptions | Entity) => Entity; getById: (id: string) => Entity | undefined } }>(
  source: T,
  entity: Entity.ConstructorOptions | Entity,
): Entity | undefined {
  if (entity.id != null && source.entities.getById(entity.id)) return undefined;
  return source.entities.add(entity);
}

export class GlobeDataManager {
  private viewer: Viewer;
  private layers = new Map<string, GlobeLayer>();
  private weatherImageryLayers: ImageryLayer[] = [];
  private clusterableLayers = new Set<string>();
  private buildingManager: BuildingTileManager | null = null;
  private satellitePoints: InstanceType<typeof PointPrimitiveCollection> | null = null;
  private orbitLines: InstanceType<typeof PolylineCollection> | null = null;
  private satelliteCatalog: SatelliteTLE[] = [];
  private unsubPositions: (() => void) | null = null;
  private cameraMoveSub: (() => void) | null = null;
  private maritimeVesselsTimer: ReturnType<typeof setInterval> | null = null;
  private heatmapRenderer: GlobeHeatmapRenderer | null = null;
  private cursorListener: ((event: Event) => void) | null = null;
  private aftershockForecasts = new Map<string, AftershockForecast>();
  private cycloneCones = new Map<string, ForecastCone>();
  // Persists across loadTropicalCyclones() calls so we can derive an actual
  // heading from successive advisories. The single-point fallback (random
  // hash bearing) only fires for first-sighting cyclones.
  private cycloneTracks = new Map<string, TrackPoint[]>();
  // Power-infrastructure layer: in-memory enabled mirror (avoids a localStorage
  // read on every camera move) + the last anchor cell we actually fetched, so a
  // pan only re-hits the rate-limited Overpass relay when the cell changes.
  private powerLayerEnabled = false;
  private lastPowerAnchorKey: string | null = null;
  // Debounce the Overpass fetch so cells we merely pan *through* don't each
  // trigger a request — only the cell the camera settles on fetches.
  private powerFetchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(viewer: Viewer) {
 this.viewer = viewer;
  }

  initialize(): void {
 // Static geo layers
 this.registerLayer('nuclear', () => this.loadNuclearFacilities());
 this.registerLayer('cables', () => this.loadUnderseaCables());
 this.registerLayer('bases', () => this.loadMilitaryBases());
 this.registerLayer('waterways', () => this.loadStrategicWaterways());
 this.registerLayer('spaceports', () => this.loadSpaceports());
 this.registerLayer('minerals', () => this.loadCriticalMinerals());
 this.registerLayer('hotspots', () => this.loadIntelHotspots());

 // Dynamic data layers
 this.registerLayer('earthquakes', () => this.loadEarthquakes());
 this.registerLayer('gdacs', () => this.loadGDACS());
 this.registerLayer('volcanoes', () => this.loadVolcanoes());
 this.registerLayer('cyclones', () => this.loadTropicalCyclones());
 this.registerLayer('fires', () => this.loadFires());
 this.registerLayer('airQuality', () => this.loadAirQuality());
 this.registerLayer('spaceWeather', () => this.loadSpaceWeatherOverlay());
 this.registerLayer('warRiskZones', () => this.loadWarRiskZones());
 this.registerLayer('infrastructure', () => this.loadInfrastructureOverlay());
 this.registerLayer('powerInfrastructure', () => this.loadPowerInfrastructure());
 this.powerLayerEnabled = loadGodsVisionLayers().powerInfrastructure?.enabled ?? false;
 this.registerLayer('conflicts', () => this.loadConflicts());
 this.registerLayer('airstrikes', () => this.loadAirstrikes());
 this.registerLayer('strike-packages', () => this.loadStrikePackages());
 this.registerLayer('cyber', () => this.loadCyberThreats());
 this.registerLayer('flights', () => this.loadMilitaryFlights());
 this.registerLayer('aviationIntel', () => this.loadAviationIntel());
 this.registerLayer('vessels', () => this.loadMilitaryVessels());
 this.registerLayer('darkVessels', () => this.loadDarkVessels());
 this.registerLayer('maritimeVessels', () => this.loadMaritimeVessels());
 this.registerLayer('gpsJamming', () => this.loadGpsJamming());
 this.registerLayer('satChange', () => this.loadSatelliteChange());
 this.registerLayer('satellites', () => this.loadOrbitalSatellites());
 this.registerLayer('protests', () => this.loadProtests());
 this.registerLayer('disease', () => this.loadDiseaseOutbreaks());
 this.registerLayer('displacement', () => this.loadDisplacement());

 // Weather layers
 this.registerLayer('weatherRadar', () => this.loadWeatherRadar());
 this.registerLayer('weatherSatellite', () => this.loadWeatherSatellite());
 this.registerLayer('smokeForecast', () => this.loadSmokeForecastWms());
 this.registerLayer('lightningStrikes', () => this.loadLightningStrikes());
 this.registerLayer('redFlagWarnings', () => this.loadRedFlagWarnings());
 this.registerLayer('weatherHazards', () => this.loadWeatherHazards());
 this.registerLayer('floodAlerts', () => this.loadFloodAlerts());
 this.registerLayer('wastewaterStates', () => this.loadWastewaterStates());
 this.registerLayer('volcanoMonitor', () => this.loadVolcanoMonitorMarkers());
 this.registerLayer('severeWeatherPolygons', () => this.loadSevereWeatherPolygons());
 this.registerLayer('shakemapOverlay', () => this.loadShakemapOverlay());

 this.registerLayer('streetTiles', () => {
 // Managed by StreetTileManager, not data source
 });

 // 3D Building tiles (managed separately — uses Cesium primitives, not data sources)
 this.buildingManager = new BuildingTileManager(this.viewer);
 void this.buildingManager.initialize();

 // Satellites (managed via PointPrimitiveCollection for performance, not data sources)
 void this.initSatellites();

 // Eagerly load layers without altitude gates; deferred layers load on camera move.
 for (const name of this.layers.keys()) {
 if (!DEFERRED_LAYER_ALTITUDE[name]) void this.loadLayer(name);
 }
 this.setupDeferredLayerLoading();

 // Heatmap renderer self-manages via the wm:globe-heatmap-changed event bus.
 this.heatmapRenderer = new GlobeHeatmapRenderer(this.viewer);
 this.heatmapRenderer.mount();

 // Timeline cursor → entity opacity wiring. Fades out-of-window
 // entities to 0.3 alpha so playback visibly affects the globe.
 this.cursorListener = (event) => this.handleCursorChange(event);
 document.addEventListener('wm:globe-timeline-cursor', this.cursorListener);
  }

  /** Apply cursor-window opacity to every time-stamped entity in
   *  every loaded data source. Called from the cursor event listener.
   *  Public so tests can drive it without dispatching DOM events. */
  applyCursorOpacity(cursorMs: number): { faded: number; full: number; timeless: number } {
 const result = { faded: 0, full: 0, timeless: 0 };
 for (const [, layer] of this.layers) {
 for (const entity of layer.source.entities.values) {
 const ts = readEntityTimestampMs(entity);
 if (ts === null) {
 result.timeless += 1;
 // Timeless entities are never faded — leave them alone.
 continue;
 }
 const alpha = opacityForEntity(ts, cursorMs);
 applyEntityAlpha(entity, alpha);
 if (alpha < 1) result.faded += 1;
 else result.full += 1;
 }
 }
 return result;
  }

  private handleCursorChange(event: Event): void {
 const detail = (event as CustomEvent<{ cursorMs?: unknown }>).detail;
 const ms = Number(detail?.cursorMs);
 if (!Number.isFinite(ms)) return;
 this.applyCursorOpacity(ms);
  }

  private checkDeferredLayers = (): void => {
 const altitude = Ellipsoid.WGS84.cartesianToCartographic(this.viewer.camera.positionWC)?.height ?? Infinity;
 for (const [name, maxAlt] of Object.entries(DEFERRED_LAYER_ALTITUDE)) {
   if (altitude <= maxAlt) void this.loadLayer(name);
 }
  };

  private setupDeferredLayerLoading(): void {
 this.cameraMoveSub = this.viewer.camera.changed.addEventListener(this.checkDeferredLayers);
 this.checkDeferredLayers();
  }

  private registerLayer(name: string, load: () => void | Promise<void>): void {
 const source = new CustomDataSource(name);
 void this.viewer.dataSources.add(source);
 this.layers.set(name, { source, load, loaded: false });
  }

  private async loadLayer(name: string): Promise<void> {
 const layer = this.layers.get(name);
 if (!layer || layer.loaded) return;
 // Optimistic lock: camera.changed fires checkDeferredLayers repeatedly
 // during a pan, so claim the layer BEFORE the await — otherwise a second
 // fire re-enters while load() is pending and adds a duplicate entity set.
 layer.loaded = true;
 try {
 await layer.load();
 const categoryColor = CLUSTER_LAYERS[name];
 if (categoryColor) {
 applyClustering(layer.source, { categoryColor });
 this.clusterableLayers.add(name);
 }
 } catch {
 // Load failed — release the lock so a later camera move can retry.
 layer.loaded = false;
 }
  }

  setClusteringEnabled(enabled: boolean): void {
 for (const name of this.clusterableLayers) {
 const layer = this.layers.get(name);
 if (layer) layer.source.clustering.enabled = enabled;
 }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STATIC GEO LAYERS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private loadNuclearFacilities(): void {
 const layer = this.layers.get('nuclear');
 if (!layer) return;

 for (const f of NUCLEAR_FACILITIES) {
 const isWeapons = f.type === 'weapons' || f.type === 'icbm' ||
 f.type === 'ssbn' || f.type === 'test-site';
 const color = isWeapons ? C.nuclearWeapons : C.nuclear;

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(f.lon, f.lat),
 billboard: {
 image: ICON_NUCLEAR,
 color,
 scale: isWeapons ? 0.4 : 0.3,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.4),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: f.name,
 font: '11px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 1e7),
 },
 description: `${f.name} — ${f.type} (${f.status})`,
 });
 }
  }

  private loadUnderseaCables(): void {
 const layer = this.layers.get('cables');
 if (!layer) return;

 for (const cable of UNDERSEA_CABLES) {
 if (cable.points.length < 2) continue;
 const positions = cable.points.map(([lon, lat]: [number, number]) =>
 Cartesian3.fromDegrees(lon, lat),
 );

 layer.source.entities.add({
 polyline: {
 positions,
 width: cable.major ? 1.5 : 0.8,
 material: new ColorMaterialProperty(cable.major ? C.cableMajor : C.cable),
 clampToGround: true,
 },
 description: cable.capacityTbps
 ? cable.name + ' — ' + String(cable.capacityTbps) + ' Tbps'
 : cable.name,
 });

 if (cable.landingPoints) {
 for (const lp of cable.landingPoints) {
 layer.source.entities.add({
 position: Cartesian3.fromDegrees(lp.lon, lp.lat),
 billboard: {
 image: ICON_CABLE_LANDING,
 color: C.cableLanding,
 scale: 0.2,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 });
 }
 }
 }
  }

  private loadMilitaryBases(): void {
 const layer = this.layers.get('bases');
 if (!layer) return;

 for (const base of MILITARY_BASES) {
 const arm = base.arm?.toLowerCase() ?? '';
 const isNaval = arm.includes('navy') || arm.includes('naval');
 const isAir = arm.includes('air');
 let icon = ICON_BASE;
 if (isNaval) icon = ICON_BASE_NAVAL;
 else if (isAir) icon = ICON_BASE_AIR;
 const color = baseColor(base.type);

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(base.lon, base.lat),
 billboard: {
 image: icon,
 color,
 scale: 0.3,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.3),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: base.name,
 font: '10px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 8e6),
 },
 description: `${base.name} — ${base.type}${base.arm ? ' (' + base.arm + ')' : ''}${base.country ? ' — ' + base.country : ''}`,
 });
 }
  }

  private loadStrategicWaterways(): void {
 const layer = this.layers.get('waterways');
 if (!layer) return;

 for (const ww of STRATEGIC_WATERWAYS) {
 layer.source.entities.add({
 position: Cartesian3.fromDegrees(ww.lon, ww.lat),
 billboard: {
 image: ICON_CHOKEPOINT,
 color: C.chokepoint,
 scale: 0.4,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.5),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: ww.name,
 font: '11px monospace',
 fillColor: C.chokepoint,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1e7, 0.3),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 8e6),
 },
 description: ww.description ?? ww.name,
 });
 }
  }

  private loadSpaceports(): void {
 const layer = this.layers.get('spaceports');
 if (!layer) return;

 for (const sp of SPACEPORTS) {
 layer.source.entities.add({
 position: Cartesian3.fromDegrees(sp.lon, sp.lat),
 billboard: {
 image: ICON_SPACEPORT,
 color: C.spaceport,
 scale: 0.35,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.4),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: sp.name,
 font: '10px monospace',
 fillColor: C.spaceport,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 1e7),
 },
 description: `${sp.name} — ${sp.operator} (${sp.country}) — ${sp.status}`,
 });
 }
  }

  private loadCriticalMinerals(): void {
 const layer = this.layers.get('minerals');
 if (!layer) return;

 for (const m of CRITICAL_MINERALS) {
 layer.source.entities.add({
 position: Cartesian3.fromDegrees(m.lon, m.lat),
 billboard: {
 image: ICON_MINERAL,
 color: C.mineral,
 scale: 0.25,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.2, 1e7, 0.25),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: m.mineral,
 font: '9px monospace',
 fillColor: C.mineral,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 8e6),
 },
 description: `${m.name} — ${m.mineral} (${m.country}) — ${m.status}\n${m.significance}`,
 });
 }
  }

  private loadIntelHotspots(): void {
 const layer = this.layers.get('hotspots');
 if (!layer) return;

 for (const h of INTEL_HOTSPOTS) {
 const color = hotspotColor(h.level);
 const scale = hotspotScale(h.level);

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(h.lon, h.lat),
 billboard: {
 image: ICON_HOTSPOT,
 color,
 scale,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e5, 1.5, 1e7, 0.5),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: h.name,
 font: '11px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1e7, 0.2),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 1e7),
 },
 description: h.description ?? h.name,
 });
 }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DYNAMIC DATA LAYERS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private async loadEarthquakes(): Promise<void> {
 const layer = this.layers.get('earthquakes');
 if (!layer) return;

 const { fetchEarthquakes } = await import('@/services/earthquakes');
 const quakes = await fetchEarthquakes();

 // Build a fresh map and atomic-swap at the end so concurrent readers
 // (e.g. getAftershockForecast during a refresh tick) never observe an
 // empty in-progress map.
 const nextForecasts = new Map<string, AftershockForecast>();

 // Idempotent rebuild: clear before re-adding so explicit board ids (below) can't
 // collide on a reload/retry (mirrors the maritime refresh pattern).
 layer.source.entities.removeAll();

 for (const eq of quakes) {
 const lat = eq.location?.latitude;
 const lon = eq.location?.longitude;
 if (lat == null || lon == null) continue;

 if (eq.magnitude >= 4 && eq.id) {
 nextForecasts.set(
 eq.id,
 computeAftershockForecast(eq.id, lat, lon, eq.magnitude),
 );
 }

 const isMajor = eq.magnitude >= 5;
 const color = isMajor ? C.earthquake : C.earthquakeMinor;
 const scale = Math.max(0.25, eq.magnitude * 0.08);

 const eqEntity = addEntitySafe(layer.source, {
 // Stable board id so the personal lens can style this marker (E4). Quakes
 // without an upstream id fall back to Cesium's auto-generated unique id.
 ...(eq.id ? { id: boardEntityId('earthquake', eq.id) } : {}),
 position: Cartesian3.fromDegrees(lon, lat),
 billboard: {
 image: ICON_EARTHQUAKE,
 color,
 scale,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.4),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: isMajor ? {
 text: `M${eq.magnitude.toFixed(1)}`,
 font: '11px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 1e7),
 } : undefined,
 description: `${eq.place} — M${eq.magnitude} at ${eq.depthKm}km depth`,
 });
 setEntityTimestampIfPresent(eqEntity, eq.occurredAt);
 }

 this.aftershockForecasts = nextForecasts;
  }

  private async loadGDACS(): Promise<void> {
 const layer = this.layers.get('gdacs');
 if (!layer) return;

 const { fetchGDACSEvents } = await import('@/services/gdacs');
 const events = await fetchGDACSEvents();

 for (const ev of events) {
 const isRed = ev.alertLevel === 'Red';
 const color = isRed ? C.gdacsRed : C.gdacs;
 const [lon, lat] = ev.coordinates;
 const icon = GDACS_ICONS[ev.eventType] ?? ICON_EARTHQUAKE;

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(lon, lat),
 billboard: {
 image: icon,
 color,
 scale: isRed ? 0.5 : 0.35,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.5),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: `${ev.eventType} ${ev.name}`,
 font: '10px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 8e6),
 },
 description: `${ev.name} — ${ev.alertLevel} alert (${ev.country})`,
 });
 }
  }

  private async loadVolcanoes(): Promise<void> {
 const layer = this.layers.get('volcanoes');
 if (!layer) return;

 const { fetchVolcanoAlerts } = await import('@/services/volcano-alerts');
 const volcanoes = await fetchVolcanoAlerts();

 for (const v of volcanoes) {
 const color = volcanoColor(v.alertLevel);
 const scale = volcanoScale(v.alertLevel);

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(v.lon, v.lat),
 billboard: {
 image: ICON_VOLCANO,
 color,
 scale,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.5),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: `${v.name} [${v.alertLevel}]`,
 font: '10px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 6e6),
 },
 description: `${v.name} — ${v.alertLevel} / Aviation ${v.color} (${v.observatory})`,
 });
 }
  }

  private async loadTropicalCyclones(): Promise<void> {
 const layer = this.layers.get('cyclones');
 if (!layer) return;

 const { fetchTropicalCyclones } = await import('@/services/tropical-cyclones');
 const cyclones = await fetchTropicalCyclones();

 // Build a fresh cones map and atomic-swap at the end so concurrent
 // readers (getCycloneCone) never see an empty in-progress map.
 const nextCones = new Map<string, ForecastCone>();

 // Drop tracked positions for cyclones that fell out of the active feed.
 const liveIds = new Set(cyclones.map((tc) => tc.id));
 for (const id of this.cycloneTracks.keys()) {
 if (!liveIds.has(id)) this.cycloneTracks.delete(id);
 }

 for (const tc of cyclones) {
 const advisoryMs = tc.advisoryTime instanceof Date ? tc.advisoryTime.getTime() : Date.now();
 const existing = this.cycloneTracks.get(tc.id) ?? [];
 const last = existing[existing.length - 1];
 // Append only when the advisory has actually progressed; the upstream
 // feed re-serves the same advisory on every poll until a new one lands,
 // and duplicate timestamps would not change the derived heading.
 const isSameAdvisory = last?.timeMs === advisoryMs && last?.lat === tc.lat && last?.lon === tc.lon;
 const track = isSameAdvisory
 ? existing
 : [...existing, { lat: tc.lat, lon: tc.lon, timeMs: advisoryMs }].slice(-6);
 this.cycloneTracks.set(tc.id, track);
 const cone = computeCycloneCone(tc.id, track);
 if (cone) nextCones.set(tc.id, cone);

 const isCat3Plus = tc.category === 'category_3' || tc.category === 'category_4' || tc.category === 'category_5';
 const isCat1Plus = isCat3Plus || tc.category === 'category_1' || tc.category === 'category_2';
 const color = cycloneColor(tc.category, isCat3Plus, isCat1Plus);
 const scale = cycloneScale(tc.category === 'category_5', isCat3Plus, isCat1Plus);

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(tc.lon, tc.lat),
 billboard: {
 image: ICON_CYCLONE,
 color,
 scale,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e5, 1.5, 1e7, 0.6),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: `${tc.name}${tc.windKts ? ' ' + String(tc.windKts) + 'kt' : ''}`,
 font: '11px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1e7, 0.3),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 1.5e7),
 },
 description: `${tc.name} — ${tc.category.replace('_', ' ')} (${tc.basin})\n${tc.movement}\n${tc.headline}`,
 });
 }

 this.cycloneCones = nextCones;
  }

  private async loadFires(): Promise<void> {
 const layer = this.layers.get('fires');
 if (!layer) return;

 const { fetchAllFires, flattenFires, toMapFires } = await import('@/services/wildfires');
 const { fetchActivePerimeters } = await import('@/services/wildfires/fire-intel-service');
 const { clusterHotspots, findNearestPerimeter } = await import('@/services/wildfires/fire-intel-helpers');

 const [fireResult, perimeters] = await Promise.all([
 fetchAllFires().catch(() => ({ regions: {}, totalCount: 0 })),
 fetchActivePerimeters().catch(() => []),
 ]);

 renderPerimeterPolygons(layer, perimeters);
 const clusters = clusterHotspots(toMapFires(flattenFires(fireResult.regions)), { gridDeg: 0.1, topN: 500 });
 renderHotspotClusters(layer, clusters, perimeters, findNearestPerimeter);
  }

  private async loadAirQuality(): Promise<void> {
 const layer = this.layers.get('airQuality');
 if (!layer) return;
 const { fetchPurpleAirSnapshot } = await import('@/services/airquality/purpleair-service');
 const purpleAir = await fetchPurpleAirSnapshot().catch(() => ({ sensors: [], source: 'unknown' as const, fetchedAt: Date.now() }));
 renderPurpleAirDots(layer, purpleAir.sensors);
  }

  private async loadSpaceWeatherOverlay(): Promise<void> {
 const layer = this.layers.get('spaceWeather');
 if (!layer) return;
 const { fetchSpaceWxStatus, renderSpaceWeatherDescriptor, buildOverlayDescriptor } =
 await import('./globe/SpaceWeatherGlobeOverlay');
 const status = await fetchSpaceWxStatus();
 if (!status) return;
 renderSpaceWeatherDescriptor(layer, buildOverlayDescriptor(status));
  }

  private async loadWarRiskZones(): Promise<void> {
 const layer = this.layers.get('warRiskZones');
 if (!layer) return;
 const { WAR_RISK_ZONES } = await import('@/services/maritime/maritime-threats');
 const { warZoneColors } = await import('@/services/globe/overlay-helpers');

 for (const zone of WAR_RISK_ZONES) {
 const palette = warZoneColors(zone.threatCategory);
 const fill = Color.fromCssColorString(palette.fillHex).withAlpha(palette.fillAlpha);
 const outline = Color.fromCssColorString(palette.outlineHex);
 layer.source.entities.add({
 position: Cartesian3.fromDegrees(zone.centerLon, zone.centerLat),
 ellipse: {
 semiMajorAxis: zone.radiusKm * 1000,
 semiMinorAxis: zone.radiusKm * 1000,
 material: new ColorMaterialProperty(fill),
 outline: true,
 outlineColor: outline,
 outlineWidth: 2,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 },
 name: `war-risk-${zone.id}`,
 description: `<b>${escapeHtml(zone.name)}</b><br/>${escapeHtml(zone.rationale)}<br/>Effective: ${zone.effectiveFrom}`,
 });
 }
  }

  private async loadInfrastructureOverlay(): Promise<void> {
 const layer = this.layers.get('infrastructure');
 if (!layer) return;
 const [{ fetchOutages, fetchRadiation }, { outagesToStateOverlay, radiationToHotspots }, { outageRectExtent, radnetPulsePixelSize }] = await Promise.all([
 import('@/services/infrastructure/grid-intelligence-loader'),
 import('@/services/infrastructure/infrastructure-overlay'),
 import('@/services/globe/overlay-helpers'),
 ]);
 const [outages, radiation] = await Promise.all([fetchOutages(), fetchRadiation()]);

 for (const row of outagesToStateOverlay(outages)) {
 const ext = outageRectExtent(row.lat, row.lon, row.severity);
 const fill = Color.fromCssColorString(row.fillColorHex).withAlpha(row.fillOpacity);
 const outline = Color.fromCssColorString(row.fillColorHex);
 layer.source.entities.add({
 rectangle: {
 coordinates: Rectangle.fromDegrees(ext.west, ext.south, ext.east, ext.north),
 material: new ColorMaterialProperty(fill),
 outline: true,
 outlineColor: outline,
 outlineWidth: 1,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 },
 name: `outage-${row.state}`,
 description: `<b>${escapeHtml(row.state)} — ${row.severity}</b><br/>${row.customersAffected.toLocaleString()} customers affected across ${row.countyCount} counties`,
 });
 }

 for (const hot of radiationToHotspots(radiation)) {
 const startMs = Date.now();
 const periodMs = hot.pulsePeriodMs;
 const pulseColor = Color.fromCssColorString(hot.pulseColorHex);
 const pixelSize = new CallbackProperty(() => radnetPulsePixelSize(Date.now() - startMs, periodMs), false);
 layer.source.entities.add({
 position: Cartesian3.fromDegrees(hot.lon, hot.lat),
 point: {
 color: pulseColor,
 outlineColor: Color.BLACK,
 outlineWidth: 1,
 pixelSize,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.4, 1e7, 0.4),
 },
 name: `radnet-${hot.name}`,
 description: radnetDescription(hot),
 });
 }
  }

  /** Resolve the origin for the power-infrastructure Overpass query.
   *  Site-first: the user's highest-priority `data_center` saved place (the
   *  same origin the datacenter readiness layer uses). Falls back to the
   *  current camera center when no site is configured. Radius is clamped so a
   *  generous saved-place radius can't issue a punishing Overpass query. */
  private resolvePowerAnchor(): { lat: number; lon: number; radiusKm: number } | null {
 const site = resolveSiteConfig(getSavedPlaces());
 if (site) {
 const radiusKm = Math.min(50, site.radiusKm > 0 ? site.radiusKm : 25);
 return { lat: site.lat, lon: site.lon, radiusKm };
 }
 // Camera-center fallback.
 const carto = Ellipsoid.WGS84.cartesianToCartographic(this.viewer.camera.positionWC);
 if (!carto) return null;
 const lat = CesiumMath.toDegrees(carto.latitude);
 const lon = CesiumMath.toDegrees(carto.longitude);
 if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
 return { lat, lon, radiusKm: 25 };
  }

  /** Coarse grid-snap key for an anchor so small pans reuse the same cell (and
   *  the sidecar's 6h Overpass cache key) instead of refetching per camera
   *  move. Grid step scales with the query radius. */
  private powerAnchorKey(anchor: { lat: number; lon: number; radiusKm: number }): string {
 const step = Math.max(0.25, anchor.radiusKm / 111); // ~radius in degrees
 const snap = (v: number): number => Math.round(v / step) * step;
 return `${snap(anchor.lat).toFixed(3)},${snap(anchor.lon).toFixed(3)},${anchor.radiusKm}`;
  }

  /** OSM power infrastructure (OpenGridWorks open data via Overpass) around the
   *  resolved site / camera center. Acts as a per-camera-move handler: it always
   *  re-arms (in `finally`) so panning to a new area can refetch, but the actual
   *  rate-limited Overpass call is gated on (a) the layer being enabled and
   *  (b) the anchor *cell* actually changing — so hovering one area, or the
   *  fixed-site path, fetches at most once. Billboards are styled by the pure
   *  `powerOverlayStyle` (per-kind color + weight). */
  private loadPowerInfrastructure(): void {
 const layer = this.layers.get('powerInfrastructure');
 if (!layer) return;

 try {
 // Don't spend an Overpass call while the layer is toggled off.
 if (!this.powerLayerEnabled) return;

 const anchor = this.resolvePowerAnchor();
 if (!anchor) return;

 // Same anchor cell as the last *successful* fetch → nothing new to load.
 const key = this.powerAnchorKey(anchor);
 if (key === this.lastPowerAnchorKey) return;

 // Debounce: camera.changed fires repeatedly during a pan. Defer the fetch
 // until the camera settles so cells panned *through* don't each hit the
 // rate-limited Overpass relay. lastPowerAnchorKey is advanced only after a
 // successful fetch (in fetchPowerInfrastructure), so a cancelled debounce
 // or a failed fetch re-arms this cell cleanly on the next camera move.
 if (this.powerFetchTimer) clearTimeout(this.powerFetchTimer);
 this.powerFetchTimer = setTimeout(() => {
 this.powerFetchTimer = null;
 void this.fetchPowerInfrastructure(anchor, key);
 }, POWER_FETCH_DEBOUNCE_MS);
 } finally {
 // Re-arm so the next camera move re-checks the anchor cell (the cheap key
 // compare above gates whether that actually schedules a refetch).
 layer.loaded = false;
 }
  }

  /** Heavy path for {@link loadPowerInfrastructure}: fetch + render the power
   *  assets for a settled anchor cell. Split out so the camera-driven entry can
   *  debounce it. Commits `lastPowerAnchorKey` only on success. */
  private async fetchPowerInfrastructure(
 anchor: { lat: number; lon: number; radiusKm: number },
 key: string,
  ): Promise<void> {
 const layer = this.layers.get('powerInfrastructure');
 if (!layer || !this.powerLayerEnabled) return;

 const [{ fetchSitePowerAssets }, { powerAssetsToOverlayRows, powerOverlayStyle, powerKindLabel }] =
 await Promise.all([
 import('@/services/infrastructure/osm-power-source'),
 import('@/services/infrastructure/osm-power'),
 ]);

 try {
 const assets = await fetchSitePowerAssets(anchor.lat, anchor.lon, anchor.radiusKm);
 const rows = powerAssetsToOverlayRows(assets);
 // New anchor cell → replace the previous cell's billboards.
 layer.source.entities.removeAll();
 for (const row of rows) {
 const style = powerOverlayStyle(row);
 const color = Color.fromBytes(style.color[0], style.color[1], style.color[2]);
 const showLabel = row.weight >= 0.7;
 layer.source.entities.add({
 position: Cartesian3.fromDegrees(row.lon, row.lat),
 billboard: {
 image: POWER_ICONS[row.kind],
 color,
 scale: 0.22 + row.weight * 0.28,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.2, 1e7, 0.25),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: showLabel ? {
 text: row.label,
 font: '10px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 2e6),
 } : undefined,
 description: `<b>${escapeHtml(row.label)}</b><br/>${escapeHtml(powerKindLabel(row.kind))}<br/><i>© OpenStreetMap contributors</i>`,
 });
 }
 // Commit the cell key only now that the fetch + render actually succeeded,
 // so a cancelled debounce or a failed fetch leaves this cell retryable.
 this.lastPowerAnchorKey = key;
 } catch {
 // Transient fetch failure — leave lastPowerAnchorKey unchanged so a later
 // camera move retries this cell.
 }
  }

  private async loadConflicts(): Promise<void> {
 const layer = this.layers.get('conflicts');
 if (!layer) return;

 const { fetchConflictEvents } = await import('@/services/conflict');
 const data = await fetchConflictEvents();

 for (const ev of data.events) {
 const isExplosion = ev.eventType === 'explosion' || ev.eventType === 'remote_violence';
 const icon = isExplosion ? ICON_EXPLOSION : ICON_CROSSHAIR;
 const color = isExplosion ? C.conflictExplosion : C.conflict;
 const scale = Math.min(0.5, 0.25 + ev.fatalities * 0.02);

 const conflictEntity = layer.source.entities.add({
 position: Cartesian3.fromDegrees(ev.lon, ev.lat),
 billboard: {
 image: icon,
 color,
 scale,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.4, 1e7, 0.3),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: ev.fatalities > 0 ? {
 text: `${ev.fatalities} killed`,
 font: '10px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 8e6),
 } : undefined,
 description: `${ev.eventType} — ${ev.location}, ${ev.country}`,
 });
 if (ev.time) {
 setEntityTimestamp(conflictEntity, ev.time);
 }
 }
  }

  private async loadAirstrikes(): Promise<void> {
 const layer = this.layers.get('airstrikes');
 if (!layer) return;

 const { fetchAirstrikes } = await import('@/services/airstrikes');
 const strikes = await fetchAirstrikes();

 for (const s of strikes) {
 const scale = Math.min(0.5, 0.3 + s.fatalities * 0.02);

 const strikeEntity = layer.source.entities.add({
 position: Cartesian3.fromDegrees(s.lon, s.lat),
 billboard: {
 image: ICON_AIRSTRIKE,
 color: C.airstrike,
 scale,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.4, 1e7, 0.3),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: `${s.actor}`,
 font: '10px monospace',
 fillColor: C.airstrike,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 8e6),
 },
 description: `Airstrike — ${s.actor} vs ${s.targetActor}\n${s.location}, ${s.country}\n${s.fatalities} fatalities\n${s.notes}`,
 });
 if (s.date) {
 const parsed = new Date(s.date);
 if (!Number.isNaN(parsed.getTime())) setEntityTimestamp(strikeEntity, parsed);
 }
 }
  }

  private async loadStrikePackages(): Promise<void> {
 const layer = this.layers.get('strike-packages');
 if (!layer) return;

 const { getStrikePackages } = await import('@/services/strike-packages');
 const packages = getStrikePackages();

 for (const pkg of packages) {
   const isNaval = pkg.domain === 'naval';
   const color = isNaval
     ? Color.fromCssColorString('#f59e0b')
     : Color.fromCssColorString('#3b82f6');

   layer.source.entities.add({
     position: Cartesian3.fromDegrees(pkg.lon, pkg.lat),
     billboard: {
       image: isNaval ? ICON_WARSHIP : ICON_BASE_AIR,
       color,
       scale: 0.5,
       heightReference: HeightReference.CLAMP_TO_GROUND,
       scaleByDistance: new NearFarScalar(1e4, 1.4, 1e7, 0.3),
       verticalOrigin: VerticalOrigin.CENTER,
       horizontalOrigin: HorizontalOrigin.CENTER,
     },
     label: {
       text: pkg.name,
       font: '11px monospace',
       fillColor: color,
       outlineColor: Color.BLACK,
       outlineWidth: 2,
       style: 2,
       pixelOffset: LABEL_OFFSET_SM,
       horizontalOrigin: HorizontalOrigin.CENTER,
       verticalOrigin: VerticalOrigin.BOTTOM,
       scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
       distanceDisplayCondition: new DistanceDisplayCondition(0, 1e7),
     },
     description: `${pkg.name} (${pkg.domain})
Status: ${pkg.status}
${pkg.composition.map(u => u.type + ' x' + String(u.count)).join(', ')}`,
   });

   if (pkg.prediction.extrapolatedPath.length >= 2) {
     const positions = [
       Cartesian3.fromDegrees(pkg.lon, pkg.lat),
       ...pkg.prediction.extrapolatedPath.map(([lat, lon]) =>
         Cartesian3.fromDegrees(lon, lat)),
     ];
     layer.source.entities.add({
       polyline: {
         positions,
         width: 1.5,
         material: new ColorMaterialProperty(color.withAlpha(0.4)),
         clampToGround: true,
       },
     });
   }
 }
 }

  private async loadCyberThreats(): Promise<void> {
 const layer = this.layers.get('cyber');
 if (!layer) return;

 const { fetchCyberThreats } = await import('@/services/cyber');
 const threats = await fetchCyberThreats({ limit: 200 });

 for (const t of threats) {
 if (!t.lat || !t.lon) continue;

 const isCritical = t.severity === 'critical';
 const icon = isCritical ? ICON_CYBER_CRITICAL : ICON_CYBER;
 const color = cyberColor(t.severity);

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(t.lon, t.lat),
 billboard: {
 image: icon,
 color,
 scale: isCritical ? 0.35 : 0.25,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.2, 1e7, 0.2),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 description: `${t.type} — ${t.indicator} (${t.severity})`,
 });
 }
  }

  private async loadMilitaryFlights(): Promise<void> {
 const layer = this.layers.get('flights');
 if (!layer) return;

 const { fetchMilitaryFlights } = await import('@/services/military-flights');
 const { flights } = await fetchMilitaryFlights();

 for (const f of flights) {
 const altMeters = f.altitude * 0.3048;

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(f.lon, f.lat, altMeters),
 orientation: Transforms.headingPitchRollQuaternion(
 Cartesian3.fromDegrees(f.lon, f.lat, altMeters),
 new HeadingPitchRoll(
 CesiumMath.toRadians(f.heading),
 0,
 0,
 ),
 ) as unknown as import('cesium').Property,
 model: {
 uri: modelLoader.getUrlForMilitary(f.aircraftType),
 minimumPixelSize: 24,
 maximumScale: 5000,
 color: C.flight,
 colorBlendMode: 2,
 colorBlendAmount: 0.5,
 },
 label: {
 text: f.callsign ?? f.hexCode,
 font: '10px monospace',
 fillColor: C.flight,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 8e6),
 },
 description: `${f.callsign || 'Unknown'} — ${f.aircraftModel ?? f.aircraftType} (${f.operatorCountry})` +
 `\nAlt: ${Math.round(f.altitude).toLocaleString()} ft | Speed: ${Math.round(f.speed)} kts | Hdg: ${Math.round(f.heading)}°`,
 });

 if (f.track && f.track.length >= 2) {
 const trailPositions = f.track.map(([lon, lat]: [number, number]) =>
 Cartesian3.fromDegrees(lon, lat),
 );
 layer.source.entities.add({
 polyline: {
 positions: trailPositions,
 width: 1.5,
 material: new ColorMaterialProperty(C.flightTrail),
 clampToGround: true,
 },
 });
 }
 }
  }

  private async loadAviationIntel(): Promise<void> {
 const layer = this.layers.get('aviationIntel');
 if (!layer) return;

 const [{ fetchAviationIntelSnapshot }, helpers, { fetchLiveFlights }] = await Promise.all([
 import('@/services/aviation/aviation-intel-service'),
 import('@/services/aviation/aviation-globe-helpers'),
 import('@/services/aviation/commercial-flights-service'),
 ]);
 const [snapshot, liveFlights] = await Promise.all([
 fetchAviationIntelSnapshot(),
 fetchLiveFlights(),
 ]);

 layer.source.entities.removeAll();

 for (const tfr of helpers.tfrsWithGeometry(snapshot.notams.data)) {
 this.addAviationTfrEntity(layer, tfr, helpers);
 }
 for (const sigmet of snapshot.sigmets.data) {
 if (sigmet.polygon.length >= 3) this.addAviationSigmetEntity(layer, sigmet, helpers);
 }
 for (const ash of helpers.ashAdvisoriesWithPolygon(snapshot.volcanicAsh.data)) {
 this.addAviationAshEntity(layer, ash, helpers);
 }
 for (const ac of helpers.aircraftWithPosition(snapshot.military.data)) {
 this.addAviationAircraftEntity(layer, ac, helpers);
 }
 // Commercial / cargo / GA flights — emergencies always render with a red
 // pulse; non-emergency flights are capped to keep the globe usable.
 for (const flight of this.selectFlightsForGlobe(liveFlights.flights)) {
 this.addCommercialFlightEntity(layer, flight);
 }
  }

  private selectFlightsForGlobe(
 flights: readonly import('@/services/aviation/commercial-flights-classify').LiveFlight[],
  ): import('@/services/aviation/commercial-flights-classify').LiveFlight[] {
 const NON_EMERGENCY_CAP = 1500;
 const out: import('@/services/aviation/commercial-flights-classify').LiveFlight[] = [];
 const nonEmergency: import('@/services/aviation/commercial-flights-classify').LiveFlight[] = [];
 for (const f of flights) {
 if (f.onGround) continue;
 if (f.emergency) {
 out.push(f);
 } else if (f.category !== 'military') {
 // Military aircraft are already rendered via the existing
 // aircraftWithPosition pass — skip to avoid duplicates.
 nonEmergency.push(f);
 }
 }
 // Sort cargo + commercial first so the cap doesn't drop the most
 // recognisable category.
 nonEmergency.sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
 for (const f of nonEmergency.slice(0, NON_EMERGENCY_CAP)) out.push(f);
 return out;
  }

  private addCommercialFlightEntity(
 layer: GlobeLayer,
 flight: import('@/services/aviation/commercial-flights-classify').LiveFlight,
  ): void {
 const altMeters = flight.altitudeFt === null ? 0 : flight.altitudeFt * 0.3048;
 const heading = flight.headingDeg ?? 0;
 const colorHex = COMMERCIAL_FLIGHT_HEX[flight.category] ?? '#9e9e9e';
 const color = Color.fromCssColorString(colorHex);
 if (flight.emergency) {
 // Red pulsing dot — pulsing achieved via a CallbackProperty on alpha.
 const startMs = Date.now();
 const pulse = new CallbackProperty(() => {
 const t = ((Date.now() - startMs) % 1200) / 1200;
 const alpha = 0.4 + 0.6 * Math.abs(Math.sin(t * Math.PI));
 return Color.RED.withAlpha(alpha);
 }, false);
 addEntitySafe(layer.source, new Entity({
 id: `aviation-flight-${flight.icao24}`,
 position: Cartesian3.fromDegrees(flight.lon, flight.lat, altMeters),
 point: {
 pixelSize: 14,
 color: pulse,
 outlineColor: Color.WHITE,
 outlineWidth: 2,
 heightReference: HeightReference.NONE,
 },
 label: flight.callsign ? {
 text: `${flight.callsign}  SQ ${flight.squawk ?? ''}`,
 font: '11px monospace',
 fillColor: Color.RED,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 1.5e7),
 } : undefined,
 description: commercialFlightDescriptionHtml(flight),
 name: flight.callsign ?? flight.icao24,
 }));
 return;
 }
 const icon = flight.category === 'helicopter' ? ICON_HELICOPTER : ICON_TRANSPORT;
 addEntitySafe(layer.source, new Entity({
 id: `aviation-flight-${flight.icao24}`,
 position: Cartesian3.fromDegrees(flight.lon, flight.lat, altMeters),
 billboard: {
 image: icon,
 color,
 scale: 0.22,
 rotation: CesiumMath.toRadians(-heading),
 alignedAxis: Cartesian3.UNIT_Z,
 heightReference: HeightReference.NONE,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.CENTER,
 scaleByDistance: new NearFarScalar(1e5, 0.9, 1.5e7, 0.25),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 8e6),
 },
 label: flight.callsign ? {
 text: flight.callsign,
 font: '9px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 3e6),
 } : undefined,
 description: commercialFlightDescriptionHtml(flight),
 name: flight.callsign ?? flight.icao24,
 }));
  }

  private addAviationTfrEntity(
 layer: GlobeLayer,
 tfr: import('@/services/aviation/aviation-intel-types').AviationNotam,
 helpers: typeof import('@/services/aviation/aviation-globe-helpers'),
  ): void {
 if (!tfr.center) return;
 const ring = helpers.circleToPolygon({
 centerLat: tfr.center.lat,
 centerLon: tfr.center.lon,
 radiusNm: tfr.center.radiusNm,
 });
 const positions = ring.map((p) => Cartesian3.fromDegrees(p.lon, p.lat));
 const style = helpers.notamStyle(tfr);
 const outline = Color.fromCssColorString(style.outlineHex);
 const fill = Color.fromCssColorString(style.fillHex).withAlpha(style.fillAlpha);
 addEntitySafe(layer.source, new Entity({
 id: `aviation-tfr-${tfr.id}`,
 polygon: new PolygonGraphics({
 hierarchy: new PolygonHierarchy(positions),
 material: fill,
 outline: true,
 outlineColor: outline,
 outlineWidth: 2,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 }),
 description: helpers.notamDescriptionHtml(tfr),
 name: tfr.notamNumber || tfr.id,
 }));
  }

  private addAviationSigmetEntity(
 layer: GlobeLayer,
 sigmet: import('@/services/aviation/aviation-intel-types').AviationSigmet,
 helpers: typeof import('@/services/aviation/aviation-globe-helpers'),
  ): void {
 const positions = sigmet.polygon.map((p) => Cartesian3.fromDegrees(p.lon, p.lat));
 const style = helpers.sigmetStyle(sigmet);
 const color = Color.fromCssColorString(style.hex);
 addEntitySafe(layer.source, new Entity({
 id: `aviation-sigmet-${sigmet.id}`,
 polygon: new PolygonGraphics({
 hierarchy: new PolygonHierarchy(positions),
 material: color.withAlpha(style.fillAlpha),
 outline: true,
 outlineColor: color,
 outlineWidth: 1,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 }),
 description: helpers.sigmetDescriptionHtml(sigmet),
 name: `${sigmet.hazard} (${sigmet.severity})`,
 }));
  }

  private addAviationAshEntity(
 layer: GlobeLayer,
 ash: import('@/services/aviation/aviation-intel-types').VolcanicAshAdvisory,
 helpers: typeof import('@/services/aviation/aviation-globe-helpers'),
  ): void {
 const positions = ash.polygon.map((p) => Cartesian3.fromDegrees(p.lon, p.lat));
 const color = Color.fromCssColorString(helpers.VOLCANIC_ASH_HEX);
 addEntitySafe(layer.source, new Entity({
 id: `aviation-ash-${ash.id}`,
 polygon: new PolygonGraphics({
 hierarchy: new PolygonHierarchy(positions),
 material: color.withAlpha(helpers.VOLCANIC_ASH_FILL_ALPHA),
 outline: true,
 outlineColor: color,
 outlineWidth: 2,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 }),
 description: `<h3>${ash.volcano} ash advisory</h3><pre>${ash.text}</pre>`,
 name: `${ash.volcano} ash`,
 }));
  }

  private addAviationAircraftEntity(
 layer: GlobeLayer,
 ac: import('@/services/aviation/aviation-intel-types').MilitaryAircraft,
 helpers: typeof import('@/services/aviation/aviation-globe-helpers'),
  ): void {
 if (ac.lat === null || ac.lon === null) return;
 const altMeters = ac.altitudeFt === null ? 0 : ac.altitudeFt * 0.3048;
 const style = helpers.aircraftStyle(ac);
 const color = Color.fromCssColorString(style.hex);
 addEntitySafe(layer.source, new Entity({
 id: `aviation-mil-${ac.icao24}`,
 position: Cartesian3.fromDegrees(ac.lon, ac.lat, altMeters),
 point: {
 pixelSize: style.emergency ? 10 : 6,
 color,
 outlineColor: Color.BLACK,
 outlineWidth: style.emergency ? 2 : 1,
 heightReference: HeightReference.NONE,
 },
 label: ac.callsign ? {
 text: ac.callsign,
 font: '10px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 8e6),
 } : undefined,
 description: helpers.aircraftDescriptionHtml(ac),
 name: ac.callsign ?? ac.icao24,
 }));
  }

  private async loadMilitaryVessels(): Promise<void> {
 const layer = this.layers.get('vessels');
 if (!layer) return;

 const { fetchMilitaryVessels } = await import('@/services/military-vessels');
 const { vessels } = await fetchMilitaryVessels();

 for (const v of vessels) {
 this.addVesselEntity(layer.source, v);
 }
  }

  private addVesselEntity(
 source: CustomDataSource,
 v: { lon: number; lat: number; heading: number; speed: number; name: string; mmsi: string; vesselType: string; isDark?: boolean; nearChokepoint?: string; track?: [number, number][] },
  ): void {
 const isDark = v.isDark ?? false;
 const color = isDark ? C.vesselDark : C.vessel;
 const icon = VESSEL_ICONS[v.vesselType] ?? ICON_WARSHIP;
 const isLarge = v.vesselType === 'carrier' || v.vesselType === 'amphibious';

 source.entities.add({
 position: Cartesian3.fromDegrees(v.lon, v.lat),
 billboard: {
 image: icon,
 color,
 scale: isLarge ? 0.45 : 0.35,
 rotation: CesiumMath.toRadians(-v.heading),
 alignedAxis: Cartesian3.UNIT_Z,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.5),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: v.name ?? v.mmsi,
 font: '10px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 8e6),
 },
 description: `${v.name ?? v.mmsi} — ${v.vesselType}${isDark ? ' (DARK SHIP)' : ''}` +
 `\nSpeed: ${Math.round(v.speed)} kts | Hdg: ${Math.round(v.heading)}°` +
 (v.nearChokepoint ? `\nNear: ${v.nearChokepoint}` : ''),
 });

 if (v.track && v.track.length >= 2) {
 const trailPositions = v.track.map(([lon, lat]: [number, number]) =>
 Cartesian3.fromDegrees(lon, lat),
 );
 source.entities.add({
 polyline: {
 positions: trailPositions,
 width: 1.5,
 material: new ColorMaterialProperty(isDark ? C.vesselDarkTrail : C.vesselTrail),
 clampToGround: true,
 },
 });
 }
  }

  /**
   * Live AIS vessel layer fed by `/api/maritime/vessels` (sidecar's
   * risk-zone-filtered AIS stream). Renders each vessel as a coloured
   * point primitive with rotation matching its heading. Refreshes
   * every 5 minutes; previous entities are cleared on each tick.
   *
   * Distinct from `loadMilitaryVessels` (curated warship roster) and
   * `loadDarkVessels` (AIS gap detector). All three can render
   * simultaneously when their HUD toggles are on.
   */
  private async loadMaritimeVessels(): Promise<void> {
    await this.refreshMaritimeVessels();
    this.maritimeVesselsTimer ??= setInterval(
      () => { void this.refreshMaritimeVessels(); },
      5 * 60 * 1000,
    );
  }

  private async refreshMaritimeVessels(): Promise<void> {
    const layer = this.layers.get('maritimeVessels');
    if (!layer) return;
    const helpers = await import('@/services/maritime/vessel-globe-helpers');
    let vessels: import('@/services/maritime/vessel-globe-helpers').MaritimeVesselWire[] = [];
    try {
      const r = await fetch('/api/maritime/vessels', { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const body = (await r.json()) as { vessels?: typeof vessels };
      vessels = Array.isArray(body.vessels) ? helpers.dedupeVesselsByMmsi(body.vessels) : [];
    } catch {
      return;
    }
    layer.source.entities.removeAll();
    for (const v of vessels) {
      const css = helpers.vesselColorCss(v.category);
      const color = Color.fromCssColorString(css);
      addEntitySafe(layer.source, {
        id: `maritime-vessel-${v.mmsi}`,
        position: Cartesian3.fromDegrees(v.lon, v.lat),
        point: {
          pixelSize: 8,
          color,
          outlineColor: Color.BLACK,
          outlineWidth: 1,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          scaleByDistance: new NearFarScalar(1e5, 1.4, 1.5e7, 0.6),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 2e7),
        },
        billboard: {
          image: VESSEL_TRIANGLE_DATAURI,
          color,
          scale: 0.5,
          rotation: CesiumMath.toRadians(-helpers.vesselRotationDeg(v.headingDeg)),
          alignedAxis: Cartesian3.UNIT_Z,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          scaleByDistance: new NearFarScalar(1e5, 0.7, 1.5e7, 0.25),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 1.5e7),
          verticalOrigin: VerticalOrigin.CENTER,
          horizontalOrigin: HorizontalOrigin.CENTER,
        },
        description: helpers.vesselTooltip(v),
        properties: {
          mmsi: v.mmsi,
          category: v.category,
          flag: v.flag,
          zoneId: v.zoneId,
          observedAt: v.observedAt,
        },
      });
    }
  }

  private async loadDarkVessels(): Promise<void> {
 const layer = this.layers.get('darkVessels');
 if (!layer) return;

 const { detectDarkVessels } = await import('@/services/dark-vessel');
 const alerts = detectDarkVessels();

 for (const dv of alerts) {
 const isCritical = dv.severity === 'critical' || dv.severity === 'high';
 const color = isCritical ? C.darkVesselCritical : C.darkVessel;

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(dv.lastLon, dv.lastLat),
 billboard: {
 image: ICON_DARK_VESSEL,
 color,
 scale: isCritical ? 0.4 : 0.3,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.5),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: `${dv.vesselName || dv.mmsi} DARK ${Math.round(dv.darkHours)}h`,
 font: '10px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 1e7),
 },
 description: `DARK VESSEL — ${dv.vesselName || dv.mmsi} (${dv.flag})` +
 `\nAIS off for ${Math.round(dv.darkHours)} hours` +
 `\nRisk zone: ${dv.riskZone}` +
 (dv.sanctioned ? '\nSANCTIONED' : ''),
 });
 }
  }

  private async loadGpsJamming(): Promise<void> {
 const layer = this.layers.get('gpsJamming');
 if (!layer) return;

 const { fetchGpsInterference } = await import('@/services/gps-interference');
 const data = await fetchGpsInterference();
 if (!data) return;

 for (const hex of data.hexes) {
 const color = hex.level === 'high' ? C.gpsHigh : C.gpsMedium;

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(hex.lon, hex.lat),
 billboard: {
 image: ICON_GPS_JAM,
 color,
 scale: hex.level === 'high' ? 0.4 : 0.3,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.4),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: hex.level === 'high' ? {
 text: `GPS JAM ${Math.round(hex.pct)}%`,
 font: '10px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 1e7),
 } : undefined,
 description: `GPS Interference — ${hex.pct.toFixed(1)}% affected\n${hex.bad}/${hex.total} reports degraded`,
 });
 }
  }

  private async loadSatelliteChange(): Promise<void> {
 const layer = this.layers.get('satChange');
 if (!layer) return;

 const { getRecentDetections, getWatchLocations } = await import('@/services/satellite-change');

 // Show watched locations as rings
 const locations = getWatchLocations();
 for (const loc of locations) {
 if (!loc.enabled) continue;
 layer.source.entities.add({
 position: Cartesian3.fromDegrees(loc.lon, loc.lat),
 billboard: {
 image: ICON_SAT_CHANGE,
 color: C.satChangeLow,
 scale: 0.3,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.2, 1e7, 0.3),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: loc.name,
 font: '10px monospace',
 fillColor: C.satChangeLow,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 1e7),
 },
 description: `Watch zone: ${loc.name} (${loc.radiusKm}km radius)`,
 });
 }

 // Show recent detections
 const detections = getRecentDetections(72);
 for (const d of detections) {
 const color = satChangeColor(d.severity);

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(d.lon, d.lat),
 billboard: {
 image: ICON_SAT_CHANGE,
 color,
 scale: 0.35,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.4),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 description: `${d.changeType} at ${d.locationName}\n${d.description}\nConfidence: ${d.confidence}% | Area: ${d.areaSqKm.toFixed(1)} km²`,
 });
 }
  }

  private async loadProtests(): Promise<void> {
 const layer = this.layers.get('protests');
 if (!layer) return;

 const { fetchProtestEvents } = await import('@/services/unrest');
 const data = await fetchProtestEvents();

 for (const ev of data.events) {
 const isHigh = ev.severity === 'high';
 const color = isHigh ? C.protestHigh : C.protest;

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(ev.lon, ev.lat),
 billboard: {
 image: ICON_PROTEST,
 color,
 scale: isHigh ? 0.35 : 0.25,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.2, 1e7, 0.25),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: isHigh ? {
 text: ev.title,
 font: '10px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 8e6),
 } : undefined,
 description: `${ev.title} — ${ev.eventType} (${ev.country})`,
 });
 }
  }

  private async loadDiseaseOutbreaks(): Promise<void> {
 const layer = this.layers.get('disease');
 if (!layer) return;

 const { fetchDiseaseIntel } = await import('@/services/disease-intel');
 const data = await fetchDiseaseIntel();

 for (const c of data.covidCountries) {
 if (!c.lat || !c.lon) continue;
 const color = diseaseColor(c.casesPerOneMillion);
 const scale = diseaseScale(c.casesPerOneMillion);
 const showLabel = c.casesPerOneMillion > 1000;

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(c.lon, c.lat),
 billboard: {
 image: ICON_DISEASE,
 color,
 scale,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e5, 1.5, 1e7, 0.4),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: showLabel ? {
 text: `${c.country} ${c.todayCases > 0 ? '+' + c.todayCases.toLocaleString() : ''}`,
 font: '10px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 1e7),
 } : undefined,
 description: `${c.country} — Active: ${c.active.toLocaleString()} | Today: +${c.todayCases.toLocaleString()} | Per 1M: ${Math.round(c.casesPerOneMillion).toLocaleString()}`,
 });
 }
  }

  private async loadDisplacement(): Promise<void> {
 const layer = this.layers.get('displacement');
 if (!layer) return;

 const { fetchUnhcrPopulation } = await import('@/services/displacement');
 const result = await fetchUnhcrPopulation();
 if (!result.ok) return;

 // Country markers for displacement origin countries
 for (const country of result.data.countries) {
 if (!country.lat || !country.lon || country.totalDisplaced < 10_000) continue;
 const isHigh = country.totalDisplaced > 1_000_000;
 const color = isHigh ? C.displacementHigh : C.displacement;
 const scale = Math.min(0.5, 0.2 + Math.log10(country.totalDisplaced) * 0.04);

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(country.lon, country.lat),
 billboard: {
 image: ICON_DISPLACEMENT,
 color,
 scale,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e5, 1.5, 1e7, 0.4),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: isHigh ? {
 text: `${country.name} ${(country.totalDisplaced / 1e6).toFixed(1)}M`,
 font: '10px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 1.5e7),
 } : undefined,
 description: `${country.name} — ${country.totalDisplaced.toLocaleString()} displaced` +
 `\nRefugees: ${country.refugees.toLocaleString()} | IDPs: ${country.idps.toLocaleString()}`,
 });
 }

 // Arc lines for top refugee flows
 for (const flow of result.data.topFlows.slice(0, 30)) {
 if (!flow.originLat || !flow.originLon || !flow.asylumLat || !flow.asylumLon) continue;
 if (flow.refugees < 50_000) continue;

 layer.source.entities.add({
 polyline: {
 positions: [
 Cartesian3.fromDegrees(flow.originLon, flow.originLat),
 Cartesian3.fromDegrees(flow.asylumLon, flow.asylumLat),
 ],
 width: Math.min(4, 1 + Math.log10(flow.refugees) * 0.3),
 material: new ColorMaterialProperty(C.displacementFlow),
 clampToGround: true,
 },
 description: `${flow.originName} → ${flow.asylumName}: ${flow.refugees.toLocaleString()} refugees`,
 });
 }
  }

  private async loadOrbitalSatellites(): Promise<void> {
 const layer = this.layers.get('satellites');
 if (!layer) return;

 const { fetchOrbitalSatellites } = await import('@/services/celestrak-tle');
 const sats = await fetchOrbitalSatellites();

 for (const sat of sats) {
 const altMeters = sat.alt * 1000;
 const isStation = sat.group === 'stations';
 const color = isStation
 ? Color.fromCssColorString('#00ffff')
 : Color.fromCssColorString('#aaaaff');

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(sat.lon, sat.lat, altMeters),
 billboard: {
 image: ICON_SATELLITE,
 color,
 scale: isStation ? 0.6 : 0.35,
 scaleByDistance: new NearFarScalar(1e5, 1.5, 5e7, 0.4),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: sat.name,
 font: '10px monospace',
 fillColor: color,
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET_SM,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 5e7, 0.3),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 2e7),
 },
 description: `${sat.name}\nGroup: ${sat.group}\nAltitude: ${Math.round(sat.alt)} km\nLat: ${sat.lat.toFixed(2)}° Lon: ${sat.lon.toFixed(2)}°`,
 });
 }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // WEATHER LAYERS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  private async loadWeatherRadar(): Promise<void> {
 try {
 const state = await fetchRadarFrames();
 const tileUrl = getRadarTileUrl(state);
 if (!tileUrl) return;
 const provider = new UrlTemplateImageryProvider({ url: tileUrl, maximumLevel: 6 });
 const imgLayer = this.viewer.imageryLayers.addImageryProvider(provider);
 imgLayer.alpha = 0.5;
 this.weatherImageryLayers.push(imgLayer);
 } catch { /* radar unavailable */ }
  }

  private loadWeatherSatellite(): void {
 try {
 const tileUrl = getGoesWmsTileUrl('geocolor');
 const provider = new UrlTemplateImageryProvider({ url: tileUrl, maximumLevel: 7 });
 const imgLayer = this.viewer.imageryLayers.addImageryProvider(provider);
 imgLayer.alpha = 0.7;
 this.weatherImageryLayers.push(imgLayer);
 } catch { /* satellite imagery unavailable */ }
  }

  private loadSmokeForecastWms(): void {
 try {
 // Server-default TIME (nearest current hour) — the globe is the ambient
 // view; scrubbing through the 72 h forecast lives on the 2D map.
 const provider = new WebMapServiceImageryProvider({
 url: FIREWORK_WMS_BASE,
 layers: FIREWORK_LAYER,
 parameters: { format: 'image/png', transparent: true },
 });
 const imgLayer = this.viewer.imageryLayers.addImageryProvider(provider);
 imgLayer.alpha = 0.55;
 this.weatherImageryLayers.push(imgLayer);
 } catch { /* smoke forecast unavailable — other weather layers unaffected */ }
  }

  private async loadFloodAlerts(): Promise<void> {
 const layer = this.layers.get('floodAlerts');
 if (!layer) return;
 try {
 const base = getApiBaseUrl();
 const r = await fetch(`${base}/api/floods/warnings`, { signal: AbortSignal.timeout(10_000) });
 if (!r.ok) return;
 const data = await r.json() as { alerts?: { id: string; event: string; severity: string; headline: string; polygon: { type: string; coordinates: number[][][] } | null }[] };
 const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
 const SEVERITY_COLORS: Record<string, string> = {
 Extreme: '#cc0000',
 Severe: '#ff4400',
 Moderate: '#ff8800',
 Minor: '#ffcc00',
 };
 for (const alert of alerts) {
 if (!alert.polygon?.coordinates?.[0]) continue;
 const outerRing = alert.polygon.coordinates[0];
 const flat = outerRing.flatMap(coord => [coord[0] ?? 0, coord[1] ?? 0]);
 if (flat.length < 6) continue;
 const fillHex = SEVERITY_COLORS[alert.severity] ?? '#0088ff';
 const fillColor = Color.fromCssColorString(fillHex).withAlpha(0.35);
 const outlineColor = Color.fromCssColorString(fillHex).withAlpha(0.8);
 layer.source.entities.add({
 name: alert.id,
 polygon: {
 hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flat)),
 material: new ColorMaterialProperty(fillColor),
 outline: true,
 outlineColor,
 outlineWidth: 2,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 },
 description: escapeHtml(alert.headline),
 });
 }
 } catch { /* flood alerts unavailable */ }
  }

  private async loadLightningStrikes(): Promise<void> {
 const layer = this.layers.get('lightningStrikes');
 if (!layer) return;

 try {
 const strikes = await fetchLightningStrikes();
 for (const s of strikes.slice(0, 200)) {
 const ageMin = (Date.now() - s.time) / 60_000;
 const alpha = Math.max(0.3, 1 - ageMin / 30);
 let color = Color.YELLOW.withAlpha(alpha);
 if (s.intensity > 100) color = Color.RED.withAlpha(alpha);
 else if (s.intensity > 50) color = Color.ORANGE.withAlpha(alpha);

 layer.source.entities.add({
 position: Cartesian3.fromDegrees(s.lon, s.lat),
 point: {
 pixelSize: 4,
 color,
 outlineColor: Color.WHITE.withAlpha(alpha * 0.5),
 outlineWidth: 1,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 2, 1e7, 0.5),
 },
 });
 }
 } catch { /* lightning unavailable */ }
  }

  /**
   * Weather Hazards layer (PR 3 of weather-hazards stack).
   *
   * Renders three things from PR 1's data sources:
   *   1. NWS alert polygons   — tornado/hurricane/flood/winter colored fills
   *   2. Hurricane forecast track + uncertainty cone (NHC GeoJSON)
   *   3. Storm-center billboards (note: visual overlap with the existing
   *      `cyclones` layer is expected when both are enabled — this
   *      layer is the "weather hazard" view, the other is the general
   *      cyclone tracker)
   *
   * Click on any alert polygon → Cesium description popup with the
   * alert event, area description, headline, and expires-in time.
   */
  private async loadWeatherHazards(): Promise<void> {
    const layer = this.layers.get('weatherHazards');
    if (!layer) return;
    try {
      const [
        { fetchHazardAlerts, fetchTropicalStorms },
        { alertsToPolygonDescriptors, stormsToBillboards },
      ] = await Promise.all([
        import('@/services/weather/nws-hazards'),
        import('./weather-hazard-globe-helpers'),
      ]);
      const [alerts, storms] = await Promise.all([fetchHazardAlerts(), fetchTropicalStorms()]);
      for (const p of alertsToPolygonDescriptors(alerts)) {
        this.addAlertPolygon(layer, p);
      }
      for (const b of stormsToBillboards(storms)) {
        this.addStormBillboard(layer, b);
      }
      for (const s of storms) {
        if (s.forecastTrackUrl) await this.addStormForecastTrack(layer, s);
      }
    } catch { /* hazards unavailable */ }
  }

  private addAlertPolygon(
    layer: GlobeLayer,
    p: import('./weather-hazard-globe-helpers').AlertPolygonDescriptor,
  ): void {
    const flat = p.rings[0]!;
    const fillColor = Color.fromCssColorString(p.color).withAlpha(0.35);
    const outlineColor = Color.fromCssColorString(p.color);
    layer.source.entities.add({
      name: `weather-alert-${p.alertId}`,
      polygon: {
        hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flat)),
        material: new ColorMaterialProperty(fillColor),
        outline: true,
        outlineColor,
        outlineWidth: 2,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
      description: p.description,
    });
  }

  private addStormBillboard(
    layer: GlobeLayer,
    b: import('./weather-hazard-globe-helpers').StormBillboardDescriptor,
  ): void {
    layer.source.entities.add({
      position: Cartesian3.fromDegrees(b.position.lng, b.position.lat),
      billboard: {
        image: ICON_CYCLONE,
        color: Color.fromCssColorString(b.color),
        scale: 0.6,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        scaleByDistance: new NearFarScalar(1e5, 1.5, 1e7, 0.6),
        verticalOrigin: VerticalOrigin.CENTER,
        horizontalOrigin: HorizontalOrigin.CENTER,
      },
      label: {
        text: b.name,
        font: '11px monospace',
        fillColor: Color.fromCssColorString(b.color),
        outlineColor: Color.BLACK,
        outlineWidth: 2,
        style: 2,
        pixelOffset: LABEL_OFFSET,
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.BOTTOM,
        scaleByDistance: new NearFarScalar(1e5, 1, 1e7, 0.3),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 1.5e7),
      },
      description: b.description,
    });
  }

  private async addStormForecastTrack(
    layer: GlobeLayer,
    s: import('@/services/weather/nws-hazards').NhcStorm,
  ): Promise<void> {
    if (!s.forecastTrackUrl) return;
    try {
      const trackUrl = `${getApiBaseUrl()}/api/weather/tropical/track?url=${encodeURIComponent(s.forecastTrackUrl)}`;
      const resp = await fetch(trackUrl);
      if (!resp.ok) return;
      const trackJson: unknown = await resp.json();
      const { parseHurricaneTrack } = await import('@/services/weather/nws-hazards');
      const { trackToDescriptor } = await import('./weather-hazard-globe-helpers');
      const parsed = parseHurricaneTrack(trackJson, s.id);
      if (!parsed) return;
      const desc = trackToDescriptor(parsed, s);
      if (desc.trackPolyline.length >= 4) {
        layer.source.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArray(desc.trackPolyline),
            width: 3,
            material: Color.fromCssColorString(STORM_TRACK_COLOR_HEX).withAlpha(0.9),
            clampToGround: true,
          },
          name: `track-${s.id}`,
        });
      }
      if (desc.uncertaintyCone) {
        layer.source.entities.add({
          polygon: {
            hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(desc.uncertaintyCone)),
            material: new ColorMaterialProperty(
              Color.fromCssColorString(STORM_TRACK_COLOR_HEX).withAlpha(0.18),
            ),
            outline: true,
            outlineColor: Color.fromCssColorString(STORM_TRACK_COLOR_HEX),
            outlineWidth: 1,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
          name: `cone-${s.id}`,
        });
      }
    } catch { /* track unavailable */ }
  }

  /**
   * Wastewater Genomics — color US states by SARS-CoV-2 wastewater
   * percentile (CDC NWSS, dataset 2ew6-ywp6). Renders one colored
   * point primitive at each state's centroid, scaled by level.
   * 'low' states are dropped to keep the globe legible.
   */
  private async loadWastewaterStates(): Promise<void> {
    const layer = this.layers.get('wastewaterStates');
    if (!layer) return;
    try {
      const [
        { fetchWastewaterSurveillance },
        { buildWastewaterStateEntities },
      ] = await Promise.all([
        import('@/services/biosurveillance/wastewater-service'),
        import('./wastewater-globe-helpers'),
      ]);
      const snapshot = await fetchWastewaterSurveillance();
      const entities = buildWastewaterStateEntities(snapshot.states);
      for (const e of entities) {
        layer.source.entities.add({
          name: `wastewater-state-${e.stateCode}`,
          position: Cartesian3.fromDegrees(e.lon, e.lat),
          point: {
            color: Color.fromCssColorString(e.fillColor).withAlpha(0.7),
            outlineColor: Color.fromCssColorString(e.fillColor),
            outlineWidth: 2,
            pixelSize: e.radiusPx,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            scaleByDistance: new NearFarScalar(1e5, 1.2, 1e7, 0.6),
          },
          label: {
            text: e.stateCode,
            font: '11px monospace',
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            style: 2,
            pixelOffset: LABEL_OFFSET,
            horizontalOrigin: HorizontalOrigin.CENTER,
            verticalOrigin: VerticalOrigin.BOTTOM,
            scaleByDistance: new NearFarScalar(1e5, 1, 1e7, 0.3),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 1.5e7),
          },
          description: e.description,
        });
      }
    } catch { /* wastewater overlay unavailable */ }
  }

  private async loadRedFlagWarnings(): Promise<void> {
 const layer = this.layers.get('redFlagWarnings');
 if (!layer) return;

 try {
 const warnings = await fetchRedFlagWarnings();
 for (const w of warnings) {
 if (!w.centroid) continue;
 layer.source.entities.add({
 position: Cartesian3.fromDegrees(w.centroid[0], w.centroid[1]),
 billboard: {
 image: ICON_FIRE,
 color: Color.fromCssColorString('#ef4444'),
 scale: 0.35,
 heightReference: HeightReference.CLAMP_TO_GROUND,
 scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.4),
 verticalOrigin: VerticalOrigin.CENTER,
 horizontalOrigin: HorizontalOrigin.CENTER,
 },
 label: {
 text: w.event,
 font: '10px monospace',
 fillColor: Color.fromCssColorString('#ef4444'),
 outlineColor: Color.BLACK,
 outlineWidth: 2,
 style: 2,
 pixelOffset: LABEL_OFFSET,
 horizontalOrigin: HorizontalOrigin.CENTER,
 verticalOrigin: VerticalOrigin.BOTTOM,
 scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
 distanceDisplayCondition: new DistanceDisplayCondition(0, 5e6),
 },
 description: `${w.event}: ${w.headline}`,
 });
 }
 } catch { /* red flag unavailable */ }
  }

  private async loadVolcanoMonitorMarkers(): Promise<void> {
    const layer = this.layers.get('volcanoMonitor');
    if (!layer) return;
    try {
      const { fetchVolcanoMonitorStatus, aviationColorHex } = await import('@/services/volcano-monitor');
      const status = await fetchVolcanoMonitorStatus();
      for (const v of status.volcanoes) {
        const hex = aviationColorHex(v.aviationColor);
        const color = Color.fromCssColorString(hex);
        layer.source.entities.add({
          position: Cartesian3.fromDegrees(v.lon, v.lat),
          billboard: {
            image: ICON_VOLCANO,
            color,
            scale: 0.7,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.5),
            verticalOrigin: VerticalOrigin.CENTER,
            horizontalOrigin: HorizontalOrigin.CENTER,
          },
          label: {
            text: `${v.name} [${v.alertLevel}]`,
            font: '10px monospace',
            fillColor: color,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            style: 2,
            pixelOffset: LABEL_OFFSET,
            horizontalOrigin: HorizontalOrigin.CENTER,
            verticalOrigin: VerticalOrigin.BOTTOM,
            scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 6e6),
          },
          description: `${v.name} — Alert: ${v.alertLevel} / Aviation: ${v.aviationColor} (${v.observatory})`,
        });
      }
    } catch { /* volcano monitor unavailable */ }
  }

  private async loadSevereWeatherPolygons(): Promise<void> {
    const layer = this.layers.get('severeWeatherPolygons');
    if (!layer) return;
    try {
      const { fetchActiveWarnings, warningColor } = await import('@/services/severe-weather');
      const warnings = await fetchActiveWarnings();
      for (const w of warnings) {
        if (!w.polygon || w.polygon.length < 3) {
          if (w.centroid) {
            const hex = warningColor(w.warnType);
            const color = Color.fromCssColorString(hex);
            layer.source.entities.add({
              position: Cartesian3.fromDegrees(w.centroid.lon, w.centroid.lat),
              billboard: {
                image: ICON_FIRE,
                color,
                scale: 0.35,
                heightReference: HeightReference.CLAMP_TO_GROUND,
                scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.4),
                verticalOrigin: VerticalOrigin.CENTER,
                horizontalOrigin: HorizontalOrigin.CENTER,
              },
              description: `${w.event}: ${w.headline}`,
            });
          }
          continue;
        }
        const hex = warningColor(w.warnType);
        const fillColor = Color.fromCssColorString(hex).withAlpha(0.3);
        const outlineColor = Color.fromCssColorString(hex);
        const flat = w.polygon.flatMap(([lng, lat]: [number, number]) => [lng, lat]);
        layer.source.entities.add({
          name: `severe-${w.id}`,
          polygon: {
            hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(flat)),
            material: new ColorMaterialProperty(fillColor),
            outline: true,
            outlineColor,
            outlineWidth: 2,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
          description: `${w.event}: ${w.headline}`,
        });
      }
    } catch { /* severe weather polygons unavailable */ }
  }

  private async loadShakemapOverlay(): Promise<void> {
    const layer = this.layers.get('shakemapOverlay');
    if (!layer) return;
    try {
      const { fetchShakemapEvents, mmiHexColor } = await import('@/services/shakealert');
      const status = await fetchShakemapEvents();
      for (const ev of status.events) {
        const hex = mmiHexColor(ev.maxMmi ?? 0);
        const color = Color.fromCssColorString(hex);
        const scale = Math.max(0.4, Math.min(1.2, (ev.magnitude - 4) * 0.25 + 0.4));
        layer.source.entities.add({
          position: Cartesian3.fromDegrees(ev.lon, ev.lat),
          billboard: {
            image: ICON_EARTHQUAKE,
            color,
            scale,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            scaleByDistance: new NearFarScalar(1e4, 1.5, 1e7, 0.4),
            verticalOrigin: VerticalOrigin.CENTER,
            horizontalOrigin: HorizontalOrigin.CENTER,
          },
          label: {
            text: `M${ev.magnitude.toFixed(1)}${ev.hasShakemap ? ' ✓' : ''}`,
            font: '10px monospace',
            fillColor: color,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            style: 2,
            pixelOffset: LABEL_OFFSET,
            horizontalOrigin: HorizontalOrigin.CENTER,
            verticalOrigin: VerticalOrigin.BOTTOM,
            scaleByDistance: new NearFarScalar(1e5, 1, 1.5e7, 0.4),
            distanceDisplayCondition: new DistanceDisplayCondition(0, 8e6),
          },
          description: `M${ev.magnitude.toFixed(1)} — ${ev.place}\nMMI: ${ev.mmiLabel}\nShakeMap: ${ev.hasShakemap ? 'available' : 'not available'}`,
        });
      }
    } catch { /* shakemap overlay unavailable */ }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PUBLIC API
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
 * Filter time-bucketed layers to entities whose timestamp is <= currentTimeMs.
 * Pass null to clear the filter (live mode).
 */
  private entityInWindow(
 e: import('cesium').Entity,
 julian: import('cesium').JulianDate,
 floor: number,
 cutoff: number,
  ): boolean {
 try {
 const bag = e.properties?.getValue(julian) as { timestamp?: Date | string | number } | undefined;
 const ts = bag?.timestamp;
 if (!ts) return true;
 const t = ts instanceof Date ? ts.getTime() : Number(ts);
 return !Number.isNaN(t) && t <= cutoff && t >= floor;
 } catch {
 return true;
 }
  }

  private filterLayerByTime(
 entities: import('cesium').Entity[],
 cutoff: number,
 floor: number,
  ): void {
 const julian = JulianDate.fromDate(new Date(cutoff));
 for (const e of entities) {
 if (e) e.show = this.entityInWindow(e, julian, floor, cutoff);
 }
  }

  applyTimeFilter(currentTimeMs: number | null): void {
 const timeLayers = ['earthquakes', 'fires', 'conflicts', 'airstrikes'];
 for (const name of timeLayers) {
 const layer = this.layers.get(name);
 if (!layer) continue;
 // Snapshot — concurrent data refreshes mutate entities.values mid-iteration.
 const entities = [...layer.source.entities.values];
 if (currentTimeMs == null) {
 for (const e of entities) { if (e) e.show = true; }
 } else {
 this.filterLayerByTime(entities, currentTimeMs, currentTimeMs - 24 * 60 * 60 * 1000);
 }
 }
  }

  setLayerVisible(name: string, visible: boolean): void {
 const layer = this.layers.get(name);
 if (!layer) return;
 layer.source.show = visible;
 // The power-infrastructure layer defers BOTH its visibility and its fetch
 // (rate-limited Overpass, enable-gated), unlike sibling layers whose
 // entities already exist when toggled. So enabling it must mirror the flag
 // and kick a load — otherwise the toggle looks dead until the camera moves.
 if (name === 'powerInfrastructure') {
 this.powerLayerEnabled = visible;
 if (visible) void this.loadLayer(name);
 }
  }

  getAftershockForecast(earthquakeId: string): AftershockForecast | null {
 return this.aftershockForecasts.get(earthquakeId) ?? null;
  }

  getCycloneCone(cycloneId: string): ForecastCone | null {
 return this.cycloneCones.get(cycloneId) ?? null;
  }

  getEntityCount(): number {
 let count = 0;
 for (const [, layer] of this.layers) {
 if (layer.source.show) count += layer.source.entities.values.length;
 }
 return count;
  }

  getLayerCounts(): Map<string, number> {
 const counts = new Map<string, number>();
 for (const [name, layer] of this.layers) {
 counts.set(name, layer.source.entities.values.length);
 }
 return counts;
  }

  getTopAlerts(limit = 5): { name: string; type: string; severity: number; lat?: number; lon?: number }[] {
 const results: { name: string; type: string; severity: number; lat?: number; lon?: number }[] = [];
 const SEVERITY: Record<string, number> = {
 airstrikes: 10, conflicts: 8, cyber: 6, earthquakes: 5,
 gdacs: 7, cyclones: 6, fires: 4, gpsJamming: 5,
 };
 for (const [layerKey, layerData] of this.layers) {
 const sev = SEVERITY[layerKey] ?? 3;
 const entities = [...layerData.source.entities.values];
 for (const entity of entities) {
 if (!entity.name) continue;
 let lat: number | undefined;
 let lon: number | undefined;
 const pos = entity.position?.getValue(this.viewer.clock.currentTime);
 if (pos) {
 const carto = Ellipsoid.WGS84.cartesianToCartographic(pos);
 if (carto) {
 lat = CesiumMath.toDegrees(carto.latitude);
 lon = CesiumMath.toDegrees(carto.longitude);
 }
 }
 results.push({ name: entity.name, type: layerKey, severity: sev, lat, lon });
 }
 }
 results.sort((a, b) => b.severity - a.severity);
 return results.slice(0, limit);
  }

  getCategoryCounts(): { conflicts: number; disasters: number } {
 return {
 conflicts: (this.layers.get('conflicts')?.source.show ? this.layers.get('conflicts')!.source.entities.values.length : 0) + (this.layers.get('airstrikes')?.source.show ? this.layers.get('airstrikes')!.source.entities.values.length : 0),
 disasters: (this.layers.get('gdacs')?.source.show ? this.layers.get('gdacs')!.source.entities.values.length : 0) + (this.layers.get('cyclones')?.source.show ? this.layers.get('cyclones')!.source.entities.values.length : 0) + (this.layers.get('earthquakes')?.source.show ? this.layers.get('earthquakes')!.source.entities.values.length : 0) + (this.layers.get('fires')?.source.show ? this.layers.get('fires')!.source.entities.values.length : 0),
 };
  }

  getNearestHotspot(lat: number, lon: number): { name: string; distanceKm: number } | null {
 const layer = this.layers.get('hotspots');
 if (!layer?.source.show) return null;
 const R = 6371;
 const rad = Math.PI / 180;
 const lat1 = lat * rad;
 let best: { name: string; distanceKm: number } | null = null;
 for (const entity of layer.source.entities.values) {
 const pos = entity.position?.getValue(this.viewer.clock.currentTime);
 if (!pos) continue;
 const carto = Cartographic.fromCartesian(pos);
 const lat2 = carto.latitude;
 const dLat = lat2 - lat1;
 const dLon = carto.longitude - lon * rad;
 const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
 const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
 if (!best || d < best.distanceKm) {
 best = { name: entity.name ?? 'Unknown hotspot', distanceKm: d };
 }
 }
 return best;
  }

  /** Expose data sources for AutoFollowEngine to read entity positions. */
  getDataSources(): Map<string, CustomDataSource> {
 const result = new Map<string, CustomDataSource>();
 for (const [name, layer] of this.layers) {
 result.set(name, layer.source);
 }
 return result;
  }

  private async initSatellites(): Promise<void> {
 try {
 this.satelliteCatalog = await fetchSatelliteCatalog();
 if (this.satelliteCatalog.length === 0) return;

 this.satellitePoints = new PointPrimitiveCollection();
 this.viewer.scene.primitives.add(this.satellitePoints);

 this.orbitLines = new PolylineCollection();
 this.viewer.scene.primitives.add(this.orbitLines);

 satellitePropagator.start(this.satelliteCatalog);

 this.unsubPositions = satellitePropagator.onPositions((positions) => {
 this.updateSatellitePositions(positions);
 });
 } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[GlobeDataManager] Satellite init failed:', error);
 }
  }

  private updateSatellitePositions(positions: SatellitePosition[]): void {
 if (!this.satellitePoints) return;
 this.satellitePoints.removeAll();

 const notableIds = new Set(filterNotable(this.satelliteCatalog).map(s => s.noradId));

 for (const pos of positions) {
 const isNotable = notableIds.has(pos.noradId);
 const cat = this.satelliteCatalog.find(s => s.noradId === pos.noradId);
 const rgb = cat?.annotation?.color ?? [150, 150, 150];

 this.satellitePoints.add({
 position: Cartesian3.fromDegrees(pos.lon, pos.lat, pos.altKm * 1000),
 pixelSize: isNotable ? 4 : 1.5,
 color: Color.fromBytes(rgb[0], rgb[1], rgb[2], isNotable ? 255 : 80),
 });
 }
  }

  destroy(): void {
 if (this.cursorListener) {
 document.removeEventListener('wm:globe-timeline-cursor', this.cursorListener);
 this.cursorListener = null;
 }
 this.heatmapRenderer?.destroy();
 this.heatmapRenderer = null;
 this.cameraMoveSub?.();
 this.cameraMoveSub = null;
 if (this.powerFetchTimer) {
 clearTimeout(this.powerFetchTimer);
 this.powerFetchTimer = null;
 }
 for (const [, layer] of this.layers) {
 this.viewer.dataSources.remove(layer.source, true);
 }
 this.buildingManager?.destroy();
 this.buildingManager = null;
 this.unsubPositions?.();
 this.unsubPositions = null;
 if (this.maritimeVesselsTimer !== null) {
 clearInterval(this.maritimeVesselsTimer);
 this.maritimeVesselsTimer = null;
 }
 satellitePropagator.stop();
 if (this.satellitePoints) {
 this.viewer.scene.primitives.remove(this.satellitePoints);
 this.satellitePoints = null;
 }
 if (this.orbitLines) {
 this.viewer.scene.primitives.remove(this.orbitLines);
 this.orbitLines = null;
 }
 this.layers.clear();
 for (const imgLayer of this.weatherImageryLayers) {
 this.viewer.imageryLayers.remove(imgLayer, true);
 }
 this.weatherImageryLayers = [];
  }

  getBuildingTier(): string {
 return this.buildingManager?.providerName ?? 'Not loaded';
  }

  /**
   * Returns position+timestamp pairs for visible entities in the named layer.
   * Used by GlobeTrails to build comet tails.
   */
  getEntityPositionHistory(layerName: string): EntityPositionSample[] {
 const layer = this.layers.get(layerName);
 if (!layer?.source.show) return [];
 const results: EntityPositionSample[] = [];
 const now = JulianDate.fromDate(new Date());
 for (const entity of layer.source.entities.values) {
 if (!entity.show) continue;
 const pos = entity.position?.getValue(now);
 if (!pos) continue;
 const carto = Cartographic.fromCartesian(pos);
 let timeMs = Date.now();
 try {
 const bag = entity.properties?.getValue(now) as TimestampedProperties | undefined;
 const ts = bag?.timestamp;
 if (ts) timeMs = ts instanceof Date ? ts.getTime() : Number(ts);
 } catch { /* no timestamp — fall back to now */ }
 results.push({
 id: String(entity.id),
 lat: CesiumMath.toDegrees(carto.latitude),
 lon: CesiumMath.toDegrees(carto.longitude),
 timeMs,
 });
 }
 return results;
  }

  /**
   * Returns entities with severity metadata for pillar and degradation rendering.
   */
  getLayerEntitiesWithTimestamps(layerName: string): EntityTimestampedSample[] {
 const layer = this.layers.get(layerName);
 if (!layer?.source.show) return [];
 const baseSeverity = LAYER_BASE_SEVERITY[layerName] ?? 1;
 const now = JulianDate.fromDate(new Date());
 const results: EntityTimestampedSample[] = [];
 for (const entity of layer.source.entities.values) {
 if (!entity.show) continue;
 const pos = entity.position?.getValue(now);
 if (!pos) continue;
 const carto = Cartographic.fromCartesian(pos);
 let timeMs = Date.now();
 try {
 const bag = entity.properties?.getValue(now) as TimestampedProperties | undefined;
 const ts = bag?.timestamp;
 if (ts) timeMs = ts instanceof Date ? ts.getTime() : Number(ts);
 } catch { /* no timestamp */ }
 const desc = entity.description?.getValue(now) as unknown;
 results.push({
 id: String(entity.id),
 lat: CesiumMath.toDegrees(carto.latitude),
 lon: CesiumMath.toDegrees(carto.longitude),
 timeMs,
 severity: baseSeverity,
 description: typeof desc === 'string' ? desc : (entity.name ?? layerName),
 });
 }
 return results;
  }

  /**
   * Returns event blocks grouped by swimlane category for timeline rendering.
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity -- nested by design: category × layer × entity. Restructuring into helpers split the timestamp/severity/coord assembly across functions and made the data flow harder to follow than the linear loop.
  getEventBlocks(): EventBlock[] {
 const nowMs = Date.now();
 const blocks: EventBlock[] = [];
 const now = JulianDate.fromDate(new Date());
 for (const [category, layerNames] of Object.entries(SWIMLANE_CATEGORY_MAP) as [EventBlock['category'], string[]][]) {
 for (const layerName of layerNames) {
 const layer = this.layers.get(layerName);
 if (!layer) continue;
 for (const entity of layer.source.entities.values) {
 const pos = entity.position?.getValue(now);
 if (!pos) continue;
 const carto = Cartographic.fromCartesian(pos);
 let timeMs = nowMs;
 try {
 const bag = entity.properties?.getValue(now) as TimestampedProperties | undefined;
 const ts = bag?.timestamp;
 if (ts) timeMs = ts instanceof Date ? ts.getTime() : Number(ts);
 } catch { /* use now */ }
 const desc = entity.description?.getValue(now) as unknown;
 blocks.push({
 id: String(entity.id),
 layerName,
 category,
 startMs: timeMs,
 endMs: timeMs + 3_600_000,
 severity: LAYER_BASE_SEVERITY[layerName] ?? 1,
 name: typeof desc === 'string' ? desc : (entity.name ?? layerName),
 lat: CesiumMath.toDegrees(carto.latitude),
 lon: CesiumMath.toDegrees(carto.longitude),
 isForecast: timeMs > nowMs,
 });
 }
 }
 }
 return blocks;
  }

}
