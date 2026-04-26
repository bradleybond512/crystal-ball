/**
 * Anomaly Detection Panel — displays active anomalies and timeline
 *
 * Shows real-time statistical anomalies detected across all monitored
 * signal streams. Active anomalies sorted by severity, with a 24h timeline
 * and summary stats.
 */

import { Panel } from './Panel';
import { anomalyEngine, type Anomaly, type AnomalySeverity, type AnomalyType } from '../services/anomaly-detection';
import { escapeHtml } from '../utils/sanitize';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<AnomalyType, string> = {
  spike: '\uD83D\uDCC8', // 📈
  silence: '\uD83D\uDD07',  // 🔇
  reversal: '\uD83D\uDD04', // 🔄
  deviation: '\uD83D\uDCC9', // 📉
  compound: '\u26A0\uFE0F', // ⚠️
};

const SEVERITY_CLASSES: Record<AnomalySeverity, string> = {
  critical: 'anomaly-severity-critical',
  warning: 'anomaly-severity-warning',
  info: 'anomaly-severity-info',
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatTimeAgo(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000 * 10) / 10}h ago`;
}

function formatAnomalyMetric(anomaly: Anomaly): string {
  if (anomaly.type === 'silence') {
 const hours = Math.round(anomaly.value / (60 * 60 * 1000) * 10) / 10;
 return `silent for ${hours}h`;
  }
  const sigma = Math.abs(Math.round(anomaly.zScore * 10) / 10);
  return `${sigma}\u03C3 ${anomaly.zScore > 0 ? 'above' : 'below'} normal`;
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export class AnomalyDetectionPanel extends Panel {
  private unsubscribe: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastActiveCount = -1;

  constructor() {
 super({
 id: 'anomaly-detection',
 title: 'Anomaly Detection',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Adaptive statistical monitoring across all data feeds. Detects Z-score spikes, source silence, trend reversals, and burst patterns using rolling 24h windows.',
 });
 this.showLoading('Initializing anomaly engine\u2026');
 this.start();
  }

  private start(): void {
 // Subscribe to new anomalies
 this.unsubscribe = anomalyEngine.subscribe(() => {
 this.render();
 });

 // Periodic refresh (every 30s) for silence checks and time-ago updates
 this.refreshTimer = setInterval(() => {
 const prevCount = anomalyEngine.getActiveAnomalies().length;
 anomalyEngine.checkSilence();
 const newCount = anomalyEngine.getActiveAnomalies().length;
 if (newCount !== prevCount || newCount !== this.lastActiveCount) {
 this.render();
 }
 }, 30_000);

 // Initial render
 this.render();
  }

  private render(): void {
 const active = anomalyEngine.getActiveAnomalies();
 const recent = anomalyEngine.getRecentAnomalies();
 const sourceCount = anomalyEngine.getSourceCount();

 this.lastActiveCount = active.length;
 this.setCount(active.length);

 if (sourceCount === 0) {
 this.setContent(`
 <div class="panel-empty">
 No signal sources ingested yet. Anomalies will appear as data feeds report in.
 </div>
 `);
 return;
 }

 const statsHtml = this.renderStats(active.length, recent.length, sourceCount);
 const anomaliesHtml = active.length > 0
 ? this.renderAnomalies(active)
 : '<div class="anomaly-empty">No active anomalies \u2014 all signals within normal parameters.</div>';
 const timelineHtml = this.renderTimeline(recent);

 this.setContent(`
 <div class="anomaly-panel-content">
 ${statsHtml}
 <div class="anomaly-list">${anomaliesHtml}</div>
 ${timelineHtml}
 </div>
 `);
  }

  private renderStats(activeCount: number, recentCount: number, sourceCount: number): string {
 return `<div class="anomaly-stats">
 <span class="anomaly-stat">${activeCount} active</span>
 <span class="anomaly-stat-sep">\u2502</span>
 <span class="anomaly-stat">${recentCount} in 24h</span>
 <span class="anomaly-stat-sep">\u2502</span>
 <span class="anomaly-stat">${sourceCount} sources</span>
 </div>`;
  }

  private renderAnomalies(anomalies: Anomaly[]): string {
 return anomalies.map(a => {
 const icon = TYPE_ICONS[a.type];
 const sevClass = SEVERITY_CLASSES[a.severity];
 const metric = escapeHtml(formatAnomalyMetric(a));
 const desc = escapeHtml(a.description);
 const time = escapeHtml(formatTimeAgo(a.timestamp));
 const source = escapeHtml(a.source);

 return `<div class="anomaly-card ${sevClass}">
 <div class="anomaly-card-header">
 <span class="anomaly-icon">${icon}</span>
 <span class="anomaly-source">${source}</span>
 <span class="anomaly-badge ${sevClass}">${escapeHtml(a.severity)}</span>
 </div>
 <div class="anomaly-metric">${metric}</div>
 <div class="anomaly-desc">${desc}</div>
 <div class="anomaly-time">${time}</div>
 </div>`;
 }).join('');
  }

  private renderTimeline(anomalies: Anomaly[]): string {
 if (anomalies.length === 0) return '';

 const now = Date.now();
 const windowMs = 24 * 60 * 60 * 1000;
 const start = now - windowMs;

 const dots = anomalies.map(a => {
 const pct = Math.max(0, Math.min(100, ((a.timestamp - start) / windowMs) * 100));
 const sevClass = SEVERITY_CLASSES[a.severity];
 const label = escapeHtml(`${formatTimestamp(a.timestamp)} \u2014 ${a.source}: ${a.type}`);
 return `<div class="anomaly-dot ${sevClass}" style="left:${pct.toFixed(1)}%" title="${label}"></div>`;
 }).join('');

 return `<div class="anomaly-timeline">
 <div class="anomaly-timeline-label">24h timeline</div>
 <div class="anomaly-timeline-track">
 ${dots}
 </div>
 <div class="anomaly-timeline-axis">
 <span>-24h</span><span>-12h</span><span>now</span>
 </div>
 </div>`;
  }

  public override destroy(): void {
 if (this.unsubscribe) {
 this.unsubscribe();
 this.unsubscribe = null;
 }
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }
}
