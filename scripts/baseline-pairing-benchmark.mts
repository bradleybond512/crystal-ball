/**
 * ACC-303 baseline-pairing benchmark CLI — `npm run bench:baselines`.
 * Runs the deterministic walk-forward pairing corpus and gates against
 * the committed baseline JSON. Exit 1 on any regression.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  comparePairingToBaseline,
  runBaselinePairingBenchmark,
  type PairingBenchmarkBaseline,
} from '../src/services/intelligence/baseline-pairing-benchmark.ts';

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(
  here,
  '../src/services/intelligence/__bench__/baseline-pairing-baseline.json',
);
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as PairingBenchmarkBaseline;

const report = runBaselinePairingBenchmark();

console.log(`Baseline pairing benchmark — corpus ${report.corpusId} (${report.fixtureCount} fixtures)`);
console.log(`  Production incumbent   Brier ${report.production.brier} over ${report.production.records}`);
for (const m of report.models) {
  console.log(
    `  ${m.model.padEnd(24)} Brier ${m.brier} over ${m.records}  skill vs production ${m.brierSkillVsProduction}`,
  );
}

const regressions = comparePairingToBaseline(report, baseline);
if (regressions.length > 0) {
  console.error('\nFAIL — pairing benchmark regressions:');
  for (const r of regressions) {
    console.error(`  ${r.model} ${r.metric}: expected ${r.expected}, got ${r.actual}`);
  }
  process.exitCode = 1;
} else {
  console.log('\nPASS — all baseline-pairing gates are within the reviewed baseline.');
}
