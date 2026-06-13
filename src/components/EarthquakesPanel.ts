import { Panel } from './Panel';
import type { Earthquake } from '@/services/earthquakes';
import { escapeHtml } from '@/utils/sanitize';
import { getSavedPlacesFilterService, isNearActivePlace } from '@/services/intelligence/saved-places-filter';

export class EarthquakesPanel extends Panel {
  private allEarthquakes: Earthquake[] = [];
  private lastUpdated: Date | null = null;
  private filterUnsub: (() => void) | null = null;

  constructor() {
 super({
 id: 'earthquakes',
 title: 'Earthquakes',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'USGS earthquake data — M4.5+ events in the past 24 hours.',
 });
 this.showLoading('Fetching seismic data...');
 this.filterUnsub = getSavedPlacesFilterService().subscribe(() => this.render());
  }

  public destroy(): void {
 super.destroy();
 this.filterUnsub?.();
 this.filterUnsub = null;
  }

  public update(earthquakes: Earthquake[]): void {
 this.allEarthquakes = [...earthquakes].sort((a, b) => b.magnitude - a.magnitude);
 this.lastUpdated = new Date();
 this.render();
  }

  private render(): void {
 const ctx = getSavedPlacesFilterService().getContext();
 const earthquakes = ctx.isActive
 ? this.allEarthquakes.filter(eq => !eq.location || isNearActivePlace(eq.location.latitude, eq.location.longitude))
 : this.allEarthquakes;
 const hiddenCount = this.allEarthquakes.length - earthquakes.length;
 this.setCount(earthquakes.length);

 if (earthquakes.length === 0 && this.allEarthquakes.length === 0) {
 this.setContent('<div class="panel-empty">No earthquakes reported in the past 24 hours.</div>');
 return;
 }

 const filterBanner = ctx.isActive
 ? `<div class="spf-proximity-banner">📍 ${escapeHtml(ctx.activePlaceName ?? '')} · ${ctx.radiusKm} km · ${hiddenCount > 0 ? `${hiddenCount} hidden` : 'showing all'}</div>`
 : '';

 if (earthquakes.length === 0) {
 this.setContent(`${filterBanner}<div class="panel-empty">No earthquakes within ${ctx.radiusKm} km of ${escapeHtml(ctx.activePlaceName ?? 'saved place')}.</div>`);
 return;
 }

 const rows = earthquakes.map(eq => {
 const mag = eq.magnitude.toFixed(1);
 const depth = eq.depthKm == undefined ? '—' : `${Math.round(eq.depthKm)} km`;
 const ago = timeAgo(eq.occurredAt);
 const rowClass = magClass(eq.magnitude);
 return `<tr class="${rowClass}">
 <td class="eq-mag">${mag}</td>
 <td class="eq-place">${escapeHtml(eq.place)}</td>
 <td class="eq-depth">${depth}</td>
 <td class="eq-time">${ago}</td>
 </tr>`;
 }).join('');

 const updatedStr = this.lastUpdated ? timeAgo(this.lastUpdated.getTime() / 1000) : 'never';

 this.setContent(`
 <div class="eq-panel-content">
 ${filterBanner}
 <table class="eq-table">
 <thead>
 <tr>
 <th>Mag</th>
 <th>Location</th>
 <th>Depth</th>
 <th>Time</th>
 </tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer">
 <span class="fires-source">USGS · M4.5+ · 24h</span>
 <span class="fires-updated">Updated ${updatedStr}</span>
 </div>
 </div>
 `);
  }
}

function magClass(mag: number): string {
  if (mag >= 7) return 'eq-row eq-major';
  if (mag >= 6) return 'eq-row eq-strong';
  if (mag >= 5) return 'eq-row eq-moderate';
  return 'eq-row';
}

function timeAgo(epochSeconds: number): string {
  const secs = Math.floor(Date.now() / 1000 - epochSeconds);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
