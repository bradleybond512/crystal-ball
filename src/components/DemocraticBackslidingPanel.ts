import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  regimeClass,
  trendClass,
  trendArrow,
  rankByScore,
  type CountryDemocracy,
  type BackslidingEvent,
  type DemocracyData,
} from './democratic-backsliding-helpers';

const REFRESH_MS = 60 * 60 * 1000;

function scoreColor(score: number): string {
  if (score < 0.3) return '#ff453a';
  if (score < 0.5) return '#ff9800';
  if (score < 0.7) return '#ffeb3b';
  return '#4caf50';
}

function deltaColor(delta: number): string {
  return delta < 0 ? 'var(--sev-high,#ff453a)' : 'var(--sev-ok,#4caf50)';
}

export class DemocraticBackslidingPanel extends Panel {
  static readonly panelId = 'democratic-backsliding';
  static readonly panelTitle = 'Democratic Backsliding';

  private data: DemocracyData | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: DemocraticBackslidingPanel.panelId,
      title: DemocraticBackslidingPanel.panelTitle,
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks democratic backsliding across 15 countries using V-Dem-inspired scores. Shows regime classification, 3-year trend deltas, key erosion events, and recent backsliding incidents.',
    });
    this.start();
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private start(): void {
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  private refresh(): void {
    try {
      this.data = buildRenderData();
    } catch {
      this.data = null;
    }
    this.render();
  }

  private render(): void {
    if (!this.data) {
      this.setContent('<div style="padding:12px;color:var(--text-secondary,#aaa);font-size:12px;">Data unavailable</div>');
      return;
    }
    const erodingCount = this.data.erodingCount;
    this.setCount(erodingCount);
    this.setContent(this.buildHtml(this.data));
  }

  private buildHtml(data: DemocracyData): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${this.renderSummaryBar(data)}
      ${this.renderCountries(data.countries)}
      ${this.renderEvents(data.events)}
    </div>`;
  }

  private renderSummaryBar(data: DemocracyData): string {
    const idxColor = scoreColor(data.globalDemocracyIndex / 100);
    return `<div style="display:flex;flex-wrap:wrap;gap:8px;padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;">
      <div style="display:flex;flex-direction:column;align-items:center;min-width:70px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Democracy Index</span>
        <span style="font-size:14px;font-weight:700;color:${idxColor};">${data.globalDemocracyIndex}/100</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;min-width:60px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Liberal Dem</span>
        <span style="font-size:14px;font-weight:700;color:#4caf50;">${data.liberalCount}</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;min-width:60px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Electoral Dem</span>
        <span style="font-size:14px;font-weight:700;color:#ffeb3b;">${data.electoralDemCount}</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;min-width:60px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Autocracy</span>
        <span style="font-size:14px;font-weight:700;color:#ff9800;">${data.electoralAutocCount + data.closedAutocCount}</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;min-width:60px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Eroding</span>
        <span style="font-size:14px;font-weight:700;color:#ff453a;">${data.erodingCount}</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;min-width:80px;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Pop. Under Autoc.</span>
        <span style="font-size:14px;font-weight:700;color:#ff453a;">${data.populationUnderAutocracy}M</span>
      </div>
    </div>`;
  }

  private renderCountries(countries: CountryDemocracy[]): string {
    const rows = rankByScore(countries).map((c) => this.renderCountryRow(c)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Countries (sorted by score, worst first)</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderCountryRow(c: CountryDemocracy): string {
    const rClass = regimeClass(c.regime);
    const tClass = trendClass(c.trend);
    const arrow = trendArrow(c.trend);
    const scoreVal = Math.round(c.vdemScore * 100);
    const color = scoreColor(c.vdemScore);
    const dColor = deltaColor(c.trendDeltaYr);
    const deltaStr = `${c.trendDeltaYr >= 0 ? '+' : ''}${(c.trendDeltaYr * 100).toFixed(1)}pts/3yr`;
    let borderColor = '#ff453a';
    if (rClass === 'regime-liberal') borderColor = '#4caf50';
    else if (rClass === 'regime-electoral') borderColor = '#ffeb3b';
    else if (rClass === 'regime-autoc') borderColor = '#ff9800';
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${borderColor};border-radius:3px;padding:6px 8px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">
        <span style="font-weight:600;">${escapeHtml(c.country)}</span>
        <span style="font-size:10px;font-weight:700;color:${borderColor};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(c.regime)}</span>
        <span class="${tClass}" style="font-size:13px;">${escapeHtml(arrow)}</span>
        <span style="font-family:ui-monospace,monospace;font-weight:700;color:${color};">${scoreVal}/100</span>
        <span style="font-size:10px;color:${dColor};">${escapeHtml(deltaStr)}</span>
      </div>
      <div style="margin-top:3px;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(c.keyErosionEvent)}</div>
    </div>`;
  }

  private renderEvents(events: BackslidingEvent[]): string {
    if (events.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Backsliding Events</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No events recorded.</div>
      </div>`;
    }
    const sorted = [...events].sort((a, b) => b.severity - a.severity);
    const rows = sorted.map((ev) => this.renderEventRow(ev)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Backsliding Events (${events.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderEventRow(ev: BackslidingEvent): string {
    let sevColor = '#ffeb3b';
    if (ev.severity >= 8) sevColor = '#ff453a';
    else if (ev.severity >= 5) sevColor = '#ff9800';
    const ongoingBadge = ev.ongoing
      ? `<span style="font-size:9px;font-weight:700;color:#ff453a;border:1px solid #ff453a;border-radius:3px;padding:0 4px;margin-left:6px;">ONGOING</span>`
      : '';
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${sevColor};border-radius:3px;padding:6px 8px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:4px;">
        <div style="font-weight:600;">${escapeHtml(ev.country)} · <span style="font-weight:400;">${escapeHtml(ev.category)}</span>${ongoingBadge}</div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(ev.date)}</span>
          <span style="font-weight:700;color:${sevColor};font-family:ui-monospace,monospace;">${ev.severity}/10</span>
        </div>
      </div>
      <div style="margin-top:3px;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(ev.description)}</div>
    </div>`;
  }
}
