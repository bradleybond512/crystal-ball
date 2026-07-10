/**
 * SIGINT Panel
 *
 * Unified Signals Intelligence dashboard showing GPS jamming events,
 * BGP routing anomalies, and submarine cable outages in one view.
 * Highlights SIGINT convergence — when multiple signal types fire
 * near the same location.
 */

import { Panel } from './Panel';
import { getSigintEvents, getSigintClusters, type SigintEvent, type SigintConvergenceCluster } from '@/services/sigint-convergence';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const TYPE_ICONS: Record<string, string> = {
  gps_jamming: '\uD83D\uDCE1',  // 📡
  bgp_anomaly: '\uD83C\uDF10',  // 🌐
  cable_outage: '\u26A0\uFE0F', // ⚠️
};

const TYPE_LABELS: Record<string, string> = {
  gps_jamming: 'GPS Jamming',
  bgp_anomaly: 'BGP Anomaly',
  cable_outage: 'Cable Outage',
};

const SEV_CLASS: Record<string, string> = {
  critical: 'sigint-sev-critical',
  high: 'sigint-sev-high',
  medium: 'sigint-sev-medium',
  low: 'sigint-sev-low',
};

export class SigintPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'sigint-panel',
 title: 'SIGINT Monitor',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Signals Intelligence: monitors GPS/GNSS jamming, BGP routing anomalies, and submarine cable outages. Highlights convergence when multiple signal types cluster near the same location — a strong indicator of state-level electronic warfare.',
 });
 this.showLoading('Monitoring signal feeds\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 60_000);
  }

  private render(): void {
 const events = getSigintEvents();
 const clusters = getSigintClusters();

 this.setCount(events.length);

 if (events.length === 0) {
 this.setContent(`
 <div class="panel-empty">
 No SIGINT events in the last 24 hours. GPS jamming, BGP anomalies, and cable outages will appear here when detected.
 </div>
 `);
 return;
 }

 // Stats bar
 const gpsCount = events.filter(e => e.type === 'gps_jamming').length;
 const bgpCount = events.filter(e => e.type === 'bgp_anomaly').length;
 const cableCount = events.filter(e => e.type === 'cable_outage').length;

 const statsHtml = `<div class="sigint-stats">
 <span>${TYPE_ICONS.gps_jamming} ${gpsCount} GPS</span>
 <span class="sigint-sep">\u2502</span>
 <span>${TYPE_ICONS.bgp_anomaly} ${bgpCount} BGP</span>
 <span class="sigint-sep">\u2502</span>
 <span>${TYPE_ICONS.cable_outage} ${cableCount} Cable</span>
 ${clusters.length > 0 ? `<span class="sigint-sep">\u2502</span><span class="sigint-convergence-badge">\uD83D\uDD34 ${clusters.length} convergence</span>` : ''}
 </div>`;

 // Convergence clusters (most important)
 const clusterHtml = clusters.length > 0
 ? `<div class="sigint-section-title">CONVERGENCE ZONES</div>` +
 clusters.slice(0, 5).map(c => this.renderCluster(c)).join('')
 : '';

 // Recent events
 const recentHtml = `<div class="sigint-section-title">RECENT EVENTS</div>` +
 events.slice(-15).reverse().map(e => this.renderEvent(e)).join('');

 this.setContent(`
 <div style="padding:8px 12px;">
 ${statsHtml}
 ${clusterHtml}
 ${recentHtml}
 </div>
 `);
  }

  private renderCluster(c: SigintConvergenceCluster): string {
 const types = c.events.map(e => TYPE_ICONS[e.type] ?? '\u2753').join(' ');
 return `<div class="sigint-cluster">
 <div class="sigint-cluster-header">
 <span class="sigint-cluster-score" style="color:rgb(${c.color[0]},${c.color[1]},${c.color[2]})">${c.score}</span>
 <span>${types}</span>
 <span class="sigint-cluster-count">${c.events.length} events, ${c.typeCount} types</span>
 </div>
 <div class="sigint-cluster-loc">${c.lat.toFixed(1)}\u00B0, ${c.lon.toFixed(1)}\u00B0 \u2014 ${escapeHtml(c.maxSeverity)} severity</div>
 </div>`;
  }

  private renderEvent(e: SigintEvent): string {
 const icon = TYPE_ICONS[e.type] ?? '\u2753';
 const label = TYPE_LABELS[e.type] ?? e.type;
 const sevClass = SEV_CLASS[e.severity] ?? '';
 const time = formatTime(new Date(e.timestamp));

 return `<div class="sigint-event ${sevClass}">
 <span class="sigint-event-icon">${icon}</span>
 <span class="sigint-event-type">${escapeHtml(label)}</span>
 <span class="sigint-event-desc">${escapeHtml(e.description)}</span>
 <span class="sigint-event-time">${escapeHtml(time)}</span>
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
