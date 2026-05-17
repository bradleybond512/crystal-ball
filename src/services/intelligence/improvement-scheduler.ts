/**
 * Improvement Scheduler — autonomous loop that fires Crystal Ball's
 * self-improvement pipeline (calibration, safety, debt, bias, repair)
 * on per-task cadences. Pure scheduling infrastructure: each task's
 * runner is a no-op stub by default; future PRs wire the actual
 * service calls via the `taskRunners` injection point.
 *
 * Tests run without timers by calling `tick()` / `runNow()` directly
 * with an injected clock. In production, `start()` installs a
 * setInterval that calls `tick()` every CHECK_INTERVAL_MS.
 */

// ── Public types ─────────────────────────────────────────────────────────

export type ScheduledTaskId =
  | 'purge-expired-learning-items'
  | 'recalibrate-attention'
  | 'adjust-trust-budgets'
  | 'run-safety-evaluation'
  | 'scan-quality-debt'
  | 'scan-bias'
  | 'generate-repair-recs'
  | 'update-domain-scorecards';

export type RunResult = 'success' | 'error' | 'skipped';

export interface ScheduledTask {
  id: ScheduledTaskId;
  name: string;
  description: string;
  intervalMs: number;
  lastRunAt: Date | null;
  nextRunAt: Date;
  lastResult: RunResult | null;
  lastErrorMessage?: string;
  runCount: number;
  enabled: boolean;
}

export interface SchedulerRun {
  id: string;
  taskId: ScheduledTaskId;
  startedAt: Date;
  completedAt: Date;
  result: RunResult;
  durationMs: number;
  errorMessage?: string;
}

export interface SchedulerStats {
  totalRuns: number;
  successRate: number;
  avgDurationMs: number;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
}

export type TaskRunner = () => void | Promise<void>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ImprovementSchedulerOptions {
  storage?: StorageLike | null;
  now?: () => number;
  /** Override the no-op runner for one or more tasks. Future PRs wire
   *  the real service calls here without changing the scheduler. */
  taskRunners?: Partial<Record<ScheduledTaskId, TaskRunner>>;
  /** Override the check cadence used by start()/stop(). Default 60s. */
  checkIntervalMs?: number;
}

export interface ImprovementScheduler {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  /** Run a single check pass. Public so tests can drive the scheduler
   *  deterministically without timers. */
  tick(): Promise<void>;
  runNow(taskId: ScheduledTaskId): Promise<SchedulerRun>;
  getTask(id: ScheduledTaskId): ScheduledTask;
  getAllTasks(): ScheduledTask[];
  enableTask(id: ScheduledTaskId): void;
  disableTask(id: ScheduledTaskId): void;
  getHistory(taskId?: ScheduledTaskId, limit?: number): SchedulerRun[];
  stats(): SchedulerStats;
  subscribe(cb: (run: SchedulerRun) => void): () => void;
}

// ── Constants + defaults ─────────────────────────────────────────────────

export const TASK_STORAGE_KEY = 'wm-scheduler-tasks';
export const HISTORY_STORAGE_KEY = 'wm-scheduler-history';
export const HISTORY_LIMIT = 500;
const DEFAULT_CHECK_INTERVAL_MS = 60_000;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export interface TaskDefinition {
  id: ScheduledTaskId;
  name: string;
  description: string;
  intervalMs: number;
}

export const TASK_DEFINITIONS: readonly TaskDefinition[] = [
  {
    id: 'purge-expired-learning-items', name: 'Purge expired learning items',
    description: 'ActiveLearningQueue.purgeExpired() — drop unreviewed items past 24h.',
    intervalMs: DAY_MS,
  },
  {
    id: 'recalibrate-attention', name: 'Recalibrate attention',
    description: 'AttentionAllocator.recompute() — refresh per-domain attention multipliers from outcomes.',
    intervalMs: DAY_MS,
  },
  {
    id: 'adjust-trust-budgets', name: 'Adjust trust budgets',
    description: 'TrustBudget.adjustQuotas() + rechargeAll() — re-apply outcome-driven quota adjustments.',
    intervalMs: HOUR_MS,
  },
  {
    id: 'run-safety-evaluation', name: 'Run safety evaluation',
    description: 'SafetyCase.evaluate() — re-check safety arguments against current evidence.',
    intervalMs: 6 * HOUR_MS,
  },
  {
    id: 'scan-quality-debt', name: 'Scan quality debt',
    description: 'QualityDebt.scan() — re-tally stale fixtures, unverified assumptions, dead detectors.',
    intervalMs: 12 * HOUR_MS,
  },
  {
    id: 'scan-bias', name: 'Scan for bias',
    description: 'BiasDetector.scan() — re-run the 6 bias detectors over recent activity.',
    intervalMs: 4 * HOUR_MS,
  },
  {
    id: 'generate-repair-recs', name: 'Generate repair recommendations',
    description: 'RepairEngine.generateFromSafetyCase() — propose mitigations for safety case gaps.',
    intervalMs: 6 * HOUR_MS,
  },
  {
    id: 'update-domain-scorecards', name: 'Update domain scorecards',
    description: 'DomainScorecard.generateAll() — refresh per-domain A–F grades.',
    intervalMs: DAY_MS,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────

let _runIdCounter = 0;
function nextRunId(nowMs: number): string {
  _runIdCounter += 1;
  return `run-${nowMs.toString(36)}-${_runIdCounter.toString(36)}`;
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function freshTask(def: TaskDefinition, nowMs: number): ScheduledTask {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    intervalMs: def.intervalMs,
    lastRunAt: null,
    nextRunAt: new Date(nowMs),
    lastResult: null,
    runCount: 0,
    enabled: true,
  };
}

function cloneTask(t: ScheduledTask): ScheduledTask {
  return {
    ...t,
    lastRunAt: t.lastRunAt ? new Date(t.lastRunAt) : null,
    nextRunAt: new Date(t.nextRunAt),
  };
}

function cloneRun(r: SchedulerRun): SchedulerRun {
  return {
    ...r,
    startedAt: new Date(r.startedAt),
    completedAt: new Date(r.completedAt),
  };
}

interface PersistedTask {
  id: ScheduledTaskId;
  intervalMs: number;
  lastRunAt: string | null;
  nextRunAt: string;
  lastResult: RunResult | null;
  lastErrorMessage?: string;
  runCount: number;
  enabled: boolean;
}

interface PersistedRun {
  id: string;
  taskId: ScheduledTaskId;
  startedAt: string;
  completedAt: string;
  result: RunResult;
  durationMs: number;
  errorMessage?: string;
}

function serializeTask(t: ScheduledTask): PersistedTask {
  return {
    id: t.id,
    intervalMs: t.intervalMs,
    lastRunAt: t.lastRunAt ? t.lastRunAt.toISOString() : null,
    nextRunAt: t.nextRunAt.toISOString(),
    lastResult: t.lastResult,
    lastErrorMessage: t.lastErrorMessage,
    runCount: t.runCount,
    enabled: t.enabled,
  };
}

function serializeRun(r: SchedulerRun): PersistedRun {
  return {
    id: r.id,
    taskId: r.taskId,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt.toISOString(),
    result: r.result,
    durationMs: r.durationMs,
    errorMessage: r.errorMessage,
  };
}

function deserializeTask(raw: unknown, def: TaskDefinition, nowMs: number): ScheduledTask {
  const fallback = freshTask(def, nowMs);
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Partial<PersistedTask>;
  const lastRunAt = typeof r.lastRunAt === 'string' ? new Date(r.lastRunAt) : null;
  const nextRunAt = typeof r.nextRunAt === 'string' ? new Date(r.nextRunAt) : fallback.nextRunAt;
  return {
    ...fallback,
    lastRunAt: lastRunAt && !Number.isNaN(lastRunAt.getTime()) ? lastRunAt : null,
    nextRunAt: Number.isNaN(nextRunAt.getTime()) ? fallback.nextRunAt : nextRunAt,
    lastResult: (r.lastResult === 'success' || r.lastResult === 'error' || r.lastResult === 'skipped')
      ? r.lastResult : null,
    lastErrorMessage: typeof r.lastErrorMessage === 'string' ? r.lastErrorMessage : undefined,
    runCount: typeof r.runCount === 'number' ? r.runCount : 0,
    enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
  };
}

function deserializeRun(raw: unknown): SchedulerRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<PersistedRun>;
  if (typeof r.id !== 'string' || typeof r.taskId !== 'string') return null;
  if (typeof r.startedAt !== 'string' || typeof r.completedAt !== 'string') return null;
  const startedAt = new Date(r.startedAt);
  const completedAt = new Date(r.completedAt);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(completedAt.getTime())) return null;
  return {
    id: r.id,
    taskId: r.taskId as ScheduledTaskId,
    startedAt,
    completedAt,
    result: (r.result === 'success' || r.result === 'error' || r.result === 'skipped') ? r.result : 'skipped',
    durationMs: typeof r.durationMs === 'number' ? r.durationMs : 0,
    errorMessage: typeof r.errorMessage === 'string' ? r.errorMessage : undefined,
  };
}

function rehydrateTasks(storage: StorageLike | null, nowMs: number): Map<ScheduledTaskId, ScheduledTask> {
  const out = new Map<ScheduledTaskId, ScheduledTask>();
  let parsed: unknown = null;
  if (storage) {
    try {
      const raw = storage.getItem(TASK_STORAGE_KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch { parsed = null; }
  }
  const byId = new Map<string, unknown>();
  if (Array.isArray(parsed)) {
    for (const p of parsed) {
      if (p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string') {
        byId.set((p as { id: string }).id, p);
      }
    }
  }
  for (const def of TASK_DEFINITIONS) {
    out.set(def.id, deserializeTask(byId.get(def.id), def, nowMs));
  }
  return out;
}

function rehydrateHistory(storage: StorageLike | null): SchedulerRun[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(HISTORY_STORAGE_KEY); }
  catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: SchedulerRun[] = [];
  for (const p of parsed) {
    const r = deserializeRun(p);
    if (r) out.push(r);
  }
  return out;
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createImprovementScheduler(
  options: ImprovementSchedulerOptions = {},
): ImprovementScheduler {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const taskRunners = { ...options.taskRunners };
  const checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;

  const tasks = rehydrateTasks(storage, clock());
  let history: SchedulerRun[] = rehydrateHistory(storage);
  const listeners = new Set<(r: SchedulerRun) => void>();
  let timerHandle: ReturnType<typeof setInterval> | null = null;

  function persistTasks(): void {
    if (!storage) return;
    try {
      const payload = [...tasks.values()].map((t) => serializeTask(t));
      storage.setItem(TASK_STORAGE_KEY, JSON.stringify(payload));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function persistHistory(): void {
    if (!storage) return;
    try {
      const payload = history.map((r) => serializeRun(r));
      storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(payload));
    } catch { /* non-critical */ }
  }

  function recordRun(run: SchedulerRun): void {
    history = [run, ...history];
    if (history.length > HISTORY_LIMIT) {
      history = history.slice(0, HISTORY_LIMIT);
    }
    persistHistory();
    for (const cb of listeners) {
      try { cb(cloneRun(run)); } catch { /* listener crash isolation */ }
    }
  }

  async function executeTask(taskId: ScheduledTaskId): Promise<SchedulerRun> {
    const startedAtMs = clock();
    const task = tasks.get(taskId)!;
    if (!task.enabled) {
      const completedAtMs = clock();
      const run: SchedulerRun = {
        id: nextRunId(startedAtMs),
        taskId,
        startedAt: new Date(startedAtMs),
        completedAt: new Date(completedAtMs),
        result: 'skipped',
        durationMs: Math.max(0, completedAtMs - startedAtMs),
        errorMessage: 'Task is disabled.',
      };
      task.lastRunAt = new Date(startedAtMs);
      task.lastResult = 'skipped';
      task.nextRunAt = new Date(startedAtMs + task.intervalMs);
      persistTasks();
      recordRun(run);
      return cloneRun(run);
    }
    const runner = taskRunners[taskId] ?? defaultRunner;
    let result: RunResult = 'success';
    let errorMessage: string | undefined;
    try {
      await Promise.resolve(runner());
    } catch (error) {
      result = 'error';
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    const completedAtMs = clock();
    const run: SchedulerRun = {
      id: nextRunId(startedAtMs),
      taskId,
      startedAt: new Date(startedAtMs),
      completedAt: new Date(completedAtMs),
      result,
      durationMs: Math.max(0, completedAtMs - startedAtMs),
      errorMessage,
    };
    task.lastRunAt = new Date(startedAtMs);
    task.nextRunAt = new Date(startedAtMs + task.intervalMs);
    task.lastResult = result;
    task.lastErrorMessage = errorMessage;
    task.runCount += 1;
    persistTasks();
    recordRun(run);
    return cloneRun(run);
  }

  async function tickInternal(): Promise<void> {
    const nowMs = clock();
    for (const task of tasks.values()) {
      if (!task.enabled) continue;
      if (task.nextRunAt.getTime() > nowMs) continue;
      await executeTask(task.id);
    }
  }

  return {
    start(): void {
      if (timerHandle !== null) return;
      timerHandle = setInterval(() => { void tickInternal(); }, checkIntervalMs);
    },
    stop(): void {
      if (timerHandle === null) return;
      clearInterval(timerHandle);
      timerHandle = null;
    },
    isRunning(): boolean {
      return timerHandle !== null;
    },
    async tick(): Promise<void> {
      await tickInternal();
    },
    async runNow(taskId): Promise<SchedulerRun> {
      return executeTask(taskId);
    },
    getTask(id): ScheduledTask {
      const t = tasks.get(id);
      if (!t) throw new Error(`Unknown task id: ${id}`);
      return cloneTask(t);
    },
    getAllTasks(): ScheduledTask[] {
      return [...tasks.values()].map((t) => cloneTask(t));
    },
    enableTask(id): void {
      const t = tasks.get(id);
      if (!t || t.enabled) return;
      t.enabled = true;
      persistTasks();
    },
    disableTask(id): void {
      const t = tasks.get(id);
      if (!t?.enabled) return;
      t.enabled = false;
      persistTasks();
    },
    getHistory(taskId, limit): SchedulerRun[] {
      let result = history;
      if (taskId) result = result.filter((r) => r.taskId === taskId);
      if (typeof limit === 'number') result = result.slice(0, limit);
      return result.map((r) => cloneRun(r));
    },
    stats(): SchedulerStats {
      let total = 0, success = 0, durationSum = 0;
      let lastRunAt: Date | null = null;
      for (const r of history) {
        total += 1;
        if (r.result === 'success') success += 1;
        durationSum += r.durationMs;
        if (!lastRunAt || r.startedAt.getTime() > lastRunAt.getTime()) {
          lastRunAt = r.startedAt;
        }
      }
      let nextRunAt: Date | null = null;
      for (const t of tasks.values()) {
        if (!t.enabled) continue;
        if (!nextRunAt || t.nextRunAt.getTime() < nextRunAt.getTime()) {
          nextRunAt = t.nextRunAt;
        }
      }
      return {
        totalRuns: total,
        successRate: total === 0 ? 0 : success / total,
        avgDurationMs: total === 0 ? 0 : durationSum / total,
        lastRunAt: lastRunAt ? new Date(lastRunAt) : null,
        nextRunAt: nextRunAt ? new Date(nextRunAt) : null,
      };
    },
    subscribe(cb): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}

function defaultRunner(): void {
  // No-op stub. Future PRs wire the real service calls via the
  // `taskRunners` injection point on createImprovementScheduler.
}

// ── Lazy singleton ───────────────────────────────────────────────────────

let _singleton: ImprovementScheduler | null = null;

export function getImprovementScheduler(): ImprovementScheduler {
  _singleton ??= createImprovementScheduler();
  return _singleton;
}

export function _resetImprovementSchedulerSingletonForTests(): void {
  _singleton?.stop();
  _singleton = null;
}
