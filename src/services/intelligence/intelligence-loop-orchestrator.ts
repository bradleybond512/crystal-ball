/**
 * Intelligence Loop Orchestrator Service — single entry point that
 * pipes an ObservationEvent through the full intelligence loop:
 *
 *   Normalize → Correlate → Explain → Prioritize → Act → Learn
 *
 * Wires the existing stage services together in the right order and
 * records the pipeline trace for debugging. Each stage runner is
 * injectable so the panel/service can be tested in isolation and so
 * the production wire-up can swap implementations without touching
 * the orchestrator.
 *
 * Errors in individual stages are caught and recorded as failed
 * StageResults — the pipeline keeps running. The overall PipelineRun
 * is marked unsuccessful if any stage failed.
 *
 * Pure module — no DOM, no fetch, no globals at import time.
 * Persists up to 500 runs under `wm-pipeline-runs` (ring buffer).
 * Defensive deserialise + corrupt-blob recovery + listener crash
 * isolation.
 */

import type { ObservationEvent } from './observation-types';

// ── Public types ──────────────────────────────────────────────────────

export type PipelineStage =
  | 'normalize'
  | 'correlate'
  | 'explain'
  | 'prioritize'
  | 'act'
  | 'learn';

export const PIPELINE_STAGES: readonly PipelineStage[] = [
  'normalize',
  'correlate',
  'explain',
  'prioritize',
  'act',
  'learn',
];

export interface StageResult {
  stage: PipelineStage;
  success: boolean;
  durationMs: number;
  outputSummary: string;
  error?: string;
}

export interface PipelineRun {
  id: string;
  observationId: string;
  startedAt: number;
  completedAt: number;
  stages: StageResult[];
  overallSuccess: boolean;
  totalDurationMs: number;
}

export interface PipelineRunners {
  normalize?: (obs: ObservationEvent) => ObservationEvent;
  correlate?: (obs: ObservationEvent) => void;
  explain?: (obs: ObservationEvent) => void;
  prioritize?: (obs: ObservationEvent) => void;
  act?: (obs: ObservationEvent) => void;
  learn?: (obs: ObservationEvent) => void;
}

export interface PipelineStats {
  totalRuns: number;
  /** Fraction of runs whose overallSuccess === true. */
  successRate: number;
  /** Mean totalDurationMs over the history window. */
  avgDurationMs: number;
  /** Per-stage success rate computed across runs that actually
   *  executed that stage (skipped stages don't count against). */
  stageSuccessRates: Record<PipelineStage, number>;
}

export interface OrchestratorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type OrchestratorListener = (run: PipelineRun) => void;

// ── Constants ─────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-pipeline-runs';
export const MAX_RUNS = 500;

// ── Helpers ───────────────────────────────────────────────────────────

function isValidStageResult(v: unknown): v is StageResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.stage === 'string' &&
    typeof r.success === 'boolean' &&
    typeof r.durationMs === 'number' &&
    typeof r.outputSummary === 'string'
  );
}

function isValidRun(v: unknown): v is PipelineRun {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string') return false;
  if (typeof r.observationId !== 'string') return false;
  if (typeof r.startedAt !== 'number') return false;
  if (typeof r.completedAt !== 'number') return false;
  if (typeof r.overallSuccess !== 'boolean') return false;
  if (typeof r.totalDurationMs !== 'number') return false;
  if (!Array.isArray(r.stages)) return false;
  return r.stages.every((s) => isValidStageResult(s));
}

function makeRunId(observationId: string, startedAt: number): string {
  return `run-${startedAt}-${observationId}`;
}

function summarizeEvent(obs: ObservationEvent): string {
  return `${obs.domain}/${obs.eventType} sev=${obs.severity} entities=${obs.entities.length}`;
}

// ── Service ───────────────────────────────────────────────────────────

export class IntelligenceLoopOrchestratorService {
  private readonly storage: OrchestratorStorage;
  private readonly clock: () => number;
  private readonly listeners = new Set<OrchestratorListener>();
  private runners: PipelineRunners;
  private history: PipelineRun[] = [];

  constructor(
    storage: OrchestratorStorage,
    clock: () => number = () => Date.now(),
    runners: PipelineRunners = {},
  ) {
    this.storage = storage;
    this.clock = clock;
    this.runners = runners;
    this.hydrate();
  }

  setRunners(runners: PipelineRunners): void {
    this.runners = runners;
  }

  run(observation: ObservationEvent): PipelineRun {
    const startedAt = this.clock();
    let current = observation;
    const stages: StageResult[] = [];

    for (const stage of PIPELINE_STAGES) {
      const result = this.runStage(stage, current);
      stages.push(result.result);
      if (stage === 'normalize' && result.normalizedEvent) {
        current = result.normalizedEvent;
      }
    }

    const completedAt = this.clock();
    const totalDurationMs = stages.reduce((sum, s) => sum + s.durationMs, 0);
    const executed = stages.filter((s) => s.outputSummary !== 'skipped');
    const overallSuccess = executed.length > 0 && executed.every((s) => s.success);

    const finalRun: PipelineRun = {
      id: makeRunId(observation.id, startedAt),
      observationId: observation.id,
      startedAt,
      completedAt,
      stages,
      overallSuccess,
      totalDurationMs,
    };

    this.history.push(finalRun);
    if (this.history.length > MAX_RUNS) {
      this.history.splice(0, this.history.length - MAX_RUNS);
    }
    this.persist();
    this.notify(finalRun);
    return { ...finalRun, stages: finalRun.stages.map((s) => ({ ...s })) };
  }

  getHistory(limit?: number): PipelineRun[] {
    const lifo: PipelineRun[] = [];
    for (let i = this.history.length - 1; i >= 0; i--) {
      const r = this.history[i];
      if (r) lifo.push(r);
    }
    const sliced = typeof limit === 'number' && limit >= 0 ? lifo.slice(0, limit) : lifo;
    return sliced.map((r) => ({ ...r, stages: r.stages.map((s) => ({ ...s })) }));
  }

  getStats(): PipelineStats {
    const total = this.history.length;
    if (total === 0) {
      return {
        totalRuns: 0,
        successRate: 0,
        avgDurationMs: 0,
        stageSuccessRates: emptyStageRates(),
      };
    }
    const successes = this.history.filter((r) => r.overallSuccess).length;
    const totalDuration = this.history.reduce((sum, r) => sum + r.totalDurationMs, 0);

    const stageExecuted: Record<PipelineStage, number> = emptyStageCounts();
    const stageSucceeded: Record<PipelineStage, number> = emptyStageCounts();
    for (const run of this.history) {
      for (const result of run.stages) {
        if (result.outputSummary === 'skipped') continue;
        stageExecuted[result.stage] = (stageExecuted[result.stage] ?? 0) + 1;
        if (result.success) {
          stageSucceeded[result.stage] = (stageSucceeded[result.stage] ?? 0) + 1;
        }
      }
    }

    const stageSuccessRates: Record<PipelineStage, number> = emptyStageRates();
    for (const stage of PIPELINE_STAGES) {
      const exec = stageExecuted[stage];
      stageSuccessRates[stage] = exec > 0 ? stageSucceeded[stage] / exec : 0;
    }

    return {
      totalRuns: total,
      successRate: successes / total,
      avgDurationMs: totalDuration / total,
      stageSuccessRates,
    };
  }

  subscribe(cb: OrchestratorListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // ── Internals ───────────────────────────────────────────────────────

  private runStage(
    stage: PipelineStage,
    obs: ObservationEvent,
  ): { result: StageResult; normalizedEvent?: ObservationEvent } {
    const started = this.clock();
    const runner = this.runners[stage];

    if (!runner) {
      const ended = this.clock();
      return {
        result: {
          stage,
          success: true,
          durationMs: Math.max(0, ended - started),
          outputSummary: 'skipped',
        },
      };
    }

    try {
      let normalizedEvent: ObservationEvent | undefined;
      let outputSummary: string;
      if (stage === 'normalize') {
        normalizedEvent = (runner as PipelineRunners['normalize'])!(obs);
        outputSummary = summarizeEvent(normalizedEvent);
      } else {
        (runner as (o: ObservationEvent) => void)(obs);
        outputSummary = `dispatched: ${summarizeEvent(obs)}`;
      }
      const ended = this.clock();
      return {
        result: {
          stage,
          success: true,
          durationMs: Math.max(0, ended - started),
          outputSummary,
        },
        normalizedEvent,
      };
    } catch (error) {
      const ended = this.clock();
      const message = error instanceof Error ? error.message : String(error);
      return {
        result: {
          stage,
          success: false,
          durationMs: Math.max(0, ended - started),
          outputSummary: `failed: ${message}`,
          error: message,
        },
      };
    }
  }

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
      const filtered = parsed.filter((r) => isValidRun(r));
      this.history = filtered.slice(-MAX_RUNS);
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

  private notify(run: PipelineRun): void {
    for (const listener of this.listeners) {
      try {
        listener(run);
      } catch {
        // Crash isolation — one bad listener cannot poison the others.
      }
    }
  }
}

function emptyStageCounts(): Record<PipelineStage, number> {
  return {
    normalize: 0,
    correlate: 0,
    explain: 0,
    prioritize: 0,
    act: 0,
    learn: 0,
  };
}

// rates and counts have identical zero-state — alias for readability at call sites.
const emptyStageRates = emptyStageCounts;

// ── Singleton ─────────────────────────────────────────────────────────

let singleton: IntelligenceLoopOrchestratorService | null = null;

function defaultStorage(): OrchestratorStorage {
  if (typeof globalThis !== 'undefined' && (globalThis as { localStorage?: OrchestratorStorage }).localStorage) {
    return (globalThis as unknown as { localStorage: OrchestratorStorage }).localStorage;
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

export function getIntelligenceLoopOrchestrator(): IntelligenceLoopOrchestratorService {
  singleton ??= new IntelligenceLoopOrchestratorService(defaultStorage());
  return singleton;
}

export function __resetIntelligenceLoopOrchestratorSingleton(): void {
  singleton = null;
}

export const __internals = {
  summarizeEvent,
  makeRunId,
  emptyStageCounts,
  emptyStageRates,
};
