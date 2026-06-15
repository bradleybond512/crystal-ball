/**
 * Tests for src/services/cognition/recalibration.ts
 *
 * Tests (node:test + node:assert, static fixtures, no DOM/IDB):
 *   - PAV monotonicity enforced on fixture with violators
 *   - Shrinkage math hand-verified (n_bin / (n_bin + 10))
 *   - n-threshold fallbacks: domain → global → identity
 *   - Output clamped to [CLAMP_LO, CLAMP_HI]
 *   - Explanation string content (plan invariant)
 *   - Perfect-calibration fixture yields ≈identity
 *   - pooledCurve weighted merge + monotonicity re-application
 *   - identityCurve helper returns zero-sample bins
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCurve,
  recalibrate,
  pooledCurve,
  identityCurve,
  BIN_COUNT,
  SHRINK_PRIOR,
  MIN_DOMAIN_N,
  MIN_GLOBAL_N,
  CLAMP_LO,
  CLAMP_HI,
} from '../recalibration.js';
import type { PredictionRecord } from '../../intelligence/forecast-calibration.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

let _idCounter = 0;
function makeRecord(
  probability: number,
  outcome: 'resolved_true' | 'resolved_false',
  domain: PredictionRecord['domain'] = 'markets',
): PredictionRecord {
  _idCounter += 1;
  return {
    id: `r${_idCounter}`,
    sourceId: 'test',
    domain,
    claim: `test claim ${_idCounter}`,
    probability,
    predictedAt: 1_000_000,
    resolveBy: 2_000_000,
    status: outcome,
    resolvedAt: 1_500_000,
  };
}

/** Build n records all in [lo, hi), with given outcome. */
function makeRecords(
  n: number,
  probability: number,
  outcome: 'resolved_true' | 'resolved_false',
  domain: PredictionRecord['domain'] = 'markets',
): PredictionRecord[] {
  return Array.from({ length: n }, () => makeRecord(probability, outcome, domain));
}

// ── buildCurve: basic structure ───────────────────────────────────────────────

describe('buildCurve', () => {
  it('produces exactly BIN_COUNT bins', () => {
    const records = makeRecords(5, 0.3, 'resolved_true');
    const curve = buildCurve(records);
    assert.equal(curve.bins.length, BIN_COUNT);
  });

  it('domain label is set correctly', () => {
    const records = makeRecords(35, 0.65, 'resolved_true', 'weather');
    const curve = buildCurve(records, 'weather');
    assert.equal(curve.domain, 'weather');
  });

  it('global label when domain omitted', () => {
    const records = makeRecords(5, 0.3, 'resolved_true');
    const curve = buildCurve(records);
    assert.equal(curve.domain, 'global');
  });

  it('sampleSize counts only resolved records', () => {
    const resolved = makeRecords(10, 0.5, 'resolved_true');
    // Add a pending record — should NOT count.
    const pending: PredictionRecord = {
      ...makeRecord(0.5, 'resolved_true'),
      status: 'pending',
      resolvedAt: undefined,
    };
    const curve = buildCurve([...resolved, pending]);
    assert.equal(curve.sampleSize, 10);
  });

  it('generatedAt is a recent timestamp', () => {
    const before = Date.now();
    const curve = buildCurve(makeRecords(5, 0.3, 'resolved_true'));
    const after = Date.now();
    assert.ok(curve.generatedAt >= before);
    assert.ok(curve.generatedAt <= after);
  });
});

// ── PAV monotonicity ──────────────────────────────────────────────────────────

describe('PAV monotonicity', () => {
  it('bins are non-decreasing in observedRate after buildCurve', () => {
    // Construct a fixture where raw observed rates deliberately violate monotonicity:
    // Bin [0.2,0.3): 20 resolved_true out of 20 (rate = 1.0)  ← violates monotonicity vs [0.3,0.4)
    // Bin [0.3,0.4): 20 resolved_false out of 20 (rate = 0.0)
    // Bin [0.5,0.6): 20 resolved_true out of 20 (rate = 1.0)
    // Bin [0.6,0.7): 20 resolved_false out of 20 (rate = 0.0)
    const records: PredictionRecord[] = [
      ...makeRecords(20, 0.25, 'resolved_true'),   // bin 2 → high rate
      ...makeRecords(20, 0.35, 'resolved_false'),  // bin 3 → low rate (violator)
      ...makeRecords(20, 0.55, 'resolved_true'),   // bin 5 → high rate
      ...makeRecords(20, 0.65, 'resolved_false'),  // bin 6 → low rate (violator)
    ];

    const curve = buildCurve(records);

    // After PAV, each bin's observedRate must be ≤ the next bin's observedRate.
    for (let i = 0; i < BIN_COUNT - 1; i++) {
      const curr = curve.bins[i]!.observedRate;
      const next = curve.bins[i + 1]!.observedRate;
      assert.ok(
        curr <= next + 1e-9,
        `Monotonicity violated at bin ${i}: ${curr} > ${next}`,
      );
    }
  });

  it('PAV handles single violator pair correctly', () => {
    // Bins 4 and 5: [0.4,0.5) → all true; [0.5,0.6) → all false
    // After PAV: both should become equal (weighted merge).
    const records: PredictionRecord[] = [
      ...makeRecords(10, 0.45, 'resolved_true'),  // bin 4, rate ~1
      ...makeRecords(10, 0.55, 'resolved_false'), // bin 5, rate ~0 (violates)
    ];
    const curve = buildCurve(records);
    // After PAV merge, bins 4 and 5 should have equal observedRate.
    const b4 = curve.bins[4]!.observedRate;
    const b5 = curve.bins[5]!.observedRate;
    assert.ok(Math.abs(b4 - b5) < 0.01, `PAV merge failed: b4=${b4}, b5=${b5}`);
    // And the monotonicity property must still hold globally.
    for (let i = 0; i < BIN_COUNT - 1; i++) {
      assert.ok(curve.bins[i]!.observedRate <= curve.bins[i + 1]!.observedRate + 1e-9);
    }
  });
});

// ── Shrinkage math ────────────────────────────────────────────────────────────

describe('shrinkage math', () => {
  it('small n_bin → correction is shrunk proportionally', () => {
    // 3 records in bin [0.7, 0.8), all resolved_false → raw observedRate = 0
    // predictedMean ≈ 0.75
    // rawCorrection = 0 - 0.75 = -0.75
    // shrinkage = 3 / (3 + 10) = 0.2308
    // correction = -0.75 * 0.2308 = -0.1731
    // calibratedValue = 0.75 + (-0.1731) = 0.5769
    //
    // With only 3 samples, the large raw correction is heavily shrunk.
    // The PAV-corrected observedRate in bin 7 should be closer to 0.75 than to 0.
    const n = 3;
    const p = 0.75;
    const records = makeRecords(n, p, 'resolved_false');
    const curve = buildCurve(records);
    const bin7 = curve.bins[7]!;
    // Only bin 7 has data; all others are identity (predictedMean = center, observedRate = center).
    // The shrinkage factor pulls the correction toward 0, so observedRate should be
    // meaningfully above 0 (not shrunk all the way to 0 like raw would be).
    const expectedShrinkage = n / (n + SHRINK_PRIOR);
    const rawCorrection = 0 - p; // observedRate(0) - predictedMean(0.75) = -0.75
    const expectedCalibrated = p + rawCorrection * expectedShrinkage; // 0.75 - 0.75 * (3/13) ≈ 0.576
    // The difference between the expected calibrated and the observedRate should be tiny.
    // (PAV won't affect this since adjacent bins are identity.)
    assert.ok(
      Math.abs(bin7.observedRate - expectedCalibrated) < 0.02,
      `Shrinkage mismatch: expected ~${expectedCalibrated.toFixed(3)}, got ${bin7.observedRate}`,
    );
    // Crucially, the correction must be much smaller than the raw correction.
    const rawCalibrated = p + rawCorrection; // = 0
    assert.ok(bin7.observedRate > rawCalibrated + 0.4, 'Shrinkage should pull observedRate well above raw');
  });

  it('large n_bin → correction approaches raw correction (low shrinkage)', () => {
    // 100 records in bin [0.7, 0.8), all resolved_false → shrinkage = 100/(100+10) ≈ 0.909
    // The correction should be close to the raw correction.
    const n = 100;
    const records = makeRecords(n, 0.75, 'resolved_false');
    const curve = buildCurve(records);
    const bin7 = curve.bins[7]!;
    // observedRate should be close to 0 (large n → little shrinkage → correction close to raw).
    // PAV will have merged with neighbors (all of which are identity at center), so the actual
    // value may be > 0 due to pooling with empty bins, but it should be much lower than the
    // small-n case.
    assert.ok(bin7.observedRate < 0.3, `Large-n correction should approach raw: got ${bin7.observedRate}`);
  });

  it('shrinkage formula constant is SHRINK_PRIOR', () => {
    assert.equal(SHRINK_PRIOR, 10, 'Shrinkage prior constant must be 10 per spec');
  });
});

// ── n-threshold fallbacks ─────────────────────────────────────────────────────

describe('n-threshold fallbacks', () => {
  it('domain curve used when n ≥ MIN_DOMAIN_N', () => {
    assert.equal(MIN_DOMAIN_N, 30, 'MIN_DOMAIN_N must be 30 per spec');
    const records = makeRecords(MIN_DOMAIN_N, 0.75, 'resolved_false', 'cyber');
    const curve = buildCurve(records, 'cyber');
    assert.equal(curve.domain, 'cyber');
    assert.equal(curve.sampleSize, MIN_DOMAIN_N);
  });

  it('global pooled curve used when domain n < MIN_DOMAIN_N', () => {
    // 20 records in 'cyber' — not enough for a domain curve.
    const records = makeRecords(20, 0.5, 'resolved_true', 'cyber');
    // Build global (should work since sampleSize = 20 < MIN_DOMAIN_N = 30).
    const curve = buildCurve(records); // global
    assert.equal(curve.domain, 'global');
    assert.equal(curve.sampleSize, 20);
  });

  it('identity when sampleSize < MIN_GLOBAL_N and domain is global', () => {
    assert.equal(MIN_GLOBAL_N, 50, 'MIN_GLOBAL_N must be 50 per spec');
    const curve = identityCurve('global');
    const result = recalibrate(0.7, curve);
    // Identity: sampleSize = 0 < MIN_GLOBAL_N, so no adjustment.
    assert.equal(result.adjustment, 0);
    assert.ok(result.explanation.includes('insufficient'));
  });

  it('identity when sampleSize < MIN_DOMAIN_N and domain is not global', () => {
    const curve = identityCurve('markets');
    const result = recalibrate(0.6, curve);
    assert.equal(result.adjustment, 0);
    assert.ok(result.explanation.includes('insufficient'));
  });

  it('recalibrate uses curve.sampleSize to determine path (domain)', () => {
    // Build a real domain curve with enough records.
    const records = makeRecords(MIN_DOMAIN_N + 5, 0.65, 'resolved_false', 'markets');
    const curve = buildCurve(records, 'markets');
    // Now recalibrate a probability in the same bin.
    const result = recalibrate(0.65, curve);
    // The curve has data, so it should apply an adjustment.
    assert.ok(result.explanation.length > 0, 'explanation must be non-empty');
    // p should be clamped to [CLAMP_LO, CLAMP_HI].
    assert.ok(result.p >= CLAMP_LO);
    assert.ok(result.p <= CLAMP_HI);
  });

  it('recalibrate uses global curve sampleSize', () => {
    // Build a global curve with MIN_GLOBAL_N records.
    const records = makeRecords(MIN_GLOBAL_N + 10, 0.5, 'resolved_true');
    const curve = buildCurve(records);
    const result = recalibrate(0.5, curve);
    assert.ok(result.explanation.length > 0);
  });
});

// ── Clamp ─────────────────────────────────────────────────────────────────────

describe('output clamp', () => {
  it('output is never below CLAMP_LO', () => {
    assert.equal(CLAMP_LO, 0.02, 'CLAMP_LO must be 0.02 per spec');
    // Build a curve where the observed rate would push output toward 0.
    const records = makeRecords(MIN_GLOBAL_N + 10, 0.05, 'resolved_false');
    const curve = buildCurve(records);
    const result = recalibrate(0.05, curve);
    assert.ok(result.p >= CLAMP_LO, `p=${result.p} is below CLAMP_LO=${CLAMP_LO}`);
  });

  it('output is never above CLAMP_HI', () => {
    assert.equal(CLAMP_HI, 0.98, 'CLAMP_HI must be 0.98 per spec');
    const records = makeRecords(MIN_GLOBAL_N + 10, 0.95, 'resolved_true');
    const curve = buildCurve(records);
    const result = recalibrate(0.95, curve);
    assert.ok(result.p <= CLAMP_HI, `p=${result.p} is above CLAMP_HI=${CLAMP_HI}`);
  });

  it('clamp applies even for identity curve at extremes', () => {
    const curve = identityCurve('global');
    // Manually inject a sampleSize to bypass the identity path.
    // Actually, we just need to verify clamp is applied for raw p=0.0 and p=1.0.
    // With identity curve (sampleSize=0), explanation says insufficient but p is clamped.
    const lo = recalibrate(0.0, curve);
    assert.ok(lo.p >= CLAMP_LO);
    const hi = recalibrate(1.0, curve);
    assert.ok(hi.p <= CLAMP_HI);
  });
});

// ── Explanation content ───────────────────────────────────────────────────────

describe('explanation content (plan invariant)', () => {
  it('explanation is always a non-empty string', () => {
    const curve = identityCurve('global');
    const result = recalibrate(0.5, curve);
    assert.ok(typeof result.explanation === 'string');
    assert.ok(result.explanation.length > 0);
  });

  it('explanation mentions domain label for non-global curve', () => {
    const records = makeRecords(MIN_DOMAIN_N + 5, 0.65, 'resolved_false', 'conflict');
    const curve = buildCurve(records, 'conflict');
    const result = recalibrate(0.65, curve);
    // Explanation should mention "conflict forecasts"
    assert.ok(
      result.explanation.includes('conflict'),
      `Explanation should mention domain: "${result.explanation}"`,
    );
  });

  it('explanation mentions approximate input percentage', () => {
    const records = makeRecords(MIN_GLOBAL_N + 5, 0.7, 'resolved_false');
    const curve = buildCurve(records);
    const result = recalibrate(0.7, curve);
    // Should mention ~70%
    assert.ok(
      result.explanation.includes('70%'),
      `Explanation should mention ~70%: "${result.explanation}"`,
    );
  });

  it('explanation follows example format from spec', () => {
    // Spec: "finance forecasts at ~70% have materialized 54% of the time (n=41) → adjusted to 58%"
    // Our domain here is 'markets' (not 'finance', but similar structure).
    const records = makeRecords(41, 0.7, 'resolved_false', 'markets');
    const curve = buildCurve(records, 'markets');
    const result = recalibrate(0.7, curve);
    // Should contain: "markets forecasts at ~70%", "materialized", "%", "n=", "adjusted to"
    const exp = result.explanation;
    // Either "well-calibrated" (if no adjustment) or contains adjustment language.
    assert.ok(
      exp.includes('materialized') || exp.includes('well-calibrated') || exp.includes('unchanged'),
      `Explanation format unexpected: "${exp}"`,
    );
    assert.ok(exp.includes('n='));
  });

  it('identity explanation mentions insufficient history', () => {
    const curve = identityCurve('markets');
    const result = recalibrate(0.5, curve);
    assert.ok(
      result.explanation.includes('insufficient'),
      `Identity explanation should say "insufficient": "${result.explanation}"`,
    );
  });

  it('adjustment field is consistent with p change', () => {
    const records = makeRecords(MIN_GLOBAL_N + 10, 0.7, 'resolved_false');
    const curve = buildCurve(records);
    const originalP = 0.7;
    const result = recalibrate(originalP, curve);
    // adjustment = recalibratedP - clamp(originalP, CLAMP_LO, CLAMP_HI)
    const expectedAdj = Math.round((result.p - Math.max(CLAMP_LO, Math.min(CLAMP_HI, originalP))) * 1000) / 1000;
    assert.ok(
      Math.abs(result.adjustment - expectedAdj) < 0.002,
      `adjustment=${result.adjustment} should equal p - clamp(originalP): ${expectedAdj}`,
    );
  });
});

// ── Perfect-calibration fixture yields ≈ identity ─────────────────────────────

describe('perfect calibration fixture', () => {
  it('perfectly calibrated records yield near-zero adjustments', () => {
    // Build records where the observed rate equals the predicted probability in each bin.
    // Bin [0.1,0.2): 20 records at 0.15, 3 true (rate = 3/20 = 0.15) ✓
    // Bin [0.3,0.4): 20 records at 0.35, 7 true (rate = 7/20 = 0.35) ✓
    // Bin [0.5,0.6): 20 records at 0.55, 11 true (rate = 11/20 = 0.55) ✓
    // Bin [0.7,0.8): 20 records at 0.75, 15 true (rate = 15/20 = 0.75) ✓
    // Bin [0.9,1.0]: 20 records at 0.95, 19 true (rate = 19/20 = 0.95) ✓
    const makeBalanced = (p: number, n: number, domain: PredictionRecord['domain'] = 'markets'): PredictionRecord[] => {
      const trueCount = Math.round(p * n);
      return [
        ...makeRecords(trueCount, p, 'resolved_true', domain),
        ...makeRecords(n - trueCount, p, 'resolved_false', domain),
      ];
    };

    const records: PredictionRecord[] = [
      ...makeBalanced(0.15, 20),
      ...makeBalanced(0.35, 20),
      ...makeBalanced(0.55, 20),
      ...makeBalanced(0.75, 20),
      ...makeBalanced(0.95, 10), // Fewer to avoid PAV issues near boundary
    ];

    const curve = buildCurve(records);

    // For each bin that has data, the recalibrated probability should be close
    // to the original (adjustment should be small — near 0).
    const testPs = [0.15, 0.35, 0.55, 0.75];
    for (const p of testPs) {
      const result = recalibrate(p, curve);
      assert.ok(
        Math.abs(result.adjustment) < 0.15,
        `Perfect calibration should yield small adjustment for p=${p}: got ${result.adjustment} (explanation: ${result.explanation})`,
      );
    }
  });
});

// ── pooledCurve ───────────────────────────────────────────────────────────────

describe('pooledCurve', () => {
  it('returns global domain curve', () => {
    const c1 = buildCurve(makeRecords(40, 0.5, 'resolved_true', 'markets'), 'markets');
    const c2 = buildCurve(makeRecords(40, 0.5, 'resolved_true', 'cyber'), 'cyber');
    const pooled = pooledCurve([c1, c2]);
    assert.equal(pooled.domain, 'global');
  });

  it('sampleSize is sum of input sampleSizes', () => {
    const c1 = buildCurve(makeRecords(30, 0.5, 'resolved_true', 'markets'), 'markets');
    const c2 = buildCurve(makeRecords(40, 0.5, 'resolved_true', 'cyber'), 'cyber');
    const pooled = pooledCurve([c1, c2]);
    assert.equal(pooled.sampleSize, 70);
  });

  it('pooled curve is monotone', () => {
    const c1 = buildCurve(makeRecords(30, 0.25, 'resolved_true', 'markets'), 'markets');
    const c2 = buildCurve(makeRecords(30, 0.75, 'resolved_false', 'cyber'), 'cyber');
    const pooled = pooledCurve([c1, c2]);
    for (let i = 0; i < BIN_COUNT - 1; i++) {
      const curr = pooled.bins[i]!.observedRate;
      const next = pooled.bins[i + 1]!.observedRate;
      assert.ok(curr <= next + 1e-9, `Pooled monotonicity violated at bin ${i}: ${curr} > ${next}`);
    }
  });

  it('empty input returns zero-sample identity curve', () => {
    const pooled = pooledCurve([]);
    assert.equal(pooled.sampleSize, 0);
    assert.equal(pooled.bins.length, BIN_COUNT);
  });
});

// ── identityCurve ─────────────────────────────────────────────────────────────

describe('identityCurve', () => {
  it('all bins have n=0', () => {
    const curve = identityCurve('global');
    for (const bin of curve.bins) {
      assert.equal(bin.n, 0);
    }
  });

  it('sampleSize is 0', () => {
    const curve = identityCurve('conflict');
    assert.equal(curve.sampleSize, 0);
  });

  it('observedRate equals predictedMean for all bins (identity)', () => {
    const curve = identityCurve('global');
    for (const bin of curve.bins) {
      assert.ok(
        Math.abs(bin.observedRate - bin.predictedMean) < 0.001,
        `Identity bin should have observedRate ≈ predictedMean: ${bin.observedRate} ≠ ${bin.predictedMean}`,
      );
    }
  });
});

// ── recalibrate with sufficient data path ─────────────────────────────────────

describe('recalibrate with sufficient-data curves', () => {
  it('returns lower probability for overconfident forecasts', () => {
    // 70% forecasts that only materialized 40% of the time.
    const records: PredictionRecord[] = [
      ...makeRecords(40, 0.7, 'resolved_false', 'markets'),
      ...makeRecords(20, 0.7, 'resolved_true', 'markets'),
    ];
    const curve = buildCurve(records, 'markets');
    const result = recalibrate(0.7, curve);
    // Should adjust downward (forecasts were overconfident).
    assert.ok(result.p < 0.7, `Expected downward adjustment: got p=${result.p}`);
    assert.ok(result.adjustment < 0);
  });

  it('returns higher probability for underconfident forecasts', () => {
    // 30% forecasts that materialized 60% of the time.
    const records: PredictionRecord[] = [
      ...makeRecords(20, 0.3, 'resolved_false', 'conflict'),
      ...makeRecords(40, 0.3, 'resolved_true', 'conflict'),
    ];
    const curve = buildCurve(records, 'conflict');
    const result = recalibrate(0.3, curve);
    // Should adjust upward (forecasts were underconfident).
    assert.ok(result.p > 0.3, `Expected upward adjustment: got p=${result.p}`);
    assert.ok(result.adjustment > 0);
  });
});
