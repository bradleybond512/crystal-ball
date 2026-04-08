import { Panel } from './Panel';
import type { OilSpillIncident } from '@/services/oil-spill-tracker';
import { spillSeverityClass, spillTypeLabel } from '@/services/oil-spill-tracker';
import { escapeHtml } from '@/utils/sanitize';

export class OilSpillPanel extends Panel {
  private incidents: OilSpillIncident[] = [];

  constructor() {
 super({
 id: 'oil-spill',
 title: 'Oil & Chemical Spills',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Active oil spills and chemical releases tracked by NOAA Office of Response and Restoration.',
 });
 this.showLoading('Fetching spill data...');
  }

  public update(incidents: OilSpillIncident[]): void {
 this.incidents = incidents;
 this.setCount(incidents.filter(i => i.isOpen).length);
 this.render();
  }

  private render(): void {
 if (this.incidents.length === 0) {
 this.setContent('<div class="panel-empty">No recent oil or chemical spills reported.</div>');
 return;
 }

 const rows = this.incidents.slice(0, 50).map(r => {
 const rowClass = spillSeverityClass(r.severity);
 const status = r.isOpen
 ? '<span class="sev-badge" style="background:var(--semantic-critical)">OPEN</span>'
 : '<span class="sev-badge">CLOSED</span>';
 const name = r.name.length > 45 ? r.name.slice(0, 43) + '…' : r.name;
 const qty = r.quantity ? escapeHtml(r.quantity) : '—';
 const date = r.openDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
 // All dynamic content escaped before insertion
 return `<tr class="${rowClass}">
 <td>${status}</td>
 <td>${escapeHtml(name)}</td>
 <td>${escapeHtml(spillTypeLabel(r.type))}</td>
 <td>${escapeHtml(r.pollutant || '—')}</td>
 <td>${qty}</td>
 <td>${date}</td>
 </tr>`;
 }).join('');

 this.setContent(`
 <div class="ct-panel-content">
 <table class="eq-table ct-table">
 <thead>
 <tr><th>Status</th><th>Incident</th><th>Type</th><th>Pollutant</th><th>Qty</th><th>Date</th></tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer">
 <span class="fires-source">NOAA Office of Response and Restoration</span>
 </div>
 </div>
 `);
  }
}
