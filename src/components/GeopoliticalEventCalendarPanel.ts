/**
 * Geopolitical Event Calendar Panel (panel id: `geopolitical-event-calendar`).
 *
 * Timeline view of upcoming scheduled events (elections, summits,
 * treaty deadlines, sanctions reviews, exercises). Three horizon
 * tabs (7d / 30d / 90d) and a filter row (type + risk). Each event
 * card carries a risk badge, type icon, domain chips, country, a
 * days-until countdown, and an Acknowledge button.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getGeopoliticalEventCalendar,
  type CalendarEvent,
  type CalendarEventRisk,
  type CalendarEventType,
  type UpcomingFilter,
} from '@/services/intelligence/geopolitical-event-calendar';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const HORIZON_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;
type Horizon = keyof typeof HORIZON_DAYS;

const RISK_COLOR: Record<CalendarEventRisk, string> = {
  low: '#9ca3af',
  medium: '#f5a524',
  high: '#e07b30',
  critical: '#e94f37',
};

const TYPE_ICON: Record<CalendarEventType, string> = {
  election: '🗳',
  summit: '🤝',
  'treaty-deadline': '📜',
  'sanctions-review': '⚖',
  'military-exercise': '🛡',
  'economic-release': '📊',
  other: '•',
};

const TYPE_LABEL: Record<CalendarEventType, string> = {
  election: 'Election',
  summit: 'Summit',
  'treaty-deadline': 'Treaty',
  'sanctions-review': 'Sanctions',
  'military-exercise': 'Exercise',
  'economic-release': 'Econ',
  other: 'Other',
};

export class GeopoliticalEventCalendarPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listener: ((events: CalendarEvent[]) => void) | null = null;
  private horizon: Horizon = '30d';
  private typeFilter: CalendarEventType | 'all' = 'all';
  private riskFilter: CalendarEventRisk | 'all' = 'all';

  constructor() {
    super({
      id: 'geopolitical-event-calendar',
      title: 'Event Calendar',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Scheduled geopolitical events with risk tags and domain linkage. Elections, summits, treaty deadlines, sanctions reviews, military exercises.',
    });
    const svc = getGeopoliticalEventCalendar();
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
      getGeopoliticalEventCalendar().unsubscribe(this.listener);
      this.listener = null;
    }
    super.destroy();
  }

  private render(): void {
    const svc = getGeopoliticalEventCalendar();
    const filter = this.buildFilter();
    const horizonMs = HORIZON_DAYS[this.horizon] * DAY_MS;
    const events = svc.getUpcoming(horizonMs, filter);
    const summary = svc.getSummary();
    this.setCount(summary.highRiskCount);
    this.setContent(this.buildHtml(events, summary.highRiskCount), () => this.wireHandlers());
  }

  private buildFilter(): UpcomingFilter | undefined {
    if (this.typeFilter === 'all' && this.riskFilter === 'all') return undefined;
    const filter: UpcomingFilter = {};
    if (this.typeFilter !== 'all') filter.type = this.typeFilter;
    if (this.riskFilter !== 'all') filter.riskLevel = this.riskFilter;
    return filter;
  }

  private buildHtml(events: readonly CalendarEvent[], highRisk: number): string {
    return `<div class="cal-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderHeader(events.length, highRisk)}
      ${this.renderFilters()}
      ${this.renderEvents(events)}
    </div>`;
  }

  private renderHeader(visible: number, highRisk: number): string {
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
      <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;">${visible} event${visible === 1 ? '' : 's'} · ${highRisk} high-risk pending</span>
      <div style="display:flex;gap:3px;">
        ${this.horizonButton('7d', '7d')}
        ${this.horizonButton('30d', '30d')}
        ${this.horizonButton('90d', '90d')}
      </div>
    </div>`;
  }

  private horizonButton(key: Horizon, label: string): string {
    const active = this.horizon === key;
    const bg = active ? 'rgba(74,158,255,0.25)' : 'rgba(255,255,255,0.05)';
    const border = active ? 'rgba(74,158,255,0.5)' : 'rgba(255,255,255,0.1)';
    return `<button class="cal-horizon" data-key="${escapeHtml(key)}" type="button" style="padding:2px 9px;background:${bg};color:inherit;border:1px solid ${border};border-radius:2px;cursor:pointer;font-size:10px;font-family:inherit;">${escapeHtml(label)}</button>`;
  }

  private renderFilters(): string {
    const types: (CalendarEventType | 'all')[] = ['all', 'election', 'summit', 'treaty-deadline', 'sanctions-review', 'military-exercise', 'economic-release'];
    const risks: (CalendarEventRisk | 'all')[] = ['all', 'critical', 'high', 'medium', 'low'];
    return `<div style="display:flex;flex-direction:column;gap:4px;">
      <div style="display:flex;gap:3px;flex-wrap:wrap;">
        ${types.map((t) => this.filterChip('type', t, t === 'all' ? 'All types' : TYPE_LABEL[t as CalendarEventType], this.typeFilter === t)).join('')}
      </div>
      <div style="display:flex;gap:3px;flex-wrap:wrap;">
        ${risks.map((r) => this.filterChip('risk', r, r === 'all' ? 'All risks' : r, this.riskFilter === r)).join('')}
      </div>
    </div>`;
  }

  private filterChip(kind: 'type' | 'risk', value: string, label: string, active: boolean): string {
    const bg = active ? 'rgba(74,158,255,0.22)' : 'rgba(255,255,255,0.04)';
    const border = active ? 'rgba(74,158,255,0.5)' : 'rgba(255,255,255,0.1)';
    return `<button class="cal-filter" data-kind="${escapeHtml(kind)}" data-value="${escapeHtml(value)}" type="button" style="padding:1px 7px;background:${bg};color:inherit;border:1px solid ${border};border-radius:2px;cursor:pointer;font-size:9.5px;font-family:inherit;text-transform:capitalize;">${escapeHtml(label)}</button>`;
  }

  private renderEvents(events: readonly CalendarEvent[]): string {
    if (events.length === 0) {
      return `<div style="font-size:11px;opacity:0.55;padding:6px 0;text-align:center;">No matching events in this window.</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:5px;">${events.map((e) => this.renderEventCard(e)).join('')}</div>`;
  }

  private renderEventCard(e: CalendarEvent): string {
    const nowMs = Date.now();
    const daysUntil = Math.max(0, Math.round((e.scheduledAt - nowMs) / DAY_MS));
    const riskColor = RISK_COLOR[e.riskLevel];
    const ackOpacity = e.acknowledged ? '0.45' : '1';
    return `<div data-event-id="${escapeHtml(e.id)}" style="opacity:${ackOpacity};border-left:3px solid ${riskColor};background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;padding:6px 8px;display:flex;flex-direction:column;gap:3px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <span style="font-size:11.5px;color:#ddd;font-weight:600;">${escapeHtml(TYPE_ICON[e.type])} ${escapeHtml(e.title)}</span>
        <span style="font-size:10px;color:${riskColor};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${e.riskLevel}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:10px;opacity:0.65;">
        <span>${escapeHtml(e.country)} · ${escapeHtml(e.region)}</span>
        <span style="font-family:ui-monospace,monospace;">in ${daysUntil}d</span>
      </div>
      ${e.domains.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:3px;">${e.domains.map((d) => `<span style="font-size:9px;background:rgba(74,158,255,0.12);color:#9ec5ff;padding:1px 5px;border-radius:2px;">${escapeHtml(d)}</span>`).join('')}</div>` : ''}
      <div style="font-size:10px;opacity:0.6;font-style:italic;">${escapeHtml(e.riskRationale)}</div>
      ${e.acknowledged ? '' : `<button class="cal-ack" type="button" style="align-self:flex-end;padding:2px 8px;background:rgba(46,194,126,0.18);color:#2ec27e;border:1px solid rgba(46,194,126,0.45);border-radius:2px;cursor:pointer;font-size:10px;font-family:inherit;">Acknowledge</button>`}
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const svc = getGeopoliticalEventCalendar();

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.cal-horizon')) {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-key');
        if (key === '7d' || key === '30d' || key === '90d') {
          this.horizon = key;
          this.render();
        }
      });
    }

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.cal-filter')) {
      btn.addEventListener('click', () => {
        const kind = btn.getAttribute('data-kind');
        const value = btn.getAttribute('data-value');
        if (!value) return;
        if (kind === 'type') {
          this.typeFilter = value === 'all' ? 'all' : (value as CalendarEventType);
        } else if (kind === 'risk') {
          this.riskFilter = value === 'all' ? 'all' : (value as CalendarEventRisk);
        }
        this.render();
      });
    }

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.cal-ack')) {
      btn.addEventListener('click', () => {
        const row = btn.closest<HTMLElement>('[data-event-id]');
        const id = row?.getAttribute('data-event-id');
        if (id) svc.acknowledge(id);
      });
    }
  }
}
