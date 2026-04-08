import { Panel } from './Panel';
import type { HumanitarianCrisis } from '@/services/hdx-crisis';
import { crisisTypeLabel, crisisSeverityClass } from '@/services/hdx-crisis';
import { escapeHtml } from '@/utils/sanitize';

export class HumanitarianCrisisPanel extends Panel {
  private crises: HumanitarianCrisis[] = [];

  constructor() {
 super({
 id: 'humanitarian-crisis',
 title: 'Humanitarian Crises',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Active humanitarian crises from UN OCHA Humanitarian Data Exchange — conflict, displacement, food insecurity, and disaster datasets.',
 });
 this.showLoading('Fetching humanitarian crisis data...');
  }

  public update(crises: HumanitarianCrisis[]): void {
 this.crises = crises;
 this.setCount(crises.length);
 this.render();
  }

  private render(): void {
 if (this.crises.length === 0) {
 this.setContent('<div class="panel-empty">No active humanitarian crises.</div>');
 return;
 }

 const rows = this.crises.slice(0, 15).map(c => {
 const rowClass = crisisSeverityClass(c.severity);
 const updated = c.updatedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
 const country = c.country || c.countryCode || '—';
 return `<tr class="${rowClass}">
 <td><span class="sev-badge">${escapeHtml(crisisTypeLabel(c.crisisType))}</span></td>
 <td>${escapeHtml(country)}</td>
 <td><a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer"
 style="color:inherit;text-decoration:none">${escapeHtml(c.title.slice(0, 55))}${c.title.length > 55 ? '…' : ''}</a></td>
 <td style="opacity:0.6;white-space:nowrap">${updated}</td>
 </tr>`;
 }).join('');

 this.setContent(`
 <div class="ct-panel-content">
 <table class="eq-table ct-table">
 <thead>
 <tr>
 <th>Type</th>
 <th>Country</th>
 <th>Dataset</th>
 <th>Updated</th>
 </tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer">
 <span class="fires-source">UN OCHA Humanitarian Data Exchange</span>
 </div>
 </div>
 `);
  }
}
