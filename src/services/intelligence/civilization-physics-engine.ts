/**
 * Civilization Physics Engine — models pressure accumulation and release
 * across geopolitical, economic, and social domains. Analogous to tectonic
 * stress: systems build pressure over time and release it catastrophically
 * when a threshold is crossed.
 *
 * Eight pre-seeded systems cover the major civilizational fault lines.
 * Pure store: injectable Storage + clock. Events persist in a 500-record
 * ring buffer under `wm-civilization-physics`.
 */

// ── Public types ──────────────────────────────────────────────────────────

export type PressureStatus = 'stable' | 'building' | 'critical' | 'releasing';
export type PressureEventType = 'accumulation' | 'release' | 'spike';

export interface PressureSystem {
  id: string;
  domain: string;
  region: string;
  pressure: number;
  releaseThreshold: number;
  accumulationRate: number;
  lastReleaseAt?: number;
  status: PressureStatus;
}

export interface PressureEvent {
  systemId: string;
  timestamp: number;
  deltaPressure: number;
  eventType: PressureEventType;
  trigger: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CivilizationPhysicsEngineOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-civilization-physics';
export const MAX_EVENTS = 500;
export const HOUR_MS = 60 * 60 * 1000;

// ── Seeded systems ────────────────────────────────────────────────────────

const SEED_SYSTEMS: Omit<PressureSystem, 'status'>[] = [
  { id: 'us-china-trade',        domain: 'trade',         region: 'Pacific',        pressure: 72, releaseThreshold: 85, accumulationRate: 1.2 },
  { id: 'middle-east-geo',       domain: 'geopolitical',  region: 'Middle East',    pressure: 65, releaseThreshold: 80, accumulationRate: 1.5 },
  { id: 'european-energy',       domain: 'energy',        region: 'Europe',         pressure: 58, releaseThreshold: 75, accumulationRate: 0.9 },
  { id: 'global-debt',           domain: 'financial',     region: 'Global',         pressure: 78, releaseThreshold: 90, accumulationRate: 0.7 },
  { id: 'social-inequality',     domain: 'social',        region: 'Global',         pressure: 54, releaseThreshold: 70, accumulationRate: 0.5 },
  { id: 'cyber-infrastructure',  domain: 'cyber',         region: 'Global',         pressure: 47, releaseThreshold: 72, accumulationRate: 1.1 },
  { id: 'climate-migration',     domain: 'climate',       region: 'Global',         pressure: 61, releaseThreshold: 78, accumulationRate: 0.6 },
  { id: 'nuclear-proliferation', domain: 'nuclear',       region: 'Global',         pressure: 43, releaseThreshold: 95, accumulationRate: 0.3 },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function statusFor(pressure: number, threshold: number): PressureStatus {
  if (pressure >= threshold) return 'releasing';
  if (pressure >= 90) return 'critical';
  if (pressure >= 60) return 'critical';
  if (pressure >= 30) return 'building';
  return 'stable';
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function deserializeEvent(raw: unknown): PressureEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.systemId !== 'string' || typeof r.timestamp !== 'number') return null;
  if (typeof r.deltaPressure !== 'number' || typeof r.trigger !== 'string') return null;
  const validTypes: PressureEventType[] = ['accumulation', 'release', 'spike'];
  if (!validTypes.includes(r.eventType as PressureEventType)) return null;
  return {
    systemId: r.systemId,
    timestamp: r.timestamp,
    deltaPressure: r.deltaPressure,
    eventType: r.eventType as PressureEventType,
    trigger: r.trigger,
  };
}

function rehydrateEvents(storage: StorageLike | null): PressureEvent[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: PressureEvent[] = [];
  for (const item of parsed) {
    const e = deserializeEvent(item);
    if (e) out.push(e);
  }
  return out;
}

// ── Class ─────────────────────────────────────────────────────────────────

export class CivilizationPhysicsEngine {
  private static _instance: CivilizationPhysicsEngine | null = null;

  static getInstance(): CivilizationPhysicsEngine {
    CivilizationPhysicsEngine._instance ??= new CivilizationPhysicsEngine();
    return CivilizationPhysicsEngine._instance;
  }

  static _resetSingletonForTests(): void {
    CivilizationPhysicsEngine._instance = null;
  }

  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly systems: Map<string, PressureSystem>;
  private readonly events: PressureEvent[];
  private readonly subscribers: ((e: PressureEvent) => void)[];
  private lastTickAt: number;

  constructor(options: CivilizationPhysicsEngineOptions = {}) {
    this.storage = resolveStorage(options.storage);
    this.clock = options.now ?? (() => Date.now());
    this.events = rehydrateEvents(this.storage);
    this.subscribers = [];
    this.lastTickAt = this.clock();

    this.systems = new Map();
    for (const seed of SEED_SYSTEMS) {
      this.systems.set(seed.id, {
        ...seed,
        status: statusFor(seed.pressure, seed.releaseThreshold),
      });
    }
  }

  accumulatePressure(systemId: string, delta: number, trigger: string): void {
    const sys = this.systems.get(systemId);
    if (!sys) return;

    const newPressure = Math.min(100, sys.pressure + delta);
    sys.pressure = newPressure;
    sys.status = statusFor(newPressure, sys.releaseThreshold);

    const event = this.recordEvent(systemId, delta, 'accumulation', trigger);
    this.notify(event);

    if (newPressure >= sys.releaseThreshold) {
      this.triggerRelease(systemId);
    }
  }

  triggerRelease(systemId: string): void {
    const sys = this.systems.get(systemId);
    if (!sys) return;

    const released = sys.releaseThreshold * 0.8;
    const before = sys.pressure;
    sys.pressure = Math.max(0, sys.pressure - released);
    sys.lastReleaseAt = this.clock();
    sys.status = statusFor(sys.pressure, sys.releaseThreshold);

    const event = this.recordEvent(systemId, -(before - sys.pressure), 'release', 'threshold-release');
    this.notify(event);
  }

  tick(now: number): void {
    const elapsed = now - this.lastTickAt;
    if (elapsed <= 0) return;
    this.lastTickAt = now;

    const hours = elapsed / HOUR_MS;
    for (const sys of this.systems.values()) {
      const delta = sys.accumulationRate * hours;
      if (delta > 0) {
        this.accumulatePressure(sys.id, delta, 'tick');
      }
    }
  }

  subscribe(callback: (event: PressureEvent) => void): void {
    this.subscribers.push(callback);
  }

  getSystems(): PressureSystem[] {
    return [...this.systems.values()]
      .sort((a, b) => b.pressure - a.pressure)
      .map(s => ({ ...s }));
  }

  getEvents(): PressureEvent[] {
    return [...this.events];
  }

  private recordEvent(
    systemId: string,
    delta: number,
    eventType: PressureEventType,
    trigger: string,
  ): PressureEvent {
    const event: PressureEvent = {
      systemId,
      timestamp: this.clock(),
      deltaPressure: delta,
      eventType,
      trigger,
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
    this.persist();
    return event;
  }

  private notify(event: PressureEvent): void {
    for (const cb of this.subscribers) {
      try { cb(event); } catch { /* subscriber errors are non-fatal */ }
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.events));
    } catch { /* quota / private-mode — non-critical */ }
  }
}
