/**
 * ACC-303 baseline-pairing corpus — deterministic fixtures that exercise
 * the persistence and momentum baselines, which the ACC-301 replay
 * corpus structurally cannot (unique targetKeys, no price series).
 *
 * Three families, all closed-form in the fixture index (no randomness,
 * no clock reads):
 *  - mode:*     — 3 advisory keys, repeated over time → persistence
 *  - shortage:* — 2 commodity keys, repeated over time → persistence
 *  - market     — market_move criteria with an embedded pre-forecast
 *                 price series → momentum
 *
 * Outcomes follow regime patterns with deliberate flips so persistence
 * is right in runs and wrong at transitions; market outcomes follow the
 * embedded trend with periodic reversals so momentum is informative but
 * imperfect. The corpus id is its own namespace: this file is FROZEN
 * once the committed baseline JSON is reviewed — see
 * baseline-pairing-benchmark.ts.
 */

import type { MarketMoveCriteria } from '../forecast-calibration';

export const BASELINE_PAIRING_CORPUS_ID = 'baseline-pairing-v1';
export const BASELINE_PAIRING_ANCHOR = Date.UTC(2025, 0, 1);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface PairingPricePoint {
  offsetMs: number; // relative to fixture predictedAt (negative = before)
  price: number;
}

export interface PairingFixture {
  id: string;
  family: 'mode' | 'shortage' | 'market';
  targetKey: string;
  domain: string;
  predictedAt: number;
  resolveBy: number;
  resolvedAt: number;
  outcome: boolean;
  /** SYNTHETIC incumbent probability — an outcome-informed oracle by
   *  construction (see productionProbabilityFor). It is a FIXED
   *  reference for regression gating, NOT evidence about the real
   *  production system's skill. */
  productionProbability: number;
  criteria?: MarketMoveCriteria;
  priceSeries?: PairingPricePoint[];
}

const MODE_KEYS = ['mode:finance', 'mode:security', 'mode:cyber'] as const;
const SHORTAGE_KEYS = ['shortage:wheat:global', 'shortage:diesel:us-gulf'] as const;

/** Regime pattern: runs of `true` and `false` with flips — index-driven. */
function stateOutcome(seriesIndex: number, phase: number): boolean {
  // Runs of length 4 with a phase offset per key.
  return Math.floor((seriesIndex + phase) / 4) % 2 === 0;
}

function productionProbabilityFor(outcome: boolean, seriesIndex: number): number {
  // DELIBERATELY outcome-informed: this synthetic incumbent knows the
  // fixture outcome and adds calibrated noise. That makes it an ORACLE
  // reference the baselines are regression-gated against — it says
  // nothing about real production skill (the live shadow pairing runs
  // measure that). Right direction most of the time, overconfident
  // every 5th forecast.
  const base = outcome ? 0.68 : 0.34;
  const wobble = ((seriesIndex * 7) % 10) / 100; // 0.00..0.09
  const overconfident = seriesIndex % 5 === 0;
  const overconfidenceShift = outcome ? -0.3 : 0.3;
  const p = base + (outcome ? wobble : -wobble) + (overconfident ? overconfidenceShift : 0);
  return Math.min(0.95, Math.max(0.05, Number(p.toFixed(4))));
}

function stateFixtures(
  family: 'mode' | 'shortage',
  keys: readonly string[],
  domain: string,
  perKey: number,
  phaseStep: number,
): PairingFixture[] {
  const out: PairingFixture[] = [];
  keys.forEach((targetKey, keyIndex) => {
    for (let i = 0; i < perKey; i++) {
      const predictedAt = BASELINE_PAIRING_ANCHOR + (keyIndex * perKey + i) * 6 * HOUR + keyIndex * HOUR;
      const resolveBy = predictedAt + DAY;
      const outcome = stateOutcome(i, keyIndex * phaseStep);
      out.push({
        id: `${family}-${keyIndex}-${i}`,
        family,
        targetKey,
        domain,
        predictedAt,
        resolveBy,
        resolvedAt: predictedAt + 18 * HOUR,
        outcome,
        productionProbability: productionProbabilityFor(outcome, i),
      });
    }
  });
  return out;
}

/** Market trend per fixture: slope sign flips every 3 fixtures; outcome
 *  follows the trend except every 4th fixture (reversal). */
function marketFixtures(count: number): PairingFixture[] {
  const out: PairingFixture[] = [];
  for (let i = 0; i < count; i++) {
    const predictedAt = BASELINE_PAIRING_ANCHOR + 400 * HOUR + i * DAY;
    const resolveBy = predictedAt + DAY;
    const upTrend = Math.floor(i / 3) % 2 === 0;
    const reversal = i % 4 === 3;
    const outcome = reversal ? !upTrend : upTrend;
    const basisPrice = 100 + i;
    const slopePctPerHour = upTrend ? 0.4 : -0.4;
    const priceSeries: PairingPricePoint[] = [];
    for (let s = 0; s < 8; s++) {
      const offsetMs = -(5 * 60_000) - (7 - s) * 30 * 60_000;
      const hoursBeforeEnd = (-offsetMs - 5 * 60_000) / HOUR;
      priceSeries.push({
        offsetMs,
        price: Number((basisPrice * (1 - (slopePctPerHour / 100) * hoursBeforeEnd)).toFixed(6)),
      });
    }
    out.push({
      id: `market-${i}`,
      family: 'market',
      targetKey: `hypothesis:pairing-mkt-${i}`,
      domain: 'markets',
      predictedAt,
      resolveBy,
      resolvedAt: predictedAt + 20 * HOUR,
      outcome,
      productionProbability: productionProbabilityFor(outcome, i),
      criteria: {
        kind: 'market_move',
        symbol: `SYM${i % 4}`,
        direction: 'up',
        minAbsPct: 3,
        basisPrice,
        basisObservedAt: predictedAt - 5 * 60_000,
      },
      priceSeries,
    });
  }
  return out;
}

export function baselinePairingFixtures(): PairingFixture[] {
  return [
    ...stateFixtures('mode', MODE_KEYS, 'macro', 12, 2),
    ...stateFixtures('shortage', SHORTAGE_KEYS, 'infra', 12, 3),
    ...marketFixtures(12),
  ].sort((a, b) => a.predictedAt - b.predictedAt || a.id.localeCompare(b.id));
}
