/**
 * Built-in scoring drivers — at least 2 per domain across the 10
 * domains Crystal Ball ships with out of the box.
 *
 * Each driver pulls a raw value from `ObservationEvent.raw` (the
 * provider payload) or `ObservationEvent.tags` defensively, returning
 * null when the field isn't present so the engine can credit a 0
 * contribution rather than crash.
 *
 * Pure deterministic; no DOM, no fetch.
 */

import type { ObservationEvent } from './observation-adapters';
import type { ScoringDriver } from './driver-scores';

// ── Shared helpers ───────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function readNumber(source: unknown, ...keys: string[]): number | null {
  for (const key of keys) {
    const rec = asRecord(source);
    if (!rec) continue;
    const value = rec[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function pickFirstNumber(obs: ObservationEvent, ...paths: ((raw: unknown) => number | null)[]): number | null {
  for (const path of paths) {
    const v = path(obs.raw);
    if (v !== null) return v;
  }
  return null;
}

function tagSeverity(obs: ObservationEvent, mapping: Record<string, number>): number | null {
  for (const tag of obs.tags) {
    const value = mapping[tag];
    if (typeof value === 'number') return value;
  }
  return null;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function linear(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return clamp01((value - min) / (max - min));
}

// ── Earthquake ───────────────────────────────────────────────────────

export const earthquakeMagnitudeDriver: ScoringDriver = {
  id: 'earthquake.magnitude',
  name: 'Seismic Magnitude',
  domain: 'earthquake',
  weight: 0.6,
  description: 'USGS moment magnitude — past M3.0, saturating at M8.0 (great earthquakes).',
  extractValue: (obs) => pickFirstNumber(
    obs,
    (raw) => readNumber(asRecord(raw)?.properties, 'mag'),
    (raw) => readNumber(raw, 'magnitude'),
  ),
  normalizeValue: (raw) => linear(raw, 3, 8),
};

export const earthquakeDepthDriver: ScoringDriver = {
  id: 'earthquake.depth',
  name: 'Hypocenter Depth (shallow=worse)',
  domain: 'earthquake',
  weight: 0.2,
  description: 'Shallow earthquakes do more damage; <70 km scaled toward 1.0.',
  extractValue: (obs) => pickFirstNumber(
    obs,
    (raw) => readNumber(raw, 'depth'),
    (raw) => {
      const coords = asRecord(asRecord(raw)?.geometry)?.coordinates;
      if (Array.isArray(coords) && typeof coords[2] === 'number') return coords[2];
      return null;
    },
  ),
  normalizeValue: (depth) => 1 - linear(depth, 0, 200),
};

export const earthquakePopulationProximityDriver: ScoringDriver = {
  id: 'earthquake.population_proximity',
  name: 'Population Proximity',
  domain: 'earthquake',
  weight: 0.2,
  description: 'Tag-based hint at proximity to populated regions.',
  extractValue: (obs) => tagSeverity(obs, {
    'urban-impact': 1, 'populated-area': 0.7, 'rural': 0.2, 'offshore': 0.1,
  }),
  normalizeValue: (raw) => clamp01(raw),
};

// ── Weather ──────────────────────────────────────────────────────────

export const weatherWindSpeedDriver: ScoringDriver = {
  id: 'weather.wind_speed',
  name: 'Wind Speed (mph)',
  domain: 'weather',
  weight: 0.4,
  description: 'Sustained wind speed — tropical-storm threshold (39 mph) to Cat-5 (157 mph).',
  extractValue: (obs) => pickFirstNumber(
    obs,
    (raw) => readNumber(raw, 'windSpeedMph', 'wind_speed_mph'),
    (raw) => readNumber(asRecord(raw)?.properties, 'windSpeedMph'),
  ),
  normalizeValue: (mph) => linear(mph, 39, 157),
};

export const weatherPrecipitationDriver: ScoringDriver = {
  id: 'weather.precipitation',
  name: 'Precipitation Intensity (in/hr)',
  domain: 'weather',
  weight: 0.3,
  description: 'Hourly precipitation rate. >1 in/hr is flash-flood territory.',
  extractValue: (obs) => readNumber(obs.raw, 'precipitationInHr', 'precip_in_hr'),
  normalizeValue: (rate) => linear(rate, 0.1, 4),
};

export const weatherStormCategoryDriver: ScoringDriver = {
  id: 'weather.storm_category',
  name: 'Storm Category (NWS)',
  domain: 'weather',
  weight: 0.3,
  description: 'NWS storm category 1–5; or tag-derived hurricane/tornado category.',
  extractValue: (obs) => {
    const numeric = readNumber(obs.raw, 'category', 'stormCategory');
    if (numeric !== null) return numeric;
    return tagSeverity(obs, {
      'cat-5': 5, 'cat-4': 4, 'cat-3': 3, 'cat-2': 2, 'cat-1': 1,
    });
  },
  normalizeValue: (cat) => linear(cat, 0, 5),
};

// ── Wildfire ─────────────────────────────────────────────────────────

export const wildfireAcreageDriver: ScoringDriver = {
  id: 'wildfire.acreage',
  name: 'Acres Burned',
  domain: 'wildfire',
  weight: 0.4,
  description: 'Total acres burned — log-scaled from 100 to 500,000 acres.',
  extractValue: (obs) => readNumber(obs.raw, 'acres', 'acresBurned'),
  normalizeValue: (acres) => clamp01(Math.log10(Math.max(acres, 1) + 1) / Math.log10(500_000)),
};

export const wildfireContainmentDriver: ScoringDriver = {
  id: 'wildfire.containment_inverse',
  name: 'Containment % (inverse)',
  domain: 'wildfire',
  weight: 0.3,
  description: 'Inverse of containment — 0% contained → 1.0; 100% → 0.0.',
  extractValue: (obs) => readNumber(obs.raw, 'containmentPercent', 'percentContained'),
  normalizeValue: (pct) => 1 - clamp01(pct / 100),
};

export const wildfireFireWeatherIndexDriver: ScoringDriver = {
  id: 'wildfire.fire_weather_index',
  name: 'Fire Weather Index',
  domain: 'wildfire',
  weight: 0.3,
  description: 'Canadian FWI — 0 to 50+ is critical.',
  extractValue: (obs) => readNumber(obs.raw, 'fwi', 'fireWeatherIndex'),
  normalizeValue: (fwi) => linear(fwi, 0, 50),
};

// ── Maritime ─────────────────────────────────────────────────────────

export const maritimeVesselCountDriver: ScoringDriver = {
  id: 'maritime.vessel_count',
  name: 'Affected Vessel Count',
  domain: 'maritime',
  weight: 0.4,
  description: 'Number of vessels in the affected region — log scale to 100.',
  extractValue: (obs) => readNumber(obs.raw, 'vesselCount', 'affectedVessels'),
  normalizeValue: (n) => clamp01(Math.log10(Math.max(n, 1) + 1) / Math.log10(101)),
};

export const maritimeCargoValueDriver: ScoringDriver = {
  id: 'maritime.cargo_value',
  name: 'Cargo Value Estimate (USD M)',
  domain: 'maritime',
  weight: 0.3,
  description: 'Estimated cargo value in millions of USD — scaled to $5B.',
  extractValue: (obs) => readNumber(obs.raw, 'cargoValueUsdM', 'cargoValueMillions'),
  normalizeValue: (musd) => linear(musd, 10, 5000),
};

export const maritimeChokepointProximityDriver: ScoringDriver = {
  id: 'maritime.chokepoint_proximity',
  name: 'Chokepoint Proximity',
  domain: 'maritime',
  weight: 0.3,
  description: 'Tag-based proximity to a maritime chokepoint (Hormuz, Suez, Bosphorus, …).',
  extractValue: (obs) => tagSeverity(obs, {
    'hormuz': 1, 'suez': 1, 'bosphorus': 0.9,
    'panama': 0.8, 'malacca': 0.9, 'bab-el-mandeb': 0.95,
  }),
  normalizeValue: (raw) => clamp01(raw),
};

// ── Aviation ─────────────────────────────────────────────────────────

export const aviationAffectedFlightsDriver: ScoringDriver = {
  id: 'aviation.affected_flights',
  name: 'Affected Flight Count',
  domain: 'aviation',
  weight: 0.5,
  description: 'Number of flights diverted/cancelled — log scale to 1000.',
  extractValue: (obs) => readNumber(obs.raw, 'affectedFlights', 'flightCount'),
  normalizeValue: (n) => clamp01(Math.log10(Math.max(n, 1) + 1) / Math.log10(1001)),
};

export const aviationAirportCategoryDriver: ScoringDriver = {
  id: 'aviation.airport_category',
  name: 'Airport Category',
  domain: 'aviation',
  weight: 0.5,
  description: 'Tag-based hub size — major hubs weight higher.',
  extractValue: (obs) => tagSeverity(obs, {
    'major-hub': 1, 'large-hub': 0.8, 'medium-hub': 0.5, 'small-hub': 0.3,
  }),
  normalizeValue: (raw) => clamp01(raw),
};

// ── Biosurveillance ──────────────────────────────────────────────────

export const biosurvWastewaterDriver: ScoringDriver = {
  id: 'biosurv.wastewater_concentration',
  name: 'Wastewater Concentration',
  domain: 'biosurveillance',
  weight: 0.5,
  description: 'CDC wastewater normalized concentration — 0 to 100+.',
  extractValue: (obs) => readNumber(obs.raw, 'wastewaterConcentration', 'concentration'),
  normalizeValue: (c) => linear(c, 0, 100),
};

export const biosurvGeographicSpreadDriver: ScoringDriver = {
  id: 'biosurv.geographic_spread',
  name: 'Geographic Spread (cities)',
  domain: 'biosurveillance',
  weight: 0.5,
  description: 'Number of distinct cities reporting — 1 to 50+.',
  extractValue: (obs) => readNumber(obs.raw, 'cityCount', 'affectedCities'),
  normalizeValue: (n) => linear(n, 1, 50),
};

// ── Space weather ────────────────────────────────────────────────────

export const spaceWeatherKpDriver: ScoringDriver = {
  id: 'space-weather.kp_index',
  name: 'Kp Index',
  domain: 'space-weather',
  weight: 0.6,
  description: 'NOAA Kp planetary index — 0 (calm) to 9 (G5).',
  extractValue: (obs) => readNumber(obs.raw, 'kp', 'kpIndex'),
  normalizeValue: (kp) => linear(kp, 4, 9),
};

export const spaceWeatherXrayClassDriver: ScoringDriver = {
  id: 'space-weather.xray_flux',
  name: 'X-Ray Flux Class',
  domain: 'space-weather',
  weight: 0.4,
  description: 'GOES X-ray flare class A/B/C/M/X — letter mapped to 0..1.',
  extractValue: (obs) => {
    const raw = asRecord(obs.raw);
    const cls = typeof raw?.xrayClass === 'string' ? (raw.xrayClass as string) : undefined;
    if (!cls) return null;
    const letter = cls[0]?.toUpperCase();
    if (letter === 'X') return 5;
    if (letter === 'M') return 4;
    if (letter === 'C') return 3;
    if (letter === 'B') return 2;
    if (letter === 'A') return 1;
    return null;
  },
  normalizeValue: (rank) => linear(rank, 1, 5),
};

// ── Cyber ────────────────────────────────────────────────────────────

export const cyberCvssDriver: ScoringDriver = {
  id: 'cyber.cvss',
  name: 'CVE CVSS Score',
  domain: 'cyber',
  weight: 0.5,
  description: 'CVSS base score 0–10.',
  extractValue: (obs) => readNumber(obs.raw, 'cvss', 'cvssScore', 'cvssBaseScore'),
  normalizeValue: (cvss) => linear(cvss, 0, 10),
};

export const cyberAffectedSystemsDriver: ScoringDriver = {
  id: 'cyber.affected_systems',
  name: 'Affected System Count',
  domain: 'cyber',
  weight: 0.3,
  description: 'Number of distinct systems affected — log scale to 10,000.',
  extractValue: (obs) => readNumber(obs.raw, 'affectedSystems', 'systemCount'),
  normalizeValue: (n) => clamp01(Math.log10(Math.max(n, 1) + 1) / Math.log10(10_001)),
};

export const cyberKevDriver: ScoringDriver = {
  id: 'cyber.kev_status',
  name: 'CISA KEV Status',
  domain: 'cyber',
  weight: 0.2,
  description: 'Known Exploited Vulnerabilities status — 1.0 if listed.',
  extractValue: (obs) => {
    if (obs.tags.includes('kev')) return 1;
    if (obs.tags.includes('exploited')) return 0.7;
    return null;
  },
  normalizeValue: (raw) => clamp01(raw),
};

// ── Sanctions ────────────────────────────────────────────────────────

export const sanctionsMatchConfidenceDriver: ScoringDriver = {
  id: 'sanctions.match_confidence',
  name: 'SDN Match Confidence',
  domain: 'sanctions',
  weight: 0.6,
  description: 'OFAC SDN match confidence 0–1.',
  extractValue: (obs) => readNumber(obs.raw, 'matchConfidence', 'sdnMatchConfidence'),
  normalizeValue: (c) => clamp01(c),
};

export const sanctionsTradeVolumeDriver: ScoringDriver = {
  id: 'sanctions.trade_volume',
  name: 'Trade Volume Estimate (USD M)',
  domain: 'sanctions',
  weight: 0.4,
  description: 'Estimated annual trade volume in USD millions — log to $10B.',
  extractValue: (obs) => readNumber(obs.raw, 'tradeVolumeUsdM', 'tradeVolumeMillions'),
  normalizeValue: (musd) => clamp01(Math.log10(Math.max(musd, 1) + 1) / Math.log10(10_001)),
};

// ── Intelligence (corroboration) ─────────────────────────────────────

export const intelligenceCorroborationDriver: ScoringDriver = {
  id: 'intelligence.corroboration_count',
  name: 'Corroborating Source Count',
  domain: 'intelligence',
  weight: 0.6,
  description: 'Number of independent sources reporting the same claim.',
  extractValue: (obs) => readNumber(obs.raw, 'corroborationCount', 'sourceCount'),
  normalizeValue: (n) => linear(n, 1, 8),
};

export const intelligenceSourceReliabilityDriver: ScoringDriver = {
  id: 'intelligence.source_reliability',
  name: 'Source Reliability',
  domain: 'intelligence',
  weight: 0.4,
  description: 'Average source reliability score 0–1.',
  extractValue: (obs) => readNumber(obs.raw, 'sourceReliability', 'reliability'),
  normalizeValue: (r) => clamp01(r),
};

// ── Aggregate export ─────────────────────────────────────────────────

export const builtInDrivers: readonly ScoringDriver[] = [
  earthquakeMagnitudeDriver,
  earthquakeDepthDriver,
  earthquakePopulationProximityDriver,
  weatherWindSpeedDriver,
  weatherPrecipitationDriver,
  weatherStormCategoryDriver,
  wildfireAcreageDriver,
  wildfireContainmentDriver,
  wildfireFireWeatherIndexDriver,
  maritimeVesselCountDriver,
  maritimeCargoValueDriver,
  maritimeChokepointProximityDriver,
  aviationAffectedFlightsDriver,
  aviationAirportCategoryDriver,
  biosurvWastewaterDriver,
  biosurvGeographicSpreadDriver,
  spaceWeatherKpDriver,
  spaceWeatherXrayClassDriver,
  cyberCvssDriver,
  cyberAffectedSystemsDriver,
  cyberKevDriver,
  sanctionsMatchConfidenceDriver,
  sanctionsTradeVolumeDriver,
  intelligenceCorroborationDriver,
  intelligenceSourceReliabilityDriver,
];
