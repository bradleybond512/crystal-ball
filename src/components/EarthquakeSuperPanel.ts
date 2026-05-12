import { Panel } from './Panel';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';
import {
  fetchEarthquakeIntelligence,
  type EarthquakeIntelligenceState,
  type EarthquakeSummary,
  type RegionalSeismicityRate,
  type MmiLabel,
} from '@/services/earthquake/earthquake-intelligence';
import type { AftershockForecast } from '@/services/seismic/aftershock-watch';

const REFRESH_MS = 60_000;

export class EarthquakeSuperPanel extends Panel {
  private state: EarthquakeIntelligenceState | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private loading = false;

  constructor() {
    super({
      id: 'earthquake-super',
      title: 'Earthquake Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Cross-domain earthquake intelligence: live USGS feed, Omori-Utsu aftershock forecasts, nearest fault systems, estimated MMI + population exposure, and regional rate vs 30-day baseline. 60-second refresh.',
    });
    this.render();
    queueMicrotask(() => { void this.load(); });
    this.refreshTimer = setInterval(() => { void this.load(); }, REFRESH_MS);
  }

  public destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      this.state = await fetchEarthquakeIntelligence({
        baseUrl: `${getApiBaseUrl()}/api/earthquake`,
      });
      this.setCount(this.state.significantEvents.length);
      this.render();
    } finally {
      this.loading = false;
    }
  }

  // ─── Rendering ─────────────────────────────────────────────────────

  private renderRateHeader(): string {
    if (!this.state) return '<div style="padding:6px 0;opacity:0.65;font-size:12px">Loading USGS feed…</div>';
    const rate = this.state.regionalRate;
    return `<div class="eq-rate-header" style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:6px;background:${rateBg(rate)};margin-bottom:8px">
      <div>
        <div style="font-size:11px;text-transform:uppercase;opacity:0.7">Regional Rate</div>
        <div style="font-size:18px;font-weight:600">${rate.last24hCount} events / 24h</div>
        <div style="font-size:11px;opacity:0.7;margin-top:2px">Baseline ${rate.baseline24hCount.toFixed(1)} / day · ratio ${rate.ratio === null ? 'n/a' : `${rate.ratio.toFixed(2)}×`}</div>
      </div>
      <div style="text-align:right">
        <span style="padding:3px 10px;border-radius:4px;background:${rateColor(rate)};color:#000;font-size:11px;font-weight:600;text-transform:uppercase">${escapeHtml(rate.label)}</span>
        <div style="font-size:11px;opacity:0.65;margin-top:4px">Updated ${timeAgo(this.state.generatedAt)}</div>
      </div>
    </div>`;
  }

  private renderSignificantEvents(): string {
    if (!this.state || this.state.significantEvents.length === 0) {
      return emptyState('No M ≥ 4.0 events in the active feed slice.');
    }
    const rows = this.state.significantEvents.slice(0, 12).map((s) => this.renderEventCard(s)).join('');
    return `<div style="display:flex;flex-direction:column;gap:6px">${rows}</div>`;
  }

  private renderEventCard(s: EarthquakeSummary): string {
    const e = s.event;
    const forecast = this.state?.aftershockForecasts[e.id];
    const url = sanitizeUrl(s.shakemapUrl) || '';
    const detailUrl = e.url ? sanitizeUrl(e.url) || '' : '';
    const faultLine = s.fault
      ? `<span style="opacity:0.85">Nearest fault: <strong>${escapeHtml(s.fault.name)}</strong> · ${s.fault.distanceKm} km</span>`
      : '<span style="opacity:0.65">No major fault within 500 km</span>';
    return `<div class="eq-card" style="padding:10px 12px;border-radius:6px;background:rgba(255,255,255,0.04);border-left:4px solid ${mmiColor(s.estimatedMmiLabel)}">
      <div style="display:flex;align-items:baseline;justify-content:space-between">
        <div>
          <span style="font-size:16px;font-weight:600">M${e.magnitude.toFixed(1)}</span>
          <span style="margin-left:6px;font-size:13px">${escapeHtml(e.place)}</span>
        </div>
        <span style="padding:2px 6px;border-radius:3px;background:${mmiColor(s.estimatedMmiLabel)};color:#000;font-size:10px;font-weight:600">MMI ${escapeHtml(s.estimatedMmiLabel)}</span>
      </div>
      <div style="font-size:11px;opacity:0.7;margin-top:4px">
        Depth ${e.depthKm === null ? '—' : `${e.depthKm.toFixed(1)} km`} ·
        Pop ≤50 km: ~${s.populationWithin50Km.toLocaleString()} ·
        ${escapeHtml(timeAgo(e.time))}
      </div>
      <div style="font-size:11px;margin-top:4px">${faultLine}</div>
      <div style="font-size:11px;opacity:0.75;margin-top:2px">${escapeHtml(s.historicalContext)}</div>
      ${forecast ? `<div style="font-size:11px;margin-top:6px;padding:4px 6px;border-radius:3px;background:rgba(96,165,250,0.10)">${renderAftershockSummary(forecast)}</div>` : ''}
      <div style="margin-top:6px;font-size:11px;display:flex;gap:10px">
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa">ShakeMap →</a>
        ${detailUrl ? `<a href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa">USGS event →</a>` : ''}
      </div>
    </div>`;
  }

  private render(): void {
    const footer = '<div style="opacity:0.65;font-size:11px;margin-top:8px">Source: USGS · Omori-Utsu aftershock model · 60s refresh</div>';
    this.setContent(`${this.renderRateHeader()}${this.renderSignificantEvents()}${footer}`);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function renderAftershockSummary(f: AftershockForecast): string {
  const h24 = f.horizons[0];
  const h168 = f.horizons.length > 0 ? f.horizons[f.horizons.length - 1] : undefined;
  if (!h24 || !h168) return '';
  return `<strong>Aftershock forecast (Omori-Utsu):</strong> ~${h24.expectedCount.toFixed(1)} in next 24h · ~${h168.expectedCount.toFixed(1)} in next 7d · P(M≥5) ${(h168.probAtLeastOneM5 * 100).toFixed(1)}%`;
}

function mmiColor(label: MmiLabel): string {
  switch (label) {
    case 'I': { return '#bbb';
    }
    case 'II-III': { return '#9fd0e4';
    }
    case 'IV': { return '#7fc0b9';
    }
    case 'V': { return '#bcd35f';
    }
    case 'VI': { return '#eaaa00';
    }
    case 'VII': { return '#e07a00';
    }
    case 'VIII': { return '#e0451e';
    }
    case 'IX': { return '#b41819';
    }
    case 'X+': { return '#7c0a02';
    }
  }
}

function rateColor(r: RegionalSeismicityRate): string {
  switch (r.label) {
    case 'swarm': { return '#dc2626';
    }
    case 'elevated': { return '#fb923c';
    }
    case 'normal': { return '#22c55e';
    }
    case 'quiet': { return '#a3a3a3';
    }
  }
}

function rateBg(r: RegionalSeismicityRate): string {
  switch (r.label) {
    case 'swarm': { return 'rgba(220,38,38,0.18)';
    }
    case 'elevated': { return 'rgba(251,146,60,0.18)';
    }
    case 'normal': { return 'rgba(34,197,94,0.12)';
    }
    case 'quiet': { return 'rgba(163,163,163,0.10)';
    }
  }
}

function emptyState(message: string): string {
  return `<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.75">${escapeHtml(message)}</div>`;
}

function timeAgo(epoch: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - epoch) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
