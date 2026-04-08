import { Panel } from './Panel';
import type { PollenReading } from '@/services/pollen';
import { pollenLevelColor } from '@/services/pollen';
import { escapeHtml } from '@/utils/sanitize';

export class PollenPanel extends Panel {
  private readings: PollenReading[] = [];

  constructor() {
 super({
 id: 'pollen',
 title: 'Pollen & Allergy',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Global pollen counts from Open-Meteo. Shows grass, birch, ragweed, alder, and olive pollen.',
 });
 this.showLoading('Fetching pollen data...');
  }

  public update(readings: PollenReading[]): void {
 this.readings = readings;
 this.setCount(readings.length);
 this.render();
  }

  private render(): void {
 if (this.readings.length === 0) {
 this.setContent('<div class="panel-empty">No pollen data available.</div>');
 return;
 }

 const rows = this.readings.map(r => {
 const color = pollenLevelColor(r.overallLevel);
 const levelLabel = r.overallLevel.replace('_', ' ').toUpperCase();
 return `<tr>
 <td>${escapeHtml(r.city)}</td>
 <td style="color:${color};font-weight:600">${levelLabel}</td>
 <td>${escapeHtml(r.dominantType)}</td>
 <td>${String(Math.round(r.grassPollen))}</td>
 <td>${String(Math.round(r.birchPollen))}</td>
 <td>${String(Math.round(r.ragweedPollen))}</td>
 </tr>`;
 }).join('');

 this.setContent(`
 <div class="pollen-panel-content">
 <table class="eq-table">
 <thead>
 <tr>
 <th>City</th>
 <th>Level</th>
 <th>Dominant</th>
 <th>Grass</th>
 <th>Birch</th>
 <th>Ragweed</th>
 </tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer">
 <span class="fires-source">Open-Meteo Air Quality &middot; grains/m&sup3;</span>
 </div>
 </div>
 `);
  }
}
