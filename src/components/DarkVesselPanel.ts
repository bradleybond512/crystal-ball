/**
 * Dark Vessel Detection Panel
 *
 * Displays vessels that have gone dark (disabled AIS transponders)
 * in high-risk maritime zones. Cross-references against sanctions lists.
 *
 * Inspired by Palantir Gotham maritime intelligence and Windward.
 */

import { Panel } from './Panel';
import { detectDarkVessels, getDarkVesselCount, type DarkVesselAlert } from '@/services/dark-vessel';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const SEV_ICONS: Record<string, string> = {
  critical: '\uD83D\uDD34', // 🔴
  high: '\uD83D\uDFE0', // 🟠
  medium: '\uD83D\uDFE1', // 🟡
  low: '\uD83D\uDFE2', // 🟢
};

export class DarkVesselPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'dark-vessel',
 title: 'Dark Vessel Watch',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Monitors vessels that disable AIS transponders in high-risk maritime zones. A key indicator of sanctions evasion, smuggling, or covert military operations. Cross-references against OFAC/OpenSanctions lists.',
 });
 this.showLoading('Scanning AIS feeds\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 2 * 60 * 1000);
  }

  private render(): void {
 const alerts = detectDarkVessels();
 const darkCount = getDarkVesselCount();

 this.setCount(darkCount);

 if (alerts.length === 0) {
 this.setContent(`
 <div class="panel-empty">
 No dark vessel alerts in high-risk zones. Vessels will be flagged here when AIS signals disappear for 6+ hours in monitored maritime chokepoints.
 </div>
 `);
 return;
 }

 const sanctionedCount = alerts.filter(a => a.sanctioned).length;
 const statsHtml = `<div class="dv-stats">
 <span>\u26A0\uFE0F ${alerts.length} dark</span>
 ${sanctionedCount > 0 ? `<span class="dv-sep">\u2502</span><span class="dv-sanctioned">\uD83D\uDEA8 ${sanctionedCount} sanctioned</span>` : ''}
 </div>`;

 const cardsHtml = alerts.slice(0, 20).map(a => this.renderAlert(a)).join('');

 this.setContent(`
 <div style="padding:8px 12px;">
 ${statsHtml}
 <div class="dv-list">${cardsHtml}</div>
 </div>
 `);
  }

  private renderAlert(a: DarkVesselAlert): string {
 const icon = SEV_ICONS[a.severity] ?? '\u2B55';
 const name = escapeHtml(a.vesselName || a.mmsi);
 const flag = escapeHtml(a.flag);
 const zone = escapeHtml(a.riskZone);
 const lastSeen = formatTime(new Date(a.lastSeen));
 const sanctionBadge = a.sanctioned ? '<span class="dv-sanction-badge">SANCTIONED</span>' : '';

 return `<div class="dv-card dv-sev-${a.severity}">
 <div class="dv-card-header">
 <span>${icon}</span>
 <span class="dv-vessel-name">${name}</span>
 <span class="dv-flag">${flag}</span>
 ${sanctionBadge}
 </div>
 <div class="dv-detail">
 Dark for <strong>${a.darkHours}h</strong> in ${zone}
 \u2014 last seen ${lastSeen}
 </div>
 <div class="dv-coords">${a.lastLat.toFixed(2)}\u00B0, ${a.lastLon.toFixed(2)}\u00B0</div>
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
