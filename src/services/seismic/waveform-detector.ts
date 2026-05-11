/**
 * FDSN catalog pre-arrival detector — descoped Layer-6.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 * Compares the latest USGS FDSN catalog poll against the renderer's
 * current fused-event set and emits a "USGS detected, fusion pending"
 * badge for each catalog entry that fusion has not yet caught up to.
 * This buys early-warning time without paying for raw waveform parsing.
 *
 * Plan invariants:
 *   - The detector is a pure function over (catalog, fused, now). Polling
 *     cadence and seen-id memory live in the caller — the renderer's
 *     bridge is responsible for the 30 s tick and stable-id memory.
 *   - Cross-check rule: an event is "fusion-confirmed" when EITHER any
 *     observation in any fused group shares its source event id, OR a
 *     fused primary lies within 90 s and 50 km of the catalog entry —
 *     the same thresholds the dedupe layer uses.
 *   - Confirmed events are still emitted for one tick (with
 *     `fusionConfirmed: true`) so the UI can fade the badge gracefully
 *     instead of yanking it.
 *   - Stale catalog rows (older than `maxAgeMs`, default 10 min) are
 *     filtered before scoring; the detector reports actionable news,
 *     not historical residue.
 *
 * Future work: replace with Seedlink STA/LTA waveform detector — requires
 *               miniSEED Steim1/2 decoder + multi-station coincidence
 *               detection. The interface in this module is the right
 *               contract; a future implementation can keep the same
 *               `CatalogPreArrivalEvent` output shape so consumers don't
 *               change. Tracked as a follow-up to this descoped PR 9.
 */

import type { FusedSeismicEvent } from './seismic-fusion';

// ── Public types ────────────────────────────────────────────────────────

export interface PreArrivalCatalogEntry {
  /** USGS FDSN event id. */
  id: string;
  /** ms epoch of origin time. */
  occurredAt: number;
  lat: number;
  lon: number;
  magnitude: number | null;
  place?: string;
  /** Optional URL back to the USGS event page. */
  url?: string;
}

export interface PreArrivalDetectionInput {
  /** Recent USGS FDSN catalog entries (the polling result). */
  catalog: readonly PreArrivalCatalogEntry[];
  /** Currently-fused events (from seismic-fusion). */
  fused: readonly FusedSeismicEvent[];
  /** ms epoch — supplied by the caller for deterministic tests. */
  now: number;
  /** Maximum age in ms for a catalog entry to remain on the badge.
   *  Events older than this are filtered out. Default 600_000 (10 min). */
  maxAgeMs?: number;
}

export interface CatalogPreArrivalEvent {
  catalogEntry: PreArrivalCatalogEntry;
  /** ms since the catalog entry's origin time, computed against `now`. */
  ageMs: number;
  /** True when fusion already has a corroborating observation. The
   *  caller surfaces a different badge state for confirmed entries
   *  (and typically retires them on the next tick). */
  fusionConfirmed: boolean;
}

// ── Constants ───────────────────────────────────────────────────────────

/** Match thresholds copied from the dedupe layer so a catalog entry
 *  classified as "the same quake" by fusion is also classified as
 *  "fusion-confirmed" by this detector. */
const COINCIDENCE_TIME_MS = 90_000;
const COINCIDENCE_DISTANCE_KM = 50;
const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Find catalog entries that are visible to USGS but not yet to fusion.
 * Returns one entry per still-actionable catalog row. Caller decides
 * how to render the badge based on `fusionConfirmed`.
 *
 * Sorted by `ageMs` ascending (newest first) so the UI can take the
 * head of the list without sorting again.
 */
export function findPreArrivalEvents(
  input: PreArrivalDetectionInput,
): CatalogPreArrivalEvent[] {
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const out: CatalogPreArrivalEvent[] = [];

  for (const entry of input.catalog) {
    const ageMs = input.now - entry.occurredAt;
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) continue;

    const fusionConfirmed = isFusionConfirmed(entry, input.fused);
    out.push({ catalogEntry: entry, ageMs, fusionConfirmed });
  }

  out.sort((a, b) => a.ageMs - b.ageMs);
  return out;
}

/**
 * True when at least one fused-event observation already covers this
 * catalog entry. Two paths: source-event-id match, or coincidence on
 * (time, distance) thresholds matching the dedupe layer.
 */
export function isFusionConfirmed(
  entry: PreArrivalCatalogEntry,
  fused: readonly FusedSeismicEvent[],
): boolean {
  for (const fusedEvent of fused) {
    for (const observation of fusedEvent.observations) {
      if (observation.sourceEventId === entry.id) return true;
    }
    if (
      Math.abs(fusedEvent.primary.occurredAt - entry.occurredAt) <= COINCIDENCE_TIME_MS
      && haversineKm(
        fusedEvent.primary.lat,
        fusedEvent.primary.lon,
        entry.lat,
        entry.lon,
      ) <= COINCIDENCE_DISTANCE_KM
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Parse a USGS FDSN GeoJSON FeatureCollection (the response from the
 * sidecar `/api/fdsn-catalog` passthrough) into pre-arrival catalog
 * entries. Drops features missing id, location, or origin time.
 */
export function parseFdsnCatalog(payload: unknown): PreArrivalCatalogEntry[] {
  if (!payload || typeof payload !== 'object') return [];
  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];

  const out: PreArrivalCatalogEntry[] = [];
  for (const f of features) {
    const entry = parseCatalogFeature(f);
    if (entry) out.push(entry);
  }
  return out;
}

// ── Internal helpers ───────────────────────────────────────────────────

function parseCatalogFeature(f: unknown): PreArrivalCatalogEntry | null {
  if (!f || typeof f !== 'object') return null;
  const obj = f as Record<string, unknown>;
  const id = obj.id;
  if (typeof id !== 'string' || !id) return null;

  const props = obj.properties;
  if (!props || typeof props !== 'object') return null;
  const geom = obj.geometry;
  if (!geom || typeof geom !== 'object') return null;

  const coords = (geom as Record<string, unknown>).coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;

  const lon = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const occurredAt = parseOccurredAtMs((props as Record<string, unknown>).time);
  if (occurredAt === null) return null;

  const magnitude = parseMagnitude((props as Record<string, unknown>).mag);

  const place = (props as Record<string, unknown>).place;
  const url = (props as Record<string, unknown>).url;

  return {
    id,
    occurredAt,
    lat,
    lon,
    magnitude,
    place: typeof place === 'string' ? place : undefined,
    url: typeof url === 'string' ? url : undefined,
  };
}

function parseOccurredAtMs(time: unknown): number | null {
  if (typeof time === 'number' && Number.isFinite(time)) return time;
  if (typeof time === 'string' && time) {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseMagnitude(mag: unknown): number | null {
  if (typeof mag === 'number' && Number.isFinite(mag)) return mag;
  if (typeof mag === 'string' && mag) {
    const n = Number(mag);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const EARTH_RADIUS_KM = 6371;
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}
