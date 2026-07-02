import { runConsolidation } from './consolidation';
import { isGhostMode } from '@/services/mode-manager';

export const CONSOLIDATION_INTERVAL_MS = 6 * 60 * 60 * 1000;

const LAST_RUN_KEY = 'cb:consolidation-last';
const TICK_MS = 30 * 60 * 1000;

export function shouldRunConsolidation(lastRunMs: number | null, nowMs: number): boolean {
  if (lastRunMs === null) return true;
  return nowMs - lastRunMs >= CONSOLIDATION_INTERVAL_MS;
}

export function startConsolidationCadence(): void {
  setInterval(() => {
    try {
      if (isGhostMode()) return;
      const raw = localStorage.getItem(LAST_RUN_KEY);
      const lastRunMs = raw === null ? null : Number(raw);
      if (!shouldRunConsolidation(Number.isFinite(lastRunMs) ? lastRunMs : null, Date.now())) return;
      void runConsolidation()
        .then(() => localStorage.setItem(LAST_RUN_KEY, String(Date.now())))
        .catch(() => {
          // Never let a failed consolidation pass crash the cadence timer.
        });
    } catch {
      // Never let the cadence timer crash the app.
    }
  }, TICK_MS);
}
