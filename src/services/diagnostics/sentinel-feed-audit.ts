/**
 * Sentinel feed audit — pure deterministic remediation engine.
 *
 * The app polls dozens of feeds (NWS alerts, NWS observations, USGS
 * earthquakes, EIA inventories, GDACS, NOAA satellites, FEWS NET,
 * watchlist sources, …). When any of them go silent or fall behind
 * their expected refresh window, the user wants a short list of
 * "which feed is degraded, why does it matter, and what should I do".
 *
 * This module ingests a `FeedHealthSnapshot[]` (the shape any feed
 * health source can produce) and a `FeedSentinel[]` (declarative
 * metadata about expected refresh windows, fallbacks, and feature
 * exposure) and produces a `SentinelFeedAuditReport` the diagnostics
 * UI / export bundle can render.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 *
 * Plan invariants:
 *   - Every degraded feed gets a remediation string + fallback path
 *   - Safety-critical feeds (NWS alerts, watchlist providers) escalate
 *     to 'critical' at the report level
 *   - Output is JSON-serializable for the diagnostics export bundle
 */

// ── Public API ──────────────────────────────────────────────────────────

export type FeedHealthLevel = 'fresh' | 'stale' | 'late' | 'silent' | 'unknown';

export interface FeedHealthSnapshot {
  feedId: string;
  /** ms timestamp of the most recent successful poll. Undefined when
   *  never observed. */
  lastSuccessAt?: number;
  /** ms timestamp of the most recent failure. */
  lastFailureAt?: number;
  /** Free-text last-error message, if any. */
  lastError?: string;
}

export interface FeedSentinel {
  feedId: string;
  /** Display label. */
  label: string;
  /** Free-text purpose so the audit can answer "why does this matter?". */
  purpose: string;
  /** Expected refresh window. Past this without a success → 'stale'. */
  expectedRefreshMs: number;
  /** Hard ceiling. Past this → 'late'. */
  staleCeilingMs: number;
  /** Past this → 'silent'. */
  silentCeilingMs: number;
  /** Whether the feed is safety-critical (alerts, watchlist, …). */
  safetyCritical: boolean;
  /** Optional fallback feed id the app uses when this one is down. */
  fallbackFeedId?: string;
  /** Optional fallback strategy the audit reports when this feed is
   *  silent (e.g. "fallback to FEWS NET aggregate", "skip relevance
   *  check until backfill"). */
  fallbackStrategy?: string;
  /** Optional remediation hint — usually credentials, network, or
   *  upstream availability. */
  remediation?: string;
}

export interface FeedAuditEntry {
  feedId: string;
  label: string;
  purpose: string;
  level: FeedHealthLevel;
  /** Time since last success in ms. Undefined when never observed. */
  ageMs?: number;
  /** Most-recent error message. */
  lastError?: string;
  safetyCritical: boolean;
  reason: string;
  /** Concrete remediation hint. */
  remediation: string;
  fallback: string;
}

export type SentinelReportLevel = 'healthy' | 'degraded' | 'critical' | 'unknown';

export interface SentinelFeedAuditReport {
  generatedAt: number;
  level: SentinelReportLevel;
  /** All feed entries in registration order. */
  entries: readonly FeedAuditEntry[];
  /** Plain-English summary. */
  summary: string;
  /** Concrete next-action recommendations sorted by safety + level. */
  recommendations: readonly string[];
}

export interface AuditFeedsInput {
  generatedAt?: number;
  sentinels: readonly FeedSentinel[];
  snapshots: readonly FeedHealthSnapshot[];
}

export function auditFeeds(input: AuditFeedsInput): SentinelFeedAuditReport {
  const generatedAt = input.generatedAt ?? Date.now();
  const snapshotById = new Map<string, FeedHealthSnapshot>();
  for (const s of input.snapshots) snapshotById.set(s.feedId, s);
  const entries: FeedAuditEntry[] = [];
  for (const sentinel of input.sentinels) {
    entries.push(buildEntry(sentinel, snapshotById.get(sentinel.feedId), generatedAt));
  }
  return {
    generatedAt,
    level: rollUpLevel(entries),
    entries,
    summary: describeSummary(entries),
    recommendations: collectRecommendations(entries),
  };
}

// ── Per-feed audit ─────────────────────────────────────────────────────

function buildEntry(
  sentinel: FeedSentinel,
  snapshot: FeedHealthSnapshot | undefined,
  now: number,
): FeedAuditEntry {
  const lastSuccessAt = snapshot?.lastSuccessAt;
  const ageMs = lastSuccessAt === undefined ? undefined : now - lastSuccessAt;
  const level = decideLevel(sentinel, ageMs);
  const fallback = describeFallback(sentinel);
  const reason = describeFeedReason(level, ageMs, snapshot?.lastError);
  return {
    feedId: sentinel.feedId,
    label: sentinel.label,
    purpose: sentinel.purpose,
    level,
    ageMs,
    lastError: snapshot?.lastError,
    safetyCritical: sentinel.safetyCritical,
    reason,
    remediation: pickRemediation(level, sentinel),
    fallback,
  };
}

function describeFallback(sentinel: FeedSentinel): string {
  if (sentinel.fallbackFeedId) {
    if (sentinel.fallbackStrategy) {
      return `Fallback feed: ${sentinel.fallbackFeedId}. ${sentinel.fallbackStrategy}`;
    }
    return `Fallback feed: ${sentinel.fallbackFeedId}`;
  }
  return sentinel.fallbackStrategy ?? 'No fallback declared.';
}

function decideLevel(sentinel: FeedSentinel, ageMs: number | undefined): FeedHealthLevel {
  if (ageMs === undefined) return 'unknown';
  if (ageMs <= sentinel.expectedRefreshMs) return 'fresh';
  if (ageMs <= sentinel.staleCeilingMs) return 'stale';
  if (ageMs <= sentinel.silentCeilingMs) return 'late';
  return 'silent';
}

function describeFeedReason(
  level: FeedHealthLevel,
  ageMs: number | undefined,
  lastError: string | undefined,
): string {
  if (level === 'fresh') return 'Feed is fresh.';
  if (level === 'unknown') return 'No successful poll observed yet.';
  const ageNote = ageMs === undefined ? 'age unknown' : `last success ${formatAge(ageMs)} ago`;
  const errorNote = lastError ? ` Last error: ${lastError}` : '';
  switch (level) {
    case 'stale': {
      return `Feed past expected refresh window (${ageNote}).${errorNote}`;
    }
    case 'late': {
      return `Feed late (${ageNote}).${errorNote}`;
    }
    case 'silent': {
      return `Feed silent (${ageNote}).${errorNote}`;
    }
  }
}

function pickRemediation(level: FeedHealthLevel, sentinel: FeedSentinel): string {
  if (level === 'fresh' || level === 'unknown') return '';
  if (sentinel.remediation) return sentinel.remediation;
  return 'Check API key validity and upstream availability; restart the sidecar if the failure persists.';
}

// ── Roll-up ────────────────────────────────────────────────────────────

const LEVEL_SEVERITY: Record<FeedHealthLevel, number> = {
  fresh: 0,
  unknown: 1,
  stale: 2,
  late: 3,
  silent: 4,
};

function rollUpLevel(entries: readonly FeedAuditEntry[]): SentinelReportLevel {
  if (entries.length === 0) return 'unknown';
  // Any safety-critical feed late or silent → critical.
  for (const e of entries) {
    if (e.safetyCritical && (e.level === 'late' || e.level === 'silent')) {
      return 'critical';
    }
  }
  let worst: FeedHealthLevel = 'fresh';
  for (const e of entries) {
    if (LEVEL_SEVERITY[e.level] > LEVEL_SEVERITY[worst]) worst = e.level;
  }
  if (worst === 'silent' || worst === 'late') return 'critical';
  if (worst === 'stale' || worst === 'unknown') return 'degraded';
  return 'healthy';
}

function describeSummary(entries: readonly FeedAuditEntry[]): string {
  if (entries.length === 0) return 'No feeds configured.';
  const counts: Record<FeedHealthLevel, number> = {
    fresh: 0,
    stale: 0,
    late: 0,
    silent: 0,
    unknown: 0,
  };
  for (const e of entries) counts[e.level] += 1;
  if (counts.fresh === entries.length) {
    return `All ${entries.length} feeds fresh.`;
  }
  const parts: string[] = [];
  if (counts.silent) parts.push(`${counts.silent} silent`);
  if (counts.late) parts.push(`${counts.late} late`);
  if (counts.stale) parts.push(`${counts.stale} stale`);
  if (counts.unknown) parts.push(`${counts.unknown} unknown`);
  if (counts.fresh) parts.push(`${counts.fresh} fresh`);
  return `Feeds: ${parts.join(', ')}.`;
}

function collectRecommendations(entries: readonly FeedAuditEntry[]): readonly string[] {
  const out: string[] = [];
  const sorted = [...entries].sort((a, b) => {
    if (a.safetyCritical !== b.safetyCritical) return a.safetyCritical ? -1 : 1;
    return LEVEL_SEVERITY[b.level] - LEVEL_SEVERITY[a.level];
  });
  for (const e of sorted) {
    if (e.level === 'fresh' || e.level === 'unknown') continue;
    if (!e.remediation) continue;
    out.push(`${e.label}: ${e.remediation}`);
    if (out.length >= 8) break;
  }
  return out;
}

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 24 * 60 * 60_000) return `${(ms / (60 * 60_000)).toFixed(1)} h`;
  return `${(ms / (24 * 60 * 60_000)).toFixed(1)} d`;
}

// ── Default sentinel catalog ───────────────────────────────────────────

/** A starter catalog covering the eight feeds the plan flags as the
 *  most common sources of intelligence drift when they degrade. The
 *  host can swap in a different list — this is just a sane default. */
export function defaultFeedSentinels(): FeedSentinel[] {
  const minute = 60_000;
  const hour = 60 * minute;
  return [
    {
      feedId: 'nws-alerts',
      label: 'NWS alerts',
      purpose: 'Severe-weather warnings against saved places.',
      expectedRefreshMs: 5 * minute,
      staleCeilingMs: 15 * minute,
      silentCeilingMs: 60 * minute,
      safetyCritical: true,
      fallbackFeedId: 'noaa-radar',
      fallbackStrategy: 'Fall back to radar-only matching while alerts are silent.',
      remediation: 'Verify NWS provider key + sidecar reachability; this feed gates Storm Mode.',
    },
    {
      feedId: 'usgs-earthquakes',
      label: 'USGS earthquakes',
      purpose: 'Quake detection feeding the disaster posture.',
      expectedRefreshMs: 10 * minute,
      staleCeilingMs: 30 * minute,
      silentCeilingMs: 2 * hour,
      safetyCritical: true,
      remediation: 'USGS feed is open; if missing, the sidecar likely lost network. Restart the sidecar.',
    },
    {
      feedId: 'gdacs',
      label: 'GDACS disasters',
      purpose: 'Aggregated disaster severity (volcano, flood, drought).',
      expectedRefreshMs: 30 * minute,
      staleCeilingMs: 4 * hour,
      silentCeilingMs: 24 * hour,
      safetyCritical: true,
      remediation: 'Check the GDACS upstream feed availability page; falls back to manual status.',
    },
    {
      feedId: 'eia-inventories',
      label: 'EIA inventories',
      purpose: 'Energy stress + shortage forecast inputs.',
      expectedRefreshMs: 24 * hour,
      staleCeilingMs: 36 * hour,
      silentCeilingMs: 7 * 24 * hour,
      safetyCritical: false,
      remediation: 'EIA publishes weekly Wednesday; missing means API key issue.',
    },
    {
      feedId: 'fred',
      label: 'FRED economic data',
      purpose: 'Macro context for shortage + commodity scoring.',
      expectedRefreshMs: 24 * hour,
      staleCeilingMs: 3 * 24 * hour,
      silentCeilingMs: 14 * 24 * hour,
      safetyCritical: false,
      remediation: 'FRED needs an API key — confirm in Settings → API Keys.',
    },
    {
      feedId: 'fews-net',
      label: 'FEWS NET food security',
      purpose: 'Food shortage classifications (IPC stages).',
      expectedRefreshMs: 7 * 24 * hour,
      staleCeilingMs: 30 * 24 * hour,
      silentCeilingMs: 90 * 24 * hour,
      safetyCritical: false,
      remediation: 'FEWS NET updates are quarterly; long stale gaps are typical between releases.',
    },
    {
      feedId: 'adsbexchange',
      label: 'ADS-B Exchange',
      purpose: 'Live aircraft positions for travel + transport panels.',
      expectedRefreshMs: 60_000,
      staleCeilingMs: 5 * minute,
      silentCeilingMs: 30 * minute,
      safetyCritical: false,
      fallbackFeedId: 'opensky',
      fallbackStrategy: 'Falls back to OpenSky when ADS-B Exchange is silent.',
      remediation: 'Re-authenticate ADS-B Exchange in Settings → API Keys.',
    },
    {
      feedId: 'opensky',
      label: 'OpenSky Network',
      purpose: 'Backup ADS-B feed for travel + transport.',
      expectedRefreshMs: 2 * minute,
      staleCeilingMs: 10 * minute,
      silentCeilingMs: 60 * minute,
      safetyCritical: false,
      remediation: 'OpenSky is open; silence usually = upstream rate limit. Wait 10 minutes.',
    },
  ];
}
