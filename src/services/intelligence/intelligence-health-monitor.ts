/**
 * Intelligence Health Monitor Service — top-level "is the system
 * working?" view. Polls six key services and produces a unified
 * system health score with per-component breakdowns:
 *
 *   situation-store    — SituationStoreV2.list() callable?
 *   civilization-pulse — most recent overallScore / 100
 *   feed-watchdog      — healthy / total feeds
 *   safety-case        — overall pass rate
 *   trust-budget       — 1 - active-suppressions / total-domains
 *   improvement-scheduler — running?
 *
 * Every probe is null-safe: if the upstream service is missing,
 * unreachable, or throws, the probe reports status='unknown' with
 * score=0.5 rather than blowing up the dashboard.
 *
 * Pure module — no DOM, no fetch, no globals at import time.
 * Persists up to 200 snapshots under `wm-intelligence-health`
 * (ring buffer). Defensive deserialise + corrupt-blob recovery
 * + listener crash isolation.
 */

import { getSituationStoreV2 } from './situation-store-v2';
import { getCivilizationPulseEngine } from './civilization-pulse';
import { getSafetyCaseDashboardService } from './safety-case-dashboard';
import { getImprovementScheduler } from './improvement-scheduler';

// ── Public types ──────────────────────────────────────────────────────

export type ComponentStatus = 'ok' | 'degraded' | 'error' | 'unknown';
export type SystemStatus = 'ok' | 'degraded' | 'error';

export interface ComponentHealth {
  componentId: string;
  label: string;
  status: ComponentStatus;
  /** 0..1 — higher is healthier. */
  score: number;
  detail: string;
  lastCheckedAt: number;
}

export interface SystemHealthSnapshot {
  overallScore: number;
  overallStatus: SystemStatus;
  components: ComponentHealth[];
  checkedAt: number;
}

export interface HealthMonitorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type HealthMonitorListener = (snapshot: SystemHealthSnapshot) => void;

export type ProbeResult = Omit<ComponentHealth, 'componentId' | 'label' | 'lastCheckedAt'>;

/** A probe owns its componentId/label and produces a ComponentHealth.
 *  Probes MUST NOT throw — they should catch and return status='unknown'
 *  with detail explaining the failure. */
export interface HealthProbe {
  componentId: string;
  label: string;
  run(now: number): ProbeResult;
}

// ── Constants ─────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-intelligence-health';
export const MAX_HISTORY = 200;
export const OK_THRESHOLD = 0.8;
export const DEGRADED_THRESHOLD = 0.5;

// ── Helpers ───────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function statusFromScore(score: number): SystemStatus {
  if (score >= OK_THRESHOLD) return 'ok';
  if (score >= DEGRADED_THRESHOLD) return 'degraded';
  return 'error';
}

function unknownPartial(detail: string): ProbeResult {
  return { status: 'unknown', score: 0.5, detail };
}

// SystemStatus is a subset of ComponentStatus — same thresholds, so
// component status piggybacks on statusFromScore via an alias.
const componentStatusFromScore: (score: number) => ComponentStatus = statusFromScore;

function isValidComponent(v: unknown): v is ComponentHealth {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.componentId === 'string' &&
    typeof r.label === 'string' &&
    typeof r.status === 'string' &&
    typeof r.score === 'number' &&
    typeof r.detail === 'string' &&
    typeof r.lastCheckedAt === 'number'
  );
}

function isValidSnapshot(v: unknown): v is SystemHealthSnapshot {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (typeof r.overallScore !== 'number') return false;
  if (typeof r.overallStatus !== 'string') return false;
  if (typeof r.checkedAt !== 'number') return false;
  if (!Array.isArray(r.components)) return false;
  return r.components.every((c) => isValidComponent(c));
}

// ── Default probes ───────────────────────────────────────────────────

/** Best-effort wrapper — any throw / missing service collapses to
 *  unknown so the dashboard never crashes the renderer. */
function safeProbe(
  componentId: string,
  label: string,
  fn: () => Omit<ComponentHealth, 'componentId' | 'label' | 'lastCheckedAt'>,
): HealthProbe {
  return {
    componentId,
    label,
    run() {
      try {
        return fn();
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'probe threw';
        return unknownPartial(`probe failed: ${detail}`);
      }
    },
  };
}

export function buildDefaultProbes(): HealthProbe[] {
  return [
    safeProbe('situation-store', 'Situation Store', () => {
      const store = getSituationStoreV2() as unknown as { list?: () => unknown };
      const list = typeof store.list === 'function' ? store.list() : undefined;
      if (!Array.isArray(list)) return unknownPartial('list() not callable');
      return { status: 'ok', score: 1, detail: `${list.length} situations tracked` };
    }),
    safeProbe('civilization-pulse', 'Civilization Pulse', () => {
      const engine = getCivilizationPulseEngine() as unknown as {
        getLatestReading?: () => { overallScore?: number } | undefined;
      };
      const reading = typeof engine.getLatestReading === 'function' ? engine.getLatestReading() : undefined;
      if (!reading || typeof reading.overallScore !== 'number') {
        return unknownPartial('no pulse reading available');
      }
      const score = clamp01(reading.overallScore / 100);
      return { status: componentStatusFromScore(score), score, detail: `overallScore=${reading.overallScore.toFixed(1)}` };
    }),
    safeProbe('feed-watchdog', 'Feed Watchdog', () =>
      // No singleton accessor exists in this repo — feed health is a
      // pure function over the catalog. Operators can replace this
      // probe with a wired-up version via setProbes().
      unknownPartial('no singleton — inject a custom probe to populate'),
    ),
    safeProbe('safety-case', 'Safety Case', () => {
      const svc = getSafetyCaseDashboardService() as unknown as {
        getSummary?: () => { overallPassRate?: number; notImplementedCount?: number; totalChecks?: number } | undefined;
      };
      const summary = typeof svc.getSummary === 'function' ? svc.getSummary() : undefined;
      if (!summary || typeof summary.overallPassRate !== 'number') {
        return unknownPartial('no safety-case summary available');
      }
      const total = summary.totalChecks ?? 0;
      const notImpl = summary.notImplementedCount ?? 0;
      if (total > 0 && notImpl === total) {
        return unknownPartial('no implemented safety checks yet');
      }
      const score = clamp01(summary.overallPassRate);
      return { status: componentStatusFromScore(score), score, detail: `passRate=${(score * 100).toFixed(0)}%` };
    }),
    safeProbe('trust-budget', 'Trust Budget', () =>
      // computeTrustBudget needs an input bag — no singleton state.
      // Same story as feed-watchdog: inject a custom probe to wire.
      unknownPartial('no singleton — inject a custom probe to populate'),
    ),
    safeProbe('improvement-scheduler', 'Improvement Scheduler', () => {
      const scheduler = getImprovementScheduler() as unknown as { isRunning?: () => boolean };
      const running = typeof scheduler.isRunning === 'function' ? scheduler.isRunning() : undefined;
      if (typeof running !== 'boolean') return unknownPartial('scheduler unavailable');
      return running
        ? { status: 'ok', score: 1, detail: 'running' }
        : { status: 'degraded', score: 0.5, detail: 'stopped' };
    }),
  ];
}

// ── Service ───────────────────────────────────────────────────────────

export class IntelligenceHealthMonitorService {
  private readonly storage: HealthMonitorStorage;
  private readonly clock: () => number;
  private readonly listeners = new Set<HealthMonitorListener>();
  private probes: HealthProbe[];
  private history: SystemHealthSnapshot[] = [];

  constructor(
    storage: HealthMonitorStorage,
    clock: () => number = () => Date.now(),
    probes?: HealthProbe[],
  ) {
    this.storage = storage;
    this.clock = clock;
    this.probes = probes ?? buildDefaultProbes();
    this.hydrate();
  }

  setProbes(probes: HealthProbe[]): void {
    this.probes = probes;
  }

  check(): SystemHealthSnapshot {
    const now = this.clock();
    const components: ComponentHealth[] = this.probes.map((probe) => {
      const partial = probe.run(now);
      return {
        componentId: probe.componentId,
        label: probe.label,
        status: partial.status,
        score: clamp01(partial.score),
        detail: partial.detail,
        lastCheckedAt: now,
      };
    });
    const overallScore = components.length === 0
      ? 0
      : components.reduce((sum, c) => sum + c.score, 0) / components.length;
    const snapshot: SystemHealthSnapshot = {
      overallScore,
      overallStatus: statusFromScore(overallScore),
      components,
      checkedAt: now,
    };
    this.history.push(snapshot);
    if (this.history.length > MAX_HISTORY) {
      this.history.splice(0, this.history.length - MAX_HISTORY);
    }
    this.persist();
    this.notify(snapshot);
    return { ...snapshot, components: snapshot.components.map((c) => ({ ...c })) };
  }

  getLatest(): SystemHealthSnapshot | null {
    const last = this.history[this.history.length - 1];
    if (!last) return null;
    return { ...last, components: last.components.map((c) => ({ ...c })) };
  }

  getHistory(limit?: number): SystemHealthSnapshot[] {
    const lifo: SystemHealthSnapshot[] = [];
    for (let i = this.history.length - 1; i >= 0; i--) {
      const snap = this.history[i];
      if (snap) lifo.push(snap);
    }
    const sliced = typeof limit === 'number' && limit >= 0 ? lifo.slice(0, limit) : lifo;
    return sliced.map((s) => ({ ...s, components: s.components.map((c) => ({ ...c })) }));
  }

  subscribe(cb: HealthMonitorListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // ── Internals ───────────────────────────────────────────────────────

  private hydrate(): void {
    let raw: string | null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const filtered = parsed.filter((s) => isValidSnapshot(s));
      this.history = filtered.slice(-MAX_HISTORY);
    } catch {
      try {
        this.storage.removeItem(STORAGE_KEY);
      } catch {
        /* noop */
      }
    }
  }

  private persist(): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.history));
    } catch {
      /* persistence is best-effort */
    }
  }

  private notify(snapshot: SystemHealthSnapshot): void {
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Crash isolation — one bad listener cannot poison the others.
      }
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let singleton: IntelligenceHealthMonitorService | null = null;

function defaultStorage(): HealthMonitorStorage {
  if (typeof globalThis !== 'undefined' && (globalThis as { localStorage?: HealthMonitorStorage }).localStorage) {
    return (globalThis as unknown as { localStorage: HealthMonitorStorage }).localStorage;
  }
  const mem = new Map<string, string>();
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) ?? null : null),
    setItem: (k, v) => {
      mem.set(k, v);
    },
    removeItem: (k) => {
      mem.delete(k);
    },
  };
}

export function getIntelligenceHealthMonitorService(): IntelligenceHealthMonitorService {
  singleton ??= new IntelligenceHealthMonitorService(defaultStorage());
  return singleton;
}

export function __resetIntelligenceHealthMonitorSingleton(): void {
  singleton = null;
}

export const __internals = {
  clamp01,
  statusFromScore,
  componentStatusFromScore,
  unknownPartial,
};
