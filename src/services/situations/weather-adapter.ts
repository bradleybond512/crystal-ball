/* eslint-disable unicorn/no-nested-ternary, sonarjs/no-nested-conditional, unicorn/no-zero-fractions */
/**
 * Weather → Situation adapter.
 *
 * Phase 1 of docs/CLAUDE_HIGH_IMPACT_EVENT_INTELLIGENCE_VISION_2026-04-29.md.
 *
 * Pure deterministic. Takes the existing NWS WeatherAlert shape and
 * produces normalized Situation records. Adapter is intentionally
 * narrow:
 *   - One alert → one Situation (compound merging is Phase 5)
 *   - User-exposure scoring is shape-only in Phase 1 (Phase 2 wires
 *     real saved-place / route data via the Personal Exposure Graph)
 *   - Watch-window + invalidation signals are seeded with sensible
 *     defaults so the model can demonstrate decay logic in Phase 3
 */

import type { WeatherAlert } from '@/services/weather';
import {
  severityFromScore,
  type Situation,
  type SituationSeverity,
} from './situation-types';

// ── Public API ──────────────────────────────────────────────────────────

export interface WeatherAdapterInput {
  alerts: readonly WeatherAlert[];
  /** Optional saved-place coordinates for Phase 2 user-exposure
   *  scoring. Phase 1 uses this only when present to bump exposure. */
  savedPlaces?: readonly { id: string; name: string; lat: number; lon: number }[];
  /** Optional clock for tests. */
  now?: () => number;
}

/** Map every alert to a Situation. Returns an empty array if alerts
 *  is empty. */
export function weatherAlertsToSituations(input: WeatherAdapterInput): Situation[] {
  const now = input.now ?? Date.now;
  const alerts = input.alerts ?? [];
  return alerts.map((alert) => alertToSituation(alert, input.savedPlaces ?? [], now()));
}

// ── Internals ───────────────────────────────────────────────────────────

const NWS_TO_SCORE: Record<WeatherAlert['severity'], number> = {
  Extreme: 0.9,
  Severe: 0.7,
  Moderate: 0.5,
  Minor: 0.3,
  Unknown: 0.2,
};

function alertToSituation(
  alert: WeatherAlert,
  savedPlaces: readonly { id: string; name: string; lat: number; lon: number }[],
  ts: number,
): Situation {
  const score = NWS_TO_SCORE[alert.severity] ?? 0.2;
  const severity: SituationSeverity = severityFromScore(score);
  // Watch-window: NWS alerts include onset + expires. Time-to-onset
  // drives urgency — closer onset → higher urgency.
  const onsetMs = alert.onset?.getTime?.() ?? ts;
  const minutesToOnset = Math.max(0, (onsetMs - ts) / 60_000);
  // Linear ramp: 0 min → 1.0 urgency, 60+ min → 0.3 urgency.
  const urgency = clamp01(1 - minutesToOnset / 90);

  // Phase 1 user-exposure: simple distance check vs saved places.
  // Phase 2 will use polygon-match + watchlist + travel routes.
  const { exposure, exposureReasons } = computeWeatherExposure(alert, savedPlaces);

  const evidence = [
    {
      id: alert.id,
      source: 'NWS',
      claim: `${alert.event}: ${alert.headline}`.slice(0, 200),
      observedAt: alert.onset?.getTime?.() ?? ts,
      weight: 1.0,
    },
  ];

  const expectedNextSignals = [
    { id: `${alert.id}:radar-strengthen`, description: 'Radar core strengthens within 30 min' },
    { id: `${alert.id}:lightning-density`, description: 'Lightning density increase near affected area' },
    { id: `${alert.id}:storm-reports`, description: 'Spotter / storm reports begin arriving' },
  ];

  const invalidationSignals = [
    { id: `${alert.id}:nws-cancellation`, description: 'NWS cancels or expires the alert' },
    { id: `${alert.id}:radar-decay`, description: 'Radar signature decays for 20+ minutes' },
  ];

  const recommendedActions = severity === 'critical' || severity === 'emergency'
    ? [
        {
          id: `${alert.id}:shelter`,
          text: `Take shelter — ${alert.event} threatens ${alert.areaDesc.split(';')[0]?.trim() ?? 'your area'}.`,
          urgency: 'immediate' as const,
        },
        {
          id: `${alert.id}:monitor`,
          text: 'Monitor NWS updates and local emergency notifications.',
          urgency: 'immediate' as const,
        },
      ]
    : severity === 'elevated'
    ? [
        {
          id: `${alert.id}:prepare`,
          text: `Prepare for ${alert.event}; review evacuation route if applicable.`,
          urgency: 'soon' as const,
        },
      ]
    : [
        {
          id: `${alert.id}:monitor`,
          text: 'Monitor for escalation; no action required yet.',
          urgency: 'monitor' as const,
        },
      ];

  return {
    id: `weather:${alert.id}`,
    domain: 'weather',
    title: `${alert.event} — ${alert.areaDesc.split(';')[0]?.trim() ?? 'area'}`,
    summary: alert.headline.slice(0, 240),
    severity,
    confidence: 0.9, // NWS is authoritative; high baseline
    urgency,
    userExposure: exposure,
    personalImpact: {
      summary: exposureReasons.length > 0
        ? `Affects ${savedPlaces.length > 0 ? 'a saved place' : 'your area'}`
        : 'No direct exposure detected',
      level: exposureToLevel(exposure),
      reasons: exposureReasons,
    },
    evidence,
    sourceAgreement: {
      agreeing: ['NWS'],
      disagreeing: [],
      independentSourceCount: 1,
    },
    whatChanged: [
      { ts, text: `New ${alert.severity.toLowerCase()} alert from NWS`, source: 'NWS' },
    ],
    expectedNextSignals,
    invalidationSignals,
    recommendedActions,
    timeline: [
      { ts: alert.onset?.getTime?.() ?? ts, text: `Onset: ${alert.event}`, source: 'NWS' },
    ],
    diagnosticsTrace: {
      createdReason: `NWS alert ${alert.id} (${alert.severity}) reached the high-impact threshold`,
      severityRationale: `NWS severity '${alert.severity}' → score ${score.toFixed(2)} → tier '${severity}'`,
      confidenceRationale: 'NWS is the authoritative source for US weather alerts (baseline 0.9).',
      exposureRationale: exposureReasons.length > 0
        ? `Saved place(s) within proximity radius: ${exposureReasons.join('; ')}`
        : 'No saved places within proximity radius — exposure scored from severity only.',
      sourceContributions: { NWS: 1.0 },
      thresholdsCrossed: [`severity:${severity}`, `urgency:${urgency.toFixed(2)}`],
    },
    predictionOutcome: {},
    phase: 'active',
    firstSeen: ts,
    lastUpdated: ts,
  };
}

/** Phase 1 user-exposure: cheap radial proximity. Phase 2 will use
 *  the existing polygon-match service. */
function computeWeatherExposure(
  alert: WeatherAlert,
  savedPlaces: readonly { id: string; name: string; lat: number; lon: number }[],
): { exposure: number; exposureReasons: string[] } {
  if (savedPlaces.length === 0 || !alert.centroid) {
    return { exposure: 0.1, exposureReasons: [] };
  }
  const reasons: string[] = [];
  let maxExposure = 0.1;
  for (const place of savedPlaces) {
    const km = haversineKm(alert.centroid[1], alert.centroid[0], place.lat, place.lon);
    if (km < 25) {
      maxExposure = Math.max(maxExposure, 0.95);
      reasons.push(`${place.name} within 25 km of alert centroid`);
    } else if (km < 80) {
      maxExposure = Math.max(maxExposure, 0.6);
      reasons.push(`${place.name} within 80 km of alert centroid`);
    } else if (km < 200) {
      maxExposure = Math.max(maxExposure, 0.25);
    }
  }
  return { exposure: maxExposure, exposureReasons: reasons };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function exposureToLevel(exposure: number): 'none' | 'low' | 'medium' | 'high' | 'severe' {
  if (exposure >= 0.85) return 'severe';
  if (exposure >= 0.6) return 'high';
  if (exposure >= 0.35) return 'medium';
  if (exposure >= 0.15) return 'low';
  return 'none';
}
