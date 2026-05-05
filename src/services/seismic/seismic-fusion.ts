/**
 * Multi-source seismic fusion — per
 * docs/CLAUDE_SEISMIC_INTELLIGENCE_SYSTEM_PLAN_2026-05-05.md Layer 2.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time. Takes
 * the deduped quake groups produced by the normalizer (Layer 1) and
 * produces `FusedSeismicEvent[]` with confidence + source-agreement +
 * magnitude / location spread metadata downstream layers (impact,
 * cascade, mission bridge) consume.
 *
 * Plan invariants (Layer 2 scoring rules):
 *   - USGS reviewed event: high trust.
 *   - USGS automatic + EMSC corroboration: boosted.
 *   - PAGER alert present: boosted for impact relevance.
 *   - Large disagreement in magnitude or location: lower confidence
 *     and surface conflict.
 *   - Single-source automatic M<4 event far from saved places: low
 *     relevance — expressed as low confidence here; saved-place
 *     relevance lives in Layer 3 (shaking estimator).
 */

import { dedupeCanonicalEvents, type DedupedQuakeGroup, type DedupeThresholds } from './seismic-normalizer';
import type { CanonicalSeismicEvent, SeismicSource } from './seismic-types';

// ── Public types ────────────────────────────────────────────────────────

export type SourceAgreement = 'single_source' | 'corroborated' | 'conflicting';

export interface FusedSeismicEvent {
  /** Canonical id from the primary observation. */
  id: string;
  primary: CanonicalSeismicEvent;
  /** All observations in the group, oldest first by occurredAt. */
  observations: CanonicalSeismicEvent[];
  /** Fused confidence in (0..1]. Combines primary's per-record
   *  confidence with corroboration boosts and conflict penalties. */
  confidence: number;
  sourceAgreement: SourceAgreement;
  /** Min/max magnitude across observations. `null` when no observation
   *  reports a magnitude. */
  magnitudeRange: [number, number] | null;
  /** Greatest pairwise great-circle distance across observations.
   *  `null` when there is only one observation. */
  locationSpreadKm: number | null;
  /** ms epoch of the most recent revision across observations. */
  latestUpdateAt: number;
}

// ── Public API ──────────────────────────────────────────────────────────

/** Pure fusion: takes deduped groups and produces fused events. */
export function fuseQuakeGroups(groups: readonly DedupedQuakeGroup[]): FusedSeismicEvent[] {
  return groups.map((group) => fuseGroup(group));
}

/** End-to-end fusion: normalize-then-dedupe-then-fuse. Takes already-
 *  normalized canonical events (as a single bag) and produces fused
 *  events. */
export function fuseCanonicalEvents(
  events: readonly CanonicalSeismicEvent[],
  thresholds: DedupeThresholds = {},
): FusedSeismicEvent[] {
  const groups = dedupeCanonicalEvents(events, thresholds);
  return fuseQuakeGroups(groups);
}

// ── Group-level fusion ─────────────────────────────────────────────────

function fuseGroup(group: DedupedQuakeGroup): FusedSeismicEvent {
  const observations = [...group.observations].sort((a, b) => a.occurredAt - b.occurredAt);
  const sources = new Set(observations.map((o) => o.source));
  const magnitudeRange = computeMagnitudeRange(observations);
  const locationSpreadKm = computeLocationSpreadKm(observations);
  const latestUpdateAt = observations.reduce(
    (acc, o) => Math.max(acc, o.updatedAt ?? o.occurredAt),
    0,
  );

  const sourceAgreement = classifyAgreement({
    sourceCount: sources.size,
    magnitudeRange,
    locationSpreadKm,
  });

  const confidence = scoreConfidence({
    primary: group.primary,
    sources,
    sourceAgreement,
  });

  return {
    id: group.primary.id,
    primary: group.primary,
    observations,
    confidence,
    sourceAgreement,
    magnitudeRange,
    locationSpreadKm,
    latestUpdateAt,
  };
}

// ── Source agreement classification ────────────────────────────────────

const CONFLICT_MAGNITUDE_DELTA = 0.5;
const CONFLICT_LOCATION_KM = 25;

function classifyAgreement(input: {
  sourceCount: number;
  magnitudeRange: [number, number] | null;
  locationSpreadKm: number | null;
}): SourceAgreement {
  if (input.sourceCount <= 1) return 'single_source';
  const magnitudeConflict = input.magnitudeRange !== null
    && input.magnitudeRange[1] - input.magnitudeRange[0] > CONFLICT_MAGNITUDE_DELTA;
  const locationConflict = input.locationSpreadKm !== null
    && input.locationSpreadKm > CONFLICT_LOCATION_KM;
  if (magnitudeConflict || locationConflict) return 'conflicting';
  return 'corroborated';
}

// ── Confidence scoring ─────────────────────────────────────────────────

const CONFIDENCE_BOUNDS: { min: number; max: number } = { min: 0, max: 1 };

function scoreConfidence(input: {
  primary: CanonicalSeismicEvent;
  sources: ReadonlySet<SeismicSource>;
  sourceAgreement: SourceAgreement;
}): number {
  let score = input.primary.confidence;

  // Plan rule: USGS automatic + EMSC corroboration boosts.
  const usgsAutomaticPlusEmsc =
    input.primary.source === 'usgs'
    && input.primary.status !== 'reviewed'
    && input.sources.has('emsc');
  if (usgsAutomaticPlusEmsc) score += 0.1;

  // Plan rule: PAGER alert present boosts impact relevance.
  if (input.sources.has('pager') || input.primary.pagerAlert) score += 0.05;

  // Plan rule: corroboration boost (any second source not already
  // captured by the USGS+EMSC clause).
  if (input.sourceAgreement === 'corroborated' && !usgsAutomaticPlusEmsc) {
    score += 0.05;
  }

  // Plan rule: conflict penalty — large magnitude or location spread.
  if (input.sourceAgreement === 'conflicting') score -= 0.15;

  // Plan rule: single-source automatic small quake → low confidence.
  if (
    input.sourceAgreement === 'single_source'
    && input.primary.status !== 'reviewed'
    && input.primary.magnitude !== null
    && input.primary.magnitude < 4
  ) {
    score -= 0.1;
  }

  return clamp(score, CONFIDENCE_BOUNDS.min, CONFIDENCE_BOUNDS.max);
}

// ── Math helpers ───────────────────────────────────────────────────────

function computeMagnitudeRange(events: readonly CanonicalSeismicEvent[]): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const event of events) {
    if (event.magnitude === null) continue;
    if (event.magnitude < min) min = event.magnitude;
    if (event.magnitude > max) max = event.magnitude;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return [min, max];
}

function computeLocationSpreadKm(events: readonly CanonicalSeismicEvent[]): number | null {
  if (events.length < 2) return null;
  let max = 0;
  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      const a = events[i]!;
      const b = events[j]!;
      const d = haversineKm(a.lat, a.lon, b.lat, b.lon);
      if (d > max) max = d;
    }
  }
  return max;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
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
