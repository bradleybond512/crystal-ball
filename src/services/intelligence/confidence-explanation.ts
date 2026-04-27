/**
 * Confidence explanation — turns a TruthScore into a human-readable
 * AlgorithmExplanation and a numeric ConfidenceBreakdown.
 *
 * Per the plan doc:
 *   "Risk: 82 = 22/25 + 13/15 + 21/25 + 14/15 + 7/10 - 2"
 *   plus a `missingConfirmation` list pointing at the lowest-confidence
 *   component so the user (or a future automated collector) knows what
 *   would push the score higher.
 *
 * Pure deterministic. Inputs: a NormalizedFact and its TruthScore.
 * Outputs: structured explanation objects ready for the UI.
 */

import type {
  AlgorithmExplanation,
  ConfidenceBreakdown,
  ConfidenceBreakdownItem,
  ExplanationLine,
  NormalizedFact,
  TruthScore,
  TruthScoreComponents,
} from './types';

// ── Decomposition ─────────────────────────────────────────────────────────
//
// Weights match `truth-score.ts` so the breakdown sums (modulo penalty +
// rounding) to the same number scoreFact() produced. We render a 100-point
// scale: 25/15/25/15/10/10 + a contradiction penalty deduction.

const WEIGHTS = {
  reliability: 25,
  freshness: 15,
  corroboration: 25,
  sourceDiversity: 15,
  precision: 10,
  historicalAccuracy: 10,
} as const;

export function buildConfidenceBreakdown(score: TruthScore): ConfidenceBreakdown {
  const c = score.components;
  const items: ConfidenceBreakdownItem[] = [
    { label: 'Source reliability', value: pts(c.reliability, WEIGHTS.reliability), max: WEIGHTS.reliability, polarity: 'positive' },
    { label: 'Freshness', value: pts(c.freshness, WEIGHTS.freshness), max: WEIGHTS.freshness, polarity: 'positive' },
    { label: 'Corroboration', value: pts(c.corroboration, WEIGHTS.corroboration), max: WEIGHTS.corroboration, polarity: 'positive' },
    { label: 'Source diversity', value: pts(c.sourceDiversity, WEIGHTS.sourceDiversity), max: WEIGHTS.sourceDiversity, polarity: 'positive' },
    { label: 'Geographic precision', value: pts(c.precision, WEIGHTS.precision), max: WEIGHTS.precision, polarity: 'positive' },
    { label: 'Historical accuracy', value: pts(c.historicalAccuracy, WEIGHTS.historicalAccuracy), max: WEIGHTS.historicalAccuracy, polarity: 'positive' },
  ];
  if (c.contradictionPenalty > 0) {
    items.push({
      label: 'Contradictions',
      value: -Math.round(c.contradictionPenalty * 100),
      max: 100,
      polarity: 'negative',
    });
  }
  const positiveSum = items
    .filter((i) => i.polarity === 'positive')
    .reduce((s, i) => s + i.value, 0);
  const negativeSum = items
    .filter((i) => i.polarity === 'negative')
    .reduce((s, i) => s + i.value, 0); // already negative
  const total = clamp(0, 100, positiveSum + negativeSum);
  return { total, max: 100, items };
}

// ── Explanation lines ─────────────────────────────────────────────────────

export interface ExplanationOptions {
  /** Optional human label for the fact's domain (e.g. "Earthquake"). */
  domainLabel?: string;
  /** When this fact has corroborating facts (from the evidence graph),
   *  pass them in to enrich the explanation. */
  corroboratingFactIds?: readonly string[];
  /** Same idea for contradicting facts. */
  contradictingFactIds?: readonly string[];
}

export function buildExplanation(
  fact: NormalizedFact,
  score: TruthScore,
  options: ExplanationOptions = {},
): AlgorithmExplanation {
  const c = score.components;
  const headline = `${labelTitleCase(score.label)} — ${Math.round(score.score * 100)}/100`;
  const sourceCount = score.contributingProviders.length;

  const lines: ExplanationLine[] = [
    sourceCountLine(sourceCount, score.contributingProviders),
    reliabilityLine(c.reliability),
    freshnessLine(c.freshness),
    diversityLine(c.sourceDiversity, sourceCount),
    precisionLine(c.precision),
    contradictionLine(c.contradictionPenalty, options.contradictingFactIds?.length),
    corroboratingLine(options.corroboratingFactIds?.length ?? 0),
  ].filter((l): l is ExplanationLine => l !== null);

  // Sort by weight (1 = most prominent).
  lines.sort((a, b) => a.weight - b.weight);

  const missingConfirmation = computeMissingConfirmation(fact, c);

  return {
    headline,
    lines,
    missingConfirmation,
  };
}

// ── Per-component line builders (kept small to keep buildExplanation
//    under the cognitive-complexity ceiling). Each returns null when
//    there's nothing notable to say. ─────────────────────────────────────

function sourceCountLine(n: number, providers: readonly string[]): ExplanationLine | null {
  if (n >= 3) return { text: `${n} independent providers attest to this claim`, polarity: 'positive', weight: 1 };
  if (n === 2) return { text: '2 providers attest — corroborated but not yet broadly confirmed', polarity: 'positive', weight: 1 };
  if (n === 1) return { text: `Single source (${providers[0] ?? 'unknown'}) — uncorroborated`, polarity: 'negative', weight: 1 };
  return null;
}
function reliabilityLine(r: number): ExplanationLine | null {
  if (r >= 0.85) return { text: 'Reporting providers have strong reliability priors', polarity: 'positive', weight: 2 };
  if (r < 0.5) return { text: 'Reporting providers have weak or unknown reliability', polarity: 'negative', weight: 2 };
  return null;
}
function freshnessLine(f: number): ExplanationLine | null {
  if (f >= 0.85) return { text: 'Reporting is fresh relative to this domain', polarity: 'positive', weight: 3 };
  if (f <= 0.3) return { text: 'Reporting is stale — confidence reduced', polarity: 'negative', weight: 3 };
  return null;
}
function diversityLine(d: number, sourceCount: number): ExplanationLine | null {
  if (d < 0.6 && sourceCount >= 2) {
    return { text: 'Sources may share an upstream — diversity penalty applied', polarity: 'negative', weight: 4 };
  }
  return null;
}
function precisionLine(p: number): ExplanationLine | null {
  if (p >= 0.85) return { text: 'Location is precisely identified', polarity: 'positive', weight: 5 };
  if (p <= 0.4) return { text: 'Location is broad — geographic precision is low', polarity: 'negative', weight: 5 };
  return null;
}
function contradictionLine(penalty: number, knownCount?: number): ExplanationLine | null {
  if (penalty <= 0) return null;
  const n = knownCount ?? Math.round(penalty / 0.15);
  return { text: `${n} contradicting fact${n === 1 ? '' : 's'} reduce confidence`, polarity: 'negative', weight: 1 };
}
function corroboratingLine(n: number): ExplanationLine | null {
  if (n <= 0) return null;
  return { text: `Corroborated by ${n} related fact(s)`, polarity: 'positive', weight: 6 };
}

// ── Missing-confirmation hints ────────────────────────────────────────────
//
// We rank components by lowest score and surface domain-aware hints for
// the bottom one or two. This is the "Next Best Source Recommendation"
// section of the plan (lines 461-476) — a short, targeted list of what
// would push the score over the next threshold.

export function computeMissingConfirmation(
  fact: NormalizedFact,
  c: TruthScoreComponents,
): string[] {
  const ranked: { key: keyof TruthScoreComponents; value: number }[] = [
    { key: 'corroboration' as const, value: c.corroboration },
    { key: 'sourceDiversity' as const, value: c.sourceDiversity },
    { key: 'freshness' as const, value: c.freshness },
    { key: 'precision' as const, value: c.precision },
    { key: 'reliability' as const, value: c.reliability },
    { key: 'historicalAccuracy' as const, value: c.historicalAccuracy },
  ];
  ranked.sort((a, b) => a.value - b.value);

  const hints: string[] = [];
  for (const { key, value } of ranked) {
    if (value >= 0.7) break; // good enough — stop suggesting things
    const hint = HINTS_BY_DOMAIN[fact.domain]?.[key] ?? GENERIC_HINTS[key];
    if (hint) hints.push(hint);
    if (hints.length >= 3) break;
  }
  // Contradiction penalty is special — if it exists, finding a
  // resolving source is more important than any other ask.
  if (c.contradictionPenalty > 0) {
    hints.unshift('Resolve contradictory reports — find an authoritative tiebreaker');
    if (hints.length > 3) hints.length = 3;
  }
  return hints;
}

const GENERIC_HINTS: Record<keyof TruthScoreComponents, string> = {
  reliability: 'Add a higher-reliability provider for this claim',
  freshness: 'Re-verify with a current source',
  corroboration: 'Find a second independent source',
  sourceDiversity: 'Add a source from a different upstream',
  precision: 'Pin down the exact location',
  historicalAccuracy: 'Cross-check with a provider with known calibration in this domain',
  contradictionPenalty: 'Resolve contradictions with an authoritative source',
};

const HINTS_BY_DOMAIN: Partial<Record<NormalizedFact['domain'], Partial<Record<keyof TruthScoreComponents, string>>>> = {
  weather: {
    corroboration: 'Cross-check against NWS / ECMWF / Open-Meteo',
    precision: 'Get coordinates from the radar/sat product, not the headline',
  },
  cyber: {
    corroboration: 'Confirm with NVD, CISA KEV, or vendor advisory',
    reliability: 'Prefer CVE/EPSS records over news aggregations',
  },
  aviation: {
    corroboration: 'Add a second ADS-B feed (OpenSky, ADSB.fi, Airplanes.live)',
    precision: 'Lock to the exact ICAO hex and squawk',
  },
  maritime: {
    corroboration: 'Cross-check AIS with a second receiver network',
    sourceDiversity: 'Pull a non-AIS confirmation (port authority, news)',
  },
  markets: {
    corroboration: 'Confirm against a second exchange feed',
    freshness: 'Re-pull the quote — markets move fast',
  },
  conflict: {
    corroboration: 'Look for ACLED + GDELT + local-language confirmation',
    reliability: 'Prefer official briefings over open-source aggregators',
  },
  humanitarian: {
    corroboration: 'Confirm with OCHA / GDACS / ReliefWeb',
  },
  space: {
    corroboration: 'Confirm with CelesTrak / Space-Track',
  },
  infra: {
    corroboration: 'Confirm with utility status feeds + EIA',
  },
  macro: {
    corroboration: 'Confirm against a second macro publisher',
  },
};

// ── helpers ───────────────────────────────────────────────────────────────

function pts(score01: number, max: number): number {
  return Math.round(score01 * max);
}
function clamp(min: number, max: number, x: number): number {
  return Math.max(min, Math.min(max, x));
}
function labelTitleCase(label: TruthScore['label']): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}
