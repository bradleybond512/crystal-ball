/**
 * Static catalog of every external data feed Crystal Ball polls, plus
 * the pure helpers that derive a 🟢 / 🟡 / 🔴 status from a feed's poll
 * interval and last-success / last-error timestamps.
 */

import type { DataSourceId } from '@/services/data-freshness';

export type FeedHealth = 'fresh' | 'stale' | 'error' | 'never';

/** A logical feed shown in the FeedHealthPanel. */
export interface FeedDefinition {
  /** Stable id used as the row's React key / dedupe handle. */
  id: string;
  /** User-visible label, e.g. "USGS Earthquakes". */
  name: string;
  /** Display category — used to group rows. */
  category: 'natural' | 'space' | 'fire' | 'air' | 'energy' | 'cyber' | 'data' | 'aviation' | 'maritime';
  /** External endpoint URL displayed in the panel (no auth headers leaked). */
  endpoint: string;
  /** Nominal poll interval in ms; status thresholds key off this value. */
  pollIntervalMs: number;
  /** Optional DataSourceId backing this feed in data-freshness. The panel
   *  prefers data-freshness state for sources that have it; rows without
   *  a sourceId fall back to the sidecar /api/health feeds[] payload. */
  sourceId?: DataSourceId;
  /** Sidecar route name used to look up the feed in /api/health.feeds[]
   *  if the sidecar exposes per-feed status. */
  sidecarKey?: string;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/**
 * Catalog covering the spec-mandated feed list. Order is the display order
 * in the panel. New feeds get appended; never re-ordered (test pins the
 * first 18 entries to lock the panel layout).
 */
export const FEED_CATALOG: FeedDefinition[] = [
  // ── Natural hazards ────────────────────────────────────────────────────
  { id: 'usgs-earthquakes', name: 'USGS Earthquakes', category: 'natural',
    endpoint: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',
    pollIntervalMs: 60 * 1000, sourceId: 'usgs', sidecarKey: 'usgs' },
  { id: 'nws-alerts', name: 'NWS Alerts', category: 'natural',
    endpoint: 'https://api.weather.gov/alerts/active',
    pollIntervalMs: 60 * 1000, sourceId: 'nws-alerts', sidecarKey: 'nws-alerts' },
  { id: 'nhc-tropical', name: 'NHC Tropical Cyclones', category: 'natural',
    endpoint: 'https://www.nhc.noaa.gov/CurrentStorms.json',
    pollIntervalMs: 5 * MIN, sourceId: 'tropical-cyclones', sidecarKey: 'nhc' },
  // ── Space weather ──────────────────────────────────────────────────────
  { id: 'swpc-xray', name: 'SWPC X-ray Flux', category: 'space',
    endpoint: 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json',
    pollIntervalMs: 5 * MIN, sourceId: 'space-weather', sidecarKey: 'swpc-xray' },
  { id: 'swpc-kp', name: 'SWPC Planetary Kp', category: 'space',
    endpoint: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
    pollIntervalMs: 5 * MIN, sourceId: 'space-weather', sidecarKey: 'swpc-kp' },
  // ── Fire ───────────────────────────────────────────────────────────────
  { id: 'firms-modis', name: 'NASA FIRMS MODIS', category: 'fire',
    endpoint: 'https://firms.modaps.eosdis.nasa.gov/api/area/csv/MODIS_NRT/world',
    pollIntervalMs: 30 * MIN, sourceId: 'firms', sidecarKey: 'firms-modis' },
  { id: 'firms-viirs', name: 'NASA FIRMS VIIRS', category: 'fire',
    endpoint: 'https://firms.modaps.eosdis.nasa.gov/api/area/csv/VIIRS_SNPP_NRT/world',
    pollIntervalMs: 30 * MIN, sourceId: 'firms', sidecarKey: 'firms-viirs' },
  { id: 'nifc-perimeters', name: 'NIFC Fire Perimeters', category: 'fire',
    endpoint: 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query',
    pollIntervalMs: 15 * MIN, sourceId: 'inciweb', sidecarKey: 'nifc' },
  // ── Air quality ────────────────────────────────────────────────────────
  { id: 'airnow-aqi', name: 'AirNow AQI', category: 'air',
    endpoint: 'https://www.airnowapi.org/aq/observation/zipCode/current/',
    pollIntervalMs: 15 * MIN, sourceId: 'air-quality', sidecarKey: 'airnow' },
  { id: 'purpleair', name: 'PurpleAir Sensors', category: 'air',
    endpoint: 'https://api.purpleair.com/v1/sensors',
    pollIntervalMs: 10 * MIN, sourceId: 'air-quality', sidecarKey: 'purpleair' },
  // ── Energy / grid ──────────────────────────────────────────────────────
  { id: 'eia-930', name: 'EIA-930 Grid', category: 'energy',
    endpoint: 'https://api.eia.gov/v2/electricity/rto/region-data/data',
    pollIntervalMs: HOUR, sourceId: 'power-grid', sidecarKey: 'eia-930' },
  { id: 'poweroutage-us', name: 'PowerOutage.us', category: 'energy',
    endpoint: 'https://poweroutage.us/api/web/states',
    pollIntervalMs: 5 * MIN, sourceId: 'power-grid-alerts', sidecarKey: 'poweroutage' },
  { id: 'radnet', name: 'EPA RadNet', category: 'energy',
    endpoint: 'https://www.epa.gov/radnet',
    pollIntervalMs: HOUR, sourceId: 'radiation-monitoring', sidecarKey: 'radnet' },
  // ── Cyber / network ────────────────────────────────────────────────────
  { id: 'cloudflare-bgp', name: 'Cloudflare Radar BGP', category: 'cyber',
    endpoint: 'https://api.cloudflare.com/client/v4/radar/bgp/timeseries',
    pollIntervalMs: 10 * MIN, sourceId: 'internet-outages', sidecarKey: 'cloudflare-bgp' },
  { id: 'otx', name: 'AlienVault OTX', category: 'cyber',
    endpoint: 'https://otx.alienvault.com/api/v1/pulses/subscribed',
    pollIntervalMs: 30 * MIN, sourceId: 'cyber_threats', sidecarKey: 'otx' },
  // ── Open-source intel ──────────────────────────────────────────────────
  { id: 'gdelt', name: 'GDELT Doc API', category: 'data',
    endpoint: 'https://api.gdeltproject.org/api/v2/doc/doc',
    pollIntervalMs: 15 * MIN, sourceId: 'gdelt', sidecarKey: 'gdelt' },
  { id: 'acled', name: 'ACLED Conflict', category: 'data',
    endpoint: 'https://api.acleddata.com/acled/read',
    pollIntervalMs: HOUR, sourceId: 'acled_conflict', sidecarKey: 'acled' },
  // ── Markets ────────────────────────────────────────────────────────────
  { id: 'fred', name: 'FRED Economic', category: 'data',
    endpoint: 'https://fred.stlouisfed.org/graph/fredgraph.csv',
    pollIntervalMs: HOUR, sourceId: 'economic', sidecarKey: 'fred' },
  // ── Aviation ───────────────────────────────────────────────────────────
  { id: 'opensky', name: 'OpenSky Network', category: 'aviation',
    endpoint: 'https://opensky-network.org/api/states/all',
    pollIntervalMs: 90 * 1000, sourceId: 'opensky', sidecarKey: 'opensky' },
  // ── Maritime ───────────────────────────────────────────────────────────
  { id: 'ais', name: 'AISStream Vessels', category: 'maritime',
    endpoint: 'wss://stream.aisstream.io/v0/stream',
    pollIntervalMs: 30 * 1000, sourceId: 'ais', sidecarKey: 'ais' },
  // ── Appended feeds (order-pinned above; append-only below) ────────────
  { id: 'smoke-forecast', name: 'Smoke Forecast (Open-Meteo AQ)', category: 'air',
    endpoint: 'https://air-quality-api.open-meteo.com/v1/air-quality',
    pollIntervalMs: 30 * MIN, sourceId: 'smoke_forecast' },
];

/** Spec-mandated minimum count — the panel wires up at least this many feeds. */
export const FEED_CATALOG_MIN_COUNT = 18;

// ── Status helpers ─────────────────────────────────────────────────────────

const FRESH_INTERVAL_MULTIPLIER = 2;
const STALE_INTERVAL_MULTIPLIER = 10;

export interface FeedSnapshot {
  /** Feed id from FEED_CATALOG. */
  id: string;
  /** Last successful fetch, ms since epoch — null if never. */
  lastSuccessAt: number | null;
  /** Last error message — null when the last fetch succeeded or no fetches yet. */
  lastError: string | null;
  /** Last attempt (success or fail), ms since epoch — null if never. */
  lastAttemptAt: number | null;
}

export interface FeedRow extends FeedSnapshot {
  name: string;
  endpoint: string;
  category: FeedDefinition['category'];
  pollIntervalMs: number;
  status: FeedHealth;
}

/**
 * Decide a feed's health colour from its poll interval and the latest
 * snapshot. Spec semantics:
 *   🟢 fresh  — last success ≤ 2× pollIntervalMs ago AND no error on last fetch
 *   🟡 stale  — last success between 2× and 10× pollIntervalMs ago
 *   🔴 error  — last fetch errored (regardless of age) OR ≥ 10× interval stale
 *   ⚪ never  — feed has never reported a success/error
 */
export function classifyFeedHealth(
  snapshot: FeedSnapshot,
  pollIntervalMs: number,
  nowMs: number,
): FeedHealth {
  if (snapshot.lastSuccessAt === null && snapshot.lastError === null && snapshot.lastAttemptAt === null) {
    return 'never';
  }
  if (snapshot.lastError && (snapshot.lastSuccessAt === null
    || (snapshot.lastAttemptAt !== null && snapshot.lastAttemptAt > snapshot.lastSuccessAt))) {
    return 'error';
  }
  if (snapshot.lastSuccessAt === null) return 'never';
  const ageMs = nowMs - snapshot.lastSuccessAt;
  if (ageMs <= pollIntervalMs * FRESH_INTERVAL_MULTIPLIER) return 'fresh';
  if (ageMs <= pollIntervalMs * STALE_INTERVAL_MULTIPLIER) return 'stale';
  return 'error';
}

/** Merge a list of snapshots against the static catalog into ready-to-render
 *  rows. Snapshots can be sparse — feeds not in the snapshot map fall to
 *  status `never`. */
export function buildFeedRows(
  catalog: FeedDefinition[],
  snapshots: Record<string, FeedSnapshot>,
  nowMs: number,
): FeedRow[] {
  return catalog.map((def) => {
    const snap = snapshots[def.id] ?? {
      id: def.id, lastSuccessAt: null, lastError: null, lastAttemptAt: null,
    };
    return {
      id: def.id,
      name: def.name,
      endpoint: def.endpoint,
      category: def.category,
      pollIntervalMs: def.pollIntervalMs,
      lastSuccessAt: snap.lastSuccessAt,
      lastError: snap.lastError,
      lastAttemptAt: snap.lastAttemptAt,
      status: classifyFeedHealth(snap, def.pollIntervalMs, nowMs),
    };
  });
}

export interface FeedHealthSummary {
  total: number;
  fresh: number;
  stale: number;
  error: number;
  never: number;
}

/** Roll-up counts shown in the panel header / sidebar badge. */
export function summarizeFeedHealth(rows: FeedRow[]): FeedHealthSummary {
  const out: FeedHealthSummary = { total: rows.length, fresh: 0, stale: 0, error: 0, never: 0 };
  for (const r of rows) {
    out[r.status] += 1;
  }
  return out;
}

/** Format the "last poll" column. Empty string for never-polled feeds. */
export function formatLastPoll(snapshot: FeedSnapshot, nowMs: number): string {
  const at = snapshot.lastSuccessAt ?? snapshot.lastAttemptAt;
  if (at === null) return '—';
  const ageMs = nowMs - at;
  if (ageMs < 60_000) return 'just now';
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
