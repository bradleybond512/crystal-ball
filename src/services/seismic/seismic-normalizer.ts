/**
 * Seismic event normalizer — per
 * docs/CLAUDE_SEISMIC_INTELLIGENCE_SYSTEM_PLAN_2026-05-05.md Layer 1.
 *
 * Pure deterministic. No DOM, no fetch, no globals. Takes USGS / EMSC /
 * PAGER feed shapes and returns `CanonicalSeismicEvent[]`. Also exposes
 * a cross-source dedupe helper that groups feed entries that almost
 * certainly describe the same physical quake.
 *
 * Plan invariants:
 *   - Reviewed USGS / PAGER values win on conflict.
 *   - Alternate-source observations are preserved (the dedupe helper
 *     keeps the loser, it does not throw it away — fusion uses them
 *     for corroboration scoring).
 *   - Every output is JSON-serializable.
 */

import type { Earthquake } from '@/generated/client/crystalball/seismology/v1/service_client';
import type { EmscEvent } from '../emsc-seismic';
import type { PagerEvent } from '../usgs-pager';
import type {
  CanonicalSeismicEvent,
  
  SeismicSource,
} from './seismic-types';

// ── Public API ─────────────────────────────────────────────────────────

/** Normalize a USGS earthquake from the generated Seismology RPC type. */
export function normalizeUsgsEarthquake(quake: Earthquake): CanonicalSeismicEvent {
  return {
    id: makeCanonicalId('usgs', quake.id),
    source: 'usgs',
    sourceEventId: quake.id,
    magnitude: Number.isFinite(quake.magnitude) ? quake.magnitude : null,
    depthKm: Number.isFinite(quake.depthKm) ? quake.depthKm : null,
    lat: quake.location?.latitude ?? 0,
    lon: quake.location?.longitude ?? 0,
    place: quake.place,
    occurredAt: quake.occurredAt,
    status: 'unknown',
    url: quake.sourceUrl || undefined,
    confidence: defaultConfidenceFor('usgs', 'unknown'),
  };
}

/** Normalize an EMSC FDSN-style event. */
export function normalizeEmscEvent(event: EmscEvent): CanonicalSeismicEvent | null {
  if (!event.id || !event.time) return null;
  const occurredAt = Date.parse(event.time);
  if (!Number.isFinite(occurredAt)) return null;
  return {
    id: makeCanonicalId('emsc', event.id),
    source: 'emsc',
    sourceEventId: event.id,
    magnitude: event.magnitude,
    magnitudeType: event.magnitudeType ?? undefined,
    depthKm: event.depth,
    lat: event.lat,
    lon: event.lon,
    place: event.region ?? '',
    occurredAt,
    status: 'unknown',
    confidence: defaultConfidenceFor('emsc', 'unknown'),
  };
}

/** Normalize a USGS PAGER event. PAGER carries the impact alert level
 *  but is otherwise the same physical quake as the USGS feed entry. */
export function normalizePagerEvent(event: PagerEvent): CanonicalSeismicEvent {
  return {
    id: makeCanonicalId('pager', event.id),
    source: 'pager',
    sourceEventId: event.id,
    magnitude: Number.isFinite(event.magnitude) ? event.magnitude : null,
    depthKm: Number.isFinite(event.depth) ? event.depth : null,
    lat: event.lat,
    lon: event.lon,
    place: event.place,
    occurredAt: event.time.getTime(),
    updatedAt: event.updatedAt.getTime(),
    // PAGER summaries are reviewed by USGS NEIC analysts before the
    // alert level is assigned, so treat them as reviewed.
    status: 'reviewed',
    pagerAlert: event.alertLevel,
    url: event.url || undefined,
    confidence: defaultConfidenceFor('pager', 'reviewed'),
  };
}

// ── Dedupe ─────────────────────────────────────────────────────────────

/** Two records refer to the same physical quake when they fall inside
 *  every threshold below. Defaults are deliberately tight to avoid
 *  fusing distinct nearby quakes. */
export interface DedupeThresholds {
  /** Max time delta in ms. Default 90 s — feed timestamps drift by
   *  a few seconds across providers; reviewed updates can land minutes
   *  later. */
  maxTimeDeltaMs?: number;
  /** Max great-circle distance in km. Default 50 km. */
  maxDistanceKm?: number;
  /** Max magnitude delta. Default 0.5 — magnitude revisions of more
   *  than half a unit usually mean the quake was misidentified, not
   *  re-estimated. */
  maxMagnitudeDelta?: number;
}

/** A group of canonical records that all describe the same quake. */
export interface DedupedQuakeGroup {
  /** The "best" record in the group, chosen by source priority +
   *  reviewed status. Fusion treats this as the authoritative summary. */
  primary: CanonicalSeismicEvent;
  /** Every record in the group, oldest first by occurredAt. Includes
   *  `primary`. Preserved so fusion can cite corroborating sources. */
  observations: CanonicalSeismicEvent[];
}

/** Group canonical records into per-physical-quake clusters. Records
 *  with matching `sourceEventId` always cluster (USGS PAGER is the
 *  same event id space as USGS earthquakes). Records from different
 *  sources cluster only when time / distance / magnitude deltas all
 *  fall under the thresholds. */
export function dedupeCanonicalEvents(
  events: readonly CanonicalSeismicEvent[],
  thresholds: DedupeThresholds = {},
): DedupedQuakeGroup[] {
  const maxTimeDeltaMs = thresholds.maxTimeDeltaMs ?? 90_000;
  const maxDistanceKm = thresholds.maxDistanceKm ?? 50;
  const maxMagnitudeDelta = thresholds.maxMagnitudeDelta ?? 0.5;

  const sorted = [...events].sort((a, b) => a.occurredAt - b.occurredAt);
  const groups: CanonicalSeismicEvent[][] = [];

  for (const event of sorted) {
    const matchIndex = findGroupIndex(groups, event, {
      maxTimeDeltaMs,
      maxDistanceKm,
      maxMagnitudeDelta,
    });
    if (matchIndex === -1) {
      groups.push([event]);
    } else {
      groups[matchIndex]!.push(event);
    }
  }

  return groups.map((bucket) => ({
    primary: pickPrimary(bucket),
    observations: [...bucket].sort((a, b) => a.occurredAt - b.occurredAt),
  }));
}

// ── Helpers ────────────────────────────────────────────────────────────

function findGroupIndex(
  groups: readonly (readonly CanonicalSeismicEvent[])[],
  event: CanonicalSeismicEvent,
  t: Required<DedupeThresholds>,
): number {
  for (const [i, group] of groups.entries()) {
    if (group!.some((member) => sameQuake(member, event, t))) return i;
  }
  return -1;
}

function sameQuake(
  a: CanonicalSeismicEvent,
  b: CanonicalSeismicEvent,
  t: Required<DedupeThresholds>,
): boolean {
  // Same source-event-id (e.g. USGS event + USGS PAGER) — always
  // groups, regardless of time/distance drift in revisions.
  if (a.sourceEventId === b.sourceEventId) return true;
  if (Math.abs(a.occurredAt - b.occurredAt) > t.maxTimeDeltaMs) return false;
  if (haversineKm(a.lat, a.lon, b.lat, b.lon) > t.maxDistanceKm) return false;
  if (a.magnitude !== null && b.magnitude !== null && Math.abs(a.magnitude - b.magnitude) > t.maxMagnitudeDelta) return false;
  return true;
}

const SOURCE_PRIORITY: Record<SeismicSource, number> = {
  shakealert: 6,
  pager: 5,
  usgs: 4,
  // Regional authoritative networks rank with USGS for events in their
  // jurisdictions — they review faster than the global feed in those
  // regions. Ordered alphabetically among themselves to keep ties stable.
  geonet: 4,
  geofon: 4,
  ingv: 4,
  jma: 4,
  gdacs: 3,
  emsc: 2,
  tsunami: 1,
};

/** Choose the most authoritative record in a group:
 *  1. `reviewed` beats `automatic` beats `unknown`.
 *  2. Source priority breaks ties.
 *  3. Most recent `updatedAt` (or `occurredAt` fallback) breaks
 *     remaining ties — newer revisions reflect later analyst input. */
function pickPrimary(bucket: readonly CanonicalSeismicEvent[]): CanonicalSeismicEvent {
  const sorted = [...bucket].sort((a, b) => {
    const statusDelta = statusRank(b.status) - statusRank(a.status);
    if (statusDelta !== 0) return statusDelta;
    const sourceDelta = SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source];
    if (sourceDelta !== 0) return sourceDelta;
    const updatedB = b.updatedAt ?? b.occurredAt;
    const updatedA = a.updatedAt ?? a.occurredAt;
    return updatedB - updatedA;
  });
  return sorted[0]!;
}

function statusRank(status: CanonicalSeismicEvent['status']): number {
  switch (status) {
    case 'reviewed': { return 3;
    }
    case 'automatic': { return 2;
    }
    case 'deleted': { return 0;
    }
    default: { return 1;
    }
  }
}

/** Default per-record confidence by source + status. Fusion can revise
 *  this when corroborating sources are present. */
function defaultConfidenceFor(
  source: SeismicSource,
  status: CanonicalSeismicEvent['status'],
): number {
  const base = (() => {
    switch (source) {
      case 'shakealert': { return 0.9;
      }
      case 'pager': { return 0.85;
      }
      case 'usgs': { return 0.7;
      }
      // Regional authoritative networks: similar baseline to USGS for
      // their own jurisdictions where they review fastest.
      case 'geonet': { return 0.7;
      }
      case 'geofon': { return 0.7;
      }
      case 'ingv': { return 0.7;
      }
      case 'jma': { return 0.7;
      }
      case 'gdacs': { return 0.65;
      }
      case 'emsc': { return 0.6;
      }
      case 'tsunami': { return 0.55;
      }
    }
  })();
  if (status === 'reviewed') return Math.min(1, base + 0.1);
  if (status === 'automatic') return base;
  if (status === 'deleted') return 0;
  return base;
}

function makeCanonicalId(source: SeismicSource, sourceEventId: string): string {
  return `${source}:${sourceEventId}`;
}

const EARTH_RADIUS_KM = 6371;
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/** Re-export for downstream layers that want the source priority
 *  ordering without re-deriving it. */
export const __SOURCE_PRIORITY = SOURCE_PRIORITY;
/** Re-export the alert-level type so consumers can import a single
 *  module instead of crossing into `seismic-types.ts` for it. */


export {type PagerAlert} from './seismic-types';