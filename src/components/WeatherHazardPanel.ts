/**
 * Weather Hazard Panel — PR 2 of weather-hazards stack.
 *
 * Four tabs over the four hazard data sources from PR 1:
 *   • Alerts   — active NWS Extreme/Severe alerts, color-coded
 *   • Tropical — active named storms with category + position + track
 *   • Drought  — USDM weekly D0–D4 coverage with color bar
 *   • Climate  — Arctic sea-ice extent vs 1981-2010 median + record-low
 *
 * Auto-refresh cadences match the polling spec from PR 1
 * (alerts 2min, tropical 30min, drought + sea ice daily). The panel
 * fetches each source independently so a slow tropical fetch never
 * stalls the alerts tab.
 */

import { Panel } from './Panel';
import {
  fetchHazardAlerts,
  fetchTropicalStorms,
  fetchDroughtSnapshot,
  fetchSeaIceSnapshot,
  ALERT_CATEGORY_COLOR,
  WEATHER_HAZARD_POLLING_MS,
  type NwsHazardAlert,
  type NhcStorm,
  type DroughtSnapshot,
  type SeaIceSnapshot,
} from '@/services/weather/nws-hazards';
import { escapeHtml } from '@/utils/sanitize';
import { groupAlertsByCategory, formatRelativeExpires } from './weather-hazard-helpers';

type TabId = 'alerts' | 'tropical' | 'drought' | 'climate';

function trendColorFor(anomaly: number): string {
  if (anomaly < 0) return '#ff453a';
  if (anomaly > 0) return '#26a69a';
  return '#aaa';
}

function trendArrowFor(anomaly: number): string {
  if (anomaly < 0) return '▼';
  if (anomaly > 0) return '▲';
  return '—';
}

const TAB_ORDER: { id: TabId; label: string }[] = [
  { id: 'alerts', label: 'Alerts' },
  { id: 'tropical', label: 'Tropical' },
  { id: 'drought', label: 'Drought' },
  { id: 'climate', label: 'Climate' },
];

/** Saffir-Simpson + sub-hurricane category badges (color, label). */
const STORM_CATEGORY_BADGE: Record<string, { color: string; label: string }> = {
  TD: { color: '#1e88e5', label: 'TD' },
  TS: { color: '#26a69a', label: 'TS' },
  HU1: { color: '#ffd54f', label: 'CAT 1' },
  HU2: { color: '#ff9800', label: 'CAT 2' },
  HU3: { color: '#f4511e', label: 'CAT 3' },
  HU4: { color: '#ff453a', label: 'CAT 4' },
  HU5: { color: '#6a1b9a', label: 'CAT 5' },
  PT: { color: '#9e9e9e', label: 'PT' },
  unknown: { color: '#616161', label: '?' },
};

const DROUGHT_BAR_COLORS = {
  none: '#4caf50',
  d0: '#fff176',
  d1: '#ffb74d',
  d2: '#ff7043',
  d3: '#d84315',
  d4: '#7b1fa2',
} as const;

interface PanelState {
  activeTab: TabId;
  alerts: NwsHazardAlert[];
  storms: NhcStorm[];
  drought: DroughtSnapshot | undefined;
  seaIce: SeaIceSnapshot | undefined;
  alertsLoading: boolean;
  tropicalLoading: boolean;
  droughtLoading: boolean;
  climateLoading: boolean;
  lastFetched: { alerts: number; tropical: number; drought: number; seaIce: number };
}

export class WeatherHazardPanel extends Panel {
  private state: PanelState = {
    activeTab: 'alerts',
    alerts: [],
    storms: [],
    drought: undefined,
    seaIce: undefined,
    alertsLoading: true,
    tropicalLoading: true,
    droughtLoading: true,
    climateLoading: true,
    lastFetched: { alerts: 0, tropical: 0, drought: 0, seaIce: 0 },
  };

  private timers: ReturnType<typeof setInterval>[] = [];

  constructor() {
    super({
      id: 'weather-hazard',
      title: 'Weather Hazards',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'NWS active alerts (Extreme/Severe + warning re-issues), NHC tropical cyclones, US Drought Monitor weekly D0–D4 coverage, Arctic sea-ice extent vs 1981–2010 median.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    void this.refreshAlerts();
    void this.refreshTropical();
    void this.refreshDrought();
    void this.refreshSeaIce();
    this.timers.push(
      setInterval(() => void this.refreshAlerts(), WEATHER_HAZARD_POLLING_MS.alerts),
      setInterval(() => void this.refreshTropical(), WEATHER_HAZARD_POLLING_MS.tropical),
      setInterval(() => void this.refreshDrought(), WEATHER_HAZARD_POLLING_MS.drought),
      setInterval(() => void this.refreshSeaIce(), WEATHER_HAZARD_POLLING_MS.seaIce),
    );
  }

  public destroy(): void {
    super.destroy();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private async refreshAlerts(): Promise<void> {
    const alerts = await fetchHazardAlerts();
    this.state.alerts = alerts;
    this.state.alertsLoading = false;
    this.state.lastFetched.alerts = Date.now();
    this.setCount(alerts.length);
    this.render();
  }

  private async refreshTropical(): Promise<void> {
    this.state.storms = await fetchTropicalStorms();
    this.state.tropicalLoading = false;
    this.state.lastFetched.tropical = Date.now();
    this.render();
  }

  private async refreshDrought(): Promise<void> {
    this.state.drought = await fetchDroughtSnapshot();
    this.state.droughtLoading = false;
    this.state.lastFetched.drought = Date.now();
    this.render();
  }

  private async refreshSeaIce(): Promise<void> {
    this.state.seaIce = await fetchSeaIceSnapshot();
    this.state.climateLoading = false;
    this.state.lastFetched.seaIce = Date.now();
    this.render();
  }

  private render(): void {
    this.setContent(this.buildHtml());
    this.wireTabHandlers();
  }

  private buildHtml(): string {
    return `
      <div style="padding:14px;display:flex;flex-direction:column;gap:14px;">
        ${this.renderTabBar()}
        <div data-weather-hazard-tab-body>
          ${this.renderTabBody()}
        </div>
      </div>
    `;
  }

  private renderTabBar(): string {
    const tabs = TAB_ORDER.map((t) => {
      const isActive = t.id === this.state.activeTab;
      const bg = isActive ? 'var(--accent,#4a9eff)' : 'transparent';
      const color = isActive ? '#fff' : 'var(--text-secondary,#aaa)';
      const border = isActive ? 'var(--accent,#4a9eff)' : 'var(--border-subtle,#333)';
      return `<button type="button" data-weather-hazard-tab="${t.id}"
        style="background:${bg};color:${color};border:1px solid ${border};border-radius:4px;padding:6px 14px;font-size:12px;cursor:pointer;letter-spacing:0.04em;text-transform:uppercase;">
        ${escapeHtml(t.label)}
      </button>`;
    }).join('');
    return `<div style="display:flex;gap:8px;border-bottom:1px solid var(--border-subtle,#333);padding-bottom:10px;">${tabs}</div>`;
  }

  private renderTabBody(): string {
    switch (this.state.activeTab) {
      case 'alerts': {
        return this.renderAlertsTab();
      }
      case 'tropical': {
        return this.renderTropicalTab();
      }
      case 'drought': {
        return this.renderDroughtTab();
      }
      case 'climate': {
        return this.renderClimateTab();
      }
    }
  }

  // ── Alerts tab ─────────────────────────────────────────────────────

  private renderAlertsTab(): string {
    if (this.state.alertsLoading) return this.renderLoading('Loading active NWS alerts…');
    if (this.state.alerts.length === 0) return this.renderEmpty('No Extreme or Severe NWS alerts active.');
    const groups = groupAlertsByCategory(this.state.alerts);
    const summary = `<div style="font-size:11px;color:var(--text-secondary,#aaa);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.04em;">
      ${this.state.alerts.length} active ${this.state.alerts.length === 1 ? 'alert' : 'alerts'}
    </div>`;
    const rows = this.state.alerts.slice(0, 50).map((a) => this.renderAlertRow(a)).join('');
    return `${summary}${this.renderCategoryBadges(groups)}${rows}`;
  }

  private renderCategoryBadges(groups: Record<string, NwsHazardAlert[]>): string {
    const badges = Object.entries(groups)
      .filter(([, alerts]) => alerts.length > 0)
      .map(([cat, alerts]) => {
        const color = ALERT_CATEGORY_COLOR[cat as keyof typeof ALERT_CATEGORY_COLOR] ?? '#666';
        return `<span style="background:${color}33;color:${color};border:1px solid ${color}66;border-radius:10px;padding:3px 9px;font-size:10px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">
          ${escapeHtml(cat)} ${alerts.length}
        </span>`;
      }).join('');
    return badges ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">${badges}</div>` : '';
  }

  private renderAlertRow(a: NwsHazardAlert): string {
    const color = ALERT_CATEGORY_COLOR[a.category];
    const expiresLabel = formatRelativeExpires(a.expires);
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:4px solid ${color};border-radius:3px;padding:10px;margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <span style="font-weight:700;font-size:13px;color:${color};">${escapeHtml(a.event)}</span>
        <span style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;">${escapeHtml(a.severity)} · ${escapeHtml(a.urgency)}</span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(a.areaDesc)}</div>
      ${a.headline ? `<div style="font-size:11px;color:#ddd;margin-top:4px;line-height:1.45;">${escapeHtml(a.headline)}</div>` : ''}
      ${expiresLabel ? `<div style="font-size:10px;color:#9e9e9e;margin-top:6px;">Expires ${escapeHtml(expiresLabel)}</div>` : ''}
    </div>`;
  }

  // ── Tropical tab ───────────────────────────────────────────────────

  private renderTropicalTab(): string {
    if (this.state.tropicalLoading) return this.renderLoading('Loading active tropical cyclones…');
    if (this.state.storms.length === 0) return this.renderEmpty('No active named storms in NHC basins.');
    const rows = this.state.storms.map((s) => this.renderStormRow(s)).join('');
    return `<div style="font-size:11px;color:var(--text-secondary,#aaa);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.04em;">
      ${this.state.storms.length} active ${this.state.storms.length === 1 ? 'storm' : 'storms'}
    </div>${rows}`;
  }

  private renderStormRow(s: NhcStorm): string {
    const cat = STORM_CATEGORY_BADGE[s.category] ?? STORM_CATEGORY_BADGE.unknown!;
    const movement = s.movement
      ? `${s.movement.headingDeg.toFixed(0)}° at ${s.movement.speedMph.toFixed(0)} mph`
      : '—';
    const surge = s.intensityMph >= 96 ? `<span style="color:#ff453a;font-weight:700;">Storm-surge threat</span>` : '';
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:4px solid ${cat.color};border-radius:3px;padding:10px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <span style="font-weight:700;font-size:14px;">${escapeHtml(s.name)}</span>
        <span style="background:${cat.color};color:#fff;font-size:10px;font-weight:700;border-radius:3px;padding:2px 8px;letter-spacing:0.05em;">${escapeHtml(cat.label)}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 16px;font-size:11px;margin-top:6px;color:var(--text-secondary,#aaa);">
        <div>Position: ${s.position.lat.toFixed(1)}°, ${s.position.lng.toFixed(1)}°</div>
        <div>Wind: ${s.intensityMph.toFixed(0)} mph${s.pressureMb ? ` · ${s.pressureMb.toFixed(0)} mb` : ''}</div>
        <div>Movement: ${escapeHtml(movement)}</div>
        <div>Advisory #${escapeHtml(s.advisoryNumber || '—')} · Basin ${escapeHtml(s.basin)}</div>
      </div>
      ${surge ? `<div style="font-size:11px;margin-top:6px;">${surge}</div>` : ''}
      ${s.publicAdvisoryUrl ? `<div style="font-size:11px;margin-top:6px;"><a href="${escapeHtml(s.publicAdvisoryUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent,#4a9eff);">NHC public advisory</a></div>` : ''}
    </div>`;
  }

  // ── Drought tab ────────────────────────────────────────────────────

  private renderDroughtTab(): string {
    if (this.state.droughtLoading) return this.renderLoading('Loading USDM drought snapshot…');
    const d = this.state.drought;
    if (!d) return this.renderEmpty('USDM data unavailable.');
    const total = d.d0Fraction + d.d1Fraction + d.d2Fraction + d.d3Fraction + d.d4Fraction;
    const sumOrFloor = Math.max(total, 0.01);
    const segments = [
      { key: 'd0', frac: d.d0Fraction, label: 'D0 — Abnormally dry' },
      { key: 'd1', frac: d.d1Fraction, label: 'D1 — Moderate' },
      { key: 'd2', frac: d.d2Fraction, label: 'D2 — Severe' },
      { key: 'd3', frac: d.d3Fraction, label: 'D3 — Extreme' },
      { key: 'd4', frac: d.d4Fraction, label: 'D4 — Exceptional' },
    ] as const;
    const bar = segments.map((s) => {
      const w = (s.frac / sumOrFloor) * 100;
      return `<div title="${escapeHtml(s.label)}: ${(s.frac * 100).toFixed(1)}%" style="background:${DROUGHT_BAR_COLORS[s.key]};width:${w.toFixed(2)}%;height:24px;"></div>`;
    }).join('');
    const noneSeg = (d.noneFraction * 100).toFixed(1);
    const rows = segments.map((s) => `
      <div style="display:flex;align-items:center;gap:10px;font-size:12px;">
        <span style="display:inline-block;width:14px;height:14px;background:${DROUGHT_BAR_COLORS[s.key]};border-radius:2px;"></span>
        <span style="flex:1;">${escapeHtml(s.label)}</span>
        <span style="font-weight:700;font-variant-numeric:tabular-nums;">${(s.frac * 100).toFixed(1)}%</span>
      </div>`).join('');
    return `<div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">
      Week ending ${escapeHtml(d.weekDate)} · ${noneSeg}% of CONUS not in drought
    </div>
    <div style="display:flex;height:24px;border:1px solid var(--border-subtle,#333);border-radius:3px;overflow:hidden;margin-bottom:12px;">
      ${bar}
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;">${rows}</div>`;
  }

  // ── Climate tab ────────────────────────────────────────────────────

  private renderClimateTab(): string {
    if (this.state.climateLoading) return this.renderLoading('Loading Arctic sea-ice extent…');
    const ice = this.state.seaIce;
    if (!ice) return this.renderEmpty('NSIDC sea-ice data unavailable.');
    const anomaly = ice.anomalyMillionKm2 ?? 0;
    const trendColor = trendColorFor(anomaly);
    const arrow = trendArrowFor(anomaly);
    const recordBadge = ice.isRecordLow
      ? `<span style="background:#ff453a;color:#fff;font-size:10px;font-weight:700;border-radius:3px;padding:2px 8px;letter-spacing:0.05em;">RECORD LOW</span>`
      : '';
    return `<div style="display:flex;flex-direction:column;gap:14px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.04em;">
        ${escapeHtml(ice.date)} · Arctic sea-ice extent
      </div>
      <div style="display:flex;align-items:flex-end;gap:12px;">
        <div style="font-size:36px;font-weight:800;color:${trendColor};line-height:1;">${ice.extentMillionKm2.toFixed(2)}</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);padding-bottom:6px;">
          million km²
        </div>
        ${recordBadge}
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px 16px;font-size:12px;">
        <div>1981–2010 median:</div>
        <div style="font-variant-numeric:tabular-nums;font-weight:700;">${ice.medianMillionKm2 === undefined ? '—' : `${ice.medianMillionKm2.toFixed(2)} million km²`}</div>
        <div>Anomaly:</div>
        <div style="font-variant-numeric:tabular-nums;font-weight:700;color:${trendColor};">${arrow} ${anomaly.toFixed(2)} million km²</div>
      </div>
    </div>`;
  }

  // ── Helpers ─────────────────────────────────────────────────────────



  private renderLoading(msg: string): string {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);padding:8px 0;">${escapeHtml(msg)}</div>`;
  }

  private renderEmpty(msg: string): string {
    return `<div style="font-size:12px;color:#4caf50;padding:8px 0;">${escapeHtml(msg)}</div>`;
  }

  private wireTabHandlers(): void {
    const root = this.getContentElement();
    if (!root) return;
    const buttons = root.querySelectorAll<HTMLButtonElement>('[data-weather-hazard-tab]');
    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.weatherHazardTab as TabId | undefined;
        if (!id) return;
        if (this.state.activeTab !== id) {
          this.state.activeTab = id;
          this.render();
        }
      });
    }
  }
}

