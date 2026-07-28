/**
 * ACC-303 baseline-pairing benchmark — deterministic walk-forward
 * evaluation of the persistence and momentum baselines against the
 * production (incumbent) probabilities and the hierarchical base rate,
 * on the dedicated pairing corpus (the frozen ACC-301 replay corpus
 * cannot exercise these families).
 *
 * For every fixture, in strict time order, each applicable model sees
 * ONLY prior fixtures' resolutions (and only pre-forecast price
 * samples). Reported per model: record count, Brier, and Brier SKILL
 * versus the corpus's SYNTHETIC incumbent on the SAME records. The
 * incumbent is an outcome-informed oracle by construction — skill here
 * is a FIXED regression reference, not a claim about the real
 * production system (the live shadow pairing runs measure that). A
 * committed JSON gates regressions on baseline Brier, incumbent drift,
 * and skill drift.
 *
 * Pure and deterministic: no clock reads, no store singletons.
 */

import type { PredictionRecord } from './forecast-calibration';
import {
  baselinePairingFixtures,
  BASELINE_PAIRING_CORPUS_ID,
  type PairingFixture,
} from './__bench__/baseline-pairing-corpus';
import { estimatePersistenceBaseline, PERSISTENCE_BASELINE_SOURCE_ID } from './persistence-baseline';
import {
  estimateMomentumBaseline,
  MOMENTUM_BASELINE_SOURCE_ID,
  type MomentumSample,
} from './momentum-baseline';
import { estimateHierarchicalBaseRate, HIERARCHICAL_BASE_RATE_SOURCE_ID } from './hierarchical-base-rate';

export interface PairingModelReport {
  model: string;
  records: number;
  brier: number;
  /** SYNTHETIC incumbent Brier on the SAME records (oracle reference). */
  productionBrier: number;
  /** productionBrier − modelBrier vs the synthetic incumbent reference. */
  brierSkillVsProduction: number;
}

export interface PairingBenchmarkReport {
  corpusId: string;
  fixtureCount: number;
  production: { records: number; brier: number };
  models: PairingModelReport[];
}

export interface PairingBenchmarkBaseline {
  corpusId: string;
  fixtureCount: number;
  productionBrier: number;
  models: {
    model: string;
    records: number;
    brier: number;
    brierSkillVsProduction: number;
  }[];
  tolerances: {
    brierIncrease: number;
    recordCountChange: number;
    /** Max |actual − expected| for the synthetic incumbent's Brier and
     *  each model's skill — the corpus is deterministic, so ANY drift
     *  means the oracle or corpus changed and must be re-reviewed. */
    referenceDrift: number;
  };
}

export interface PairingRegression {
  model: string;
  metric: 'records' | 'brier' | 'missing-model' | 'incumbent-brier' | 'skill-drift';
  expected: number;
  actual: number;
}

function fixtureToRecord(f: PairingFixture, resolved: boolean): PredictionRecord {
  const outcomeStatus = f.outcome ? 'resolved_true' : 'resolved_false';
  const resolvedStatus = resolved ? outcomeStatus : 'pending';
  return {
    id: `pairing:${f.id}`,
    sourceId: f.family === 'market' ? 'analyst-loop' : `${f.family}-forecast`,
    targetKey: f.targetKey,
    domain: f.domain as PredictionRecord['domain'],
    claim: `pairing fixture ${f.id}`,
    probability: f.productionProbability,
    predictedAt: f.predictedAt,
    resolveBy: f.resolveBy,
    status: resolvedStatus,
    resolvedAt: resolved ? f.resolvedAt : undefined,
    resolutionNote: resolved ? 'direct:pairing-corpus' : undefined,
    criteria: f.criteria,
  } as PredictionRecord;
}

function momentumSamples(f: PairingFixture): MomentumSample[] {
  return (f.priceSeries ?? []).map((p) => ({
    observedAt: f.predictedAt + p.offsetMs,
    price: p.price,
  }));
}

function brier(scores: readonly { p: number; outcome: boolean }[]): number {
  if (scores.length === 0) return 0;
  const sum = scores.reduce((acc, s) => acc + (s.p - (s.outcome ? 1 : 0)) ** 2, 0);
  return sum / scores.length;
}

function round6(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}

export function runBaselinePairingBenchmark(): PairingBenchmarkReport {
  const fixtures = baselinePairingFixtures();
  const perModel = new Map<string, { p: number; outcome: boolean; production: number }[]>();
  const productionScores: { p: number; outcome: boolean }[] = [];

  for (const fixture of fixtures) {
    const target = fixtureToRecord(fixture, false);
    // Walk-forward history: every fixture resolved BEFORE this target's
    // predictedAt (the estimators re-enforce their own cutoffs anyway).
    const history = fixtures
      .filter((f) => f.resolvedAt < fixture.predictedAt)
      .map((f) => fixtureToRecord(f, true));

    productionScores.push({ p: fixture.productionProbability, outcome: fixture.outcome });

    const candidates: [string, number | undefined][] = [
      [PERSISTENCE_BASELINE_SOURCE_ID, estimatePersistenceBaseline(target, history)?.probability],
      [MOMENTUM_BASELINE_SOURCE_ID, estimateMomentumBaseline(target, momentumSamples(fixture))?.probability],
      [HIERARCHICAL_BASE_RATE_SOURCE_ID, estimateHierarchicalBaseRate(target, history)?.probability],
    ];
    for (const [model, p] of candidates) {
      if (p === undefined) continue;
      const list = perModel.get(model) ?? [];
      list.push({ p, outcome: fixture.outcome, production: fixture.productionProbability });
      perModel.set(model, list);
    }
  }

  const models: PairingModelReport[] = [...perModel.entries()]
    .map(([model, scores]) => {
      const modelBrier = brier(scores);
      const productionBrier = brier(scores.map((s) => ({ p: s.production, outcome: s.outcome })));
      return {
        model,
        records: scores.length,
        brier: round6(modelBrier),
        productionBrier: round6(productionBrier),
        brierSkillVsProduction: round6(productionBrier - modelBrier),
      };
    })
    .sort((a, b) => a.model.localeCompare(b.model));

  return {
    corpusId: BASELINE_PAIRING_CORPUS_ID,
    fixtureCount: fixtures.length,
    production: { records: productionScores.length, brier: round6(brier(productionScores)) },
    models,
  };
}

/** Compare a fresh run to the committed baseline. Fails closed on
 *  corpus identity, missing models, record-count drift beyond tolerance,
 *  and Brier regressions beyond tolerance. */
export function comparePairingToBaseline(
  report: PairingBenchmarkReport,
  baseline: PairingBenchmarkBaseline,
): PairingRegression[] {
  const regressions: PairingRegression[] = [];
  if (report.corpusId !== baseline.corpusId || report.fixtureCount !== baseline.fixtureCount) {
    regressions.push({
      model: 'corpus',
      metric: 'records',
      expected: baseline.fixtureCount,
      actual: report.corpusId === baseline.corpusId ? report.fixtureCount : -1,
    });
    return regressions;
  }
  if (Math.abs(report.production.brier - baseline.productionBrier) > baseline.tolerances.referenceDrift) {
    regressions.push({
      model: 'incumbent',
      metric: 'incumbent-brier',
      expected: baseline.productionBrier,
      actual: report.production.brier,
    });
  }
  for (const expected of baseline.models) {
    const actual = report.models.find((m) => m.model === expected.model);
    if (!actual) {
      regressions.push({ model: expected.model, metric: 'missing-model', expected: 1, actual: 0 });
      continue;
    }
    if (
      Math.abs(actual.brierSkillVsProduction - expected.brierSkillVsProduction)
      > baseline.tolerances.referenceDrift
    ) {
      regressions.push({
        model: expected.model, metric: 'skill-drift',
        expected: expected.brierSkillVsProduction, actual: actual.brierSkillVsProduction,
      });
    }
    if (Math.abs(actual.records - expected.records) > baseline.tolerances.recordCountChange) {
      regressions.push({
        model: expected.model, metric: 'records',
        expected: expected.records, actual: actual.records,
      });
    }
    if (actual.brier > expected.brier + baseline.tolerances.brierIncrease) {
      regressions.push({
        model: expected.model, metric: 'brier',
        expected: expected.brier, actual: actual.brier,
      });
    }
  }
  return regressions;
}
