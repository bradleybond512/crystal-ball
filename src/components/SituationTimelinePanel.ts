/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Situation Timeline Panel — Phase 4 chronological view.
 *
 * Filter bar (domain chips + status toggle + date range) drives a
 * sorted timeline list. Click any row to expand the peak-severity +
 * correlation details. Stats row at top summarises active count,
 * average duration, and the most-active domain.
 */

import { Panel } from './Panel';
import {
  getSituationTimelineService,
  type DomainBreakdownRow,
  type TimelineEntry,
  type TimelineFilter,
  type TimelineStats,
} from '@/services/intelligence/situation-timeline';
import type { SituationSeverity } from '@/services/intelligence/situation-store-v2';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const DOMAIN_CHIP_LIMIT = 8;

const SEVERITY_COLOR: Record<SituationSeverity, string> = {
  low: '#9e9e9e',
  medium: '#4a9eff',
  high: '#ffb74d',
  critical: '#f44336',
};

const STATUS_COLOR: Record<TimelineEntry['status'], string> = {
  active: '#f44336',
  resolved: '#4caf50',
};

interface PanelState {
  filter: TimelineFilter;
  expandedId: string | null;
}

export class SituationTimelinePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private state: PanelState = {
    filter: { status: 'all' },
    expandedId: null,
  };

  constructor() {
    super({
      id: 'situation-timeline',
      title: 'Situation Timeline',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Phase 4 chronological view of all Situations. Filter by domain / status / date / minimum severity; click any row to expand peak-severity and correlation detail. Stats row reflects the full cache, not the filtered slice.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
    this.unsub = getSituationTimelineService().subscribe(() => this.render());
  }

  public dispose(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private render(): void {
    const svc = getSituationTimelineService();
    const entries = svc.buildTimeline(this.state.filter);
    const stats = svc.getStats();
    const breakdown = svc.getDomainBreakdown();
    this.setCount(stats.activeCount);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      ${renderStatsRow(stats)}
      ${this.renderFilterBar(breakdown)}
      ${renderTimeline(entries, this.state.expandedId)}
    </div>`;
    this.setContent(html);
    this.wireHandlers();
  }

  private renderFilterBar(breakdown: readonly DomainBreakdownRow[]): string {
    const domainChips = breakdown.slice(0, DOMAIN_CHIP_LIMIT).map((row) => {
      const active = this.state.filter.domain === row.domain;
      const bg = active ? 'var(--accent,#4a9eff)26' : 'transparent';
      const border = active ? 'var(--accent,#4a9eff)' : 'var(--border-subtle,#333)';
      return `<button data-timeline-domain="${escapeHtml(row.domain)}" style="font-size:11px;padding:3px 8px;border:1px solid ${border};border-radius:12px;background:${bg};color:inherit;cursor:pointer;">${escapeHtml(row.domain)} ${row.count}</button>`;
    }).join('');
    const allChip = `<button data-timeline-domain="" style="font-size:11px;padding:3px 8px;border:1px solid ${this.state.filter.domain ? 'var(--border-subtle,#333)' : 'var(--accent,#4a9eff)'};border-radius:12px;background:${this.state.filter.domain ? 'transparent' : 'var(--accent,#4a9eff)26'};color:inherit;cursor:pointer;">All</button>`;
    const status = this.state.filter.status ?? 'all';
    const statusToggles = (['active', 'resolved', 'all'] as const).map((s) => {
      const active = status === s;
      const bg = active ? 'var(--accent,#4a9eff)26' : 'transparent';
      const border = active ? 'var(--accent,#4a9eff)' : 'var(--border-subtle,#333)';
      return `<button data-timeline-status="${s}" style="font-size:11px;padding:3px 8px;border:1px solid ${border};border-radius:3px;background:${bg};color:inherit;cursor:pointer;">${s}</button>`;
    }).join('');
    const fromValue = this.state.filter.fromDate ? new Date(this.state.filter.fromDate).toISOString().slice(0, 10) : '';
    const toValue = this.state.filter.toDate ? new Date(this.state.filter.toDate).toISOString().slice(0, 10) : '';
    return `<div style="display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Domain</span>
        ${allChip}
        ${domainChips}
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Status</span>
        ${statusToggles}
        <span style="font-size:11px;color:var(--text-secondary,#aaa);margin-left:12px;">From</span>
        <input id="timelineFromDate" type="date" value="${escapeHtml(fromValue)}" style="font-size:11px;padding:2px 4px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;">
        <span style="font-size:11px;color:var(--text-secondary,#aaa);">To</span>
        <input id="timelineToDate" type="date" value="${escapeHtml(toValue)}" style="font-size:11px;padding:2px 4px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;">
        <button id="timelineClear" style="font-size:11px;padding:2px 8px;background:transparent;color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Clear</button>
      </div>
    </div>`;
  }

  private wireHandlers(): void {
    setTimeout(() => {
      const root = this.content;
      root.querySelectorAll<HTMLButtonElement>('[data-timeline-domain]').forEach((el) => {
        el.addEventListener('click', () => {
          const v = el.dataset.timelineDomain ?? '';
          this.state.filter.domain = v === '' ? undefined : v;
          this.render();
        });
      });
      root.querySelectorAll<HTMLButtonElement>('[data-timeline-status]').forEach((el) => {
        el.addEventListener('click', () => {
          const v = el.dataset.timelineStatus as 'active' | 'resolved' | 'all' | undefined;
          this.state.filter.status = v ?? 'all';
          this.render();
        });
      });
      const fromInput = root.querySelector<HTMLInputElement>('#timelineFromDate');
      fromInput?.addEventListener('change', () => {
        this.state.filter.fromDate = parseDate(fromInput.value);
        this.render();
      });
      const toInput = root.querySelector<HTMLInputElement>('#timelineToDate');
      toInput?.addEventListener('change', () => {
        this.state.filter.toDate = parseDate(toInput.value);
        this.render();
      });
      root.querySelector<HTMLButtonElement>('#timelineClear')?.addEventListener('click', () => {
        this.state.filter = { status: 'all' };
        this.render();
      });
      root.querySelectorAll<HTMLElement>('[data-timeline-row]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.dataset.timelineRow;
          if (!id) return;
          this.state.expandedId = this.state.expandedId === id ? null : id;
          this.render();
        });
      });
    }, 0);
  }
}

function parseDate(value: string): number | undefined {
  if (!value) return undefined;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : undefined;
}

function renderStatsRow(stats: TimelineStats): string {
  const longest = stats.longestActiveSituation;
  const longestText = longest
    ? `${escapeHtml(longest.title)} (${formatHours(longest.duration ?? 0)})`
    : '—';
  return `<div style="display:flex;gap:18px;font-size:12px;font-family:ui-monospace,monospace;flex-wrap:wrap;">
    <span><strong>${stats.totalSituations}</strong> total</span>
    <span><strong style="color:#f44336;">${stats.activeCount}</strong> active</span>
    <span>avg <strong>${stats.avgDurationHours.toFixed(1)} h</strong></span>
    <span>most active: <strong>${escapeHtml(stats.mostActiveDomain ?? '—')}</strong></span>
    <span style="color:var(--text-secondary,#aaa);">longest active: ${longestText}</span>
  </div>`;
}

function renderTimeline(entries: readonly TimelineEntry[], expandedId: string | null): string {
  if (entries.length === 0) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No situations match the current filter.</div>`;
  }
  const items = entries.map((e) => renderRow(e, e.situationId === expandedId)).join('');
  return `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;">${items}</ul>`;
}

function renderRow(e: TimelineEntry, expanded: boolean): string {
  const sevColor = SEVERITY_COLOR[e.currentSeverity];
  const statusColor = STATUS_COLOR[e.status];
  const arrow = expanded ? '▾' : '▸';
  const durText = formatDurationText(e);
  const startRel = formatAgo(Date.now() - e.startedAt);
  return `<li data-timeline-row="${escapeHtml(e.situationId)}" style="cursor:pointer;border:1px solid var(--border-subtle,#333);border-left:3px solid ${sevColor};border-radius:3px;background:var(--surface-2,#1a1a1a);padding:6px 10px;display:flex;flex-direction:column;gap:4px;">
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
      <span style="color:var(--text-secondary,#aaa);width:12px;">${arrow}</span>
      <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${statusColor}26;color:${statusColor};text-transform:uppercase;letter-spacing:0.04em;">${e.status}</span>
      <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:var(--surface-3,#222);color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">${escapeHtml(e.domain)}</span>
      <span style="font-weight:600;flex:1;">${escapeHtml(e.title)}</span>
      <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${sevColor}26;color:${sevColor};text-transform:uppercase;">${escapeHtml(e.currentSeverity)}</span>
      <span style="font-size:11px;color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">${escapeHtml(startRel)} · ${escapeHtml(durText)}</span>
    </div>
    ${expanded ? renderExpansion(e) : ''}
  </li>`;
}

function renderExpansion(e: TimelineEntry): string {
  const peakColor = SEVERITY_COLOR[e.peakSeverity];
  const peakLabel = e.peakAt === null
    ? `${e.peakSeverity} (current)`
    : `${e.peakSeverity} at ${new Date(e.peakAt).toISOString().slice(0, 16)}Z`;
  const resolvedText = e.resolvedAt === null
    ? 'ongoing'
    : `resolved ${new Date(e.resolvedAt).toISOString().slice(0, 16)}Z`;
  return `<div style="display:flex;flex-direction:column;gap:4px;padding-top:4px;border-top:1px solid var(--border-subtle,#333);font-size:11px;">
    <div>peak <span style="color:${peakColor};font-weight:600;">${escapeHtml(peakLabel)}</span></div>
    <div style="color:var(--text-secondary,#aaa);">started ${new Date(e.startedAt).toISOString().slice(0, 16)}Z · ${escapeHtml(resolvedText)}</div>
    <div style="color:var(--text-secondary,#aaa);">${e.correlationCount} correlation edge${e.correlationCount === 1 ? '' : 's'}</div>
  </div>`;
}

function formatDurationText(e: TimelineEntry): string {
  if (e.duration === null) return '—';
  if (e.status === 'active') return `${formatHours(e.duration)} so far`;
  return formatHours(e.duration);
}

function formatHours(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.round(ms / 60_000)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatAgo(ms: number): string {
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
