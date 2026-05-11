import { Panel } from './Panel';
import type { GDACSEvent } from '@/services/gdacs';
import { getEventTypeIcon } from '@/services/gdacs';
import { getApiBaseUrl } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';

interface RssEvent {
  id: string;
  eventType: string;
  name: string;
  alertLevel: 'Green' | 'Orange' | 'Red';
  score: number;
  country: string;
  coordinates: [number, number] | null;
  fromDate: string;
  severity: string;
  url: string;
}

interface RssEnvelope {
  events: RssEvent[];
  count: number;
  fetchedAt: number;
  degraded: boolean;
  reason?: string;
}

type Tab = 'json' | 'rss';

const REFRESH_MS = 30 * 60 * 1000;

// Known event types in display priority order
const TYPE_ORDER = ['TC', 'EQ', 'FL', 'VO', 'WF', 'DR'];
const TYPE_NAMES: Record<string, string> = {
  TC: 'Tropical Cyclone',
  EQ: 'Earthquake',
  FL: 'Flood',
  VO: 'Volcano',
  WF: 'Wildfire',
  DR: 'Drought',
};
const ALERT_COLOR: Record<string, string> = {
  Red: '#e53935',
  Orange: '#fb8c00',
  Green: '#43a047',
};

export class GDACSAlertsPanel extends Panel {
  private events: GDACSEvent[] = [];
  private rssData: RssEnvelope | null = null;
  private activeTab: Tab = 'rss';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private onEventClick: ((lat: number, lon: number) => void) | null = null;

  constructor() {
    super({
      id: 'gdacs-alerts',
      title: 'GDACS Disaster Alerts',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Active global disaster alerts from GDACS — earthquakes, floods, tropical cyclones, volcanoes, wildfires, droughts. RSS feed (gdacs.org/xml/rss.xml) grouped by type with alert score and country. Cross-reference with existing seismic/hurricane/wildfire data.',
    });
    this.showLoading('Fetching GDACS alerts...');
    queueMicrotask(() => { void this.refreshRss(); });
    this.refreshTimer = setInterval(() => void this.refreshRss(), REFRESH_MS);
  }

  public setEventClickHandler(fn: (lat: number, lon: number) => void): void {
    this.onEventClick = fn;
  }

  public dispose(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // Legacy: fed from data-loader via JSON API
  public update(events: GDACSEvent[]): void {
    this.events = events;
    this.render();
  }

  private async refreshRss(): Promise<void> {
    try {
      const resp = await fetch(`${getApiBaseUrl()}/api/disasters/gdacs`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.rssData = (await resp.json()) as RssEnvelope;
    } catch {
      // Keep stale data; sidecar serves cached response on failure
    }
    this.render();
  }

  private render(): void {
    // Count source with most events for badge
    const rssCount = this.rssData?.events.length ?? 0;
    const jsonCount = this.events.length;
    this.setCount(Math.max(rssCount, jsonCount));

    const tabBar = `
      <div style="display:flex;gap:4px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:6px;padding:0 4px;">
        ${(['rss', 'json'] as Tab[]).map((t) => `
          <button class="gdacs-tab" data-tab="${t}" style="
            background:${this.activeTab === t ? 'rgba(74,158,255,0.15)' : 'transparent'};
            border:none;border-bottom:2px solid ${this.activeTab === t ? '#4a9eff' : 'transparent'};
            color:inherit;padding:4px 10px;font-size:12px;cursor:pointer;">
            ${t === 'rss' ? 'GDACS RSS' : 'JSON API'}</button>`).join('')}
      </div>`;

    const content = this.activeTab === 'rss' ? this.renderRss() : this.renderJson();

    this.setContent(`<div style="padding:8px;font-size:12px;">${tabBar}${content}</div>`);
    this.wireHandlers();
  }

  private renderRss(): string {
    if (!this.rssData) return '<div style="opacity:0.6;">Loading GDACS RSS…</div>';
    const { events, degraded, reason } = this.rssData;

    const banner = degraded
      ? `<div style="padding:4px 6px;background:rgba(244,67,54,0.10);border-left:3px solid #f44336;margin-bottom:6px;font-size:11px;">Degraded: ${escapeHtml(reason ?? 'upstream')}</div>`
      : '';

    if (events.length === 0) return `${banner}<div style="opacity:0.6;">No active GDACS events.</div>`;

    // Group by type
    const groups: Record<string, RssEvent[]> = {};
    for (const e of events) {
      const list = groups[e.eventType] ?? [];
      list.push(e);
      groups[e.eventType] = list;
    }

    const allTypes = [...new Set([...TYPE_ORDER, ...Object.keys(groups)])].filter((t) => groups[t]);

    const sections = allTypes.map((type) => {
      const typeEvents = groups[type] ?? [];
      const icon = getEventTypeIcon(type as GDACSEvent['eventType']);
      const label = TYPE_NAMES[type] ?? type;
      const rows = typeEvents.slice(0, 20).map((e) => {
        const alertColor = ALERT_COLOR[e.alertLevel] ?? '#9e9e9e';
        const coordAttr = e.coordinates
          ? `data-lat="${e.coordinates[1]}" data-lon="${e.coordinates[0]}"`
          : '';
        // Cross-reference badge: mark events that are also in the JSON feed by location proximity
        const overlap = this.findJsonOverlap(e);
        const xrefBadge = overlap
          ? `<span style="background:rgba(74,158,255,0.2);color:#4a9eff;border-radius:3px;padding:0 4px;font-size:10px;margin-left:4px;">+confirmed</span>`
          : '';
        return `<div class="gdacs-row" ${coordAttr} role="button" tabindex="0" style="
          padding:5px 6px;margin:3px 0;border-left:3px solid ${alertColor};
          background:rgba(255,255,255,0.03);cursor:${e.coordinates ? 'pointer' : 'default'};">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;color:${alertColor};">${escapeHtml(e.alertLevel)}</span>
            <span style="opacity:0.7;font-size:11px;">Score: ${e.score.toFixed(1)}</span>
          </div>
          <div>${escapeHtml(e.name.slice(0, 60))}${xrefBadge}</div>
          <div style="opacity:0.8;font-size:11px;">${escapeHtml(e.country)}${e.fromDate ? ' · ' + escapeHtml(formatDate(e.fromDate)) : ''}</div>
          ${e.severity ? `<div style="opacity:0.7;font-size:11px;">${escapeHtml(e.severity)}</div>` : ''}
        </div>`;
      }).join('');

      return `
        <div style="margin-bottom:10px;">
          <h4 style="margin:6px 0 4px 0;font-size:12px;">${icon} ${escapeHtml(label)} (${typeEvents.length})</h4>
          ${rows}
        </div>`;
    }).join('');

    return `${banner}${sections}<div style="opacity:0.5;font-size:11px;margin-top:6px;">Source: GDACS RSS · ${events.length} events</div>`;
  }

  private renderJson(): string {
    if (this.events.length === 0) {
      return '<div class="panel-empty">No active GDACS disaster alerts above Green level.</div>';
    }
    const rows = this.events.slice(0, 80).map((e) => {
      const [lng, lat] = e.coordinates;
      const icon = getEventTypeIcon(e.eventType);
      let levelClass = 'eq-row eq-moderate';
      if (e.alertLevel === 'Red') levelClass = 'eq-row eq-major';
      else if (e.alertLevel === 'Orange') levelClass = 'eq-row eq-strong';
      const date = e.fromDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `<tr class="${levelClass} gdacs-row" role="button" tabindex="0" data-lat="${lat}" data-lon="${lng}" style="cursor:pointer">
        <td>${icon}</td>
        <td>${e.alertLevel}</td>
        <td>${escapeHtml(e.country)}</td>
        <td>${escapeHtml(e.name.length > 35 ? e.name.slice(0, 33) + '…' : e.name)}</td>
        <td>${escapeHtml(e.severity || '—')}</td>
        <td>${date}</td>
      </tr>`;
    }).join('');

    return `
      <div class="ct-panel-content">
        <table class="eq-table ct-table">
          <thead><tr><th>Type</th><th>Level</th><th>Country</th><th>Event</th><th>Severity</th><th>Date</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="fires-footer"><span class="fires-source">GDACS Global Disaster Coordination</span></div>
      </div>`;
  }

  /** Find a JSON-API event that overlaps with an RSS event by proximity (~200 km). */
  private findJsonOverlap(rss: RssEvent): GDACSEvent | undefined {
    if (!rss.coordinates || this.events.length === 0) return undefined;
    const [rssLon, rssLat] = rss.coordinates;
    return this.events.find((je) => {
      const [jeLon, jeLat] = je.coordinates;
      const dlat = (jeLat - rssLat) * Math.PI / 180;
      const dlon = (jeLon - rssLon) * Math.PI / 180;
      const a = Math.sin(dlat / 2) ** 2 + Math.cos(rssLat * Math.PI / 180) * Math.cos(jeLat * Math.PI / 180) * Math.sin(dlon / 2) ** 2;
      const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return km < 200;
    });
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.gdacs-tab')) {
      btn.addEventListener('click', () => {
        const next = btn.dataset.tab as Tab | undefined;
        if (next && next !== this.activeTab) {
          this.activeTab = next;
          this.render();
        }
      });
    }
    root.addEventListener('click', (ev) => {
      const row = (ev.target as Element).closest('.gdacs-row[data-lat]') as HTMLElement | null;
      if (!row || !this.onEventClick) return;
      const lat = Number.parseFloat(row.dataset.lat ?? '');
      const lon = Number.parseFloat(row.dataset.lon ?? '');
      if (Number.isFinite(lat) && Number.isFinite(lon)) this.onEventClick(lat, lon);
    });
  }
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return s;
  }
}
