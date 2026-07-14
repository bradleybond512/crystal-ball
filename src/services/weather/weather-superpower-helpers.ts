/**
 * Pure helpers + types for WeatherSuperpowerPanel.
 *
 * Lives in `services/weather/` so the panel can import them without
 * dragging the Panel-class transitive import chain into unit tests.
 * The panel re-exports `renderSevereTracker` etc. so external imports
 * stay backwards-compatible.
 *
 * No DOM. No fetch. Pure functions only.
 */

import { escapeHtml } from '@/utils/sanitize';

// ── Public state types ───────────────────────────────────────────────

export type WeatherSeverity = 0 | 1 | 2 | 3 | 4;

export type WeatherEventKind =
  | 'tornado'
  | 'hurricane'
  | 'blizzard'
  | 'severe-thunderstorm'
  | 'ice-storm'
  | 'derecho';

export interface SevereWeatherEvent {
  id: string;
  kind: WeatherEventKind;
  name: string;
  severity: WeatherSeverity;
  category?: number;
  region: string;
  windSpeedMph: number;
  source: string;
}

export type RiverGaugeLevel = 'normal' | 'action' | 'flood' | 'major';

export interface FloodWatch {
  id: string;
  region: string;
  precipInches: number;
  riverGauge: RiverGaugeLevel;
  alertLevel: 'watch' | 'warning';
  affectedCounties: number;
}

export type ExtremeKind = 'heat-dome' | 'polar-vortex' | 'cold-snap' | 'heat-wave';

export interface ExtremeTempEvent {
  id: string;
  kind: ExtremeKind;
  region: string;
  populationMillions: number;
  indexF: number;
  durationDays: number;
}

export type AtmHazardKind = 'wildfire-smoke' | 'volcanic-ash' | 'dust-storm';

export interface AtmosphericHazard {
  id: string;
  kind: AtmHazardKind;
  region: string;
  aqi?: number;
  visibilityMiles?: number;
  aviationImpact: 'vfr' | 'mvfr' | 'ifr' | 'lifr' | 'no-fly';
}

export type RiskTrend = 'rising' | 'steady' | 'falling';

export interface DailyRiskOutlook {
  date: string;
  riskScore: WeatherSeverity;
  leadingHazard: WeatherEventKind | ExtremeKind | AtmHazardKind | 'flood' | 'none';
  trend: RiskTrend;
}

export interface WeatherSuperState {
  severeEvents: SevereWeatherEvent[];
  floodWatches: FloodWatch[];
  extremeEvents: ExtremeTempEvent[];
  atmHazards: AtmosphericHazard[];
  weeklyOutlook: DailyRiskOutlook[];
  generatedAt: number;
}

// ── Constants ────────────────────────────────────────────────────────

export const SEVERITY_COLOR: Record<WeatherSeverity, string> = {
  0: '#9e9e9e',
  1: '#4caf50',
  2: '#ffc107',
  3: '#ff9800',
  4: '#ff453a',
};

export const GAUGE_COLOR: Record<RiverGaugeLevel, string> = {
  normal: '#4caf50',
  action: '#ffc107',
  flood:  '#ff9800',
  major:  '#ff453a',
};

export const HAZARD_LABEL: Record<AtmHazardKind, string> = {
  'wildfire-smoke': 'Wildfire smoke',
  'volcanic-ash':   'Volcanic ash',
  'dust-storm':     'Dust storm',
};

export const EXTREME_LABEL: Record<ExtremeKind, string> = {
  'heat-dome':    'Heat dome',
  'polar-vortex': 'Polar vortex',
  'cold-snap':    'Cold snap',
  'heat-wave':    'Heat wave',
};

export const TREND_GLYPH: Record<RiskTrend, string> = {
  rising:  '↑',
  steady:  '→',
  falling: '↓',
};

export const KIND_LABEL: Record<WeatherEventKind, string> = {
  tornado: 'Tornado',
  hurricane: 'Hurricane',
  blizzard: 'Blizzard',
  'severe-thunderstorm': 'Severe TStorm',
  'ice-storm': 'Ice storm',
  derecho: 'Derecho',
};

// ── Pure helpers ─────────────────────────────────────────────────────

export function severityFromHurricaneCategory(cat: number): WeatherSeverity {
  if (cat >= 5) return 4;
  if (cat === 4) return 3;
  if (cat === 3) return 2;
  if (cat >= 1) return 1;
  return 0;
}

export function severityFromEFRating(ef: number): WeatherSeverity {
  if (ef >= 4) return 4;
  if (ef === 3) return 3;
  if (ef === 2) return 2;
  if (ef >= 0) return 1;
  return 0;
}

export function severityFromGauge(level: RiverGaugeLevel): WeatherSeverity {
  switch (level) {
    case 'major': { return 4; }
    case 'flood': { return 3; }
    case 'action': { return 2; }
    case 'normal': { return 1; }
  }
}

export function severityFromHeatIndex(heatIndexF: number): WeatherSeverity {
  if (heatIndexF >= 125) return 4;
  if (heatIndexF >= 105) return 3;
  if (heatIndexF >= 90) return 2;
  if (heatIndexF >= 80) return 1;
  return 0;
}

export function severityFromWindChill(windChillF: number): WeatherSeverity {
  if (windChillF <= -40) return 4;
  if (windChillF <= -20) return 3;
  if (windChillF <= 0) return 2;
  if (windChillF <= 20) return 1;
  return 0;
}

export function severityFromAqi(aqi: number): WeatherSeverity {
  if (aqi >= 300) return 4;
  if (aqi >= 200) return 3;
  if (aqi >= 150) return 3;
  if (aqi >= 100) return 2;
  if (aqi >= 50) return 1;
  return 0;
}

export function compositeNowRisk(s: WeatherSuperState): WeatherSeverity {
  let max: WeatherSeverity = 0;
  const consider = (n: WeatherSeverity): void => { if (n > max) max = n; };
  for (const e of s.severeEvents) consider(e.severity);
  for (const f of s.floodWatches) consider(severityFromGauge(f.riverGauge));
  for (const e of s.extremeEvents) {
    consider(
      e.kind === 'cold-snap' || e.kind === 'polar-vortex'
        ? severityFromWindChill(e.indexF)
        : severityFromHeatIndex(e.indexF),
    );
  }
  for (const h of s.atmHazards) {
    if (typeof h.aqi === 'number') consider(severityFromAqi(h.aqi));
    if (h.aviationImpact === 'no-fly' || h.aviationImpact === 'lifr') consider(3);
  }
  return max;
}

export function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

export function timeAgo(epoch: number): string {
  if (!Number.isFinite(epoch) || epoch <= 0) return 'never';
  const secs = Math.max(0, Math.floor((Date.now() - epoch) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

export function defaultWeatherSuperState(): WeatherSuperState {
  return {
    severeEvents: [],
    floodWatches: [],
    extremeEvents: [],
    atmHazards: [],
    weeklyOutlook: [],
    generatedAt: 0,
  };
}

export function parseApiResponse(raw: Record<string, unknown>): WeatherSuperState {
  const state = defaultWeatherSuperState();
  state.severeEvents = safe(() => Array.isArray(raw.severeEvents) ? raw.severeEvents as SevereWeatherEvent[] : []) ?? [];
  state.floodWatches = safe(() => Array.isArray(raw.floodWatches) ? raw.floodWatches as FloodWatch[] : []) ?? [];
  state.extremeEvents = safe(() => Array.isArray(raw.extremeEvents) ? raw.extremeEvents as ExtremeTempEvent[] : []) ?? [];
  state.atmHazards = safe(() => Array.isArray(raw.atmHazards) ? raw.atmHazards as AtmosphericHazard[] : []) ?? [];
  state.weeklyOutlook = safe(() => Array.isArray(raw.weeklyOutlook) ? raw.weeklyOutlook as DailyRiskOutlook[] : []) ?? [];
  state.generatedAt = safe(() => typeof raw.generatedAt === 'number' ? raw.generatedAt : Date.now()) ?? Date.now();
  return state;
}

// ── Renderers (pure HTML-string builders) ────────────────────────────

function sectionHeader(title: string, source: string): string {
  return `<div style="display:flex;align-items:baseline;justify-content:space-between;margin:14px 0 6px;">
    <strong style="font-size:13px;">${escapeHtml(title)}</strong>
    <span style="font-size:10px;opacity:0.6;">Source: ${escapeHtml(source)}</span>
  </div>`;
}

function sevBadge(s: WeatherSeverity): string {
  return `<span style="padding:1px 6px;border-radius:3px;background:${SEVERITY_COLOR[s]};color:#000;font-size:10px;font-weight:600;">SEV ${s}</span>`;
}

export function renderSevereTracker(state: WeatherSuperState, sourceLabel = 'NWS / NHC'): string {
  const events = [...state.severeEvents].sort((a, b) => b.severity - a.severity || b.windSpeedMph - a.windSpeedMph);
  const header = sectionHeader('Severe Weather Tracker', sourceLabel);
  if (events.length === 0) {
    return `${header}<div style="font-size:11px;opacity:0.6;">No active severe weather events.</div>`;
  }
  const rows = events.slice(0, 10).map((e) => {
    const cat = e.category === undefined ? '' : ` C${e.category}`;
    return `<div style="padding:6px 8px;border-radius:4px;background:rgba(255,255,255,0.03);display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      ${sevBadge(e.severity)}
      <strong style="font-size:12px;">${escapeHtml(e.name)}</strong>
      <span style="font-size:11px;opacity:0.75;">${escapeHtml(KIND_LABEL[e.kind])}${cat}</span>
      <span style="margin-left:auto;font-size:11px;opacity:0.7;">${escapeHtml(e.region)} · ${e.windSpeedMph} mph</span>
    </div>`;
  }).join('');
  return `${header}${rows}`;
}

export function renderFloodMonitor(state: WeatherSuperState, sourceLabel = 'NWS / USGS gauges'): string {
  const watches = [...state.floodWatches].sort((a, b) => severityFromGauge(b.riverGauge) - severityFromGauge(a.riverGauge));
  const header = sectionHeader('Flash Flood Monitor', sourceLabel);
  if (watches.length === 0) {
    return `${header}<div style="font-size:11px;opacity:0.6;">No active flood watches.</div>`;
  }
  const rows = watches.slice(0, 10).map((w) => `<div style="padding:6px 8px;border-radius:4px;background:rgba(255,255,255,0.03);display:flex;align-items:center;gap:8px;margin-bottom:4px;">
    <span style="padding:1px 6px;border-radius:3px;background:${GAUGE_COLOR[w.riverGauge]};color:#000;font-size:10px;font-weight:600;text-transform:uppercase;">${escapeHtml(w.riverGauge)}</span>
    <strong style="font-size:12px;">${escapeHtml(w.region)}</strong>
    <span style="font-size:11px;opacity:0.7;">${escapeHtml(w.alertLevel)}</span>
    <span style="margin-left:auto;font-size:11px;opacity:0.75;">${w.precipInches.toFixed(2)}" · ${w.affectedCounties} counties</span>
  </div>`).join('');
  return `${header}${rows}`;
}

export function renderExtremeIndex(state: WeatherSuperState): string {
  const events = [...state.extremeEvents].sort((a, b) => b.populationMillions - a.populationMillions);
  const header = sectionHeader('Extreme Heat / Cold Index', 'NWS / CPC');
  if (events.length === 0) {
    return `${header}<div style="font-size:11px;opacity:0.6;">No extreme temperature events active.</div>`;
  }
  const rows = events.slice(0, 8).map((e) => {
    const cold = e.kind === 'cold-snap' || e.kind === 'polar-vortex';
    const sev = cold ? severityFromWindChill(e.indexF) : severityFromHeatIndex(e.indexF);
    const indexLabel = cold ? 'Wind-chill' : 'Heat-index';
    return `<div style="padding:6px 8px;border-radius:4px;background:rgba(255,255,255,0.03);display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      ${sevBadge(sev)}
      <strong style="font-size:12px;">${escapeHtml(EXTREME_LABEL[e.kind])}</strong>
      <span style="font-size:11px;opacity:0.7;">${escapeHtml(e.region)}</span>
      <span style="margin-left:auto;font-size:11px;opacity:0.8;">${escapeHtml(indexLabel)} ${e.indexF}°F · ${e.populationMillions.toFixed(1)}M ppl · ${e.durationDays}d</span>
    </div>`;
  }).join('');
  return `${header}${rows}`;
}

export function renderAtmospheric(state: WeatherSuperState, sourceLabel = 'NIFC / VAAC / NOAA'): string {
  const hazards = [...state.atmHazards];
  const header = sectionHeader('Atmospheric Hazards', sourceLabel);
  if (hazards.length === 0) {
    return `${header}<div style="font-size:11px;opacity:0.6;">No atmospheric hazards reported.</div>`;
  }
  const rows = hazards.slice(0, 10).map((h) => {
    let meta = '';
    if (typeof h.aqi === 'number') meta = `AQI ${h.aqi}`;
    else if (typeof h.visibilityMiles === 'number') meta = `Visibility ${h.visibilityMiles.toFixed(1)} mi`;
    return `<div style="padding:6px 8px;border-radius:4px;background:rgba(255,255,255,0.03);display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <span style="padding:1px 6px;border-radius:3px;background:rgba(255,152,0,0.18);font-size:10px;text-transform:uppercase;">${escapeHtml(h.aviationImpact)}</span>
      <strong style="font-size:12px;">${escapeHtml(HAZARD_LABEL[h.kind])}</strong>
      <span style="font-size:11px;opacity:0.7;">${escapeHtml(h.region)}</span>
      <span style="margin-left:auto;font-size:11px;opacity:0.8;">${escapeHtml(meta)}</span>
    </div>`;
  }).join('');
  return `${header}${rows}`;
}

export function renderWeeklyOutlook(state: WeatherSuperState): string {
  const days = [...state.weeklyOutlook].slice(0, 7);
  const header = sectionHeader('7-Day Risk Outlook', 'NWS / SPC / CPC');
  if (days.length === 0) {
    return `${header}<div style="font-size:11px;opacity:0.6;">No outlook available.</div>`;
  }
  const cells = days.map((d) => `<div style="flex:1;padding:6px;border-radius:4px;background:rgba(255,255,255,0.04);text-align:center;">
    <div style="font-size:10px;opacity:0.7;">${escapeHtml(d.date)}</div>
    <div style="margin:4px 0;">${sevBadge(d.riskScore)}</div>
    <div style="font-size:10px;opacity:0.8;">${escapeHtml(String(d.leadingHazard))}</div>
    <div style="font-size:12px;margin-top:2px;">${escapeHtml(TREND_GLYPH[d.trend])}</div>
  </div>`).join('');
  return `${header}<div style="display:flex;gap:4px;">${cells}</div>`;
}
