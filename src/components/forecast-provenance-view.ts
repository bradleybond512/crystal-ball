import type { HypothesisForecast } from '@/services/intelligence/hypothesis-forecast';
import type { SuperForecast } from '@/services/cognition/superforecast';

const pct = (n: number) => `${Math.round(n * 100)}%`;
const signed = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n * 100)}%`;

export function buildForecastProvenanceLines(f: HypothesisForecast): string[] {
  const c = f.components;
  const lines: string[] = [`Base confidence ${pct(c.baseConfidence)}`];
  if (c.pciBoost) lines.push(`Pattern (PCI) ${signed(c.pciBoost)}`);
  if (c.analogBoost) lines.push(`Past analogs ${signed(c.analogBoost)}`);
  if (c.calibrationExplanation) lines.push(c.calibrationExplanation);
  else if (c.recalibratedP !== undefined && c.calibrationAdjustment) lines.push(`Calibration ${signed(c.calibrationAdjustment)}`);
  return lines;
}

const TIER_LABELS: Record<SuperForecast['llmTier'], string> = {
  full: 'full LLM pipeline',
  partial: 'partial LLM pipeline',
  'deterministic-only': 'deterministic floor',
};

/** Display lines for a SuperForecast: headline, interval, estimate provenance. */
export function buildSuperforecastLines(sf: SuperForecast): string[] {
  const lines: string[] = [
    `Superforecast ${pct(sf.probability)} (${TIER_LABELS[sf.llmTier]})`,
  ];
  if (sf.interval) {
    const coverage = Math.round((1 - sf.interval.alpha) * 100);
    lines.push(`${coverage}% interval ${pct(sf.interval.lo)}–${pct(sf.interval.hi)} (n=${sf.interval.n})`);
  }
  if (sf.referenceClass) lines.push(`Reference class: ${sf.referenceClass}`);
  for (const e of sf.estimates) {
    lines.push(`${e.source} ${pct(e.p)} (weight ${e.weight.toFixed(1)})`);
  }
  if (sf.estimates.length > 1) lines.push(`Estimate spread ${pct(sf.spread)}`);
  return lines;
}
