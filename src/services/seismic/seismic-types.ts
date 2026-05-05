/**
 * Canonical seismic event types — per
 * docs/CLAUDE_SEISMIC_INTELLIGENCE_SYSTEM_PLAN_2026-05-05.md Layer 1.
 *
 * Pure type module. No runtime, no DOM. Downstream layers (fusion,
 * shaking estimator, impact, cascade, mission bridge) consume these.
 *
 * Plan invariants:
 *   - Every canonical record is JSON-serializable (replay + audit
 *     trail).
 *   - Source-derived claims keep enough provenance (`source`,
 *     `sourceEventId`) to dedupe and to surface conflicts rather than
 *     averaging them away.
 */

export type SeismicSource =
  | 'usgs'
  | 'emsc'
  | 'pager'
  | 'gdacs'
  | 'tsunami'
  | 'shakealert';

export type SeismicEventStatus = 'automatic' | 'reviewed' | 'deleted' | 'unknown';

export type PagerAlert = 'green' | 'yellow' | 'orange' | 'red';

export interface CanonicalSeismicEvent {
  /** Stable canonical id. Built from `${source}:${sourceEventId}` so a
   *  USGS event and an EMSC event for the same physical quake do NOT
   *  collide — fusion is responsible for deduping. */
  id: string;
  source: SeismicSource;
  /** The native event id from the upstream feed (USGS event id, EMSC
   *  unid, PAGER feature id). */
  sourceEventId: string;
  magnitude: number | null;
  magnitudeType?: string;
  depthKm: number | null;
  lat: number;
  lon: number;
  place: string;
  /** ms epoch of the quake's origin time. */
  occurredAt: number;
  /** ms epoch of the most recent revision known to this record. */
  updatedAt?: number;
  status?: SeismicEventStatus;
  /** USGS sets `tsunami=1` when the event might generate a tsunami.
   *  Fusion treats this as a hint, not a confirmed warning. */
  tsunamiFlag?: boolean;
  pagerAlert?: PagerAlert;
  url?: string;
  /** Per-record confidence (0..1). The normalizer assigns a baseline
   *  by source/status; fusion can revise it later. */
  confidence: number;
}
