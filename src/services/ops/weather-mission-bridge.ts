/**
 * Weather → Mission Ledger bridge.
 *
 * Converts a `WeatherDispatchDecision` into mission ledger writes:
 *   - On a fresh matched alert: `openMission()` for the saved place,
 *     followed by `app_watch` (the polygon match) and—when urgency
 *     dispatched a notification—`user_notified`.
 *   - On a re-route of the same alert (same `alertId`): only append
 *     new events. The mission stays open until resolution.
 *
 * Why this exists: PR 2 of
 * docs/CLAUDE_BACKTEST_SELF_IMPROVEMENT_HANDOFF_2026-04-28.md asks for
 * "real warning decisions open or update a mission" so time-to-warn
 * can be measured per-place. Keeping the bridge separate from
 * `routeWeatherAlert` preserves the router's pure-function shape.
 */

import type { WeatherDispatchDecision } from '@/services/weather/weather-warning-router';
import { routeWeatherAlert } from '@/services/weather/weather-warning-router';
import type { NwsAlertMinimal, SavedPlace, WeatherSeverity } from '@/services/weather/weather-threat-types';
import type { MissionEvent, MissionRecord } from './mission-types';
import { getMissionLedger } from './mission-state';

// ── Adapter: legacy WeatherAlert → NwsAlertMinimal ──────────────────────
// `src/services/weather.ts` `WeatherAlert` is the renderer's current
// shape; the polygon-matching engine wants `NwsAlertMinimal`. This
// adapter avoids forcing every caller to know the difference.

interface LegacyWeatherAlertLike {
  id: string;
  event: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  headline?: string;
  onset: Date | string;
  expires: Date | string;
  /** Single-ring polygon. The matcher accepts an array of rings; we
   *  wrap the single ring before forwarding. */
  coordinates?: readonly (readonly [number, number])[];
}

const SEVERITY_LOWER: Record<LegacyWeatherAlertLike['severity'], WeatherSeverity> = {
  Extreme: 'extreme',
  Severe: 'severe',
  Moderate: 'moderate',
  Minor: 'minor',
  Unknown: 'unknown',
};

function toIsoString(d: Date | string): string {
  return typeof d === 'string' ? d : d.toISOString();
}

export function legacyAlertToNwsMinimal(alert: LegacyWeatherAlertLike): NwsAlertMinimal {
  const ring = alert.coordinates && alert.coordinates.length >= 3
    ? alert.coordinates.map(([lng, lat]) => [lng, lat] as [number, number])
    : undefined;
  return {
    id: alert.id,
    event: alert.event,
    polygon: ring ? { rings: [ring] } : undefined,
    sent: toIsoString(alert.onset),
    expires: toIsoString(alert.expires),
    severity: SEVERITY_LOWER[alert.severity],
    headline: alert.headline,
    messageType: 'alert',
  };
}

/**
 * Bridge a weather dispatch decision into the mission ledger.
 *
 * Returns the mission record (newly opened or already-existing) plus
 * the events appended on this call. When the decision has no match or
 * is fully suppressed, returns `undefined` — there's nothing useful
 * to track.
 */
export function bridgeWeatherDecisionToMission(
  decision: WeatherDispatchDecision,
  options: { now?: number; explanationScore?: number } = {},
): { mission: MissionRecord; appendedEvents: MissionEvent[] } | undefined {
  const at = options.now ?? Date.now();
  if (!decision.match || decision.match.matchKind === 'no_match' || !decision.matchedPlaceId) return undefined;
  // Suppressed decisions (quiet-hours blocked, dispatcher refused, etc.)
  // intentionally weren't surfaced to the user. Recording them as
  // active missions would pollute time-to-warn / near-miss data with
  // alerts that the router deliberately silenced.
  if (decision.shouldSuppress) return undefined;

  const ledger = getMissionLedger();
  const missionId = `weather-${decision.alertId}-${decision.matchedPlaceId}`;
  const mission = ledger.get(missionId) ?? ledger.openMission({
    id: missionId,
    domain: 'weather_safety',
    description: `${decision.match.hazardKind} alert near ${decision.matchedPlaceLabel ?? decision.matchedPlaceId}`,
    createdAt: at,
    factId: decision.alertId,
    placeId: decision.matchedPlaceId,
    originAlgorithmId: 'weather-urgency',
    explanationScore: options.explanationScore,
  });

  const appendedEvents: MissionEvent[] = [];

  // app_watch — polygon match recorded the moment the app saw it.
  // Only append once per mission (on initial open).
  const alreadyHasAppWatch = mission.events.some((e) => e.kind === 'app_watch');
  if (!alreadyHasAppWatch) {
    appendedEvents.push(ledger.recordEvent(missionId, {
      at,
      kind: 'app_watch',
      label: `${decision.match.matchKind} match`,
      detail: {
        threatLevel: decision.match.threatLevel,
        matchKind: decision.match.matchKind,
        hazardKind: decision.match.hazardKind,
        distanceKm: decision.match.distanceKm,
      },
    }));
  }

  // user_notified — only when the dispatcher actually surfaced the
  // alert to the user *now*. The 'digest' priority queues the alert
  // for the next morning/evening digest; recording user_notified at
  // routing time would skew time-to-warn metrics that read this
  // event's timestamp as the warning moment. Digest delivery should
  // emit user_notified at digest-render time instead (future PR).
  const isDigestQueue = decision.urgency?.priority === 'digest';
  if (decision.urgency && !isDigestQueue) {
    appendedEvents.push(ledger.recordEvent(missionId, {
      at,
      kind: 'user_notified',
      label: decision.urgency.priority,
      detail: {
        priority: decision.urgency.priority,
        persistentInApp: decision.urgency.persistentInApp,
        dispatchActions: decision.dispatchActions,
        reason: decision.reason,
      },
    }));
  }

  return { mission: ledger.get(missionId)!, appendedEvents };
}

// ── Production orchestrator ─────────────────────────────────────────────
//
// Single entry point the data-loader can call once weather alerts have
// been fetched. Per (alert × place) pair, runs the polygon match +
// urgency engine + mission bridge. Returns the mission records that
// were opened or updated so callers can plumb them into the diagnostic
// panel without re-querying the ledger.
//
// Plan invariant: this is the ONLY place that wires legacy weather
// alerts into the closed-loop layer. Adding more downstream consumers
// (notification dispatcher, time-to-warn calculator, etc.) means
// reading from `getMissionLedger()`, not duplicating the routing call.

export interface RouteAndBridgeResult {
  /** Stable alert id this entry covers. */
  alertId: string;
  /** Stable place id matched against. */
  placeId: string;
  /** Underlying dispatch decision. */
  decision: WeatherDispatchDecision;
  /** Mission record (newly opened or already-existing) — `undefined`
   *  when the bridge intentionally skipped (no_match / suppressed). */
  mission?: MissionRecord;
}

/** SavedPlace shape that the personal-impact / insights-state layer
 *  uses. The weather router wants a different shape; we convert. */
export interface PersonalSavedPlaceLike {
  placeId: string;
  label: string;
  latitude: number;
  longitude: number;
}

function toWeatherSavedPlace(p: PersonalSavedPlaceLike): SavedPlace {
  return { id: p.placeId, label: p.label, lat: p.latitude, lon: p.longitude };
}

export function routeAndBridgeWeatherAlerts(
  alerts: readonly LegacyWeatherAlertLike[],
  places: readonly PersonalSavedPlaceLike[],
  options: { now?: number } = {},
): RouteAndBridgeResult[] {
  const at = options.now ?? Date.now();
  const weatherPlaces = places.map((p) => toWeatherSavedPlace(p));
  const out: RouteAndBridgeResult[] = [];
  for (const alert of alerts) {
    const minimal = legacyAlertToNwsMinimal(alert);
    const decision = routeWeatherAlert(minimal, weatherPlaces, { now: at });
    // Only emit a result when the alert actually concerned a saved
    // place (real polygon match or zone match). routeWeatherAlert
    // returns a matchedPlaceId even for no_match strongest-pick rows;
    // we discard those here so the closed-loop layer doesn't see
    // 5,000 daily NWS alerts the user has no relationship to.
    if (!decision.matchedPlaceId || decision.match?.matchKind === 'no_match') continue;
    const bridgeResult = bridgeWeatherDecisionToMission(decision, { now: at });
    out.push({
      alertId: alert.id,
      placeId: decision.matchedPlaceId,
      decision,
      mission: bridgeResult?.mission,
    });
  }
  return out;
}
