/**
 * DeckGLMap - WebGL-accelerated map visualization for desktop
 * Uses deck.gl for high-performance rendering of large datasets
 * Mobile devices gracefully degrade to the D3/SVG-based Map component
 */
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer, LayersList, PickingInfo } from '@deck.gl/core';
import { GeoJsonLayer, ScatterplotLayer, PathLayer, IconLayer, TextLayer, PolygonLayer } from '@deck.gl/layers';
import { getSmokeSnapshots, subscribeSmoke } from '@/services/smoke/smoke-state';
import { categorizeUsAqi } from '@/services/smoke/aqi-category';
import type { AqiCategory } from '@/services/smoke/smoke-types';

/** EPA category colors as deck.gl RGBA — mirrors AirSmokePanel's palette. */
const AQI_MAP_COLOR: Record<AqiCategory, [number, number, number, number]> = {
  good: [63, 185, 80, 200],
  moderate: [212, 167, 44, 200],
  usg: [240, 136, 62, 210],
  unhealthy: [255, 69, 58, 220],
  very_unhealthy: [143, 63, 151, 220],
  hazardous: [126, 0, 35, 230],
  unknown: [139, 148, 158, 150],
};
import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import type {
  MapLayers,
  Hotspot,
  NewsItem,
  InternetOutage,
  RelatedAsset,
  AssetType,
  AisDisruptionEvent,
  AisDensityZone,
  CableAdvisory,
  RepairShip,
  SocialUnrestEvent,
  AIDataCenter,
  MilitaryFlight,
  MilitaryVessel,
  MilitaryFlightCluster,
  MilitaryVesselCluster,
  NaturalEvent,
  UcdpGeoEvent,
  MapProtestCluster,
  MapTechHQCluster,
  MapTechEventCluster,
  MapDatacenterCluster,
  CyberThreat,
  CableHealthRecord,
  MilitaryBaseEnriched,
  StrikePackage,
} from '@/types';
import { fetchMilitaryBases, type MilitaryBaseCluster as ServerBaseCluster } from '@/services/military-bases';
import { forecastOverlay, riskToColor, formatRegionLabel, type ForecastRegion } from '@/services/forecast-overlay';
import type { AirportDelayAlert } from '@/services/aviation';
import type { ScoredFAACamera } from '@/services/faa-cameras';
import type { DiseaseIntelData, CovidCountry, EpidemicEvent, WhoDonAlert } from '@/services/disease-intel';
import type { IranEvent } from '@/services/conflict';
import type { GpsJamHex } from '@/services/gps-interference';
import type { DisplacementFlow } from '@/services/displacement';
import type { Earthquake } from '@/services/earthquakes';
import type { ClimateAnomaly } from '@/services/climate';
import { ArcLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import { PathStyleExtension } from '@deck.gl/extensions';
import { SimpleMeshLayer } from '@deck.gl/mesh-layers';
import { modelLoader } from '@/services/model-loader';
import type { WeatherAlert } from '@/services/weather';
import { escapeHtml } from '@/utils/sanitize';
import { tokenizeForMatch, matchKeyword, matchesAnyKeyword, findMatchingKeywords } from '@/utils/keyword-match';
import { t } from '@/services/i18n';
import { debounce, rafSchedule, getCurrentTheme } from '@/utils/index';
import {
  INTEL_HOTSPOTS,
  CONFLICT_ZONES,
  MILITARY_BASES,
  UNDERSEA_CABLES,
  NUCLEAR_FACILITIES,
  GAMMA_IRRADIATORS,
  PIPELINES,
  PIPELINE_COLORS,
  STRATEGIC_WATERWAYS,
  ECONOMIC_CENTERS,
  AI_DATA_CENTERS,
  SITE_VARIANT,
  STARTUP_HUBS,
  ACCELERATORS,
  TECH_HQS,
  CLOUD_REGIONS,
  PORTS,
  SPACEPORTS,
  CRITICAL_MINERALS,
  STOCK_EXCHANGES,
  FINANCIAL_CENTERS,
  CENTRAL_BANKS,
  COMMODITY_HUBS,
  GULF_INVESTMENTS,
} from '@/config';
import type { GulfInvestment } from '@/types';
import { resolveTradeRouteSegments, TRADE_ROUTES as TRADE_ROUTES_LIST, type TradeRouteSegment } from '@/config/trade-routes';
import { MapPopup, type PopupType } from './MapPopup';
import {
  updateHotspotEscalation,
  getHotspotEscalation,
  setMilitaryData,
  setCIIGetter,
  setGeoAlertGetter,
} from '@/services/hotspot-escalation';
import { getCountryScore } from '@/services/country-instability';
import { getAlertsNearLocation, detectGeoConvergence, type GeoConvergenceAlert } from '@/services/geo-convergence';
import { getTheaterPolygons, getTheaterBorderColor, subscribeTheaterPolygons, type TheaterPolygon } from '@/services/theater-polygons';
import type { PositiveGeoEvent } from '@/services/positive-events-geo';
import type { KindnessPoint } from '@/services/kindness-data';
import type { HappinessData } from '@/services/happiness-data';
import type { RenewableInstallation } from '@/services/renewable-installations';
import type { SpeciesRecovery } from '@/services/conservation-data';
import type { GeoHubActivity } from '@/services/geo-activity';
import { getCountriesGeoJson, getCountryAtCoordinates, getCountryBbox } from '@/services/country-geometry';
import type { FeatureCollection, Geometry } from 'geojson';
import {
  initArrivalChoreography,
  setCurrentCenter,
  setCoronaTargets,
  triggerWavefront,
  triggerGlobalFlare,
  type ThreatType,
} from '@/services/arrival-choreography';
import { isLowPowerMode } from '@/services/low-power';
import type { AirstrikeEvent } from '@/services/airstrikes';
import type { S2UndergroundEvent } from '@/services/s2-underground';
import type { TechHubActivity } from '@/services/tech-activity';
import { getSigintPoints, getSigintClusters, type SigintEvent, type SigintConvergenceCluster } from '@/services/sigint-convergence';
import { getRadarTileUrl, type RadarState } from '@/services/rainviewer-radar';
import { getSmokeForecastTileUrl, smokeForecastHoursFromNow, type SmokeForecastState } from '@/services/firework-smoke';
import { strikeColor, strikeOpacity, type LightningStrike } from '@/services/lightning';
import { getGoesWmsTileUrl, gibsHourTimestamp } from '@/services/satellite-weather';
import { getOwmTileUrl, type OwmTileLayer } from '@/services/owm-weather-tiles';
import type { RedFlagWarning } from '@/services/red-flag-warnings';
import type { SatellitePosition, OrbitPath } from '@/services/satellite-propagator';
import type { SatelliteTLE } from '@/services/satellite-catalog';
import { filterNotable } from '@/services/satellite-catalog';

export type TimeRange = '1h' | '6h' | '24h' | '48h' | '7d' | 'all';
export type DeckMapView = 'global' | 'america' | 'mena' | 'eu' | 'asia' | 'latam' | 'africa' | 'oceania';
type MapInteractionMode = 'flat' | '3d';

export interface CountryClickPayload {
  lat: number;
  lon: number;
  code?: string;
  name?: string;
}

interface DeckMapState {
  zoom: number;
  pan: { x: number; y: number };
  view: DeckMapView;
  layers: MapLayers;
  timeRange: TimeRange;
}

interface HotspotWithBreaking extends Hotspot {
  hasBreaking?: boolean;
}

interface TechEventMarker {
  id: string;
  title: string;
  location: string;
  lat: number;
  lng: number;
  country: string;
  startDate: string;
  endDate: string;
  url: string | null;
  daysUntil: number;
}

// View presets with longitude, latitude, zoom
const VIEW_PRESETS: Record<DeckMapView, { longitude: number; latitude: number; zoom: number }> = {
  global: { longitude: 0, latitude: 20, zoom: 1.5 },
  america: { longitude: -95, latitude: 38, zoom: 3 },
  mena: { longitude: 45, latitude: 28, zoom: 3.5 },
  eu: { longitude: 15, latitude: 50, zoom: 3.5 },
  asia: { longitude: 105, latitude: 35, zoom: 3 },
  latam: { longitude: -60, latitude: -15, zoom: 3 },
  africa: { longitude: 20, latitude: 5, zoom: 3 },
  oceania: { longitude: 135, latitude: -25, zoom: 3.5 },
};

const MAP_INTERACTION_MODE: MapInteractionMode =
  import.meta.env.VITE_MAP_INTERACTION_MODE === 'flat' ? 'flat' : '3d';

// Theme-aware basemap style URLs. Self-hosted JSON references CARTO raster
// tiles — more reliable in web builds than fetching the CARTO vector gl style
// cross-origin (which occasionally misbehaves under strict CSP / CORS, and
// doesn't get picked up by the service worker's carto-tiles runtime cache).
const DARK_STYLE = SITE_VARIANT === 'happy'
  ? '/map-styles/happy-dark.json'
  : '/map-styles/dark.json';
const LIGHT_STYLE = SITE_VARIANT === 'happy'
  ? '/map-styles/happy-light.json'
  : '/map-styles/light.json';

// Raster basemap styles — Esri services, free to use, no API key required
const SATELLITE_STYLE = '/map-styles/satellite.json';
const TERRAIN_STYLE = '/map-styles/terrain.json';

type BaseMapStyle = 'dark' | 'light' | 'satellite' | 'terrain';
const BASEMAP_STORAGE_KEY = 'wm-basemap';

// Clade family → RGBA color for variant dot layer
const CLADE_COLORS: Record<string, [number, number, number, number]> = {
  JN: [100, 180, 255, 180], // JN.1 lineage — blue
  KP: [255, 120, 60, 180], // KP.2 / KP lineage — orange
  XBB: [160, 100, 255, 180],  // XBB lineage — purple
  EG: [100, 220, 160, 180], // EG.5 lineage — green
};

// Match an outbreak country name to a lat/lon from the disease.sh country list.
// Pass 1: exact case-insensitive match. Pass 2: either name starts with the other
// (handles "Democratic Republic of the Congo" ↔ "Congo (Kinshasa)" etc.).
function resolveCountryCoords(
  name: string,
  countries: CovidCountry[]
): [number, number] | null {
  const needle = name.toLowerCase().trim();
  // Pass 1 — exact
  let match = countries.find(c => c.country.toLowerCase() === needle);
  // Pass 2 — prefix fold: either string is a prefix of the other
  match ??= countries.find(c => {
 const hay = c.country.toLowerCase();
 return hay.startsWith(needle.slice(0, 5)) || needle.startsWith(hay.slice(0, 5));
  });
  if (!match || match.lat === 0 && match.lon === 0) return null;
  return [match.lat, match.lon];
}

function getDominantCladeColorForIso2(data: DiseaseIntelData, iso2: string): [number, number, number, number] {
  const country = data.covidCountries.find(c => c.iso2 === iso2);
  if (!country) return [180, 180, 180, 120];
  const loc = data.variants.find(v =>
 v.location.toLowerCase().includes(country.country.toLowerCase().slice(0, 6))
  );
  if (!loc || loc.clades.length === 0) return [180, 180, 180, 120];
  const dominant = [...loc.clades].sort((a, b) => b.freq.value - a.freq.value)[0];
  if (!dominant) return [180, 180, 180, 120];
  for (const [prefix, color] of Object.entries(CLADE_COLORS)) {
 if (dominant.clade.startsWith(prefix)) return color;
  }
  return [180, 180, 180, 120];
}

function getStyleUrl(basemap: BaseMapStyle): string {
  switch (basemap) {
 case 'satellite': { return SATELLITE_STYLE;
 }
 case 'terrain': { return TERRAIN_STYLE;
 }
 case 'light': { return LIGHT_STYLE;
 }
 default: { return DARK_STYLE;
 }
  }
}

// Zoom thresholds for layer visibility and labels (matches old Map.ts)
// Zoom-dependent layer visibility and labels
const LAYER_ZOOM_THRESHOLDS: Partial<Record<keyof MapLayers, { minZoom: number; showLabels?: number }>> = {
  bases: { minZoom: 3, showLabels: 5 },
  nuclear: { minZoom: 3 },
  conflicts: { minZoom: 1, showLabels: 3 },
  economic: { minZoom: 3 },
  natural: { minZoom: 1, showLabels: 2 },
  datacenters: { minZoom: 5 },
  irradiators: { minZoom: 4 },
  spaceports: { minZoom: 3 },
  gulfInvestments: { minZoom: 2, showLabels: 5 },
};
// Export for external use
export { LAYER_ZOOM_THRESHOLDS };

// Theme-aware overlay color function — refreshed each buildLayers() call
function getOverlayColors() {
  const isLight = getCurrentTheme() === 'light';
  return {
 // Threat dots: IDENTICAL in both modes (user locked decision)
 hotspotHigh: [255, 68, 68, 200] as [number, number, number, number],
 hotspotElevated: [255, 165, 0, 200] as [number, number, number, number],
 hotspotLow: [255, 255, 0, 180] as [number, number, number, number],

 // Conflict zone fills: more transparent in light mode
 conflict: isLight
 ? [255, 0, 0, 60] as [number, number, number, number]
 : [255, 0, 0, 100] as [number, number, number, number],

 // Infrastructure/category markers: darker variants in light mode for map readability
 base: [0, 150, 255, 200] as [number, number, number, number],
 nuclear: isLight
 ? [180, 120, 0, 220] as [number, number, number, number]
 : [255, 215, 0, 200] as [number, number, number, number],
 datacenter: isLight
 ? [13, 148, 136, 200] as [number, number, number, number]
 : [0, 255, 200, 180] as [number, number, number, number],
 cable: [0, 200, 255, 150] as [number, number, number, number],
 cableHighlight: [255, 100, 100, 200] as [number, number, number, number],
 cableFault: [255, 50, 50, 220] as [number, number, number, number],
 cableDegraded: [255, 165, 0, 200] as [number, number, number, number],
 earthquake: [255, 100, 50, 200] as [number, number, number, number],
 vesselMilitary: [255, 100, 100, 220] as [number, number, number, number],
 protest: [255, 150, 0, 200] as [number, number, number, number],
 outage: [255, 50, 50, 180] as [number, number, number, number],
 weather: [100, 150, 255, 180] as [number, number, number, number],
 startupHub: isLight
 ? [22, 163, 74, 220] as [number, number, number, number]
 : [0, 255, 150, 200] as [number, number, number, number],
 techHQ: [100, 200, 255, 200] as [number, number, number, number],
 accelerator: isLight
 ? [180, 120, 0, 220] as [number, number, number, number]
 : [255, 200, 0, 200] as [number, number, number, number],
 cloudRegion: [150, 100, 255, 180] as [number, number, number, number],
 stockExchange: isLight
 ? [20, 120, 200, 220] as [number, number, number, number]
 : [80, 200, 255, 210] as [number, number, number, number],
 financialCenter: isLight
 ? [0, 150, 110, 215] as [number, number, number, number]
 : [0, 220, 150, 200] as [number, number, number, number],
 centralBank: isLight
 ? [180, 120, 0, 220] as [number, number, number, number]
 : [255, 210, 80, 210] as [number, number, number, number],
 commodityHub: isLight
 ? [190, 95, 40, 220] as [number, number, number, number]
 : [255, 150, 80, 200] as [number, number, number, number],
 gulfInvestmentSA: [0, 168, 107, 220] as [number, number, number, number],
 gulfInvestmentUAE: [255, 0, 100, 220] as [number, number, number, number],
 ucdpStateBased: [255, 50, 50, 200] as [number, number, number, number],
 ucdpNonState: [255, 165, 0, 200] as [number, number, number, number],
 ucdpOneSided: [255, 255, 0, 200] as [number, number, number, number],
  };
}
// Cache theme colors — only recompute when theme actually changes
let _cachedTheme: string | null = null;
let COLORS = getOverlayColors();

/** Severity → color triplet for weather alerts. Three variants:
 *  - 'icon'   : opaque punchy color for the centroid pin
 *  - 'stroke' : same hue as icon, full alpha for polygon outline
 *  - 'fill'   : same hue at low alpha so polygon fill doesn't
 *               obscure underlying basemap labels.
 *  Used by both the icon layer and the polygon layer so the visual
 *  treatment stays consistent across the two rendering paths. */
function weatherSeverityColor(
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown',
  variant: 'icon' | 'stroke' | 'fill',
): [number, number, number, number] {
  // Base RGB by severity tier
  let rgb: [number, number, number];
  if (severity === 'Extreme') rgb = [255, 0, 0];
  else if (severity === 'Severe') rgb = [255, 100, 0];
  else if (severity === 'Moderate') rgb = [255, 170, 0];
  else rgb = [100, 150, 255];

  let alpha: number;
  if (variant === 'fill') alpha = 60;          // ~24%
  else if (variant === 'stroke') alpha = 220;  // ~86%
  else alpha = severity === 'Extreme' ? 200 : severity === 'Severe' ? 180 : severity === 'Moderate' ? 160 : 180;

  return [rgb[0], rgb[1], rgb[2], alpha];
}

// SVG icons as data URLs for different marker shapes
// ── Canvas-drawn icon atlas (SVG data URIs fail in WKWebView WebGL) ──
// All icons are drawn onto a single 32-tall sprite sheet using Canvas 2D API.
// Each icon occupies a 32x32 cell. `mask: true` lets DeckGL tint via getColor.
const ICON_SIZE = 32;

type IconDrawFn = (ctx: CanvasRenderingContext2D) => void;

const ICON_DRAW_FNS: Record<string, IconDrawFn> = {
  triangleUp: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 2); ctx.lineTo(30, 28); ctx.lineTo(2, 28); ctx.closePath(); ctx.fill(); },
  hexagon: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 2); ctx.lineTo(28, 9); ctx.lineTo(28, 23); ctx.lineTo(16, 30); ctx.lineTo(4, 23); ctx.lineTo(4, 9); ctx.closePath(); ctx.fill(); },
  square: (ctx) => { ctx.beginPath(); ctx.roundRect(2, 2, 28, 28, 3); ctx.fill(); },
  circle: (ctx) => { ctx.beginPath(); ctx.arc(16, 16, 14, 0, Math.PI * 2); ctx.fill(); },
  diamond: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 2); ctx.lineTo(30, 16); ctx.lineTo(16, 30); ctx.lineTo(2, 16); ctx.closePath(); ctx.fill(); },
  star: (ctx) => { ctx.beginPath(); const pts = [[16,2],[20,12],[30,12],[22,19],[25,30],[16,23],[7,30],[10,19],[2,12],[12,12]]; ctx.moveTo(pts[0]![0]!, pts[0]![1]!); for (let i = 1; i < pts.length; i++) { ctx.lineTo(pts[i]![0]!, pts[i]![1]!); } ctx.closePath(); ctx.fill(); },
  airplane: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 1); ctx.lineTo(14, 10); ctx.lineTo(4, 18); ctx.lineTo(4, 20); ctx.lineTo(14, 17); ctx.lineTo(14, 25); ctx.lineTo(10, 28); ctx.lineTo(10, 30); ctx.lineTo(16, 28); ctx.lineTo(22, 30); ctx.lineTo(22, 28); ctx.lineTo(18, 25); ctx.lineTo(18, 17); ctx.lineTo(28, 20); ctx.lineTo(28, 18); ctx.lineTo(18, 10); ctx.closePath(); ctx.fill(); },
  fighter: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 1); ctx.lineTo(14, 8); ctx.lineTo(2, 16); ctx.lineTo(2, 18); ctx.lineTo(14, 15); ctx.lineTo(13, 22); ctx.lineTo(8, 26); ctx.lineTo(8, 28); ctx.lineTo(14, 25); ctx.lineTo(14, 29); ctx.lineTo(16, 31); ctx.lineTo(18, 29); ctx.lineTo(18, 25); ctx.lineTo(24, 28); ctx.lineTo(24, 26); ctx.lineTo(19, 22); ctx.lineTo(18, 15); ctx.lineTo(30, 18); ctx.lineTo(30, 16); ctx.lineTo(18, 8); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(12, 10); ctx.lineTo(10, 12); ctx.lineTo(14, 11); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(20, 10); ctx.lineTo(22, 12); ctx.lineTo(18, 11); ctx.closePath(); ctx.fill(); },
  ship: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 3); ctx.lineTo(20, 10); ctx.lineTo(21, 24); ctx.lineTo(19, 29); ctx.lineTo(13, 29); ctx.lineTo(11, 24); ctx.lineTo(12, 10); ctx.closePath(); ctx.fill(); },
  satellite: (ctx) => { ctx.beginPath(); ctx.roundRect(13, 8, 6, 16, 1); ctx.fill(); ctx.beginPath(); ctx.roundRect(2, 12, 10, 8, 1); ctx.fill(); ctx.beginPath(); ctx.roundRect(20, 12, 10, 8, 1); ctx.fill(); },
  earthquake: (ctx) => { ctx.beginPath(); ctx.moveTo(4, 16); ctx.lineTo(8, 8); ctx.lineTo(12, 22); ctx.lineTo(16, 6); ctx.lineTo(20, 26); ctx.lineTo(24, 10); ctx.lineTo(28, 16); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); },
  fire: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 2); ctx.bezierCurveTo(16, 2, 24, 12, 24, 20); ctx.bezierCurveTo(24, 24.4, 20.4, 28, 16, 28); ctx.bezierCurveTo(11.6, 28, 8, 24.4, 8, 20); ctx.bezierCurveTo(8, 12, 16, 2, 16, 2); ctx.fill(); },
  lightning: (ctx) => { ctx.beginPath(); ctx.moveTo(18, 2); ctx.lineTo(10, 18); ctx.lineTo(15, 18); ctx.lineTo(14, 30); ctx.lineTo(22, 14); ctx.lineTo(17, 14); ctx.closePath(); ctx.fill(); },
  rocket: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 2); ctx.bezierCurveTo(16, 2, 22, 8, 22, 18); ctx.lineTo(25, 22); ctx.lineTo(25, 25); ctx.lineTo(20, 22); ctx.lineTo(20, 26); ctx.lineTo(18, 28); ctx.lineTo(16, 26); ctx.lineTo(14, 28); ctx.lineTo(12, 26); ctx.lineTo(12, 22); ctx.lineTo(7, 25); ctx.lineTo(7, 22); ctx.lineTo(10, 18); ctx.bezierCurveTo(10, 8, 16, 2, 16, 2); ctx.fill(); ctx.beginPath(); ctx.arc(16, 15, 3, 0, Math.PI * 2); ctx.globalCompositeOperation = 'destination-out'; ctx.fill(); ctx.globalCompositeOperation = 'source-over'; },
  anchor: (ctx) => { ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(16, 8, 3, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(16, 11); ctx.lineTo(16, 27); ctx.stroke(); ctx.beginPath(); ctx.moveTo(11, 17); ctx.lineTo(21, 17); ctx.stroke(); ctx.beginPath(); ctx.moveTo(10, 22); ctx.quadraticCurveTo(10, 29, 16, 29); ctx.stroke(); ctx.beginPath(); ctx.moveTo(22, 22); ctx.quadraticCurveTo(22, 29, 16, 29); ctx.stroke(); },
  crosshair: (ctx) => { ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(16, 16, 8, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(16, 16, 3, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(16, 4); ctx.lineTo(16, 8); ctx.moveTo(16, 24); ctx.lineTo(16, 28); ctx.moveTo(4, 16); ctx.lineTo(8, 16); ctx.moveTo(24, 16); ctx.lineTo(28, 16); ctx.stroke(); },
  biohazard: (ctx) => { ctx.beginPath(); ctx.arc(16, 16, 3, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(16, 10, 8, Math.PI * 0.7, Math.PI * 1.1); ctx.stroke(); ctx.beginPath(); ctx.arc(22, 20, 8, Math.PI * 1.2, Math.PI * 1.7); ctx.stroke(); ctx.beginPath(); ctx.arc(10, 20, 8, -Math.PI * 0.2, Math.PI * 0.3); ctx.stroke(); },
  shield: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 3); ctx.lineTo(4, 8); ctx.lineTo(4, 16); ctx.quadraticCurveTo(4, 26, 16, 30); ctx.quadraticCurveTo(28, 26, 28, 16); ctx.lineTo(28, 8); ctx.closePath(); ctx.fill(); },
  cloud: (ctx) => { ctx.beginPath(); ctx.arc(12, 16, 6, 0, Math.PI * 2); ctx.arc(20, 15, 7, 0, Math.PI * 2); ctx.arc(8, 19, 4, 0, Math.PI * 2); ctx.arc(24, 18, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(6, 16, 20, 8); ctx.beginPath(); ctx.fillRect(15, 11, 2, 6); ctx.fill(); ctx.beginPath(); ctx.arc(16, 10, 1, 0, Math.PI * 2); ctx.fill(); },
  turbine: (ctx) => { ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(16, 13); ctx.lineTo(16, 28); ctx.moveTo(12, 28); ctx.lineTo(20, 28); ctx.stroke(); ctx.beginPath(); ctx.arc(16, 10, 3, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(16, 10); ctx.lineTo(16, 2); ctx.moveTo(16, 10); ctx.lineTo(23, 16); ctx.moveTo(16, 10); ctx.lineTo(9, 16); ctx.stroke(); },
  chart: (ctx) => { ctx.beginPath(); ctx.roundRect(5, 18, 4, 10, 1); ctx.fill(); ctx.beginPath(); ctx.roundRect(11, 12, 4, 16, 1); ctx.fill(); ctx.beginPath(); ctx.roundRect(17, 6, 4, 22, 1); ctx.fill(); ctx.beginPath(); ctx.roundRect(23, 14, 4, 14, 1); ctx.fill(); },
  bank: (ctx) => { ctx.beginPath(); ctx.moveTo(16, 3); ctx.lineTo(28, 10); ctx.lineTo(28, 12); ctx.lineTo(4, 12); ctx.lineTo(4, 10); ctx.closePath(); ctx.fill(); ctx.fillRect(6, 13, 3, 12); ctx.fillRect(11, 13, 3, 12); ctx.fillRect(18, 13, 3, 12); ctx.fillRect(23, 13, 3, 12); ctx.beginPath(); ctx.roundRect(4, 26, 24, 3, 1); ctx.fill(); },
};

 
let _iconAtlas: any = null;
let _iconMapping: Record<string, { x: number; y: number; width: number; height: number; anchorX: number; anchorY: number; mask: boolean }> | null = null;

// DeckGL accepts HTMLCanvasElement at runtime but types only allow string | Texture
 
function getIconAtlas(): any {
  if (_iconAtlas) return _iconAtlas;
  const names = Object.keys(ICON_DRAW_FNS);
  const canvas = document.createElement('canvas');
  canvas.width = names.length * ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'white';
  const mapping: typeof _iconMapping = {};
  for (const [i, name] of names.entries()) {
    ctx.save();
    ctx.translate(i * ICON_SIZE, 0);
    ICON_DRAW_FNS[name!]!(ctx);
    ctx.restore();
    // Anchor each icon at its center, not the DeckGL default of bottom-center.
    // Without explicit anchorY, every icon (planes, cyclones, fires, …) is
    // drawn with its bottom edge at the geo point — visually offset upward
    // by half the icon height. The displacement is in screen pixels, so it
    // looks larger at low zoom and becomes obvious once you pan in close
    // enough to compare planes against runways.
    mapping[name!] = {
      x: i * ICON_SIZE, y: 0,
      width: ICON_SIZE, height: ICON_SIZE,
      anchorX: ICON_SIZE / 2, anchorY: ICON_SIZE / 2,
      mask: true,
    };
  }
  _iconAtlas = canvas;
  _iconMapping = mapping;
  return canvas;
}

function getIconMapping(): Record<string, { x: number; y: number; width: number; height: number; anchorX: number; anchorY: number; mask: boolean }> {
  if (!_iconMapping) getIconAtlas();
  return _iconMapping!;
}

// Altitude-based color gradient matching Wingbits' color scheme.
// Transitions cyan (sea level) → yellow-green → orange → red (cruise altitude).
const ALTITUDE_COLOR_STOPS: Array<{ alt: number; r: number; g: number; b: number }> = [
  { alt: 0, r: 0, g: 217, b: 255 },
  { alt: 5000, r: 50,  g: 250, b: 160 },
  { alt: 10000,  r: 200, g: 230, b: 60  },
  { alt: 20000,  r: 255, g: 165, b: 30  },
  { alt: 30000,  r: 255, g: 100, b: 35  },
  { alt: 40000,  r: 235, g: 50,  b: 55  },
  { alt: 45000,  r: 210, g: 40,  b: 70  },
];

function altitudeToColor(altFt: number): [number, number, number] {
  const stops = ALTITUDE_COLOR_STOPS;
  const alt = Number.isFinite(altFt) ? altFt : 0;
  if (alt <= stops[0]!.alt) return [stops[0]!.r, stops[0]!.g, stops[0]!.b];
  const last = stops[stops.length - 1]!;
  if (alt >= last.alt) return [last.r, last.g, last.b];
  for (let i = 1; i < stops.length; i++) {
 const hi = stops[i]!;
 const lo = stops[i - 1]!;
 if (alt <= hi.alt) {
 const t = (alt - lo.alt) / (hi.alt - lo.alt);
 return [
 Math.round(lo.r + (hi.r - lo.r) * t),
 Math.round(lo.g + (hi.g - lo.g) * t),
 Math.round(lo.b + (hi.b - lo.b) * t),
 ];
 }
  }
  return [last.r, last.g, last.b]; // unreachable: exhaustive bracket search above satisfies TS
}


const CONFLICT_ZONES_GEOJSON: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: CONFLICT_ZONES.map(zone => ({
 type: 'Feature' as const,
 properties: { id: zone.id, name: zone.name, intensity: zone.intensity },
 geometry: { type: 'Polygon' as const, coordinates: [zone.coords] },
  })),
};

/** deck.gl TextLayer renders blurry bitmap-atlas glyphs unless SDF is enabled.
 *  These props give crisp, outlined text at any zoom / DPR. */
const CRISP_LABEL_TEXT = {
  fontSettings: { sdf: true, radius: 12, cutoff: 0.25 },
  outlineWidth: 2,
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
};

export class DeckGLMap {
  private static readonly MAX_CLUSTER_LEAVES = 200;

  private container: HTMLElement;
  private deckOverlay: MapboxOverlay | null = null;
  private maplibreMap: maplibregl.Map | null = null;
  private activeBaseMap: BaseMapStyle = 'dark';
  private state: DeckMapState;
  private popup: MapPopup;
  private isResizing = false;

  // Data stores
  private hotspots: HotspotWithBreaking[];
  private earthquakes: Earthquake[] = [];
  private weatherAlerts: WeatherAlert[] = [];
  private outages: InternetOutage[] = [];
  private cyberThreats: CyberThreat[] = [];
  private alertPulses: Array<{ id: string; lat: number; lon: number; severity: 'critical' | 'high' | 'medium' | 'low' | 'info' }> = [];
  private aptGroups: import('@/types').APTGroup[] = [];
  private aptGroupsLoaded = false;
  private iranEvents: IranEvent[] = [];
  private aisDisruptions: AisDisruptionEvent[] = [];
  private aisDensity: AisDensityZone[] = [];
  private adsbFlights: import('@/services/adsb').AdsbFlight[] = [];
  private cableAdvisories: CableAdvisory[] = [];
  private repairShips: RepairShip[] = [];
  private healthByCableId: Record<string, CableHealthRecord> = {};
  private protests: SocialUnrestEvent[] = [];
  private militaryFlights: MilitaryFlight[] = [];
  private militaryFlightClusters: MilitaryFlightCluster[] = [];
  private strikePackages: StrikePackage[] = [];
  private expandedStrikePackageId: string | null = null;
  private militaryVessels: MilitaryVessel[] = [];
  private militaryVesselClusters: MilitaryVesselCluster[] = [];
  private serverBases: MilitaryBaseEnriched[] = [];
  private serverBaseClusters: ServerBaseCluster[] = [];
  private serverBasesLoaded = false;
  private naturalEvents: NaturalEvent[] = [];
  private firmsFireData: { lat: number; lon: number; brightness: number; frp: number; confidence: number; region: string; acq_date: string; daynight: string }[] = [];
  // Smoke & Air overlay (PR 4 of the smoke program): AQI sample dots come
  // synchronously from the smoke engine snapshot; perimeters + HMS plume load
  // lazily on first toggle (service-level caches handle refresh).
  private smokeOverlayPerimeters: import('@/services/wildfires/fire-intel-service').ActiveFirePerimeter[] = [];
  private smokeOverlayPlumes: import('@/services/wildfire-smoke').SmokePolygon[] = [];
  private smokeOverlayLoadedAt = 0;
  private smokeOverlayLoading = false;
  private smokeOverlayUnsub: (() => void) | null = null;
  // Forecast smoke field (grid-sampled AQI forecast) + its time scrubber.
  private smokeForecastField: import('@/services/smoke/forecast-field').SmokeForecastField | null = null;
  private smokeForecastCenter: string | null = null;
  private smokeForecastLoading = false;
  private smokeForecastFailedAt = 0;
  private smokeForecastHourIdx = 0;
  private smokeScrubberEl: HTMLElement | null = null;
  private smokeScrubberInput: HTMLInputElement | null = null;
  private smokeScrubberLabel: HTMLElement | null = null;
  private techEvents: TechEventMarker[] = [];
  private flightDelays: AirportDelayAlert[] = [];
  private faaCameras: ScoredFAACamera[] = [];
  private diseaseIntelData: DiseaseIntelData | null = null;
  private diseaseIntelCountryCaseMap = new Map<string, number>();
  private diseaseIntelGeoJson: import('geojson').FeatureCollection | null = null;
  private news: NewsItem[] = [];
  private newsLocations: { lat: number; lon: number; title: string; threatLevel: string; timestamp?: Date }[] = [];
  private newsLocationFirstSeen = new Map<string, number>();
  private ucdpEvents: UcdpGeoEvent[] = [];
  private airstrikesData: AirstrikeEvent[] = [];
  private s2pimuData: S2UndergroundEvent[] = [];
  private displacementFlows: DisplacementFlow[] = [];
  private gpsJammingHexes: GpsJamHex[] = [];
  private climateAnomalies: ClimateAnomaly[] = [];
  private tradeRouteSegments: TradeRouteSegment[] = resolveTradeRouteSegments();
  private positiveEvents: PositiveGeoEvent[] = [];
  private kindnessPoints: KindnessPoint[] = [];

  // Phase 8 overlay data
  private happinessScores = new Map<string, number>();
  private happinessYear = 0;
  private happinessSource = '';
  private speciesRecoveryZones: (SpeciesRecovery & { recoveryZone: { name: string; lat: number; lon: number } })[] = [];
  private renewableInstallations: RenewableInstallation[] = [];
  private countriesGeoJsonData: FeatureCollection<Geometry> | null = null;

  // Country highlight state
  private countryGeoJsonLoaded = false;
  private countryHoverSetup = false;
  private highlightedCountryCode: string | null = null;

  // Callbacks
  private onHotspotClick?: (hotspot: Hotspot) => void;
  private onTimeRangeChange?: (range: TimeRange) => void;
  private onCountryClick?: (country: CountryClickPayload) => void;
  private onLocationPick?: (lat: number, lon: number) => void;
  private onLayerChange?: (layer: keyof MapLayers, enabled: boolean, source: 'user' | 'programmatic') => void;
  private onStateChange?: (state: DeckMapState) => void;

  // Highlighted assets
  private highlightedAssets: Record<AssetType, Set<string>> = {
 pipeline: new Set(),
 cable: new Set(),
 datacenter: new Set(),
 base: new Set(),
 nuclear: new Set(),
  };

  private renderScheduled = false;
  private renderPaused = false;
  private _pausedByView = false;   // manual pause (country-detail overlay)
  private _pausedByHidden = false; // window hidden
  // Temporary idle-repaint instrumentation counters (see installMapFpsDebug).
  private _mapFpsRenderCount = 0;
  private _mapFpsAppRepaintCount = 0;
  private _mapFpsTimerId: number | null = null;
  private webglLost = false;
  private resizeObserver: ResizeObserver | null = null;

  private layerCache = new Map<string, Layer>();
  private lastZoomThreshold = 0;
  private protestSC: Supercluster | null = null;
  private techHQSC: Supercluster | null = null;
  private techEventSC: Supercluster | null = null;
  private datacenterSC: Supercluster | null = null;
  private datacenterSCSource: AIDataCenter[] = [];
  private protestClusters: MapProtestCluster[] = [];
  private techHQClusters: MapTechHQCluster[] = [];
  private techEventClusters: MapTechEventCluster[] = [];
  private datacenterClusters: MapDatacenterCluster[] = [];
  private lastSCZoom = -1;
  private lastSCBoundsKey = '';
  private lastSCMask = '';
  private protestSuperclusterSource: SocialUnrestEvent[] = [];
  private newsPulseIntervalId: ReturnType<typeof setInterval> | null = null;
  private dayNightIntervalId: ReturnType<typeof setInterval> | null = null;
  private cablePulseIntervalId: ReturnType<typeof setInterval> | null = null;
  /** Current cable pulse phase in radians (0 → 2π, cycles every CABLE_PULSE_PERIOD_MS). */
  private cablePulsePhase = 0;
  private cachedNightPolygon: [number, number][] | null = null;
  private readonly startupTime = Date.now();
  private theaterPolygons: TheaterPolygon[] = [];
  private theaterUnsubscribe: (() => void) | null = null;
  private convergenceSeenAlerts = new Set<string>();
  private radarState: RadarState | null = null;
  private fireworkState: SmokeForecastState | null = null;
  private fireworkAppliedUrl: string | null = null;
  // GIBS GOES GeoColor publishes each hourly frame with a ~15–40 min latency,
  // so the latest top-of-hour is often a 404. Start one hour back and step
  // further on tile errors (see recoverSatelliteTiles).
  private satelliteHourOffset = 1;
  // MapLibre emits one error per failed *tile*, so an unavailable hour fires a
  // burst. A self-rescheduling timer coalesces the burst into one hour-step
  // per rebuild and keeps stepping while the rebuilt hour also fails.
  private satelliteRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private satelliteErrorSinceRebuild = false;
  // The tile URL currently applied to the wm-satellite source, and the base
  // UTC hour it was computed for — used to rebuild on hour-rollover/recovery.
  private satelliteAppliedUrl: string | null = null;
  private satelliteBaseHour: string | null = null;
  private static readonly MAX_SATELLITE_HOUR_OFFSET = 6;
  private static readonly SATELLITE_RECOVERY_COOLDOWN_MS = 8000;
  private lightningStrikes: LightningStrike[] = [];
  private redFlagWarnings: RedFlagWarning[] = [];
  private satellitePositions: SatellitePosition[] = [];
  private satelliteCatalog: SatelliteTLE[] = [];
  private selectedOrbitPath: OrbitPath | null = null;
  private lastCableHighlightSignature = '';
  private lastCableHealthSignature = '';
  private lastPipelineHighlightSignature = '';
  private debouncedRebuildLayers: () => void;
  private debouncedFetchBases: () => void;
  private rafUpdateLayers: () => void;
  private rafUpdateLayersPending = false;
  private moveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private _themeChangedHandler: ((e: Event) => void) | null = null;
  private _visibilityHandler: (() => void) | null = null;
  private mapEventHandlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

  constructor(container: HTMLElement, initialState: DeckMapState) {
 this.container = container;
 this.state = initialState;
 this.hotspots = [...INTEL_HOTSPOTS];

 this.debouncedRebuildLayers = debounce(() => {
 if (this.renderPaused || this.webglLost || !this.maplibreMap) return;
 this.maplibreMap.resize();
 try { this.deckOverlay?.setProps({ layers: this.buildLayers() }); } catch { /* map mid-teardown */ }
 }, 150);
 this.debouncedFetchBases = debounce(() => this.fetchServerBases(), 300);
 const rafFn = rafSchedule(() => {
 this.rafUpdateLayersPending = false;
 if (this.renderPaused || this.webglLost || !this.maplibreMap) return;
 try { this.deckOverlay?.setProps({ layers: this.buildLayers() }); } catch { /* map mid-teardown */ }
 });
 this.rafUpdateLayers = () => {
 this.rafUpdateLayersPending = true;
 this._mapFpsAppRepaintCount++;
 rafFn();
 };

 this.setupDOM();
 this.popup = new MapPopup(container);

 this._themeChangedHandler = (e: Event) => {
 const theme = (e as CustomEvent).detail?.theme as 'dark' | 'light';
 if (theme) {
 // Only auto-switch basemap if not using a custom (satellite/terrain) style
 if (this.activeBaseMap === 'dark' || this.activeBaseMap === 'light') {
 this.switchBasemap(theme);
 }
 this.render(); // Rebuilds Deck.GL layers with new theme-aware colors
 }
 };
 window.addEventListener('theme-changed', this._themeChangedHandler);

 // Suspend ALL map rendering (pulse/cable/day-night timers + the render loop)
 // while the window is hidden — otherwise the 1s pulse setIntervals keep firing
 // and each repaint commits the whole 185-panel + map layer tree to Core
 // Animation, burning CPU/battery for a view nobody can see. setRenderPaused
 // stops the timers; on unhide it resumes them and flushes any pending render.
 this._visibilityHandler = () => {
 this.setRenderPausedByHidden(document.visibilityState === 'hidden');
 };
 document.addEventListener('visibilitychange', this._visibilityHandler);

 this.initMapLibre();

 this.maplibreMap?.on('load', () => {
 this.rebuildTechHQSupercluster();
 this.rebuildDatacenterSupercluster();
 this.initDeck();
 this.loadCountryBoundaries();
 this.fetchServerBases();
 this.render();
 this.installMapFpsDebug();

 this.applyDarkMapEnhancements();

 // Arrival choreography canvas overlay
 const wrapper = document.getElementById('deckglMapWrapper');
 if (wrapper) {
 initArrivalChoreography(wrapper, (lat, lon) => this.latlonToPixel(lat, lon));
 }
 });

 this.setupResizeObserver();

 this.createControls();
 this.createTimeSlider();
 this.createLayerToggles();
 this.createLegend();

 // Start day/night timer only if layer is initially enabled
 if (this.state.layers.dayNight) {
 this.startDayNightTimer();
 }

 // Subscribe to theater polygon updates (driven by escalation forecast)
 if (this.state.layers.theaterPolygons) {
 this.startTheaterPolygons();
 }
  }

  /**
   * TEMPORARY idle-repaint instrumentation, gated behind
   * localStorage['cb-debug-map-fps']. Counts actual MapLibre GL frames ('render'
   * event) + app-initiated deck repaints, and every 2s logs frames/sec alongside
   * which standing requester is active — so we can confirm the map is repainting
   * at idle and attribute it. Left behind the flag (off by default); enable with
   *   localStorage.setItem('cb-debug-map-fps','1')
   */
  private installMapFpsDebug(): void {
 let enabled = false;
 try { enabled = localStorage.getItem('cb-debug-map-fps') === '1'; } catch { enabled = false; }
 if (!enabled || !this.maplibreMap) return;
 this.maplibreMap.on('render', () => { this._mapFpsRenderCount++; });
 this._mapFpsTimerId = window.setInterval(() => {
 const glfps = (this._mapFpsRenderCount / 2).toFixed(1);
 const app = (this._mapFpsAppRepaintCount / 2).toFixed(1);
 this._mapFpsRenderCount = 0;
 this._mapFpsAppRepaintCount = 0;
 console.warn(`[MAP-FPS] gl=${glfps}/s appRepaint=${app}/s alertPulses=${this.alertPulses.length} newsPulse=${this.newsPulseIntervalId !== null} cablePulse=${this.cablePulseIntervalId !== null} dayNight=${this.dayNightIntervalId !== null} paused=${this.renderPaused}`);
 }, 2000) as unknown as number;
  }

  private startDayNightTimer(): void {
 if (this.dayNightIntervalId) return;
 this.cachedNightPolygon = this.computeNightPolygon();
 this.dayNightIntervalId = setInterval(() => {
 this.cachedNightPolygon = this.computeNightPolygon();
 this.render();
 }, 5 * 60 * 1000);
  }

  private stopDayNightTimer(): void {
 if (this.dayNightIntervalId) {
 clearInterval(this.dayNightIntervalId);
 this.dayNightIntervalId = null;
 }
 this.cachedNightPolygon = null;
  }

  private startTheaterPolygons(): void {
 if (this.theaterUnsubscribe) return;
 this.theaterUnsubscribe = subscribeTheaterPolygons(() => {
 this.theaterPolygons = getTheaterPolygons();
 this.render();
 });
 this.theaterPolygons = getTheaterPolygons();
  }

  private stopTheaterPolygons(): void {
 if (this.theaterUnsubscribe) {
 this.theaterUnsubscribe();
 this.theaterUnsubscribe = null;
 }
 this.theaterPolygons = [];
  }

  private setupDOM(): void {
 const wrapper = document.createElement('div');
 wrapper.className = 'deckgl-map-wrapper';
 wrapper.id = 'deckglMapWrapper';
 wrapper.style.cssText = 'position: relative; width: 100%; height: 100%; overflow: hidden;';

 // MapLibre container - deck.gl renders directly into MapLibre via MapboxOverlay
 const mapContainer = document.createElement('div');
 mapContainer.id = 'deckgl-basemap';
 mapContainer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%;';
 wrapper.append(mapContainer);

 // Map attribution (CARTO basemap + OpenStreetMap data)
 const attribution = document.createElement('div');
 attribution.className = 'map-attribution';
 attribution.innerHTML = '© <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
 wrapper.append(attribution);

 this.container.append(wrapper);
  }

  private initMapLibre(): void {
 const preset = VIEW_PRESETS[this.state.view];
 const initialTheme = getCurrentTheme();
 // Validate the persisted value — an older build or a hand-edited localStorage
 // could leave a bogus string here, in which case getStyleUrl() silently falls
 // to DARK while the button UI shows nothing as active, and the user reports
 // "the basemap switcher doesn't work".
 const rawSaved = localStorage.getItem(BASEMAP_STORAGE_KEY);
 const validBasemaps: readonly BaseMapStyle[] = ['dark', 'light', 'satellite', 'terrain'];
 const savedBasemap = validBasemaps.includes(rawSaved as BaseMapStyle) ? rawSaved as BaseMapStyle : null;
 this.activeBaseMap = savedBasemap ?? (initialTheme === 'light' ? 'light' : 'dark');

 this.maplibreMap = new maplibregl.Map({
 container: 'deckgl-basemap',
 style: getStyleUrl(this.activeBaseMap),
 center: [preset.longitude, preset.latitude],
 zoom: preset.zoom,
 renderWorldCopies: false,
 attributionControl: false,
 interactive: true,
 ...(MAP_INTERACTION_MODE === 'flat'
 ? {
 maxPitch: 0,
 pitchWithRotate: false,
 dragRotate: false,
 touchPitch: false,
 }
 : {}),
 });

 const canvas = this.maplibreMap.getCanvas();
 canvas.addEventListener('webglcontextlost', (e) => {
 e.preventDefault();
 this.webglLost = true;
 console.warn('[DeckGLMap] WebGL context lost — will restore when browser recovers');
 });
 canvas.addEventListener('webglcontextrestored', () => {
 this.webglLost = false;
 console.info('[DeckGLMap] WebGL context restored');
 this.maplibreMap?.triggerRepaint();
 });
  }

  private initDeck(): void {
 if (!this.maplibreMap) return;

 this.deckOverlay = new MapboxOverlay({
 interleaved: true,
 layers: this.buildLayers(),
 getTooltip: (info: PickingInfo) => this.getTooltip(info),
 onClick: (info: PickingInfo) => this.handleClick(info),
 pickingRadius: 10,
 useDevicePixels: window.devicePixelRatio > 2 ? 2 : true,
 onError: (error: Error) => console.warn('[DeckGLMap] Render error (non-fatal):', error.message),
 });

 this.maplibreMap.addControl(this.deckOverlay as unknown as maplibregl.IControl);

 // Store map event handlers for cleanup in destroy()
 const onMoveStart = () => {
 if (this.moveTimeoutId) {
 clearTimeout(this.moveTimeoutId);
 this.moveTimeoutId = null;
 }
 };
 const onMoveEnd = () => {
 this.lastSCZoom = -1;
 this.rafUpdateLayers();
 this.debouncedFetchBases();
 this.state.zoom = this.maplibreMap?.getZoom() ?? this.state.zoom;
 this.onStateChange?.(this.state);
 const c = this.maplibreMap?.getCenter();
 if (c) setCurrentCenter(c.lat, c.lng);
 };
 const onMoveOrZoom = () => {
 if (this.moveTimeoutId) clearTimeout(this.moveTimeoutId);
 this.moveTimeoutId = setTimeout(() => {
 this.lastSCZoom = -1;
 this.rafUpdateLayers();
 }, 100);
 };
 const onZoomEnd = () => {
 const currentZoom = Math.floor(this.maplibreMap?.getZoom() || 2);
 const thresholdCrossed = Math.abs(currentZoom - this.lastZoomThreshold) >= 1;
 if (thresholdCrossed) {
 this.lastZoomThreshold = currentZoom;
 this.debouncedRebuildLayers();
 }
 this.state.zoom = this.maplibreMap?.getZoom() ?? this.state.zoom;
 this.onStateChange?.(this.state);
 };

 // MapLibre 'error' events fire when a style JSON or tile fails to load
 // (CORS block, 404, network). Log them; if we get many in a short
 // window, surface a visible overlay so a black map produces actionable
 // info instead of a silent failure.
 let mapErrorCount = 0;
 const mapErrorWindowMs = 5000;
 const mapErrorThreshold = 3;
 setTimeout(() => { mapErrorCount = 0; }, mapErrorWindowMs);
 this.maplibreMap.on('error', (e: unknown) => {
 const err = (e as { error?: unknown }).error;
 const msg = err instanceof Error ? err.message : String(err ?? 'unknown');
 const sourceId = (e as { sourceId?: string }).sourceId;
 // Satellite is an optional overlay (not the basemap) and GIBS GOES tiles
 // for the latest hour are often not published yet — handle its errors via
 // hourly fallback and never escalate them to the basemap error overlay.
 // Suppress per-tile logging since recoverSatelliteTiles handles recovery.
 if (sourceId === 'wm-satellite-src') {
 this.recoverSatelliteTiles();
 return;
 }
 console.warn('[DeckGLMap] MapLibre error', { message: msg, sourceId }); // eslint-disable-line no-console
 mapErrorCount += 1;
 if (mapErrorCount === mapErrorThreshold) {
 this.showMapErrorOverlay(msg, sourceId);
 }
 });

 this.maplibreMap.on('movestart', onMoveStart);
 this.maplibreMap.on('moveend', onMoveEnd);
 this.maplibreMap.on('move', onMoveOrZoom);
 this.maplibreMap.on('zoom', onMoveOrZoom);
 this.maplibreMap.on('zoomend', onZoomEnd);
 this.mapEventHandlers = [
 { event: 'movestart', handler: onMoveStart as (...args: unknown[]) => void },
 { event: 'moveend', handler: onMoveEnd as (...args: unknown[]) => void },
 { event: 'move', handler: onMoveOrZoom as (...args: unknown[]) => void },
 { event: 'zoom', handler: onMoveOrZoom as (...args: unknown[]) => void },
 { event: 'zoomend', handler: onZoomEnd as (...args: unknown[]) => void },
 ];
  }

  private setupResizeObserver(): void {
 this.resizeObserver = new ResizeObserver(() => {
 if (this.isResizing) return;
 if (this.maplibreMap) {
 this.maplibreMap.resize();
 }
 });
 this.resizeObserver.observe(this.container);
  }

  public setIsResizing(value: boolean): void {
 const wasResizing = this.isResizing;
 this.isResizing = value;
 if (wasResizing && !value && this.maplibreMap) {
 this.maplibreMap.resize();
 }
  }

  private getSetSignature(set: Set<string>): string {
 return [...set].sort().join('|');
  }

  private hasRecentNews(now = Date.now()): boolean {
 for (const ts of this.newsLocationFirstSeen.values()) {
 if (now - ts < 30_000) return true;
 }
 return false;
  }

  private getTimeRangeMs(range: TimeRange = this.state.timeRange): number {
 const ranges: Record<TimeRange, number> = {
 '1h': 60 * 60 * 1000,
 '6h': 6 * 60 * 60 * 1000,
 '24h': 24 * 60 * 60 * 1000,
 '48h': 48 * 60 * 60 * 1000,
 '7d': 7 * 24 * 60 * 60 * 1000,
 'all': Infinity,
 };
 return ranges[range];
  }

  private parseTime(value: Date | string | number | undefined | null): number | null {
 if (value == undefined) return null;
 const ts = value instanceof Date ? value.getTime() : new Date(value).getTime();
 return Number.isFinite(ts) ? ts : null;
  }

  // filterByTime memoization — cache keyed by (arrayRef, timeRange, minuteBucket)
  // so the same filter isn't re-run 11+ times per buildLayers() call.
  private filterByTimeCache = new WeakMap<readonly unknown[] | unknown[], { range: string; bucket: number; result: unknown[] }>();

  private filterByTime<T>(
 items: T[],
 getTime: (item: T) => Date | string | number | undefined | null
  ): T[] {
 if (this.state.timeRange === 'all') return items;
 // Bucket by minute so cache invalidates roughly every 60s, not every frame
 const bucket = Math.floor(Date.now() / 60_000);
 const cached = this.filterByTimeCache.get(items);
 if (cached && cached.range === this.state.timeRange && cached.bucket === bucket) {
 return cached.result as T[];
 }
 const cutoff = Date.now() - this.getTimeRangeMs();
 const result = items.filter((item) => {
 const ts = this.parseTime(getTime(item));
 return ts == undefined ? true : ts >= cutoff;
 });
 this.filterByTimeCache.set(items, { range: this.state.timeRange, bucket, result });
 return result;
  }

  private getFilteredProtests(): SocialUnrestEvent[] {
 return this.filterByTime(this.protests, (event) => event.time);
  }

  private filterMilitaryFlightClustersByTime(clusters: MilitaryFlightCluster[]): MilitaryFlightCluster[] {
 return clusters
 .map((cluster) => {
 const flights = this.filterByTime(cluster.flights ?? [], (flight) => flight.lastSeen);
 if (flights.length === 0) return null;
 return {
 ...cluster,
 flights,
 flightCount: flights.length,
 };
 })
 .filter((cluster): cluster is MilitaryFlightCluster => cluster !== null);
  }

  private filterMilitaryVesselClustersByTime(clusters: MilitaryVesselCluster[]): MilitaryVesselCluster[] {
 return clusters
 .map((cluster) => {
 const vessels = this.filterByTime(cluster.vessels ?? [], (vessel) => vessel.lastAisUpdate);
 if (vessels.length === 0) return null;
 return {
 ...cluster,
 vessels,
 vesselCount: vessels.length,
 };
 })
 .filter((cluster): cluster is MilitaryVesselCluster => cluster !== null);
  }

  private rebuildProtestSupercluster(source: SocialUnrestEvent[] = this.getFilteredProtests()): void {
 this.protestSuperclusterSource = source;
 const points = source.map((p, i) => ({
 type: 'Feature' as const,
 geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] as [number, number] },
 properties: {
 index: i,
 country: p.country,
 severity: p.severity,
 eventType: p.eventType,
 sourceType: p.sourceType,
 validated: Boolean(p.validated),
 fatalities: Number.isFinite(p.fatalities) ? Number(p.fatalities) : 0,
 timeMs: p.time.getTime(),
 },
 }));
 this.protestSC = new Supercluster({
 radius: 60,
 maxZoom: 14,
 map: (props: Record<string, unknown>) => ({
 index: Number(props.index ?? 0),
 country: String(props.country ?? ''),
 maxSeverityRank: props.severity === 'high' ? 2 : (props.severity === 'medium' ? 1 : 0),
 riotCount: props.eventType === 'riot' ? 1 : 0,
 highSeverityCount: props.severity === 'high' ? 1 : 0,
 verifiedCount: props.validated ? 1 : 0,
 totalFatalities: Number(props.fatalities ?? 0) || 0,
 riotTimeMs: props.eventType === 'riot' && props.sourceType !== 'gdelt' && Number.isFinite(Number(props.timeMs)) ? Number(props.timeMs) : 0,
 }),
 reduce: (acc: Record<string, unknown>, props: Record<string, unknown>) => {
 acc.maxSeverityRank = Math.max(Number(acc.maxSeverityRank ?? 0), Number(props.maxSeverityRank ?? 0));
 acc.riotCount = Number(acc.riotCount ?? 0) + Number(props.riotCount ?? 0);
 acc.highSeverityCount = Number(acc.highSeverityCount ?? 0) + Number(props.highSeverityCount ?? 0);
 acc.verifiedCount = Number(acc.verifiedCount ?? 0) + Number(props.verifiedCount ?? 0);
 acc.totalFatalities = Number(acc.totalFatalities ?? 0) + Number(props.totalFatalities ?? 0);
 const accRiot = Number(acc.riotTimeMs ?? 0);
 const propRiot = Number(props.riotTimeMs ?? 0);
 acc.riotTimeMs = Number.isFinite(propRiot) ? Math.max(accRiot, propRiot) : accRiot;
 if (!acc.country && props.country) acc.country = props.country;
 },
 });
 this.protestSC.load(points);
 this.lastSCZoom = -1;
  }

  private rebuildTechHQSupercluster(): void {
 const points = TECH_HQS.map((h, i) => ({
 type: 'Feature' as const,
 geometry: { type: 'Point' as const, coordinates: [h.lon, h.lat] as [number, number] },
 properties: {
 index: i,
 city: h.city,
 country: h.country,
 type: h.type,
 },
 }));
 this.techHQSC = new Supercluster({
 radius: 50,
 maxZoom: 14,
 map: (props: Record<string, unknown>) => ({
 index: Number(props.index ?? 0),
 city: String(props.city ?? ''),
 country: String(props.country ?? ''),
 faangCount: props.type === 'faang' ? 1 : 0,
 unicornCount: props.type === 'unicorn' ? 1 : 0,
 publicCount: props.type === 'public' ? 1 : 0,
 }),
 reduce: (acc: Record<string, unknown>, props: Record<string, unknown>) => {
 acc.faangCount = Number(acc.faangCount ?? 0) + Number(props.faangCount ?? 0);
 acc.unicornCount = Number(acc.unicornCount ?? 0) + Number(props.unicornCount ?? 0);
 acc.publicCount = Number(acc.publicCount ?? 0) + Number(props.publicCount ?? 0);
 if (!acc.city && props.city) acc.city = props.city;
 if (!acc.country && props.country) acc.country = props.country;
 },
 });
 this.techHQSC.load(points);
 this.lastSCZoom = -1;
  }

  private rebuildTechEventSupercluster(): void {
 const points = this.techEvents.map((e, i) => ({
 type: 'Feature' as const,
 geometry: { type: 'Point' as const, coordinates: [e.lng, e.lat] as [number, number] },
 properties: {
 index: i,
 location: e.location,
 country: e.country,
 daysUntil: e.daysUntil,
 },
 }));
 this.techEventSC = new Supercluster({
 radius: 50,
 maxZoom: 14,
 map: (props: Record<string, unknown>) => {
 const daysUntil = Number(props.daysUntil ?? Number.MAX_SAFE_INTEGER);
 return {
 index: Number(props.index ?? 0),
 location: String(props.location ?? ''),
 country: String(props.country ?? ''),
 soonestDaysUntil: Number.isFinite(daysUntil) ? daysUntil : Number.MAX_SAFE_INTEGER,
 soonCount: Number.isFinite(daysUntil) && daysUntil <= 14 ? 1 : 0,
 };
 },
 reduce: (acc: Record<string, unknown>, props: Record<string, unknown>) => {
 acc.soonestDaysUntil = Math.min(
 Number(acc.soonestDaysUntil ?? Number.MAX_SAFE_INTEGER),
 Number(props.soonestDaysUntil ?? Number.MAX_SAFE_INTEGER),
 );
 acc.soonCount = Number(acc.soonCount ?? 0) + Number(props.soonCount ?? 0);
 if (!acc.location && props.location) acc.location = props.location;
 if (!acc.country && props.country) acc.country = props.country;
 },
 });
 this.techEventSC.load(points);
 this.lastSCZoom = -1;
  }

  private rebuildDatacenterSupercluster(): void {
 const activeDCs = AI_DATA_CENTERS.filter(dc => dc.status !== 'decommissioned');
 this.datacenterSCSource = activeDCs;
 const points = activeDCs.map((dc, i) => ({
 type: 'Feature' as const,
 geometry: { type: 'Point' as const, coordinates: [dc.lon, dc.lat] as [number, number] },
 properties: {
 index: i,
 country: dc.country,
 chipCount: dc.chipCount,
 powerMW: dc.powerMW ?? 0,
 status: dc.status,
 },
 }));
 this.datacenterSC = new Supercluster({
 radius: 70,
 maxZoom: 14,
 map: (props: Record<string, unknown>) => ({
 index: Number(props.index ?? 0),
 country: String(props.country ?? ''),
 totalChips: Number(props.chipCount ?? 0) || 0,
 totalPowerMW: Number(props.powerMW ?? 0) || 0,
 existingCount: props.status === 'existing' ? 1 : 0,
 plannedCount: props.status === 'planned' ? 1 : 0,
 }),
 reduce: (acc: Record<string, unknown>, props: Record<string, unknown>) => {
 acc.totalChips = Number(acc.totalChips ?? 0) + Number(props.totalChips ?? 0);
 acc.totalPowerMW = Number(acc.totalPowerMW ?? 0) + Number(props.totalPowerMW ?? 0);
 acc.existingCount = Number(acc.existingCount ?? 0) + Number(props.existingCount ?? 0);
 acc.plannedCount = Number(acc.plannedCount ?? 0) + Number(props.plannedCount ?? 0);
 if (!acc.country && props.country) acc.country = props.country;
 },
 });
 this.datacenterSC.load(points);
 this.lastSCZoom = -1;
  }

  private updateClusterData(): void {
 const zoom = Math.floor(this.maplibreMap?.getZoom() ?? 2);
 const bounds = this.maplibreMap?.getBounds();
 if (!bounds) return;
 const bbox: [number, number, number, number] = [
 bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
 ];
 const boundsKey = `${bbox[0].toFixed(4)}:${bbox[1].toFixed(4)}:${bbox[2].toFixed(4)}:${bbox[3].toFixed(4)}`;
 const layers = this.state.layers;
 const useProtests = layers.protests && this.protestSuperclusterSource.length > 0;
 const useTechHQ = SITE_VARIANT === 'tech' && layers.techHQs;
 const useTechEvents = SITE_VARIANT === 'tech' && layers.techEvents && this.techEvents.length > 0;
 const useDatacenterClusters = layers.datacenters && zoom < 5;
 const layerMask = `${Number(useProtests)}${Number(useTechHQ)}${Number(useTechEvents)}${Number(useDatacenterClusters)}`;
 if (zoom === this.lastSCZoom && boundsKey === this.lastSCBoundsKey && layerMask === this.lastSCMask) return;
 this.lastSCZoom = zoom;
 this.lastSCBoundsKey = boundsKey;
 this.lastSCMask = layerMask;

 this.protestClusters = useProtests && this.protestSC ? this.protestSC.getClusters(bbox, zoom).map(f => {
 const coords = f.geometry.coordinates as [number, number];
 if (f.properties.cluster) {
 const props = f.properties as Record<string, unknown>;
 const maxSeverityRank = Number(props.maxSeverityRank ?? 0);
 const maxSev = maxSeverityRank >= 2 ? 'high' : (maxSeverityRank === 1 ? 'medium' : 'low');
 const riotCount = Number(props.riotCount ?? 0);
 const highSeverityCount = Number(props.highSeverityCount ?? 0);
 const verifiedCount = Number(props.verifiedCount ?? 0);
 const totalFatalities = Number(props.totalFatalities ?? 0);
 const clusterCount = Number(f.properties.point_count ?? 0);
 const riotTimeMs = Number(props.riotTimeMs ?? 0);
 return {
 id: `pc-${f.properties.cluster_id}`,
 _clusterId: f.properties.cluster_id!,
 lat: coords[1], lon: coords[0],
 count: clusterCount,
 items: [] as SocialUnrestEvent[],
 country: String(props.country ?? ''),
 maxSeverity: maxSev as 'low' | 'medium' | 'high',
 hasRiot: riotCount > 0,
 latestRiotEventTimeMs: riotTimeMs || undefined,
 totalFatalities,
 riotCount,
 highSeverityCount,
 verifiedCount,
 sampled: clusterCount > DeckGLMap.MAX_CLUSTER_LEAVES,
 };
 }
 const item = this.protestSuperclusterSource[f.properties.index]!;
 return {
 id: `pp-${f.properties.index}`, lat: item.lat, lon: item.lon,
 count: 1, items: [item], country: item.country,
 maxSeverity: item.severity, hasRiot: item.eventType === 'riot',
 latestRiotEventTimeMs:
 item.eventType === 'riot' && item.sourceType !== 'gdelt' && Number.isFinite(item.time.getTime())
 ? item.time.getTime()
 : undefined,
 totalFatalities: item.fatalities ?? 0,
 riotCount: item.eventType === 'riot' ? 1 : 0,
 highSeverityCount: item.severity === 'high' ? 1 : 0,
 verifiedCount: item.validated ? 1 : 0,
 sampled: false,
 };
 }) : [];

 this.techHQClusters = useTechHQ && this.techHQSC ? this.techHQSC.getClusters(bbox, zoom).map(f => {
 const coords = f.geometry.coordinates as [number, number];
 if (f.properties.cluster) {
 const props = f.properties as Record<string, unknown>;
 const faangCount = Number(props.faangCount ?? 0);
 const unicornCount = Number(props.unicornCount ?? 0);
 const publicCount = Number(props.publicCount ?? 0);
 const clusterCount = Number(f.properties.point_count ?? 0);
 const primaryType = faangCount >= unicornCount && faangCount >= publicCount
 ? 'faang'
 : (unicornCount >= publicCount
 ? 'unicorn'
 : 'public');
 return {
 id: `hc-${f.properties.cluster_id}`,
 _clusterId: f.properties.cluster_id!,
 lat: coords[1], lon: coords[0],
 count: clusterCount,
 items: [] as import('@/config/tech-geo').TechHQ[],
 city: String(props.city ?? ''),
 country: String(props.country ?? ''),
 primaryType,
 faangCount,
 unicornCount,
 publicCount,
 sampled: clusterCount > DeckGLMap.MAX_CLUSTER_LEAVES,
 };
 }
 const item = TECH_HQS[f.properties.index]!;
 return {
 id: `hp-${f.properties.index}`, lat: item.lat, lon: item.lon,
 count: 1, items: [item], city: item.city, country: item.country,
 primaryType: item.type,
 faangCount: item.type === 'faang' ? 1 : 0,
 unicornCount: item.type === 'unicorn' ? 1 : 0,
 publicCount: item.type === 'public' ? 1 : 0,
 sampled: false,
 };
 }) : [];

 this.techEventClusters = useTechEvents && this.techEventSC ? this.techEventSC.getClusters(bbox, zoom).map(f => {
 const coords = f.geometry.coordinates as [number, number];
 if (f.properties.cluster) {
 const props = f.properties as Record<string, unknown>;
 const clusterCount = Number(f.properties.point_count ?? 0);
 const soonestDaysUntil = Number(props.soonestDaysUntil ?? Number.MAX_SAFE_INTEGER);
 const soonCount = Number(props.soonCount ?? 0);
 return {
 id: `ec-${f.properties.cluster_id}`,
 _clusterId: f.properties.cluster_id!,
 lat: coords[1], lon: coords[0],
 count: clusterCount,
 items: [] as TechEventMarker[],
 location: String(props.location ?? ''),
 country: String(props.country ?? ''),
 soonestDaysUntil: Number.isFinite(soonestDaysUntil) ? soonestDaysUntil : Number.MAX_SAFE_INTEGER,
 soonCount,
 sampled: clusterCount > DeckGLMap.MAX_CLUSTER_LEAVES,
 };
 }
 const item = this.techEvents[f.properties.index]!;
 return {
 id: `ep-${f.properties.index}`, lat: item.lat, lon: item.lng,
 count: 1, items: [item], location: item.location, country: item.country,
 soonestDaysUntil: item.daysUntil,
 soonCount: item.daysUntil <= 14 ? 1 : 0,
 sampled: false,
 };
 }) : [];

 if (useDatacenterClusters && this.datacenterSC) {
 const activeDCs = this.datacenterSCSource;
 this.datacenterClusters = this.datacenterSC.getClusters(bbox, zoom).map(f => {
 const coords = f.geometry.coordinates as [number, number];
 if (f.properties.cluster) {
 const props = f.properties as Record<string, unknown>;
 const clusterCount = Number(f.properties.point_count ?? 0);
 const existingCount = Number(props.existingCount ?? 0);
 const plannedCount = Number(props.plannedCount ?? 0);
 const totalChips = Number(props.totalChips ?? 0);
 const totalPowerMW = Number(props.totalPowerMW ?? 0);
 return {
 id: `dc-${f.properties.cluster_id}`,
 _clusterId: f.properties.cluster_id!,
 lat: coords[1], lon: coords[0],
 count: clusterCount,
 items: [] as AIDataCenter[],
 region: String(props.country ?? ''),
 country: String(props.country ?? ''),
 totalChips,
 totalPowerMW,
 majorityExisting: existingCount >= Math.max(1, clusterCount / 2),
 existingCount,
 plannedCount,
 sampled: clusterCount > DeckGLMap.MAX_CLUSTER_LEAVES,
 };
 }
 const item = activeDCs[f.properties.index]!;
 return {
 id: `dp-${f.properties.index}`, lat: item.lat, lon: item.lon,
 count: 1, items: [item], region: item.country, country: item.country,
 totalChips: item.chipCount, totalPowerMW: item.powerMW ?? 0,
 majorityExisting: item.status === 'existing',
 existingCount: item.status === 'existing' ? 1 : 0,
 plannedCount: item.status === 'planned' ? 1 : 0,
 sampled: false,
 };
 });
 } else {
 this.datacenterClusters = [];
 }
  }




  private isLayerVisible(layerKey: keyof MapLayers): boolean {
 const threshold = LAYER_ZOOM_THRESHOLDS[layerKey];
 if (!threshold) return true;
 const zoom = this.maplibreMap?.getZoom() || 2;
 return zoom >= threshold.minZoom;
  }

  private buildLayers(): LayersList {
 const startTime = performance.now();
 // Refresh theme-aware overlay colors only when theme changes
 const currentTheme = getCurrentTheme();
 if (currentTheme !== _cachedTheme) {
 COLORS = getOverlayColors();
 _cachedTheme = currentTheme;
 }
 const layers: (Layer | null | false)[] = [];
 const { layers: mapLayers } = this.state;
 const filteredEarthquakes = mapLayers.natural ? this.filterByTime(this.earthquakes, (eq) => eq.occurredAt) : [];
 const filteredNaturalEvents = mapLayers.natural ? this.filterByTime(this.naturalEvents, (event) => event.date) : [];
 const filteredWeatherAlerts = mapLayers.weather ? this.filterByTime(this.weatherAlerts, (alert) => alert.onset) : [];
 const filteredOutages = mapLayers.outages ? this.filterByTime(this.outages, (outage) => outage.pubDate) : [];
 const filteredCableAdvisories = mapLayers.cables ? this.filterByTime(this.cableAdvisories, (advisory) => advisory.reported) : [];
 const filteredFlightDelays = mapLayers.flights ? this.filterByTime(this.flightDelays, (delay) => delay.updatedAt) : [];
 const filteredMilitaryFlights = mapLayers.military ? this.filterByTime(this.militaryFlights, (flight) => flight.lastSeen) : [];
 const filteredMilitaryVessels = mapLayers.military ? this.filterByTime(this.militaryVessels, (vessel) => vessel.lastAisUpdate) : [];
 const filteredMilitaryFlightClusters = mapLayers.military ? this.filterMilitaryFlightClustersByTime(this.militaryFlightClusters) : [];
 const filteredMilitaryVesselClusters = mapLayers.military ? this.filterMilitaryVesselClustersByTime(this.militaryVesselClusters) : [];
 const filteredUcdpEvents = mapLayers.ucdpEvents ? this.filterByTime(this.ucdpEvents, (event) => event.date_start) : [];

 // Day/night overlay (rendered first as background)
 if (mapLayers.dayNight) {
 if (!this.dayNightIntervalId) this.startDayNightTimer();
 layers.push(this.createDayNightLayer());
 } else {
 if (this.dayNightIntervalId) this.stopDayNightTimer();
 this.layerCache.delete('day-night-layer');
 }

 // Theater polygon overlays — Worldview-style active conflict theaters colored by escalation score
 if (mapLayers.theaterPolygons) {
 if (!this.theaterUnsubscribe) this.startTheaterPolygons();
 if (this.theaterPolygons.length > 0) {
 layers.push(...this.createTheaterPolygonsLayers());
 }
 } else {
 this.stopTheaterPolygons();
 }

 // Undersea cables layer
 if (mapLayers.cables) {
 layers.push(this.createCablesLayer());
 } else {
 this.layerCache.delete('cables-layer');
 }

 // Pipelines layer
 if (mapLayers.pipelines) {
 layers.push(this.createPipelinesLayer());
 } else {
 this.layerCache.delete('pipelines-layer');
 }

 // Conflict zones layer
 if (mapLayers.conflicts) {
 layers.push(this.createConflictZonesLayer());
 }

 // Military bases layer — hidden at low zoom (E: progressive disclosure) + ghost + clusters
 if (mapLayers.bases && this.isLayerVisible('bases')) {
 layers.push(this.createBasesLayer());
 layers.push(...this.createBasesClusterLayer());
 }

 // Nuclear facilities layer — hidden at low zoom + ghost
 if (mapLayers.nuclear && this.isLayerVisible('nuclear')) {
 layers.push(this.createNuclearLayer());
 }

 // Gamma irradiators layer — hidden at low zoom
 if (mapLayers.irradiators && this.isLayerVisible('irradiators')) {
 layers.push(this.createIrradiatorsLayer());
 }

 // Spaceports layer — hidden at low zoom
 if (mapLayers.spaceports && this.isLayerVisible('spaceports')) {
 layers.push(this.createSpaceportsLayer());
 }

 // Hotspots layer (all hotspots including high/breaking, with pulse + ghost)
 if (mapLayers.hotspots) {
 layers.push(...this.createHotspotsLayers());
 }

 // Datacenters layer - SQUARE icons at zoom >= 5, cluster dots at zoom < 5
 const currentZoom = this.maplibreMap?.getZoom() || 2;
 if (mapLayers.datacenters) {
 if (currentZoom >= 5) {
 layers.push(this.createDatacentersLayer());
 } else {
 layers.push(...this.createDatacenterClusterLayers());
 }
 }

 // Earthquakes layer + ghost for easier picking
 if (mapLayers.natural && filteredEarthquakes.length > 0) {
 layers.push(this.createEarthquakesLayer(filteredEarthquakes));
 }

 // Natural events layer
 if (mapLayers.natural && filteredNaturalEvents.length > 0) {
 layers.push(this.createNaturalEventsLayer(filteredNaturalEvents));
 }

 // Satellite fires layer (NASA FIRMS)
 if (mapLayers.fires && this.firmsFireData.length > 0) {
 layers.push(this.createFiresLayer());
 }

 // Smoke & Air overlay — AQI field + HMS plume + NIFC fire perimeters
 if (mapLayers.airSmoke) {
 this.ensureSmokeOverlayData();
 layers.push(...this.createAirSmokeLayers());
 }

 // Iran events layer
 if (mapLayers.iranAttacks && this.iranEvents.length > 0) {
 layers.push(this.createIranEventsLayer());
 layers.push(this.createGhostLayer('iran-events-layer', this.iranEvents, d => [d.longitude, d.latitude], { radiusMinPixels: 12 }));
 }

 // Weather alerts layer — polygon shape (so user can see what
 // area is covered) + centroid icon (so the alert is visible
 // even when zoomed out and the polygon collapses to a pixel).
 if (mapLayers.weather && filteredWeatherAlerts.length > 0) {
 const polyLayer = this.createWeatherPolygonLayer(filteredWeatherAlerts);
 if (polyLayer) layers.push(polyLayer);
 layers.push(this.createWeatherLayer(filteredWeatherAlerts));
 }

 // Lightning strikes layer (Blitzortung)
 if (mapLayers.lightning && this.lightningStrikes.length > 0) {
 layers.push(this.createLightningLayer());
 }

 // Red flag warnings (NWS fire weather)
 if (mapLayers.redFlagWarnings && this.redFlagWarnings.length > 0) {
 layers.push(this.createRedFlagWarningsLayer());
 }

 // Satellite ground positions
 if (mapLayers.satellites && this.satellitePositions.length > 0) {
 layers.push(this.createSatelliteLayer());
 layers.push(this.createSatelliteLabelLayer());
 if (this.selectedOrbitPath) {
 layers.push(this.createSatelliteOrbitLayer());
 }
 }

 // Internet outages layer + ghost for easier picking
 if (mapLayers.outages && filteredOutages.length > 0) {
 layers.push(this.createOutagesLayer(filteredOutages));
 }

 // Cyber threat IOC layer
 if (mapLayers.cyberThreats && this.cyberThreats.length > 0) {
 layers.push(this.createCyberThreatsLayer());
 }

 // Alert pulse beacons — top of stack so they're never occluded
 if (this.alertPulses.length > 0) {
 const t = (Date.now() % 2000) / 2000; // 0..1 over 2 seconds
 const sevColor = (s: string): [number, number, number, number] =>
 s === 'critical' ? [255, 59, 48, 255]
 : s === 'high' ? [255, 149, 0, 255]
 : [255, 204, 0, 255];
 const radius = 8 + t * 28;
 const fadeAlpha = Math.round(255 * (1 - t));
 layers.push(new ScatterplotLayer({
 id: 'alert-pulses',
 data: this.alertPulses,
 pickable: false,
 stroked: true,
 filled: false,
 lineWidthMinPixels: 2,
 radiusUnits: 'pixels',
 getPosition: (d: { lat: number; lon: number }) => [d.lon, d.lat],
 getRadius: radius,
 getLineColor: (d: { severity: string }) => {
 const c = sevColor(d.severity);
 return [c[0], c[1], c[2], fadeAlpha];
 },
 updateTriggers: { getRadius: t, getLineColor: t },
 }));
 // Throttled repaint — drives alert pulse at ~4fps instead of unbounded RAF
 // loop. Suppressed while paused/hidden so it can't keep rebuilding layers for
 // a view nobody can see (the loop that spiked idle CPU when alerts were live).
 if (!this.rafUpdateLayersPending && !this.renderPaused) {
 setTimeout(() => this.rafUpdateLayers(), 250);
 }
 }

 // AIS density layer
 if (mapLayers.ais && this.aisDensity.length > 0) {
 layers.push(this.createAisDensityLayer());
 }

 // AIS disruptions layer (spoofing/jamming)
 if (mapLayers.ais && this.aisDisruptions.length > 0) {
 layers.push(this.createAisDisruptionsLayer());
 }

 // GPS/GNSS jamming layer
 if (mapLayers.gpsJamming && this.gpsJammingHexes.length > 0) {
 layers.push(this.createGpsJammingLayer());
 }

 // ADS-B live aircraft layer
 if (mapLayers.adsb && this.adsbFlights.length > 0) {
 if (mapLayers.aircraft3d && (this.maplibreMap?.getZoom() ?? 0) >= 5) {
 layers.push(this.createAdsb3DLayer());
 } else {
 layers.push(this.createAdsbLayer());
 }
 }

 // Strategic ports layer (shown with AIS)
 if (mapLayers.ais) {
 layers.push(this.createPortsLayer());
 }

 // Cable advisories layer (shown with cables)
 if (mapLayers.cables && filteredCableAdvisories.length > 0) {
 layers.push(this.createCableAdvisoriesLayer(filteredCableAdvisories));
 }

 // Repair ships layer (shown with cables)
 if (mapLayers.cables && this.repairShips.length > 0) {
 layers.push(this.createRepairShipsLayer());
 }

 // Flight delays layer
 if (mapLayers.flights && filteredFlightDelays.length > 0) {
 layers.push(this.createFlightDelaysLayer(filteredFlightDelays));
 }

 // FAA weather cameras layer
 if (mapLayers.faaWeatherCams && this.faaCameras.length > 0) {
 layers.push(this.createFAACamerasLayer(this.faaCameras));
 }

 // Disease Intelligence layers (choropleth + variant dots + outbreak pins)
 if (mapLayers.diseaseIntel && this.diseaseIntelData) {
 if (this.diseaseIntelGeoJson) {
 layers.push(this.createDiseaseIntelChoroplethLayer(this.diseaseIntelGeoJson));
 }
 if (this.diseaseIntelData.covidCountries.length > 0) {
 layers.push(this.createDiseaseIntelVariantDotsLayer(this.diseaseIntelData.covidCountries));
 }
 const outbreakPins = [
 ...this.diseaseIntelData.epidemicEvents,
 ...this.diseaseIntelData.whoDon,
 ];
 if (outbreakPins.length > 0) {
 layers.push(this.createDiseaseIntelOutbreakPinsLayer(outbreakPins));
 }
 }

 // Protests layer (Supercluster-based deck.gl layers)
 if (mapLayers.protests && this.protests.length > 0) {
 layers.push(...this.createProtestClusterLayers());
 }

 // Military vessel + flight trails (zoom-gated; rendered below dot markers)
 if (mapLayers.military && (this.maplibreMap?.getZoom() ?? 0) >= 3.5 && !isLowPowerMode()) {
 const vesselTrails = this.createMilitaryVesselTrailsLayer(filteredMilitaryVessels);
 if (vesselTrails) layers.push(vesselTrails);
 const flightTrails = this.createMilitaryFlightTrailsLayer(filteredMilitaryFlights);
 if (flightTrails) layers.push(flightTrails);
 }

 // Military vessels layer
 if (mapLayers.military && filteredMilitaryVessels.length > 0) {
 layers.push(this.createMilitaryVesselsLayer(filteredMilitaryVessels));
 }

 // Military vessel clusters layer
 if (mapLayers.military && filteredMilitaryVesselClusters.length > 0) {
 layers.push(this.createMilitaryVesselClustersLayer(filteredMilitaryVesselClusters));
 }

 // Military flights layer
 if (mapLayers.military && filteredMilitaryFlights.length > 0) {
 if (mapLayers.aircraft3d && (this.maplibreMap?.getZoom() ?? 0) >= 5) {
 layers.push(this.createMilitary3DFlightsLayer(filteredMilitaryFlights));
 } else {
 layers.push(this.createMilitaryFlightsLayer(filteredMilitaryFlights));
 }
 }

 // Military flight clusters layer
 if (mapLayers.military && filteredMilitaryFlightClusters.length > 0) {
 layers.push(this.createMilitaryFlightClustersLayer(filteredMilitaryFlightClusters));
 }

 // Strategic waterways layer
 if (mapLayers.waterways) {
 layers.push(this.createWaterwaysLayer());
 }

 // Economic centers layer — hidden at low zoom
 if (mapLayers.economic && this.isLayerVisible('economic')) {
 layers.push(this.createEconomicCentersLayer());
 }

 // Finance variant layers
 if (mapLayers.stockExchanges) {
 layers.push(this.createStockExchangesLayer());
 }
 if (mapLayers.financialCenters) {
 layers.push(this.createFinancialCentersLayer());
 }
 if (mapLayers.centralBanks) {
 layers.push(this.createCentralBanksLayer());
 }
 if (mapLayers.commodityHubs) {
 layers.push(this.createCommodityHubsLayer());
 }

 // Critical minerals layer
 if (mapLayers.minerals) {
 layers.push(this.createMineralsLayer());
 }

 // APT Groups layer — loaded lazily when cyberThreats layer is enabled
 if (mapLayers.cyberThreats && SITE_VARIANT !== 'tech' && SITE_VARIANT !== 'happy' && this.aptGroups.length > 0) {
 layers.push(this.createAPTGroupsLayer());
 }

 // UCDP georeferenced events layer
 if (mapLayers.ucdpEvents && filteredUcdpEvents.length > 0) {
 layers.push(this.createUcdpEventsLayer(filteredUcdpEvents));
 }

 // Air strikes & drone events layer
 if (mapLayers.airstrikes && this.airstrikesData.length > 0) {
 layers.push(this.createAirstrikesLayer());
 }

 // Strike package icons + predicted route paths
 if (mapLayers.strikePackages && this.strikePackages.length > 0) {
 layers.push(this.createStrikePackageIconLayer());
 layers.push(...this.createStrikePackageRouteLayers());
 }

 // S2 Underground intelligence layer — only at zoom ≥5 to avoid global dot clutter
 const zoom = this.maplibreMap?.getZoom() ?? 0;
 if (mapLayers.s2pimu && this.s2pimuData.length > 0 && zoom >= 5) {
 layers.push(this.createS2UndergroundLayer());
 }

 // Displacement flows arc layer
 if (mapLayers.displacement && this.displacementFlows.length > 0) {
 layers.push(this.createDisplacementArcsLayer());
 }

 // Climate anomalies heatmap layer
 if (mapLayers.climate && this.climateAnomalies.length > 0) {
 layers.push(this.createClimateHeatmapLayer());
 }

 // Trade routes layer
 if (mapLayers.tradeRoutes) {
 layers.push(this.createTradeRoutesLayer());
 layers.push(this.createTradeChokepointsLayer());
 } else {
 this.layerCache.delete('trade-routes-layer');
 this.layerCache.delete('trade-chokepoints-layer');
 }

 // Tech variant layers (Supercluster-based deck.gl layers for HQs and events)
 if (SITE_VARIANT === 'tech') {
 if (mapLayers.startupHubs) {
 layers.push(this.createStartupHubsLayer());
 }
 if (mapLayers.techHQs) {
 layers.push(...this.createTechHQClusterLayers());
 }
 if (mapLayers.accelerators) {
 layers.push(this.createAcceleratorsLayer());
 }
 if (mapLayers.cloudRegions) {
 layers.push(this.createCloudRegionsLayer());
 }
 if (mapLayers.techEvents && this.techEvents.length > 0) {
 layers.push(...this.createTechEventClusterLayers());
 }
 }

 // Gulf FDI investments layer
 if (mapLayers.gulfInvestments) {
 layers.push(this.createGulfInvestmentsLayer());
 }

 // Positive events layer (happy variant)
 if (mapLayers.positiveEvents && this.positiveEvents.length > 0) {
 layers.push(...this.createPositiveEventsLayers());
 }

 // Kindness layer (happy variant -- green baseline pulses + real kindness events)
 if (mapLayers.kindness && this.kindnessPoints.length > 0) {
 layers.push(...this.createKindnessLayers());
 }

 // Phase 8: Happiness choropleth (rendered below point markers)
 if (mapLayers.happiness) {
 const choropleth = this.createHappinessChoroplethLayer();
 if (choropleth) layers.push(choropleth);
 }
 // Phase 8: Species recovery zones
 if (mapLayers.speciesRecovery && this.speciesRecoveryZones.length > 0) {
 layers.push(this.createSpeciesRecoveryLayer());
 }
 // Phase 8: Renewable energy installations
 if (mapLayers.renewableInstallations && this.renewableInstallations.length > 0) {
 layers.push(this.createRenewableInstallationsLayer());
 }

 // Multi-domain threat convergence rings
 if (mapLayers.convergenceRings) {
 const convergenceAlerts = detectGeoConvergence(this.convergenceSeenAlerts);
 if (convergenceAlerts.length > 0) {
 layers.push(...this.createConvergenceRingsLayers(convergenceAlerts));
 }
 }

 // EMA forecast predictive threat overlay
 if (mapLayers.forecastOverlay) {
 const forecastRegions = forecastOverlay.getRegions();
 if (forecastRegions.length > 0) {
 layers.push(this.createForecastOverlayLayer(forecastRegions));
 layers.push(this.createForecastOverlayLabelLayer(forecastRegions));
 }
 }

 // Threat Heatmap — aggregate all geo-tagged events into a density heatmap
 if (mapLayers.threatHeatmap) {
 const heatPoints = this.collectThreatHeatmapPoints();
 if (heatPoints.length > 0) {
 layers.push(this.createThreatHeatmapLayer(heatPoints));
 }
 }

 // SIGINT Convergence — unified GPS jamming + BGP anomaly + cable outage layer
 if (mapLayers.sigintConvergence) {
 const sigintPts = getSigintPoints();
 if (sigintPts.length > 0) {
 layers.push(this.createSigintPointsLayer(sigintPts));
 }
 const sigintClusters = getSigintClusters();
 if (sigintClusters.length > 0) {
 layers.push(this.createSigintClusterLayer(sigintClusters));
 }
 }

 // News geo-locations (always shown if data exists)
 if (this.newsLocations.length > 0) {
 layers.push(...this.createNewsLocationsLayer());
 }

 const result = layers.filter(Boolean) as LayersList;
 const elapsed = performance.now() - startTime;
 if (import.meta.env.DEV && elapsed > 16) {
 console.warn(`[DeckGLMap] buildLayers took ${elapsed.toFixed(2)}ms (>16ms budget), ${result.length} layers`);
 }
 return result;
  }

  // Layer creation methods
  private createCablesLayer(): PathLayer {
 const highlightedCables = this.highlightedAssets.cable;
 const cacheKey = 'cables-layer';
 const cached = this.layerCache.get(cacheKey) as PathLayer | undefined;
 const highlightSignature = this.getSetSignature(highlightedCables);
 const healthSignature = Object.keys(this.healthByCableId).sort().join(',');
 // Cache is invalidated by pulse (cablePulsePhase changes every ~120ms via startCablePulse)
 if (cached && highlightSignature === this.lastCableHighlightSignature && healthSignature === this.lastCableHealthSignature) return cached;

 const health = this.healthByCableId;
 // Pulse: gentle sine-wave opacity modulation 100–200 alpha over 10s cycle
 const pulseAlpha = Math.round(150 + 50 * Math.sin(this.cablePulsePhase));

 const layer = new PathLayer({
 id: cacheKey,
 data: UNDERSEA_CABLES,
 getPath: (d) => d.points,
 getColor: (d) => {
 if (highlightedCables.has(d.id)) return COLORS.cableHighlight;
 const h = health[d.id];
 if (h?.status === 'fault') return COLORS.cableFault;
 if (h?.status === 'degraded') return COLORS.cableDegraded;
 return [0, 200, 255, pulseAlpha] as [number, number, number, number];
 },
 getWidth: (d) => {
 if (highlightedCables.has(d.id)) return 3;
 const h = health[d.id];
 if (h?.status === 'fault') return 2.5;
 if (h?.status === 'degraded') return 2;
 return 1;
 },
 widthMinPixels: 1,
 widthMaxPixels: 5,
 pickable: true,
 updateTriggers: { highlighted: highlightSignature, health: healthSignature, pulse: this.cablePulsePhase },
 });

 this.lastCableHighlightSignature = highlightSignature;
 this.lastCableHealthSignature = healthSignature;
 this.layerCache.set(cacheKey, layer);
 return layer;
  }

  private createPipelinesLayer(): PathLayer {
 const highlightedPipelines = this.highlightedAssets.pipeline;
 const cacheKey = 'pipelines-layer';
 const cached = this.layerCache.get(cacheKey) as PathLayer | undefined;
 const highlightSignature = this.getSetSignature(highlightedPipelines);
 if (cached && highlightSignature === this.lastPipelineHighlightSignature) return cached;

 const layer = new PathLayer({
 id: cacheKey,
 data: PIPELINES,
 getPath: (d) => d.points,
 getColor: (d) => {
 if (highlightedPipelines.has(d.id)) {
 return [255, 100, 100, 200] as [number, number, number, number];
 }
 const colorKey = d.type as keyof typeof PIPELINE_COLORS;
 const hex = PIPELINE_COLORS[colorKey] || '#666666';
 return this.hexToRgba(hex, 150);
 },
 getWidth: (d) => highlightedPipelines.has(d.id) ? 3 : 1.5,
 widthMinPixels: 1,
 widthMaxPixels: 4,
 pickable: true,
 updateTriggers: { highlighted: highlightSignature },
 });

 this.lastPipelineHighlightSignature = highlightSignature;
 this.layerCache.set(cacheKey, layer);
 return layer;
  }

  private createConflictZonesLayer(): GeoJsonLayer {
 const cacheKey = 'conflict-zones-layer';
 const lineColor = getCurrentTheme() === 'light'
 ? [255, 0, 0, 120] as [number, number, number, number]
 : [255, 0, 0, 180] as [number, number, number, number];

 const layer = new GeoJsonLayer({
 id: cacheKey,
 data: CONFLICT_ZONES_GEOJSON,
 filled: true,
 stroked: true,
 getFillColor: COLORS.conflict,
 getLineColor: lineColor,
 getLineWidth: 2,
 lineWidthMinPixels: 1,
 pickable: true,
 });
 return layer;
  }

  private getBasesData(): MilitaryBaseEnriched[] {
 return this.serverBasesLoaded ? this.serverBases : MILITARY_BASES as MilitaryBaseEnriched[];
  }

  private getBaseColor(type: string, a: number): [number, number, number, number] {
 switch (type) {
 case 'us-nato': { return [68, 136, 255, a];
 }
 case 'russia': { return [255, 68, 68, a];
 }
 case 'china': { return [255, 136, 68, a];
 }
 case 'uk': { return [68, 170, 255, a];
 }
 case 'france': { return [0, 85, 164, a];
 }
 case 'india': { return [255, 153, 51, a];
 }
 case 'japan': { return [188, 0, 45, a];
 }
 default: { return [136, 136, 136, a];
 }
 }
  }

  private createBasesLayer(): IconLayer {
 const highlightedBases = this.highlightedAssets.base;
 const zoom = this.maplibreMap?.getZoom() || 3;
 const alphaScale = Math.min(1, (zoom - 2.5) / 2.5);
 const a = Math.round(160 * Math.max(0.3, alphaScale));
 const data = this.getBasesData();

 return new IconLayer({
 id: 'bases-layer',
 data,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: () => 'triangleUp',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: (d) => highlightedBases.has(d.id) ? 16 : 11,
 getColor: (d) => {
 if (highlightedBases.has(d.id)) {
 return [255, 100, 100, 220] as [number, number, number, number];
 }
 return this.getBaseColor(d.type, a);
 },
 sizeScale: 1,
 sizeMinPixels: 6,
 sizeMaxPixels: 16,
 pickable: true,
 });
  }

  private createBasesClusterLayer(): Layer[] {
 if (this.serverBaseClusters.length === 0) return [];
 const zoom = this.maplibreMap?.getZoom() || 3;
 const alphaScale = Math.min(1, (zoom - 2.5) / 2.5);
 const a = Math.round(180 * Math.max(0.3, alphaScale));

 const scatterLayer = new ScatterplotLayer<ServerBaseCluster>({
 id: 'bases-cluster-layer',
 data: this.serverBaseClusters,
 getPosition: (d) => [d.longitude, d.latitude],
 getRadius: (d) => Math.max(8000, Math.log2(d.count) * 6000),
 getFillColor: (d) => this.getBaseColor(d.dominantType, a),
 radiusMinPixels: 10,
 radiusMaxPixels: 40,
 pickable: true,
 });

 const textLayer = new TextLayer<ServerBaseCluster>({
 id: 'bases-cluster-text',
 data: this.serverBaseClusters,
 getPosition: (d) => [d.longitude, d.latitude],
 getText: (d) => String(d.count),
 getSize: 12,
 getColor: [255, 255, 255, 220],
 fontWeight: 'bold',
 getTextAnchor: 'middle',
 getAlignmentBaseline: 'center',
 });

 return [scatterLayer, textLayer];
  }

  private createNuclearLayer(): IconLayer {
 const highlightedNuclear = this.highlightedAssets.nuclear;
 const data = NUCLEAR_FACILITIES.filter(f => f.status !== 'decommissioned');

 // Nuclear: HEXAGON icons - yellow/orange color, semi-transparent
 return new IconLayer({
 id: 'nuclear-layer',
 data,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: () => 'hexagon',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: (d) => highlightedNuclear.has(d.id) ? 15 : 11,
 getColor: (d) => {
 if (highlightedNuclear.has(d.id)) {
 return [255, 100, 100, 220] as [number, number, number, number];
 }
 if (d.status === 'contested') {
 return [255, 50, 50, 200] as [number, number, number, number];
 }
 return [255, 220, 0, 200] as [number, number, number, number]; // Semi-transparent yellow
 },
 sizeScale: 1,
 sizeMinPixels: 6,
 sizeMaxPixels: 15,
 pickable: true,
 });
  }

  private createIrradiatorsLayer(): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'irradiators-layer',
 data: GAMMA_IRRADIATORS,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 6000,
 getFillColor: [255, 100, 255, 180] as [number, number, number, number], // Magenta
 radiusMinPixels: 4,
 radiusMaxPixels: 10,
 pickable: true,
 });
  }

  private createSpaceportsLayer(): IconLayer {
 return new IconLayer({
 id: 'spaceports-layer',
 data: SPACEPORTS,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: () => 'rocket',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: 20,
 sizeMinPixels: 10,
 sizeMaxPixels: 22,
 getColor: [200, 100, 255, 200] as [number, number, number, number],
 pickable: true,
 });
  }

  private createPortsLayer(): IconLayer {
 return new IconLayer({
 id: 'ports-layer',
 data: PORTS,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: () => 'anchor',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: 18,
 sizeMinPixels: 8,
 sizeMaxPixels: 18,
 getColor: (d) => {
 switch (d.type) {
 case 'naval': { return [100, 150, 255, 200] as [number, number, number, number]; }
 case 'oil': { return [255, 140, 0, 200] as [number, number, number, number]; }
 case 'lng': { return [255, 200, 50, 200] as [number, number, number, number]; }
 case 'container': { return [0, 200, 255, 180] as [number, number, number, number]; }
 case 'mixed': { return [150, 200, 150, 180] as [number, number, number, number]; }
 case 'bulk': { return [180, 150, 120, 180] as [number, number, number, number]; }
 default: { return [0, 200, 255, 160] as [number, number, number, number]; }
 }
 },
 pickable: true,
 });
  }

  private createFlightDelaysLayer(delays: AirportDelayAlert[]): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'flight-delays-layer',
 data: delays,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: (d) => {
 if (d.severity === 'severe') return 15_000;
 if (d.severity === 'major') return 12_000;
 if (d.severity === 'moderate') return 10_000;
 return 8000;
 },
 getFillColor: (d) => {
 if (d.severity === 'severe') return [255, 50, 50, 200] as [number, number, number, number];
 if (d.severity === 'major') return [255, 150, 0, 200] as [number, number, number, number];
 if (d.severity === 'moderate') return [255, 200, 100, 180] as [number, number, number, number];
 return [180, 180, 180, 150] as [number, number, number, number];
 },
 radiusMinPixels: 4,
 radiusMaxPixels: 15,
 pickable: true,
 });
  }

  private createFAACamerasLayer(cameras: ScoredFAACamera[]): ScatterplotLayer<ScoredFAACamera> {
 return new ScatterplotLayer<ScoredFAACamera>({
 id: 'faa-cameras',
 data: cameras,
 getPosition: d => [d.lon, d.lat],
 // Bumped from 4/8 → 6/12 base radius so 3,000+ cameras stay
 // visible on satellite/terrain basemaps where small pale-blue
 // dots used to disappear.
 getRadius: d => (d.alertProximityMi !== null ? 12 : 6),
 getFillColor: d =>
 d.alertProximityMi !== null
 ? [255, 160, 60, 240]    // amber, near full alpha
 : [100, 180, 255, 160],  // pale blue, ~63% alpha (was 31%)
 stroked: true,
 lineWidthMinPixels: 1,
 getLineColor: d =>
 d.alertProximityMi !== null
 ? [80, 40, 0, 255]
 : [40, 90, 140, 200],
 // Min/max pixel radius keeps the dots visible at every zoom.
 radiusMinPixels: 5,
 radiusMaxPixels: 16,
 pickable: true,
 autoHighlight: true,
 });
  }

  private createDiseaseIntelChoroplethLayer(geoJson: import('geojson').FeatureCollection): GeoJsonLayer {
 const caseMap = this.diseaseIntelCountryCaseMap;
 return new GeoJsonLayer({
 id: 'disease-intel-choropleth',
 data: geoJson,
 filled: true,
 stroked: false,
 getFillColor: (d: import('geojson').Feature) => {
 const iso2 =
 (d.properties?.['ISO3166-1-Alpha-2'] as string | undefined)?.toUpperCase() ??
 (d.properties?.ISO_A2 as string | undefined)?.toUpperCase() ??
 '';
 const perM = caseMap.get(iso2) ?? 0;
 if (perM <= 0) return [0, 0, 0, 0];
 if (perM >= 20_000) return [200, 0, 0, 130];
 if (perM >= 5000) return [255, 80, 0, 100];
 if (perM >= 1000) return [255, 180, 0, 60];
 return [255, 220, 100, 30];
 },
 pickable: false,
 updateTriggers: { getFillColor: [caseMap.size] },
 });
  }

  private createDiseaseIntelVariantDotsLayer(countries: CovidCountry[]): ScatterplotLayer<CovidCountry> {
 const data = this.diseaseIntelData;
 return new ScatterplotLayer<CovidCountry>({
 id: 'disease-intel-variant-dots',
 data: countries.filter(c => c.lat !== 0 && c.lon !== 0),
 getPosition: d => [d.lon, d.lat],
 getRadius: 5,
 getFillColor: d => {
 const clade = data ? getDominantCladeColorForIso2(data, d.iso2) : [180, 180, 180, 160];
 return clade as [number, number, number, number];
 },
 radiusMinPixels: 3,
 radiusMaxPixels: 8,
 pickable: true,
 autoHighlight: true,
 });
  }

  private createDiseaseIntelOutbreakPinsLayer(
 items: (EpidemicEvent | WhoDonAlert)[]
  ): IconLayer<{ lat: number; lon: number; isAlert: boolean }> {
 const countries = this.diseaseIntelData?.covidCountries ?? [];

 const pins = items
 .map(item => {
 const countryName = item.country;
 const coords = resolveCountryCoords(countryName, countries);
 if (!coords) return null;
 const isAlert = 'status' in item ? (item as EpidemicEvent).status === 'alert' : false;
 return { lat: coords[0], lon: coords[1], isAlert };
 })
 .filter((p): p is { lat: number; lon: number; isAlert: boolean } => p !== null);

 return new IconLayer({
 id: 'disease-intel-outbreak-pins',
 data: pins,
 getPosition: d => [d.lon, d.lat],
 getIcon: () => 'biohazard',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: 20,
 sizeMinPixels: 10,
 sizeMaxPixels: 22,
 getColor: d => d.isAlert ? [255, 60, 60, 220] : [255, 160, 60, 200],
 pickable: true,
 });
  }

  private createGhostLayer<T>(id: string, data: T[], getPosition: (d: T) => [number, number], opts: { radiusMinPixels?: number } = {}): ScatterplotLayer<T> {
 return new ScatterplotLayer<T>({
 id: `${id}-ghost`,
 data,
 getPosition,
 getRadius: 1,
 radiusMinPixels: opts.radiusMinPixels ?? 12,
 getFillColor: [0, 0, 0, 0],
 pickable: true,
 });
  }


  private createDatacentersLayer(): IconLayer {
 const highlightedDC = this.highlightedAssets.datacenter;
 const data = AI_DATA_CENTERS.filter(dc => dc.status !== 'decommissioned');

 // Datacenters: SQUARE icons - purple color, semi-transparent for layering
 return new IconLayer({
 id: 'datacenters-layer',
 data,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: () => 'square',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: (d) => highlightedDC.has(d.id) ? 14 : 10,
 getColor: (d) => {
 if (highlightedDC.has(d.id)) {
 return [255, 100, 100, 200] as [number, number, number, number];
 }
 if (d.status === 'planned') {
 return [136, 68, 255, 100] as [number, number, number, number]; // Transparent for planned
 }
 return [136, 68, 255, 140] as [number, number, number, number]; // ~55% opacity
 },
 sizeScale: 1,
 sizeMinPixels: 6,
 sizeMaxPixels: 14,
 pickable: true,
 });
  }

  private createEarthquakesLayer(earthquakes: Earthquake[]): IconLayer {
 return new IconLayer({
 id: 'earthquakes-layer',
 data: earthquakes,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: () => 'earthquake',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: (d) => 12 + d.magnitude * 3,
 sizeMinPixels: 10,
 sizeMaxPixels: 36,
 getColor: (d) => {
 const mag = d.magnitude;
 if (mag >= 6) return [255, 0, 0, 200] as [number, number, number, number];
 if (mag >= 5) return [255, 100, 0, 200] as [number, number, number, number];
 return COLORS.earthquake;
 },
 pickable: true,
 });
  }

  private createNaturalEventsLayer(events: NaturalEvent[]): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'natural-events-layer',
 data: events,
 getPosition: (d: NaturalEvent) => [d.lon, d.lat],
 getRadius: (d: NaturalEvent) => d.title.startsWith('🔴') ? 20_000 : (d.title.startsWith('🟠') ? 15_000 : 8000),
 getFillColor: (d: NaturalEvent) => {
 if (d.title.startsWith('🔴')) return [255, 0, 0, 220] as [number, number, number, number];
 if (d.title.startsWith('🟠')) return [255, 140, 0, 200] as [number, number, number, number];
 return [255, 150, 50, 180] as [number, number, number, number];
 },
 radiusMinPixels: 5,
 radiusMaxPixels: 18,
 pickable: true,
 });
  }

  private createFiresLayer(): IconLayer {
 return new IconLayer({
 id: 'fires-layer',
 data: this.firmsFireData,
 getPosition: (d: (typeof this.firmsFireData)[0]) => [d.lon, d.lat],
 getIcon: () => 'fire',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: (d: (typeof this.firmsFireData)[0]) => 12 + Math.min(d.frp / 10, 16),
 sizeMinPixels: 8,
 sizeMaxPixels: 24,
 getColor: (d: (typeof this.firmsFireData)[0]) => {
 if (d.brightness > 400) return [255, 30, 0, 220] as [number, number, number, number];
 if (d.brightness > 350) return [255, 140, 0, 200] as [number, number, number, number];
 return [255, 220, 50, 180] as [number, number, number, number];
 },
 pickable: true,
 });
  }

  private ensureSmokeOverlayData(): void {
 // AQI dots track the smoke engine — re-render whenever it refreshes.
 this.smokeOverlayUnsub ??= subscribeSmoke(() => this.updateLayers());
 // Forecast field loads independently — its absence never blocks the dots.
 void this.ensureSmokeForecastField();
 // Re-read plume + perimeters when our copy is older than the service
 // cache windows; a failed load leaves the timestamp unset so the next
 // layer build retries instead of sticking stale-forever.
 const RELOAD_MS = 10 * 60 * 1000;
 if (this.smokeOverlayLoading || Date.now() - this.smokeOverlayLoadedAt < RELOAD_MS) return;
 this.smokeOverlayLoading = true;
 void Promise.all([
 import('@/services/wildfires/fire-intel-service').then((m) => m.fetchActivePerimeters()),
 import('@/services/wildfire-smoke').then((m) => m.fetchWildfireSmoke()),
 ])
 .then(([perimeters, smoke]) => {
 this.smokeOverlayPerimeters = perimeters;
 this.smokeOverlayPlumes = smoke.polygons ?? [];
 // The services fail SOFT (resolve empty on upstream errors), so a
 // both-empty result is treated as not-loaded and retried on the next
 // build — ~150 fires are always active nationally, so genuinely-empty
 // is implausible and the cost of re-asking the cached services is nil.
 if (perimeters.length > 0 || this.smokeOverlayPlumes.length > 0) {
 this.smokeOverlayLoadedAt = Date.now();
 }
 this.updateLayers();
 })
 .catch(() => { /* retry on a later layer build; freshness feed records the error */ })
 .finally(() => { this.smokeOverlayLoading = false; });
  }

  /** 30-min reload of the grid-sampled AQI forecast that powers the map's
   *  time scrubber. Keyed to the primary place; failures degrade silently
   *  (the observational layers still render; freshness records the error). */
  private async ensureSmokeForecastField(): Promise<void> {
 const snap = getSmokeSnapshots()[0];
 if (!snap || this.smokeForecastLoading) return;
 // Primary place changed → the cached field is another place's air. Drop
 // it synchronously (this runs before createAirSmokeLayers in the same
 // buildLayers pass) so the old field never renders under the new center
 // while the refetch runs — even if that refetch fails.
 if (this.smokeForecastField && this.smokeForecastCenter !== snap.placeId) {
 this.smokeForecastField = null;
 this.smokeForecastHourIdx = 0;
 }
 const FIELD_RELOAD_MS = 30 * 60 * 1000;
 const FIELD_RETRY_MS = 2 * 60 * 1000;
 if (this.smokeForecastField && Date.now() - this.smokeForecastField.generatedAt < FIELD_RELOAD_MS) return;
 // Outage cooldown: layer rebuilds fire on every pan/zoom — don't hammer
 // a failing endpoint more than once per retry window.
 if (Date.now() - this.smokeForecastFailedAt < FIELD_RETRY_MS) return;
 this.smokeForecastLoading = true;
 try {
 const [{ forecastGridPoints, assembleForecastField }, { fetchAqGrid, fetchHrrrAqGrid }] = await Promise.all([
 import('@/services/smoke/forecast-field'),
 import('@/services/smoke/smoke-fetch'),
 ]);
 const points = forecastGridPoints(snap.lat, snap.lon);
 // Prefer the HRRR-Smoke gridded model (sidecar wgrib2 decode); fall back to
 // the Open-Meteo sampler whenever HRRR yields nothing (wgrib2 not installed,
 // point outside CONUS, or NOMADS down). Both return the same GridPointAq[].
 const hrrr = await fetchHrrrAqGrid(points);
 const parsed = hrrr.some((p) => p !== null) ? hrrr : await fetchAqGrid(points);
 const field = assembleForecastField(points, parsed, Date.now());
 if (field) {
 this.smokeForecastField = field;
 this.smokeForecastCenter = snap.placeId;
 this.smokeForecastHourIdx = Math.min(this.smokeForecastHourIdx, field.hoursMs.length - 1);
 this.smokeForecastFailedAt = 0;
 this.updateLayers();
 } else {
 this.smokeForecastFailedAt = Date.now();
 }
 } catch { this.smokeForecastFailedAt = Date.now(); /* enhancement layer — dots/plume still render */ }
 finally { this.smokeForecastLoading = false; }
  }

  private createAirSmokeLayers(): (ScatterplotLayer | PolygonLayer)[] {
 const layers: (ScatterplotLayer | PolygonLayer)[] = [];

 // Forecast AQI field for the scrubber's selected hour — rendered UNDER
 // the observational layers (plume/fires/dots stay legible on top).
 const field = this.smokeForecastField;
 if (field && field.cells.length > 0) {
 const hourIdx = Math.min(this.smokeForecastHourIdx, field.hoursMs.length - 1);
 layers.push(new ScatterplotLayer({
 id: 'air-smoke-forecast-layer',
 data: field.cells,
 getPosition: (d: (typeof field.cells)[0]) => [d.lon, d.lat],
 getRadius: 34_000,
 radiusMaxPixels: 72,
 stroked: false,
 getFillColor: (d: (typeof field.cells)[0]) => {
 const aqi = d.aqiByHour[hourIdx] ?? null;
 if (aqi === null) return [0, 0, 0, 0] as [number, number, number, number];
 const c = AQI_MAP_COLOR[categorizeUsAqi(aqi)];
 return [c[0], c[1], c[2], 70] as [number, number, number, number];
 },
 pickable: true,
 updateTriggers: { getFillColor: [hourIdx] },
 }));
 }

 // HMS smoke plume polygons — density-shaded gray.
 if (this.smokeOverlayPlumes.length > 0) {
 layers.push(new PolygonLayer({
 id: 'air-smoke-plume-layer',
 data: this.smokeOverlayPlumes,
 getPolygon: (d: (typeof this.smokeOverlayPlumes)[0]) => d.coordinates,
 getFillColor: (d: (typeof this.smokeOverlayPlumes)[0]) => {
 if (d.density === 'Heavy') return [90, 90, 100, 110] as [number, number, number, number];
 if (d.density === 'Medium') return [120, 120, 130, 80] as [number, number, number, number];
 return [150, 150, 160, 55] as [number, number, number, number];
 },
 stroked: false,
 pickable: true,
 }));
 }

 // NIFC active fire perimeter centroids — sized by acreage.
 if (this.smokeOverlayPerimeters.length > 0) {
 layers.push(new ScatterplotLayer({
 id: 'air-smoke-perimeter-layer',
 data: this.smokeOverlayPerimeters,
 getPosition: (d: (typeof this.smokeOverlayPerimeters)[0]) => [d.lon, d.lat],
 getRadius: (d: (typeof this.smokeOverlayPerimeters)[0]) => 4000 + Math.min((d.acres ?? 0) * 2, 60_000),
 getFillColor: [255, 69, 58, 170] as [number, number, number, number],
 getLineColor: [255, 255, 255, 200] as [number, number, number, number],
 lineWidthMinPixels: 1,
 stroked: true,
 radiusMinPixels: 4,
 radiusMaxPixels: 26,
 pickable: true,
 }));
 }

 // AQI sample dots (home + cleaner-air compass ring), EPA category colors.
 const snap = getSmokeSnapshots()[0];
 if (snap) {
 const samples: { lat: number; lon: number; aqi: number | null; label: string }[] = [
 { lat: snap.lat, lon: snap.lon, aqi: snap.current.usAqi, label: snap.placeName },
 ...snap.compass.map((c) => ({ lat: c.lat, lon: c.lon, aqi: c.avgAqi6h, label: `${c.direction} ${c.radiusMi} mi` })),
 ];
 layers.push(new ScatterplotLayer({
 id: 'air-smoke-aqi-layer',
 data: samples,
 getPosition: (d: (typeof samples)[0]) => [d.lon, d.lat],
 getRadius: 6000,
 radiusMinPixels: 5,
 radiusMaxPixels: 14,
 getFillColor: (d: (typeof samples)[0]) => AQI_MAP_COLOR[categorizeUsAqi(d.aqi)],
 getLineColor: [255, 255, 255, 220] as [number, number, number, number],
 lineWidthMinPixels: 1,
 stroked: true,
 pickable: true,
 }));
 }

 return layers;
  }

  /** Hours driving the map's smoke scrubber: the per-place Open-Meteo field
   *  when loaded, else the FireWork frame times (from the current hour on)
   *  when the WMS overlay is enabled — the scrubber works with either. */
  private smokeScrubberHours(): number[] | null {
 const field = this.smokeForecastField;
 if (field && field.hoursMs.length > 0) return field.hoursMs;
 if (this.state.layers.smokeForecast && this.fireworkState) {
 const hours = smokeForecastHoursFromNow(this.fireworkState);
 if (hours.length > 0) return hours;
 }
 return null;
  }

  /** Show/hide + sync the forecast time scrubber pinned to the map. All
   *  content is set via textContent/attributes — no HTML-string sinks. */
  private syncSmokeScrubber(show: boolean): void {
 const hours = this.smokeScrubberHours();
 if (!show || !hours) {
 this.smokeScrubberEl?.remove();
 this.smokeScrubberEl = null;
 this.smokeScrubberInput = null;
 this.smokeScrubberLabel = null;
 return;
 }
 if (!this.smokeScrubberEl) {
 const wrap = document.createElement('div');
 wrap.className = 'smoke-forecast-scrubber';
 wrap.style.cssText = 'position:absolute;bottom:14px;left:50%;transform:translateX(-50%);z-index:5;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:8px;background:var(--surface-3, rgba(15,17,22,0.82));border:1px solid var(--surface-border, rgba(255,255,255,0.14));font-size:11px;color:var(--text-primary, #e6e8ec);backdrop-filter:blur(4px);';
 const title = document.createElement('span');
 title.textContent = '💨 Forecast';
 title.style.cssText = 'font-weight:600;opacity:0.85;white-space:nowrap;';
 const input = document.createElement('input');
 input.type = 'range';
 input.min = '0';
 input.step = '1';
 input.style.width = '180px';
 input.addEventListener('input', () => {
 this.smokeForecastHourIdx = Number.parseInt(input.value, 10) || 0;
 this.updateSmokeScrubberLabel();
 this.updateLayers();
 });
 const label = document.createElement('span');
 label.style.cssText = 'min-width:110px;opacity:0.9;white-space:nowrap;';
 wrap.append(title, input, label);
 // The control must not zoom/pan the map underneath it.
 wrap.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
 wrap.addEventListener('pointerdown', (e) => e.stopPropagation());
 wrap.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
 this.container.append(wrap);
 this.smokeScrubberEl = wrap;
 this.smokeScrubberInput = input;
 this.smokeScrubberLabel = label;
 }
 if (this.smokeScrubberInput) {
 this.smokeScrubberInput.max = String(hours.length - 1);
 this.smokeScrubberInput.value = String(Math.min(this.smokeForecastHourIdx, hours.length - 1));
 }
 this.updateSmokeScrubberLabel();
  }

  private updateSmokeScrubberLabel(): void {
 const hours = this.smokeScrubberHours();
 if (!hours || !this.smokeScrubberLabel) return;
 const idx = Math.min(this.smokeForecastHourIdx, hours.length - 1);
 // "Now" only while hour 0 actually covers the present — a field kept
 // alive through an outage must not claim an aged frame is current.
 const hourIsNow = idx === 0 && Math.abs(hours[0]! - Date.now()) < 90 * 60 * 1000;
 this.smokeScrubberLabel.textContent = hourIsNow
 ? 'Now'
 : `+${idx}h · ${new Date(hours[idx]!).toLocaleString([], { weekday: 'short', hour: 'numeric' })}`;
  }

  private createIranEventsLayer(): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'iran-events-layer',
 data: this.iranEvents,
 getPosition: (d: IranEvent) => [d.longitude, d.latitude],
 getRadius: (d: IranEvent) => d.severity === 'high' ? 20_000 : (d.severity === 'medium' ? 15_000 : 10_000),
 getFillColor: (d: IranEvent) => {
 if (d.category === 'military') return [255, 50, 50, 220] as [number, number, number, number];
 if (d.category === 'politics' || d.category === 'diplomacy') return [255, 165, 0, 200] as [number, number, number, number];
 return [255, 255, 0, 180] as [number, number, number, number];
 },
 radiusMinPixels: 4,
 radiusMaxPixels: 16,
 pickable: true,
 });
  }

  private createWeatherLayer(alerts: WeatherAlert[]): IconLayer {
 const alertsWithCoords = alerts.filter(a => a.centroid?.length === 2);

 return new IconLayer({
 id: 'weather-layer',
 data: alertsWithCoords,
 getPosition: (d) => d.centroid as [number, number],
 getIcon: () => 'cloud',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: 24,
 sizeMinPixels: 14,
 sizeMaxPixels: 28,
 getColor: (d) => weatherSeverityColor(d.severity, 'icon'),
 pickable: true,
 });
  }

  /** Polygon outline + fill for each NWS alert. Until now we only
   *  drew a centroid pin, so the user couldn't see what area was
   *  covered by the alert. Filters alerts that lack polygon
   *  coordinates (some alerts ship as pure geometry-less area
   *  descriptions). */
  private createWeatherPolygonLayer(alerts: WeatherAlert[]): PolygonLayer | null {
 const polygonAlerts = alerts.filter((a) => a.coordinates?.length >= 3);
 if (polygonAlerts.length === 0) return null;

 return new PolygonLayer<WeatherAlert>({
 id: 'weather-polygons-layer',
 data: polygonAlerts,
 getPolygon: (d) => d.coordinates,
 getFillColor: (d) => weatherSeverityColor(d.severity, 'fill'),
 getLineColor: (d) => weatherSeverityColor(d.severity, 'stroke'),
 lineWidthUnits: 'pixels',
 getLineWidth: 1.5,
 stroked: true,
 filled: true,
 pickable: true,
 // Update triggers so palette color changes propagate without
 // a full layer rebuild.
 updateTriggers: {
 getFillColor: polygonAlerts.length,
 getLineColor: polygonAlerts.length,
 },
 });
  }

  private createOutagesLayer(outages: InternetOutage[]): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'outages-layer',
 data: outages,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 20_000,
 getFillColor: COLORS.outage,
 radiusMinPixels: 6,
 radiusMaxPixels: 18,
 pickable: true,
 });
  }

  private createCyberThreatsLayer(): IconLayer<CyberThreat> {
 return new IconLayer<CyberThreat>({
 id: 'cyber-threats-layer',
 data: this.cyberThreats,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: () => 'shield',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: (d) => {
 switch (d.severity) {
 case 'critical': { return 28; }
 case 'high': { return 22; }
 case 'medium': { return 18; }
 default: { return 14; }
 }
 },
 sizeMinPixels: 10,
 sizeMaxPixels: 28,
 getColor: (d) => {
 switch (d.severity) {
 case 'critical': { return [255, 61, 0, 225] as [number, number, number, number]; }
 case 'high': { return [255, 102, 0, 205] as [number, number, number, number]; }
 case 'medium': { return [255, 176, 0, 185] as [number, number, number, number]; }
 default: { return [255, 235, 59, 170] as [number, number, number, number]; }
 }
 },
 pickable: true,
 });
  }

  private createForecastOverlayLayer(regions: ForecastRegion[]): ScatterplotLayer<ForecastRegion> {
 return new ScatterplotLayer<ForecastRegion>({
 id: 'forecast-overlay-layer',
 data: regions,
 getPosition: (d) => d.center,
 // Radius in meters: convert km to meters, scale with risk
 getRadius: (d) => d.radius * 1000,
 getFillColor: (d) => riskToColor(d.riskScore),
 opacity: 1, // per-feature alpha is baked into getFillColor
 radiusMinPixels: 15,
 radiusMaxPixels: 120,
 pickable: true,
 stroked: true,
 getLineColor: (d) => {
 const [r, g, b] = riskToColor(d.riskScore);
 return [r, g, b, 200] as [number, number, number, number];
 },
 lineWidthMinPixels: 1,
 lineWidthMaxPixels: 2,
 });
  }

  private createForecastOverlayLabelLayer(regions: ForecastRegion[]): TextLayer<ForecastRegion> {
 return new TextLayer<ForecastRegion>({
 id: 'forecast-overlay-labels',
 data: regions,
 getPosition: (d) => d.center,
 getText: (d) => formatRegionLabel(d),
 getSize: 13,
 getColor: [255, 255, 255, 220],
 getAngle: 0,
 getTextAnchor: 'middle',
 getAlignmentBaseline: 'center',
 getPixelOffset: [0, -20],
 fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
 fontWeight: '600',
 outlineWidth: 3,
 outlineColor: [0, 0, 0, 180],
 pickable: false,
 billboard: true,
 sizeMinPixels: 10,
 sizeMaxPixels: 16,
 });
  }

  private createAisDensityLayer(): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'ais-density-layer',
 data: this.aisDensity,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: (d) => 4000 + d.intensity * 8000,
 getFillColor: (d) => {
 const intensity = Math.min(Math.max(d.intensity, 0.15), 1);
 const isCongested = (d.deltaPct || 0) >= 15;
 const alpha = Math.round(40 + intensity * 160);
 // Orange for congested areas, cyan for normal traffic
 if (isCongested) {
 return [255, 183, 3, alpha] as [number, number, number, number]; // #ffb703
 }
 return [0, 209, 255, alpha] as [number, number, number, number]; // #00d1ff
 },
 radiusMinPixels: 4,
 radiusMaxPixels: 12,
 pickable: true,
 });
  }

  private createGpsJammingLayer(): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'gps-jamming-layer',
 data: this.gpsJammingHexes,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: (d) => d.level === 'high' ? 15_000 : 10_000,
 getFillColor: (d) => {
 if (d.level === 'high') return [255, 80, 80, 200] as [number, number, number, number];
 return [255, 180, 50, 180] as [number, number, number, number];
 },
 radiusMinPixels: 4,
 radiusMaxPixels: 14,
 pickable: true,
 stroked: true,
 getLineColor: [255, 255, 255, 100] as [number, number, number, number],
 lineWidthMinPixels: 1,
 });
  }

  private createAisDisruptionsLayer(): ScatterplotLayer {
 // AIS spoofing/jamming events
 return new ScatterplotLayer({
 id: 'ais-disruptions-layer',
 data: this.aisDisruptions,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 12_000,
 getFillColor: (d) => {
 // Color by severity/type
 if (d.severity === 'high' || d.type === 'spoofing') {
 return [255, 50, 50, 220] as [number, number, number, number]; // Red
 }
 if (d.severity === 'medium') {
 return [255, 150, 0, 200] as [number, number, number, number]; // Orange
 }
 return [255, 200, 100, 180] as [number, number, number, number]; // Yellow
 },
 radiusMinPixels: 6,
 radiusMaxPixels: 14,
 pickable: true,
 stroked: true,
 getLineColor: [255, 255, 255, 150] as [number, number, number, number],
 lineWidthMinPixels: 1,
 });
  }

  private createAdsbLayer(): IconLayer {
 return new IconLayer({
 id: 'adsb-layer',
 data: this.adsbFlights,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: () => 'airplane',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getAngle: (d) => -(d.heading ?? 0),
 getSize: 20,
 sizeMinPixels: 8,
 sizeMaxPixels: 20,
 getColor: (d) => {
 if (d.squawk === '7700' || d.squawk === '7600' || d.squawk === '7500') return [255, 50, 50, 255];
 const [r, g, b] = altitudeToColor(d.altitude ?? 0);
 return [r, g, b, 200] as [number, number, number, number];
 },
 pickable: true,
 updateTriggers: { getColor: [this.adsbFlights] },
 });
  }

  private createAdsb3DLayer(): SimpleMeshLayer {
 const data = this.adsbFlights.slice(0, 200);
 const fallbackUrl = modelLoader.getFallbackUrl();

 return new SimpleMeshLayer({
 id: 'adsb-flights-3d',
 data,
 mesh: fallbackUrl,
 getPosition: (d: typeof this.adsbFlights[0]) => [d.lon, d.lat, (d.altitude ?? 0) * 0.3048],
 getOrientation: (d: typeof this.adsbFlights[0]) => [0, -(d.heading ?? 0), 0],
 getColor: [200, 200, 200, 200],
 sizeScale: 300,
 pickable: true,
 });
  }

  private createCableAdvisoriesLayer(advisories: CableAdvisory[]): ScatterplotLayer {
 // Cable fault/maintenance advisories
 return new ScatterplotLayer({
 id: 'cable-advisories-layer',
 data: advisories,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 10_000,
 getFillColor: (d) => {
 if (d.severity === 'fault') {
 return [255, 50, 50, 220] as [number, number, number, number]; // Red for faults
 }
 return [255, 200, 0, 200] as [number, number, number, number]; // Yellow for maintenance
 },
 radiusMinPixels: 5,
 radiusMaxPixels: 12,
 pickable: true,
 stroked: true,
 getLineColor: [0, 200, 255, 200] as [number, number, number, number], // Cyan outline (cable color)
 lineWidthMinPixels: 2,
 });
  }

  private createRepairShipsLayer(): IconLayer {
 return new IconLayer({
 id: 'repair-ships-layer',
 data: this.repairShips,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: () => 'ship',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: 18,
 sizeMinPixels: 8,
 sizeMaxPixels: 18,
 getColor: [0, 255, 200, 200] as [number, number, number, number],
 pickable: true,
 });
  }

  private createMilitaryVesselsLayer(vessels: MilitaryVessel[]): IconLayer {
 return new IconLayer({
 id: 'military-vessels-layer',
 data: vessels,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: () => 'ship',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getAngle: (d) => -(d.heading ?? 0),
 getSize: 18,
 sizeMinPixels: 8,
 sizeMaxPixels: 18,
 getColor: (d) => {
 if (d.usniSource) return [255, 160, 60, 160] as [number, number, number, number];
 return COLORS.vesselMilitary;
 },
 pickable: true,
 });
  }

  private createMilitaryVesselClustersLayer(clusters: MilitaryVesselCluster[]): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'military-vessel-clusters-layer',
 data: clusters,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: (d) => 15_000 + (d.vesselCount || 1) * 3000,
 getFillColor: (d) => {
 // Vessel types: 'exercise' | 'deployment' | 'transit' | 'unknown'
 const activity = d.activityType || 'unknown';
 if (activity === 'exercise' || activity === 'deployment') return [255, 100, 100, 200] as [number, number, number, number];
 if (activity === 'transit') return [255, 180, 100, 180] as [number, number, number, number];
 return [200, 150, 150, 160] as [number, number, number, number];
 },
 radiusMinPixels: 8,
 radiusMaxPixels: 25,
 pickable: true,
 });
  }

  private createMilitaryFlightsLayer(flights: MilitaryFlight[]): IconLayer {
 return new IconLayer({
 id: 'military-flights-layer',
 data: flights,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: () => 'fighter',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getAngle: (d) => -d.heading,
 getSize: 24,
 sizeMinPixels: 10,
 sizeMaxPixels: 24,
 getColor: (d) => {
 if (d.onGround) return [120, 120, 120, 160] as [number, number, number, number];
 if (d.operator === 'usaf' || d.operator === 'usn' || d.operator === 'usa' || d.operator === 'usmc') return [52, 211, 153, 240] as [number, number, number, number];
 if (d.operatorCountry === 'Russia') return [248, 113, 113, 240] as [number, number, number, number];
 if (d.operatorCountry === 'China') return [251, 191, 36, 240] as [number, number, number, number];
 return [129, 140, 248, 240] as [number, number, number, number];
 },
 pickable: true,
 });
  }

  private createMilitary3DFlightsLayer(flights: MilitaryFlight[]): SimpleMeshLayer {
 const data = flights.slice(0, 200);
 const fallbackUrl = modelLoader.getFallbackUrl();

 return new SimpleMeshLayer({
 id: 'military-flights-3d',
 data,
 mesh: fallbackUrl,
 getPosition: (d: MilitaryFlight) => [d.lon, d.lat, d.altitude * 0.3048],
 getOrientation: (d: MilitaryFlight) => [0, -d.heading, 0],
 getColor: (d: MilitaryFlight) => {
 if (d.operator === 'usaf' || d.operator === 'usn' || d.operator === 'usa' || d.operator === 'usmc') return [52, 211, 153, 255];
 if (d.operatorCountry === 'Russia') return [248, 113, 113, 255];
 if (d.operatorCountry === 'China') return [251, 191, 36, 255];
 return [129, 140, 248, 255];
 },
 sizeScale: 500,
 pickable: true,
 });
  }

  private createMilitaryFlightClustersLayer(clusters: MilitaryFlightCluster[]): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'military-flight-clusters-layer',
 data: clusters,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: (d) => 15_000 + (d.flightCount || 1) * 3000,
 getFillColor: (d) => {
 const activity = d.activityType || 'unknown';
 if (activity === 'exercise' || activity === 'patrol') return [100, 150, 255, 200] as [number, number, number, number];
 if (activity === 'transport') return [255, 200, 100, 180] as [number, number, number, number];
 return [150, 150, 200, 160] as [number, number, number, number];
 },
 radiusMinPixels: 8,
 radiusMaxPixels: 25,
 pickable: true,
 });
  }

  // ── Ghostly trail layers ────────────────────────────────────────────────────
  // Each track is split into N-1 segments so we can alpha-decay oldest → newest.
  // Only rendered at zoom ≥ 3.5 to keep GPU load low.

  private createMilitaryFlightTrailsLayer(flights: MilitaryFlight[]): PathLayer | null {
 interface TrailSeg { path: [[number, number], [number, number]]; alpha: number }
 const segments: TrailSeg[] = [];
 for (const f of flights) {
 const pts = f.track;
 if (!pts || pts.length < 2) continue;
 const n = pts.length;
 for (let i = 0; i < n - 1; i++) {
 // progress: 0 = oldest gap, 1 = leading edge
 const progress = (i + 1) / (n - 1);
 segments.push({ path: [pts[i]!, pts[i + 1]!], alpha: Math.round(15 + progress * 90) });
 }
 }
 if (segments.length === 0) return null;
 return new PathLayer<TrailSeg>({
 id: 'military-flight-trails-layer',
 data: segments,
 getPath: (d) => d.path,
 getColor: (d) => [255, 100, 100, d.alpha] as [number, number, number, number],
 getWidth: 1,
 widthMinPixels: 1,
 widthMaxPixels: 2,
 pickable: false,
 });
  }

  private createMilitaryVesselTrailsLayer(vessels: MilitaryVessel[]): PathLayer | null {
 interface TrailSeg { path: [[number, number], [number, number]]; alpha: number }
 const segments: TrailSeg[] = [];
 for (const v of vessels) {
 const pts = v.track;
 if (!pts || pts.length < 2) continue;
 const n = pts.length;
 for (let i = 0; i < n - 1; i++) {
 const progress = (i + 1) / (n - 1);
 segments.push({ path: [pts[i]!, pts[i + 1]!], alpha: Math.round(15 + progress * 80) });
 }
 }
 if (segments.length === 0) return null;
 return new PathLayer<TrailSeg>({
 id: 'military-vessel-trails-layer',
 data: segments,
 getPath: (d) => d.path,
 getColor: (d) => [255, 180, 60, d.alpha] as [number, number, number, number],
 getWidth: 1.5,
 widthMinPixels: 1,
 widthMaxPixels: 3,
 pickable: false,
 });
  }

  private createWaterwaysLayer(): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'waterways-layer',
 data: STRATEGIC_WATERWAYS,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 10_000,
 getFillColor: [100, 150, 255, 180] as [number, number, number, number],
 radiusMinPixels: 5,
 radiusMaxPixels: 12,
 pickable: true,
 });
  }

  private createEconomicCentersLayer(): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'economic-centers-layer',
 data: ECONOMIC_CENTERS,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 8000,
 getFillColor: [255, 215, 0, 180] as [number, number, number, number],
 radiusMinPixels: 4,
 radiusMaxPixels: 10,
 pickable: true,
 });
  }

  private createStockExchangesLayer(): IconLayer {
 return new IconLayer({
 id: 'stock-exchanges-layer',
 data: STOCK_EXCHANGES,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: () => 'chart',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: (d) => d.tier === 'mega' ? 24 : (d.tier === 'major' ? 20 : 16),
 sizeMinPixels: 10,
 sizeMaxPixels: 24,
 getColor: (d) => {
 if (d.tier === 'mega') return [255, 215, 80, 220] as [number, number, number, number];
 if (d.tier === 'major') return COLORS.stockExchange;
 return [140, 210, 255, 190] as [number, number, number, number];
 },
 pickable: true,
 });
  }

  private createFinancialCentersLayer(): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'financial-centers-layer',
 data: FINANCIAL_CENTERS,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: (d) => d.type === 'global' ? 17_000 : (d.type === 'regional' ? 13_000 : 10_000),
 getFillColor: (d) => {
 if (d.type === 'global') return COLORS.financialCenter;
 if (d.type === 'regional') return [0, 190, 130, 185] as [number, number, number, number];
 return [0, 150, 110, 165] as [number, number, number, number];
 },
 radiusMinPixels: 4,
 radiusMaxPixels: 12,
 pickable: true,
 });
  }

  private createCentralBanksLayer(): IconLayer {
 return new IconLayer({
 id: 'central-banks-layer',
 data: CENTRAL_BANKS,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: () => 'bank',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: (d) => d.type === 'supranational' ? 22 : (d.type === 'major' ? 20 : 16),
 sizeMinPixels: 8,
 sizeMaxPixels: 22,
 getColor: (d) => {
 if (d.type === 'major') return COLORS.centralBank;
 if (d.type === 'supranational') return [255, 235, 140, 220] as [number, number, number, number];
 return [235, 180, 80, 185] as [number, number, number, number];
 },
 pickable: true,
 });
  }

  private createCommodityHubsLayer(): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'commodity-hubs-layer',
 data: COMMODITY_HUBS,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: (d) => d.type === 'exchange' ? 14_000 : (d.type === 'port' ? 12_000 : 10_000),
 getFillColor: (d) => {
 if (d.type === 'exchange') return COLORS.commodityHub;
 if (d.type === 'port') return [80, 170, 255, 190] as [number, number, number, number];
 return [255, 110, 80, 185] as [number, number, number, number];
 },
 radiusMinPixels: 4,
 radiusMaxPixels: 11,
 pickable: true,
 });
  }

  private async loadAptGroups(): Promise<void> {
 const { APT_GROUPS } = await import('@/config/apt-groups');
 this.aptGroups = APT_GROUPS;
 this.aptGroupsLoaded = true;
 this.render();
  }

  private createAPTGroupsLayer(): ScatterplotLayer {
 // APT Groups - cyber threat actor markers (geopolitical variant only)
 // Made subtle to avoid visual clutter - small orange dots
 return new ScatterplotLayer({
 id: 'apt-groups-layer',
 data: this.aptGroups,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 6000,
 getFillColor: [255, 140, 0, 140] as [number, number, number, number],
 radiusMinPixels: 4,
 radiusMaxPixels: 8,
 pickable: true,
 stroked: false,
 });
  }

  private createMineralsLayer(): ScatterplotLayer {
 // Critical minerals projects
 return new ScatterplotLayer({
 id: 'minerals-layer',
 data: CRITICAL_MINERALS,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 8000,
 getFillColor: (d) => {
 // Color by mineral type
 switch (d.mineral) {
 case 'Lithium': { return [0, 200, 255, 200] as [number, number, number, number];
 } // Cyan
 case 'Cobalt': { return [100, 100, 255, 200] as [number, number, number, number];
 } // Blue
 case 'Rare Earths': { return [255, 100, 200, 200] as [number, number, number, number];
 } // Pink
 case 'Nickel': { return [100, 255, 100, 200] as [number, number, number, number];
 } // Green
 default: { return [200, 200, 200, 200] as [number, number, number, number];
 } // Gray
 }
 },
 radiusMinPixels: 5,
 radiusMaxPixels: 12,
 pickable: true,
 });
  }

  // Tech variant layers
  private createStartupHubsLayer(): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'startup-hubs-layer',
 data: STARTUP_HUBS,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 10_000,
 getFillColor: COLORS.startupHub,
 radiusMinPixels: 5,
 radiusMaxPixels: 12,
 pickable: true,
 });
  }

  private createAcceleratorsLayer(): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'accelerators-layer',
 data: ACCELERATORS,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 6000,
 getFillColor: COLORS.accelerator,
 radiusMinPixels: 3,
 radiusMaxPixels: 8,
 pickable: true,
 });
  }

  private createCloudRegionsLayer(): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'cloud-regions-layer',
 data: CLOUD_REGIONS,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 12_000,
 getFillColor: COLORS.cloudRegion,
 radiusMinPixels: 4,
 radiusMaxPixels: 12,
 pickable: true,
 });
  }

  private createProtestClusterLayers(): Layer[] {
 this.updateClusterData();
 const layers: Layer[] = [];

 layers.push(new ScatterplotLayer<MapProtestCluster>({
 id: 'protest-clusters-layer',
 data: this.protestClusters,
 getPosition: d => [d.lon, d.lat],
 getRadius: d => 15_000 + d.count * 2000,
 radiusMinPixels: 6,
 radiusMaxPixels: 22,
 getFillColor: d => {
 if (d.hasRiot) return [220, 40, 40, 200] as [number, number, number, number];
 if (d.maxSeverity === 'high') return [255, 80, 60, 180] as [number, number, number, number];
 if (d.maxSeverity === 'medium') return [255, 160, 40, 160] as [number, number, number, number];
 return [255, 220, 80, 140] as [number, number, number, number];
 },
 pickable: true,
 updateTriggers: { getRadius: this.lastSCZoom, getFillColor: this.lastSCZoom },
 }));

 const multiClusters = this.protestClusters.filter(c => c.count > 1);
 if (multiClusters.length > 0) {
 layers.push(new TextLayer<MapProtestCluster>({
 id: 'protest-clusters-badge',
 data: multiClusters,
 getText: d => String(d.count),
 getPosition: d => [d.lon, d.lat],
 background: true,
 getBackgroundColor: [0, 0, 0, 180],
 backgroundPadding: [4, 2, 4, 2],
 getColor: [255, 255, 255, 255],
 getSize: 12,
 getPixelOffset: [0, -14],
 pickable: false,
 fontFamily: 'system-ui, sans-serif',
 fontWeight: 700,
 }));
 }

 const pulseClusters = this.protestClusters.filter(c => c.maxSeverity === 'high' || c.hasRiot);
 if (pulseClusters.length > 0) {
 const pulse = 1 + 0.8 * (0.5 + 0.5 * Math.sin((this.pulseTime || Date.now()) / 400));
 layers.push(new ScatterplotLayer<MapProtestCluster>({
 id: 'protest-clusters-pulse',
 data: pulseClusters,
 getPosition: d => [d.lon, d.lat],
 getRadius: d => 15_000 + d.count * 2000,
 radiusScale: pulse,
 radiusMinPixels: 8,
 radiusMaxPixels: 30,
 stroked: true,
 filled: false,
 getLineColor: d => d.hasRiot ? [220, 40, 40, 120] as [number, number, number, number] : [255, 80, 60, 100] as [number, number, number, number],
 lineWidthMinPixels: 1.5,
 pickable: false,
 updateTriggers: { radiusScale: this.pulseTime },
 }));
 }

 return layers;
  }

  private createTechHQClusterLayers(): Layer[] {
 this.updateClusterData();
 const layers: Layer[] = [];
 const zoom = this.maplibreMap?.getZoom() || 2;

 layers.push(new ScatterplotLayer<MapTechHQCluster>({
 id: 'tech-hq-clusters-layer',
 data: this.techHQClusters,
 getPosition: d => [d.lon, d.lat],
 getRadius: d => 10_000 + d.count * 1500,
 radiusMinPixels: 5,
 radiusMaxPixels: 18,
 getFillColor: d => {
 if (d.primaryType === 'faang') return [0, 220, 120, 200] as [number, number, number, number];
 if (d.primaryType === 'unicorn') return [255, 100, 200, 180] as [number, number, number, number];
 return [80, 160, 255, 180] as [number, number, number, number];
 },
 pickable: true,
 updateTriggers: { getRadius: this.lastSCZoom },
 }));

 const multiClusters = this.techHQClusters.filter(c => c.count > 1);
 if (multiClusters.length > 0) {
 layers.push(new TextLayer<MapTechHQCluster>({
 id: 'tech-hq-clusters-badge',
 data: multiClusters,
 getText: d => String(d.count),
 getPosition: d => [d.lon, d.lat],
 background: true,
 getBackgroundColor: [0, 0, 0, 180],
 backgroundPadding: [4, 2, 4, 2],
 getColor: [255, 255, 255, 255],
 getSize: 12,
 getPixelOffset: [0, -14],
 pickable: false,
 fontFamily: 'system-ui, sans-serif',
 fontWeight: 700,
 }));
 }

 if (zoom >= 3) {
 const singles = this.techHQClusters.filter(c => c.count === 1);
 if (singles.length > 0) {
 layers.push(new TextLayer<MapTechHQCluster>({
 id: 'tech-hq-clusters-label',
 data: singles,
 getText: d => d.items[0]?.company ?? '',
 getPosition: d => [d.lon, d.lat],
 getSize: 11,
 getColor: [220, 220, 220, 200],
 getPixelOffset: [0, 12],
 pickable: false,
 fontFamily: 'system-ui, sans-serif',
 }));
 }
 }

 return layers;
  }

  private createTechEventClusterLayers(): Layer[] {
 this.updateClusterData();
 const layers: Layer[] = [];

 layers.push(new ScatterplotLayer<MapTechEventCluster>({
 id: 'tech-event-clusters-layer',
 data: this.techEventClusters,
 getPosition: d => [d.lon, d.lat],
 getRadius: d => 10_000 + d.count * 1500,
 radiusMinPixels: 5,
 radiusMaxPixels: 18,
 getFillColor: d => {
 if (d.soonestDaysUntil <= 14) return [255, 220, 50, 200] as [number, number, number, number];
 return [80, 140, 255, 180] as [number, number, number, number];
 },
 pickable: true,
 updateTriggers: { getRadius: this.lastSCZoom },
 }));

 const multiClusters = this.techEventClusters.filter(c => c.count > 1);
 if (multiClusters.length > 0) {
 layers.push(new TextLayer<MapTechEventCluster>({
 id: 'tech-event-clusters-badge',
 data: multiClusters,
 getText: d => String(d.count),
 getPosition: d => [d.lon, d.lat],
 background: true,
 getBackgroundColor: [0, 0, 0, 180],
 backgroundPadding: [4, 2, 4, 2],
 getColor: [255, 255, 255, 255],
 getSize: 12,
 getPixelOffset: [0, -14],
 pickable: false,
 fontFamily: 'system-ui, sans-serif',
 fontWeight: 700,
 }));
 }

 return layers;
  }

  private createDatacenterClusterLayers(): Layer[] {
 this.updateClusterData();
 const layers: Layer[] = [];

 layers.push(new ScatterplotLayer<MapDatacenterCluster>({
 id: 'datacenter-clusters-layer',
 data: this.datacenterClusters,
 getPosition: d => [d.lon, d.lat],
 getRadius: d => 15_000 + d.count * 2000,
 radiusMinPixels: 6,
 radiusMaxPixels: 20,
 getFillColor: d => {
 if (d.majorityExisting) return [160, 80, 255, 180] as [number, number, number, number];
 return [80, 160, 255, 180] as [number, number, number, number];
 },
 pickable: true,
 updateTriggers: { getRadius: this.lastSCZoom },
 }));

 const multiClusters = this.datacenterClusters.filter(c => c.count > 1);
 if (multiClusters.length > 0) {
 layers.push(new TextLayer<MapDatacenterCluster>({
 id: 'datacenter-clusters-badge',
 data: multiClusters,
 getText: d => String(d.count),
 getPosition: d => [d.lon, d.lat],
 background: true,
 getBackgroundColor: [0, 0, 0, 180],
 backgroundPadding: [4, 2, 4, 2],
 getColor: [255, 255, 255, 255],
 getSize: 12,
 getPixelOffset: [0, -14],
 pickable: false,
 fontFamily: 'system-ui, sans-serif',
 fontWeight: 700,
 }));
 }

 return layers;
  }

  private createHotspotsLayers(): Layer[] {
 const zoom = this.maplibreMap?.getZoom() || 2;
 const zoomScale = Math.min(1, (zoom - 1) / 3);
 const maxPx = 6 + Math.round(14 * zoomScale);
 const baseOpacity = zoom < 2.5 ? 0.5 : (zoom < 4 ? 0.7 : 1);
 const layers: Layer[] = [];

 layers.push(new ScatterplotLayer({
 id: 'hotspots-layer',
 data: this.hotspots,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: (d) => {
 const score = d.escalationScore || 1;
 return 10_000 + score * 5000;
 },
 getFillColor: (d) => {
 const score = d.escalationScore || 1;
 const a = Math.round((score >= 4 ? 200 : (score >= 2 ? 200 : 180)) * baseOpacity);
 if (score >= 4) return [255, 68, 68, a] as [number, number, number, number];
 if (score >= 2) return [255, 165, 0, a] as [number, number, number, number];
 return [255, 255, 0, a] as [number, number, number, number];
 },
 radiusMinPixels: 4,
 radiusMaxPixels: maxPx,
 pickable: true,
 stroked: true,
 getLineColor: (d) =>
 d.hasBreaking ? [255, 255, 255, 255] as [number, number, number, number] : [0, 0, 0, 0] as [number, number, number, number],
 lineWidthMinPixels: 2,
 }));

 const highHotspots = this.hotspots.filter(h => h.level === 'high' || h.hasBreaking);
 if (highHotspots.length > 0) {
 const pulse = 1 + 0.8 * (0.5 + 0.5 * Math.sin((this.pulseTime || Date.now()) / 400));
 layers.push(new ScatterplotLayer({
 id: 'hotspots-pulse',
 data: highHotspots,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: (d) => {
 const score = d.escalationScore || 1;
 return 10_000 + score * 5000;
 },
 radiusScale: pulse,
 radiusMinPixels: 6,
 radiusMaxPixels: 30,
 stroked: true,
 filled: false,
 getLineColor: (d) => {
 const a = Math.round(120 * baseOpacity);
 return d.hasBreaking ? [255, 50, 50, a] as [number, number, number, number] : [255, 165, 0, a] as [number, number, number, number];
 },
 lineWidthMinPixels: 1.5,
 pickable: false,
 updateTriggers: { radiusScale: this.pulseTime },
 }));

 // Night bloom: soft outer glow around high-severity hotspots.
 // Omitted when the user prefers reduced motion or low power mode is active.
 if (zoom >= 2.5 && !isLowPowerMode() && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
 const bloomBreath = 0.5 + 0.5 * Math.sin((this.pulseTime || Date.now()) / 1200);
 layers.push(new ScatterplotLayer({
 id: 'hotspots-bloom',
 data: highHotspots,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: (d) => {
 const score = d.escalationScore || 1;
 return (10_000 + score * 5000) * 3.5;
 },
 getFillColor: (d) => {
 const score = d.escalationScore || 1;
 const baseAlpha = Math.round((18 + score * 6) * bloomBreath * baseOpacity);
 return d.hasBreaking
 ? [255, 50, 50, baseAlpha] as [number, number, number, number]
 : [255, 140, 0, baseAlpha] as [number, number, number, number];
 },
 radiusMinPixels: 14,
 radiusMaxPixels: 80,
 stroked: false,
 filled: true,
 pickable: false,
 updateTriggers: { getFillColor: this.pulseTime },
 }));
 }
 }

 return layers;
  }

  private createGulfInvestmentsLayer(): ScatterplotLayer {
 return new ScatterplotLayer<GulfInvestment>({
 id: 'gulf-investments-layer',
 data: GULF_INVESTMENTS,
 getPosition: (d: GulfInvestment) => [d.lon, d.lat],
 getRadius: (d: GulfInvestment) => {
 if (!d.investmentUSD) return 20_000;
 if (d.investmentUSD >= 50_000) return 70_000;
 if (d.investmentUSD >= 10_000) return 55_000;
 if (d.investmentUSD >= 1000) return 40_000;
 return 25_000;
 },
 getFillColor: (d: GulfInvestment) =>
 d.investingCountry === 'SA' ? COLORS.gulfInvestmentSA : COLORS.gulfInvestmentUAE,
 getLineColor: [255, 255, 255, 80] as [number, number, number, number],
 lineWidthMinPixels: 1,
 radiusMinPixels: 5,
 radiusMaxPixels: 28,
 pickable: true,
 });
  }

  private pulseTime = 0;

  private canPulse(now = Date.now()): boolean {
 return now - this.startupTime > 60_000;
  }

  private hasRecentRiot(now = Date.now(), windowMs = 2 * 60 * 60 * 1000): boolean {
 const hasRecentClusterRiot = this.protestClusters.some(c =>
 c.hasRiot && c.latestRiotEventTimeMs != undefined && (now - c.latestRiotEventTimeMs) < windowMs
 );
 if (hasRecentClusterRiot) return true;

 // Fallback to raw protests because syncPulseAnimation can run before cluster data refreshes.
 return this.protests.some((p) => {
 if (p.eventType !== 'riot' || p.sourceType === 'gdelt') return false;
 const ts = p.time.getTime();
 return Number.isFinite(ts) && (now - ts) < windowMs;
 });
  }

  private needsPulseAnimation(now = Date.now()): boolean {
 return this.hasRecentNews(now)
 || this.hasRecentRiot(now)
 || this.hotspots.some(h => h.hasBreaking)
 || this.positiveEvents.some(e => e.count > 10)
 || this.kindnessPoints.some(p => p.type === 'real');
  }

  private syncPulseAnimation(now = Date.now()): void {
 if (this.renderPaused) {
 if (this.newsPulseIntervalId !== null) this.stopPulseAnimation();
 return;
 }
 const shouldPulse = this.canPulse(now) && this.needsPulseAnimation(now);
 if (shouldPulse && this.newsPulseIntervalId === null) {
 this.startPulseAnimation();
 } else if (!shouldPulse && this.newsPulseIntervalId !== null) {
 this.stopPulseAnimation();
 }
  }

  private startPulseAnimation(): void {
 if (this.newsPulseIntervalId !== null) return;
 // 1s is sufficient — pulse is a smooth sine wave, 500ms was imperceptibly faster
 const PULSE_UPDATE_INTERVAL_MS = 1000;

 this.newsPulseIntervalId = setInterval(() => {
 const now = Date.now();
 if (!this.needsPulseAnimation(now)) {
 this.pulseTime = now;
 this.stopPulseAnimation();
 this.rafUpdateLayers();
 return;
 }
 this.pulseTime = now;
 this.rafUpdateLayers();
 }, PULSE_UPDATE_INTERVAL_MS);
  }

  private stopPulseAnimation(): void {
 if (this.newsPulseIntervalId !== null) {
 clearInterval(this.newsPulseIntervalId);
 this.newsPulseIntervalId = null;
 }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Cable pulse — gentle sine-wave opacity animation on undersea cable layer
  // Period: 10s cycle; interval: 120ms (~8fps, imperceptible on slow motion)
  // ──────────────────────────────────────────────────────────────────────────

  private static readonly CABLE_PULSE_PERIOD_MS = 10_000;

  private startCablePulse(): void {
 if (this.cablePulseIntervalId !== null) return;
 // Use a slower interval (1s) — the pulse is a gentle 10s sine wave,
 // so 120ms updates were ~80x faster than perceptually needed.
 this.cablePulseIntervalId = setInterval(() => {
 if (this.renderPaused || this.webglLost) return;
 const TWO_PI = 2 * Math.PI;
 const period = DeckGLMap.CABLE_PULSE_PERIOD_MS;
 this.cablePulsePhase = ((Date.now() % period) / period) * TWO_PI;
 this.layerCache.delete('cables-layer');
 this.rafUpdateLayers();
 }, 1000);
  }

  private stopCablePulse(): void {
 if (this.cablePulseIntervalId !== null) {
 clearInterval(this.cablePulseIntervalId);
 this.cablePulseIntervalId = null;
 }
  }

  private createNewsLocationsLayer(): ScatterplotLayer[] {
 const zoom = this.maplibreMap?.getZoom() || 2;
 const alphaScale = zoom < 2.5 ? 0.4 : (zoom < 4 ? 0.7 : 1);
 const filteredNewsLocations = this.filterByTime(this.newsLocations, (location) => location.timestamp);
 const THREAT_RGB: Record<string, [number, number, number]> = {
 critical: [239, 68, 68],
 high: [249, 115, 22],
 medium: [234, 179, 8],
 low: [34, 197, 94],
 info: [59, 130, 246],
 };
 const THREAT_ALPHA: Record<string, number> = {
 critical: 220,
 high: 190,
 medium: 160,
 low: 120,
 info: 80,
 };

 const now = this.pulseTime || Date.now();
 const PULSE_DURATION = 30_000;

 const layers: ScatterplotLayer[] = [
 new ScatterplotLayer({
 id: 'news-locations-layer',
 data: filteredNewsLocations,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 18_000,
 getFillColor: (d) => {
 const rgb = THREAT_RGB[d.threatLevel] || [59, 130, 246];
 const a = Math.round((THREAT_ALPHA[d.threatLevel] || 120) * alphaScale);
 return [...rgb, a] as [number, number, number, number];
 },
 radiusMinPixels: 3,
 radiusMaxPixels: 12,
 pickable: true,
 }),
 ];

 const recentNews = filteredNewsLocations.filter(d => {
 const firstSeen = this.newsLocationFirstSeen.get(d.title);
 return firstSeen && (now - firstSeen) < PULSE_DURATION;
 });

 if (recentNews.length > 0) {
 const pulse = 1 + 1.5 * (0.5 + 0.5 * Math.sin(now / 318));

 layers.push(new ScatterplotLayer({
 id: 'news-pulse-layer',
 data: recentNews,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 18_000,
 radiusScale: pulse,
 radiusMinPixels: 6,
 radiusMaxPixels: 30,
 pickable: false,
 stroked: true,
 filled: false,
 getLineColor: (d) => {
 const rgb = THREAT_RGB[d.threatLevel] || [59, 130, 246];
 const firstSeen = this.newsLocationFirstSeen.get(d.title) || now;
 const age = now - firstSeen;
 const fadeOut = Math.max(0, 1 - age / PULSE_DURATION);
 const a = Math.round(150 * fadeOut * alphaScale);
 return [...rgb, a] as [number, number, number, number];
 },
 lineWidthMinPixels: 1.5,
 updateTriggers: { pulseTime: now },
 }));
 }

 return layers;
  }

  private createPositiveEventsLayers(): Layer[] {
 const layers: Layer[] = [];

 const getCategoryColor = (category: string): [number, number, number, number] => {
 switch (category) {
 case 'nature-wildlife':
 case 'humanity-kindness': {
 return [34, 197, 94, 200];
 } // green
 case 'science-health':
 case 'innovation-tech':
 case 'climate-wins': {
 return [234, 179, 8, 200];
 } // gold
 case 'culture-community': {
 return [139, 92, 246, 200];
 } // purple
 default: {
 return [34, 197, 94, 200];
 } // green default
 }
 };

 // Dot layer (tooltip on hover via getTooltip)
 layers.push(new ScatterplotLayer({
 id: 'positive-events-layer',
 data: this.positiveEvents,
 getPosition: (d: PositiveGeoEvent) => [d.lon, d.lat],
 getRadius: 12_000,
 getFillColor: (d: PositiveGeoEvent) => getCategoryColor(d.category),
 radiusMinPixels: 5,
 radiusMaxPixels: 10,
 pickable: true,
 }));

 // Gentle pulse ring for significant events (count > 8)
 const significantEvents = this.positiveEvents.filter(e => e.count > 8);
 if (significantEvents.length > 0) {
 const pulse = 1 + 0.4 * (0.5 + 0.5 * Math.sin((this.pulseTime || Date.now()) / 800));
 layers.push(new ScatterplotLayer({
 id: 'positive-events-pulse',
 data: significantEvents,
 getPosition: (d: PositiveGeoEvent) => [d.lon, d.lat],
 getRadius: 15_000,
 radiusScale: pulse,
 radiusMinPixels: 8,
 radiusMaxPixels: 24,
 stroked: true,
 filled: false,
 getLineColor: (d: PositiveGeoEvent) => getCategoryColor(d.category),
 lineWidthMinPixels: 1.5,
 pickable: false,
 updateTriggers: { radiusScale: this.pulseTime },
 }));
 }

 return layers;
  }

  private createKindnessLayers(): Layer[] {
 const layers: Layer[] = [];
 if (this.kindnessPoints.length === 0) return layers;

 // Dot layer (tooltip on hover via getTooltip)
 layers.push(new ScatterplotLayer<KindnessPoint>({
 id: 'kindness-layer',
 data: this.kindnessPoints,
 getPosition: (d: KindnessPoint) => [d.lon, d.lat],
 getRadius: 12_000,
 getFillColor: [74, 222, 128, 200] as [number, number, number, number],
 radiusMinPixels: 5,
 radiusMaxPixels: 10,
 pickable: true,
 }));

 // Pulse for real events
 const pulse = 1 + 0.4 * (0.5 + 0.5 * Math.sin((this.pulseTime || Date.now()) / 800));
 layers.push(new ScatterplotLayer<KindnessPoint>({
 id: 'kindness-pulse',
 data: this.kindnessPoints,
 getPosition: (d: KindnessPoint) => [d.lon, d.lat],
 getRadius: 14_000,
 radiusScale: pulse,
 radiusMinPixels: 6,
 radiusMaxPixels: 18,
 stroked: true,
 filled: false,
 getLineColor: [74, 222, 128, 80] as [number, number, number, number],
 lineWidthMinPixels: 1,
 pickable: false,
 updateTriggers: { radiusScale: this.pulseTime },
 }));

 return layers;
  }

  private createHappinessChoroplethLayer(): GeoJsonLayer | null {
 if (!this.countriesGeoJsonData || this.happinessScores.size === 0) return null;
 const scores = this.happinessScores;
 return new GeoJsonLayer({
 id: 'happiness-choropleth-layer',
 data: this.countriesGeoJsonData,
 filled: true,
 stroked: true,
 getFillColor: (feature: { properties?: Record<string, unknown> }) => {
 const code = feature.properties?.['ISO3166-1-Alpha-2'] as string | undefined;
 const score = code ? scores.get(code) : undefined;
 if (score == undefined) return [0, 0, 0, 0] as [number, number, number, number];
 const t = score / 10;
 return [
 Math.round(40 + (1 - t) * 180),
 Math.round(180 + t * 60),
 Math.round(40 + (1 - t) * 100),
 140,
 ] as [number, number, number, number];
 },
 getLineColor: [100, 100, 100, 60] as [number, number, number, number],
 getLineWidth: 1,
 lineWidthMinPixels: 0.5,
 pickable: true,
 updateTriggers: { getFillColor: [scores.size] },
 });
  }

  private createSpeciesRecoveryLayer(): ScatterplotLayer {
 return new ScatterplotLayer({
 id: 'species-recovery-layer',
 data: this.speciesRecoveryZones,
 getPosition: (d: (typeof this.speciesRecoveryZones)[number]) => [d.recoveryZone.lon, d.recoveryZone.lat],
 getRadius: 50_000,
 radiusMinPixels: 8,
 radiusMaxPixels: 25,
 getFillColor: [74, 222, 128, 120] as [number, number, number, number],
 stroked: true,
 getLineColor: [74, 222, 128, 200] as [number, number, number, number],
 lineWidthMinPixels: 1.5,
 pickable: true,
 });
  }

  private createRenewableInstallationsLayer(): IconLayer {
 const typeColors: Record<string, [number, number, number, number]> = {
 solar: [255, 200, 50, 200],
 wind: [100, 200, 255, 200],
 hydro: [0, 180, 180, 200],
 geothermal: [255, 150, 80, 200],
 };
 return new IconLayer({
 id: 'renewable-installations-layer',
 data: this.renewableInstallations,
 getPosition: (d: RenewableInstallation) => [d.lon, d.lat],
 getIcon: () => 'turbine',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: 20,
 sizeMinPixels: 10,
 sizeMaxPixels: 24,
 getColor: (d: RenewableInstallation) => typeColors[d.type] ?? [200, 200, 200, 200] as [number, number, number, number],
 pickable: true,
 });
  }

  private getTooltip(info: PickingInfo): { html: string } | null {
 if (!info.object) return null;

 const rawLayerId = info.layer?.id || '';
 const layerId = rawLayerId.endsWith('-ghost') ? rawLayerId.slice(0, -6) : rawLayerId;
  
 const obj = info.object as any;
 const text = (value: unknown): string => escapeHtml(String(value ?? ''));

 switch (layerId) {
 case 'hotspots-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.subtext)}</div>` };
 }
 case 'earthquakes-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>M${(obj.magnitude || 0).toFixed(1)} ${t('components.deckgl.tooltip.earthquake')}</strong><br/>${text(obj.place)}</div>` };
 }
 case 'military-vessels-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.operatorCountry)}</div>` };
 }
 case 'military-flights-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.callsign || obj.registration || t('components.deckgl.tooltip.militaryAircraft'))}</strong><br/>${text(obj.type)}</div>` };
 }
 case 'military-vessel-clusters-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name || t('components.deckgl.tooltip.vesselCluster'))}</strong><br/>${obj.vesselCount || 0} ${t('components.deckgl.tooltip.vessels')}<br/>${text(obj.activityType)}</div>` };
 }
 case 'military-flight-clusters-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name || t('components.deckgl.tooltip.flightCluster'))}</strong><br/>${obj.flightCount || 0} ${t('components.deckgl.tooltip.aircraft')}<br/>${text(obj.activityType)}</div>` };
 }
 case 'protests-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.title)}</strong><br/>${text(obj.country)}</div>` };
 }
 case 'protest-clusters-layer': {
 if (obj.count === 1) {
 const item = obj.items?.[0];
 return { html: `<div class="deckgl-tooltip"><strong>${text(item?.title || t('components.deckgl.tooltip.protest'))}</strong><br/>${text(item?.city || item?.country || '')}</div>` };
 }
 return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.tooltip.protestsCount', { count: String(obj.count) })}</strong><br/>${text(obj.country)}</div>` };
 }
 case 'tech-hq-clusters-layer': {
 if (obj.count === 1) {
 const hq = obj.items?.[0];
 return { html: `<div class="deckgl-tooltip"><strong>${text(hq?.company || '')}</strong><br/>${text(hq?.city || '')}</div>` };
 }
 return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.tooltip.techHQsCount', { count: String(obj.count) })}</strong><br/>${text(obj.city)}</div>` };
 }
 case 'tech-event-clusters-layer': {
 if (obj.count === 1) {
 const ev = obj.items?.[0];
 return { html: `<div class="deckgl-tooltip"><strong>${text(ev?.title || '')}</strong><br/>${text(ev?.location || '')}</div>` };
 }
 return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.tooltip.techEventsCount', { count: String(obj.count) })}</strong><br/>${text(obj.location)}</div>` };
 }
 case 'datacenter-clusters-layer': {
 if (obj.count === 1) {
 const dc = obj.items?.[0];
 return { html: `<div class="deckgl-tooltip"><strong>${text(dc?.name || '')}</strong><br/>${text(dc?.owner || '')}</div>` };
 }
 return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.tooltip.dataCentersCount', { count: String(obj.count) })}</strong><br/>${text(obj.country)}</div>` };
 }
 case 'air-smoke-plume-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.density)} smoke plume</strong><br/>NOAA HMS satellite analysis ${text(obj.date)}</div>` };
 }
 case 'air-smoke-perimeter-layer': {
 const acres = typeof obj.acres === 'number' ? `${Math.round(obj.acres).toLocaleString()} acres` : 'size unknown';
 const contained = typeof obj.containmentPct === 'number' ? ` · ${obj.containmentPct}% contained` : '';
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name || 'Active fire')}</strong><br/>${acres}${contained}</div>` };
 }
 case 'air-smoke-aqi-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>AQI ${obj.aqi === null ? 'n/a' : Math.round(obj.aqi)}</strong><br/>${text(obj.label)}</div>` };
 }
 case 'air-smoke-forecast-layer': {
 const field = this.smokeForecastField;
 if (!field) return null;
 const idx = Math.min(this.smokeForecastHourIdx, field.hoursMs.length - 1);
 const aqi = (obj.aqiByHour?.[idx] ?? null) as number | null;
 const when = new Date(field.hoursMs[idx]!).toLocaleString([], { weekday: 'short', hour: 'numeric' });
 return { html: `<div class="deckgl-tooltip"><strong>Forecast AQI ${aqi === null ? 'n/a' : Math.round(aqi)}</strong><br/>${text(when)}</div>` };
 }
 case 'bases-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.country)}${obj.kind ? ` · ${text(obj.kind)}` : ''}</div>` };
 }
 case 'bases-cluster-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${obj.count} bases</strong></div>` };
 }
 case 'nuclear-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.type)}</div>` };
 }
 case 'datacenters-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.owner)}</div>` };
 }
 case 'cables-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${t('components.deckgl.tooltip.underseaCable')}</div>` };
 }
 case 'pipelines-layer': {
 const pipelineType = String(obj.type || '').toLowerCase();
 const pipelineTypeLabel = pipelineType === 'oil'
 ? t('popups.pipeline.types.oil')
 : pipelineType === 'gas'
 ? t('popups.pipeline.types.gas')
 : pipelineType === 'products'
 ? t('popups.pipeline.types.products')
 : `${text(obj.type)} ${t('components.deckgl.tooltip.pipeline')}`;
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${pipelineTypeLabel}</div>` };
 }
 case 'conflict-zones-layer': {
 const props = obj.properties || obj;
 return { html: `<div class="deckgl-tooltip"><strong>${text(props.name)}</strong><br/>${t('components.deckgl.tooltip.conflictZone')}</div>` };
 }
 case 'natural-events-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.title)}</strong><br/>${text(obj.category || t('components.deckgl.tooltip.naturalEvent'))}</div>` };
 }
 case 'ais-density-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.layers.shipTraffic')}</strong><br/>${t('popups.intensity')}: ${text(obj.intensity)}</div>` };
 }
 case 'waterways-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${t('components.deckgl.layers.strategicWaterways')}</div>` };
 }
 case 'economic-centers-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.country)}</div>` };
 }
 case 'stock-exchanges-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.shortName)}</strong><br/>${text(obj.city)}, ${text(obj.country)}</div>` };
 }
 case 'financial-centers-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.type)} ${t('components.deckgl.tooltip.financialCenter')}</div>` };
 }
 case 'central-banks-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.shortName)}</strong><br/>${text(obj.city)}, ${text(obj.country)}</div>` };
 }
 case 'commodity-hubs-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.type)} · ${text(obj.city)}</div>` };
 }
 case 'startup-hubs-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.city)}</strong><br/>${text(obj.country)}</div>` };
 }
 case 'tech-hqs-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.company)}</strong><br/>${text(obj.city)}</div>` };
 }
 case 'accelerators-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.city)}</div>` };
 }
 case 'cloud-regions-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.provider)}</strong><br/>${text(obj.region)}</div>` };
 }
 case 'tech-events-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.title)}</strong><br/>${text(obj.location)}</div>` };
 }
 case 'irradiators-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.type || t('components.deckgl.layers.gammaIrradiators'))}</div>` };
 }
 case 'spaceports-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.country || t('components.deckgl.layers.spaceports'))}</div>` };
 }
 case 'ports-layer': {
 const typeIcon = obj.type === 'naval' ? '⚓' : (obj.type === 'oil' || obj.type === 'lng' ? '🛢️' : '🏭');
 return { html: `<div class="deckgl-tooltip"><strong>${typeIcon} ${text(obj.name)}</strong><br/>${text(obj.type || t('components.deckgl.tooltip.port'))} - ${text(obj.country)}</div>` };
 }
 case 'flight-delays-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)} (${text(obj.iata)})</strong><br/>${text(obj.severity)}: ${text(obj.reason)}</div>` };
 }
 case 'apt-groups-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.aka)}<br/>${t('popups.sponsor')}: ${text(obj.sponsor)}</div>` };
 }
 case 'minerals-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.mineral)} - ${text(obj.country)}<br/>${text(obj.operator)}</div>` };
 }
 case 'ais-disruptions-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>AIS ${text(obj.type || t('components.deckgl.tooltip.disruption'))}</strong><br/>${text(obj.severity)} ${t('popups.severity')}<br/>${text(obj.description)}</div>` };
 }
 case 'gps-jamming-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>GPS Jamming</strong><br/>${text(obj.level)} interference (${obj.pct}%)<br/>H3: ${text(obj.h3)}</div>` };
 }
 case 'cable-advisories-layer': {
 const cableName = UNDERSEA_CABLES.find(c => c.id === obj.cableId)?.name || obj.cableId;
 return { html: `<div class="deckgl-tooltip"><strong>${text(cableName)}</strong><br/>${text(obj.severity || t('components.deckgl.tooltip.advisory'))}<br/>${text(obj.description)}</div>` };
 }
 case 'repair-ships-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name || t('components.deckgl.tooltip.repairShip'))}</strong><br/>${text(obj.status)}</div>` };
 }
 case 'weather-layer': {
 const areaDesc = typeof obj.areaDesc === 'string' ? obj.areaDesc : '';
 const area = areaDesc ? `<br/><small>${text(areaDesc.slice(0, 50))}${areaDesc.length > 50 ? '...' : ''}</small>` : '';
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.event || t('components.deckgl.layers.weatherAlerts'))}</strong><br/>${text(obj.severity)}${area}</div>` };
 }
 case 'outages-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.asn || t('components.deckgl.tooltip.internetOutage'))}</strong><br/>${text(obj.country)}</div>` };
 }
 case 'cyber-threats-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${t('popups.cyberThreat.title')}</strong><br/>${text(obj.severity || t('components.deckgl.tooltip.medium'))} · ${text(obj.country || t('popups.unknown'))}</div>` };
 }
 case 'forecast-overlay-layer': {
 const domains = (obj.domains || []).join(', ');
 const trendLabel = obj.trend === 'rising' ? '\u2191 Rising' : obj.trend === 'falling' ? '\u2193 Falling' : '\u2192 Stable';
 return { html: `<div class="deckgl-tooltip"><strong>\u26A0 ${text(obj.label || 'Forecast Region')}</strong><br/>Risk: ${obj.riskScore}/100 ${trendLabel}<br/>Domains: ${text(domains)}</div>` };
 }
 case 'iran-events-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.layers.iranAttacks')}: ${text(obj.category || '')}</strong><br/>${text((obj.title || '').slice(0, 80))}</div>` };
 }
 case 'news-locations-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>📰 ${t('components.deckgl.tooltip.news')}</strong><br/>${text(obj.title?.slice(0, 80) || '')}</div>` };
 }
 case 'positive-events-layer': {
 const catLabel = obj.category ? obj.category.replace(/-/g, ' & ') : 'Positive Event';
 const countInfo = obj.count > 1 ? `<br/><span style="opacity:.7">${obj.count} sources reporting</span>` : '';
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/><span style="text-transform:capitalize">${text(catLabel)}</span>${countInfo}</div>` };
 }
 case 'kindness-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong></div>` };
 }
 case 'happiness-choropleth-layer': {
 const hcName = obj.properties?.name ?? 'Unknown';
 const hcCode = obj.properties?.['ISO3166-1-Alpha-2'];
 const hcScore = hcCode ? this.happinessScores.get(hcCode as string) : undefined;
 const hcScoreStr = hcScore == undefined ? 'No data' : hcScore.toFixed(1);
 return { html: `<div class="deckgl-tooltip"><strong>${text(hcName)}</strong><br/>Happiness: ${hcScoreStr}/10${hcScore == undefined ? '' : `<br/><span style="opacity:.7">${text(this.happinessSource)} (${this.happinessYear})</span>`}</div>` };
 }
 case 'species-recovery-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.commonName)}</strong><br/>${text(obj.recoveryZone?.name ?? obj.region)}<br/><span style="opacity:.7">Status: ${text(obj.recoveryStatus)}</span></div>` };
 }
 case 'renewable-installations-layer': {
 const riTypeLabel = obj.type ? String(obj.type).charAt(0).toUpperCase() + String(obj.type).slice(1) : 'Renewable';
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${riTypeLabel} &middot; ${obj.capacityMW?.toLocaleString() ?? '?'} MW<br/><span style="opacity:.7">${text(obj.country)} &middot; ${obj.year}</span></div>` };
 }
 case 'gulf-investments-layer': {
 const inv = obj as GulfInvestment;
 const flag = inv.investingCountry === 'SA' ? '🇸🇦' : '🇦🇪';
 const usd = inv.investmentUSD == undefined
 ? t('components.deckgl.tooltip.undisclosed')
 : (inv.investmentUSD >= 1000 ? `$${(inv.investmentUSD / 1000).toFixed(1)}B` : `$${inv.investmentUSD}M`);
 const stake = inv.stakePercent == undefined ? '' : `<br/>${text(String(inv.stakePercent))}% ${t('components.deckgl.tooltip.stake')}`;
 return {
 html: `<div class="deckgl-tooltip">
 <strong>${flag} ${text(inv.assetName)}</strong><br/>
 <em>${text(inv.investingEntity)}</em><br/>
 ${text(inv.targetCountry)} · ${text(inv.sector)}<br/>
 <strong>${usd}</strong>${stake}<br/>
 <span style="text-transform:capitalize">${text(inv.status)}</span>
 </div>`,
 };
 }
 case 'airstrikes-layer': {
 const fatStr = obj.fatalities > 0 ? `<br/><span style="color:#f87171">${obj.fatalities} fatalities</span>` : '';
 const actorStr = obj.actor ? `<br/><span style="opacity:.8">${text(obj.actor)}</span>` : '';
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.subEventType || obj.eventType)}</strong><br/>${text([obj.location, obj.country].filter(Boolean).join(', '))}${actorStr}${fatStr}<br/><span style="opacity:.6">${text(obj.date)}</span></div>` };
 }
 case 's2underground-layer': {
 const nameStr = obj.name ? `<strong>${text(obj.name)}</strong><br/>` : '';
 const typeStr = obj.eventType ? `<span style="opacity:.9">${text(obj.eventType)}</span><br/>` : '';
 const descStr = obj.description ? `<span style="opacity:.7;font-size:0.85em">${text(obj.description).slice(0, 200)}</span><br/>` : '';
 const dateStr = obj.date ? `<span style="opacity:.6">${text(String(obj.date))}</span>` : '';
 return { html: `<div class="deckgl-tooltip">${nameStr}${typeStr}${descStr}${dateStr}<br/><span style="opacity:.5;font-size:0.8em">S2 Underground — ${text(obj.layerTitle)}</span></div>` };
 }
 case 'faa-cameras': {
 const alertStr = obj.alertLabel ? `<br/><span style="color:#ffa03c">${text(obj.alertLabel)}</span>` : '';
 return { html: `<div class="deckgl-tooltip">&#128247; <strong>${text(obj.name)}</strong><br/>${text(obj.state)} · ${text(obj.category)}${alertStr}</div>` };
 }
 case 'adsb-layer': {
 const altFt = obj.altitude != null ? `${Math.round(obj.altitude * 3.281).toLocaleString()} ft` : '—';
 const spdKt = obj.velocity != null ? `${Math.round(obj.velocity * 1.944)} kt` : '—';
 const callsign = obj.callsign || obj.icao24;
 return { html: `<div class="deckgl-tooltip"><strong>&#9992; ${escapeHtml(callsign)}</strong><br/>${escapeHtml(obj.originCountry)}<br/>${altFt} · ${spdKt}</div>` };
 }
 case 'adsb-flights-3d': {
 const alt3d = obj.altitude != null ? `${Math.round(obj.altitude).toLocaleString()} ft` : '—';
 const spd3d = obj.velocity != null ? `${Math.round(obj.velocity * 1.944)} kt` : '—';
 const cs3d = obj.callsign || obj.icao24;
 return { html: `<div class="deckgl-tooltip"><strong>&#9992; ${escapeHtml(cs3d)}</strong><br/>${escapeHtml(obj.originCountry)}<br/>${alt3d} · ${spd3d}</div>` };
 }
 case 'military-flights-3d': {
 const milAlt = `${Math.round(obj.altitude).toLocaleString()} ft`;
 const milSpd = `${Math.round(obj.speed)} kt`;
 const milCs = obj.callsign || obj.registration || 'Military Aircraft';
 return { html: `<div class="deckgl-tooltip"><strong>&#9992; ${escapeHtml(milCs)}</strong><br/>${text(obj.operatorCountry)}${obj.aircraftModel ? ` · ${text(obj.aircraftModel)}` : ''}<br/>${milAlt} · ${milSpd}</div>` };
 }
 case 'fires-layer': {
 const frpStr = obj.frp > 0 ? `FRP: ${Math.round(obj.frp)} MW` : '';
 const confStr = obj.confidence > 0 ? `${obj.confidence}% confidence` : '';
 const details = [frpStr, confStr].filter(Boolean).join(' · ');
 const dayNight = obj.daynight === 'D' ? 'Day' : obj.daynight === 'N' ? 'Night' : '';
 return { html: `<div class="deckgl-tooltip"><strong>\uD83D\uDD25 Active Fire</strong><br/>${text(obj.region || 'Unknown region')}${obj.acq_date ? `<br/>${text(obj.acq_date)}` : ''}${dayNight ? ` · ${dayNight}` : ''}${details ? `<br/>${details}` : ''}</div>` };
 }
 case 'disease-intel-variant-dots': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.country)}</strong><br/>Active: ${(obj.active ?? 0).toLocaleString()}<br/>Today: +${(obj.todayCases ?? 0).toLocaleString()}</div>` };
 }
 case 'disease-intel-outbreak-pins': {
 return { html: `<div class="deckgl-tooltip"><strong>\u2623 Disease Outbreak</strong><br/>${obj.isAlert ? 'Alert' : 'Monitoring'}</div>` };
 }
 case 'strike-package-icons': {
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.label || 'Strike Package')}</strong><br/>${obj.aircraftCount} aircraft · ${text(obj.packageType || '')}<br/>${text(obj.description || '')}</div>` };
 }
 case 'theater-polygons-fill': {
 const trendIcon = obj.trend === 'escalating' ? '\u2191' : obj.trend === 'de-escalating' ? '\u2193' : '\u2192';
 return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>Risk: ${obj.score}/100 ${trendIcon}<br/>${text(obj.region)}</div>` };
 }
 case 'convergence-rings-inner': {
 const evTypes = (obj.types || []).join(', ');
 return { html: `<div class="deckgl-tooltip"><strong>\u26A0 Geo-Convergence</strong><br/>Score: ${obj.score}/100 · ${obj.totalEvents} events<br/>${text(evTypes)}</div>` };
 }
 case 'sigint-points-layer': {
 const sigType = String(obj.type || '').replace(/_/g, ' ');
 return { html: `<div class="deckgl-tooltip"><strong>SIGINT: ${text(sigType)}</strong><br/>${text(obj.severity)} severity<br/>${text(obj.description || '')}</div>` };
 }
 case 'sigint-cluster-layer': {
 return { html: `<div class="deckgl-tooltip"><strong>SIGINT Convergence</strong><br/>Score: ${obj.score}/100 · ${obj.events?.length ?? 0} events<br/>${text(obj.maxSeverity)} severity · ${obj.typeCount} types</div>` };
 }
 case 'lightning-strikes': {
 const kA = obj.intensity != null ? `${Math.round(obj.intensity)} kA` : '';
 const ago = obj.time ? `${Math.round((Date.now() - obj.time) / 60_000)}m ago` : '';
 return { html: `<div class="deckgl-tooltip"><strong>\u26A1 Lightning Strike</strong>${kA ? `<br/>${kA}` : ''}${ago ? `<br/>${ago}` : ''}</div>` };
 }
 case 'red-flag-warnings': {
 return { html: `<div class="deckgl-tooltip"><strong>\uD83D\uDEA9 ${text(obj.event || 'Red Flag Warning')}</strong><br/>${text(obj.areaDesc || '')}<br/>${text(obj.severity || '')}</div>` };
 }
 case 'satellite-positions': {
 const satCat = this.satelliteCatalog.find(s => s.noradId === obj.noradId);
 const satName = satCat?.name || `NORAD ${obj.noradId}`;
 const altStr = obj.altKm != null ? `${Math.round(obj.altKm).toLocaleString()} km` : '';
 const velStr = obj.velocityKmS != null ? `${obj.velocityKmS.toFixed(1)} km/s` : '';
 const classStr = satCat?.classification ? `<br/><span style="opacity:.7">${text(satCat.classification)}</span>` : '';
 return { html: `<div class="deckgl-tooltip"><strong>\uD83D\uDEF0 ${escapeHtml(satName)}</strong>${altStr || velStr ? `<br/>${[altStr, velStr].filter(Boolean).join(' · ')}` : ''}${classStr}</div>` };
 }
 default: {
 return null;
 }
 }
  }

  public setPickLocationMode(callback: ((lat: number, lon: number) => void) | null): void {
 this.onLocationPick = callback ?? undefined;
  }

  private handleClick(info: PickingInfo): void {
 if (info.coordinate && this.onLocationPick) {
 const [lon, lat] = info.coordinate as [number, number];
 this.onLocationPick(lat, lon);
 return;
 }

 if (!info.object) {
 // Empty map click → country detection
 if (info.coordinate && this.onCountryClick) {
 const [lon, lat] = info.coordinate as [number, number];
 const country = this.resolveCountryFromCoordinate(lon, lat);
 this.onCountryClick({
 lat,
 lon,
 ...(country ? { code: country.code, name: country.name } : {}),
 });
 }
 return;
 }

 const rawClickLayerId = info.layer?.id || '';
 const layerId = rawClickLayerId.endsWith('-ghost') ? rawClickLayerId.slice(0, -6) : rawClickLayerId;

 // Hotspots show popup with related news
 if (layerId === 'hotspots-layer') {
 const hotspot = info.object as Hotspot;
 const relatedNews = this.getRelatedNews(hotspot);
 this.popup.show({
 type: 'hotspot',
 data: hotspot,
 relatedNews,
 x: info.x,
 y: info.y,
 });
 this.popup.loadHotspotGdeltContext(hotspot);
 this.onHotspotClick?.(hotspot);
 return;
 }

 // Handle cluster layers with single/multi logic
 if (layerId === 'protest-clusters-layer') {
 const cluster = info.object as MapProtestCluster;
 if (cluster.items.length === 0 && cluster._clusterId != null && this.protestSC) {
 try {
 const leaves = this.protestSC.getLeaves(cluster._clusterId, DeckGLMap.MAX_CLUSTER_LEAVES);
 cluster.items = leaves.map(l => this.protestSuperclusterSource[l.properties.index]).filter((x): x is SocialUnrestEvent => !!x);
 cluster.sampled = cluster.items.length < cluster.count;
 } catch (error) {
 console.warn('[DeckGLMap] stale protest cluster', cluster._clusterId, error);
 return;
 }
 }
 if (cluster.count === 1 && cluster.items[0]) {
 this.popup.show({ type: 'protest', data: cluster.items[0], x: info.x, y: info.y });
 } else {
 this.popup.show({
 type: 'protestCluster',
 data: {
 items: cluster.items,
 country: cluster.country,
 count: cluster.count,
 riotCount: cluster.riotCount,
 highSeverityCount: cluster.highSeverityCount,
 verifiedCount: cluster.verifiedCount,
 totalFatalities: cluster.totalFatalities,
 sampled: cluster.sampled,
 },
 x: info.x,
 y: info.y,
 });
 }
 return;
 }
 if (layerId === 'tech-hq-clusters-layer') {
 const cluster = info.object as MapTechHQCluster;
 if (cluster.items.length === 0 && cluster._clusterId != null && this.techHQSC) {
 try {
 const leaves = this.techHQSC.getLeaves(cluster._clusterId, DeckGLMap.MAX_CLUSTER_LEAVES);
 cluster.items = leaves.map(l => TECH_HQS[l.properties.index]).filter(Boolean) as typeof TECH_HQS;
 cluster.sampled = cluster.items.length < cluster.count;
 } catch (error) {
 console.warn('[DeckGLMap] stale techHQ cluster', cluster._clusterId, error);
 return;
 }
 }
 if (cluster.count === 1 && cluster.items[0]) {
 this.popup.show({ type: 'techHQ', data: cluster.items[0], x: info.x, y: info.y });
 } else {
 this.popup.show({
 type: 'techHQCluster',
 data: {
 items: cluster.items,
 city: cluster.city,
 country: cluster.country,
 count: cluster.count,
 faangCount: cluster.faangCount,
 unicornCount: cluster.unicornCount,
 publicCount: cluster.publicCount,
 sampled: cluster.sampled,
 },
 x: info.x,
 y: info.y,
 });
 }
 return;
 }
 if (layerId === 'tech-event-clusters-layer') {
 const cluster = info.object as MapTechEventCluster;
 if (cluster.items.length === 0 && cluster._clusterId != null && this.techEventSC) {
 try {
 const leaves = this.techEventSC.getLeaves(cluster._clusterId, DeckGLMap.MAX_CLUSTER_LEAVES);
 cluster.items = leaves.map(l => this.techEvents[l.properties.index]).filter((x): x is TechEventMarker => !!x);
 cluster.sampled = cluster.items.length < cluster.count;
 } catch (error) {
 console.warn('[DeckGLMap] stale techEvent cluster', cluster._clusterId, error);
 return;
 }
 }
 if (cluster.count === 1 && cluster.items[0]) {
 this.popup.show({ type: 'techEvent', data: cluster.items[0], x: info.x, y: info.y });
 } else {
 this.popup.show({
 type: 'techEventCluster',
 data: {
 items: cluster.items,
 location: cluster.location,
 country: cluster.country,
 count: cluster.count,
 soonCount: cluster.soonCount,
 sampled: cluster.sampled,
 },
 x: info.x,
 y: info.y,
 });
 }
 return;
 }
 if (layerId === 'datacenter-clusters-layer') {
 const cluster = info.object as MapDatacenterCluster;
 if (cluster.items.length === 0 && cluster._clusterId != null && this.datacenterSC) {
 try {
 const leaves = this.datacenterSC.getLeaves(cluster._clusterId, DeckGLMap.MAX_CLUSTER_LEAVES);
 cluster.items = leaves.map(l => this.datacenterSCSource[l.properties.index]).filter((x): x is AIDataCenter => !!x);
 cluster.sampled = cluster.items.length < cluster.count;
 } catch (error) {
 console.warn('[DeckGLMap] stale datacenter cluster', cluster._clusterId, error);
 return;
 }
 }
 if (cluster.count === 1 && cluster.items[0]) {
 this.popup.show({ type: 'datacenter', data: cluster.items[0], x: info.x, y: info.y });
 } else {
 this.popup.show({
 type: 'datacenterCluster',
 data: {
 items: cluster.items,
 region: cluster.region || cluster.country,
 country: cluster.country,
 count: cluster.count,
 totalChips: cluster.totalChips,
 totalPowerMW: cluster.totalPowerMW,
 existingCount: cluster.existingCount,
 plannedCount: cluster.plannedCount,
 sampled: cluster.sampled,
 },
 x: info.x,
 y: info.y,
 });
 }
 return;
 }

 // Map layer IDs to popup types
 const layerToPopupType: Record<string, PopupType> = {
 'conflict-zones-layer': 'conflict',
 'bases-layer': 'base',
 'nuclear-layer': 'nuclear',
 'irradiators-layer': 'irradiator',
 'datacenters-layer': 'datacenter',
 'cables-layer': 'cable',
 'pipelines-layer': 'pipeline',
 'earthquakes-layer': 'earthquake',
 'weather-layer': 'weather',
 'outages-layer': 'outage',
 'cyber-threats-layer': 'cyberThreat',
 'iran-events-layer': 'iranEvent',
 'protests-layer': 'protest',
 'military-flights-layer': 'militaryFlight',
 'military-vessels-layer': 'militaryVessel',
 'military-vessel-clusters-layer': 'militaryVesselCluster',
 'military-flight-clusters-layer': 'militaryFlightCluster',
 'natural-events-layer': 'natEvent',
 'waterways-layer': 'waterway',
 'economic-centers-layer': 'economic',
 'stock-exchanges-layer': 'stockExchange',
 'financial-centers-layer': 'financialCenter',
 'central-banks-layer': 'centralBank',
 'commodity-hubs-layer': 'commodityHub',
 'spaceports-layer': 'spaceport',
 'ports-layer': 'port',
 'flight-delays-layer': 'flight',
 'startup-hubs-layer': 'startupHub',
 'tech-hqs-layer': 'techHQ',
 'accelerators-layer': 'accelerator',
 'cloud-regions-layer': 'cloudRegion',
 'tech-events-layer': 'techEvent',
 'apt-groups-layer': 'apt',
 'minerals-layer': 'mineral',
 'ais-disruptions-layer': 'ais',
 'gps-jamming-layer': 'gpsJamming',
 'cable-advisories-layer': 'cable-advisory',
 'repair-ships-layer': 'repair-ship',
 'faa-cameras': 'faaCamera',
 };

 const popupType = layerToPopupType[layerId];
 if (!popupType) return;

 // For GeoJSON layers, the data is in properties
 let data = info.object;
 if (layerId === 'conflict-zones-layer' && info.object.properties) {
 // Find the full conflict zone data from config
 const conflictId = info.object.properties.id;
 const fullConflict = CONFLICT_ZONES.find(c => c.id === conflictId);
 if (fullConflict) data = fullConflict;
 }

 // Enrich iran events with related events from same location
 if (popupType === 'iranEvent' && data.locationName) {
 const clickedId = data.id;
 const normalizedLoc = data.locationName.trim().toLowerCase();
 const related = this.iranEvents
 .filter(e => e.id !== clickedId && e.locationName && e.locationName.trim().toLowerCase() === normalizedLoc)
 .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
 .slice(0, 5);
 data = { ...data, relatedEvents: related };
 }

 // Get click coordinates relative to container
 const x = info.x ?? 0;
 const y = info.y ?? 0;

 this.popup.show({
 type: popupType,
 data: data,
 x,
 y,
 });
  }

  // Utility methods
  private hexToRgba(hex: string, alpha: number): [number, number, number, number] {
 const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
 if (result?.[1] && result[2] && result[3]) {
 return [
 Number.parseInt(result[1], 16),
 Number.parseInt(result[2], 16),
 Number.parseInt(result[3], 16),
 alpha,
 ];
 }
 return [100, 100, 100, alpha];
  }

  // UI Creation methods
  private createControls(): void {
 const controls = document.createElement('div');
 controls.className = 'map-controls deckgl-controls';
 controls.innerHTML = `
 <div class="zoom-controls">
 <button class="map-btn zoom-in" title="${t('components.deckgl.zoomIn')}">+</button>
 <button class="map-btn zoom-out" title="${t('components.deckgl.zoomOut')}">-</button>
 <button class="map-btn zoom-reset" title="${t('components.deckgl.resetView')}">&#8962;</button>
 </div>
 <div class="view-selector">
 <select class="view-select">
 <option value="global">${t('components.deckgl.views.global')}</option>
 <option value="america">${t('components.deckgl.views.americas')}</option>
 <option value="mena">${t('components.deckgl.views.mena')}</option>
 <option value="eu">${t('components.deckgl.views.europe')}</option>
 <option value="asia">${t('components.deckgl.views.asia')}</option>
 <option value="latam">${t('components.deckgl.views.latam')}</option>
 <option value="africa">${t('components.deckgl.views.africa')}</option>
 <option value="oceania">${t('components.deckgl.views.oceania')}</option>
 </select>
 </div>
 `;

 this.container.append(controls);

 // Bind events - use event delegation for reliability
 controls.addEventListener('click', (e) => {
 const target = e.target as HTMLElement;
 if (target.classList.contains('zoom-in')) this.zoomIn();
 else if (target.classList.contains('zoom-out')) this.zoomOut();
 else if (target.classList.contains('zoom-reset')) this.resetView();
 });

 const viewSelect = controls.querySelector('.view-select') as HTMLSelectElement;
 viewSelect.value = this.state.view;
 viewSelect.addEventListener('change', () => {
 this.setView(viewSelect.value as DeckMapView);
 });
  }

  private createTimeSlider(): void {
 const slider = document.createElement('div');
 slider.className = 'time-slider deckgl-time-slider';
 slider.innerHTML = `
 <div class="time-options">
 <button class="time-btn ${this.state.timeRange === '1h' ? 'active' : ''}" data-range="1h">1h</button>
 <button class="time-btn ${this.state.timeRange === '6h' ? 'active' : ''}" data-range="6h">6h</button>
 <button class="time-btn ${this.state.timeRange === '24h' ? 'active' : ''}" data-range="24h">24h</button>
 <button class="time-btn ${this.state.timeRange === '48h' ? 'active' : ''}" data-range="48h">48h</button>
 <button class="time-btn ${this.state.timeRange === '7d' ? 'active' : ''}" data-range="7d">7d</button>
 <button class="time-btn ${this.state.timeRange === 'all' ? 'active' : ''}" data-range="all">${t('components.deckgl.timeAll')}</button>
 </div>
 `;

 this.container.append(slider);

 slider.querySelectorAll('.time-btn').forEach(btn => {
 btn.addEventListener('click', () => {
 const range = (btn as HTMLElement).dataset.range as TimeRange;
 this.setTimeRange(range);
 });
 });
  }

  private updateTimeSliderButtons(): void {
 const slider = this.container.querySelector('.deckgl-time-slider');
 if (!slider) return;
 slider.querySelectorAll('.time-btn').forEach((btn) => {
 const range = (btn as HTMLElement).dataset.range as TimeRange | undefined;
 btn.classList.toggle('active', range === this.state.timeRange);
 });
  }

  private createLayerToggles(): void {
 const toggles = document.createElement('div');
 toggles.className = 'layer-toggles deckgl-layer-toggles';

 const layerConfig = SITE_VARIANT === 'tech'
 ? [
 { key: 'startupHubs', label: t('components.deckgl.layers.startupHubs'), icon: '&#128640;' },
 { key: 'techHQs', label: t('components.deckgl.layers.techHQs'), icon: '&#127970;' },
 { key: 'accelerators', label: t('components.deckgl.layers.accelerators'), icon: '&#9889;' },
 { key: 'cloudRegions', label: t('components.deckgl.layers.cloudRegions'), icon: '&#9729;' },
 { key: 'datacenters', label: t('components.deckgl.layers.aiDataCenters'), icon: '&#128421;' },
 { key: 'cables', label: t('components.deckgl.layers.underseaCables'), icon: '&#128268;' },
 { key: 'outages', label: t('components.deckgl.layers.internetOutages'), icon: '&#128225;' },
 { key: 'cyberThreats', label: t('components.deckgl.layers.cyberThreats'), icon: '&#128737;' },
 { key: 'techEvents', label: t('components.deckgl.layers.techEvents'), icon: '&#128197;' },
 { key: 'natural', label: t('components.deckgl.layers.naturalEvents'), icon: '&#127755;' },
 { key: 'fires', label: t('components.deckgl.layers.fires'), icon: '&#128293;' },
 { key: 'airSmoke', label: 'Air & Smoke', icon: '💨' },
 { key: 'dayNight', label: t('components.deckgl.layers.dayNight'), icon: '&#127763;' },
 ]
 : SITE_VARIANT === 'finance'
 ? [
 { key: 'stockExchanges', label: t('components.deckgl.layers.stockExchanges'), icon: '&#127963;' },
 { key: 'financialCenters', label: t('components.deckgl.layers.financialCenters'), icon: '&#128176;' },
 { key: 'centralBanks', label: t('components.deckgl.layers.centralBanks'), icon: '&#127974;' },
 { key: 'commodityHubs', label: t('components.deckgl.layers.commodityHubs'), icon: '&#128230;' },
 { key: 'gulfInvestments', label: t('components.deckgl.layers.gulfInvestments'), icon: '&#127760;' },
 { key: 'tradeRoutes', label: t('components.deckgl.layers.tradeRoutes'), icon: '&#128674;' },
 { key: 'cables', label: t('components.deckgl.layers.underseaCables'), icon: '&#128268;' },
 { key: 'pipelines', label: t('components.deckgl.layers.pipelines'), icon: '&#128738;' },
 { key: 'outages', label: t('components.deckgl.layers.internetOutages'), icon: '&#128225;' },
 { key: 'weather', label: t('components.deckgl.layers.weatherAlerts'), icon: '&#9928;' },
 { key: 'weatherRadar', label: 'Weather Radar', icon: '&#127783;' },
 { key: 'weatherSatellite', label: 'Satellite', icon: '&#128752;' },
 { key: 'lightning', label: 'Lightning', icon: '&#9889;' },
 { key: 'owmTemperature', label: 'Temperature (OWM)', icon: '&#127777;' },
 { key: 'owmPrecipitation', label: 'Precipitation (OWM)', icon: '&#9748;' },
 { key: 'owmClouds', label: 'Clouds (OWM)', icon: '&#9729;' },
 { key: 'owmWind', label: 'Wind (OWM)', icon: '&#127788;' },
 { key: 'economic', label: t('components.deckgl.layers.economicCenters'), icon: '&#128176;' },
 { key: 'waterways', label: t('components.deckgl.layers.strategicWaterways'), icon: '&#9875;' },
 { key: 'natural', label: t('components.deckgl.layers.naturalEvents'), icon: '&#127755;' },
 { key: 'cyberThreats', label: t('components.deckgl.layers.cyberThreats'), icon: '&#128737;' },
 { key: 'dayNight', label: t('components.deckgl.layers.dayNight'), icon: '&#127763;' },
 ]
 : SITE_VARIANT === 'happy'
 ? [
 { key: 'positiveEvents', label: 'Positive Events', icon: '&#127775;' },
 { key: 'kindness', label: 'Acts of Kindness', icon: '&#128154;' },
 { key: 'happiness', label: 'World Happiness', icon: '&#128522;' },
 { key: 'speciesRecovery', label: 'Species Recovery', icon: '&#128062;' },
 { key: 'renewableInstallations', label: 'Clean Energy', icon: '&#9889;' },
 ]
 : [
 { key: 'iranAttacks', label: t('components.deckgl.layers.iranAttacks'), icon: '&#127919;' },
 { key: 'hotspots', label: t('components.deckgl.layers.intelHotspots'), icon: '&#127919;' },
 { key: 'conflicts', label: t('components.deckgl.layers.conflictZones'), icon: '&#9876;' },
 { key: 'bases', label: t('components.deckgl.layers.militaryBases'), icon: '&#127963;' },
 { key: 'nuclear', label: t('components.deckgl.layers.nuclearSites'), icon: '&#9762;' },
 { key: 'irradiators', label: t('components.deckgl.layers.gammaIrradiators'), icon: '&#9888;' },
 { key: 'spaceports', label: t('components.deckgl.layers.spaceports'), icon: '&#128640;' },
 { key: 'cables', label: t('components.deckgl.layers.underseaCables'), icon: '&#128268;' },
 { key: 'pipelines', label: t('components.deckgl.layers.pipelines'), icon: '&#128738;' },
 { key: 'datacenters', label: t('components.deckgl.layers.aiDataCenters'), icon: '&#128421;' },
 { key: 'military', label: t('components.deckgl.layers.militaryActivity'), icon: '&#9992;' },
 { key: 'ais', label: t('components.deckgl.layers.shipTraffic'), icon: '&#128674;' },
 { key: 'tradeRoutes', label: t('components.deckgl.layers.tradeRoutes'), icon: '&#9875;' },
 { key: 'flights', label: t('components.deckgl.layers.flightDelays'), icon: '&#9992;' },
 { key: 'adsb', label: t('components.deckgl.layers.adsbAircraft'), icon: '&#9992;' },
 { key: 'faaWeatherCams', label: t('components.deckgl.layers.faaWeatherCams'), icon: '&#128247;' },
 { key: 'protests', label: t('components.deckgl.layers.protests'), icon: '&#128226;' },
 { key: 'ucdpEvents', label: t('components.deckgl.layers.ucdpEvents'), icon: '&#9876;' },
 { key: 's2pimu', label: t('components.deckgl.layers.s2pimu'), icon: '&#128123;' },
 { key: 'displacement', label: t('components.deckgl.layers.displacementFlows'), icon: '&#128101;' },
 { key: 'climate', label: t('components.deckgl.layers.climateAnomalies'), icon: '&#127787;' },
 { key: 'weather', label: t('components.deckgl.layers.weatherAlerts'), icon: '&#9928;' },
 { key: 'weatherRadar', label: 'Weather Radar', icon: '&#127783;' },
 { key: 'weatherSatellite', label: 'Satellite', icon: '&#128752;' },
 { key: 'lightning', label: 'Lightning', icon: '&#9889;' },
 { key: 'owmTemperature', label: 'Temperature (OWM)', icon: '&#127777;' },
 { key: 'owmPrecipitation', label: 'Precipitation (OWM)', icon: '&#9748;' },
 { key: 'owmClouds', label: 'Clouds (OWM)', icon: '&#9729;' },
 { key: 'owmWind', label: 'Wind (OWM)', icon: '&#127788;' },
 { key: 'outages', label: t('components.deckgl.layers.internetOutages'), icon: '&#128225;' },
 { key: 'cyberThreats', label: t('components.deckgl.layers.cyberThreats'), icon: '&#128737;' },
 { key: 'natural', label: t('components.deckgl.layers.naturalEvents'), icon: '&#127755;' },
 { key: 'fires', label: t('components.deckgl.layers.fires'), icon: '&#128293;' },
 { key: 'airSmoke', label: 'Air & Smoke', icon: '💨' },
 { key: 'smokeForecast', label: 'Smoke Forecast (72h)', icon: '🌫' },
 { key: 'waterways', label: t('components.deckgl.layers.strategicWaterways'), icon: '&#9875;' },
 { key: 'economic', label: t('components.deckgl.layers.economicCenters'), icon: '&#128176;' },
 { key: 'minerals', label: t('components.deckgl.layers.criticalMinerals'), icon: '&#128142;' },
 { key: 'gpsJamming', label: t('components.deckgl.layers.gpsJamming'), icon: '&#128225;' },
 { key: 'forecastOverlay', label: 'Forecast Overlay', icon: '&#9888;' },
 { key: 'dayNight', label: t('components.deckgl.layers.dayNight'), icon: '&#127763;' },
 { key: 'theaterPolygons', label: 'Theater Polygons', icon: '&#127758;' },
 { key: 'convergenceRings', label: 'Convergence Rings', icon: '&#9881;' },
 { key: 'threatHeatmap', label: 'Threat Heatmap', icon: '&#128293;' },
 { key: 'sigintConvergence', label: 'SIGINT Layer', icon: '&#128225;' },
 { key: 'displacement', label: 'Displacement Flows', icon: '&#128202;' },
 { key: 'tradeRoutes', label: 'Trade Routes', icon: '&#9875;' },
 ];

 const bm = this.activeBaseMap;
 toggles.innerHTML = `
 <div class="toggle-header">
 <span>${t('components.deckgl.layersTitle')}</span>
 <button class="layer-help-btn" title="${t('components.deckgl.layerGuide')}">?</button>
 <button class="toggle-collapse">&#9660;</button>
 </div>
 <div class="basemap-selector">
 <span class="basemap-label">Base Map</span>
 <div class="basemap-btns">
 <button class="basemap-btn${bm === 'dark' ? ' basemap-active' : ''}" data-basemap="dark">Dark</button>
 <button class="basemap-btn${bm === 'light' ? ' basemap-active' : ''}" data-basemap="light">Light</button>
 <button class="basemap-btn${bm === 'satellite' ? ' basemap-active' : ''}" data-basemap="satellite">&#127759; Satellite</button>
 <button class="basemap-btn${bm === 'terrain' ? ' basemap-active' : ''}" data-basemap="terrain">&#9968; Terrain</button>
 </div>
 </div>
 <div class="toggle-list" style="max-height: 32vh; overflow-y: auto; scrollbar-width: thin;">
 ${layerConfig.map(({ key, label, icon }) => `
 <label class="layer-toggle" data-layer="${key}">
 <input type="checkbox" ${this.state.layers[key as keyof MapLayers] ? 'checked' : ''}>
 <span class="toggle-icon">${icon}</span>
 <span class="toggle-label">${label}</span>
 </label>
 `).join('')}
 </div>
 `;

 this.container.append(toggles);

 // Bind toggle events
 toggles.querySelectorAll('.layer-toggle input').forEach(input => {
 input.addEventListener('change', () => {
 const layer = (input as HTMLInputElement).closest('.layer-toggle')?.getAttribute('data-layer') as keyof MapLayers;
 if (layer) {
 this.state.layers[layer] = (input as HTMLInputElement).checked;
 this.render();
 this.onLayerChange?.(layer, (input as HTMLInputElement).checked, 'user');
 }
 });
 });

 // Basemap selector buttons
 toggles.querySelectorAll('.basemap-btn').forEach(btn => {
 btn.addEventListener('click', () => {
 const newBasemap = btn.getAttribute('data-basemap') as BaseMapStyle;
 if (newBasemap && newBasemap !== this.activeBaseMap) {
 this.switchBasemap(newBasemap);
 toggles.querySelectorAll('.basemap-btn').forEach(b =>
 b.classList.toggle('basemap-active', b.getAttribute('data-basemap') === newBasemap),
 );
 }
 });
 });

 // Help button
 const helpBtn = toggles.querySelector('.layer-help-btn');
 helpBtn?.addEventListener('click', () => this.showLayerHelp());

 // Collapse toggle
 const collapseBtn = toggles.querySelector('.toggle-collapse');
 const toggleList = toggles.querySelector('.toggle-list');

 // Manual scroll: intercept wheel, prevent map zoom, scroll the list ourselves
 if (toggleList) {
 toggles.addEventListener('wheel', (e) => {
 e.stopPropagation();
 e.preventDefault();
 toggleList.scrollTop += e.deltaY;
 }, { passive: false });
 toggles.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false });
 }
 collapseBtn?.addEventListener('click', () => {
 toggleList?.classList.toggle('collapsed');
 if (collapseBtn) collapseBtn.innerHTML = toggleList?.classList.contains('collapsed') ? '&#9654;' : '&#9660;';
 });
  }

  /** Show layer help popup explaining each layer */
  private showLayerHelp(): void {
 const existing = this.container.querySelector('.layer-help-popup');
 if (existing) {
 existing.remove();
 return;
 }

 const popup = document.createElement('div');
 popup.className = 'layer-help-popup';

 const label = (layerKey: string): string => t(`components.deckgl.layers.${layerKey}`).toUpperCase();
 const staticLabel = (labelKey: string): string => t(`components.deckgl.layerHelp.labels.${labelKey}`).toUpperCase();
 const helpItem = (layerLabel: string, descriptionKey: string): string =>
 `<div class="layer-help-item"><span>${layerLabel}</span> ${t(`components.deckgl.layerHelp.descriptions.${descriptionKey}`)}</div>`;
 const helpSection = (titleKey: string, items: string[], noteKey?: string): string => `
 <div class="layer-help-section">
 <div class="layer-help-title">${t(`components.deckgl.layerHelp.sections.${titleKey}`)}</div>
 ${items.join('')}
 ${noteKey ? `<div class="layer-help-note">${t(`components.deckgl.layerHelp.notes.${noteKey}`)}</div>` : ''}
 </div>
 `;
 const helpHeader = `
 <div class="layer-help-header">
 <span>${t('components.deckgl.layerHelp.title')}</span>
 <button class="layer-help-close">×</button>
 </div>
 `;

 const techHelpContent = `
 ${helpHeader}
 <div class="layer-help-content">
 ${helpSection('techEcosystem', [
 helpItem(label('startupHubs'), 'techStartupHubs'),
 helpItem(label('cloudRegions'), 'techCloudRegions'),
 helpItem(label('techHQs'), 'techHQs'),
 helpItem(label('accelerators'), 'techAccelerators'),
 helpItem(label('techEvents'), 'techEvents'),
 ])}
 ${helpSection('infrastructure', [
 helpItem(label('underseaCables'), 'infraCables'),
 helpItem(label('aiDataCenters'), 'infraDatacenters'),
 helpItem(label('internetOutages'), 'infraOutages'),
 helpItem(label('cyberThreats'), 'techCyberThreats'),
 ])}
 ${helpSection('naturalEconomic', [
 helpItem(label('naturalEvents'), 'naturalEventsTech'),
 helpItem(label('fires'), 'techFires'),
 helpItem(staticLabel('countries'), 'countriesOverlay'),
 helpItem(label('dayNight'), 'dayNight'),
 ])}
 </div>
 `;

 const financeHelpContent = `
 ${helpHeader}
 <div class="layer-help-content">
 ${helpSection('financeCore', [
 helpItem(label('stockExchanges'), 'financeExchanges'),
 helpItem(label('financialCenters'), 'financeCenters'),
 helpItem(label('centralBanks'), 'financeCentralBanks'),
 helpItem(label('commodityHubs'), 'financeCommodityHubs'),
 helpItem(label('gulfInvestments'), 'financeGulfInvestments'),
 ])}
 ${helpSection('infrastructureRisk', [
 helpItem(label('underseaCables'), 'financeCables'),
 helpItem(label('pipelines'), 'financePipelines'),
 helpItem(label('internetOutages'), 'financeOutages'),
 helpItem(label('cyberThreats'), 'financeCyberThreats'),
 helpItem(label('tradeRoutes'), 'tradeRoutes'),
 ])}
 ${helpSection('macroContext', [
 helpItem(label('economicCenters'), 'economicCenters'),
 helpItem(label('strategicWaterways'), 'macroWaterways'),
 helpItem(label('weatherAlerts'), 'weatherAlertsMarket'),
 helpItem(label('naturalEvents'), 'naturalEventsMacro'),
 helpItem(label('dayNight'), 'dayNight'),
 ])}
 </div>
 `;

 const fullHelpContent = `
 ${helpHeader}
 <div class="layer-help-content">
 ${helpSection('timeFilter', [
 helpItem(staticLabel('timeRecent'), 'timeRecent'),
 helpItem(staticLabel('timeExtended'), 'timeExtended'),
 ], 'timeAffects')}
 ${helpSection('geopolitical', [
 helpItem(label('conflictZones'), 'geoConflicts'),
 helpItem(label('intelHotspots'), 'geoHotspots'),
 helpItem(staticLabel('sanctions'), 'geoSanctions'),
 helpItem(label('protests'), 'geoProtests'),
 helpItem(label('ucdpEvents'), 'geoUcdpEvents'),
 helpItem(label('displacementFlows'), 'geoDisplacement'),
 ])}
 ${helpSection('militaryStrategic', [
 helpItem(label('militaryBases'), 'militaryBases'),
 helpItem(label('nuclearSites'), 'militaryNuclear'),
 helpItem(label('gammaIrradiators'), 'militaryIrradiators'),
 helpItem(label('militaryActivity'), 'militaryActivity'),
 helpItem(label('spaceports'), 'militarySpaceports'),
 ])}
 ${helpSection('infrastructure', [
 helpItem(label('underseaCables'), 'infraCablesFull'),
 helpItem(label('pipelines'), 'infraPipelinesFull'),
 helpItem(label('internetOutages'), 'infraOutages'),
 helpItem(label('aiDataCenters'), 'infraDatacentersFull'),
 helpItem(label('cyberThreats'), 'infraCyberThreats'),
 ])}
 ${helpSection('transport', [
 helpItem(label('shipTraffic'), 'transportShipping'),
 helpItem(label('tradeRoutes'), 'tradeRoutes'),
 helpItem(label('flightDelays'), 'transportDelays'),
 helpItem(label('adsbAircraft'), 'transportAdsb'),
 ])}
 ${helpSection('naturalEconomic', [
 helpItem(label('naturalEvents'), 'naturalEventsFull'),
 helpItem(label('fires'), 'firesFull'),
 helpItem(label('weatherAlerts'), 'weatherAlerts'),
 helpItem(label('climateAnomalies'), 'climateAnomalies'),
 helpItem(label('economicCenters'), 'economicCenters'),
 helpItem(label('criticalMinerals'), 'mineralsFull'),
 ])}
 ${helpSection('overlays', [
 helpItem(label('dayNight'), 'dayNight'),
 helpItem(staticLabel('countries'), 'countriesOverlay'),
 helpItem(label('strategicWaterways'), 'waterwaysLabels'),
 ])}
 </div>
 `;

 popup.innerHTML = SITE_VARIANT === 'tech'
 ? techHelpContent
 : (SITE_VARIANT === 'finance'
 ? financeHelpContent
 : fullHelpContent);

 popup.querySelector('.layer-help-close')?.addEventListener('click', () => popup.remove());

 // Prevent scroll events from propagating to map
 const content = popup.querySelector('.layer-help-content');
 if (content) {
 content.addEventListener('wheel', (e) => e.stopPropagation(), { passive: false });
 content.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false });
 }

 // Close on click outside
 setTimeout(() => {
 const closeHandler = (e: MouseEvent) => {
 if (!popup.contains(e.target as Node)) {
 popup.remove();
 document.removeEventListener('click', closeHandler);
 }
 };
 document.addEventListener('click', closeHandler);
 }, 100);

 this.container.append(popup);
  }

  private createLegend(): void {
 const legend = document.createElement('div');
 legend.className = 'map-legend deckgl-legend';

 // SVG shapes for different marker types
 const shapes = {
 circle: (color: string) => `<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="${color}"/></svg>`,
 triangle: (color: string) => `<svg width="12" height="12" viewBox="0 0 12 12"><polygon points="6,1 11,10 1,10" fill="${color}"/></svg>`,
 square: (color: string) => `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="${color}"/></svg>`,
 hexagon: (color: string) => `<svg width="12" height="12" viewBox="0 0 12 12"><polygon points="6,1 10.5,3.5 10.5,8.5 6,11 1.5,8.5 1.5,3.5" fill="${color}"/></svg>`,
 };

 const isLight = getCurrentTheme() === 'light';
 const legendItems = SITE_VARIANT === 'tech'
 ? [
 { shape: shapes.circle(isLight ? 'rgb(22, 163, 74)' : 'rgb(0, 255, 150)'), label: t('components.deckgl.legend.startupHub') },
 { shape: shapes.circle('rgb(100, 200, 255)'), label: t('components.deckgl.legend.techHQ') },
 { shape: shapes.circle(isLight ? 'rgb(180, 120, 0)' : 'rgb(255, 200, 0)'), label: t('components.deckgl.legend.accelerator') },
 { shape: shapes.circle('rgb(150, 100, 255)'), label: t('components.deckgl.legend.cloudRegion') },
 { shape: shapes.square('rgb(136, 68, 255)'), label: t('components.deckgl.legend.datacenter') },
 ]
 : SITE_VARIANT === 'finance'
 ? [
 { shape: shapes.circle('rgb(255, 215, 80)'), label: t('components.deckgl.legend.stockExchange') },
 { shape: shapes.circle('rgb(0, 220, 150)'), label: t('components.deckgl.legend.financialCenter') },
 { shape: shapes.hexagon('rgb(255, 210, 80)'), label: t('components.deckgl.legend.centralBank') },
 { shape: shapes.square('rgb(255, 150, 80)'), label: t('components.deckgl.legend.commodityHub') },
 { shape: shapes.triangle('rgb(80, 170, 255)'), label: t('components.deckgl.legend.waterway') },
 ]
 : SITE_VARIANT === 'happy'
 ? [
 { shape: shapes.circle('rgb(34, 197, 94)'), label: 'Positive Event' },
 { shape: shapes.circle('rgb(234, 179, 8)'), label: 'Breakthrough' },
 { shape: shapes.circle('rgb(74, 222, 128)'), label: 'Act of Kindness' },
 { shape: shapes.circle('rgb(255, 100, 50)'), label: 'Natural Event' },
 { shape: shapes.square('rgb(34, 180, 100)'), label: 'Happy Country' },
 { shape: shapes.circle('rgb(74, 222, 128)'), label: 'Species Recovery Zone' },
 { shape: shapes.circle('rgb(255, 200, 50)'), label: 'Renewable Installation' },
 ]
 : [
 { shape: shapes.circle('rgb(255, 68, 68)'), label: t('components.deckgl.legend.highAlert') },
 { shape: shapes.circle('rgb(255, 165, 0)'), label: t('components.deckgl.legend.elevated') },
 { shape: shapes.circle(isLight ? 'rgb(180, 120, 0)' : 'rgb(255, 255, 0)'), label: t('components.deckgl.legend.monitoring') },
 { shape: shapes.triangle('rgb(68, 136, 255)'), label: t('components.deckgl.legend.base') },
 { shape: shapes.hexagon(isLight ? 'rgb(180, 120, 0)' : 'rgb(255, 220, 0)'), label: t('components.deckgl.legend.nuclear') },
 { shape: shapes.square('rgb(136, 68, 255)'), label: t('components.deckgl.legend.datacenter') },
 ];

 legend.innerHTML = `
 <span class="legend-label-title">${t('components.deckgl.legend.title')}</span>
 ${legendItems.map(({ shape, label }) => `<span class="legend-item">${shape}<span class="legend-label">${label}</span></span>`).join('')}
 `;

 this.container.append(legend);

 // SIGINT legend chip — only visible when the SIGINT layer is active.
 const sigintLegend = document.createElement('div');
 sigintLegend.className = 'map-legend deckgl-legend sigint-legend';
 sigintLegend.id = 'sigintLegend';
 sigintLegend.hidden = true;
 const swatch = (rgb: string, label: string): HTMLElement => {
 const item = document.createElement('span');
 item.className = 'legend-item';
 const sw = document.createElement('span');
 sw.className = 'sigint-swatch';
 sw.style.background = rgb;
 const lbl = document.createElement('span');
 lbl.className = 'legend-label';
 lbl.textContent = label;
 item.append(sw, lbl);
 return item;
 };
 const title = document.createElement('span');
 title.className = 'legend-label-title';
 title.textContent = 'SIGINT clusters';
 sigintLegend.append(
 title,
 swatch('rgb(200, 40, 255)', 'GPS jamming'),
 swatch('rgb(40, 180, 255)', 'BGP anomaly'),
 swatch('rgb(255, 140, 30)', 'Cable outage'),
 );
 this.container.append(sigintLegend);
  }

  // Public API methods (matching MapComponent interface)
  public render(): void {
 // Paused: skip. applyRenderPause() issues a fresh render() on resume, so a
 // render requested while paused is never lost.
 if (this.renderPaused) return;
 if (this.renderScheduled) return;
 this.renderScheduled = true;
 this._mapFpsAppRepaintCount++;

 requestAnimationFrame(() => {
 this.renderScheduled = false;
 this.updateLayers();
 });
  }

  /** External/manual pause (e.g. country-detail overlay covers the map). */
  public setRenderPaused(paused: boolean): void {
 this._pausedByView = paused;
 this.applyRenderPause();
  }

  /** Visibility pause — driven by the window hidden/visible state. */
  private setRenderPausedByHidden(hidden: boolean): void {
 this._pausedByHidden = hidden;
 this.applyRenderPause();
  }

  /**
   * Effective render-pause = paused by ANY reason (manual view OR window hidden),
   * so the two callers can't fight over a single boolean: resuming requires every
   * reason to clear. Only touches the timers when the effective state flips.
   */
  private applyRenderPause(): void {
 const paused = this._pausedByView || this._pausedByHidden;
 if (this.renderPaused === paused) return;
 this.renderPaused = paused;
 if (paused) {
 this.stopPulseAnimation();
 this.stopDayNightTimer();
 this.stopCablePulse();
 return;
 }

 this.syncPulseAnimation();
 if (this.state.layers.dayNight) this.startDayNightTimer();
 if (this.state.layers.cables) this.startCablePulse();
 if (this.state.layers.theaterPolygons) this.startTheaterPolygons();
 // Always refresh once on resume. Besides flushing any render deferred while
 // paused, this re-arms the alert-pulse loop: that loop is a self-scheduling
 // setTimeout chain (not a named timer), so if the window hid mid-cycle its
 // chain broke — a fresh render()→buildLayers() re-schedules it when alert
 // pulses are still active.
 this.render();
  }

  private updateLayers(): void {
 if (this.renderPaused || this.webglLost || !this.maplibreMap) return;
 const startTime = performance.now();
 try {
 this.deckOverlay?.setProps({ layers: this.buildLayers() });
 this.syncWeatherRasterLayers();
 this.syncBuildingExtrusions();
 const sigintLegend = this.container.querySelector<HTMLElement>('#sigintLegend');
 if (sigintLegend) sigintLegend.hidden = !this.state.layers.sigintConvergence;
 } catch { /* map may be mid-teardown (null.getProjection) */ }
 const elapsed = performance.now() - startTime;
 if (import.meta.env.DEV && elapsed > 16) {
 console.warn(`[DeckGLMap] updateLayers took ${elapsed.toFixed(2)}ms (>16ms budget)`);
 }
  }

  public setView(view: DeckMapView): void {
 const preset = VIEW_PRESETS[view];
 if (!preset) return;
 this.state.view = view;

 if (this.maplibreMap) {
 this.maplibreMap.flyTo({
 center: [preset.longitude, preset.latitude],
 zoom: preset.zoom,
 duration: 1000,
 });
 }

 const viewSelect = this.container.querySelector('.view-select') as HTMLSelectElement;
 if (viewSelect) viewSelect.value = view;

 this.onStateChange?.(this.state);
  }

  public setZoom(zoom: number): void {
 this.state.zoom = zoom;
 if (this.maplibreMap) {
 this.maplibreMap.setZoom(zoom);
 }
  }

  public setCenter(lat: number, lon: number, zoom?: number): void {
 if (this.maplibreMap) {
 this.maplibreMap.flyTo({
 center: [lon, lat],
 ...(zoom != undefined && { zoom }),
 duration: 500,
 });
 }
  }

  public fitCountry(code: string): void {
 const bbox = getCountryBbox(code);
 if (!bbox || !this.maplibreMap) return;
 const [minLon, minLat, maxLon, maxLat] = bbox;
 this.maplibreMap.fitBounds([[minLon, minLat], [maxLon, maxLat]], {
 padding: 40,
 duration: 800,
 maxZoom: 8,
 });
  }

  public getCenter(): { lat: number; lon: number } | null {
 if (this.maplibreMap) {
 const center = this.maplibreMap.getCenter();
 return { lat: center.lat, lon: center.lng };
 }
 return null;
  }

  /** Project a geographic coordinate to canvas pixel position (CSS pixels, unscaled). */
  public latlonToPixel(lat: number, lon: number): { x: number; y: number } | null {
 if (!this.maplibreMap) return null;
 const pt = this.maplibreMap.project([lon, lat]);
 return { x: pt.x, y: pt.y };
  }

  public setTimeRange(range: TimeRange): void {
 this.state.timeRange = range;
 this.rebuildProtestSupercluster();
 this.onTimeRangeChange?.(range);
 this.updateTimeSliderButtons();
 this.render(); // Debounced
  }

  public getTimeRange(): TimeRange {
 return this.state.timeRange;
  }

  public setLayers(layers: MapLayers): void {
 const prevCyber = this.state.layers.cyberThreats;
 this.state.layers = { ...layers };
 if (this.state.layers.cyberThreats && !prevCyber && !this.aptGroupsLoaded) this.loadAptGroups();
 this.render(); // Debounced

 // Start/stop cable pulse animation when cables layer is toggled
 if (layers.cables) {
 this.startCablePulse();
 } else {
 this.stopCablePulse();
 }

 // Update toggle checkboxes
 Object.entries(layers).forEach(([key, value]) => {
 const toggle = this.container.querySelector(`.layer-toggle[data-layer="${key}"] input`) as HTMLInputElement;
 if (toggle) toggle.checked = value;
 });
  }

  public getState(): DeckMapState {
 return { ...this.state };
  }

  // Zoom controls - public for external access
  public zoomIn(): void {
 if (this.maplibreMap) {
 this.maplibreMap.zoomIn();
 }
  }

  public zoomOut(): void {
 if (this.maplibreMap) {
 this.maplibreMap.zoomOut();
 }
  }

  private resetView(): void {
 this.setView('global');
  }

  private createUcdpEventsLayer(events: UcdpGeoEvent[]): ScatterplotLayer<UcdpGeoEvent> {
 return new ScatterplotLayer<UcdpGeoEvent>({
 id: 'ucdp-events-layer',
 data: events,
 getPosition: (d) => [d.longitude, d.latitude],
 getRadius: (d) => Math.max(4000, Math.sqrt(d.deaths_best || 1) * 3000),
 getFillColor: (d) => {
 switch (d.type_of_violence) {
 case 'state-based': { return COLORS.ucdpStateBased;
 }
 case 'non-state': { return COLORS.ucdpNonState;
 }
 case 'one-sided': { return COLORS.ucdpOneSided;
 }
 default: { return COLORS.ucdpStateBased;
 }
 }
 },
 radiusMinPixels: 3,
 radiusMaxPixels: 20,
 pickable: false,
 });
  }

  private createAirstrikesLayer(): IconLayer<AirstrikeEvent> {
 return new IconLayer<AirstrikeEvent>({
 id: 'airstrikes-layer',
 data: this.airstrikesData,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: () => 'crosshair',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: (d) => 14 + Math.sqrt(d.fatalities || 0) * 3,
 sizeMinPixels: 10,
 sizeMaxPixels: 30,
 getColor: (d) => {
 const sub = d.subEventType.toLowerCase();
 if (sub.includes('drone') || sub.includes('loiter')) return [140, 80, 255, 210];
 if (sub.includes('missile')) return [255, 100, 20, 220];
 if (sub.includes('shell') || sub.includes('artill')) return [255, 200, 30, 200];
 return [255, 40, 40, 220];
 },
 pickable: true,
 });
  }

  private createStrikePackageIconLayer(): IconLayer<StrikePackage> {
 return new IconLayer<StrikePackage>({
 id: 'strike-package-icons',
 data: this.strikePackages,
 getPosition: (d) => [d.lon, d.lat],
 getIcon: (d) => d.domain === 'naval' ? 'warship' : 'fighter',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: 28,
 sizeMinPixels: 14,
 sizeMaxPixels: 32,
 getAngle: (d) => d.domain === 'air' ? -d.heading : 0,
 getColor: (d) => d.domain === 'naval'
 ? [245, 158, 11, 240] as [number, number, number, number]
 : [59, 130, 246, 240] as [number, number, number, number],
 pickable: true,
 });
  }

  private createStrikePackageRouteLayers(): PathLayer<StrikePackage>[] {
 return this.strikePackages
 .filter(p => p.prediction.extrapolatedPath.length > 0)
 .map(p => {
 const isExpanded = p.id === this.expandedStrikePackageId;
 const path: [number, number][] = [[p.lon, p.lat], ...p.prediction.extrapolatedPath.map(([lat, lon]): [number, number] => [lon, lat])];
 return new PathLayer<StrikePackage>({
 id: `strike-route-${p.id}`,
 data: [p],
 getPath: () => path,
 getColor: p.domain === 'naval'
 ? [245, 158, 11, isExpanded ? 160 : 80]
 : [59, 130, 246, isExpanded ? 160 : 80],
 getWidth: isExpanded ? 3 : 1.5,
 widthMinPixels: 1,
 // getDashArray / dashJustified are injected by PathStyleExtension at runtime
 ...({ getDashArray: [6, 4], dashJustified: true } as Record<string, unknown>),
 extensions: [new PathStyleExtension({ dash: true })],
 });
 });
  }

  private createS2UndergroundLayer(): ScatterplotLayer<S2UndergroundEvent> {
 // Filter to high-signal events only — skip generic/routine entries that flood the map
 const HIGH_SIGNAL_TERMS = ['kinetic', 'attack', 'strike', 'military', 'base', 'installation',
 'border', 'crisis', 'threat', 'terror', 'missile', 'drone', 'convoy', 'artillery'];
 const filtered = this.s2pimuData.filter((d) => {
 const t = (d.eventType + ' ' + d.layerTitle + ' ' + d.name).toLowerCase();
 return HIGH_SIGNAL_TERMS.some(term => t.includes(term));
 });
 return new ScatterplotLayer<S2UndergroundEvent>({
 id: 's2underground-layer',
 data: filtered,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 6_000,
 getFillColor: (d) => {
 const t = (d.eventType || d.layerTitle || '').toLowerCase();
 if (t.includes('kinetic') || t.includes('attack') || t.includes('strike') || t.includes('missile') || t.includes('drone') || t.includes('artillery')) return [255, 60, 60, 220];
 if (t.includes('military') || t.includes('base') || t.includes('installation') || t.includes('convoy')) return [100, 180, 255, 200];
 if (t.includes('border') || t.includes('crisis')) return [255, 165, 0, 200];
 if (t.includes('threat') || t.includes('terror')) return [200, 40, 40, 220];
 return [180, 120, 255, 180];
 },
 radiusMinPixels: 3,
 radiusMaxPixels: 12,
 stroked: true,
 getLineColor: [255, 255, 255, 80],
 lineWidthMinPixels: 1,
 pickable: true,
 });
  }

  private createDisplacementArcsLayer(): ArcLayer<DisplacementFlow> {
 const withCoords = this.displacementFlows.filter(f => f.originLat != undefined && f.asylumLat != undefined);
 const top50 = withCoords.slice(0, 50);
 const maxCount = Math.max(1, ...top50.map(f => f.refugees));
 return new ArcLayer<DisplacementFlow>({
 id: 'displacement-arcs-layer',
 data: top50,
 getSourcePosition: (d) => [d.originLon!, d.originLat!],
 getTargetPosition: (d) => [d.asylumLon!, d.asylumLat!],
 getSourceColor: getCurrentTheme() === 'light' ? [50, 80, 180, 220] : [100, 150, 255, 180],
 getTargetColor: getCurrentTheme() === 'light' ? [20, 150, 100, 220] : [100, 255, 200, 180],
 getWidth: (d) => Math.max(1, (d.refugees / maxCount) * 8),
 widthMinPixels: 1,
 widthMaxPixels: 8,
 pickable: false,
 });
  }

  private createClimateHeatmapLayer(): HeatmapLayer<ClimateAnomaly> {
 return new HeatmapLayer<ClimateAnomaly>({
 id: 'climate-heatmap-layer',
 data: this.climateAnomalies,
 getPosition: (d) => [d.lon, d.lat],
 getWeight: (d) => Math.abs(d.tempDelta) + Math.abs(d.precipDelta) * 0.1,
 radiusPixels: 40,
 intensity: 0.6,
 threshold: 0.15,
 opacity: 0.45,
 colorRange: [
 [68, 136, 255],
 [100, 200, 255],
 [255, 255, 100],
 [255, 200, 50],
 [255, 100, 50],
 [255, 50, 50],
 ],
 pickable: false,
 });
  }

  private createTradeRoutesLayer(): ArcLayer<TradeRouteSegment> {
 const active: [number, number, number, number] = getCurrentTheme() === 'light' ? [30, 100, 180, 200] : [100, 200, 255, 160];
 const disrupted: [number, number, number, number] = getCurrentTheme() === 'light' ? [200, 40, 40, 220] : [255, 80, 80, 200];
 const highRisk: [number, number, number, number] = getCurrentTheme() === 'light' ? [200, 140, 20, 200] : [255, 180, 50, 180];
 const colorFor = (status: string): [number, number, number, number] =>
 status === 'disrupted' ? disrupted : (status === 'high_risk' ? highRisk : active);

 return new ArcLayer<TradeRouteSegment>({
 id: 'trade-routes-layer',
 data: this.tradeRouteSegments,
 getSourcePosition: (d) => d.sourcePosition,
 getTargetPosition: (d) => d.targetPosition,
 getSourceColor: (d) => colorFor(d.status),
 getTargetColor: (d) => colorFor(d.status),
 getWidth: (d) => d.category === 'energy' ? 3 : 2,
 widthMinPixels: 1,
 widthMaxPixels: 6,
 greatCircle: true,
 pickable: false,
 });
  }

  private createTradeChokepointsLayer(): ScatterplotLayer {
 const routeWaypointIds = new Set<string>();
 for (const seg of this.tradeRouteSegments) {
 const route = TRADE_ROUTES_LIST.find(r => r.id === seg.routeId);
 if (route) for (const wp of route.waypoints) routeWaypointIds.add(wp);
 }
 const chokepoints = STRATEGIC_WATERWAYS.filter(w => routeWaypointIds.has(w.id));
 const isLight = getCurrentTheme() === 'light';

 return new ScatterplotLayer({
 id: 'trade-chokepoints-layer',
 data: chokepoints,
 getPosition: (d: { lon: number; lat: number }) => [d.lon, d.lat],
 getFillColor: isLight ? [200, 140, 20, 200] : [255, 180, 50, 180],
 getLineColor: isLight ? [100, 70, 10, 255] : [255, 220, 120, 255],
 getRadius: 30_000,
 stroked: true,
 lineWidthMinPixels: 1,
 radiusMinPixels: 4,
 radiusMaxPixels: 12,
 pickable: false,
 });
  }

  /**
 * Compute the solar terminator polygon (night side of the Earth).
 * Uses standard astronomical formulas to find the subsolar point,
 * then traces the terminator line and closes around the dark pole.
 */
  private computeNightPolygon(): [number, number][] {
 const now = new Date();
 const JD = now.getTime() / 86_400_000 + 2_440_587.5;
 const D = JD - 2_451_545; // Days since J2000.0

 // Solar mean anomaly (radians)
 const g = ((357.529 + 0.985_600_28 * D) % 360) * Math.PI / 180;

 // Solar ecliptic longitude (degrees)
 const q = (280.459 + 0.985_647_36 * D) % 360;
 const L = q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
 const LRad = L * Math.PI / 180;

 // Obliquity of ecliptic (radians)
 const eRad = (23.439 - 0.000_000_36 * D) * Math.PI / 180;

 // Solar declination (radians)
 const decl = Math.asin(Math.sin(eRad) * Math.sin(LRad));

 // Solar right ascension (radians)
 const RA = Math.atan2(Math.cos(eRad) * Math.sin(LRad), Math.cos(LRad));

 // Greenwich Mean Sidereal Time (degrees)
 const GMST = ((18.697_374_558 + 24.065_709_824_419_08 * D) % 24) * 15;

 // Sub-solar longitude (degrees, normalized to [-180, 180])
 let sunLng = RA * 180 / Math.PI - GMST;
 sunLng = ((sunLng % 360) + 540) % 360 - 180;

 // Trace terminator line (1° steps for smooth curve at high zoom)
 const tanDecl = Math.tan(decl);
 const points: [number, number][] = [];

 // Near equinox (|tanDecl| ≈ 0), the terminator is nearly a great circle
 // through the poles — use a vertical line at the subsolar meridian ±90°
 if (Math.abs(tanDecl) < 1e-6) {
 for (let lat = -90; lat <= 90; lat += 1) {
 points.push([sunLng + 90, lat]);
 }
 for (let lat = 90; lat >= -90; lat -= 1) {
 points.push([sunLng - 90, lat]);
 }
 return points;
 }

 for (let lng = -180; lng <= 180; lng += 1) {
 const ha = (lng - sunLng) * Math.PI / 180;
 const lat = Math.atan(-Math.cos(ha) / tanDecl) * 180 / Math.PI;
 points.push([lng, lat]);
 }

 // Close polygon around the dark pole
 const darkPoleLat = decl > 0 ? -90 : 90;
 points.push([180, darkPoleLat], [-180, darkPoleLat]);

 return points;
  }

  private createDayNightLayer(): PolygonLayer {
 const nightPolygon = this.cachedNightPolygon ?? (this.cachedNightPolygon = this.computeNightPolygon());
 const isLight = getCurrentTheme() === 'light';

 return new PolygonLayer({
 id: 'day-night-layer',
 data: [{ polygon: nightPolygon }],
 getPolygon: (d: { polygon: [number, number][] }) => d.polygon,
 getFillColor: isLight ? [0, 0, 40, 35] : [0, 0, 20, 55],
 filled: true,
 stroked: true,
 getLineColor: isLight ? [100, 100, 100, 40] : [200, 200, 255, 25],
 getLineWidth: 1,
 lineWidthUnits: 'pixels' as const,
 pickable: false,
 });
  }

  // Data setters - all use render() for debouncing
  public setEarthquakes(earthquakes: Earthquake[]): void {
 this.earthquakes = earthquakes;
 this.render();
  }

  public setWeatherAlerts(alerts: WeatherAlert[]): void {
 this.weatherAlerts = alerts;
 this.render();
  }

  public setOutages(outages: InternetOutage[]): void {
 this.outages = outages;
 this.render();
  }

  public setCyberThreats(threats: CyberThreat[]): void {
 this.cyberThreats = threats;
 this.render();
  }

  public setAlertPulses(pulses: Array<{ id: string; lat: number; lon: number; severity: 'critical' | 'high' | 'medium' | 'low' | 'info' }>): void {
 this.alertPulses = pulses;
 this.render();
  }

  public setIranEvents(events: IranEvent[]): void {
 this.iranEvents = events;
 this.render();
  }

  public setAisData(disruptions: AisDisruptionEvent[], density: AisDensityZone[]): void {
 this.aisDisruptions = disruptions;
 this.aisDensity = density;
 this.render();
  }

  public setAdsbFlights(flights: import('@/services/adsb').AdsbFlight[]): void {
 this.adsbFlights = flights;
 this.render();
  }

  public setCableActivity(advisories: CableAdvisory[], repairShips: RepairShip[]): void {
 this.cableAdvisories = advisories;
 this.repairShips = repairShips;
 this.render();
  }

  public setCableHealth(healthMap: Record<string, CableHealthRecord>): void {
 this.healthByCableId = healthMap;
 this.layerCache.delete('cables-layer');
 this.render();
  }

  public setProtests(events: SocialUnrestEvent[]): void {
 this.protests = events;
 this.rebuildProtestSupercluster();
 this.render();
 this.syncPulseAnimation();
  }

  public setFlightDelays(delays: AirportDelayAlert[]): void {
 this.flightDelays = delays;
 this.render();
  }

  public setFAACameras(cameras: ScoredFAACamera[]): void {
 this.faaCameras = cameras;
 this.render();
  }

  public setDiseaseIntel(data: DiseaseIntelData): void {
 this.diseaseIntelData = data;
 this.diseaseIntelCountryCaseMap = new Map(
 data.covidCountries.map(c => [c.iso2, c.casesPerOneMillion])
 );
 // Lazy-load country GeoJSON once; re-use on subsequent calls
 if (this.diseaseIntelGeoJson) {
 this.render();
 } else {
 void getCountriesGeoJson().then(gj => {
 this.diseaseIntelGeoJson = gj;
 this.render();
 });
 }
  }

  public setMilitaryFlights(flights: MilitaryFlight[], clusters: MilitaryFlightCluster[] = []): void {
 this.militaryFlights = flights;
 this.militaryFlightClusters = clusters;
 this.render();
  }

  public setStrikePackages(packages: StrikePackage[]): void {
 this.strikePackages = packages;
 this.render();
  }

  public expandStrikePackage(id: string | null): void {
 this.expandedStrikePackageId = id;
 this.render();
  }

  public setMilitaryVessels(vessels: MilitaryVessel[], clusters: MilitaryVesselCluster[] = []): void {
 this.militaryVessels = vessels;
 this.militaryVesselClusters = clusters;
 this.render();
  }

  private fetchServerBases(): void {
 if (!this.maplibreMap) return;
 const mapLayers = this.state.layers;
 if (!mapLayers.bases) return;
 const zoom = this.maplibreMap.getZoom();
 if (zoom < 3) return;
 const bounds = this.maplibreMap.getBounds();
 const sw = bounds.getSouthWest();
 const ne = bounds.getNorthEast();
 fetchMilitaryBases(sw.lat, sw.lng, ne.lat, ne.lng, zoom).then((result) => {
 if (!result) return;
 this.serverBases = result.bases;
 this.serverBaseClusters = result.clusters;
 this.serverBasesLoaded = true;
 this.render();
 }).catch((error) => {
 console.error('[bases] fetch error', error);
 });
  }

  public setNaturalEvents(events: NaturalEvent[]): void {
 this.naturalEvents = events;
 this.render();
  }

  public setFires(fires: { lat: number; lon: number; brightness: number; frp: number; confidence: number; region: string; acq_date: string; daynight: string }[]): void {
 this.firmsFireData = fires;
 this.render();
  }

  public setTechEvents(events: TechEventMarker[]): void {
 this.techEvents = events;
 this.rebuildTechEventSupercluster();
 this.render();
  }

  public setUcdpEvents(events: UcdpGeoEvent[]): void {
 this.ucdpEvents = events;
 this.render();
  }

  public setAirstrikes(events: AirstrikeEvent[]): void {
 this.airstrikesData = events;
 this.render();
  }

  public setS2Underground(events: S2UndergroundEvent[]): void {
 this.s2pimuData = events;
 this.render();
  }

  public setDisplacementFlows(flows: DisplacementFlow[]): void {
 this.displacementFlows = flows;
 this.render();
  }

  public setClimateAnomalies(anomalies: ClimateAnomaly[]): void {
 this.climateAnomalies = anomalies;
 this.render();
  }

  public setGpsJamming(hexes: GpsJamHex[]): void {
 this.gpsJammingHexes = hexes;
 this.render();
  }

  public setNewsLocations(data: { lat: number; lon: number; title: string; threatLevel: string; timestamp?: Date }[]): void {
 const now = Date.now();
 for (const d of data) {
 if (!this.newsLocationFirstSeen.has(d.title)) {
 this.newsLocationFirstSeen.set(d.title, now);
 }
 }
 for (const [key, ts] of this.newsLocationFirstSeen) {
 if (now - ts > 60_000) this.newsLocationFirstSeen.delete(key);
 }
 this.newsLocations = data;
 this.render();

 this.syncPulseAnimation(now);
  }

  public setTechActivity(_activities: TechHubActivity[]): void {}

  public setOnTechHubClick(_handler: (hub: TechHubActivity) => void): void {}

  public setGeoActivity(_activities: GeoHubActivity[]): void {}

  public setOnGeoHubClick(_handler: (hub: GeoHubActivity) => void): void {}

  public setPositiveEvents(events: PositiveGeoEvent[]): void {
 this.positiveEvents = events;
 this.syncPulseAnimation();
 this.render();
  }

  public setKindnessData(points: KindnessPoint[]): void {
 this.kindnessPoints = points;
 this.syncPulseAnimation();
 this.render();
  }

  public setHappinessScores(data: HappinessData): void {
 this.happinessScores = data.scores;
 this.happinessYear = data.year;
 this.happinessSource = data.source;
 this.render();
  }

  public setSpeciesRecoveryZones(species: SpeciesRecovery[]): void {
 this.speciesRecoveryZones = species.filter(
 (s): s is SpeciesRecovery & { recoveryZone: { name: string; lat: number; lon: number } } =>
 s.recoveryZone != undefined
 );
 this.render();
  }

  public setRenewableInstallations(installations: RenewableInstallation[]): void {
 this.renewableInstallations = installations;
 this.render();
  }

  public updateHotspotActivity(news: NewsItem[]): void {
 this.news = news; // Store for related news lookup

 // Update hotspot "breaking" indicators based on recent news
 const breakingKeywords = new Set<string>();
 const recentNews = news.filter(n =>
 Date.now() - n.pubDate.getTime() < 2 * 60 * 60 * 1000 // Last 2 hours
 );

 // Count matches per hotspot for escalation tracking
 const matchCounts = new Map<string, number>();

 recentNews.forEach(item => {
 const tokens = tokenizeForMatch(item.title);
 this.hotspots.forEach(hotspot => {
 if (matchesAnyKeyword(tokens, hotspot.keywords)) {
 breakingKeywords.add(hotspot.id);
 matchCounts.set(hotspot.id, (matchCounts.get(hotspot.id) || 0) + 1);
 }
 });
 });

 this.hotspots.forEach(h => {
 h.hasBreaking = breakingKeywords.has(h.id);
 const matchCount = matchCounts.get(h.id) || 0;
 // Calculate a simple velocity metric (matches per hour normalized)
 const velocity = matchCount > 0 ? matchCount / 2 : 0; // 2 hour window
 updateHotspotEscalation(h.id, matchCount, h.hasBreaking || false, velocity);
 });

 this.render();
 this.syncPulseAnimation();
  }

  /** Get news items related to a hotspot by keyword matching */
  private getRelatedNews(hotspot: Hotspot): NewsItem[] {
 const conflictTopics = ['gaza', 'ukraine', 'ukrainian', 'russia', 'russian', 'israel', 'israeli', 'iran', 'iranian', 'china', 'chinese', 'taiwan', 'taiwanese', 'korea', 'korean', 'syria', 'syrian'];

 return this.news
 .map((item) => {
 const tokens = tokenizeForMatch(item.title);
 const matchedKeywords = findMatchingKeywords(tokens, hotspot.keywords);

 if (matchedKeywords.length === 0) return null;

 const conflictMatches = conflictTopics.filter(t =>
 matchKeyword(tokens, t) && !hotspot.keywords.some(k => k.toLowerCase().includes(t))
 );

 if (conflictMatches.length > 0) {
 const strongLocalMatch = matchedKeywords.some(kw =>
 kw.toLowerCase() === hotspot.name.toLowerCase() ||
 hotspot.agencies?.some(a => matchKeyword(tokens, a))
 );
 if (!strongLocalMatch) return null;
 }

 const score = matchedKeywords.length;
 return { item, score };
 })
 .filter((x): x is { item: NewsItem; score: number } => x !== null)
 .sort((a, b) => b.score - a.score)
 .slice(0, 5)
 .map(x => x.item);
  }

  public updateMilitaryForEscalation(flights: MilitaryFlight[], vessels: MilitaryVessel[]): void {
 setMilitaryData(flights, vessels);
  }

  public getHotspotDynamicScore(hotspotId: string) {
 return getHotspotEscalation(hotspotId);
  }

  /** Get military flight clusters for rendering/analysis */
  public getMilitaryFlightClusters(): MilitaryFlightCluster[] {
 return this.militaryFlightClusters;
  }

  /** Get military vessel clusters for rendering/analysis */
  public getMilitaryVesselClusters(): MilitaryVesselCluster[] {
 return this.militaryVesselClusters;
  }

  public highlightAssets(assets: RelatedAsset[] | null): void {
 // Clear previous highlights
 Object.values(this.highlightedAssets).forEach(set => set.clear());

 if (assets) {
 assets.forEach(asset => {
 this.highlightedAssets[asset.type].add(asset.id);
 });
 }

 this.render(); // Debounced
  }

  public setOnHotspotClick(callback: (hotspot: Hotspot) => void): void {
 this.onHotspotClick = callback;
  }

  public setOnTimeRangeChange(callback: (range: TimeRange) => void): void {
 this.onTimeRangeChange = callback;
  }

  public setOnLayerChange(callback: (layer: keyof MapLayers, enabled: boolean, source: 'user' | 'programmatic') => void): void {
 this.onLayerChange = callback;
  }

  public setOnStateChange(callback: (state: DeckMapState) => void): void {
 this.onStateChange = callback;
  }

  public getHotspotLevels(): Record<string, string> {
 const levels: Record<string, string> = {};
 this.hotspots.forEach(h => {
 levels[h.name] = h.level || 'low';
 });
 return levels;
  }

  public setHotspotLevels(levels: Record<string, string>): void {
 this.hotspots.forEach(h => {
 if (levels[h.name]) {
 h.level = levels[h.name] as 'low' | 'elevated' | 'high';
 }
 });
 setCoronaTargets(this.hotspots);
 this.render(); // Debounced
  }

  /** Trigger a wavefront ripple at a geographic point (e.g. from geo-convergence). */
  public triggerArrivalEffect(lat: number, lon: number, type: ThreatType = 'generic'): void {
 triggerWavefront(lat, lon, type);
  }

  /** Trigger a full-screen flare (e.g. on War Mode activation). */
  public triggerFlare(type: ThreatType = 'generic'): void {
 triggerGlobalFlare(type);
  }

  public initEscalationGetters(): void {
 setCIIGetter(getCountryScore);
 setGeoAlertGetter(getAlertsNearLocation);
  }

  // UI visibility methods
  public hideLayerToggle(layer: keyof MapLayers): void {
 const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"]`);
 if (toggle) (toggle as HTMLElement).style.display = 'none';
  }

  public setLayerLoading(layer: keyof MapLayers, loading: boolean): void {
 const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"]`);
 if (toggle) toggle.classList.toggle('loading', loading);
  }

  public setLayerReady(layer: keyof MapLayers, hasData: boolean): void {
 const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"]`);
 if (!toggle) return;

 toggle.classList.remove('loading');
 // Match old Map.ts behavior: set 'active' only when layer enabled AND has data
 toggle.classList.toggle('active', this.state.layers[layer] && hasData);
  }

  public flashAssets(assetType: AssetType, ids: string[]): void {
 // Temporarily highlight assets
 ids.forEach(id => this.highlightedAssets[assetType].add(id));
 this.render();

 setTimeout(() => {
 ids.forEach(id => this.highlightedAssets[assetType].delete(id));
 this.render();
 }, 3000);
  }

  // Enable layer programmatically
  public enableLayer(layer: keyof MapLayers): void {
 if (!this.state.layers[layer]) {
 this.state.layers[layer] = true;
 const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"] input`) as HTMLInputElement;
 if (toggle) toggle.checked = true;
 this.render();
 this.onLayerChange?.(layer, true, 'programmatic');
 }
  }

  // Toggle layer on/off programmatically
  public toggleLayer(layer: keyof MapLayers): void {
 this.state.layers[layer] = !this.state.layers[layer];
 const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"] input`) as HTMLInputElement;
 if (toggle) toggle.checked = this.state.layers[layer];
 this.render();
 this.onLayerChange?.(layer, this.state.layers[layer], 'programmatic');
  }

  // Get center coordinates for programmatic popup positioning
  private getContainerCenter(): { x: number; y: number } {
 const rect = this.container.getBoundingClientRect();
 return { x: rect.width / 2, y: rect.height / 2 };
  }

  // Project lat/lon to screen coordinates without moving the map
  private projectToScreen(lat: number, lon: number): { x: number; y: number } | null {
 if (!this.maplibreMap) return null;
 const point = this.maplibreMap.project([lon, lat]);
 return { x: point.x, y: point.y };
  }

  // Trigger click methods - show popup at item location without moving the map
  public triggerHotspotClick(id: string): void {
 const hotspot = this.hotspots.find(h => h.id === id);
 if (!hotspot) return;

 // Get screen position for popup
 const screenPos = this.projectToScreen(hotspot.lat, hotspot.lon);
 const { x, y } = screenPos || this.getContainerCenter();

 // Get related news and show popup
 const relatedNews = this.getRelatedNews(hotspot);
 this.popup.show({
 type: 'hotspot',
 data: hotspot,
 relatedNews,
 x,
 y,
 });
 this.popup.loadHotspotGdeltContext(hotspot);
 this.onHotspotClick?.(hotspot);
  }

  public triggerConflictClick(id: string): void {
 const conflict = CONFLICT_ZONES.find(c => c.id === id);
 if (conflict) {
 // Don't pan - show popup at projected screen position or center
 const screenPos = this.projectToScreen(conflict.center[1], conflict.center[0]);
 const { x, y } = screenPos || this.getContainerCenter();
 this.popup.show({ type: 'conflict', data: conflict, x, y });
 }
  }

  public triggerBaseClick(id: string): void {
 const base = this.serverBases.find(b => b.id === id) || MILITARY_BASES.find(b => b.id === id);
 if (base) {
 const screenPos = this.projectToScreen(base.lat, base.lon);
 const { x, y } = screenPos || this.getContainerCenter();
 this.popup.show({ type: 'base', data: base, x, y });
 }
  }

  public triggerPipelineClick(id: string): void {
 const pipeline = PIPELINES.find(p => p.id === id);
 if (pipeline && pipeline.points.length > 0) {
 const midIdx = Math.floor(pipeline.points.length / 2);
 const midPoint = pipeline.points[midIdx];
 // Don't pan - show popup at projected screen position or center
 const screenPos = midPoint ? this.projectToScreen(midPoint[1], midPoint[0]) : null;
 const { x, y } = screenPos || this.getContainerCenter();
 this.popup.show({ type: 'pipeline', data: pipeline, x, y });
 }
  }

  public triggerCableClick(id: string): void {
 const cable = UNDERSEA_CABLES.find(c => c.id === id);
 if (cable && cable.points.length > 0) {
 const midIdx = Math.floor(cable.points.length / 2);
 const midPoint = cable.points[midIdx];
 // Don't pan - show popup at projected screen position or center
 const screenPos = midPoint ? this.projectToScreen(midPoint[1], midPoint[0]) : null;
 const { x, y } = screenPos || this.getContainerCenter();
 this.popup.show({ type: 'cable', data: cable, x, y });
 }
  }

  public triggerDatacenterClick(id: string): void {
 const dc = AI_DATA_CENTERS.find(d => d.id === id);
 if (dc) {
 // Don't pan - show popup at projected screen position or center
 const screenPos = this.projectToScreen(dc.lat, dc.lon);
 const { x, y } = screenPos || this.getContainerCenter();
 this.popup.show({ type: 'datacenter', data: dc, x, y });
 }
  }

  public triggerNuclearClick(id: string): void {
 const facility = NUCLEAR_FACILITIES.find(n => n.id === id);
 if (facility) {
 // Don't pan - show popup at projected screen position or center
 const screenPos = this.projectToScreen(facility.lat, facility.lon);
 const { x, y } = screenPos || this.getContainerCenter();
 this.popup.show({ type: 'nuclear', data: facility, x, y });
 }
  }

  public triggerIrradiatorClick(id: string): void {
 const irradiator = GAMMA_IRRADIATORS.find(i => i.id === id);
 if (irradiator) {
 // Don't pan - show popup at projected screen position or center
 const screenPos = this.projectToScreen(irradiator.lat, irradiator.lon);
 const { x, y } = screenPos || this.getContainerCenter();
 this.popup.show({ type: 'irradiator', data: irradiator, x, y });
 }
  }

  public flashLocation(lat: number, lon: number, durationMs = 2000): void {
 // Don't pan - project coordinates to screen position
 const screenPos = this.projectToScreen(lat, lon);
 if (!screenPos) return;

 // Flash effect by temporarily adding a highlight at the location
 const flashMarker = document.createElement('div');
 flashMarker.className = 'flash-location-marker';
 flashMarker.style.cssText = `
 position: absolute;
 width: 40px;
 height: 40px;
 border-radius: 50%;
 background: rgba(255, 255, 255, 0.5);
 border: 2px solid #fff;
 animation: flash-pulse 0.5s ease-out infinite;
 pointer-events: none;
 z-index: 1000;
 left: ${screenPos.x}px;
 top: ${screenPos.y}px;
 transform: translate(-50%, -50%);
 `;

 // Add animation keyframes if not present
 if (!document.getElementById('flash-animation-styles')) {
 const style = document.createElement('style');
 style.id = 'flash-animation-styles';
 style.textContent = `
 @keyframes flash-pulse {
 0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
 100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
 }
 `;
 document.head.append(style);
 }

 const wrapper = this.container.querySelector('.deckgl-map-wrapper');
 if (wrapper) {
 wrapper.append(flashMarker);
 setTimeout(() => flashMarker.remove(), durationMs);
 }
  }

  // --- Country click + highlight ---

  public setOnCountryClick(cb: (country: CountryClickPayload) => void): void {
 this.onCountryClick = cb;
  }

  private resolveCountryFromCoordinate(lon: number, lat: number): { code: string; name: string } | null {
 const fromGeometry = getCountryAtCoordinates(lat, lon);
 if (fromGeometry) return fromGeometry;
 if (!this.maplibreMap || !this.countryGeoJsonLoaded) return null;
 try {
 const point = this.maplibreMap.project([lon, lat]);
 const features = this.maplibreMap.queryRenderedFeatures(point, { layers: ['country-interactive'] });
 const properties = (features?.[0]?.properties ?? {}) as Record<string, unknown>;
 const code = typeof properties['ISO3166-1-Alpha-2'] === 'string'
 ? properties['ISO3166-1-Alpha-2'].trim().toUpperCase()
 : '';
 const name = typeof properties.name === 'string'
 ? properties.name.trim()
 : '';
 if (!code || !name) return null;
 return { code, name };
 } catch {
 return null;
 }
  }

  private loadCountryBoundaries(): void {
 if (!this.maplibreMap || this.countryGeoJsonLoaded) return;
 this.countryGeoJsonLoaded = true;

 getCountriesGeoJson()
 .then((geojson) => {
 if (!this.maplibreMap || !geojson) return;
 this.countriesGeoJsonData = geojson;
 // Guard each add: rapid basemap switches reset countryGeoJsonLoaded
 // synchronously, so two loads can race past the entry guard and both
 // reach here after the await — re-adding throws "already a source/layer".
 if (!this.maplibreMap.getSource('country-boundaries')) {
 this.maplibreMap.addSource('country-boundaries', {
 type: 'geojson',
 data: geojson,
 });
 }
 if (!this.maplibreMap.getLayer('country-interactive')) {
 this.maplibreMap.addLayer({
 id: 'country-interactive',
 type: 'fill',
 source: 'country-boundaries',
 paint: {
 'fill-color': '#3b82f6',
 'fill-opacity': 0,
 },
 });
 }
 if (!this.maplibreMap.getLayer('country-hover-fill')) {
 this.maplibreMap.addLayer({
 id: 'country-hover-fill',
 type: 'fill',
 source: 'country-boundaries',
 paint: {
 'fill-color': '#3b82f6',
 'fill-opacity': 0.06,
 },
 filter: ['==', ['get', 'name'], ''],
 });
 }
 if (!this.maplibreMap.getLayer('country-highlight-fill')) {
 this.maplibreMap.addLayer({
 id: 'country-highlight-fill',
 type: 'fill',
 source: 'country-boundaries',
 paint: {
 'fill-color': '#3b82f6',
 'fill-opacity': 0.12,
 },
 filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
 });
 }
 if (!this.maplibreMap.getLayer('country-highlight-border')) {
 this.maplibreMap.addLayer({
 id: 'country-highlight-border',
 type: 'line',
 source: 'country-boundaries',
 paint: {
 'line-color': '#3b82f6',
 'line-width': 1.5,
 'line-opacity': 0.5,
 },
 filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
 });
 }

 if (!this.countryHoverSetup) this.setupCountryHover();
 this.updateCountryLayerPaint(getCurrentTheme());
 if (this.highlightedCountryCode) this.highlightCountry(this.highlightedCountryCode);
 })
 .catch((error) => console.warn('[DeckGLMap] Failed to load country boundaries:', error));
  }

  private setupCountryHover(): void {
 if (!this.maplibreMap || this.countryHoverSetup) return;
 this.countryHoverSetup = true;
 const map = this.maplibreMap;
 let hoveredName: string | null = null;

 map.on('mousemove', (e) => {
 if (!this.onCountryClick) return;
 const features = map.queryRenderedFeatures(e.point, { layers: ['country-interactive'] });
 const name = features?.[0]?.properties?.name as string | undefined;

 try {
 if (name && name !== hoveredName) {
 hoveredName = name;
 map.setFilter('country-hover-fill', ['==', ['get', 'name'], name]);
 map.getCanvas().style.cursor = 'pointer';
 } else if (!name && hoveredName) {
 hoveredName = null;
 map.setFilter('country-hover-fill', ['==', ['get', 'name'], '']);
 map.getCanvas().style.cursor = '';
 }
 } catch { /* style not done loading during theme switch */ }
 });

 map.on('mouseout', () => {
 if (hoveredName) {
 hoveredName = null;
 try {
 map.setFilter('country-hover-fill', ['==', ['get', 'name'], '']);
 } catch { /* style not done loading */ }
 map.getCanvas().style.cursor = '';
 }
 });
  }

  public highlightCountry(code: string): void {
 this.highlightedCountryCode = code;
 if (!this.maplibreMap || !this.countryGeoJsonLoaded) return;
 const filter = ['==', ['get', 'ISO3166-1-Alpha-2'], code] as maplibregl.FilterSpecification;
 try {
 this.maplibreMap.setFilter('country-highlight-fill', filter);
 this.maplibreMap.setFilter('country-highlight-border', filter);
 } catch { /* layer not ready yet */ }
  }

  public clearCountryHighlight(): void {
 this.highlightedCountryCode = null;
 if (!this.maplibreMap) return;
 const noMatch = ['==', ['get', 'ISO3166-1-Alpha-2'], ''] as maplibregl.FilterSpecification;
 try {
 this.maplibreMap.setFilter('country-highlight-fill', noMatch);
 this.maplibreMap.setFilter('country-highlight-border', noMatch);
 } catch { /* layer not ready */ }
  }

  private applyDarkMapEnhancements(): void {
 if (!this.maplibreMap || this.activeBaseMap !== 'dark') return;
 // The hillshade DEM expects a vector style with symbol layers underneath
 // for the hillshade to overlay through. Our self-hosted dark.json is a
 // raster-only style (single CARTO tile layer), so adding a hillshade on
 // top occludes the basemap and produces a black map. Bail when there's
 // no vector source to enhance.
 const styleSpec = this.maplibreMap.getStyle();
 const hasVectorSource = Object.values(styleSpec?.sources ?? {})
 .some((src) => (src as { type?: string }).type === 'vector');
 if (!hasVectorSource) return;
 try {
 // Add terrain DEM source for hillshade (Mapzen terrarium — free, no API key)
 if (!this.maplibreMap.getSource('wm-terrain-dem')) {
 this.maplibreMap.addSource('wm-terrain-dem', {
 type: 'raster-dem',
 tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
 encoding: 'terrarium',
 tileSize: 256,
 maxzoom: 14,
 });
 }
 if (!this.maplibreMap.getLayer('wm-hillshade')) {
 // Insert hillshade below the first symbol (label) layer so labels sit on top
 const firstSymbolId = this.maplibreMap.getStyle()?.layers?.find(l => l.type === 'symbol')?.id;
 this.maplibreMap.addLayer(
 {
 id: 'wm-hillshade',
 type: 'hillshade',
 source: 'wm-terrain-dem',
 paint: {
 'hillshade-shadow-color': '#080d1a',
 'hillshade-highlight-color': '#1a2b48',
 'hillshade-accent-color': '#0d1220',
 'hillshade-exaggeration': 0.45,
 'hillshade-illumination-direction': 330,
 'hillshade-illumination-anchor': 'map',
 },
 },
 firstSymbolId,
 );
 }
 } catch (error) {
 console.warn('[DeckGLMap] Dark map enhancements skipped:', error);
 }
  }

  private showMapErrorOverlay(message: string, sourceId?: string): void {
 const wrapper = this.container.querySelector<HTMLElement>('#deckglMapWrapper');
 if (!wrapper || wrapper.querySelector('.map-error-overlay')) return;
 const overlay = document.createElement('div');
 overlay.className = 'map-error-overlay';
 overlay.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(11,14,18,0.92);color:#e5e9f0;font-size:13px;text-align:center;padding:24px;z-index:5;';
 const safeMsg = message.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
 const safeSource = sourceId ? sourceId.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c] ?? c)) : '';
 overlay.innerHTML = `
 <div style="font-weight:600;font-size:14px;">Map tiles failed to load</div>
 <div style="opacity:0.75;max-width:420px;">${safeMsg}${safeSource ? ` (source: ${safeSource})` : ''}</div>
 <div style="display:flex;gap:8px;margin-top:6px;">
 <button class="map-error-retry" style="padding:6px 14px;border-radius:6px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.06);color:#e5e9f0;cursor:pointer;font-size:12px;">Retry</button>
 <button class="map-error-clear-cache" style="padding:6px 14px;border-radius:6px;border:1px solid rgba(255,255,255,0.25);background:transparent;color:#e5e9f0;cursor:pointer;font-size:12px;">Clear cache &amp; reload</button>
 </div>
 `;
 wrapper.append(overlay);
 overlay.querySelector('.map-error-retry')?.addEventListener('click', () => {
 overlay.remove();
 if (this.maplibreMap) this.maplibreMap.setStyle(getStyleUrl(this.activeBaseMap));
 });
 overlay.querySelector('.map-error-clear-cache')?.addEventListener('click', () => {
 void (async () => {
 try {
 const regs = await navigator.serviceWorker?.getRegistrations();
 await Promise.all((regs ?? []).map((r) => r.unregister()));
 const keys = await caches.keys();
 await Promise.all(keys.map((k) => caches.delete(k)));
 } catch { /* ignore */ }
 location.reload();
 })();
 });
  }

  private switchBasemap(basemap: BaseMapStyle): void {
 if (!this.maplibreMap) return;
 this.activeBaseMap = basemap;
 localStorage.setItem(BASEMAP_STORAGE_KEY, basemap);
 this.maplibreMap.setStyle(getStyleUrl(basemap));
 // setStyle() replaces all sources/layers — reset guard so country layers are re-added
 this.countryGeoJsonLoaded = false;
 const themeForPaint: 'dark' | 'light' = basemap === 'light' ? 'light' : 'dark';
 this.maplibreMap.once('style.load', () => {
 this.loadCountryBoundaries();
 this.updateCountryLayerPaint(themeForPaint);
 this.updateAttribution(basemap);
 // Re-render deck.gl overlay after style swap — interleaved layers need
 // the new MapLibre style to be loaded before they can re-insert.
 this.render();
 this.applyDarkMapEnhancements();
 });
  }

  private updateAttribution(basemap: BaseMapStyle): void {
 const el = this.container.querySelector('.map-attribution');
 if (!el) return;
 if (basemap === 'satellite') {
 el.innerHTML = '&copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> &mdash; Source: Esri, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN';
 } else if (basemap === 'terrain') {
 el.innerHTML = '&copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> &mdash; Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO';
 } else {
 el.innerHTML = '&copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
 }
  }

  private updateCountryLayerPaint(theme: 'dark' | 'light'): void {
 if (!this.maplibreMap || !this.countryGeoJsonLoaded) return;
 // Satellite/terrain raster backgrounds need more visible country hover overlays
 const isRaster = this.activeBaseMap === 'satellite' || this.activeBaseMap === 'terrain';
 const hoverOpacity = isRaster ? 0.12 : (theme === 'light' ? 0.1 : 0.06);
 const highlightOpacity = isRaster ? 0.22 : (theme === 'light' ? 0.18 : 0.12);
 try {
 this.maplibreMap.setPaintProperty('country-hover-fill', 'fill-opacity', hoverOpacity);
 this.maplibreMap.setPaintProperty('country-highlight-fill', 'fill-opacity', highlightOpacity);
 } catch { /* layers may not be ready */ }
  }

  public destroy(): void {
 this.smokeOverlayUnsub?.();
 this.smokeOverlayUnsub = null;
 this.smokeScrubberEl?.remove();
 this.smokeScrubberEl = null;
 this.smokeScrubberInput = null;
 this.smokeScrubberLabel = null;
 if (this._mapFpsTimerId !== null) {
 clearInterval(this._mapFpsTimerId);
 this._mapFpsTimerId = null;
 }
 if (this.moveTimeoutId) {
 clearTimeout(this.moveTimeoutId);
 this.moveTimeoutId = null;
 }
 if (this.satelliteRetryTimer) {
 clearTimeout(this.satelliteRetryTimer);
 this.satelliteRetryTimer = null;
 }

 this.stopPulseAnimation();
 this.stopCablePulse();
 this.stopDayNightTimer();
 this.stopTheaterPolygons();

 if (this._themeChangedHandler) {
 window.removeEventListener('theme-changed', this._themeChangedHandler);
 this._themeChangedHandler = null;
 }
 if (this._visibilityHandler) {
 document.removeEventListener('visibilitychange', this._visibilityHandler);
 this._visibilityHandler = null;
 }

 // Remove all MapLibre event listeners to prevent leaks
 for (const { event, handler } of this.mapEventHandlers) {
 this.maplibreMap?.off(event, handler);
 }
 this.mapEventHandlers = [];

 if (this.resizeObserver) {
 this.resizeObserver.disconnect();
 this.resizeObserver = null;
 }

 this.layerCache.clear();
 this.filterByTimeCache = new WeakMap();

 this.deckOverlay?.finalize();
 this.deckOverlay = null;
 this.maplibreMap?.remove();
 this.maplibreMap = null;

 this.container.innerHTML = '';
  }

  // ── Worldview-style layer creators ────────────────────────────────────────

  private createTheaterPolygonsLayers(): Layer[] {
 const isLight = getCurrentTheme() === 'light';
 const fill = new PolygonLayer<TheaterPolygon>({
 id: 'theater-polygons-fill',
 data: this.theaterPolygons,
 getPolygon: (d) => d.polygon,
 getFillColor: (d) => d.color,
 getLineColor: (d) => getTheaterBorderColor(d),
 filled: true,
 stroked: true,
 getLineWidth: 2,
 lineWidthUnits: 'pixels' as const,
 pickable: true,
 });

 // Precompute centroids once per data change instead of per frame
 const labelData = this.theaterPolygons
 .filter(t => t.score >= 40)
 .map(t => {
 const lons = t.polygon.map(p => p[0]);
 const lats = t.polygon.map(p => p[1]);
 return {
 ...t,
 _centroid: [
 (Math.min(...lons) + Math.max(...lons)) / 2,
 (Math.min(...lats) + Math.max(...lats)) / 2,
 ] as [number, number],
 };
 });

 const labels = new TextLayer<(typeof labelData)[number]>({
 id: 'theater-polygons-labels',
 data: labelData,
 getPosition: (d) => d._centroid,
 getText: (d) => `${d.name}\n${d.score}`,
 getSize: 11,
 getColor: isLight ? [30, 30, 30, 200] : [240, 240, 240, 200],
 fontWeight: 'bold',
 background: true,
 getBackgroundColor: isLight ? [255, 255, 255, 140] : [20, 20, 30, 160],
 backgroundPadding: [4, 2, 4, 2],
 pickable: false,
 ...CRISP_LABEL_TEXT,
 outlineColor: (isLight ? [255, 255, 255, 220] : [0, 0, 0, 200]) as [number, number, number, number],
 });

 return [fill, labels];
  }

  private createConvergenceRingsLayers(alerts: GeoConvergenceAlert[]): ScatterplotLayer<GeoConvergenceAlert>[] {
 // Outer glow ring
 const outer = new ScatterplotLayer<GeoConvergenceAlert>({
 id: 'convergence-rings-outer',
 data: alerts,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: (d) => 80_000 + d.score * 1200,
 getFillColor: (d) => {
 const intensity = Math.round((d.score / 100) * 180);
 return [220, intensity > 100 ? 50 : 120, 40, 35];
 },
 getLineColor: (d) => {
 if (d.score >= 80) return [255, 50, 50, 200];
 if (d.score >= 60) return [255, 140, 40, 180];
 return [220, 180, 40, 150];
 },
 stroked: true,
 filled: true,
 lineWidthMinPixels: 2,
 getLineWidth: 3000,
 radiusUnits: 'meters' as const,
 pickable: false,
 });

 // Inner core dot
 const inner = new ScatterplotLayer<GeoConvergenceAlert>({
 id: 'convergence-rings-inner',
 data: alerts,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 18_000,
 getFillColor: (d) => {
 if (d.score >= 80) return [255, 60, 60, 220];
 if (d.score >= 60) return [255, 140, 40, 200];
 return [220, 200, 50, 180];
 },
 radiusUnits: 'meters' as const,
 pickable: true,
 autoHighlight: true,
 });

 return [outer, inner];
  }

  // ── Threat Heatmap ───────────────────────────────────────────────────────

  private collectThreatHeatmapPoints(): { lat: number; lon: number; weight: number }[] {
 const pts: { lat: number; lon: number; weight: number }[] = [];

 // Earthquakes (location is a GeoCoordinates object)
 for (const eq of this.earthquakes) {
 const loc = eq.location;
 if (loc) pts.push({ lat: loc.latitude, lon: loc.longitude, weight: Math.max(1, eq.magnitude / 2) });
 }
 // Conflicts/UCDP events
 for (const ev of this.ucdpEvents) {
 if (ev.latitude != null && ev.longitude != null) {
 pts.push({ lat: ev.latitude, lon: ev.longitude, weight: 2 });
 }
 }
 // Airstrikes
 for (const a of this.airstrikesData) {
 if (a.lat != null && a.lon != null) {
 pts.push({ lat: a.lat, lon: a.lon, weight: 3 });
 }
 }
 // Weather alerts (centroid is [lon, lat])
 for (const w of this.weatherAlerts) {
 if (w.centroid?.length === 2) {
 pts.push({ lat: w.centroid[1], lon: w.centroid[0], weight: 1.5 });
 }
 }
 // Cyber threats
 for (const ct of this.cyberThreats) {
 if (ct.lat != null && ct.lon != null) {
 pts.push({ lat: ct.lat, lon: ct.lon, weight: 2 });
 }
 }
 // Natural events
 for (const ne of this.naturalEvents) {
 if (ne.lat != null && ne.lon != null) {
 pts.push({ lat: ne.lat, lon: ne.lon, weight: 2 });
 }
 }
 // Internet outages
 for (const o of this.outages) {
 if (o.lat != null && o.lon != null) {
 pts.push({ lat: o.lat, lon: o.lon, weight: 1 });
 }
 }
 return pts;
  }

  private createThreatHeatmapLayer(points: { lat: number; lon: number; weight: number }[]): HeatmapLayer {
 return new HeatmapLayer({
 id: 'threat-heatmap-layer',
 data: points,
 getPosition: (d: { lat: number; lon: number }) => [d.lon, d.lat],
 getWeight: (d: { weight: number }) => d.weight,
 radiusPixels: 50,
 intensity: 0.8,
 threshold: 0.1,
 opacity: 0.5,
 colorRange: [
 [30, 80, 200], // low — blue
 [60, 180, 120],  // med — green-teal
 [230, 200, 40],  // elevated — amber
 [240, 120, 20],  // high — orange
 [220, 40, 40], // critical — red
 [180, 0, 60], // extreme — deep red
 ],
 pickable: false,
 });
  }

  // ── SIGINT Layers ────────────────────────────────────────────────────────

  private createSigintPointsLayer(points: SigintEvent[]): ScatterplotLayer<SigintEvent> {
 const SIGINT_COLORS: Record<string, [number, number, number, number]> = {
 gps_jamming: [200, 40, 255, 180], // violet
 bgp_anomaly: [40, 180, 255, 180], // cyan
 cable_outage: [255, 140, 30, 180], // amber
 };

 return new ScatterplotLayer<SigintEvent>({
 id: 'sigint-points-layer',
 data: points,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: 25_000,
 getFillColor: (d) => SIGINT_COLORS[d.type] ?? [150, 150, 150, 150],
 radiusUnits: 'meters' as const,
 radiusMinPixels: 3,
 radiusMaxPixels: 12,
 pickable: true,
 autoHighlight: true,
 });
  }

  private createSigintClusterLayer(clusters: SigintConvergenceCluster[]): ScatterplotLayer<SigintConvergenceCluster> {
 return new ScatterplotLayer<SigintConvergenceCluster>({
 id: 'sigint-cluster-layer',
 data: clusters,
 getPosition: (d) => [d.lon, d.lat],
 getRadius: (d) => 60_000 + d.score * 1500,
 getFillColor: (d) => d.color,
 getLineColor: (d) => {
 const [r, g, b] = d.color;
 return [r, g, b, 220] as [number, number, number, number];
 },
 stroked: true,
 filled: true,
 lineWidthMinPixels: 2,
 lineWidthMaxPixels: 4,
 radiusUnits: 'meters' as const,
 pickable: true,
 autoHighlight: true,
 });
  }

  // ── Building Extrusions (MapLibre GL native fill-extrusion) ──────

  private syncBuildingExtrusions(): void {
 if (!this.maplibreMap) return;
 const map = this.maplibreMap;
 const enabled = this.state.layers.buildings3d;
 const layerId = 'wm-3d-buildings';
 const zoom = map.getZoom();

 if (!enabled || zoom < 14) {
 if (map.getLayer(layerId)) {
 map.setLayoutProperty(layerId, 'visibility', 'none');
 }
 return;
 }

 if (!map.getLayer(layerId)) {
 const firstSymbolId = map.getStyle()?.layers?.find(l => l.type === 'symbol')?.id;
 map.addLayer(
 {
 id: layerId,
 type: 'fill-extrusion',
 source: 'carto',
 'source-layer': 'building',
 minzoom: 14,
 paint: {
 'fill-extrusion-color': this.activeBaseMap === 'light' ? '#c8c8c8' : '#1a2744',
 'fill-extrusion-height': ['get', 'render_height'],
 'fill-extrusion-base': ['get', 'render_min_height'],
 'fill-extrusion-opacity': [
 'interpolate', ['linear'], ['zoom'],
 14, 0,
 15, 0.7,
 ],
 },
 },
 firstSymbolId,
 );
 } else {
 map.setLayoutProperty(layerId, 'visibility', 'visible');
 }
  }

  // ── Weather Raster Tile Layers (MapLibre GL native) ──────────────

  /**
   * Note that the current GIBS GOES hour failed and ensure a recovery timer is
   * armed. MapLibre fires one `error` per failed tile, so a single unavailable
   * hour produces a burst (plus late in-flight failures from the removed
   * source). Rather than step per error, we flag the failure and let a
   * self-rescheduling timer (scheduleSatelliteRetry) drive the actual
   * hour-step — coalescing the burst and continuing to step while each rebuilt
   * hour also fails, without depending on MapLibre re-emitting after the burst.
   * The base hour resets the offset each new UTC hour (see syncWeatherRasterLayers),
   * so an exhausted lookback retries the freshest frame on the next hour.
   */
  private recoverSatelliteTiles(): void {
 if (!this.maplibreMap) return;
 this.satelliteErrorSinceRebuild = true;
 if (this.satelliteRetryTimer === null
 && this.satelliteHourOffset < DeckGLMap.MAX_SATELLITE_HOUR_OFFSET) {
 this.scheduleSatelliteRetry();
 }
  }

  private scheduleSatelliteRetry(): void {
 this.satelliteRetryTimer = setTimeout(() => {
 this.satelliteRetryTimer = null;
 // Rebuilt hour loaded cleanly (no errors since) — settled.
 if (!this.satelliteErrorSinceRebuild) return;
 if (!this.maplibreMap) return;
 // Exhausted the lookback budget — surface a diagnostic and stop; the
 // hour-rollover reset retries the freshest frame on the next UTC hour.
 if (this.satelliteHourOffset >= DeckGLMap.MAX_SATELLITE_HOUR_OFFSET) {
 console.warn('[DeckGLMap] GOES satellite imagery unavailable after exhausting GIBS hourly fallback (up to 6h back); will retry on the next UTC hour.');
 return;
 }
 this.satelliteErrorSinceRebuild = false;
 this.satelliteHourOffset += 1;
 // syncWeatherRasterLayers rebuilds the source because the URL now differs.
 this.syncWeatherRasterLayers();
 // Re-arm to check whether this hour also fails.
 this.scheduleSatelliteRetry();
 }, DeckGLMap.SATELLITE_RECOVERY_COOLDOWN_MS);
  }

  private syncWeatherRasterLayers(): void {
 if (!this.maplibreMap) return;
 const map = this.maplibreMap;
 const ml = this.state.layers;

 // Weather radar (RainViewer)
 this.syncRasterTileLayer(map, 'wm-radar', ml.weatherRadar, () => {
 if (!this.radarState) return null;
 const url = getRadarTileUrl(this.radarState);
 return url ? [url] : null;
 }, 0.6);

 // Satellite imagery (NOAA GOES geocolor) — time-stamped GIBS WMTS.
 // The TIME segment advances each UTC hour, so reset the recovery offset on
 // hour-rollover (retry the freshest frame) and rebuild the source whenever
 // the computed URL changes — syncRasterTileLayer otherwise keeps the source
 // pinned to the URL it was first created with.
 const satelliteBaseHour = gibsHourTimestamp(0);
 if (this.satelliteBaseHour !== null && this.satelliteBaseHour !== satelliteBaseHour) {
 this.satelliteHourOffset = 1;
 this.satelliteErrorSinceRebuild = false;
 }
 this.satelliteBaseHour = satelliteBaseHour;
 const satelliteUrl = getGoesWmsTileUrl('geocolor', this.satelliteHourOffset);
 if (ml.weatherSatellite
 && this.satelliteAppliedUrl !== null
 && this.satelliteAppliedUrl !== satelliteUrl) {
 if (map.getLayer('wm-satellite-layer')) map.removeLayer('wm-satellite-layer');
 if (map.getSource('wm-satellite-src')) map.removeSource('wm-satellite-src');
 }
 // GoogleMapsCompatible_Level7 tiles only exist at zoom 0–7; pass maxzoom
 // so MapLibre overzooms at z8+ instead of requesting out-of-bounds tiles.
 this.syncRasterTileLayer(map, 'wm-satellite', ml.weatherSatellite, () => [satelliteUrl], 0.5, 7);
 if (ml.weatherSatellite) this.satelliteAppliedUrl = satelliteUrl;

 // OWM tile layers (require API key)
 const owmLayers: [string, boolean, OwmTileLayer][] = [
 ['wm-owm-temp', ml.owmTemperature, 'temp_new'],
 ['wm-owm-precip', ml.owmPrecipitation, 'precipitation_new'],
 ['wm-owm-clouds', ml.owmClouds, 'clouds_new'],
 ['wm-owm-wind', ml.owmWind, 'wind_new'],
 ];
 for (const [id, enabled, layer] of owmLayers) {
 this.syncRasterTileLayer(map, id, enabled, () => {
 const url = getOwmTileUrl(layer);
 return url ? [url] : null;
 }, 0.7);
 }

 // ECCC FireWork wildfire-smoke PM2.5 forecast (GeoMet WMS). The scrubber's
 // selected hour pins the WMS TIME dimension, so the URL changes as the user
 // scrubs — rebuild the source, which syncRasterTileLayer otherwise keeps
 // pinned to the URL it was first created with.
 const fireworkHours = this.smokeScrubberHours();
 const fireworkTarget = fireworkHours
 ? fireworkHours[Math.min(this.smokeForecastHourIdx, fireworkHours.length - 1)]
 : undefined;
 const fireworkUrl = getSmokeForecastTileUrl(this.fireworkState, fireworkTarget);
 if (ml.smokeForecast
 && this.fireworkAppliedUrl !== null
 && this.fireworkAppliedUrl !== fireworkUrl) {
 if (map.getLayer('wm-firework-layer')) map.removeLayer('wm-firework-layer');
 if (map.getSource('wm-firework-src')) map.removeSource('wm-firework-src');
 }
 this.syncRasterTileLayer(map, 'wm-firework', ml.smokeForecast, () => [fireworkUrl], 0.55);
 if (ml.smokeForecast) this.fireworkAppliedUrl = fireworkUrl;
 // Scrubber lives here rather than in buildLayers(): that call is behind
 // `this.deckOverlay?.`, so it is skipped entirely when the deck overlay
 // failed to construct — the raster would render with no way to scrub it.
 this.syncSmokeScrubber(ml.airSmoke || ml.smokeForecast);
  }

  private syncRasterTileLayer(
 map: maplibregl.Map,
 id: string,
 enabled: boolean,
 getTiles: () => string[] | null,
 opacity: number,
 maxzoom?: number,
  ): void {
 const layerId = `${id}-layer`;
 const sourceId = `${id}-src`;

 if (!enabled) {
 if (map.getLayer(layerId)) {
 map.setLayoutProperty(layerId, 'visibility', 'none');
 }
 return;
 }

 const tiles = getTiles();
 if (!tiles) {
 if (map.getLayer(layerId)) {
 map.setLayoutProperty(layerId, 'visibility', 'none');
 }
 return;
 }

 if (!map.getSource(sourceId)) {
 map.addSource(sourceId, {
 type: 'raster',
 tiles,
 tileSize: 256,
 ...(maxzoom !== undefined ? { maxzoom } : {}),
 });
 }

 if (!map.getLayer(layerId)) {
 map.addLayer({
 id: layerId,
 type: 'raster',
 source: sourceId,
 paint: { 'raster-opacity': opacity },
 });
 } else {
 map.setLayoutProperty(layerId, 'visibility', 'visible');
 }
  }

  // ── Lightning Layer (DeckGL ScatterplotLayer) ────────────────────

  private createLightningLayer(): IconLayer {
 return new IconLayer({
 id: 'lightning-strikes',
 data: this.lightningStrikes,
 getPosition: (d: LightningStrike) => [d.lon, d.lat],
 getIcon: () => 'lightning',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: 16,
 sizeMinPixels: 6,
 sizeMaxPixels: 18,
 getColor: (d: LightningStrike) => {
 const rgb = strikeColor(d.intensity);
 const a = Math.round(strikeOpacity(d.time) * 255);
 return [...rgb, a] as [number, number, number, number];
 },
 pickable: true,
 });
  }

  // ── Red Flag Warnings Layer (DeckGL ScatterplotLayer) ────────────

  private createRedFlagWarningsLayer(): ScatterplotLayer {
 const data = this.redFlagWarnings.filter(w => w.centroid);
 return new ScatterplotLayer({
 id: 'red-flag-warnings',
 data,
 getPosition: (d: RedFlagWarning) => d.centroid as [number, number],
 getRadius: 30_000,
 getFillColor: [239, 68, 68, 160],
 getLineColor: [239, 68, 68, 255],
 stroked: true,
 filled: true,
 lineWidthMinPixels: 2,
 radiusUnits: 'meters' as const,
 radiusMinPixels: 6,
 pickable: true,
 });
  }

  // ── Weather Data Setters ─────────────────────────────────────────

  public setRadarState(state: RadarState): void {
 this.radarState = state;
 this.rafUpdateLayers();
  }

  public setFireworkForecast(state: SmokeForecastState): void {
 this.fireworkState = state;
 this.rafUpdateLayers();
  }

  public setLightningStrikes(strikes: LightningStrike[]): void {
 this.lightningStrikes = strikes;
 this.rafUpdateLayers();
  }

  public setRedFlagWarnings(warnings: RedFlagWarning[]): void {
 this.redFlagWarnings = warnings;
 this.rafUpdateLayers();
  }

  // ── Satellite Layers ─────────────────────────────────────────────

  private createSatelliteLayer(): IconLayer {
 const zoom = this.maplibreMap?.getZoom() ?? 0;
 const notable = this.satelliteCatalog.length > 0
 ? new Set(filterNotable(this.satelliteCatalog).map(s => s.noradId))
 : new Set<number>();

 const data = zoom < 3
 ? this.satellitePositions.filter(s => notable.has(s.noradId))
 : this.satellitePositions;

 return new IconLayer({
 id: 'satellite-positions',
 data,
 getPosition: (d: SatellitePosition) => [d.lon, d.lat],
 getIcon: () => 'satellite',
 iconAtlas: getIconAtlas(),
 iconMapping: getIconMapping(),
 getSize: (d: SatellitePosition) => notable.has(d.noradId) ? 18 : 12,
 sizeMinPixels: 4,
 sizeMaxPixels: 18,
 getColor: (d: SatellitePosition) => {
 const cat = this.satelliteCatalog.find(s => s.noradId === d.noradId);
 if (cat?.annotation) return [...cat.annotation.color, 200] as [number, number, number, number];
 return [150, 150, 150, 100];
 },
 pickable: true,
 });
  }

  private createSatelliteLabelLayer(): TextLayer {
 const notable = this.satelliteCatalog.filter(s => s.annotation && s.classification !== 'constellation');
 const notableIds = new Set(notable.map(s => s.noradId));
 const labeled = this.satellitePositions.filter(s => notableIds.has(s.noradId));

 return new TextLayer({
 id: 'satellite-labels',
 data: labeled,
 getPosition: (d: SatellitePosition) => [d.lon, d.lat],
 getText: (d: SatellitePosition) => {
 const cat = this.satelliteCatalog.find(s => s.noradId === d.noradId);
 return cat?.annotation?.label ?? '';
 },
 getSize: 10,
 getColor: [255, 255, 255, 180],
 getTextAnchor: 'start' as const,
 getAlignmentBaseline: 'center' as const,
 getPixelOffset: [8, 0],
 fontFamily: 'monospace',
 billboard: true,
 });
  }

  private createSatelliteOrbitLayer(): PathLayer {
 if (!this.selectedOrbitPath) return new PathLayer({ id: 'satellite-orbit', data: [] });
 return new PathLayer({
 id: 'satellite-orbit',
 data: [{ path: this.selectedOrbitPath.points.map(p => [p[0], p[1]]) }],
 getPath: (d: { path: [number, number][] }) => d.path,
 getColor: [255, 215, 0, 150],
 getWidth: 2,
 widthUnits: 'pixels' as const,
 });
  }

  public setSatellitePositions(positions: SatellitePosition[], catalog: SatelliteTLE[]): void {
 this.satellitePositions = positions;
 this.satelliteCatalog = catalog;
 this.rafUpdateLayers();
  }

  public setSelectedOrbitPath(path: OrbitPath | null): void {
 this.selectedOrbitPath = path;
 this.rafUpdateLayers();
  }
}
