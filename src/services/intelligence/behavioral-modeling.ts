/**
 * BehavioralModelingService — predict how populations, governments, and
 * institutional actors respond to different stress levels.
 *
 * Distinct from `behavioral-response.ts` (which tracks the time-phased
 * response curve of a single in-flight event). This service answers a
 * different question: given an archetype (e.g. "democratic-population")
 * and a stress level on the 0–4 INFO/LOW/MEDIUM/HIGH/CRITICAL scale,
 * what behavior should we expect, and how intensely?
 *
 * Each archetype has a hand-seeded `stressResponseCurve` of (stressLevel,
 * responseIntensity, behaviorType) anchor points. `predictResponse`
 * linearly interpolates intensity between anchors and picks the
 * behaviorType of the nearest anchor. Confidence drops the further the
 * query stress level sits from any anchor.
 *
 * `recordObservedBehavior` is the calibration hook: when the observed
 * behaviorType doesn't match the prediction for that stress range,
 * `escalationThreshold` nudges by ±0.1 (clamped 0–4) so future
 * predictions for that archetype shift.
 *
 * Pure / deterministic / no DOM / no fetch. Injectable Storage.
 */

// ── Public types ─────────────────────────────────────────────────────────

export type BehaviorType = 'compliance' | 'adaptation' | 'resistance' | 'collapse';

export interface StressPoint {
  /** Stress on the 0–4 INFO/LOW/MEDIUM/HIGH/CRITICAL scale. */
  stressLevel: number;
  /** 0–1 normalized response intensity at this stress level. */
  responseIntensity: number;
  /** Qualitative behavior at this stress level. */
  behaviorType: BehaviorType;
}

export interface BehavioralArchetype {
  id: string;
  name: string;
  description: string;
  /** Hand-seeded anchor points sorted ascending by stressLevel. */
  stressResponseCurve: StressPoint[];
  /** Plain-English examples of what the archetype typically does. */
  typicalReactions: string[];
  /**
   * Stress level at which the archetype's behavior tips from
   * compliance/adaptation into resistance/collapse. Used by callers to
   * flag "this archetype is about to flip"; adjusted by
   * `recordObservedBehavior` when reality disagrees with predictions.
   */
  escalationThreshold: number;
}

export interface BehavioralPrediction {
  archetypeId: string;
  region: string;
  stressLevel: number;
  predictedBehavior: string;
  responseIntensity: number;
  behaviorType: BehaviorType;
  /** 0–1: nearer to an anchor → higher confidence. */
  confidence: number;
}

export interface BehavioralObservation {
  archetypeId: string;
  region: string;
  stressLevel: number;
  actualBehaviorType: BehaviorType;
  observedAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface BehavioralModelingOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-behavioral-modeling';
export const MAX_OBSERVATIONS = 200;
export const THRESHOLD_NUDGE = 0.1;
export const STRESS_MIN = 0;
export const STRESS_MAX = 4;

const DEFAULT_REGION = 'global';

// ── Seed archetypes ──────────────────────────────────────────────────────

function seedArchetypes(): BehavioralArchetype[] {
  return [
    {
      id: 'democratic-population',
      name: 'Democratic Population',
      description:
        'Citizens in liberal democracies with strong civil-society institutions, free press, and a tradition of collective action.',
      stressResponseCurve: [
        { stressLevel: 0, responseIntensity: 0.05, behaviorType: 'compliance' },
        { stressLevel: 1, responseIntensity: 0.2, behaviorType: 'compliance' },
        { stressLevel: 2, responseIntensity: 0.5, behaviorType: 'adaptation' },
        { stressLevel: 3, responseIntensity: 0.75, behaviorType: 'resistance' },
        { stressLevel: 4, responseIntensity: 0.95, behaviorType: 'resistance' },
      ],
      typicalReactions: [
        'organize peaceful protests and petition campaigns',
        'shift consumption patterns and hoard essentials',
        'pressure elected representatives via media and town halls',
        'form mutual-aid networks for the affected',
      ],
      escalationThreshold: 2.8,
    },
    {
      id: 'authoritarian-population',
      name: 'Authoritarian Population',
      description:
        'Citizens under regimes that suppress dissent — visible compliance masks a much higher latent stress response.',
      stressResponseCurve: [
        { stressLevel: 0, responseIntensity: 0.02, behaviorType: 'compliance' },
        { stressLevel: 1, responseIntensity: 0.08, behaviorType: 'compliance' },
        { stressLevel: 2, responseIntensity: 0.25, behaviorType: 'compliance' },
        { stressLevel: 3, responseIntensity: 0.55, behaviorType: 'adaptation' },
        { stressLevel: 4, responseIntensity: 0.9, behaviorType: 'collapse' },
      ],
      typicalReactions: [
        'public compliance with private hoarding and emigration prep',
        'underground networks and informal trade',
        'sudden, rare flashpoints that surprise observers',
        'regime brittleness that fails catastrophically once tipped',
      ],
      escalationThreshold: 3.4,
    },
    {
      id: 'democratic-government',
      name: 'Democratic Government',
      description:
        'Elected governments accountable to voters, media, and courts — slower to act but more legitimate when they do.',
      stressResponseCurve: [
        { stressLevel: 0, responseIntensity: 0.1, behaviorType: 'compliance' },
        { stressLevel: 1, responseIntensity: 0.3, behaviorType: 'compliance' },
        { stressLevel: 2, responseIntensity: 0.55, behaviorType: 'adaptation' },
        { stressLevel: 3, responseIntensity: 0.8, behaviorType: 'adaptation' },
        { stressLevel: 4, responseIntensity: 0.95, behaviorType: 'resistance' },
      ],
      typicalReactions: [
        'invoke emergency powers under existing statutes',
        'fiscal stimulus and targeted relief programs',
        'diplomatic coordination with allies',
        'fall back on judicial review when actions overreach',
      ],
      escalationThreshold: 3,
    },
    {
      id: 'authoritarian-government',
      name: 'Authoritarian Government',
      description:
        'Regimes optimized for regime survival — quick coercive action, opaque decision making, prone to overreach.',
      stressResponseCurve: [
        { stressLevel: 0, responseIntensity: 0.15, behaviorType: 'compliance' },
        { stressLevel: 1, responseIntensity: 0.4, behaviorType: 'adaptation' },
        { stressLevel: 2, responseIntensity: 0.7, behaviorType: 'resistance' },
        { stressLevel: 3, responseIntensity: 0.88, behaviorType: 'resistance' },
        { stressLevel: 4, responseIntensity: 0.98, behaviorType: 'collapse' },
      ],
      typicalReactions: [
        'mass arrests and information blackouts',
        'mobilize internal security and paramilitary forces',
        'scapegoat external adversaries to rally support',
        'lethal crackdowns once regime survival is threatened',
      ],
      escalationThreshold: 2.2,
    },
    {
      id: 'international-institution',
      name: 'International Institution',
      description:
        'Multilateral bodies (UN, IMF, WHO, NATO) — slow consensus mechanics, ceiling on coercive power.',
      stressResponseCurve: [
        { stressLevel: 0, responseIntensity: 0.05, behaviorType: 'compliance' },
        { stressLevel: 1, responseIntensity: 0.15, behaviorType: 'compliance' },
        { stressLevel: 2, responseIntensity: 0.35, behaviorType: 'adaptation' },
        { stressLevel: 3, responseIntensity: 0.55, behaviorType: 'adaptation' },
        { stressLevel: 4, responseIntensity: 0.7, behaviorType: 'adaptation' },
      ],
      typicalReactions: [
        'convene emergency sessions and issue resolutions',
        'release humanitarian funds and deploy observers',
        'sanction violators within the limits of member consensus',
        'broker ceasefires and negotiation channels',
      ],
      escalationThreshold: 3.5,
    },
    {
      id: 'market-actor',
      name: 'Market Actor',
      description:
        'Banks, asset managers, and corporates — risk-aversion kicks in early, herd dynamics amplify late.',
      stressResponseCurve: [
        { stressLevel: 0, responseIntensity: 0.1, behaviorType: 'compliance' },
        { stressLevel: 1, responseIntensity: 0.35, behaviorType: 'adaptation' },
        { stressLevel: 2, responseIntensity: 0.65, behaviorType: 'adaptation' },
        { stressLevel: 3, responseIntensity: 0.85, behaviorType: 'resistance' },
        { stressLevel: 4, responseIntensity: 1, behaviorType: 'collapse' },
      ],
      typicalReactions: [
        'rebalance into defensive assets and raise cash',
        'tighten lending standards and hoard liquidity',
        'short the affected sector or geography',
        'fire-sale assets once margin calls cascade',
      ],
      escalationThreshold: 2.5,
    },
  ];
}

// ── Storage helpers ──────────────────────────────────────────────────────

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

interface PersistedStore {
  archetypes: BehavioralArchetype[];
  observations: BehavioralObservation[];
}

// ── Service ──────────────────────────────────────────────────────────────

export class BehavioralModelingService {
  private static instance: BehavioralModelingService | undefined;

  private readonly storage: StorageLike;
  private readonly now: () => number;
  private archetypes = new Map<string, BehavioralArchetype>();
  private observations: BehavioralObservation[] = [];

  private constructor(options: BehavioralModelingOptions = {}) {
    this.storage = options.storage ?? defaultStorage();
    this.now = options.now ?? (() => Date.now());
    this.hydrate();
    this.seedIfEmpty();
  }

  static getInstance(): BehavioralModelingService {
    BehavioralModelingService.instance ??= new BehavioralModelingService();
    return BehavioralModelingService.instance;
  }

  static createForTesting(options: BehavioralModelingOptions = {}): BehavioralModelingService {
    return new BehavioralModelingService(options);
  }

  /** Reset the process-wide singleton. Tests-only. */
  static resetForTesting(): void {
    BehavioralModelingService.instance = undefined;
  }

  // ── Read ────────────────────────────────────────────────────────────────

  getArchetypes(): BehavioralArchetype[] {
    return [...this.archetypes.values()].map((a) => cloneArchetype(a));
  }

  getArchetype(id: string): BehavioralArchetype | undefined {
    const a = this.archetypes.get(id);
    return a ? cloneArchetype(a) : undefined;
  }

  getObservations(): BehavioralObservation[] {
    return this.observations.map((o) => ({ ...o }));
  }

  // ── Predict ────────────────────────────────────────────────────────────

  predictResponse(
    archetypeId: string,
    stressLevel: number,
    region: string = DEFAULT_REGION,
  ): BehavioralPrediction {
    const archetype = this.archetypes.get(archetypeId);
    if (!archetype) {
      throw new Error(`Unknown archetype id: "${archetypeId}"`);
    }
    if (!Number.isFinite(stressLevel)) {
      throw new TypeError(`stressLevel must be a finite number; got ${stressLevel}`);
    }

    const clamped = clamp(stressLevel, STRESS_MIN, STRESS_MAX);
    const interp = interpolate(archetype.stressResponseCurve, clamped);
    const nearest = nearestAnchor(archetype.stressResponseCurve, clamped);
    const confidence = clamp(1 - Math.abs(clamped - nearest.stressLevel) / STRESS_MAX, 0, 1);

    return {
      archetypeId,
      region,
      stressLevel: clamped,
      predictedBehavior: describeBehavior(archetype, interp.behaviorType, interp.responseIntensity),
      responseIntensity: interp.responseIntensity,
      behaviorType: interp.behaviorType,
      confidence,
    };
  }

  // ── Calibrate ──────────────────────────────────────────────────────────

  recordObservedBehavior(
    archetypeId: string,
    stressLevel: number,
    actualBehaviorType: BehaviorType,
    region: string = DEFAULT_REGION,
  ): BehavioralObservation {
    const archetype = this.archetypes.get(archetypeId);
    if (!archetype) {
      throw new Error(`Unknown archetype id: "${archetypeId}"`);
    }
    if (!Number.isFinite(stressLevel)) {
      throw new TypeError(`stressLevel must be a finite number; got ${stressLevel}`);
    }

    const clamped = clamp(stressLevel, STRESS_MIN, STRESS_MAX);
    const observation: BehavioralObservation = {
      archetypeId,
      region,
      stressLevel: clamped,
      actualBehaviorType,
      observedAt: this.now(),
    };

    this.observations.push(observation);
    if (this.observations.length > MAX_OBSERVATIONS) {
      this.observations.splice(0, this.observations.length - MAX_OBSERVATIONS);
    }

    const predicted = interpolate(archetype.stressResponseCurve, clamped);
    if (predicted.behaviorType !== actualBehaviorType) {
      const direction = nudgeDirection(predicted.behaviorType, actualBehaviorType);
      const next = clamp(
        archetype.escalationThreshold + direction * THRESHOLD_NUDGE,
        STRESS_MIN,
        STRESS_MAX,
      );
      const updated: BehavioralArchetype = { ...archetype, escalationThreshold: next };
      this.archetypes.set(archetypeId, updated);
    }

    this.persist();
    return { ...observation };
  }

  // ── Persistence ────────────────────────────────────────────────────────

  private hydrate(): void {
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as PersistedStore;
      if (Array.isArray(parsed.archetypes)) {
        for (const a of parsed.archetypes) {
          if (isArchetype(a)) this.archetypes.set(a.id, a);
        }
      }
      if (Array.isArray(parsed.observations)) {
        this.observations = parsed.observations
          .filter((o) => isObservation(o))
          .slice(-MAX_OBSERVATIONS);
      }
    } catch {
      // Corrupt payload — drop it.
    }
  }

  private seedIfEmpty(): void {
    if (this.archetypes.size > 0) return;
    for (const a of seedArchetypes()) this.archetypes.set(a.id, a);
    this.persist();
  }

  private persist(): void {
    const payload: PersistedStore = {
      archetypes: [...this.archetypes.values()],
      observations: this.observations,
    };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Best-effort; ignore quota / serialization errors.
    }
  }
}

// ── Pure helpers (exported for tests) ────────────────────────────────────

export function interpolate(
  curve: readonly StressPoint[],
  stressLevel: number,
): { responseIntensity: number; behaviorType: BehaviorType } {
  if (curve.length === 0) {
    return { responseIntensity: 0, behaviorType: 'compliance' };
  }
  const sorted = [...curve].sort((a, b) => a.stressLevel - b.stressLevel);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  if (stressLevel <= first.stressLevel) {
    return { responseIntensity: first.responseIntensity, behaviorType: first.behaviorType };
  }
  if (stressLevel >= last.stressLevel) {
    return { responseIntensity: last.responseIntensity, behaviorType: last.behaviorType };
  }

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const lo = sorted[i]!;
    const hi = sorted[i + 1]!;
    if (stressLevel >= lo.stressLevel && stressLevel <= hi.stressLevel) {
      const span = hi.stressLevel - lo.stressLevel;
      const t = span === 0 ? 0 : (stressLevel - lo.stressLevel) / span;
      const responseIntensity =
        lo.responseIntensity + t * (hi.responseIntensity - lo.responseIntensity);
      // Behavior type follows the nearest anchor on the segment.
      const behaviorType = t < 0.5 ? lo.behaviorType : hi.behaviorType;
      return { responseIntensity, behaviorType };
    }
  }
  // Should be unreachable thanks to the boundary guards above.
  return { responseIntensity: last.responseIntensity, behaviorType: last.behaviorType };
}

export function nearestAnchor(
  curve: readonly StressPoint[],
  stressLevel: number,
): StressPoint {
  if (curve.length === 0) {
    return { stressLevel: 0, responseIntensity: 0, behaviorType: 'compliance' };
  }
  let best = curve[0]!;
  let bestDist = Math.abs(stressLevel - best.stressLevel);
  for (let i = 1; i < curve.length; i += 1) {
    const p = curve[i]!;
    const d = Math.abs(stressLevel - p.stressLevel);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

const BEHAVIOR_RANK: Record<BehaviorType, number> = {
  compliance: 0,
  adaptation: 1,
  resistance: 2,
  collapse: 3,
};

/**
 * Determine which direction to nudge the escalation threshold.
 *
 *   actual MORE intense than predicted → archetype escalates sooner than
 *   we thought → lower the threshold (negative).
 *
 *   actual LESS intense than predicted → archetype is more resilient
 *   than we thought → raise the threshold (positive).
 */
export function nudgeDirection(
  predicted: BehaviorType,
  actual: BehaviorType,
): number {
  const delta = BEHAVIOR_RANK[actual] - BEHAVIOR_RANK[predicted];
  if (delta > 0) return -1;
  if (delta < 0) return 1;
  return 0;
}

function describeBehavior(
  archetype: BehavioralArchetype,
  behaviorType: BehaviorType,
  intensity: number,
): string {
  const pct = Math.round(intensity * 100);
  switch (behaviorType) {
    case 'compliance': {
      return `${archetype.name}: largely compliant (${pct}% intensity) — expect baseline behavior with minor adjustments.`;
    }
    case 'adaptation': {
      return `${archetype.name}: actively adapting (${pct}% intensity) — expect policy shifts, hedging, and reallocation.`;
    }
    case 'resistance': {
      return `${archetype.name}: resisting (${pct}% intensity) — expect protest, dissent, or coercive pushback.`;
    }
    case 'collapse': {
      return `${archetype.name}: at risk of collapse (${pct}% intensity) — expect cascading failure or regime breakdown.`;
    }
  }
}

function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

function cloneArchetype(a: BehavioralArchetype): BehavioralArchetype {
  return {
    ...a,
    stressResponseCurve: a.stressResponseCurve.map((p) => ({ ...p })),
    typicalReactions: [...a.typicalReactions],
  };
}

function isArchetype(value: unknown): value is BehavioralArchetype {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.id === 'string' &&
    typeof a.name === 'string' &&
    typeof a.description === 'string' &&
    Array.isArray(a.stressResponseCurve) &&
    Array.isArray(a.typicalReactions) &&
    typeof a.escalationThreshold === 'number'
  );
}

function isObservation(value: unknown): value is BehavioralObservation {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.archetypeId === 'string' &&
    typeof o.region === 'string' &&
    typeof o.stressLevel === 'number' &&
    (o.actualBehaviorType === 'compliance' ||
      o.actualBehaviorType === 'adaptation' ||
      o.actualBehaviorType === 'resistance' ||
      o.actualBehaviorType === 'collapse') &&
    typeof o.observedAt === 'number'
  );
}
