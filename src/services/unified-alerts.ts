/**
 * Unified Alert Types
 *
 * Common interface for all alert sources in Crystal Ball.
 * Every alert — breaking news, NWS weather, GDACS disaster, tsunami,
 * hazard proximity, OREF siren, correlation signal — normalizes to this shape.
 */

import type { EvidencePack } from './evidence-pack';
import { alertDB } from './alert-store';
import { notificationDispatcher, actionForSeverity } from './notification-dispatcher';
import type { AlertExplanation } from './intelligence/explainer';

export type AlertSource =
  | 'breaking-news'
  | 'nws'
  | 'gdacs'
  | 'tsunami'
  | 'volcano'
  | 'oref'
  | 'hazard'
  | 'correlation'
  | 'cyber'
  | 'resource'
  | 'local-ids'
  | 'earthquake'
  | 'fire'
  | 'cyclone'
  | 'power-grid'
  | 'comms-health'
  | 'space-weather'
  | 'spc'
  | 'disease'
  | 'maritime'
  | 'travel-advisory'
  | 'radiation'
  | 'air-quality'
  | 'aviation-hazard';

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface UnifiedAlert {
  id: string;
  source: AlertSource;
  severity: AlertSeverity;
  title: string;
  body: string;
  timestamp: number;
  location?: { lat: number; lon: number; label?: string };
  distanceKm?: number;
  relevanceScore: number;
  acknowledged: boolean;
  pinned: boolean;
  /** If set, alert is suppressed from triage/score until this Unix-ms timestamp. */
  snoozedUntil?: number;
  link?: string;
  evidence?: EvidencePack;
  raw?: unknown;
  /** For `correlation` alerts: IDs of member alerts that triggered synthesis. */
  correlationMembers?: string[];
  /** For `correlation` alerts: the causal pair that matched, e.g. ['earthquake','tsunami']. */
  correlationPair?: [AlertSource, AlertSource];
  /** Human-readable explanation from the intelligence Explain stage. */
  explanation?: AlertExplanation;
}

const STORAGE_KEY = 'wm-unified-alerts-v1';
const USER_LOCATION_KEY = 'crystalball-user-location';
const MAX_ALERTS = 500;
const PRUNE_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

// ── Haversine distance ──────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

/** Compute great-circle distance in km between two points. */
export function computeDistanceKm(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Compute distance in miles from the user's location. Returns undefined if alert has no coords. */
export function computeDistance(
  alert: UnifiedAlert, userLat: number, userLon: number,
): number | undefined {
  if (!alert.location) return undefined;
  return computeDistanceKm(userLat, userLon, alert.location.lat, alert.location.lon);
}

/** Read the user's stored location from localStorage. */
function getUserLocation(): { lat: number; lon: number } | null {
  try {
    const raw = localStorage.getItem(USER_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lat?: number; lon?: number };
    if (typeof parsed.lat === 'number' && typeof parsed.lon === 'number') {
      return { lat: parsed.lat, lon: parsed.lon };
    }
  } catch { /* ignore */ }
  return null;
}

/** Stamp distanceKm on each alert that has a location, given user position. */
function stampDistances(alerts: UnifiedAlert[]): void {
  const loc = getUserLocation();
  if (!loc) return;
  for (const alert of alerts) {
    if (alert.location) {
      alert.distanceKm = computeDistanceKm(loc.lat, loc.lon, alert.location.lat, alert.location.lon);
    }
  }
}

/**
 * In-memory store for unified alerts.
 * Persisted to localStorage for cross-session survival.
 */
class UnifiedAlertStore {
  private alerts = new Map<string, UnifiedAlert>();
  private listeners = new Set<() => void>();
  private flushScheduled = false;
  private flushDirty = false;

  constructor() {
    this.loadFromStorage();
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const flush = () => this.flushNow();
      window.addEventListener('pagehide', flush);
      window.addEventListener('beforeunload', flush);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') this.flushNow();
        });
      }
    }
  }

  /**
   * Coalesce persist()+notify() into a single rAF flush. Multiple mutations
   * in the same frame (e.g. "Ack all" over N alerts) collapse to one persist
   * and one subscriber fan-out instead of N×listeners synchronous callbacks —
   * the root cause of the laggy acknowledge/dismiss path.
   */
  private scheduleFlush(): void {
    this.flushDirty = true;
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    const run = () => {
      this.flushScheduled = false;
      if (!this.flushDirty) return;
      this.flushDirty = false;
      this.persist();
      this.notify();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else queueMicrotask(run);
  }

  /**
   * Synchronously flush any pending persist+notify. Registered on page unload
   * so a deferred frame never drops the last write (durability guard).
   */
  private flushNow(): void {
    if (!this.flushDirty) return;
    this.flushDirty = false;
    this.persist();
    this.notify();
  }

  /** Add or update alerts. Deduplicates by id. Stamps distance, dispatches notifications for new alerts. */
  ingest(incoming: UnifiedAlert[]): void {
    stampDistances(incoming);
    let changed = false;
    const newAlerts: UnifiedAlert[] = [];
    for (const alert of incoming) {
      const existing = this.alerts.get(alert.id);
      if (existing) {
        // Update relevanceScore and timestamp if newer, preserve ack/pin state
        if (alert.timestamp >= existing.timestamp) {
          this.alerts.set(alert.id, {
            ...alert,
            acknowledged: existing.acknowledged,
            pinned: existing.pinned,
          });
          changed = true;
        }
      } else {
        this.alerts.set(alert.id, alert);
        newAlerts.push(alert);
        changed = true;
      }
    }
    if (changed) {
      this.prune();
      this.scheduleFlush();

      // Fire-and-forget: persist to IndexedDB for 30-day retention
      alertDB.putBatch(incoming).catch(() => { /* silent — IDB persistence is best-effort */ });
    }
    // Dispatch notifications for genuinely new alerts (after store update)
    for (const alert of newAlerts) {
      notificationDispatcher.dispatchNotification(alert, actionForSeverity(alert.severity));
    }
  }

  getAll(): UnifiedAlert[] {
    return [...this.alerts.values()];
  }

  getUnacknowledgedCount(): number {
    let count = 0;
    for (const a of this.alerts.values()) {
      if (!a.acknowledged) count++;
    }
    return count;
  }

  acknowledge(id: string): void {
    const alert = this.alerts.get(id);
    if (alert && !alert.acknowledged) {
      alert.acknowledged = true;
      this.scheduleFlush();
    }
  }

  /** Acknowledge many alerts with a single coalesced persist + notify. */
  acknowledgeMany(ids: string[]): void {
    let changed = false;
    for (const id of ids) {
      const alert = this.alerts.get(id);
      if (alert && !alert.acknowledged) {
        alert.acknowledged = true;
        changed = true;
      }
    }
    if (changed) this.scheduleFlush();
  }

  acknowledgeAll(): void {
    let changed = false;
    for (const alert of this.alerts.values()) {
      if (!alert.acknowledged) {
        alert.acknowledged = true;
        changed = true;
      }
    }
    if (changed) {
      this.scheduleFlush();
    }
  }

  snooze(id: string, ms: number): void {
    const alert = this.alerts.get(id);
    if (alert) {
      alert.snoozedUntil = Date.now() + ms;
      this.scheduleFlush();
    }
  }

  togglePin(id: string): void {
    const alert = this.alerts.get(id);
    if (alert) {
      alert.pinned = !alert.pinned;
      this.scheduleFlush();
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try { fn(); } catch { /* noop */ }
    }
  }

  private prune(): void {
    const now = Date.now();
    // Remove old unpinned alerts
    for (const [id, alert] of this.alerts) {
      if (!alert.pinned && now - alert.timestamp > PRUNE_AGE_MS) {
        this.alerts.delete(id);
      }
    }
    // Cap size — remove oldest acknowledged first, then oldest unacknowledged
    if (this.alerts.size > MAX_ALERTS) {
      const sorted = [...this.alerts.values()].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
        return a.timestamp - b.timestamp;
      });
      const toDrop = sorted.slice(0, sorted.length - MAX_ALERTS);
      for (const alert of toDrop) {
        this.alerts.delete(alert.id);
      }
    }
  }

  private persist(): void {
    try {
      const entries = [...this.alerts.values()];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch { /* storage full — silently drop */ }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const entries = JSON.parse(raw) as UnifiedAlert[];
      const now = Date.now();
      const loaded: UnifiedAlert[] = [];
      for (const entry of entries) {
        if (entry.pinned || now - entry.timestamp <= PRUNE_AGE_MS) {
          this.alerts.set(entry.id, entry);
          loaded.push(entry);
        }
      }
      // Re-compute distances with current user location
      stampDistances(loaded);
    } catch { /* corrupted — start fresh */ }
  }
}

export const unifiedAlertStore = new UnifiedAlertStore();
