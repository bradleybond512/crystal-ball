/**
 * Pure formatter for a SuperForecast — turns the superforecaster pipeline output
 * into a short list of display lines for the AnalystHUD "Deep forecast" card.
 * No DOM, no fetch, no state: string in, strings out.
 */

import type { SuperForecast } from '@/services/cognition/superforecast';

export function formatSuperForecast(sf: SuperForecast): string[] {
  const lines: string[] = [
    `${(sf.probability * 100).toFixed(0)}% likely · spread ${(sf.spread * 100).toFixed(0)}pts · ${sf.llmTier}`,
  ];
  if (sf.interval) lines.push(`Interval: ${(sf.interval.lo * 100).toFixed(0)}–${(sf.interval.hi * 100).toFixed(0)}%`);
  lines.push(sf.explanation);
  return lines;
}
