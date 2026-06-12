/**
 * Infrastructure Risk Matrix — pure-deterministic service.
 *
 * Aggregates four cross-domain risk signals:
 *
 *   - Power grid: poweroutage.us per-county customer counts.
 *   - CISA KEV: known-exploited-vulnerabilities feed, filtered to the
 *     last 7 days and grouped by vendor.
 *   - BGP anomalies: RIPE NCC routing-consistency snapshots flagged
 *     when their `inconsistencies[]` array is non-empty.
 *   - ACLED: violence-against-civilians events scored by fatality
 *     count (anonymous read, returns [] gracefully on auth failure).
 *
 * Every parser is pure and takes upstream-shaped JSON. The
 * orchestrator `fetchInfraRisks()` accepts a `fetchImpl` so tests can
 * inject a stubbed fetch and verify the full state shape without
 * network. The renderer-side panel reads `getInfraState()` for the
 * last computed snapshot.
 */

import type { UnifiedAlert } from '@/services/unified-alerts';

// ─── Public types ─────────────────────────────────────────────────────

export type InfraSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface PowerOutageRecord {
  county: string;
  state: string;
  customersOut: number;
  customersTracked: number;
  /** customersOut / customersTracked, 0-1. */
  outageRatio: number;
  severity: InfraSeverity;
  observedAt: number | null;
}

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

export interface InfraRiskState {
  power: { records: PowerOutageRecord[]; score: DomainScore; alerts: UnifiedAlert[]; dataAsOf?: number };
  kev: { entries: CisaKevEntry[]; score: DomainScore; alerts: UnifiedAlert[] };
  bgp: { records: BgpAnomalyRecord[]; score: DomainScore; alerts: UnifiedAlert[] };
  acled: { events: AcledEvent[]; score: DomainScore; alerts: UnifiedAlert[] };
  /** 0-100 composite across all four domains. */
  compositeScore: number;
  compositeSeverity: InfraSeverity;
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

// ─── Power grid: poweroutage.us ───────────────────────────────────────

interface PowerOutageRow {
  CountyName?: unknown;
  StateName?: unknown;
  CustomersOut?: unknown;
  CustomersTracked?: unknown;
  RecordDateTime?: unknown;
}

function parsePowerSeverity(customersOut: number): InfraSeverity {
  if (customersOut > 500_000) return 'CRITICAL';
  if (customersOut > 100_000) return 'HIGH';
  if (customersOut > 10_000) return 'MEDIUM';
  if (customersOut > 0) return 'LOW';
  return 'INFO';
}

export function parsePowerOutages(raw: unknown): PowerOutageRecord[] {
  const rows = extractRows(raw, ['CountyOutages', 'counties', 'data']);
  const out: PowerOutageRecord[] = [];
  for (const r of rows) {
    const row = r as PowerOutageRow;
    const county = stringOrEmpty(row.CountyName);
    const state = stringOrEmpty(row.StateName);
    const customersOut = numOrZero(row.CustomersOut);
    const customersTracked = numOrZero(row.CustomersTracked);
    if (!county || !state || customersOut <= 0) continue;
    out.push({
      county,
      state,
      customersOut,
      customersTracked,
      outageRatio: customersTracked > 0 ? customersOut / customersTracked : 0,
      severity: parsePowerSeverity(customersOut),
      observedAt: parseTimestamp(row.RecordDateTime),
    });
  }
  return out.sort((a, b) => b.customersOut - a.customersOut);
}

export function scorePowerOutages(records: readonly PowerOutageRecord[]): DomainScore {
  if (records.length === 0) return { score: 0, severity: 'INFO', headline: 'No reported outages' };
  const totalOut = records.reduce((acc, r) => acc + r.customersOut, 0);
  const sev = maxSeverity(records.map((r) => r.severity));
  return {
    score: severityToScore(sev),
    severity: sev,
    headline: `${totalOut.toLocaleString()} customers out across ${records.length} counties`,
  };
}

export function powerAlertsFor(records: readonly PowerOutageRecord[], now: number): UnifiedAlert[] {
  return records
    .filter((r) => r.severity === 'HIGH' || r.severity === 'CRITICAL')
    .map((r) => ({
      id: `infra-power-${r.state}-${r.county}-${now}`,
      source: 'power-grid' as const,
      severity: SEVERITY_TO_ALERT[r.severity],
      title: `Power outage: ${r.county}, ${r.state}`,
      body: `${r.customersOut.toLocaleString()} customers out (${Math.round(r.outageRatio * 100)}% of tracked).`,
      timestamp: now,
      relevanceScore: Math.min(1, r.customersOut / 1_000_000),
      acknowledged: false,
      pinned: false,
    }));
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
  if (flagged.length === 0) return { score: 0, severity: 'INFO', headline: 'No BGP inconsistencies detected' };
  const sev = maxSeverity(flagged.map((r) => r.severity));
  const total = flagged.reduce((acc, r) => acc + r.inconsistencyCount, 0);
  return {
    score: severityToScore(sev),
    severity: sev,
    headline: `${total} BGP inconsistencies across ${flagged.length} prefixes`,
  };
}

export function bgpAlertsFor(records: readonly BgpAnomalyRecord[], now: number): UnifiedAlert[] {
  return records
    .filter((r) => r.severity === 'HIGH')
    .map((r) => ({
      id: `infra-bgp-${r.resource}-${now}`,
      source: 'cyber' as const,
      severity: 'high' as const,
      title: `BGP anomaly: ${r.resource}`,
      body: `${r.inconsistencyCount} routing inconsistencies detected on ${r.resource}.`,
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

const DOMAIN_WEIGHTS = { power: 0.3, kev: 0.25, bgp: 0.2, acled: 0.25 };

export function composeInfraRiskState(input: {
  power: { records: PowerOutageRecord[]; score: DomainScore; alerts: UnifiedAlert[]; dataAsOf?: number };
  kev: { entries: CisaKevEntry[]; score: DomainScore; alerts: UnifiedAlert[] };
  bgp: { records: BgpAnomalyRecord[]; score: DomainScore; alerts: UnifiedAlert[] };
  acled: { events: AcledEvent[]; score: DomainScore; alerts: UnifiedAlert[] };
  fetchedAt: number;
}): InfraRiskState {
  const compositeScore = Math.round(
    input.power.score.score * DOMAIN_WEIGHTS.power
    + input.kev.score.score * DOMAIN_WEIGHTS.kev
    + input.bgp.score.score * DOMAIN_WEIGHTS.bgp
    + input.acled.score.score * DOMAIN_WEIGHTS.acled,
  );
  return {
    power: input.power,
    kev: input.kev,
    bgp: input.bgp,
    acled: input.acled,
    compositeScore,
    compositeSeverity: severityFromScore(compositeScore),
    fetchedAt: input.fetchedAt,
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────

export interface FetchInfraRisksOptions {
  /** Override the sidecar base URL. Default: '/api/infrarisks'. */
  baseUrl?: string;
  /** Injection point for tests. Default: globalThis.fetch. */
  fetchImpl?: typeof fetch;
  now?: number;
}

let _lastState: InfraRiskState | null = null;

/**
 * Pull the four upstream feeds via the sidecar, parse + score each
 * domain, generate per-domain UnifiedAlerts, and compose into an
 * InfraRiskState snapshot. Persists the result in module state so the
 * panel can read `getInfraState()` between refreshes.
 */
export async function fetchInfraRisks(opts: FetchInfraRisksOptions = {}): Promise<InfraRiskState> {
  const baseUrl = opts.baseUrl ?? '/api/infrarisks';
  const f = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? Date.now();

  const [powerRaw, kevRaw, bgpRaw, acledRaw] = await Promise.all([
    fetchSilent(f, `${baseUrl}/power`),
    fetchSilent(f, `${baseUrl}/kev`),
    fetchSilent(f, `${baseUrl}/bgp`),
    fetchSilent(f, `${baseUrl}/acled`),
  ]);

  const powerRecords = parsePowerOutages(powerRaw);
  const kevEntries = parseCisaKev(kevRaw, now);
  const bgpRecords = parseBgpAnomalies(bgpRaw);
  const acledEvents = parseAcledEvents(acledRaw);
  const powerDataAsOf = typeof (powerRaw as { cachedAt?: unknown } | null)?.cachedAt === 'number'
    ? (powerRaw as { cachedAt: number }).cachedAt
    : undefined;

  const state = composeInfraRiskState({
    power: { records: powerRecords, score: scorePowerOutages(powerRecords), alerts: powerAlertsFor(powerRecords, now), dataAsOf: powerDataAsOf },
    kev: { entries: kevEntries, score: scoreCisaKev(kevEntries, now), alerts: kevAlertsFor(kevEntries, now) },
    bgp: { records: bgpRecords, score: scoreBgpAnomalies(bgpRecords), alerts: bgpAlertsFor(bgpRecords, now) },
    acled: { events: acledEvents, score: scoreAcled(acledEvents), alerts: acledAlertsFor(acledEvents, now) },
    fetchedAt: now,
  });
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

async function fetchSilent(f: typeof fetch, url: string): Promise<unknown> {
  try {
    const r = await f(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json() as unknown;
  } catch {
    return null;
  }
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

function safeStringify(v: unknown): string {
  try { return typeof v === 'string' ? v : JSON.stringify(v); }
  catch { return ''; }
}
