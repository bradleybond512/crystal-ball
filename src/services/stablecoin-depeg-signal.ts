 
/**
 * Stablecoin De-peg Correlation Signal
 *
 * Detects when a stablecoin deviates >0.5% from its peg AND a high-CII country
 * is present. Correlation suggests capital flight or systemic stress.
 */

import type { CorrelationSignalCore } from './analysis-core';
import { generateSignalId } from '@/utils/analysis-constants';

export interface StablecoinPegStatus {
  symbol: string;
  priceUsd: number;
  deviationPct: number;
}

const DEVIATION_THRESHOLD_PCT = 0.5;
const CII_THRESHOLD = 70;
const MAX_CONFIDENCE = 0.9;

export function detectStablecoinDepegSignals(
  pegs: StablecoinPegStatus[],
  countryScores: { country: string; cii: number }[],
): CorrelationSignalCore[] {
  const signals: CorrelationSignalCore[] = [];

  const highCiiCountries = countryScores
    .filter((c) => c.cii > CII_THRESHOLD)
    .sort((a, b) => b.cii - a.cii);

  if (highCiiCountries.length === 0) return signals;

  const top = highCiiCountries[0]!;
  const topCountry = top.country;
  const topCiiScore = top.cii;

  for (const peg of pegs) {
    const absDev = Math.abs(peg.deviationPct);
    if (absDev <= DEVIATION_THRESHOLD_PCT) continue;

    const confidence = Math.min(
      MAX_CONFIDENCE,
      0.5 + absDev * 0.1 + (topCiiScore - CII_THRESHOLD) * 0.01,
    );

    signals.push({
      id: generateSignalId(),
      type: 'keyword_spike',
      title: 'Stablecoin De-peg',
      description: `${peg.symbol} deviated ${peg.deviationPct.toFixed(2)}% from peg with elevated instability in ${topCountry} (CII ${topCiiScore})`,
      confidence,
      timestamp: new Date(),
      data: {
        marketChange: peg.deviationPct,
        correlatedEntities: [peg.symbol, topCountry],
      },
    });
  }

  return signals;
}
