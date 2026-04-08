import { Panel } from './Panel';
import type { EdgarFiling } from '@/services/sec-edgar';
import { escapeHtml } from '@/utils/sanitize';

export class EdgarFilingsPanel extends Panel {
  private filings: EdgarFiling[] = [];

  constructor() {
 super({
 id: 'edgar-filings',
 title: 'SEC EDGAR Filings',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Recent SEC EDGAR filings — 10-K, 10-Q, 8-K, and other regulatory disclosures.',
 });
 this.showLoading('Fetching SEC filings...');
  }

  public update(filings: EdgarFiling[]): void {
 this.filings = filings;
 this.setCount(filings.length);
 this.render();
  }

  private render(): void {
 if (this.filings.length === 0) {
 this.setContent('<div class="panel-empty">No SEC filings available.</div>');
 return;
 }

 const rows = this.filings.slice(0, 15).map(f => {
 const date = f.filedAt ? new Date(f.filedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
 return `<tr>
 <td>${escapeHtml(f.company.length > 30 ? f.company.slice(0, 30) + '…' : f.company)}</td>
 <td><span class="sev-badge">${escapeHtml(f.formType)}</span></td>
 <td style="opacity:0.7;font-size:0.85em">${escapeHtml(f.description.length > 35 ? f.description.slice(0, 35) + '…' : f.description)}</td>
 <td style="opacity:0.6;white-space:nowrap">${date}</td>
 </tr>`;
 }).join('');

 this.setContent(`
 <div class="ct-panel-content">
 <table class="eq-table ct-table">
 <thead>
 <tr>
 <th>Company</th>
 <th>Form</th>
 <th>Description</th>
 <th>Filed</th>
 </tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer">
 <span class="fires-source">SEC EDGAR</span>
 </div>
 </div>
 `);
  }
}
