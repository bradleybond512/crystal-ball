/**
 * Safety Case Dashboard — tracks the health of the 8 SafetyPropertyId
 * invariants (from repair-engine), auto-runs simple checks against
 * incoming Situations, and exposes a live coverage + pass-rate view.
 *
 * Pure service with injectable Storage + clock. Three properties have
 * actual heuristics today:
 *   - FEED-COVERAGE  → pass if situation has ≥1 signal
 *   - BIAS-FREE      → pass if signals span ≥2 distinct sources;
 *                       not_implemented when signals field is absent
 *   - ACCURACY       → pass if severity ≠ 'critical' OR signals ≥ 3
 *
 * The remaining 5 properties (FALSE-POSITIVE-RATE, ASSUMPTIONS-
 * DISCLOSED, ALGORITHM-STABLE, ALERT-BUDGET, HUMAN-IN-LOOP) report
 * `not_implemented` — a NEUTRAL third state, never red/failed. They
 * are excluded from pass-rate denominators and from criticalFailures
 * so the dashboard is honest rather than artificially green or red.
 * Later PRs replace each stub with a real detector without changing
 * the surrounding service or panel.
 */

import type { SafetyPropertyId } from './repair-engine';

// ── Public types ─────────────────────────────────────────────────────────

export type SafetyTrend = 'improving' | 'stable' | 'degrading';

export type SafetyCheckStatus = 'passed' | 'failed' | 'not_implemented';

export interface SafetyCheckResult {
  id: string;
  propertyId: SafetyPropertyId;
  situationId: string;
  status: SafetyCheckStatus;
  /** Derived from status for backwards-compat with summary math. */
  passed: boolean;
  evidence: string;
  checkedAt: number;
}

export interface SafetyPropertySummary {
  propertyId: SafetyPropertyId;
  totalChecks: number;
  passCount: number;
  failCount: number;
  /** Checks with status === 'not_implemented'. Excluded from passRate denominator. */
  notImplementedCount: number;
  passRate: number;
  lastCheckedAt: number | null;
  trend: SafetyTrend;
}

export interface SafetyCaseSummary {
  overallPassRate: number;
  totalChecks: number;
  /** Checks with status === 'not_implemented'. Excluded from overallPassRate denominator. */
  notImplementedCount: number;
  propertySummaries: SafetyPropertySummary[];
  /** Only includes checks with status === 'failed'. not_implemented checks are excluded. */
  criticalFailures: SafetyCheckResult[];
}

export interface SituationInput {
  id: string;
  severity: string;
  domain: string;
  signals?: unknown[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SafetyCaseDashboardOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

export interface SafetyCaseDashboardService {
  recordCheck(result: Omit<SafetyCheckResult, 'id' | 'checkedAt'>): SafetyCheckResult;
  runChecks(situation: SituationInput): SafetyCheckResult[];
  getSummary(): SafetyCaseSummary;
  getChecksForProperty(propertyId: SafetyPropertyId, limit?: number): SafetyCheckResult[];
  subscribe(cb: (summary: SafetyCaseSummary) => void): void;
  unsubscribe(cb: (summary: SafetyCaseSummary) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-safety-case';
export const MAX_CHECKS = 2000;
const CRITICAL_FAILURE_LIMIT = 10;
const TREND_WINDOW = 10;
const TREND_THRESHOLD = 0.05;

export const ALL_SAFETY_PROPERTY_IDS: readonly SafetyPropertyId[] = [
  'ACCURACY',
  'BIAS-FREE',
  'ASSUMPTIONS-DISCLOSED',
  'ALERT-BUDGET',
  'FEED-COVERAGE',
  'FALSE-POSITIVE-RATE',
  'HUMAN-IN-LOOP',
  'ALGORITHM-STABLE',
];

// ── Helpers ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(nowMs: number): string {
  _idCounter += 1;
  return `sc-${nowMs.toString(36)}-${_idCounter.toString(36)}`;
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function cloneCheck(c: SafetyCheckResult): SafetyCheckResult {
  return { ...c };
}

function rehydrate(storage: StorageLike | null): SafetyCheckResult[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: SafetyCheckResult[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const r = item as SafetyCheckResult;
    if (typeof r.id !== 'string') continue;
    out.push(r);
  }
  return out;
}

// ── Heuristics ──────────────────────────────────────────────────────────

interface HeuristicOutcome {
  status: SafetyCheckStatus;
  evidence: string;
}

function countDistinctSources(signals: readonly unknown[]): number {
  const sources = new Set<string>();
  for (const s of signals) {
    if (!s || typeof s !== 'object') continue;
    const sid = (s as { sourceId?: unknown }).sourceId;
    if (typeof sid === 'string') sources.add(sid);
  }
  return sources.size;
}

function checkFeedCoverage(situation: SituationInput): HeuristicOutcome {
  const count = situation.signals?.length ?? 0;
  return {
    status: count >= 1 ? 'passed' : 'failed',
    evidence: `signals=${count}`,
  };
}

function checkBiasFree(situation: SituationInput): HeuristicOutcome {
  if (situation.signals === undefined) {
    return { status: 'not_implemented', evidence: 'no real check wired yet' };
  }
  const distinct = countDistinctSources(situation.signals);
  return {
    status: distinct >= 2 ? 'passed' : 'failed',
    evidence: `distinct sources=${distinct}`,
  };
}

function checkAccuracy(situation: SituationInput): HeuristicOutcome {
  const isCritical = situation.severity === 'critical';
  const signalCount = situation.signals?.length ?? 0;
  const ok = !isCritical || signalCount >= 3;
  return {
    status: ok ? 'passed' : 'failed',
    evidence: `severity=${situation.severity}, signals=${signalCount}`,
  };
}

function checkStub(): HeuristicOutcome {
  return { status: 'not_implemented', evidence: 'no real check wired yet' };
}

function evaluateProperty(
  propertyId: SafetyPropertyId,
  situation: SituationInput,
): HeuristicOutcome {
  // Placeholder branches (FALSE-POSITIVE-RATE, ASSUMPTIONS-DISCLOSED,
  // ALGORITHM-STABLE, ALERT-BUDGET, HUMAN-IN-LOOP) return a stub
  // outcome until their detectors land. Replace with real heuristics
  // when the upstream services ship.
  switch (propertyId) {
    case 'FEED-COVERAGE': { return checkFeedCoverage(situation); }
    case 'BIAS-FREE': { return checkBiasFree(situation); }
    case 'ACCURACY': { return checkAccuracy(situation); }
    case 'FALSE-POSITIVE-RATE': { return checkStub(); }
    case 'ASSUMPTIONS-DISCLOSED': { return checkStub(); }
    case 'ALGORITHM-STABLE': { return checkStub(); }
    case 'ALERT-BUDGET': { return checkStub(); }
    case 'HUMAN-IN-LOOP': { return checkStub(); }
  }
}

// ── Summary builders ────────────────────────────────────────────────────

function passRate(passed: number, total: number): number {
  if (total === 0) return 0;
  return passed / total;
}

function computeTrend(checks: readonly SafetyCheckResult[]): SafetyTrend {
  if (checks.length < TREND_WINDOW * 2) return 'stable';
  // checks are stored oldest-first internally
  const lastN = checks.slice(-TREND_WINDOW);
  const priorN = checks.slice(-(TREND_WINDOW * 2), -TREND_WINDOW);
  const lastRate = passRate(lastN.filter((c) => c.passed).length, lastN.length);
  const priorRate = passRate(priorN.filter((c) => c.passed).length, priorN.length);
  const delta = lastRate - priorRate;
  if (delta > TREND_THRESHOLD) return 'improving';
  if (delta < -TREND_THRESHOLD) return 'degrading';
  return 'stable';
}

function buildPropertySummary(
  propertyId: SafetyPropertyId,
  checks: readonly SafetyCheckResult[],
): SafetyPropertySummary {
  const ofProperty = checks.filter((c) => c.propertyId === propertyId);
  const notImplementedCount = ofProperty.filter((c) => c.status === 'not_implemented').length;
  const implemented = ofProperty.filter((c) => c.status !== 'not_implemented');
  const passCount = implemented.filter((c) => c.passed).length;
  const failCount = implemented.length - passCount;
  const lastCheckedAt = ofProperty.length === 0
    ? null
    : ofProperty[ofProperty.length - 1]!.checkedAt;
  return {
    propertyId,
    totalChecks: ofProperty.length,
    passCount,
    failCount,
    notImplementedCount,
    passRate: passRate(passCount, implemented.length),
    lastCheckedAt,
    trend: computeTrend(ofProperty),
  };
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createSafetyCaseDashboardService(
  options: SafetyCaseDashboardOptions = {},
): SafetyCaseDashboardService {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const checks: SafetyCheckResult[] = rehydrate(storage);
  const listeners = new Set<(summary: SafetyCaseSummary) => void>();

  function persist(): void {
    if (!storage) return;
    try { storage.setItem(STORAGE_KEY, JSON.stringify(checks)); }
    catch { /* non-critical */ }
  }

  function buildSummary(): SafetyCaseSummary {
    const propertySummaries = ALL_SAFETY_PROPERTY_IDS.map(
      (id) => buildPropertySummary(id, checks),
    );
    const notImplementedCount = checks.filter((c) => c.status === 'not_implemented').length;
    const implementedChecks = checks.filter((c) => c.status !== 'not_implemented');
    const passCount = implementedChecks.filter((c) => c.passed).length;
    const overallPassRate = passRate(passCount, implementedChecks.length);
    const criticalFailures: SafetyCheckResult[] = [];
    for (let i = checks.length - 1; i >= 0 && criticalFailures.length < CRITICAL_FAILURE_LIMIT; i--) {
      const c = checks[i]!;
      if (c.status === 'failed') criticalFailures.push(cloneCheck(c));
    }
    return {
      overallPassRate,
      totalChecks: checks.length,
      notImplementedCount,
      propertySummaries,
      criticalFailures,
    };
  }

  function notify(): void {
    const snapshot = buildSummary();
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  function appendCheck(result: SafetyCheckResult): void {
    checks.push(result);
    if (checks.length > MAX_CHECKS) {
      checks.splice(0, checks.length - MAX_CHECKS);
    }
  }

  return {
    recordCheck(input): SafetyCheckResult {
      const now = clock();
      const result: SafetyCheckResult = {
        ...input,
        passed: input.status === 'passed',
        id: nextId(now),
        checkedAt: now,
      };
      appendCheck(result);
      persist();
      notify();
      return cloneCheck(result);
    },

    runChecks(situation): SafetyCheckResult[] {
      const now = clock();
      const out: SafetyCheckResult[] = [];
      for (const propertyId of ALL_SAFETY_PROPERTY_IDS) {
        const outcome = evaluateProperty(propertyId, situation);
        const result: SafetyCheckResult = {
          id: nextId(now),
          propertyId,
          situationId: situation.id,
          status: outcome.status,
          passed: outcome.status === 'passed',
          evidence: outcome.evidence,
          checkedAt: now,
        };
        appendCheck(result);
        out.push(result);
      }
      persist();
      notify();
      return out.map((r) => cloneCheck(r));
    },

    getSummary(): SafetyCaseSummary {
      return buildSummary();
    },

    getChecksForProperty(propertyId, limit): SafetyCheckResult[] {
      const out: SafetyCheckResult[] = [];
      const cap = limit ?? Infinity;
      for (let i = checks.length - 1; i >= 0 && out.length < cap; i--) {
        const c = checks[i]!;
        if (c.propertyId === propertyId) out.push(cloneCheck(c));
      }
      return out;
    },

    subscribe(cb): void { listeners.add(cb); },
    unsubscribe(cb): void { listeners.delete(cb); },
  };
}

// ── Lazy singleton ───────────────────────────────────────────────────────

let _singleton: SafetyCaseDashboardService | null = null;

export function getSafetyCaseDashboardService(): SafetyCaseDashboardService {
  _singleton ??= createSafetyCaseDashboardService();
  return _singleton;
}

export function _resetSafetyCaseDashboardSingletonForTests(): void {
  _singleton = null;
}
