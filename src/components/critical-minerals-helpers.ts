/**
 * Pure helpers for CriticalMineralsPanel.
 *
 * Aggregates ObservationStore events (domain 'resources') into five
 * sections + computes concentration risk + reserve status from a static
 * producer fact table. Pure deterministic — no DOM, no fetch. Unit tests
 * import this module directly without dragging in the Panel base class.
 */

import type { ObservationEvent } from '@/types/intelligence';
import { escapeHtml } from '@/utils/sanitize';

export type Mineral =
  | 'lithium' | 'cobalt' | 'rare-earths' | 'nickel'
  | 'manganese' | 'graphite' | 'platinum' | 'copper' | 'tungsten';

export interface CriticalMineralsDeps {
  /** Resource-domain observations. Defaults at runtime to observationStore.query. */
  queryObservations: () => readonly ObservationEvent[];
  /** Clock injection for deterministic tests. */
  now?: () => number;
}

// ── Static producer fact table ─────────────────────────────────────────────
//
// Top producers + their global supply share, used by Concentration Risk Map
// and Processing Bottleneck Alert. Sourced from USGS Mineral Commodity
// Summaries 2024 (mine production) and Wood Mackenzie 2024 (refining).
//
// Each entry's shares are normalized to sum to ≤100 (the residual is the
// long tail of small producers).

export interface ProducerRow { country: string; mineSharePct: number; refiningSharePct: number; }

export const MINERAL_PRODUCERS: Record<Mineral, ProducerRow[]> = {
  lithium:       [
    { country: 'AUS', mineSharePct: 52, refiningSharePct: 18 },
    { country: 'CHL', mineSharePct: 22, refiningSharePct: 29 },
    { country: 'CHN', mineSharePct: 13, refiningSharePct: 65 },
  ],
  cobalt:        [
    { country: 'COD', mineSharePct: 72, refiningSharePct: 8 },
    { country: 'IDN', mineSharePct: 7,  refiningSharePct: 4 },
    { country: 'CHN', mineSharePct: 2,  refiningSharePct: 78 },
  ],
  'rare-earths': [
    { country: 'CHN', mineSharePct: 68, refiningSharePct: 87 },
    { country: 'USA', mineSharePct: 12, refiningSharePct: 3 },
    { country: 'AUS', mineSharePct: 7,  refiningSharePct: 0 },
  ],
  nickel:        [
    { country: 'IDN', mineSharePct: 50, refiningSharePct: 38 },
    { country: 'PHL', mineSharePct: 12, refiningSharePct: 0 },
    { country: 'RUS', mineSharePct: 6,  refiningSharePct: 7 },
    { country: 'CHN', mineSharePct: 4,  refiningSharePct: 35 },
  ],
  manganese:     [
    { country: 'ZAF', mineSharePct: 36, refiningSharePct: 0 },
    { country: 'GAB', mineSharePct: 22, refiningSharePct: 0 },
    { country: 'AUS', mineSharePct: 16, refiningSharePct: 0 },
    { country: 'CHN', mineSharePct: 7,  refiningSharePct: 96 },
  ],
  graphite:      [
    { country: 'CHN', mineSharePct: 77, refiningSharePct: 100 },
    { country: 'MOZ', mineSharePct: 11, refiningSharePct: 0 },
    { country: 'MDG', mineSharePct: 4,  refiningSharePct: 0 },
  ],
  platinum:      [
    { country: 'ZAF', mineSharePct: 70, refiningSharePct: 50 },
    { country: 'RUS', mineSharePct: 11, refiningSharePct: 20 },
    { country: 'ZWE', mineSharePct: 8,  refiningSharePct: 0 },
  ],
  copper:        [
    { country: 'CHL', mineSharePct: 24, refiningSharePct: 9 },
    { country: 'PER', mineSharePct: 10, refiningSharePct: 3 },
    { country: 'COD', mineSharePct: 10, refiningSharePct: 0 },
    { country: 'CHN', mineSharePct: 8,  refiningSharePct: 42 },
  ],
  tungsten:      [
    { country: 'CHN', mineSharePct: 81, refiningSharePct: 88 },
    { country: 'VNM', mineSharePct: 5,  refiningSharePct: 4 },
  ],
};

const ALL_MINERALS = Object.keys(MINERAL_PRODUCERS) as Mineral[];

// ── Safe accessors ─────────────────────────────────────────────────────────

export function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}

function readString(raw: unknown, key: string): string | undefined {
  const rec = asRecord(raw);
  const v = rec?.[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function readNumber(raw: unknown, key: string): number | undefined {
  const rec = asRecord(raw);
  const v = rec?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function readMineral(raw: unknown): Mineral | undefined {
  const m = readString(raw, 'mineral');
  if (!m) return undefined;
  const lc = m.toLowerCase().trim();
  return (ALL_MINERALS as string[]).includes(lc) ? lc as Mineral : undefined;
}

// ── Section 1: Supply Disruption Watch ─────────────────────────────────────

export type DisruptionType = 'mine-closure' | 'export-ban' | 'labor-strike' | 'geologic-event' | 'other';

const DISRUPTION_TYPE_LABEL: Record<DisruptionType, string> = {
  'mine-closure': 'Mine closure',
  'export-ban': 'Export ban',
  'labor-strike': 'Labor strike',
  'geologic-event': 'Geologic event',
  'other': 'Other',
};

export interface SupplyDisruption {
  id: string;
  mineral: Mineral;
  disruptionType: DisruptionType;
  country: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  affectedSupplyPct?: number;
  title: string;
  timestamp: number;
}

function readDisruptionType(raw: unknown): DisruptionType {
  const v = readString(raw, 'disruptionType') ?? '';
  const allowed: DisruptionType[] = ['mine-closure', 'export-ban', 'labor-strike', 'geologic-event', 'other'];
  return (allowed as string[]).includes(v) ? v as DisruptionType : 'other';
}

export function computeDisruptions(events: readonly ObservationEvent[]): SupplyDisruption[] {
  const out: SupplyDisruption[] = [];
  for (const e of events) {
    if (!e.tags.includes('disruption')) continue;
    const mineral = readMineral(e.raw);
    if (!mineral) continue;
    out.push({
      id: e.id,
      mineral,
      disruptionType: readDisruptionType(e.raw),
      country: readString(e.raw, 'country') ?? '—',
      severity: e.severity === 'INFO' ? 'LOW' : e.severity,
      affectedSupplyPct: readNumber(e.raw, 'affectedSupplyPct'),
      title: e.title,
      timestamp: e.timestamp,
    });
  }
  // Severity-weighted, newest first within tier.
  const rank: Record<SupplyDisruption['severity'], number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  out.sort((a, b) => rank[b.severity] - rank[a.severity] || b.timestamp - a.timestamp);
  return out.slice(0, 12);
}

// ── Section 2: Export Restriction Tracker ─────────────────────────────────

export interface ExportRestriction {
  id: string;
  country: string;
  mineral: Mineral;
  restrictionType: string;
  effectiveAt?: number;
  affectedImporters: string[];
  timestamp: number;
}

function readStringList(raw: unknown, key: string): string[] {
  const rec = asRecord(raw);
  const v = rec?.[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

export function computeExportRestrictions(events: readonly ObservationEvent[]): ExportRestriction[] {
  const out: ExportRestriction[] = [];
  for (const e of events) {
    if (!e.tags.includes('export-restriction')) continue;
    const mineral = readMineral(e.raw);
    if (!mineral) continue;
    out.push({
      id: e.id,
      country: readString(e.raw, 'country') ?? '—',
      mineral,
      restrictionType: readString(e.raw, 'restrictionType') ?? 'Restriction',
      effectiveAt: readNumber(e.raw, 'effectiveAt'),
      affectedImporters: readStringList(e.raw, 'affectedImporters'),
      timestamp: e.timestamp,
    });
  }
  out.sort((a, b) => (b.effectiveAt ?? b.timestamp) - (a.effectiveAt ?? a.timestamp));
  return out.slice(0, 12);
}

// ── Section 3: Concentration Risk Map ─────────────────────────────────────

export interface ConcentrationRow {
  mineral: Mineral;
  /** Herfindahl-Hirschman Index (0..10000), computed from mining shares. */
  hhi: number;
  /** Top-3 producers combined share (%). */
  top3SharePct: number;
  /** 0..4 risk band (4 = catastrophic concentration). */
  riskBand: 0 | 1 | 2 | 3 | 4;
  topProducers: { country: string; sharePct: number }[];
}

function riskBandFromHhi(hhi: number): 0 | 1 | 2 | 3 | 4 {
  if (hhi >= 6000) return 4;
  if (hhi >= 4000) return 3;
  if (hhi >= 2500) return 2;
  if (hhi >= 1500) return 1;
  return 0;
}

export function computeConcentrationRisk(): ConcentrationRow[] {
  const out: ConcentrationRow[] = [];
  for (const mineral of ALL_MINERALS) {
    const producers = MINERAL_PRODUCERS[mineral];
    const hhi = producers.reduce((sum, p) => sum + (p.mineSharePct * p.mineSharePct), 0);
    const top3 = producers.slice(0, 3);
    const top3SharePct = top3.reduce((sum, p) => sum + p.mineSharePct, 0);
    out.push({
      mineral,
      hhi: Math.round(hhi),
      top3SharePct,
      riskBand: riskBandFromHhi(hhi),
      topProducers: top3.map(p => ({ country: p.country, sharePct: p.mineSharePct })),
    });
  }
  out.sort((a, b) => b.hhi - a.hhi);
  return out;
}

// ── Section 4: Processing Bottleneck Alert ────────────────────────────────

export interface ProcessingBottleneck {
  mineral: Mineral;
  processingCountry: string;
  refiningSharePct: number;
  status: 'normal' | 'strained' | 'disrupted';
  liveAlerts: number;
}

function processingStatusFromEvents(mineral: Mineral, country: string, events: readonly ObservationEvent[]): { status: ProcessingBottleneck['status']; liveAlerts: number } {
  let critical = 0; let high = 0;
  for (const e of events) {
    if (!e.tags.includes('processing')) continue;
    if (readMineral(e.raw) !== mineral) continue;
    const evtCountry = readString(e.raw, 'country');
    if (evtCountry && evtCountry !== country) continue;
    if (e.severity === 'CRITICAL') critical += 1;
    else if (e.severity === 'HIGH') high += 1;
  }
  const liveAlerts = critical + high;
  let status: ProcessingBottleneck['status'];
  if (critical > 0) status = 'disrupted';
  else if (high > 0) status = 'strained';
  else status = 'normal';
  return { status, liveAlerts };
}

export function computeProcessingBottlenecks(events: readonly ObservationEvent[]): ProcessingBottleneck[] {
  const out: ProcessingBottleneck[] = [];
  for (const mineral of ALL_MINERALS) {
    for (const p of MINERAL_PRODUCERS[mineral]) {
      if (p.refiningSharePct < 30) continue;
      const { status, liveAlerts } = processingStatusFromEvents(mineral, p.country, events);
      out.push({
        mineral,
        processingCountry: p.country,
        refiningSharePct: p.refiningSharePct,
        status,
        liveAlerts,
      });
    }
  }
  const statusRank: Record<ProcessingBottleneck['status'], number> = { disrupted: 2, strained: 1, normal: 0 };
  out.sort((a, b) => statusRank[b.status] - statusRank[a.status] || b.refiningSharePct - a.refiningSharePct);
  return out;
}

// ── Section 5: Strategic Reserve Status ───────────────────────────────────

export type ReserveTrend = 'building' | 'stable' | 'depleting';

export interface ReserveStatus {
  id: string;
  country: string;
  mineral: Mineral;
  monthsOfSupply: number;
  trend: ReserveTrend;
  timestamp: number;
}

function readTrend(raw: unknown): ReserveTrend {
  const v = readString(raw, 'trend');
  if (v === 'building' || v === 'depleting') return v;
  return 'stable';
}

export function computeStrategicReserves(events: readonly ObservationEvent[]): ReserveStatus[] {
  const out: ReserveStatus[] = [];
  for (const e of events) {
    if (!e.tags.includes('stockpile')) continue;
    const mineral = readMineral(e.raw);
    if (!mineral) continue;
    const months = readNumber(e.raw, 'monthsOfSupply') ?? 0;
    out.push({
      id: e.id,
      country: readString(e.raw, 'country') ?? '—',
      mineral,
      monthsOfSupply: months,
      trend: readTrend(e.raw),
      timestamp: e.timestamp,
    });
  }
  // Lowest months-of-supply first (most at risk).
  out.sort((a, b) => a.monthsOfSupply - b.monthsOfSupply);
  return out.slice(0, 15);
}

// ── View model ─────────────────────────────────────────────────────────────

export interface PanelViewModel {
  disruptions: SupplyDisruption[];
  exportRestrictions: ExportRestriction[];
  concentration: ConcentrationRow[];
  processing: ProcessingBottleneck[];
  reserves: ReserveStatus[];
  errors: string[];
}

export function buildViewModel(deps: CriticalMineralsDeps): PanelViewModel {
  const errors: string[] = [];
  const eventsRaw = safe(() => deps.queryObservations());
  if (eventsRaw === undefined) errors.push('Observation store unavailable');
  const events = eventsRaw ?? [];
  return {
    disruptions: computeDisruptions(events),
    exportRestrictions: computeExportRestrictions(events),
    concentration: computeConcentrationRisk(),
    processing: computeProcessingBottlenecks(events),
    reserves: computeStrategicReserves(events),
    errors,
  };
}

// ── Rendering ──────────────────────────────────────────────────────────────

const MINERAL_LABEL: Record<Mineral, string> = {
  lithium: 'Lithium', cobalt: 'Cobalt', 'rare-earths': 'Rare earths',
  nickel: 'Nickel', manganese: 'Manganese', graphite: 'Graphite',
  platinum: 'Platinum', copper: 'Copper', tungsten: 'Tungsten',
};

const SEVERITY_BADGE: Record<SupplyDisruption['severity'], string> = {
  LOW: 'background:#9ca3af20; color:#9ca3af',
  MEDIUM: 'background:#f5a52420; color:#f5a524',
  HIGH: 'background:#e07b3020; color:#e07b30',
  CRITICAL: 'background:#e94f3720; color:#e94f37',
};

const RISK_BAND_LABEL: Record<ConcentrationRow['riskBand'], string> = {
  0: 'Low', 1: 'Moderate', 2: 'High', 3: 'Severe', 4: 'Catastrophic',
};

const RISK_BAND_COLOR: Record<ConcentrationRow['riskBand'], string> = {
  0: '#22c55e', 1: '#f5a524', 2: '#e07b30', 3: '#e94f37', 4: '#a21caf',
};

const STATUS_BADGE: Record<ProcessingBottleneck['status'], string> = {
  normal: 'background:#22c55e20; color:#22c55e',
  strained: 'background:#f5a52420; color:#f5a524',
  disrupted: 'background:#e94f3720; color:#e94f37',
};

const TREND_GLYPH: Record<ReserveTrend, string> = {
  building: '▲',
  stable: '·',
  depleting: '▼',
};

function fmtAgo(now: number, ts: number): string {
  const diffMs = Math.max(0, now - ts);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function renderDisruptions(rows: SupplyDisruption[], now: number): string {
  if (rows.length === 0) return '<div class="cm-empty">No supply disruptions tracked.</div>';
  return rows.map(r => `
    <div class="cm-row">
      <span class="cm-badge" style="${SEVERITY_BADGE[r.severity]}">${r.severity}</span>
      <span class="cm-mineral">${escapeHtml(MINERAL_LABEL[r.mineral])}</span>
      <span class="cm-cell">${escapeHtml(DISRUPTION_TYPE_LABEL[r.disruptionType])}</span>
      <span class="cm-cell">${escapeHtml(r.country)}</span>
      <span class="cm-cell">${r.affectedSupplyPct === undefined ? '—' : `${r.affectedSupplyPct.toFixed(1)}% supply`}</span>
      <span class="cm-muted">${fmtAgo(now, r.timestamp)}</span>
    </div>
  `).join('');
}

function renderExportRestrictions(rows: ExportRestriction[], now: number): string {
  if (rows.length === 0) return '<div class="cm-empty">No active export restrictions.</div>';
  return rows.map(r => `
    <div class="cm-row">
      <span class="cm-cell"><strong>${escapeHtml(r.country)}</strong> → ${escapeHtml(MINERAL_LABEL[r.mineral])}</span>
      <span class="cm-cell">${escapeHtml(r.restrictionType)}</span>
      <span class="cm-cell">${r.effectiveAt === undefined ? '—' : `eff ${fmtAgo(now, r.effectiveAt)}`}</span>
      <span class="cm-muted">affects: ${r.affectedImporters.length > 0 ? r.affectedImporters.map(i => escapeHtml(i)).join(', ') : '—'}</span>
    </div>
  `).join('');
}

function renderConcentration(rows: ConcentrationRow[]): string {
  if (rows.length === 0) return '<div class="cm-empty">No producer data.</div>';
  return rows.map(r => `
    <div class="cm-row">
      <span class="cm-mineral">${escapeHtml(MINERAL_LABEL[r.mineral])}</span>
      <span class="cm-cell">HHI ${r.hhi}</span>
      <span class="cm-cell">Top 3 ${r.top3SharePct}%</span>
      <span class="cm-badge" style="background:${RISK_BAND_COLOR[r.riskBand]}20; color:${RISK_BAND_COLOR[r.riskBand]};">${RISK_BAND_LABEL[r.riskBand]}</span>
      <span class="cm-muted">${r.topProducers.map(p => `${escapeHtml(p.country)} ${p.sharePct}%`).join(' · ')}</span>
    </div>
  `).join('');
}

function renderProcessing(rows: ProcessingBottleneck[]): string {
  if (rows.length === 0) return '<div class="cm-empty">No refining chokepoints flagged.</div>';
  return rows.map(r => `
    <div class="cm-row">
      <span class="cm-mineral">${escapeHtml(MINERAL_LABEL[r.mineral])}</span>
      <span class="cm-cell"><strong>${escapeHtml(r.processingCountry)}</strong></span>
      <span class="cm-cell">${r.refiningSharePct}% global refining</span>
      <span class="cm-badge" style="${STATUS_BADGE[r.status]}">${r.status}</span>
      <span class="cm-muted">${r.liveAlerts} live alert${r.liveAlerts === 1 ? '' : 's'}</span>
    </div>
  `).join('');
}

function renderReserves(rows: ReserveStatus[]): string {
  if (rows.length === 0) return '<div class="cm-empty">No strategic reserve data.</div>';
  return rows.map(r => `
    <div class="cm-row">
      <span class="cm-cell"><strong>${escapeHtml(r.country)}</strong></span>
      <span class="cm-mineral">${escapeHtml(MINERAL_LABEL[r.mineral])}</span>
      <span class="cm-cell">${r.monthsOfSupply.toFixed(1)} mo supply</span>
      <span class="cm-cell">${TREND_GLYPH[r.trend]} ${escapeHtml(r.trend)}</span>
    </div>
  `).join('');
}

export function renderHtml(vm: PanelViewModel, now: number): string {
  const errorRow = vm.errors.length === 0
    ? ''
    : `<div class="cm-error-row">⚠ ${vm.errors.map(e => escapeHtml(e)).join(' · ')}</div>`;
  return `
    <div class="critical-minerals">
      ${errorRow}
      <section class="cm-section">
        <h3 class="cm-section-title">Supply Disruption Watch</h3>
        ${renderDisruptions(vm.disruptions, now)}
      </section>
      <section class="cm-section">
        <h3 class="cm-section-title">Export Restriction Tracker</h3>
        ${renderExportRestrictions(vm.exportRestrictions, now)}
      </section>
      <section class="cm-section">
        <h3 class="cm-section-title">Concentration Risk Map</h3>
        ${renderConcentration(vm.concentration)}
      </section>
      <section class="cm-section">
        <h3 class="cm-section-title">Processing Bottleneck Alert</h3>
        ${renderProcessing(vm.processing)}
      </section>
      <section class="cm-section">
        <h3 class="cm-section-title">Strategic Reserve Status</h3>
        ${renderReserves(vm.reserves)}
      </section>
    </div>
  `;
}
