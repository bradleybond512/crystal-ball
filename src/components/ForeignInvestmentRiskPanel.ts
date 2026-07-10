import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  statusBadgeClass,
  riskClass,
  rankSectorsByExposure,
  type FDITransaction,
  type SectorExposure,
} from './foreign-investment-risk-helpers';

const REFRESH_MS = 15 * 60 * 1000;

export class ForeignInvestmentRiskPanel extends Panel {
  static readonly panelId = 'foreign-investment-risk';
  static readonly title = 'Foreign Investment Risk';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'foreign-investment-risk',
      title: 'Foreign Investment Risk Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'CFIUS and allied-body FDI review outcomes (blocked / conditioned / approved), sector-level foreign ownership exposure, and high-risk deal tracking across semiconductors, AI, telecom, energy, and defense.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private render(): void {
    const data = buildRenderData();
    this.setCount(data.highRiskCount);
    this.setContent(this.buildHtml(data));
  }

  private buildHtml(data: ReturnType<typeof buildRenderData>): string {
    const {
      transactions,
      sectorExposures,
      blockRate,
      approvalRate,
      pendingCount,
      highRiskCount,
      totalValueBlockedBn,
    } = data;
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${this.renderMetrics(blockRate, approvalRate, pendingCount, highRiskCount, totalValueBlockedBn)}
      ${this.renderTransactions(transactions)}
      ${this.renderSectors(sectorExposures)}
    </div>`;
  }

  private renderMetrics(
    blockRate: number,
    approvalRate: number,
    pendingCount: number,
    highRiskCount: number,
    totalValueBlockedBn: number,
  ): string {
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px;">
      ${this.metricCard('Block Rate', `${blockRate}%`, '#d50000')}
      ${this.metricCard('Approval Rate', `${approvalRate}%`, '#4caf50')}
      ${this.metricCard('Pending Review', String(pendingCount), '#ff9800')}
      ${this.metricCard('High Risk', String(highRiskCount), '#d50000')}
      ${this.metricCard('Blocked Value', `$${totalValueBlockedBn.toFixed(0)}B`, '#ff5722')}
    </div>`;
  }

  private metricCard(label: string, value: string, color: string): string {
    return `<div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px 10px;">
      <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">${escapeHtml(label)}</div>
      <div style="font-size:16px;font-weight:700;color:${color};">${escapeHtml(value)}</div>
    </div>`;
  }

  private renderTransactions(transactions: FDITransaction[]): string {
    if (transactions.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Notable FDI Reviews</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No transactions available.</div>
      </div>`;
    }
    const rows = transactions.map((tx) => this.renderTransaction(tx)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Notable FDI Reviews (${transactions.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderTransaction(tx: FDITransaction): string {
    const riskColor = this.riskColor(tx.riskLevel);
    const statusColor = this.statusColor(tx.status);
    const valueLabel = tx.dealValueBn > 0 ? ` · $${tx.dealValueBn}B` : '';
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${riskColor};border-radius:3px;padding:6px 8px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;">
        <div style="min-width:0;flex:1;">
          <span style="font-weight:600;">${escapeHtml(tx.acquirer)}</span>
          <span style="color:var(--text-secondary,#aaa);"> → </span>
          <span style="font-weight:600;">${escapeHtml(tx.target)}</span>
        </div>
        <span style="font-size:10px;font-weight:700;color:${statusColor};text-transform:uppercase;white-space:nowrap;">${escapeHtml(statusBadgeClass(tx.status).replace('status-', ''))}</span>
      </div>
      <div style="margin-top:2px;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(tx.targetSector)} · ${escapeHtml(tx.reviewBody)} · ${tx.year}${escapeHtml(valueLabel)}</div>
      <div style="margin-top:2px;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(tx.notes)}</div>
    </div>`;
  }

  private renderSectors(sectorExposures: SectorExposure[]): string {
    if (sectorExposures.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Sector Exposure</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No sector data available.</div>
      </div>`;
    }
    const ranked = rankSectorsByExposure(sectorExposures);
    const rows = ranked.map((sec) => this.renderSector(sec)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Sector Exposure</div>
      <div style="display:flex;flex-direction:column;gap:3px;">${rows}</div>
    </div>`;
  }

  private renderSector(sec: SectorExposure): string {
    const senColor = this.riskColor(sec.sensitivityLevel);
    const actors = sec.topForeignActors.join(', ');
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${senColor};border-radius:3px;font-size:11px;gap:8px;">
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;">${escapeHtml(sec.sector)}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(actors)}</div>
      </div>
      <div style="text-align:right;white-space:nowrap;">
        <div style="font-size:12px;font-weight:700;">${sec.foreignOwnershipPct}% foreign</div>
        <div style="font-size:10px;font-weight:700;color:${senColor};text-transform:uppercase;">${escapeHtml(riskClass(sec.sensitivityLevel).replace('risk-', ''))}</div>
      </div>
    </div>`;
  }

  private riskColor(level: string): string {
    if (level === 'Critical') return '#d50000';
    if (level === 'High') return '#ff9800';
    if (level === 'Medium') return '#ffeb3b';
    return '#9e9e9e';
  }

  private statusColor(status: FDITransaction['status']): string {
    if (status === 'Blocked') return '#d50000';
    if (status === 'Pending') return '#ff9800';
    if (status === 'Conditioned') return '#ffeb3b';
    if (status === 'Approved') return '#4caf50';
    return '#9e9e9e';
  }
}
