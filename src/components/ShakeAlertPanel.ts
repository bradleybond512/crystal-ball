import { Panel } from './Panel';
import type { ShakemapStatus, ShakemapEvent } from '@/services/shakealert';
import { mmiLabel, mmiHexColor, pagerAlertColor, shakemapAvailabilityLabel } from '@/services/shakealert';
import { escapeHtml } from '@/utils/sanitize';

export class ShakeAlertPanel extends Panel {
  private status: ShakemapStatus | null = null;
  private onEventClick: ((lat: number, lon: number) => void) | null = null;

  constructor() {
    super({
      id: 'shakealert',
      title: 'ShakeAlert + ShakeMaps',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'USGS ShakeMap intensity for M4.5+ earthquakes in the past 7 days. Click an event to pan the globe.',
    });
    this.showLoading('Fetching USGS ShakeMap events...');
  }

  public setEventClickHandler(fn: (lat: number, lon: number) => void): void {
    this.onEventClick = fn;
  }

  public update(status: ShakemapStatus): void {
    this.status = status;
    this.setCount(status.events.filter(e => e.hasShakemap).length);
    this.render();
  }

  private render(): void {
    if (!this.status || this.status.events.length === 0) {
      this.setContent('<div class="panel-empty">No M4.5+ earthquakes in the past 7 days.</div>');
      return;
    }

    const rows = this.status.events.map(e => this.renderRow(e)).join('');

    this.setContent(`
      <div class="ct-panel-content">
        <table class="eq-table">
          <thead>
            <tr>
              <th>Mag</th>
              <th>Location</th>
              <th>MMI</th>
              <th>ShakeMap</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="fires-footer">
          <span class="fires-source">USGS FDSN · ShakeMap · 7 days · M4.5+</span>
        </div>
      </div>
    `);

    this.getContentElement().addEventListener('click', (e) => {
      const row = (e.target as Element).closest('tr[data-lat]') as HTMLElement | null;
      if (!row) return;
      const lat = Number.parseFloat(row.dataset.lat ?? '0');
      const lon = Number.parseFloat(row.dataset.lon ?? '0');
      if (!Number.isNaN(lat) && !Number.isNaN(lon) && this.onEventClick) this.onEventClick(lat, lon);
    });
  }

  private renderRow(e: ShakemapEvent): string {
    const mag = e.magnitude.toFixed(1);
    let magClass = '';
    if (e.magnitude >= 7) magClass = 'eq-major';
    else if (e.magnitude >= 6) magClass = 'eq-strong';
    else if (e.magnitude >= 5) magClass = 'eq-moderate';
    const mmiColor = mmiHexColor(e.maxMmi);
    const mmiText = mmiLabel(e.maxMmi);
    const smLabel = shakemapAvailabilityLabel(e.hasShakemap);
    const smStyle = e.hasShakemap ? 'color:#22c55e' : 'color:#6b7280';
    const pagerStyle = e.pagerAlert ? `color:${escapeHtml(pagerAlertColor(e.pagerAlert))}` : 'display:none';
    const pagerSpan = e.pagerAlert
      ? `<span style="${pagerStyle};font-size:9px;font-weight:700;margin-left:4px">${escapeHtml(e.pagerAlert.toUpperCase())}</span>`
      : '';

    return `<tr class="eq-row ${escapeHtml(magClass)}" data-lat="${e.lat}" data-lon="${e.lon}" style="cursor:pointer">
      <td class="eq-mag">${escapeHtml(mag)}${pagerSpan}</td>
      <td class="eq-place" style="font-size:10px">${escapeHtml(e.place)}</td>
      <td style="font-size:10px"><span style="color:${escapeHtml(mmiColor)};font-weight:700">${escapeHtml(mmiText)}</span></td>
      <td style="font-size:9px;${smStyle}">${escapeHtml(smLabel)}</td>
    </tr>`;
  }
}
