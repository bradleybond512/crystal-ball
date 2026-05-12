/**
 * Bitcoin Abuse intelligence service.
 *
 * Pure-deterministic helpers + thin renderer-side fetch wrappers around
 * `/api/crypto/bitcoin-abuse` and `/api/crypto/bitcoin-abuse/check`.
 *
 * Data sources (sidecar resolves these — module is renderer-safe):
 *   - CryptoScamDB v1   (no key) for scam addresses + scam domains
 *   - blockchain.info   (no key) for balance / tx_count on a single address
 *   - Bitcoin Abuse DB  (key-gated, optional) for crowd-sourced reports
 *
 * No DOM, no globals at import time. Fetch only inside the public
 * loaders — pure helpers can be unit-tested on fixture JSON.
 */

import { getApiBaseUrl } from '../runtime';

// ── Public types ───────────────────────────────────────────────────────

export type ScamAddressCategory =
  | 'scam'
  | 'ransomware'
  | 'darknet'
  | 'mining'
  | 'phishing'
  | 'mixer'
  | 'other';

export interface ScamAddressEntry {
  address: string;
  /** Normalised category — CryptoScamDB calls the field `subcategory` or
   *  `category` depending on payload shape. */
  category: ScamAddressCategory;
  /** Number of reports / mentions backing this entry. Defaults to 1
   *  when the upstream payload doesn't expose a count. */
  reportCount: number;
  /** Optional human-readable name (e.g. "BitConnect"). */
  name?: string;
  /** ISO timestamp of the last reported activity, when known. */
  lastReportedAt?: string;
}

export type ScamDomainStatus = 'active' | 'inactive' | 'unknown';

export interface ScamDomainEntry {
  domain: string;
  category: ScamAddressCategory;
  status: ScamDomainStatus;
  name?: string;
  reportedAt?: string;
}

export interface BitcoinAbuseFeed {
  addresses: ScamAddressEntry[];
  domains: ScamDomainEntry[];
  /** Set when the upstream returned a degraded response (e.g. rate
   *  limit, optional key missing). Renderer surfaces this so users
   *  understand a low result count is provenance, not a bug. */
  degraded: boolean;
  /** Free-form provenance string the panel surfaces in the footer. */
  source: string;
  /** Sidecar cache freshness — ISO timestamp the snapshot was built. */
  generatedAt: string;
}

export interface AddressCheckResult {
  address: string;
  /** True when the address appears in any ingested scam DB. */
  scamMatch: ScamAddressEntry | null;
  /** Blockchain.info balance, satoshis. `null` when chain lookup failed. */
  balanceSat: number | null;
  /** Total tx count from chain lookup. `null` when chain lookup failed. */
  txCount: number | null;
  /** Free-form provenance string for the footer. */
  source: string;
  fetchedAt: string;
}

// ── Pure parsers ───────────────────────────────────────────────────────

const VALID_CATEGORIES: ReadonlySet<ScamAddressCategory> = new Set([
  'scam', 'ransomware', 'darknet', 'mining', 'phishing', 'mixer', 'other',
]);

/** Coerce arbitrary upstream category strings to one of our enum values.
 *  Cryptoscamdb has a free-form `subcategory` field — we map the common
 *  cases and bucket the rest as 'other'. */
export function normalizeCategory(raw: unknown): ScamAddressCategory {
  if (typeof raw !== 'string') return 'other';
  const lower = raw.toLowerCase();
  if (lower.includes('ransom')) return 'ransomware';
  if (lower.includes('phish')) return 'phishing';
  if (lower.includes('mixer') || lower.includes('tumbler')) return 'mixer';
  if (lower.includes('darknet') || lower.includes('dark net') || lower.includes('darkmarket')) return 'darknet';
  if (lower.includes('mining') || lower.includes('miner')) return 'mining';
  if (lower.includes('scam') || lower.includes('fraud') || lower.includes('fake')) return 'scam';
  return VALID_CATEGORIES.has(lower as ScamAddressCategory) ? (lower as ScamAddressCategory) : 'other';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

interface CryptoScamRecord {
  address?: unknown;
  name?: unknown;
  category?: unknown;
  subcategory?: unknown;
  url?: unknown;
  reportedaddresses?: unknown;
  reports?: unknown;
  /** CryptoScamDB sometimes uses `coin` to disambiguate; we only keep BTC. */
  coin?: unknown;
}

interface KeyedRecord<T> { key: string | null; record: T }

/** Split a CryptoScamDB-shaped envelope into per-record entries.
 *  Handles both the legacy object-keyed form and the array form. */
function recordsFromResult<T extends object>(raw: unknown): KeyedRecord<T>[] {
  if (!raw || typeof raw !== 'object') return [];
  const result = (raw as Record<string, unknown>).result;
  if (Array.isArray(result)) return arrayResultToRecords<T>(result);
  if (result && typeof result === 'object') return objectResultToRecords<T>(result as Record<string, unknown>);
  return [];
}

function arrayResultToRecords<T extends object>(arr: readonly unknown[]): KeyedRecord<T>[] {
  const out: KeyedRecord<T>[] = [];
  for (const r of arr) {
    if (r && typeof r === 'object') out.push({ key: null, record: r as T });
  }
  return out;
}

function objectResultToRecords<T extends object>(obj: Record<string, unknown>): KeyedRecord<T>[] {
  const out: KeyedRecord<T>[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object') out.push({ key, record: value as T });
  }
  return out;
}

/**
 * Parse CryptoScamDB `/v1/addresses` response. Accepts both shapes the
 * API has used over the years — the legacy object-keyed-by-address form
 * `{ success, result: { "addr1": {...}, ... } }` and the newer array
 * form `{ success, result: [...] }`. Returns a normalised list with
 * non-BTC entries dropped.
 */
export function parseScamAddressesResponse(raw: unknown): ScamAddressEntry[] {
  const out: ScamAddressEntry[] = [];
  for (const { key, record } of recordsFromResult<CryptoScamRecord>(raw)) {
    const entry = toScamAddressEntry(key, record);
    if (entry) out.push(entry);
  }
  return out;
}

function toScamAddressEntry(
  key: string | null,
  record: CryptoScamRecord,
): ScamAddressEntry | null {
  const coin = asString(record.coin);
  if (coin && coin.toUpperCase() !== 'BTC') return null;
  const address = asString(record.address) ?? key ?? null;
  if (!address) return null;
  return {
    address,
    category: normalizeCategory(record.subcategory ?? record.category),
    reportCount: asNumber(record.reports) ?? asNumber(record.reportedaddresses) ?? 1,
    name: asString(record.name),
  };
}

interface CryptoScamDomainRecord {
  url?: unknown;
  domain?: unknown;
  name?: unknown;
  category?: unknown;
  subcategory?: unknown;
  status?: unknown;
  reported?: unknown;
}

function normaliseDomainStatus(raw: unknown): ScamDomainStatus {
  if (typeof raw !== 'string') return 'unknown';
  const lower = raw.toLowerCase();
  if (lower.includes('offline') || lower.includes('inactive') || lower === 'dead') return 'inactive';
  if (lower.includes('active') || lower === 'online') return 'active';
  return 'unknown';
}

/** Parse CryptoScamDB `/v1/domains` response. Mirrors
 *  `parseScamAddressesResponse` — handles array + object payload shapes
 *  and accepts either `url` or `domain` as the primary key. */
export function parseScamDomainsResponse(raw: unknown): ScamDomainEntry[] {
  const out: ScamDomainEntry[] = [];
  for (const { key, record } of recordsFromResult<CryptoScamDomainRecord>(raw)) {
    const entry = toScamDomainEntry(key, record);
    if (entry) out.push(entry);
  }
  return out;
}

function toScamDomainEntry(
  key: string | null,
  record: CryptoScamDomainRecord,
): ScamDomainEntry | null {
  const domain = asString(record.domain) ?? asString(record.url) ?? key ?? null;
  if (!domain) return null;
  return {
    domain: stripProtocol(domain),
    category: normalizeCategory(record.subcategory ?? record.category),
    status: normaliseDomainStatus(record.status),
    name: asString(record.name),
    reportedAt: asString(record.reported),
  };
}

function stripProtocol(value: string): string {
  return value.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

/**
 * Lightweight Bitcoin address shape check — exact validation would
 * require base58/bech32 decoding (and is not part of the spec). We
 * accept legacy P2PKH (`1...`), P2SH (`3...`), and bech32 (`bc1...`)
 * by prefix + length so the panel can reject obvious typos before
 * sending the request to the sidecar.
 */
export function isPlausibleBtcAddress(value: string): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 26 || trimmed.length > 90) return false;
  if (/^bc1[ac-hj-np-z02-9]+$/i.test(trimmed)) return true;
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return true;
  return false;
}

// ── Renderer-side fetch wrappers ───────────────────────────────────────

const FEED_PATH = '/api/crypto/bitcoin-abuse';
const CHECK_PATH = '/api/crypto/bitcoin-abuse/check';

export async function fetchBitcoinAbuseFeed(): Promise<BitcoinAbuseFeed> {
  try {
    const res = await fetch(`${getApiBaseUrl()}${FEED_PATH}`);
    if (!res.ok) return emptyFeed(`HTTP ${res.status}`);
    const data = (await res.json()) as Partial<BitcoinAbuseFeed>;
    return {
      addresses: Array.isArray(data.addresses) ? data.addresses : [],
      domains: Array.isArray(data.domains) ? data.domains : [],
      degraded: data.degraded === true,
      source: typeof data.source === 'string' ? data.source : 'CryptoScamDB',
      generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : new Date(0).toISOString(),
    };
  } catch (error) {
    return emptyFeed(error instanceof Error ? error.message : String(error));
  }
}

export async function fetchBitcoinAddressCheck(address: string): Promise<AddressCheckResult> {
  const fallback: AddressCheckResult = {
    address,
    scamMatch: null,
    balanceSat: null,
    txCount: null,
    source: 'lookup-failed',
    fetchedAt: new Date().toISOString(),
  };
  if (!isPlausibleBtcAddress(address)) {
    return { ...fallback, source: 'invalid-address-format' };
  }
  try {
    const url = `${getApiBaseUrl()}${CHECK_PATH}?address=${encodeURIComponent(address.trim())}`;
    const res = await fetch(url);
    if (!res.ok) return { ...fallback, source: `HTTP ${res.status}` };
    const data = (await res.json()) as Partial<AddressCheckResult>;
    return {
      address: data.address ?? address,
      scamMatch: data.scamMatch ?? null,
      balanceSat: typeof data.balanceSat === 'number' ? data.balanceSat : null,
      txCount: typeof data.txCount === 'number' ? data.txCount : null,
      source: typeof data.source === 'string' ? data.source : 'unknown',
      fetchedAt: typeof data.fetchedAt === 'string' ? data.fetchedAt : new Date().toISOString(),
    };
  } catch (error) {
    return { ...fallback, source: error instanceof Error ? error.message : String(error) };
  }
}

function emptyFeed(reason: string): BitcoinAbuseFeed {
  return {
    addresses: [],
    domains: [],
    degraded: true,
    source: reason,
    generatedAt: new Date(0).toISOString(),
  };
}

// ── Formatting helpers (panel surfaces) ────────────────────────────────

export function truncateAddress(address: string, head = 6, tail = 6): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function formatSatoshisAsBtc(sats: number | null): string {
  if (sats === null || !Number.isFinite(sats)) return '—';
  return `${(sats / 100_000_000).toFixed(8)} BTC`;
}
