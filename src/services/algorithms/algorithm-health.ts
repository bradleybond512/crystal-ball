/**
 * Algorithm Health Aggregator — per
 * docs/ALGORITHM_DIAGNOSTICS_SELF_IMPROVEMENT_PLAN.md PR 3.
 *
 * Joins algorithm definitions (id / criticality / expected hit rate /
 * minimum sample size) with the calibration roll-up from the
 * Evaluation Ledger to produce a deterministic AlgorithmHealth per
 * algorithm. The closed-loop layer (PR 4) reads this to decide
 * whether an algorithm needs adjustment, alerting, or quarantine.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 *
 * Plan invariants:
 *   - Safety-critical algorithms with weighted hit rate below
 *     the minimum threshold flip to 'unsafe' (mirrors the gameplan's
 *     'never miss what matters' rule for features)
 *   - Insufficient sample size yields 'unknown', never a false-pass
 *   - Output is JSON-serializable for the diagnostics export bundle
 */

import type {
  AlgorithmDomain,
  CalibrationSummary,
  EvaluationRecord,
} from './algorithm-evaluation-ledger';

// ── Public API ──────────────────────────────────────────────────────────

export type AlgorithmCriticality = 'safety' | 'high' | 'medium' | 'low';

export type AlgorithmHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'failing'
  | 'unsafe'
  | 'unknown';

export interface AlgorithmDefinition {
  algorithmId: string;
  label: string;
  version?: string;
  domain: AlgorithmDomain;
  criticality: AlgorithmCriticality;
  /** Lower bound on the weighted hit rate before we flag the algorithm.
   *  Defaults: safety=0.85, high=0.7, medium=0.55, low=0.4. */
  minWeightedHitRate?: number;
  /** Minimum number of graded evaluations before we believe the rate.
   *  Below this we report 'unknown' instead of pretending. Defaults
   *  to 10 (small enough to react in production without snap calls). */
  minGradedSamples?: number;
  /** Optional latency upper bound — the aggregator surfaces
   *  'degraded' when meanDurationMs > maxMeanDurationMs even if hit
   *  rate is fine. */
  maxMeanDurationMs?: number;
}

export interface AlgorithmHealth {
  algorithmId: string;
  label: string;
  version?: string;
  domain: AlgorithmDomain;
  criticality: AlgorithmCriticality;
  status: AlgorithmHealthStatus;
  /** Free-text reason — surfaced in the diagnostics UI. */
  reason: string;
  /** Concrete adjustment suggestion. Required when status is degraded
   *  / failing / unsafe. Empty string when status is healthy. */
  recommendedAdjustment: string;
  /** Calibration roll-up the verdict is based on. */
  calibration?: CalibrationSummary;
}

export interface AlgorithmHealthReport {
  generatedAt: number;
  /** Worst-status-wins; safety + (failing|unsafe) → 'unsafe'. */
  status: AlgorithmHealthStatus;
  algorithms: readonly AlgorithmHealth[];
  /** Plain-English summary for the diagnostics surface. */
  summary: string;
  /** Concrete next-action recommendations sorted by criticality. */
  recommendations: readonly string[];
}

const DEFAULT_MIN_WEIGHTED_HIT_RATE: Record<AlgorithmCriticality, number> = {
  safety: 0.85,
  high: 0.7,
  medium: 0.55,
  low: 0.4,
};
const DEFAULT_MIN_GRADED_SAMPLES = 10;

// ── Aggregator ─────────────────────────────────────────────────────────

export interface AggregateAlgorithmHealthInput {
  generatedAt?: number;
  definitions: readonly AlgorithmDefinition[];
  calibrations: readonly CalibrationSummary[];
}

export function aggregateAlgorithmHealth(
  input: AggregateAlgorithmHealthInput,
): AlgorithmHealthReport {
  const generatedAt = input.generatedAt ?? Date.now();
  const calibrationByKey = new Map<string, CalibrationSummary>();
  for (const c of input.calibrations) {
    calibrationByKey.set(`${c.domain}|${c.algorithmId}`, c);
  }

  const algorithms: AlgorithmHealth[] = [];
  for (const def of input.definitions) {
    const cal = calibrationByKey.get(`${def.domain}|${def.algorithmId}`);
    algorithms.push(computeAlgorithmHealth(def, cal));
  }

  const status = decideReportStatus(algorithms);
  const summary = describeReportSummary(status, algorithms);
  const recommendations = collectRecommendations(algorithms);

  return {
    generatedAt,
    status,
    algorithms,
    summary,
    recommendations,
  };
}

function computeAlgorithmHealth(
  def: AlgorithmDefinition,
  cal: CalibrationSummary | undefined,
): AlgorithmHealth {
  const minRate = def.minWeightedHitRate ?? DEFAULT_MIN_WEIGHTED_HIT_RATE[def.criticality];
  const minSamples = def.minGradedSamples ?? DEFAULT_MIN_GRADED_SAMPLES;

  const verdict = decideAlgorithmVerdict(def, cal, minRate, minSamples);
  return {
    algorithmId: def.algorithmId,
    label: def.label,
    version: def.version,
    domain: def.domain,
    criticality: def.criticality,
    ...verdict,
    calibration: cal,
  };
}

export function filterCurrentVersionRecords(
  records: readonly EvaluationRecord[],
  definitions: readonly AlgorithmDefinition[],
): EvaluationRecord[] {
  const currentVersions = new Map<string, string>();
  for (const definition of definitions) {
    if (definition.version !== undefined) {
      currentVersions.set(definition.algorithmId, definition.version);
    }
  }
  return records.filter((record) => {
    const currentVersion = currentVersions.get(record.algorithmId);
    return currentVersion === undefined || record.version === currentVersion;
  });
}

interface AlgorithmVerdict {
  status: AlgorithmHealthStatus;
  reason: string;
  recommendedAdjustment: string;
}

function decideAlgorithmVerdict(
  def: AlgorithmDefinition,
  cal: CalibrationSummary | undefined,
  minRate: number,
  minSamples: number,
): AlgorithmVerdict {
  if (!cal || cal.graded < minSamples) {
    return {
      status: 'unknown',
      reason: cal
        ? `Only ${cal.graded} graded samples — need at least ${minSamples} to trust the rate.`
        : 'No graded samples recorded yet.',
      recommendedAdjustment: '',
    };
  }
  if (def.maxMeanDurationMs !== undefined && cal.meanDurationMs > def.maxMeanDurationMs) {
    return {
      status: 'degraded',
      reason: `Mean latency ${cal.meanDurationMs.toFixed(0)} ms exceeds the ${def.maxMeanDurationMs} ms ceiling.`,
      recommendedAdjustment:
        'Investigate the algorithm\'s hot path or reduce its sampling frequency.',
    };
  }
  if (cal.weightedHitRate >= minRate) {
    return {
      status: 'healthy',
      reason: `Weighted hit rate ${formatRate(cal.weightedHitRate)} clears the ${formatRate(minRate)} floor (n=${cal.graded}).`,
      recommendedAdjustment: '',
    };
  }
  return decideUnderfloorVerdict(def, cal, minRate);
}

function decideUnderfloorVerdict(
  def: AlgorithmDefinition,
  cal: CalibrationSummary,
  minRate: number,
): AlgorithmVerdict {
  const isLargeGap = cal.weightedHitRate < minRate - 0.1;
  // Safety criticality is stricter — any gap is at least 'failing',
  // and a large gap escalates to 'unsafe'. Non-safety: gap < 0.1 →
  // 'degraded'; gap ≥ 0.1 → 'failing'.
  const status = pickUnderfloorStatus(def.criticality, isLargeGap);
  if (status === 'unsafe') {
    return {
      status,
      reason: `Weighted hit rate ${formatRate(cal.weightedHitRate)} is well below the safety floor ${formatRate(minRate)}.`,
      recommendedAdjustment:
        'Quarantine the algorithm; require a manual review before re-enabling. The Evaluation Ledger has the most-recent misses for replay.',
    };
  }
  return {
    status,
    reason: `Weighted hit rate ${formatRate(cal.weightedHitRate)} is below the ${formatRate(minRate)} floor.`,
    recommendedAdjustment: buildAdjustmentSuggestion(def, cal, minRate),
  };
}

function buildAdjustmentSuggestion(
  def: AlgorithmDefinition,
  cal: CalibrationSummary,
  minRate: number,
): string {
  const gap = (minRate - cal.weightedHitRate).toFixed(2);
  switch (def.domain) {
    case 'truth_score': {
      return `Tighten contradiction penalties or raise the minimum corroboration count (gap ${gap}).`;
    }
    case 'evidence_graph': {
      return `Re-tune the source-trust priors against recent misses (gap ${gap}).`;
    }
    case 'situation_clustering': {
      return `Lower the cluster-merge similarity threshold so near-misses fuse correctly (gap ${gap}).`;
    }
    case 'baseline_deviation': {
      return `Refresh the seasonal baselines — recent misses may be drift, not anomalies (gap ${gap}).`;
    }
    case 'compound_risk': {
      return `Audit dependency weights; one weak input may be dragging the score (gap ${gap}).`;
    }
    case 'forecast_calibration': {
      return `Re-fit the Brier-score calibrator on the latest graded fixtures (gap ${gap}).`;
    }
    case 'watchlist_relevance': {
      return `Inspect recent dismissals; the relevance threshold may be too aggressive (gap ${gap}).`;
    }
    case 'negative_evidence': {
      return `Confirm the missing-confirmation watcher is still picking up the right signals (gap ${gap}).`;
    }
    case 'shortage_score': {
      return `Re-fit the playbook weights on the latest USDA / FRED fixtures (gap ${gap}).`;
    }
    case 'weather_polygon': {
      return `Verify saved-place coordinates and UGC zone overlap — recent misses suggest a matcher gap (gap ${gap}).`;
    }
    case 'weather_urgency': {
      return `Re-tune the urgency ladder thresholds; storm-mode may not be triggering early enough (gap ${gap}).`;
    }
    case 'reasoning_hypothesis': {
      return `Re-rank hypothesis evidence weights; recent misses point to noisy thread continuity (gap ${gap}).`;
    }
    case 'other': {
      return `Open the Evaluation Ledger and review the latest misses (gap ${gap}).`;
    }
  }
}

function pickUnderfloorStatus(
  criticality: AlgorithmCriticality,
  isLargeGap: boolean,
): AlgorithmHealthStatus {
  if (criticality === 'safety') return isLargeGap ? 'unsafe' : 'failing';
  return isLargeGap ? 'failing' : 'degraded';
}

// ── Report status calculator ───────────────────────────────────────────

const STATUS_SEVERITY: Record<AlgorithmHealthStatus, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  failing: 3,
  unsafe: 4,
};

function decideReportStatus(algorithms: readonly AlgorithmHealth[]): AlgorithmHealthStatus {
  if (algorithms.some((a) => a.criticality === 'safety' && (a.status === 'unsafe' || a.status === 'failing'))) {
    return 'unsafe';
  }
  let worst: AlgorithmHealthStatus = 'healthy';
  for (const a of algorithms) {
    if (STATUS_SEVERITY[a.status] > STATUS_SEVERITY[worst]) worst = a.status;
  }
  return worst;
}

function describeReportSummary(
  status: AlgorithmHealthStatus,
  algorithms: readonly AlgorithmHealth[],
): string {
  if (status === 'healthy') return 'All algorithms within their calibration floors.';
  if (status === 'unknown') return 'No algorithms have enough graded samples to evaluate yet.';

  const failingSafety = algorithms.filter(
    (a) => a.criticality === 'safety' && (a.status === 'unsafe' || a.status === 'failing'),
  );
  if (failingSafety.length > 0) {
    const labels = failingSafety.map((a) => a.label).slice(0, 3).join(', ');
    return `Safety-critical ${pluralize('algorithm', failingSafety.length)} below floor: ${labels}.`;
  }

  const counts = countByStatus(algorithms.map((a) => a.status));
  const parts: string[] = [];
  if (counts.failing) parts.push(`${counts.failing} failing`);
  if (counts.degraded) parts.push(`${counts.degraded} degraded`);
  if (counts.unknown) parts.push(`${counts.unknown} unknown`);
  return `Algorithms: ${parts.join(', ')}.`;
}

function collectRecommendations(algorithms: readonly AlgorithmHealth[]): readonly string[] {
  const seen = new Set<string>();
  const recs: string[] = [];
  // Sort: safety first, then by status severity desc.
  const sorted = [...algorithms].sort((a, b) => {
    if (a.criticality !== b.criticality) {
      return criticalityRank(b.criticality) - criticalityRank(a.criticality);
    }
    return STATUS_SEVERITY[b.status] - STATUS_SEVERITY[a.status];
  });
  for (const a of sorted) {
    if (!a.recommendedAdjustment) continue;
    const rec = `${a.label}: ${a.recommendedAdjustment}`;
    if (seen.has(rec)) continue;
    seen.add(rec);
    recs.push(rec);
  }
  return recs.slice(0, 8);
}

function criticalityRank(c: AlgorithmCriticality): number {
  switch (c) {
    case 'safety': {
      return 3;
    }
    case 'high': {
      return 2;
    }
    case 'medium': {
      return 1;
    }
    case 'low': {
      return 0;
    }
  }
}

function countByStatus(
  statuses: readonly AlgorithmHealthStatus[],
): Record<AlgorithmHealthStatus, number> {
  const tally: Record<AlgorithmHealthStatus, number> = {
    healthy: 0,
    degraded: 0,
    failing: 0,
    unsafe: 0,
    unknown: 0,
  };
  for (const s of statuses) tally[s] += 1;
  return tally;
}

function pluralize(noun: string, n: number): string {
  return n === 1 ? noun : `${noun}s`;
}

function formatRate(rate: number): string {
  return Number.isFinite(rate) ? `${(rate * 100).toFixed(0)}%` : 'n/a';
}
