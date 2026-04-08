import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { DebrisReentry } from '@/services/aerospace-reentry';
import { reentrySeverityClass } from '@/services/aerospace-reentry';

export class AerospaceReentryPanel extends Panel {
  constructor() {
 super({ id: 'aerospace-reentry', title: 'Aerospace Reentry', showCount: true, trackActivity: false });
 this.showLoading('Loading reentry predictions...');
  }

  updatePredictions(predictions: DebrisReentry[]): void {
 this.setCount(predictions.length);
 if (predictions.length === 0) {
 this.setContent('<div class="panel-empty">No reentry predictions available.</div>');
 return;
 }
 const rows = predictions.map(p => {
 const cls = reentrySeverityClass(p.severity);
 const time = p.predictedTime ? p.predictedTime.toUTCString().slice(0, 22) : 'TBD';
 const adversaryBadge = p.isAdversaryObject
 ? `<span class="sev-badge" style="background:rgba(220,50,50,0.25);color:#f87171;font-size:9px;padding:1px 4px;border-radius:3px">ADVERSARY</span> `
 : '';
 return `<tr class="${cls}">
 <td style="font-size:10px;white-space:nowrap">${escapeHtml(time)}</td>
 <td>${adversaryBadge}<span style="font-weight:600;font-size:11px">${escapeHtml(p.objectName)}</span>
 <div style="font-size:10px;opacity:0.55">${escapeHtml(p.country)} · ${escapeHtml(p.objectType)}</div>
 </td>
 <td style="font-size:10px">${escapeHtml(p.survivability)}</td>
 </tr>`;
 }).join('');
 this.setContent(`<div style="overflow-y:auto;max-height:100%"><table class="eq-table">
 <thead><tr><th>Time (UTC)</th><th>Object</th><th>Survivability</th></tr></thead>
 <tbody>${rows}</tbody>
 </table></div>`);
  }
}
