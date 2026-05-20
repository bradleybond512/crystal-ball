/**
 * BacktestGate — pre-apply safety check for algorithm parameter changes.
 *
 * Operators submit a `ProposedChange` (algorithm id + param name +
 * proposed value); the gate evaluates it by:
 *
 *   1. Pulling recent accuracy data for the algorithm from
 *      `AlgoEvalLedger.getStats(algoId)`.
 *   2. Translating the change into a `BacktestParameterChanges` payload
 *      via one of the three built-in templates (confidence-threshold-
 *      raise, severity-weight-shift, correlation-radius-expand).
 *   3. Running `BacktestEngine.runBacktest()` against the built-in
 *      scenario library.
 *   4. Approving when both `accuracyDelta > -0.05` AND
 *      `simulatedAccuracy > 0.5`.
 *
 * Verdicts persist to localStorage `wm-backtest-gate` (cap 100
 * pending + 100 verdicts, oldest evicted). The gate never mutates the
 * production scoring engine — that's the apply-step's job once an
 * operator acts on the verdict.
 */

import {
  getBacktestEngine,
  type BacktestEngine,
  type BacktestParameterChanges,
  type BacktestResult,
  type BacktestScenario,
  type SeverityBand,
  DEFAULT_SEVERITY_BANDS,
} from './backtest-engine';
import { getBuiltInScenarios } from './built-in-scenarios';
import {
  getAlgoEvalLedger,
  type AlgoEvalLedger,
} from './algo-eval-ledger';

// ── Public types ──────────────────────────────────────────────────────

export interface ProposedChange {
  /** Unique id. Generated when not provided. */
  id?: string;
  algoId: string;
  paramName: string;
  currentValue: unknown;
  proposedValue: unknown;
  rationale: string;
  proposedAt: number;
}

export type GateConfidenceLevel = 'high' | 'medium' | 'low';

export interface GateVerdict {
  changeId: string;
  approved: boolean;
  reason: string;
  simulatedAccuracy: number;
  currentAccuracy: number;
  delta: number;
  confidenceLevel: GateConfidenceLevel;
  evaluatedAt: number;
  /** Optional reference to the BacktestResult that produced the
   *  simulated number. Populated when the gate actually ran the engine. */
  backtestResultId?: string;
}

export type GateListener = (verdict: GateVerdict) => void;

/** A pre-baked change-template so callers can spawn well-formed
 *  proposals without inventing field shapes themselves. */
export interface ChangeTemplate {
  id: string;
  label: string;
  description: string;
  build(input: { algoId: string; rationale?: string; proposedValue: unknown }): ProposedChange;
}

// ── BacktestRun — rule-centric historical replay ──────────────────────

export interface BacktestRun {
  id: string;
  ruleId: string;
  ruleSnapshot: object;
  ranAt: number;
  windowDays: number;
  triggeredCount: number;
  falsePositiveRate: number;
  precision: number;
  passed: boolean;
  failReason?: string;
}

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-backtest-gate';
const MAX_HISTORY = 100;
const MAX_RUNS = 500;
const DEFAULT_WINDOW_DAYS = 30;
const FP_RATE_THRESHOLD = 0.3;
const PRECISION_THRESHOLD = 0.7;
const APPROVAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const APPROVAL_DELTA_FLOOR = -0.05;
const APPROVAL_ACCURACY_FLOOR = 0.5;
const MIN_PREDICTIONS_FOR_HIGH = 30;
const MIN_PREDICTIONS_FOR_MEDIUM = 10;

// ── Built-in change templates ────────────────────────────────────────

export const CHANGE_TEMPLATES: readonly ChangeTemplate[] = [
  {
    id: 'confidence-threshold-raise',
    label: 'Confidence threshold raise',
    description: 'Shifts every severity band ceiling up so observations need higher confidence to land in the same band.',
    build({ algoId, rationale, proposedValue }) {
      return {
        algoId,
        paramName: 'severityBands.shift',
        currentValue: 0,
        proposedValue,
        rationale: rationale ?? 'Tighten band thresholds to reduce false positives.',
        proposedAt: Date.now(),
      };
    },
  },
  {
    id: 'severity-weight-shift',
    label: 'Severity weight shift',
    description: 'Adjusts a single driver weight (paramName encodes the driver id).',
    build({ algoId, rationale, proposedValue }) {
      return {
        algoId,
        paramName: 'driverWeights.primary',
        currentValue: 1,
        proposedValue,
        rationale: rationale ?? 'Re-tune driver weight against historical outcomes.',
        proposedAt: Date.now(),
      };
    },
  },
  {
    id: 'correlation-radius-expand',
    label: 'Correlation radius expand',
    description: 'Loosens correlation joining thresholds — modelled as a uniform weight scaler.',
    build({ algoId, rationale, proposedValue }) {
      return {
        algoId,
        paramName: 'correlation.radiusKm',
        currentValue: 100,
        proposedValue,
        rationale: rationale ?? 'Expand correlation radius to capture more co-located events.',
        proposedAt: Date.now(),
      };
    },
  },
];

// ── Gate ──────────────────────────────────────────────────────────────

export interface BacktestGateOptions {
  backtestEngine?: BacktestEngine;
  evalLedger?: AlgoEvalLedger;
  /** Override the default scenarios. Defaults to `getBuiltInScenarios()`. */
  scenarios?: readonly BacktestScenario[];
  clock?: () => number;
}

interface GateSnapshot {
  pending: ProposedChange[];
  verdicts: GateVerdict[];
  runs?: BacktestRun[];
}

export class BacktestGate {
  private pending = new Map<string, ProposedChange>();
  private verdicts = new Map<string, GateVerdict>();
  /** Insertion order so persistence + getVerdicts() stay deterministic. */
  private verdictOrder: string[] = [];
  private pendingOrder: string[] = [];
  private listeners = new Set<GateListener>();
  private idSeq = 0;
  private hydrated = false;
  private allRuns: BacktestRun[] = [];
  private backtestEngine?: BacktestEngine;
  private evalLedger?: AlgoEvalLedger;
  private scenarios?: readonly BacktestScenario[];
  private clock: () => number;

  constructor(options: BacktestGateOptions = {}) {
    this.backtestEngine = options.backtestEngine;
    this.evalLedger = options.evalLedger;
    this.scenarios = options.scenarios;
    this.clock = options.clock ?? (() => Date.now());
  }

  static getInstance(): BacktestGate {
    return getBacktestGate();
  }

  // ── Public API ──────────────────────────────────────────────────

  submitChange(change: ProposedChange): string {
    this.ensureHydrated();
    const id = change.id ?? this.nextId('chg');
    const stamped: ProposedChange = { ...change, id, proposedAt: change.proposedAt || this.clock() };
    this.pending.set(id, stamped);
    if (!this.pendingOrder.includes(id)) this.pendingOrder.push(id);
    this.enforceCapacity();
    this.persist();
    return id;
  }

  evaluate(change: ProposedChange): GateVerdict {
    this.ensureHydrated();
    const changeId = change.id ?? this.nextId('chg');
    const ledger = this.resolveEvalLedger();
    const stats = ledger.getStats(change.algoId);
    const currentAccuracy = typeof stats.accuracy === 'number' ? stats.accuracy : 0;

    const verdict = this.runBacktestVerdict(changeId, change, currentAccuracy, stats.resolvedCount);
    this.storeVerdict(verdict);
    // Once evaluated, the change exits the pending queue.
    this.pending.delete(changeId);
    this.pendingOrder = this.pendingOrder.filter((id) => id !== changeId);
    this.persist();
    this.notify(verdict);
    return cloneVerdict(verdict);
  }

  getPending(): ProposedChange[] {
    this.ensureHydrated();
    return this.pendingOrder
      .map((id) => this.pending.get(id))
      .filter((c): c is ProposedChange => c !== undefined)
      .map((c) => ({ ...c }));
  }

  getVerdicts(): GateVerdict[] {
    this.ensureHydrated();
    return this.verdictOrder
      .map((id) => this.verdicts.get(id))
      .filter((v): v is GateVerdict => v !== undefined)
      .map((v) => cloneVerdict(v));
  }

  getVerdict(changeId: string): GateVerdict | undefined {
    this.ensureHydrated();
    const v = this.verdicts.get(changeId);
    return v ? cloneVerdict(v) : undefined;
  }

  subscribe(listener: GateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  resetForTesting(): void {
    this.pending.clear();
    this.verdicts.clear();
    this.pendingOrder = [];
    this.verdictOrder = [];
    this.allRuns = [];
    this.listeners.clear();
    this.idSeq = 0;
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Rule-centric backtest API ────────────────────────────────────

  runBacktest(
    ruleId: string,
    ruleSnapshot: object,
    historicalEvents: object[],
    windowDays = DEFAULT_WINDOW_DAYS,
  ): BacktestRun {
    this.ensureHydrated();
    const now = this.clock();
    const windowMs = windowDays * 24 * 60 * 60 * 1000;
    const cutoff = now - windowMs;

    const inWindow = historicalEvents.filter((ev) => {
      const ts = (ev as Record<string, unknown>).timestamp;
      return typeof ts !== 'number' || ts >= cutoff;
    });

    const triggered = inWindow.filter((ev) => triggersRule(ev, ruleSnapshot));
    const triggeredCount = triggered.length;
    const fpCount = triggered.filter((ev) => isFalsePositive(ev, ruleSnapshot)).length;

    const falsePositiveRate = triggeredCount === 0 ? 0 : round4(fpCount / triggeredCount);
    const precision = triggeredCount === 0 ? 0 : round4((triggeredCount - fpCount) / triggeredCount);

    const failReason = resolveFailReason(triggeredCount, falsePositiveRate, precision);
    const run: BacktestRun = {
      id: this.nextId('btr'),
      ruleId,
      ruleSnapshot,
      ranAt: now,
      windowDays,
      triggeredCount,
      falsePositiveRate,
      precision,
      passed: failReason === undefined,
      failReason,
    };

    this.storeRun(run);
    this.persist();
    return { ...run };
  }

  getLastRun(ruleId: string): BacktestRun | undefined {
    this.ensureHydrated();
    let last: BacktestRun | undefined;
    for (const r of this.allRuns) {
      if (r.ruleId === ruleId) last = r;
    }
    return last ? { ...last } : undefined;
  }

  getHistory(ruleId: string): BacktestRun[] {
    this.ensureHydrated();
    return this.allRuns.filter((r) => r.ruleId === ruleId).map((r) => ({ ...r }));
  }

  isApproved(ruleId: string): boolean {
    const last = this.getLastRun(ruleId);
    if (last === undefined) return false;
    return last.passed && (this.clock() - last.ranAt) < APPROVAL_WINDOW_MS;
  }

  // ── Verdict construction ────────────────────────────────────────

  private runBacktestVerdict(
    changeId: string,
    change: ProposedChange,
    currentAccuracy: number,
    resolvedCount: number,
  ): GateVerdict {
    const scenarios = this.scenarios ?? getBuiltInScenarios();
    const now = this.clock();
    if (scenarios.length === 0) {
      return {
        changeId,
        approved: false,
        reason: 'No backtest scenarios available to evaluate the change.',
        simulatedAccuracy: 0,
        currentAccuracy,
        delta: 0,
        confidenceLevel: 'low',
        evaluatedAt: now,
      };
    }
    const parameterChanges = mapChangeToParameters(change);
    const engine = this.resolveBacktestEngine();
    const result = engine.runBacktest({
      algorithmId: change.algoId,
      // BacktestConfig.parameterChanges intersects BacktestParameterChanges
      // with Record<string, unknown> so extra keys can ride along; we
      // don't carry any extra keys today, so widen the type at the
      // boundary rather than polluting the helper.
      parameterChanges: { ...parameterChanges } as BacktestParameterChanges & Record<string, unknown>,
      scenarios: [...scenarios],
      minAccuracyDelta: APPROVAL_DELTA_FLOOR,
    });
    return buildVerdict(changeId, change, result, currentAccuracy, resolvedCount, now);
  }

  private storeVerdict(verdict: GateVerdict): void {
    const existing = this.verdicts.has(verdict.changeId);
    this.verdicts.set(verdict.changeId, verdict);
    if (!existing) {
      this.verdictOrder.push(verdict.changeId);
      this.enforceCapacity();
    }
  }

  private storeRun(run: BacktestRun): void {
    this.allRuns.push(run);
    while (this.allRuns.length > MAX_RUNS) {
      this.allRuns.shift();
    }
  }

  private notify(verdict: GateVerdict): void {
    const snapshot = cloneVerdict(verdict);
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  private enforceCapacity(): void {
    while (this.verdictOrder.length > MAX_HISTORY) {
      const oldest = this.verdictOrder.shift();
      if (oldest !== undefined) this.verdicts.delete(oldest);
    }
    while (this.pendingOrder.length > MAX_HISTORY) {
      const oldest = this.pendingOrder.shift();
      if (oldest !== undefined) this.pending.delete(oldest);
    }
  }

  // ── Internal resolvers + persistence ────────────────────────────

  private resolveBacktestEngine(): BacktestEngine {
    return this.backtestEngine ?? getBacktestEngine();
  }

  private resolveEvalLedger(): AlgoEvalLedger {
    return this.evalLedger ?? getAlgoEvalLedger();
  }

  private nextId(prefix: string): string {
    this.idSeq += 1;
    return `${prefix}-${this.clock().toString(36)}-${this.idSeq}`;
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
      const parsed = JSON.parse(raw) as Partial<GateSnapshot> | null;
      if (!parsed) return;
      for (const c of parsed.pending ?? []) {
        if (!c || typeof c.algoId !== 'string') continue;
        const id = c.id ?? this.nextId('chg');
        this.pending.set(id, { ...c, id });
        this.pendingOrder.push(id);
      }
      for (const v of parsed.verdicts ?? []) {
        if (!v || typeof v.changeId !== 'string') continue;
        this.verdicts.set(v.changeId, normalizeVerdict(v));
        this.verdictOrder.push(v.changeId);
      }
      for (const r of parsed.runs ?? []) {
        if (!r || typeof (r as unknown as Record<string, unknown>).ruleId !== 'string') continue;
        this.allRuns.push(normalizeRun(r));
      }
    } catch {
      // corrupt — leave empty
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    const snapshot: GateSnapshot = {
      pending: this.pendingOrder
        .map((id) => this.pending.get(id))
        .filter((c): c is ProposedChange => c !== undefined),
      verdicts: this.verdictOrder
        .map((id) => this.verdicts.get(id))
        .filter((v): v is GateVerdict => v !== undefined),
      runs: this.allRuns,
    };
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // quota / disabled — best effort
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function mapChangeToParameters(change: ProposedChange): BacktestParameterChanges {
  const param = change.paramName.toLowerCase();
  if (param.startsWith('driverweights')) {
    const driverId = change.paramName.includes('.')
      ? change.paramName.slice(change.paramName.indexOf('.') + 1)
      : 'primary';
    const weight = typeof change.proposedValue === 'number' ? change.proposedValue : 1;
    return { driverWeights: { [driverId]: weight } };
  }
  if (param.startsWith('severitybands')) {
    const shift = typeof change.proposedValue === 'number' ? change.proposedValue : 0;
    return { severityBands: shiftSeverityBands(DEFAULT_SEVERITY_BANDS, shift) };
  }
  // Generic fallback: treat any numeric proposedValue as a uniform
  // weight scaler so the engine still produces a delta we can act on.
  if (typeof change.proposedValue === 'number') {
    return { driverWeights: { '*': change.proposedValue } };
  }
  return {};
}

function shiftSeverityBands(base: readonly SeverityBand[], shift: number): SeverityBand[] {
  return base.map((band) => ({
    ...band,
    min: clamp01(band.min + shift),
  }));
}

function buildVerdict(
  changeId: string,
  change: ProposedChange,
  result: BacktestResult,
  currentAccuracy: number,
  resolvedCount: number,
  now: number,
): GateVerdict {
  const simulatedAccuracy = result.proposedAccuracy;
  // Round before the boundary comparison so float drift (e.g. 0.55 -
  // 0.6 → -0.04999…) doesn't accidentally flip a boundary case from
  // reject to approve.
  const delta = round4(simulatedAccuracy - currentAccuracy);
  const approved = delta > APPROVAL_DELTA_FLOOR && simulatedAccuracy > APPROVAL_ACCURACY_FLOOR;
  const reason = approved
    ? `Approved — simulated accuracy ${pct(simulatedAccuracy)} clears the ${pct(APPROVAL_ACCURACY_FLOOR)} floor with delta ${signedPct(delta)} vs current ${pct(currentAccuracy)}.`
    : explainRejection(simulatedAccuracy, delta, currentAccuracy);
  return {
    changeId,
    approved,
    reason: reason.length > 0 ? reason : `Backtest produced ${pct(simulatedAccuracy)} for "${change.paramName}".`,
    simulatedAccuracy: round4(simulatedAccuracy),
    currentAccuracy: round4(currentAccuracy),
    delta,
    confidenceLevel: deriveConfidence(resolvedCount, result),
    evaluatedAt: now,
    backtestResultId: result.id,
  };
}

function explainRejection(simulated: number, delta: number, current: number): string {
  if (simulated <= APPROVAL_ACCURACY_FLOOR) {
    return `Rejected — simulated accuracy ${pct(simulated)} did not clear the ${pct(APPROVAL_ACCURACY_FLOOR)} floor.`;
  }
  return `Rejected — accuracy delta ${signedPct(delta)} regresses past the ${signedPct(APPROVAL_DELTA_FLOOR)} floor (current ${pct(current)} → simulated ${pct(simulated)}).`;
}

function deriveConfidence(resolvedCount: number, result: BacktestResult): GateConfidenceLevel {
  const scenarioCount = result.scenarioResults.length;
  if (resolvedCount >= MIN_PREDICTIONS_FOR_HIGH && scenarioCount >= 3) return 'high';
  if (resolvedCount >= MIN_PREDICTIONS_FOR_MEDIUM && scenarioCount >= 1) return 'medium';
  return 'low';
}

function normalizeVerdict(raw: unknown): GateVerdict {
  const v = raw as GateVerdict;
  return {
    changeId: v.changeId,
    approved: v.approved === true,
    reason: v.reason ?? '',
    simulatedAccuracy: typeof v.simulatedAccuracy === 'number' ? v.simulatedAccuracy : 0,
    currentAccuracy: typeof v.currentAccuracy === 'number' ? v.currentAccuracy : 0,
    delta: typeof v.delta === 'number' ? v.delta : 0,
    confidenceLevel: (v.confidenceLevel ?? 'low') as GateConfidenceLevel,
    evaluatedAt: typeof v.evaluatedAt === 'number' ? v.evaluatedAt : 0,
    backtestResultId: v.backtestResultId,
  };
}

function cloneVerdict(v: GateVerdict): GateVerdict {
  return { ...v };
}

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function round4(n: number): number {
  return Number(n.toFixed(4));
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function signedPct(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(1)}%`;
}

// ── Rule-replay helpers ──────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = {
  INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};

function eventSeverityRank(ev: object): number {
  const e = ev as Record<string, unknown>;
  const s = typeof e.severity === 'string' ? e.severity.toUpperCase() : 'INFO';
  return SEVERITY_RANK[s] ?? 0;
}

function ruleSeverityThreshold(ruleSnapshot: object): number {
  const r = ruleSnapshot as Record<string, unknown>;
  const ts = Array.isArray(r.triggerSeverity) ? (r.triggerSeverity as string[]) : [];
  if (ts.length === 0) return 0;
  const ranks = ts.map((s) => SEVERITY_RANK[String(s).toUpperCase()] ?? 0);
  return Math.min(...ranks);
}

function triggersRule(ev: object, ruleSnapshot: object): boolean {
  const e = ev as Record<string, unknown>;
  const r = ruleSnapshot as Record<string, unknown>;
  if (typeof r.domain === 'string' && typeof e.domain === 'string' && r.domain !== e.domain) {
    return false;
  }
  const ruleTags = Array.isArray(r.triggerTags) ? (r.triggerTags as string[]) : [];
  if (ruleTags.length > 0) {
    const evtTags = Array.isArray(e.tags) ? (e.tags as string[]) : [];
    const matched = ruleTags.find((t) => evtTags.includes(t));
    if (matched === undefined) return false;
  }
  return true;
}

function isFalsePositive(ev: object, ruleSnapshot: object): boolean {
  return eventSeverityRank(ev) < ruleSeverityThreshold(ruleSnapshot);
}

function resolveFailReason(
  triggeredCount: number,
  falsePositiveRate: number,
  precision: number,
): string | undefined {
  if (triggeredCount === 0) return 'no events triggered the rule in the historical window';
  if (falsePositiveRate >= FP_RATE_THRESHOLD) {
    return `false-positive rate ${pct(falsePositiveRate)} exceeds ${pct(FP_RATE_THRESHOLD)} threshold`;
  }
  if (precision <= PRECISION_THRESHOLD) {
    return `precision ${pct(precision)} did not clear ${pct(PRECISION_THRESHOLD)} threshold`;
  }
  return undefined;
}

function normalizeRun(raw: unknown): BacktestRun {
  const r = raw as BacktestRun;
  return {
    id: typeof r.id === 'string' ? r.id : '',
    ruleId: typeof r.ruleId === 'string' ? r.ruleId : '',
    ruleSnapshot: (typeof r.ruleSnapshot === 'object' && r.ruleSnapshot != null) ? r.ruleSnapshot : {},
    ranAt: typeof r.ranAt === 'number' ? r.ranAt : 0,
    windowDays: typeof r.windowDays === 'number' ? r.windowDays : DEFAULT_WINDOW_DAYS,
    triggeredCount: typeof r.triggeredCount === 'number' ? r.triggeredCount : 0,
    falsePositiveRate: typeof r.falsePositiveRate === 'number' ? r.falsePositiveRate : 0,
    precision: typeof r.precision === 'number' ? r.precision : 0,
    passed: r.passed === true,
    failReason: typeof r.failReason === 'string' ? r.failReason : undefined,
  };
}

// ── Singleton ────────────────────────────────────────────────────────

let _singleton: BacktestGate | null = null;

export function getBacktestGate(): BacktestGate {
  _singleton ??= new BacktestGate();
  return _singleton;
}

export function __resetBacktestGateSingleton(): void {
  _singleton = null;
}

export const __internals = {
  CHANGE_TEMPLATES,
  APPROVAL_DELTA_FLOOR,
  APPROVAL_ACCURACY_FLOOR,
  MAX_HISTORY,
  MIN_PREDICTIONS_FOR_HIGH,
  MIN_PREDICTIONS_FOR_MEDIUM,
  MAX_RUNS,
  DEFAULT_WINDOW_DAYS,
  FP_RATE_THRESHOLD,
  PRECISION_THRESHOLD,
  APPROVAL_WINDOW_MS,
  mapChangeToParameters,
  shiftSeverityBands,
  deriveConfidence,
  buildVerdict,
  triggersRule,
  isFalsePositive,
  resolveFailReason,
  normalizeRun,
};
