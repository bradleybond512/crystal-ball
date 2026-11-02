import { Panel } from './Panel';
import type { NWSAlert } from '@/services/nws-alerts';
import { nwsSeverityClass } from '@/services/nws-alerts';
import { escapeHtml } from '@/utils/sanitize';

interface NWSPanelSnapshot {
  alerts: NWSAlert[];
  state: 'current' | 'stale' | 'unavailable';
  observedAt: number | null;
}

function formatTime(value: string | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return `<time datetime="${escapeHtml(value)}">${escapeHtml(new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</time>`;
}

export class NWSAlertsPanel extends Panel {
  constructor() {
    super({
      id: 'nws-alerts',
      title: 'NWS Hazard Alerts',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Active US weather hazard alerts from NOAA National Weather Service — tornadoes, floods, blizzards, extreme heat, and more.',
    });
    this.showLoading('Fetching NWS alerts...');
  }

  public updateSnapshot({ alerts, state, observedAt }: NWSPanelSnapshot): void {
    if (alerts.length > 0 || state === 'current') this.setCount(alerts.length);
    else if (this.countEl) this.countEl.textContent = '—';
    const observation = observedAt !== null && Number.isFinite(observedAt)
      ? ` Last complete observation: ${formatTime(new Date(observedAt).toISOString())}.` : '';
    const label = {
      current: 'Current national snapshot.',
      stale: 'Stale national snapshot. Current warning coverage cannot be confirmed.',
      unavailable: 'NWS warning coverage unavailable.',
    }[state];
    const status = `<div class="panel-status" role="status" aria-live="polite">${label}${observation}</div>`;
    if (alerts.length === 0) {
      this.setContent(`${status}<div class="panel-empty">${state === 'current'
        ? 'No active NWS hazard alerts.' : 'No current warning list available. Check NOAA National Weather Service for current warnings.'}</div>`);
      return;
    }
    const rows = alerts.slice(0, 80).map(a => {
      const area = a.areaDesc.length > 40 ? a.areaDesc.slice(0, 38) + '…' : a.areaDesc;
      return `<tr class="${nwsSeverityClass(a.severity)}" title="${escapeHtml(a.headline)}">
        <td><span class="sev-badge">${escapeHtml(a.severity)}</span></td>
        <td>${escapeHtml(a.event)}</td>
        <td>${escapeHtml(area)}</td>
        <td>${formatTime(a.sent)}</td>
        <td>${formatTime(a.onset)}</td>
      </tr>`;
    }).join('');
    this.setContent(`${status}
      <div class="ct-panel-content">
        <table class="eq-table ct-table">
          <thead><tr><th>Sev</th><th>Event</th><th>Area</th><th>Issued</th><th>Starts</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="fires-footer"><span class="fires-source">NOAA National Weather Service</span>
          ${alerts.length > 80 ? `<span>Showing 80 of ${alerts.length} warnings</span>` : ''}
        </div>
      </div>`);
  }
}
