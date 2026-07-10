/**
 * Pattern-of-Life Panel
 *
 * Displays per-region temporal baselines and surfaces anomalies
 * when activity surges above or drops below the expected pattern.
 * Core of Activity-Based Intelligence (ABI).
 */

import { Panel } from './Panel';
import { detectAnomalies, getMonitoredRegions, type PatternAnomaly } from '@/services/pattern-of-life';
import { escapeHtml } from '@/utils/sanitize';

export class PatternOfLifePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'pattern-of-life',
 title: 'Pattern of Life',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Activity-Based Intelligence: monitors per-region event baselines over 30 days. Surfaces anomalies when activity surges or goes silent relative to the expected pattern for this hour of the week.',
 });
 this.showLoading('Building regional baselines\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 // Refresh every 5 minutes
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 5 * 60 * 1000);
  }

  private render(): void {
 const anomalies = detectAnomalies();
 const regionCount = getMonitoredRegions().length;

 this.setCount(anomalies.length);

 if (regionCount === 0) {
 this.setContent(`
 <div class="panel-empty">
 No regional data ingested yet. Baselines will build as event feeds report in over the next 24-48 hours.
 </div>
 `);
 return;
 }

 if (anomalies.length === 0) {
 this.setContent(`
 <div style="padding:12px;">
 <div class="pol-stats">${regionCount} regions monitored \u2502 All within normal parameters</div>
 <div class="panel-empty" style="margin-top:8px;">
 No pattern anomalies detected. Activity across all monitored regions is within expected baselines for this hour.
 </div>
 </div>
 `);
 return;
 }

 const anomalyCards = anomalies.slice(0, 20).map(a => this.renderAnomaly(a)).join('');

 this.setContent(`
 <div style="padding:8px 12px;">
 <div class="pol-stats">${regionCount} regions \u2502 ${anomalies.length} anomal${anomalies.length === 1 ? 'y' : 'ies'}</div>
 <div class="pol-list">${anomalyCards}</div>
 </div>
 `);
  }

  private renderAnomaly(a: PatternAnomaly): string {
 const icon = a.direction === 'surge' ? '\uD83D\uDCC8' : '\uD83D\uDD07'; // 📈 or 🔇
 const dirLabel = a.direction === 'surge' ? 'SURGE' : 'GOING DARK';
 const sevClass = Math.abs(a.zScore) >= 3 ? 'pol-critical' : 'pol-warning';
 const name = escapeHtml(a.regionName);

 return `<div class="pol-card ${sevClass}">
 <div class="pol-card-header">
 <span>${icon}</span>
 <span class="pol-region">${name}</span>
 <span class="pol-badge ${sevClass}">${dirLabel}</span>
 </div>
 <div class="pol-detail">
 ${Math.abs(a.zScore)}\u03C3 ${a.direction === 'surge' ? 'above' : 'below'} baseline \u2014
 ${a.currentCount} events (expected ~${a.expectedCount})
 </div>
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
