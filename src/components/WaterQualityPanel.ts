import { Panel } from './Panel';
import type { WaterQualityData, WaterAlert, WaterAlertType, WaterSystem, WaterAlertSeverity } from '@/services/water-quality';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';
import { locationBannerHtml, wireLocationBanner } from '@/components/location-gate';

export class WaterQualityPanel extends Panel {
  private data: WaterQualityData | null = null;
  private lastUpdated: Date | null = null;

  constructor() {
 super({
 id: 'water-quality',
 title: 'Water Quality',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Drinking water safety from EPA SDWIS violations and USGS water quality sensors. Boil water advisories, contamination alerts, and treatment plant status.',
 });
 this.showLoading('Fetching water quality data...');
  }

  public update(data: WaterQualityData): void {
 this.data = data;
 this.lastUpdated = new Date();
 this.setCount(data.alerts.length);
 this.render();
  }

  private render(): void {
 if (!this.data) {
 this.setContent('<div class="panel-empty">Water quality data unavailable.</div>');
 return;
 }

 const { alerts, systems, summary } = this.data;
 const locBanner = locationBannerHtml();

 // Summary bar
 const summaryHtml = `
 <div class="wq-summary">
 <span class="wq-badge wq-safe">${summary.safeSystems} Safe</span>
 <span class="wq-badge wq-advisory">${summary.advisorySystems} Advisory</span>
 <span class="wq-badge wq-dnu">${summary.doNotUseSystems} Do-Not-Use</span>
 </div>
 `;

 // Active alerts
 let alertsHtml = '';
 if (alerts.length > 0) {
 const alertRows = alerts.slice(0, 20).map(a => renderAlert(a)).join('');
 alertsHtml = `
 <div class="wq-section">
 <h4 class="wq-section-title">Active Advisories (${alerts.length})</h4>
 <div class="wq-alerts">${alertRows}</div>
 </div>
 `;
 }

 // Water systems table
 const systemRows = systems.slice(0, 25).map(s => renderSystem(s)).join('');
 const systemsHtml = `
 <div class="wq-section">
 <h4 class="wq-section-title">Water Systems (${systems.length})</h4>
 <table class="eq-table">
 <thead>
 <tr>
 <th>System</th>
 <th>State</th>
 <th>Status</th>
 <th>Violations</th>
 <th>Distance</th>
 </tr>
 </thead>
 <tbody>${systemRows}</tbody>
 </table>
 </div>
 `;

 const updatedStr = this.lastUpdated ? formatTime(this.lastUpdated) : 'never';

 this.setContent(`
 <div class="wq-panel-content">
 ${locBanner}
 ${summaryHtml}
 ${alertsHtml}
 ${systemsHtml}
 <div class="fires-footer">
 <span class="fires-source">EPA SDWIS · USGS Water Services</span>
 <span class="fires-updated">Updated ${updatedStr}</span>
 </div>
 </div>
 `);
 wireLocationBanner(this.getContentElement(), () => { this.render(); });
  }
}

function renderAlert(alert: WaterAlert): string {
  const sevClass = severityClass(alert.severity);
  const alertIcons: Record<WaterAlertType, string> = {
 'boil-water': '🔥',
 'do-not-use': '🚫',
 contamination: '⚠️',
 'treatment-outage': '🔧',
 general: 'ℹ️',
  };
  const icon = alertIcons[alert.type] ?? 'ℹ️';

  const dateStr = alert.issuedAt.toLocaleDateString();

  return `
 <div class="wq-alert ${sevClass}">
 <span class="wq-alert-icon">${icon}</span>
 <div class="wq-alert-body">
 <div class="wq-alert-title">${escapeHtml(alert.title)}</div>
 <div class="wq-alert-desc">${escapeHtml(alert.description)}</div>
 <div class="wq-alert-meta">${escapeHtml(alert.state)} · ${dateStr}</div>
 </div>
 </div>
  `;
}

function renderSystem(sys: WaterSystem): string {
  const statusClsMap: Record<WaterAlertSeverity, string> = {
 'do-not-use': 'eq-row eq-major',
 advisory: 'eq-row eq-moderate',
 safe: 'eq-row',
  };
  const cls = statusClsMap[sys.status];

  const statusBadge = `<span class="wq-status-dot wq-status-${sys.status}">${statusLabel(sys.status)}</span>`;
  const distStr = sys.distanceKm === null ? '—' : `${Math.round(sys.distanceKm)} km`;

  return `<tr class="${cls}">
 <td>${escapeHtml(sys.name)}</td>
 <td>${escapeHtml(sys.state)}</td>
 <td>${statusBadge}</td>
 <td>${sys.violations}</td>
 <td>${distStr}</td>
  </tr>`;
}

function statusLabel(status: WaterAlertSeverity): string {
  const labels: Record<WaterAlertSeverity, string> = {
 safe: 'Safe',
 advisory: 'Advisory',
 'do-not-use': 'Do Not Use',
  };
  return labels[status];
}

function severityClass(severity: WaterAlertSeverity): string {
  if (severity === 'do-not-use') return 'wq-alert-critical';
  if (severity === 'advisory') return 'wq-alert-warning';
  return 'wq-alert-info';
}

