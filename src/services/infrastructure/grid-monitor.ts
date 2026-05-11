/**
 * Grid Monitor — pure-deterministic foundation for the
 * infrastructure-intelligence stack.
 *
 * Pure: no DOM, no fetch, no globals at import time. Each public
 * function takes upstream-shaped JSON and returns a typed, sorted,
 * JSON-serializable summary the renderer can render directly.
 *
 * Four upstream sources, parsed independently:
 *
 *   - EIA Grid Monitor (api.eia.gov v2): per-region demand (D) and
 *     net generation (NG), megawatt-hours per day. We cover CISO,
 *     PJM, MISO, ERCO, NYIS — the five biggest US balancing
 *     authorities.
 *
 *   - PowerOutage.us: county-level outage rollup. We surface the
 *     national customers-affected total + the top counties.
 *
 *   - Cloudflare Radar BGP hijack events: prefix, expected origin AS,
 *     detected origin AS, started/ended timestamps. Severity is
 *     decided by the prefix's "well-known" classification (cloud,
 *     DNS, CDN — see KNOWN_PREFIX_TAGS).
 *
 *   - EPA RadNet near-real-time gross gamma counts. We label stations
 *     above the >100 CPM background threshold as `elevated`, with a
 *     ladder up to `extreme` for sustained anomalies.
 *
 * Plan invariants:
 *   - Every region/county/event/station record has an explicit
 *     freshness timestamp so the renderer can show "stale" badges.
 *   - State outage rollup is sorted by descending customers-affected
 *     so the top-10 view reads correctly with no resort.
 *   - BGP severity defaults to `info` and only escalates when the
 *     hijacked prefix matches a known cloud/CDN/DNS tag.
 *   - Radiation labels are a function of CPM only; we never invent
 *     a "trend" without two-snapshot input.
 */

// ─── Common types ─────────────────────────────────────────────────────

export type Severity = 'normal' | 'elevated' | 'high' | 'major' | 'extreme';

export interface StalenessBadge {
  /** ms-epoch of the most recent observation in the rollup. */
  observedAt: number | null;
  /** Reference time used to decide staleness (default: rollup builder's `now`). */
  evaluatedAt: number;
  /** Age in seconds at `evaluatedAt`. */
  ageSeconds: number;
  isStale: boolean;
}

function buildBadge(observedAt: number | null, now: number, staleAfterSec: number): StalenessBadge {
  if (observedAt === null) {
    return { observedAt: null, evaluatedAt: now, ageSeconds: Number.POSITIVE_INFINITY, isStale: true };
  }
  const ageSeconds = Math.max(0, Math.floor((now - observedAt) / 1000));
  return { observedAt, evaluatedAt: now, ageSeconds, isStale: ageSeconds > staleAfterSec };
}

// ─── EIA Grid Monitor ─────────────────────────────────────────────────

/** The five regions the panel highlights. */
export const EIA_REGIONS = ['CISO', 'PJM', 'MISO', 'ERCO', 'NYIS'] as const;
export type EiaRegion = typeof EIA_REGIONS[number];

const REGION_DISPLAY_NAMES: Record<EiaRegion, string> = {
  CISO: 'California ISO',
  PJM: 'PJM Interconnection',
  MISO: 'Midcontinent ISO',
  ERCO: 'ERCOT (Texas)',
  NYIS: 'New York ISO',
};

export interface EiaRowRaw {
  period: string;
  respondent: string;
  type: string;
  value: string | number | null;
}

export interface RegionBalance {
  region: EiaRegion;
  displayName: string;
  /** Most recent demand reading (MWh). */
  demandMwh: number | null;
  /** Most recent net-generation reading (MWh). */
  generationMwh: number | null;
  /** generationMwh − demandMwh. Positive = surplus. */
  deltaMwh: number | null;
  /** demandMwh / generationMwh ratio when both are present. */
  loadRatio: number | null;
  status: 'surplus' | 'balanced' | 'deficit' | 'unknown';
  observedDate: string | null;
}

export interface GridSnapshot {
  regions: RegionBalance[];
  /** True if every covered region returned at least one reading. */
  isComplete: boolean;
  badge: StalenessBadge;
}

const EIA_DEFICIT_PCT = 0.02; // <-2% surplus → deficit
const EIA_SURPLUS_PCT = 0.02; // >+2% surplus → surplus
const EIA_STALE_AFTER_SEC = 36 * 60 * 60; // 36h: data is daily, so a missed day is "stale"

/**
 * Build a per-region grid snapshot from a flat array of EIA-shaped rows.
 * The EIA v2 endpoint returns rows like:
 *   { period: "2026-05-05", respondent: "CISO", type: "D",  value: "850000" }
 *   { period: "2026-05-05", respondent: "CISO", type: "NG", value: "865000" }
 * We pick the latest period per (respondent, type), then derive the
 * delta and a status label.
 */
interface LatestCell { value: number; period: string; periodEpoch: number }

function foldLatestEia(rows: readonly EiaRowRaw[]): Map<string, LatestCell> {
  const latest = new Map<string, LatestCell>();
  for (const r of rows) {
    if (typeof r.respondent !== 'string' || typeof r.type !== 'string') continue;
    if (!isEiaRegion(r.respondent)) continue;
    if (r.type !== 'D' && r.type !== 'NG') continue;
    const v = typeof r.value === 'number' ? r.value : Number.parseFloat(String(r.value ?? ''));
    const epoch = parsePeriodEpoch(r.period);
    if (!Number.isFinite(v) || epoch === null) continue;
    const key = `${r.respondent}:${r.type}`;
    const cur = latest.get(key);
    if (!cur || epoch > cur.periodEpoch) {
      latest.set(key, { value: v, period: r.period, periodEpoch: epoch });
    }
  }
  return latest;
}

function regionStatus(demand: number | null, delta: number | null): RegionBalance['status'] {
  if (delta === null || demand === null || demand <= 0) return 'unknown';
  const pct = delta / demand;
  if (pct >= EIA_SURPLUS_PCT) return 'surplus';
  if (pct <= -EIA_DEFICIT_PCT) return 'deficit';
  return 'balanced';
}

export function buildGridSnapshot(
  rows: readonly EiaRowRaw[],
  now: number,
): GridSnapshot {
  const latest = foldLatestEia(rows);

  const regions: RegionBalance[] = EIA_REGIONS.map((region) => {
    const dCell = latest.get(`${region}:D`);
    const ngCell = latest.get(`${region}:NG`);
    const demand = dCell?.value ?? null;
    const generation = ngCell?.value ?? null;
    const delta = demand !== null && generation !== null ? generation - demand : null;
    const loadRatio = demand !== null && generation !== null && generation > 0
      ? demand / generation
      : null;
    return {
      region,
      displayName: REGION_DISPLAY_NAMES[region],
      demandMwh: demand,
      generationMwh: generation,
      deltaMwh: delta,
      loadRatio,
      status: regionStatus(demand, delta),
      observedDate: dCell?.period ?? ngCell?.period ?? null,
    };
  });

  const observedAtMs = [...latest.values()]
    .map((c) => c.periodEpoch)
    .reduce<number | null>((acc, x) => (acc === null || x > acc ? x : acc), null);

  return {
    regions,
    isComplete: regions.every((r) => r.demandMwh !== null && r.generationMwh !== null),
    badge: buildBadge(observedAtMs, now, EIA_STALE_AFTER_SEC),
  };
}

function isEiaRegion(s: string): s is EiaRegion {
  return (EIA_REGIONS as readonly string[]).includes(s);
}

function parsePeriodEpoch(period: unknown): number | null {
  if (typeof period !== 'string') return null;
  const t = Date.parse(period);
  return Number.isFinite(t) ? t : null;
}

// ─── PowerOutage.us ───────────────────────────────────────────────────

export interface OutageRowRaw {
  StateName?: unknown;
  CountyName?: unknown;
  CustomersTracked?: unknown;
  CustomersAffected?: unknown;
  RecordDateTime?: unknown;
  UtilityCompany?: unknown;
}

export interface CountyOutage {
  state: string;
  county: string;
  customersTracked: number;
  customersAffected: number;
  affectedRatio: number;
  utility: string | null;
  recordedAt: number | null;
}

export interface StateOutageRollup {
  state: string;
  customersAffected: number;
  countyCount: number;
  topCounty: string | null;
  severity: Severity;
}

export interface OutageSummary {
  /** Sum of customers-affected across the input. */
  nationalCustomersAffected: number;
  countyCount: number;
  topCounties: CountyOutage[];
  byState: StateOutageRollup[];
  severity: Severity;
  badge: StalenessBadge;
}

const OUTAGE_STALE_AFTER_SEC = 30 * 60; // 30 min

/** Customer thresholds for state-level outage severity. */
export const OUTAGE_STATE_THRESHOLDS: Readonly<Record<Severity, number>> = {
  normal: 0,
  elevated: 50_000,
  high: 250_000,
  major: 1_000_000,
  extreme: 3_000_000,
};

/** Customer thresholds for the national rollup. */
export const OUTAGE_NATIONAL_THRESHOLDS: Readonly<Record<Severity, number>> = {
  normal: 0,
  elevated: 250_000,
  high: 1_000_000,
  major: 3_000_000,
  extreme: 8_000_000,
};

export function severityFor(value: number, ladder: Readonly<Record<Severity, number>>): Severity {
  if (value >= ladder.extreme) return 'extreme';
  if (value >= ladder.major) return 'major';
  if (value >= ladder.high) return 'high';
  if (value >= ladder.elevated) return 'elevated';
  return 'normal';
}

export function buildOutageSummary(
  rows: readonly OutageRowRaw[],
  now: number,
  topN = 10,
): OutageSummary {
  const counties: CountyOutage[] = [];
  const stateMap = new Map<string, { customersAffected: number; countyCount: number; top: { county: string; affected: number } | null }>();
  let nationalAffected = 0;
  let mostRecent = 0;

  for (const r of rows) {
    const state = stringOrEmpty(r.StateName);
    const county = stringOrEmpty(r.CountyName);
    if (!state || !county) continue;
    const tracked = numOrZero(r.CustomersTracked);
    const affected = Math.max(0, numOrZero(r.CustomersAffected));
    if (affected <= 0) continue;
    const recordedAt = parseTimestamp(r.RecordDateTime);
    if (recordedAt !== null && recordedAt > mostRecent) mostRecent = recordedAt;
    counties.push({
      state,
      county,
      customersTracked: tracked,
      customersAffected: affected,
      affectedRatio: tracked > 0 ? affected / tracked : 0,
      utility: stringOrEmpty(r.UtilityCompany) || null,
      recordedAt,
    });
    nationalAffected += affected;
    const slot = stateMap.get(state) ?? { customersAffected: 0, countyCount: 0, top: null };
    slot.customersAffected += affected;
    slot.countyCount += 1;
    if (!slot.top || affected > slot.top.affected) {
      slot.top = { county, affected };
    }
    stateMap.set(state, slot);
  }

  counties.sort((a, b) => b.customersAffected - a.customersAffected);
  const topCounties = counties.slice(0, Math.max(0, topN));
  const byState: StateOutageRollup[] = [...stateMap.entries()]
    .map(([state, slot]) => ({
      state,
      customersAffected: slot.customersAffected,
      countyCount: slot.countyCount,
      topCounty: slot.top?.county ?? null,
      severity: severityFor(slot.customersAffected, OUTAGE_STATE_THRESHOLDS),
    }))
    .sort((a, b) => b.customersAffected - a.customersAffected);

  return {
    nationalCustomersAffected: nationalAffected,
    countyCount: counties.length,
    topCounties,
    byState,
    severity: severityFor(nationalAffected, OUTAGE_NATIONAL_THRESHOLDS),
    badge: buildBadge(mostRecent > 0 ? mostRecent : null, now, OUTAGE_STALE_AFTER_SEC),
  };
}

// ─── Cloudflare Radar BGP hijacks ─────────────────────────────────────

export interface BgpEventRaw {
  id?: unknown;
  started_at?: unknown;
  ended_at?: unknown;
  detected_origins?: unknown;
  expected_origin?: unknown;
  involved_asns?: unknown;
  prefixes?: unknown;
  type?: unknown;
}

export type BgpSeverity = 'info' | 'elevated' | 'critical';

export interface BgpEvent {
  id: string;
  startedAt: number | null;
  endedAt: number | null;
  prefixes: string[];
  expectedOriginAsn: string | null;
  detectedOriginAsns: string[];
  involvedAsns: string[];
  type: string;
  /** Tags matched against KNOWN_PREFIX_TAGS — used to escalate. */
  tags: string[];
  severity: BgpSeverity;
}

export interface BgpSummary {
  events: BgpEvent[];
  criticalCount: number;
  elevatedCount: number;
  affectedAsnSet: string[];
  badge: StalenessBadge;
}

/** Well-known prefixes that escalate a hijack event to `critical`. The
 *  list is intentionally short — we'd rather under-flag than fire on
 *  every routine route flap. */
export const KNOWN_PREFIX_TAGS: readonly { prefix: string; tag: string }[] = [
  { prefix: '8.8.8.', tag: 'google-dns' },
  { prefix: '8.8.4.', tag: 'google-dns' },
  { prefix: '1.1.1.', tag: 'cloudflare-dns' },
  { prefix: '1.0.0.', tag: 'cloudflare-dns' },
  { prefix: '9.9.9.', tag: 'quad9-dns' },
  { prefix: '208.67.222.', tag: 'opendns' },
  { prefix: '208.67.220.', tag: 'opendns' },
  { prefix: '13.107.', tag: 'azure-cdn' },
  { prefix: '52.84.', tag: 'cloudfront' },
  { prefix: '143.204.', tag: 'cloudfront' },
  { prefix: '151.101.', tag: 'fastly' },
  { prefix: '199.232.', tag: 'fastly' },
  { prefix: '23.235.', tag: 'fastly' },
];

const BGP_STALE_AFTER_SEC = 60 * 60; // 1h

export function buildBgpSummary(events: readonly BgpEventRaw[], now: number): BgpSummary {
  const out: BgpEvent[] = [];
  const asnSet = new Set<string>();
  let mostRecent = 0;
  let criticalCount = 0;
  let elevatedCount = 0;

  for (const e of events) {
    const prefixes = stringArray(e.prefixes);
    const expected = stringOrNull(e.expected_origin);
    const detected = stringArray(e.detected_origins);
    const involved = stringArray(e.involved_asns);
    const startedAt = parseTimestamp(e.started_at);
    const endedAt = parseTimestamp(e.ended_at);
    if (!prefixes.length && !involved.length) continue;
    if (startedAt !== null && startedAt > mostRecent) mostRecent = startedAt;
    const tags = collectPrefixTags(prefixes);
    const severity = decideBgpSeverity(prefixes, detected, expected, tags);
    if (severity === 'critical') criticalCount += 1;
    else if (severity === 'elevated') elevatedCount += 1;
    for (const a of [...detected, ...involved]) asnSet.add(a);
    out.push({
      id: stringOrEmpty(e.id) || `${expected ?? ''}-${prefixes[0] ?? ''}-${startedAt ?? 0}`,
      startedAt,
      endedAt,
      prefixes,
      expectedOriginAsn: expected,
      detectedOriginAsns: detected,
      involvedAsns: involved,
      type: stringOrEmpty(e.type),
      tags,
      severity,
    });
  }

  out.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || (b.startedAt ?? 0) - (a.startedAt ?? 0));

  return {
    events: out,
    criticalCount,
    elevatedCount,
    affectedAsnSet: [...asnSet],
    badge: buildBadge(mostRecent > 0 ? mostRecent : null, now, BGP_STALE_AFTER_SEC),
  };
}

function severityRank(s: BgpSeverity): number {
  if (s === 'critical') return 2;
  if (s === 'elevated') return 1;
  return 0;
}

function collectPrefixTags(prefixes: readonly string[]): string[] {
  const tags = new Set<string>();
  for (const p of prefixes) {
    for (const k of KNOWN_PREFIX_TAGS) {
      if (p.startsWith(k.prefix)) tags.add(k.tag);
    }
  }
  return [...tags];
}

function decideBgpSeverity(
  prefixes: readonly string[],
  detected: readonly string[],
  expected: string | null,
  tags: readonly string[],
): BgpSeverity {
  const hasUnexpected = expected !== null
    && detected.some((d) => d !== expected);
  if (tags.length > 0 && hasUnexpected) return 'critical';
  if (tags.length > 0 || hasUnexpected) return 'elevated';
  if (prefixes.length > 5) return 'elevated';
  return 'info';
}

// ─── EPA RadNet ───────────────────────────────────────────────────────

export interface RadStationRaw {
  StationName?: unknown;
  StationLocationName?: unknown;
  Location?: unknown;
  Latitude?: unknown;
  Longitude?: unknown;
  /** Gross gamma counts per minute. EPA varies the field name across
   *  historical exports, so we accept several spellings. */
  GammaCpm?: unknown;
  GammaCPM?: unknown;
  Gamma?: unknown;
  CountRate?: unknown;
  SampleDateTime?: unknown;
  CollectionDate?: unknown;
}

export interface RadStation {
  name: string;
  state: string | null;
  lat: number | null;
  lon: number | null;
  cpm: number | null;
  observedAt: number | null;
  severity: Severity;
}

export interface RadSummary {
  stationCount: number;
  elevatedStations: RadStation[];
  /** Highest CPM across all stations (null if no stations). */
  maxCpm: number | null;
  maxCpmStation: string | null;
  severity: Severity;
  badge: StalenessBadge;
}

export const RADIATION_BACKGROUND_CPM = 100;
export const RADIATION_THRESHOLDS: Readonly<Record<Severity, number>> = {
  normal: 0,
  elevated: 100,
  high: 200,
  major: 500,
  extreme: 1000,
};

const RADIATION_STALE_AFTER_SEC = 6 * 60 * 60; // 6h: hourly readings — gap >6h is stale

export function buildRadSummary(stations: readonly RadStationRaw[], now: number): RadSummary {
  const out: RadStation[] = [];
  let mostRecent = 0;
  let maxCpm = -Infinity;
  let maxCpmStation: string | null = null;

  for (const s of stations) {
    const cpm = readCpm(s);
    const observedAt = parseTimestamp(s.SampleDateTime ?? s.CollectionDate);
    if (observedAt !== null && observedAt > mostRecent) mostRecent = observedAt;
    const name = stringOrEmpty(s.StationLocationName ?? s.StationName ?? s.Location) || 'Unknown';
    const stateMatch = /,\s*([A-Z]{2})\b/.exec(name);
    const state = stateMatch?.[1] ?? null;
    const lat = parseNumOrNull(s.Latitude);
    const lon = parseNumOrNull(s.Longitude);
    const severity = cpm === null ? 'normal' : severityFor(cpm, RADIATION_THRESHOLDS);
    if (cpm !== null && cpm > maxCpm) {
      maxCpm = cpm;
      maxCpmStation = name;
    }
    out.push({ name, state, lat, lon, cpm, observedAt, severity });
  }

  const elevated = out
    .filter((s) => s.cpm !== null && s.cpm >= RADIATION_BACKGROUND_CPM)
    .sort((a, b) => (b.cpm ?? 0) - (a.cpm ?? 0));

  return {
    stationCount: out.length,
    elevatedStations: elevated,
    maxCpm: maxCpm === -Infinity ? null : maxCpm,
    maxCpmStation,
    severity: maxCpm === -Infinity ? 'normal' : severityFor(maxCpm, RADIATION_THRESHOLDS),
    badge: buildBadge(mostRecent > 0 ? mostRecent : null, now, RADIATION_STALE_AFTER_SEC),
  };
}

function readCpm(s: RadStationRaw): number | null {
  for (const key of ['GammaCpm', 'GammaCPM', 'Gamma', 'CountRate'] as const) {
    const v = s[key];
    if (typeof v === 'number') {
      if (Number.isFinite(v)) return v;
      continue;
    }
    if (typeof v === 'string') {
      const n = Number.parseFloat(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function stringOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function stringOrNull(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = v.trim();
    return s || null;
  }
  if (typeof v === 'number') return String(v);
  return null;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string' && item.trim()) out.push(item.trim());
    else if (typeof item === 'number') out.push(String(item));
  }
  return out;
}

function numOrZero(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseNumOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseTimestamp(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}
