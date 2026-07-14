/**
 * Pure render helpers + format utilities for SituationTimelinePanel.
 *
 * Isolated from the Panel base class so unit tests can exercise the
 * HTML/string contract without pulling in DOM, i18n, or Vite-only
 * imports.
 */

import type { SituationSeverity } from '@/services/intelligence/situation-store-v2';
import type { TimelineEntry, TimelineFilter, TimelineStats } from '@/services/intelligence/situation-timeline';
import { escapeHtml } from '@/utils/sanitize';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export const SEVERITY_COLOR: Record<SituationSeverity, string> = {
  low: '#9e9e9e',
  medium: '#4a9eff',
  high: '#ffb74d',
  critical: '#ff453a',
};

export const STATUS_COLOR: Record<TimelineEntry['status'], string> = {
  active: '#ff453a',
  resolved: '#4caf50',
};

export interface QuickRange {
  label: string;
  windowMs: number;
}

export const QUICK_RANGES: readonly QuickRange[] = [
  { label: '1h', windowMs: HOUR_MS },
  { label: '6h', windowMs: 6 * HOUR_MS },
  { label: '24h', windowMs: DAY_MS },
  { label: '7d', windowMs: 7 * DAY_MS },
];

export function isQuickRangeActive(filter: TimelineFilter, windowMs: number, now: number): boolean {
  if (filter.fromDate === undefined) return false;
  const expected = now - windowMs;
  return Math.abs(filter.fromDate - expected) <= 60_000;
}

export function parseDate(value: string): number | undefined {
  if (!value) return undefined;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : undefined;
}

export function renderStatsRow(stats: TimelineStats): string {
  const longest = stats.longestActiveSituation;
  const longestText = longest
    ? `${escapeHtml(longest.title)} (${formatHours(longest.duration ?? 0)})`
    : '—';
  return `<div style="display:flex;gap:18px;font-size:12px;font-family:ui-monospace,monospace;flex-wrap:wrap;">
    <span><strong>${stats.totalSituations}</strong> total</span>
    <span><strong style="color:#ff453a;">${stats.activeCount}</strong> active</span>
    <span>avg <strong>${stats.avgDurationHours.toFixed(1)} h</strong></span>
    <span>most active: <strong>${escapeHtml(stats.mostActiveDomain ?? '—')}</strong></span>
    <span style="color:var(--text-secondary,#aaa);">longest active: ${longestText}</span>
  </div>`;
}

export function renderTimeline(entries: readonly TimelineEntry[], expandedId: string | null): string {
  if (entries.length === 0) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No situations match the current filter.</div>`;
  }
  const items = entries.map((e) => renderRow(e, e.situationId === expandedId)).join('');
  return `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;">${items}</ul>`;
}

export function renderRow(e: TimelineEntry, expanded: boolean): string {
  const sevColor = SEVERITY_COLOR[e.currentSeverity];
  const statusColor = STATUS_COLOR[e.status];
  const arrow = expanded ? '▾' : '▸';
  const durText = formatDurationText(e);
  const startRel = formatAgo(Date.now() - e.startedAt);
  return `<li data-timeline-row="${escapeHtml(e.situationId)}" style="cursor:pointer;border:1px solid var(--border-subtle,#333);border-left:3px solid ${sevColor};border-radius:3px;background:var(--surface-2,#1a1a1a);padding:6px 10px;display:flex;flex-direction:column;gap:4px;">`
    + `<div style="display:flex;align-items:center;gap:8px;font-size:12px;">`
    + `<span style="color:var(--text-secondary,#aaa);width:12px;">${arrow}</span>`
    + `<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${statusColor}26;color:${statusColor};text-transform:uppercase;letter-spacing:0.04em;">${e.status}</span>`
    + `<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:var(--surface-3,#222);color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">${escapeHtml(e.domain)}</span>`
    + `<span style="font-weight:600;flex:1;">${escapeHtml(e.title)}</span>`
    + `<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${sevColor}26;color:${sevColor};text-transform:uppercase;">${escapeHtml(e.currentSeverity)}</span>`
    + `<span style="font-size:11px;color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">${escapeHtml(startRel)} · ${escapeHtml(durText)}</span>`
    + `</div>`
    + `${expanded ? renderExpansion(e) : ''}`
    + `</li>`;
}

export function renderExpansion(e: TimelineEntry): string {
  const peakColor = SEVERITY_COLOR[e.peakSeverity];
  const peakLabel = e.peakAt === null
    ? `${e.peakSeverity} (current)`
    : `${e.peakSeverity} at ${new Date(e.peakAt).toISOString().slice(0, 16)}Z`;
  const resolvedText = e.resolvedAt === null
    ? 'ongoing'
    : `resolved ${new Date(e.resolvedAt).toISOString().slice(0, 16)}Z`;
  return `<div style="display:flex;flex-direction:column;gap:4px;padding-top:4px;border-top:1px solid var(--border-subtle,#333);font-size:11px;">`
    + `<div>peak <span style="color:${peakColor};font-weight:600;">${escapeHtml(peakLabel)}</span></div>`
    + `<div style="color:var(--text-secondary,#aaa);">started ${new Date(e.startedAt).toISOString().slice(0, 16)}Z · ${escapeHtml(resolvedText)}</div>`
    + `<div style="color:var(--text-secondary,#aaa);">${e.correlationCount} correlation edge${e.correlationCount === 1 ? '' : 's'}</div>`
    + `</div>`;
}

export function formatDurationText(e: TimelineEntry): string {
  if (e.duration === null) return '—';
  if (e.status === 'active') return `${formatHours(e.duration)} so far`;
  return formatHours(e.duration);
}

export function formatHours(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.round(ms / 60_000)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export function formatAgo(ms: number): string {
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
