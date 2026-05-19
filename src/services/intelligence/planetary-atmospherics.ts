/**
 * Planetary Atmospherics Service — integrates atmospheric pressure and
 * climate systems into threat modeling by correlating weather extremes
 * with geopolitical, economic, social, health, food, and energy stress.
 *
 * Records discrete atmospheric events (heat domes, polar vortex
 * intrusions, atmospheric rivers, droughts, flood patterns, hurricane
 * clusters) and computes domain threat multipliers for each active event
 * in a queried region. getRegionalStress() aggregates active severity
 * into a single 0–10 signal for downstream compound-risk scoring.
 *
 * Pure store: injectable Storage + clock. No DOM, no fetch.
 */

// ── Public types ─────────────────────────────────────────────────────────

export type AtmosphericEventType =
  | 'heat-dome'
  | 'polar-vortex'
  | 'atmospheric-river'
  | 'drought'
  | 'flood-pattern'
  | 'hurricane-cluster';

export interface AtmosphericEvent {
  id: string;
  type: AtmosphericEventType;
  region: string;
  severity: number;
  startedAt: number;
  projectedEndAt?: number;
  affectedPopulation?: number;
  correlatedDomains: string[];
}

export interface AtmosphericThreatMultiplier {
  domain: string;
  region: string;
  multiplier: number;
  reason: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PlanetaryAtmosphericsOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-planetary-atmospherics';
export const MAX_EVENTS = 500;
export const REGIONAL_STRESS_CAP = 10;

export const EVENT_TYPES: AtmosphericEventType[] = [
  'heat-dome',
  'polar-vortex',
  'atmospheric-river',
  'drought',
  'flood-pattern',
  'hurricane-cluster',
];

// ── Threat multiplier rules ──────────────────────────────────────────────
//
// Each event type maps to domain multipliers that amplify existing threats.
// Multipliers are in [1.0, 3.0]. A multiplier of 1.0 means no amplification.

interface MultiplierRule {
  domain: string;
  multiplier: number;
  reason: string;
}

const MULTIPLIER_RULES: Record<AtmosphericEventType, MultiplierRule[]> = {
  'heat-dome': [
    { domain: 'health', multiplier: 2, reason: 'Heat-related illness and mortality spike during sustained high temperatures' },
    { domain: 'energy', multiplier: 1.8, reason: 'Cooling demand strains grids; outages cascade into social and economic disruption' },
    { domain: 'agriculture', multiplier: 1.6, reason: 'Crop stress reduces yields; livestock mortality rises above 40°C' },
    { domain: 'labor', multiplier: 1.4, reason: 'Outdoor work hours curtailed; productivity losses mount across construction and agriculture' },
  ],
  'polar-vortex': [
    { domain: 'energy', multiplier: 2.2, reason: 'Heating demand surges; natural gas and electricity infrastructure stressed beyond design limits' },
    { domain: 'supply-chain', multiplier: 1.9, reason: 'Transportation gridlock freezes last-mile logistics and port operations' },
    { domain: 'health', multiplier: 1.7, reason: 'Cold-related emergencies overwhelm hospital capacity; hypothermia risk in vulnerable populations' },
    { domain: 'agriculture', multiplier: 1.5, reason: 'Frost damage to winter crops; livestock losses in exposed operations' },
  ],
  'atmospheric-river': [
    { domain: 'infrastructure', multiplier: 2.1, reason: 'Flooding overwhelms drainage, damages roads, rail, and bridges' },
    { domain: 'supply-chain', multiplier: 1.8, reason: 'Road and rail closures interrupt cargo movement; port access impeded' },
    { domain: 'agriculture', multiplier: 1.7, reason: 'Field saturation prevents planting or harvest; crop losses mount' },
    { domain: 'housing', multiplier: 1.5, reason: 'Landslides and inundation displace populations and damage stock' },
  ],
  'drought': [
    { domain: 'food', multiplier: 2.5, reason: 'Reduced crop yields cascade into food price spikes and import dependency' },
    { domain: 'migration', multiplier: 2, reason: 'Water scarcity drives rural-to-urban displacement and cross-border movement' },
    { domain: 'energy', multiplier: 1.7, reason: 'Hydropower output falls; thermal plant cooling capacity reduced' },
    { domain: 'political', multiplier: 1.6, reason: 'Resource competition over water rights elevates inter-state and intra-state tension' },
  ],
  'flood-pattern': [
    { domain: 'infrastructure', multiplier: 2.3, reason: 'Sustained flooding degrades critical infrastructure beyond single-event capacity' },
    { domain: 'health', multiplier: 2, reason: 'Waterborne disease vectors multiply; sanitation systems overwhelmed' },
    { domain: 'economic', multiplier: 1.8, reason: 'Property losses, insurance claims, and business interruption accumulate' },
    { domain: 'migration', multiplier: 1.7, reason: 'Repeated flooding triggers permanent displacement from high-risk zones' },
  ],
  'hurricane-cluster': [
    { domain: 'infrastructure', multiplier: 2.8, reason: 'Multiple storm landfalls exhaust repair capacity; cascading grid and road failures' },
    { domain: 'economic', multiplier: 2.3, reason: 'Insurance capacity exhausted; federal aid pipelines strained by simultaneous events' },
    { domain: 'supply-chain', multiplier: 2.1, reason: 'Port closures and road damage disrupt just-in-time logistics across the region' },
    { domain: 'political', multiplier: 1.8, reason: 'Emergency management fatigue and resource allocation disputes surface under sustained pressure' },
  ],
};

// ── Seed archetypes ──────────────────────────────────────────────────────
//
// Four representative atmospheric events seeded at construction time.
// These document the model's expected input shape and prime the
// getThreatMultipliers / getRegionalStress outputs for new installations.

const SEED_EVENTS: Omit<AtmosphericEvent, 'id'>[] = [
  {
    type: 'heat-dome',
    region: 'North America / Southwest',
    severity: 3,
    startedAt: new Date('2026-06-15T00:00:00Z').getTime(),
    projectedEndAt: new Date('2026-07-10T00:00:00Z').getTime(),
    affectedPopulation: 28_000_000,
    correlatedDomains: ['health', 'energy', 'agriculture', 'labor'],
  },
  {
    type: 'drought',
    region: 'East Africa',
    severity: 4,
    startedAt: new Date('2025-09-01T00:00:00Z').getTime(),
    affectedPopulation: 55_000_000,
    correlatedDomains: ['food', 'migration', 'energy', 'political'],
  },
  {
    type: 'hurricane-cluster',
    region: 'Gulf of Mexico',
    severity: 3,
    startedAt: new Date('2026-09-01T00:00:00Z').getTime(),
    projectedEndAt: new Date('2026-11-30T00:00:00Z').getTime(),
    affectedPopulation: 20_000_000,
    correlatedDomains: ['infrastructure', 'economic', 'supply-chain', 'political'],
  },
  {
    type: 'atmospheric-river',
    region: 'Western Europe',
    severity: 2,
    startedAt: new Date('2026-01-10T00:00:00Z').getTime(),
    projectedEndAt: new Date('2026-02-15T00:00:00Z').getTime(),
    affectedPopulation: 12_000_000,
    correlatedDomains: ['infrastructure', 'supply-chain', 'agriculture', 'housing'],
  },
];

// ── Persistence helpers ──────────────────────────────────────────────────

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function cloneEvent(e: AtmosphericEvent): AtmosphericEvent {
  return { ...e, correlatedDomains: [...e.correlatedDomains] };
}

function isValidEventType(t: unknown): t is AtmosphericEventType {
  return EVENT_TYPES.includes(t as AtmosphericEventType);
}

function deserializeEvent(raw: unknown): AtmosphericEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (!isValidEventType(r.type)) return null;
  if (typeof r.region !== 'string') return null;
  if (typeof r.severity !== 'number') return null;
  if (typeof r.startedAt !== 'number') return null;
  if (!Array.isArray(r.correlatedDomains)) return null;
  return {
    id: r.id,
    type: r.type,
    region: r.region,
    severity: Math.max(0, Math.min(4, r.severity)),
    startedAt: r.startedAt,
    projectedEndAt: typeof r.projectedEndAt === 'number' ? r.projectedEndAt : undefined,
    affectedPopulation: typeof r.affectedPopulation === 'number' ? r.affectedPopulation : undefined,
    correlatedDomains: (r.correlatedDomains as unknown[]).filter((v): v is string => typeof v === 'string'),
  };
}

function rehydrate(storage: StorageLike | null): AtmosphericEvent[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return (parsed as unknown[])
    .map((e) => deserializeEvent(e))
    .filter((e): e is AtmosphericEvent => e !== null);
}

function makeSeedId(type: string, region: string): string {
  return `seed:${type}:${region.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9:-]/g, '')}`;
}

// ── Class ────────────────────────────────────────────────────────────────

export class PlanetaryAtmosphericsService {
  private static _instance: PlanetaryAtmosphericsService | null = null;

  static getInstance(): PlanetaryAtmosphericsService {
    PlanetaryAtmosphericsService._instance ??= new PlanetaryAtmosphericsService();
    return PlanetaryAtmosphericsService._instance;
  }

  static _resetSingletonForTests(): void {
    PlanetaryAtmosphericsService._instance = null;
  }

  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly events: AtmosphericEvent[];

  constructor(options: PlanetaryAtmosphericsOptions = {}) {
    this.storage = resolveStorage(options.storage);
    this.clock = options.now ?? (() => Date.now());
    this.events = rehydrate(this.storage);
    this.seedIfMissing();
  }

  recordEvent(event: AtmosphericEvent): void {
    const idx = this.events.findIndex((e) => e.id === event.id);
    const clamped: AtmosphericEvent = {
      ...event,
      severity: Math.max(0, Math.min(4, event.severity)),
      correlatedDomains: [...event.correlatedDomains],
    };
    if (idx === -1) {
      this.events.push(clamped);
      this.capBuffer();
    } else {
      this.events[idx] = clamped;
    }
    this.persist();
  }

  getActive(): AtmosphericEvent[] {
    const now = this.clock();
    return this.events
      .filter((e) => e.projectedEndAt === undefined || e.projectedEndAt > now)
      .map((e) => cloneEvent(e));
  }

  getThreatMultipliers(region: string): AtmosphericThreatMultiplier[] {
    const now = this.clock();
    const active = this.events.filter(
      (e) =>
        this.regionMatches(e.region, region) &&
        (e.projectedEndAt === undefined || e.projectedEndAt > now),
    );
    const result: AtmosphericThreatMultiplier[] = [];
    for (const event of active) {
      const rules = MULTIPLIER_RULES[event.type];
      const severityScale = Math.max(1, event.severity) / 4;
      for (const rule of rules) {
        const scaled = 1 + (rule.multiplier - 1) * severityScale;
        result.push({
          domain: rule.domain,
          region,
          multiplier: Math.round(scaled * 100) / 100,
          reason: `[${event.type}] ${rule.reason}`,
        });
      }
    }
    return result;
  }

  getRegionalStress(region: string): number {
    const now = this.clock();
    const total = this.events
      .filter(
        (e) =>
          this.regionMatches(e.region, region) &&
          (e.projectedEndAt === undefined || e.projectedEndAt > now),
      )
      .reduce((sum, e) => sum + e.severity, 0);
    return Math.min(total, REGIONAL_STRESS_CAP);
  }

  private regionMatches(eventRegion: string, query: string): boolean {
    const a = eventRegion.toLowerCase();
    const b = query.toLowerCase();
    return a === b || a.includes(b) || b.includes(a);
  }

  private seedIfMissing(): void {
    for (const proto of SEED_EVENTS) {
      const id = makeSeedId(proto.type, proto.region);
      if (!this.events.some((e) => e.id === id)) {
        this.events.push({ ...proto, id, correlatedDomains: [...proto.correlatedDomains] });
      }
    }
    this.capBuffer();
    this.persist();
  }

  private capBuffer(): void {
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.events));
    } catch { /* quota / private-mode — non-critical */ }
  }
}
