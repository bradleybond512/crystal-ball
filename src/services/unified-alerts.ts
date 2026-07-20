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

/**
 * Throttle the subscriber fan-out. ~26 subscribers re-run on every notify (each
 * getAll()s + reprocesses the whole set), and several re-ingest/re-acknowledge
 * from their callback — a feedback loop that, unbounded, fires the fan-out every
 * frame and drives the ingest-burst CPU/GC stall. Leading + trailing throttle
 * caps it to ≤1 fan-out per interval while never dropping the final state.
 */
let notifyThrottleMs = 100;
/** Test seam — override the notify throttle (0 = fire immediately, as before). */
export function _setNotifyThrottleForTest(ms: number): void { notifyThrottleMs = ms; }

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
  /** Incoming alerts accumulated across a burst for ONE coalesced IDB archive write. */
  private pendingArchive: UnifiedAlert[] = [];
  /** Throttled subscriber fan-out state (see notifyThrottleMs). */
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private notifyDirty = false;
  private lastNotifyAt = 0;

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
    // Scheduled (non-unload) drain: throttle the subscriber fan-out.
    const run = () => this.drainFlush(false);
    // rAF coalesces to one flush per painted frame — but it is PAUSED while the
    // document is hidden. This app ingests in the background, so fall back to a
    // timer when hidden (or when rAF is unavailable) so prune/persist/archive
    // still run instead of backing up until the window is foregrounded again.
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (typeof requestAnimationFrame === 'function' && !hidden) requestAnimationFrame(run);
    else if (typeof setTimeout === 'function') setTimeout(run, 0);
    else queueMicrotask(run);
  }

  /**
   * Synchronously flush any pending work. Registered on page unload so a
   * deferred frame never drops the last write (durability guard).
   */
  private flushNow(): void {
    // Clear the scheduled flag so that if a flush was armed via requestAnimationFrame
    // while visible and the document then went hidden (this runs on the
    // visibilitychange→hidden transition), the now-paused rAF no longer blocks
    // subsequent hidden ingests from re-arming the setTimeout fallback. A stale
    // rAF that later fires is a harmless no-op (guarded by flushDirty).
    this.drainFlush(true);
  }

  /**
   * Run the coalesced flush if dirty. `immediate` forces a synchronous notify
   * (unload durability); otherwise the subscriber fan-out is throttled.
   */
  private drainFlush(immediate: boolean): void {
    this.flushScheduled = false;
    if (this.flushDirty) {
      this.flushDirty = false;
      this.flush(immediate);
      return;
    }
    // Nothing to persist — but on unload a throttled notify may still be pending
    // (the flush already ran, only its trailing fan-out is queued). Deliver it
    // synchronously so subscribers never miss the final state on page close.
    // Guard on notifyDirty so a bare unload with nothing pending is a no-op.
    if (immediate && this.notifyDirty) this.deliverNotifyNow();
  }

  /**
   * The single coalesced per-burst work unit: prune → persist (localStorage) →
   * archive (one IDB putBatch) → notify. Doing prune + the IDB write here rather
   * than per-ingest collapses N ingests in a frame into ONE spread+sort, ONE
   * stringify and ONE structured clone — the serialization/GC churn behind the
   * ingest-burst renderer stall. The subscriber fan-out is throttled separately
   * (see scheduleNotify) so it cannot fire every frame.
   */
  private flush(immediate: boolean): void {
    this.prune();
    this.persist();
    this.flushArchive();
    // An immediate (unload) flush just changed state → deliver now; otherwise
    // throttle the fan-out.
    if (immediate) this.deliverNotifyNow();
    else this.scheduleNotify();
  }

  /** Throttled subscriber fan-out: leading fire when idle, else a trailing fire. */
  private scheduleNotify(): void {
    this.notifyDirty = true;
    if (this.notifyTimer !== null) return;
    const elapsed = Date.now() - this.lastNotifyAt;
    if (elapsed >= notifyThrottleMs) {
      this.emitNotify();
    } else {
      this.notifyTimer = setTimeout(() => { this.notifyTimer = null; this.emitNotify(); }, notifyThrottleMs - elapsed);
    }
  }

  private emitNotify(): void {
    if (this.notifyDirty) this.deliverNotifyNow();
  }

  /** Fire the subscriber fan-out now: cancel any pending trailing timer, clear dirty, notify. */
  private deliverNotifyNow(): void {
    if (this.notifyTimer !== null) { clearTimeout(this.notifyTimer); this.notifyTimer = null; }
    this.notifyDirty = false;
    this.lastNotifyAt = Date.now();
    this.notify();
  }

  /** Test seam — simulate the pagehide/unload synchronous flush. */
  _flushNowForTest(): void { this.flushNow(); }

  /** Fire-and-forget: one structured-clone IDB write for the whole burst. */
  private flushArchive(): void {
    if (this.pendingArchive.length === 0) return;
    const batch = this.pendingArchive;
    this.pendingArchive = [];
    // Shed `raw` before the structured clone — the same multi-KB source
    // payloads behind the persist rope storm show up here as
    // globalFuncCloneObject/operationSpreadGeneric in hang samples, and they
    // grew the archive store to 60 MB on disk. ThreatInboxPanel reads `raw`
    // back for 'threat-reactor' rows (ReactorMeta), so keep it for that
    // source only.
    const slim = batch.map((a) =>
      a.raw === undefined || (a.source as string) === 'threat-reactor' ? a : { ...a, raw: undefined },
    );
    // Best-effort 30-day retention archive — never blocks the flush.
    alertDB.putBatch(slim).catch(() => { /* silent — IDB persistence is best-effort */ });
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
      // Defer prune + persist + the IDB archive write to a single coalesced
      // flush per burst (see flush()). Accumulate this batch for the one
      // trailing putBatch instead of cloning on every ingest.
      for (const alert of incoming) this.pendingArchive.push(alert);
      // Backstop: a single huge ingest (or a long hidden backlog) could grow the
      // map far past the cap before the deferred flush prunes it. Bound the
      // transient oversize/memory without re-introducing per-ingest churn for
      // normal small bursts.
      if (this.alerts.size > MAX_ALERTS * 2) this.prune();
      this.scheduleFlush();
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entriesForPersist()));
    } catch { /* storage full — silently drop */ }
  }

  /**
   * Bound the SERIALIZED payload independent of map size. prune() normally keeps
   * the map ≤ MAX_ALERTS, but this is a persist-time backstop so the stringify
   * cost can never blow up regardless of how the map got large: pinned + unacked
   * alerts are always kept, the remainder is filled most-recent-first.
   */
  private entriesForPersist(): UnifiedAlert[] {
    const all = [...this.alerts.values()];
    let bounded: UnifiedAlert[];
    if (all.length <= MAX_ALERTS) {
      bounded = all;
    } else {
      const kept = all.filter((a) => a.pinned || !a.acknowledged);
      const rest = all
        .filter((a) => !a.pinned && a.acknowledged)
        .sort((a, b) => b.timestamp - a.timestamp);
      bounded = [...kept, ...rest].slice(0, Math.max(MAX_ALERTS, kept.length));
    }
    // Bound the BYTES, not just the count: `raw` carries the original source
    // payload (NWS polygons, GDELT docs — tens of KB per alert), which made
    // this blob multi-MB and each stringify a main-thread rope storm (live
    // sample: JSRopeString::resolveToBuffer hot; on-disk localStorage WAL
    // churning at 13 MB). Nothing reads `raw` back from the reloaded store —
    // the only `raw` consumer (ThreatInboxPanel) reads alertDB rows, not this
    // blob — so shed it at persist time. JSON.stringify drops undefined.
    return bounded.map((a) => (a.raw === undefined ? a : { ...a, raw: undefined }));
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

/** Exported for tests only — production code uses the `unifiedAlertStore` singleton. */
export { UnifiedAlertStore };
