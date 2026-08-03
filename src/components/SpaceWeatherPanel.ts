import { Panel } from './Panel';
import type { SpaceWeatherData } from '@/services/space-weather';
import type {
  SpaceWxStatus,
  SpaceWxAlert,
  EarthwardCme,
} from '@/services/spaceweather/swpc-monitor';
import {
  buildDefaultImageryResponse,
  formatLastUpdated,
  isSolarImageryResponse,
  type SolarImageryResponse,
  type SolarImageryStatus,
} from '@/services/spaceweather/solar-imagery';
import { escapeHtml } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import { getApiBaseUrl } from '@/services/runtime';
import {
  alertSeverityClass,
  buildWindStrip,
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
const IMAGERY_REFRESH_MS = 15 * 60 * 1000;

type Tab = 'status' | 'imagery';

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
  private activeTab: Tab = 'status';
  private imagery: SolarImageryResponse = buildDefaultImageryResponse(new Date(0).toISOString());
  private imageryFetchedAt: number | null = null;
  private imageryFetchError: string | null = null;
  private imageryTimer: ReturnType<typeof setInterval> | null = null;
  private modalEl: HTMLDivElement | null = null;

  constructor() {
    super({
      id: 'space-weather',
      title: t('panels.spaceWeather'),
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'NOAA SWPC: X-ray flare class, geomagnetic Kp + G0–G5 storm level, aurora visibility, GPS / HF disruption risk, earthward CMEs. Solar Imagery tab: live SDO + LASCO from NASA.',
    });
    this.showLoading('Fetching NOAA space weather...');
    queueMicrotask(() => { void this.refreshStatus(); });
    this.refreshTimer = setInterval(() => void this.refreshStatus(), STATUS_REFRESH_MS);
    // Single delegated click handler so we don't fight the setContent
    // debounce when wiring tab / imagery buttons.
    this.getContentElement().addEventListener('click', (event) => this.onContentClick(event));
  }

  private onContentClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (!target) return;
    const tabBtn = target.closest<HTMLElement>('.sw-tab[data-sw-tab]');
    if (tabBtn) {
      const next = tabBtn.dataset.swTab as Tab | undefined;
      if (!next || next === this.activeTab) return;
      this.activeTab = next;
      this.render();
      if (next === 'imagery') {
        void this.refreshImagery();
        this.imageryTimer ??= setInterval(() => void this.refreshImagery(), IMAGERY_REFRESH_MS);
      }
      return;
    }
    const refreshBtn = target.closest<HTMLElement>('[data-sw-imagery-refresh]');
    if (refreshBtn) {
      void this.refreshImagery();
      return;
    }
    const openBtn = target.closest<HTMLElement>('[data-sw-imagery-open]');
    if (openBtn) {
      const slug = openBtn.dataset.swImageryOpen;
      const img = slug ? this.imagery.images.find((i) => i.slug === slug) : null;
      if (img) this.openModal(img);
    }
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
    if (this.imageryTimer) {
      clearInterval(this.imageryTimer);
      this.imageryTimer = null;
    }
    this.closeModal();
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
    if (!this.data && !this.status && this.activeTab === 'status') {
      this.setContent('<div class="panel-empty">Space weather data unavailable.</div>');
      return;
    }
    const tabBar = `<div class="sw-tabs" role="tablist">
      <button class="sw-tab${this.activeTab === 'status' ? ' sw-tab--active' : ''}"
        role="tab" data-sw-tab="status" type="button">Status</button>
      <button class="sw-tab${this.activeTab === 'imagery' ? ' sw-tab--active' : ''}"
        role="tab" data-sw-tab="imagery" type="button">Solar Imagery</button>
    </div>`;
    const body = this.activeTab === 'imagery' ? this.renderImagery() : this.renderStatus();
    this.setContent(`<div class="sw-panel-content">${tabBar}${body}</div>`);
  }

  private renderStatus(): string {
    return [
      this.renderHeadlineGrid(),
      this.renderSolarWind(),
      this.renderAuroraStrip(),
      this.renderEarthwardCmes(),
      this.renderAlerts(),
      this.renderFooter(),
    ].filter((s) => s.length > 0).join('');
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
    const hfColor = hfBlackout ? '#ff453a' : '#4caf50';
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

  // ── Solar wind ────────────────────────────────────────────────────────

  /**
   * Speed / density / Bz come only from fetchSpaceWeather(); /api/spaceweather/
   * status carries no solar-wind fields, so `this.data` is the sole source and
   * a status-only render has nothing to say here.
   *
   * When `this.data` IS present the strip renders even if all three values are
   * null. That reads as "SWPC answered but the wind product did not parse",
   * which is a different and more useful statement than the row vanishing —
   * a hidden section is indistinguishable from a section that was never wired.
   */
  private renderSolarWind(): string {
    if (!this.data) return '';
    const view = buildWindStrip(this.data);
    const cells = view.cells.map((c) => `<div class="sw-wind-cell">
        <div class="sw-wind-label">${escapeHtml(c.label)}</div>
        <div class="sw-wind-value" style="color:${c.color};">${escapeHtml(c.value)}</div>
        <div class="sw-wind-sub">${escapeHtml(c.sub)}</div>
      </div>`).join('');
    return `<div class="sw-wind">
      <div class="sw-wind-header">
        <span class="sw-wind-title">Solar wind (L1)</span>
        <span class="${view.metaWarn ? 'sw-wind-stale' : 'sw-wind-age'}">${escapeHtml(view.meta)}</span>
      </div>
      <div class="sw-wind-grid">${cells}</div>
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
    // An outage must not borrow the appearance of an all-clear. When the feed
    // failed the list is empty for a reason that has nothing to do with the
    // sun, so say so rather than letting the section quietly disappear —
    // absence of a section is indistinguishable from absence of a threat.
    //
    // Only an explicit true clears this. An ABSENT flag is a cached envelope
    // from a build that predates the flag, and it carries no evidence either
    // way — reading it as healthy would restore the fail-open for exactly as
    // long as that cache lives.
    const feedOk = this.status?.cmeFeedOk;
    if (this.status !== null && feedOk !== true) {
      const why = feedOk === false
        ? 'CME feed unavailable'
        : 'CME feed not reported by this source';
      return `<div class="sw-alerts">
        <div class="sw-alerts-header">Earthward CMEs</div>
        <div class="sw-alert-row sw-warning">${why} — Earthward CMEs unknown</div>
      </div>`;
    }
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

  // ── Solar Imagery tab ──────────────────────────────────────────────────

  private renderImagery(): string {
    const now = Date.now();
    const cards = this.imagery.images.map((img) => this.renderImageryCard(img, now)).join('');
    const sourceFooter = this.imageryFetchError
      ? `<span style="color:#ff9800;">⚠ ${escapeHtml(this.imageryFetchError)}</span>`
      : `<span class="fires-source">NASA SDO · SOHO/LASCO</span>`;
    const fetchedLabel = this.imageryFetchedAt
      ? timeAgo(new Date(this.imageryFetchedAt))
      : 'never';
    return `<div class="sw-imagery">
      <div class="sw-imagery-toolbar">
        <button type="button" class="sw-imagery-refresh" data-sw-imagery-refresh>
          ↻ Refresh imagery
        </button>
        <span class="sw-imagery-meta">Catalog fetched ${escapeHtml(fetchedLabel)}</span>
      </div>
      <div class="sw-imagery-grid">${cards}</div>
      <div class="fires-footer">
        ${sourceFooter}
        <span class="fires-updated">Auto-refresh every 15 min</span>
      </div>
    </div>`;
  }

  private renderImageryCard(image: SolarImageryStatus, nowMs: number): string {
    const lastModMs = image.lastModified ? Date.parse(image.lastModified) : null;
    const ageLabel = formatLastUpdated(
      lastModMs !== null && Number.isFinite(lastModMs) ? lastModMs : null,
      nowMs,
    );
    const upstreamWarn = image.upstreamStatus !== 'ok' && image.upstreamStatus !== 'unknown'
      ? `<span class="sw-imagery-warn" title="upstream ${escapeHtml(image.upstreamStatus)}">⚠</span>`
      : '';
    const base = getApiBaseUrl();
    const src = `${base}${image.proxyUrl}`;
    return `<figure class="sw-imagery-card" data-sw-imagery-slug="${escapeHtml(image.slug)}">
      <button type="button" class="sw-imagery-img-btn"
        data-sw-imagery-open="${escapeHtml(image.slug)}"
        aria-label="Open ${escapeHtml(image.label)} full size">
        <img class="sw-imagery-img" src="${escapeHtml(src)}"
          alt="${escapeHtml(image.label)} — ${escapeHtml(image.description)}"
          loading="lazy" />
      </button>
      <figcaption class="sw-imagery-cap">
        <div class="sw-imagery-label">${escapeHtml(image.label)} ${upstreamWarn}</div>
        <div class="sw-imagery-desc">${escapeHtml(image.description)}</div>
        <div class="sw-imagery-time">${escapeHtml(ageLabel)}</div>
      </figcaption>
    </figure>`;
  }

  private async refreshImagery(): Promise<void> {
    try {
      const base = getApiBaseUrl();
      const resp = await fetch(`${base}/api/spaceweather/imagery`, {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body: unknown = await resp.json();
      if (!isSolarImageryResponse(body)) throw new Error('malformed imagery payload');
      this.imagery = body;
      this.imageryFetchedAt = Date.now();
      this.imageryFetchError = null;
    } catch (error) {
      this.imageryFetchError = error instanceof Error ? error.message : String(error);
    }
    if (this.activeTab === 'imagery') this.render();
  }

  private openModal(image: SolarImageryStatus): void {
    this.closeModal();
    const modal = document.createElement('div');
    modal.className = 'sw-imagery-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', `${image.label} full size`);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sw-imagery-modal-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';

    const figure = document.createElement('figure');
    figure.className = 'sw-imagery-modal-figure';

    const img = document.createElement('img');
    img.src = `${getApiBaseUrl()}${image.proxyUrl}`;
    img.alt = image.label;

    const caption = document.createElement('figcaption');
    caption.textContent = `${image.label} — ${image.description}`;

    figure.append(img, caption);
    modal.append(closeBtn, figure);

    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target === closeBtn) this.closeModal();
    });

    document.body.append(modal);
    this.modalEl = modal;

    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        this.closeModal();
        document.removeEventListener('keydown', onEsc);
      }
    };
    document.addEventListener('keydown', onEsc);
  }

  private closeModal(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }

}

