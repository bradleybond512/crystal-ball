import { Panel } from './Panel';
import type { FederalDocument } from '@/services/federal-register';
import { escapeHtml } from '@/utils/sanitize';

export class FederalRegisterPanel extends Panel {
  constructor() {
 super({
 id: 'federal-register',
 title: 'Federal Register',
 showCount: true,
 trackActivity: false,
 infoTooltip: 'Executive orders, major rules, and emergency declarations from the Federal Register.',
 });
 this.showLoading('Fetching Federal Register documents...');
  }

  public update(docs: FederalDocument[]): void {
 this.setCount(docs.length);
 this.render(docs);
  }

  private render(docs: FederalDocument[]): void {
 if (docs.length === 0) {
 this.setContent('<div class="panel-empty">No Federal Register documents available.</div>');
 return;
 }

 const rows = docs.slice(0, 15).map(doc => {
 const badgeText = doc.severity === 'critical' ? 'CRIT' : doc.severity === 'high' ? 'HIGH' : '—';
 const title = doc.title.length > 60 ? doc.title.slice(0, 60) + '…' : doc.title;
 return `<tr>
 <td><span class="badge badge-${escapeHtml(doc.severity)}">${badgeText}</span></td>
 <td>${escapeHtml(title)}</td>
 <td style="opacity:0.65;white-space:nowrap">${escapeHtml(doc.agency.slice(0, 30))}</td>
 <td style="opacity:0.55;white-space:nowrap">${escapeHtml(doc.date)}</td>
 </tr>`;
 }).join('');

 this.setContent(`
 <div class="ct-panel-content">
 <table class="eq-table ct-table">
 <thead>
 <tr>
 <th>Sev</th>
 <th>Title</th>
 <th>Agency</th>
 <th>Date</th>
 </tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer">
 <span class="fires-source">Federal Register — federalregister.gov</span>
 </div>
 </div>
 `);
  }
}
