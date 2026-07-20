/**
 * Correlation outcomes — every emitted CorrelatedPair is an implicit
 * forecast: "these events are genuinely related; corroboration will
 * follow." This module turns pairs into PredictionRecords and resolves
 * them deterministically from later situation state, so the calibration
 * spine can grade each correlation rule (rule-as-source).
 *
 * Pure: no DOM, no fetch, no globals, no clock reads — callers inject
 * `now`. See docs/CORRELATION_NEXTGEN_PLAN.md §D3.
 */

import type { CorrelatedPair } from '../intelligence/correlate-engine';
import type { PredictionRecord } from '../intelligence/forecast-calibration';
import type { FactDomain } from '../intelligence/types';

export const CORR_RULE_SOURCE_PREFIX = 'corr-rule:';
const PAIR_ID_PREFIX = 'corr';
const PAIR_ID_SEP = '|';

export const DEFAULT_RESOLVE_HORIZON_MS = 24 * 3_600_000;
export const DEFAULT_MAX_RECORDS_PER_RULE_PER_HOUR = 5;
const HOUR_MS = 3_600_000;

/** Stable id — same pair (either order) always maps to the same id. */
export function pairPredictionId(pair: Pick<CorrelatedPair, 'ruleId' | 'eventA' | 'eventB'>): string {
  const [first, second] =
    pair.eventA.id < pair.eventB.id
      ? [pair.eventA.id, pair.eventB.id]
      : [pair.eventB.id, pair.eventA.id];
  return [PAIR_ID_PREFIX, pair.ruleId, first, second].join(PAIR_ID_SEP);
}

/** Recover the two observation ids from a pair-prediction id, or null
 *  when the id is not one of ours / a segment contained the separator. */
export function observationIdsFromPredictionId(id: string): { a: string; b: string } | null {
  const parts = id.split(PAIR_ID_SEP);
  if (parts.length !== 4 || parts[0] !== PAIR_ID_PREFIX) return null;
  const a = parts[2];
  const b = parts[3];
  if (!a || !b) return null;
  return { a, b };
}

/** Observation-domain string → FactDomain for calibration roll-ups.
 *  Unknown domains map to 'other' — the per-rule multiplier (keyed by
 *  sourceId) is unaffected by this mapping. */
export function factDomainFor(observationDomain: string): FactDomain {
  const d = observationDomain.toLowerCase();
  if (d === 'weather' || d === 'wildfire' || d === 'flood') return 'weather';
  if (d === 'cyber') return 'cyber';
  if (d === 'aviation') return 'aviation';
  if (d === 'maritime') return 'maritime';
  if (d === 'markets' || d === 'finance' || d === 'crypto' || d === 'stocks') return 'markets';
  if (d === 'conflict' || d === 'military') return 'conflict';
  if (d === 'humanitarian' || d === 'displacement' || d === 'health' || d === 'disease') return 'humanitarian';
  if (d === 'space' || d === 'space-weather') return 'space';
  if (d === 'infrastructure' || d === 'infra' || d === 'energy' || d === 'grid') return 'infra';
  if (d === 'macro' || d === 'economy') return 'macro';
  return 'other';
}

export function buildPairPrediction(
  pair: CorrelatedPair,
  now: number,
  horizonMs: number = DEFAULT_RESOLVE_HORIZON_MS,
): PredictionRecord {
  return {
    id: pairPredictionId(pair),
    sourceId: `${CORR_RULE_SOURCE_PREFIX}${pair.ruleId}`,
    domain: factDomainFor(pair.eventA.domain),
    claim: `Correlation ${pair.ruleId}: "${pair.eventA.title}" ↔ "${pair.eventB.title}" is genuine; corroboration expected within ${Math.round(horizonMs / HOUR_MS)}h`,
    probability: pair.confidence,
    predictedAt: now,
    resolveBy: now + horizonMs,
    status: 'pending',
  };
}

/** Flood control: a rule may add at most `maxPerRulePerHour` predictions
 *  in any rolling hour. Correlation volume must never starve the ledger. */
export function shouldRecordPair(
  existing: readonly PredictionRecord[],
  ruleId: string,
  now: number,
  options: { maxPerRulePerHour?: number } = {},
): boolean {
  const max = options.maxPerRulePerHour ?? DEFAULT_MAX_RECORDS_PER_RULE_PER_HOUR;
  const sourceId = `${CORR_RULE_SOURCE_PREFIX}${ruleId}`;
  let recent = 0;
  for (const r of existing) {
    if (r.sourceId === sourceId && now - r.predictedAt < HOUR_MS) recent += 1;
    if (recent >= max) return false;
  }
  return true;
}

/** The slice of a Situation that outcome assessment needs. */
export interface SituationLite {
  observationIds: readonly string[];
  edgeCount: number;
  status: 'active' | 'watching' | 'resolved';
}

/**
 * Deterministic outcome for a pair prediction given current situations:
 *  - true  — the situation holding both observations accreted further
 *            evidence (≥3 observations or ≥2 edges): corroboration arrived.
 *  - false — that situation resolved without ever accreting.
 *  - null  — still pending (or the situation was evicted; expiry will
 *            mark the record 'expired', which Brier scoring excludes).
 */
export function assessPairOutcome(
  predictionId: string,
  situations: readonly SituationLite[],
): boolean | null {
  const ids = observationIdsFromPredictionId(predictionId);
  if (!ids) return null;
  for (const s of situations) {
    const set = new Set(s.observationIds);
    if (!set.has(ids.a) || !set.has(ids.b)) continue;
    if (set.size >= 3 || s.edgeCount >= 2) return true;
    if (s.status === 'resolved') return false;
    return null;
  }
  return null;
}
