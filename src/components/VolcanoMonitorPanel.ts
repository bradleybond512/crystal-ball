import { Panel } from './Panel';
import type { VolcanoMonitorItem, VolcanoMonitorStatus } from '@/services/volcano-monitor';
import { alertLevelBadgeClass, alertLevelColor, aviationColorHex } from '@/services/volcano-monitor';
import { escapeHtml } from '@/utils/sanitize';

const LEVEL_ORDER: Record<string, number> = { Warning: 3, Watch: 2, Advisory: 1, Normal: 0 };

export class VolcanoMonitorPanel extends Panel {
  private status: VolcanoMonitorStatus | null = null;
  private onEventClick: ((lat: number, lon: number) => void) | null = null;

  constructor() {
    super({
      id: 'volcano-monitor',
      title: 'Volcano Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'USGS VHP volcanoesHazardLevel + Smithsonian GVP weekly bulletin. 169 US volcanoes monitored.',
    });
    this.showLoading('Fetching USGS volcano status...');
  }

  public setEventClickHandler(fn: (lat: number, lon: number) => void): void {
    this.onEventClick = fn;
  }

  public update(status: VolcanoMonitorStatus): void {
    this.status = status;
    this.setCount(status.activeCount);
    this.render();
  }

  private render(): void {
    if (!this.status || this.status.volcanoes.length === 0) {
      this.setContent('<div class="panel-empty">No elevated volcano alerts.</div>');
      return;
    }

    const active = this.status.volcanoes
      .filter(v => v.alertLevel !== 'Normal')
      .sort((a, b) => (LEVEL_ORDER[b.alertLevel] ?? 0) - (LEVEL_ORDER[a.alertLevel] ?? 0));

    if (active.length === 0) {
      this.setContent('<div class="panel-empty">All monitored volcanoes at NORMAL.</div>');
      return;
    }

    const grouped = new Map<string, VolcanoMonitorItem[]>();
    for (const level of ['Warning', 'Watch', 'Advisory'] as const) {
      const items = active.filter(v => v.alertLevel === level);
      if (items.length > 0) grouped.set(level, items);
    }

    const sections: string[] = [];
    for (const [level, items] of grouped) {
      const color = alertLevelColor(level as VolcanoMonitorItem['alertLevel']);
      const rows = items.map(v => {
        const rowClass = alertLevelBadgeClass(v.alertLevel);
        const avHex = aviationColorHex(v.aviationColor);
        const bulletin = v.gvpBulletin
          ? `<div style="font-size:9px;opacity:0.7;margin-top:1px">${escapeHtml(v.gvpBulletin.slice(0, 80))}…</div>`
          : '';
        return `<tr class="${rowClass}" role="button" tabindex="0" data-lat="${v.lat}" data-lon="${v.lon}" style="cursor:pointer">
          <td><span style="background:${escapeHtml(avHex)};color:#000;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:700">${escapeHtml(v.aviationColor)}</span></td>
          <td><div>${escapeHtml(v.name)}</div>${bulletin}</td>
          <td>${escapeHtml(v.location)}</td>
          <td style="font-size:10px;color:var(--text-dim)">${escapeHtml(v.observatory)}</td>
        </tr>`;
      }).join('');
      sections.push(
        `<div style="padding:4px 8px;font-size:10px;font-weight:700;text-transform:uppercase;color:${escapeHtml(color)};border-bottom:1px solid rgba(255,255,255,0.08)">${escapeHtml(level)} (${items.length})</div>` +
        `<table class="eq-table ct-table"><thead><tr><th>Aviation</th><th>Volcano</th><th>Location</th><th>Observatory</th></tr></thead><tbody>${rows}</tbody></table>`,
      );
    }

    this.setContent(
      `<div class="ct-panel-content">${sections.join('')}<div class="fires-footer"><span class="fires-source">USGS VHP + Smithsonian GVP</span></div></div>`,
    );

    this.getContentElement().addEventListener('click', (e) => {
      const row = (e.target as Element).closest('tr[data-lat]') as HTMLElement | null;
      if (!row) return;
      const lat = Number.parseFloat(row.dataset.lat ?? '0');
      const lon = Number.parseFloat(row.dataset.lon ?? '0');
      if (!Number.isNaN(lat) && !Number.isNaN(lon) && this.onEventClick) this.onEventClick(lat, lon);
    });
  }
}
