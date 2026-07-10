/**
 * Intel Report Panel
 *
 * Displays generated intelligence reports including SITREPs, INTSUMs,
 * SPOT reports, and warnings. Shows report statistics, type breakdown,
 * and recent reports with expandable summaries.
 */

import { Panel } from './Panel';
import {
  getReports,
  getReportCount,
  type IntelReport,
  type ReportType,
} from '@/services/intel-report';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const TYPE_BADGES: Record<ReportType, { label: string; color: string }> = {
  sitrep: { label: 'SITREP', color: '#4299e1' },
  intsum: { label: 'INTSUM', color: '#9f7aea' },
  warning: { label: 'WARNING', color: '#e53e3e' },
  assessment: { label: 'ASSESSMENT', color: '#ed8936' },
};


export class IntelReportPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private expandedReportId: string | null = null;

  constructor() {
 super({
 id: 'intel-report',
 title: 'Intel Reports',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Intelligence report generation and tracking. Displays SITREPs, INTSUMs, SPOT reports, and warnings with threat-level classification and regional context.',
 });
 this.showLoading('Loading intelligence reports\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 90 * 1000);
  }

  private render(): void {
 const totalReports = getReportCount();
 const reports: IntelReport[] = getReports();

 this.setCount(totalReports);

 if (totalReports === 0) {
 this.setContent(`
 <div class="panel-empty">
 No intelligence reports generated. Reports will appear as threat conditions trigger SITREP, INTSUM, WARNING, or ASSESSMENT generation.
 </div>
 `);
 return;
 }

 const typeCounts: Record<ReportType, number> = { sitrep: 0, intsum: 0, warning: 0, assessment: 0 };
 for (const r of reports) typeCounts[r.type]++;

 const typeChips = (Object.keys(typeCounts) as ReportType[])
 .filter(t => typeCounts[t] > 0)
 .map(t => {
 const badge = TYPE_BADGES[t];
 return `<span style="background:${badge.color};color:#fff;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;">${badge.label} (${typeCounts[t]})</span>`;
 })
 .join(' ');

 const latestReport = reports[0];
 const latestInfo = latestReport
 ? `Latest: ${escapeHtml(latestReport.title.length > 40 ? latestReport.title.slice(0, 38) + '\u2026' : latestReport.title)}`
 : '';

 const sortedReports = [...reports]
 .sort((a, b) => b.generatedAt - a.generatedAt)
 .slice(0, 15);

 const reportCards = sortedReports.map(report => {
 const badge = TYPE_BADGES[report.type] ?? { label: report.type, color: '#718096' };
 const title = escapeHtml(report.title.length > 60 ? report.title.slice(0, 58) + '\u2026' : report.title);
 const ts = formatTime(new Date(report.generatedAt));
 const classLabel = escapeHtml(report.classification.toUpperCase());
 const preparedBy = escapeHtml(report.preparedBy);
 const classColor = report.classification === 'confidential' ? '#e53e3e' : report.classification === 'fouo' ? '#ed8936' : '#68d391';
 const expanded = this.expandedReportId === report.id;

 const summaryHtml = expanded && report.executiveSummary
 ? `<div class="ir-summary" style="margin-top:6px;padding:6px 8px;font-size:12px;opacity:0.9;border-left:2px solid ${badge.color};background:rgba(255,255,255,0.03);">${escapeHtml(report.executiveSummary)}</div>`
 : '';

 return `<div class="ir-report-card" data-report-id="${report.id}" style="cursor:pointer;">
 <div class="ir-report-header" style="display:flex;align-items:center;gap:8px;">
 <span style="background:${badge.color};color:#fff;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:700;">${badge.label}</span>
 <span style="flex:1;font-weight:500;font-size:13px;">${title}</span>
 <span class="ir-classification" style="color:${classColor};font-size:11px;font-weight:600;">${classLabel}</span>
 </div>
 <div class="ir-report-meta" style="font-size:11px;opacity:0.7;margin-top:2px;">
 ${preparedBy} \u00B7 ${ts}
 </div>
 ${summaryHtml}
 </div>`;
 }).join('');

 this.setContent(`
 <div style="padding:8px 12px;">
 <div style="display:flex;gap:12px;font-size:12px;opacity:0.85;margin-bottom:6px;">
 <span>Total: <strong>${totalReports}</strong></span>
 <span style="opacity:0.7;">${latestInfo}</span>
 </div>
 <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">${typeChips}</div>
 <div style="font-size:11px;font-weight:600;text-transform:uppercase;opacity:0.7;margin-bottom:6px;">Recent Reports</div>
 <div class="ir-reports" style="display:flex;flex-direction:column;gap:8px;">${reportCards}</div>
 </div>
 `);

 this.getContentElement().querySelectorAll('.ir-report-card').forEach(card => {
 card.addEventListener('click', () => {
 const id = card.getAttribute('data-report-id');
 this.expandedReportId = this.expandedReportId === id ? null : id;
 this.render();
 });
 });
  }

  public override destroy(): void {
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }
}
