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
import type { MissionEvent, MissionRecord } from './mission-types';
import { getMissionLedger } from './mission-state';

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

  // user_notified — only when the dispatcher would actually deliver.
  if (decision.urgency && !decision.shouldSuppress) {
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
