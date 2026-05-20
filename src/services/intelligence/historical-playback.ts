/**
 * HistoricalPlaybackService — stores world-state snapshots over time so
 * the UI can scrub back to any past moment.
 *
 * Each `captureSnapshot()` call appends a `WorldSnapshot` carrying the
 * per-domain severity + event count, plus aggregate situation and alert
 * counts. The store stays in capture order (which is monotonic in
 * `capturedAt` under the injected clock), enabling `getNearest()` to do a
 * binary search rather than scan every entry.
 *
 * Pure deterministic — no DOM, no fetch. Persists to localStorage under
 * `wm-historical-playback`, ring-buffered at `MAX_SNAPSHOTS = 2000`,
 * evicting the oldest first. Injectable storage + clock throughout.
 */

// ── Public types ──────────────────────────────────────────────────────

export interface DomainState {
  domain: string;
  severity: number;
  eventCount: number;
}

export interface WorldSnapshot {
  id: string;
  capturedAt: number;
  domainStates: DomainState[];
  situationCount: number;
  activeAlerts: number;
  notes?: string;
}

export interface TimelineEntry {
  timestamp: number;
  id: string;
  severity: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface HistoricalPlaybackOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-historical-playback';
export const MAX_SNAPSHOTS = 2000;

// ── Storage helper ────────────────────────────────────────────────────

function safeStorage(injected?: StorageLike | null): StorageLike | null {
  if (injected !== undefined) return injected;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function cloneDomainStates(states: DomainState[]): DomainState[] {
  return states.map((s) => ({ domain: s.domain, severity: s.severity, eventCount: s.eventCount }));
}

function cloneSnapshot(snap: WorldSnapshot): WorldSnapshot {
  const out: WorldSnapshot = {
    id: snap.id,
    capturedAt: snap.capturedAt,
    domainStates: cloneDomainStates(snap.domainStates),
    situationCount: snap.situationCount,
    activeAlerts: snap.activeAlerts,
  };
  if (snap.notes !== undefined) out.notes = snap.notes;
  return out;
}

function maxSeverity(states: DomainState[]): number {
  let max = 0;
  for (const s of states) {
    if (typeof s?.severity === 'number' && s.severity > max) max = s.severity;
  }
  return max;
}

// ── Service ───────────────────────────────────────────────────────────

export class HistoricalPlaybackService {
  private static _singleton: HistoricalPlaybackService | null = null;
  private snapshots: WorldSnapshot[] = [];
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private idCounter = 0;

  constructor(options: HistoricalPlaybackOptions = {}) {
    this.storage = safeStorage(options.storage);
    this.clock = options.clock ?? Date.now;
    this.hydrate();
  }

  static getInstance(): HistoricalPlaybackService {
    HistoricalPlaybackService._singleton ??= new HistoricalPlaybackService();
    return HistoricalPlaybackService._singleton;
  }

  static _resetForTests(): void {
    HistoricalPlaybackService._singleton = null;
  }

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Append a new snapshot stamped with the injected clock. The supplied
   * `domainStates` array is cloned defensively so the caller's mutations
   * after the call don't bleed into stored history.
   *
   * Returns the stored snapshot (a fresh copy).
   */
  captureSnapshot(
    domainStates: DomainState[],
    situationCount: number,
    activeAlerts: number,
    notes?: string,
  ): WorldSnapshot {
    this.idCounter += 1;
    const capturedAt = this.clock();
    const snap: WorldSnapshot = {
      id: `hps-${capturedAt.toString(36)}-${this.idCounter}`,
      capturedAt,
      domainStates: cloneDomainStates(domainStates),
      situationCount,
      activeAlerts,
    };
    if (notes !== undefined) snap.notes = notes;

    this.snapshots.push(snap);
    while (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
    this.persist();

    return cloneSnapshot(snap);
  }

  getSnapshot(id: string): WorldSnapshot | undefined {
    const found = this.snapshots.find((s) => s.id === id);
    return found ? cloneSnapshot(found) : undefined;
  }

  /**
   * All snapshots whose `capturedAt` falls inside `[startMs, endMs]`
   * (inclusive on both ends). Result is sorted ascending by `capturedAt`.
   */
  getSnapshotsInRange(startMs: number, endMs: number): WorldSnapshot[] {
    if (endMs < startMs) return [];
    return this.snapshots
      .filter((s) => s.capturedAt >= startMs && s.capturedAt <= endMs)
      .sort((a, b) => a.capturedAt - b.capturedAt)
      .map((s) => cloneSnapshot(s));
  }

  /**
   * Binary-search the nearest snapshot to `timestamp` by `capturedAt`.
   * Snapshots are stored in capture order (monotonic timestamps under
   * the injected clock), so the lookup is O(log n) — important once the
   * timeline grows to thousands of entries.
   *
   * Ties (equidistant snapshots) resolve to the earlier one for
   * deterministic scrub behaviour.
   */
  getNearest(timestamp: number): WorldSnapshot | undefined {
    const arr = this.snapshots;
    if (arr.length === 0) return undefined;
    const first = arr[0]!;
    const last = arr[arr.length - 1]!;
    if (timestamp <= first.capturedAt) return cloneSnapshot(first);
    if (timestamp >= last.capturedAt) return cloneSnapshot(last);

    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid]!.capturedAt <= timestamp) lo = mid;
      else hi = mid;
    }
    const before = arr[lo]!;
    const after = arr[hi]!;
    const beforeDelta = timestamp - before.capturedAt;
    const afterDelta = after.capturedAt - timestamp;
    return cloneSnapshot(beforeDelta <= afterDelta ? before : after);
  }

  /**
   * Lightweight timeline view. Each entry carries only what a scrubber
   * UI needs: the snapshot's id, its capture time, and its peak
   * severity across domains. Sorted ascending by timestamp.
   */
  getTimeline(): TimelineEntry[] {
    return this.snapshots
      .map((s) => ({ timestamp: s.capturedAt, id: s.id, severity: maxSeverity(s.domainStates) }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Same shape as `getSnapshotsInRange` — explicitly named for export/replay callers. */
  exportRange(startMs: number, endMs: number): WorldSnapshot[] {
    return this.getSnapshotsInRange(startMs, endMs);
  }

  /** Clear all snapshots + storage (test seam). */
  resetForTesting(): void {
    this.snapshots = [];
    this.idCounter = 0;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ──────────────────────────────────────────────────────

  private hydrate(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: WorldSnapshot[] | null;
    try { parsed = JSON.parse(raw) as WorldSnapshot[] | null; } catch { return; }
    if (!Array.isArray(parsed)) return;

    for (const entry of parsed) {
      if (!entry || typeof entry.id !== 'string') continue;
      if (typeof entry.capturedAt !== 'number') continue;
      if (!Array.isArray(entry.domainStates)) continue;
      this.snapshots.push(cloneSnapshot(entry));
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.snapshots));
    } catch { /* best effort */ }
  }
}

// ── Convenience accessor ──────────────────────────────────────────────

export function getHistoricalPlaybackService(): HistoricalPlaybackService {
  return HistoricalPlaybackService.getInstance();
}

export const __internals = {
  STORAGE_KEY,
  MAX_SNAPSHOTS,
};
