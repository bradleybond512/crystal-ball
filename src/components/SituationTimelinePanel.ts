/**
 * Situation Timeline Panel — Phase 4 chronological view.
 *
 * Filter bar (domain chips + status toggle + quick-range chips + date
 * pickers) drives a sorted timeline list. Click any row to expand the
 * peak-severity + correlation details. Stats row at top summarises
 * active count, average duration, and the most-active domain.
 */

import { Panel } from './Panel';
import {
  getSituationTimelineService,
  type DomainBreakdownRow,
  type TimelineFilter,
} from '@/services/intelligence/situation-timeline';
import { escapeHtml } from '@/utils/sanitize';
import {
  QUICK_RANGES,
  isQuickRangeActive,
  parseDate,
  renderStatsRow,
  renderTimeline,
} from './situation-timeline-render';

const REFRESH_MS = 30_000;
const DOMAIN_CHIP_LIMIT = 8;

// Re-export the pure helpers so call sites + tests can keep importing
// from the panel module path.
export {
  QUICK_RANGES,
  isQuickRangeActive,
  parseDate,
  renderStatsRow,
  renderTimeline,
} from './situation-timeline-render';

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
        'Phase 4 chronological view of all Situations. Filter by domain / status / quick-range / date / minimum severity; click any row to expand peak-severity and correlation detail. Stats row reflects the full cache, not the filtered slice.',
    });
    this.start();
  }

  private start(): void {
    const svc = getSituationTimelineService();
    svc.buildTimeline();                 // populate the cache once for first paint
    this.render();
    // Periodic full rebuild keeps "active for Xm" durations fresh (its notify
    // repaints via the subscription below). render() itself only READS the
    // cache — calling buildTimeline in render re-entered the build on every
    // store notify (the settle-tail storm).
    this.refreshTimer = setInterval(() => svc.buildTimeline(), REFRESH_MS);
    this.unsub = svc.subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
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
    const entries = svc.getFiltered(this.state.filter);
    const stats = svc.getStats();
    const breakdown = svc.getDomainBreakdown();
    this.setCount(stats.activeCount);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      ${renderStatsRow(stats)}
      ${this.renderFilterBar(breakdown)}
      ${renderTimeline(entries, this.state.expandedId)}
    </div>`;
    this.setContent(html, () => this.wireHandlers());
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
    const quickChips = QUICK_RANGES.map((r) => {
      const active = isQuickRangeActive(this.state.filter, r.windowMs, Date.now());
      const bg = active ? 'var(--accent,#4a9eff)26' : 'transparent';
      const border = active ? 'var(--accent,#4a9eff)' : 'var(--border-subtle,#333)';
      return `<button data-timeline-quick="${r.windowMs}" style="font-size:11px;padding:3px 8px;border:1px solid ${border};border-radius:3px;background:${bg};color:inherit;cursor:pointer;">${r.label}</button>`;
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
        <span style="font-size:11px;color:var(--text-secondary,#aaa);margin-left:12px;text-transform:uppercase;letter-spacing:0.05em;">Range</span>
        ${quickChips}
        <span style="font-size:11px;color:var(--text-secondary,#aaa);margin-left:8px;">From</span>
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
      root.querySelectorAll<HTMLButtonElement>('[data-timeline-quick]').forEach((el) => {
        el.addEventListener('click', () => {
          const windowMs = Number.parseInt(el.dataset.timelineQuick ?? '', 10);
          if (!Number.isFinite(windowMs) || windowMs <= 0) return;
          this.state.filter.fromDate = Date.now() - windowMs;
          this.state.filter.toDate = undefined;
          this.render();
        });
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
