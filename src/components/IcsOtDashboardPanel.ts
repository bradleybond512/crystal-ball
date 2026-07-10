/**
 * ICS/OT Security Dashboard Panel
 *
 * Dragos-inspired unified view of industrial control system assets,
 * their security status, alerts, and sector-level risk scores.
 */

import { Panel } from './Panel';
import {
  getOtDashboard,
  getOtAlerts,
  getSectorRisk,
  type OtAlert,
} from '@/services/ics-ot-monitor';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const SEV_ICONS: Record<string, string> = {
  critical: '\uD83D\uDD34',
  high: '\uD83D\uDFE0',
  medium: '\uD83D\uDFE1',
  low: '\uD83D\uDFE2',
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  unauthorized_access: 'Unauthorized Access',
  firmware_change: 'Firmware Change',
  protocol_anomaly: 'Protocol Anomaly',
  network_scan: 'Network Scan',
  policy_violation: 'Policy Violation',
  connection_anomaly: 'Connection Anomaly',
};

export class IcsOtDashboardPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'ics-ot-dashboard',
 title: 'ICS/OT Dashboard',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Dragos-inspired industrial control system security dashboard. Monitors OT assets (PLCs, RTUs, SCADA, HMIs), tracks security alerts, and provides sector-level risk assessment.',
 });
 this.showLoading('Scanning OT assets\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 90 * 1000);
  }

  private render(): void {
 const dash = getOtDashboard();
 const sectors = getSectorRisk();
 const alerts = getOtAlerts();

 this.setCount(dash.criticalAlerts.length);

 if (dash.totalAssets === 0) {
 this.setContent(`
 <div class="panel-empty">
 No OT assets registered. Industrial control system assets (PLCs, RTUs, SCADA servers, HMIs) will appear here as they are discovered or manually registered.
 </div>
 `);
 return;
 }

 const statusBar = `<div class="ot-status-bar">
 <span class="ot-stat ot-online">\u2705 ${dash.onlineCount} Online</span>
 <span class="ot-stat ot-offline">\u26AA ${dash.offlineCount} Offline</span>
 <span class="ot-stat ot-compromised">\uD83D\uDD34 ${dash.compromisedCount} Compromised</span>
 <span class="ot-stat ot-alerts">\u26A0\uFE0F ${dash.alertCount24h} Alerts (24h)</span>
 </div>`;

 const sectorHtml = sectors.length > 0 ? `
 <div class="ot-section-title">SECTOR RISK</div>
 <div class="ot-sectors">${sectors.map(s => {
 const riskColor = s.riskScore >= 70 ? '#e53e3e' : s.riskScore >= 40 ? '#ed8936' : '#38a169';
 return `<div class="ot-sector-row">
 <span class="ot-sector-name">${escapeHtml(s.sector)}</span>
 <span class="ot-sector-assets">${s.assetCount} assets</span>
 <span class="ot-sector-risk" style="color:${riskColor}">${s.riskScore}%</span>
 </div>`;
 }).join('')}</div>
 ` : '';

 const alertHtml = alerts.length > 0 ? `
 <div class="ot-section-title">RECENT ALERTS</div>
 <div class="ot-alerts-list">${alerts.slice(0, 15).map(a => this.renderAlert(a)).join('')}</div>
 ` : '';

 this.setContent(`
 <div style="padding:8px 12px;">
 ${statusBar}
 ${sectorHtml}
 ${alertHtml}
 </div>
 `);
  }

  private renderAlert(a: OtAlert): string {
 const icon = SEV_ICONS[a.severity] ?? '\u2B55';
 const typeLabel = ALERT_TYPE_LABELS[a.alertType] ?? a.alertType;
 const time = formatTime(new Date(a.timestamp));
 const mitre = a.mitreTactic ? `<span class="ot-mitre">${escapeHtml(a.mitreTactic)}</span>` : '';

 return `<div class="ot-alert-card ot-sev-${a.severity}">
 <div class="ot-alert-header">
 <span>${icon}</span>
 <span class="ot-alert-type">${escapeHtml(typeLabel)}</span>
 <span class="ot-alert-asset">${escapeHtml(a.assetName)}</span>
 ${mitre}
 </div>
 <div class="ot-alert-desc">${escapeHtml(a.description)}</div>
 <div class="ot-alert-time">${time}</div>
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
