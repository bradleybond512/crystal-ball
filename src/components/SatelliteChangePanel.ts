/**
 * Satellite Change Detection Panel
 *
 * Monitors satellite imagery for changes at watched locations. Displays
 * watch locations, recent detections, and change type statistics.
 */

import { Panel } from './Panel';
import {
  getWatchLocations,
  getRecentDetections,
  getSatelliteStats,
  type ChangeDetection,
  type ChangeType,
} from '@/services/satellite-change';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const CHANGE_ICONS: Record<ChangeType, string> = {
  construction: '\uD83C\uDFD7\uFE0F',
  destruction: '\uD83D\uDCA5',
  vegetation_loss: '\uD83C\uDF42',
  flooding: '\uD83C\uDF0A',
  fire_damage: '\uD83D\uDD25',
  troop_buildup: '\u2694\uFE0F',
  vehicle_movement: '\uD83D\uDE9A',
  infrastructure_change: '\u2699\uFE0F',
  unknown: '\u2753',
};

const CHANGE_LABELS: Record<ChangeType, string> = {
  construction: 'Construction',
  destruction: 'Destruction',
  vegetation_loss: 'Vegetation Loss',
  flooding: 'Flooding',
  fire_damage: 'Fire Damage',
  troop_buildup: 'Troop Buildup',
  vehicle_movement: 'Vehicle Movement',
  infrastructure_change: 'Infra Change',
  unknown: 'Unknown',
};

const SEV_COLORS: Record<string, string> = {
  critical: '#f44336',
  high: '#ff9800',
  medium: '#ffc107',
  low: '#4caf50',
};

export class SatelliteChangePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'satellite-change',
 title: 'Satellite Change Detection',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Monitors satellite imagery for construction, destruction, troop movement, flooding, and other changes at watched locations.',
 });
 this.showLoading('Scanning satellite imagery\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 90_000);
  }

  private render(): void {
 const stats = getSatelliteStats();
 const detections = getRecentDetections(48);
 const locations = getWatchLocations();

 this.setCount(stats.recentDetections24h);

 const statsHtml = `<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-subtle,#333);">
 <div style="text-align:center;flex:1;"><span style="font-size:18px;font-weight:700;">${stats.watchedLocations}</span><br><span style="font-size:10px;color:var(--text-muted,#888);">Locations</span></div>
 <div style="text-align:center;flex:1;"><span style="font-size:18px;font-weight:700;">${stats.enabledLocations}</span><br><span style="font-size:10px;color:var(--text-muted,#888);">Active</span></div>
 <div style="text-align:center;flex:1;"><span style="font-size:18px;font-weight:700;">${stats.totalDetections}</span><br><span style="font-size:10px;color:var(--text-muted,#888);">Detections</span></div>
 <div style="text-align:center;flex:1;"><span style="font-size:18px;font-weight:700;color:#ff9800;">${stats.recentDetections24h}</span><br><span style="font-size:10px;color:var(--text-muted,#888);">24h</span></div>
 </div>`;

 const detectionsHtml = detections.length > 0 ? `
 <div style="margin-top:8px;">
 <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Recent Detections</div>
 ${detections.slice(0, 15).map((d: ChangeDetection) => {
 const icon = CHANGE_ICONS[d.changeType] ?? '\u2753';
 const label = CHANGE_LABELS[d.changeType] ?? d.changeType;
 const sevColor = SEV_COLORS[d.severity] ?? '#999';
 return `<div style="border-left:3px solid ${sevColor};padding:4px 8px;margin-bottom:4px;border-radius:0 4px 4px 0;">
 <div style="display:flex;justify-content:space-between;">
 <span style="font-size:11px;font-weight:600;">${icon} ${escapeHtml(label)}</span>
 <span style="font-size:10px;color:var(--text-muted,#888);">${Math.round(d.confidence)}%</span>
 </div>
 <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(d.locationName)} \u2022 ${d.areaSqKm.toFixed(1)} km\u00B2</div>
 <div style="font-size:10px;color:var(--text-muted,#888);margin-top:1px;">${escapeHtml(d.description.slice(0, 100))}</div>
 <div style="font-size:9px;color:var(--text-muted,#888);margin-top:1px;">${formatTime(new Date(d.detectedAt))} \u2022 ${escapeHtml(d.beforeDate)} \u2192 ${escapeHtml(d.afterDate)}</div>
 </div>`;
 }).join('')}
 </div>
 ` : '';

 const locationsHtml = locations.length > 0 ? `
 <div style="margin-top:8px;">
 <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Watch Locations (${locations.length})</div>
 ${locations.slice(0, 10).map(l => {
 const status = l.enabled ? '\uD83D\uDFE2' : '\u26AA';
 const lastCheck = l.lastChecked ? formatTime(new Date(l.lastChecked)) : 'never';
 return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--border-subtle,#333);">
 <span>${status}</span>
 <span style="flex:1;font-size:11px;">${escapeHtml(l.name)}</span>
 <span style="font-size:9px;color:var(--text-muted,#888);">${l.radiusKm}km \u2022 ${lastCheck}</span>
 </div>`;
 }).join('')}
 </div>
 ` : '';

 this.setContent(`<div style="padding:8px 12px;">${statsHtml}${detectionsHtml}${locationsHtml}</div>`);
  }

  public override destroy(): void {
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }
}
