/**
 * Replay baseline comparison — single source of truth for "does the current
 * replay-fixtures-catalog run still match the committed baseline?".
 *
 * Consumers:
 *   - scripts/smoke.mts (CI tier 1)
 *   - scripts/checkup.mjs (shape-only mirror)
 *   - SystemDiagnosticPanel Self-Test tab (`replay_baseline` probe)
 *
 * The committed baseline lives next to this module in replay-baseline.json.
 * The catalog fixtures are intentionally-failing regression cases (the five
 * documented missed events), so the meaningful check is baseline equality,
 * not a pass verdict.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 */

import type { ReplayHarnessReport } from './replay-harness';

export interface ReplayBaseline {
  fixtures: Record<string, string>;
}

export interface ReplayBaselineComparison {
  ok: boolean;
  mismatches: string[];
  /** Number of fixtures in the live report. */
  fixtureCount: number;
}

export function compareReplayReportToBaseline(
  report: ReplayHarnessReport,
  baseline: ReplayBaseline,
): ReplayBaselineComparison {
  const mismatches: string[] = [];
  for (const r of report.results) {
    const expected = baseline.fixtures[r.fixtureId];
    if (expected === undefined) {
      mismatches.push(`${r.fixtureId}: new fixture not in baseline (expected missing)`);
    } else if (r.outcome !== expected) {
      mismatches.push(`${r.fixtureId}: expected ${expected}, got ${r.outcome}`);
    }
  }
  // Also flag baselines that no longer have a matching fixture.
  for (const id of Object.keys(baseline.fixtures)) {
    if (!report.results.some((r) => r.fixtureId === id)) {
      mismatches.push(`${id}: in baseline but no matching fixture`);
    }
  }
  return { ok: mismatches.length === 0, mismatches, fixtureCount: report.results.length };
}
