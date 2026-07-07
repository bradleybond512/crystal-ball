#!/usr/bin/env tsx
/**
 * cognition-benchmark — PR 16 Cognition Benchmark + CI Gate.
 *
 * Replays the 12 golden windows (src/services/cognition/__bench__/golden-windows.ts)
 * through the full deterministic cognition pipeline (episodic recall → base
 * rate → aggregation → recalibration → conformal, plus a held-out schema
 * stage) via runCognitionBenchmark(), prints a human-readable report, and
 * compares the result against the committed baseline
 * (src/services/cognition/bench-baseline.json).
 *
 * Usage:
 *   npm run bench:cognition            # print report, fail (exit 1) on regression
 *   npm run bench:cognition -- --json  # print report as JSON only
 *
 * This is the CI gate referenced by docs/COGNITIVE_ENHANCEMENT_PLAN.md PR 16:
 * "fail on Brier regression > 0.02 absolute or coverage drop below
 * 1−α−0.05 versus the committed baseline JSON. Update the baseline only
 * deliberately, in a reviewed diff." Wired as a step in .github/workflows/smoke.yml.
 *
 * Fully offline, fully deterministic (fixed-seed PRNG, frozen fixtures, no
 * LLM calls, no fetch) — typical runtime is a handful of milliseconds, so
 * this cannot become a slow or hanging CI step.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCognitionBenchmark } from '../src/services/cognition/bench-cognition.ts';
import { compareBenchReportToBaseline, type BenchBaseline } from '../src/services/cognition/bench-baseline.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(root, 'src', 'services', 'cognition', 'bench-baseline.json');

const isTTY = process.stdout.isTTY;
const C = {
  reset: isTTY ? '[0m' : '',
  bold: isTTY ? '[1m' : '',
  green: isTTY ? '[32m' : '',
  yellow: isTTY ? '[33m' : '',
  red: isTTY ? '[31m' : '',
  cyan: isTTY ? '[36m' : '',
  dim: isTTY ? '[2m' : '',
};

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const jsonOnly = process.argv.includes('--json');

  const report = await runCognitionBenchmark();

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n${C.bold}Crystal Ball — Cognition Benchmark${C.reset} (${report.windowCount} golden windows)\n`);
    console.log(`  Brier score              ${report.brier.toFixed(4)}  ${C.dim}(0 = perfect, 0.25 = coin-flip)${C.reset}`);
    console.log(`  Conformal coverage       ${pct(report.coverageRate)}  ${C.dim}(target ≥ ${pct(report.targetCoverage)}, α=${report.alpha})${C.reset}`);
    console.log(`  Analog precision@5       ${pct(report.analogPrecisionAt5)}`);
    console.log(
      `  Schema true-positive rate  ${report.schemaTruePositiveRate === null ? C.dim + 'n/a (no matched positives)' + C.reset : pct(report.schemaTruePositiveRate)}` +
      `  ${C.dim}(${report.schemaMatchedCount}/${report.schemaTotalCount} windows matched a learned schema)${C.reset}`,
    );
    console.log(`  Latency p50 / p95        ${report.p50LatencyMs.toFixed(2)}ms / ${report.p95LatencyMs.toFixed(2)}ms\n`);

    console.log(`  ${C.dim}window                              domain     p      recalib.  covered  precision@5${C.reset}`);
    for (const r of report.results) {
      const covered = r.coveredByInterval ? `${C.green}yes${C.reset}` : `${C.red}no${C.reset} `;
      console.log(
        `  ${r.windowId.padEnd(35)} ${r.factDomain.padEnd(10)} ${pct(r.aggregatedP).padStart(6)}  ${pct(r.recalibratedP).padStart(7)}  ${covered}      ${pct(r.precisionAt5)}`,
      );
    }
    console.log('');
  }

  let baseline: BenchBaseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as BenchBaseline;
  } catch (err) {
    console.error(`${C.red}Baseline file not found or unreadable: ${BASELINE_PATH}${C.reset}\n${String(err)}`);
    process.exitCode = 2;
    return;
  }

  const { ok, reasons } = compareBenchReportToBaseline(report, baseline);

  if (ok) {
    console.log(`${C.green}${C.bold}PASS${C.reset} — within tolerance of committed baseline (${BASELINE_PATH.replace(root + path.sep, '')}).`);
  } else {
    console.log(`${C.red}${C.bold}FAIL${C.reset} — regression(s) versus committed baseline:`);
    for (const reason of reasons) console.log(`  ${C.red}✗${C.reset} ${reason}`);
    console.log(`\nIf this regression is intentional, update ${BASELINE_PATH.replace(root + path.sep, '')} in a reviewed diff.`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 2;
});
