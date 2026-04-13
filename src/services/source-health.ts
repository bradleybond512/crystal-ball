/* eslint-disable sonarjs/void-use */
/**
 * Source health tracker — records per-source last-success and error rates
 * so the health dashboard can show "which feeds are dead" at a glance.
 *
 * Services call `recordFetch(name, ok)` after each fetch attempt. Kept in
 * memory (not persisted — rebuilds on restart).
 */

export interface SourceHealth {
  name: string;
  lastOk: number | null;
  lastErr: number | null;
  successCount: number;
  errorCount: number;
  status: 'ok' | 'degraded' | 'down' | 'unknown';
}

const health = new Map<string, Omit<SourceHealth, 'status'>>();

export function recordFetch(name: string, ok: boolean): void {
  const cur = health.get(name) ?? { name, lastOk: null, lastErr: null, successCount: 0, errorCount: 0 };
  if (ok) { cur.lastOk = Date.now(); cur.successCount += 1; }
  else { cur.lastErr = Date.now(); cur.errorCount += 1; }
  health.set(name, cur);
}

function statusOf(h: Omit<SourceHealth, 'status'>): SourceHealth['status'] {
  if (!h.lastOk && !h.lastErr) return 'unknown';
  const total = h.successCount + h.errorCount;
  if (total === 0) return 'unknown';
  const errRate = h.errorCount / total;
  const staleMs = h.lastOk ? Date.now() - h.lastOk : Number.POSITIVE_INFINITY;
  if (errRate >= 0.8 || staleMs > 60 * 60_000) return 'down';
  if (errRate >= 0.3 || staleMs > 30 * 60_000) return 'degraded';
  return 'ok';
}

export function getSourceHealth(): SourceHealth[] {
  return [...health.values()]
    .map(h => ({ ...h, status: statusOf(h) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
