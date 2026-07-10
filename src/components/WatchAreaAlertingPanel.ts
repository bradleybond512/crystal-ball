/**
 * Watch Area Alerting Panel — area list with enable/disable toggle,
 * per-domain threshold summary, and an alert count badge. Below the
 * list: an alert feed with distance, severity, and per-row
 * Acknowledge, plus a Create Area form with name + lat/lon/radius +
 * up to four per-domain threshold dropdowns.
 *
 * Vanilla TS — subscribes to the service for push-driven refresh and
 * falls back to a 10s timer.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getWatchAreaAlertingService,
  type WatchArea,
  type WatchAreaAlert,
  type WatchAreaStats,
  type WatchSeverity,
} from '@/services/intelligence/watch-area-alerting';

const REFRESH_MS = 10_000;
const RECENT_ALERT_LIMIT = 50;

const ALL_SEVERITIES: readonly WatchSeverity[] = ['low', 'medium', 'high', 'critical'];

const SEVERITY_COLOR: Record<string, string> = {
  low: 'var(--severity-info,#22c55e)',
  medium: 'var(--severity-medium,#facc15)',
  high: 'var(--severity-high,#f87171)',
  critical: 'var(--severity-critical,#dc2626)',
};

const DEFAULT_DOMAIN_OPTIONS = ['earthquake', 'weather', 'maritime', 'aviation', 'biosurv', 'cyber', 'geopolitical', 'wildfire'] as const;

interface DraftThreshold {
  domain: string;
  severity: WatchSeverity;
}

export class WatchAreaAlertingPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private draft = {
    name: '',
    lat: '',
    lon: '',
    radiusKm: '50',
    thresholds: [{ domain: 'earthquake', severity: 'high' as WatchSeverity }] as DraftThreshold[],
  };

  constructor() {
    super({
      id: 'watch-area-alerting',
      title: 'Watch Area Alerting',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Define named circular geographic regions with per-domain severity thresholds. Observations or situations that land inside a region and meet the threshold fire a watch-area alert.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = getWatchAreaAlertingService().subscribe(() => this.render());
    this.attachHandlers();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }

  // ── Rendering ──────────────────────────────────────────────────────

  private render(): void {
    try {
      const svc = getWatchAreaAlertingService();
      const stats = svc.getStats();
      const areas = svc.getAreas();
      const alerts = svc.getAlerts({}, RECENT_ALERT_LIMIT);
      this.setCount(stats.unacknowledgedAlerts);
      this.setContent(this.buildHtml(stats, areas, alerts));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Watch-area render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(stats: WatchAreaStats, areas: readonly WatchArea[], alerts: readonly WatchAreaAlert[]): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;font-size:12px;">
      ${this.renderSummary(stats)}
      ${this.renderAreaList(areas, stats)}
      ${this.renderCreateForm()}
      ${this.renderAlertFeed(alerts)}
    </div>`;
  }

  private renderSummary(s: WatchAreaStats): string {
    return `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;font-size:11px;color:var(--text-secondary,#aaa);">
      <span><strong style="color:var(--text-primary,#fff);font-size:14px;">${s.totalAreas}</strong> areas (${s.enabledAreas} enabled)</span>
      <span><strong style="color:var(--severity-high,#f87171);font-size:14px;">${s.unacknowledgedAlerts}</strong> unack alerts</span>
      <span><strong style="color:var(--text-primary,#fff);">${s.totalAlerts}</strong> total</span>
    </div>`;
  }

  private renderAreaList(areas: readonly WatchArea[], stats: WatchAreaStats): string {
    if (areas.length === 0) {
      return `<div style="padding:14px;text-align:center;font-size:12px;color:var(--text-secondary,#aaa);border-top:1px solid var(--border-subtle,#333);">No watch areas defined.</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;max-height:200px;overflow-y:auto;">
      ${areas.map((a) => this.renderAreaRow(a, stats.alertsByArea[a.id] ?? 0)).join('')}
    </div>`;
  }

  private renderAreaRow(area: WatchArea, alertCount: number): string {
    const enabledColor = area.enabled ? 'var(--severity-info,#22c55e)' : 'var(--text-secondary,#aaa)';
    const enabledLabel = area.enabled ? 'ON' : 'OFF';
    const thresholdChips = Object.entries(area.thresholds)
      .map(([d, sev]) => `<span style="font-size:10px;padding:1px 5px;border-radius:3px;background:${SEVERITY_COLOR[sev]}22;color:${SEVERITY_COLOR[sev]};">${escapeHtml(d)}:${escapeHtml(sev)}</span>`)
      .join(' ');
    return `<div style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:rgba(255,255,255,0.02);${area.enabled ? '' : 'opacity:0.6;'}">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button class="waa-toggle" data-id="${escapeHtml(area.id)}" style="font-size:9px;padding:1px 6px;border:1px solid var(--border-subtle,#333);background:${enabledColor}22;color:${enabledColor};border-radius:3px;cursor:pointer;font-weight:700;letter-spacing:0.04em;">${enabledLabel}</button>
        <strong style="font-size:12px;">${escapeHtml(area.name)}</strong>
        <span style="font-size:10px;color:var(--text-secondary,#aaa);">${area.lat.toFixed(3)}, ${area.lon.toFixed(3)} · r=${area.radiusKm}km</span>
        <span style="margin-left:auto;font-size:11px;color:var(--text-secondary,#aaa);"><strong style="color:var(--text-primary,#fff);">${alertCount}</strong> alerts</span>
        <button class="waa-delete" data-id="${escapeHtml(area.id)}" style="font-size:9px;padding:1px 6px;border:1px solid var(--border-subtle,#333);background:rgba(248,113,113,0.10);color:#f87171;border-radius:3px;cursor:pointer;">Delete</button>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:5px;display:flex;gap:5px;flex-wrap:wrap;">
        ${thresholdChips}
      </div>
    </div>`;
  }

  private renderCreateForm(): string {
    return `<form class="waa-create" style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;font-size:11px;">
      <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">Create Watch Area</div>
      <input class="waa-name" placeholder="Name" value="${escapeHtml(this.draft.name)}" style="padding:4px 6px;font-size:11px;background:rgba(255,255,255,0.04);border:1px solid var(--border-subtle,#333);color:var(--text-primary,#fff);border-radius:3px;" />
      <div style="display:flex;gap:6px;">
        <input class="waa-lat" placeholder="Lat" value="${escapeHtml(this.draft.lat)}" style="flex:1;padding:4px 6px;font-size:11px;background:rgba(255,255,255,0.04);border:1px solid var(--border-subtle,#333);color:var(--text-primary,#fff);border-radius:3px;" />
        <input class="waa-lon" placeholder="Lon" value="${escapeHtml(this.draft.lon)}" style="flex:1;padding:4px 6px;font-size:11px;background:rgba(255,255,255,0.04);border:1px solid var(--border-subtle,#333);color:var(--text-primary,#fff);border-radius:3px;" />
        <input class="waa-radius" placeholder="Radius km" value="${escapeHtml(this.draft.radiusKm)}" style="flex:1;padding:4px 6px;font-size:11px;background:rgba(255,255,255,0.04);border:1px solid var(--border-subtle,#333);color:var(--text-primary,#fff);border-radius:3px;" />
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        ${this.draft.thresholds.map((t, i) => this.renderThresholdRow(t, i)).join('')}
      </div>
      <div style="display:flex;gap:6px;">
        <button type="button" class="waa-add-threshold" style="font-size:10px;padding:3px 8px;border:1px solid var(--border-subtle,#333);background:rgba(255,255,255,0.04);color:var(--text-secondary,#aaa);border-radius:3px;cursor:pointer;">+ Threshold</button>
        <button type="submit" style="margin-left:auto;font-size:10px;padding:3px 8px;border:1px solid var(--accent,#4a9eff);background:var(--accent,#4a9eff);color:#fff;border-radius:3px;cursor:pointer;font-weight:600;">Create</button>
      </div>
    </form>`;
  }

  private renderThresholdRow(t: DraftThreshold, index: number): string {
    return `<div style="display:flex;gap:6px;align-items:center;">
      <select class="waa-th-domain" data-index="${index}" style="flex:2;padding:3px 6px;font-size:11px;background:rgba(255,255,255,0.04);border:1px solid var(--border-subtle,#333);color:var(--text-primary,#fff);border-radius:3px;">
        ${DEFAULT_DOMAIN_OPTIONS.map((d) =>
          `<option value="${escapeHtml(d)}" ${d === t.domain ? 'selected' : ''}>${escapeHtml(d)}</option>`,
        ).join('')}
      </select>
      <select class="waa-th-sev" data-index="${index}" style="flex:1;padding:3px 6px;font-size:11px;background:rgba(255,255,255,0.04);border:1px solid var(--border-subtle,#333);color:var(--text-primary,#fff);border-radius:3px;">
        ${ALL_SEVERITIES.map((s) =>
          `<option value="${escapeHtml(s)}" ${s === t.severity ? 'selected' : ''}>${escapeHtml(s)}</option>`,
        ).join('')}
      </select>
    </div>`;
  }

  private renderAlertFeed(alerts: readonly WatchAreaAlert[]): string {
    if (alerts.length === 0) {
      return `<div style="padding:12px;text-align:center;font-size:11px;color:var(--text-secondary,#aaa);border-top:1px solid var(--border-subtle,#333);">No recent alerts.</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;max-height:280px;overflow-y:auto;">
      ${alerts.map((a) => this.renderAlertRow(a)).join('')}
    </div>`;
  }

  private renderAlertRow(a: WatchAreaAlert): string {
    const color = SEVERITY_COLOR[a.severity.toLowerCase()] ?? 'var(--text-secondary,#aaa)';
    const distance = Number.isFinite(a.distanceKm) ? `${a.distanceKm.toFixed(1)}km` : 'no coords';
    const when = new Date(a.firedAt).toLocaleTimeString();
    const ack = a.acknowledged
      ? `<span style="font-size:10px;color:var(--severity-info,#22c55e);text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">ACK</span>`
      : `<button class="waa-ack" data-id="${escapeHtml(a.id)}" style="padding:2px 8px;font-size:10px;border:1px solid var(--border-subtle,#333);background:rgba(34,197,94,0.10);color:#22c55e;border-radius:3px;cursor:pointer;">Ack</button>`;
    return `<div style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:rgba(255,255,255,0.02);${a.acknowledged ? 'opacity:0.55;' : ''}">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${color}22;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(a.severity)}</span>
        <strong style="font-size:12px;">${escapeHtml(a.watchAreaName)}</strong>
        <span style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(a.domain)} · ${escapeHtml(a.sourceType)}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(distance)} · ${escapeHtml(when)}</span>
        ${ack}
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">source <code style="font-family:ui-monospace,monospace;">${escapeHtml(a.sourceId)}</code></div>
    </div>`;
  }

  // ── Events ────────────────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('click', (e) => this.onClick(e));
    this.content.addEventListener('submit', (e) => this.onSubmit(e));
    this.content.addEventListener('input', (e) => this.onInput(e));
    this.content.addEventListener('change', (e) => this.onInput(e));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const svc = getWatchAreaAlertingService();
    const ack = target.closest<HTMLElement>('.waa-ack');
    if (ack) {
      event.stopPropagation();
      const id = ack.dataset.id;
      if (id) { svc.acknowledge(id); this.render(); }
      return;
    }
    const del = target.closest<HTMLElement>('.waa-delete');
    if (del) {
      event.stopPropagation();
      const id = del.dataset.id;
      if (id) { svc.deleteArea(id); this.render(); }
      return;
    }
    const toggle = target.closest<HTMLElement>('.waa-toggle');
    if (toggle) {
      event.stopPropagation();
      const id = toggle.dataset.id;
      if (id) {
        const area = svc.getAreas().find((a) => a.id === id);
        if (area) svc.updateArea(id, { enabled: !area.enabled });
        this.render();
      }
      return;
    }
    const add = target.closest<HTMLElement>('.waa-add-threshold');
    if (add) {
      event.stopPropagation();
      this.draft.thresholds.push({ domain: 'weather', severity: 'medium' });
      this.render();
    }
  }

  private onSubmit(event: SubmitEvent): void {
    const form = event.target as HTMLElement | null;
    if (!form?.classList.contains('waa-create')) return;
    event.preventDefault();
    const lat = Number(this.draft.lat);
    const lon = Number(this.draft.lon);
    const radiusKm = Number(this.draft.radiusKm);
    if (!this.draft.name || Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(radiusKm)) return;
    const thresholds: Record<string, WatchSeverity> = {};
    for (const t of this.draft.thresholds) thresholds[t.domain] = t.severity;
    getWatchAreaAlertingService().createArea({
      name: this.draft.name, lat, lon, radiusKm,
      enabled: true, thresholds,
    });
    this.draft = { name: '', lat: '', lon: '', radiusKm: '50', thresholds: [{ domain: 'earthquake', severity: 'high' }] };
    this.render();
  }

  private onInput(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.classList.contains('waa-name')) this.draft.name = (target as HTMLInputElement).value;
    else if (target.classList.contains('waa-lat')) this.draft.lat = (target as HTMLInputElement).value;
    else if (target.classList.contains('waa-lon')) this.draft.lon = (target as HTMLInputElement).value;
    else if (target.classList.contains('waa-radius')) this.draft.radiusKm = (target as HTMLInputElement).value;
    else if (target.classList.contains('waa-th-domain')) {
      const idx = Number((target as HTMLSelectElement).dataset.index);
      const slot = this.draft.thresholds[idx];
      if (slot) slot.domain = (target as HTMLSelectElement).value;
    } else if (target.classList.contains('waa-th-sev')) {
      const idx = Number((target as HTMLSelectElement).dataset.index);
      const slot = this.draft.thresholds[idx];
      if (slot) slot.severity = (target as HTMLSelectElement).value as WatchSeverity;
    }
  }
}
