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
 *   - EIA Grid Monitor (api.eia.gov v2): descriptive per-region demand
 *     (D) and net generation (NG), megawatt-hours per day. We cover CISO,
 *     PJM, MISO, ERCO, NYIS — the five biggest US balancing
 *     authorities.
 *
 *   - ORNL ODIN: exact-county utility outage reports supplied by the
 *     Disaster Lifelines snapshot. ODIN does not establish nationwide
 *     coverage, so a missing/empty/expired result remains `unknown` and
 *     a reported zero is kept distinct from an all-clear.
 *
 *   - Cloudflare Radar BGP hijack events: prefix, expected origin AS,
 *     detected origin AS, started/ended timestamps. Severity is
 *     decided by the prefix's "well-known" classification (cloud,
 *     DNS, CDN — see KNOWN_PREFIX_TAGS).
 *
 *   - EPA RadNet near-real-time gross gamma counts. We label stations
 *     at or above the 100 CPM alert threshold as `elevated`, with a
 *     ladder up to `extreme` for sustained anomalies.
 *
 * Plan invariants:
 *   - Every region/report/event/station record has an explicit
 *     freshness timestamp so the renderer can show "stale" badges.
 *   - County outage context is never promoted into a state or national
 *     rollup. Accepted utility reports are sorted by customers out.
 *   - BGP severity defaults to `info` and only escalates when the
 *     hijacked prefix matches a known cloud/CDN/DNS tag.
 *   - Radiation labels are a function of CPM only; we never invent
 *     a "trend" without two-snapshot input.
 */

// ─── Common types ─────────────────────────────────────────────────────

export type Severity = 'normal' | 'elevated' | 'high' | 'major' | 'extreme';
export type EvidenceCoverage = 'reported' | 'unknown';

export interface ProviderEvidence {
  coverage: EvidenceCoverage;
  error: string | null;
  retrievedAt: number | null;
  /** Rows rejected by the provider boundary before this pure normalizer ran. */
  droppedRows: number;
}

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
  /** Not ingested yet. D and NG alone cannot establish transfers or adequacy. */
  totalNetInterchangeMwh: null;
  /** Import/export and supply-adequacy interpretation requires same-period TI. */
  balanceInterpretation: 'unknown';
  observedDate: string | null;
}

export interface GridSnapshot {
  regions: RegionBalance[];
  /** True if every covered region returned at least one reading. */
  isComplete: boolean;
  badge: StalenessBadge;
}

export const EIA_STALE_AFTER_MS = 36 * 60 * 60 * 1000; // 36h: data is daily, so a missed day is stale
const EIA_STALE_AFTER_SEC = EIA_STALE_AFTER_MS / 1000;
const EIA_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Build a per-region grid snapshot from a flat array of EIA-shaped rows.
 * The EIA v2 endpoint returns rows like:
 *   { period: "2026-05-05", respondent: "CISO", type: "D",  value: "850000" }
 *   { period: "2026-05-05", respondent: "CISO", type: "NG", value: "865000" }
 * We pick the latest period per (respondent, type). Demand and net generation
 * remain descriptive: without same-period total net interchange (TI), their
 * difference cannot establish a shortage, surplus, import, or export.
 */
interface LatestCell { value: number; period: string; periodEpoch: number }

function oldestCell(left: LatestCell | undefined, right: LatestCell | undefined): LatestCell | undefined {
  if (!left) return right;
  if (!right) return left;
  return left.periodEpoch <= right.periodEpoch ? left : right;
}

function foldLatestEia(rows: readonly EiaRowRaw[], now: number): Map<string, LatestCell> {
  const latest = new Map<string, LatestCell>();
  for (const r of rows) {
    if (typeof r.respondent !== 'string' || typeof r.type !== 'string') continue;
    if (!isEiaRegion(r.respondent)) continue;
    if (r.type !== 'D' && r.type !== 'NG') continue;
    const v = typeof r.value === 'number' ? r.value : Number.parseFloat(String(r.value ?? ''));
    const epoch = parsePeriodEpoch(r.period);
    if (!Number.isFinite(v) || epoch === null || epoch > now + EIA_MAX_FUTURE_SKEW_MS) continue;
    const key = `${r.respondent}:${r.type}`;
    const cur = latest.get(key);
    if (!cur || epoch > cur.periodEpoch) {
      latest.set(key, { value: v, period: r.period, periodEpoch: epoch });
    }
  }
  return latest;
}

export function buildGridSnapshot(
  rows: readonly EiaRowRaw[],
  now: number,
): GridSnapshot {
  const latest = foldLatestEia(rows, now);

  const regions: RegionBalance[] = EIA_REGIONS.map((region) => {
    const dCell = latest.get(`${region}:D`);
    const ngCell = latest.get(`${region}:NG`);
    const demand = dCell?.value ?? null;
    const generation = ngCell?.value ?? null;
    const periodsAligned = dCell !== undefined && dCell.period === ngCell?.period;
    const oldest = oldestCell(dCell, ngCell);
    return {
      region,
      displayName: REGION_DISPLAY_NAMES[region],
      demandMwh: demand,
      generationMwh: generation,
      totalNetInterchangeMwh: null,
      balanceInterpretation: 'unknown',
      // A single date cannot truthfully label a balance derived from two
      // different daily periods. Null makes the mismatch fail closed in every
      // dynamic freshness consumer as well as in the initial status.
      observedDate: dCell && ngCell && !periodsAligned ? null : (oldest?.period ?? null),
    };
  });

  const observedAtMs = [...latest.values()]
    .map((c) => c.periodEpoch)
    .reduce<number | null>((acc, x) => (acc === null || x > acc ? x : acc), null);

  return {
    regions,
    isComplete: regions.every((r) => r.demandMwh !== null && r.generationMwh !== null
      && r.observedDate !== null),
    badge: buildBadge(observedAtMs, now, EIA_STALE_AFTER_SEC),
  };
}

/** Whether every EIA value that could support a displayed observation is
 *  still current at an injected clock. A single stale/future region makes the
 *  mixed snapshot unsafe to present as current EIA observations. */
export function isGridSnapshotFresh(snapshot: GridSnapshot | null, now = Date.now()): boolean {
  if (!snapshot || snapshot.badge.isStale || !Number.isFinite(now)) return false;
  const { observedAt } = snapshot.badge;
  if (typeof observedAt !== 'number' || !Number.isFinite(observedAt)
    || observedAt > now + EIA_MAX_FUTURE_SKEW_MS
    || now - observedAt > EIA_STALE_AFTER_MS) return false;
  return snapshot.regions.every((region) => {
    if (region.demandMwh === null && region.generationMwh === null) return true;
    const regionObservedAt = parsePeriodEpoch(region.observedDate);
    return regionObservedAt !== null
      && regionObservedAt <= now + EIA_MAX_FUTURE_SKEW_MS
      && now - regionObservedAt <= EIA_STALE_AFTER_MS;
  });
}

function isEiaRegion(s: string): s is EiaRegion {
  return (EIA_REGIONS as readonly string[]).includes(s);
}

function parsePeriodEpoch(period: unknown): number | null {
  if (typeof period !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const t = Date.UTC(year, month - 1, day);
  const date = new Date(t);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day ? t : null;
}

// ─── ORNL ODIN county outage context ──────────────────────────────────

export type OutageCoverage = 'reported' | 'unknown';
export type OutageCompleteness = 'reported' | 'partial' | 'unknown';
export type OutageUnknownReason =
  | 'awaiting_lifeline_context'
  | 'county_fips_unknown'
  | 'provider_unavailable'
  | 'no_accepted_reports'
  | 'expired_reports'
  | 'malformed_snapshot';

export interface CountyOutage {
  countyFips: string;
  state: string;
  county: string;
  customersOut: number;
  customersRestored: number | null;
  utility: string | null;
  utilityId: string | null;
  /** ODIN currently exposes retrieval time, not a source observation time. */
  retrievedAt: number;
  expiresAt: number;
}

export interface OutageSummary {
  source: 'ornl-odin';
  coverage: OutageCoverage;
  completeness: OutageCompleteness;
  placeId: string | null;
  placeName: string | null;
  countyFips: string | null;
  county: string | null;
  state: string | null;
  /** Sum across accepted, unexpired ODIN utility reports; null means unknown. */
  reportedCustomersOut: number | null;
  /** Sum only when every accepted report supplies a restored count. */
  reportedCustomersRestored: number | null;
  reportCount: number;
  reports: CountyOutage[];
  providerState: 'ok' | 'partial' | 'empty' | 'stale' | 'error' | 'unavailable';
  unknownReason: OutageUnknownReason | null;
  severity: Severity;
  badge: StalenessBadge;
}

const OUTAGE_STALE_AFTER_SEC = 30 * 60;
const MAX_ODIN_REPORTS = 100;
const MAX_OUTAGE_CUSTOMERS = 1_000_000_000;

/**
 * Display-only bands for an exact-county accepted-report sum. They are not a
 * county service-status classification and never imply facility power.
 */
export const OUTAGE_REPORTED_THRESHOLDS: Readonly<Record<Severity, number>> = {
  normal: 0,
  elevated: 1,
  high: 10_000,
  major: 50_000,
  extreme: 100_000,
};

export function severityFor(value: number, ladder: Readonly<Record<Severity, number>>): Severity {
  if (value >= ladder.extreme) return 'extreme';
  if (value >= ladder.major) return 'major';
  if (value >= ladder.high) return 'high';
  if (value >= ladder.elevated) return 'elevated';
  return 'normal';
}

type OutageContext = Partial<Pick<
  OutageSummary,
  'placeId' | 'placeName' | 'countyFips' | 'providerState' | 'badge'
>>;

interface ParsedOutageProvider {
  state: Exclude<OutageSummary['providerState'], 'unavailable'>;
  acceptedRows: number;
  droppedRows: number;
  retrievedAt: number | null;
}

interface ParsedOutageProviderResult {
  value: ParsedOutageProvider | null;
  error: 'missing' | 'malformed' | null;
}

interface ParsedCountyOutageResult {
  value: CountyOutage | null;
  error: 'malformed' | 'expired' | null;
}

interface ParsedCountyOutagesResult {
  value: CountyOutage[] | null;
  error: 'malformed' | 'expired' | null;
}

interface ParsedOutageSnapshot {
  value: {
    record: Record<string, unknown>;
    placeId: string;
    placeName: string;
    countyFips: string;
    providers: unknown[];
    areaConditions: unknown[];
  } | null;
  reason: OutageUnknownReason;
  context?: OutageContext;
}

function unknownOutageSummary(reason: OutageUnknownReason, now: number, context?: OutageContext): OutageSummary {
  return {
    source: 'ornl-odin',
    coverage: 'unknown',
    completeness: 'unknown',
    placeId: context?.placeId ?? null,
    placeName: context?.placeName ?? null,
    countyFips: context?.countyFips ?? null,
    county: null,
    state: null,
    reportedCustomersOut: null,
    reportedCustomersRestored: null,
    reportCount: 0,
    reports: [],
    providerState: context?.providerState ?? 'unavailable',
    unknownReason: reason,
    severity: 'normal',
    badge: context?.badge ?? buildBadge(null, now, OUTAGE_STALE_AFTER_SEC),
  };
}

function parseOutageSnapshot(snapshot: unknown): ParsedOutageSnapshot {
  if (snapshot === null || snapshot === undefined) return { value: null, reason: 'awaiting_lifeline_context' };
  if (!isRecord(snapshot) || snapshot.schemaVersion !== 2) return { value: null, reason: 'malformed_snapshot' };
  const placeId = boundedStringOrNull(snapshot.placeId, 160);
  const placeName = boundedStringOrNull(snapshot.placeName, 160);
  if (!placeId || !placeName) return { value: null, reason: 'malformed_snapshot' };
  const context = { placeId, placeName };
  if (!Array.isArray(snapshot.providers) || snapshot.providers.length > 16
    || !Array.isArray(snapshot.areaConditions) || snapshot.areaConditions.length > MAX_ODIN_REPORTS) {
    return { value: null, reason: 'malformed_snapshot', context };
  }
  const countyFips = typeof snapshot.countyFips === 'string' && /^\d{5}$/.test(snapshot.countyFips)
    ? snapshot.countyFips : null;
  if (!countyFips) return { value: null, reason: 'county_fips_unknown', context: { ...context, countyFips } };
  return {
    value: {
      record: snapshot,
      placeId,
      placeName,
      countyFips,
      providers: snapshot.providers,
      areaConditions: snapshot.areaConditions,
    },
    reason: 'malformed_snapshot',
  };
}

function parseOutageProvider(providers: unknown[]): ParsedOutageProviderResult {
  const raw: unknown = providers.find((item: unknown) => isRecord(item) && item.id === 'ornl-odin');
  if (!isRecord(raw)) return { value: null, error: 'missing' };
  const states = new Set(['ok', 'partial', 'empty', 'stale', 'error']);
  if (typeof raw.state !== 'string' || !states.has(raw.state)) return { value: null, error: 'malformed' };
  const acceptedRows = safeBoundedInteger(raw.acceptedRows, 0, MAX_ODIN_REPORTS);
  const droppedRows = safeBoundedInteger(raw.droppedRows, 0, MAX_ODIN_REPORTS);
  if (acceptedRows === null || droppedRows === null) return { value: null, error: 'malformed' };
  return {
    value: {
      state: raw.state as ParsedOutageProvider['state'],
      acceptedRows,
      droppedRows,
      retrievedAt: parseTimestamp(raw.retrievedAt ?? raw.observedAt),
    },
    error: null,
  };
}

function parseCountyOutage(item: unknown, countyFips: string, now: number): ParsedCountyOutageResult {
  if (!isRecord(item) || item.type !== 'power_outage' || item.source !== 'ornl-odin'
    || item.coverage !== 'reported' || item.countyFips !== countyFips) {
    return { value: null, error: 'malformed' };
  }
  const county = boundedStringOrNull(item.county, 160);
  const state = boundedStringOrNull(item.state, 80);
  const customersOut = safeBoundedInteger(item.customersOut, 0, MAX_OUTAGE_CUSTOMERS);
  const retrievedAt = parseTimestamp(item.retrievedAt ?? item.observedAt);
  const expiresAt = parseTimestamp(item.expiresAt);
  if (!county || !state || customersOut === null || retrievedAt === null || expiresAt === null
    || expiresAt < retrievedAt) return { value: null, error: 'malformed' };
  if (expiresAt <= now) return { value: null, error: 'expired' };
  const restored = item.customersRestored === undefined
    ? null : safeBoundedInteger(item.customersRestored, 0, MAX_OUTAGE_CUSTOMERS);
  if (item.customersRestored !== undefined && restored === null) return { value: null, error: 'malformed' };
  return {
    value: {
      countyFips,
      county,
      state,
      customersOut,
      customersRestored: restored,
      utility: boundedStringOrNull(item.utilityName, 160),
      utilityId: boundedStringOrNull(item.utilityId, 80),
      retrievedAt,
      expiresAt,
    },
    error: null,
  };
}

function parseCountyOutages(
  values: unknown[],
  countyFips: string,
  now: number,
): ParsedCountyOutagesResult {
  const reports: CountyOutage[] = [];
  for (const value of values) {
    const result = parseCountyOutage(value, countyFips, now);
    if (result.error || !result.value) return { value: null, error: result.error ?? 'malformed' };
    reports.push(result.value);
  }
  return { value: reports, error: null };
}

export function buildOutageSummary(snapshot: unknown, now: number): OutageSummary {
  const parsedSnapshot = parseOutageSnapshot(snapshot);
  if (!parsedSnapshot.value) return unknownOutageSummary(parsedSnapshot.reason, now, parsedSnapshot.context);
  const { placeId, placeName, countyFips, providers, areaConditions } = parsedSnapshot.value;
  const baseContext = { placeId, placeName, countyFips };

  const providerResult = parseOutageProvider(providers);
  if (!providerResult.value) {
    const reason = providerResult.error === 'missing' ? 'provider_unavailable' : 'malformed_snapshot';
    return unknownOutageSummary(reason, now, baseContext);
  }
  const provider = providerResult.value;
  const providerBadge = buildBadge(provider.retrievedAt, now, OUTAGE_STALE_AFTER_SEC);
  const providerContext = { ...baseContext, providerState: provider.state, badge: providerBadge };
  if (provider.state === 'error' || provider.state === 'stale') {
    return unknownOutageSummary('provider_unavailable', now, providerContext);
  }
  if (provider.state === 'empty' || provider.acceptedRows === 0) {
    return unknownOutageSummary('no_accepted_reports', now, providerContext);
  }
  if (provider.retrievedAt === null) return unknownOutageSummary('malformed_snapshot', now, providerContext);

  const reportResult = parseCountyOutages(areaConditions, countyFips, now);
  if (reportResult.error === 'expired') {
    return unknownOutageSummary('expired_reports', now, {
      ...providerContext,
      badge: { ...providerBadge, isStale: true },
    });
  }
  const reports = reportResult.value;
  if (!reports || reportResult.error === 'malformed'
    || reports.length !== provider.acceptedRows || reports.length === 0) {
    return unknownOutageSummary('malformed_snapshot', now, providerContext);
  }
  const county = reports[0]!.county;
  const state = reports[0]!.state;
  if (reports.some((report) => report.county !== county || report.state !== state)) {
    return unknownOutageSummary('malformed_snapshot', now, providerContext);
  }
  reports.sort((left, right) => right.customersOut - left.customersOut
    || (left.utility ?? '').localeCompare(right.utility ?? ''));
  const reportedCustomersOut = reports.reduce((sum, report) => sum + report.customersOut, 0);
  if (!Number.isSafeInteger(reportedCustomersOut)) return unknownOutageSummary('malformed_snapshot', now, providerContext);
  const reportedCustomersRestored = reports.every((report) => report.customersRestored !== null)
    ? reports.reduce((sum, report) => sum + (report.customersRestored ?? 0), 0)
    : null;

  return {
    source: 'ornl-odin',
    coverage: 'reported',
    completeness: provider.state === 'partial' || provider.droppedRows > 0 ? 'partial' : 'reported',
    placeId,
    placeName,
    countyFips,
    county,
    state,
    reportedCustomersOut,
    reportedCustomersRestored,
    reportCount: reports.length,
    reports,
    providerState: provider.state,
    unknownReason: null,
    severity: severityFor(reportedCustomersOut, OUTAGE_REPORTED_THRESHOLDS),
    badge: providerBadge,
  };
}

/** Re-evaluate retrieval age/expiry without retaining the full Lifelines snapshot. */
export function ageOutageSummary(summary: OutageSummary, now: number): OutageSummary {
  const badge = buildBadge(summary.badge.observedAt, now, OUTAGE_STALE_AFTER_SEC);
  if (summary.coverage === 'reported' && summary.reports.some((report) => report.expiresAt <= now)) {
    return {
      ...summary,
      coverage: 'unknown',
      completeness: 'unknown',
      county: null,
      state: null,
      reportedCustomersOut: null,
      reportedCustomersRestored: null,
      reportCount: 0,
      reports: [],
      unknownReason: 'expired_reports',
      severity: 'normal',
      badge: { ...badge, isStale: true },
    };
  }
  return { ...summary, badge };
}

/**
 * Keep the grid panel bound to the explicit Disaster Lifelines selection.
 * Background/offline-pack snapshots for other places must never win by race.
 */
export function selectActiveOutageSummary(
  current: OutageSummary,
  candidate: OutageSummary | null,
  activePlaceId: string | null,
  now: number,
): OutageSummary {
  if (!activePlaceId) return buildOutageSummary(null, now);
  if (candidate?.placeId === activePlaceId) return ageOutageSummary(candidate, now);
  if (current.placeId === activePlaceId) return ageOutageSummary(current, now);
  return buildOutageSummary(null, now);
}

/** Active-place edits/selections are hard context boundaries. */
export function resetActiveOutageSummary(
  exactCandidate: OutageSummary | null,
  activePlaceId: string | null,
  now: number,
): OutageSummary {
  if (exactCandidate?.placeId === activePlaceId && activePlaceId !== null) {
    return ageOutageSummary(exactCandidate, now);
  }
  return buildOutageSummary(null, now);
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
  coverage: EvidenceCoverage;
  error: string | null;
  events: BgpEvent[];
  acceptedRows: number;
  droppedRows: number;
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

export const BGP_STALE_AFTER_MS = 60 * 60 * 1000; // 1h
const BGP_STALE_AFTER_SEC = BGP_STALE_AFTER_MS / 1000;

function parseBgpEvent(value: BgpEventRaw): BgpEvent | null {
  if (!isRecord(value)) return null;
  const prefixes = stringArray(value.prefixes);
  const expected = stringOrNull(value.expected_origin);
  const detected = stringArray(value.detected_origins);
  const involved = stringArray(value.involved_asns);
  const startedAt = parseTimestamp(value.started_at);
  const endedAt = value.ended_at === null ? null : parseTimestamp(value.ended_at);
  if ((!prefixes.length && !involved.length) || startedAt === null) return null;
  if ((value.ended_at !== null && endedAt === null) || (endedAt !== null && endedAt < startedAt)) return null;
  const tags = collectPrefixTags(prefixes);
  return {
    id: stringOrEmpty(value.id) || `${expected ?? ''}-${prefixes[0] ?? ''}-${startedAt}`,
    startedAt,
    endedAt,
    prefixes,
    expectedOriginAsn: expected,
    detectedOriginAsns: detected,
    involvedAsns: involved,
    type: stringOrEmpty(value.type),
    tags,
    severity: decideBgpSeverity(prefixes, detected, expected, tags),
  };
}

export function buildBgpSummary(
  events: readonly BgpEventRaw[],
  now: number,
  evidence?: ProviderEvidence,
): BgpSummary {
  const providerEvidence = evidence ?? {
    coverage: 'reported' as const, error: null, retrievedAt: now, droppedRows: 0,
  };
  const boundaryDroppedEverything = events.length === 0 && providerEvidence.droppedRows > 0;
  if (providerEvidence.coverage !== 'reported' || boundaryDroppedEverything) {
    return {
      coverage: 'unknown',
      error: providerEvidence.error ?? (boundaryDroppedEverything
        ? 'The BGP provider response contained no valid event rows.'
        : 'BGP coverage is unavailable.'),
      events: [],
      acceptedRows: 0,
      droppedRows: Math.max(0, providerEvidence.droppedRows),
      criticalCount: 0,
      elevatedCount: 0,
      affectedAsnSet: [],
      badge: buildBadge(providerEvidence.retrievedAt, now, BGP_STALE_AFTER_SEC),
    };
  }
  const out: BgpEvent[] = [];
  const asnSet = new Set<string>();
  let criticalCount = 0;
  let elevatedCount = 0;

  for (const value of events) {
    const event = parseBgpEvent(value);
    if (!event) continue;
    if (event.severity === 'critical') criticalCount += 1;
    else if (event.severity === 'elevated') elevatedCount += 1;
    for (const asn of [...event.detectedOriginAsns, ...event.involvedAsns]) asnSet.add(asn);
    out.push(event);
  }

  out.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || (b.startedAt ?? 0) - (a.startedAt ?? 0));

  const locallyDroppedRows = Math.max(0, events.length - out.length);
  const droppedRows = Math.max(0, providerEvidence.droppedRows) + locallyDroppedRows;
  if (events.length > 0 && out.length === 0) {
    return {
      coverage: 'unknown',
      error: 'The BGP provider response contained no valid event rows.',
      events: [],
      acceptedRows: 0,
      droppedRows,
      criticalCount: 0,
      elevatedCount: 0,
      affectedAsnSet: [],
      badge: buildBadge(providerEvidence.retrievedAt, now, BGP_STALE_AFTER_SEC),
    };
  }

  return {
    coverage: 'reported',
    error: null,
    events: out,
    acceptedRows: out.length,
    droppedRows,
    criticalCount,
    elevatedCount,
    affectedAsnSet: [...asnSet],
    // An old-but-ongoing event can still be current. Freshness belongs to
    // the provider retrieval that attests its state, not the event start.
    badge: buildBadge(providerEvidence.retrievedAt, now, BGP_STALE_AFTER_SEC),
  };
}

/** Whether a reported BGP response is still current at an injected clock.
 *  Re-evaluating the evidence timestamp prevents a once-fresh summary from
 *  remaining actionable merely because its stored badge has not been rebuilt. */
export function isBgpSummaryFresh(summary: BgpSummary | null, now = Date.now()): boolean {
  if (summary?.coverage !== 'reported' || summary.badge.isStale
    || !Number.isFinite(now)) return false;
  const { observedAt } = summary.badge;
  return typeof observedAt === 'number' && Number.isFinite(observedAt)
    && now - observedAt <= BGP_STALE_AFTER_MS;
}

/** Project a 24-hour provider response into events that are actionable now. */
export function activeBgpEvents(summary: BgpSummary | null, now = Date.now()): BgpEvent[] {
  if (!isBgpSummaryFresh(summary, now)) return [];
  return (summary?.events ?? []).filter((event) => event.endedAt === null
    || (Number.isFinite(event.endedAt) && event.endedAt > now));
}

/** Critical/elevated counts for badges and other active-alert consumers. */
export function countActiveBgpAlerts(
  summary: BgpSummary | null,
  now = Date.now(),
): { critical: number; elevated: number } {
  let critical = 0;
  let elevated = 0;
  for (const event of activeBgpEvents(summary, now)) {
    if (event.severity === 'critical') critical += 1;
    else if (event.severity === 'elevated') elevated += 1;
  }
  return { critical, elevated };
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

type ValidatedRadStation = Omit<RadStation, 'cpm' | 'observedAt'> & {
  cpm: number;
  observedAt: number;
};

export interface RadSummary {
  coverage: EvidenceCoverage;
  error: string | null;
  stationCount: number;
  acceptedRows: number;
  droppedRows: number;
  elevatedStations: RadStation[];
  /** Highest CPM across all stations (null if no stations). */
  maxCpm: number | null;
  maxCpmStation: string | null;
  severity: Severity | null;
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

export const RADIATION_STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6h: hourly readings — gap >6h is stale
const RADIATION_STALE_AFTER_SEC = RADIATION_STALE_AFTER_MS / 1000;
const RADIATION_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function parseRadStation(value: RadStationRaw, now: number): ValidatedRadStation | null {
  if (!isRecord(value)) return null;
  const cpm = readCpm(value);
  if (cpm === null) return null;
  const observedAt = parseTimestamp(value.SampleDateTime ?? value.CollectionDate);
  if (observedAt === null || observedAt > now + RADIATION_MAX_FUTURE_SKEW_MS) return null;
  const name = stringOrEmpty(value.StationLocationName ?? value.StationName ?? value.Location) || 'Unknown';
  const stateMatch = /,\s*([A-Z]{2})\b/.exec(name);
  return {
    name,
    state: stateMatch?.[1] ?? null,
    lat: parseCoordinateOrNull(value.Latitude, -90, 90),
    lon: parseCoordinateOrNull(value.Longitude, -180, 180),
    cpm,
    observedAt,
    severity: severityFor(cpm, RADIATION_THRESHOLDS),
  };
}

function unknownRadSummary(
  error: string,
  droppedRows: number,
  retrievedAt: number | null,
  now: number,
): RadSummary {
  return {
    coverage: 'unknown',
    error,
    stationCount: 0,
    acceptedRows: 0,
    droppedRows,
    elevatedStations: [],
    maxCpm: null,
    maxCpmStation: null,
    severity: null,
    badge: buildBadge(retrievedAt, now, RADIATION_STALE_AFTER_SEC),
  };
}

function collectRadStations(stations: readonly RadStationRaw[], now: number): {
  stations: ValidatedRadStation[];
  mostRecent: number;
  maxCpm: number;
  maxCpmStation: string | null;
} {
  const accepted: ValidatedRadStation[] = [];
  let mostRecent = 0;
  let maxCpm = -Infinity;
  let maxCpmStation: string | null = null;
  for (const value of stations) {
    const station = parseRadStation(value, now);
    if (!station) continue;
    if (station.observedAt > mostRecent) mostRecent = station.observedAt;
    if (station.cpm > maxCpm) {
      maxCpm = station.cpm;
      maxCpmStation = station.name;
    }
    accepted.push(station);
  }
  return { stations: accepted, mostRecent, maxCpm, maxCpmStation };
}

export function buildRadSummary(
  stations: readonly RadStationRaw[],
  now: number,
  evidence?: ProviderEvidence,
): RadSummary {
  const providerEvidence = evidence ?? {
    coverage: 'reported' as const, error: null, retrievedAt: now, droppedRows: 0,
  };
  const boundaryDroppedEverything = stations.length === 0 && providerEvidence.droppedRows > 0;
  if (providerEvidence.coverage !== 'reported' || boundaryDroppedEverything) {
    const unavailableError = boundaryDroppedEverything
      ? 'The radiation provider response contained no valid station readings.'
      : 'Radiation coverage is unavailable.';
    return unknownRadSummary(
      providerEvidence.error ?? unavailableError,
      Math.max(0, providerEvidence.droppedRows),
      providerEvidence.retrievedAt,
      now,
    );
  }
  const {
    stations: out, mostRecent, maxCpm, maxCpmStation,
  } = collectRadStations(stations, now);

  const locallyDroppedRows = Math.max(0, stations.length - out.length);
  const droppedRows = Math.max(0, providerEvidence.droppedRows) + locallyDroppedRows;
  if (stations.length > 0 && out.length === 0) {
    return unknownRadSummary(
      'The radiation provider response contained no valid station readings.',
      droppedRows,
      providerEvidence.retrievedAt,
      now,
    );
  }

  const elevated = out
    .filter((station) => station.cpm >= RADIATION_BACKGROUND_CPM)
    .sort((left, right) => right.cpm - left.cpm);

  return {
    coverage: 'reported',
    error: null,
    stationCount: out.length,
    acceptedRows: out.length,
    droppedRows,
    elevatedStations: elevated,
    maxCpm: maxCpm === -Infinity ? null : maxCpm,
    maxCpmStation,
    severity: maxCpm === -Infinity ? 'normal' : severityFor(maxCpm, RADIATION_THRESHOLDS),
    badge: buildBadge(mostRecent > 0 ? mostRecent : providerEvidence.retrievedAt, now, RADIATION_STALE_AFTER_SEC),
  };
}

/** Whether reported RadNet evidence is still actionable at an injected clock.
 *  This is deliberately re-evaluated instead of trusting the stored badge so a
 *  once-fresh summary cannot keep driving alerts, hotspots, or an all-clear. */
export function isRadSummaryFresh(summary: RadSummary | null, now = Date.now()): boolean {
  if (summary?.coverage !== 'reported' || summary.severity === null
    || summary.badge.isStale || !Number.isFinite(now)) return false;
  const { observedAt } = summary.badge;
  return typeof observedAt === 'number' && Number.isFinite(observedAt)
    && observedAt <= now + RADIATION_MAX_FUTURE_SKEW_MS
    && now - observedAt <= RADIATION_STALE_AFTER_MS;
}

/** Count only elevated stations backed by currently fresh RadNet evidence. */
export function countActiveRadiationAlerts(summary: RadSummary | null, now = Date.now()): number {
  return isRadSummaryFresh(summary, now) ? summary?.elevatedStations.length ?? 0 : 0;
}

function readCpm(s: RadStationRaw): number | null {
  for (const key of ['GammaCpm', 'GammaCPM', 'Gamma', 'CountRate'] as const) {
    const cpm = numericCpm(s[key]);
    if (cpm !== null) return cpm;
  }
  return null;
}

function numericCpm(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const cpm = Number(value.trim());
  return Number.isFinite(cpm) && cpm >= 0 ? cpm : null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function stringOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedStringOrNull(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}

function safeBoundedInteger(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value : null;
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

function parseCoordinateOrNull(v: unknown, min: number, max: number): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return v;
  if (typeof v === 'string') {
    const clean = v.trim();
    if (!clean) return null;
    const n = Number(clean);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  }
  return null;
}

function parseTimestamp(v: unknown): number | null {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}
