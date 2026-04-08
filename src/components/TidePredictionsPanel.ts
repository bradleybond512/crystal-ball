import { Panel } from './Panel';
import type { TideData } from '@/services/tide-predictions';
import { TIDE_STATIONS } from '@/services/tide-predictions';
import { escapeHtml } from '@/utils/sanitize';

export class TidePredictionsPanel extends Panel {
  private tideData: TideData | null = null;
  private onStationChange: ((stationId: string) => void) | null = null;

  constructor() {
 super({
 id: 'tide-predictions',
 title: 'Tide Predictions',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'NOAA CO-OPS tide predictions for US coastal stations. 48-hour high/low tides.',
 });
 this.showLoading('Fetching tide data...');
  }

  public setOnStationChange(cb: (stationId: string) => void): void {
 this.onStationChange = cb;
  }

  public update(data: TideData | null): void {
 this.tideData = data;
 if (data) this.setCount(data.predictions.length);
 this.render();
  }

  private render(): void {
 const stationSelect = TIDE_STATIONS.map(s => {
 const selected = this.tideData?.station.id === s.id ? 'selected' : '';
 return `<option value="${s.id}" ${selected}>${escapeHtml(s.name)}</option>`;
 }).join('');

 if (!this.tideData) {
 this.setContent(`
 <div class="tide-panel-content">
 <select class="tide-station-select">${stationSelect}</select>
 <div class="panel-empty">No tide data available.</div>
 </div>
 `);
 this.attachSelectHandler();
 return;
 }

 const rows = this.tideData.predictions.slice(0, 20).map(p => {
 const typeLabel = p.type === 'H' ? 'HIGH' : 'LOW';
 const typeClass = p.type === 'H' ? 'tide-high' : 'tide-low';
 const time = p.time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
 const date = p.time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
 return `<tr class="${typeClass}">
 <td>${typeLabel}</td>
 <td>${date}</td>
 <td>${time}</td>
 <td>${p.height.toFixed(1)} ft</td>
 </tr>`;
 }).join('');

 this.setContent(`
 <div class="tide-panel-content">
 <select class="tide-station-select">${stationSelect}</select>
 <table class="eq-table">
 <thead><tr><th>Type</th><th>Date</th><th>Time</th><th>Height</th></tr></thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer">
 <span class="fires-source">NOAA CO-OPS &middot; ${escapeHtml(this.tideData.station.name)}</span>
 </div>
 </div>
 `);
 this.attachSelectHandler();
  }

  private attachSelectHandler(): void {
 const el = this.getContentElement();
 const select = el.querySelector('.tide-station-select') as HTMLSelectElement | null;
 if (select) {
 select.addEventListener('change', () => {
 this.onStationChange?.(select.value);
 });
 }
  }
}
