/**
 * Consolidation state — persists the outcome of the most recent
 * episodic→schema consolidation run so the ConsolidationStatusPanel can
 * show "N episodes → M schemas · last run <time> · X retired" without
 * re-running the clustering pass.
 *
 * runConsolidation() itself returns a ConsolidationReport but the cadence
 * timer used to discard it; recordConsolidationReport() is now called from
 * every run site (cadence tick + panel "Run now") and mirrors the report
 * to localStorage + a `cb:consolidation-report` document event.
 */

import { runConsolidation, type ConsolidationReport } from './consolidation';
import { isCognitionEnabled } from './cognition-settings';

const REPORT_KEY = 'cb:consolidation-last-report';
export const CONSOLIDATION_REPORT_EVENT = 'cb:consolidation-report';

export function recordConsolidationReport(report: ConsolidationReport): void {
  try {
    localStorage.setItem(REPORT_KEY, JSON.stringify(report));
  } catch { /* quota / private browsing */ }
  try {
    document.dispatchEvent(new CustomEvent<ConsolidationReport>(CONSOLIDATION_REPORT_EVENT, { detail: report }));
  } catch { /* non-browser environments */ }
}

/** Last persisted run report, or null when consolidation has never run. */
export function getLastConsolidationReport(): ConsolidationReport | null {
  try {
    const raw = localStorage.getItem(REPORT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;
    const report = parsed as ConsolidationReport;
    return typeof report.ranAt === 'number' ? report : null;
  } catch {
    return null;
  }
}

/**
 * Manual trigger (panel "Run now"). Respects the consolidation kill-switch;
 * resolves null when disabled or when the run fails.
 */
export async function runConsolidationNow(): Promise<ConsolidationReport | null> {
  if (!isCognitionEnabled('consolidation')) return null;
  try {
    const report = await runConsolidation();
    recordConsolidationReport(report);
    return report;
  } catch {
    return null;
  }
}

export function subscribeConsolidationReport(cb: (report: ConsolidationReport) => void): () => void {
  const handler = (e: Event): void => {
    cb((e as CustomEvent<ConsolidationReport>).detail);
  };
  document.addEventListener(CONSOLIDATION_REPORT_EVENT, handler);
  return () => document.removeEventListener(CONSOLIDATION_REPORT_EVENT, handler);
}
