/**
 * Sanctions Cross-Ref Panel
 *
 * Cross-references entities against OFAC and other sanctions lists.
 * Displays match statistics, recent matches with confidence scores,
 * and a summary of watched entities by list source and type.
 */

import { Panel } from './Panel';
import {
  getSanctionsStats,
  getRecentMatches,
  type SanctionsStats,
  type SanctionsMatch,
} from '@/services/sanctions-crossref';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

export class SanctionsCrossRefPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'sanctions-crossref',
 title: 'Sanctions Cross-Ref',
 showCount: true,
 trackActivity: true,
 infoTooltip:
 'Cross-references monitored entities against OFAC, EU, and UN sanctions lists. Shows match confidence and list source breakdowns.',
 });
 this.showLoading('Loading sanctions data\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => {
 this.render();
 }, 60_000);
  }

  private render(): void {
 const stats = getSanctionsStats();
 const recentMatches = getRecentMatches(15);

 this.setCount(stats.totalMatches);

 if (stats.totalEntries === 0) {
 this.setContent(
 '<div class="panel-empty">No sanctions data available.</div>',
 );
 return;
 }

 const summaryHtml = this.renderSummary(stats);
 const matchesHtml = this.renderRecentMatches(recentMatches);
 const byListHtml = this.renderByList(stats.byList);
 const byTypeHtml = '';

 this.setContent(`
 <div class="ct-panel-content">
 ${summaryHtml}
 ${matchesHtml}
 ${byListHtml}
 ${byTypeHtml}
 </div>
 `);
  }

  private renderSummary(stats: SanctionsStats): string {
 return `<div class="anomaly-stats">
 <span class="anomaly-stat">${escapeHtml(String(stats.totalEntries))} entries</span>
 <span class="anomaly-stat-sep">\u2502</span>
 <span class="anomaly-stat">${escapeHtml(String(stats.totalMatches))} matches</span>
 <span class="anomaly-stat-sep">\u2502</span>
 <span class="anomaly-stat">${escapeHtml(String(stats.highConfidenceMatches))} high-conf</span>
 </div>`;
  }

  private renderRecentMatches(matches: SanctionsMatch[]): string {
 if (matches.length === 0) {
 return '<div class="anomaly-empty">No recent matches detected.</div>';
 }

 const rows = matches.slice(0, 15).map((m) => {
 const confidence = m.matchScore;
 const confColor =
 confidence >= 90
 ? 'var(--semantic-critical, #ff453a)'
 : confidence >= 70
 ? 'var(--semantic-high, #ff9800)'
 : 'var(--semantic-elevated, #ffeb3b)';
 const time = formatTime(new Date(m.checkedAt));
 const name =
 m.entityName.length > 35
 ? m.entityName.slice(0, 33) + '\u2026'
 : m.entityName;
 const source =
 m.context.length > 20
 ? m.context.slice(0, 18) + '\u2026'
 : m.context || m.matchedEntry.source;

 return `<tr>
 <td>${escapeHtml(name)}</td>
 <td>${escapeHtml(source)}</td>
 <td style="color:${confColor};font-weight:600;">${escapeHtml(String(confidence))}</td>
 <td style="opacity:0.6;white-space:nowrap;">${escapeHtml(time)}</td>
 </tr>`;
 }).join('');

 return `
 <div style="margin-top:8px;">
 <div style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">
 Recent Matches
 </div>
 <table class="eq-table ct-table">
 <thead>
 <tr>
 <th>Entity</th>
 <th>Matched In</th>
 <th>Conf.</th>
 <th>Time</th>
 </tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 </div>
 `;
  }

  private renderByList(byList: Record<string, number>): string {
 const entries = Object.entries(byList).sort(([, a], [, b]) => b - a);
 if (entries.length === 0) return '';

 const maxVal = entries[0]?.[1] ?? 1;
 const rows = entries.slice(0, 8).map(([list, count]) => {
 const pct = Math.round((count / maxVal) * 100);
 return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;">
 <span style="width:80px;font-size:11px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(list)}</span>
 <div style="flex:1;height:4px;background:var(--bg-tertiary);border-radius:2px;overflow:hidden;">
 <div style="width:${pct}%;height:100%;background:var(--accent-primary);border-radius:2px;"></div>
 </div>
 <span style="width:32px;text-align:right;font-size:11px;color:var(--text-secondary);">${escapeHtml(String(count))}</span>
 </div>`;
 }).join('');

 return `
 <div style="margin-top:10px;">
 <div style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">
 By List
 </div>
 ${rows}
 </div>
 `;
  }


  public override destroy(): void {
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }
}
