/**
 * Correlate stage — cross-domain signal joining.
 *
 * Takes a list of ObservationEvents and a registered rule set and
 * produces pairs of events the rule set thinks are related. Pure
 * deterministic: no DOM, no fetch, no globals at import time.
 *
 * Complexity: O(n²) within the rule's time window. Caller is expected
 * to feed a bounded slice — e.g. the last 30 minutes of events — not
 * the entire ring buffer.
 */

import type { ObservationEvent } from './observation-adapters';
import {
  computeEdgeConfidence,
  pairDistanceKm,
  sharedEntityCount,
  type EdgeConfidence,
} from '../correlation/edge-confidence';

export type EdgeType = 'co-located' | 'temporally-adjacent' | 'causal-candidate' | 'contradicts';

export interface CorrelationRule {
  id: string;
  name: string;
  description: string;
  /** Domains the rule cares about. Used to prune work — if neither
   *  side of a candidate pair touches a listed domain, the pair is
   *  skipped before the matchFn runs. Empty array = any domain. */
  domains: string[];
  /** Two events must be within this many ms of each other on the
   *  ObservationEvent.timestamp axis. */
  timeWindowMs: number;
  matchFn: (a: ObservationEvent, b: ObservationEvent) => boolean;
  edgeType: EdgeType;
  /** Rule conviction: disables temporal decay and becomes the base
   *  factor of the kernel score. Spatial / entity / learned-reliability
   *  factors still modulate the result. */
  baseConfidence?: number;
}

export interface CorrelatedPair {
  ruleId: string;
  edgeType: EdgeType;
  eventA: ObservationEvent;
  eventB: ObservationEvent;
  /** 0..1 — multi-factor kernel score; equals confidenceDetail.value. */
  confidence: number;
  /** Factor breakdown + explanation for the score above. */
  confidenceDetail?: EdgeConfidence;
  detectedAt: Date;
}

export interface CorrelateEngineOptions {
  /** Per-rule learned reliability multiplier (correlation outcome ledger).
   *  Return 1 for neutral. Clamped downstream to [0.5, 1.5]. */
  reliabilityFor?: (ruleId: string) => number;
  /** Regime-coupling factor for a candidate pair (BOCPD integration).
   *  Return 1 for neutral. Boost-only: clamped downstream to [1, 1.15]. */
  regimeFactorFor?: (a: ObservationEvent, b: ObservationEvent) => number;
  /** Time-window multiplier per rule (regime coupling widens the search
   *  while a regime is moving). Return 1 for neutral; clamped to [1, 2].
   *  The widened window also drives the temporal kernel, so admitted
   *  far-gap pairs are scored on the window that admitted them. */
  windowMultiplierFor?: (rule: CorrelationRule) => number;
  /** Monotonic timer used only for the diagnostic `processingMs` field.
   *  Inject a fake in tests to make the whole CorrelationResult
   *  deterministic. Defaults to performance.now / Date.now. */
  timer?: () => number;
}

export interface CorrelationResult {
  pairs: CorrelatedPair[];
  processingMs: number;
  rulesApplied: number;
  observationsConsidered: number;
}

export class CorrelateEngine {
  private readonly rules = new Map<string, CorrelationRule>();
  private readonly options: CorrelateEngineOptions;

  constructor(options: CorrelateEngineOptions = {}) {
    this.options = options;
  }

  registerRule(rule: CorrelationRule): void {
    this.rules.set(rule.id, rule);
  }

  unregisterRule(id: string): void {
    this.rules.delete(id);
  }

  getRules(): readonly CorrelationRule[] {
    return [...this.rules.values()];
  }

  correlate(observations: readonly ObservationEvent[], now: Date = new Date()): CorrelationResult {
    const timer = this.options.timer ?? nowMs;
    const start = timer();
    const pairs: CorrelatedPair[] = [];
    const seen = new Set<string>();

    for (const rule of this.rules.values()) {
      applyRule(rule, observations, now, seen, pairs, this.options);
    }

    return {
      pairs,
      processingMs: Math.max(0, timer() - start),
      rulesApplied: this.rules.size,
      observationsConsidered: observations.length,
    };
  }

  correlateIncremental(
    current: ObservationEvent,
    history: readonly ObservationEvent[],
    now: Date = new Date(),
  ): CorrelationResult {
    const timer = this.options.timer ?? nowMs;
    const start = timer();
    const pairs: CorrelatedPair[] = [];
    const seen = new Set<string>();

    for (const rule of this.rules.values()) {
      applyRuleIncremental(rule, current, history, now, seen, pairs, this.options);
    }

    return {
      pairs,
      processingMs: Math.max(0, timer() - start),
      rulesApplied: this.rules.size,
      observationsConsidered: history.length + 1,
    };
  }
}

function applyRuleIncremental(
  rule: CorrelationRule,
  current: ObservationEvent,
  history: readonly ObservationEvent[],
  now: Date,
  seen: Set<string>,
  pairs: CorrelatedPair[],
  options: CorrelateEngineOptions,
): void {
  const domainSet = new Set(rule.domains);
  const effectiveWindowMs = effectiveWindowFor(rule, options);
  for (const previous of history) {
    if (previous.id === current.id) continue;
    const pair = evaluatePair(
      rule,
      domainSet,
      previous,
      current,
      seen,
      options,
      effectiveWindowMs,
    );
    if (pair) pairs.push({ ...pair, detectedAt: now });
  }
}

function applyRule(
  rule: CorrelationRule,
  observations: readonly ObservationEvent[],
  now: Date,
  seen: Set<string>,
  pairs: CorrelatedPair[],
  options: CorrelateEngineOptions,
): void {
  const domainSet = new Set(rule.domains);
  const effectiveWindowMs = effectiveWindowFor(rule, options);
  for (let i = 0; i < observations.length; i++) {
    const a = observations[i];
    if (!a) continue;
    for (let j = i + 1; j < observations.length; j++) {
      const b = observations[j];
      if (!b) continue;
      const pair = evaluatePair(rule, domainSet, a, b, seen, options, effectiveWindowMs);
      if (pair) {
        pairs.push({ ...pair, detectedAt: now });
      }
    }
  }
}

/** Regime coupling can widen a rule's window; a broken provider must
 *  never shrink or explode it — clamp [1, 2]; non-finite or throwing
 *  providers are neutral. */
function effectiveWindowFor(rule: CorrelationRule, options: CorrelateEngineOptions): number {
  const raw = safeProviderValue(() => options.windowMultiplierFor?.(rule));
  const mult = raw !== undefined && Number.isFinite(raw)
    ? Math.max(1, Math.min(2, raw))
    : 1;
  return rule.timeWindowMs * mult;
}

/** Injected providers must never break correlate() — a throw degrades
 *  to neutral (undefined), same as an absent provider. */
function safeProviderValue(call: () => number | undefined): number | undefined {
  try {
    return call();
  } catch {
    return undefined;
  }
}

function evaluatePair(
  rule: CorrelationRule,
  domainSet: ReadonlySet<string>,
  a: ObservationEvent,
  b: ObservationEvent,
  seen: Set<string>,
  options: CorrelateEngineOptions,
  effectiveWindowMs: number,
): Omit<CorrelatedPair, 'detectedAt'> | undefined {
  if (!domainMatches(domainSet, a, b)) return undefined;
  if (Math.abs(a.timestamp - b.timestamp) > effectiveWindowMs) return undefined;
  // Run the symmetric matcher in both directions so rule authors can
  // write asymmetric checks (e.g. "earthquake first, infra after")
  // without worrying about which side is `a`.
  if (!rule.matchFn(a, b) && !tryReverse(rule, a, b)) return undefined;
  const key = pairKey(rule.id, a.id, b.id);
  if (seen.has(key)) return undefined;
  seen.add(key);
  const detail = computeEdgeConfidence({
    gapMs: Math.abs(a.timestamp - b.timestamp),
    timeWindowMs: effectiveWindowMs,
    baseConfidence: rule.baseConfidence,
    distanceKm: pairDistanceKm(a, b),
    sharedEntityCount: sharedEntityCount(a.entityIds, b.entityIds),
    reliability: safeProviderValue(() => options.reliabilityFor?.(rule.id)),
    regimeFactor: safeProviderValue(() => options.regimeFactorFor?.(a, b)),
  });
  return {
    ruleId: rule.id,
    edgeType: rule.edgeType,
    eventA: a,
    eventB: b,
    confidence: detail.value,
    confidenceDetail: detail,
  };
}

function tryReverse(
  rule: CorrelationRule,
  first: ObservationEvent,
  second: ObservationEvent,
): boolean {
  return rule.matchFn(second, first);
}

function domainMatches(
  domainSet: ReadonlySet<string>,
  a: ObservationEvent,
  b: ObservationEvent,
): boolean {
  if (domainSet.size === 0) return true;
  return domainSet.has(a.domain) || domainSet.has(b.domain);
}

function pairKey(ruleId: string, aId: string, bId: string): string {
  const [first, second] = aId < bId ? [aId, bId] : [bId, aId];
  return `${ruleId}|${first}|${second}`;
}

function nowMs(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf ? perf.now() : Date.now();
}
