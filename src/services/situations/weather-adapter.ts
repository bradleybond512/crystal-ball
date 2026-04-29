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
import {
  exposureToLevel,
  scoreGeoExposure,
  type ExposureGraph,
} from './exposure-graph';

// ── Public API ──────────────────────────────────────────────────────────

export interface WeatherAdapterInput {
  alerts: readonly WeatherAlert[];
  /**
   * Phase 2: Personal Exposure Graph drives userExposure.
   * Pass the user's full graph (saved places, current location).
   * Phase 1's standalone savedPlaces input remains for back-compat
   * — when both are present, the graph wins.
   */
  exposureGraph?: ExposureGraph;
  /** Phase 1 fallback for callers that haven't migrated to the graph. */
  savedPlaces?: readonly { id: string; name: string; lat: number; lon: number }[];
  /** Optional clock for tests. */
  now?: () => number;
}

/** Map every alert to a Situation. Returns an empty array if alerts
 *  is empty. */
export function weatherAlertsToSituations(input: WeatherAdapterInput): Situation[] {
  const now = input.now ?? Date.now;
  const alerts = input.alerts ?? [];
  // If an exposure graph is supplied, use it. Otherwise synthesize a
  // minimal one from the legacy savedPlaces input.
  const graph: ExposureGraph = input.exposureGraph ?? {
    savedPlaces: (input.savedPlaces ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      tags: [],
      primary: false,
    })),
    watchlist: { countries: [], sectors: [], tickers: [], vendors: [], cves: [] },
    device: { osLabels: [], versions: [] },
  };
  return alerts.map((alert) => alertToSituation(alert, graph, now()));
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
  graph: ExposureGraph,
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

  // Phase 2: scoreGeoExposure walks the full ExposureGraph (saved
  // places + current location) and returns a (score, reasons,
  // contributions) breakdown. Phase 3 will swap radial distance for
  // polygon-match using the existing weather/nws-polygon-match
  // service.
  const exposureScore = alert.centroid
    ? scoreGeoExposure({ lat: alert.centroid[1], lon: alert.centroid[0] }, graph)
    : { score: 0.1, reasons: [], contributions: { 'no-centroid': 0.1 } };
  const exposure = exposureScore.score;
  const exposureReasons = exposureScore.reasons;

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
        ? `Affects ${exposureReasons[0]?.includes('Current location') ? 'your current location' : 'a saved place'}`
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
        ? `Personal exposure graph: ${exposureReasons.join('; ')}`
        : 'No saved places or current location within proximity radius — exposure scored as baseline (0.1).',
      sourceContributions: { NWS: 1.0 },
      thresholdsCrossed: [`severity:${severity}`, `urgency:${urgency.toFixed(2)}`],
    },
    predictionOutcome: {},
    phase: 'active',
    firstSeen: ts,
    lastUpdated: ts,
  };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
