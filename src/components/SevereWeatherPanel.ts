import { Panel } from './Panel';
import type { SevereWeatherStatus, ActiveWarning } from '@/services/severe-weather';
import { riskLabelForCode, riskBadgeStyle, warningColor } from '@/services/severe-weather';
import { escapeHtml } from '@/utils/sanitize';

export class SevereWeatherPanel extends Panel {
  private status: SevereWeatherStatus | null = null;
  private onWarningClick: ((lat: number, lon: number) => void) | null = null;

  constructor() {
    super({
      id: 'severe-weather',
      title: 'Severe Weather / SPC',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'SPC Day 1–2 convective outlook risk level + NWS active tornado and severe thunderstorm warnings.',
    });
    this.showLoading('Fetching SPC outlook...');
  }

  public setWarningClickHandler(fn: (lat: number, lon: number) => void): void {
    this.onWarningClick = fn;
  }

  public update(status: SevereWeatherStatus): void {
    this.status = status;
    const count = status.tornadoWarningCount + status.thunderstormWarningCount + status.watchCount;
    this.setCount(count);
    this.render();
  }

  private render(): void {
    if (!this.status) {
      this.setContent('<div class="panel-empty">No severe weather data.</div>');
      return;
    }

    const { outlook, warnings, tornadoWarningCount, thunderstormWarningCount, watchCount } = this.status;
    const riskLabel = riskLabelForCode(outlook.maxRisk);

    const outlookHtml = `
      <div style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid rgba(255,255,255,0.08)">
        <div>
          <div style="font-size:10px;opacity:0.6;text-transform:uppercase;letter-spacing:.05em">SPC Day 1 Outlook</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
            <span style="${escapeHtml(riskBadgeStyle(outlook.maxRisk))}">${escapeHtml(riskLabel)}</span>
            ${outlook.validTime ? `<span style="font-size:10px;opacity:0.5">${escapeHtml(outlook.validTime)}</span>` : ''}
          </div>
        </div>
        <div style="margin-left:auto;text-align:right;font-size:11px">
          <div style="color:#ef4444;font-weight:600">${tornadoWarningCount} Tornado Warn.</div>
          <div style="color:#f97316">${thunderstormWarningCount} Thunder. Warn.</div>
          <div style="color:#eab308">${watchCount} Watch${watchCount === 1 ? '' : 'es'}</div>
        </div>
      </div>`;

    const warningRows = warnings.slice(0, 40).map(w => this.renderWarningRow(w)).join('');

    const tableHtml = warnings.length === 0
      ? '<div class="panel-empty" style="padding:12px">No active tornado or severe thunderstorm warnings.</div>'
      : `<table class="eq-table ct-table">
          <thead><tr><th>Type</th><th>Area</th><th>Expires</th></tr></thead>
          <tbody>${warningRows}</tbody>
        </table>`;

    this.setContent(
      `<div class="ct-panel-content">${outlookHtml}${tableHtml}<div class="fires-footer"><span class="fires-source">NWS SPC · NWS CAP</span></div></div>`,
    );

    this.getContentElement().addEventListener('click', (e) => {
      const row = (e.target as Element).closest('tr[data-lat]') as HTMLElement | null;
      if (!row) return;
      const lat = Number.parseFloat(row.dataset.lat ?? '0');
      const lon = Number.parseFloat(row.dataset.lon ?? '0');
      if (!Number.isNaN(lat) && !Number.isNaN(lon) && this.onWarningClick) this.onWarningClick(lat, lon);
    });
  }

  private renderWarningRow(w: ActiveWarning): string {
    const color = warningColor(w.warnType);
    const typeLabel = { tornado: 'Tornado Warn.', thunderstorm: 'Thunder. Warn.', watch: 'Watch' }[w.warnType] ?? w.event;
    const expiresStr = w.expires ? new Date(w.expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    const latAttr = w.centroid ? ` data-lat="${w.centroid.lat}" data-lon="${w.centroid.lon}" style="cursor:pointer"` : '';
    return `<tr${latAttr}>
      <td><span style="color:${escapeHtml(color)};font-weight:700;font-size:10px">${escapeHtml(typeLabel)}</span></td>
      <td style="font-size:10px">${escapeHtml(w.areaDesc.slice(0, 60))}</td>
      <td style="font-size:10px;color:var(--text-dim)">${escapeHtml(expiresStr)}</td>
    </tr>`;
  }
}
