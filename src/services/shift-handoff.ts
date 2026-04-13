/**
 * Shift handoff briefing — generates a structured summary of the last
 * N hours: top stories, active situations, forecast accuracy, degraded sources.
 *
 * Dispatches `cb:shift-handoff` with the briefing data.
 */

import { unifiedAlertStore } from './unified-alerts';
import { groupIntoStories } from './alert-stories';
import { situationEngine } from './situation-engine';
import { getForecastAccuracy, type ForecastAccuracy } from './forecast-accuracy';
import { getSourceHealth } from './source-health';
import { getAllLifecycles, type LifecyclePhase } from './alert-lifecycle';

export interface ShiftBriefing {
  periodHours: number;
  generatedAt: number;
  totalAlerts: number;
  acknowledgedCount: number;
  topStories: { label: string; count: number; leadSeverity: string }[];
  activeSituations: { title: string; phase: string; confidence: number }[];
  resolvedStories: number;
  forecastAccuracy: ForecastAccuracy;
  degradedSources: { name: string; status: string; errorRate: number }[];
  lifecycleSummary: Record<LifecyclePhase, number>;
}

export function generateShiftBriefing(periodHours = 8): ShiftBriefing {
  const cutoff = Date.now() - periodHours * 60 * 60_000;
  const all = unifiedAlertStore.getAll().filter(a => a.timestamp >= cutoff);
  const unacked = all.filter(a => !a.acknowledged);
  const acked = all.filter(a => a.acknowledged);

  const stories = groupIntoStories(unacked);
  const topStories = stories.slice(0, 10).map(s => ({
    label: s.label,
    count: s.alerts.length,
    leadSeverity: s.leadAlert.severity,
  }));

  const situations = situationEngine.getSituations();
  const activeSituations = situations
    .filter(s => s.phase === 'active' || s.phase === 'developing')
    .slice(0, 5)
    .map(s => ({ title: s.title, phase: s.phase, confidence: s.confidence }));

  const lifecycles = getAllLifecycles();
  const lifecycleSummary: Record<LifecyclePhase, number> = { rising: 0, peaked: 0, cooling: 0, resolved: 0 };
  for (const phase of lifecycles.values()) lifecycleSummary[phase]++;

  const health = getSourceHealth();
  const degradedSources = health
    .filter(h => h.status !== 'ok')
    .map(h => ({
      name: h.name,
      status: h.status,
      errorRate: h.errorCount / Math.max(1, h.successCount + h.errorCount),
    }));

  return {
    periodHours,
    generatedAt: Date.now(),
    totalAlerts: all.length,
    acknowledgedCount: acked.length,
    topStories,
    activeSituations,
    resolvedStories: lifecycleSummary.resolved,
    forecastAccuracy: getForecastAccuracy(),
    degradedSources,
    lifecycleSummary,
  };
}
