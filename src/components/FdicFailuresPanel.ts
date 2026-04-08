import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { FdicFailureSummary } from '@/services/fdic-failures';
import { bankFailureSeverityClass } from '@/services/fdic-failures';

export class FdicFailuresPanel extends Panel {
  constructor() {
 super({ id: 'fdic-failures', title: 'FDIC Bank Failures', showCount: true, trackActivity: false });
 this.showLoading('Loading bank failure data...');
  }

  updateSummary(summary: FdicFailureSummary): void {
 this.setCount(summary.failures.length);
 if (summary.failures.length === 0) {
 this.setContent('<div class="panel-empty">No recent bank failures.</div>');
 return;
 }
 const rows = summary.failures.map(f => {
 const cls = bankFailureSeverityClass(f.severity);
 const assets = f.totalAssetsM >= 1000
 ? `$${(f.totalAssetsM / 1000).toFixed(1)}B`
 : `$${f.totalAssetsM.toFixed(0)}M`;
 const dateStr = f.failureDate.toLocaleDateString();
 return `<tr class="${cls}">
 <td style="font-weight:600;font-size:11px">${escapeHtml(f.institutionName)}<div style="font-size:10px;opacity:0.55">${escapeHtml(f.city)}, ${escapeHtml(f.state)}</div></td>
 <td style="font-size:11px;white-space:nowrap">${escapeHtml(assets)}</td>
 <td style="font-size:10px;white-space:nowrap">${escapeHtml(dateStr)}</td>
 </tr>`;
 }).join('');
 this.setContent(`<div style="overflow-y:auto;max-height:100%"><table class="eq-table">
 <thead><tr><th>Institution</th><th>Assets</th><th>Date</th></tr></thead>
 <tbody>${rows}</tbody>
 </table></div>`);
  }
}
