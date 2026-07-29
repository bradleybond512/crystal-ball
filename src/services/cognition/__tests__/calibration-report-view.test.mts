/**
 * Tests for src/services/cognition/calibration-report-view.ts
 *
 * Tests (node:test + node:assert, static fixtures, no DOM/IDB):
 *   - Empty input → global insufficient_data, no domain rows, honest summary
 *   - Well-calibrated domain (predicted ≈ observed) → well_calibrated
 *   - Overconfident (predicted ≫ observed) → overconfident, headline "run hot"
 *   - Underconfident (predicted ≪ observed) → underconfident, headline "run cold"
 *   - Below MIN_REPORT_N → insufficient_data but row still present with brier
 *   - curveSource ladder: domain (≥30) → global (pooled active) → identity
 *   - Sparkline: non-empty bins only, gap = observed − predicted
 *   - generatedAt honors options.now (determinism), domains sorted sample-desc
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCalibrationReportCard,
  MIN_REPORT_N,
} from '../calibration-report-view.js';
import { MIN_DOMAIN_N, MIN_GLOBAL_N } from '../recalibration.js';
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

/**
 * Build `n` resolved records at probability `p` in `domain`, of which
 * `trueCount` resolve true. Lets a fixture dial observed rate independently
 * of predicted probability.
 */
function makeCalibrated(
  n: number,
  p: number,
  trueCount: number,
  domain: PredictionRecord['domain'] = 'markets',
): PredictionRecord[] {
  const out: PredictionRecord[] = [];
  for (let i = 0; i < n; i++) {
    out.push(makeRecord(p, i < trueCount ? 'resolved_true' : 'resolved_false', domain));
  }
  return out;
}

const NOW = 1_700_000_000_000;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildCalibrationReportCard', () => {
  it('empty input → global insufficient_data, no domain rows', () => {
    const card = buildCalibrationReportCard([], { now: NOW });
    assert.equal(card.generatedAt, NOW);
    assert.equal(card.global.reliability, 'insufficient_data');
    assert.equal(card.global.sampleSize, 0);
    assert.equal(card.global.brier, null);
    assert.equal(card.global.gap, null);
    assert.deepEqual(card.domains, []);
    assert.equal(card.overall.resolvedTotal, 0);
    assert.equal(card.overall.trackedDomains, 0);
    assert.match(card.global.headline, /no resolved forecasts/i);
  });

  it('well-calibrated domain (predicted ≈ observed) → well_calibrated', () => {
    // 40 markets @ 0.6, 24 true → observed 0.6 == predicted 0.6, gap 0.
    const card = buildCalibrationReportCard(makeCalibrated(40, 0.6, 24), { now: NOW });
    const markets = card.domains.find(d => d.domain === 'markets');
    assert.ok(markets);
    assert.equal(markets.sampleSize, 40);
    assert.equal(markets.reliability, 'well_calibrated');
    assert.equal(markets.meanPredicted, 0.6);
    assert.equal(markets.observedRate, 0.6);
    assert.equal(markets.gap, 0);
    assert.equal(markets.curveSource, 'domain'); // ≥ MIN_DOMAIN_N
    assert.match(markets.headline, /well-calibrated/i);
  });

  it('overconfident (predicted ≫ observed) → overconfident, "run hot"', () => {
    // 40 markets @ 0.8, 12 true → observed 0.3, gap −0.5.
    const card = buildCalibrationReportCard(makeCalibrated(40, 0.8, 12), { now: NOW });
    const markets = card.domains.find(d => d.domain === 'markets');
    assert.ok(markets);
    assert.equal(markets.reliability, 'overconfident');
    assert.ok((markets.gap ?? 0) < 0);
    assert.match(markets.headline, /run hot/i);
    assert.equal(card.overall.label, 'overconfident');
  });

  it('underconfident (predicted ≪ observed) → underconfident, "run cold"', () => {
    // 40 markets @ 0.3, 24 true → observed 0.6, gap +0.3.
    const card = buildCalibrationReportCard(makeCalibrated(40, 0.3, 24), { now: NOW });
    const markets = card.domains.find(d => d.domain === 'markets');
    assert.ok(markets);
    assert.equal(markets.reliability, 'underconfident');
    assert.ok((markets.gap ?? 0) > 0);
    assert.match(markets.headline, /run cold/i);
  });

  it('below MIN_REPORT_N → insufficient_data but row present with brier', () => {
    const n = MIN_REPORT_N - 1;
    const card = buildCalibrationReportCard(makeCalibrated(n, 0.5, 3), { now: NOW });
    const markets = card.domains.find(d => d.domain === 'markets');
    assert.ok(markets, 'row present even below the grading floor');
    assert.equal(markets.sampleSize, n);
    assert.equal(markets.reliability, 'insufficient_data');
    assert.notEqual(markets.brier, null); // still measured
    assert.match(markets.headline, /not enough to grade/i);
  });

  it('curveSource ladder: domain ≥30, else global when pooled active, else identity', () => {
    // 40 weather (→ domain) + 20 markets (→ global, pooled active since total 60 ≥ 50).
    const records = [
      ...makeCalibrated(40, 0.6, 24, 'weather'),
      ...makeCalibrated(20, 0.6, 12, 'markets'),
    ];
    assert.ok(40 >= MIN_DOMAIN_N && 60 >= MIN_GLOBAL_N && 20 < MIN_DOMAIN_N);
    const card = buildCalibrationReportCard(records, { now: NOW });
    const weather = card.domains.find(d => d.domain === 'weather');
    const markets = card.domains.find(d => d.domain === 'markets');
    assert.equal(weather?.curveSource, 'domain');
    assert.equal(markets?.curveSource, 'global');
    assert.equal(card.global.curveSource, 'global'); // 60 ≥ MIN_GLOBAL_N

    // Same 20 markets alone: pooled inactive (20 < 50) → identity.
    const lonely = buildCalibrationReportCard(makeCalibrated(20, 0.6, 12, 'markets'), { now: NOW });
    assert.equal(lonely.domains.find(d => d.domain === 'markets')?.curveSource, 'identity');
    assert.equal(lonely.global.curveSource, 'identity');
  });

  it('sparkline holds non-empty bins only with gap = observed − predicted', () => {
    const card = buildCalibrationReportCard(makeCalibrated(40, 0.6, 24), { now: NOW });
    const markets = card.domains.find(d => d.domain === 'markets');
    assert.ok(markets && markets.sparkline.length > 0);
    for (const pt of markets.sparkline) {
      assert.ok(pt.n > 0, 'only populated bins appear');
      assert.equal(pt.gap, Math.round((pt.observed - pt.predicted) * 1000) / 1000);
    }
  });

  it('domains sorted by sampleSize desc', () => {
    const records = [
      ...makeCalibrated(15, 0.5, 7, 'cyber'),
      ...makeCalibrated(40, 0.5, 20, 'markets'),
      ...makeCalibrated(25, 0.5, 12, 'weather'),
    ];
    const card = buildCalibrationReportCard(records, { now: NOW });
    const sizes = card.domains.map(d => d.sampleSize);
    assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a));
    assert.equal(card.domains[0].domain, 'markets');
  });
});
