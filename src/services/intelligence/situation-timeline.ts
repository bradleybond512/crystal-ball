/**
 * Situation Timeline — Phase 4 chronological view.
 *
 * Reads from SituationStoreV2 and produces a chronological timeline of
 * situations with start / peak / resolved annotations plus domain +
 * severity rollups. The store holds the canonical situation state; this
 * service is a read model that adds derived fields (peak severity from
 * underlying observations, ongoing-duration, correlation count) and a
 * filter API the panel can drive.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Caches the
 * most-recent built timeline (up to 500 entries) under
 * `wm-situation-timeline` so the first paint after launch is non-empty
 * even before the store has rebuilt from observations.
 */

import {
  getSituationStoreV2,
  type Situation,
  type SituationSeverity,
} from './situation-store-v2';

// ── Public types ──────────────────────────────────────────────────────

export interface TimelineEntry {
  situationId: string;
  title: string;
  domain: string;
  startedAt: number;
  /** Timestamp of the highest-severity observation in the situation,
   *  or null when the situation has no observations. */
  peakAt: number | null;
  resolvedAt: number | null;
  /** Highest severity ever observed across the situation's observations
   *  (or the situation's own severity if it has no observations). */
  peakSeverity: SituationSeverity;
  currentSeverity: SituationSeverity;
  /** ms; null when the situation has no usable startedAt. */
  duration: number | null;
  status: 'active' | 'resolved';
  correlationCount: number;
}

export interface TimelineFilter {
  domain?: string;
  status?: 'active' | 'resolved' | 'all';
  fromDate?: number;
  toDate?: number;
  minSeverity?: SituationSeverity;
}

export interface TimelineStats {
  totalSituations: number;
  activeCount: number;
  avgDurationHours: number;
  longestActiveSituation: TimelineEntry | null;
  mostActiveDomain: string | null;
}

export interface DomainBreakdownRow {
  domain: string;
  count: number;
  /** Mean severity-ladder index (0 low → 3 critical). */
  avgSeverity: number;
}

export type TimelineListener = (entries: TimelineEntry[]) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-situation-timeline';
const MAX_ENTRIES = 500;

const SEVERITY_RANK: Record<SituationSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const SEVERITY_BY_RANK: SituationSeverity[] = ['low', 'medium', 'high', 'critical'];

const OBS_SEVERITY_TO_SITUATION: Record<string, SituationSeverity> = {
  INFO: 'low',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

// ── Helpers ──────────────────────────────────────────────────────────

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function severityRank(severity: SituationSeverity): number {
  return SEVERITY_RANK[severity] ?? 0;
}

function mapObservationSeverity(raw: string): SituationSeverity {
  return OBS_SEVERITY_TO_SITUATION[raw] ?? 'low';
}

function peakOf(situation: Situation): { ts: number | null; severity: SituationSeverity } {
  if (situation.observations.length === 0) {
    return { ts: null, severity: situation.severity };
  }
  let bestRank = -1;
  let bestTs = situation.observations[0]!.timestamp;
  let bestSeverity: SituationSeverity = situation.severity;
  for (const obs of situation.observations) {
    const sev = mapObservationSeverity(obs.severity);
    const rank = severityRank(sev);
    if (rank > bestRank) {
      bestRank = rank;
      bestTs = obs.timestamp;
      bestSeverity = sev;
    }
  }
  return { ts: bestTs, severity: bestSeverity };
}

function timelineEntryFor(situation: Situation, now: number): TimelineEntry {
  const startedAt = situation.startedAt.getTime();
  const resolvedAt = situation.resolvedAt ? situation.resolvedAt.getTime() : null;
  const peak = peakOf(situation);
  const isResolved = situation.status === 'resolved';
  const status: TimelineEntry['status'] = isResolved ? 'resolved' : 'active';
  // Ongoing situations carry "duration so far" against the clock; resolved
  // ones use the explicit resolvedAt. Defensive guard for nonsensical
  // negative startedAt timestamps.
  const endAt = resolvedAt ?? now;
  const duration = Number.isFinite(startedAt) ? Math.max(0, endAt - startedAt) : null;
  return {
    situationId: situation.id,
    title: situation.name,
    domain: situation.domain,
    startedAt,
    peakAt: peak.ts,
    resolvedAt,
    peakSeverity: peak.severity,
    currentSeverity: situation.severity,
    duration,
    status,
    correlationCount: situation.edges.length,
  };
}

function matchesFilter(entry: TimelineEntry, filter?: TimelineFilter): boolean {
  if (!filter) return true;
  if (filter.domain && entry.domain !== filter.domain) return false;
  if (filter.status && filter.status !== 'all' && entry.status !== filter.status) return false;
  if (filter.fromDate !== undefined && entry.startedAt < filter.fromDate) return false;
  if (filter.toDate !== undefined && entry.startedAt > filter.toDate) return false;
  if (filter.minSeverity !== undefined && severityRank(entry.currentSeverity) < severityRank(filter.minSeverity)) return false;
  return true;
}

// ── Service ───────────────────────────────────────────────────────────

export interface SituationTimelineOptions {
  clock?: () => number;
  /** Override the situation source — used by tests. */
  source?: () => readonly Situation[];
}

export class SituationTimelineService {
  private cache: TimelineEntry[] = [];
  private listeners = new Set<TimelineListener>();
  private hydrated = false;
  private clock: () => number;
  private readSituations: () => readonly Situation[];
  private unsubStore: (() => void) | null = null;

  constructor(options: SituationTimelineOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.readSituations = options.source ?? (() => getSituationStoreV2().list());
    // Forward store updates so the panel doesn't have to know about
    // two singletons. Only wired when using the production source.
    if (!options.source) {
      try {
        this.unsubStore = getSituationStoreV2().subscribe(() => {
          // Coalesce a burst of store notifies (e.g. the boot data-load ingests
          // every feed's observations) into ONE rebuild on the next macrotask,
          // instead of a full O(situations) rebuild + fan-out per notify.
          this.scheduleRebuild();
        });
      } catch {
        // Store unavailable at import — fine. Hydrate-on-demand.
      }
    }
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const store = safeStorage();
    if (!store) return;
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      this.cache = deserialize(parsed);
    } catch {
      // Corrupt blob — start clean.
    }
  }

  // Coalesces a burst of mutations into one JSON.stringify write on the next
  // microtask (in-memory state stays synchronous); fixes the renderer-hang
  // stringify storm.
  private persistScheduled = false;
  private schedulePersist(): void {
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    queueMicrotask(() => { this.persistScheduled = false; this.persist(); });
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(this.cache));
    } catch {
      // Quota or disabled — best-effort.
    }
  }

  private notify(): void {
    const snapshot = this.cache.map((e) => ({ ...e }));
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  private rebuildScheduled = false;
  /** Coalesce a burst of store notifies into ONE buildTimeline on the next
   *  microtask (in-memory cache stays fresh for cache reads). */
  private scheduleRebuild(): void {
    if (this.rebuildScheduled) return;
    this.rebuildScheduled = true;
    if (typeof queueMicrotask === 'function') queueMicrotask(() => this.flushRebuild());
    else this.flushRebuild();
  }

  private flushRebuild(): void {
    this.rebuildScheduled = false;
    this.buildTimeline();
  }

  /** Build a fresh timeline from the situation source, apply the
   *  optional filter, sort by startedAt DESC, cache up to MAX_ENTRIES,
   *  and notify subscribers. */
  buildTimeline(filter?: TimelineFilter): TimelineEntry[] {
    this.ensureHydrated();
    const p = (typeof performance !== 'undefined') && performance.now() < 180_000;
    const t0 = p ? performance.now() : 0;
    const now = this.clock();
    const situations = this.readSituations();
    const t1 = p ? performance.now() : 0;
    const built: TimelineEntry[] = [];
    for (const s of situations) built.push(timelineEntryFor(s, now));
    built.sort((a, b) => b.startedAt - a.startedAt);
    // The cache always holds the un-filtered, sorted list so subsequent
    // `getStats` / `getDomainBreakdown` calls see the full picture even
    // if the caller asked for a narrow filter slice.
    this.cache = built.slice(0, MAX_ENTRIES).map((e) => ({ ...e }));
    const t2 = p ? performance.now() : 0;
    this.schedulePersist();
    this.notify();
    if (p) {
      const t3 = performance.now();
      if (t3 - t0 >= 300) {
        // eslint-disable-next-line no-console
        console.warn(`[TIMELINE-PHASE] buildTimeline ${Math.round(t3 - t0)}ms (read ${Math.round(t1 - t0)}ms, entries ${Math.round(t2 - t1)}ms, notify ${Math.round(t3 - t2)}ms; n=${situations.length})`);
      }
    }
    return built.filter((e) => matchesFilter(e, filter)).map((e) => ({ ...e }));
  }

  /** Stats over the most-recently-built timeline. Returns zeros when
   *  the cache is empty. */
  getStats(): TimelineStats {
    this.ensureHydrated();
    const total = this.cache.length;
    if (total === 0) {
      return {
        totalSituations: 0,
        activeCount: 0,
        avgDurationHours: 0,
        longestActiveSituation: null,
        mostActiveDomain: null,
      };
    }
    let activeCount = 0;
    let totalDurationMs = 0;
    let withDuration = 0;
    let longestActive: TimelineEntry | null = null;
    const domainCounts = new Map<string, number>();
    for (const entry of this.cache) {
      if (entry.status === 'active') activeCount += 1;
      if (entry.duration !== null) {
        totalDurationMs += entry.duration;
        withDuration += 1;
      }
      if (entry.status === 'active' && entry.duration !== null && (!longestActive || entry.duration > (longestActive.duration ?? 0))) {
          longestActive = entry;
        }
      domainCounts.set(entry.domain, (domainCounts.get(entry.domain) ?? 0) + 1);
    }
    const avgDurationHours = withDuration === 0
      ? 0
      : +((totalDurationMs / withDuration) / 3_600_000).toFixed(2);
    const mostActiveDomain = pickMostActiveDomain(domainCounts);
    return {
      totalSituations: total,
      activeCount,
      avgDurationHours,
      longestActiveSituation: longestActive ? { ...longestActive } : null,
      mostActiveDomain,
    };
  }

  /** One row per domain with count + mean severity-ladder index, sorted
   *  by count DESC then domain ASC. */
  getDomainBreakdown(): DomainBreakdownRow[] {
    this.ensureHydrated();
    const buckets = new Map<string, { count: number; sevSum: number }>();
    for (const entry of this.cache) {
      const cur = buckets.get(entry.domain) ?? { count: 0, sevSum: 0 };
      cur.count += 1;
      cur.sevSum += severityRank(entry.currentSeverity);
      buckets.set(entry.domain, cur);
    }
    const out: DomainBreakdownRow[] = [];
    for (const [domain, { count, sevSum }] of buckets) {
      out.push({ domain, count, avgSeverity: +(sevSum / count).toFixed(2) });
    }
    out.sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
    return out;
  }

  /** Most-recently-built cache (un-filtered). */
  getCache(): TimelineEntry[] {
    this.ensureHydrated();
    return this.cache.map((e) => ({ ...e }));
  }

  /**
   * Read the current cache with a filter applied — WITHOUT rebuilding or
   * notifying. Renderers must use this (not buildTimeline) on every repaint:
   * buildTimeline re-runs the full O(situations) build AND fans out to
   * listeners, so a subscriber that called buildTimeline in its own render
   * re-entered the build on every store notify (the settle-tail storm).
   */
  getFiltered(filter?: TimelineFilter): TimelineEntry[] {
    this.ensureHydrated();
    return this.cache.filter((e) => matchesFilter(e, filter)).map((e) => ({ ...e }));
  }

  subscribe(listener: TimelineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties cache + drops listeners + clears storage. */
  resetForTesting(): void {
    this.cache = [];
    this.listeners.clear();
    this.hydrated = true;
    if (this.unsubStore) {
      try { this.unsubStore(); } catch { /* ignored */ }
      this.unsubStore = null;
    }
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* best effort */ }
    }
  }
}

function pickMostActiveDomain(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [domain, count] of counts) {
    if (count > bestCount || (count === bestCount && best && domain.localeCompare(best) < 0)) {
      best = domain;
      bestCount = count;
    }
  }
  return best;
}

// ── Persistence helpers ──────────────────────────────────────────────

function asValidEntry(entry: unknown): TimelineEntry | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as TimelineEntry;
  if (typeof e.situationId !== 'string' || typeof e.title !== 'string') return undefined;
  if (typeof e.domain !== 'string' || typeof e.startedAt !== 'number') return undefined;
  if (typeof e.peakSeverity !== 'string' || typeof e.currentSeverity !== 'string') return undefined;
  if (typeof e.correlationCount !== 'number') return undefined;
  if (e.status !== 'active' && e.status !== 'resolved') return undefined;
  return { ...e };
}

function deserialize(raw: unknown): TimelineEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: TimelineEntry[] = [];
  for (const entry of raw) {
    const valid = asValidEntry(entry);
    if (valid) out.push(valid);
  }
  return out;
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: SituationTimelineService | null = null;

export function getSituationTimelineService(): SituationTimelineService {
  _singleton ??= new SituationTimelineService();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetSituationTimelineSingleton(): void {
  _singleton = null;
}

export const __internals = {
  STORAGE_KEY,
  MAX_ENTRIES,
  SEVERITY_RANK,
  SEVERITY_BY_RANK,
  severityRank,
  peakOf,
  timelineEntryFor,
  matchesFilter,
};
