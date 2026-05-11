/**
 * ipinfo.io geo + ASN lookup — single + batch.
 *
 * Pure parsers + facade. The sidecar (/api/security/ipinfo) proxies
 * the public ipinfo.io API (50k req/month free tier, basic tier
 * doesn't require auth) and runs a 1-hour per-IP cache.
 *
 * Source: https://ipinfo.io/{ip}/json
 */

import { getApiBaseUrl } from '@/services/runtime';

// ── Public types ──────────────────────────────────────────────────────

export interface IpInfo {
  ip: string;
  hostname?: string;
  city?: string;
  region?: string;
  country?: string;
  /** Two-character country code, uppercased. */
  countryCode?: string;
  /** Latitude in decimal degrees. */
  lat?: number;
  /** Longitude in decimal degrees. */
  lon?: number;
  /** Combined "AS<num> <ORG>" string when present. */
  org?: string;
  /** Just "AS<num>" parsed from `org`. */
  asn?: string;
  /** Just the org portion of `org`. */
  orgName?: string;
  postal?: string;
  timezone?: string;
  /** True when ipinfo flags the IP as part of an anycast block. */
  anycast?: boolean;
  /** Bogon (private/reserved) per ipinfo's classification. */
  bogon?: boolean;
  /** ISO timestamp of when the lookup was made. */
  fetchedAt?: string;
}

export interface IpThreatContext {
  ip: string;
  /** True when the ASN appears in the configured bad-actor list. */
  knownBadActor: boolean;
  /** Free-form rationale shown next to the warning badge. */
  notes: string[];
}

// ── IP validation ─────────────────────────────────────────────────────

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})$/;
const IPV6_RE = /^[\da-f:]+$/i;

/** True when `s` parses as a syntactically-valid IPv4 or IPv6
 *  address (compressed forms accepted, no full-RFC validation). */
export function isValidIp(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (IPV4_RE.test(trimmed)) return true;
  // Crude IPv6: hex + colons only, must contain a colon, length sane.
  if (trimmed.length >= 3 && trimmed.length <= 39 && trimmed.includes(':') && IPV6_RE.test(trimmed)) {
    return true;
  }
  return false;
}

// ── Parser ────────────────────────────────────────────────────────────

function toStr(x: unknown): string | undefined {
  if (typeof x === 'string' && x.trim().length > 0) return x.trim();
  return undefined;
}

function toBool(x: unknown): boolean | undefined {
  if (x === true) return true;
  if (x === false) return false;
  return undefined;
}

function parseLatLon(loc: string | undefined): { lat?: number; lon?: number } {
  if (!loc) return {};
  const parts = loc.split(',');
  if (parts.length !== 2) return {};
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return {};
  return { lat, lon };
}

/** Pull the leading "ASNNN" token + the rest of the org string out of
 *  ipinfo's `org` field (e.g. "AS15169 Google LLC"). */
function parseOrg(org: string | undefined): { asn?: string; orgName?: string } {
  if (!org) return {};
  const trimmed = org.trim();
  const space = trimmed.indexOf(' ');
  if (space > 0) {
    const head = trimmed.slice(0, space);
    if (/^AS\d+$/i.test(head)) {
      return { asn: head.toUpperCase(), orgName: trimmed.slice(space + 1).trim() };
    }
  }
  return { orgName: trimmed };
}

/** Parse a raw ipinfo.io response. Returns null when the response
 *  doesn't even include an `ip` field (which is what the upstream
 *  returns on a malformed/blocked input). */
export function parseIpInfoResponse(raw: unknown): IpInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ip = toStr(r.ip);
  if (!ip) return null;
  const country = toStr(r.country);
  const { lat, lon } = parseLatLon(toStr(r.loc));
  const orgRaw = toStr(r.org);
  const { asn, orgName } = parseOrg(orgRaw);
  return {
    ip,
    hostname: toStr(r.hostname),
    city: toStr(r.city),
    region: toStr(r.region),
    country,
    countryCode: country ? country.toUpperCase() : undefined,
    lat,
    lon,
    org: orgRaw,
    asn,
    orgName,
    postal: toStr(r.postal),
    timezone: toStr(r.timezone),
    anycast: toBool(r.anycast),
    bogon: toBool(r.bogon),
    fetchedAt: toStr(r.fetchedAt) ?? new Date().toISOString(),
  };
}

// ── Cache key (1h per-IP) ─────────────────────────────────────────────

/** Stable cache key for a per-IP lookup. Sidecar groups concurrent
 *  requests for the same IP under a single upstream call. */
export function ipInfoCacheKey(ip: string): string {
  return `ipinfo:${ip.trim().toLowerCase()}`;
}

// ── Threat-context cross-reference ────────────────────────────────────

/** ASN list curated from public OTX / GDELT-tagged actors. Stored as a
 *  Set so callers can pass their own ASN feed in lieu of the default
 *  via `crossReferenceThreats({ knownBadAsns })`. */
export const KNOWN_BAD_ACTOR_ASNS: ReadonlySet<string> = new Set([
  // Bulletproof / abuse-tolerant hosts that consistently rank in
  // public threat feeds. Treat as a starting set, not authoritative.
  'AS200651', // Flokinet (LV)
  'AS204428', // SS-Net (RU/MK)
  'AS35415',  // Webzilla (NL)
  'AS46844',  // ServerStack / Sharktech
  'AS49447',  // RM Engineering
  'AS50340',  // Selectel-fronted abuse
  'AS197695', // Reg.ru (RU)
  'AS208951', // 1337TEAM
  'AS209588', // FlokiNET BG
]);

export function crossReferenceThreats(
  info: IpInfo,
  options: { knownBadAsns?: ReadonlySet<string> } = {},
): IpThreatContext {
  const list = options.knownBadAsns ?? KNOWN_BAD_ACTOR_ASNS;
  const notes: string[] = [];
  let knownBadActor = false;
  if (info.asn && list.has(info.asn.toUpperCase())) {
    knownBadActor = true;
    notes.push(`ASN ${info.asn} (${info.orgName ?? '—'}) is on the bad-actor watchlist.`);
  }
  if (info.bogon) {
    notes.push('IP is in a bogon (private/reserved) range.');
  }
  if (info.anycast) {
    notes.push('IP is part of an anycast block — geolocation is approximate.');
  }
  return { ip: info.ip, knownBadActor, notes };
}

// ── History store (localStorage) ──────────────────────────────────────

const HISTORY_KEY = 'cb:ipinfo-history';
const HISTORY_LIMIT = 20;

export interface HistoryEntry {
  ip: string;
  countryCode?: string;
  city?: string;
  asn?: string;
  at: number;
}

export function recordHistory(entry: HistoryEntry, list: readonly HistoryEntry[]): HistoryEntry[] {
  // Move-to-front semantics: dedupe by IP, then prepend.
  const filtered = list.filter((e) => e.ip !== entry.ip);
  return [entry, ...filtered].slice(0, HISTORY_LIMIT);
}

export function loadHistoryFromStorage(): HistoryEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is HistoryEntry => {
      return typeof e === 'object' && e !== null && typeof (e as HistoryEntry).ip === 'string';
    }).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function saveHistoryToStorage(history: readonly HistoryEntry[]): void {
  try {
    globalThis.localStorage?.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  } catch {
    /* quota / disabled storage — quiet noop */
  }
}

// ── Fetcher facades ───────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 12_000;

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

export async function lookupIp(ip: string): Promise<IpInfo | null> {
  if (!isValidIp(ip)) return null;
  const url = `${getApiBaseUrl()}/api/security/ipinfo?ip=${encodeURIComponent(ip.trim())}`;
  const data = await fetchJsonOrNull(url);
  return parseIpInfoResponse(data);
}

/** Batch lookup. Slices the input to a safe ceiling, dedupes, then
 *  fans out concurrent calls. Returns one entry per unique input IP,
 *  preserving input order. Invalid entries surface as `null`. */
export async function lookupIpBatch(ips: readonly string[], maxBatch = 50): Promise<(IpInfo | null)[]> {
  const trimmed = ips.map((s) => s.trim()).filter((s) => s.length > 0).slice(0, maxBatch);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const ip of trimmed) {
    const key = ip.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(ip);
    }
  }
  return Promise.all(unique.map((ip) => lookupIp(ip)));
}
