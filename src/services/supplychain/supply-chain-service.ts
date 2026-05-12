/**
 * Supply Chain Disruption Service — pure-deterministic layer.
 *
 * Computes port congestion, canal queue estimates, BDI trend, and
 * chokepoint risk from caller-supplied vessel positions and FRED data.
 *
 * No DOM, no fetch, no globals. Every output is reproducible from
 * static fixtures for unit testing.
 */

import { computeDistanceKm } from '@/services/unified-alerts';
import type { UnifiedAlert } from '@/services/unified-alerts';

// ── Shared geo helper ──────────────────────────────────────────────────────



// ── Vessel position (minimal AIS shape) ────────────────────────────────────

export interface VesselPosition {
  mmsi: string;
  lat: number;
  lon: number;
  /** Speed over ground, knots. */
  sog: number;
  /** Navigational status — 1 = at anchor, 5 = moored, etc. Optional. */
  navStatus?: number;
  observedAt?: number;
}

function isAnchored(v: VesselPosition): boolean {
  return v.sog < 0.5 || v.navStatus === 1 || v.navStatus === 5;
}

// ── Port definitions (top 10 global container ports) ─────────────────────

export type PortCode =
  | 'USLA' | 'USLGB' | 'SGSIN' | 'CNSHA' | 'NLRTM'
  | 'DEHAM' | 'CNNGB' | 'USNYK' | 'BEANR' | 'KRPUS';

export interface PortConfig {
  code: PortCode;
  name: string;
  lat: number;
  lon: number;
  /** Radius within which anchored vessels count as "waiting". */
  anchorRadiusKm: number;
  /** Radius for vessels actively transiting. */
  transitRadiusKm: number;
  /** Estimated daily vessel capacity (throughput). */
  dailyCapacity: number;
}

export const PORT_CONFIGS: Record<PortCode, PortConfig> = {
  USLA:  { code: 'USLA',  name: 'Los Angeles',     lat: 33.73, lon: -118.26, anchorRadiusKm: 20, transitRadiusKm: 10, dailyCapacity: 40 },
  USLGB: { code: 'USLGB', name: 'Long Beach',      lat: 33.75, lon: -118.21, anchorRadiusKm: 20, transitRadiusKm: 10, dailyCapacity: 38 },
  SGSIN: { code: 'SGSIN', name: 'Singapore',        lat: 1.26,  lon: 103.82, anchorRadiusKm: 25, transitRadiusKm: 15, dailyCapacity: 120 },
  CNSHA: { code: 'CNSHA', name: 'Shanghai',         lat: 31.23, lon: 121.47, anchorRadiusKm: 30, transitRadiusKm: 20, dailyCapacity: 130 },
  NLRTM: { code: 'NLRTM', name: 'Rotterdam',        lat: 51.92, lon: 4.48,  anchorRadiusKm: 25, transitRadiusKm: 15, dailyCapacity: 80 },
  DEHAM: { code: 'DEHAM', name: 'Hamburg',          lat: 53.55, lon: 9.99,  anchorRadiusKm: 20, transitRadiusKm: 12, dailyCapacity: 50 },
  CNNGB: { code: 'CNNGB', name: 'Ningbo-Zhoushan', lat: 29.87, lon: 121.55, anchorRadiusKm: 30, transitRadiusKm: 20, dailyCapacity: 110 },
  USNYK: { code: 'USNYK', name: 'New York',         lat: 40.66, lon: -74.04, anchorRadiusKm: 20, transitRadiusKm: 12, dailyCapacity: 45 },
  BEANR: { code: 'BEANR', name: 'Antwerp',          lat: 51.25, lon: 4.4,  anchorRadiusKm: 20, transitRadiusKm: 12, dailyCapacity: 60 },
  KRPUS: { code: 'KRPUS', name: 'Busan',            lat: 35.1, lon: 129.04, anchorRadiusKm: 20, transitRadiusKm: 12, dailyCapacity: 70 },
};

export type CongestionTrend = 'rising' | 'falling' | 'stable';
export type CongestionLevel = 'low' | 'moderate' | 'high' | 'critical';

export interface PortStatus {
  code: PortCode;
  name: string;
  anchored: number;
  inTransit: number;
  /** 0–100. */
  congestionScore: number;
  congestionLevel: CongestionLevel;
  trend: CongestionTrend;
  computedAt: number;
}

// ── Port congestion computation ────────────────────────────────────────────

export function congestionLevelFor(score: number): CongestionLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'moderate';
  return 'low';
}

/**
 * Compute congestion score 0-100 from anchored vessel count relative to
 * the port's daily capacity. Score is clamped to [0, 100].
 */
export function scoreCongestion(anchored: number, dailyCapacity: number): number {
  if (dailyCapacity <= 0) return 0;
  return Math.min(100, Math.round((anchored / (dailyCapacity * 0.5)) * 100));
}

/**
 * Compute port status from a snapshot of vessel positions.
 * `prevAnchored` is the anchored count from the prior snapshot, used
 * to derive the congestion trend.
 */
export function computePortCongestion(
  vessels: VesselPosition[],
  portCode: PortCode,
  prevAnchored?: number,
  now = Date.now(),
): PortStatus {
  const cfg = PORT_CONFIGS[portCode];
  let anchored = 0;
  let inTransit = 0;

  for (const v of vessels) {
    const distKm = computeDistanceKm(cfg.lat, cfg.lon, v.lat, v.lon);
    if (distKm > cfg.anchorRadiusKm) continue;
    if (isAnchored(v)) {
      anchored++;
    } else if (distKm <= cfg.transitRadiusKm) {
      inTransit++;
    }
  }

  const congestionScore = scoreCongestion(anchored, cfg.dailyCapacity);

  let trend: CongestionTrend = 'stable';
  if (prevAnchored !== undefined) {
    const delta = anchored - prevAnchored;
    if (delta > 2) trend = 'rising';
    else if (delta < -2) trend = 'falling';
  }

  return {
    code: portCode,
    name: cfg.name,
    anchored,
    inTransit,
    congestionScore,
    congestionLevel: congestionLevelFor(congestionScore),
    trend,
    computedAt: now,
  };
}

// ── Canal definitions ──────────────────────────────────────────────────────

export type CanalId = 'suez' | 'panama' | 'bosphorus' | 'malacca';

export interface CanalConfig {
  id: CanalId;
  name: string;
  /** Approach zone entry point (vessels queue here). */
  approachLat: number;
  approachLon: number;
  /** Active transit zone centre. */
  transitLat: number;
  transitLon: number;
  approachRadiusKm: number;
  transitRadiusKm: number;
  /** Typical vessels processed per hour across both directions. */
  hourlyCapacity: number;
}

export const CANAL_CONFIGS: Record<CanalId, CanalConfig> = {
  suez: {
    id: 'suez', name: 'Suez Canal',
    approachLat: 30, approachLon: 32.6,
    transitLat: 30.5, transitLon: 32.3,
    approachRadiusKm: 80, transitRadiusKm: 30,
    hourlyCapacity: 2.5,
  },
  panama: {
    id: 'panama', name: 'Panama Canal',
    approachLat: 8.9, approachLon: -79.5,
    transitLat: 9.1, transitLon: -79.7,
    approachRadiusKm: 60, transitRadiusKm: 25,
    hourlyCapacity: 1.5,
  },
  bosphorus: {
    id: 'bosphorus', name: 'Bosphorus Strait',
    approachLat: 41.2, approachLon: 29,
    transitLat: 41.1, transitLon: 29.05,
    approachRadiusKm: 50, transitRadiusKm: 20,
    hourlyCapacity: 4,
  },
  malacca: {
    id: 'malacca', name: 'Strait of Malacca',
    approachLat: 1.3, approachLon: 103.5,
    transitLat: 1.5, transitLon: 104,
    approachRadiusKm: 80, transitRadiusKm: 40,
    hourlyCapacity: 5,
  },
};

export type DisruptionStatus = 'normal' | 'delayed' | 'restricted' | 'closed';

export interface CanalStatus {
  id: CanalId;
  name: string;
  /** Vessels in the approach queue (anchored outside transit zone). */
  queued: number;
  /** Vessels actively transiting. */
  inTransit: number;
  /** Estimated wait before transit begins, hours. */
  estimatedWaitHours: number;
  disruptionStatus: DisruptionStatus;
  computedAt: number;
}

// ── Canal computation ──────────────────────────────────────────────────────

/** Estimate wait hours from queue length and canal hourly capacity. */
export function estimateWaitHours(queued: number, hourlyCapacity: number): number {
  if (hourlyCapacity <= 0 || queued <= 0) return 0;
  return Math.round((queued / hourlyCapacity) * 10) / 10;
}

export function disruptionStatusFor(waitHours: number): DisruptionStatus {
  if (waitHours >= 72) return 'closed';
  if (waitHours >= 24) return 'restricted';
  if (waitHours >= 8)  return 'delayed';
  return 'normal';
}

/**
 * Compute canal status from vessel positions. Vessels in the approach zone
 * but NOT the transit zone count as queued; vessels inside the transit zone
 * count as in-transit.
 */
export function computeCanalStatus(
  vessels: VesselPosition[],
  canalId: CanalId,
  now = Date.now(),
): CanalStatus {
  const cfg = CANAL_CONFIGS[canalId];
  let queued = 0;
  let inTransit = 0;

  for (const v of vessels) {
    const approachDist = computeDistanceKm(cfg.approachLat, cfg.approachLon, v.lat, v.lon);
    const transitDist  = computeDistanceKm(cfg.transitLat,  cfg.transitLon,  v.lat, v.lon);

    if (transitDist <= cfg.transitRadiusKm) {
      inTransit++;
    } else if (approachDist <= cfg.approachRadiusKm && isAnchored(v)) {
      queued++;
    }
  }

  const waitHours = estimateWaitHours(queued, cfg.hourlyCapacity);
  return {
    id: canalId,
    name: cfg.name,
    queued,
    inTransit,
    estimatedWaitHours: waitHours,
    disruptionStatus: disruptionStatusFor(waitHours),
    computedAt: now,
  };
}

// ── BDI (Baltic Dry Index) ─────────────────────────────────────────────────

export interface BDIPoint {
  date: string;
  value: number;
}

export type BDITrend = 'rising' | 'falling' | 'stable';
export type BDILevel = 'depressed' | 'normal' | 'elevated' | 'spike';

export interface BDIData {
  /** Series identifier used (BDI or proxy). */
  series: string;
  current: number | null;
  avg90d: number | null;
  deviationPct: number | null;
  trend: BDITrend;
  level: BDILevel;
  history: BDIPoint[];
  asOf: string | null;
}

/**
 * Parse a stooq or FRED-style CSV into BDI data points.
 * Stooq header: Date,Open,High,Low,Close,Volume
 * FRED header:  DATE,VALUE
 */
export function parseBDIFromCsv(csv: string, series = 'BDI'): BDIData {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return emptyBDI(series);

  const header = lines[0]!.toLowerCase().split(',');
  const dateIdx = header.findIndex((h) => h.includes('date') || h === 'observation_date');
  // Stooq: close is index 4; FRED: value is index 1
  const valueIdx = header.includes('close') ? header.indexOf('close') : 1;

  const points: BDIPoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(',');
    if (cols.length <= Math.max(dateIdx, valueIdx)) continue;
    const date = cols[dateIdx]!.trim();
    const raw  = cols[valueIdx]!.trim();
    if (!date || raw === '' || raw === '.') continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) continue;
    points.push({ date, value });
  }

  if (points.length === 0) return emptyBDI(series);

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1]!;
  const window = sorted.slice(Math.max(0, sorted.length - 90));
  const values = window.map((p) => p.value);
  const avg90d = values.reduce((s, v) => s + v, 0) / values.length;
  const deviationPct = avg90d === 0 ? null : ((last.value - avg90d) / avg90d) * 100;
  const trend = bdiTrendFromTail(sorted.map((p) => p.value));
  const level = bdiLevelFor(deviationPct);

  return {
    series,
    current: last.value,
    avg90d: Math.round(avg90d),
    deviationPct: deviationPct === null ? null : Math.round(deviationPct * 10) / 10,
    trend,
    level,
    history: sorted.slice(-30),
    asOf: last.date,
  };
}

function emptyBDI(series: string): BDIData {
  return { series, current: null, avg90d: null, deviationPct: null, trend: 'stable', level: 'normal', history: [], asOf: null };
}

function bdiTrendFromTail(values: number[]): BDITrend {
  if (values.length < 5) return 'stable';
  const tail = values.slice(-5);
  const slope = (tail[4]! - tail[0]!) / 4;
  const ref = Math.abs(tail[0]!) || 1;
  if (slope > 0.01 * ref) return 'rising';
  if (slope < -0.01 * ref) return 'falling';
  return 'stable';
}

function bdiLevelFor(deviationPct: number | null): BDILevel {
  if (deviationPct === null) return 'normal';
  if (deviationPct >= 40) return 'spike';
  if (deviationPct >= 15) return 'elevated';
  if (deviationPct <= -20) return 'depressed';
  return 'normal';
}

// ── Chokepoint risk ────────────────────────────────────────────────────────

export interface RiskScore {
  location: string;
  /** Composite 0–100. */
  score: number;
  level: CongestionLevel;
  /** Share of score from AIS-derived closure risk (0–1). */
  aisWeight: number;
  /** Share of score from freight stress signal (0–1). */
  freightWeight: number;
  drivers: string[];
}

/**
 * Composite chokepoint risk from AIS closure risk + freight stress.
 * `closureRisk` 0–100 (from chokepoint-monitor).
 * `freightStress` 0–100 (from freight-stress computeFreightStress).
 */
export function computeChokepointRisk(
  location: string,
  closureRisk: number,
  freightStress: number,
  extraDrivers: string[] = [],
): RiskScore {
  const AIS_W = 0.65;
  const FREIGHT_W = 0.35;
  const score = Math.round(closureRisk * AIS_W + freightStress * FREIGHT_W);
  const drivers: string[] = [...extraDrivers];
  if (closureRisk >= 50) drivers.push(`Closure risk ${closureRisk}/100 (AIS)`);
  if (freightStress >= 50) drivers.push(`Freight stress ${freightStress}/100`);

  return {
    location,
    score,
    level: congestionLevelFor(score),
    aisWeight: AIS_W,
    freightWeight: FREIGHT_W,
    drivers,
  };
}

// ── ObservationStore wiring ────────────────────────────────────────────────

const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min per port
const _lastAlertTs = new Map<string, number>();

/**
 * Create a UnifiedAlert when port congestion exceeds threshold.
 * Returns null when below threshold or within cooldown window.
 */
export function portStatusToAlert(
  status: PortStatus,
  now = Date.now(),
): UnifiedAlert | null {
  if (status.congestionLevel !== 'high' && status.congestionLevel !== 'critical') return null;
  const last = _lastAlertTs.get(status.code) ?? 0;
  if (now - last < ALERT_COOLDOWN_MS) return null;
  _lastAlertTs.set(status.code, now);

  const severity = status.congestionLevel === 'critical' ? 'critical' : 'high';
  const cfg = PORT_CONFIGS[status.code];

  return {
    id: `sc-port-${status.code}-${now}`,
    source: 'maritime',
    severity,
    title: `Port Congestion: ${status.name}`,
    body: `${status.anchored} vessels at anchor — congestion score ${status.congestionScore}/100 (${status.congestionLevel}). Trend: ${status.trend}.`,
    timestamp: now,
    location: { lat: cfg.lat, lon: cfg.lon, label: status.name },
    relevanceScore: status.congestionScore / 100,
    acknowledged: false,
    pinned: false,
  };
}

/**
 * Create a UnifiedAlert when a canal queue exceeds threshold.
 */
export function canalStatusToAlert(
  status: CanalStatus,
  now = Date.now(),
): UnifiedAlert | null {
  if (status.disruptionStatus === 'normal' || status.queued < 10) return null;
  const last = _lastAlertTs.get(status.id) ?? 0;
  if (now - last < ALERT_COOLDOWN_MS) return null;
  _lastAlertTs.set(status.id, now);

  let severity: 'critical' | 'high' | 'medium' = 'medium';
  if (status.disruptionStatus === 'closed') severity = 'critical';
  else if (status.disruptionStatus === 'restricted') severity = 'high';
  const cfg = CANAL_CONFIGS[status.id];

  return {
    id: `sc-canal-${status.id}-${now}`,
    source: 'maritime',
    severity,
    title: `Canal Disruption: ${status.name}`,
    body: `${status.queued} vessels queued — estimated wait ${status.estimatedWaitHours}h (${status.disruptionStatus}).`,
    timestamp: now,
    location: { lat: cfg.approachLat, lon: cfg.approachLon, label: status.name },
    relevanceScore: Math.min(1, status.estimatedWaitHours / 48),
    acknowledged: false,
    pinned: false,
  };
}

/** Reset cooldown state — for tests only. */
export function resetAlertCooldowns(): void {
  _lastAlertTs.clear();
}

export {computeDistanceKm} from '@/services/unified-alerts';