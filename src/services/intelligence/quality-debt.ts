/**
 * Quality debt tracker — surface accumulating analytical and data-
 * quality issues across the intelligence layer. Different from
 * `src/services/quality/quality-debt.ts`, which models human-curated
 * software debt; this module auto-detects model + data drift over
 * the live intelligence signals.
 *
 * Six detectors:
 *   1. data-staleness     feed health degraded / down
 *   2. coverage-gap       too few observations in the last 24h
 *   3. model-drift        algorithm accuracy trending degrading
 *   4. assumption-debt    critical assumptions piling up
 *   5. calibration-lag    domain has >30 outcomes but no recent
 *                         outcome recorded in the calibration window
 *   6. test-coverage      no recent backtest for this domain
 *
 * Pure deterministic; no DOM, no fetch.
 */

import type { AlgorithmStats } from './algo-eval-ledger';
import type { AssumptionStats } from './assumption-tracker';

// ── Public types ──────────────────────────────────────────────────────

export type DebtCategory =
  | 'data-staleness'
  | 'coverage-gap'
  | 'model-drift'
  | 'assumption-debt'
  | 'calibration-lag'
  | 'test-coverage';

export type DebtSeverity = 'negligible' | 'minor' | 'moderate' | 'significant' | 'critical';
export type DebtStatus = 'open' | 'acknowledged' | 'resolved';
export type CompoundingRate = 'fast' | 'slow' | 'none';
export type DebtTrend = 'accumulating' | 'stable' | 'reducing';
export type FeedHealth = 'healthy' | 'degraded' | 'down';

export interface DebtItem {
  id: string;
  category: DebtCategory;
  domain: string;
  severity: DebtSeverity;
  title: string;
  description: string;
  ageMs: number;
  estimatedCostToRepair: string;
  compoundingRate: CompoundingRate;
  relatedItemIds: string[];
  status: DebtStatus;
  detectedAt: Date;
  resolvedAt?: Date;
}

export interface ScanParams {
  feedHealthMap: Record<string, FeedHealth>;
  recentObsCounts: Record<string, number>;
  algoStats: readonly AlgorithmStats[];
  assumptionStats: AssumptionStats;
  outcomeCountByDomain: Record<string, number>;
  /** Last-outcome timestamp per domain — drives calibration-lag. */
  lastOutcomeByDomain?: Record<string, Date | null>;
  /** Last-backtest timestamp per domain — drives test-coverage. */
  lastBacktestByDomain: Record<string, Date | null>;
}

export interface DebtSummary {
  generatedAt: Date;
  items: DebtItem[];
  totalDebtScore: number;
  byCategory: Record<DebtCategory, number>;
  bySeverity: Record<DebtSeverity, number>;
  fastCompoundingCount: number;
  topPriorityItem: DebtItem | null;
  trend: DebtTrend;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface QualityDebtTrackerOptions {
  capacity?: number;
  historyCapacity?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_CAPACITY = 500;
const DEFAULT_HISTORY_CAPACITY = 50;
export const STORAGE_KEY = 'wm-quality-debt';

const SEVERITY_WEIGHT: Record<DebtSeverity, number> = {
  critical: 10,
  significant: 5,
  moderate: 2,
  minor: 1,
  negligible: 0,
};
const SEVERITY_RANK: DebtSeverity[] = ['negligible', 'minor', 'moderate', 'significant', 'critical'];
const COMPOUNDING_RANK: CompoundingRate[] = ['none', 'slow', 'fast'];
const TREND_THRESHOLD = 1;

/** Domains where a feed-down is materially worse than a backwater feed. */
const CRITICAL_DOMAINS = new Set(['earthquake', 'weather', 'maritime', 'aviation', 'wildfire']);

const COVERAGE_24H_MIN = 3;
const COVERAGE_24H_NEAR_ZERO = 1;
const ASSUMPTION_CRITICAL_MODERATE = 15;
const ASSUMPTION_CRITICAL_SIGNIFICANT = 25;
const ASSUMPTION_CRITICAL_CRITICAL = 40;
const CALIBRATION_OUTCOMES_FLOOR = 30;
const CALIBRATION_STALE_DAYS = 14;
const BACKTEST_STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60_000;

// ── Engine ───────────────────────────────────────────────────────────

interface PersistedState {
  items: SerializedItem[];
  history: SerializedSummary[];
  priorScore: number | null;
}

interface SerializedItem extends Omit<DebtItem, 'detectedAt' | 'resolvedAt'> {
  detectedAt: number;
  resolvedAt?: number;
}

interface SerializedSummary extends Omit<DebtSummary, 'generatedAt' | 'items' | 'topPriorityItem'> {
  generatedAt: number;
  items: SerializedItem[];
  topPriorityItem: SerializedItem | null;
}

export class QualityDebtTracker {
  private readonly capacity: number;
  private readonly historyCapacity: number;
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  /** All items the tracker has ever seen, keyed by stable fingerprint
   *  `${category}|${domain}` so a re-scan replaces metadata while
   *  preserving status + detectedAt. */
  private readonly itemsByKey = new Map<string, DebtItem>();
  /** Insertion order for ring-buffer eviction. */
  private readonly order: string[] = [];
  private readonly history: DebtSummary[] = [];
  private priorScore: number | null = null;
  private readonly subscribers = new Set<(s: DebtSummary) => void>();

  constructor(opts: QualityDebtTrackerOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.historyCapacity = opts.historyCapacity ?? DEFAULT_HISTORY_CAPACITY;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.hydrate();
  }

  scan(params: ScanParams): DebtSummary {
    const detectedAt = new Date(this.clock());
    const detected = runAllDetectors(params, this.clock(), detectedAt);
    const presentKeys = this.mergeDetected(detected);
    this.resolveDropped(presentKeys, detectedAt);

    const summary = this.buildSummary(detectedAt);
    this.history.push(summary);
    while (this.history.length > this.historyCapacity) this.history.shift();
    this.priorScore = summary.totalDebtScore;
    this.persist();
    for (const cb of this.subscribers) cb(summary);
    return summary;
  }

  private mergeDetected(detected: readonly DebtItem[]): Set<string> {
    const presentKeys = new Set<string>();
    for (const incoming of detected) {
      const key = fingerprint(incoming);
      presentKeys.add(key);
      this.upsertItem(key, incoming);
    }
    return presentKeys;
  }

  private upsertItem(key: string, incoming: DebtItem): void {
    const prior = this.itemsByKey.get(key);
    if (prior) {
      this.itemsByKey.set(key, {
        ...incoming,
        id: prior.id,
        status: prior.status === 'resolved' ? 'open' : prior.status,
        detectedAt: prior.detectedAt,
        ageMs: this.clock() - prior.detectedAt.getTime(),
      });
      return;
    }
    this.itemsByKey.set(key, incoming);
    this.order.push(key);
    while (this.order.length > this.capacity) {
      const evictKey = this.order.shift();
      if (evictKey !== undefined) this.itemsByKey.delete(evictKey);
    }
  }

  private resolveDropped(presentKeys: ReadonlySet<string>, detectedAt: Date): void {
    for (const key of this.itemsByKey.keys()) {
      if (presentKeys.has(key)) continue;
      const prior = this.itemsByKey.get(key);
      if (!prior || prior.status === 'resolved') continue;
      this.itemsByKey.set(key, { ...prior, status: 'resolved', resolvedAt: detectedAt });
    }
  }

  acknowledge(id: string): void {
    const found = this.findById(id);
    if (!found) return;
    this.itemsByKey.set(fingerprint(found), { ...found, status: 'acknowledged' });
    this.persist();
  }

  resolve(id: string): void {
    const found = this.findById(id);
    if (!found) return;
    this.itemsByKey.set(fingerprint(found), {
      ...found,
      status: 'resolved',
      resolvedAt: new Date(this.clock()),
    });
    this.persist();
  }

  getOpen(): DebtItem[] {
    return [...this.itemsByKey.values()].filter((i) => i.status !== 'resolved');
  }

  getFastCompounding(): DebtItem[] {
    return this.getOpen().filter((i) => i.compoundingRate === 'fast');
  }

  stats(): DebtSummary {
    return this.buildSummary(new Date(this.clock()));
  }

  getHistory(): DebtSummary[] {
    return [...this.history];
  }

  subscribe(cb: (s: DebtSummary) => void): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  // ── Internals ──────────────────────────────────────────────────────

  private findById(id: string): DebtItem | undefined {
    for (const item of this.itemsByKey.values()) {
      if (item.id === id) return item;
    }
    return undefined;
  }

  private buildSummary(generatedAt: Date): DebtSummary {
    const open = this.getOpen();
    const byCategory: Record<DebtCategory, number> = {
      'data-staleness': 0,
      'coverage-gap': 0,
      'model-drift': 0,
      'assumption-debt': 0,
      'calibration-lag': 0,
      'test-coverage': 0,
    };
    const bySeverity: Record<DebtSeverity, number> = {
      negligible: 0,
      minor: 0,
      moderate: 0,
      significant: 0,
      critical: 0,
    };
    let totalDebtScore = 0;
    let fastCompoundingCount = 0;
    for (const item of open) {
      byCategory[item.category]++;
      bySeverity[item.severity]++;
      totalDebtScore += SEVERITY_WEIGHT[item.severity];
      if (item.compoundingRate === 'fast') fastCompoundingCount++;
    }
    const topPriorityItem = pickTopPriority(open);
    const trend = decideTrend(this.priorScore, totalDebtScore);
    return {
      generatedAt,
      items: open,
      totalDebtScore,
      byCategory,
      bySeverity,
      fastCompoundingCount,
      topPriorityItem,
      trend,
    };
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
      if (!parsed || !Array.isArray(parsed.items)) return;
      this.hydrateItems(parsed.items);
      this.priorScore = parsed.priorScore ?? null;
      if (Array.isArray(parsed.history)) {
        for (const s of parsed.history) this.history.push(deserializeSummary(s));
      }
    } catch {
      this.itemsByKey.clear();
      this.order.length = 0;
      this.history.length = 0;
      this.priorScore = null;
    }
  }

  private hydrateItems(serialized: readonly SerializedItem[]): void {
    for (const item of serialized) {
      const restored = deserializeItem(item);
      const key = fingerprint(restored);
      if (!this.itemsByKey.has(key)) this.order.push(key);
      this.itemsByKey.set(key, restored);
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedState = {
        items: [...this.itemsByKey.values()].map((i) => serializeItem(i)),
        history: this.history.map((s) => ({
          ...s,
          generatedAt: s.generatedAt.getTime(),
          items: s.items.map((i) => serializeItem(i)),
          topPriorityItem: s.topPriorityItem ? serializeItem(s.topPriorityItem) : null,
        })),
        priorScore: this.priorScore,
      };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // Storage failures are non-fatal.
    }
  }
}

function serializeItem(item: DebtItem): SerializedItem {
  return {
    ...item,
    detectedAt: item.detectedAt.getTime(),
    resolvedAt: item.resolvedAt?.getTime(),
  };
}

function deserializeItem(item: SerializedItem): DebtItem {
  return {
    ...item,
    detectedAt: new Date(item.detectedAt),
    resolvedAt: item.resolvedAt ? new Date(item.resolvedAt) : undefined,
  };
}

function deserializeSummary(s: SerializedSummary): DebtSummary {
  return {
    ...s,
    generatedAt: new Date(s.generatedAt),
    items: s.items.map((i) => deserializeItem(i)),
    topPriorityItem: s.topPriorityItem ? deserializeItem(s.topPriorityItem) : null,
  };
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: QualityDebtTracker | undefined;

export function getQualityDebtTracker(): QualityDebtTracker {
  singleton ??= new QualityDebtTracker();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Detectors ───────────────────────────────────────────────────────

function runAllDetectors(params: ScanParams, now: number, detectedAt: Date): DebtItem[] {
  const out: DebtItem[] = [];
  detectDataStaleness(params, detectedAt, out);
  detectCoverageGap(params, detectedAt, out);
  detectModelDrift(params, detectedAt, out);
  detectAssumptionDebt(params, detectedAt, out);
  detectCalibrationLag(params, now, detectedAt, out);
  detectTestCoverage(params, now, detectedAt, out);
  return out;
}

function detectDataStaleness(params: ScanParams, detectedAt: Date, out: DebtItem[]): void {
  for (const [domain, health] of Object.entries(params.feedHealthMap)) {
    if (health === 'healthy') continue;
    const critical = CRITICAL_DOMAINS.has(domain) && health === 'down';
    out.push(buildItem({
      category: 'data-staleness',
      domain,
      severity: critical ? 'significant' : 'moderate',
      title: `${domain} feed ${health}`,
      description: critical
        ? `${domain} is a critical safety domain; its feed is currently down — alerts and situations cannot be triggered.`
        : `${domain} feed is ${health}. Confidence in recent ${domain} alerts is reduced.`,
      compoundingRate: 'slow',
      estimatedCostToRepair: 'Investigate provider health; ~30 min',
    }, detectedAt));
  }
}

function detectCoverageGap(params: ScanParams, detectedAt: Date, out: DebtItem[]): void {
  for (const [domain, count] of Object.entries(params.recentObsCounts)) {
    if (count >= COVERAGE_24H_MIN) continue;
    const severe = count < COVERAGE_24H_NEAR_ZERO;
    out.push(buildItem({
      category: 'coverage-gap',
      domain,
      severity: severe ? 'moderate' : 'minor',
      title: `${domain} observation drought`,
      description: `Only ${count} observation${count === 1 ? '' : 's'} in the last 24h for ${domain}. Coverage may be incomplete.`,
      compoundingRate: 'slow',
      estimatedCostToRepair: 'Verify feed routing; ~1 analyst-hour',
    }, detectedAt));
  }
}

function detectModelDrift(params: ScanParams, detectedAt: Date, out: DebtItem[]): void {
  const degrading = params.algoStats.filter((s) => s.trend === 'degrading');
  if (degrading.length === 0) return;
  const severity: DebtSeverity = degrading.length >= 2 ? 'significant' : 'moderate';
  const domain = degrading.length === 1 ? degrading[0]!.domain : 'multiple';
  out.push(buildItem({
    category: 'model-drift',
    domain,
    severity,
    title: degrading.length > 1
      ? `Algorithm accuracy degrading (${degrading.length} algos)`
      : 'Algorithm accuracy degrading',
    description: `${degrading.length} algorithm${degrading.length === 1 ? '' : 's'} with accuracy trending downward. Predictions may be systematically off.`,
    compoundingRate: 'fast',
    estimatedCostToRepair: 'Re-tune driver weights and retrain; ~3 analyst-hours',
  }, detectedAt));
}

function detectAssumptionDebt(params: ScanParams, detectedAt: Date, out: DebtItem[]): void {
  const critical = params.assumptionStats.criticalCount;
  let severity: DebtSeverity | null = null;
  if (critical > ASSUMPTION_CRITICAL_CRITICAL) severity = 'critical';
  else if (critical > ASSUMPTION_CRITICAL_SIGNIFICANT) severity = 'significant';
  else if (critical > ASSUMPTION_CRITICAL_MODERATE) severity = 'moderate';
  if (!severity) return;
  out.push(buildItem({
    category: 'assumption-debt',
    domain: 'system',
    severity,
    title: `${critical} unresolved critical assumptions`,
    description: `${critical} critical assumptions across ${params.assumptionStats.totalOutputs} outputs. Each unresolved critical assumption is a place the system could be wrong without realizing.`,
    compoundingRate: 'fast',
    estimatedCostToRepair: 'Resolve high-priority assumptions; ~2 analyst-hours per batch',
  }, detectedAt));
}

function detectCalibrationLag(params: ScanParams, now: number, detectedAt: Date, out: DebtItem[]): void {
  for (const [domain, count] of Object.entries(params.outcomeCountByDomain)) {
    if (count <= CALIBRATION_OUTCOMES_FLOOR) continue;
    const last = params.lastOutcomeByDomain?.[domain] ?? null;
    if (!last) continue;
    const ageDays = (now - last.getTime()) / DAY_MS;
    if (ageDays < CALIBRATION_STALE_DAYS) continue;
    out.push(buildItem({
      category: 'calibration-lag',
      domain,
      severity: 'minor',
      title: `${domain} calibration stale (${Math.round(ageDays)}d)`,
      description: `${domain} has ${count} graded outcomes but the most recent is ${Math.round(ageDays)} days old. Per-domain calibration may be drifting.`,
      compoundingRate: 'slow',
      estimatedCostToRepair: 'Recompute calibration; automated fix available',
    }, detectedAt));
  }
}

function detectTestCoverage(params: ScanParams, now: number, detectedAt: Date, out: DebtItem[]): void {
  for (const [domain, last] of Object.entries(params.lastBacktestByDomain)) {
    if (last) {
      const ageDays = (now - last.getTime()) / DAY_MS;
      if (ageDays < BACKTEST_STALE_DAYS) continue;
    }
    out.push(buildItem({
      category: 'test-coverage',
      domain,
      severity: 'minor',
      title: `${domain} backtest stale`,
      description: last
        ? `${domain} has not been backtested in ${Math.round((now - last.getTime()) / DAY_MS)} days.`
        : `${domain} has never been backtested.`,
      compoundingRate: 'none',
      estimatedCostToRepair: 'Schedule backtest run; ~30 min',
    }, detectedAt));
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

interface ItemBuild {
  category: DebtCategory;
  domain: string;
  severity: DebtSeverity;
  title: string;
  description: string;
  compoundingRate: CompoundingRate;
  estimatedCostToRepair: string;
}

function buildItem(b: ItemBuild, detectedAt: Date): DebtItem {
  return {
    id: `debt-${b.category}-${b.domain}-${detectedAt.getTime()}`,
    category: b.category,
    domain: b.domain,
    severity: b.severity,
    title: b.title,
    description: b.description,
    ageMs: 0,
    estimatedCostToRepair: b.estimatedCostToRepair,
    compoundingRate: b.compoundingRate,
    relatedItemIds: [],
    status: 'open',
    detectedAt,
  };
}

function fingerprint(item: DebtItem): string {
  return `${item.category}|${item.domain}`;
}

function pickTopPriority(open: readonly DebtItem[]): DebtItem | null {
  if (open.length === 0) return null;
  let pick = open[0]!;
  for (const item of open) {
    if (compareTopPriority(item, pick) > 0) pick = item;
  }
  return pick;
}

function compareTopPriority(a: DebtItem, b: DebtItem): number {
  const sevA = SEVERITY_RANK.indexOf(a.severity);
  const sevB = SEVERITY_RANK.indexOf(b.severity);
  if (sevA !== sevB) return sevA - sevB;
  const compA = COMPOUNDING_RANK.indexOf(a.compoundingRate);
  const compB = COMPOUNDING_RANK.indexOf(b.compoundingRate);
  return compA - compB;
}

function decideTrend(prior: number | null, current: number): DebtTrend {
  if (prior === null) return 'stable';
  const delta = current - prior;
  if (delta > TREND_THRESHOLD) return 'accumulating';
  if (delta < -TREND_THRESHOLD) return 'reducing';
  return 'stable';
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
