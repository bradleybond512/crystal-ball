/**
 * Tests for src/services/cognition/bench-cognition.ts + bench-baseline.ts —
 * PR 16 (Cognition Benchmark + CI Gate).
 *
 * Coverage (plan-mandated):
 *   - runCognitionBenchmark() produces one result per golden window, every
 *     result carries a non-empty explanation chain (plan invariant).
 *   - Determinism: two runs over the same fixture corpus are byte-identical
 *     apart from latency measurements.
 *   - Metric bounds sanity (Brier/coverage/precision/schema rate all in [0,1]
 *     or null).
 *   - A hand-verified fixture value for schemaTruePositiveRate (0.75) so a
 *     silent change to the schema-matching logic is caught, not just a
 *     baseline-JSON diff.
 *   - Injectable windows/calibrationPool: the pipeline works over an
 *     arbitrary custom corpus, not just the shipped golden windows (e.g. an
 *     unmatched-domain window yields schemaMatchedCount 0 / rate null).
 *   - compareBenchReportToBaseline(): passes on the current fixture corpus
 *     against the committed baseline; flags Brier regression beyond
 *     tolerance, coverage drop below floor, and window-count drift
 *     independently.
 *   - Never hangs: the whole suite (including the consolidation schema
 *     stage) resolves promptly under Node's default test timeout.
 *
 * Static fixtures throughout, no DOM, no live fetch, no real IDB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runCognitionBenchmark } from '../bench-cognition.js';
import type { BenchReport, WindowBenchResult } from '../bench-cognition.js';
import {
  compareBenchReportToBaseline,
  BRIER_REGRESSION_TOLERANCE,
  COVERAGE_DROP_TOLERANCE,
} from '../bench-baseline.js';
import type { BenchBaseline } from '../bench-baseline.js';
import committedBaseline from '../bench-baseline.json' with { type: 'json' };
import { GOLDEN_WINDOWS, CALIBRATION_POOL } from '../__bench__/golden-windows.js';
import type { GoldenWindow } from '../__bench__/golden-windows.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip latency fields (the only non-deterministic-by-wall-clock field) for equality checks. */
function stripLatency(report: BenchReport): unknown {
  return {
    ...report,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    results: report.results.map((r: WindowBenchResult) => ({ ...r, latencyMs: 0 })),
  };
}

// ── runCognitionBenchmark() ─────────────────────────────────────────────────

describe('runCognitionBenchmark', () => {
  it('produces one result per golden window', async () => {
    const report = await runCognitionBenchmark();
    assert.equal(report.windowCount, GOLDEN_WINDOWS.length);
    assert.equal(report.results.length, GOLDEN_WINDOWS.length);
  });

  it('every window result carries a non-empty explanation chain (plan invariant)', async () => {
    const report = await runCognitionBenchmark();
    for (const r of report.results) {
      assert.ok(r.explanation.length > 0, `${r.windowId}: expected a non-empty explanation chain`);
      for (const line of r.explanation) {
        assert.ok(line.length > 0, `${r.windowId}: expected every explanation line to be non-empty`);
      }
    }
  });

  it('every golden window matches a reference class (fallback class always fires)', async () => {
    const report = await runCognitionBenchmark();
    for (const r of report.results) {
      assert.ok(r.referenceClassId !== null, `${r.windowId}: expected a matched reference class`);
    }
  });

  it('is deterministic: two runs over the same corpus are identical apart from latency', async () => {
    const a = await runCognitionBenchmark();
    const b = await runCognitionBenchmark();
    assert.deepEqual(stripLatency(a), stripLatency(b));
  });

  it('all metrics stay within their documented bounds', async () => {
    const report = await runCognitionBenchmark();
    assert.ok(report.brier >= 0 && report.brier <= 1);
    assert.ok(report.coverageRate >= 0 && report.coverageRate <= 1);
    assert.ok(report.analogPrecisionAt5 >= 0 && report.analogPrecisionAt5 <= 1);
    if (report.schemaTruePositiveRate !== null) {
      assert.ok(report.schemaTruePositiveRate >= 0 && report.schemaTruePositiveRate <= 1);
    }
    assert.ok(report.p50LatencyMs >= 0);
    assert.ok(report.p95LatencyMs >= report.p50LatencyMs);
  });

  it('hand-verified: schemaTruePositiveRate is 0.75 for the shipped golden-window corpus', async () => {
    // 8/12 windows share a domain with a trained cluster (conflict, markets,
    // cyber, weather — 2 windows each). Of those, 4 are actual positives
    // (materialized): conflict-black-sea, markets-equity-selloff,
    // cyber-ics-intrusion, weather-hurricane-track. The cyber cluster is
    // deliberately trained LOW (materializationRate 0.167 → predicts
    // "fizzles"), so cyber-ics-intrusion is a false negative — 3 of 4
    // actual positives are correctly predicted ⇒ 0.75.
    const report = await runCognitionBenchmark();
    assert.equal(report.schemaMatchedCount, 8);
    assert.equal(report.schemaTotalCount, 12);
    assert.equal(report.schemaTruePositiveRate, 0.75);
  });

  it('schema stage: an unmatched-domain window yields no schema match and a null rate when it is the only window', async () => {
    const custom: GoldenWindow = {
      id: 'custom-humanitarian-only',
      description: 'A domain with no trained cluster.',
      factDomain: 'humanitarian',
      hypothesis: { kind: 'watchlist-convergence', statement: 'A relief convoy is delayed.', domains: ['humanitarian'] },
      groundTruthOutcome: 0,
      modelForecastP: 0.2,
      analogRecalls: [],
    };
    const report = await runCognitionBenchmark({ windows: [custom], calibrationPool: CALIBRATION_POOL });
    assert.equal(report.schemaMatchedCount, 0);
    assert.equal(report.schemaTruePositiveRate, null);
    assert.equal(report.results[0]?.schemaMatched, false);
    assert.equal(report.results[0]?.schemaPredictedMaterialize, null);
  });

  it('analog recall stage: analogScoreFor returns null when a window has fewer than 3 qualifying recalls', async () => {
    const custom: GoldenWindow = {
      id: 'custom-thin-analogs',
      description: 'Only two recalls — below the MIN_RECALLS_FOR_ANALOG floor.',
      factDomain: 'other',
      hypothesis: { kind: 'watchlist-convergence', statement: 'Sparse signal.', domains: [] },
      groundTruthOutcome: 0,
      modelForecastP: 0.25,
      analogRecalls: [
        { episode: { id: 'a', kind: 'hypothesis', signature: 's', summary: 's', domains: [], entities: [], createdAt: 0, resolvedAt: 1, outcome: 'fizzled', vector: [], tier: 'hashed' }, similarity: 0.9, ageDays: 1, explanation: 'x' },
        { episode: { id: 'b', kind: 'hypothesis', signature: 's', summary: 's', domains: [], entities: [], createdAt: 0, resolvedAt: 1, outcome: 'fizzled', vector: [], tier: 'hashed' }, similarity: 0.9, ageDays: 1, explanation: 'x' },
      ],
    };
    const report = await runCognitionBenchmark({ windows: [custom], calibrationPool: CALIBRATION_POOL });
    assert.equal(report.results[0]?.analogScore, null);
    // precision@5 still computes over whatever recalls exist (< 5 here).
    assert.equal(report.results[0]?.precisionAt5, 1); // both recalls predict "fizzles", matching groundTruth 0
  });

  it('resolves promptly (no hang) even though the schema stage runs consolidation clustering', async () => {
    const start = Date.now();
    await runCognitionBenchmark();
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 5000, `expected the benchmark to resolve in well under 5s, took ${elapsed}ms`);
  });
});

// ── compareBenchReportToBaseline() ──────────────────────────────────────────

describe('compareBenchReportToBaseline', () => {
  it('the committed baseline passes against a live run of the current golden-window corpus', async () => {
    const report = await runCognitionBenchmark();
    const { ok, reasons } = compareBenchReportToBaseline(report, committedBaseline as BenchBaseline);
    assert.equal(ok, true, `expected no regressions, got: ${reasons.join('; ')}`);
    assert.deepEqual(reasons, []);
  });

  it('flags a Brier regression beyond tolerance', () => {
    const baseline: BenchBaseline = { windowCount: 1, brier: 0.10, coverageRate: 1, targetCoverage: 0.8, analogPrecisionAt5: 0.5, schemaTruePositiveRate: null };
    const report = { windowCount: 1, brier: 0.10 + BRIER_REGRESSION_TOLERANCE + 0.001, coverageRate: 1, targetCoverage: 0.8, analogPrecisionAt5: 0.5, schemaTruePositiveRate: null } as BenchReport;
    const { ok, reasons } = compareBenchReportToBaseline(report, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some(r => r.includes('Brier regressed')));
  });

  it('does not flag a Brier change within tolerance', () => {
    const baseline: BenchBaseline = { windowCount: 1, brier: 0.10, coverageRate: 1, targetCoverage: 0.8, analogPrecisionAt5: 0.5, schemaTruePositiveRate: null };
    const report = { windowCount: 1, brier: 0.10 + BRIER_REGRESSION_TOLERANCE - 0.001, coverageRate: 1, targetCoverage: 0.8, analogPrecisionAt5: 0.5, schemaTruePositiveRate: null } as BenchReport;
    const { ok } = compareBenchReportToBaseline(report, baseline);
    assert.equal(ok, true);
  });

  it('flags a conformal coverage drop below the floor', () => {
    const baseline: BenchBaseline = { windowCount: 1, brier: 0.10, coverageRate: 0.9, targetCoverage: 0.8, analogPrecisionAt5: 0.5, schemaTruePositiveRate: null };
    const report = { windowCount: 1, brier: 0.10, coverageRate: 0.8 - COVERAGE_DROP_TOLERANCE - 0.01, targetCoverage: 0.8, analogPrecisionAt5: 0.5, schemaTruePositiveRate: null } as BenchReport;
    const { ok, reasons } = compareBenchReportToBaseline(report, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some(r => r.includes('conformal coverage dropped')));
  });

  it('does not flag coverage exactly at the floor', () => {
    const baseline: BenchBaseline = { windowCount: 1, brier: 0.10, coverageRate: 0.9, targetCoverage: 0.8, analogPrecisionAt5: 0.5, schemaTruePositiveRate: null };
    const report = { windowCount: 1, brier: 0.10, coverageRate: 0.8 - COVERAGE_DROP_TOLERANCE, targetCoverage: 0.8, analogPrecisionAt5: 0.5, schemaTruePositiveRate: null } as BenchReport;
    const { ok } = compareBenchReportToBaseline(report, baseline);
    assert.equal(ok, true);
  });

  it('flags a window-count drift (golden-windows.ts edited without a deliberate baseline update)', () => {
    const baseline: BenchBaseline = { windowCount: 12, brier: 0.10, coverageRate: 1, targetCoverage: 0.8, analogPrecisionAt5: 0.5, schemaTruePositiveRate: null };
    const report = { windowCount: 13, brier: 0.10, coverageRate: 1, targetCoverage: 0.8, analogPrecisionAt5: 0.5, schemaTruePositiveRate: null } as BenchReport;
    const { ok, reasons } = compareBenchReportToBaseline(report, baseline);
    assert.equal(ok, false);
    assert.ok(reasons.some(r => r.includes('golden-window count changed')));
  });

  it('improvements (lower Brier, higher coverage) always pass', () => {
    const baseline: BenchBaseline = { windowCount: 1, brier: 0.20, coverageRate: 0.85, targetCoverage: 0.8, analogPrecisionAt5: 0.5, schemaTruePositiveRate: 0.5 };
    const report = { windowCount: 1, brier: 0.05, coverageRate: 1, targetCoverage: 0.8, analogPrecisionAt5: 0.9, schemaTruePositiveRate: 0.9 } as BenchReport;
    const { ok, reasons } = compareBenchReportToBaseline(report, baseline);
    assert.equal(ok, true);
    assert.deepEqual(reasons, []);
  });

  it('reports multiple independent regressions in one comparison', () => {
    const baseline: BenchBaseline = { windowCount: 1, brier: 0.10, coverageRate: 0.9, targetCoverage: 0.8, analogPrecisionAt5: 0.5, schemaTruePositiveRate: null };
    const report = {
      windowCount: 2,
      brier: 0.10 + BRIER_REGRESSION_TOLERANCE + 0.05,
      coverageRate: 0.5,
      targetCoverage: 0.8,
      analogPrecisionAt5: 0.5,
      schemaTruePositiveRate: null,
    } as BenchReport;
    const { ok, reasons } = compareBenchReportToBaseline(report, baseline);
    assert.equal(ok, false);
    assert.equal(reasons.length, 3);
  });
});
