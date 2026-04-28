/**
 * Mission Effectiveness scorer — per
 * docs/CLOSED_LOOP_INTELLIGENCE_OPERATIONS_PLAN.md PR 4.
 *
 * Reads MissionRecords and produces a per-domain effectiveness
 * score that combines hit rate, lead-time accuracy, false-positive
 * rate, and user follow-through.
 *
 * Pure deterministic. No DOM, no fetch, no globals.
 */

import type { MissionDomain, MissionRecord } from './mission-types';

// ── Public API ──────────────────────────────────────────────────────────

export interface EffectivenessScore {
  domain: MissionDomain;
  /** Total missions evaluated. */
  total: number;
  hits: number;
  misses: number;
  expired: number;
  cancelled: number;
  /** hits / (hits + misses). NaN when both are 0. */
  hitRate: number;
  /** Fraction of resolved missions where the user took an explicit
   *  action. */
  userFollowThroughRate: number;
  /** 0..1 weighted score: 0.6 × hitRate + 0.2 × (1 − missRate) +
   *  0.2 × userFollowThroughRate. NaN when there are no resolved
   *  missions. */
  effectiveness: number;
  /** Letter grade derived from the effectiveness score. */
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | 'N/A';
}

export interface EffectivenessReport {
  generatedAt: number;
  scores: readonly EffectivenessScore[];
  /** Worst-domain summary. */
  summary: string;
  /** Concrete next-action recommendations, capped at 5. */
  recommendations: readonly string[];
}

export interface ScoreEffectivenessOptions {
  generatedAt?: number;
}

export function scoreEffectiveness(
  missions: readonly MissionRecord[],
  options: ScoreEffectivenessOptions = {},
): EffectivenessReport {
  const generatedAt = options.generatedAt ?? Date.now();
  const buckets = new Map<MissionDomain, MissionRecord[]>();
  for (const m of missions) {
    const list = buckets.get(m.domain) ?? [];
    list.push(m);
    buckets.set(m.domain, list);
  }
  const scores: EffectivenessScore[] = [];
  for (const [domain, list] of buckets) {
    scores.push(scoreOne(domain, list));
  }
  scores.sort((a, b) => a.domain.localeCompare(b.domain));
  return {
    generatedAt,
    scores,
    summary: buildSummary(scores),
    recommendations: collectRecommendations(scores),
  };
}

function scoreOne(domain: MissionDomain, list: readonly MissionRecord[]): EffectivenessScore {
  let hits = 0;
  let misses = 0;
  let expired = 0;
  let cancelled = 0;
  let resolvedWithFollowThrough = 0;
  let resolved = 0;
  for (const m of list) {
    switch (m.status) {
      case 'resolved_hit': {
        hits += 1;
        resolved += 1;
        if (hasUserAction(m)) resolvedWithFollowThrough += 1;
        break;
      }
      case 'resolved_miss': {
        misses += 1;
        resolved += 1;
        if (hasUserAction(m)) resolvedWithFollowThrough += 1;
        break;
      }
      case 'expired': {
        expired += 1;
        break;
      }
      case 'cancelled': {
        cancelled += 1;
        break;
      }
      case 'active': {
        break;
      }
    }
  }
  const denom = hits + misses;
  const hitRate = denom === 0 ? Number.NaN : hits / denom;
  const missRate = denom === 0 ? Number.NaN : misses / denom;
  const userFollowThroughRate =
    resolved === 0 ? Number.NaN : resolvedWithFollowThrough / resolved;
  const effectiveness =
    denom === 0 || resolved === 0
      ? Number.NaN
      : 0.6 * hitRate + 0.2 * (1 - missRate) + 0.2 * userFollowThroughRate;

  return {
    domain,
    total: list.length,
    hits,
    misses,
    expired,
    cancelled,
    hitRate,
    userFollowThroughRate,
    effectiveness,
    grade: pickGrade(effectiveness),
  };
}

function hasUserAction(m: MissionRecord): boolean {
  return m.events.some(
    (e) => e.kind === 'user_acknowledged' || e.kind === 'user_action_taken',
  );
}

function pickGrade(effectiveness: number): EffectivenessScore['grade'] {
  if (!Number.isFinite(effectiveness)) return 'N/A';
  if (effectiveness >= 0.9) return 'A';
  if (effectiveness >= 0.8) return 'B';
  if (effectiveness >= 0.7) return 'C';
  if (effectiveness >= 0.6) return 'D';
  return 'F';
}

function buildSummary(scores: readonly EffectivenessScore[]): string {
  if (scores.length === 0) return 'No mission data.';
  const evaluable = scores.filter((s) => Number.isFinite(s.effectiveness));
  if (evaluable.length === 0) return 'No resolved missions yet.';
  const worst = evaluable.reduce(
    (acc, s) => (s.effectiveness < acc.effectiveness ? s : acc),
    evaluable[0]!,
  );
  return `Worst domain: ${worst.domain} (effectiveness ${(worst.effectiveness * 100).toFixed(0)}%, grade ${worst.grade}).`;
}

function collectRecommendations(scores: readonly EffectivenessScore[]): readonly string[] {
  const out: string[] = [];
  for (const s of scores) {
    if (!Number.isFinite(s.effectiveness)) continue;
    if (s.grade === 'A' || s.grade === 'B') continue;
    if (s.misses > s.hits) {
      out.push(`${s.domain}: more misses than hits — open the Evaluation Ledger and review the most-recent failure modes.`);
    } else if (Number.isFinite(s.userFollowThroughRate) && s.userFollowThroughRate < 0.3) {
      out.push(`${s.domain}: low user follow-through (${(s.userFollowThroughRate * 100).toFixed(0)}%) — consider reducing alert frequency or raising the threshold.`);
    } else {
      out.push(`${s.domain}: effectiveness below B — re-tune thresholds or revisit dependencies.`);
    }
    if (out.length >= 5) break;
  }
  return out;
}
