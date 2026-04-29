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
  /** Optional saved-place coordinates — reserved for Phase 2 user
   *  exposure (e.g. travel risk near a specific theater). Phase 1
   *  uses presence-only as a small exposure bump. */
  savedPlaces?: readonly { id: string; name: string; lat: number; lon: number }[];
  now?: () => number;
}

export function militaryPosturesToSituations(input: MilitaryAdapterInput): Situation[] {
  const now = input.now ?? Date.now;
  return (input.postures ?? [])
    // Filter out 'normal' postures — they don't make the high-impact list.
    .filter((p) => p.posture !== 'normal')
    .map((p) => postureToSituation(p, input.savedPlaces ?? [], now()));
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
  savedPlaces: readonly { id: string; name: string; lat: number; lon: number }[],
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

  // Phase 1 user exposure: presence of saved places gives a small
  // bump (the user has *something* to lose). Phase 2 will reason
  // about specific exposure (travel route, watchlisted ticker, etc.).
  const userExposure = savedPlaces.length > 0 ? 0.25 : 0.1;

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
      summary: severity === 'critical' || severity === 'emergency'
        ? 'May affect travel, fuel prices, and shipping if escalation continues.'
        : 'Indirect exposure: market and commodity volatility possible.',
      level: severity === 'emergency' ? 'high' : severity === 'critical' ? 'medium' : 'low',
      reasons: severity === 'critical' || severity === 'emergency'
        ? ['Theater posture meets strike-readiness threshold']
        : [],
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
      exposureRationale: savedPlaces.length > 0
        ? 'Saved-place presence gives a small exposure bump (Phase 2 will refine)'
        : 'No saved places — minimal user exposure',
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
