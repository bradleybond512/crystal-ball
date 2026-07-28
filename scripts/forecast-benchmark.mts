#!/usr/bin/env tsx

import committedBaseline from '../src/services/intelligence/__bench__/forecast-replay-baseline.json' with { type: 'json' };
import { FORECAST_REPLAY_CORPUS } from '../src/services/intelligence/__bench__/forecast-replay-corpus.ts';
import {
  compareForecastReplayToBaseline,
  runForecastReplayBenchmark,
  type ForecastReplayBaseline,
  type ForecastReplayMetricRow,
} from '../src/services/intelligence/forecast-replay-benchmark.ts';

const report = runForecastReplayBenchmark(FORECAST_REPLAY_CORPUS);
const comparison = compareForecastReplayToBaseline(
  report,
  committedBaseline as ForecastReplayBaseline,
);
const jsonOnly = process.argv.includes('--json');

if (jsonOnly) {
  console.log(JSON.stringify({ report, comparison }, null, 2));
} else {
  console.log('\nCrystal Ball — Forecast Replay Benchmark\n');
  console.log(`  Corpus                  ${report.corpus.id} (${report.corpus.recordCount} records)`);
  console.log(`  Walk-forward folds      ${report.folds.length}`);
  console.log(`  Baseline model          ${report.config.baselineModel}`);
  console.log(`  Scored / evaluation     ${report.overall.scored} / ${report.overall.evaluationRecords}`);
  console.log(`  Resolution coverage     ${percent(report.overall.resolutionCoverage)}`);
  console.log(`  Brier score             ${metric(report.overall.brier)}`);
  console.log(`  Brier skill             ${metric(report.overall.brierSkill)}`);
  console.log(`  Baseline Brier          ${metric(report.overall.baselineBrier)}`);
  console.log(`  Global baseline Brier   ${metric(report.overall.globalBaselineBrier)}`);
  console.log(`  Log loss                ${metric(report.overall.logLoss)}`);
  console.log(`  High-confidence misses  ${report.overall.highConfidenceMisses}\n`);
  printTopLoss('Source', report.groups.bySource);
  printTopLoss('Domain', report.groups.byDomain);
  printTopLoss('Horizon', report.groups.byHorizon);
  printTopLoss('Version', report.groups.byAlgorithmVersion);
  console.log('');
  if (comparison.ok) {
    console.log('PASS — all forecast replay gates are within the reviewed baseline.');
  } else {
    console.log('FAIL — forecast replay regression(s):');
    for (const regression of comparison.regressions) {
      console.log(`  - ${regression.message}`);
    }
    console.log(
      '\nUpdate forecast-replay-baseline.json only for an intentional, reviewed change.',
    );
  }
}

if (!comparison.ok) process.exitCode = 1;

function printTopLoss(
  dimension: string,
  rows: readonly ForecastReplayMetricRow[],
): void {
  const top = rows[0];
  if (!top) {
    console.log(`  Top ${dimension.toLowerCase()} loss       unavailable`);
    return;
  }
  console.log(
    `  Top ${dimension.toLowerCase()} loss       ${top.key} `
    + `${percent(top.shareOfBrierLoss)} of loss; Brier ${top.brier.toFixed(3)}; `
    + `${top.highConfidenceMisses} high-confidence misses`,
  );
}

function metric(value: number | null): string {
  return value === null ? 'insufficient evidence' : value.toFixed(4);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
