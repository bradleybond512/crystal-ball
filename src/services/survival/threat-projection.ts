// src/services/survival/threat-projection.ts
import type { NwsAlertMinimal, SavedPlace } from '../weather/weather-threat-types.ts';
import { matchAlertToPlace } from '../weather/nws-polygon-match.ts';
import { buildStormModePayload } from '../weather/personal-storm-mode.ts';
import type { PostureThreat } from './survival-types.ts';
import { threatLevelToSeverity } from './survival-types.ts';

export interface ThreatProjectionOptions {
  now?: number;
}

/** Project NWS alerts near saved places into physical-safety posture threats. */
export function projectWeatherThreats(
  alerts: readonly NwsAlertMinimal[],
  places: readonly SavedPlace[],
  options: ThreatProjectionOptions = {},
): PostureThreat[] {
  const now = options.now ?? Date.now();
  const threats: PostureThreat[] = [];

  for (const place of places) {
    for (const alert of alerts) {
      const match = matchAlertToPlace(alert, place, { now });
      if (match.matchKind === 'no_match' || match.isCancellation || match.threatLevel === 'none') continue;

      const payload = buildStormModePayload(match, place.label, { now });
      const timeToImpactMins = payload.arrivalWindow
        ? Math.max(0, Math.round((payload.arrivalWindow.earliestMs - now) / 60_000))
        : null;

      threats.push({
        sourceEventId: alert.id,
        axis: 'physical_safety',
        severity: threatLevelToSeverity(match.threatLevel),
        threatLevel: match.threatLevel,
        hazardKind: match.hazardKind,
        hazardLabel: match.event,
        timeToImpactMins,
        arrivalLabel: payload.arrivalWindow?.label ?? null,
        why: match.reason,
        confidenceLabel: payload.confidenceLabel,
      });
    }
  }

  return threats.sort((a, b) => b.severity - a.severity);
}
