import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { AvalancheForecast } from '@/services/avalanche-hazard';
import { avalancheDangerLabel, avalancheSeverityClass } from '@/services/avalanche-hazard';

export class AvalancheHazardPanel extends Panel {
  constructor() {
 super({ id: 'avalanche-hazard', title: 'Avalanche Hazard', showCount: true, trackActivity: false });
 this.showLoading('Loading avalanche forecasts...');
  }

  updateForecasts(forecasts: AvalancheForecast[]): void {
 this.setCount(forecasts.length);
 if (forecasts.length === 0) {
 this.setContent('<div class="panel-empty">No Moderate+ avalanche hazard zones.</div>');
 return;
 }
 const rows = forecasts.map(f => {
 const cls = avalancheSeverityClass(f.severity);
 const dangerLabel = avalancheDangerLabel(f.danger);
 const problems = f.avalancheProblems.length ? f.avalancheProblems.join(', ') : '';
 return `<tr class="${cls}">
 <td style="font-weight:600;font-size:11px">${escapeHtml(f.zoneName)}<div style="font-size:10px;opacity:0.55">${escapeHtml(f.state)}</div></td>
 <td style="font-size:11px;white-space:nowrap">${escapeHtml(dangerLabel)}</td>
 <td style="font-size:10px;opacity:0.7">${escapeHtml(problems)}</td>
 </tr>`;
 }).join('');
 this.setContent(`<div style="overflow-y:auto;max-height:100%"><table class="eq-table">
 <thead><tr><th>Zone</th><th>Danger</th><th>Problems</th></tr></thead>
 <tbody>${rows}</tbody>
 </table></div>`);
  }
}
