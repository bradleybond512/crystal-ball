/**
 * Critical Infrastructure Attack Panel — Security category, 30-minute refresh.
 *
 * Displays confirmed physical/cyber attacks on power grids, water systems,
 * communications, and transport infrastructure. Attribution, severity, and
 * recovery-status tracking with risk scoring.
 */

import { Panel } from './Panel';
import {
  buildAttackSummary,
  filterActiveAttacks,
  sortAttacksBySeverity,
  formatSector,
  formatVector,
  formatRecoveryStatus,
  formatAttributionConfidence,
  sampleInfraAttackEvents,
  type InfraAttackEvent,
  type InfraAttackSummary,
} from './critical-infra-attack-helpers';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes
const ACTIVE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const SEVERITY_COLOR: Record<InfraAttackEvent['severity'], string> = {
  critical: '#d50000',
  high: '#ff9800',
  medium: '#ffeb3b',
  low: '#4caf50',
};

const RECOVERY_COLOR: Record<InfraAttackEvent['recoveryStatus'], string> = {
  ongoing: '#d50000',
  recovering: '#ff9800',
  contained: '#4caf50',
  unknown: '#9e9e9e',
};

const RISK_LABEL_COLOR: Record<InfraAttackSummary['riskLabel'], string> = {
  Severe: '#d50000',
  High: '#ff9800',
  Elevated: '#ffeb3b',
  Guarded: '#4caf50',
  Low: '#9e9e9e',
};

export class CriticalInfrastructureAttackPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private events: InfraAttackEvent[];

  constructor(events?: InfraAttackEvent[]) {
    super({
      id: 'critical-infra-attack',
      title: 'Critical Infrastructure Attacks',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Confirmed attacks on critical infrastructure (power grids, water systems, ' +
        'communications, transport). Risk score weights severity × vector × recency. ' +
        'Data refreshes every 30 minutes.',
    });
    this.events = events ?? sampleInfraAttackEvents();
    this.start();
  }

  /** Replace the current event set and re-render. */
  public setEvents(events: InfraAttackEvent[]): void {
    this.events = events;
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    const active = filterActiveAttacks(this.events, ACTIVE_WINDOW_MS);
    const summary = buildAttackSummary(active);
    this.setCount(summary.criticalCount + summary.ongoingCount);
    this.setContent(this.buildHtml(summary, active));
  }

  private buildHtml(summary: InfraAttackSummary, events: InfraAttackEvent[]): string {
    const sorted = sortAttacksBySeverity(events);
    return `
      ${this.buildRiskBanner(summary)}
      ${this.buildSummaryStats(summary)}
      ${this.buildEventTable(sorted)}
    `;
  }

  private buildRiskBanner(summary: InfraAttackSummary): string {
    const hasCritical = summary.criticalCount > 0 || summary.ongoingCount > 0;
    if (!hasCritical) return '';
    const bits: string[] = [];
    if (summary.criticalCount > 0) bits.push(`${summary.criticalCount} CRITICAL`);
    if (summary.ongoingCount > 0) bits.push(`${summary.ongoingCount} ONGOING`);
    return `<div style="padding:6px 12px;background:rgba(213,0,0,0.12);border-bottom:1px solid rgba(213,0,0,0.3);font-size:11px;font-weight:700;color:#d50000;letter-spacing:0.04em;">
      ⚠ INFRA ALERTS: ${escapeHtml(bits.join(' · '))}
    </div>`;
  }

  private buildSummaryStats(summary: InfraAttackSummary): string {
    const labelColor = RISK_LABEL_COLOR[summary.riskLabel];
    return `
      <div style="display:flex;align-items:center;gap:16px;padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);flex-wrap:wrap;">
        <div style="text-align:center;">
          <div style="font-size:22px;font-weight:700;color:${labelColor};font-family:ui-monospace,monospace;">${summary.riskScore}</div>
          <div style="font-size:10px;color:var(--text-secondary,#888);text-transform:uppercase;letter-spacing:0.06em;">Risk Score</div>
        </div>
        <div style="width:1px;height:36px;background:var(--border-subtle,#333);"></div>
        <div style="text-align:center;">
          <div style="font-size:14px;font-weight:700;color:${labelColor};padding:2px 8px;border:1px solid ${labelColor};border-radius:3px;letter-spacing:0.04em;">${escapeHtml(summary.riskLabel)}</div>
          <div style="font-size:10px;color:var(--text-secondary,#888);margin-top:2px;text-transform:uppercase;letter-spacing:0.06em;">Posture</div>
        </div>
        <div style="width:1px;height:36px;background:var(--border-subtle,#333);"></div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          ${this.buildStatPill(String(summary.totalAttacks), 'Total')}
          ${this.buildStatPill(String(summary.criticalCount), 'Critical', '#d50000')}
          ${this.buildStatPill(String(summary.ongoingCount), 'Ongoing', '#ff9800')}
        </div>
      </div>
      <div style="display:flex;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border-subtle,#333);flex-wrap:wrap;">
        ${this.buildSectorBar(summary)}
      </div>
    `;
  }

  private buildStatPill(value: string, label: string, color = '#aaa'): string {
    return `<div style="text-align:center;">
      <div style="font-size:16px;font-weight:700;color:${color};font-family:ui-monospace,monospace;">${escapeHtml(value)}</div>
      <div style="font-size:10px;color:var(--text-secondary,#888);text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(label)}</div>
    </div>`;
  }

  private buildSectorBar(summary: InfraAttackSummary): string {
    const sectors = Object.entries(summary.bySector) as [InfraAttackEvent['sector'], number][];
    return sectors
      .filter(([, count]) => count > 0)
      .map(([sector, count]) =>
        `<span style="font-size:10px;background:rgba(255,255,255,0.06);padding:2px 7px;border-radius:10px;color:var(--text-secondary,#aaa);">
          ${escapeHtml(formatSector(sector))}: ${count}
        </span>`,
      )
      .join('');
  }

  private buildEventTable(events: InfraAttackEvent[]): string {
    if (events.length === 0) {
      return `<div style="padding:20px;text-align:center;color:var(--text-secondary,#888);font-size:12px;">No infrastructure attacks in the active window.</div>`;
    }
    const rows = events.map((ev) => this.buildEventRow(ev)).join('');
    return `
      <div style="padding:8px 10px;font-size:11px;color:var(--text-secondary,#888);">
        ${events.length} attack${events.length === 1 ? '' : 's'} · sorted by severity · active within 90 days
      </div>
      <table role="table" style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="text-align:left;color:var(--text-secondary,#888);border-bottom:1px solid var(--border-subtle,#333);">
            <th scope="col" style="padding:6px 10px;font-weight:600;">Location</th>
            <th scope="col" style="padding:6px 10px;font-weight:600;">Sector</th>
            <th scope="col" style="padding:6px 10px;font-weight:600;">Vector</th>
            <th scope="col" style="padding:6px 10px;font-weight:600;">Severity</th>
            <th scope="col" style="padding:6px 10px;font-weight:600;">Status</th>
            <th scope="col" style="padding:6px 10px;font-weight:600;">Attribution</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  private buildEventRow(ev: InfraAttackEvent): string {
    const sevColor = SEVERITY_COLOR[ev.severity];
    const recColor = RECOVERY_COLOR[ev.recoveryStatus];
    const attribution = ev.attribution
      ? `${escapeHtml(ev.attribution)} (${escapeHtml(formatAttributionConfidence(ev.attributionConfidence))})`
      : `Unknown (${escapeHtml(formatAttributionConfidence(ev.attributionConfidence))})`;
    return `<tr title="${escapeHtml(ev.description)}" style="border-bottom:1px solid var(--border-subtle,#222);">
      <td style="padding:7px 10px;font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(ev.location)}">${escapeHtml(ev.location)}</td>
      <td style="padding:7px 10px;color:var(--text-secondary,#aaa);">${escapeHtml(formatSector(ev.sector))}</td>
      <td style="padding:7px 10px;color:var(--text-secondary,#aaa);">${escapeHtml(formatVector(ev.vector))}</td>
      <td style="padding:7px 10px;">
        <span style="font-size:10px;font-weight:700;color:${sevColor};text-transform:uppercase;letter-spacing:0.06em;padding:1px 5px;border:1px solid ${sevColor};border-radius:2px;">${escapeHtml(ev.severity)}</span>
      </td>
      <td style="padding:7px 10px;">
        <span style="font-size:10px;font-weight:600;color:${recColor};">${escapeHtml(formatRecoveryStatus(ev.recoveryStatus))}</span>
      </td>
      <td style="padding:7px 10px;color:var(--text-secondary,#aaa);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(attribution)}">${escapeHtml(attribution)}</td>
    </tr>`;
  }
}
