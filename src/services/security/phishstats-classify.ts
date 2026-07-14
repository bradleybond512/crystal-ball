/**
 * PhishStats — pure-deterministic parsing + classification.
 *
 * Upstream returns one row per phishing URL. Each row has a confidence score
 * (0–10), a target brand string, the IP/country, and a date. Higher score =
 * higher confidence the URL is malicious.
 */

export type PhishSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface PhishingRecord {
  id: string;
  url: string;
  /** PhishStats confidence score, 0–10 (10 = highest confidence). */
  score: number;
  severity: PhishSeverity;
  /** Target brand (e.g. "Microsoft", "PayPal") — null when not detected. */
  target: string | null;
  ip: string | null;
  countryCode: string | null;
  countryName: string | null;
  /** Detection timestamp, unix ms. */
  detectedAt: number;
  asn: string | null;
}

export function classifyScore(score: number): PhishSeverity {
  if (!Number.isFinite(score)) return 'low';
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
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

function pickNumber(...values: unknown[]): number | null {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
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

/**
 * Parse a raw PhishStats payload (array-of-objects) into typed records. Bad
 * rows are skipped — callers get a clean envelope, not a thrown exception.
 */
export function parsePhishingRecords(payload: unknown): PhishingRecord[] {
  if (!Array.isArray(payload)) return [];
  const out: PhishingRecord[] = [];
  for (const raw of payload) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const url = pickString(r.url);
    if (!url) continue;
    const score = pickNumber(r.score) ?? 0;
    const id = pickString(r.id) ?? `${url}#${out.length}`;
    out.push({
      id,
      url,
      score,
      severity: classifyScore(score),
      target: pickString(r.title, r.target),
      ip: pickString(r.ip),
      countryCode: pickString(r.countrycode, r.country_code, r.cc),
      countryName: pickString(r.countryname, r.country_name, r.country),
      detectedAt: parseTimestamp(r.date ?? r.added),
      asn: pickString(r.asn, r.bgp),
    });
  }
  return out;
}

export interface PhishingStats {
  total: number;
  bySeverity: Record<PhishSeverity, number>;
  topTargets: { target: string; count: number }[];
  topCountries: { countryCode: string; countryName: string | null; count: number }[];
  /** Max detection timestamp seen, unix ms — null when no rows had a date. */
  latestDetectedAt: number | null;
}

export function summarisePhishing(
  records: readonly PhishingRecord[],
  topN = 5,
): PhishingStats {
  const stats: PhishingStats = {
    total: records.length,
    bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
    topTargets: [],
    topCountries: [],
    latestDetectedAt: null,
  };
  const targets = new Map<string, number>();
  const countries = new Map<string, { name: string | null; count: number }>();
  for (const r of records) {
    stats.bySeverity[r.severity] += 1;
    if (r.target) targets.set(r.target, (targets.get(r.target) ?? 0) + 1);
    if (r.countryCode) {
      const prior = countries.get(r.countryCode);
      countries.set(r.countryCode, {
        name: prior?.name ?? r.countryName,
        count: (prior?.count ?? 0) + 1,
      });
    }
    if (stats.latestDetectedAt === null || r.detectedAt > stats.latestDetectedAt) {
      stats.latestDetectedAt = r.detectedAt;
    }
  }
  stats.topTargets = [...targets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([target, count]) => ({ target, count }));
  stats.topCountries = [...countries.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, topN)
    .map(([countryCode, v]) => ({ countryCode, countryName: v.name, count: v.count }));
  return stats;
}

export function filterByMinScore(
  records: readonly PhishingRecord[],
  minScore: number,
): PhishingRecord[] {
  return records.filter((r) => r.score >= minScore);
}

const SEVERITY_HEX: Record<PhishSeverity, string> = {
  low: '#9e9e9e',
  medium: '#ffeb3b',
  high: '#ff9800',
  critical: '#ff453a',
};

export function severityColor(severity: PhishSeverity): string {
  return SEVERITY_HEX[severity];
}

const MAX_DISPLAY_LEN = 60;

/** Truncate a URL for the table display — keep the host + start of the path. */
export function truncateUrl(url: string, maxLen = MAX_DISPLAY_LEN): string {
  if (url.length <= maxLen) return url;
  return `${url.slice(0, maxLen - 1)}…`;
}
