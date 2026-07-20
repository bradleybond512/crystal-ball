/**
 * Feed Watchdog — monitors active data feeds for staleness, error
 * rates, and quality degradation. Emits alerts when a feed
 * transitions across the healthy / degraded / stale / offline state
 * boundaries so operators see live feed problems rather than discover
 * them via missing data downstream.
 *
 * Status precedence (highest → lowest):
 *   1. offline   — consecutiveFailures >= 5 OR age > 6× expected interval
 *   2. stale     — age in (2, 6]× expected interval
 *   3. degraded  — age in (1, 2]× expected interval OR error rate >= 0.1
 *   4. healthy   — otherwise
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * to `wm-feed-watchdog-health` (one entry per feed) and
 * `wm-feed-watchdog-alerts` (LIFO ring, max 1000).
 */

import { formatDurationMinutes } from '../../utils/format-duration';

// ── Public types ──────────────────────────────────────────────────────

export type FeedStatus = 'healthy' | 'degraded' | 'stale' | 'offline';

export type WatchdogAlertType = 'went-stale' | 'went-offline' | 'error-spike' | 'recovered';

export interface FeedHealth {
  feedId: string;
  domain: string;
  lastSeenAt: number;
  expectedIntervalMs: number;
  errorCount: number;
  successCount: number;
  status: FeedStatus;
  consecutiveFailures: number;
  /** Set when status enters stale/offline; cleared on recovery. */
  staleSinceAt?: number;
}

export interface WatchdogAlert {
  id: string;
  feedId: string;
  domain: string;
  alertType: WatchdogAlertType;
  message: string;
  detectedAt: number;
  acknowledged: boolean;
}

export interface WatchdogSummary {
  total: number;
  healthy: number;
  degraded: number;
  stale: number;
  offline: number;
  unacknowledgedAlerts: number;
}

export interface AlertFilter {
  feedId?: string;
  acknowledged?: boolean;
}

export type WatchdogListener = (alert: WatchdogAlert) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface FeedWatchdogOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const HEALTH_STORAGE_KEY = 'wm-feed-watchdog-health';
export const ALERTS_STORAGE_KEY = 'wm-feed-watchdog-alerts';
export const MAX_ALERTS = 1000;

export const OFFLINE_CONSECUTIVE_FAILURES = 5;
export const OFFLINE_AGE_MULTIPLIER = 6;
export const STALE_AGE_MULTIPLIER = 2;
export const DEGRADED_AGE_MULTIPLIER = 1;
export const DEGRADED_ERROR_RATE = 0.1;
export const ERROR_SPIKE_RATE = 0.3;

// ── Seed catalog ──────────────────────────────────────────────────────

interface SeedEntry {
  feedId: string;
  domain: string;
  expectedIntervalMs: number;
}

const SEED_FEEDS: readonly SeedEntry[] = [
  { feedId: 'earthquake-usgs', domain: 'earthquake', expectedIntervalMs: 5 * 60_000 },
  { feedId: 'biosurv-who', domain: 'biosurv', expectedIntervalMs: 6 * 60 * 60_000 },
  { feedId: 'weather-nws', domain: 'weather', expectedIntervalMs: 10 * 60_000 },
  { feedId: 'maritime-ais', domain: 'maritime', expectedIntervalMs: 60_000 },
  { feedId: 'aviation-opensky', domain: 'aviation', expectedIntervalMs: 30_000 },
  { feedId: 'gdacs-alerts', domain: 'gdacs', expectedIntervalMs: 15 * 60_000 },
  { feedId: 'osint-twitter', domain: 'osint', expectedIntervalMs: 2 * 60_000 },
  { feedId: 'cve-nvd', domain: 'cyber', expectedIntervalMs: 60 * 60_000 },
  { feedId: 'acled-conflict', domain: 'geopolitical', expectedIntervalMs: 24 * 60 * 60_000 },
  { feedId: 'iss-tracker', domain: 'space', expectedIntervalMs: 10_000 },
  { feedId: 'space-wx-noaa', domain: 'space', expectedIntervalMs: 5 * 60_000 },
  { feedId: 'sanctions-ofac', domain: 'compliance', expectedIntervalMs: 24 * 60 * 60_000 },
];

// ── Helpers ───────────────────────────────────────────────────────────

function safeStorage(injected?: StorageLike | null): StorageLike | null {
  if (injected !== undefined) return injected;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function cloneHealth(h: FeedHealth): FeedHealth {
  return { ...h };
}

function cloneAlert(a: WatchdogAlert): WatchdogAlert {
  return { ...a };
}

function errorRateOf(h: FeedHealth): number {
  const total = h.errorCount + h.successCount;
  if (total === 0) return 0;
  return h.errorCount / total;
}

function classifyFeed(h: FeedHealth, now: number): FeedStatus {
  if (h.consecutiveFailures >= OFFLINE_CONSECUTIVE_FAILURES) return 'offline';
  const ageRatio = (now - h.lastSeenAt) / h.expectedIntervalMs;
  if (ageRatio > OFFLINE_AGE_MULTIPLIER) return 'offline';
  if (ageRatio > STALE_AGE_MULTIPLIER) return 'stale';
  if (ageRatio > DEGRADED_AGE_MULTIPLIER) return 'degraded';
  if (errorRateOf(h) >= DEGRADED_ERROR_RATE) return 'degraded';
  return 'healthy';
}

/** Severity rank used by reads when sorting feeds for the panel. */
const STATUS_RANK: Record<FeedStatus, number> = { offline: 0, stale: 1, degraded: 2, healthy: 3 };

// ── Service ───────────────────────────────────────────────────────────

export class FeedWatchdogService {
  private feeds = new Map<string, FeedHealth>();
  private alerts: WatchdogAlert[] = [];
  private listeners = new Set<WatchdogListener>();
  private storage: StorageLike | null;
  private clock: () => number;
  private hydrated = false;
  private idSeq = 0;

  constructor(options: FeedWatchdogOptions = {}) {
    this.storage = safeStorage(options.storage);
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Registration ───────────────────────────────────────────────────

  registerFeed(feedId: string, domain: string, expectedIntervalMs: number): FeedHealth {
    this.ensureHydrated();
    const existing = this.feeds.get(feedId);
    if (existing) {
      // Update mutable metadata but keep counters + status intact.
      existing.domain = domain;
      existing.expectedIntervalMs = Math.max(1, expectedIntervalMs);
      this.persistHealth();
      return cloneHealth(existing);
    }
    const now = this.clock();
    const health: FeedHealth = {
      feedId,
      domain,
      lastSeenAt: now,
      expectedIntervalMs: Math.max(1, expectedIntervalMs),
      errorCount: 0,
      successCount: 0,
      status: 'healthy',
      consecutiveFailures: 0,
    };
    this.feeds.set(feedId, health);
    this.persistHealth();
    return cloneHealth(health);
  }

  // ── Reporting ──────────────────────────────────────────────────────

  recordSuccess(feedId: string): FeedHealth | undefined {
    this.ensureHydrated();
    const health = this.feeds.get(feedId);
    if (!health) return undefined;
    const previousStatus = health.status;
    health.successCount += 1;
    health.consecutiveFailures = 0;
    health.lastSeenAt = this.clock();
    this.transitionTo(health, classifyFeed(health, this.clock()), previousStatus);
    this.persistHealth();
    return cloneHealth(health);
  }

  recordFailure(feedId: string): FeedHealth | undefined {
    this.ensureHydrated();
    const health = this.feeds.get(feedId);
    if (!health) return undefined;
    const previousStatus = health.status;
    const previousErrorRate = errorRateOf(health);
    health.errorCount += 1;
    health.consecutiveFailures += 1;
    const nextStatus = classifyFeed(health, this.clock());
    this.transitionTo(health, nextStatus, previousStatus);
    // Error-spike alert is independent of state transitions — fires
    // whenever the rolling rate crosses ERROR_SPIKE_RATE upward.
    const nextErrorRate = errorRateOf(health);
    if (previousErrorRate < ERROR_SPIKE_RATE && nextErrorRate >= ERROR_SPIKE_RATE) {
      this.recordAlert(health, 'error-spike',
        `${health.feedId} error rate spiked to ${(nextErrorRate * 100).toFixed(0)}%`);
    }
    this.persistHealth();
    return cloneHealth(health);
  }

  /** Called periodically. Re-evaluates every feed against the current
   *  clock and fires alerts for newly stale / offline feeds. */
  tick(): void {
    this.ensureHydrated();
    const now = this.clock();
    let mutated = false;
    for (const health of this.feeds.values()) {
      const previousStatus = health.status;
      const nextStatus = classifyFeed(health, now);
      if (nextStatus !== previousStatus) {
        this.transitionTo(health, nextStatus, previousStatus);
        mutated = true;
      }
    }
    if (mutated) this.persistHealth();
  }

  // ── Reads ──────────────────────────────────────────────────────────

  getHealth(feedId: string): FeedHealth | undefined;
  getHealth(): FeedHealth[];
  // eslint-disable-next-line sonarjs/function-return-type -- overloaded API per spec
  getHealth(feedId?: string): FeedHealth | FeedHealth[] | undefined {
    this.ensureHydrated();
    if (feedId !== undefined) {
      const h = this.feeds.get(feedId);
      return h ? cloneHealth(h) : undefined;
    }
    return [...this.feeds.values()]
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])
      .map((h) => cloneHealth(h));
  }

  getAlerts(filter: AlertFilter = {}, limit?: number): WatchdogAlert[] {
    this.ensureHydrated();
    const matched = this.alerts.filter((a) => {
      if (filter.feedId && a.feedId !== filter.feedId) return false;
      if (filter.acknowledged !== undefined && a.acknowledged !== filter.acknowledged) return false;
      return true;
    });
    const ordered: WatchdogAlert[] = [];
    for (let i = matched.length - 1; i >= 0; i -= 1) ordered.push(matched[i]!);
    const capped = typeof limit === 'number' ? ordered.slice(0, Math.max(0, limit)) : ordered;
    return capped.map((a) => cloneAlert(a));
  }

  getSummary(): WatchdogSummary {
    this.ensureHydrated();
    let healthy = 0; let degraded = 0; let stale = 0; let offline = 0;
    for (const h of this.feeds.values()) {
      switch (h.status) {
        case 'healthy': { healthy += 1; break; }
        case 'degraded': { degraded += 1; break; }
        case 'stale': { stale += 1; break; }
        case 'offline': { offline += 1; break; }
      }
    }
    const unacknowledgedAlerts = this.alerts.filter((a) => !a.acknowledged).length;
    return {
      total: this.feeds.size, healthy, degraded, stale, offline, unacknowledgedAlerts,
    };
  }

  acknowledge(alertId: string): WatchdogAlert | undefined {
    this.ensureHydrated();
    const idx = this.alerts.findIndex((a) => a.id === alertId);
    if (idx === -1) return undefined;
    const current = this.alerts[idx]!;
    if (current.acknowledged) return cloneAlert(current);
    const next: WatchdogAlert = { ...current, acknowledged: true };
    this.alerts[idx] = next;
    this.persistAlerts();
    return cloneAlert(next);
  }

  subscribe(listener: WatchdogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  unsubscribe(listener: WatchdogListener): void {
    this.listeners.delete(listener);
  }

  /** Test seam — clears state and persisted blobs, re-seeds catalog. */
  resetForTesting(): void {
    this.feeds.clear();
    this.alerts = [];
    this.listeners.clear();
    this.idSeq = 0;
    this.hydrated = true;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(HEALTH_STORAGE_KEY); } catch { /* ignore */ }
      try { this.storage.removeItem(ALERTS_STORAGE_KEY); } catch { /* ignore */ }
    }
    this.seedDefaultFeeds();
  }

  // ── Internal ───────────────────────────────────────────────────────

  private transitionTo(health: FeedHealth, nextStatus: FeedStatus, previousStatus: FeedStatus): void {
    if (nextStatus === previousStatus) return;
    health.status = nextStatus;
    if (nextStatus === 'stale' || nextStatus === 'offline') {
      health.staleSinceAt = this.clock();
    } else if (previousStatus === 'stale' || previousStatus === 'offline') {
      delete health.staleSinceAt;
    }
    if (nextStatus === 'stale') {
      this.recordAlert(health, 'went-stale',
        `${health.feedId} went stale — no data for ${this.ageDescription(health)}`);
    } else if (nextStatus === 'offline') {
      this.recordAlert(health, 'went-offline',
        `${health.feedId} went offline — ${this.offlineReason(health)}`);
    } else if (previousStatus === 'stale' || previousStatus === 'offline') {
      this.recordAlert(health, 'recovered',
        `${health.feedId} recovered (was ${previousStatus}, now ${nextStatus})`);
    }
  }

  private ageDescription(h: FeedHealth): string {
    const seconds = Math.round((this.clock() - h.lastSeenAt) / 1000);
    if (seconds < 60) return `${seconds}s`;
    // Shared formatter: "45m", "3h 20m", "5d 7h" — never "120h".
    return formatDurationMinutes(seconds / 60);
  }

  private offlineReason(h: FeedHealth): string {
    if (h.consecutiveFailures >= OFFLINE_CONSECUTIVE_FAILURES) {
      return `${h.consecutiveFailures} consecutive failures`;
    }
    return `no data for ${this.ageDescription(h)}`;
  }

  private recordAlert(health: FeedHealth, alertType: WatchdogAlertType, message: string): void {
    const now = this.clock();
    this.idSeq += 1;
    const alert: WatchdogAlert = {
      id: `fwd-${now.toString(36)}-${this.idSeq}`,
      feedId: health.feedId, domain: health.domain, alertType, message,
      detectedAt: now, acknowledged: false,
    };
    this.alerts.push(alert);
    if (this.alerts.length > MAX_ALERTS) {
      this.alerts.splice(0, this.alerts.length - MAX_ALERTS);
    }
    this.persistAlerts();
    const snapshot = cloneAlert(alert);
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* isolate */ }
    }
  }

  private seedDefaultFeeds(): void {
    const now = this.clock();
    for (const seed of SEED_FEEDS) {
      if (this.feeds.has(seed.feedId)) continue;
      this.feeds.set(seed.feedId, {
        feedId: seed.feedId, domain: seed.domain,
        lastSeenAt: now, expectedIntervalMs: seed.expectedIntervalMs,
        errorCount: 0, successCount: 0,
        status: 'healthy', consecutiveFailures: 0,
      });
    }
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    this.seedDefaultFeeds();
    if (!this.storage) return;
    this.hydrateHealth();
    this.hydrateAlerts();
  }

  private hydrateHealth(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(HEALTH_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: FeedHealth[] | null;
    try { parsed = JSON.parse(raw) as FeedHealth[] | null; }
    catch { return; }
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (entry && typeof entry.feedId === 'string') this.feeds.set(entry.feedId, { ...entry });
    }
  }

  private hydrateAlerts(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(ALERTS_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: WatchdogAlert[] | null;
    try { parsed = JSON.parse(raw) as WatchdogAlert[] | null; }
    catch { return; }
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (entry && typeof entry.id === 'string') this.alerts.push({ ...entry });
    }
  }

  private persistHealth(): void {
    if (!this.storage) return;
    const payload = [...this.feeds.values()];
    try {
      this.storage.setItem(HEALTH_STORAGE_KEY, JSON.stringify(payload));
    } catch { /* best effort */ }
  }

  private persistAlerts(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(this.alerts));
    } catch { /* best effort */ }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: FeedWatchdogService | null = null;

export function getFeedWatchdogService(): FeedWatchdogService {
  _singleton ??= new FeedWatchdogService();
  return _singleton;
}

export function __resetFeedWatchdogServiceSingleton(): void {
  _singleton = null;
}

export const __internals = {
  SEED_FEEDS,
  STATUS_RANK,
  OFFLINE_CONSECUTIVE_FAILURES,
  OFFLINE_AGE_MULTIPLIER,
  STALE_AGE_MULTIPLIER,
  DEGRADED_AGE_MULTIPLIER,
  DEGRADED_ERROR_RATE,
  ERROR_SPIKE_RATE,
  MAX_ALERTS,
  classifyFeed,
  errorRateOf,
};
