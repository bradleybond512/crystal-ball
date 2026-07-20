/* eslint-disable sonarjs/no-nested-template-literals */
import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getApiBaseUrl } from '@/services/runtime';
import type {
  XrayFluxState,
  GeomagState,
  EarthwardCme,
  GeomagStormLevel,
  RiskBand,
} from '@/services/spaceweather/swpc-monitor';

// ── Public state type ─────────────────────────────────────────────────

export interface SunspotRegion {
  id: string;
  latitude: number;
  longitude: number;
  area: number;
  mClass24h: number;
  xClass24h: number;
}

export interface FlareProb {
  mClassPct: number;
  xClassPct: number;
  protonEventPct: number;
  validUntil: string;
}

export interface RegionGridRisk {
  region: string;
  latitudeBand: string;
  riskLevel: 'low' | 'moderate' | 'high' | 'extreme';
  notes: string;
}

export interface SpaceSuperState {
  xray: XrayFluxState | null;
  geomag: GeomagState | null;
  cmes: EarthwardCme[];
  sunspotRegions: SunspotRegion[];
  flareProb: FlareProb | null;
  gpsRisk: RiskBand;
  hfBlackout: boolean;
  radioBlackoutZones: string[];
  gridRisks: RegionGridRisk[];
  gicRisk: 'low' | 'moderate' | 'high' | 'extreme';
  generatedAt: number;
}

// ── Constants ─────────────────────────────────────────────────────────

const REFRESH_MS = 5 * 60_000;

export const G_LEVEL_COLOR: Record<GeomagStormLevel, string> = {
  G0: '#4caf50',
  G1: '#8bc34a',
  G2: '#ffc107',
  G3: '#ff9800',
  G4: '#ff453a',
  G5: '#b71c1c',
};

const FLARE_COLOR: Record<string, string> = {
  A: '#546e7a',
  B: '#4caf50',
  C: '#8bc34a',
  M: '#ffc107',
  X: '#ff453a',
};

const GRID_RISK_COLOR: Record<RegionGridRisk['riskLevel'], string> = {
  low:      '#4caf50',
  moderate: '#ffc107',
  high:     '#ff9800',
  extreme:  '#ff453a',
};

const GIC_RISK_COLOR: Record<SpaceSuperState['gicRisk'], string> = {
  low:      '#4caf50',
  moderate: '#ffc107',
  high:     '#ff9800',
  extreme:  '#ff453a',
};

// ── Pure helpers (exported for unit tests) ────────────────────────────

export function stormLevelFromKp(kp: number): GeomagStormLevel {
  if (kp >= 9) return 'G5';
  if (kp >= 8) return 'G4';
  if (kp >= 7) return 'G3';
  if (kp >= 6) return 'G2';
  if (kp >= 5) return 'G1';
  return 'G0';
}

export function flareClassFromFlux(fluxWm2: number): string {
  if (fluxWm2 >= 1e-4) return 'X';
  if (fluxWm2 >= 1e-5) return 'M';
  if (fluxWm2 >= 1e-6) return 'C';
  if (fluxWm2 >= 1e-7) return 'B';
  return 'A';
}

export function auroraLatitude(kp: number): number {
  // Linear approximation: Kp 5 → 60°N, Kp 9 → 45°N
  const clamped = Math.max(0, Math.min(9, kp));
  if (clamped < 5) return 90;
  return Math.round(60 - (clamped - 5) * 3.75);
}

export function gpsRiskFromKp(kp: number): RiskBand {
  if (kp >= 7) return 'high';
  if (kp >= 5) return 'moderate';
  if (kp >= 3) return 'low';
  return 'none';
}

export function gridRiskForLatitude(latDeg: number): RegionGridRisk['riskLevel'] {
  const abs = Math.abs(latDeg);
  if (abs >= 65) return 'extreme';
  if (abs >= 55) return 'high';
  if (abs >= 45) return 'moderate';
  return 'low';
}

export function gicRiskFromKp(kp: number): SpaceSuperState['gicRisk'] {
  if (kp >= 8) return 'extreme';
  if (kp >= 6) return 'high';
  if (kp >= 4) return 'moderate';
  return 'low';
}

export function affectedInfrastructure(level: GeomagStormLevel): string[] {
  switch (level) {
    case 'G0': { return []; }
    case 'G1': { return ['Power systems: weak fluctuations', 'Spacecraft: minor orientation corrections']; }
    case 'G2': { return ['Power systems: voltage alerts', 'HF radio: limited blackouts at high lat', 'Spacecraft: orientation corrections, drag increase']; }
    case 'G3': { return ['Power systems: voltage corrections, false alarms', 'HF radio: intermittent', 'GPS: degraded accuracy', 'Spacecraft: significant drag']; }
    case 'G4': { return ['Power systems: widespread voltage control problems', 'HF radio: propagation degraded', 'GPS: navigation errors', 'Pipeline corrosion', 'Spacecraft: surface charging']; }
    case 'G5': { return ['Power grids: widespread collapse risk', 'HF radio: blackout possible', 'GPS: navigation unreliable', 'Pipelines: GIC saturation', 'Spacecraft: attitude anomalies']; }
  }
}

export function cmeArrivalEta(estimatedArrival: string | null, now = Date.now()): string {
  if (!estimatedArrival) return 'Unknown';
  const ms = new Date(estimatedArrival).getTime() - now;
  if (Number.isNaN(ms)) return 'Unknown';
  if (ms <= 0) return 'Arrived';
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 48) return `~${Math.floor(hours / 24)}d`;
  if (hours > 0) return `~${hours}h ${mins}m`;
  return `~${mins}m`;
}

export function kpImpactLabel(kp: number): string {
  const level = stormLevelFromKp(kp);
  if (level === 'G0') return 'No storm expected';
  return `${level} storm (Kp ≥ ${Math.ceil(kp)})`;
}

export function formatFlux(flux: number): string {
  if (flux === 0) return '0.0';
  const exp = Math.floor(Math.log10(flux));
  const mantissa = flux / Math.pow(10, exp);
  return `${mantissa.toFixed(1)}×10^${exp}`;
}

// ── Section renderers (exported for unit tests) ────────────────────────

export function renderSolarDashboard(state: SpaceSuperState): string {
  const { xray, sunspotRegions, flareProb } = state;

  const xClassBadge = xray?.xClassActive
    ? '<span style="padding:2px 6px;border-radius:3px;background:#b71c1c;color:#fff;font-size:10px;font-weight:600">X-CLASS ACTIVE</span>'
    : '';
  const fluxBlock = xray
    ? `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="font-size:22px;font-weight:700;color:${FLARE_COLOR[xray.peakClass] ?? '#cfd8dc'}">${escapeHtml(xray.peakLabel)}</span>
        <span style="font-size:12px;opacity:0.7">peak · ${escapeHtml(formatFlux(xray.currentFlux))} W/m² current</span>
        ${xClassBadge}
      </div>`
    : '<div style="opacity:0.6;font-size:12px;margin-bottom:8px">X-ray flux unavailable</div>';

  const probBlock = flareProb
    ? `<div style="display:flex;gap:12px;font-size:11px;margin-bottom:8px">
        <span>M-class: <strong>${flareProb.mClassPct}%</strong></span>
        <span>X-class: <strong>${flareProb.xClassPct}%</strong></span>
        <span>Proton event: <strong>${flareProb.protonEventPct}%</strong></span>
        <span style="opacity:0.6">Valid until ${escapeHtml(flareProb.validUntil)}</span>
      </div>`
    : '';

  const regionsBlock = sunspotRegions.length === 0
    ? '<div style="opacity:0.6;font-size:11px">No active sunspot regions reported.</div>'
    : `<div style="font-size:11px;opacity:0.75">Active sunspot regions: ${sunspotRegions.map((r) =>
        `<span style="margin-right:8px"><strong>${escapeHtml(r.id)}</strong> (lat ${r.latitude > 0 ? `+${r.latitude}` : String(r.latitude)}°, area ${r.area})</span>`
      ).join('')}</div>`;

  return section('Solar Activity Dashboard', `${fluxBlock}${probBlock}${regionsBlock}`);
}

export function renderCmeTracker(state: SpaceSuperState): string {
  if (state.cmes.length === 0) {
    return section('CME Tracker', '<div style="opacity:0.6;font-size:12px">No earthward-directed CMEs tracked.</div>');
  }
  const rows = state.cmes.slice(0, 6).map((cme) => {
    const eta = cmeArrivalEta(cme.estimatedArrival);
    const speedLabel = cme.speedKmS === null ? 'speed unknown' : `${cme.speedKmS.toFixed(0)} km/s`;
    return `<div style="padding:8px 10px;border-radius:5px;background:rgba(255,152,0,0.08);border-left:3px solid #ff9800;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:12px;font-weight:600">CME ${escapeHtml(cme.id)}</span>
        <span style="font-size:11px;color:#ffc107;font-weight:600">ETA: ${escapeHtml(eta)}</span>
      </div>
      <div style="font-size:11px;opacity:0.7;margin-top:2px">${escapeHtml(speedLabel)} · Start: ${escapeHtml(cme.startTime ?? 'unknown')}</div>
    </div>`;
  }).join('');
  return section('CME Tracker', rows);
}

export function renderGeomagWatch(state: SpaceSuperState): string {
  const { geomag } = state;
  if (!geomag) {
    return section('Geomagnetic Storm Watch', '<div style="opacity:0.6;font-size:12px">Kp index unavailable.</div>');
  }
  const color = G_LEVEL_COLOR[geomag.level];
  const infra = affectedInfrastructure(geomag.level);
  const infraHtml = infra.length === 0
    ? '<div style="font-size:11px;opacity:0.65;margin-top:6px">No significant infrastructure effects at this level.</div>'
    : `<ul style="font-size:11px;opacity:0.8;margin:6px 0 0 16px;padding:0">${infra.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;

  return section('Geomagnetic Storm Watch', `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <div style="text-align:center;padding:8px 14px;border-radius:6px;background:${color}22;border:2px solid ${color}">
        <div style="font-size:28px;font-weight:700;color:${color}">${geomag.kp.toFixed(1)}</div>
        <div style="font-size:10px;text-transform:uppercase;color:${color}">Kp index</div>
      </div>
      <div>
        <div style="font-size:16px;font-weight:600;color:${color}">${geomag.level} Storm</div>
        <div style="font-size:11px;opacity:0.7">24h max: Kp ${geomag.kpMax24h.toFixed(1)}</div>
        <div style="font-size:11px;opacity:0.7">Aurora visible ≥ ${auroraLatitude(geomag.kp)}°N</div>
      </div>
    </div>${infraHtml}`);
}

export function renderSatelliteRisk(state: SpaceSuperState): string {
  const gpsColor = GRID_RISK_COLOR[state.gpsRisk as RegionGridRisk['riskLevel']] ?? '#4caf50';
  const blackoutHtml = state.radioBlackoutZones.length > 0
    ? `<div style="font-size:11px;margin-top:4px">HF blackout zones: ${state.radioBlackoutZones.map((z) => escapeHtml(z)).join(', ')}</div>`
    : '';

  return section('Satellite Disruption Risk', `
    <div style="display:flex;gap:12px;margin-bottom:8px">
      <div style="padding:6px 12px;border-radius:4px;background:${gpsColor}22;border:1px solid ${gpsColor}">
        <div style="font-size:10px;opacity:0.7;text-transform:uppercase">GPS Risk</div>
        <div style="font-size:14px;font-weight:600;color:${gpsColor};text-transform:capitalize">${escapeHtml(state.gpsRisk)}</div>
      </div>
      <div style="padding:6px 12px;border-radius:4px;background:${state.hfBlackout ? '#ff453a22' : '#4caf5022'};border:1px solid ${state.hfBlackout ? '#ff453a' : '#4caf50'}">
        <div style="font-size:10px;opacity:0.7;text-transform:uppercase">HF Radio</div>
        <div style="font-size:14px;font-weight:600;color:${state.hfBlackout ? '#ff453a' : '#4caf50'}">${state.hfBlackout ? 'BLACKOUT' : 'Clear'}</div>
      </div>
    </div>${blackoutHtml}`);
}

export function renderInfrastructureImpact(state: SpaceSuperState): string {
  const gicColor = GIC_RISK_COLOR[state.gicRisk];
  const regionRows = state.gridRisks.map((r) => {
    const c = GRID_RISK_COLOR[r.riskLevel];
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <span style="font-size:12px">${escapeHtml(r.region)}</span>
      <span style="font-size:10px;opacity:0.7">${escapeHtml(r.latitudeBand)}</span>
      <span style="padding:2px 6px;border-radius:3px;background:${c}22;color:${c};font-size:10px;font-weight:600;text-transform:uppercase">${escapeHtml(r.riskLevel)}</span>
    </div>`;
  }).join('');

  return section('Infrastructure Impact Model', `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="font-size:12px;opacity:0.8">Pipeline GIC Risk:</span>
      <span style="padding:2px 8px;border-radius:3px;background:${gicColor}22;color:${gicColor};font-size:11px;font-weight:600;text-transform:uppercase">${escapeHtml(state.gicRisk)}</span>
    </div>
    ${regionRows.length > 0 ? `<div style="margin-top:4px">${regionRows}</div>` : '<div style="font-size:11px;opacity:0.6">No region data.</div>'}`);
}

// ── Panel ─────────────────────────────────────────────────────────────

export class SpaceSuperpowerPanel extends Panel {
  private state: SpaceSuperState = defaultState();
  private loading = false;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'space-superpower',
      title: 'Space Superpower',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep space weather intelligence: X-ray flux, CME tracking, geomagnetic storm watch (G1–G5), satellite disruption risk, and infrastructure impact model (power grid + pipeline GIC). 5-minute refresh.',
    });
    this.render();
    queueMicrotask(() => { void this.load(); });
    this.refreshTimer = setInterval(() => { void this.load(); }, REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  public setData(next: Partial<SpaceSuperState>): void {
    this.state = { ...this.state, ...next, generatedAt: Date.now() };
    this.updateCount();
    this.render();
  }

  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/api/space-weather`, { signal: this.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json() as Record<string, unknown>;
      if (!raw || typeof raw !== 'object') {
        this.setDataBadge('unavailable', 'Fetch error');
        return;
      }
      this.state = parseApiResponse(raw);
      this.updateCount();
      this.render();
    } catch (error) {
      if (!this.isAbortError(error)) {
        this.setDataBadge('unavailable', 'Fetch error');
      }
    } finally {
      this.loading = false;
    }
  }

  private updateCount(): void {
    const activeAlerts = (this.state.cmes.length > 0 ? 1 : 0)
      + (this.state.geomag && this.state.geomag.level !== 'G0' ? 1 : 0)
      + (this.state.xray?.xClassActive ? 1 : 0);
    this.setCount(activeAlerts);
  }

  private render(): void {
    const s = this.state;
    const stamp = s.generatedAt > 0
      ? `<div style="opacity:0.55;font-size:10px;margin-top:12px">Generated ${timeAgo(s.generatedAt)} · Source: NOAA SWPC / NASA DONKI</div>`
      : '';
    this.setContent(
      renderSolarDashboard(s)
      + renderCmeTracker(s)
      + renderGeomagWatch(s)
      + renderSatelliteRisk(s)
      + renderInfrastructureImpact(s)
      + stamp,
    );
  }
}

// ── Internal helpers ──────────────────────────────────────────────────

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function defaultState(): SpaceSuperState {
  return {
    xray: null,
    geomag: null,
    cmes: [],
    sunspotRegions: [],
    flareProb: null,
    gpsRisk: 'none',
    hfBlackout: false,
    radioBlackoutZones: [],
    gridRisks: defaultGridRisks(),
    gicRisk: 'low',
    generatedAt: 0,
  };
}

function defaultGridRisks(): RegionGridRisk[] {
  return [
    { region: 'Scandinavia / Iceland', latitudeBand: '60–70°N', riskLevel: 'extreme', notes: 'Highest GIC exposure' },
    { region: 'Canada / Alaska', latitudeBand: '55–65°N', riskLevel: 'high', notes: 'Long pipeline networks' },
    { region: 'Northern Europe', latitudeBand: '50–60°N', riskLevel: 'high', notes: 'HV transmission exposure' },
    { region: 'Northern US', latitudeBand: '45–55°N', riskLevel: 'moderate', notes: 'Transformer vulnerability' },
    { region: 'Mid-latitudes', latitudeBand: '30–45°N/S', riskLevel: 'low', notes: 'Reduced GIC coupling' },
  ];
}

function parseApiResponse(raw: Record<string, unknown>): SpaceSuperState {
  const state = defaultState();

  state.xray = safe(() => raw.xray as XrayFluxState) ?? null;
  state.geomag = safe(() => raw.geomag as GeomagState) ?? null;
  state.cmes = safe(() => Array.isArray(raw.cmes) ? raw.cmes as EarthwardCme[] : []) ?? [];

  const kp = safe(() => (state.geomag as GeomagState).kp) ?? 0;
  state.gpsRisk = safe(() => raw.gpsRisk as RiskBand) ?? gpsRiskFromKp(kp);
  state.hfBlackout = safe(() => Boolean(raw.hfBlackout)) ?? (state.xray?.xClassActive ?? false);
  state.gicRisk = safe(() => raw.gicRisk as SpaceSuperState['gicRisk']) ?? gicRiskFromKp(kp);
  state.generatedAt = Date.now();

  // Update grid risk levels based on current storm
  if (state.geomag && state.geomag.level !== 'G0') {
    state.gridRisks = state.gridRisks.map((r) => ({
      ...r,
      riskLevel: escalateRisk(r.riskLevel, state.geomag!.level),
    }));
  }

  return state;
}

function escalateRisk(base: RegionGridRisk['riskLevel'], storm: GeomagStormLevel): RegionGridRisk['riskLevel'] {
  const rank: Record<RegionGridRisk['riskLevel'], number> = { low: 0, moderate: 1, high: 2, extreme: 3 };
  const stormBoost: Record<GeomagStormLevel, number> = { G0: 0, G1: 0, G2: 0, G3: 1, G4: 1, G5: 2 };
  const tiers: RegionGridRisk['riskLevel'][] = ['low', 'moderate', 'high', 'extreme'];
  const newRank = Math.min(3, rank[base] + stormBoost[storm]);
  return tiers[newRank]!;
}

function section(title: string, body: string): string {
  return `<div style="margin-bottom:14px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;opacity:0.6;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.08)">${escapeHtml(title)}</div>
    ${body}
  </div>`;
}

function timeAgo(epoch: number): string {
  const s = Math.max(0, Math.floor((Date.now() - epoch) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
