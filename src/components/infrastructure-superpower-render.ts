/**
 * Pure compute + render helpers for InfrastructureSuperpowerPanel.
 *
 * Isolated from the Panel base class so unit tests can exercise the
 * scoring + HTML contract without pulling in DOM, i18n, or Vite-only
 * imports (the `?worker` syntax in `@/services/ml-worker` blocks plain
 * tsx-based test runners when Panel is imported).
 */

import { escapeHtml } from '@/utils/sanitize';

// ── Public state types ──────────────────────────────────────────────

export interface PowerOutage {
  id: string;
  region: string;
  nercRegion: string;
  customersAffected: number;
  cause: string;
  restorationEtaMs: number | null;
  reportedAt: number;
}

export interface PowerSectorState {
  outages: PowerOutage[];
  hasCriticalOutage: boolean;
  totalCustomersAffected: number;
}

export type WaterAdvisoryLevel = 'advisory' | 'warning' | 'emergency';

export interface WaterAdvisory {
  id: string;
  region: string;
  level: WaterAdvisoryLevel;
  populationAffected: number;
  contaminant: string | null;
  facility: string | null;
}

export interface WaterSectorState {
  advisories: WaterAdvisory[];
  facilityDisruptions: number;
  totalPopulationAffected: number;
}

export type CdnPerformance = 'healthy' | 'degraded' | 'partial-outage' | 'major-outage';

export interface CableEvent {
  id: string;
  cableName: string;
  location: string;
  type: 'cut' | 'damage' | 'repair-in-progress';
}

/** Common provider names — but any string is accepted to admit
 *  region-specific or new providers without a code change. */
export type CloudProvider = 'AWS' | 'Azure' | 'GCP' | 'Cloudflare' | 'Akamai' | (string & {});

export interface CloudOutage {
  id: string;
  provider: CloudProvider;
  region: string;
  services: string[];
  startedAt: number;
}

export interface BgpAnomaly {
  id: string;
  asn: string;
  region: string;
  type: 'hijack' | 'leak' | 'flap';
}

export interface TelecomSectorState {
  cableEvents: CableEvent[];
  cloudOutages: CloudOutage[];
  bgpAnomalies: BgpAnomaly[];
  cdnPerformance: CdnPerformance;
}

export type TransportMode = 'highway' | 'bridge' | 'tunnel' | 'rail' | 'port' | 'airport';

export interface TransportIncident {
  id: string;
  mode: TransportMode;
  location: string;
  cause: string;
  restorationEstimateMs: number | null;
  closureDurationMs: number;
}

export interface TransportSectorState {
  incidents: TransportIncident[];
  majorHighwayClosures: number;
}

export type SectorTier = 'operational' | 'degraded' | 'stressed' | 'critical';
export type Sector = 'energy' | 'water' | 'comms' | 'transport';

export interface SectorRisk {
  sector: Sector;
  score: number;
  tier: SectorTier;
  populationAffected: number;
}

export interface RiskIndex {
  composite: number;
  tier: SectorTier;
  sectors: SectorRisk[];
}

export interface InfrastructureState {
  power: PowerSectorState;
  water: WaterSectorState;
  telecom: TelecomSectorState;
  transport: TransportSectorState;
  risk: RiskIndex;
  generatedAt: number;
}

// ── Constants ───────────────────────────────────────────────────────

export const CRITICAL_OUTAGE_CUSTOMERS = 500_000;
export const MAJOR_HIGHWAY_CLOSURE_MS = 2 * 60 * 60_000;

export const SECTOR_WEIGHTS: Record<Sector, number> = {
  energy: 0.35,
  water: 0.25,
  comms: 0.2,
  transport: 0.2,
};

export const TIER_COLOR: Record<SectorTier, string> = {
  operational: '#4caf50',
  degraded: '#ffc107',
  stressed: '#ff9800',
  critical: '#ff453a',
};

const ADVISORY_COLOR: Record<WaterAdvisoryLevel, string> = {
  advisory: '#ffc107',
  warning: '#ff9800',
  emergency: '#ff453a',
};

const CDN_COLOR: Record<CdnPerformance, string> = {
  healthy: '#4caf50',
  degraded: '#ffc107',
  'partial-outage': '#ff9800',
  'major-outage': '#ff453a',
};

// ── Pure helpers ────────────────────────────────────────────────────

export function powerSectorScore(state: PowerSectorState): number {
  if (state.totalCustomersAffected <= 0) return 0;
  const score = (Math.log10(state.totalCustomersAffected) / 7) * 100;
  return Math.min(100, Math.max(0, Math.round(score)));
}

const ADVISORY_WEIGHT: Record<WaterAdvisoryLevel, number> = {
  emergency: 3,
  warning: 2,
  advisory: 1,
};

export function waterSectorScore(state: WaterSectorState): number {
  if (state.advisories.length === 0 && state.facilityDisruptions === 0) return 0;
  let weighted = 0;
  for (const a of state.advisories) {
    const w = ADVISORY_WEIGHT[a.level];
    weighted += w * Math.max(1, Math.log10(Math.max(1, a.populationAffected)) / 7);
  }
  const facilityPenalty = state.facilityDisruptions * 5;
  return Math.min(100, Math.max(0, Math.round(weighted * 15 + facilityPenalty)));
}

const TRANSPORT_MODE_ICON: Record<TransportMode, string> = {
  highway: '🛣️',
  bridge: '🌉',
  tunnel: '🚇',
  rail: '🚆',
  port: '⚓',
  airport: '✈️',
};

const CDN_PENALTY: Record<CdnPerformance, number> = {
  'major-outage': 40,
  'partial-outage': 25,
  degraded: 12,
  healthy: 0,
};

export function telecomSectorScore(state: TelecomSectorState): number {
  const cloudPenalty = state.cloudOutages.length * 30;
  const cablePenalty = state.cableEvents.length * 15;
  const bgpPenalty = state.bgpAnomalies.length * 10;
  const cdnPenalty = CDN_PENALTY[state.cdnPerformance];
  return Math.min(100, Math.max(0, cloudPenalty + cablePenalty + bgpPenalty + cdnPenalty));
}

export function transportSectorScore(state: TransportSectorState): number {
  return Math.min(100, Math.max(0, state.incidents.length * 15 + state.majorHighwayClosures * 5));
}

export function tierFromScore(score: number): SectorTier {
  if (score >= 70) return 'critical';
  if (score >= 40) return 'stressed';
  if (score >= 15) return 'degraded';
  return 'operational';
}

export function compositeRisk(state: Omit<InfrastructureState, 'risk' | 'generatedAt'>): RiskIndex {
  const sectors: SectorRisk[] = [
    {
      sector: 'energy',
      score: powerSectorScore(state.power),
      tier: tierFromScore(powerSectorScore(state.power)),
      populationAffected: state.power.totalCustomersAffected,
    },
    {
      sector: 'water',
      score: waterSectorScore(state.water),
      tier: tierFromScore(waterSectorScore(state.water)),
      populationAffected: state.water.totalPopulationAffected,
    },
    {
      sector: 'comms',
      score: telecomSectorScore(state.telecom),
      tier: tierFromScore(telecomSectorScore(state.telecom)),
      populationAffected: 0,
    },
    {
      sector: 'transport',
      score: transportSectorScore(state.transport),
      tier: tierFromScore(transportSectorScore(state.transport)),
      populationAffected: 0,
    },
  ];
  let composite = 0;
  for (const s of sectors) composite += s.score * SECTOR_WEIGHTS[s.sector];
  const rounded = Math.round(composite);
  return { composite: rounded, tier: tierFromScore(rounded), sectors };
}

export function formatCustomers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

export function formatEta(ms: number | null, now = Date.now()): string {
  if (ms === null) return 'Unknown';
  const diff = ms - now;
  if (diff <= 0) return 'Past due';
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours >= 24) return `~${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `~${hours}h ${mins}m`;
  return `~${mins}m`;
}

// ── Engine ──────────────────────────────────────────────────────────

export class InfrastructureSuperpowerEngine {
  static defaultState(): InfrastructureState {
    const power: PowerSectorState = { outages: [], hasCriticalOutage: false, totalCustomersAffected: 0 };
    const water: WaterSectorState = { advisories: [], facilityDisruptions: 0, totalPopulationAffected: 0 };
    const telecom: TelecomSectorState = { cableEvents: [], cloudOutages: [], bgpAnomalies: [], cdnPerformance: 'healthy' };
    const transport: TransportSectorState = { incidents: [], majorHighwayClosures: 0 };
    return {
      power,
      water,
      telecom,
      transport,
      risk: compositeRisk({ power, water, telecom, transport }),
      generatedAt: 0,
    };
  }

  classifyPower(rawOutages: readonly PowerOutage[]): PowerSectorState {
    let total = 0;
    let hasCritical = false;
    for (const o of rawOutages) {
      total += Math.max(0, o.customersAffected);
      if (o.customersAffected >= CRITICAL_OUTAGE_CUSTOMERS) hasCritical = true;
    }
    return { outages: [...rawOutages], totalCustomersAffected: total, hasCriticalOutage: hasCritical };
  }

  classifyWater(rawAdvisories: readonly WaterAdvisory[], facilityDisruptions: number): WaterSectorState {
    let total = 0;
    for (const a of rawAdvisories) total += Math.max(0, a.populationAffected);
    return {
      advisories: [...rawAdvisories],
      facilityDisruptions: Math.max(0, Math.floor(facilityDisruptions)),
      totalPopulationAffected: total,
    };
  }

  classifyTransport(rawIncidents: readonly TransportIncident[]): TransportSectorState {
    let majorHighway = 0;
    for (const i of rawIncidents) {
      if (i.mode === 'highway' && i.closureDurationMs >= MAJOR_HIGHWAY_CLOSURE_MS) majorHighway += 1;
    }
    return { incidents: [...rawIncidents], majorHighwayClosures: majorHighway };
  }
}

// ── Section renderers ───────────────────────────────────────────────

export function renderPowerSection(state: PowerSectorState): string {
  const criticalBadge = state.hasCriticalOutage
    ? '<span style="padding:2px 6px;border-radius:3px;background:#b71c1c;color:#fff;font-size:10px;font-weight:600">CRITICAL OUTAGE</span>'
    : '';
  const totalLine = `<div style="font-size:12px;margin-bottom:8px">Total customers affected: <strong>${formatCustomers(state.totalCustomersAffected)}</strong> ${criticalBadge}</div>`;
  if (state.outages.length === 0) {
    return section('Grid & Power Status', `${totalLine}<div style="opacity:0.6;font-size:11px">No active outages reported.</div>`);
  }
  const rows = state.outages.slice(0, 8).map((o) => {
    const isCritical = o.customersAffected >= CRITICAL_OUTAGE_CUSTOMERS;
    const accent = isCritical ? '#ff453a' : '#ffc107';
    return `<div style="padding:6px 10px;border-radius:4px;background:${accent}11;border-left:3px solid ${accent};margin-bottom:5px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:12px;font-weight:600">${escapeHtml(o.region)}</span>
        <span style="font-size:10px;opacity:0.8;color:${accent};font-weight:600">${formatCustomers(o.customersAffected)} customers</span>
      </div>
      <div style="font-size:11px;opacity:0.7;margin-top:2px">${escapeHtml(o.nercRegion)} · ${escapeHtml(o.cause)} · ETA ${escapeHtml(formatEta(o.restorationEtaMs))}</div>
    </div>`;
  }).join('');
  return section('Grid & Power Status', `${totalLine}${rows}`);
}

export function renderWaterSection(state: WaterSectorState): string {
  if (state.advisories.length === 0 && state.facilityDisruptions === 0) {
    return section('Water & Sanitation', '<div style="opacity:0.6;font-size:11px">No active advisories or facility disruptions.</div>');
  }
  const facilityLine = state.facilityDisruptions > 0
    ? `<div style="font-size:12px;margin-bottom:6px">Treatment facility disruptions: <strong>${state.facilityDisruptions}</strong></div>`
    : '';
  const rows = state.advisories.slice(0, 8).map((a) => {
    const color = ADVISORY_COLOR[a.level];
    const contam = a.contaminant ? `· ${escapeHtml(a.contaminant)}` : '';
    const facility = a.facility ? `· ${escapeHtml(a.facility)}` : '';
    return `<div style="padding:6px 10px;border-radius:4px;background:${color}11;border-left:3px solid ${color};margin-bottom:5px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:12px;font-weight:600">${escapeHtml(a.region)}</span>
        <span style="padding:2px 6px;border-radius:3px;background:${color}22;color:${color};font-size:10px;font-weight:600;text-transform:uppercase">${a.level}</span>
      </div>
      <div style="font-size:11px;opacity:0.7;margin-top:2px">Pop ${formatCustomers(a.populationAffected)} ${contam} ${facility}</div>
    </div>`;
  }).join('');
  return section('Water & Sanitation', `${facilityLine}${rows}`);
}

export function renderTelecomSection(state: TelecomSectorState): string {
  const cdnColor = CDN_COLOR[state.cdnPerformance];
  const cdnBadge = `<span style="padding:2px 6px;border-radius:3px;background:${cdnColor}22;color:${cdnColor};font-size:10px;font-weight:600;text-transform:uppercase">CDN: ${state.cdnPerformance.replace('-', ' ')}</span>`;
  const cableRows = state.cableEvents.length === 0 ? '' : state.cableEvents.slice(0, 4).map((c) =>
    `<div style="font-size:11px;padding:3px 0">📡 <strong>${escapeHtml(c.cableName)}</strong> · ${escapeHtml(c.location)} <span style="opacity:0.7">(${escapeHtml(c.type)})</span></div>`,
  ).join('');
  const cloudRows = state.cloudOutages.length === 0 ? '' : state.cloudOutages.slice(0, 4).map((o) =>
    `<div style="font-size:11px;padding:3px 0">☁️ <strong>${escapeHtml(o.provider)}</strong> · ${escapeHtml(o.region)} <span style="opacity:0.7">(${o.services.map((s) => escapeHtml(s)).join(', ')})</span></div>`,
  ).join('');
  const bgpRows = state.bgpAnomalies.length === 0 ? '' : state.bgpAnomalies.slice(0, 4).map((b) =>
    `<div style="font-size:11px;padding:3px 0">⚠️ AS${escapeHtml(b.asn)} · ${escapeHtml(b.region)} <span style="opacity:0.7">(${escapeHtml(b.type)})</span></div>`,
  ).join('');
  const empty = !cableRows && !cloudRows && !bgpRows && state.cdnPerformance === 'healthy';
  if (empty) {
    return section('Telecommunications', `<div style="margin-bottom:6px">${cdnBadge}</div><div style="opacity:0.6;font-size:11px">No telecom anomalies.</div>`);
  }
  return section('Telecommunications', `<div style="margin-bottom:8px">${cdnBadge}</div>${cableRows}${cloudRows}${bgpRows}`);
}

export function renderTransportSection(state: TransportSectorState): string {
  if (state.incidents.length === 0) {
    return section('Transportation Networks', '<div style="opacity:0.6;font-size:11px">No active transportation incidents.</div>');
  }
  const majorLine = state.majorHighwayClosures > 0
    ? `<div style="font-size:12px;margin-bottom:6px">Major highway closures (≥2h): <strong>${state.majorHighwayClosures}</strong></div>`
    : '';
  const rows = state.incidents.slice(0, 8).map((i) => {
    const modeIcon = TRANSPORT_MODE_ICON[i.mode];
    return `<div style="padding:6px 10px;border-radius:4px;background:rgba(255,193,7,0.06);border-left:3px solid #ffc107;margin-bottom:5px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:12px;font-weight:600">${modeIcon} ${escapeHtml(i.location)}</span>
        <span style="font-size:10px;opacity:0.7;text-transform:uppercase">${escapeHtml(i.mode)}</span>
      </div>
      <div style="font-size:11px;opacity:0.7;margin-top:2px">${escapeHtml(i.cause)} · ETA ${escapeHtml(formatEta(i.restorationEstimateMs))}</div>
    </div>`;
  }).join('');
  return section('Transportation Networks', `${majorLine}${rows}`);
}

export function renderRiskIndex(risk: RiskIndex): string {
  const color = TIER_COLOR[risk.tier];
  const compositeBlock = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
    <div style="text-align:center;padding:8px 14px;border-radius:6px;background:${color}22;border:2px solid ${color}">
      <div style="font-size:28px;font-weight:700;color:${color}">${risk.composite}</div>
      <div style="font-size:10px;text-transform:uppercase;color:${color}">composite</div>
    </div>
    <div>
      <div style="font-size:16px;font-weight:600;color:${color};text-transform:uppercase">${risk.tier}</div>
      <div style="font-size:11px;opacity:0.7">Weighted: energy 35% / water 25% / comms 20% / transport 20%</div>
    </div>
  </div>`;
  const sectorRows = risk.sectors.map((s) => {
    const c = TIER_COLOR[s.tier];
    const popLine = s.populationAffected > 0 ? `<span style="font-size:10px;opacity:0.7;margin-left:6px">pop ${formatCustomers(s.populationAffected)}</span>` : '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <span style="font-size:12px;text-transform:capitalize">${escapeHtml(s.sector)}</span>
      <span style="font-size:11px;opacity:0.75">${s.score}/100${popLine}</span>
      <span style="padding:2px 6px;border-radius:3px;background:${c}22;color:${c};font-size:10px;font-weight:600;text-transform:uppercase">${escapeHtml(s.tier)}</span>
    </div>`;
  }).join('');
  return section('Critical Infrastructure Risk Index', `${compositeBlock}${sectorRows}`);
}

// ── Section helper ──────────────────────────────────────────────────

function section(title: string, body: string): string {
  return `<div style="margin-bottom:14px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;opacity:0.6;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.08)">${escapeHtml(title)}</div>
    ${body}
  </div>`;
}
