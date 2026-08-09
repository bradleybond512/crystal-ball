/**
 * ACC-404 — compute the first production promotion decision from a
 * localStorage export of the installed app.
 *
 * Usage:
 *   npx tsx scripts/acc404-first-decision.mts <localstorage-export.json>
 *
 * The export is a JSON object mapping localStorage keys to their raw
 * string values (at minimum 'wm-shadow-mode-comparisons',
 * 'wm-shadow-mode-runs', 'crystalball-forecast-calibration-v1').
 * Produce one from the app's DevTools console with:
 *   copy(JSON.stringify(Object.fromEntries(Object.entries(localStorage))))
 * or extract it read-only from the WKWebView localstorage.sqlite3.
 *
 * The script reconstructs the REAL modules (shadow service, calibration
 * store, exact joins, promotion gate, replay-catalog safety evidence) on
 * the exported data — no reimplementation — and prints the
 * FirstPromotionDecisionRecord JSON.
 */

import { readFileSync } from 'node:fs';
import { ShadowModeAlgorithmService } from '../src/services/intelligence/shadow-mode';
import type { PredictionRecord, ForecastCalibrationStore } from '../src/services/intelligence/forecast-calibration';
import {
  collectJoinedEvidence,
  resetShadowRolloutForTests,
  RUN_IDS,
  type RunId,
} from '../src/services/cognition/shadow-rollout';
import {
  evaluatePromotionGate,
  safetyEvidenceFromBaselineRegression,
} from '../src/services/cognition/promotion-gate';
import { decideFirstPromotion } from '../src/services/cognition/first-promotion-decision';
import { runReplay } from '../src/services/ops/replay-harness';
import { buildCatalogReplayFixtures } from '../src/services/ops/replay-fixtures-catalog';
import type { ReplayBaseline } from '../src/services/ops/replay-baseline';
import replayBaseline from '../src/services/ops/replay-baseline.json';

const CHALLENGER_RUNS: { runId: RunId; challengerId: string }[] = [
  { runId: RUN_IDS.SUPERFORECAST, challengerId: 'superforecast' },
  { runId: RUN_IDS.BASELINE_HIERARCHICAL, challengerId: 'hierarchical-base-rate' },
  { runId: RUN_IDS.BASELINE_PERSISTENCE, challengerId: 'persistence-baseline' },
  { runId: RUN_IDS.BASELINE_MOMENTUM, challengerId: 'momentum-baseline' },
];

const exportPath = process.argv[2];
if (!exportPath) {
  console.error('usage: npx tsx scripts/acc404-first-decision.mts <localstorage-export.json>');
  process.exit(1);
}

const dump = JSON.parse(readFileSync(exportPath, 'utf8')) as Record<string, string>;

// Rebuild the shadow service on the exported ledger (hydrates from the
// injected storage exactly like the app does).
const storage = {
  getItem: (k: string) => dump[k] ?? null,
  setItem: () => {},
  removeItem: () => {},
};
const shadowService = new ShadowModeAlgorithmService({ storage });

// Rebuild a read-only calibration store view over the exported records.
const records = JSON.parse(dump['crystalball-forecast-calibration-v1'] ?? '[]') as PredictionRecord[];
const calibrationStore = { all: () => records } as unknown as ForecastCalibrationStore;

// Real safety evidence from the shipped replay catalog: NO-NEW-REGRESSIONS
// against the committed baseline (the fixtures are intentionally-failing
// historical-miss cases; raw pass rate is 0 by design).
const fixtures = buildCatalogReplayFixtures();
const safety = safetyEvidenceFromBaselineRegression(
  runReplay({ fixtures }),
  fixtures,
  replayBaseline as ReplayBaseline,
);

const decidedAt = Date.now();
const challengers = CHALLENGER_RUNS.map(({ runId, challengerId }) => {
  resetShadowRolloutForTests();
  const pairs = collectJoinedEvidence(runId, { shadowService, calibrationStore, storage: null, putMemoryFn: () => Promise.resolve() });
  const decision = evaluatePromotionGate({
    challengerId,
    incumbentId: 'production',
    pairs,
    enabledDomains: [],
    safety,
    evaluatedAt: decidedAt,
  });
  return { runId, challengerId, decision };
});

const record = decideFirstPromotion({ slot: 'forecast-primary', challengers, decidedAt });

console.log(JSON.stringify({
  record,
  safetyEvidence: safety,
  rawCounts: CHALLENGER_RUNS.map(({ runId }) => ({
    runId,
    comparisons: shadowService.getComparisons({ runId }).length,
    withJoinKey: shadowService.getComparisons({ runId }).filter((c) => c.joinKey).length,
  })),
  resolvedCalibrationRecords: records.filter((r) => r.status === 'resolved_true' || r.status === 'resolved_false').length,
}, null, 2));
