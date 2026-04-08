import { Panel } from './Panel';
import type { NearbyHazard } from '@/services/proximity-alerts';
import { proximityAlertService } from '@/services/proximity-alerts';
import { loadProximityConfig } from '@/services/proximity-filter';
import { showLocationGate } from '@/components/location-gate';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

const TYPE_LABEL: Record<NearbyHazard['type'], string> = {
  wildfire: 'Fire',
  hazmat: 'Hazmat',
  'oil-spill': 'Spill',
  'air-quality': 'AQI',
};

const SEV_CLASS: Record<NearbyHazard['severity'], string> = {
  critical: 'eq-row eq-major',
  high: 'eq-row eq-strong',
  medium: 'eq-row eq-moderate',
  low: 'eq-row',
};

export class HazardAlertsPanel extends Panel {
  constructor() {
 super({
 id: 'hazard-alerts',
 title: 'Hazard Alerts — Near Me',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Nearby wildfires, chemical spills, hazmat incidents, and air quality emergencies based on your home location. Set location in Settings → General.',
 });
 this._renderNoLocation();
  }

  public refresh(): void {
 this._render();
  }

  private _renderNoLocation(): void {
 showLocationGate(this, () => { this._render(); });
  }

  private _render(): void {
 const config = loadProximityConfig();
 if (!config.location) {
 this._renderNoLocation();
 this.setCount(0);
 return;
 }

 const hazards = proximityAlertService.getNearbyHazards();
 this.setCount(hazards.length);

 if (hazards.length === 0) {
 this.setContent('<div class="panel-empty">No nearby hazards detected.</div>');
 return;
 }

 const locationLabel = escapeHtml(config.location.label);

 const rows = hazards.map(h => {
 const distStr = h.distanceMiles < 1 ? '&lt; 1 mi' : `${h.distanceMiles} mi`;
 const evacBadge = h.evacuationOrder
 ? '<span class="sev-badge" style="background:var(--semantic-critical);font-size:10px;margin-right:4px">EVAC</span>'
 : '';
 // checklist items come from our own CHECKLISTS constant — not user input — no escaping needed
 const checklistHtml = h.checklist.map(item => `<li>${item}</li>`).join('');
 const safeId = escapeHtml(h.id);
 const shortTitle = h.title.length > 40 ? h.title.slice(0, 38) + '…' : h.title;

 return `
 <tr class="${SEV_CLASS[h.severity]} hazard-alert-row" data-hazard-id="${safeId}">
 <td style="white-space:nowrap"><span class="sev-badge">${TYPE_LABEL[h.type]}</span> ${distStr}</td>
 <td>${evacBadge}${escapeHtml(shortTitle)}</td>
 <td>${escapeHtml(h.location)}</td>
 <td><a href="${sanitizeUrl(h.url)}" target="_blank" rel="noopener noreferrer" class="popup-link">src</a></td>
 </tr>
 <tr class="hazard-checklist-row" data-for-hazard="${safeId}" style="display:none">
 <td colspan="4">
 <ul style="margin:6px 0 6px 16px;padding:0;list-style:disc;font-size:12px">${checklistHtml}</ul>
 </td>
 </tr>
 `;
 }).join('');

 const el = this.getContentElement();
 el.innerHTML = `
 <div class="ct-panel-content">
 <div style="padding:4px 8px;font-size:11px;opacity:0.7">Near: ${locationLabel}</div>
 <table class="eq-table ct-table">
 <thead>
 <tr><th>Type / Dist.</th><th>Hazard</th><th>Location</th><th></th></tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer"><span class="fires-source">Click a row to see action steps</span></div>
 </div>
 `;

 el.querySelector('tbody')?.addEventListener('click', (e) => {
 const row = (e.target as Element).closest<HTMLElement>('.hazard-alert-row');
 if (!row) return;
 const id = row.dataset['hazardId'];
 if (!id) return;
 const escaped = CSS.escape(id);
 const cl = el.querySelector<HTMLElement>(`.hazard-checklist-row[data-for-hazard="${escaped}"]`);
 if (cl) cl.style.display = cl.style.display === 'none' ? '' : 'none';
 });
  }
}
