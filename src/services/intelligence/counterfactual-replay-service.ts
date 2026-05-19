/**
 * CounterfactualReplayService — "what would have happened if X were
 * different?"
 *
 * Re-runs a saved bundle of past observations through `scoreEvent` (the
 * DriverScorer) with caller-supplied field modifications applied to deep
 * clones, then compares against the unmodified baseline to compute alert
 * count + max severity deltas.
 *
 * Persistence: localStorage `wm-counterfactual-replay`, capped at 100
 * scenarios (oldest-first eviction on overflow).
 *
 * Note on file location: the spec called for this in
 * `counterfactual-replay.ts`, but that path already hosts a wired-up
 * `CounterfactualReplayEngine` (panel + 460+ existing tests). This
 * service is therefore in a sibling file and can coexist without
 * disturbing the legacy engine.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';
import { scoreEvent, type ScoredEvent } from './driver-scorer';

// ── Public types ─────────────────────────────────────────────────────────

export interface Modification {
  /** id of the ObservationEvent in the baseline this modification targets. */
  observationId: string;
  /**
   * Dot-path into the event ("severity", "raw.magnitude", "location.lat").
   * The replay engine walks the path on a deep clone of the baseline event
   * and assigns `modifiedValue` to the leaf.
   */
  field: string;
  originalValue: unknown;
  modifiedValue: unknown;
}

export interface CounterfactualScenario {
  id: string;
  name: string;
  baselineObservations: ObservationEvent[];
  modifications: Modification[];
  /** ms-since-epoch the replay last ran. Undefined if never replayed. */
  replayedAt?: number;
  result?: ReplayResult;
}

export interface ReplayResult {
  scenarioId: string;
  originalAlertCount: number;
  modifiedAlertCount: number;
  /** modifiedAlertCount - originalAlertCount. Positive = scenario produced
   *  MORE alerts; negative = fewer; zero = no change. */
  deltaAlertCount: number;
  /** Maximum driver score across baseline / modified runs, in [0, 1]. */
  originalMaxSeverity: number;
  modifiedMaxSeverity: number;
  /** One-line plain-English summary of the delta. */
  summary: string;
}

// ── Tunables ─────────────────────────────────────────────────────────────

/**
 * Spec called for `wm-counterfactual-replay`, but the existing legacy
 * `CounterfactualReplayEngine` already owns that key (and stores a
 * differently-shaped `{ scenarios, results }` object). To avoid mutually
 * clobbering writes during the transition, the new service uses a v1
 * suffix until the legacy engine is retired.
 */
export const STORAGE_KEY = 'wm-counterfactual-replay-service-v1';
export const MAX_SCENARIOS = 100;
/** driverScore (in [0, 1]) at or above this counts as "would-alert". */
export const ALERT_THRESHOLD = 0.5;

const SEVERITY_INDEX: Record<ObservationSeverity, number> = {
  INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};

// ── Storage abstraction (testable) ────────────────────────────────────────

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    // Node's built-in localStorage polyfill (24+) only partially implements
    // the Storage interface — verify getItem/setItem are real functions
    // before trusting it.
    const ls = localStorage as unknown as StorageLike;
    if (typeof ls.getItem !== 'function' || typeof ls.setItem !== 'function') return null;
    return ls;
  } catch { return null; }
}

// ── Pure helpers ─────────────────────────────────────────────────────────

/**
 * Deep clone an event so modifications don't leak back into the baseline.
 * JSON round-trip is safe because ObservationEvent is data-only (the `raw`
 * field is provider JSON in practice).
 */
export function cloneEvent(event: ObservationEvent): ObservationEvent {
  // structuredClone exists on both Node 17+ and modern browsers and handles
  // nested objects + arrays without losing prototype information the way
  // JSON round-tripping does.
  return structuredClone(event);
}

/**
 * Apply one modification to a cloned event in place. Walks the `field`
 * dot-path. No-ops if the intermediate path doesn't resolve to an object,
 * so a typo in `field` silently doesn't crash a whole replay.
 */
export function applyModification(event: ObservationEvent, mod: Modification): void {
  const parts = mod.field.split('.').filter(Boolean);
  if (parts.length === 0) return;
  if (parts.length === 1) {
    (event as unknown as Record<string, unknown>)[parts[0]!] = mod.modifiedValue;
    return;
  }
  let cursor: Record<string, unknown> = event as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cursor[parts[i]!];
    if (next === null || next === undefined || typeof next !== 'object') return;
    cursor = next as Record<string, unknown>;
  }
  const leaf = parts[parts.length - 1]!;
  cursor[leaf] = mod.modifiedValue;
}

/**
 * Apply every modification whose `observationId` matches `event.id` to a
 * cloned copy. Returns the modified clone (original event untouched).
 */
export function applyModificationsToEvent(
  event: ObservationEvent,
  modifications: readonly Modification[],
): ObservationEvent {
  const clone = cloneEvent(event);
  for (const mod of modifications) {
    if (mod.observationId === event.id) applyModification(clone, mod);
  }
  return clone;
}

export interface RunStats {
  alertCount: number;
  maxSeverity: number;
}

/** Pure: count alerts (driverScore >= ALERT_THRESHOLD) + max severity. */
export function computeRunStats(scored: readonly ScoredEvent[]): RunStats {
  let alertCount = 0;
  let maxSeverity = 0;
  for (const s of scored) {
    if (s.driverScore >= ALERT_THRESHOLD) alertCount += 1;
    if (s.driverScore > maxSeverity) maxSeverity = s.driverScore;
  }
  return { alertCount, maxSeverity };
}

function summarizeAlertDelta(delta: number): string {
  if (delta === 0) return 'no change in alert count';
  const abs = Math.abs(delta);
  const plural = abs === 1 ? '' : 's';
  if (delta > 0) return `${abs} more alert${plural}`;
  return `${abs} fewer alert${plural}`;
}

function summarizeSeverityDelta(sevDelta: number): string {
  if (sevDelta === 0) return '';
  const sign = sevDelta > 0 ? '+' : '';
  return ` (max severity ${sign}${(sevDelta * 100).toFixed(0)}%)`;
}

/** Produce the plain-English summary line. */
export function buildSummary(original: RunStats, modified: RunStats): string {
  const direction = summarizeAlertDelta(modified.alertCount - original.alertCount);
  const sev = summarizeSeverityDelta(modified.maxSeverity - original.maxSeverity);
  return `Counterfactual produced ${direction}${sev}.`;
}

/** Convert an ObservationSeverity ladder rung into a 0..4 index. */
export function severityIndex(s: string): number {
  return SEVERITY_INDEX[s.toUpperCase() as ObservationSeverity] ?? 0;
}

// ── Parsing / persistence ─────────────────────────────────────────────────

export function parseScenarios(raw: string | null): CounterfactualScenario[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: CounterfactualScenario[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.name !== 'string') continue;
    if (!Array.isArray(r.baselineObservations) || !Array.isArray(r.modifications)) continue;
    out.push({
      id: r.id,
      name: r.name,
      baselineObservations: r.baselineObservations as ObservationEvent[],
      modifications: r.modifications as Modification[],
      replayedAt: typeof r.replayedAt === 'number' ? r.replayedAt : undefined,
      result: (r.result && typeof r.result === 'object') ? r.result as ReplayResult : undefined,
    });
  }
  return out;
}

// ── Service ──────────────────────────────────────────────────────────────

let _instance: CounterfactualReplayService | null = null;
let _idCounter = 0;

/** Reset the singleton (tests only). Passing null restores lazy init. */
export function _setInstanceForTests(instance: CounterfactualReplayService | null): void {
  _instance = instance;
}

export function _resetIdCounter(): void { _idCounter = 0; }

export class CounterfactualReplayService {
  private scenarios = new Map<string, CounterfactualScenario>();
  private readonly storage: StorageLike | null;
  private readonly now: () => number;

  constructor(storage: StorageLike | null = defaultStorage(), now: () => number = Date.now) {
    this.storage = storage;
    this.now = now;
    this.load();
  }

  static getInstance(): CounterfactualReplayService {
    _instance ??= new CounterfactualReplayService();
    return _instance;
  }

  /** Create a new scenario, persist it, evict oldest if over the cap. */
  createScenario(
    name: string,
    observations: readonly ObservationEvent[],
    modifications: readonly Modification[],
  ): CounterfactualScenario {
    if (!name.trim()) throw new Error('counterfactual: name required');
    const scenario: CounterfactualScenario = {
      id: this.nextId(),
      name: name.trim(),
      baselineObservations: observations.map((e) => cloneEvent(e)),
      modifications: modifications.map((m) => ({ ...m })),
    };
    this.scenarios.set(scenario.id, scenario);
    this.evictOverCap();
    this.persist();
    return { ...scenario };
  }

  /** Run (or re-run) the replay for a scenario. Throws on unknown id. */
  replayScenario(id: string): ReplayResult {
    const scenario = this.scenarios.get(id);
    if (!scenario) throw new Error(`counterfactual: unknown scenario id "${id}"`);

    const originalScored = scenario.baselineObservations.map((e) => scoreEvent(e));
    const modifiedScored = scenario.baselineObservations.map((e) =>
      scoreEvent(applyModificationsToEvent(e, scenario.modifications)),
    );

    const original = computeRunStats(originalScored);
    const modified = computeRunStats(modifiedScored);

    const result: ReplayResult = {
      scenarioId: scenario.id,
      originalAlertCount: original.alertCount,
      modifiedAlertCount: modified.alertCount,
      deltaAlertCount: modified.alertCount - original.alertCount,
      originalMaxSeverity: original.maxSeverity,
      modifiedMaxSeverity: modified.maxSeverity,
      summary: buildSummary(original, modified),
    };

    scenario.replayedAt = this.now();
    scenario.result = result;
    this.persist();
    return { ...result };
  }

  getScenarios(): CounterfactualScenario[] {
    return [...this.scenarios.values()].map((s) => ({ ...s }));
  }

  getScenario(id: string): CounterfactualScenario | undefined {
    const s = this.scenarios.get(id);
    return s ? { ...s } : undefined;
  }

  getResult(id: string): ReplayResult | undefined {
    const s = this.scenarios.get(id);
    return s?.result ? { ...s.result } : undefined;
  }

  deleteScenario(id: string): boolean {
    if (!this.scenarios.has(id)) return false;
    this.scenarios.delete(id);
    this.persist();
    return true;
  }

  /** Wipe every scenario. Test-only — no UI surface. */
  clearAll(): void {
    this.scenarios.clear();
    this.persist();
  }

  size(): number { return this.scenarios.size; }

  // ── Internals ────────────────────────────────────────────────────────

  private nextId(): string {
    _idCounter += 1;
    return `cf-${this.now().toString(36)}-${_idCounter}`;
  }

  private evictOverCap(): void {
    while (this.scenarios.size > MAX_SCENARIOS) {
      const oldest = this.scenarios.keys().next().value;
      if (oldest === undefined) break;
      this.scenarios.delete(oldest);
    }
  }

  private load(): void {
    const raw = this.storage?.getItem(STORAGE_KEY) ?? null;
    for (const s of parseScenarios(raw)) this.scenarios.set(s.id, s);
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const arr = [...this.scenarios.values()];
      this.storage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch { /* quota / disabled — best-effort */ }
  }
}
