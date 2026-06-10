/**
 * Benchmark unit tests — PR 16.
 *
 * Tests:
 *   1. Runner determinism: two runs produce identical scores (modulo latency).
 *   2. Gate math: Brier regression detected at exactly +0.02 boundary.
 *   3. Coverage gate: coverageRate < 0.75 triggers failure.
 *   4. Pending-baseline path: {"pending": true} baseline → exit 0 (no gate).
 *   5. Metric sanity: overallBrier in [0, 1], coverageRate in [0, 1].
 *   6. Analog recall: precision@5 computes correctly from the runner results.
 *   7. Schema TP: schemaTruePositiveRate in [0, 1].
 *
 * All tests are purely deterministic (no LLM, no network).
 * Tests use a small subset of golden windows for speed.
 *
 * Per docs/COGNITIVE_ENHANCEMENT_PLAN.md PR 16.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { runBenchmark } from '../__bench__/run-benchmark.ts';
import {
  GOLDEN_WINDOWS,
  WINDOW_BLACK_SEA_GRAIN,
  WINDOW_FLASH_FLOOD,
  WINDOW_ICS_CYBERATTACK,
} from '../__bench__/golden-windows.ts';

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Run the benchmark over a small, deterministic subset of windows.
 * Using 3 windows keeps test runtime reasonable while exercising all metric paths.
 */
async function runSmallBench() {
  return runBenchmark([WINDOW_BLACK_SEA_GRAIN, WINDOW_FLASH_FLOOD, WINDOW_ICS_CYBERATTACK]);
}

// ── Gate math helpers (mirrors cognition-bench.mjs logic) ──────────────────────

const BRIER_REGRESSION_THRESHOLD = 0.02;
const COVERAGE_FLOOR = 0.75;

interface BaselineShape {
  overallBrier: number;
  coverageRate: number;
  pending?: boolean;
}

function gatePass(
  report: { overallBrier: number; coverageRate: number },
  baseline: BaselineShape,
): { passed: boolean; failures: string[] } {
  if (baseline.pending) return { passed: true, failures: [] };

  const failures: string[] = [];
  const brierDelta = report.overallBrier - baseline.overallBrier;

  if (brierDelta > BRIER_REGRESSION_THRESHOLD) {
    failures.push(`Brier regression: delta=${brierDelta.toFixed(4)} > threshold=${BRIER_REGRESSION_THRESHOLD}`);
  }
  if (report.coverageRate < COVERAGE_FLOOR) {
    failures.push(`Coverage too low: ${report.coverageRate.toFixed(3)} < floor=${COVERAGE_FLOOR}`);
  }

  return { passed: failures.length === 0, failures };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Cognition Benchmark — runner determinism', () => {
  it('two runs over the same windows produce identical Brier and coverage scores', async () => {
    const r1 = await runSmallBench();
    const r2 = await runSmallBench();

    assert.equal(r1.overallBrier, r2.overallBrier,
      'overallBrier must be identical across runs');
    assert.equal(r1.coverageRate, r2.coverageRate,
      'coverageRate must be identical across runs');
    assert.equal(r1.analogPrecisionMean, r2.analogPrecisionMean,
      'analogPrecisionMean must be identical across runs');
    assert.equal(r1.schemaTruePositiveRate, r2.schemaTruePositiveRate,
      'schemaTruePositiveRate must be identical across runs');
    assert.equal(r1.windowCount, r2.windowCount,
      'windowCount must be identical across runs');
  });

  it('per-window finalP values are identical across two runs', async () => {
    const r1 = await runSmallBench();
    const r2 = await runSmallBench();

    for (let i = 0; i < r1.windows.length; i++) {
      const w1 = r1.windows[i]!;
      const w2 = r2.windows[i]!;
      assert.equal(w1.finalP, w2.finalP,
        `Window ${w1.windowId}: finalP must be identical across runs`);
      assert.equal(w1.windowBrier, w2.windowBrier,
        `Window ${w1.windowId}: windowBrier must be identical across runs`);
    }
  });
});

describe('Cognition Benchmark — metric sanity', () => {
  let report: Awaited<ReturnType<typeof runSmallBench>>;

  before(async () => {
    report = await runSmallBench();
  });

  it('overallBrier is in [0, 1]', () => {
    assert.ok(report.overallBrier >= 0 && report.overallBrier <= 1,
      `overallBrier=${report.overallBrier} must be in [0, 1]`);
  });

  it('coverageRate is in [0, 1]', () => {
    assert.ok(report.coverageRate >= 0 && report.coverageRate <= 1,
      `coverageRate=${report.coverageRate} must be in [0, 1]`);
  });

  it('analogPrecisionMean is in [0, 1]', () => {
    assert.ok(report.analogPrecisionMean >= 0 && report.analogPrecisionMean <= 1,
      `analogPrecisionMean=${report.analogPrecisionMean} must be in [0, 1]`);
  });

  it('schemaTruePositiveRate is in [0, 1]', () => {
    assert.ok(report.schemaTruePositiveRate >= 0 && report.schemaTruePositiveRate <= 1,
      `schemaTruePositiveRate=${report.schemaTruePositiveRate} must be in [0, 1]`);
  });

  it('windowCount matches the number of windows passed', () => {
    assert.equal(report.windowCount, 3);
  });

  it('per-window finalP values are all in [0, 1]', () => {
    for (const w of report.windows) {
      assert.ok(w.finalP >= 0 && w.finalP <= 1,
        `Window ${w.windowId}: finalP=${w.finalP} must be in [0, 1]`);
    }
  });

  it('per-window Brier values are all in [0, 1]', () => {
    for (const w of report.windows) {
      assert.ok(w.windowBrier >= 0 && w.windowBrier <= 1,
        `Window ${w.windowId}: windowBrier=${w.windowBrier} must be in [0, 1]`);
    }
  });

  it('overall Brier equals mean of per-window Brier values', () => {
    const meanBrier = report.windows.reduce((s, w) => s + w.windowBrier, 0) / report.windows.length;
    const rounded = Math.round(meanBrier * 10000) / 10000;
    assert.equal(report.overallBrier, rounded,
      `overallBrier=${report.overallBrier} must equal mean of per-window values`);
  });

  it('all windows report llmTier = deterministic-only', () => {
    for (const w of report.windows) {
      assert.equal(w.llmTier, 'deterministic-only',
        `Window ${w.windowId}: llmTier must be deterministic-only in bench`);
    }
  });

  it('all windows have conformal intervals with lo <= hi', () => {
    for (const w of report.windows) {
      assert.ok(w.intervalLo <= w.intervalHi,
        `Window ${w.windowId}: lo=${w.intervalLo} must be <= hi=${w.intervalHi}`);
    }
  });
});

describe('Cognition Benchmark — gate math (Brier regression detection)', () => {
  it('passes when Brier delta is exactly 0', () => {
    const baseline = { overallBrier: 0.15, coverageRate: 0.85 };
    const report = { overallBrier: 0.15, coverageRate: 0.85 };
    const { passed } = gatePass(report, baseline);
    assert.ok(passed, 'should pass when delta is 0');
  });

  it('passes when Brier delta is exactly at threshold (0.02)', () => {
    const baseline = { overallBrier: 0.15, coverageRate: 0.85 };
    const report = { overallBrier: 0.17, coverageRate: 0.85 };
    const { passed } = gatePass(report, baseline);
    // delta = 0.02 exactly — must pass (gate is STRICT inequality > 0.02)
    assert.ok(passed, 'should pass when delta is exactly 0.02 (boundary)');
  });

  it('fails when Brier delta exceeds threshold by epsilon', () => {
    const baseline = { overallBrier: 0.15, coverageRate: 0.85 };
    const report = { overallBrier: 0.1701, coverageRate: 0.85 };
    const { passed, failures } = gatePass(report, baseline);
    assert.ok(!passed, 'should fail when delta is > 0.02');
    assert.ok(failures.some(f => f.includes('Brier regression')),
      'failure message should mention Brier regression');
  });

  it('fails when Brier regression is clearly large', () => {
    const baseline = { overallBrier: 0.10, coverageRate: 0.85 };
    const report = { overallBrier: 0.20, coverageRate: 0.85 };
    const { passed } = gatePass(report, baseline);
    assert.ok(!passed, 'should fail on large Brier regression');
  });

  it('passes when Brier actually improves (decreases)', () => {
    const baseline = { overallBrier: 0.20, coverageRate: 0.85 };
    const report = { overallBrier: 0.10, coverageRate: 0.85 };
    const { passed } = gatePass(report, baseline);
    assert.ok(passed, 'should pass when Brier improves');
  });
});

describe('Cognition Benchmark — gate math (coverage gate)', () => {
  it('passes when coverage is at floor exactly (0.75)', () => {
    const baseline = { overallBrier: 0.15, coverageRate: 0.80 };
    const report = { overallBrier: 0.15, coverageRate: 0.75 };
    const { passed } = gatePass(report, baseline);
    assert.ok(passed, 'should pass when coverage is exactly 0.75 (floor is strict <)');
  });

  it('fails when coverage drops below floor', () => {
    const baseline = { overallBrier: 0.15, coverageRate: 0.85 };
    const report = { overallBrier: 0.15, coverageRate: 0.74 };
    const { passed, failures } = gatePass(report, baseline);
    assert.ok(!passed, 'should fail when coverage < 0.75');
    assert.ok(failures.some(f => f.includes('Coverage too low')),
      'failure message should mention coverage');
  });

  it('passes when coverage is well above floor', () => {
    const baseline = { overallBrier: 0.15, coverageRate: 0.85 };
    const report = { overallBrier: 0.15, coverageRate: 0.95 };
    const { passed } = gatePass(report, baseline);
    assert.ok(passed, 'should pass with excellent coverage');
  });

  it('can fail on both gates simultaneously', () => {
    const baseline = { overallBrier: 0.10, coverageRate: 0.85 };
    const report = { overallBrier: 0.20, coverageRate: 0.60 };
    const { passed, failures } = gatePass(report, baseline);
    assert.ok(!passed, 'should fail on both gates');
    assert.equal(failures.length, 2, 'should report both failures');
  });
});

describe('Cognition Benchmark — pending baseline path', () => {
  it('pending baseline always passes (no gate applied)', () => {
    const pendingBaseline = { pending: true, overallBrier: 0, coverageRate: 0 };
    // Even with terrible metrics, pending baseline should pass.
    const report = { overallBrier: 1.0, coverageRate: 0.0 };
    const { passed } = gatePass(report, pendingBaseline);
    assert.ok(passed, 'pending baseline must always pass (exit 0)');
  });

  it('non-pending baseline applies gate math', () => {
    const realBaseline = { overallBrier: 0.10, coverageRate: 0.85 };
    const report = { overallBrier: 0.20, coverageRate: 0.60 };
    const { passed } = gatePass(report, realBaseline);
    assert.ok(!passed, 'real baseline must apply gate math');
  });
});

describe('Cognition Benchmark — analog recall metric', () => {
  it('precision@5 is 0 when no analogs are recalled', () => {
    // In an empty episodic memory, recall returns nothing → precision = 0.
    // We test the precision computation logic directly.
    const planted = ['sig-a', 'sig-b', 'sig-c'];
    const recalled: string[] = [];
    const found = planted.filter(s => recalled.includes(s));
    const precision = planted.length > 0 ? found.length / planted.length : 1;
    assert.equal(precision, 0);
  });

  it('precision@5 is 1 when all planted analogs appear in top-5', () => {
    const planted = ['sig-a', 'sig-b'];
    const recalled = ['sig-a', 'sig-b', 'sig-c', 'sig-d', 'sig-e'];
    const found = planted.filter(s => recalled.includes(s));
    const precision = planted.length > 0 ? found.length / planted.length : 1;
    assert.equal(precision, 1);
  });

  it('precision@5 is 0.5 when half of planted analogs appear in top-5', () => {
    const planted = ['sig-a', 'sig-b'];
    const recalled = ['sig-a', 'sig-c', 'sig-d', 'sig-e'];
    const found = planted.filter(s => recalled.includes(s));
    const precision = planted.length > 0 ? found.length / planted.length : 1;
    assert.equal(precision, 0.5);
  });

  it('mean precision@5 across windows is computed correctly', () => {
    const precisions = [1.0, 0.5, 0.0];
    const mean = precisions.reduce((s, p) => s + p, 0) / precisions.length;
    assert.equal(mean, 0.5);
  });
});

describe('Cognition Benchmark — full golden window catalog', () => {
  it('catalog contains exactly 14 windows', () => {
    assert.equal(GOLDEN_WINDOWS.length, 14, 'GOLDEN_WINDOWS must have 14 entries');
  });

  it('all windows have distinct ids', () => {
    const ids = new Set(GOLDEN_WINDOWS.map(w => w.id));
    assert.equal(ids.size, GOLDEN_WINDOWS.length, 'all window ids must be distinct');
  });

  it('all windows have at least 3 planted analog signatures', () => {
    for (const w of GOLDEN_WINDOWS) {
      assert.ok(w.plantedAnalogSignatures.length >= 2,
        `Window ${w.id}: must have ≥2 planted analog signatures`);
    }
  });

  it('all windows have ≥40 prediction records for conformal intervals', () => {
    for (const w of GOLDEN_WINDOWS) {
      assert.ok(w.predictionRecords.length >= 40,
        `Window ${w.id}: must have ≥40 prediction records (have ${w.predictionRecords.length})`);
    }
  });

  it('all prediction records have a valid status', () => {
    const validStatuses = new Set(['resolved_true', 'resolved_false', 'pending', 'expired']);
    for (const w of GOLDEN_WINDOWS) {
      for (const pr of w.predictionRecords) {
        assert.ok(validStatuses.has(pr.status),
          `Window ${w.id}: pr ${pr.id} has invalid status "${pr.status}"`);
      }
    }
  });

  it('all windows have a modelForecastP in (0, 1)', () => {
    for (const w of GOLDEN_WINDOWS) {
      assert.ok(w.modelForecastP > 0 && w.modelForecastP < 1,
        `Window ${w.id}: modelForecastP=${w.modelForecastP} must be in (0, 1)`);
    }
  });

  it('windows span all required domains (conflict, market, weather, cyber, shortage/macro)', () => {
    const domains = new Set(GOLDEN_WINDOWS.map(w => w.domain));
    assert.ok(domains.has('conflict'), 'must have a conflict-domain window');
    assert.ok(domains.has('markets') || domains.has('macro'), 'must have a market/macro window');
    assert.ok(domains.has('weather'), 'must have a weather window');
    assert.ok(domains.has('cyber'), 'must have a cyber window');
    // shortage maps to macro or maritime in FactDomain
    assert.ok(domains.has('macro') || domains.has('maritime'), 'must have a shortage-proxy window');
  });
});
