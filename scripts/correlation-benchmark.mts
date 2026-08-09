#!/usr/bin/env tsx
/**
 * correlation-benchmark — ACC-501 Frozen Correlation Benchmark + CI Gate.
 *
 * Replays the 10 frozen golden streams
 * (src/services/correlation/__bench__/golden-streams.ts) through the REAL
 * lead-lag miner and a REAL CorrelateEngine carrying the shipped built-in
 * rules via runCorrelationBenchmark(), prints a human-readable report, and
 * compares the result against the committed baseline
 * (src/services/correlation/__bench__/bench-correlation-baseline.json).
 *
 * Usage:
 *   npm run bench:correlation            # print report, fail (exit 1) on regression
 *   npm run bench:correlation -- --json  # print report as JSON only
 *   npm run bench:correlation -- --seed > /tmp/bench-correlation-baseline.candidate.json
 *                                      # validate against the previous baseline,
 *                                      # then print a candidate for review
 *
 * This is the gate ACC-502 through ACC-506 have to clear: every one of those
 * tasks claims to improve correlation quality, and this is where the claim gets
 * measured instead of asserted.
 *
 * How it fails is worth stating plainly, because it is stricter than a
 * tolerance band. The baseline pins a digest of the WHOLE report, so ANY change
 * that moves ANY reported number — a regression, an improvement, a refactor
 * that shifts a rounding — fails on identity. The one-sided tolerances then
 * decide, at re-seed time, whether the new numbers are ALLOWED to replace the
 * old ones. So the workflow for a real change is:
 *
 *   1. make the change, run this; it fails on `reportDigest`;
 *   2. `npm run bench:correlation -- --seed >
 *      /tmp/bench-correlation-baseline.candidate.json` — this first refuses
 *      regressions against the PREVIOUS baseline, then gives a human-readable
 *      candidate to inspect;
 *   3. copy it over bench-correlation-baseline.json, append a `note` paragraph
 *      saying what moved and why;
 *   4. re-run; the tolerances now gate the new numbers against the old ones,
 *      and the PR diff shows a reviewer exactly what changed.
 *
 * The earlier design — pin the aggregates, re-derive everything else — let a
 * producer-side change move the report and its own witness together. Wired as a
 * step in .github/workflows/smoke.yml.
 *
 * Fully offline, fully deterministic (frozen fixtures, fixed-seed jitter,
 * injected `timer: () => 0`, fixed `now`, no fetch) — typical runtime is well
 * under a second, so this cannot become a slow or hanging CI step.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCorrelationBenchmark } from '../src/services/correlation/bench-correlation.ts';
import {
  CORRELATION_BENCH_V11_TO_V12_MIGRATION,
  CORRELATION_BENCH_V12_TO_V13_MIGRATION,
  validateCorrelationBenchV12ToV13Migration,
  compareCorrelationBenchReseedToPrevious,
  compareCorrelationBenchToBaseline,
  seedCorrelationBenchBaseline,
  validateCorrelationBenchV11ToV12Migration,
  type CorrelationBenchBaseline,
} from '../src/services/correlation/bench-correlation-baseline.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(
  root, 'src', 'services', 'correlation', '__bench__', 'bench-correlation-baseline.json',
);
const CANDIDATE_PATH = '/tmp/bench-correlation-baseline.candidate.json';

const isTTY = process.stdout.isTTY;
const C = {
  reset: isTTY ? '[0m' : '',
  bold: isTTY ? '[1m' : '',
  green: isTTY ? '[32m' : '',
  yellow: isTTY ? '[33m' : '',
  red: isTTY ? '[31m' : '',
  dim: isTTY ? '[2m' : '',
};

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function verdictColor(verdict: string): string {
  if (verdict === 'causal') return C.green;
  if (verdict === 'unplanted') return C.dim;
  return C.yellow;
}

/** null when unreadable — the caller decides whether that is fatal. */
function loadBaseline(baselinePath = BASELINE_PATH): CorrelationBenchBaseline | null {
  try {
    return JSON.parse(readFileSync(baselinePath, 'utf8')) as CorrelationBenchBaseline;
  } catch (err) {
    console.error(`${C.red}Baseline file not found or unreadable: ${baselinePath}${C.reset}\n${String(err)}`);
    return null;
  }
}

function optionValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a file path`);
  }
  return value;
}

function main(): void {
  const jsonOnly = process.argv.includes('--json');
  const report = runCorrelationBenchmark();

  // Re-seed mode prints candidate JSON to STDOUT only after the new run passes
  // every one-sided gate against the PREVIOUS reviewed baseline. Operator and
  // CI instructions always redirect to a temporary candidate path: truncating
  // the tracked baseline before this process reads it destroys the reference
  // the guard exists to enforce.
  if (process.argv.includes('--seed')) {
    const previousPath = optionValue('--previous-baseline') ?? BASELINE_PATH;
    const prev = loadBaseline(previousPath);
    if (prev === null) {
      process.exitCode = 2;
      return;
    }
    // A schema bump short-circuits the normal comparator before its tolerance
    // loop, so each one gets an explicit, pinned migration instead of a pass
    // from a check that never ran.
    let comparison;
    if (prev.schemaVersion === 11) {
      comparison = validateCorrelationBenchV11ToV12Migration(
        report,
        prev,
        CORRELATION_BENCH_V11_TO_V12_MIGRATION,
      );
    } else if (prev.schemaVersion === 12) {
      comparison = validateCorrelationBenchV12ToV13Migration(
        report,
        prev,
        CORRELATION_BENCH_V12_TO_V13_MIGRATION,
      );
    } else {
      comparison = compareCorrelationBenchReseedToPrevious(report, prev);
    }
    if (!comparison.ok) {
      console.error(
        `${C.red}${C.bold}REFUSED${C.reset} — re-seed candidate regresses against or is ` +
        `incomparable with the previous baseline (${previousPath}):`,
      );
      for (const reason of comparison.reasons) {
        console.error(`  ${C.red}✗${C.reset} ${reason}`);
      }
      process.exitCode = 1;
      return;
    }
    const seeded = seedCorrelationBenchBaseline(
      report,
      { note: prev.note, tolerances: prev.tolerances },
      new Date().toISOString(),
    );
    console.log(JSON.stringify(seeded, null, 2));
    console.error(
      `${C.yellow}Seeded from the current run.${C.reset} Read it, then append a note ` +
      `paragraph saying what moved and why — the tolerances and the note are carried ` +
      `over verbatim and are yours to justify. Keep the candidate at ${CANDIDATE_PATH} ` +
      `until that review is complete.`,
    );
    return;
  }

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `\n${C.bold}Crystal Ball — Correlation Benchmark${C.reset} ` +
      `(${report.streamCount} golden streams, ${report.observationCount} observations)\n`,
    );

    console.log(`  ${C.bold}Lead-lag miner${C.reset}  ${C.dim}(domain-level truth)${C.reset}`);
    console.log(`    Coupling precision      ${pct(report.couplingPrecision).padStart(6)}  ${C.dim}${report.significantEdgeCount} significant of ${report.minedEdgeCount} mined${C.reset}`);
    console.log(`    Coupling recall         ${pct(report.couplingRecall).padStart(6)}  ${C.dim}${report.plantedCausalCount} planted causal couplings${C.reset}`);
    if (report.missingCouplings.length > 0) {
      console.log(`    ${C.red}Missed${C.reset}                  ${report.missingCouplings.join(', ')}`);
    }
    console.log(`    Evidence separation     ${fmt(report.edgeEvidenceSeparation)}  ${C.dim}mean z: causal ${report.meanCausalEdgeZ} vs false ${fmt(report.meanFalseEdgeZ)}${C.reset}`);
    console.log(`    Strength separation     ${fmt(report.edgeStrengthSeparation)}  ${C.dim}saturating blend — near-flat by construction${C.reset}`);
    console.log(`    False positives         confounded ${report.confoundedFalsePositives} · mediated ${report.mediatedFalsePositives} · independent ${report.independentFalsePositives} · inhibitory ${report.inhibitoryEdgesReported} · unplanted ${report.unplantedFalsePositives}\n`);

    console.log(`  ${C.bold}Learned rules${C.reset}  ${C.dim}(mined edges → live CorrelationRules)${C.reset}`);
    console.log(`    Rules synthesised       ${report.learnedRuleCount}  ${C.dim}${report.learnedRuleFalsePositives} from non-causal edges${C.reset}`);
    if (report.causalCouplingsLostToCap.length > 0) {
      console.log(`    ${C.yellow}Evicted at the cap${C.reset}      ${report.causalCouplingsLostToCap.join(', ')}  ${C.dim}real signal outranked by noise${C.reset}`);
    }
    console.log(`    Pair blast radius       ${report.learnedRulePairCount}  ${C.dim}pairs attributed to learned:* rules${C.reset}\n`);

    console.log(`  ${C.bold}CorrelateEngine${C.reset}  ${C.dim}(built-in rules only, event-level truth)${C.reset}`);
    console.log(`    Pair precision          ${pct(report.pairPrecision).padStart(6)}  ${C.dim}${report.distinctEnginePairCount} distinct pairs of ${report.enginePairCount} emissions${C.reset}`);
    console.log(`    Pair recall             ${pct(report.pairRecall).padStart(6)}`);
    console.log(`    Near-miss decoy pairs   ${report.decoyPairsEmitted === 0 ? `${C.green}0${C.reset}` : `${C.red}${report.decoyPairsEmitted}${C.reset}`}  ${C.dim}zero-tolerance${C.reset}`);
    console.log(`    Mean true confidence    ${report.meanTruePairConfidence}  ${C.dim}false ${fmt(report.meanFalsePairConfidence)}${C.reset}\n`);

    console.log(`  ${C.dim}verdict       edge                              sup   lift      z       window  learned${C.reset}`);
    for (const e of report.edges) {
      console.log(
        `  ${verdictColor(e.verdict)}${e.verdict.padEnd(12)}${C.reset}  ` +
        `${`${e.from} → ${e.to}`.padEnd(32)}  ${String(e.support).padStart(3)}  ` +
        `${fmt(e.lift).padStart(8)}  ${fmt(e.zScore).padStart(6)}  ${`${e.windowHours}h`.padStart(5)}  ` +
        `${e.becameLearnedRule ? 'yes' : C.dim + 'no' + C.reset}`,
      );
    }
    console.log('');
  }

  const baseline = loadBaseline();
  if (baseline === null) {
    process.exitCode = 2;
    return;
  }

  const { ok, reasons } = compareCorrelationBenchToBaseline(report, baseline);
  const rel = BASELINE_PATH.replace(root + path.sep, '');

  // `--json` promises parseable JSON on stdout, so the verdict goes to stderr
  // in that mode. Exit codes are identical either way — a caller piping to jq
  // still learns PASS/FAIL from the status, not from a trailing line it would
  // have to strip.
  const say = jsonOnly
    ? (line: string): void => { console.error(line); }
    : (line: string): void => { console.log(line); };

  if (ok) {
    say(`${C.green}${C.bold}PASS${C.reset} — within tolerance of committed baseline (${rel}).`);
  } else {
    say(`${C.red}${C.bold}FAIL${C.reset} — regression(s) versus committed baseline:`);
    for (const reason of reasons) say(`  ${C.red}✗${C.reset} ${reason}`);
    say(
      `\nIf this change is intentional — including an IMPROVEMENT, which fails the ` +
      `reportDigest like anything else that moves a number — re-seed ${rel} in a reviewed ` +
      `diff:\n  npm run bench:correlation -- --seed > ${CANDIDATE_PATH}`,
    );
    process.exitCode = 1;
  }
}

/** `null` renders as an explicit dash — never as an empty column. */
function fmt(v: number | null): string {
  return v === null ? '—' : String(v);
}

try {
  main();
} catch (err: unknown) {
  console.error(err);
  process.exitCode = 2;
}
