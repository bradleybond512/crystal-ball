/**
 * urlscan.io — pure-deterministic parsing + classification.
 *
 * The search API returns one record per scan. We project the nested
 * `page` / `task` / `verdicts` blocks into a flat `UrlscanThreat` and
 * classify the verdict as malicious / suspicious / clean / unknown.
 */

export type UrlscanVerdict = 'malicious' | 'suspicious' | 'clean' | 'unknown';

export interface UrlscanThreat {
  /** urlscan.io scan UUID. */
  uuid: string;
  /** Page URL after redirects (display URL). */
  url: string;
  domain: string | null;
  ip: string | null;
  asn: string | null;
  country: string | null;
  verdict: UrlscanVerdict;
  /** Numeric verdict score, when present (-100..100; positive = malicious). */
  verdictScore: number | null;
  categories: string[];
  brands: string[];
  tags: string[];
  /** Direct URL to a screenshot PNG (urlscan-hosted). */
  screenshotUrl: string | null;
  reportUrl: string | null;
  scannedAt: number;
}

function pickString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  }
  return out;
}

function parseTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

export function classifyVerdict(
  rawVerdict: unknown,
  score: number | null,
): UrlscanVerdict {
  const raw = typeof rawVerdict === 'string' ? rawVerdict.toLowerCase() : '';
  if (raw.includes('malicious') || (typeof score === 'number' && score >= 50)) return 'malicious';
  if (raw.includes('suspicious') || (typeof score === 'number' && score >= 10)) return 'suspicious';
  if (raw === 'clean' || raw === 'benign' || (typeof score === 'number' && score <= 0 && raw !== '')) return 'clean';
  return 'unknown';
}

function deriveVerdictRaw(
  overall: Record<string, unknown>,
  rowVerdict: unknown,
  verdictScore: number | null,
): string | null {
  if (overall.malicious === true) return 'malicious';
  if (overall.malicious === false) {
    if (verdictScore !== null && verdictScore <= 0) return 'clean';
    return 'unknown';
  }
  return pickString(rowVerdict);
}

function parseUrlscanRow(raw: unknown): UrlscanThreat | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const task = (r.task as Record<string, unknown> | undefined) ?? {};
  const page = (r.page as Record<string, unknown> | undefined) ?? {};
  const verdicts = (r.verdicts as Record<string, unknown> | undefined) ?? {};
  const overall = (verdicts.overall as Record<string, unknown> | undefined) ?? {};
  const url = pickString(task.url, page.url, r.url);
  const uuid = pickString(r._id, task.uuid, r.uuid);
  if (!url || !uuid) return null;
  const rawScore = (overall.score ?? r.score) as unknown;
  const verdictScore = typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : null;
  const verdictRaw = deriveVerdictRaw(overall, r.verdict, verdictScore);
  return {
    uuid,
    url,
    domain: pickString(page.domain, task.domain),
    ip: pickString(page.ip, task.ip),
    asn: pickString(page.asn, page.asnname),
    country: pickString(page.country),
    verdict: classifyVerdict(verdictRaw, verdictScore),
    verdictScore,
    categories: pickStringArray(overall.categories),
    brands: pickStringArray(overall.brands),
    tags: pickStringArray(r.tags ?? task.tags),
    screenshotUrl: pickString(r.screenshot),
    reportUrl: pickString(r.result, task.reportURL),
    scannedAt: parseTimestamp(task.time ?? r.time ?? task.timestamp),
  };
}

/**
 * Parse a urlscan.io search-API payload (`{ results: [...] }`) into typed
 * threats. Tolerates raw arrays and skips bad rows.
 */
export function parseUrlscanThreats(payload: unknown): UrlscanThreat[] {
  let results: unknown[] = [];
  if (Array.isArray(payload)) {
    results = payload;
  } else if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.results)) results = p.results as unknown[];
  }
  const out: UrlscanThreat[] = [];
  for (const raw of results) {
    const parsed = parseUrlscanRow(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

export interface UrlscanStats {
  total: number;
  byVerdict: Record<UrlscanVerdict, number>;
  topCategories: { category: string; count: number }[];
  topBrands: { brand: string; count: number }[];
}

export function summariseUrlscan(threats: readonly UrlscanThreat[]): UrlscanStats {
  const stats: UrlscanStats = {
    total: threats.length,
    byVerdict: { malicious: 0, suspicious: 0, clean: 0, unknown: 0 },
    topCategories: [],
    topBrands: [],
  };
  const cats = new Map<string, number>();
  const brands = new Map<string, number>();
  for (const t of threats) {
    stats.byVerdict[t.verdict] += 1;
    for (const c of t.categories) cats.set(c, (cats.get(c) ?? 0) + 1);
    for (const b of t.brands) brands.set(b, (brands.get(b) ?? 0) + 1);
  }
  stats.topCategories = [...cats.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([category, count]) => ({ category, count }));
  stats.topBrands = [...brands.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([brand, count]) => ({ brand, count }));
  return stats;
}

const VERDICT_HEX: Record<UrlscanVerdict, string> = {
  malicious: '#ff453a',
  suspicious: '#ff9800',
  clean: '#4caf50',
  unknown: '#9e9e9e',
};

export function verdictColor(verdict: UrlscanVerdict): string {
  return VERDICT_HEX[verdict];
}

/**
 * Validate a URL the user typed into the Scan input. Returns the normalised
 * URL string on success or an error message on failure. Blocks SSRF prone
 * private hosts so the sidecar can fail closed even if its own check slips.
 */
export function validateSubmitUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'URL is empty' };
  let parsed: URL;
  try { parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`); }
  catch { return { ok: false, error: 'Not a valid URL' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) URLs accepted' };
  }
  const host = parsed.hostname.toLowerCase();
  // eslint-disable-next-line no-restricted-syntax -- user-typed host being validated, not a value we send.
  const isLoopbackName = host === 'localhost';
  if (
    isLoopbackName ||
    host === '0.0.0.0' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith('.local')
  ) {
    return { ok: false, error: 'Private host blocked' };
  }
  return { ok: true, url: parsed.toString() };
}
