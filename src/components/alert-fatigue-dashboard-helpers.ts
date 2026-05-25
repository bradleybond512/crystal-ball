/**
 * Pure helpers for AlertFatigueDashboardPanel.
 * Kept separate so tests can import without dragging in Panel + transitive DOM deps.
 */
import type { AlertRecord, FatigueRecommendation } from '@/services/intelligence/alert-fatigue-detector';

// ── Types ─────────────────────────────────────────────────────────────────

export type TrendDirection = 'up' | 'down' | 'flat';

export interface DomainEntry {
  domain: string;
  count: number;
  acked: number;
}

// ── Score formatting ──────────────────────────────────────────────────────

export function fatigueColor(score: number): string {
  if (score >= 0.8) return 'var(--severity-critical, #ef4444)';
  if (score >= 0.5) return 'var(--severity-high,     #fb923c)';
  if (score >= 0.3) return 'var(--severity-medium,   #facc15)';
  return 'var(--severity-low, #4caf50)';
}

export function fatiguePercent(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}

// ── Recommendation strings ────────────────────────────────────────────────

export function recommendationLabel(rec: FatigueRecommendation): string {
  const labels: Record<FatigueRecommendation, string> = {
    none:           'Normal',
    batch:          'Batch',
    'suppress-low': 'Suppress Low',
    'escalate-only':'Escalate Only',
  };
  return labels[rec] ?? rec;
}

export function recommendationDesc(rec: FatigueRecommendation): string {
  const desc: Record<FatigueRecommendation, string> = {
    none:           'All alerts are being delivered normally.',
    batch:          'Alerts are grouped into digest bundles to reduce interruptions.',
    'suppress-low': 'Low-severity alerts are suppressed; only medium and above are delivered.',
    'escalate-only':'Only critical-severity alerts are shown. Alert fatigue is at maximum.',
  };
  return desc[rec] ?? '';
}

export function recommendationIcon(rec: FatigueRecommendation): string {
  const icons: Record<FatigueRecommendation, string> = {
    none:           '✓',
    batch:          '⊞',
    'suppress-low': '⊘',
    'escalate-only':'⚠',
  };
  return icons[rec] ?? '?';
}

// ── Trend ─────────────────────────────────────────────────────────────────

export function trendDirection(currentRate: number, prevRate: number): TrendDirection {
  const delta = currentRate - prevRate;
  if (Math.abs(delta) < 0.01) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

export function trendArrow(dir: TrendDirection): string {
  const arrows: Record<TrendDirection, string> = { up: '▲', down: '▼', flat: '→' };
  return arrows[dir];
}

// ── Domain breakdown ──────────────────────────────────────────────────────

export function domainBreakdown(
  alerts: readonly AlertRecord[],
  windowMs: number,
  now: number,
): DomainEntry[] {
  const cutoff = now - windowMs;
  const counts = new Map<string, DomainEntry>();
  for (const a of alerts) {
    if (a.timestamp < cutoff) continue;
    const entry = counts.get(a.domain) ?? { domain: a.domain, count: 0, acked: 0 };
    entry.count++;
    if (a.acknowledged) entry.acked++;
    counts.set(a.domain, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

// ── Rate helpers ──────────────────────────────────────────────────────────

export function previousWindowRate(
  alerts: readonly AlertRecord[],
  windowMs: number,
  now: number,
): number {
  const cutoff = now - windowMs;
  const prevCutoff = cutoff - windowMs;
  const count = alerts.filter(a => a.timestamp >= prevCutoff && a.timestamp < cutoff).length;
  const windowMinutes = windowMs / 60_000;
  return windowMinutes > 0 ? count / windowMinutes : 0;
}

export function formatRate(rate: number): string {
  return rate < 0.1 ? '<0.1/min' : `${rate.toFixed(1)}/min`;
}

export function formatAckRate(ackRate: number): string {
  return `${Math.round(Math.max(0, Math.min(1, ackRate)) * 100)}%`;
}
