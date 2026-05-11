/**
 * HIBP (Have I Been Pwned) breach intelligence — public breaches list.
 *
 * Pure parsers + a thin fetcher facade. The sidecar
 * (/api/security/breaches{,/latest}) proxies the HIBP public API
 * (no API key required for breach metadata) and runs caching;
 * downstream consumers just receive a typed array.
 *
 * Source: https://haveibeenpwned.com/api/v3/breaches
 */

import { getApiBaseUrl } from '@/services/runtime';

// ── Public types ──────────────────────────────────────────────────────

export type BreachSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface HibpBreach {
  /** Stable name slug, e.g. "Adobe". */
  name: string;
  /** Pretty title, often === name. */
  title: string;
  /** Site domain, e.g. "adobe.com". */
  domain: string;
  /** ISO yyyy-mm-dd of the breach incident. */
  breachDate: string;
  /** ISO ms timestamp when HIBP first added it. */
  addedDate: string;
  /** ISO ms timestamp of last modification. */
  modifiedDate: string;
  /** Number of accounts pwned. */
  pwnCount: number;
  /** Plain-text summary HIBP publishes alongside the breach. */
  description: string;
  /** Stolen-data taxonomy ("Email addresses", "Passwords", etc.). */
  dataClasses: string[];
  isVerified: boolean;
  isFabricated: boolean;
  isSensitive: boolean;
  isRetired: boolean;
  isSpamList: boolean;
  isMalware: boolean;
  logoPath?: string;
  severity: BreachSeverity;
}

export interface BreachStatistics {
  totalBreaches: number;
  totalPwnedAccounts: number;
  /** Top data classes by frequency (count of breaches that include it). */
  topDataClasses: { dataClass: string; count: number }[];
  /** Count by severity bucket. */
  bySeverity: Record<BreachSeverity, number>;
  /** Total breaches added in the trailing 90 days. */
  recentBreaches: number;
}

// ── Severity classification ──────────────────────────────────────────

const CRITICAL_DATA = new Set([
  'Passwords',
  'Password hashes',
  'Password hints',
  'Credit cards',
  'Bank account numbers',
  'Social security numbers',
  'Government issued IDs',
  'Auth tokens',
]);

const HIGH_DATA = new Set([
  'Phone numbers',
  'Physical addresses',
  'Health data',
  'Drivers licenses',
  'Passport numbers',
  'Tax records',
  'Browsing histories',
  'IP addresses',
  'Security questions and answers',
]);

const MEDIUM_DATA = new Set([
  'Email addresses',
  'Names',
  'Dates of birth',
  'Genders',
  'Geographic locations',
]);

/** Classify a breach by the most-sensitive data class it leaked. */
export function classifyBreachSeverity(dataClasses: readonly string[]): BreachSeverity {
  for (const c of dataClasses) if (CRITICAL_DATA.has(c)) return 'critical';
  for (const c of dataClasses) if (HIGH_DATA.has(c)) return 'high';
  for (const c of dataClasses) if (MEDIUM_DATA.has(c)) return 'medium';
  return 'low';
}

// ── Row parser ────────────────────────────────────────────────────────

function toStr(x: unknown, fallback = ''): string {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  return fallback;
}

function toFiniteInt(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function toBool(x: unknown): boolean {
  return x === true;
}

/** Parse a raw HIBP breach object. Returns null for rows missing the
 *  identity fields. */
export function parseBreachRow(row: unknown): HibpBreach | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const name = toStr(r.Name);
  const breachDate = toStr(r.BreachDate);
  if (!name || !breachDate) return null;
  const dataClasses = Array.isArray(r.DataClasses)
    ? r.DataClasses.filter((x): x is string => typeof x === 'string')
    : [];
  return {
    name,
    title: toStr(r.Title) || name,
    domain: toStr(r.Domain),
    breachDate,
    addedDate: toStr(r.AddedDate),
    modifiedDate: toStr(r.ModifiedDate),
    pwnCount: toFiniteInt(r.PwnCount),
    description: toStr(r.Description),
    dataClasses,
    isVerified: toBool(r.IsVerified),
    isFabricated: toBool(r.IsFabricated),
    isSensitive: toBool(r.IsSensitive),
    isRetired: toBool(r.IsRetired),
    isSpamList: toBool(r.IsSpamList),
    isMalware: toBool(r.IsMalware),
    logoPath: typeof r.LogoPath === 'string' ? r.LogoPath : undefined,
    severity: classifyBreachSeverity(dataClasses),
  };
}

/** Parse a HIBP breach response array. */
export function parseBreaches(raw: unknown): HibpBreach[] {
  if (!Array.isArray(raw)) return [];
  const out: HibpBreach[] = [];
  for (const r of raw) {
    const b = parseBreachRow(r);
    if (b) out.push(b);
  }
  return out;
}

// ── Sort / filter / search ────────────────────────────────────────────

export function sortByBreachDateDesc(breaches: readonly HibpBreach[]): HibpBreach[] {
  return [...breaches].sort((a, b) => b.breachDate.localeCompare(a.breachDate));
}

/** Subset of breaches added (per HIBP's `AddedDate`) within the
 *  trailing windowDays. Default 90 days per spec. */
export function filterRecentlyAdded(
  breaches: readonly HibpBreach[],
  windowDays = 90,
  now: number = Date.now(),
): HibpBreach[] {
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  const out: HibpBreach[] = [];
  for (const b of breaches) {
    const t = Date.parse(b.addedDate);
    if (Number.isFinite(t) && t >= cutoff) out.push(b);
  }
  return out;
}

/** Case-insensitive substring search across name, title, domain. */
export function searchBreaches(breaches: readonly HibpBreach[], query: string, limit = 50): HibpBreach[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: HibpBreach[] = [];
  for (const b of breaches) {
    const hay = `${b.name}\n${b.title}\n${b.domain}`.toLowerCase();
    if (hay.includes(q)) hits.push(b);
    if (hits.length >= limit) break;
  }
  return hits;
}

// ── Statistics ────────────────────────────────────────────────────────

export function computeBreachStatistics(
  breaches: readonly HibpBreach[],
  now: number = Date.now(),
): BreachStatistics {
  const bySeverity: Record<BreachSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const dataClassCounts = new Map<string, number>();
  let totalPwnedAccounts = 0;
  for (const b of breaches) {
    bySeverity[b.severity] += 1;
    totalPwnedAccounts += b.pwnCount;
    for (const c of b.dataClasses) dataClassCounts.set(c, (dataClassCounts.get(c) ?? 0) + 1);
  }
  const topDataClasses = [...dataClassCounts.entries()]
    .map(([dataClass, count]) => ({ dataClass, count }))
    .sort((a, b) => b.count - a.count || a.dataClass.localeCompare(b.dataClass))
    .slice(0, 10);
  return {
    totalBreaches: breaches.length,
    totalPwnedAccounts,
    topDataClasses,
    bySeverity,
    recentBreaches: filterRecentlyAdded(breaches, 90, now).length,
  };
}

// ── Cache key helpers ─────────────────────────────────────────────────

/** Stable cache key for an arbitrary search query. Used by the sidecar
 *  to dedupe identical-query requests during the cache window.
 *  Lowercases + trims + collapses internal whitespace. */
export function searchCacheKey(query: string, limit: number): string {
  const norm = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return `breaches-search:${norm}:${Math.max(1, Math.trunc(limit))}`;
}

// ── Severity color ramp (panel + globe layer share) ──────────────────

export const BREACH_SEVERITY_COLOR: Readonly<Record<BreachSeverity, string>> = {
  critical: '#dc2626',
  high: '#fb923c',
  medium: '#fbbf24',
  low: '#10b981',
};

// ── Fetcher facades ───────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 25_000;

async function fetchJsonOrNull(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchAllBreaches(): Promise<HibpBreach[]> {
  const data = await fetchJsonOrNull(`${getApiBaseUrl()}/api/security/breaches`);
  if (!data || typeof data !== 'object') return [];
  const arr = (data as { breaches?: unknown }).breaches;
  return parseBreaches(arr);
}

export async function fetchLatestBreaches(): Promise<HibpBreach[]> {
  const data = await fetchJsonOrNull(`${getApiBaseUrl()}/api/security/breaches/latest`);
  if (!data || typeof data !== 'object') return [];
  const arr = (data as { breaches?: unknown }).breaches;
  return parseBreaches(arr);
}

export async function searchBreachesRemote(query: string, limit = 50): Promise<HibpBreach[]> {
  if (!query.trim()) return [];
  const url = `${getApiBaseUrl()}/api/security/breaches?q=${encodeURIComponent(query)}&limit=${Math.max(1, Math.trunc(limit))}`;
  const data = await fetchJsonOrNull(url);
  if (!data || typeof data !== 'object') return [];
  const arr = (data as { breaches?: unknown }).breaches;
  return parseBreaches(arr);
}
