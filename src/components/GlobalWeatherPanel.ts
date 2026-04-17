import { Panel } from './Panel';
import type { GlobalWeatherReading } from '@/services/global-weather';
import { escapeHtml } from '@/utils/sanitize';

export class GlobalWeatherPanel extends Panel {
  private readings: GlobalWeatherReading[] = [];

  constructor() {
 super({
 id: 'global-weather',
 title: 'Global Weather',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Current weather conditions for cities worldwide via Open-Meteo.',
 });
 this.showLoading('Fetching global weather data...');
  }

  public update(readings: GlobalWeatherReading[]): void {
 this.readings = readings;
 this.setCount(readings.length);
 this.render();
  }

  private render(): void {
 if (this.readings.length === 0) {
 this.setContent('<div class="panel-empty">No weather data available.</div>');
 return;
 }

 const rows = this.readings.slice(0, 15).map(r => {
 const wind = r.windMps == null ? '—' : `${r.windMps.toFixed(1)} m/s`;
 const temp = `${r.tempC.toFixed(1)}°C`;
 return `<tr>
 <td>${escapeHtml(r.city)}</td>
 <td>${temp}</td>
 <td>${escapeHtml(r.condition)}</td>
 <td style="opacity:0.7">${wind}</td>
 </tr>`;
 }).join('');

 this.setContent(`
 <div class="ct-panel-content">
 <table class="eq-table ct-table">
 <thead>
 <tr>
 <th>City</th>
 <th>Temp</th>
 <th>Conditions</th>
 <th>Wind</th>
 </tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer">
 <span class="fires-source">Open-Meteo</span>
 </div>
 </div>
 `);
  }
}
