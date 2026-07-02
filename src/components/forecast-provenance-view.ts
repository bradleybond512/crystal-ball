import type { HypothesisForecast } from '@/services/intelligence/hypothesis-forecast';

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
