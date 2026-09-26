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
import { createIdentityLedger, hydrateIdentityLedger, identifyAlert } from './alert-identity';

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

export type AlertSpatialScope =
  | { kind: 'point'; basis: 'reported-event' | 'centroid' | 'regional-centroid' }
  | { kind: 'area'; basis: 'nws-geometry' }
  | { kind: 'global'; basis: 'producer' }
  | { kind: 'members' };

export interface UnifiedAlert {
  id: string;
  source: AlertSource;
  severity: AlertSeverity;
  title: string;
  body: string;
  timestamp: number;
  location?: { lat: number; lon: number; label?: string };
  /** How `location` may be interpreted; absent means impact cannot be inferred. */
  spatialScope?: AlertSpatialScope;
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

const VALID_SEVERITIES = new Set<string>(['critical', 'high', 'medium', 'low', 'info']);

function isValidAlertSpatialScope(value: unknown): value is AlertSpatialScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const scope = value as Record<string, unknown>;
  switch (scope['kind']) {
    case 'point':
      return scope['basis'] === 'reported-event'
        || scope['basis'] === 'centroid'
        || scope['basis'] === 'regional-centroid';
    case 'area':
      return scope['basis'] === 'nws-geometry';
    case 'global':
      return scope['basis'] === 'producer';
    case 'members':
      return scope['basis'] === undefined;
    default:
      return false;
  }
}

type HydratableUnifiedAlert = Omit<UnifiedAlert, 'spatialScope'> & { spatialScope?: unknown };

/**
 * Runtime structural guard for localStorage-hydrated alert entries.
 * Rejects anything that doesn't have the minimum required shape so a
 * corrupted or tampered store can't populate the live alert registry
 * with untyped objects.
 */
function isValidUnifiedAlertEntry(e: unknown): e is HydratableUnifiedAlert {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  const a = e as Record<string, unknown>;
  return (
    typeof a['id'] === 'string' && a['id'].length > 0 &&
    typeof a['source'] === 'string' &&
    typeof a['severity'] === 'string' && VALID_SEVERITIES.has(a['severity']) &&
    typeof a['title'] === 'string' &&
    typeof a['body'] === 'string' &&
    typeof a['timestamp'] === 'number' && Number.isFinite(a['timestamp'])
  );
}

function sanitizeHydratedAlert(entry: HydratableUnifiedAlert): UnifiedAlert {
  if (entry.spatialScope === undefined || isValidAlertSpatialScope(entry.spatialScope)) {
    return entry as UnifiedAlert;
  }
  const { spatialScope: _invalidScope, ...alert } = entry;
  return alert;
}

const LEGACY_STORAGE_KEY = 'wm-unified-alerts-v1';
const STORAGE_KEY = 'wm-unified-alerts-v2';
const USER_LOCATION_KEY = 'crystalball-user-location';
const MAX_ALERTS = 500;
const PRUNE_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

interface AlertIdentityState {
  notificationConsidered: boolean;
  acknowledged: boolean;
  pinned: boolean;
  snoozedUntil?: number;
}

function isIdentityState(value: unknown): value is AlertIdentityState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return typeof state.notificationConsidered === 'boolean'
    && typeof state.acknowledged === 'boolean'
    && typeof state.pinned === 'boolean'
    && (state.snoozedUntil === undefined
      || (typeof state.snoozedUntil === 'number' && Number.isFinite(state.snoozedUntil)));
}

function identityState(alert: UnifiedAlert, considered: boolean): AlertIdentityState {
  return {
    notificationConsidered: considered,
    acknowledged: alert.acknowledged === true,
    pinned: alert.pinned === true,
    ...(Number.isFinite(alert.snoozedUntil) ? { snoozedUntil: alert.snoozedUntil } : {}),
  };
}

function capacityOrder(a: UnifiedAlert, b: UnifiedAlert): number {
  if (a.pinned !== b.pinned) return a.pinned ? 1 : -1;
  if (!a.pinned && a.acknowledged !== b.acknowledged) return a.acknowledged ? -1 : 1;
  return a.timestamp - b.timestamp;
}

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
  private identities = createIdentityLedger(isIdentityState);
  private identityLimits: Parameters<typeof createIdentityLedger>[1];
  private lastPersisted: string | undefined;
  private storageFailure = false;
  private migrationPending = false;
  private capacityFailures = 0;
  private invalidIdentities = 0;
  private listeners = new Set<() => void>();
  private flushScheduled = false;
  private flushDirty = false;
  /** Incoming alerts accumulated across a burst for ONE coalesced IDB archive write. */
  private pendingArchive: UnifiedAlert[] = [];
  /** Throttled subscriber fan-out state (see notifyThrottleMs). */
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private notifyDirty = false;
  private lastNotifyAt = 0;

  constructor(options: { identityLimits?: Parameters<typeof createIdentityLedger>[1] } = {}) {
    this.identityLimits = options.identityLimits;
    this.identities = createIdentityLedger(isIdentityState, this.identityLimits);
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
   * Coalesce pruning, archive writes, user-state persistence and subscriber work.
   * New notification consideration is already persisted by ingest; unchanged
   * snapshots skip the write here.
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
    const now = Date.now();
    this.identities.expire(now);
    const protectedKeys = new Set<string>();
    for (const stored of this.alerts.values()) {
      const identity = identifyAlert(stored);
      if (identity) protectedKeys.add(identity.key);
    }
    let changed = false;
    const newAlerts: UnifiedAlert[] = [];
    for (const alert of incoming) {
      const live = this.alerts.get(alert.id);
      const existing = live?.source === alert.source ? live : undefined;
      const identity = identifyAlert(alert);
      const previous = identity ? this.identities.get(identity.key) : undefined;
      const state = existing ? identityState(existing, true) : previous?.value;
      const restored = state ? {
        ...alert,
        acknowledged: state.acknowledged,
        pinned: state.pinned,
        snoozedUntil: state.snoozedUntil,
      } : alert;
      if (!existing || alert.timestamp >= existing.timestamp) {
        this.alerts.set(alert.id, restored);
        changed = true;
      }
      const considered = !!existing || previous?.value.notificationConsidered === true;
      if (identity) {
        const status = this.identities.admit(identity, identityState(restored, true), now, protectedKeys);
        if (status === 'capacity') this.capacityFailures++;
        else if (status === 'invalid') this.invalidIdentities++;
        else {
          if (!this.identities.updateValue(identity.key, identityState(restored, true))) this.capacityFailures++;
          protectedKeys.add(identity.key);
        }
      } else {
        this.invalidIdentities++;
      }
      if (!existing && !considered) newAlerts.push(restored);
    }
    if (changed) {
      for (const alert of incoming) this.pendingArchive.push(alert);
      if (this.alerts.size > MAX_ALERTS * 2) this.prune();
      this.scheduleFlush();
    }
    // The complete data/identity envelope precedes consideration by the dispatcher.
    // A failed write preserves source-warning eligibility and in-memory deduplication.
    if (newAlerts.length > 0) this.persist();
    for (const alert of newAlerts) {
      notificationDispatcher.dispatchNotification(alert, actionForSeverity(alert.severity));
    }
  }

  getIdentityDiagnostics(): {
    entries: number; bytes: number; storageFailure: boolean; migrationPending: boolean;
    capacityFailures: number; invalidIdentities: number;
  } {
    return {
      entries: this.identities.size, bytes: this.identities.byteLength,
      storageFailure: this.storageFailure, migrationPending: this.migrationPending,
      capacityFailures: this.capacityFailures, invalidIdentities: this.invalidIdentities,
    };
  }

  private rememberUserState(alert: UnifiedAlert): void {
    const identity = identifyAlert(alert);
    if (identity && this.identities.get(identity.key) && !this.identities.updateValue(identity.key, identityState(alert, true))) this.capacityFailures++;
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
      this.rememberUserState(alert);
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
        this.rememberUserState(alert);
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
        this.rememberUserState(alert);
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
      this.rememberUserState(alert);
      this.scheduleFlush();
    }
  }

  togglePin(id: string): void {
    const alert = this.alerts.get(id);
    if (alert) {
      alert.pinned = !alert.pinned;
      this.rememberUserState(alert);
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
    // Cap size — evict unpinned acknowledged, then unpinned unacknowledged, then pinned.
    // Oldest source timestamp first within each group; ties keep Map insertion order.
    if (this.alerts.size > MAX_ALERTS) {
      const sorted = [...this.alerts.values()].sort(capacityOrder);
      const toDrop = sorted.slice(0, sorted.length - MAX_ALERTS);
      for (const alert of toDrop) {
        this.alerts.delete(alert.id);
      }
    }
  }

  private persist(): void {
    try {
      this.identities.expire(Date.now());
      const serialized = JSON.stringify({
        version: 2, alerts: this.entriesForPersist(), identities: this.identities.snapshot(),
      });
      if (serialized === this.lastPersisted && !this.storageFailure) return;
      localStorage.setItem(STORAGE_KEY, serialized);
      if (localStorage.getItem(STORAGE_KEY) !== serialized) {
        this.storageFailure = true;
        return;
      }
      this.lastPersisted = serialized;
      this.storageFailure = false;
      this.migrationPending = false;
    } catch {
      this.storageFailure = true;
    }
  }

  private entriesForPersist(): UnifiedAlert[] {
    const now = Date.now();
    const all = [...this.alerts.values()].filter((alert) =>
      alert.pinned || now - alert.timestamp <= PRUNE_AGE_MS);
    const evicted = new Set(all.length > MAX_ALERTS
      ? [...all].sort(capacityOrder).slice(0, all.length - MAX_ALERTS)
      : []);
    return all.filter((alert) => !evicted.has(alert))
      .map((alert) => alert.raw === undefined ? alert : { ...alert, raw: undefined });
  }

  private loadFromStorage(): void {
    const now = Date.now();
    let entries: unknown;
    let legacy = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (parsed && parsed.version === 2 && Array.isArray(parsed.alerts)
            && parsed.identities && typeof parsed.identities === 'object'
            && (parsed.identities as Record<string, unknown>).version === 1
            && Array.isArray((parsed.identities as Record<string, unknown>).entries)) {
            entries = parsed.alerts;
            this.identities = hydrateIdentityLedger(parsed.identities, now, isIdentityState, this.identityLimits);
            const rawEntries = (parsed.identities as { entries: unknown[] }).entries;
            const configuredAge = this.identityLimits?.maxAgeMs;
            const maxAge = typeof configuredAge === 'number' && Number.isSafeInteger(configuredAge) && configuredAge > 0
              ? Math.min(configuredAge, 7 * 86400_000) : 7 * 86400_000;
            const retainedCount = rawEntries.filter((entry) => {
              const received = entry && typeof entry === 'object'
                ? (entry as Record<string, unknown>).firstReceivedAt : undefined;
              return typeof received !== 'number' || !Number.isFinite(received) || received + maxAge > now;
            }).length;
            if (retainedCount !== this.identities.size) this.storageFailure = true;
            this.lastPersisted = raw;
          } else this.storageFailure = true;
        } catch { this.storageFailure = true; }
      }
      if (!entries) {
        const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (!rawLegacy) return;
        entries = JSON.parse(rawLegacy);
        legacy = true;
        this.migrationPending = true;
      }
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (!isValidUnifiedAlertEntry(entry)) continue;
        const alert = sanitizeHydratedAlert(entry);
        if (alert.pinned || now - alert.timestamp <= PRUNE_AGE_MS) this.alerts.set(alert.id, alert);
      }
      this.prune();
      const protectedKeys = new Set<string>();
      for (const alert of this.alerts.values()) {
        const identity = identifyAlert(alert);
        if (!identity) { this.invalidIdentities++; continue; }
        // Legacy rows seed only their exact report identity; no positional LSR mapping.
        if (legacy || !this.identities.get(identity.key)) {
          const status = this.identities.admit(identity, identityState(alert, true), now, protectedKeys);
          if (status === 'capacity') this.capacityFailures++;
          else if (status === 'invalid') this.invalidIdentities++;
        }
        protectedKeys.add(identity.key);
      }
      stampDistances([...this.alerts.values()]);
    } catch { this.storageFailure = true; }
  }
}

export const unifiedAlertStore = new UnifiedAlertStore();

/** Exported for tests only — production code uses the `unifiedAlertStore` singleton. */
export { UnifiedAlertStore };
