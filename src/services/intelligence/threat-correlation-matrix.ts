/**
 * Threat Correlation Matrix — tracks which domain pairs are co-elevated
 * (both running HIGH/CRITICAL situations) over time. The score is the
 * fraction of observation windows in which both members of the pair
 * were active simultaneously, so a pair that's always co-elevated
 * trends toward 1.0 and a pair that's never co-elevated stays at 0.
 *
 * Pure store: injectable Storage + clock. Cells persist in a 1000-record
 * ring buffer under `wm-threat-matrix-cells`; the window count lives in
 * `wm-threat-matrix-windows`. Eight known domains are seeded on first
 * use; new pairs auto-register on `recordCoElevation`.
 */

// ── Public types ─────────────────────────────────────────────────────────

export type CorrelationTrend = 'rising' | 'stable' | 'falling';

export interface CorrelationCell {
  domainA: string;
  domainB: string;
  correlationScore: number;
  coElevatedCount: number;
  lastUpdatedAt: number;
  trend: CorrelationTrend;
}

export interface MatrixSnapshot {
  domains: string[];
  cells: CorrelationCell[];
  hotPairs: { domainA: string; domainB: string; score: number }[];
  snapshotAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ThreatCorrelationMatrixOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

export interface ThreatCorrelationMatrix {
  recordCoElevation(domainA: string, domainB: string): void;
  recordWindow(): void;
  getCell(domainA: string, domainB: string): CorrelationCell | null;
  getSnapshot(): MatrixSnapshot;
  getHotPairs(threshold?: number): CorrelationCell[];
  getDomains(): string[];
  subscribe(cb: (snapshot: MatrixSnapshot) => void): void;
  unsubscribe(cb: (snapshot: MatrixSnapshot) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────────

export const CELLS_STORAGE_KEY = 'wm-threat-matrix-cells';
export const WINDOWS_STORAGE_KEY = 'wm-threat-matrix-windows';
export const MAX_CELLS = 1000;
export const TREND_DELTA = 0.05;
export const HOT_PAIR_THRESHOLD = 0.3;
export const TREND_LOOKBACK_MS = 60 * 60 * 1000;
const HOT_PAIR_SNAPSHOT_FLOOR = 0.5;

export const BUILT_IN_DOMAINS: readonly string[] = [
  'earthquake',
  'weather',
  'wildfire',
  'biosurv',
  'maritime',
  'aviation',
  'cyber',
  'geopolitical',
];

interface StoredCell extends CorrelationCell {
  /** Score-history samples for trend lookup: [{ at, score }]. */
  history: { at: number; score: number }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function deserializeCell(raw: unknown): StoredCell | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.domainA !== 'string' || typeof r.domainB !== 'string') return null;
  if (typeof r.coElevatedCount !== 'number') return null;
  if (typeof r.correlationScore !== 'number') return null;
  if (typeof r.lastUpdatedAt !== 'number') return null;
  const trend = r.trend === 'rising' || r.trend === 'falling' ? r.trend : 'stable';
  const history = Array.isArray(r.history)
    ? r.history.filter((h): h is { at: number; score: number } =>
        !!h && typeof h === 'object' &&
        typeof (h as Record<string, unknown>).at === 'number' &&
        typeof (h as Record<string, unknown>).score === 'number',
      )
    : [];
  return {
    domainA: r.domainA,
    domainB: r.domainB,
    coElevatedCount: r.coElevatedCount,
    correlationScore: r.correlationScore,
    lastUpdatedAt: r.lastUpdatedAt,
    trend,
    history,
  };
}

function rehydrateCells(storage: StorageLike | null): Map<string, StoredCell> {
  const map = new Map<string, StoredCell>();
  if (!storage) return map;
  let raw: string | null;
  try { raw = storage.getItem(CELLS_STORAGE_KEY); } catch { return map; }
  if (!raw) return map;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return map; }
  if (!Array.isArray(parsed)) return map;
  for (const p of parsed) {
    const d = deserializeCell(p);
    if (d) map.set(pairKey(d.domainA, d.domainB), d);
  }
  return map;
}

function rehydrateWindowCount(storage: StorageLike | null): number {
  if (!storage) return 0;
  try {
    const raw = storage.getItem(WINDOWS_STORAGE_KEY);
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch { return 0; }
}

function trendFor(cell: StoredCell, nowMs: number): CorrelationTrend {
  const cutoff = nowMs - TREND_LOOKBACK_MS;
  let priorScore: number | null = null;
  for (const sample of cell.history) {
    if (sample.at <= cutoff) priorScore = sample.score;
    else break;
  }
  if (priorScore === null) return 'stable';
  const delta = cell.correlationScore - priorScore;
  if (delta > TREND_DELTA) return 'rising';
  if (delta < -TREND_DELTA) return 'falling';
  return 'stable';
}

function pushHistory(cell: StoredCell, nowMs: number): void {
  cell.history.push({ at: nowMs, score: cell.correlationScore });
  if (cell.history.length <= 50) return;
  // Preserve the most-recent pre-cutoff sample (the trend anchor) when
  // capping, so a long run of new pushes doesn't silently evict the
  // baseline used for rising/falling detection.
  const cutoff = nowMs - TREND_LOOKBACK_MS;
  let anchorIdx = -1;
  for (let i = cell.history.length - 1; i >= 0; i--) {
    const sample = cell.history[i];
    if (sample && sample.at <= cutoff) { anchorIdx = i; break; }
  }
  if (anchorIdx >= 0) {
    const anchor = cell.history[anchorIdx];
    const recent = cell.history.slice(-49);
    cell.history = anchor ? [anchor, ...recent] : recent;
  } else {
    cell.history = cell.history.slice(-50);
  }
}

function publicCell(cell: StoredCell): CorrelationCell {
  return {
    domainA: cell.domainA,
    domainB: cell.domainB,
    correlationScore: cell.correlationScore,
    coElevatedCount: cell.coElevatedCount,
    lastUpdatedAt: cell.lastUpdatedAt,
    trend: cell.trend,
  };
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createThreatCorrelationMatrix(
  options: ThreatCorrelationMatrixOptions = {},
): ThreatCorrelationMatrix {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const cells = rehydrateCells(storage);
  let totalWindows = rehydrateWindowCount(storage);
  const knownDomains = new Set<string>(BUILT_IN_DOMAINS);
  for (const c of cells.values()) {
    knownDomains.add(c.domainA);
    knownDomains.add(c.domainB);
  }
  const listeners = new Set<(snapshot: MatrixSnapshot) => void>();

  function persistCells(): void {
    if (!storage) return;
    try {
      const payload = [...cells.values()];
      storage.setItem(CELLS_STORAGE_KEY, JSON.stringify(payload));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function persistWindows(): void {
    if (!storage) return;
    try { storage.setItem(WINDOWS_STORAGE_KEY, String(totalWindows)); }
    catch { /* non-critical */ }
  }

  function capCells(): void {
    if (cells.size <= MAX_CELLS) return;
    // Evict oldest-updated entries first.
    const sorted = [...cells.entries()].sort(
      ([, a], [, b]) => a.lastUpdatedAt - b.lastUpdatedAt,
    );
    const drop = cells.size - MAX_CELLS;
    for (let i = 0; i < drop; i++) {
      const entry = sorted[i];
      if (entry) cells.delete(entry[0]);
    }
  }

  function score(coCount: number): number {
    const denom = Math.max(totalWindows, 1);
    return Math.min(1, coCount / denom);
  }

  function refreshAllScores(nowMs: number): void {
    for (const cell of cells.values()) {
      cell.correlationScore = score(cell.coElevatedCount);
      pushHistory(cell, nowMs);
      cell.trend = trendFor(cell, nowMs);
    }
  }

  function notify(): void {
    if (listeners.size === 0) return;
    const snap = buildSnapshot();
    for (const cb of listeners) {
      try { cb(snap); } catch { /* listener crash isolation */ }
    }
  }

  function buildSnapshot(): MatrixSnapshot {
    const nowMs = clock();
    const cellList: CorrelationCell[] = [];
    for (const c of cells.values()) cellList.push(publicCell(c));
    const hotPairs = cellList
      .filter((c) => c.correlationScore >= HOT_PAIR_SNAPSHOT_FLOOR)
      .map((c) => ({ domainA: c.domainA, domainB: c.domainB, score: c.correlationScore }))
      .sort((a, b) => b.score - a.score);
    return {
      domains: [...knownDomains].sort((a, b) => a.localeCompare(b)),
      cells: cellList,
      hotPairs,
      snapshotAt: nowMs,
    };
  }

  return {
    recordCoElevation(domainA, domainB): void {
      if (domainA === domainB) return;
      knownDomains.add(domainA);
      knownDomains.add(domainB);
      const [a, b] = orderedPair(domainA, domainB);
      const key = pairKey(a, b);
      const nowMs = clock();
      let cell = cells.get(key);
      if (!cell) {
        cell = {
          domainA: a,
          domainB: b,
          coElevatedCount: 0,
          correlationScore: 0,
          lastUpdatedAt: nowMs,
          trend: 'stable',
          history: [],
        };
        cells.set(key, cell);
      }
      cell.coElevatedCount += 1;
      cell.correlationScore = score(cell.coElevatedCount);
      cell.lastUpdatedAt = nowMs;
      pushHistory(cell, nowMs);
      cell.trend = trendFor(cell, nowMs);
      capCells();
      persistCells();
      notify();
    },

    recordWindow(): void {
      totalWindows += 1;
      const nowMs = clock();
      refreshAllScores(nowMs);
      persistCells();
      persistWindows();
      notify();
    },

    getCell(domainA, domainB): CorrelationCell | null {
      if (domainA === domainB) return null;
      const cell = cells.get(pairKey(domainA, domainB));
      return cell ? publicCell(cell) : null;
    },

    getSnapshot(): MatrixSnapshot {
      return buildSnapshot();
    },

    getHotPairs(threshold = HOT_PAIR_THRESHOLD): CorrelationCell[] {
      const out: CorrelationCell[] = [];
      for (const c of cells.values()) {
        if (c.correlationScore >= threshold) out.push(publicCell(c));
      }
      out.sort((a, b) => b.correlationScore - a.correlationScore);
      return out;
    },

    getDomains(): string[] {
      return [...knownDomains].sort((a, b) => a.localeCompare(b));
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

let _singleton: ThreatCorrelationMatrix | null = null;

export function getThreatCorrelationMatrix(): ThreatCorrelationMatrix {
  _singleton ??= createThreatCorrelationMatrix();
  return _singleton;
}

export function resetThreatCorrelationMatrixForTests(): void {
  _singleton = null;
}
