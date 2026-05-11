/**
 * Pure helpers for WeatherHazardPanel — extracted so node:test can
 * import them without pulling in the DOM/Vite-coupled Panel base.
 */

import type { NwsHazardAlert } from '@/services/weather/nws-hazards';

export function groupAlertsByCategory(alerts: readonly NwsHazardAlert[]): Record<string, NwsHazardAlert[]> {
  const out: Record<string, NwsHazardAlert[]> = {};
  for (const a of alerts) {
    const list = out[a.category] ?? [];
    list.push(a);
    out[a.category] = list;
  }
  return out;
}

/** Render an "Expires in N {h,m}" or absolute timestamp when far. */
export function formatRelativeExpires(iso: string, now: number = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diffMs = t - now;
  if (diffMs < 0) return 'expired';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}
