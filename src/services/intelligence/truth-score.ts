/**
 * Multi-source truth scoring per the plan doc's
 * "Multi-Source Truth Scoring" section (lines 61-108).
 *
 * Pure deterministic functions. No fetch, no DOM, no globals. Inputs
 * are facts + opinion functions; outputs are TruthScore values.
 *
 * The formula is the one specified in the doc:
 *
 *   truthScore =
 *     reliability  * 0.25 +
 *     freshness    * 0.15 +
 *     corroboration * 0.25 +
 *     sourceDiversity * 0.15 +
 *     precision    * 0.10 +
 *     historicalAccuracy * 0.10
 *     - contradictionPenalty
 *
 * Component scores are clamped to [0, 1] before weighting. The final
 * score is clamped to [0, 1] after subtracting the penalty.
 */

import type {
  NormalizedFact,
  TruthScore,
  TruthScoreComponents,
  TruthLabel,
  LocationPrecision,
} from './types';
import { createBelief } from '@/components/belief-helpers';

// ── Inputs the caller supplies (decoupled from runtime services) ──────────

/** Per-provider opinion functions. Implementations can wrap the provider
 *  registry from `src/services/providers/` later, but the truth scorer
 *  doesn't import that directly so it's testable with fixtures. */
export interface TruthScoreContext {
  /** Reliability prior in [0, 1] for a given provider id. Use 0.7 for
   *  unknown providers (above-average prior). */
  reliabilityFor: (providerId: string) => number;
  /** Historical accuracy in [0, 1] for the (providerId, domain) pair.
   *  Defaults to 0.7 if we have no calibration data yet. */
  historicalAccuracyFor: (providerId: string, domain: NormalizedFact['domain']) => number;
  /** TTL for facts in this domain (ms). Drives freshness decay. */
  ttlMsForDomain: (domain: NormalizedFact['domain']) => number;
  /** Optional: now() injection for deterministic tests. */
  now?: () => number;
}

/** Sensible defaults for callers who don't have a calibrated context. */
export function defaultContext(overrides: Partial<TruthScoreContext> = {}): TruthScoreContext {
  return {
    reliabilityFor: () => 0.7,
    historicalAccuracyFor: () => 0.7,
    ttlMsForDomain: (domain) => DEFAULT_TTL_MS[domain] ?? 60 * 60 * 1000,
    ...overrides,
  };
}

/** Default freshness windows by domain. Tunable per environment. */
const DEFAULT_TTL_MS: Record<NormalizedFact['domain'], number> = {
  weather: 30 * 60 * 1000,        // 30 min
  cyber: 6 * 60 * 60 * 1000,      // 6h (KEV/CVE rotates daily)
  aviation: 5 * 60 * 1000,        // 5 min (positions move fast)
  maritime: 15 * 60 * 1000,       // 15 min
  markets: 5 * 60 * 1000,         // 5 min
  conflict: 4 * 60 * 60 * 1000,   // 4h
  humanitarian: 12 * 60 * 60 * 1000, // 12h
  space: 60 * 60 * 1000,          // 1h
  infra: 60 * 60 * 1000,          // 1h
  macro: 24 * 60 * 60 * 1000,     // 24h
  other: 60 * 60 * 1000,
};

// ── Component scorers ─────────────────────────────────────────────────────

/** Linear freshness decay: 1.0 at observation, 0.5 at 1× TTL,
 *  0.0 at ≥2× TTL. Mirrors providers/fusion.scoreFreshness. */
export function freshnessScore(latestObservedAt: number, ttlMs: number, now: number): number {
  if (!Number.isFinite(latestObservedAt) || !Number.isFinite(ttlMs) || ttlMs <= 0) return 0.5;
  const age = Math.max(0, now - latestObservedAt);
  if (age >= 2 * ttlMs) return 0;
  if (age <= 0) return 1;
  return clamp01(1 - age / (2 * ttlMs));
}

/** Average source reliability across all attesting providers. */
export function reliabilityScore(fact: NormalizedFact, ctx: TruthScoreContext): number {
  if (fact.sources.length === 0) return 0;
  const sum = fact.sources.reduce((s, src) => s + clamp01(ctx.reliabilityFor(src.providerId)), 0);
  return sum / fact.sources.length;
}

/** Cross-source agreement. Single source returns 0.3 — there is no
 *  corroboration to score, only a baseline trust-the-claim-enough-to-rate-it
 *  floor. The ladder above starts where actual agreement begins:
 *  0.75 two, 0.9 three, 1.0 four+. The 0.3 floor is what makes the
 *  doc's "single source caps at plausible" rule hold without us
 *  needing a special-case in labelFor. */
export function corroborationScore(sourceCount: number): number {
  if (sourceCount <= 0) return 0;
  if (sourceCount === 1) return 0.3;
  if (sourceCount === 2) return 0.75;
  if (sourceCount === 3) return 0.9;
  return 1;
}

/** Independence — penalize echo chambers. 1.0 if every source is
 *  independent; lower if some sources `derivedFrom` others. The
 *  intuition: 5 outlets re-publishing one wire story shouldn't score
 *  the same as 5 independent observations. */
export function sourceDiversityScore(fact: NormalizedFact): number {
  if (fact.sources.length === 0) return 0;
  if (fact.sources.length === 1) return 0.5; // single source has no diversity to score
  // Count distinct *root* providers (following derivedFrom chains).
  const roots = new Set<string>();
  const sourceById = new Map(fact.sources.map((s) => [s.providerId, s]));
  for (const src of fact.sources) {
    let cursor = src;
    let hops = 0;
    while (cursor.derivedFrom && hops < 5 /* cycle guard */) {
      const parent = sourceById.get(cursor.derivedFrom);
      if (!parent) break;
      cursor = parent;
      hops += 1;
    }
    roots.add(cursor.providerId);
  }
  // Diversity is the ratio of distinct roots to total sources, with a
  // floor of 0.4 so a single dominant root doesn't tank an otherwise
  // multi-source claim entirely.
  const ratio = roots.size / fact.sources.length;
  return Math.max(0.4, ratio);
}

/** Geographic precision multiplier from LocationPrecision. Returns a coarse
 *  default for a missing/unknown precision — the field is typed non-optional but
 *  facts built from external data can arrive without it, and an undefined here
 *  would make the whole truth-score NaN and silently poison the ledger. */
export function precisionScore(precision: LocationPrecision | undefined): number {
  switch (precision) {
    case 'point': { return 1;
    }
    case 'local': { return 0.85;
    }
    case 'regional': { return 0.7;
    }
    case 'country': { return 0.55;
    }
    case 'global': { return 0.3;
    }
    default: { return 0.55;
    }
  }
}

/** Average historical accuracy across attesting providers in this
 *  domain. Falls back to 0.7 (the doc's default for un-calibrated
 *  systems) when the context has no signal. */
export function historicalAccuracyScore(fact: NormalizedFact, ctx: TruthScoreContext): number {
  if (fact.sources.length === 0) return 0.7;
  const sum = fact.sources.reduce(
    (s, src) => s + clamp01(ctx.historicalAccuracyFor(src.providerId, fact.domain)),
    0,
  );
  return sum / fact.sources.length;
}

/** Contradiction penalty. Each contradicting fact subtracts 0.15
 *  (so two contradictions can flip a 'likely' score into 'disputed'),
 *  capped at 0.6 to keep the score from crashing to 0 even when the
 *  fact is heavily disputed. */
export function contradictionPenalty(fact: NormalizedFact): number {
  const n = fact.contradictedBy?.length ?? 0;
  return Math.min(0.6, n * 0.15);
}

// ── Top-level scorer ──────────────────────────────────────────────────────

export function scoreFact(fact: NormalizedFact, ctx: TruthScoreContext = defaultContext()): TruthScore {
  const now = ctx.now ? ctx.now() : Date.now();
  const ttl = ctx.ttlMsForDomain(fact.domain);
  // The freshest observation across providers wins.
  const latestObservedAt = fact.sources.length > 0
    ? Math.max(...fact.sources.map((s) => s.observedAt))
    : fact.occurredAt;

  const components: TruthScoreComponents = {
    reliability: clamp01(reliabilityScore(fact, ctx)),
    freshness: clamp01(freshnessScore(latestObservedAt, ttl, now)),
    corroboration: clamp01(corroborationScore(fact.sources.length)),
    sourceDiversity: clamp01(sourceDiversityScore(fact)),
    precision: clamp01(precisionScore(fact.locationPrecision)),
    historicalAccuracy: clamp01(historicalAccuracyScore(fact, ctx)),
    contradictionPenalty: contradictionPenalty(fact),
  };

  // Apply the doc's formula.
  const weighted =
    components.reliability * 0.25 +
    components.freshness * 0.15 +
    components.corroboration * 0.25 +
    components.sourceDiversity * 0.15 +
    components.precision * 0.1 +
    components.historicalAccuracy * 0.1;
  const final = clamp01(weighted - components.contradictionPenalty);

  const disputed = components.contradictionPenalty >= 0.3;
  const label = labelFor(final, disputed);

  const providers = [...new Set(fact.sources.map((s) => s.providerId))];
  return {
    score: round3(final),
    belief: createBelief(round3(final), { provenance: providers }),
    label,
    components: roundComponents(components),
    contributingProviders: providers,
    disputed,
  };
}

/** Map a numeric score + dispute flag to a categorical label. The doc
 *  specifies five labels; thresholds are tuned so:
 *  - Single fresh source caps at 'plausible' (no corroboration).
 *  - Two-source agreement crosses into 'likely'.
 *  - Three+ sources, fresh, with a precision boost can hit 'confirmed'.
 *  - Any meaningful contradiction (≥2) pulls into 'disputed' regardless. */
export function labelFor(score: number, disputed: boolean): TruthLabel {
  if (disputed) return 'disputed';
  if (score >= 0.8) return 'confirmed';
  if (score >= 0.65) return 'likely';
  if (score >= 0.45) return 'plausible';
  return 'weak';
}

// ── helpers ───────────────────────────────────────────────────────────────

// NaN-safe: Math.max(0, Math.min(1, NaN)) is NaN, which would propagate into the
// final score. A NaN component (e.g. a custom context's reliabilityFor returning
// NaN) clamps to 0 so scoreFact stays finite for ANY context, not just the default.
function clamp01(x: number): number { return Number.isNaN(x) ? 0 : Math.max(0, Math.min(1, x)); }
function round3(x: number): number { return Math.round(x * 1000) / 1000; }
function roundComponents(c: TruthScoreComponents): TruthScoreComponents {
  return {
    reliability: round3(c.reliability),
    freshness: round3(c.freshness),
    corroboration: round3(c.corroboration),
    sourceDiversity: round3(c.sourceDiversity),
    precision: round3(c.precision),
    historicalAccuracy: round3(c.historicalAccuracy),
    contradictionPenalty: round3(c.contradictionPenalty),
  };
}
