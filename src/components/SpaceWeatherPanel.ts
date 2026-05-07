/* eslint-disable sonarjs/no-nested-template-literals, sonarjs/no-nested-conditional */
import { Panel } from './Panel';
import type { SpaceWeatherData } from '@/services/space-weather';
import type {
  SpaceWxStatus,
  SpaceWxAlert,
  EarthwardCme,
} from '@/services/spaceweather/swpc-monitor';
import { escapeHtml } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import { getApiBaseUrl } from '@/services/runtime';
import {
  alertSeverityClass,
  formatArrivalCountdown,
  G_LEVEL_COLOR,
  gpsRiskBlurb,
  legacyAlertToStatus,
  RISK_COLOR,
  stormLevelLabel,
  timeAgo,
  xrayBadgeColor,
} from './space-weather-helpers';

const STATUS_REFRESH_MS = 5 * 60 * 1000;

interface AlertsResponse {
  alerts?: SpaceWxAlert[];
}

export class SpaceWeatherPanel extends Panel {
  private data: SpaceWeatherData | null = null;
  private status: SpaceWxStatus | null = null;
  private statusAlerts: SpaceWxAlert[] = [];
  private statusFetchedAt: number | null = null;
  private statusFetchError: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'space-weather',
      title: t('panels.spaceWeather'),
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'NOAA SWPC: X-ray flare class, geomagnetic Kp + G0–G5 storm level, aurora visibility, GPS / HF disruption risk, earthward CMEs.',
    });
    this.showLoading('Fetching NOAA space weather...');
    queueMicrotask(() => { void this.refreshStatus(); });
    this.refreshTimer = setInterval(() => void this.refreshStatus(), STATUS_REFRESH_MS);
  }

  public update(data: SpaceWeatherData): void {
    this.data = data;
    this.render();
  }

  override destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private async refreshStatus(): Promise<void> {
    let ok = false;
    try {
      const base = getApiBaseUrl();
      const [statusResp, alertsResp] = await Promise.allSettled([
        fetch(`${base}/api/spaceweather/status`, { headers: { Accept: 'application/json' } }),
        fetch(`${base}/api/spaceweather/alerts`, { headers: { Accept: 'application/json' } }),
      ]);
      if (statusResp.status === 'fulfilled' && statusResp.value.ok) {
        this.status = (await statusResp.value.json()) as SpaceWxStatus;
        ok = true;
      }
      if (alertsResp.status === 'fulfilled' && alertsResp.value.ok) {
        const body = (await alertsResp.value.json()) as AlertsResponse;
        this.statusAlerts = Array.isArray(body.alerts) ? body.alerts : [];
        ok = true;
      }
      this.statusFetchError = ok ? null : 'spaceweather endpoints unavailable';
    } catch (error) {
      this.statusFetchError = String((error as Error)?.message ?? error);
    }
    this.statusFetchedAt = Date.now();
    this.render();
  }

  private computeBadgeCount(): number {
    let count = 0;
    if (this.status?.hfRadioBlackout) count += 1;
    if (this.status?.gpsDisruption === 'high') count += 1;
    const level = this.status?.geomag?.level ?? 'G0';
    if (level === 'G3' || level === 'G4' || level === 'G5') count += 1;
    count += this.status?.earthwardCmes?.length ?? 0;
    return count;
  }

  private render(): void {
    this.setCount(this.computeBadgeCount());
    if (!this.data && !this.status) {
      this.setContent('<div class="panel-empty">Space weather data unavailable.</div>');
      return;
    }
    const sections = [
      this.renderHeadlineGrid(),
      this.renderAuroraStrip(),
      this.renderEarthwardCmes(),
      this.renderAlerts(),
      this.renderFooter(),
    ].filter((s) => s.length > 0).join('');
    this.setContent(`<div class="sw-panel-content">${sections}</div>`);
  }

  // ── Headline metrics ──────────────────────────────────────────────────

  private renderHeadlineGrid(): string {
    const xrayLabel = this.status?.xray?.peakLabel ?? this.data?.xrayClass ?? '—';
    const xrayFlux = this.status?.xray?.peakFlux;
    const xrayColor = xrayBadgeColor(xrayLabel);
    const xraySub = xrayFlux !== undefined && Number.isFinite(xrayFlux)
      ? `${xrayFlux.toExponential(1)} W/m²` : 'Solar flares';

    const gLevel = this.status?.geomag?.level ?? 'G0';
    const gColor = G_LEVEL_COLOR[gLevel];
    const kpVal = this.status?.geomag?.kp ?? this.data?.kpIndex ?? null;
    const kpLabel = kpVal === null ? '—' : kpVal.toFixed(1);
    const kpSub = `${gLevel} · ${stormLevelLabel(gLevel)}`;

    const gps = this.status?.gpsDisruption ?? 'none';
    const gpsColor = RISK_COLOR[gps];
    const gpsSub = gpsRiskBlurb(gps);

    const hfBlackout = this.status?.hfRadioBlackout ?? false;
    const hfColor = hfBlackout ? '#d50000' : '#4caf50';
    const hfLabel = hfBlackout ? 'BLACKOUT' : 'Nominal';
    const hfSub = hfBlackout ? 'X-ray flux ≥ 1e-4 W/m²' : 'HF propagation OK';

    return `<div class="sw-grid">
      <div class="sw-metric">
        <div class="sw-metric-label">X-Ray Flare</div>
        <div class="sw-metric-value" style="color:${xrayColor};">${escapeHtml(xrayLabel)}</div>
        <div class="sw-metric-sub">${escapeHtml(xraySub)}</div>
      </div>
      <div class="sw-metric">
        <div class="sw-metric-label">Geomagnetic</div>
        <div class="sw-metric-value" style="color:${gColor};">Kp ${escapeHtml(kpLabel)}</div>
        <div class="sw-metric-sub">${escapeHtml(kpSub)}</div>
      </div>
      <div class="sw-metric">
        <div class="sw-metric-label">GPS Disruption</div>
        <div class="sw-metric-value" style="color:${gpsColor};text-transform:uppercase;">${escapeHtml(gps)}</div>
        <div class="sw-metric-sub">${escapeHtml(gpsSub)}</div>
      </div>
      <div class="sw-metric">
        <div class="sw-metric-label">HF Radio</div>
        <div class="sw-metric-value" style="color:${hfColor};">${escapeHtml(hfLabel)}</div>
        <div class="sw-metric-sub">${escapeHtml(hfSub)}</div>
      </div>
    </div>`;
  }

  // ── Aurora visibility strip ───────────────────────────────────────────

  private renderAuroraStrip(): string {
    const lat = this.status?.geomag?.auroraVisibilityLatN ?? null;
    if (lat === null || lat >= 90) {
      return `<div class="sw-aurora-strip">
        <div class="sw-aurora-label">Aurora visibility</div>
        <div class="sw-aurora-empty">Not visible from mid-latitudes (Kp &lt; 5)</div>
      </div>`;
    }
    // Map latitude to a 0..100 strip position. 45°N → far left (intense),
    // 90°N → far right (only auroral oval).
    const pct = Math.max(0, Math.min(100, ((90 - lat) / (90 - 45)) * 100));
    return `<div class="sw-aurora-strip">
      <div class="sw-aurora-label">Aurora visibility — overhead at ${escapeHtml(lat.toFixed(1))}°N
        and poleward</div>
      <div class="sw-aurora-bar" role="img" aria-label="Aurora visibility latitude ${lat.toFixed(1)}°N">
        <div class="sw-aurora-marker" style="left:${pct}%;"></div>
        <div class="sw-aurora-scale">
          <span>45°N</span>
          <span>60°N</span>
          <span>90°N</span>
        </div>
      </div>
    </div>`;
  }

  // ── Earthward CMEs ────────────────────────────────────────────────────

  private renderEarthwardCmes(): string {
    const cmes = this.status?.earthwardCmes ?? [];
    if (cmes.length === 0) return '';
    const now = Date.now();
    const rows = cmes.slice(0, 5).map((cme) => this.renderCmeRow(cme, now)).join('');
    return `<div class="sw-alerts">
      <div class="sw-alerts-header">Earthward CMEs (${cmes.length})</div>
      ${rows}
    </div>`;
  }

  private renderCmeRow(cme: EarthwardCme, now: number): string {
    const speed = cme.speedKmS === null ? '—' : `${Math.round(cme.speedKmS)} km/s`;
    const arrival = cme.estimatedArrival ? Date.parse(cme.estimatedArrival) : Number.NaN;
    const countdown = formatArrivalCountdown(arrival, now);
    const sevClass = countdown.severityClass;
    const lon = cme.longitudeDeg === null ? '—' : `${cme.longitudeDeg.toFixed(0)}°`;
    return `<div class="sw-alert-row ${sevClass}">
      <span class="sw-alert-sev">CME ${escapeHtml(speed)}</span>
      <span class="sw-alert-msg">${escapeHtml(countdown.label)} · lon ${escapeHtml(lon)}</span>
      <span class="sw-alert-age">${cme.isMostAccurate ? 'best fit' : 'preliminary'}</span>
    </div>`;
  }

  // ── Alerts log ────────────────────────────────────────────────────────

  private renderAlerts(): string {
    const merged = this.statusAlerts.length > 0
      ? this.statusAlerts
      : (this.data?.alertMessages ?? []).map((a) => legacyAlertToStatus(a));
    if (merged.length === 0) {
      return '<div class="panel-empty" style="padding:8px 0">No active alerts</div>';
    }
    const rows = merged.slice(0, 8).map((alert) => {
      const sevClass = alertSeverityClass(alert.severity);
      const issued = Date.parse(alert.issuedAt);
      const ageStr = Number.isFinite(issued) ? timeAgo(new Date(issued)) : '—';
      return `<div class="sw-alert-row ${sevClass}">
        <span class="sw-alert-sev">${escapeHtml(alert.severity.toUpperCase())}</span>
        <span class="sw-alert-msg">${escapeHtml(alert.headline)}</span>
        <span class="sw-alert-age">${escapeHtml(ageStr)}</span>
      </div>`;
    }).join('');
    return `<div class="sw-alerts">
      <div class="sw-alerts-header">Alert Log (24h)</div>
      ${rows}
    </div>`;
  }

  // ── Footer ────────────────────────────────────────────────────────────

  private renderFooter(): string {
    const updated = this.statusFetchedAt ?? this.data?.fetchedAt?.getTime() ?? null;
    const ageStr = updated ? timeAgo(new Date(updated)) : 'Loading…';
    const errBadge = this.statusFetchError
      ? `<span style="color:#ff9800;margin-left:8px;">⚠ ${escapeHtml(this.statusFetchError)}</span>`
      : '';
    return `<div class="fires-footer">
      <span class="fires-source">NOAA SWPC · NASA DONKI</span>
      <span class="fires-updated">Updated ${escapeHtml(ageStr)}${errBadge}</span>
    </div>`;
  }
}

