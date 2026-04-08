import { Panel } from './Panel';
import type { ExtendedForecast, ForecastDay } from '@/services/extended-forecast';
import { wmoCodeEmoji } from '@/services/extended-forecast';
import { escapeHtml } from '@/utils/sanitize';

export class ExtendedForecastPanel extends Panel {
  private forecast: ExtendedForecast | null = null;

  constructor() {
 super({
 id: 'extended-forecast',
 title: '7-Day Forecast',
 showCount: false,
 trackActivity: true,
 infoTooltip: '7-day weather forecast from Open-Meteo. Click a location on the map to update.',
 });
 this.showLoading('Fetching forecast data...');
  }

  public update(forecast: ExtendedForecast | null): void {
 this.forecast = forecast;
 this.render();
  }

  private render(): void {
 if (!this.forecast) {
 this.setContent('<div class="panel-empty">No forecast data. Click a location on the map.</div>');
 return;
 }

 const locationLabel = this.forecast.location
 ? escapeHtml(this.forecast.location)
 : `${this.forecast.lat.toFixed(2)}, ${this.forecast.lon.toFixed(2)}`;

 const cards = this.forecast.days.map(d => this.dayCard(d)).join('');

 this.setContent(`
 <div class="forecast-panel-content">
 <div class="forecast-location">${locationLabel}</div>
 <div class="forecast-grid">${cards}</div>
 <div class="fires-footer">
 <span class="fires-source">Open-Meteo &middot; Updated ${timeAgo(this.forecast.fetchedAt)}</span>
 </div>
 </div>
 `);
  }

  private dayCard(d: ForecastDay): string {
 const emoji = wmoCodeEmoji(d.weatherCode);
 const precipBar = d.precipProbability > 0
 ? `<div class="forecast-precip">${String(d.precipProbability)}% &middot; ${d.precipMm.toFixed(1)}mm</div>`
 : '';
 let uvBadge = '';
 if (d.uvIndexMax >= 6) {
 uvBadge = `<span class="forecast-uv uv-high">UV ${d.uvIndexMax.toFixed(0)}</span>`;
 } else if (d.uvIndexMax >= 3) {
 uvBadge = `<span class="forecast-uv uv-mod">UV ${d.uvIndexMax.toFixed(0)}</span>`;
 }

 return `
 <div class="forecast-card">
 <div class="forecast-day-name">${escapeHtml(d.dayName)}</div>
 <div class="forecast-icon">${emoji}</div>
 <div class="forecast-temps">
 <span class="temp-high">${String(d.tempHighF)}&deg;</span>
 <span class="temp-low">${String(d.tempLowF)}&deg;</span>
 </div>
 <div class="forecast-label">${escapeHtml(d.weatherLabel)}</div>
 ${precipBar}
 <div class="forecast-wind">${escapeHtml(d.windDirection)} ${String(d.windSpeedKmh)} km/h</div>
 ${uvBadge}
 </div>
 `;
  }
}

function timeAgo(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${String(mins)}m ago`;
  return `${String(Math.floor(mins / 60))}h ago`;
}
