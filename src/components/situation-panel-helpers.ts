/**
 * Pure helpers for SituationPanel. Extracted so tests can import without
 * dragging in i18n (Vite's import.meta.glob).
 */

import type { Situation, SituationSeverity } from '@/types/intelligence';

export const SEVERITY_BADGE: Record<SituationSeverity, { color: string; label: string }> = {
  critical: { color: '#ff453a', label: 'CRITICAL' },
  high:     { color: '#ff5722', label: 'HIGH' },
  moderate: { color: '#ff9800', label: 'MODERATE' },
  low:      { color: '#ffeb3b', label: 'LOW' },
  info:     { color: '#9e9e9e', label: 'INFO' },
};

const SEVERITY_RANK: Record<SituationSeverity, number> = {
  critical: 4, high: 3, moderate: 2, low: 1, info: 0,
};

/** Sort situations by severity desc, then updatedAt desc. */
export function sortSituations(situations: Situation[]): Situation[] {
  return [...situations].sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity];
    const sb = SEVERITY_RANK[b.severity];
    if (sa !== sb) return sb - sa;
    return b.updatedAt - a.updatedAt;
  });
}

export function formatStarted(ms: number, now = Date.now()): string {
  const ageMs = now - ms;
  if (ageMs < 0) return 'just now';
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s ago`;
  if (ageMs < 60 * 60 * 1000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 24 * 60 * 60 * 1000) return `${Math.floor(ageMs / (60 * 60 * 1000))}h ago`;
  return `${Math.floor(ageMs / (24 * 60 * 60 * 1000))}d ago`;
}

/** Render a compact "linked event count" string for the row meta line. */
export function linkedCountLabel(s: Situation): string {
  const obs = s.observationIds.length;
  const cor = s.correlationIds.length;
  if (obs === 0 && cor === 0) return 'no linked events';
  const parts: string[] = [];
  if (obs > 0) parts.push(`${obs} observation${obs === 1 ? '' : 's'}`);
  if (cor > 0) parts.push(`${cor} correlation${cor === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
