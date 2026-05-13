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
  /** Override the computed confidence with a fixed value. Useful for
   *  high-conviction rules where temporal decay is misleading. */
  baseConfidence?: number;
}

export interface CorrelatedPair {
  ruleId: string;
  edgeType: EdgeType;
  eventA: ObservationEvent;
  eventB: ObservationEvent;
  /** 0..1 — combines temporal proximity with the rule's override. */
  confidence: number;
  detectedAt: Date;
}

export interface CorrelationResult {
  pairs: CorrelatedPair[];
  processingMs: number;
  rulesApplied: number;
  observationsConsidered: number;
}

export class CorrelateEngine {
  private readonly rules = new Map<string, CorrelationRule>();

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
    const start = nowMs();
    const pairs: CorrelatedPair[] = [];
    const seen = new Set<string>();

    for (const rule of this.rules.values()) {
      applyRule(rule, observations, now, seen, pairs);
    }

    return {
      pairs,
      processingMs: Math.max(0, nowMs() - start),
      rulesApplied: this.rules.size,
      observationsConsidered: observations.length,
    };
  }
}

function applyRule(
  rule: CorrelationRule,
  observations: readonly ObservationEvent[],
  now: Date,
  seen: Set<string>,
  pairs: CorrelatedPair[],
): void {
  const domainSet = new Set(rule.domains);
  for (let i = 0; i < observations.length; i++) {
    const a = observations[i];
    if (!a) continue;
    for (let j = i + 1; j < observations.length; j++) {
      const b = observations[j];
      if (!b) continue;
      const pair = evaluatePair(rule, domainSet, a, b, seen);
      if (pair) {
        pairs.push({ ...pair, detectedAt: now });
      }
    }
  }
}

function evaluatePair(
  rule: CorrelationRule,
  domainSet: ReadonlySet<string>,
  a: ObservationEvent,
  b: ObservationEvent,
  seen: Set<string>,
): Omit<CorrelatedPair, 'detectedAt'> | undefined {
  if (!domainMatches(domainSet, a, b)) return undefined;
  if (Math.abs(a.timestamp - b.timestamp) > rule.timeWindowMs) return undefined;
  // Run the symmetric matcher in both directions so rule authors can
  // write asymmetric checks (e.g. "earthquake first, infra after")
  // without worrying about which side is `a`.
  if (!rule.matchFn(a, b) && !tryReverse(rule, a, b)) return undefined;
  const key = pairKey(rule.id, a.id, b.id);
  if (seen.has(key)) return undefined;
  seen.add(key);
  return {
    ruleId: rule.id,
    edgeType: rule.edgeType,
    eventA: a,
    eventB: b,
    confidence: computeConfidence(rule, a, b),
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

function computeConfidence(
  rule: CorrelationRule,
  a: ObservationEvent,
  b: ObservationEvent,
): number {
  if (rule.baseConfidence !== undefined) return rule.baseConfidence;
  const gap = Math.abs(a.timestamp - b.timestamp);
  const ratio = rule.timeWindowMs > 0 ? gap / rule.timeWindowMs : 0;
  // Linear decay: 1.0 at gap=0, 0.3 at gap=timeWindowMs.
  const value = 1 - 0.7 * ratio;
  return Math.max(0.3, Math.min(1, Number(value.toFixed(4))));
}

function nowMs(): number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf ? perf.now() : Date.now();
}
