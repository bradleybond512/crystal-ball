/**
 * PoliticalViolencePanel — ACLED-inspired global political violence tracker.
 *
 * Displays: Global Violence Index header — Hotspot table sorted by monthly
 * events — Recent event log sorted by significance. Clicking a hotspot row
 * expands an inline drill-down with description and trend data.
 *
 * Data: static fixtures from political-violence-helpers. Designed to accept
 * live ACLED API data via setHotspots() / setEvents() for future integration.
 *
 * Refresh: every 30 minutes.
 */
import { Panel } from './Panel';
import {
  buildRenderData,
  getEscalating,
  getHighImpact,
  civilianImpactClass,
  eventTypeClass,
  HOTSPOTS,
  EVENTS,
  type ViolenceHotspot,
  type ViolenceEvent,
  type PoliticalViolenceData,
} from './political-violence-helpers';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30 * 60 * 1000;

const TREND_COLOR: Record<string, string> = {
  escalating: '#ef4444',
  stable: '#fb923c',
  declining: '#4ade80',
};

const IMPACT_COLOR: Record<string, string> = {
  Low: '#4ade80',
  Medium: '#facc15',
  High: '#fb923c',
  Extreme: '#ef4444',
};

const EVENT_COLOR: Record<string, string> = {
  Battles: '#ef4444',
  Explosions: '#f97316',
  'Violence Against Civilians': '#dc2626',
  Riots: '#facc15',
  'Strategic Developments': '#60a5fa',
};

function violenceIndexColor(index: number): string {
  if (index >= 80) return '#ef4444';
  if (index >= 60) return '#f97316';
  if (index >= 40) return '#facc15';
  return '#4ade80';
}

function trendSymbol(trend: ViolenceHotspot['trend']): string {
  if (trend === 'escalating') return '↑';
  if (trend === 'declining') return '↓';
  return '→';
}

export class PoliticalViolencePanel extends Panel {
  private hotspots: ViolenceHotspot[] = HOTSPOTS;
  private events: ViolenceEvent[] = EVENTS;
  private expandedHotspotId: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'political-violence',
      title: 'Political Violence',
      showCount: true,
      infoTooltip:
        'ACLED-inspired tracker of global political violence: battles, explosions, ' +
        'riots, remote violence, and strategic developments. Covers 10 active hotspots ' +
        'with monthly event volumes, civilian impact ratings, and recent significant events.',
    });
    this.render();
    this.startRefresh();
  }

  public setHotspots(hotspots: ViolenceHotspot[]): void {
    this.hotspots = hotspots;
    this.render();
  }

  public setEvents(events: ViolenceEvent[]): void {
    this.events = events;
    this.render();
  }

  private startRefresh(): void {
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    const data = buildRenderData(this.hotspots, this.events);
    this.setCount(data.hotspots.length);

    const sortedHotspots = [...data.hotspots].sort(
      (a, b) => b.monthlyEvents - a.monthlyEvents,
    );
    const sortedEvents = [...data.events].sort(
      (a, b) => b.significance - a.significance,
    );

    const html = `
      <div class="pv-panel">
        ${this.renderHeader(data)}
        <div class="pv-section-title" style="
          font-size:var(--text-xs); font-weight:700; color:#888;
          text-transform:uppercase; letter-spacing:0.05em;
          margin:12px 0 6px;
        ">Active Hotspots</div>
        <div class="pv-hotspot-list" role="list">
          ${sortedHotspots.map(h => this.renderHotspotRow(h)).join('')}
        </div>
        <div class="pv-section-title" style="
          font-size:var(--text-xs); font-weight:700; color:#888;
          text-transform:uppercase; letter-spacing:0.05em;
          margin:12px 0 6px;
        ">Significant Events (2024)</div>
        <div class="pv-event-list">
          ${sortedEvents.map(e => this.renderEventRow(e)).join('')}
        </div>
      </div>
    `;
    this.setContent(html);
    this.markFresh();
    this.bindHotspotClicks();
  }

  private renderHeader(data: PoliticalViolenceData): string {
    const viColor = violenceIndexColor(data.globalViolenceIndex);
    const escalatingCount = getEscalating(data.hotspots).length;
    const extremeCount = getHighImpact(data.hotspots, 'Extreme').length;

    return `
      <div class="pv-header" style="
        display:flex; gap:12px; flex-wrap:wrap; align-items:center;
        padding:8px 12px; margin-bottom:4px;
        background:rgba(255,255,255,0.04); border-radius:6px;
        border-left:3px solid ${viColor};
      ">
        <div style="flex:1 1 120px;">
          <div style="font-size:var(--text-xs);color:#888;">Global Violence Index</div>
          <div style="font-size:var(--text-xl);font-weight:700;color:${viColor};">
            ${data.globalViolenceIndex}
          </div>
        </div>
        <div class="pv-stat-pill" style="background:rgba(239,68,68,0.2);color:#f87171;">
          ${escalatingCount} Escalating
        </div>
        <div class="pv-stat-pill" style="background:rgba(220,38,38,0.25);color:#fca5a5;">
          ${extremeCount} Extreme Impact
        </div>
        <div class="pv-stat-pill" style="background:rgba(96,165,250,0.15);color:#93c5fd;">
          ${escapeHtml(data.mostViolentRegion)} Worst Region
        </div>
      </div>
    `;
  }

  private renderHotspotRow(h: ViolenceHotspot): string {
    const trendColor = TREND_COLOR[h.trend] ?? '#888';
    const impactColor = IMPACT_COLOR[h.civilianImpact] ?? '#888';
    const isExpanded = this.expandedHotspotId === h.id;
    const trendArrow = trendSymbol(h.trend);

    const drill = isExpanded
      ? `<div class="pv-drill" style="
          margin-top:8px; padding-top:8px;
          border-top:1px solid rgba(255,255,255,0.08);
          font-size:var(--text-xs); color:#bbb; line-height:1.5;
        ">
          <div style="margin-bottom:4px;">
            <span style="color:#888;">Primary Actor:</span>
            <span style="color:#e5e5e5;margin-left:4px;">${escapeHtml(h.primaryActor)}</span>
          </div>
          <div style="margin-bottom:4px;">
            <span style="color:#888;">Conflict Type:</span>
            <span style="color:#e5e5e5;margin-left:4px;">${escapeHtml(h.conflictType)}</span>
          </div>
          <div style="margin-bottom:4px;">
            <span style="color:#888;">Fatalities YTD:</span>
            <span style="color:#ef4444;margin-left:4px;font-weight:600;">${escapeHtml(h.fatalitiesYTD)}</span>
          </div>
          <div style="color:#ccc;">${escapeHtml(h.description)}</div>
        </div>`
      : '';

    return `
      <div class="pv-hotspot-row ${isExpanded ? 'expanded' : ''} ${civilianImpactClass(h.civilianImpact)}"
           role="listitem"
           data-hotspot-id="${escapeHtml(h.id)}"
           tabindex="0"
           aria-expanded="${isExpanded}"
           style="
             padding:9px 12px; margin-bottom:3px; cursor:pointer;
             border-radius:5px; border-left:3px solid ${trendColor};
             background:rgba(255,255,255,0.03);
             transition:background 0.15s;
           ">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:var(--text-sm);font-weight:600;color:#e5e5e5;flex:1;">
            ${escapeHtml(h.country)}
          </span>
          <span style="font-size:var(--text-2xs);color:#666;">${escapeHtml(h.region)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:5px;flex-wrap:wrap;">
          <span style="font-size:var(--text-2xs);color:#aaa;">
            ${h.monthlyEvents.toLocaleString()} events/mo
          </span>
          <span style="font-size:var(--text-2xs);font-weight:700;color:${trendColor};">
            ${trendArrow} ${h.trend}
          </span>
          <span style="
            font-size:var(--text-2xs); font-weight:600; padding:1px 5px;
            border-radius:3px; background:${impactColor}22; color:${impactColor};
            white-space:nowrap; margin-left:auto;
          ">${escapeHtml(h.civilianImpact)} Impact</span>
        </div>
        ${drill}
      </div>
    `;
  }

  private renderEventRow(e: ViolenceEvent): string {
    const typeColor = EVENT_COLOR[e.eventType] ?? '#888';
    const sigBars = Math.round(e.significance / 2);

    return `
      <div class="pv-event-row ${eventTypeClass(e.eventType)}"
           style="
             padding:8px 10px; margin-bottom:3px;
             border-radius:5px; border-left:3px solid ${typeColor};
             background:rgba(255,255,255,0.025);
           ">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="
            font-size:var(--text-2xs); font-weight:600; padding:1px 5px;
            border-radius:3px; background:${typeColor}22; color:${typeColor};
            white-space:nowrap;
          ">${escapeHtml(e.eventType)}</span>
          <span style="font-size:var(--text-xs);font-weight:600;color:#e5e5e5;flex:1;">
            ${escapeHtml(e.country)}
          </span>
          <span style="font-size:var(--text-2xs);color:#555;">${escapeHtml(e.date)}</span>
        </div>
        <div style="font-size:var(--text-xs);color:#bbb;margin-top:4px;line-height:1.4;">
          ${escapeHtml(e.description)}
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
          <span style="font-size:var(--text-2xs);color:#888;">
            ${e.fatalities > 0 ? `${e.fatalities.toLocaleString()} fatalities —` : ''} Actor: ${escapeHtml(e.actor)}
          </span>
          <div style="margin-left:auto;display:flex;gap:2px;" title="Significance: ${e.significance}/10">
            ${"█".repeat(sigBars)}${"░".repeat(5 - sigBars)}
          </div>
        </div>
      </div>
    `;
  }

  private bindHotspotClicks(): void {
    const rows = this.content.querySelectorAll<HTMLElement>('.pv-hotspot-row');
    const toggle = (e: Event): void => {
      e.stopPropagation();
      const id = (e.currentTarget as HTMLElement).dataset.hotspotId;
      if (!id) return;
      this.expandedHotspotId = this.expandedHotspotId === id ? null : id;
      this.render();
    };
    const onKeydown = (e: Event): void => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        e.preventDefault();
        toggle(e);
      }
    };
    for (const row of rows) {
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', onKeydown);
    }
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }
}