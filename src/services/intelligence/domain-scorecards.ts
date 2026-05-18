/**
 * Domain Scorecards — per-domain quality grades tracking five metrics
 * (accuracy, completeness, timeliness, signal-to-noise, coverage) over
 * time. The ImprovementScheduler's `update-domain-scorecards` task is
 * the upstream consumer.
 *
 * Pure store: injectable Storage + clock, no DOM / fetch. Snapshots
 * persist in a 5000-record ring buffer under
 * `wm-domain-scorecard-snapshots`. Eight built-in domains are seeded
 * with baseline 0.7 snapshots on first use; reseeding is idempotent.
 */

// ── Public types ─────────────────────────────────────────────────────────

export type ScorecardMetric =
  | 'accuracy'
  | 'completeness'
  | 'timeliness'
  | 'signal-to-noise'
  | 'coverage';

export type ScorecardGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export type ScorecardTrend = 'improving' | 'stable' | 'degrading';

export interface MetricSnapshot {
  metric: ScorecardMetric;
  value: number;
  recordedAt: number;
  source: string;
}

export interface DomainScorecard {
  domain: string;
  scores: Record<ScorecardMetric, number>;
  grades: Record<ScorecardMetric, ScorecardGrade>;
  overallScore: number;
  overallGrade: ScorecardGrade;
  lastUpdatedAt: number;
  trend: ScorecardTrend;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DomainScorecardServiceOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

export interface DomainScorecardService {
  recordMetric(domain: string, metric: ScorecardMetric, value: number, source: string): void;
  getScorecard(domain: string): DomainScorecard;
  getAllScorecards(): DomainScorecard[];
  getSnapshots(domain: string, metric?: ScorecardMetric, limit?: number): StoredSnapshot[];
  getTopDomains(n: number): DomainScorecard[];
  getWorstDomains(n: number): DomainScorecard[];
  subscribe(cb: (cards: DomainScorecard[]) => void): void;
  unsubscribe(cb: (cards: DomainScorecard[]) => void): void;
}

interface StoredSnapshot extends MetricSnapshot {
  domain: string;
}
export type { StoredSnapshot };

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-domain-scorecard-snapshots';
export const MAX_SNAPSHOTS = 5000;
export const BASELINE_VALUE = 0.7;
export const TREND_WINDOW = 5;
export const TREND_DELTA = 0.02;

export const BASELINE_DOMAINS: readonly string[] = [
  'earthquake',
  'biosurv',
  'weather',
  'maritime',
  'aviation',
  'geopolitical',
  'cyber',
  'wildfire',
];

export const GRADE_THRESHOLDS = {
  A: 0.9,
  B: 0.75,
  C: 0.6,
  D: 0.4,
} as const;

const ALL_METRICS: readonly ScorecardMetric[] = [
  'accuracy',
  'completeness',
  'timeliness',
  'signal-to-noise',
  'coverage',
];

// ── Helpers ──────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function gradeFor(score: number): ScorecardGrade {
  if (score >= GRADE_THRESHOLDS.A) return 'A';
  if (score >= GRADE_THRESHOLDS.B) return 'B';
  if (score >= GRADE_THRESHOLDS.C) return 'C';
  if (score >= GRADE_THRESHOLDS.D) return 'D';
  return 'F';
}

function emptyScores(value: number): Record<ScorecardMetric, number> {
  return {
    accuracy: value,
    completeness: value,
    timeliness: value,
    'signal-to-noise': value,
    coverage: value,
  };
}

function gradesFor(scores: Record<ScorecardMetric, number>): Record<ScorecardMetric, ScorecardGrade> {
  return {
    accuracy: gradeFor(scores.accuracy),
    completeness: gradeFor(scores.completeness),
    timeliness: gradeFor(scores.timeliness),
    'signal-to-noise': gradeFor(scores['signal-to-noise']),
    coverage: gradeFor(scores.coverage),
  };
}

function meanScore(scores: Record<ScorecardMetric, number>): number {
  let total = 0;
  for (const m of ALL_METRICS) total += scores[m];
  return total / ALL_METRICS.length;
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function isMetric(m: unknown): m is ScorecardMetric {
  return (
    m === 'accuracy' ||
    m === 'completeness' ||
    m === 'timeliness' ||
    m === 'signal-to-noise' ||
    m === 'coverage'
  );
}

function deserializeSnapshot(raw: unknown): StoredSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.domain !== 'string') return null;
  if (!isMetric(r.metric)) return null;
  if (typeof r.value !== 'number') return null;
  if (typeof r.recordedAt !== 'number') return null;
  return {
    domain: r.domain,
    metric: r.metric,
    value: clamp01(r.value),
    recordedAt: r.recordedAt,
    source: typeof r.source === 'string' ? r.source : 'unknown',
  };
}

function rehydrate(storage: StorageLike | null): StoredSnapshot[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: StoredSnapshot[] = [];
  for (const p of parsed) {
    const d = deserializeSnapshot(p);
    if (d) out.push(d);
  }
  return out;
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createDomainScorecardService(
  options: DomainScorecardServiceOptions = {},
): DomainScorecardService {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const snapshots: StoredSnapshot[] = rehydrate(storage);
  const listeners = new Set<(cards: DomainScorecard[]) => void>();

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function capRingBuffer(): void {
    if (snapshots.length > MAX_SNAPSHOTS) {
      snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
    }
  }

  function addSnapshot(s: StoredSnapshot): void {
    snapshots.push(s);
    capRingBuffer();
  }

  function seedBaselineIfNeeded(): void {
    if (snapshots.length > 0) return;
    const nowMs = clock();
    for (const domain of BASELINE_DOMAINS) {
      for (const metric of ALL_METRICS) {
        addSnapshot({ domain, metric, value: BASELINE_VALUE, recordedAt: nowMs, source: 'seed' });
      }
    }
    persist();
  }

  seedBaselineIfNeeded();

  function notify(): void {
    const cards = buildAllScorecards();
    for (const cb of listeners) {
      try { cb(cards); } catch { /* listener crash isolation */ }
    }
  }

  function snapshotsFor(domain: string): StoredSnapshot[] {
    return snapshots.filter((s) => s.domain === domain);
  }

  function latestScores(domain: string): Record<ScorecardMetric, number> | null {
    const found = snapshotsFor(domain);
    if (found.length === 0) return null;
    const out = emptyScores(0);
    const seenAt: Record<ScorecardMetric, number> = {
      accuracy: -1,
      completeness: -1,
      timeliness: -1,
      'signal-to-noise': -1,
      coverage: -1,
    };
    let anyFound = false;
    for (const s of found) {
      if (s.recordedAt >= seenAt[s.metric]) {
        out[s.metric] = s.value;
        seenAt[s.metric] = s.recordedAt;
        anyFound = true;
      }
    }
    if (!anyFound) return null;
    // Metrics that never recorded keep 0 — replace with baseline so
    // partial-data domains aren't unfairly punished. A domain seeded
    // through BASELINE_DOMAINS will always have all five.
    for (const m of ALL_METRICS) {
      if (seenAt[m] < 0) out[m] = BASELINE_VALUE;
    }
    return out;
  }

  function lastUpdatedFor(domain: string): number {
    let latest = 0;
    for (const s of snapshots) {
      if (s.domain === domain && s.recordedAt > latest) latest = s.recordedAt;
    }
    return latest;
  }

  function trendFor(domain: string): ScorecardTrend {
    const overallSeries = buildOverallSeries(domain);
    if (overallSeries.length < TREND_WINDOW * 2) return 'stable';
    const recent = overallSeries.slice(-TREND_WINDOW);
    const prior = overallSeries.slice(-TREND_WINDOW * 2, -TREND_WINDOW);
    const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const priorMean = prior.reduce((a, b) => a + b, 0) / prior.length;
    const delta = recentMean - priorMean;
    if (delta > TREND_DELTA) return 'improving';
    if (delta < -TREND_DELTA) return 'degrading';
    return 'stable';
  }

  function buildOverallSeries(domain: string): number[] {
    // Replay snapshots in chronological order, maintaining a running
    // per-metric latest. Group by unique recordedAt — each timestamp
    // (a "moment") yields one overall reading. This lets callers stage
    // multi-metric updates as one logical event for trend purposes.
    const ordered = [...snapshotsFor(domain)].sort((a, b) => a.recordedAt - b.recordedAt);
    if (ordered.length === 0) return [];
    const running: Record<ScorecardMetric, number> = emptyScores(BASELINE_VALUE);
    const byMoment = new Map<number, number>();
    for (const s of ordered) {
      running[s.metric] = s.value;
      byMoment.set(s.recordedAt, meanScore(running));
    }
    return [...byMoment.values()];
  }

  function knownDomains(): string[] {
    const set = new Set<string>();
    for (const s of snapshots) set.add(s.domain);
    return [...set];
  }

  function buildScorecard(domain: string): DomainScorecard {
    const scores = latestScores(domain) ?? emptyScores(0.5);
    const grades = gradesFor(scores);
    const overallScore = meanScore(scores);
    const overallGrade = gradeFor(overallScore);
    const lastUpdatedAt = lastUpdatedFor(domain);
    const trend = trendFor(domain);
    return { domain, scores, grades, overallScore, overallGrade, lastUpdatedAt, trend };
  }

  function buildAllScorecards(): DomainScorecard[] {
    return knownDomains()
      .map((d) => buildScorecard(d))
      .sort((a, b) => b.overallScore - a.overallScore);
  }

  return {
    recordMetric(domain, metric, value, source): void {
      addSnapshot({
        domain,
        metric,
        value: clamp01(value),
        recordedAt: clock(),
        source,
      });
      persist();
      notify();
    },

    getScorecard(domain): DomainScorecard {
      if (snapshotsFor(domain).length === 0) {
        const scores = emptyScores(0.5);
        const cGrades: Record<ScorecardMetric, ScorecardGrade> = {
          accuracy: 'C',
          completeness: 'C',
          timeliness: 'C',
          'signal-to-noise': 'C',
          coverage: 'C',
        };
        return {
          domain,
          scores,
          grades: cGrades,
          overallScore: 0.5,
          overallGrade: 'C',
          lastUpdatedAt: 0,
          trend: 'stable',
        };
      }
      return buildScorecard(domain);
    },

    getAllScorecards(): DomainScorecard[] {
      return buildAllScorecards();
    },

    getSnapshots(domain, metric, limit): StoredSnapshot[] {
      const out: StoredSnapshot[] = [];
      for (let i = snapshots.length - 1; i >= 0; i--) {
        const s = snapshots[i];
        if (s?.domain !== domain) continue;
        if (metric !== undefined && s.metric !== metric) continue;
        out.push({ ...s });
        if (limit !== undefined && out.length >= limit) break;
      }
      return out;
    },

    getTopDomains(n): DomainScorecard[] {
      return buildAllScorecards().slice(0, n);
    },

    getWorstDomains(n): DomainScorecard[] {
      return [...buildAllScorecards()]
        .sort((a, b) => a.overallScore - b.overallScore)
        .slice(0, n);
    },

    subscribe(cb): void {
      listeners.add(cb);
    },

    unsubscribe(cb): void {
      listeners.delete(cb);
    },
  };
}

// ── Singleton ────────────────────────────────────────────────────────────

let _singleton: DomainScorecardService | null = null;

export function getDomainScorecardService(): DomainScorecardService {
  _singleton ??= createDomainScorecardService();
  return _singleton;
}

export function resetDomainScorecardServiceForTests(): void {
  _singleton = null;
}
