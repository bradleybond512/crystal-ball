/**
 * Situation detector — maps incoming high-severity ObservationEvents into
 * existing or freshly-created Situations.
 *
 * Matching rule (per the Phase 3 spec):
 *   same domain  ∧  within MATCH_RADIUS_KM (500)  ∧  within MATCH_WINDOW_MS (2h)
 *     → merge into existing
 *   otherwise → create a new Situation
 *
 * Severity gate: only CRITICAL / HIGH observations create situations on
 * their own. Lower-severity events can still be *linked* into an existing
 * situation by passing { force: true }.
 *
 * Side effects: emits `wm:situation-created` or `wm:situation-updated`
 * on `document`. Pure callers (tests, sidecar) can pass a custom dispatch
 * function or `null` to suppress.
 */

import type {
  ObservationEvent,
  ObservationSeverity,
  Situation,
  SituationSeverity,
} from '@/types/intelligence';
import {
  createSituation,
  findByDomain,
  haversineKm,
  updateSituation,
} from './situation-store';

export const MATCH_RADIUS_KM = 500;
export const MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;
export const AUTO_CREATE_SEVERITIES: ObservationSeverity[] = ['HIGH', 'CRITICAL'];

export type SituationEventName = 'wm:situation-created' | 'wm:situation-updated';

export type SituationDispatch = ((name: SituationEventName, detail: Situation) => void) | null;

export interface DetectOptions {
  /** Allow LOW / MEDIUM events to seed Situations too. Default false. */
  force?: boolean;
  /** Override the global clock — used by deterministic tests. */
  now?: number;
  /** Custom event sink. Defaults to `document.dispatchEvent`; pass `null`
   *  to suppress (sidecar / unit tests). */
  dispatch?: SituationDispatch;
}

const SEVERITY_MAP: Record<ObservationSeverity, SituationSeverity> = {
  INFO: 'info',
  LOW: 'low',
  MEDIUM: 'moderate',
  HIGH: 'high',
  CRITICAL: 'critical',
};

const SEVERITY_RANK: Record<SituationSeverity, number> = {
  info: 0, low: 1, moderate: 2, high: 3, critical: 4,
};

export function mapSeverity(obs: ObservationSeverity): SituationSeverity {
  return SEVERITY_MAP[obs];
}

export function shouldAutoCreate(severity: ObservationSeverity): boolean {
  return AUTO_CREATE_SEVERITIES.includes(severity);
}

/** Compare two severities; returns the stronger (max-rank) one. */
export function maxSeverity(a: SituationSeverity, b: SituationSeverity): SituationSeverity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/**
 * Find an existing situation that should absorb `event`, or null. Pure —
 * scans candidates by domain + space + time window.
 */
export function findMatchingSituation(
  event: ObservationEvent,
  candidates: Situation[],
  now: number,
): Situation | null {
  for (const sit of candidates) {
    if (situationMatchesEvent(sit, event, now)) return sit;
  }
  return null;
}

function situationMatchesEvent(
  sit: Situation,
  event: ObservationEvent,
  now: number,
): boolean {
  if (sit.status === 'resolved') return false;
  if (sit.domain !== event.domain) return false;
  if (now - sit.updatedAt > MATCH_WINDOW_MS) return false;
  if (Math.abs(event.timestamp - sit.updatedAt) > MATCH_WINDOW_MS) return false;
  return locationMatches(event.location, sit.location);
}

function locationMatches(
  eventLoc: ObservationEvent['location'] | undefined,
  sitLoc: Situation['location'] | undefined,
): boolean {
  // No-location events tie to no-location situations by domain + time only.
  if (!eventLoc || !sitLoc) return !eventLoc && !sitLoc;
  const distKm = haversineKm(eventLoc.lat, eventLoc.lon, sitLoc.lat, sitLoc.lon);
  return distKm <= MATCH_RADIUS_KM;
}

/** Format the default Situation summary for an auto-created entry. */
export function buildAutoSummary(event: ObservationEvent): string {
  const loc = event.location;
  const place = loc ? ` near ${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°` : '';
  return `${event.title}${place} — ${event.severity.toLowerCase()} severity (${event.sourceId}).`;
}

function defaultDispatch(name: SituationEventName, detail: Situation): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Run the detect-or-create flow for a single ObservationEvent.
 *
 * Returns the resulting Situation, or `null` if the event was below the
 * auto-create severity gate AND no existing situation matched.
 */
export function detect(
  event: ObservationEvent,
  options: DetectOptions = {},
): Situation | null {
  const now = options.now ?? Date.now();
  const dispatch = options.dispatch === null
    ? null
    : (options.dispatch ?? defaultDispatch);
  const allowCreate = options.force === true || shouldAutoCreate(event.severity);
  const candidates = findByDomain(event.domain);
  const existing = findMatchingSituation(event, candidates, now);
  if (existing) {
    const updated = updateSituation(existing.id, {
      observationIds: [event.id],
      tags: event.tags,
      severity: maxSeverity(existing.severity, mapSeverity(event.severity)),
      updatedAt: now,
    });
    dispatch?.('wm:situation-updated', updated);
    return updated;
  }
  if (!allowCreate) return null;
  const situation = createSituation({
    name: event.title,
    status: 'active',
    severity: mapSeverity(event.severity),
    domain: event.domain,
    startedAt: event.timestamp,
    observationIds: [event.id],
    correlationIds: [],
    summary: buildAutoSummary(event),
    location: event.location
      ? { lat: event.location.lat, lon: event.location.lon,
          radiusKm: event.location.radiusKm ?? MATCH_RADIUS_KM }
      : undefined,
    tags: event.tags,
    confidence: 0.6,
  });
  dispatch?.('wm:situation-created', situation);
  return situation;
}

/** Test seam — module-level state lives only in situation-store, but this
 *  re-export keeps imports symmetric. */
export { __reset as resetForTests } from './situation-store';
