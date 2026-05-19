/**
 * MissionBridgeCore — standardized adapter infrastructure for connecting
 * raw domain feeds to the intelligence pipeline's ObservationEvent
 * schema.
 *
 * Every domain feed lives behind a `MissionBridgeBase` subclass that
 * implements two operations: `fetchRaw()` returning untyped provider
 * payloads, and `normalize(raw)` mapping one payload to one
 * `ObservationEvent` (or null to skip). The base orchestrates the
 * fetch-normalize-cap cycle, tracks per-bridge stats, and persists
 * stats to local storage.
 *
 * `MissionBridgeRegistry` is the process-wide singleton that owns the
 * set of registered bridges. The host registers a bridge once at boot
 * and calls `registry.runAll()` on a refresh tick to drain every
 * domain.
 *
 * Pure / deterministic given a fetch oracle. Injectable Storage + clock
 * so unit tests can pin behavior without DOM/fetch.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

// ── Public types ─────────────────────────────────────────────────────────

export interface MissionBridgeConfig {
  domain: string;
  feedId: string;
  refreshIntervalMs: number;
  maxObservationsPerCycle: number;
  enabled: boolean;
}

export interface MissionBridgeStats {
  /** Number of times processCycle() has been invoked end-to-end. */
  cyclesRun: number;
  /** Total ObservationEvents produced across the lifetime of the bridge. */
  totalObservations: number;
  /** Count of normalize() returning null (i.e. skipped / unparseable). */
  nullSkipped: number;
  /** Unix epoch ms of the most recent processCycle() completion; 0 if never. */
  lastCycleAt: number;
  /** Count of recordError() invocations. */
  errorCount: number;
  /** Most recent error message (kept short for the dashboard). */
  lastError: string | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface MissionBridgeOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-mission-bridge-stats';
export const MAX_PERSISTED_BRIDGES = 200;
const MAX_ERROR_MSG_LEN = 280;

// ── Base ─────────────────────────────────────────────────────────────────

/**
 * Subclasses must implement `fetchRaw()` and `normalize()`. Construction
 * is gated behind `super(config, options)`; the base initialises stats,
 * hydrates from storage, and exposes the standardized lifecycle.
 */
export abstract class MissionBridgeBase {
  protected readonly config: MissionBridgeConfig;
  protected readonly storage: StorageLike;
  protected readonly now: () => number;
  protected stats: MissionBridgeStats;

  protected constructor(config: MissionBridgeConfig, options: MissionBridgeOptions = {}) {
    if (!config.domain) throw new Error('MissionBridgeBase: domain is required');
    if (!config.feedId) throw new Error('MissionBridgeBase: feedId is required');
    if (config.maxObservationsPerCycle <= 0) {
      throw new Error('MissionBridgeBase: maxObservationsPerCycle must be > 0');
    }
    if (config.refreshIntervalMs <= 0) {
      throw new Error('MissionBridgeBase: refreshIntervalMs must be > 0');
    }
    this.config = { ...config };
    this.storage = options.storage ?? defaultStorage();
    this.now = options.now ?? (() => Date.now());
    this.stats = freshStats();
    this.hydrateStats();
  }

  /** Implemented by subclass — fetch the raw provider payloads. */
  abstract fetchRaw(): Promise<unknown[]>;

  /** Implemented by subclass — map one raw item to ObservationEvent (or null to skip). */
  abstract normalize(raw: unknown): ObservationEvent | null;

  /**
   * One refresh cycle: fetchRaw → normalize → cap at
   * maxObservationsPerCycle → return. Skipped items (normalize → null)
   * contribute to `nullSkipped` rather than the result list. Errors
   * raised by fetchRaw bubble up; the bridge records the error first so
   * the dashboard can show it.
   */
  async processCycle(): Promise<ObservationEvent[]> {
    if (!this.config.enabled) return [];
    let raw: unknown[];
    try {
      raw = await this.fetchRaw();
    } catch (error) {
      this.recordError(error instanceof Error ? error.message : String(error));
      throw error;
    }

    const out: ObservationEvent[] = [];
    let skipped = 0;
    for (const item of raw) {
      if (out.length >= this.config.maxObservationsPerCycle) break;
      const normalized = this.normalize(item);
      if (normalized === null) {
        skipped += 1;
        continue;
      }
      out.push(normalized);
    }

    this.stats = {
      ...this.stats,
      cyclesRun: this.stats.cyclesRun + 1,
      totalObservations: this.stats.totalObservations + out.length,
      nullSkipped: this.stats.nullSkipped + skipped,
      lastCycleAt: this.now(),
    };
    this.persistStats();
    return out;
  }

  getConfig(): MissionBridgeConfig {
    return { ...this.config };
  }

  getStats(): MissionBridgeStats {
    return { ...this.stats };
  }

  recordError(message: string): void {
    const truncated = message.length > MAX_ERROR_MSG_LEN
      ? `${message.slice(0, MAX_ERROR_MSG_LEN - 1)}…`
      : message;
    this.stats = {
      ...this.stats,
      errorCount: this.stats.errorCount + 1,
      lastError: truncated,
    };
    this.persistStats();
  }

  /** Reset stats only — config is preserved. Tests-only. */
  resetStatsForTesting(): void {
    this.stats = freshStats();
    this.persistStats();
  }

  // ── Persistence ───────────────────────────────────────────────────────

  private hydrateStats(): void {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, MissionBridgeStats>;
      const mine = parsed[this.config.feedId];
      if (mine && isStats(mine)) this.stats = { ...freshStats(), ...mine };
    } catch {
      // Corrupt blob — keep fresh stats.
    }
  }

  private persistStats(): void {
    let store: Record<string, MissionBridgeStats> = {};
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object') {
          store = parsed as Record<string, MissionBridgeStats>;
        }
      }
    } catch {
      store = {};
    }
    store[this.config.feedId] = this.stats;

    // Cap persisted bridges by dropping the least-recently-used ones if
    // the registry grows unbounded.
    const keys = Object.keys(store);
    if (keys.length > MAX_PERSISTED_BRIDGES) {
      const sorted = keys
        .map((k) => ({ k, t: store[k]?.lastCycleAt ?? 0 }))
        .sort((a, b) => a.t - b.t);
      const drop = sorted.slice(0, keys.length - MAX_PERSISTED_BRIDGES);
      for (const { k } of drop) delete store[k];
    }

    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // Best-effort.
    }
  }
}

// ── Registry ─────────────────────────────────────────────────────────────

export class MissionBridgeRegistry {
  private static instance: MissionBridgeRegistry | undefined;

  private readonly bridges = new Map<string, MissionBridgeBase>();

  static getInstance(): MissionBridgeRegistry {
    MissionBridgeRegistry.instance ??= new MissionBridgeRegistry();
    return MissionBridgeRegistry.instance;
  }

  static resetForTesting(): MissionBridgeRegistry {
    MissionBridgeRegistry.instance = new MissionBridgeRegistry();
    return MissionBridgeRegistry.instance;
  }

  register(bridge: MissionBridgeBase): void {
    const { feedId } = bridge.getConfig();
    this.bridges.set(feedId, bridge);
  }

  unregister(feedId: string): boolean {
    return this.bridges.delete(feedId);
  }

  getAll(): MissionBridgeBase[] {
    return [...this.bridges.values()];
  }

  getByDomain(domain: string): MissionBridgeBase[] {
    return this.getAll().filter((b) => b.getConfig().domain === domain);
  }

  getByFeedId(feedId: string): MissionBridgeBase | undefined {
    return this.bridges.get(feedId);
  }

  /**
   * Run every enabled bridge once and concatenate the produced
   * ObservationEvents. Errors from any individual bridge are recorded
   * on that bridge but do not abort the rest of the run.
   */
  async runAll(): Promise<ObservationEvent[]> {
    const out: ObservationEvent[] = [];
    for (const bridge of this.getAll()) {
      try {
        const cycle = await bridge.processCycle();
        out.push(...cycle);
      } catch {
        // recordError already captured the message inside processCycle.
      }
    }
    return out;
  }
}

// ── Built-in: Earthquake ─────────────────────────────────────────────────

/**
 * Raw USGS earthquake payload shape used by the built-in bridge. The
 * production fetcher comes from the host; tests supply a fake.
 */
export interface RawEarthquake {
  id: string;
  /** Magnitude on the Richter / moment-magnitude scale. */
  mag: number | null;
  /** Unix epoch ms when the quake occurred. */
  time: number;
  place: string;
  /** [lon, lat, depthKm] per the GeoJSON convention USGS uses. */
  coordinates: [number, number, number];
}

export interface EarthquakeMissionBridgeOptions extends MissionBridgeOptions {
  fetcher?: () => Promise<RawEarthquake[]>;
  config?: Partial<MissionBridgeConfig>;
}

const EARTHQUAKE_DEFAULT_CONFIG: MissionBridgeConfig = {
  domain: 'seismic',
  feedId: 'usgs-earthquake',
  refreshIntervalMs: 60_000,
  maxObservationsPerCycle: 100,
  enabled: true,
};

export class EarthquakeMissionBridge extends MissionBridgeBase {
  private readonly fetcher: () => Promise<RawEarthquake[]>;

  constructor(options: EarthquakeMissionBridgeOptions = {}) {
    super({ ...EARTHQUAKE_DEFAULT_CONFIG, ...options.config }, options);
    this.fetcher = options.fetcher ?? defaultEmptyFetcher;
  }

  override fetchRaw(): Promise<unknown[]> {
    return this.fetcher() as Promise<unknown[]>;
  }

  override normalize(raw: unknown): ObservationEvent | null {
    if (!isRawEarthquake(raw)) return null;
    const mag = raw.mag;
    if (mag === null || !Number.isFinite(mag)) return null;
    const severity = magnitudeToSeverity(mag);
    const [lon, lat] = raw.coordinates;
    return {
      id: `usgs-earthquake:${raw.id}`,
      sourceId: this.config.feedId,
      domain: this.config.domain,
      timestamp: raw.time,
      location: { lat, lon, radiusKm: estimateRadiusKm(mag) },
      severity,
      title: `M${mag.toFixed(1)} earthquake near ${raw.place}`,
      raw,
      entityIds: [],
      tags: ['earthquake', `severity-${severity.toLowerCase()}`],
    };
  }
}

/**
 * Magnitude → ObservationSeverity per spec:
 *   <3   → INFO     (0)
 *   <4   → LOW      (1)
 *   <5   → MEDIUM   (2)
 *   <6   → HIGH     (3)
 *   >=6  → CRITICAL (4)
 */
export function magnitudeToSeverity(magnitude: number): ObservationSeverity {
  if (!Number.isFinite(magnitude)) return 'INFO';
  if (magnitude < 3) return 'INFO';
  if (magnitude < 4) return 'LOW';
  if (magnitude < 5) return 'MEDIUM';
  if (magnitude < 6) return 'HIGH';
  return 'CRITICAL';
}

// Empirical: rupture length doubles roughly per magnitude unit.
function estimateRadiusKm(magnitude: number): number {
  if (!Number.isFinite(magnitude) || magnitude < 0) return 0;
  return Math.round(Math.max(1, 2 ** (magnitude - 2)));
}

function isRawEarthquake(value: unknown): value is RawEarthquake {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string') return false;
  if (typeof v.time !== 'number' || !Number.isFinite(v.time)) return false;
  if (typeof v.place !== 'string') return false;
  if (!Array.isArray(v.coordinates) || v.coordinates.length < 2) return false;
  const coords = v.coordinates as unknown[];
  const lon = coords[0];
  const lat = coords[1];
  if (typeof lon !== 'number' || typeof lat !== 'number') return false;
  if (!(v.mag === null || typeof v.mag === 'number')) return false;
  return true;
}

function defaultEmptyFetcher(): Promise<RawEarthquake[]> {
  return Promise.resolve([]);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function defaultStorage(): StorageLike {
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as { localStorage?: StorageLike };
    if (g.localStorage) return g.localStorage;
  }
  return {
    getItem: () => null,
    setItem: () => undefined,
  };
}

function freshStats(): MissionBridgeStats {
  return {
    cyclesRun: 0,
    totalObservations: 0,
    nullSkipped: 0,
    lastCycleAt: 0,
    errorCount: 0,
    lastError: null,
  };
}

function isStats(value: unknown): value is MissionBridgeStats {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.cyclesRun === 'number' &&
    typeof v.totalObservations === 'number' &&
    typeof v.nullSkipped === 'number' &&
    typeof v.lastCycleAt === 'number' &&
    typeof v.errorCount === 'number' &&
    (v.lastError === null || typeof v.lastError === 'string')
  );
}
