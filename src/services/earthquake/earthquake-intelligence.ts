/**
 * Earthquake Intelligence — domain-superpower aggregation.
 *
 * Pure-deterministic. No DOM, no fetch at import time. Aggregates four
 * lenses on a USGS earthquake feed slice:
 *
 *   1. Significant events: M ≥ 4.0 in the slice, sorted by recency.
 *   2. Aftershock forecast (delegates to seismic/aftershock-watch
 *      `forecastAftershocks()` for the Omori-Utsu math) at 24h / 72h /
 *      168h horizons.
 *   3. Nearest known fault system: cross-references the epicenter
 *      against the static FAULT_SYSTEMS table (San Andreas, Cascadia,
 *      New Madrid, Wasatch, Alpine, …) with great-circle distance.
 *   4. Population exposure: rough population estimate within R km of
 *      the epicenter using a small lat-band density table.
 *
 * Plus regional seismicity rate (events in last 24h vs the 30-day
 * baseline) and a simple MMI estimator from magnitude + distance.
 *
 * The orchestrator `fetchEarthquakeIntelligence()` accepts a
 * `fetchImpl` so tests inject stubs without network.
 */

import { forecastAftershocks, type AftershockForecast } from '@/services/seismic/aftershock-watch';

// ─── Public types ─────────────────────────────────────────────────────

export type MmiLabel = 'I' | 'II-III' | 'IV' | 'V' | 'VI' | 'VII' | 'VIII' | 'IX' | 'X+';

export interface UsgsEvent {
  id: string;
  magnitude: number;
  magnitudeType: string | null;
  place: string;
  time: number;
  depthKm: number | null;
  lat: number;
  lon: number;
  /** USGS event page URL when present. */
  url?: string;
  /** USGS `tsunami` 1/0 flag passed through. */
  tsunami?: 0 | 1;
}

export interface FaultMatch {
  /** Stable id from FAULT_SYSTEMS. */
  faultId: string;
  /** Human-readable fault name. */
  name: string;
  /** Great-circle distance (km) from the event epicenter to the
   *  fault's representative point. */
  distanceKm: number;
  /** Continent / region tag for grouping in the UI. */
  region: string;
}

export interface ShakeMapData {
  eventId: string;
  /** ShakeMap maxMMI (1–10), null if no ShakeMap product. */
  maxMmi: number | null;
  maxMmiLabel: MmiLabel | null;
  /** USGS ShakeMap page (deep link). */
  shakemapUrl: string;
}

export interface EarthquakeSummary {
  event: UsgsEvent;
  /** Estimated MMI at the epicenter from magnitude + depth. */
  estimatedMmi: number;
  estimatedMmiLabel: MmiLabel;
  fault: FaultMatch | null;
  /** Population estimate within 50 km of the epicenter. */
  populationWithin50Km: number;
  /** "Largest event in this 5°×5° cell over the last N events". */
  historicalContext: string;
  shakemapUrl: string;
}

export interface RegionalSeismicityRate {
  last24hCount: number;
  /** Baseline computed from the rest of the slice, scaled to a 24h window. */
  baseline24hCount: number;
  /** last24h / baseline. Higher than 1.0 = elevated. null when baseline is 0
   *  (no prior events to compare against — JSON-safe sentinel). */
  ratio: number | null;
  label: 'quiet' | 'normal' | 'elevated' | 'swarm';
}

export interface EarthquakeIntelligenceState {
  generatedAt: number;
  /** M ≥ 4 events from the slice, newest first. */
  significantEvents: EarthquakeSummary[];
  /** All events for context (sorted newest first). */
  allEvents: UsgsEvent[];
  /** Aftershock forecast keyed by mainshock event id (only for M≥5). */
  aftershockForecasts: Record<string, AftershockForecast>;
  regionalRate: RegionalSeismicityRate;
}

// ─── Fault systems table ─────────────────────────────────────────────

export interface FaultSystem {
  id: string;
  name: string;
  region: string;
  /** Representative lat/lon along the fault — used as a single
   *  point for great-circle distance. Coarse on purpose: fault
   *  proximity here is an "is the event near X?" sanity check, not
   *  a research-grade geometry match. */
  lat: number;
  lon: number;
}

export const FAULT_SYSTEMS: readonly FaultSystem[] = [
  // United States
  { id: 'san-andreas', name: 'San Andreas Fault', region: 'US-West', lat: 35.7, lon: -120.3 },
  { id: 'hayward', name: 'Hayward Fault', region: 'US-West', lat: 37.7, lon: -122.1 },
  { id: 'cascadia', name: 'Cascadia Subduction Zone', region: 'US-Pacific-NW', lat: 44.5, lon: -125 },
  { id: 'new-madrid', name: 'New Madrid Seismic Zone', region: 'US-Central', lat: 36.5, lon: -89.5 },
  { id: 'wasatch', name: 'Wasatch Fault', region: 'US-Intermountain', lat: 40.8, lon: -111.9 },
  { id: 'denali', name: 'Denali Fault', region: 'US-Alaska', lat: 63.4, lon: -147.6 },
  { id: 'aleutian', name: 'Aleutian Subduction Zone', region: 'US-Alaska', lat: 52, lon: -174 },
  { id: 'hawaii-rift', name: 'Hawaiian Volcanic Rifts', region: 'US-Pacific', lat: 19.5, lon: -155.5 },
  // Pacific Rim
  { id: 'japan-trench', name: 'Japan Trench', region: 'Asia-Pacific', lat: 38, lon: 143.5 },
  { id: 'nankai', name: 'Nankai Trough', region: 'Asia-Pacific', lat: 33.5, lon: 136 },
  { id: 'kuril-trench', name: 'Kuril Trench', region: 'Asia-Pacific', lat: 45, lon: 150 },
  { id: 'philippine-trench', name: 'Philippine Trench', region: 'Asia-Pacific', lat: 10, lon: 127 },
  { id: 'sunda-trench', name: 'Sunda Trench', region: 'Asia-Pacific', lat: -5, lon: 100 },
  { id: 'tonga-trench', name: 'Tonga Trench', region: 'Asia-Pacific', lat: -20, lon: -173 },
  { id: 'kermadec', name: 'Kermadec Trench', region: 'Asia-Pacific', lat: -30, lon: -177 },
  { id: 'alpine-nz', name: 'Alpine Fault (NZ)', region: 'Asia-Pacific', lat: -43.5, lon: 170 },
  // Americas (non-US)
  { id: 'peru-chile', name: 'Peru-Chile Trench', region: 'Americas', lat: -25, lon: -71 },
  { id: 'middle-america', name: 'Middle America Trench', region: 'Americas', lat: 15, lon: -94 },
  // Europe / Mediterranean / Africa
  { id: 'north-anatolian', name: 'North Anatolian Fault', region: 'Europe-MidEast', lat: 40.5, lon: 35.5 },
  { id: 'east-anatolian', name: 'East Anatolian Fault', region: 'Europe-MidEast', lat: 37.5, lon: 38.5 },
  { id: 'hellenic-arc', name: 'Hellenic Arc', region: 'Europe-MidEast', lat: 35.5, lon: 25 },
  { id: 'dead-sea', name: 'Dead Sea Transform', region: 'Europe-MidEast', lat: 31.5, lon: 35.5 },
  { id: 'east-african-rift', name: 'East African Rift', region: 'Africa', lat: 0, lon: 36 },
  // Indian subcontinent
  { id: 'himalayan', name: 'Himalayan Thrust', region: 'Asia', lat: 28, lon: 84 },
];

const PROXIMITY_THRESHOLD_KM = 500;

// ─── Geographic helpers ──────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function nearestFault(epicenter: { lat: number; lon: number }): FaultMatch | null {
  let best: { f: FaultSystem; dist: number } | null = null;
  for (const f of FAULT_SYSTEMS) {
    const dist = haversineKm(epicenter, { lat: f.lat, lon: f.lon });
    if (!best || dist < best.dist) best = { f, dist };
  }
  if (!best || best.dist > PROXIMITY_THRESHOLD_KM) return null;
  return { faultId: best.f.id, name: best.f.name, region: best.f.region, distanceKm: Math.round(best.dist) };
}

// ─── Population exposure ─────────────────────────────────────────────

/**
 * Coarse population density by absolute-latitude band (people / km²),
 * weighted with a longitude-based ocean multiplier so the open Pacific
 * doesn't get the same density as continental interior.
 *
 * This is intentionally rough — it is a sanity-check estimator, not a
 * substitute for LandScan-grade gridded data. Designed to keep the
 * panel useful without shipping a 100 MB raster.
 */
const LAT_BAND_DENSITY: readonly { maxAbsLat: number; density: number }[] = [
  { maxAbsLat: 10, density: 70 },   // tropics
  { maxAbsLat: 25, density: 90 },   // sub-tropics (dense)
  { maxAbsLat: 40, density: 110 },  // mid-latitudes (densest)
  { maxAbsLat: 55, density: 60 },   // northern temperate
  { maxAbsLat: 70, density: 5 },    // sub-arctic
  { maxAbsLat: 90, density: 0.1 },  // polar
];

function landFraction(lat: number, lon: number): number {
  // Crude ocean masks: Pacific between 130°E and -70°W (everything
  // outside the continents) drops density by 10×; Atlantic
  // intercontinental band by 5×. Used purely as a "don't pretend
  // millions live on open ocean" guard.
  const absLat = Math.abs(lat);
  // Open Pacific belt (lat |30°|, lon -160°..-100°): ~all ocean.
  if (absLat < 30 && lon > -160 && lon < -100) return 0.05;
  // Open Atlantic mid-latitudes.
  if (absLat < 45 && lon > -50 && lon < -10) return 0.1;
  // Open Indian Ocean.
  if (absLat < 30 && lon > 50 && lon < 90) return 0.4;
  return 1;
}

export function estimatePopulationExposure(lat: number, lon: number, radiusKm: number): number {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || radiusKm <= 0) return 0;
  const absLat = Math.abs(lat);
  const band = LAT_BAND_DENSITY.find((b) => absLat <= b.maxAbsLat) ?? LAT_BAND_DENSITY[LAT_BAND_DENSITY.length - 1]!;
  const area = Math.PI * radiusKm * radiusKm;
  return Math.round(area * band.density * landFraction(lat, lon));
}

// ─── MMI estimator ───────────────────────────────────────────────────

/**
 * Estimate intensity (MMI) at a site from event magnitude + distance.
 * Uses a simplified Atkinson & Wald (2007) form:
 *   MMI ≈ 1.7 + 1.5·M − 1.2·log10(R)
 * where R is hypocentral distance in km. Clamped to [1, 12].
 */
export function estimateMmi(magnitude: number, distanceKm: number): number {
  if (!Number.isFinite(magnitude)) return 0;
  const R = Math.max(1, distanceKm);
  const mmi = 1.7 + 1.5 * magnitude - 1.2 * Math.log10(R);
  return Math.max(1, Math.min(12, Math.round(mmi * 10) / 10));
}

export function mmiToLabel(mmi: number): MmiLabel {
  if (mmi < 2) return 'I';
  if (mmi < 4) return 'II-III';
  if (mmi < 5) return 'IV';
  if (mmi < 6) return 'V';
  if (mmi < 7) return 'VI';
  if (mmi < 8) return 'VII';
  if (mmi < 9) return 'VIII';
  if (mmi < 10) return 'IX';
  return 'X+';
}

// ─── Regional seismicity rate ────────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

export function regionalSeismicityRate(events: readonly UsgsEvent[], now: number): RegionalSeismicityRate {
  const last24Cutoff = now - ONE_DAY_MS;
  const baselineCutoff = now - THIRTY_DAYS_MS;
  const last24h = events.filter((e) => e.time >= last24Cutoff).length;
  const baselineWindow = events.filter((e) => e.time >= baselineCutoff && e.time < last24Cutoff);
  const baselineDays = 29; // 30-day window minus the last 24h slice
  const baseline24h = baselineDays > 0 ? baselineWindow.length / baselineDays : 0;
  const ratio: number | null = baseline24h > 0 ? Math.round((last24h / baseline24h) * 100) / 100 : null;
  return {
    last24hCount: last24h,
    baseline24hCount: Math.round(baseline24h * 10) / 10,
    ratio,
    label: rateLabelFor(last24h, ratio),
  };
}

function rateLabelFor(count: number, ratio: number | null): RegionalSeismicityRate['label'] {
  // No baseline (e.g. brand-new instrument feed): fall back to
  // absolute count. ≥100 events with no quiet baseline still reads
  // as a swarm; sparse activity is just "elevated".
  if (ratio === null) {
    if (count >= 100) return 'swarm';
    return count > 0 ? 'elevated' : 'normal';
  }
  if (count >= 100 && ratio >= 3) return 'swarm';
  if (ratio >= 1.5) return 'elevated';
  if (ratio < 0.5 && count > 0) return 'quiet';
  return 'normal';
}

// ─── Historical context ──────────────────────────────────────────────

/**
 * "Largest event within ±2.5° lat/lon over the slice" — a simple
 * regional context string. Not a 100-year history (we don't ship
 * the catalog), but useful within the active feed window.
 */
export function historicalContextFor(event: UsgsEvent, all: readonly UsgsEvent[]): string {
  const nearby = all.filter((e) => Math.abs(e.lat - event.lat) <= 2.5 && Math.abs(e.lon - event.lon) <= 2.5);
  if (nearby.length === 0) return 'No nearby events in the active feed slice';
  const max = nearby.reduce((acc, e) => e.magnitude > acc.magnitude ? e : acc, nearby[0]!);
  if (max.id === event.id) return `Strongest event in this region in the active feed slice (${nearby.length} events)`;
  return `Strongest nearby: M${max.magnitude.toFixed(1)} ${max.place}`;
}

// ─── ShakeMap helpers ────────────────────────────────────────────────

const USGS_EVENT_BASE = 'https://earthquake.usgs.gov/earthquakes/eventpage';

export function shakemapUrlFor(eventId: string): string {
  return `${USGS_EVENT_BASE}/${encodeURIComponent(eventId)}/shakemap/intensity`;
}

// ─── Builder ─────────────────────────────────────────────────────────

export function buildEarthquakeIntelligence(events: readonly UsgsEvent[], now: number): EarthquakeIntelligenceState {
  const sorted = [...events].sort((a, b) => b.time - a.time);
  const significant = sorted.filter((e) => e.magnitude >= 4);
  const aftershockForecasts: Record<string, AftershockForecast> = {};
  for (const e of significant) {
    if (e.magnitude >= 5) {
      aftershockForecasts[e.id] = forecastAftershocks({ magnitude: e.magnitude, occurredAt: e.time });
    }
  }
  const summaries: EarthquakeSummary[] = significant.map((event) => {
    const fault = nearestFault({ lat: event.lat, lon: event.lon });
    const mmi = estimateMmi(event.magnitude, event.depthKm ?? 10);
    return {
      event,
      estimatedMmi: mmi,
      estimatedMmiLabel: mmiToLabel(mmi),
      fault,
      populationWithin50Km: estimatePopulationExposure(event.lat, event.lon, 50),
      historicalContext: historicalContextFor(event, sorted),
      shakemapUrl: shakemapUrlFor(event.id),
    };
  });
  return {
    generatedAt: now,
    significantEvents: summaries,
    allEvents: sorted,
    aftershockForecasts,
    regionalRate: regionalSeismicityRate(sorted, now),
  };
}

// ─── Parser for the /api/earthquakes sidecar response ────────────────

interface UsgsRow {
  id?: unknown;
  magnitude?: unknown;
  magnitudeType?: unknown;
  place?: unknown;
  time?: unknown;
  depth?: unknown;
  lat?: unknown;
  lon?: unknown;
  url?: unknown;
  tsunami?: unknown;
}

export function parseUsgsEvents(raw: unknown): UsgsEvent[] {
  const rows = extractRows(raw);
  const out: UsgsEvent[] = [];
  for (const r of rows) {
    const row = r as UsgsRow;
    const id = stringOrEmpty(row.id);
    const magnitude = numOrNull(row.magnitude);
    const time = numOrNull(row.time);
    const lat = numOrNull(row.lat);
    const lon = numOrNull(row.lon);
    if (!id || magnitude === null || time === null || lat === null || lon === null) continue;
    out.push({
      id,
      magnitude,
      magnitudeType: stringOrEmpty(row.magnitudeType) || null,
      place: stringOrEmpty(row.place) || 'unknown',
      time,
      depthKm: numOrNull(row.depth),
      lat,
      lon,
      url: stringOrEmpty(row.url) || undefined,
      tsunami: row.tsunami === 1 ? 1 : 0,
    });
  }
  return out;
}

// ─── Orchestrator ─────────────────────────────────────────────────────

export interface FetchEarthquakeOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: number;
}

let _lastState: EarthquakeIntelligenceState | null = null;

export async function fetchEarthquakeIntelligence(opts: FetchEarthquakeOptions = {}): Promise<EarthquakeIntelligenceState> {
  const baseUrl = opts.baseUrl ?? '/api/earthquake';
  const f = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? Date.now();
  const raw = await fetchSilent(f, `${baseUrl}/intelligence`);
  const events = parseUsgsEvents(raw);
  const state = buildEarthquakeIntelligence(events, now);
  _lastState = state;
  return state;
}

export function getEarthquakeState(): EarthquakeIntelligenceState | null {
  return _lastState;
}

export function _resetEarthquakeStateForTests(): void {
  _lastState = null;
}

async function fetchSilent(f: typeof fetch, url: string): Promise<unknown> {
  try {
    const r = await f(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json() as unknown;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function extractRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  for (const key of ['events', 'data', 'features']) {
    const v = r[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function stringOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
