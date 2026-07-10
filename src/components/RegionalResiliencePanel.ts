/**
 * Regional Resilience Panel (panel id: `regional-resilience`).
 *
 * World-region leaderboard table: score, label badge, trend arrow,
 * event count, avg recovery, worst domain. Filter chips for the 5
 * resilience bands. Most-fragile rows highlighted in red/amber.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getRegionalResilienceIndex,
  type RegionalScore,
  type ResilienceLabel,
  type ResilienceTrend,
} from '@/services/intelligence/regional-resilience';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 60_000;

const LABEL_COLOR: Record<ResilienceLabel, string> = {
  fragile: '#e94f37',
  vulnerable: '#f5a524',
  moderate: '#9ca3af',
  resilient: '#4a9eff',
  robust: '#2ec27e',
};

const TREND_ICON: Record<ResilienceTrend, string> = {
  improving: '↑',
  stable: '→',
  degrading: '↓',
};
const TREND_COLOR: Record<ResilienceTrend, string> = {
  improving: '#2ec27e',
  stable: '#9ca3af',
  degrading: '#e94f37',
};

type Filter = 'all' | ResilienceLabel;

export class RegionalResiliencePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listener: ((scores: RegionalScore[]) => void) | null = null;
  private filter: Filter = 'all';

  constructor() {
    super({
      id: 'regional-resilience',
      title: 'Regional Resilience',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Per-region resilience scoring across 15 world regions. Scores adjust based on recovery speed, event frequency, and trend over time.',
    });
    const svc = getRegionalResilienceIndex();
    this.listener = () => this.render();
    svc.subscribe(this.listener);
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.listener) {
      getRegionalResilienceIndex().unsubscribe(this.listener);
      this.listener = null;
    }
    super.destroy();
  }

  private render(): void {
    const svc = getRegionalResilienceIndex();
    const all = svc.getAllScores();
    this.setCount(all.length);
    this.setContent(this.buildHtml(all), () => this.wireHandlers());
  }

  private buildHtml(all: RegionalScore[]): string {
    const filtered = this.filter === 'all'
      ? all
      : all.filter((s) => s.label === this.filter);
    const sorted = [...filtered].sort((a, b) => b.score - a.score);

    return `<div class="rr-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderFilters(all)}
      ${this.renderTable(sorted)}
    </div>`;
  }

  private renderFilters(all: RegionalScore[]): string {
    const counts: Record<Filter, number> = {
      all: all.length,
      fragile: all.filter((s) => s.label === 'fragile').length,
      vulnerable: all.filter((s) => s.label === 'vulnerable').length,
      moderate: all.filter((s) => s.label === 'moderate').length,
      resilient: all.filter((s) => s.label === 'resilient').length,
      robust: all.filter((s) => s.label === 'robust').length,
    };
    const chips: Filter[] = ['all', 'fragile', 'vulnerable', 'moderate', 'resilient', 'robust'];
    return `<div style="display:flex;gap:4px;flex-wrap:wrap;">${chips.map((c) => this.renderChip(c, counts[c])).join('')}</div>`;
  }

  private renderChip(filter: Filter, count: number): string {
    const isActive = this.filter === filter;
    const bg = isActive ? 'rgba(74,158,255,0.18)' : 'transparent';
    const borderAlpha = isActive ? '0.4' : '0.15';
    const label = filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1);
    return `<button class="rr-chip" data-filter="${filter}" type="button"
      style="padding:3px 10px;background:${bg};color:inherit;border:1px solid rgba(74,158,255,${borderAlpha});border-radius:14px;cursor:pointer;font-size:11px;">${escapeHtml(label)} (${count})</button>`;
  }

  private renderTable(sorted: RegionalScore[]): string {
    if (sorted.length === 0) {
      return `<div style="padding:14px;text-align:center;opacity:0.55;font-size:12px;">No regions match the current filter.</div>`;
    }
    const rows = sorted.map((s) => this.renderRow(s)).join('');
    return `<div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:11px;color:#bbb;">
        <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.12);">
          <th style="text-align:left;padding:5px 6px;">Region</th>
          <th style="text-align:right;padding:5px 6px;">Score</th>
          <th style="text-align:left;padding:5px 6px;">Label</th>
          <th style="text-align:left;padding:5px 6px;">Trend</th>
          <th style="text-align:right;padding:5px 6px;">Events</th>
          <th style="text-align:right;padding:5px 6px;">Avg recovery</th>
          <th style="text-align:left;padding:5px 6px;">Worst domain</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  private renderRow(s: RegionalScore): string {
    const labelColor = LABEL_COLOR[s.label];
    const trendIcon = TREND_ICON[s.trend];
    const trendColor = TREND_COLOR[s.trend];
    const tint = (s.label === 'fragile' || s.label === 'vulnerable')
      ? 'background:rgba(233,79,55,0.05);' : '';
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);${tint}">
      <td style="padding:5px 6px;color:#ddd;">${escapeHtml(s.region)}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,monospace;color:#ddd;">${s.score.toFixed(0)}</td>
      <td style="padding:5px 6px;">
        <span style="background:${labelColor};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${s.label}</span>
      </td>
      <td style="padding:5px 6px;color:${trendColor};font-size:13px;">${trendIcon}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,monospace;">${s.eventCount}</td>
      <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,monospace;">${s.avgRecoveryDays > 0 ? `${s.avgRecoveryDays.toFixed(1)}d` : '—'}</td>
      <td style="padding:5px 6px;color:#bbb;">${escapeHtml(s.worstDomain ?? '—')}</td>
    </tr>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.rr-chip')) {
      btn.addEventListener('click', () => {
        const f = btn.dataset.filter;
        if (f === 'all' || f === 'fragile' || f === 'vulnerable' || f === 'moderate' || f === 'resilient' || f === 'robust') {
          this.filter = f;
          this.render();
        }
      });
    }
  }
}
