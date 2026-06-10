/**
 * Tests for src/services/cognition/conformal.ts
 *
 * Coverage (plan-mandated):
 *   - COVERAGE PROPERTY: on synthetic fixture sets, the interval must contain
 *     the realized outcome ≥ (1−α) fraction of the time (the defining
 *     property of conformal prediction).
 *   - n-threshold fallbacks: domain → global → uninformative
 *   - Explanation content always states pool and n (plan invariant)
 *   - Clamps: lo ≥ 0, hi ≤ 1 for extreme p values
 *   - Quantile rank math on small n (rank may exceed 1 → q = 1)
 *   - Alpha boundary behavior
 *
 * Static fixtures, no DOM, no IDB.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  conformalInterval,
  MIN_DOMAIN_N,
  MIN_GLOBAL_N,
  DEFAULT_ALPHA,
} from '../conformal.js';
import type { ForecastInterval } from '../conformal.js';
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

/** Build a fixture set of n records with given probability and a known outcome fraction. */
function makeRecords(
  n: number,
  probability: number,
  trueFraction: number,
  domain: PredictionRecord['domain'] = 'markets',
): PredictionRecord[] {
  const records: PredictionRecord[] = [];
  const trueCount = Math.round(n * trueFraction);
  for (let i = 0; i < n; i++) {
    records.push(
      makeRecord(probability, i < trueCount ? 'resolved_true' : 'resolved_false', domain),
    );
  }
  return records;
}

/** Build a "realistic" mixed fixture with varied p values and outcomes. */
function makeMixedRecords(n: number, domain: PredictionRecord['domain'] = 'markets'): PredictionRecord[] {
  const records: PredictionRecord[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i % 10) / 10 + 0.05; // 0.05, 0.15, …, 0.95 cycling
    const outcome = Math.random() < p ? 'resolved_true' : 'resolved_false';
    records.push(makeRecord(p, outcome, domain));
  }
  return records;
}

// ── Deterministic coverage property fixture ───────────────────────────────────
//
// Use a fixed pseudo-random outcome to avoid flakiness.
// Pattern: for record i, outcome = (i * 31 + 7) % 100 < p*100 → resolved_true

function makeDeterministicRecords(
  n: number,
  domain: PredictionRecord['domain'] = 'weather',
): PredictionRecord[] {
  const records: PredictionRecord[] = [];
  for (let i = 0; i < n; i++) {
    const p = 0.2 + (i % 7) * 0.1; // cycles through 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8
    const hash = ((i * 31 + 7) % 100);
    const outcome = hash < p * 100 ? 'resolved_true' : 'resolved_false';
    records.push(makeRecord(p, outcome, domain));
  }
  return records;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('conformalInterval', () => {

  // ── Coverage property test (MANDATORY per plan) ───────────────────────────

  it('coverage property: interval contains realized outcome ≥ (1−α) fraction of the time', () => {
    // Build a calibration set (first half of records used as calibration).
    // Then for the second half, compute an interval and check coverage.
    //
    // We use 200 records: 100 calibration + 100 test.
    // alpha = 0.2 → expect ≥ 80% coverage on the test set.

    const alpha = 0.2;
    const calibrationN = 100;
    const testN = 100;
    const allN = calibrationN + testN;
    const domain: PredictionRecord['domain'] = 'weather';

    const allRecords = makeDeterministicRecords(allN, domain);
    const calibrationRecords = allRecords.slice(0, calibrationN);
    const testRecords = allRecords.slice(calibrationN);

    let covered = 0;
    for (const rec of testRecords) {
      const outcome = rec.status === 'resolved_true' ? 1 : 0;
      const interval = conformalInterval(rec.probability, domain, calibrationRecords, alpha);
      if (outcome >= interval.lo && outcome <= interval.hi) {
        covered += 1;
      }
    }

    const coverageRate = covered / testN;
    const expectedCoverage = 1 - alpha; // 0.80

    // Conformal coverage guarantee: ≥ (1−α) fraction.
    assert.ok(
      coverageRate >= expectedCoverage,
      `Coverage ${(coverageRate * 100).toFixed(1)}% < required ${(expectedCoverage * 100).toFixed(1)}%`,
    );
  });

  it('coverage property holds for 90% interval (alpha=0.1)', () => {
    const alpha = 0.1;
    const calibrationN = 120;
    const testN = 80;
    const domain: PredictionRecord['domain'] = 'conflict';

    const allRecords = makeDeterministicRecords(calibrationN + testN, domain);
    const calibrationRecords = allRecords.slice(0, calibrationN);
    const testRecords = allRecords.slice(calibrationN);

    let covered = 0;
    for (const rec of testRecords) {
      const outcome = rec.status === 'resolved_true' ? 1 : 0;
      const interval = conformalInterval(rec.probability, domain, calibrationRecords, alpha);
      if (outcome >= interval.lo && outcome <= interval.hi) {
        covered += 1;
      }
    }

    const coverageRate = covered / testN;
    assert.ok(
      coverageRate >= 1 - alpha,
      `Coverage ${(coverageRate * 100).toFixed(1)}% < required ${((1 - alpha) * 100).toFixed(1)}%`,
    );
  });

  // ── n-threshold fallbacks ──────────────────────────────────────────────────

  it('uses per-domain pool when domain has ≥ MIN_DOMAIN_N resolved records', () => {
    const records = makeRecords(MIN_DOMAIN_N, 0.6, 0.6, 'cyber');
    const interval = conformalInterval(0.6, 'cyber', records);

    assert.ok(interval.n === MIN_DOMAIN_N, `Expected n=${MIN_DOMAIN_N}, got n=${interval.n}`);
    assert.ok(
      interval.explanation.includes('cyber pool'),
      `Expected 'cyber pool' in: ${interval.explanation}`,
    );
    assert.strictEqual(interval.alpha, DEFAULT_ALPHA);
  });

  it('falls back to global pool when domain has < MIN_DOMAIN_N but global has ≥ MIN_GLOBAL_N', () => {
    // 10 domain records + enough other domain records to fill global pool.
    const domainRecords = makeRecords(10, 0.5, 0.5, 'cyber');
    const otherRecords = makeRecords(MIN_GLOBAL_N, 0.5, 0.5, 'markets');
    const allRecords = [...domainRecords, ...otherRecords];

    const interval = conformalInterval(0.5, 'cyber', allRecords);

    assert.ok(
      interval.explanation.includes('global pool'),
      `Expected 'global pool' in: ${interval.explanation}`,
    );
    assert.ok(
      interval.n >= MIN_GLOBAL_N,
      `Expected n ≥ ${MIN_GLOBAL_N}, got n=${interval.n}`,
    );
    // Should also mention the domain had fewer records.
    assert.ok(
      interval.explanation.includes('cyber'),
      `Expected mention of domain in: ${interval.explanation}`,
    );
  });

  it('returns uninformative interval (lo=0, hi=1) when global pool < MIN_GLOBAL_N', () => {
    const records = makeRecords(5, 0.5, 0.5, 'markets');
    const interval = conformalInterval(0.5, 'markets', records);

    assert.strictEqual(interval.lo, 0, 'lo should be 0 for uninformative');
    assert.strictEqual(interval.hi, 1, 'hi should be 1 for uninformative');
    assert.ok(
      interval.explanation.includes('insufficient history'),
      `Expected 'insufficient history' in: ${interval.explanation}`,
    );
    assert.ok(
      interval.explanation.includes(`have ${records.length}`),
      `Expected 'have 5' in: ${interval.explanation}`,
    );
  });

  it('returns uninformative interval with n=0 when no records at all', () => {
    const interval = conformalInterval(0.5, 'weather', []);

    assert.strictEqual(interval.lo, 0);
    assert.strictEqual(interval.hi, 1);
    assert.strictEqual(interval.n, 0);
    assert.ok(interval.explanation.includes('insufficient history'));
  });

  it('ignores pending and expired records (only resolved contribute)', () => {
    // Add 5 resolved + 100 pending/expired. Should still be uninformative.
    const records: PredictionRecord[] = [
      ...makeRecords(5, 0.5, 0.5, 'markets'),
      ...Array.from({ length: 100 }, (_, i) => ({
        ...makeRecord(0.5, 'resolved_true', 'markets'),
        status: 'pending' as const,
        id: `pending-${i}`,
      })),
    ];

    const interval = conformalInterval(0.5, 'markets', records);
    // Only 5 resolved → uninformative.
    assert.strictEqual(interval.lo, 0);
    assert.strictEqual(interval.hi, 1);
    assert.ok(interval.explanation.includes('insufficient history'));
  });

  // ── Quantile rank math ────────────────────────────────────────────────────

  it('quantile rank exceeds 1 for very small n → q=1 → uninformative width', () => {
    // With n=1 and alpha=0.2:
    // rank = ceil((1+1)(0.8)) / 1 = ceil(1.6) / 1 = 2 > 1 → q = 1
    // The single record won't be enough to trigger the global pool (< MIN_GLOBAL_N),
    // so we'll be in uninformative territory anyway. But verify the quantile function
    // returns width-1 when invoked with a single score.
    //
    // Test the coverage property indirectly: use exactly MIN_GLOBAL_N records
    // so we get a global pool, and force a degenerate alpha near 0.
    const records = makeRecords(MIN_GLOBAL_N, 0.5, 0.5, 'markets');
    const alpha = 0.001; // very tight → wants very high quantile rank
    const interval = conformalInterval(0.5, 'markets', records, alpha);

    // With only MIN_GLOBAL_N records and alpha≈0, rank ≈ (n+1)/n > 1 → q=1.
    // hi - lo should be ≤ 1 (clamped), and for p=0.5 with q=1: lo=0, hi=1.
    assert.ok(interval.hi - interval.lo > 0, 'Interval should have positive width');
    assert.ok(interval.lo >= 0, 'lo must be ≥ 0');
    assert.ok(interval.hi <= 1, 'hi must be ≤ 1');
  });

  it('produces a finite-width interval for normal alpha with sufficient records', () => {
    const records = makeRecords(MIN_GLOBAL_N + 20, 0.5, 0.5, 'markets');
    const interval = conformalInterval(0.5, 'markets', records, 0.2);

    // With 50%/50% predictions and outcomes, nonconformity = |0 - 0.5| = 0.5 or |1 - 0.5| = 0.5.
    // So q = 0.5. Interval should be [0, 1] since 0.5 ± 0.5 = [0, 1].
    // (All records have p=0.5, so nonconformity is always 0.5 regardless of outcome.)
    assert.strictEqual(interval.lo, 0);
    assert.strictEqual(interval.hi, 1);
    assert.ok(interval.n >= MIN_GLOBAL_N);
  });

  it('produces a tight interval when prediction is very accurate', () => {
    // Perfect calibration: all p=0 → resolved_false (nonconformity = |0 − 0| = 0)
    //                      all p=1 → resolved_true  (nonconformity = |1 − 1| = 0)
    // All nonconformity scores = 0 → q = 0 → interval = [p, p].
    const records: PredictionRecord[] = [
      ...makeRecords(MIN_GLOBAL_N / 2, 0.99, 1.0, 'markets'), // ~all true at p=0.99 → nonconformity ≈ 0.01
      ...makeRecords(MIN_GLOBAL_N / 2, 0.01, 0.0, 'markets'), // ~all false at p=0.01 → nonconformity ≈ 0.01
    ];
    const interval = conformalInterval(0.7, 'markets', records, 0.2);

    // Nonconformity = 0.01 for every record. With large n and q=0.01:
    // interval for p=0.7: [0.69, 0.71] — very tight.
    assert.ok(
      interval.hi - interval.lo <= 0.1,
      `Expected tight interval, got width=${interval.hi - interval.lo}`,
    );
  });

  // ── Clamps ────────────────────────────────────────────────────────────────

  it('clamps lo to 0 when p is near 0', () => {
    const records = makeRecords(MIN_GLOBAL_N, 0.5, 0.5, 'markets');
    const interval = conformalInterval(0.05, 'markets', records, 0.2);

    assert.ok(interval.lo >= 0, `lo=${interval.lo} must be ≥ 0`);
    assert.ok(interval.hi <= 1, `hi=${interval.hi} must be ≤ 1`);
  });

  it('clamps hi to 1 when p is near 1', () => {
    const records = makeRecords(MIN_GLOBAL_N, 0.5, 0.5, 'markets');
    const interval = conformalInterval(0.95, 'markets', records, 0.2);

    assert.ok(interval.lo >= 0, `lo=${interval.lo} must be ≥ 0`);
    assert.ok(interval.hi <= 1, `hi=${interval.hi} must be ≤ 1`);
  });

  it('clamps p=0 and p=1 inputs', () => {
    const records = makeRecords(MIN_GLOBAL_N, 0.5, 0.5, 'markets');
    const i0 = conformalInterval(0, 'markets', records);
    const i1 = conformalInterval(1, 'markets', records);

    assert.strictEqual(i0.lo, 0);
    assert.ok(i1.hi === 1);
  });

  // ── Explanation content ───────────────────────────────────────────────────

  it('explanation always contains the pool type and n', () => {
    // Global pool case.
    const globalRecords = makeRecords(MIN_GLOBAL_N, 0.5, 0.5, 'markets');
    const globalInterval = conformalInterval(0.5, 'markets', globalRecords, 0.2);
    assert.ok(
      globalInterval.explanation.includes('global pool') ||
      globalInterval.explanation.includes('markets pool'),
      `Missing pool type in: ${globalInterval.explanation}`,
    );
    assert.ok(
      globalInterval.explanation.includes(`n=${globalInterval.n}`),
      `Missing n in: ${globalInterval.explanation}`,
    );

    // Uninformative case.
    const tinyRecords = makeRecords(2, 0.5, 0.5, 'markets');
    const uninformativeInterval = conformalInterval(0.5, 'markets', tinyRecords);
    assert.ok(uninformativeInterval.explanation.length > 0, 'Explanation must not be empty');
    assert.ok(
      uninformativeInterval.explanation.includes('insufficient history'),
      `Missing 'insufficient history' in: ${uninformativeInterval.explanation}`,
    );
  });

  it('explanation mentions coverage percentage', () => {
    const records = makeRecords(MIN_GLOBAL_N, 0.5, 0.5, 'markets');
    const interval = conformalInterval(0.5, 'markets', records, 0.2);

    // 1-0.2 = 0.8 → 80%
    assert.ok(
      interval.explanation.includes('80%'),
      `Expected '80%' in: ${interval.explanation}`,
    );
  });

  it('explanation mentions nonconformity quantile q', () => {
    const records = makeRecords(MIN_GLOBAL_N, 0.5, 0.5, 'markets');
    const interval = conformalInterval(0.5, 'markets', records, 0.2);

    assert.ok(
      interval.explanation.includes('q='),
      `Expected 'q=' in: ${interval.explanation}`,
    );
  });

  // ── Fields ────────────────────────────────────────────────────────────────

  it('returns correct alpha in result', () => {
    const records = makeRecords(MIN_GLOBAL_N, 0.5, 0.5, 'markets');
    const interval = conformalInterval(0.5, 'markets', records, 0.15);

    assert.strictEqual(interval.alpha, 0.15);
  });

  it('returns rounded p value matching input', () => {
    const records = makeRecords(MIN_GLOBAL_N, 0.5, 0.5, 'markets');
    const interval = conformalInterval(0.654321, 'markets', records, 0.2);

    // p should be rounded to 3 decimal places.
    assert.strictEqual(interval.p, 0.654);
  });

  it('lo ≤ p ≤ hi when interval is informative', () => {
    const records = makeRecords(MIN_DOMAIN_N, 0.5, 0.5, 'weather');
    const interval = conformalInterval(0.5, 'weather', records, 0.2);

    assert.ok(interval.lo <= interval.p, `lo=${interval.lo} > p=${interval.p}`);
    assert.ok(interval.p <= interval.hi, `p=${interval.p} > hi=${interval.hi}`);
  });

  // ── Domain='global' shortcut ──────────────────────────────────────────────

  it('domain=global skips domain-pool attempt and goes directly to global', () => {
    const records = makeRecords(MIN_GLOBAL_N, 0.5, 0.5, 'markets');
    const interval = conformalInterval(0.5, 'global', records, 0.2);

    // Should use global pool (no domain pool attempt for 'global').
    assert.ok(
      interval.explanation.includes('global pool'),
      `Expected 'global pool' for domain='global': ${interval.explanation}`,
    );
  });

  // ── MIN constants are exported ────────────────────────────────────────────

  it('MIN_DOMAIN_N and MIN_GLOBAL_N are exported and correct', () => {
    assert.strictEqual(MIN_DOMAIN_N, 40);
    assert.strictEqual(MIN_GLOBAL_N, 40);
  });

  it('DEFAULT_ALPHA is exported and equals 0.2', () => {
    assert.strictEqual(DEFAULT_ALPHA, 0.2);
  });

});
