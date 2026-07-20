import { Panel } from './Panel';
import { getApiBaseUrl } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';

interface FaaTfr {
  id: string;
  notamNumber: string;
  type: 'VIP' | 'Security' | 'Fire' | 'Other';
  altFloor: number | null;
  altCeiling: number | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  polygon: [number, number][];
  center: [number, number] | null;
  color: [number, number, number, number];
}

interface TfrEnvelope {
  tfrs: FaaTfr[];
  count: number;
  fetchedAt: number;
  degraded: boolean;
  reason?: string;
  source: string;
}

const REFRESH_MS = 15 * 60 * 1000;

const TYPE_LABEL: Record<FaaTfr['type'], string> = {
  VIP: 'VIP / Presidential',
  Security: 'Security',
  Fire: 'Fire',
  Other: 'Other',
};

const TYPE_COLOR: Record<FaaTfr['type'], string> = {
  VIP: '#dc3545',
  Security: '#dc3545',
  Fire: '#ff8c00',
  Other: '#4a9eff',
};

export class FaaTfrsPanel extends Panel {
  private data: TfrEnvelope | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private onTfrClick: ((lon: number, lat: number) => void) | null = null;

  constructor() {
    super({
      id: 'faa-tfrs',
      title: 'FAA TFRs',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Active FAA Temporary Flight Restrictions — polygon geometry, altitude floor/ceiling, type (VIP/Security/Fire/Other), and effective window. Refreshes every 15 min. Cross-references with live commercial flight positions.',
    });
    this.start();
  }

  public setTfrClickHandler(fn: (lon: number, lat: number) => void): void {
    this.onTfrClick = fn;
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private start(): void {
    this.showLoading('Fetching FAA TFRs…');
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  private async refresh(): Promise<void> {
    try {
      const resp = await fetch(`${getApiBaseUrl()}/api/aviation/tfrs`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.data = (await resp.json()) as TfrEnvelope;
    } catch {
      if (!this.data) {
        this.setContent('<div class="panel-empty">FAA TFR data unavailable.</div>');
        return;
      }
    }
    this.render();
  }

  private render(): void {
    if (!this.data) return;
    const { tfrs, degraded, reason } = this.data;
    this.setCount(tfrs.length);

    const degradedBanner = degraded
      ? `<div style="padding:4px 6px;background:rgba(255, 69, 58,0.10);border-left:3px solid #ff453a;margin-bottom:6px;font-size:11px;">
           Degraded: ${escapeHtml(reason ?? 'upstream error')}
         </div>`
      : '';

    if (tfrs.length === 0) {
      this.setContent(`${degradedBanner}<div class="panel-empty">No active TFRs.</div>`);
      return;
    }

    const rows = tfrs.slice(0, 100).map((t) => {
      const typeColor = TYPE_COLOR[t.type];
      const altLabel =
        t.altFloor !== null || t.altCeiling !== null
          ? `${t.altFloor ?? 'SFC'}–${t.altCeiling ?? '∞'} ft`
          : '—';
      const timeLabel = t.effectiveStart
        ? formatTimeRange(t.effectiveStart, t.effectiveEnd)
        : '—';
      const centerAttr = t.center
        ? `data-lon="${t.center[0]}" data-lat="${t.center[1]}"`
        : '';
      return `<tr class="tfr-row" ${centerAttr} role="button" tabindex="0" style="cursor:${t.center ? 'pointer' : 'default'}">
        <td style="color:${typeColor};font-weight:600;">${escapeHtml(TYPE_LABEL[t.type])}</td>
        <td style="font-family:monospace;font-size:11px;">${escapeHtml(t.notamNumber)}</td>
        <td style="font-size:11px;">${escapeHtml(altLabel)}</td>
        <td style="font-size:11px;opacity:0.85;">${escapeHtml(timeLabel)}</td>
        <td style="font-size:11px;opacity:0.7;">${t.polygon.length} pts</td>
      </tr>`;
    }).join('');

    this.setContent(`
      ${degradedBanner}
      <div class="ct-panel-content">
        <table class="eq-table ct-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>NOTAM</th>
              <th>Altitude</th>
              <th>Window</th>
              <th>Polygon</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="fires-footer">
          <span class="fires-source">FAA TFR — tfr.faa.gov · ${tfrs.length} active</span>
        </div>
      </div>
    `);

    this.wireClickHandlers();
  }

  private wireClickHandlers(): void {
    const el = this.getContentElement();
    el.addEventListener('click', (ev) => {
      const row = (ev.target as Element).closest('tr.tfr-row[data-lon]') as HTMLElement | null;
      if (!row || !this.onTfrClick) return;
      const lon = Number.parseFloat(row.dataset.lon ?? '');
      const lat = Number.parseFloat(row.dataset.lat ?? '');
      if (Number.isFinite(lon) && Number.isFinite(lat)) this.onTfrClick(lon, lat);
    });
  }
}

function formatTimeRange(start: string, end: string | null): string {
  try {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
    const s = new Date(start).toLocaleString('en-US', opts);
    if (!end) return s;
    const e = new Date(end).toLocaleString('en-US', opts);
    return `${s} → ${e}`;
  } catch {
    return start;
  }
}
