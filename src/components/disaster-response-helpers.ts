/**
 * Pure compute + render helpers for DisasterResponsePanel.
 *
 * Isolated from the Panel base class so unit tests can exercise the
 * scoring + HTML contract without pulling in DOM / i18n / Vite-only
 * imports.
 */

import { escapeHtml } from '@/utils/sanitize';
import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

// ── Public types ────────────────────────────────────────────────────

export type DisasterType = 'earthquake' | 'flood' | 'hurricane' | 'wildfire' | 'famine' | 'other';
export type ResponsePhase = 'assessment' | 'relief' | 'recovery';
export type SeverityScore = 0 | 1 | 2 | 3 | 4;

export interface DisasterOperation {
  id: string;
  name: string;
  type: DisasterType;
  region: string;
  phase: ResponsePhase;
  leadAgency: string;
  severity: SeverityScore;
  startedAt: number;
}

export type ResourceKind = 'medical' | 'food' | 'shelter' | 'search-rescue' | 'water';
export type DeploymentStatus = 'requested' | 'in-transit' | 'on-ground' | 'distributed';

export interface DeployedResource {
  id: string;
  organization: string;
  kind: ResourceKind;
  quantity: number;
  unit: string; // e.g. 'kits', 'metric tons', 'personnel'
  destination: string;
  status: DeploymentStatus;
}

export type CorridorStatus = 'open' | 'limited' | 'blocked';
export type BottleneckType = 'security' | 'infrastructure' | 'weather' | 'none';

export interface AccessCorridor {
  id: string;
  name: string;
  status: CorridorStatus;
  bottleneck: BottleneckType;
  populationReachedPct: number; // 0..100
}

export type CoordinationSector = 'health' | 'WASH' | 'shelter' | 'food' | 'protection';

export interface CoordinationGap {
  id: string;
  sector: CoordinationSector;
  gapSeverity: SeverityScore;
  responsibleCluster: string;
  unfundedUsdMillions: number;
  summary: string;
}

export interface EffectivenessScore {
  operationId: string;
  operationName: string;
  score: number; // 0..100
  coverage: number; // 0..100
  speed: number;    // 0..100
  coordination: number; // 0..100
}

export interface DisasterResponseState {
  operations: DisasterOperation[];
  resources: DeployedResource[];
  corridors: AccessCorridor[];
  gaps: CoordinationGap[];
  effectiveness: EffectivenessScore[];
  generatedAt: number;
}

// ── Constants ───────────────────────────────────────────────────────

export const SEVERITY_LABEL: Record<SeverityScore, string> = {
  0: 'INFO', 1: 'LOW', 2: 'MEDIUM', 3: 'HIGH', 4: 'CRITICAL',
};

export const SEVERITY_COLOR: Record<SeverityScore, string> = {
  0: '#9e9e9e',
  1: '#60a5fa',
  2: '#facc15',
  3: '#fb923c',
  4: '#ef4444',
};

export const PHASE_COLOR: Record<ResponsePhase, string> = {
  assessment: '#60a5fa',
  relief: '#fb923c',
  recovery: '#4ade80',
};

export const STATUS_COLOR: Record<CorridorStatus, string> = {
  open: '#4ade80',
  limited: '#facc15',
  blocked: '#ef4444',
};

export const DEPLOYMENT_STATUS_COLOR: Record<DeploymentStatus, string> = {
  requested: '#9e9e9e',
  'in-transit': '#facc15',
  'on-ground': '#60a5fa',
  distributed: '#4ade80',
};

export const SEVERITY_TO_SCORE: Record<ObservationSeverity, SeverityScore> = {
  INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};

// ── Adapters ────────────────────────────────────────────────────────

interface DisasterRaw {
  kind?: string;
  operationId?: string;
  operationName?: string;
  disasterType?: string;
  region?: string;
  phase?: string;
  leadAgency?: string;
  // resource fields
  organization?: string;
  resourceKind?: string;
  quantity?: number;
  unit?: string;
  destination?: string;
  status?: string;
  // corridor fields
  corridorName?: string;
  bottleneck?: string;
  populationReachedPct?: number;
  // gap fields
  sector?: string;
  responsibleCluster?: string;
  unfundedUsdMillions?: number;
  gapSummary?: string;
  // generic
  startedAt?: number;
}

function typeOf(s: string | undefined): DisasterType {
  switch ((s ?? '').toLowerCase()) {
    case 'earthquake': { return 'earthquake';
    }
    case 'flood': { return 'flood';
    }
    case 'hurricane': { return 'hurricane';
    }
    case 'wildfire': { return 'wildfire';
    }
    case 'famine': { return 'famine';
    }
    default: { return 'other';
    }
  }
}

function phaseOf(s: string | undefined): ResponsePhase {
  switch ((s ?? '').toLowerCase()) {
    case 'assessment': { return 'assessment';
    }
    case 'recovery': { return 'recovery';
    }
    default: { return 'relief';
    }
  }
}

function resourceKindOf(s: string | undefined): ResourceKind {
  switch ((s ?? '').toLowerCase()) {
    case 'medical': { return 'medical';
    }
    case 'food': { return 'food';
    }
    case 'shelter': { return 'shelter';
    }
    case 'search-rescue':
    case 'search_rescue':
    case 'sar': { return 'search-rescue';
    }
    case 'water': { return 'water';
    }
    default: { return 'food';
    }
  }
}

function deploymentStatusOf(s: string | undefined): DeploymentStatus {
  switch ((s ?? '').toLowerCase()) {
    case 'requested': { return 'requested';
    }
    case 'in-transit':
    case 'in_transit':
    case 'transit': { return 'in-transit';
    }
    case 'distributed': { return 'distributed';
    }
    default: { return 'on-ground';
    }
  }
}

function corridorStatusOf(s: string | undefined): CorridorStatus {
  switch ((s ?? '').toLowerCase()) {
    case 'open': { return 'open';
    }
    case 'blocked': { return 'blocked';
    }
    default: { return 'limited';
    }
  }
}

function bottleneckOf(s: string | undefined): BottleneckType {
  switch ((s ?? '').toLowerCase()) {
    case 'security': { return 'security';
    }
    case 'infrastructure': { return 'infrastructure';
    }
    case 'weather': { return 'weather';
    }
    default: { return 'none';
    }
  }
}

function sectorOf(s: string | undefined): CoordinationSector {
  switch ((s ?? '').toLowerCase()) {
    case 'health': { return 'health';
    }
    case 'wash': { return 'WASH';
    }
    case 'shelter': { return 'shelter';
    }
    case 'food': { return 'food';
    }
    default: { return 'protection';
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function getRaw(evt: ObservationEvent): DisasterRaw {
  return (evt.raw && typeof evt.raw === 'object') ? evt.raw as DisasterRaw : {};
}

export function parseDisasterOperations(events: readonly ObservationEvent[]): DisasterOperation[] {
  const out: DisasterOperation[] = [];
  for (const evt of events) {
    const raw = getRaw(evt);
    if (raw.kind !== 'operation') continue;
    out.push({
      id: typeof raw.operationId === 'string' ? raw.operationId : evt.id,
      name: typeof raw.operationName === 'string' ? raw.operationName : evt.title,
      type: typeOf(raw.disasterType),
      region: typeof raw.region === 'string' ? raw.region : 'unknown',
      phase: phaseOf(raw.phase),
      leadAgency: typeof raw.leadAgency === 'string' ? raw.leadAgency : 'unspecified',
      severity: SEVERITY_TO_SCORE[evt.severity],
      startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : evt.timestamp,
    });
  }
  out.sort((a, b) => b.severity - a.severity || b.startedAt - a.startedAt);
  return out;
}

export function parseResources(events: readonly ObservationEvent[]): DeployedResource[] {
  const out: DeployedResource[] = [];
  for (const evt of events) {
    const raw = getRaw(evt);
    if (raw.kind !== 'resource') continue;
    out.push({
      id: evt.id,
      organization: typeof raw.organization === 'string' ? raw.organization : 'unspecified',
      kind: resourceKindOf(raw.resourceKind),
      quantity: typeof raw.quantity === 'number' ? Math.max(0, raw.quantity) : 0,
      unit: typeof raw.unit === 'string' ? raw.unit : 'units',
      destination: typeof raw.destination === 'string' ? raw.destination : 'unknown',
      status: deploymentStatusOf(raw.status),
    });
  }
  return out;
}

export function parseAccessCorridors(events: readonly ObservationEvent[]): AccessCorridor[] {
  const out: AccessCorridor[] = [];
  for (const evt of events) {
    const raw = getRaw(evt);
    if (raw.kind !== 'corridor') continue;
    out.push({
      id: evt.id,
      name: typeof raw.corridorName === 'string' ? raw.corridorName : evt.title,
      status: corridorStatusOf(raw.status),
      bottleneck: bottleneckOf(raw.bottleneck),
      populationReachedPct: clamp(raw.populationReachedPct ?? 0, 0, 100),
    });
  }
  return out;
}

export function parseCoordinationGaps(events: readonly ObservationEvent[]): CoordinationGap[] {
  const out: CoordinationGap[] = [];
  for (const evt of events) {
    const raw = getRaw(evt);
    if (raw.kind !== 'gap') continue;
    out.push({
      id: evt.id,
      sector: sectorOf(raw.sector),
      gapSeverity: SEVERITY_TO_SCORE[evt.severity],
      responsibleCluster: typeof raw.responsibleCluster === 'string' ? raw.responsibleCluster : 'unassigned',
      unfundedUsdMillions: typeof raw.unfundedUsdMillions === 'number' ? Math.max(0, raw.unfundedUsdMillions) : 0,
      summary: typeof raw.gapSummary === 'string' ? raw.gapSummary : evt.title,
    });
  }
  out.sort((a, b) => b.gapSeverity - a.gapSeverity || b.unfundedUsdMillions - a.unfundedUsdMillions);
  return out;
}

// ── Effectiveness scoring ───────────────────────────────────────────

/** Coverage = average populationReachedPct across corridors serving the
 *  operation's region; if no matching corridors, default to 0. */
export function coverageScore(
  op: DisasterOperation,
  corridors: readonly AccessCorridor[],
): number {
  const matching = corridors.filter((c) =>
    c.name.toLowerCase().includes(op.region.toLowerCase())
    || op.region.toLowerCase().includes(c.name.toLowerCase()),
  );
  const pool = matching.length > 0 ? matching : corridors;
  if (pool.length === 0) return 0;
  let sum = 0;
  for (const c of pool) sum += c.populationReachedPct;
  return clamp(Math.round(sum / pool.length), 0, 100);
}

/** Speed = how far the operation has moved out of assessment phase
 *  (assessment=33, relief=66, recovery=100). */
export function speedScore(op: DisasterOperation): number {
  switch (op.phase) {
    case 'recovery': { return 100;
    }
    case 'relief': { return 66;
    }
    case 'assessment': { return 33;
    }
  }
}

/** Coordination = 100 minus 12 per HIGH/CRITICAL gap, capped 0..100. */
export function coordinationScore(gaps: readonly CoordinationGap[]): number {
  let penalty = 0;
  for (const g of gaps) {
    if (g.gapSeverity >= 3) penalty += 12;
  }
  return clamp(100 - penalty, 0, 100);
}

/** Composite = round(0.5 × coverage + 0.25 × speed + 0.25 × coordination). */
export function effectivenessFor(
  op: DisasterOperation,
  corridors: readonly AccessCorridor[],
  gaps: readonly CoordinationGap[],
): EffectivenessScore {
  const coverage = coverageScore(op, corridors);
  const speed = speedScore(op);
  const coordination = coordinationScore(gaps);
  const score = Math.round(0.5 * coverage + 0.25 * speed + 0.25 * coordination);
  return { operationId: op.id, operationName: op.name, score, coverage, speed, coordination };
}

export function buildEffectivenessIndex(
  ops: readonly DisasterOperation[],
  corridors: readonly AccessCorridor[],
  gaps: readonly CoordinationGap[],
): EffectivenessScore[] {
  return ops.map((op) => effectivenessFor(op, corridors, gaps));
}

export function effectivenessColor(score: number): string {
  if (score >= 70) return '#4ade80';
  if (score >= 50) return '#facc15';
  if (score >= 30) return '#fb923c';
  return '#ef4444';
}

export function effectivenessTier(score: number): 'strong' | 'adequate' | 'strained' | 'failing' {
  if (score >= 70) return 'strong';
  if (score >= 50) return 'adequate';
  if (score >= 30) return 'strained';
  return 'failing';
}

// ── Format helpers ──────────────────────────────────────────────────

export function formatUsdMillions(m: number): string {
  if (m >= 1000) return `$${(m / 1000).toFixed(1)}B`;
  if (m >= 1) return `$${m.toFixed(0)}M`;
  return `<$1M`;
}

export function formatQuantity(qty: number, unit: string): string {
  if (qty >= 1_000_000) return `${(qty / 1_000_000).toFixed(1)}M ${unit}`;
  if (qty >= 1000) return `${(qty / 1000).toFixed(1)}k ${unit}`;
  return `${qty} ${unit}`;
}

// ── Aggregation ─────────────────────────────────────────────────────

export function buildDisasterResponseState(
  events: readonly ObservationEvent[],
  now = Date.now(),
): DisasterResponseState {
  const operations = parseDisasterOperations(events);
  const resources = parseResources(events);
  const corridors = parseAccessCorridors(events);
  const gaps = parseCoordinationGaps(events);
  const effectiveness = buildEffectivenessIndex(operations, corridors, gaps);
  return { operations, resources, corridors, gaps, effectiveness, generatedAt: now };
}

// ── Section renderers ───────────────────────────────────────────────

function section(title: string, body: string): string {
  return `<div style="margin-bottom:14px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;opacity:0.6;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.08)">${escapeHtml(title)}</div>
    ${body}
  </div>`;
}

export function renderActiveOperations(ops: readonly DisasterOperation[]): string {
  if (ops.length === 0) {
    return section('Active Disaster Operations', '<div style="opacity:0.6;font-size:11px">No active disaster operations reported.</div>');
  }
  const rows = ops.slice(0, 10).map((op) => {
    const sevColor = SEVERITY_COLOR[op.severity];
    const phaseColor = PHASE_COLOR[op.phase];
    return `<div style="padding:6px 10px;border-radius:4px;background:${sevColor}11;border-left:3px solid ${sevColor};margin-bottom:5px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <span style="font-size:12px;font-weight:600">${escapeHtml(op.name)}</span>
        <span style="padding:2px 6px;border-radius:3px;background:${sevColor}22;color:${sevColor};font-size:10px;font-weight:600;text-transform:uppercase">${escapeHtml(SEVERITY_LABEL[op.severity])}</span>
      </div>
      <div style="font-size:11px;opacity:0.75;margin-top:2px">
        ${escapeHtml(op.type)} · ${escapeHtml(op.region)} · lead: ${escapeHtml(op.leadAgency)}
        <span style="padding:1px 5px;border-radius:3px;background:${phaseColor}22;color:${phaseColor};font-size:10px;font-weight:600;text-transform:uppercase;margin-left:6px">${escapeHtml(op.phase)}</span>
      </div>
    </div>`;
  }).join('');
  return section('Active Disaster Operations', rows);
}

export function renderResourceDeployment(resources: readonly DeployedResource[]): string {
  if (resources.length === 0) {
    return section('Resource Deployment', '<div style="opacity:0.6;font-size:11px">No deployed resources reported.</div>');
  }
  const rows = resources.slice(0, 10).map((r) => {
    const color = DEPLOYMENT_STATUS_COLOR[r.status];
    return `<div style="padding:5px 10px;border-radius:4px;background:rgba(255,255,255,0.03);border-left:3px solid ${color};margin-bottom:4px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <span style="font-size:12px;font-weight:600">${escapeHtml(r.organization)}</span>
        <span style="padding:2px 6px;border-radius:3px;background:${color}22;color:${color};font-size:10px;font-weight:600;text-transform:uppercase">${escapeHtml(r.status)}</span>
      </div>
      <div style="font-size:11px;opacity:0.75;margin-top:2px">${escapeHtml(r.kind)} · ${escapeHtml(formatQuantity(r.quantity, r.unit))} → ${escapeHtml(r.destination)}</div>
    </div>`;
  }).join('');
  return section('Resource Deployment', rows);
}

function reachedColor(pct: number): string {
  if (pct >= 75) return '#4ade80';
  if (pct >= 40) return '#facc15';
  return '#ef4444';
}

export function renderAccessLogistics(corridors: readonly AccessCorridor[]): string {
  if (corridors.length === 0) {
    return section('Access & Logistics', '<div style="opacity:0.6;font-size:11px">No corridor data.</div>');
  }
  const rows = corridors.slice(0, 10).map((c) => {
    const color = STATUS_COLOR[c.status];
    const pctColor = reachedColor(c.populationReachedPct);
    return `<div style="padding:5px 10px;border-radius:4px;background:rgba(255,255,255,0.03);border-left:3px solid ${color};margin-bottom:4px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <span style="font-size:12px;font-weight:600">${escapeHtml(c.name)}</span>
        <span style="padding:2px 6px;border-radius:3px;background:${color}22;color:${color};font-size:10px;font-weight:600;text-transform:uppercase">${escapeHtml(c.status)}</span>
      </div>
      <div style="font-size:11px;opacity:0.75;margin-top:2px">bottleneck: ${escapeHtml(c.bottleneck)} · reached <span style="color:${pctColor};font-weight:600">${c.populationReachedPct}%</span></div>
    </div>`;
  }).join('');
  return section('Access & Logistics', rows);
}

export function renderCoordinationGaps(gaps: readonly CoordinationGap[]): string {
  if (gaps.length === 0) {
    return section('Coordination Gaps', '<div style="opacity:0.6;font-size:11px">No coordination gaps reported.</div>');
  }
  const rows = gaps.slice(0, 10).map((g) => {
    const sevColor = SEVERITY_COLOR[g.gapSeverity];
    return `<div style="padding:5px 10px;border-radius:4px;background:${sevColor}11;border-left:3px solid ${sevColor};margin-bottom:4px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <span style="font-size:12px;font-weight:600">${escapeHtml(g.sector)} · ${escapeHtml(g.summary)}</span>
        <span style="padding:2px 6px;border-radius:3px;background:${sevColor}22;color:${sevColor};font-size:10px;font-weight:600;text-transform:uppercase">${escapeHtml(SEVERITY_LABEL[g.gapSeverity])}</span>
      </div>
      <div style="font-size:11px;opacity:0.75;margin-top:2px">cluster: ${escapeHtml(g.responsibleCluster)} · unfunded ${escapeHtml(formatUsdMillions(g.unfundedUsdMillions))}</div>
    </div>`;
  }).join('');
  return section('Coordination Gaps', rows);
}

export function renderEffectivenessIndex(effectiveness: readonly EffectivenessScore[]): string {
  if (effectiveness.length === 0) {
    return section('Response Effectiveness Index', '<div style="opacity:0.6;font-size:11px">No operations to score.</div>');
  }
  const rows = effectiveness.slice(0, 10).map((e) => {
    const color = effectivenessColor(e.score);
    const tier = effectivenessTier(e.score);
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <span style="font-size:12px;flex:1">${escapeHtml(e.operationName)}</span>
      <span style="font-size:11px;opacity:0.75;font-family:ui-monospace,monospace;margin-right:8px">cov ${e.coverage} · spd ${e.speed} · coord ${e.coordination}</span>
      <span style="font-size:14px;font-weight:700;color:${color};margin-right:8px">${e.score}</span>
      <span style="padding:2px 6px;border-radius:3px;background:${color}22;color:${color};font-size:10px;font-weight:600;text-transform:uppercase">${escapeHtml(tier)}</span>
    </div>`;
  }).join('');
  return section('Response Effectiveness Index', rows);
}
