import { Panel } from './Panel';
import type { SanctionedEntity } from '@/services/opensanctions';
import { escapeHtml } from '@/utils/sanitize';

export class OpenSanctionsPanel extends Panel {
  private entities: SanctionedEntity[] = [];

  constructor() {
 super({
 id: 'opensanctions',
 title: 'Global Sanctions',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Recently sanctioned entities from OpenSanctions — individuals, companies, and organizations on global watchlists.',
 });
 this.showLoading('Fetching sanctions data...');
  }

  public update(entities: SanctionedEntity[]): void {
 this.entities = entities;
 this.setCount(entities.length);
 this.render();
  }

  private render(): void {
 if (this.entities.length === 0) {
 this.setContent('<div class="panel-empty">No sanctions data available.</div>');
 return;
 }

 const rows = this.entities.slice(0, 15).map(e => {
 const country = e.countries.length > 0 ? e.countries[0]!.toUpperCase() : '—';
 const dataset = e.datasets.length > 0 ? e.datasets[0]! : '—';
 const date = e.firstSeen ? new Date(e.firstSeen).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—';
 return `<tr>
 <td>${escapeHtml(e.name.length > 40 ? e.name.slice(0, 40) + '…' : e.name)}</td>
 <td>${escapeHtml(country)}</td>
 <td style="opacity:0.7;font-size:0.85em">${escapeHtml(dataset.length > 20 ? dataset.slice(0, 20) + '…' : dataset)}</td>
 <td style="opacity:0.6;white-space:nowrap">${date}</td>
 </tr>`;
 }).join('');

 this.setContent(`
 <div class="ct-panel-content">
 <table class="eq-table ct-table">
 <thead>
 <tr>
 <th>Name</th>
 <th>Country</th>
 <th>List</th>
 <th>Date</th>
 </tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer">
 <span class="fires-source">OpenSanctions</span>
 </div>
 </div>
 `);
  }
}
