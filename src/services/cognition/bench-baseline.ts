/**
 * Cognition benchmark baseline comparison — single source of truth for "did
 * the cognition pipeline regress since the last reviewed baseline?"
 *
 * Mirrors src/services/ops/replay-baseline.ts exactly (same pattern: a
 * committed JSON baseline next to this module, a pure comparison function,
 * consumed by a CLI script for the CI gate). Per
 * docs/COGNITIVE_ENHANCEMENT_PLAN.md PR 16:
 *
 *   "fail on Brier regression > 0.02 absolute or coverage drop below
 *    1−α−0.05 versus the committed baseline JSON. Update the baseline only
 *    deliberately, in a reviewed diff."
 *
 * Consumers:
 *   - scripts/cognition-benchmark.mts (`npm run bench:cognition`, CI gate)
 *   - src/services/cognition/__tests__/bench-cognition.test.mts
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 */

import type { BenchReport } from './bench-cognition';

export interface BenchBaseline {
  windowCount: number;
  brier: number;
  coverageRate: number;
  targetCoverage: number;
  analogPrecisionAt5: number;
  schemaTruePositiveRate: number | null;
}

export interface BenchBaselineComparison {
  ok: boolean;
  reasons: string[];
}

/** Fail the gate when live Brier exceeds baseline Brier by more than this (absolute). */
export const BRIER_REGRESSION_TOLERANCE = 0.02;

/** Fail the gate when live coverage drops more than this many points below (1 − α). */
export const COVERAGE_DROP_TOLERANCE = 0.05;

export function compareBenchReportToBaseline(
  report: BenchReport,
  baseline: BenchBaseline,
): BenchBaselineComparison {
  const reasons: string[] = [];

  if (report.windowCount !== baseline.windowCount) {
    reasons.push(
      `golden-window count changed: baseline=${baseline.windowCount} live=${report.windowCount} ` +
      `(golden-windows.ts was edited — update bench-baseline.json deliberately, in a reviewed diff)`,
    );
  }

  const brierDelta = report.brier - baseline.brier;
  if (brierDelta > BRIER_REGRESSION_TOLERANCE) {
    reasons.push(
      `Brier regressed: baseline=${baseline.brier.toFixed(4)} live=${report.brier.toFixed(4)} ` +
      `(Δ=+${brierDelta.toFixed(4)} exceeds ${BRIER_REGRESSION_TOLERANCE} tolerance)`,
    );
  }

  const coverageFloor = baseline.targetCoverage - COVERAGE_DROP_TOLERANCE;
  if (report.coverageRate < coverageFloor) {
    reasons.push(
      `conformal coverage dropped below floor: live=${(report.coverageRate * 100).toFixed(1)}% ` +
      `< ${(coverageFloor * 100).toFixed(1)}% (target ${(baseline.targetCoverage * 100).toFixed(0)}% ` +
      `− ${(COVERAGE_DROP_TOLERANCE * 100).toFixed(0)}pt tolerance)`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}
