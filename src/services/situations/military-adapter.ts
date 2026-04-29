/* eslint-disable unicorn/no-nested-ternary, sonarjs/no-nested-conditional, unicorn/no-zero-fractions, sonarjs/cognitive-complexity */
/**
 * Military → Situation adapter.
 *
 * Phase 1 of docs/CLAUDE_HIGH_IMPACT_EVENT_INTELLIGENCE_VISION_2026-04-29.md.
 *
 * Pure deterministic. The vision describes a Theater Escalation Watch
 * across 9 named theaters. Phase 1 ships the normalizer so any input
 * carrying {theater, posture, score, sources} can become a Situation.
 * Phase 4 will fuse OpenSky / tankers / NOTAMs / OSINT into the
 * `posture` value and add the Strike Readiness classifier.
 */

import {
  severityFromScore,
  type Situation,
  type SituationSeverity,
} from './situation-types';
import {
  scoreCountryExposure,
  scoreGeoExposure,
  type ExposureGraph,
} from './exposure-graph';

// ── Public API ──────────────────────────────────────────────────────────

export type TheaterPosture =
  | 'normal'
  | 'elevated'
  | 'deployment'
  | 'strike_ready'
  | 'active_escalation';

export interface TheaterPostureInput {
  /** Stable id for the theater (e.g. 'taiwan-strait', 'persian-gulf'). */
  theaterId: string;
  /** Display name. */
  theaterName: string;
  /** Current posture verdict from the host's existing escalation engine. */
  posture: TheaterPosture;
  /** 0..1 score from the upstream escalation forecaster. */
  postureScore: number;
  /** 0..1 prior score, so whatChanged can show direction. */
  priorScore?: number;
  /** Optional theater coordinates so the geo exposure scorer can
   *  match against saved places + current location. */
  centroid?: { lat: number; lon: number };
  /** Optional ISO 3166-1 alpha-3 country codes the theater spans
   *  (e.g. ['CHN','TWN'] for the Taiwan Strait). Drives country-watchlist
   *  exposure matching. */
  countries?: readonly string[];
  /** Source-attributed evidence rows from the host's threat-convergence
   *  / escalation-forecast / military-flights pipelines. */
  evidence: readonly {
    id: string;
    source: string;
    claim: string;
    observedAt: number;
    weight: number;
    url?: string;
  }[];
  /** Sources that agree with the posture verdict. */
  agreeingSources: readonly string[];
  /** Sources that contradict the posture verdict. */
  disagreeingSources: readonly string[];
  /** Optional ms timestamp; defaults to now(). */
  observedAt?: number;
}

export interface MilitaryAdapterInput {
  postures: readonly TheaterPostureInput[];
  /** Phase 2: full exposure graph. When present, drives userExposure
   *  via scoreGeoExposure() (saved-place proximity to theater centroid)
   *  + scoreCountryExposure() (country watchlist match). */
  exposureGraph?: ExposureGraph;
  /** Phase 1 fallback for callers that haven't migrated. */
  savedPlaces?: readonly { id: string; name: string; lat: number; lon: number }[];
  now?: () => number;
}

export function militaryPosturesToSituations(input: MilitaryAdapterInput): Situation[] {
  const now = input.now ?? Date.now;
  const graph: ExposureGraph = input.exposureGraph ?? {
    savedPlaces: (input.savedPlaces ?? []).map((p) => ({
      id: p.id, name: p.name, lat: p.lat, lon: p.lon, tags: [], primary: false,
    })),
    watchlist: { countries: [], sectors: [], tickers: [], vendors: [], cves: [] },
    device: { osLabels: [], versions: [] },
  };
  return (input.postures ?? [])
    // Filter out 'normal' postures — they don't make the high-impact list.
    .filter((p) => p.posture !== 'normal')
    .map((p) => postureToSituation(p, graph, now()));
}

// ── Internals ───────────────────────────────────────────────────────────

const POSTURE_SCORE_FLOOR: Record<TheaterPosture, number> = {
  normal: 0.0,
  elevated: 0.35,
  deployment: 0.5,
  strike_ready: 0.75,
  active_escalation: 0.9,
};

function postureToSituation(
  p: TheaterPostureInput,
  graph: ExposureGraph,
  ts: number,
): Situation {
  // The score floor enforces that 'strike_ready' lands at least
  // 'critical' even if the upstream forecaster's raw score is low —
  // the posture verdict is operator-supplied and must dominate.
  const floor = POSTURE_SCORE_FLOOR[p.posture] ?? 0.3;
  const score = Math.max(p.postureScore, floor);
  const severity: SituationSeverity = severityFromScore(score);

  // Urgency is highest for active_escalation, lower for static
  // deployment posture.
  const urgency = p.posture === 'active_escalation'
    ? 0.95
    : p.posture === 'strike_ready'
    ? 0.8
    : p.posture === 'deployment'
    ? 0.5
    : 0.3;

  // Confidence: more agreeing sources → higher confidence.
  // Base 0.5 + 0.1 per independent source, capped at 0.95.
  const independentSources = new Set(p.agreeingSources).size;
  const confidence = Math.min(0.95, 0.5 + 0.1 * independentSources);

  // Phase 2: combine geo (saved place near theater) + country
  // (theater country on user watchlist). Take the max so a watched
  // country alone produces meaningful exposure even when the user
  // has no nearby saved places.
  const geoExposure = scoreGeoExposure(p.centroid, graph);
  const countryExposure = scoreCountryExposure(p.countries ?? [], graph);
  const userExposure = Math.max(geoExposure.score, countryExposure.score);
  const exposureReasons = [...geoExposure.reasons, ...countryExposure.reasons];

  const direction = typeof p.priorScore === 'number'
    ? (p.postureScore - p.priorScore > 0.05 ? 'rising' : p.postureScore - p.priorScore < -0.05 ? 'falling' : 'steady')
    : 'unknown';

  const recommendedActions = (severity === 'critical' || severity === 'emergency')
    ? [
        {
          id: `${p.theaterId}:monitor`,
          text: `Monitor ${p.theaterName} closely — posture is ${prettyPosture(p.posture)}.`,
          urgency: 'immediate' as const,
        },
        {
          id: `${p.theaterId}:travel-review`,
          text: `Review any planned travel near ${p.theaterName}; check State Dept advisories.`,
          urgency: 'soon' as const,
        },
      ]
    : severity === 'elevated'
    ? [
        {
          id: `${p.theaterId}:watch`,
          text: `Watch ${p.theaterName} for escalation indicators (NOTAMs, naval movements).`,
          urgency: 'monitor' as const,
        },
      ]
    : [
        {
          id: `${p.theaterId}:fyi`,
          text: `${p.theaterName} posture noted; no action required.`,
          urgency: 'fyi' as const,
        },
      ];

  return {
    id: `military:${p.theaterId}`,
    domain: 'military',
    title: `${p.theaterName} — ${prettyPosture(p.posture)}`,
    summary: `Posture ${prettyPosture(p.posture)} (score ${p.postureScore.toFixed(2)}, ${direction}).`,
    severity,
    confidence,
    urgency,
    userExposure,
    personalImpact: {
      summary: exposureReasons.length > 0
        ? exposureReasons[0] ?? 'Watchlist exposure'
        : severity === 'critical' || severity === 'emergency'
        ? 'May affect travel, fuel prices, and shipping if escalation continues.'
        : 'Indirect exposure: market and commodity volatility possible.',
      level: userExposure >= 0.85 ? 'severe' : userExposure >= 0.6 ? 'high' : userExposure >= 0.35 ? 'medium' : 'low',
      reasons: exposureReasons.length > 0
        ? exposureReasons
        : (severity === 'critical' || severity === 'emergency'
          ? ['Theater posture meets strike-readiness threshold']
          : []),
    },
    evidence: p.evidence,
    sourceAgreement: {
      agreeing: p.agreeingSources,
      disagreeing: p.disagreeingSources,
      independentSourceCount: independentSources,
    },
    whatChanged: typeof p.priorScore === 'number' && Math.abs(p.postureScore - p.priorScore) > 0.05
      ? [{
          ts,
          text: `Posture score ${direction}: ${p.priorScore.toFixed(2)} → ${p.postureScore.toFixed(2)}`,
          source: 'escalation-forecast',
        }]
      : [{ ts, text: `${p.theaterName} posture observed at ${prettyPosture(p.posture)}`, source: 'escalation-forecast' }],
    expectedNextSignals: [
      { id: `${p.theaterId}:flight-surge`, description: 'Military aircraft surge above baseline (OpenSky / Wingbits)' },
      { id: `${p.theaterId}:notam`, description: 'New NOTAM closures near theater' },
      { id: `${p.theaterId}:naval`, description: 'Naval concentration above baseline (AIS dark gaps)' },
    ],
    invalidationSignals: [
      { id: `${p.theaterId}:withdrawal`, description: 'Withdrawal / re-positioning announced by official sources' },
      { id: `${p.theaterId}:de-escalation`, description: 'Multiple corroborating de-escalation reports' },
    ],
    recommendedActions,
    timeline: [
      { ts, text: `Posture: ${prettyPosture(p.posture)} (score ${p.postureScore.toFixed(2)})`, source: 'escalation-forecast' },
    ],
    diagnosticsTrace: {
      createdReason: `Theater ${p.theaterId} posture is '${p.posture}' (score ${p.postureScore.toFixed(2)})`,
      severityRationale: `Posture floor ${floor.toFixed(2)} + raw score ${p.postureScore.toFixed(2)} → max ${score.toFixed(2)} → tier '${severity}'`,
      confidenceRationale: `${independentSources} independent agreeing source(s) → confidence ${confidence.toFixed(2)}`,
      exposureRationale: exposureReasons.length > 0
        ? `Personal exposure graph: ${exposureReasons.join('; ')}`
        : 'No saved-place proximity or country watchlist match — minimal user exposure',
      sourceContributions: Object.fromEntries(
        p.agreeingSources.map((s) => [s, 1 / Math.max(1, p.agreeingSources.length)]),
      ),
      thresholdsCrossed: [`posture:${p.posture}`, `severity:${severity}`],
    },
    predictionOutcome: {},
    phase: p.posture === 'active_escalation' ? 'active' : 'developing',
    firstSeen: p.observedAt ?? ts,
    lastUpdated: ts,
  };
}

function prettyPosture(p: TheaterPosture): string {
  return p.replace(/_/g, ' ');
}
