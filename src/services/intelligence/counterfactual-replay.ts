/**
 * Counterfactual Replay — Phase 4 "what if X had been different?"
 *
 * Replays past observations with modified parameters to surface how
 * brittle a conclusion was. Each scenario captures a baseline
 * ObservationEvent + a list of modifications (severity, domain,
 * location, confidence, magnitude). `runReplay` applies the
 * modifications, re-scores the synthetic observation through a
 * self-contained deterministic scorer, and reports the outcome delta
 * with 2-3 insight strings.
 *
 * Self-contained scoring path (no upward imports on DriverScoringEngine
 * or HypothesisEngine) so the replay never mutates the live attention
 * allocator or the algorithm eval ledger. Pure module — no DOM, no
 * fetch, no globals at import time. Persists scenarios + results under
 * `wm-counterfactual-replay` (200 scenarios / 500 results ring).
 */

import type { ObservationEvent, ObservationSeverity } from './observation-adapters';
import type { ObservationLocation } from '@/types/intelligence';
import type { DerivedSeverity } from './driver-scores';

// ── Public types ──────────────────────────────────────────────────────

export type ReplayField =
  | 'severity'
  | 'domain'
  | 'location'
  | 'confidence'
  | 'magnitude';

export interface ReplayModification {
  field: ReplayField;
  originalValue: unknown;
  modifiedValue: unknown;
  rationale: string;
}

export interface ReplayScenario {
  id: string;
  name: string;
  description: string;
  baselineObservation: ObservationEvent;
  modifications: ReplayModification[];
  createdAt: number;
}

export interface ReplayResult {
  scenarioId: string;
  originalOutcome: string;
  replayedOutcome: string;
  /** Difference between the replayed and original numeric score
   *  (replayed - original). Positive means the modification made the
   *  situation look more severe. */
  deltaScore: number;
  insights: string[];
  ranAt: number;
}

export type ReplayListener = (state: { scenarios: ReplayScenario[]; results: ReplayResult[] }) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-counterfactual-replay';
const MAX_SCENARIOS = 200;
const MAX_RESULTS = 500;

const SEVERITY_TO_SCORE: Record<ObservationSeverity, number> = {
  INFO: 0.1,
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 0.7,
  CRITICAL: 0.9,
};

const SEVERITY_BANDS: { min: number; severity: DerivedSeverity }[] = [
  { min: 0.8, severity: 'critical' },
  { min: 0.6, severity: 'high' },
  { min: 0.35, severity: 'medium' },
  { min: 0, severity: 'low' },
];

// ── Helpers ───────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function readNumber(raw: unknown, ...keys: string[]): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

function severityForScore(score: number): DerivedSeverity {
  for (const band of SEVERITY_BANDS) {
    if (score >= band.min) return band.severity;
  }
  return 'low';
}

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function cloneLocation(loc: ObservationLocation | undefined): ObservationLocation | undefined {
  return loc ? { ...loc } : undefined;
}

function cloneRaw(raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== 'object') return raw;
  // Deep clone for the small object payloads observations typically
  // carry. Falls back to a shallow copy when structuredClone refuses
  // a non-cloneable value (functions, DOM nodes, etc.).
  try {
    return structuredClone(raw);
  } catch {
    if (Array.isArray(raw)) return [...(raw as unknown[])];
    return { ...(raw as Record<string, unknown>) };
  }
}

function cloneObservation(obs: ObservationEvent): ObservationEvent {
  return {
    ...obs,
    location: cloneLocation(obs.location),
    entityIds: [...obs.entityIds],
    tags: [...obs.tags],
    raw: cloneRaw(obs.raw),
  };
}

function cloneScenario(s: ReplayScenario): ReplayScenario {
  return {
    ...s,
    baselineObservation: cloneObservation(s.baselineObservation),
    modifications: s.modifications.map((m) => ({ ...m })),
  };
}

function cloneResult(r: ReplayResult): ReplayResult {
  return { ...r, insights: [...r.insights] };
}

// ── Scoring + modification application ────────────────────────────────

interface ScoredObservation {
  score: number;
  severity: DerivedSeverity;
}

/** Deterministic scorer used for replay only. Anchors on
 *  `ObservationEvent.severity` and bumps the score with magnitude /
 *  raw.confidence so modifications to those fields actually move the
 *  outcome. No side effects on any live singleton. */
export function scoreReplayObservation(obs: ObservationEvent): ScoredObservation {
  let score = SEVERITY_TO_SCORE[obs.severity] ?? 0.3;
  const magnitude = readNumber(obs.raw, 'magnitude', 'mag');
  if (magnitude !== null) {
    // Tied to a tight band around M5 so reasonable real-world earthquakes
    // move the score by realistic amounts (M3 → -0.10, M7 → +0.10).
    score += clamp01((magnitude - 5) * 0.05 + 0.5) - 0.5;
  }
  const rawConfidence = readNumber(obs.raw, 'confidence');
  if (rawConfidence !== null) {
    // Treat raw.confidence as a multiplier: confidence 1.0 leaves the
    // score; confidence 0.0 zeroes it out.
    score *= clamp01(rawConfidence);
  }
  const final = clamp01(score);
  return { score: final, severity: severityForScore(final) };
}

function asRawObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function applySeverityMod(obs: ObservationEvent, value: unknown): void {
  if (typeof value === 'string') obs.severity = value as ObservationSeverity;
}

function applyDomainMod(obs: ObservationEvent, value: unknown): void {
  if (typeof value === 'string') obs.domain = value;
}

function applyLocationMod(obs: ObservationEvent, value: unknown): void {
  if (value && typeof value === 'object') {
    obs.location = { ...(value as ObservationLocation) };
  } else if (value === null) {
    obs.location = undefined;
  }
}

function applyConfidenceMod(raw: Record<string, unknown>, value: unknown): void {
  if (typeof value === 'number') raw.confidence = value;
}

function applyMagnitudeMod(raw: Record<string, unknown>, value: unknown): void {
  if (typeof value === 'number') raw.magnitude = value;
}

function applyOneModification(
  obs: ObservationEvent,
  rawObj: Record<string, unknown>,
  mod: ReplayModification,
): void {
  switch (mod.field) {
    case 'severity':   { applySeverityMod(obs, mod.modifiedValue);   return; }
    case 'domain':     { applyDomainMod(obs, mod.modifiedValue);     return; }
    case 'location':   { applyLocationMod(obs, mod.modifiedValue);   return; }
    case 'confidence': { applyConfidenceMod(rawObj, mod.modifiedValue); return; }
    case 'magnitude':  { applyMagnitudeMod(rawObj, mod.modifiedValue);  return; }
  }
}

function applyModifications(
  obs: ObservationEvent,
  modifications: readonly ReplayModification[],
): ObservationEvent {
  const next = cloneObservation(obs);
  const rawObj = asRawObject(next.raw);
  for (const mod of modifications) applyOneModification(next, rawObj, mod);
  next.raw = rawObj;
  return next;
}

// ── Built-in templates ───────────────────────────────────────────────

const SEVERITY_DOWNGRADE: Record<ObservationSeverity, ObservationSeverity> = {
  CRITICAL: 'HIGH',
  HIGH: 'MEDIUM',
  MEDIUM: 'LOW',
  LOW: 'INFO',
  INFO: 'INFO',
};

/** Earth radius used to translate degrees into approximate km. */
const KM_PER_DEGREE = 111;

export function severityDowngradeTemplate(obs: ObservationEvent): ReplayModification[] {
  const target = SEVERITY_DOWNGRADE[obs.severity];
  return [{
    field: 'severity',
    originalValue: obs.severity,
    modifiedValue: target,
    rationale: `What if the initial classification had been ${target} instead of ${obs.severity}?`,
  }];
}

export function sourceReductionTemplate(obs: ObservationEvent): ReplayModification[] {
  // Source reduction is observable through a confidence drop: with one
  // fewer corroborating feed the effective confidence falls. We also
  // tag the rationale so the operator sees what was simulated.
  const existing = readNumber(obs.raw, 'confidence') ?? 1;
  const reduced = Math.max(0, +(existing * 0.5).toFixed(4));
  return [{
    field: 'confidence',
    originalValue: existing,
    modifiedValue: reduced,
    rationale: 'What if we had one fewer corroborating feed? Halve the effective confidence.',
  }];
}

export function locationShiftTemplate(obs: ObservationEvent): ReplayModification[] {
  const original: ObservationLocation = obs.location ?? { lat: 0, lon: 0 };
  // Shift roughly 1000 km north along the meridian. Clamp at the pole.
  const targetLat = Math.max(-89, Math.min(89, original.lat + 1000 / KM_PER_DEGREE));
  const modified: ObservationLocation = {
    lat: +targetLat.toFixed(4),
    lon: original.lon,
    radiusKm: original.radiusKm,
  };
  return [{
    field: 'location',
    originalValue: original,
    modifiedValue: modified,
    rationale: 'What if this had occurred ~1000 km away? Tests geographic relevance.',
  }];
}

export function timingShiftTemplate(obs: ObservationEvent): ReplayModification[] {
  const earlierMs = obs.timestamp - 6 * 60 * 60 * 1000;
  return [{
    field: 'confidence',
    originalValue: readNumber(obs.raw, 'confidence') ?? 1,
    modifiedValue: 0.85,
    rationale: `What if this arrived 6 h earlier (at ${new Date(earlierMs).toISOString()})? Earlier signals carry slightly lower observational confidence.`,
  }];
}

export interface ReplayTemplate {
  id: string;
  label: string;
  description: string;
  build: (obs: ObservationEvent) => ReplayModification[];
}

export const BUILT_IN_REPLAY_TEMPLATES: readonly ReplayTemplate[] = [
  {
    id: 'severity-downgrade',
    label: 'Severity downgrade',
    description: 'What if this had been classified one tier lower?',
    build: severityDowngradeTemplate,
  },
  {
    id: 'source-reduction',
    label: 'Source reduction',
    description: 'What if we had one fewer corroborating feed?',
    build: sourceReductionTemplate,
  },
  {
    id: 'location-shift',
    label: 'Location shift (~1000 km)',
    description: 'What if this had occurred ~1000 km away?',
    build: locationShiftTemplate,
  },
  {
    id: 'timing-shift',
    label: 'Timing shift (-6 h)',
    description: 'What if this had arrived 6 hours earlier?',
    build: timingShiftTemplate,
  },
];

// ── Insights ─────────────────────────────────────────────────────────

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return '[unserializable]'; }
  }
  // Restrict to the primitive types we actually pass in to keep
  // typescript-eslint's no-base-to-string happy without losing
  // intent.
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value.toString();
  return '[unknown]';
}

function buildInsights(
  modifications: readonly ReplayModification[],
  original: ScoredObservation,
  replayed: ScoredObservation,
  delta: number,
): string[] {
  const insights: string[] = [];
  // 1) Severity-band statement — always included.
  if (original.severity === replayed.severity) {
    insights.push(
      `Replayed severity remained "${original.severity}" (score Δ ${delta.toFixed(3)}). The modification did not cross a band boundary.`,
    );
  } else {
    insights.push(
      `Severity flipped from "${original.severity}" to "${replayed.severity}" (score Δ ${delta.toFixed(3)}).`,
    );
  }
  // 2) Per-modification line for the first 2 modifications. Keeps the
  //    list to the spec's "2-3 insight strings" while still echoing
  //    what was actually changed.
  for (const mod of modifications.slice(0, 2)) {
    insights.push(
      `If ${mod.field} were ${formatScalar(mod.modifiedValue)} instead of ${formatScalar(mod.originalValue)}: ${mod.rationale}`,
    );
  }
  return insights;
}

// ── Engine ────────────────────────────────────────────────────────────

export interface CounterfactualReplayOptions {
  clock?: () => number;
}

export class CounterfactualReplayEngine {
  private scenarios: ReplayScenario[] = [];
  private results: ReplayResult[] = [];
  private listeners = new Set<ReplayListener>();
  private hydrated = false;
  private idCounter = 0;
  private clock: () => number;

  constructor(options: CounterfactualReplayOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const store = safeStorage();
    if (!store) return;
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { scenarios?: unknown; results?: unknown };
      this.scenarios = deserializeScenarios(parsed.scenarios);
      this.results = deserializeResults(parsed.results);
    } catch {
      // Corrupt blob — start clean.
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify({ scenarios: this.scenarios, results: this.results }));
    } catch {
      // Quota or disabled — best-effort.
    }
  }

  private nextId(prefix: string, now: number): string {
    this.idCounter += 1;
    return `${prefix}-${now.toString(36)}-${this.idCounter}`;
  }

  private notify(): void {
    const snapshot = {
      scenarios: this.scenarios.map((s) => cloneScenario(s)),
      results: this.results.map((r) => cloneResult(r)),
    };
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  /** Persist a new replay scenario keyed off the given baseline
   *  observation + modifications. Returns a defensive copy. */
  createScenario(
    baseline: ObservationEvent,
    modifications: readonly ReplayModification[],
    name: string,
    description: string,
  ): ReplayScenario {
    this.ensureHydrated();
    const now = this.clock();
    const scenario: ReplayScenario = {
      id: this.nextId('cf', now),
      name,
      description,
      baselineObservation: cloneObservation(baseline),
      modifications: modifications.map((m) => ({ ...m })),
      createdAt: now,
    };
    this.scenarios.push(scenario);
    this.enforceScenarioCapacity();
    this.persist();
    this.notify();
    return cloneScenario(scenario);
  }

  /** Build a scenario from one of the built-in templates and the given
   *  baseline. Convenience wrapper around `createScenario`. */
  createFromTemplate(
    templateId: string,
    baseline: ObservationEvent,
    name?: string,
    description?: string,
  ): ReplayScenario | undefined {
    const tmpl = BUILT_IN_REPLAY_TEMPLATES.find((t) => t.id === templateId);
    if (!tmpl) return undefined;
    return this.createScenario(
      baseline,
      tmpl.build(baseline),
      name ?? tmpl.label,
      description ?? tmpl.description,
    );
  }

  /** Replay a scenario. Looks up the stored scenario, applies its
   *  modifications, scores both the baseline and the modified
   *  observation, and stores a fresh ReplayResult. Returns undefined
   *  when the scenarioId is unknown. */
  runReplay(scenarioId: string): ReplayResult | undefined {
    this.ensureHydrated();
    const scenario = this.scenarios.find((s) => s.id === scenarioId);
    if (!scenario) return undefined;
    const now = this.clock();
    const original = scoreReplayObservation(scenario.baselineObservation);
    const replayed = scoreReplayObservation(
      applyModifications(scenario.baselineObservation, scenario.modifications),
    );
    const deltaScore = +(replayed.score - original.score).toFixed(4);
    const result: ReplayResult = {
      scenarioId,
      originalOutcome: original.severity,
      replayedOutcome: replayed.severity,
      deltaScore,
      insights: buildInsights(scenario.modifications, original, replayed, deltaScore),
      ranAt: now,
    };
    this.results.push(result);
    this.enforceResultCapacity();
    this.persist();
    this.notify();
    return cloneResult(result);
  }

  private enforceScenarioCapacity(): void {
    if (this.scenarios.length <= MAX_SCENARIOS) return;
    this.scenarios.splice(0, this.scenarios.length - MAX_SCENARIOS);
  }

  private enforceResultCapacity(): void {
    if (this.results.length <= MAX_RESULTS) return;
    this.results.splice(0, this.results.length - MAX_RESULTS);
  }

  getScenario(scenarioId: string): ReplayScenario | undefined {
    this.ensureHydrated();
    const found = this.scenarios.find((s) => s.id === scenarioId);
    return found ? cloneScenario(found) : undefined;
  }

  getAllScenarios(): ReplayScenario[] {
    this.ensureHydrated();
    return this.scenarios.map((s) => cloneScenario(s));
  }

  getResults(scenarioId: string): ReplayResult[] {
    this.ensureHydrated();
    return this.results
      .filter((r) => r.scenarioId === scenarioId)
      .map((r) => cloneResult(r));
  }

  getAllResults(): ReplayResult[] {
    this.ensureHydrated();
    return this.results.map((r) => cloneResult(r));
  }

  subscribe(listener: ReplayListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties scenarios + results + the persisted blob. */
  resetForTesting(): void {
    this.scenarios = [];
    this.results = [];
    this.listeners.clear();
    this.idCounter = 0;
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* best effort */ }
    }
  }
}

// ── Persistence helpers ──────────────────────────────────────────────

function deserializeScenarios(raw: unknown): ReplayScenario[] {
  if (!Array.isArray(raw)) return [];
  const out: ReplayScenario[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as ReplayScenario;
    if (typeof e.id !== 'string' || typeof e.createdAt !== 'number') continue;
    if (!e.baselineObservation || typeof e.baselineObservation !== 'object') continue;
    if (!Array.isArray(e.modifications)) continue;
    out.push({
      ...e,
      baselineObservation: cloneObservation(e.baselineObservation),
      modifications: e.modifications.map((m) => ({ ...(m as ReplayModification) })),
    });
  }
  return out;
}

function deserializeResults(raw: unknown): ReplayResult[] {
  if (!Array.isArray(raw)) return [];
  const out: ReplayResult[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as ReplayResult;
    if (typeof e.scenarioId !== 'string' || typeof e.ranAt !== 'number') continue;
    if (typeof e.deltaScore !== 'number') continue;
    out.push({
      ...e,
      insights: Array.isArray(e.insights) ? [...e.insights] : [],
    });
  }
  return out;
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: CounterfactualReplayEngine | null = null;

export function getCounterfactualReplayEngine(): CounterfactualReplayEngine {
  _singleton ??= new CounterfactualReplayEngine();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetCounterfactualReplaySingleton(): void {
  _singleton = null;
}

export const __internals = {
  STORAGE_KEY,
  MAX_SCENARIOS,
  MAX_RESULTS,
  SEVERITY_TO_SCORE,
  applyModifications,
  scoreReplayObservation,
  buildInsights,
};
