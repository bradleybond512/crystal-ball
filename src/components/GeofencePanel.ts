/**
 * Custom Geofence Panel
 *
 * User-defined geographic alert zones. Set up circular or polygon
 * geofences and receive alerts when specified event types occur within.
 *
 * Inspired by Palantir Gotham/Foundry geofencing capabilities.
 */

import { Panel } from './Panel';
import {
  getGeofences,
  getRecentAlerts,
  getAlertCount,
  type Geofence,
  type GeofenceAlert,
} from '@/services/custom-geofence';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const EVENT_ICONS: Record<string, string> = {
  earthquake: '\uD83C\uDF0B',
  conflict: '\u2694\uFE0F',
  cyber: '\uD83D\uDDA5\uFE0F',
  weather: '\u26C8\uFE0F',
  nuclear: '\u2622\uFE0F',
  fire: '\uD83D\uDD25',
  protest: '\u270A',
  military: '\uD83C\uDFAF',
};

export class GeofencePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'custom-geofence',
 title: 'Geofence Alerts',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'User-defined geographic alert zones. Create circular or polygon geofences and receive alerts when earthquakes, conflicts, weather events, or other threats occur within your monitored areas.',
 });
 this.showLoading('Loading geofences\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 60 * 1000);
  }

  private render(): void {
 const fences = getGeofences();
 const alerts = getRecentAlerts(30);
 const alertCount = getAlertCount();

 this.setCount(alertCount);

 if (fences.length === 0) {
 this.setContent(`
 <div class="panel-empty">
 No geofences configured. Create circular or polygon geofences to receive alerts when specified event types (earthquakes, conflicts, weather, etc.) occur within your monitored areas.
 </div>
 `);
 return;
 }

 const enabledCount = fences.filter(f => f.enabled).length;
 const statsHtml = `<div class="gf-stats">
 <span>\uD83D\uDCCD ${fences.length} fences (${enabledCount} active)</span>
 <span class="gf-sep">\u2502</span>
 <span>\u26A0\uFE0F ${alertCount} alerts (24h)</span>
 </div>`;

 const fenceCards = fences.map(f => this.renderFence(f)).join('');

 const alertHtml = alerts.length > 0 ? `
 <div class="gf-section-title">RECENT ALERTS</div>
 <div class="gf-alerts">${alerts.slice(0, 15).map(a => this.renderAlert(a)).join('')}</div>
 ` : '';

 this.setContent(`
 <div style="padding:8px 12px;">
 ${statsHtml}
 <div class="gf-section-title">GEOFENCES</div>
 <div class="gf-fence-list">${fenceCards}</div>
 ${alertHtml}
 </div>
 `);
  }

  private renderFence(f: Geofence): string {
 const name = escapeHtml(f.name);
 const shape = f.shape === 'circle'
 ? `\u25EF ${f.radiusKm ?? 0}km radius`
 : `\u2B1F ${f.polygon?.length ?? 0} vertices`;
 const types = f.alertOnTypes.map(t => EVENT_ICONS[t] ?? t).join(' ');
 const status = f.enabled ? '\uD83D\uDFE2' : '\u26AA';

 return `<div class="gf-fence-card ${f.enabled ? '' : 'gf-disabled'}">
 <div class="gf-fence-header">
 <span>${status}</span>
 <span class="gf-fence-name">${name}</span>
 <span class="gf-fence-shape">${shape}</span>
 </div>
 <div class="gf-fence-types">${types}</div>
 </div>`;
  }

  private renderAlert(a: GeofenceAlert): string {
 const icon = EVENT_ICONS[a.eventType] ?? '\u26A0\uFE0F';
 const fence = escapeHtml(a.fenceName);
 const desc = escapeHtml(a.eventDescription.length > 80 ? a.eventDescription.slice(0, 77) + '\u2026' : a.eventDescription);
 const time = formatTime(new Date(a.timestamp));

 return `<div class="gf-alert-row">
 <span>${icon}</span>
 <span class="gf-alert-fence">${fence}</span>
 <span class="gf-alert-desc">${desc}</span>
 <span class="gf-alert-time">${time}</span>
 </div>`;
  }

  public override destroy(): void {
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }
}
