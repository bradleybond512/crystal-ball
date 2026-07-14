/**
 * Pulsedive — pure-deterministic parsing + classification for threat
 * indicators (IPs, domains, URLs, hashes).
 *
 * Pulsedive's public API returns indicator records with a textual risk
 * level (`none`/`low`/`medium`/`high`/`critical`), a `risk_recommended`
 * for the consensus level, an indicator `type`, a `threats` array, and
 * `lastseen` timestamp. We project these into a typed `PulsediveIndicator`.
 */

export type PulsediveRisk = 'none' | 'low' | 'medium' | 'high' | 'critical' | 'unknown';

export type PulsediveType =
  | 'ip'
  | 'ipv6'
  | 'domain'
  | 'url'
  | 'hash'
  | 'email'
  | 'unknown';

export interface PulsediveIndicator {
  /** Pulsedive numeric ID. */
  iid: number | null;
  /** Indicator value (e.g. "1.2.3.4", "evil.example.com"). */
  indicator: string;
  type: PulsediveType;
  risk: PulsediveRisk;
  /** Recommended consensus risk when present. */
  riskRecommended: PulsediveRisk;
  /** Active threat tags ("Phishing", "Ransomware", ...). */
  threats: string[];
  /** Active threat feeds the indicator appears in. */
  feeds: string[];
  /** First-seen timestamp (unix ms), null when missing. */
  firstSeen: number | null;
  /** Last-seen timestamp (unix ms), null when missing. */
  lastSeen: number | null;
}

const RISK_ORDER: Record<PulsediveRisk, number> = {
  none: 0,
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function classifyRisk(raw: unknown): PulsediveRisk {
  if (typeof raw !== 'string') return 'unknown';
  const v = raw.toLowerCase().trim();
  if (v === 'none') return 'none';
  if (v === 'low') return 'low';
  if (v === 'medium') return 'medium';
  if (v === 'high') return 'high';
  if (v === 'critical') return 'critical';
  return 'unknown';
}

export function classifyType(raw: unknown): PulsediveType {
  if (typeof raw !== 'string') return 'unknown';
  const v = raw.toLowerCase().trim();
  if (v === 'ip') return 'ip';
  if (v === 'ipv6') return 'ipv6';
  if (v === 'domain') return 'domain';
  if (v === 'url') return 'url';
  if (v === 'hash' || v === 'md5' || v === 'sha1' || v === 'sha256') return 'hash';
  if (v === 'email') return 'email';
  return 'unknown';
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

function pickInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function pickStringArrayFromObjects(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === 'string' && v.trim()) {
      out.push(v.trim());
    } else if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const s = pickString(obj[key], obj.name);
      if (s) out.push(s);
    }
  }
  return out;
}

/**
 * Parse a Pulsedive payload. Accepts:
 *  - the `info.php` shape (single indicator object — wrap in array),
 *  - the `explore.php` shape (`{ results: [...] }`),
 *  - or a bare array of indicator objects.
 */
export function parsePulsediveIndicators(payload: unknown): PulsediveIndicator[] {
  let rows: unknown[] = [];
  if (Array.isArray(payload)) {
    rows = payload;
  } else if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.results)) {
      rows = p.results as unknown[];
    } else if (Array.isArray(p.indicators)) {
      rows = p.indicators as unknown[];
    } else if (typeof p.indicator === 'string') {
      // info.php single-result shape: wrap.
      rows = [p];
    }
  }
  const out: PulsediveIndicator[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const indicator = pickString(r.indicator, r.value);
    if (!indicator) continue;
    out.push({
      iid: pickInt(r.iid ?? r.id),
      indicator,
      type: classifyType(r.type),
      risk: classifyRisk(r.risk),
      riskRecommended: classifyRisk(r.risk_recommended ?? r.riskRecommended ?? r.risk),
      threats: pickStringArrayFromObjects(r.threats, 'threat'),
      feeds: pickStringArrayFromObjects(r.feeds, 'feed'),
      firstSeen: parseTimestamp(r.firstseen ?? r.first_seen ?? r.added),
      lastSeen: parseTimestamp(r.lastseen ?? r.last_seen ?? r.updated),
    });
  }
  return out;
}

const RISK_HEX: Record<PulsediveRisk, string> = {
  none: '#4caf50',
  unknown: '#9e9e9e',
  low: '#8bc34a',
  medium: '#ffeb3b',
  high: '#ff9800',
  critical: '#ff453a',
};

export function riskColor(risk: PulsediveRisk): string {
  return RISK_HEX[risk];
}

/** Compare two risks; positive when `a` is more severe than `b`. */
export function compareRisk(a: PulsediveRisk, b: PulsediveRisk): number {
  return RISK_ORDER[a] - RISK_ORDER[b];
}

export interface PulsediveStats {
  total: number;
  byRisk: Record<PulsediveRisk, number>;
  byType: Record<PulsediveType, number>;
  topThreats: { threat: string; count: number }[];
  topFeeds: { feed: string; count: number }[];
  latestSeen: number | null;
}

const EMPTY_RISK_COUNTS: () => Record<PulsediveRisk, number> = () => ({
  none: 0, low: 0, medium: 0, high: 0, critical: 0, unknown: 0,
});
const EMPTY_TYPE_COUNTS: () => Record<PulsediveType, number> = () => ({
  ip: 0, ipv6: 0, domain: 0, url: 0, hash: 0, email: 0, unknown: 0,
});

export function summarisePulsedive(indicators: readonly PulsediveIndicator[]): PulsediveStats {
  const stats: PulsediveStats = {
    total: indicators.length,
    byRisk: EMPTY_RISK_COUNTS(),
    byType: EMPTY_TYPE_COUNTS(),
    topThreats: [],
    topFeeds: [],
    latestSeen: null,
  };
  const threats = new Map<string, number>();
  const feeds = new Map<string, number>();
  for (const ind of indicators) {
    stats.byRisk[ind.risk] += 1;
    stats.byType[ind.type] += 1;
    for (const t of ind.threats) threats.set(t, (threats.get(t) ?? 0) + 1);
    for (const f of ind.feeds) feeds.set(f, (feeds.get(f) ?? 0) + 1);
    if (ind.lastSeen !== null && (stats.latestSeen === null || ind.lastSeen > stats.latestSeen)) {
      stats.latestSeen = ind.lastSeen;
    }
  }
  stats.topThreats = [...threats.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([threat, count]) => ({ threat, count }));
  stats.topFeeds = [...feeds.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([feed, count]) => ({ feed, count }));
  return stats;
}
