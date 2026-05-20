// ── Types ─────────────────────────────────────────────────────────────
export type FeedStatus = 'ok' | 'stale' | 'error' | 'offline';

export interface FeedRecord {
  feedId: string;
  domain: string;
  lastSeenAt: number;
  latencyMs: number;
  errorCount: number;
  status: FeedStatus;
}

export interface ErrorLogEntry {
  feedId: string;
  domain: string;
  message: string;
  timestamp: number;
}

// ── Constants ─────────────────────────────────────────────────────────
export const STORAGE_KEY = 'wm-feed-health';
export const MAX_FEEDS = 200;
export const ERROR_LOG_CAP = 100;
export const STALE_WARN_MS = 15 * 60 * 1000;
export const STALE_CRIT_MS = 60 * 60 * 1000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface FeedHealthTrackerOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

interface PersistedState {
  records: FeedRecord[];
  errorLog: ErrorLogEntry[];
}

// ── Helpers ───────────────────────────────────────────────────────────
function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

// ── Class ─────────────────────────────────────────────────────────────
export class FeedHealthTracker {
  private static _instance: FeedHealthTracker | null = null;

  static getInstance(): FeedHealthTracker {
    FeedHealthTracker._instance ??= new FeedHealthTracker();
    return FeedHealthTracker._instance;
  }

  static _resetSingletonForTests(): void {
    FeedHealthTracker._instance = null;
  }

  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly records: Map<string, FeedRecord>;
  private readonly errorLog: ErrorLogEntry[];

  constructor(options: FeedHealthTrackerOptions = {}) {
    this.storage = resolveStorage(options.storage);
    this.clock = options.now ?? (() => Date.now());
    this.records = new Map();
    this.errorLog = [];
    this.hydrate();
  }

  recordSuccess(feedId: string, domain: string, latencyMs: number): void {
    const existing = this.records.get(feedId);
    const record: FeedRecord = existing
      ? { ...existing, domain, lastSeenAt: this.clock(), latencyMs, status: 'ok', errorCount: 0 }
      : { feedId, domain, lastSeenAt: this.clock(), latencyMs, errorCount: 0, status: 'ok' };
    this.records.set(feedId, record);
    this.enforceCap();
    this.persist();
  }

  recordError(feedId: string, domain: string, message: string): void {
    const existing = this.records.get(feedId);
    const record: FeedRecord = existing
      ? { ...existing, domain, errorCount: existing.errorCount + 1, status: 'error' }
      : { feedId, domain, lastSeenAt: 0, latencyMs: 0, errorCount: 1, status: 'error' };
    this.records.set(feedId, record);
    this.errorLog.push({ feedId, domain, message, timestamp: this.clock() });
    if (this.errorLog.length > ERROR_LOG_CAP) {
      this.errorLog.splice(0, this.errorLog.length - ERROR_LOG_CAP);
    }
    this.persist();
  }

  markOffline(feedId: string, domain: string): void {
    const existing = this.records.get(feedId);
    const record: FeedRecord = existing
      ? { ...existing, domain, status: 'offline' }
      : { feedId, domain, lastSeenAt: 0, latencyMs: 0, errorCount: 0, status: 'offline' };
    this.records.set(feedId, record);
    this.persist();
  }

  getAll(): FeedRecord[] {
    return [...this.records.values()].sort((a, b) => a.feedId.localeCompare(b.feedId));
  }

  getRecord(feedId: string): FeedRecord | undefined {
    return this.records.get(feedId);
  }

  getStaleFeedIds(thresholdMs: number, now?: number): string[] {
    const ts = now ?? this.clock();
    const result: string[] = [];
    for (const record of this.records.values()) {
      // error/offline feeds are handled separately — staleness applies only to feeds that last reported successfully
      if (record.status !== 'ok' && record.status !== 'stale') continue;
      if (ts - record.lastSeenAt > thresholdMs) result.push(record.feedId);
    }
    return result;
  }

  getHealthScore(): number {
    if (this.records.size === 0) return 100;
    let ok = 0;
    for (const record of this.records.values()) {
      if (record.status === 'ok') ok += 1;
    }
    return Math.round((ok / this.records.size) * 100);
  }

  getErrorLog(): ErrorLogEntry[] {
    return [...this.errorLog].reverse();
  }

  reset(): void {
    this.records.clear();
    this.errorLog.splice(0);
    this.persist();
  }

  private enforceCap(): void {
    if (this.records.size <= MAX_FEEDS) return;
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [key, record] of this.records) {
      if (record.lastSeenAt < oldestTime) {
        oldestTime = record.lastSeenAt;
        oldestKey = key;
      }
    }
    if (oldestKey) this.records.delete(oldestKey);
  }

  private persist(): void {
    if (!this.storage) return;
    const state: PersistedState = {
      records: [...this.records.values()],
      errorLog: [...this.errorLog],
    };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* best effort */ }
  }

  private hydrateRecords(records: unknown[]): void {
    const VALID_STATUSES = new Set<FeedStatus>(['ok', 'stale', 'error', 'offline']);
    for (const entry of records) {
      if (!entry || typeof (entry as Record<string, unknown>).feedId !== 'string') continue;
      const e = entry as Record<string, unknown>;
      const status = VALID_STATUSES.has(e.status as FeedStatus)
        ? (e.status as FeedStatus)
        : 'error';
      this.records.set(e.feedId as string, {
        feedId: e.feedId as string,
        domain: typeof e.domain === 'string' ? e.domain : '',
        lastSeenAt: typeof e.lastSeenAt === 'number' ? e.lastSeenAt : 0,
        latencyMs: typeof e.latencyMs === 'number' ? e.latencyMs : 0,
        errorCount: typeof e.errorCount === 'number' ? e.errorCount : 0,
        status,
      });
    }
  }

  private hydrateErrorLog(errorLog: unknown[]): void {
    for (const entry of errorLog) {
      if (!entry) continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.feedId !== 'string' || typeof e.message !== 'string') continue;
      this.errorLog.push({
        feedId: e.feedId,
        domain: typeof e.domain === 'string' ? e.domain : '',
        message: e.message,
        timestamp: typeof e.timestamp === 'number' ? e.timestamp : 0,
      });
    }
  }

  private hydrate(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: PersistedState | null;
    try { parsed = JSON.parse(raw) as PersistedState | null; } catch { return; }
    if (!parsed || typeof parsed !== 'object') return;
    if (Array.isArray(parsed.records)) this.hydrateRecords(parsed.records);
    if (Array.isArray(parsed.errorLog)) this.hydrateErrorLog(parsed.errorLog);
    this.enforceCap();
  }
}
