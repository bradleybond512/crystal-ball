/**
 * Backtest Engine — Phase 4 backtest-before-apply gate.
 *
 * Replays a proposed parameter change against a set of historical
 * scenarios with known outcomes, computes baseline vs proposed accuracy,
 * and returns a recommendation (apply / reject / review). Lets the
 * algorithm tuning UI surface a regression before any change is applied
 * to live scoring.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * the most-recent 100 results to `localStorage` under
 * `wm-backtest-results`. Imports no upward services so callers can use
 * this safely as a leaf in the intelligence DAG.
 */

import type { ObservationEvent } from './observation-adapters';
import type { DerivedSeverity, ScoringDriver } from './driver-scores';
import { getDriverScoringEngine } from './driver-scores';

// ── Public types ──────────────────────────────────────────────────────

export interface KnownOutcome {
  observationId: string;
  actualSeverity: DerivedSeverity;
  wasActedOn: boolean;
}

export interface BacktestScenario {
  id: string;
  name: string;
  description: string;
  observations: ObservationEvent[];
  knownOutcomes: KnownOutcome[];
}

/** Severity bands used by the scoring path. Mirrors the bands inside
 *  `driver-scores.ts`. Re-declared here (rather than imported) so the
 *  backtest can substitute alternative bands via `parameterChanges`. */
export interface SeverityBand {
  min: number;
  severity: DerivedSeverity;
}

/** Open-ended parameter override shape. Known keys are interpreted by
 *  this engine; unknown keys are preserved on the persisted result for
 *  audit but otherwise ignored. */
export interface BacktestParameterChanges {
  /** driverId → new weight. Missing drivers fall back to the registered
   *  weight on the engine. */
  driverWeights?: Record<string, number>;
  /** Custom severity bands. If omitted, the engine's defaults are used. */
  severityBands?: SeverityBand[];
}

export interface BacktestConfig {
  algorithmId: string;
  parameterChanges: BacktestParameterChanges & Record<string, unknown>;
  scenarios: BacktestScenario[];
  /** Minimum required improvement, e.g. 0.0 = no regression allowed,
   *  0.05 = must improve by at least 5 accuracy points. */
  minAccuracyDelta: number;
}

export interface ScenarioOutcome {
  scenarioId: string;
  scenarioName: string;
  baselineAccuracy: number;
  proposedAccuracy: number;
  passed: boolean;
}

export type BacktestRecommendation = 'apply' | 'reject' | 'review';

export interface BacktestResult {
  id: string;
  config: BacktestConfig;
  baselineAccuracy: number;
  proposedAccuracy: number;
  accuracyDelta: number;
  passed: boolean;
  scenarioResults: ScenarioOutcome[];
  recommendation: BacktestRecommendation;
  explanation: string;
  runAt: Date;
  durationMs: number;
}

export interface BacktestStats {
  total: number;
  passed: number;
  failed: number;
  /** Mean of accuracyDelta across all recorded backtests. 0 when empty. */
  avgAccuracyDelta: number;
  avgDurationMs: number;
}

export type BacktestListener = (results: BacktestResult[]) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-backtest-results';
const MAX_RECORDS = 100;

/** Default severity bands. Mirrors driver-scores.ts. Exposed as a
 *  fallback for proposals that don't override bands. */
export const DEFAULT_SEVERITY_BANDS: SeverityBand[] = [
  { min: 0.8, severity: 'critical' },
  { min: 0.6, severity: 'high' },
  { min: 0.35, severity: 'medium' },
  { min: 0, severity: 'low' },
];

/** Per-scenario regression threshold. A scenario regressing by more than
 *  this triggers the `reject` recommendation regardless of the overall
 *  delta — even one badly-broken scenario is a reason to escalate. */
export const REGRESSION_THRESHOLD = 0.05;

const SEVERITY_ORDER: DerivedSeverity[] = ['low', 'medium', 'high', 'critical'];

// ── Storage helper ────────────────────────────────────────────────────

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Serialization ─────────────────────────────────────────────────────

interface PersistedResult extends Omit<BacktestResult, 'runAt'> {
  runAt: number;
}

function serialize(records: readonly BacktestResult[]): PersistedResult[] {
  return records.map((r) => ({
    ...r,
    runAt: r.runAt.getTime(),
  }));
}

function deserializeEntry(entry: unknown): BacktestResult | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as PersistedResult;
  if (typeof e.id !== 'string') return undefined;
  if (typeof e.runAt !== 'number') return undefined;
  if (typeof e.baselineAccuracy !== 'number') return undefined;
  if (typeof e.proposedAccuracy !== 'number') return undefined;
  if (typeof e.passed !== 'boolean') return undefined;
  if (typeof e.recommendation !== 'string') return undefined;
  return {
    ...e,
    runAt: new Date(e.runAt),
  };
}

function deserialize(raw: unknown): BacktestResult[] {
  if (!Array.isArray(raw)) return [];
  const out: BacktestResult[] = [];
  for (const entry of raw) {
    const parsed = deserializeEntry(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

// ── Scoring math ──────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function safeCall<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function severityForBands(score: number, bands: readonly SeverityBand[]): DerivedSeverity {
  // Iterate from highest threshold down so the first match wins.
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  for (const band of sorted) {
    if (score >= band.min) return band.severity;
  }
  return 'low';
}

/** Pure severity scorer. Mirrors the math in driver-scores.ts but takes
 *  weight overrides + custom bands and has zero side effects (does not
 *  touch the AttentionAllocator or the AlgoEvalLedger). */
export function scoreSeverity(
  obs: ObservationEvent,
  drivers: readonly ScoringDriver[],
  weightOverrides: Readonly<Record<string, number>>,
  bands: readonly SeverityBand[],
): DerivedSeverity {
  const domainDrivers = drivers.filter((d) => d.domain === obs.domain);
  if (domainDrivers.length === 0) return 'low';
  const effectiveWeights = domainDrivers.map((d) =>
    Math.max(0, weightOverrides[d.id] ?? d.weight));
  const totalWeight = effectiveWeights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) return 'low';
  let score = 0;
  for (const [i, d] of domainDrivers.entries()) {
    const rawValue = safeCall(() => d.extractValue(obs)) ?? null;
    if (rawValue === null) continue;
    const norm = clamp01(safeCall(() => d.normalizeValue(rawValue)) ?? 0);
    const w = effectiveWeights[i]! / totalWeight;
    score += norm * w;
  }
  return severityForBands(Math.min(1, score), bands);
}

/** Per-observation accuracy:
 *   exact severity match  → 1.0
 *   within 1 severity band → 0.5
 *   otherwise              → 0
 */
export function accuracyForPair(
  predicted: DerivedSeverity,
  actual: DerivedSeverity,
): number {
  const pi = SEVERITY_ORDER.indexOf(predicted);
  const ai = SEVERITY_ORDER.indexOf(actual);
  if (pi === -1 || ai === -1) return 0;
  const diff = Math.abs(pi - ai);
  if (diff === 0) return 1;
  if (diff === 1) return 0.5;
  return 0;
}

function scenarioAccuracy(
  scenario: BacktestScenario,
  drivers: readonly ScoringDriver[],
  weightOverrides: Readonly<Record<string, number>>,
  bands: readonly SeverityBand[],
): number {
  if (scenario.observations.length === 0) return 0;
  const outcomeByObs = new Map<string, KnownOutcome>();
  for (const o of scenario.knownOutcomes) outcomeByObs.set(o.observationId, o);
  let total = 0;
  let scored = 0;
  for (const obs of scenario.observations) {
    const outcome = outcomeByObs.get(obs.id);
    if (!outcome) continue;
    const predicted = scoreSeverity(obs, drivers, weightOverrides, bands);
    total += accuracyForPair(predicted, outcome.actualSeverity);
    scored += 1;
  }
  return scored === 0 ? 0 : total / scored;
}

function buildBaselineWeights(drivers: readonly ScoringDriver[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of drivers) out[d.id] = d.weight;
  return out;
}

function aggregateScenarioAccuracies(results: readonly ScenarioOutcome[], key: 'baselineAccuracy' | 'proposedAccuracy'): number {
  if (results.length === 0) return 0;
  const sum = results.reduce((acc, r) => acc + r[key], 0);
  return sum / results.length;
}

function recommendationFor(
  scenarioResults: readonly ScenarioOutcome[],
  overallPassed: boolean,
): BacktestRecommendation {
  const anyRegressed = scenarioResults.some(
    (s) => s.proposedAccuracy < s.baselineAccuracy - REGRESSION_THRESHOLD,
  );
  if (anyRegressed) return 'reject';
  if (overallPassed) return 'apply';
  return 'review';
}

function explanationFor(
  baselineAccuracy: number,
  proposedAccuracy: number,
  recommendation: BacktestRecommendation,
  scenarioResults: readonly ScenarioOutcome[],
  config: BacktestConfig,
): string {
  const delta = proposedAccuracy - baselineAccuracy;
  const deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(3);
  const summary = `proposed ${(proposedAccuracy * 100).toFixed(1)}% vs baseline ${(baselineAccuracy * 100).toFixed(1)}% (Δ ${deltaStr})`;
  if (recommendation === 'apply') {
    return `${summary} — passes minAccuracyDelta=${config.minAccuracyDelta.toFixed(3)} across all ${scenarioResults.length} scenarios. Safe to apply.`;
  }
  if (recommendation === 'reject') {
    const regressed = scenarioResults.filter(
      (s) => s.proposedAccuracy < s.baselineAccuracy - REGRESSION_THRESHOLD,
    );
    const names = regressed.map((s) => s.scenarioName).join(', ');
    return `${summary} — REJECT. ${regressed.length} scenario(s) regressed beyond ${REGRESSION_THRESHOLD.toFixed(2)}: ${names}.`;
  }
  const missed = scenarioResults.filter((s) => !s.passed);
  return `${summary} — review. ${missed.length} scenario(s) did not clear the minAccuracyDelta=${config.minAccuracyDelta.toFixed(3)} bar but none regressed beyond ${REGRESSION_THRESHOLD.toFixed(2)}.`;
}

// ── Engine ────────────────────────────────────────────────────────────

export interface BacktestEngineOptions {
  /** Override Date.now() — useful for deterministic tests. */
  clock?: () => number;
  /** Inject drivers instead of pulling from the live DriverScoringEngine.
   *  Tests pass their own driver fixtures here. */
  drivers?: ScoringDriver[];
}

export class BacktestEngine {
  private results: BacktestResult[] = [];
  private listeners = new Set<BacktestListener>();
  private hydrated = false;
  private idCounter = 0;
  private clock: () => number;
  private driverOverride: ScoringDriver[] | null;

  constructor(options: BacktestEngineOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.driverOverride = options.drivers ?? null;
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
      this.results = deserialize(JSON.parse(raw));
    } catch {
      // Corrupt blob — start clean rather than crash.
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(serialize(this.results)));
    } catch {
      // Quota or disabled — best-effort.
    }
  }

  private nextId(now: number): string {
    this.idCounter += 1;
    return `bt-${now.toString(36)}-${this.idCounter}`;
  }

  private notify(): void {
    const snapshot = this.getHistory();
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  /** Run a backtest. Pure with respect to the live scoring pipeline:
   *  it inspects the registered drivers but does not modify them, and
   *  never touches the AttentionAllocator or AlgoEvalLedger. */
  runBacktest(config: BacktestConfig): BacktestResult {
    this.ensureHydrated();
    const startMs = this.clock();
    const drivers = this.driverOverride ?? getDriverScoringEngine().getDrivers();
    const baselineWeights = buildBaselineWeights(drivers);
    const proposedWeights: Record<string, number> = {
      ...baselineWeights,
      ...config.parameterChanges.driverWeights,
    };
    const bands: SeverityBand[] = config.parameterChanges.severityBands ?? DEFAULT_SEVERITY_BANDS;

    const scenarioResults: ScenarioOutcome[] = config.scenarios.map((scenario) => {
      const baseline = scenarioAccuracy(scenario, drivers, baselineWeights, DEFAULT_SEVERITY_BANDS);
      const proposed = scenarioAccuracy(scenario, drivers, proposedWeights, bands);
      const passed = proposed - baseline >= config.minAccuracyDelta;
      return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        baselineAccuracy: baseline,
        proposedAccuracy: proposed,
        passed,
      };
    });

    const baselineAccuracy = aggregateScenarioAccuracies(scenarioResults, 'baselineAccuracy');
    const proposedAccuracy = aggregateScenarioAccuracies(scenarioResults, 'proposedAccuracy');
    const accuracyDelta = proposedAccuracy - baselineAccuracy;
    // Overall pass requires every scenario to clear the bar AND the
    // aggregate delta to meet the threshold. Either-or would let a
    // single great scenario mask a mediocre one.
    const passed = scenarioResults.every((s) => s.passed)
      && accuracyDelta >= config.minAccuracyDelta;
    const recommendation = recommendationFor(scenarioResults, passed);
    const explanation = explanationFor(baselineAccuracy, proposedAccuracy, recommendation, scenarioResults, config);
    const endMs = this.clock();

    const result: BacktestResult = {
      id: this.nextId(startMs),
      config,
      baselineAccuracy,
      proposedAccuracy,
      accuracyDelta,
      passed,
      scenarioResults,
      recommendation,
      explanation,
      runAt: new Date(startMs),
      durationMs: Math.max(0, endMs - startMs),
    };

    this.results.push(result);
    this.enforceCapacity();
    this.persist();
    this.notify();
    return cloneResult(result);
  }

  private enforceCapacity(): void {
    if (this.results.length <= MAX_RECORDS) return;
    this.results.splice(0, this.results.length - MAX_RECORDS);
  }

  getResult(id: string): BacktestResult | undefined {
    this.ensureHydrated();
    const r = this.results.find((x) => x.id === id);
    return r ? cloneResult(r) : undefined;
  }

  getHistory(): BacktestResult[] {
    this.ensureHydrated();
    return this.results.map((r) => cloneResult(r));
  }

  getPassed(): BacktestResult[] {
    return this.getHistory().filter((r) => r.passed);
  }

  getFailed(): BacktestResult[] {
    return this.getHistory().filter((r) => !r.passed);
  }

  stats(): BacktestStats {
    this.ensureHydrated();
    const total = this.results.length;
    if (total === 0) {
      return { total: 0, passed: 0, failed: 0, avgAccuracyDelta: 0, avgDurationMs: 0 };
    }
    let passed = 0;
    let deltaSum = 0;
    let durationSum = 0;
    for (const r of this.results) {
      if (r.passed) passed += 1;
      deltaSum += r.accuracyDelta;
      durationSum += r.durationMs;
    }
    return {
      total,
      passed,
      failed: total - passed,
      avgAccuracyDelta: deltaSum / total,
      avgDurationMs: durationSum / total,
    };
  }

  subscribe(listener: BacktestListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties the engine and the persisted blob. */
  resetForTesting(): void {
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

function cloneResult(r: BacktestResult): BacktestResult {
  return {
    ...r,
    scenarioResults: r.scenarioResults.map((s) => ({ ...s })),
    runAt: new Date(r.runAt),
    config: { ...r.config, scenarios: r.config.scenarios.map((s) => ({ ...s })) },
  };
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: BacktestEngine | null = null;

export function getBacktestEngine(): BacktestEngine {
  _singleton ??= new BacktestEngine();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetBacktestEngineSingleton(): void {
  _singleton = null;
}

export const __internals = {
  STORAGE_KEY,
  MAX_RECORDS,
  scenarioAccuracy,
  buildBaselineWeights,
  recommendationFor,
};
