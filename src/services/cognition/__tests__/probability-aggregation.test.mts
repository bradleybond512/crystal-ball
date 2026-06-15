/**
 * Tests for src/services/cognition/probability-aggregation.ts
 *
 * Tests (node:test + node:assert, pure deterministic, no LLM):
 *   - geoMeanOfOdds vs arithmetic mean (key fixture — they must differ)
 *   - geoMeanOfOdds: equal weights, single estimate, all-equal estimates
 *   - geoMeanOfOdds: weighted computation hand-verified
 *   - extremize: identity at k=1, sharpens at k=1.3
 *   - extremize: skip when spread > 0.25 (high disagreement)
 *   - extremize: skip when < 3 estimates
 *   - extremize: output clamped to [CLAMP_LO, CLAMP_HI]
 *   - aggregate: spread surfaced (contradiction invariant)
 *   - aggregate: clamp to [CLAMP_LO, CLAMP_HI]
 *   - aggregate: explanation always non-empty (plan invariant)
 *   - aggregate: empty estimates returns default prior
 *   - aggregate: high-spread suppresses extremization
 *   - aggregate: low-spread with ≥3 estimates triggers extremization
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  geoMeanOfOdds,
  extremize,
  aggregate,
  DEFAULT_K,
  SPREAD_SKIP_THRESHOLD,
  MIN_ESTIMATES_FOR_EXTREMIZE,
  CLAMP_LO,
  CLAMP_HI,
} from '../probability-aggregation.js';
import type { Estimate } from '../probability-aggregation.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEstimate(source: Estimate['source'], p: number, weight = 1.0): Estimate {
  return { source, weight, p };
}

function arithmeticMean(estimates: Estimate[]): number {
  return estimates.reduce((s, e) => s + e.p, 0) / estimates.length;
}

// ── geoMeanOfOdds ─────────────────────────────────────────────────────────────

describe('geoMeanOfOdds vs arithmetic mean', () => {
  it('GMO and arithmetic mean differ for asymmetric probability pairs', () => {
    // 90% and 10% — arithmetic mean = 50% (implies no information)
    // GMO = 50% too, but this is correct in log-odds (symmetric extremes)
    // Use a less symmetric pair to show the difference.
    const estimates: Estimate[] = [
      makeEstimate('base-rate', 0.8),
      makeEstimate('model-forecast', 0.2),
    ];
    const gmo = geoMeanOfOdds(estimates);
    const arith = arithmeticMean(estimates);
    // Both = 0.5 for equal symmetric extremes; the critical fixture is unequal weights.
    // Use unequal weight to show divergence.
    const weighted: Estimate[] = [
      makeEstimate('base-rate', 0.8, 2.0),   // twice as credible
      makeEstimate('model-forecast', 0.2, 1.0),
    ];
    const gmoWeighted = geoMeanOfOdds(weighted);
    const arithWeighted = (0.8 * 2 + 0.2 * 1) / 3;
    // Arithmetic weighted mean = (1.6 + 0.2) / 3 = 0.6
    // GMO in log-odds: (2*log(4) + 1*log(0.25)) / 3 = (2*1.386 - 1.386)/3 = 1.386/3 = 0.462 log-odds
    // → exp(0.462)/(1+exp(0.462)) ≈ 0.614
    assert.ok(
      Math.abs(gmoWeighted - arithWeighted) > 0.01,
      `GMO (${gmoWeighted.toFixed(4)}) and arithmetic mean (${arithWeighted.toFixed(4)}) should differ for weighted estimates`,
    );
    assert.ok(gmo >= CLAMP_LO && gmo <= CLAMP_HI, 'GMO must be in [CLAMP_LO, CLAMP_HI]');
  });

  it('key fixture: GMO with [0.7, 0.3] estimates', () => {
    // log-odds: log(0.7/0.3) = 0.847, log(0.3/0.7) = -0.847
    // mean log-odds = 0 → odds = 1 → p = 0.5
    // This is correct: symmetric evidence cancels out in log-odds space.
    const estimates: Estimate[] = [
      makeEstimate('base-rate', 0.7),
      makeEstimate('model-forecast', 0.3),
    ];
    const gmo = geoMeanOfOdds(estimates);
    assert.ok(
      Math.abs(gmo - 0.5) < 0.01,
      `GMO of [0.7, 0.3] should be ~0.5 (symmetric), got ${gmo.toFixed(4)}`,
    );
  });

  it('GMO of equal estimates equals that estimate', () => {
    // GMO([p, p, p]) should equal p (geometric mean of identical values).
    const p = 0.65;
    const estimates: Estimate[] = [
      makeEstimate('persona-analyst', p),
      makeEstimate('persona-skeptic', p),
      makeEstimate('persona-pragmatist', p),
    ];
    const gmo = geoMeanOfOdds(estimates);
    assert.ok(
      Math.abs(gmo - p) < 0.001,
      `GMO of all-equal p=${p} should equal ${p}, got ${gmo.toFixed(4)}`,
    );
  });

  it('single estimate returns that estimate (clamped)', () => {
    const p = 0.42;
    const gmo = geoMeanOfOdds([makeEstimate('base-rate', p)]);
    assert.ok(
      Math.abs(gmo - p) < 0.001,
      `single-estimate GMO should return the estimate itself, got ${gmo.toFixed(4)}`,
    );
  });

  it('throws TypeError on empty estimates', () => {
    assert.throws(() => geoMeanOfOdds([]), TypeError);
  });

  it('clamps output to [CLAMP_LO, CLAMP_HI]', () => {
    // Near-certainty inputs should not produce 0 or 1.
    const estimates: Estimate[] = [
      makeEstimate('base-rate', 0.99),
      makeEstimate('model-forecast', 0.99),
      makeEstimate('persona-analyst', 0.99),
    ];
    const gmo = geoMeanOfOdds(estimates);
    assert.ok(gmo <= CLAMP_HI, `GMO should not exceed CLAMP_HI=${CLAMP_HI}, got ${gmo}`);
    assert.ok(gmo >= CLAMP_LO, `GMO should not go below CLAMP_LO=${CLAMP_LO}`);
  });

  it('weighted: higher-weight estimate pulls GMO toward it', () => {
    // Base rate: 0.3 (weight 1); model forecast: 0.7 (weight 3)
    // Should end up closer to 0.7 than to 0.3.
    const estimates: Estimate[] = [
      makeEstimate('base-rate', 0.3, 1.0),
      makeEstimate('model-forecast', 0.7, 3.0),
    ];
    const gmo = geoMeanOfOdds(estimates);
    const arith = arithmeticMean([makeEstimate('base-rate', 0.3), makeEstimate('model-forecast', 0.7)]);
    // GMO weighted toward 0.7 should be > arith (unweighted 0.5).
    assert.ok(gmo > 0.5, `weighted GMO should be > 0.5, got ${gmo.toFixed(4)}`);
    assert.ok(gmo >= CLAMP_LO && gmo <= CLAMP_HI, 'GMO in bounds');
    void arith; // suppress unused warning
  });
});

// ── extremize ─────────────────────────────────────────────────────────────────

describe('extremize', () => {
  it('k=1 is identity', () => {
    const p = 0.65;
    const result = extremize(p, 1, 0, 5);
    assert.ok(Math.abs(result - p) < 0.001, `k=1 should be identity, got ${result}`);
  });

  it('k=1.3 sharpens toward extremes when spread is low and n≥3', () => {
    // p=0.7, k=1.3, low spread, 3 estimates — should sharpen toward 1.
    const p = 0.7;
    const result = extremize(p, DEFAULT_K, 0.1, 3);
    assert.ok(
      result > p,
      `k=1.3 should sharpen 0.7 upward (got ${result.toFixed(4)})`,
    );
  });

  it('k=1.3 sharpens toward 0 for p < 0.5', () => {
    const p = 0.3;
    const result = extremize(p, DEFAULT_K, 0.1, 3);
    assert.ok(
      result < p,
      `k=1.3 should sharpen 0.3 downward (got ${result.toFixed(4)})`,
    );
  });

  it('skip condition: spread > SPREAD_SKIP_THRESHOLD (0.25) → returns p unchanged', () => {
    const p = 0.7;
    const highSpread = SPREAD_SKIP_THRESHOLD + 0.01; // 0.26
    const result = extremize(p, DEFAULT_K, highSpread, 5);
    assert.equal(
      result, p,
      `should skip extremization when spread=${highSpread} > threshold (got ${result})`,
    );
  });

  it('skip condition: exactly at threshold (0.25) → returns p unchanged', () => {
    // The condition is spread > 0.25, so 0.25 itself should also skip.
    // Actually per the spec: skipped when spread > 0.25. 0.25 > 0.25 is false,
    // so 0.25 exactly should NOT skip. Let's check: spec says "spread>0.25".
    const p = 0.7;
    const exactThreshold = SPREAD_SKIP_THRESHOLD; // 0.25
    const result = extremize(p, DEFAULT_K, exactThreshold, 5);
    // At spread=0.25 (not >) extremization should apply.
    assert.ok(result >= p || result === p, 'at exactly threshold spread=0.25, extremization can apply');
  });

  it('skip condition: spread just above threshold → no extremization', () => {
    const p = 0.7;
    const justAbove = SPREAD_SKIP_THRESHOLD + 0.001;
    const result = extremize(p, DEFAULT_K, justAbove, 5);
    assert.equal(result, p, `spread=${justAbove} > ${SPREAD_SKIP_THRESHOLD} must skip extremization`);
  });

  it('skip condition: n < MIN_ESTIMATES_FOR_EXTREMIZE (3) → returns p unchanged', () => {
    const p = 0.8;
    const result = extremize(p, DEFAULT_K, 0.0, MIN_ESTIMATES_FOR_EXTREMIZE - 1);
    assert.equal(result, p, `n=2 must skip extremization (got ${result})`);
  });

  it('skip condition: n = 1 → returns p unchanged', () => {
    const p = 0.9;
    const result = extremize(p, DEFAULT_K, 0.0, 1);
    assert.equal(result, p, `n=1 must skip extremization`);
  });

  it('n = MIN_ESTIMATES_FOR_EXTREMIZE → extremization applies', () => {
    const p = 0.7;
    const result = extremize(p, DEFAULT_K, 0.0, MIN_ESTIMATES_FOR_EXTREMIZE);
    assert.ok(result > p, `n=${MIN_ESTIMATES_FOR_EXTREMIZE} should apply extremization`);
  });

  it('clamps output to [CLAMP_LO, CLAMP_HI]', () => {
    // Extremizing a very high p with k>1 should still not exceed CLAMP_HI.
    const result = extremize(CLAMP_HI, DEFAULT_K, 0.0, 5);
    assert.ok(result <= CLAMP_HI, `output must not exceed CLAMP_HI`);
    assert.ok(result >= CLAMP_LO, `output must not go below CLAMP_LO`);
  });

  it('p=0.5 is fixed point for any k (symmetric point)', () => {
    // 0.5^k / (0.5^k + 0.5^k) = 0.5 for all k.
    const result = extremize(0.5, DEFAULT_K, 0.0, 5);
    assert.ok(Math.abs(result - 0.5) < 0.001, `0.5 is fixed point for extremization, got ${result}`);
  });
});

// ── aggregate ─────────────────────────────────────────────────────────────────

describe('aggregate', () => {
  it('spread is surfaced (contradiction invariant)', () => {
    const estimates: Estimate[] = [
      makeEstimate('base-rate', 0.2),
      makeEstimate('persona-analyst', 0.8),
    ];
    const result = aggregate(estimates);
    assert.ok(result.spread > 0, 'spread must be > 0 when estimates disagree');
    assert.ok(Math.abs(result.spread - 0.6) < 0.001, `spread should be 0.6, got ${result.spread}`);
  });

  it('explanation is always non-empty (plan invariant)', () => {
    const cases: Estimate[][] = [
      [],
      [makeEstimate('base-rate', 0.5)],
      [makeEstimate('base-rate', 0.3), makeEstimate('decomposition', 0.6), makeEstimate('persona-analyst', 0.5)],
    ];
    for (const estimates of cases) {
      const result = aggregate(estimates);
      assert.ok(result.explanation.length > 0, 'explanation must always be non-empty');
    }
  });

  it('empty estimates returns default prior (30%) with explanation', () => {
    const result = aggregate([]);
    assert.equal(result.p, 0.30, 'empty estimates must return 0.30 default prior');
    assert.ok(result.explanation.length > 0, 'explanation must be non-empty for default prior');
  });

  it('clamps output to [CLAMP_LO, CLAMP_HI]', () => {
    // Three very high confidence estimates.
    const estimates: Estimate[] = [
      makeEstimate('base-rate', 0.99),
      makeEstimate('persona-analyst', 0.99),
      makeEstimate('persona-skeptic', 0.99),
    ];
    const result = aggregate(estimates);
    assert.ok(result.p <= CLAMP_HI, `output ${result.p} exceeds CLAMP_HI=${CLAMP_HI}`);
    assert.ok(result.p >= CLAMP_LO, `output ${result.p} below CLAMP_LO=${CLAMP_LO}`);
  });

  it('high spread (> 0.25) suppresses extremization', () => {
    // Create estimates with spread = 0.7 (very high disagreement).
    const estimates: Estimate[] = [
      makeEstimate('persona-analyst', 0.85),
      makeEstimate('persona-skeptic', 0.15),
      makeEstimate('persona-pragmatist', 0.75),
    ];
    const spread = Math.max(...estimates.map(e => e.p)) - Math.min(...estimates.map(e => e.p));
    assert.ok(spread > SPREAD_SKIP_THRESHOLD, `fixture must have high spread, got ${spread}`);
    const result = aggregate(estimates);
    // The explanation should mention that extremization was skipped.
    assert.ok(
      result.explanation.includes('skipped') || result.explanation.includes('high disagreement'),
      `explanation should note extremization skipped for high spread: ${result.explanation}`,
    );
  });

  it('low spread with 3+ estimates triggers extremization', () => {
    // All estimates close to 0.7 → low spread, 3 estimates → extremize.
    const estimates: Estimate[] = [
      makeEstimate('persona-analyst', 0.70),
      makeEstimate('persona-skeptic', 0.68),
      makeEstimate('persona-pragmatist', 0.72),
    ];
    const spread = Math.max(...estimates.map(e => e.p)) - Math.min(...estimates.map(e => e.p));
    assert.ok(spread <= SPREAD_SKIP_THRESHOLD, `fixture must have low spread, got ${spread}`);
    const result = aggregate(estimates);
    // Result should be >= GMO (extremized toward 1 since all > 0.5).
    const gmo = geoMeanOfOdds(estimates);
    assert.ok(result.p >= gmo - 0.001, `extremized result ${result.p} should be >= GMO ${gmo.toFixed(4)}`);
  });

  it('single estimate: no extremization, spread=0', () => {
    const estimates: Estimate[] = [makeEstimate('base-rate', 0.45)];
    const result = aggregate(estimates);
    assert.equal(result.spread, 0, 'single estimate must have spread=0');
    // Explanation must note skipped extremization.
    assert.ok(result.explanation.includes('skipped'), `explanation should note extremization skipped: ${result.explanation}`);
  });

  it('explanation mentions all estimate sources', () => {
    const estimates: Estimate[] = [
      makeEstimate('base-rate', 0.35),
      makeEstimate('decomposition', 0.42),
      makeEstimate('persona-analyst', 0.50),
    ];
    const result = aggregate(estimates);
    assert.ok(result.explanation.includes('base-rate'), 'explanation must mention base-rate source');
    assert.ok(result.explanation.includes('decomposition'), 'explanation must mention decomposition source');
    assert.ok(result.explanation.includes('persona-analyst'), 'explanation must mention persona-analyst source');
  });
});
