import { Panel } from './Panel';
import type { HazmatIncident } from '@/services/hazmat-incidents';
import { hazmatSeverityClass } from '@/services/hazmat-incidents';
import { escapeHtml } from '@/utils/sanitize';

export class HazmatIncidentsPanel extends Panel {
  private incidents: HazmatIncident[] = [];

  constructor() {
 super({
 id: 'hazmat-incidents',
 title: 'Hazmat Incidents',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'US chemical, pipeline, and hazardous material incidents from EPA, Chemical Safety Board, and PHMSA.',
 });
 this.showLoading('Fetching hazmat incidents...');
  }

  public update(incidents: HazmatIncident[]): void {
 this.incidents = incidents;
 this.setCount(incidents.length);
 this.render();
  }

  private render(): void {
 if (this.incidents.length === 0) {
 this.setContent('<div class="panel-empty">No recent hazmat incidents reported.</div>');
 return;
 }

 const rows = this.incidents.slice(0, 50).map(r => {
 const rowClass = hazmatSeverityClass(r.severity);
 const date = r.reportedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
 const title = r.title.length > 50 ? r.title.slice(0, 48) + '…' : r.title;
 // All dynamic content escaped before insertion
 return `<tr class="${rowClass}">
 <td><span class="sev-badge">${escapeHtml(r.source)}</span></td>
 <td>${escapeHtml(title)}</td>
 <td>${escapeHtml(r.chemical)}</td>
 <td>${escapeHtml(r.state)}</td>
 <td>${date}</td>
 </tr>`;
 }).join('');

 this.setContent(`
 <div class="ct-panel-content">
 <table class="eq-table ct-table">
 <thead>
 <tr><th>Source</th><th>Incident</th><th>Chemical</th><th>State</th><th>Date</th></tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer">
 <span class="fires-source">EPA · Chemical Safety Board · PHMSA</span>
 </div>
 </div>
 `);
  }
}
