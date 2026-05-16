/**
 * Safety Case — Phase 4 single-screen trustworthiness verdict.
 *
 * Aggregates eight safety properties (accuracy, bias, assumption
 * disclosure, alert-budget exhaustion, feed coverage, false-positive
 * rate, human-in-the-loop backlog, algorithm stability) into one
 * pass/warn/fail SafetyCase. Each property compares a live signal to a
 * documented threshold and carries its evidence source so a reviewer
 * can audit any 'fail' without leaving this screen.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * the most-recent 100 evaluations under `wm-safety-case`. Imports no
 * upward services so callers in any layer can use this safely.
 *
 * Note on `BiasReport`: the bias detector hasn't shipped yet. We define
 * a minimal structural type here so the caller (panel + tests) can
 * synthesise an empty-but-safe report. When the real detector lands,
 * its emitted type can extend this one without breaking consumers.
 */

import type { AssumptionStats } from './assumption-tracker';
import type { AlgorithmStats } from './algo-eval-ledger';
import type { OutcomeStats } from './outcome-ledger';
import type { TrustBudgetSnapshot } from '@/services/notifications/trust-budget';

// ── Public types ──────────────────────────────────────────────────────

export type SafetyPropertyStatus = 'pass' | 'warn' | 'fail';

export type SafetyCategory =
  | 'accuracy'
  | 'bias'
  | 'transparency'
  | 'reliability'
  | 'containment';

export interface SafetyProperty {
  id: string;
  name: string;
  description: string;
  category: SafetyCategory;
  status: SafetyPropertyStatus;
  /** Human-readable current value, e.g. "87% accuracy". */
  value: string;
  /** What 'pass' requires, e.g. ">=80%". */
  threshold: string;
  /** Where this signal came from, e.g. "AlgoEvalLedger". */
  evidence: string;
  lastChecked: Date;
}

export interface SafetyCase {
  generatedAt: Date;
  properties: SafetyProperty[];
  overallStatus: SafetyPropertyStatus;
  passCount: number;
  warnCount: number;
  failCount: number;
  /** True iff no property is at 'fail'. Warns alone don't block. */
  safeToOperate: boolean;
  /** Single-line operator summary suited for the dashboard header. */
  operatorSummary: string;
}

export type BiasSignalSeverity = 'info' | 'warning' | 'alert';

export interface BiasSignal {
  id: string;
  severity: BiasSignalSeverity;
  /** Short label, e.g. "geographic skew" — not currently used by the
   *  evaluator but preserved on the report so the panel can render
   *  detail when this becomes a real producer. */
  label?: string;
}

export interface BiasReport {
  signals: BiasSignal[];
}

export type FeedHealthStatus = 'healthy' | 'degraded' | 'down';

export type FeedHealthMap = Record<string, FeedHealthStatus>;

export interface SafetyCaseInputs {
  biasReport: BiasReport;
  assumptionStats: AssumptionStats;
  algoStats: AlgorithmStats[];
  budgetSnapshot: TrustBudgetSnapshot;
  feedHealth: FeedHealthMap;
  outcomeStats: OutcomeStats;
  /** Optional: number of pending human-review items. Defaults to 0 when
   *  the caller doesn't have a producer wired up yet. */
  humanReviewBacklog?: number;
}

export type SafetyCaseListener = (cases: SafetyCase[]) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-safety-case';
const MAX_RECORDS = 100;

/** Critical feeds that MUST be reachable for safe operation. */
export const CRITICAL_FEEDS: readonly string[] = ['earthquake', 'weather', 'maritime'];

// Thresholds — single source of truth so tests and UI agree.
export const ACCURACY_PASS = 0.7;
export const ACCURACY_WARN = 0.5;
export const ASSUMPTIONS_PASS = 10;
export const ASSUMPTIONS_WARN = 20;
export const BUDGET_EXHAUSTED_WARN = 1;
export const BUDGET_EXHAUSTED_FAIL = 3;
export const FP_RATE_PASS = 0.4;
export const FP_RATE_WARN = 0.6;
export const HUMAN_REVIEW_PASS = 10;
export const HUMAN_REVIEW_WARN = 25;
export const DEGRADING_ALGO_FAIL = 2;

// ── Status helpers ───────────────────────────────────────────────────

const STATUS_RANK: Record<SafetyPropertyStatus, number> = {
  pass: 0,
  warn: 1,
  fail: 2,
};

function worstStatus(statuses: readonly SafetyPropertyStatus[]): SafetyPropertyStatus {
  let worst: SafetyPropertyStatus = 'pass';
  for (const s of statuses) {
    if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
  }
  return worst;
}

/** Three-tier numeric threshold helper. `pass` when value ≥ passAt,
 *  `warn` when value ≥ warnAt, otherwise `fail`. */
function tierByMin(value: number, passAt: number, warnAt: number): SafetyPropertyStatus {
  if (value >= passAt) return 'pass';
  if (value >= warnAt) return 'warn';
  return 'fail';
}

/** Inverse three-tier — `pass` when value is strictly below passUnder.
 *  Used for "count of bad things" properties where smaller is better. */
function tierByMax(value: number, passUnder: number, warnUnder: number): SafetyPropertyStatus {
  if (value < passUnder) return 'pass';
  if (value < warnUnder) return 'warn';
  return 'fail';
}

// ── Property evaluators ──────────────────────────────────────────────

function evalAccuracy(stats: readonly AlgorithmStats[], now: Date): SafetyProperty {
  // Aggregate accuracy across algorithms that emitted a categorical
  // accuracy figure. Stats without `accuracy` (numeric MAE) are
  // skipped so a purely-numeric algorithm doesn't suppress this one.
  const samples = stats.filter((s) => typeof s.accuracy === 'number');
  const total = samples.reduce((sum, s) => sum + (s.accuracy ?? 0) * s.resolvedCount, 0);
  const denom = samples.reduce((sum, s) => sum + s.resolvedCount, 0);
  const accuracy = denom === 0 ? null : total / denom;
  // No categorical samples — we can't certify "pass" so we warn until
  // the ledger has something to evaluate against.
  const status: SafetyPropertyStatus = accuracy === null
    ? 'warn'
    : tierByMin(accuracy, ACCURACY_PASS, ACCURACY_WARN);
  const value = accuracy === null
    ? 'no resolved predictions'
    : `${(accuracy * 100).toFixed(0)}% (${denom} samples)`;
  return {
    id: 'accuracy',
    name: 'Prediction accuracy',
    description: 'Weighted accuracy of categorical predictions resolved against user outcomes.',
    category: 'accuracy',
    status,
    value,
    threshold: `≥${(ACCURACY_PASS * 100).toFixed(0)}% pass / ≥${(ACCURACY_WARN * 100).toFixed(0)}% warn`,
    evidence: 'AlgoEvalLedger',
    lastChecked: now,
  };
}

function biasFreeStatus(alerts: number, warnings: number): SafetyPropertyStatus {
  if (alerts > 0) return 'fail';
  if (warnings > 0) return 'warn';
  return 'pass';
}

function evalBiasFree(report: BiasReport, now: Date): SafetyProperty {
  const alerts = report.signals.filter((s) => s.severity === 'alert').length;
  const warnings = report.signals.filter((s) => s.severity === 'warning').length;
  const status = biasFreeStatus(alerts, warnings);
  return {
    id: 'bias-free',
    name: 'Bias-free operation',
    description: 'No unaddressed bias detector signals at warning or alert severity.',
    category: 'bias',
    status,
    value: `${alerts} alerts · ${warnings} warnings`,
    threshold: '0 alerts / 0 warnings',
    evidence: 'BiasDetector',
    lastChecked: now,
  };
}

function evalAssumptionsDisclosed(stats: AssumptionStats, now: Date): SafetyProperty {
  const critical = stats.criticalCount;
  const status = tierByMax(critical, ASSUMPTIONS_PASS, ASSUMPTIONS_WARN);
  return {
    id: 'assumptions-disclosed',
    name: 'Assumptions disclosed',
    description: 'Critical assumptions on live outputs stay below the disclosure ceiling.',
    category: 'transparency',
    status,
    value: `${critical} critical assumptions`,
    threshold: `<${ASSUMPTIONS_PASS} pass / <${ASSUMPTIONS_WARN} warn`,
    evidence: 'AssumptionTracker',
    lastChecked: now,
  };
}

function alertBudgetStatus(exhausted: number): SafetyPropertyStatus {
  if (exhausted === 0) return 'pass';
  if (exhausted < BUDGET_EXHAUSTED_FAIL) return 'warn';
  return 'fail';
}

function evalAlertBudget(snapshot: TrustBudgetSnapshot, now: Date): SafetyProperty {
  const exhausted = snapshot.exhaustedDomains.length;
  const status = alertBudgetStatus(exhausted);
  const value = exhausted === 0
    ? 'no exhausted domains'
    : `${exhausted} exhausted: ${snapshot.exhaustedDomains.join(', ')}`;
  return {
    id: 'alert-budget',
    name: 'Alert budget headroom',
    description: 'Number of domains that have exhausted their per-window alert quota.',
    category: 'containment',
    status,
    value,
    threshold: `0 pass / <${BUDGET_EXHAUSTED_FAIL} warn`,
    evidence: 'TrustBudget',
    lastChecked: now,
  };
}

function feedCoverageStatus(downCount: number, degradedCount: number): SafetyPropertyStatus {
  if (downCount > 0) return 'fail';
  if (degradedCount > 0) return 'warn';
  return 'pass';
}

function feedCoverageValue(status: SafetyPropertyStatus, down: readonly string[], degraded: readonly string[]): string {
  if (status === 'pass') return 'all critical feeds healthy';
  if (down.length > 0) return `down: ${down.join(', ')}`;
  return `degraded: ${degraded.join(', ')}`;
}

function evalFeedCoverage(feeds: FeedHealthMap, now: Date): SafetyProperty {
  const findings = CRITICAL_FEEDS.map((id) => ({ id, status: feeds[id] ?? 'down' as FeedHealthStatus }));
  const down = findings.filter((f) => f.status === 'down').map((f) => f.id);
  const degraded = findings.filter((f) => f.status === 'degraded').map((f) => f.id);
  const status = feedCoverageStatus(down.length, degraded.length);
  return {
    id: 'feed-coverage',
    name: 'Feed coverage',
    description: 'Critical input feeds (earthquake, weather, maritime) are reachable.',
    category: 'reliability',
    status,
    value: feedCoverageValue(status, down, degraded),
    threshold: 'all critical feeds healthy',
    evidence: 'FeedHealthMonitor',
    lastChecked: now,
  };
}

function evalFalsePositiveRate(stats: OutcomeStats, now: Date): SafetyProperty {
  const rate = stats.overallFalsePositiveRate;
  const status = tierByMax(rate, FP_RATE_PASS, FP_RATE_WARN);
  return {
    id: 'false-positive-rate',
    name: 'False-positive rate',
    description: 'Share of outcomes the user dismissed or marked as false positives.',
    category: 'accuracy',
    status,
    value: `${(rate * 100).toFixed(0)}% (n=${stats.total})`,
    threshold: `<${(FP_RATE_PASS * 100).toFixed(0)}% pass / <${(FP_RATE_WARN * 100).toFixed(0)}% warn`,
    evidence: 'OutcomeLedger',
    lastChecked: now,
  };
}

function evalHumanInLoop(backlog: number, now: Date): SafetyProperty {
  const status = tierByMax(backlog, HUMAN_REVIEW_PASS, HUMAN_REVIEW_WARN);
  return {
    id: 'human-in-loop',
    name: 'Human-in-the-loop backlog',
    description: 'Pending items awaiting human review. Too large means the loop is broken.',
    category: 'reliability',
    status,
    value: `${backlog} pending`,
    threshold: `<${HUMAN_REVIEW_PASS} pass / <${HUMAN_REVIEW_WARN} warn`,
    evidence: 'ReviewQueue',
    lastChecked: now,
  };
}

function algorithmStabilityStatus(degradingCount: number): SafetyPropertyStatus {
  if (degradingCount === 0) return 'pass';
  if (degradingCount < DEGRADING_ALGO_FAIL) return 'warn';
  return 'fail';
}

function evalAlgorithmStability(stats: readonly AlgorithmStats[], now: Date): SafetyProperty {
  const degrading = stats.filter((s) => s.trend === 'degrading');
  const status = algorithmStabilityStatus(degrading.length);
  return {
    id: 'algorithm-stable',
    name: 'Algorithm stability',
    description: 'No algorithms show a degrading last-30 vs prior-30 trend.',
    category: 'accuracy',
    status,
    value: degrading.length === 0
      ? 'no degrading algorithms'
      : `${degrading.length} degrading: ${degrading.map((s) => s.algorithmId).join(', ')}`,
    threshold: `0 pass / <${DEGRADING_ALGO_FAIL} warn`,
    evidence: 'AlgoEvalLedger',
    lastChecked: now,
  };
}

function buildOperatorSummary(
  overallStatus: SafetyPropertyStatus,
  failCount: number,
  warnCount: number,
): string {
  if (overallStatus === 'pass') return 'System is operating safely.';
  if (overallStatus === 'fail') {
    const word = failCount === 1 ? 'property' : 'properties';
    return `${failCount} safety ${word} failing — review required before continued operation.`;
  }
  const word = warnCount === 1 ? 'property' : 'properties';
  return `${warnCount} safety ${word} in warn — system is operating but monitoring needed.`;
}

// ── Pure evaluator ────────────────────────────────────────────────────

export function buildSafetyCase(inputs: SafetyCaseInputs, generatedAt: Date = new Date()): SafetyCase {
  const properties: SafetyProperty[] = [
    evalAccuracy(inputs.algoStats, generatedAt),
    evalBiasFree(inputs.biasReport, generatedAt),
    evalAssumptionsDisclosed(inputs.assumptionStats, generatedAt),
    evalAlertBudget(inputs.budgetSnapshot, generatedAt),
    evalFeedCoverage(inputs.feedHealth, generatedAt),
    evalFalsePositiveRate(inputs.outcomeStats, generatedAt),
    evalHumanInLoop(inputs.humanReviewBacklog ?? 0, generatedAt),
    evalAlgorithmStability(inputs.algoStats, generatedAt),
  ];
  const overallStatus = worstStatus(properties.map((p) => p.status));
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  for (const p of properties) {
    if (p.status === 'pass') passCount += 1;
    else if (p.status === 'warn') warnCount += 1;
    else failCount += 1;
  }
  const safeToOperate = failCount === 0;
  const operatorSummary = buildOperatorSummary(overallStatus, failCount, warnCount);
  return {
    generatedAt,
    properties,
    overallStatus,
    passCount,
    warnCount,
    failCount,
    safeToOperate,
    operatorSummary,
  };
}

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

interface PersistedProperty extends Omit<SafetyProperty, 'lastChecked'> {
  lastChecked: number;
}

interface PersistedCase extends Omit<SafetyCase, 'generatedAt' | 'properties'> {
  generatedAt: number;
  properties: PersistedProperty[];
}

function serialize(records: readonly SafetyCase[]): PersistedCase[] {
  return records.map((r) => ({
    ...r,
    generatedAt: r.generatedAt.getTime(),
    properties: r.properties.map((p) => ({ ...p, lastChecked: p.lastChecked.getTime() })),
  }));
}

function deserializeEntry(entry: unknown): SafetyCase | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as PersistedCase;
  if (typeof e.generatedAt !== 'number') return undefined;
  if (!Array.isArray(e.properties)) return undefined;
  if (typeof e.overallStatus !== 'string') return undefined;
  const properties: SafetyProperty[] = [];
  for (const raw of e.properties) {
    const rp = raw as PersistedProperty;
    if (typeof rp?.id !== 'string' || typeof rp.lastChecked !== 'number') continue;
    properties.push({ ...rp, lastChecked: new Date(rp.lastChecked) });
  }
  return { ...e, generatedAt: new Date(e.generatedAt), properties };
}

function deserialize(raw: unknown): SafetyCase[] {
  if (!Array.isArray(raw)) return [];
  const out: SafetyCase[] = [];
  for (const entry of raw) {
    const parsed = deserializeEntry(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

// ── Service ───────────────────────────────────────────────────────────

export interface SafetyCaseServiceOptions {
  /** Override Date.now() — useful for deterministic tests. */
  clock?: () => number;
}

export class SafetyCaseService {
  private history: SafetyCase[] = [];
  private listeners = new Set<SafetyCaseListener>();
  private hydrated = false;
  private clock: () => number;

  constructor(options: SafetyCaseServiceOptions = {}) {
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
      this.history = deserialize(JSON.parse(raw));
    } catch {
      // Corrupt blob — start clean.
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(serialize(this.history)));
    } catch {
      // Quota or disabled — best-effort.
    }
  }

  private notify(): void {
    const snapshot = this.getHistory();
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  /** Evaluate a fresh safety case from the given inputs and store it
   *  in the history ring buffer. Returns a defensive copy. */
  evaluate(inputs: SafetyCaseInputs): SafetyCase {
    this.ensureHydrated();
    const sc = buildSafetyCase(inputs, new Date(this.clock()));
    this.history.push(sc);
    this.enforceCapacity();
    this.persist();
    this.notify();
    return cloneCase(sc);
  }

  private enforceCapacity(): void {
    if (this.history.length <= MAX_RECORDS) return;
    this.history.splice(0, this.history.length - MAX_RECORDS);
  }

  getLatest(): SafetyCase | undefined {
    this.ensureHydrated();
    if (this.history.length === 0) return undefined;
    return cloneCase(this.history[this.history.length - 1]!);
  }

  getHistory(): SafetyCase[] {
    this.ensureHydrated();
    return this.history.map((c) => cloneCase(c));
  }

  subscribe(listener: SafetyCaseListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties the history and the persisted blob. */
  resetForTesting(): void {
    this.history = [];
    this.listeners.clear();
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* best effort */ }
    }
  }
}

function cloneCase(sc: SafetyCase): SafetyCase {
  return {
    ...sc,
    generatedAt: new Date(sc.generatedAt),
    properties: sc.properties.map((p) => ({ ...p, lastChecked: new Date(p.lastChecked) })),
  };
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: SafetyCaseService | null = null;

export function getSafetyCaseService(): SafetyCaseService {
  _singleton ??= new SafetyCaseService();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetSafetyCaseSingleton(): void {
  _singleton = null;
}

export const __internals = {
  STORAGE_KEY,
  MAX_RECORDS,
  worstStatus,
  buildOperatorSummary,
};
