import { Panel } from './Panel';
import type { HifldAsset } from '@/services/infrastructure/hifld';
import { loadProximityConfig } from '@/services/proximity-filter';
import { escapeHtml } from '@/utils/sanitize';

export class InfrastructurePanel extends Panel {
  private _assets: HifldAsset[] = [];

  constructor() {
 super({
 id: 'infrastructure',
 title: 'Critical Infrastructure — Near Me',
 showCount: true,
 trackActivity: false,
 infoTooltip: 'Nearby hospitals and critical infrastructure from HIFLD public data. Set your home location in Settings → General.',
 });
 this._renderNoLocation();
  }

  public update(assets: HifldAsset[]): void {
 this._assets = assets;
 this._render();
  }

  private _renderNoLocation(): void {
 this.setContent('<div class="panel-empty">Set a home location in Settings → General to see nearby assets.</div>');
  }

  private _render(): void {
 const config = loadProximityConfig();
 if (!config.location) {
 this._renderNoLocation();
 this.setCount(0);
 return;
 }

 this.setCount(this._assets.length);

 if (this._assets.length === 0) {
 this.setContent('<div class="panel-empty">No nearby infrastructure found. Data loads when location is set.</div>');
 return;
 }

 const locationLabel = escapeHtml(config.location.label);

 const rows = this._assets.map(a => {
 const typeLabel = a.type === 'hospital' ? 'Hospital' : escapeHtml(a.type);
 const beds = a.beds != null ? String(a.beds) : '—';
 const phone = a.phone ? escapeHtml(a.phone) : '—';
 return `
 <tr class="eq-row">
 <td><span class="sev-badge">${typeLabel}</span></td>
 <td>${escapeHtml(a.name)}</td>
 <td style="font-size:11px">${escapeHtml(a.address)}</td>
 <td>${phone}</td>
 <td style="text-align:right">${beds}</td>
 </tr>
 `;
 }).join('');

 const el = this.getContentElement();
 el.innerHTML = `
 <div class="ct-panel-content">
 <div style="padding:4px 8px;font-size:11px;opacity:0.7">Near: ${locationLabel}</div>
 <table class="eq-table ct-table">
 <thead>
 <tr><th>Type</th><th>Name</th><th>Address</th><th>Phone</th><th style="text-align:right">Beds</th></tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer"><span class="fires-source">Source: HIFLD / ArcGIS public data</span></div>
 </div>
 `;
  }
}
