#!/usr/bin/env node
/**
 * cognition-bench.mjs — Cognition benchmark CLI runner.
 *
 * Usage:
 *   npx tsx scripts/cognition-bench.mjs               # run and compare to baseline
 *   npx tsx scripts/cognition-bench.mjs --update-baseline  # overwrite baseline.json
 *
 * Exit codes:
 *   0  = PASS (or no baseline yet)
 *   1  = FAIL (Brier regression > 0.02 absolute, or coverage drop below 1−α−0.05)
 *
 * The baseline lives at:
 *   src/services/cognition/__bench__/baseline.json
 *
 * Gate constants (per plan):
 *   BRIER_REGRESSION_THRESHOLD = 0.02   (fail if overallBrier > baseline + 0.02)
 *   COVERAGE_FLOOR = 1 − 0.2 − 0.05     = 0.75  (fail if coverageRate < 0.75)
 *
 * Per docs/COGNITIVE_ENHANCEMENT_PLAN.md PR 16.
 */

import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(ROOT, 'src', 'services', 'cognition', '__bench__', 'baseline.json');

// ── Gate constants (per plan) ─────────────────────────────────────────────────
const BRIER_REGRESSION_THRESHOLD = 0.02;
const COVERAGE_FLOOR = 0.75; // 1 − alpha(0.2) − tolerance(0.05)

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const UPDATE_BASELINE = args.includes('--update-baseline');
const UPDATE_BASELINE_ALIAS = args.includes('update-baseline'); // without --

// ── Dynamic import of the benchmark (compiled by tsx on the fly) ──────────────
// tsx is invoked externally; by the time this script runs, imports work.
const { runBenchmark } = await import('../src/services/cognition/__bench__/run-benchmark.ts');

// ── Run the benchmark ─────────────────────────────────────────────────────────
console.log('\n=== Crystal Ball — Cognition Benchmark ===\n');
console.log('Running golden windows through deterministic pipeline...\n');

let report;
try {
  report = await runBenchmark();
} catch (err) {
  console.error('FATAL: Benchmark runner threw an exception:');
  console.error(err);
  process.exit(1);
}

// ── Print table ───────────────────────────────────────────────────────────────

const colW = [32, 8, 8, 12, 12, 12, 8];
const headers = ['Window', 'Brier', 'FinalP', 'Coverage', 'AnalogP@5', 'SchemaTP', 'Latms'];

function padEnd(s, n) { return String(s).padEnd(n); }
function padStart(s, n) { return String(s).padStart(n); }

const sep = colW.map(w => '-'.repeat(w)).join(' ');
console.log(headers.map((h, i) => padEnd(h, colW[i])).join(' '));
console.log(sep);

for (const w of report.windows) {
  const row = [
    w.windowId.slice(6, 38),                       // strip 'bench-' prefix for display
    w.windowBrier.toFixed(4),
    w.finalP.toFixed(3),
    w.intervalContainsOutcome ? 'YES' : 'NO',
    w.analogPrecision.toFixed(2),
    w.schemaFound ? 'YES' : 'NO',
    w.latencyMs.toFixed(1) + 'ms',
  ];
  console.log(row.map((v, i) => padEnd(v, colW[i])).join(' '));
}

console.log(sep);
console.log(`\nSummary (${report.windowCount} windows):`);
console.log(`  Overall Brier:          ${report.overallBrier.toFixed(4)}`);
console.log(`  Conformal coverage:     ${(report.coverageRate * 100).toFixed(1)}%`);
console.log(`  Analog precision@5:     ${(report.analogPrecisionMean * 100).toFixed(1)}%`);
console.log(`  Schema true-positive:   ${(report.schemaTruePositiveRate * 100).toFixed(1)}%`);
console.log(`  Latency p50/p95:        ${report.latencyP50Ms}ms / ${report.latencyP95Ms}ms`);
console.log(`  Ran at:                 ${report.ranAt}`);

// ── Update baseline if requested ──────────────────────────────────────────────

if (UPDATE_BASELINE || UPDATE_BASELINE_ALIAS) {
  const baseline = {
    overallBrier: report.overallBrier,
    coverageRate: report.coverageRate,
    analogPrecisionMean: report.analogPrecisionMean,
    schemaTruePositiveRate: report.schemaTruePositiveRate,
    windowCount: report.windowCount,
    updatedAt: report.ranAt,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  console.log(`\nBaseline updated at: ${BASELINE_PATH}`);
  console.log('PASS (baseline update)');
  process.exit(0);
}

// ── Load baseline ─────────────────────────────────────────────────────────────

if (!existsSync(BASELINE_PATH)) {
  console.log('\nNo baseline.json found — printing results only (exit 0).');
  console.log('To commit a baseline, run: npm run bench:cognition:update-baseline');
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch (err) {
  console.error('\nERROR: Could not parse baseline.json:', err.message);
  process.exit(1);
}

// Handle the sentinel {"pending": true} baseline from manual instructions.
if (baseline.pending === true) {
  console.log('\nBaseline is marked as pending — printing results only (exit 0).');
  console.log('To commit a real baseline, run: npm run bench:cognition:update-baseline');
  process.exit(0);
}

// ── Gate comparison ───────────────────────────────────────────────────────────

console.log('\n--- Gate Comparison ---');
const brierDelta = report.overallBrier - (baseline.overallBrier ?? 0);
const coverageDelta = report.coverageRate - (baseline.coverageRate ?? 1);

console.log(`  Brier:    ${report.overallBrier.toFixed(4)} vs baseline ${(baseline.overallBrier ?? 0).toFixed(4)} (delta ${brierDelta >= 0 ? '+' : ''}${brierDelta.toFixed(4)})`);
console.log(`  Coverage: ${(report.coverageRate * 100).toFixed(1)}% vs baseline ${((baseline.coverageRate ?? 1) * 100).toFixed(1)}% (delta ${(coverageDelta * 100).toFixed(1)}pp)`);

let passed = true;
const failures = [];

if (brierDelta > BRIER_REGRESSION_THRESHOLD) {
  failures.push(
    `Brier regression: ${report.overallBrier.toFixed(4)} > baseline(${(baseline.overallBrier ?? 0).toFixed(4)}) + ${BRIER_REGRESSION_THRESHOLD} threshold`,
  );
  passed = false;
}

if (report.coverageRate < COVERAGE_FLOOR) {
  failures.push(
    `Coverage too low: ${(report.coverageRate * 100).toFixed(1)}% < floor ${(COVERAGE_FLOOR * 100).toFixed(1)}%`,
  );
  passed = false;
}

if (passed) {
  console.log('\nPASS — all gates green.');
  process.exit(0);
} else {
  console.log('\nFAIL — gate(s) triggered:');
  for (const f of failures) {
    console.log(`  ❌ ${f}`);
  }
  console.log('\nTo update the baseline deliberately: npm run bench:cognition:update-baseline');
  process.exit(1);
}
