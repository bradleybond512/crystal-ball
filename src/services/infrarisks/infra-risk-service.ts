/**
 * Infrastructure Risk Matrix — pure-deterministic service.
 *
 * Maintains one broad scored signal, one scoped evidence stream, and
 * two explicit coverage gaps:
 *
 *   - Power grid: unknown here. Exact-county ORNL ODIN context belongs to
 *     Disaster Lifelines and cannot truthfully become a national score.
 *   - CISA KEV: known-exploited-vulnerabilities feed, filtered to the
 *     last 7 days and grouped by vendor.
 *   - AS3356 / Lumen: scoped RIPE NCC routing-consistency evidence.
 *     It is displayed as exact-resource evidence and is intentionally
 *     excluded from the broad cross-domain composite.
 *   - ACLED: explicit unknown. The prior anonymous, unscoped query could
 *     restamp historical events as current risk and is disabled until a
 *     complete authenticated recent-window adapter is available.
 *
 * Every parser is pure and takes upstream-shaped JSON. The
 * orchestrator `fetchInfraRisks()` accepts a `fetchImpl` so tests can
 * inject a stubbed fetch and verify the full state shape without
 * network. The renderer-side panel reads `getInfraState()` for the
 * last computed snapshot.
 */

import type { UnifiedAlert } from '@/services/unified-alerts';

export const RIPE_BGP_RESOURCE = 'AS3356';
export const RIPE_BGP_SCOPE_LABEL = 'AS3356 / Lumen';
export const INFRA_RISK_FETCH_TIMEOUT_MS = 10_000;
export const INFRA_RISK_STATE_MAX_AGE_MS = 90_000;

// ─── Public types ─────────────────────────────────────────────────────

export type InfraSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type InfraCoverage = 'reported' | 'unknown';

export interface CisaKevEntry {
  cveId: string;
  vendor: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: number;
  /** Original date string from upstream, preserved for display. */
  dateAddedRaw: string;
  knownRansomware: boolean;
  shortDescription: string;
}

export interface BgpAnomalyRecord {
  /** RIPE resource string — typically "ASxxx" or a CIDR. */
  resource: string;
  inconsistencyCount: number;
  inconsistencies: string[];
  severity: InfraSeverity;
  observedAt: number | null;
}

export interface AcledEvent {
  eventId: string;
  eventDate: number;
  country: string;
  location: string;
  fatalities: number;
  notes: string;
  severity: InfraSeverity;
}

export interface DomainScore {
  /** 0–100 composite score for this domain. */
  score: number;
  severity: InfraSeverity;
  /** Short human-readable summary. */
  headline: string;
}

interface InfraDomainStatus {
  /** `reported` means the latest refresh returned a usable source envelope. */
  coverage: InfraCoverage;
  /** Safe, displayable explanation when coverage is unknown. */
  coverageReason: string | null;
  /** Unknown coverage has no score; it must never be represented as INFO/0. */
  score: DomainScore | null;
  alerts: UnifiedAlert[];
}

export interface InfraRiskState {
  power: InfraDomainStatus & { coverage: 'unknown' };
  kev: InfraDomainStatus & { entries: CisaKevEntry[] };
  bgp: InfraDomainStatus & {
    records: BgpAnomalyRecord[];
    /** This is exact-resource evidence, not whole-domain BGP coverage. */
    scopeLabel: typeof RIPE_BGP_SCOPE_LABEL;
    /** AS3356 alone cannot truthfully vote as the broad BGP domain. */
    compositeEligible: false;
  };
  acled: InfraDomainStatus & { events: AcledEvent[] };
  /** 0-100 composite across only the domains with reported coverage. */
  compositeScore: number | null;
  compositeSeverity: InfraSeverity | null;
  compositeCoverage: 'reported' | 'partial' | 'unknown';
  observedDomainCount: number;
  expectedDomainCount: 2;
  fetchedAt: number;
}

// ─── Severity → ordering helpers ──────────────────────────────────────

const SEVERITY_ORDER: Record<InfraSeverity, number> = {
  INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};

const SEVERITY_TO_ALERT: Record<InfraSeverity, UnifiedAlert['severity']> = {
  INFO: 'info', LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical',
};

export function maxSeverity(severities: readonly InfraSeverity[]): InfraSeverity {
  return severities.reduce<InfraSeverity>((acc, s) => SEVERITY_ORDER[s] > SEVERITY_ORDER[acc] ? s : acc, 'INFO');
}

export function severityToScore(s: InfraSeverity): number {
  return [0, 25, 50, 75, 100][SEVERITY_ORDER[s]] ?? 0;
}

function severityFromScore(score: number): InfraSeverity {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  if (score >= 10) return 'LOW';
  return 'INFO';
}

// ─── Power grid collection gap ────────────────────────────────────────

export function unknownPowerRisk(): InfraRiskState['power'] {
  return {
    coverage: 'unknown',
    coverageReason: 'Power outage coverage unknown — not included in composite',
    score: null,
    alerts: [],
  };
}

// ─── CISA KEV: known-exploited vulnerabilities ───────────────────────

interface KevEntryRaw {
  cveID?: unknown;
  vendorProject?: unknown;
  product?: unknown;
  vulnerabilityName?: unknown;
  dateAdded?: unknown;
  shortDescription?: unknown;
  knownRansomwareCampaignUse?: unknown;
}

const CISA_KEV_MAX_CATALOG_ENTRIES = 20_000;
const CISA_KEV_FUTURE_SKEW_MS = 5 * 60_000;

export function parseCisaKev(raw: unknown, now: number, windowMs = 7 * 24 * 60 * 60 * 1000): CisaKevEntry[] {
  const rows = extractRows(raw, ['vulnerabilities']);
  const cutoff = now - windowMs;
  const out: CisaKevEntry[] = [];
  for (const r of rows) {
    const row = r as KevEntryRaw;
    const cveId = stringOrEmpty(row.cveID);
    const dateAddedRaw = stringOrEmpty(row.dateAdded);
    const dateAdded = parseTimestamp(dateAddedRaw);
    if (!cveId || dateAdded === null || dateAdded < cutoff) continue;
    out.push({
      cveId,
      vendor: stringOrEmpty(row.vendorProject) || 'Unknown',
      product: stringOrEmpty(row.product) || '',
      vulnerabilityName: stringOrEmpty(row.vulnerabilityName) || '',
      dateAdded,
      dateAddedRaw,
      knownRansomware: stringOrEmpty(row.knownRansomwareCampaignUse).toLowerCase() === 'known',
      shortDescription: stringOrEmpty(row.shortDescription) || '',
    });
  }
  return out.sort((a, b) => b.dateAdded - a.dateAdded);
}

/**
 * KEV severity ladder per the task spec:
 *   HIGH    when >3 new KEVs added today
 *   MEDIUM  when any new KEV in the last 24h
 *   LOW     when entries exist in the 7-day window but nothing today
 *   INFO    otherwise
 */
export function scoreCisaKev(entries: readonly CisaKevEntry[], now: number): DomainScore {
  if (entries.length === 0) return { score: 0, severity: 'INFO', headline: 'No new KEVs in the last 7 days' };
  const dayCutoff = now - 24 * 60 * 60 * 1000;
  const today = entries.filter((e) => e.dateAdded >= dayCutoff);
  const vendorsToday = new Set(today.map((e) => e.vendor)).size;
  let severity: InfraSeverity = 'LOW';
  if (today.length > 3) severity = 'HIGH';
  else if (today.length > 0) severity = 'MEDIUM';
  return {
    score: severityToScore(severity),
    severity,
    headline: `${entries.length} new KEVs in 7 days · ${today.length} today across ${vendorsToday} vendors`,
  };
}

export function kevAlertsFor(entries: readonly CisaKevEntry[], now: number): UnifiedAlert[] {
  const dayCutoff = now - 24 * 60 * 60 * 1000;
  const today = entries.filter((e) => e.dateAdded >= dayCutoff);
  if (today.length === 0) return [];
  const severity: UnifiedAlert['severity'] = today.length > 3 ? 'high' : 'medium';
  const ransomware = today.filter((e) => e.knownRansomware).length;
  const ransomwareSuffix = ransomware > 0 ? ` (${ransomware} ransomware-linked)` : '';
  const kevPluralSuffix = today.length === 1 ? '' : 's';
  return [{
    id: `infra-kev-${now}`,
    source: 'cyber',
    severity,
    title: `${today.length} new CISA KEV${kevPluralSuffix} added today`,
    body: `${today.length} new known-exploited vulnerabilities${ransomwareSuffix}.`,
    timestamp: now,
    relevanceScore: Math.min(1, today.length / 10),
    acknowledged: false,
    pinned: false,
  }];
}

// ─── BGP anomalies: RIPE NCC routing-consistency ─────────────────────

interface RipeRow {
  resource?: unknown;
  inconsistencies?: unknown;
  /** Some endpoints return query_time; others return time. */
  query_time?: unknown;
  time?: unknown;
}

export function parseBgpAnomalies(raw: unknown): BgpAnomalyRecord[] {
  // RIPE Stat API: { data: { resource: "...", inconsistencies: [...] } }
  // (single-resource case). Also accept an array of resources.
  const root = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const data = root.data ?? root;
  const rows: RipeRow[] = Array.isArray(data) ? data as RipeRow[] : [data as RipeRow];
  const out: BgpAnomalyRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const resource = stringOrEmpty(row.resource);
    const inconsistencies = Array.isArray(row.inconsistencies)
      ? row.inconsistencies.map((i) => typeof i === 'string' ? i : safeStringify(i)).filter(Boolean)
      : [];
    if (inconsistencies.length === 0) continue;
    out.push({
      resource: resource || 'unknown',
      inconsistencyCount: inconsistencies.length,
      inconsistencies,
      severity: bgpSeverityFor(inconsistencies.length),
      observedAt: parseTimestamp(row.query_time ?? row.time),
    });
  }
  return out.sort((a, b) => b.inconsistencyCount - a.inconsistencyCount);
}

function bgpSeverityFor(count: number): InfraSeverity {
  if (count >= 5) return 'HIGH';
  if (count >= 1) return 'MEDIUM';
  return 'INFO';
}

export function scoreBgpAnomalies(records: readonly BgpAnomalyRecord[]): DomainScore {
  const flagged = records.filter((r) => r.inconsistencyCount > 0);
  if (flagged.length === 0) {
    return {
      score: 0,
      severity: 'INFO',
      headline: `${RIPE_BGP_SCOPE_LABEL}: no routing inconsistencies in the latest exact-resource response`,
    };
  }
  const sev = maxSeverity(flagged.map((r) => r.severity));
  const total = flagged.reduce((acc, r) => acc + r.inconsistencyCount, 0);
  return {
    score: severityToScore(sev),
    severity: sev,
    headline: `${RIPE_BGP_SCOPE_LABEL}: ${total} routing inconsistencies in the latest exact-resource response`,
  };
}

export function bgpAlertsFor(records: readonly BgpAnomalyRecord[], now: number): UnifiedAlert[] {
  return records
    .filter((r) => r.severity === 'HIGH')
    .map((r) => ({
      id: `infra-bgp-${r.resource}-${now}`,
      source: 'cyber' as const,
      severity: 'high' as const,
      title: `${RIPE_BGP_SCOPE_LABEL} routing anomaly`,
      body: `${r.inconsistencyCount} routing inconsistencies reported for ${RIPE_BGP_SCOPE_LABEL}.`,
      timestamp: now,
      relevanceScore: Math.min(1, r.inconsistencyCount / 20),
      acknowledged: false,
      pinned: false,
    }));
}

// ─── ACLED: violence-against-civilians ────────────────────────────────

interface AcledRow {
  event_id_cnty?: unknown;
  event_id_no_cnty?: unknown;
  data_id?: unknown;
  event_date?: unknown;
  country?: unknown;
  location?: unknown;
  fatalities?: unknown;
  notes?: unknown;
}

export function parseAcledEvents(raw: unknown): AcledEvent[] {
  const rows = extractRows(raw, ['data']);
  const out: AcledEvent[] = [];
  for (const r of rows) {
    const row = r as AcledRow;
    const eventId = stringOrEmpty(row.event_id_cnty)
      || stringOrEmpty(row.event_id_no_cnty)
      || stringOrEmpty(row.data_id);
    if (!eventId) continue;
    const fatalities = numOrZero(row.fatalities);
    out.push({
      eventId,
      eventDate: parseTimestamp(row.event_date) ?? 0,
      country: stringOrEmpty(row.country) || 'Unknown',
      location: stringOrEmpty(row.location) || '',
      fatalities,
      notes: stringOrEmpty(row.notes) || '',
      severity: acledSeverityFor(fatalities),
    });
  }
  return out.sort((a, b) => b.fatalities - a.fatalities || b.eventDate - a.eventDate);
}

function acledSeverityFor(fatalities: number): InfraSeverity {
  if (fatalities >= 25) return 'CRITICAL';
  if (fatalities >= 10) return 'HIGH';
  if (fatalities >= 3) return 'MEDIUM';
  if (fatalities >= 1) return 'LOW';
  return 'INFO';
}

export function scoreAcled(events: readonly AcledEvent[]): DomainScore {
  if (events.length === 0) return { score: 0, severity: 'INFO', headline: 'No reported violence events' };
  const totalFatalities = events.reduce((acc, e) => acc + e.fatalities, 0);
  const sev = maxSeverity(events.map((e) => e.severity));
  return {
    score: severityToScore(sev),
    severity: sev,
    headline: `${events.length} events · ${totalFatalities} fatalities`,
  };
}

export function acledAlertsFor(events: readonly AcledEvent[], now: number): UnifiedAlert[] {
  return events
    .filter((e) => e.severity === 'HIGH' || e.severity === 'CRITICAL')
    .slice(0, 5)
    .map((e) => ({
      id: `infra-acled-${e.eventId}`,
      source: 'gdacs' as const,
      severity: SEVERITY_TO_ALERT[e.severity],
      title: `Violence against civilians: ${e.country}`,
      body: `${e.fatalities} fatalities at ${e.location || 'unknown location'}. ${e.notes.slice(0, 200)}`,
      timestamp: now,
      relevanceScore: Math.min(1, e.fatalities / 50),
      acknowledged: false,
      pinned: false,
    }));
}

// ─── Composite ────────────────────────────────────────────────────────

const DOMAIN_WEIGHTS = { kev: 0.25, acled: 0.25 };
const RIPE_BGP_MAX_AGE_MS = 30 * 60_000;
const PROVIDER_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_BGP_INCONSISTENCIES = 500;
const MAX_INFRA_RISK_FETCH_TIMEOUT_MS = 30_000;
const ACLED_UNAVAILABLE_REASON = 'Current-window ACLED coverage is unavailable; historical rows are not scored as current risk.';
const STALE_REFRESH_REASON = 'The last successful infrastructure refresh is stale.';

export function composeInfraRiskState(input: {
  power: InfraRiskState['power'];
  kev: InfraRiskState['kev'];
  bgp: InfraRiskState['bgp'];
  acled: InfraRiskState['acled'];
  fetchedAt: number;
}): InfraRiskState {
  // Power has no supported national source in this panel. AS3356 / Lumen is
  // exact-resource evidence, not broad BGP-domain coverage, so it is also
  // excluded. The remaining broad domains participate only when their latest
  // response was usable. Unknown coverage must never become a zero-risk vote.
  const candidates = [
    { domain: input.kev, weight: DOMAIN_WEIGHTS.kev },
    { domain: input.acled, weight: DOMAIN_WEIGHTS.acled },
  ];
  const observed = candidates.flatMap(({ domain, weight }) => {
    const score = domain.score;
    return domain.coverage === 'reported' && score !== null ? [{ score, weight }] : [];
  });
  const observedWeight = observed.reduce((sum, { weight }) => sum + weight, 0);
  const compositeScore = observedWeight > 0
    ? Math.round(observed.reduce((sum, { score, weight }) => sum + score.score * weight, 0) / observedWeight)
    : null;
  const observedDomainCount = observed.length;
  const compositeCoverage = observedDomainCount === candidates.length
    ? 'reported'
    : observedDomainCount > 0 ? 'partial' : 'unknown';
  return {
    power: input.power,
    kev: input.kev,
    bgp: {
      ...input.bgp,
      scopeLabel: RIPE_BGP_SCOPE_LABEL,
      compositeEligible: false,
    },
    acled: input.acled,
    compositeScore,
    compositeSeverity: compositeScore === null ? null : severityFromScore(compositeScore),
    compositeCoverage,
    observedDomainCount,
    expectedDomainCount: 2,
    fetchedAt: input.fetchedAt,
  };
}

/**
 * Derive the fail-closed display state for a previously fetched snapshot.
 * The original snapshot is returned while fresh. Once its local refresh age
 * crosses the bound, every formerly scored source is demoted to unknown and
 * the old composite/alerts cannot continue to render as current evidence.
 */
export function ageInfraRiskState(state: InfraRiskState, now = Date.now()): InfraRiskState {
  const ageMs = now - state.fetchedAt;
  if (Number.isFinite(ageMs) && ageMs <= INFRA_RISK_STATE_MAX_AGE_MS) return state;
  return composeInfraRiskState({
    power: state.power,
    kev: unknownKevDomain(STALE_REFRESH_REASON),
    bgp: unknownBgpDomain('The last successful infrastructure refresh is stale.'),
    acled: unknownAcledDomain(STALE_REFRESH_REASON),
    fetchedAt: state.fetchedAt,
  });
}

// ─── Orchestrator ─────────────────────────────────────────────────────

export interface FetchInfraRisksOptions {
  /** Override the sidecar base URL. Default: '/api/infrarisks'. */
  baseUrl?: string;
  /** Injection point for tests. Default: globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Cancels the refresh and prevents a late module-state write. */
  signal?: AbortSignal;
  /** Per-source deadline. Bounded to 1-30 seconds; default 10 seconds. */
  timeoutMs?: number;
  now?: number;
}

let _lastState: InfraRiskState | null = null;

/**
 * Pull the two supported live upstream feeds via the sidecar, parse + score
 * each domain, generate per-domain UnifiedAlerts, and compose into an
 * InfraRiskState snapshot. Persists the result in module state so the
 * panel can read `getInfraState()` between refreshes.
 */
export async function fetchInfraRisks(opts: FetchInfraRisksOptions = {}): Promise<InfraRiskState> {
  const baseUrl = opts.baseUrl ?? '/api/infrarisks';
  const f = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? Date.now();
  const timeoutMs = normalizeFetchTimeout(opts.timeoutMs);
  throwIfAborted(opts.signal);

  const [kevResult, bgpResult] = await Promise.all([
    fetchDomain(f, `${baseUrl}/kev`, opts.signal, timeoutMs),
    fetchDomain(f, `${baseUrl}/bgp`, opts.signal, timeoutMs),
  ]);
  throwIfAborted(opts.signal);

  const kev = buildKevDomain(kevResult, now);
  const bgp = buildBgpDomain(bgpResult, now);
  const acled = unknownAcledDomain(ACLED_UNAVAILABLE_REASON);

  const state = composeInfraRiskState({
    power: unknownPowerRisk(),
    kev,
    bgp,
    acled,
    fetchedAt: now,
  });
  throwIfAborted(opts.signal);
  _lastState = state;
  return state;
}

export function getInfraState(): InfraRiskState | null {
  return _lastState;
}

/** Reset module state — for tests only. */
export function _resetInfraStateForTests(): void {
  _lastState = null;
}

type DomainFetchResult =
  | { available: true; raw: unknown }
  | { available: false; reason: string };

async function fetchDomain(
  f: typeof fetch,
  url: string,
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<DomainFetchResult> {
  throwIfAborted(callerSignal);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeCallerAbort: (() => void) | undefined;

  const fetchTask = (async (): Promise<DomainFetchResult> => {
    try {
      const r = await f(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!r.ok) return { available: false, reason: 'The source request failed.' };
      return { available: true, raw: await r.json() as unknown };
    } catch {
      throwIfAborted(callerSignal);
      return controller.signal.aborted
        ? { available: false, reason: 'The source request timed out.' }
        : { available: false, reason: 'The source response was unavailable.' };
    }
  })();

  const deadline = new Promise<DomainFetchResult>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve({ available: false, reason: 'The source request timed out.' });
    }, timeoutMs);
  });
  const racers: Promise<DomainFetchResult>[] = [fetchTask, deadline];

  if (callerSignal) {
    racers.push(new Promise<DomainFetchResult>((_resolve, reject) => {
      const onCallerAbort = (): void => {
        controller.abort();
        reject(createAbortError());
      };
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
      removeCallerAbort = () => callerSignal.removeEventListener('abort', onCallerAbort);
    }));
  }

  try {
    return await Promise.race(racers);
  } finally {
    if (timeout) clearTimeout(timeout);
    removeCallerAbort?.();
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw createAbortError();
}

function createAbortError(): Error {
  const error = new Error('Infrastructure risk refresh was aborted.');
  error.name = 'AbortError';
  return error;
}

function normalizeFetchTimeout(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return INFRA_RISK_FETCH_TIMEOUT_MS;
  return Math.min(MAX_INFRA_RISK_FETCH_TIMEOUT_MS, Math.max(1, Math.trunc(value)));
}

function buildKevDomain(result: DomainFetchResult, now: number): InfraRiskState['kev'] {
  if (!result.available) return unknownKevDomain(result.reason);
  if (!hasKevEnvelope(result.raw, now)) return unknownKevDomain(unusableResponseReason(result.raw));
  const entries = parseCisaKev(result.raw, now);
  return {
    coverage: 'reported',
    coverageReason: null,
    entries,
    score: scoreCisaKev(entries, now),
    alerts: kevAlertsFor(entries, now),
  };
}

function buildBgpDomain(result: DomainFetchResult, now: number): InfraRiskState['bgp'] {
  if (!result.available) return unknownBgpDomain(result.reason);
  if (!hasBgpEnvelope(result.raw, now)) return unknownBgpDomain(unusableResponseReason(result.raw));
  const records = parseBgpAnomalies(result.raw);
  return {
    coverage: 'reported',
    coverageReason: null,
    records,
    scopeLabel: RIPE_BGP_SCOPE_LABEL,
    compositeEligible: false,
    score: scoreBgpAnomalies(records),
    alerts: bgpAlertsFor(records, now),
  };
}

function unknownKevDomain(reason: string): InfraRiskState['kev'] {
  return { coverage: 'unknown', coverageReason: reason, entries: [], score: null, alerts: [] };
}

function unknownBgpDomain(reason: string): InfraRiskState['bgp'] {
  return {
    coverage: 'unknown',
    coverageReason: `${RIPE_BGP_SCOPE_LABEL}: ${reason}`,
    records: [],
    scopeLabel: RIPE_BGP_SCOPE_LABEL,
    compositeEligible: false,
    score: null,
    alerts: [],
  };
}

function unknownAcledDomain(reason: string): InfraRiskState['acled'] {
  return { coverage: 'unknown', coverageReason: reason, events: [], score: null, alerts: [] };
}

function hasKevEnvelope(raw: unknown, now = Date.now()): boolean {
  if (!isRecord(raw) || raw.degraded === true || !Number.isSafeInteger(now) || now <= 0
    || kevCatalogText(raw.catalogVersion, 80) === null) return false;
  const releasedAt = kevCatalogReleasedAt(raw.dateReleased);
  if (releasedAt === null || releasedAt > now + CISA_KEV_FUTURE_SKEW_MS) return false;
  const rows = raw.vulnerabilities;
  const count = raw.count;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1
    || count > CISA_KEV_MAX_CATALOG_ENTRIES || !Array.isArray(rows) || rows.length !== count) return false;
  const seenCves = new Set<string>();
  return rows.every((row) => kevCatalogRowIsUsable(row, now, releasedAt, seenCves));
}

function kevCatalogRowIsUsable(
  row: unknown,
  now: number,
  releasedAt: number,
  seenCves: Set<string>,
): boolean {
  if (!isRecord(row)) return false;
  const cveID = kevCatalogText(row.cveID, 32);
  if (!cveID || !/^CVE-\d{4}-\d{4,}$/.test(cveID) || seenCves.has(cveID)) return false;
  const requiredTextFields: ReadonlyArray<readonly [string, number]> = [
    ['vendorProject', 300],
    ['product', 500],
    ['vulnerabilityName', 1_000],
    ['shortDescription', 8_000],
    ['requiredAction', 8_000],
  ];
  if (!requiredTextFields.every(([key, maximum]) => kevCatalogText(row[key], maximum) !== null)) return false;
  if (kevCatalogText(row.notes, 16_000, true) === null) return false;
  if (row.knownRansomwareCampaignUse !== 'Known' && row.knownRansomwareCampaignUse !== 'Unknown') return false;
  const dateAdded = kevCatalogDate(row.dateAdded);
  const dueDate = kevCatalogDate(row.dueDate);
  if (dateAdded === null || dueDate === null || dueDate < dateAdded
    || dateAdded > now + CISA_KEV_FUTURE_SKEW_MS || dateAdded > releasedAt) return false;
  if (!Array.isArray(row.cwes) || row.cwes.length === 0 || row.cwes.length > 50
    || !row.cwes.every((cwe) => kevCatalogText(cwe, 80) !== null)) return false;
  seenCves.add(cveID);
  return true;
}

function kevCatalogText(value: unknown, maximum: number, allowEmpty = false): string | null {
  if (typeof value !== 'string' || value.length > maximum
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) return null;
  const clean = value.trim();
  return clean || allowEmpty ? clean : null;
}

function kevCatalogDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = strictCivilTimestamp(`${value}T00:00:00Z`);
  return parsed !== null && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

function kevCatalogReleasedAt(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 80 || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  return strictCivilTimestamp(value);
}

function hasBgpEnvelope(raw: unknown, now = Date.now()): boolean {
  if (!isRecord(raw) || raw.degraded === true || raw.status !== 'ok' || raw.status_code !== 200) return false;
  const data = raw.data;
  if (!isRecord(data) || stringOrEmpty(data.resource) !== RIPE_BGP_RESOURCE
    || !Array.isArray(data.inconsistencies)
    || data.inconsistencies.length > MAX_BGP_INCONSISTENCIES
    || !data.inconsistencies.every((item) => typeof item === 'string' || isRecord(item))) return false;
  const observedAt = parseTimestamp(data.query_time ?? raw.time);
  return observedAt !== null
    && observedAt >= now - RIPE_BGP_MAX_AGE_MS
    && observedAt <= now + PROVIDER_FUTURE_SKEW_MS;
}

function unusableResponseReason(raw: unknown): string {
  return isRecord(raw) && raw.degraded === true
    ? 'The source reported degraded coverage.'
    : 'The source response was not usable.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ─── Helpers ──────────────────────────────────────────────────────────

function extractRows(raw: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Record<string, unknown>;
  for (const key of keys) {
    const v = r[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function stringOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function numOrZero(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseTimestamp(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function strictCivilTimestamp(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[8] ?? 0);
  const offsetMinute = Number(match[9] ?? 0);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!year || month < 1 || month > 12 || day < 1 || day > (monthDays[month - 1] ?? 0)
    || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeStringify(v: unknown): string {
  try { return typeof v === 'string' ? v : JSON.stringify(v); }
  catch { return ''; }
}
