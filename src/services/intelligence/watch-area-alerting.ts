/**
 * Watch Area Alerting — operators define named circular geographic
 * regions with per-domain severity thresholds. When an observation
 * or situation falls inside a watch area AND meets that domain's
 * threshold, the service fires a persisted alert.
 *
 * Distinct from the saved-places proximity filter (which is passive
 * — just highlights things you've bookmarked). Watch areas actively
 * fire alerts the moment a qualifying event lands inside the radius.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * to `wm-watch-areas` (one entry per area) and `wm-watch-area-alerts`
 * (LIFO ring buffer, max 2000).
 */

// ── Public types ──────────────────────────────────────────────────────

export type WatchSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface WatchArea {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  enabled: boolean;
  /** Keyed by domain (e.g. 'earthquake'). Missing domain → don't alert. */
  thresholds: Record<string, WatchSeverity>;
  createdAt: number;
}

export type WatchSourceType = 'observation' | 'situation';

export interface CheckSource {
  id: string;
  type: WatchSourceType;
  domain: string;
  severity: string;
  lat?: number;
  lon?: number;
}

export interface WatchAreaAlert {
  id: string;
  watchAreaId: string;
  watchAreaName: string;
  domain: string;
  severity: string;
  sourceId: string;
  sourceType: WatchSourceType;
  lat?: number;
  lon?: number;
  /** Haversine distance in km from the source to the area centre.
   *  Infinity when the source has no coordinates. */
  distanceKm: number;
  firedAt: number;
  acknowledged: boolean;
}

export interface WatchAreaStats {
  totalAreas: number;
  enabledAreas: number;
  totalAlerts: number;
  unacknowledgedAlerts: number;
  alertsByArea: Record<string, number>;
}

export interface AlertFilter {
  watchAreaId?: string;
  acknowledged?: boolean;
}

export type WatchAreaListener = (alert: WatchAreaAlert) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface WatchAreaAlertingOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const AREAS_STORAGE_KEY = 'wm-watch-areas';
export const ALERTS_STORAGE_KEY = 'wm-watch-area-alerts';
export const MAX_ALERTS = 2000;

export const SEVERITY_RANK: Record<WatchSeverity, number> = {
  low: 1, medium: 2, high: 3, critical: 4,
};

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

function cloneArea(a: WatchArea): WatchArea {
  return { ...a, thresholds: { ...a.thresholds } };
}

function cloneAlert(a: WatchAreaAlert): WatchAreaAlert {
  return { ...a };
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function severityRankOf(severity: string): number {
  const key = severity.toLowerCase() as WatchSeverity;
  return SEVERITY_RANK[key] ?? 0;
}

// ── Service ───────────────────────────────────────────────────────────

export class WatchAreaAlertingService {
  private areas = new Map<string, WatchArea>();
  private alerts: WatchAreaAlert[] = [];
  private listeners = new Set<WatchAreaListener>();
  private storage: StorageLike | null;
  private clock: () => number;
  private hydrated = false;
  private idSeq = 0;

  constructor(options: WatchAreaAlertingOptions = {}) {
    this.storage = safeStorage(options.storage);
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Area CRUD ──────────────────────────────────────────────────────

  createArea(input: Omit<WatchArea, 'id' | 'createdAt'>): WatchArea {
    this.ensureHydrated();
    const now = this.clock();
    this.idSeq += 1;
    const area: WatchArea = {
      id: `area-${now.toString(36)}-${this.idSeq}`,
      name: input.name,
      lat: input.lat, lon: input.lon, radiusKm: Math.max(0, input.radiusKm),
      enabled: input.enabled,
      thresholds: { ...input.thresholds },
      createdAt: now,
    };
    this.areas.set(area.id, area);
    this.persistAreas();
    return cloneArea(area);
  }

  updateArea(
    id: string,
    updates: Partial<Pick<WatchArea, 'name' | 'lat' | 'lon' | 'radiusKm' | 'enabled' | 'thresholds'>>,
  ): WatchArea | undefined {
    this.ensureHydrated();
    const existing = this.areas.get(id);
    if (!existing) return undefined;
    if (updates.name !== undefined) existing.name = updates.name;
    if (updates.lat !== undefined) existing.lat = updates.lat;
    if (updates.lon !== undefined) existing.lon = updates.lon;
    if (updates.radiusKm !== undefined) existing.radiusKm = Math.max(0, updates.radiusKm);
    if (updates.enabled !== undefined) existing.enabled = updates.enabled;
    if (updates.thresholds !== undefined) existing.thresholds = { ...updates.thresholds };
    this.persistAreas();
    return cloneArea(existing);
  }

  deleteArea(id: string): boolean {
    this.ensureHydrated();
    const removed = this.areas.delete(id);
    if (removed) this.persistAreas();
    return removed;
  }

  getAreas(): WatchArea[] {
    this.ensureHydrated();
    return [...this.areas.values()].map((a) => cloneArea(a));
  }

  // ── Check ──────────────────────────────────────────────────────────

  check(source: CheckSource): WatchAreaAlert[] {
    this.ensureHydrated();
    const fired: WatchAreaAlert[] = [];
    for (const area of this.areas.values()) {
      if (!area.enabled) continue;
      const threshold = area.thresholds[source.domain];
      if (threshold === undefined) continue;
      const sourceRank = severityRankOf(source.severity);
      const thresholdRank = SEVERITY_RANK[threshold];
      if (sourceRank < thresholdRank) continue;
      const distanceKm = source.lat !== undefined && source.lon !== undefined
        ? haversineKm(area.lat, area.lon, source.lat, source.lon)
        : Number.POSITIVE_INFINITY;
      if (Number.isFinite(distanceKm) && distanceKm > area.radiusKm) continue;
      fired.push(this.recordAlert(area, source, distanceKm));
    }
    return fired.map((a) => cloneAlert(a));
  }

  // ── Acknowledge / reads ────────────────────────────────────────────

  acknowledge(alertId: string): WatchAreaAlert | undefined {
    this.ensureHydrated();
    const idx = this.alerts.findIndex((a) => a.id === alertId);
    if (idx === -1) return undefined;
    const current = this.alerts[idx]!;
    if (current.acknowledged) return cloneAlert(current);
    const next: WatchAreaAlert = { ...current, acknowledged: true };
    this.alerts[idx] = next;
    this.persistAlerts();
    return cloneAlert(next);
  }

  getAlerts(filter: AlertFilter = {}, limit?: number): WatchAreaAlert[] {
    this.ensureHydrated();
    const matched = this.alerts.filter((a) => {
      if (filter.watchAreaId && a.watchAreaId !== filter.watchAreaId) return false;
      if (filter.acknowledged !== undefined && a.acknowledged !== filter.acknowledged) return false;
      return true;
    });
    const ordered: WatchAreaAlert[] = [];
    for (let i = matched.length - 1; i >= 0; i -= 1) ordered.push(matched[i]!);
    const capped = typeof limit === 'number' ? ordered.slice(0, Math.max(0, limit)) : ordered;
    return capped.map((a) => cloneAlert(a));
  }

  getStats(): WatchAreaStats {
    this.ensureHydrated();
    let enabledAreas = 0;
    for (const a of this.areas.values()) if (a.enabled) enabledAreas += 1;
    let unacknowledgedAlerts = 0;
    const alertsByArea: Record<string, number> = {};
    for (const a of this.alerts) {
      if (!a.acknowledged) unacknowledgedAlerts += 1;
      alertsByArea[a.watchAreaId] = (alertsByArea[a.watchAreaId] ?? 0) + 1;
    }
    return {
      totalAreas: this.areas.size,
      enabledAreas,
      totalAlerts: this.alerts.length,
      unacknowledgedAlerts,
      alertsByArea,
    };
  }

  subscribe(listener: WatchAreaListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  unsubscribe(listener: WatchAreaListener): void {
    this.listeners.delete(listener);
  }

  /** Test seam — clears state + persisted blobs. */
  resetForTesting(): void {
    this.areas.clear();
    this.alerts = [];
    this.listeners.clear();
    this.idSeq = 0;
    this.hydrated = true;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(AREAS_STORAGE_KEY); } catch { /* ignore */ }
      try { this.storage.removeItem(ALERTS_STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  private recordAlert(area: WatchArea, source: CheckSource, distanceKm: number): WatchAreaAlert {
    const now = this.clock();
    this.idSeq += 1;
    const alert: WatchAreaAlert = {
      id: `waa-${now.toString(36)}-${this.idSeq}`,
      watchAreaId: area.id,
      watchAreaName: area.name,
      domain: source.domain,
      severity: source.severity,
      sourceId: source.id,
      sourceType: source.type,
      lat: source.lat,
      lon: source.lon,
      distanceKm: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(3)) : Number.POSITIVE_INFINITY,
      firedAt: now,
      acknowledged: false,
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
    return alert;
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.storage) return;
    this.hydrateAreas();
    this.hydrateAlerts();
  }

  private hydrateAreas(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(AREAS_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: WatchArea[] | null;
    try { parsed = JSON.parse(raw) as WatchArea[] | null; }
    catch { return; }
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (entry && typeof entry.id === 'string') {
        this.areas.set(entry.id, { ...entry, thresholds: { ...entry.thresholds } });
      }
    }
  }

  private hydrateAlerts(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(ALERTS_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: WatchAreaAlert[] | null;
    try { parsed = JSON.parse(raw) as WatchAreaAlert[] | null; }
    catch { return; }
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (entry && typeof entry.id === 'string') this.alerts.push({ ...entry });
    }
  }

  private persistAreas(): void {
    if (!this.storage) return;
    const payload = [...this.areas.values()];
    try {
      this.storage.setItem(AREAS_STORAGE_KEY, JSON.stringify(payload));
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

let _singleton: WatchAreaAlertingService | null = null;

export function getWatchAreaAlertingService(): WatchAreaAlertingService {
  _singleton ??= new WatchAreaAlertingService();
  return _singleton;
}

export function __resetWatchAreaAlertingServiceSingleton(): void {
  _singleton = null;
}

export const __internals = {
  SEVERITY_RANK,
  MAX_ALERTS,
  severityRankOf,
};
