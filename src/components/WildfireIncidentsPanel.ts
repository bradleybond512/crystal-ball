import { Panel } from './Panel';
import type { IncidentReport } from '@/services/inciweb';
import { inciwebSeverityClass, containmentBar } from '@/services/inciweb';
import { escapeHtml } from '@/utils/sanitize';

export class WildfireIncidentsPanel extends Panel {
  private incidents: IncidentReport[] = [];

  constructor() {
 super({
 id: 'wildfire-incidents',
 title: 'Wildfires (InciWeb)',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Active US wildfire incidents from InciWeb — containment %, acres burned, evacuation orders.',
 });
 this.showLoading('Fetching wildfire incidents...');
  }

  public update(incidents: IncidentReport[]): void {
 this.incidents = incidents;
 this.setCount(incidents.length);
 this.render();
  }

  private render(): void {
 if (this.incidents.length === 0) {
 this.setContent('<div class="panel-empty">No active wildfire incidents reported.</div>');
 return;
 }

 const rows = this.incidents.slice(0, 50).map(r => {
 const rowClass = inciwebSeverityClass(r.severity);
 const evac = r.evacuationOrders
 ? '<span class="sev-badge" style="background:var(--semantic-critical)">EVAC</span>'
 : r.evacuationWarnings
 ? '<span class="sev-badge" style="background:var(--semantic-high)">WARN</span>'
 : '';
 const acres = r.acresBurned !== null ? r.acresBurned.toLocaleString() : '—';
 // All dynamic content is escaped with escapeHtml() before insertion
 return `<tr class="${rowClass}">
 <td>${evac}</td>
 <td>${escapeHtml(r.name.length > 45 ? r.name.slice(0, 43) + '…' : r.name)}</td>
 <td>${escapeHtml(r.state)}</td>
 <td>${acres}</td>
 <td>${containmentBar(r.percentContained)}</td>
 <td>${escapeHtml(r.cause)}</td>
 </tr>`;
 }).join('');

 this.setContent(`
 <div class="ct-panel-content">
 <table class="eq-table ct-table">
 <thead>
 <tr><th></th><th>Incident</th><th>State</th><th>Acres</th><th>Cont.</th><th>Cause</th></tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer">
 <span class="fires-source">InciWeb — USFS National Interagency Incident Management</span>
 </div>
 </div>
 `);
  }
}
