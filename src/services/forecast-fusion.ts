 
/**
 * Forecast fusion — single number that fuses signals from the three
 * independent forecasters (EMA region risk, escalation theaters, situation
 * confidence). Used by the HUD to show one global threat curve instead of
 * three competing ones.
 *
 * Fusion is intentionally simple: take the *peak* of each forecaster's top
 * signal, normalize to 0–100, and combine via weighted average. The point
 * is alignment, not statistical rigor — when all three say "things are
 * getting worse" the combined number rises sharply; when one is loud and
 * the others are quiet, it dampens.
 */

import { getHighRiskRegions } from './ema-forecast';
import { getEscalationForecasts, getGlobalTensionIndex } from './escalation-forecast';
import { situationEngine } from './situation-engine';

export interface FusedForecast {
  /** 0–100 combined threat score for the next 24h. */
  combined: number;
  /** Component scores (each 0–100). */
  components: {
    emaPeakRisk: number;
    escalationTopScore: number;
    globalTension: number;
    situationConfidence: number;
  };
  /** Coarse direction since last sample. */
  trend: 'up' | 'stable' | 'down';
  /** Top contributing label for tooltips. */
  topDriver: string;
}

let lastCombined: number | null = null;

export function getFusedForecast(): FusedForecast {
  // Component 1: peak EMA region risk.
  const regions = getHighRiskRegions();
  const emaPeak = regions.length > 0 ? Math.max(...regions.map(r => r.risk24h)) : 0;
  const emaTopRegion = regions[0]?.region ?? '';

  // Component 2: top escalation forecast (already 0–100ish).
  const escalations = getEscalationForecasts();
  const escTop = escalations.length > 0
    ? Math.max(...escalations.map(e => (e as { score?: number }).score ?? 0))
    : 0;
  const escTopName = (escalations[0] as { theater?: string; name?: string } | undefined)?.theater
    ?? (escalations[0] as { name?: string } | undefined)?.name ?? '';

  // Component 3: global tension index (0–1 → 0–100).
  const globalTension = Math.min(100, getGlobalTensionIndex() * 100);

  // Component 4: top actionable situation confidence (0–1 → 0–100).
  const sits = situationEngine.getActionableSituations();
  const sitConfidence = sits.length > 0 ? Math.max(...sits.map(s => s.confidence * 100)) : 0;
  const sitTopTitle = sits[0]?.title ?? '';

  // Weighted average — situations and escalation forecasters get more weight
  // because they're already calibrated; EMA is broader/noisier.
  const combined = Math.round(
    (emaPeak * 0.2)
    + (escTop * 0.3)
    + (globalTension * 0.2)
    + (sitConfidence * 0.3),
  );

  // Determine top driver by comparing weighted contribution.
  const drivers: [number, string][] = [
    [emaPeak * 0.2, emaTopRegion ? `EMA: ${emaTopRegion}` : 'EMA risk'],
    [escTop * 0.3, escTopName ? `Escalation: ${escTopName}` : 'Escalation'],
    [globalTension * 0.2, 'Global tension'],
    [sitConfidence * 0.3, sitTopTitle ? `Situation: ${sitTopTitle}` : 'Situation'],
  ];
  drivers.sort((a, b) => b[0] - a[0]);
  const topDriver = drivers[0]?.[1] ?? '—';

  let trend: 'up' | 'stable' | 'down' = 'stable';
  if (lastCombined !== null) {
    if (combined - lastCombined > 5) trend = 'up';
    else if (combined - lastCombined < -5) trend = 'down';
  }
  lastCombined = combined;

  return {
    combined,
    components: {
      emaPeakRisk: Math.round(emaPeak),
      escalationTopScore: Math.round(escTop),
      globalTension: Math.round(globalTension),
      situationConfidence: Math.round(sitConfidence),
    },
    trend,
    topDriver,
  };
}
