import { runConsolidation } from './consolidation';
import { recordConsolidationReport } from './consolidation-state';
import { isCognitionEnabled } from './cognition-settings';
import { isGhostMode } from '@/services/mode-manager';
import { scheduleIdleWork } from './idle-scheduler';
import type { ScheduleIdleWorkOptions } from './idle-scheduler';

export const CONSOLIDATION_INTERVAL_MS = 6 * 60 * 60 * 1000;

const LAST_RUN_KEY = 'cb:consolidation-last';
const TICK_MS = 30 * 60 * 1000;

export function shouldRunConsolidation(lastRunMs: number | null, nowMs: number): boolean {
  if (lastRunMs === null) return true;
  return nowMs - lastRunMs >= CONSOLIDATION_INTERVAL_MS;
}

/** Injectable dependencies for one cadence tick — split out from
 *  startConsolidationCadence() so the scheduling decision is unit-testable
 *  without a real setInterval/requestIdleCallback in the test runner. */
export interface ConsolidationTickOptions {
  now?: () => number;
  isGhostModeFn?: () => boolean;
  isCognitionEnabledFn?: (key: 'consolidation') => boolean;
  storage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  runConsolidationFn?: typeof runConsolidation;
  recordReportFn?: typeof recordConsolidationReport;
  idleOpts?: ScheduleIdleWorkOptions;
}

/**
 * One cadence tick: decide whether consolidation is due, and if so, run it
 * via scheduleIdleWork() (PR 14: requestIdleCallback + visibility guard —
 * consolidation's clustering pass never runs on the synchronous path of a
 * rendered frame, and is skipped entirely while the tab is hidden).
 */
export function runConsolidationTick(opts: ConsolidationTickOptions = {}): void {
  const nowFn = opts.now ?? Date.now;
  const ghostFn = opts.isGhostModeFn ?? isGhostMode;
  const enabledFn = opts.isCognitionEnabledFn ?? isCognitionEnabled;
  const storage = opts.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  const runFn = opts.runConsolidationFn ?? runConsolidation;
  const recordFn = opts.recordReportFn ?? recordConsolidationReport;

  try {
    if (ghostFn()) return;
    // Kill-switch (Settings → Cognition). Fail-safe ON: a settings read
    // error keeps the cadence running (current behavior unchanged).
    if (!enabledFn('consolidation')) return;
    if (!storage) return;
    const raw = storage.getItem(LAST_RUN_KEY);
    const lastRunMs = raw === null ? null : Number(raw);
    if (!shouldRunConsolidation(Number.isFinite(lastRunMs) ? lastRunMs : null, nowFn())) return;

    scheduleIdleWork(() => {
      void runFn()
        .then((report) => {
          storage.setItem(LAST_RUN_KEY, String(nowFn()));
          recordFn(report);
        })
        .catch(() => {
          // Never let a failed consolidation pass crash the cadence timer.
        });
    }, opts.idleOpts);
  } catch {
    // Never let the cadence timer crash the app.
  }
}

export function startConsolidationCadence(): void {
  setInterval(() => runConsolidationTick(), TICK_MS);
}
