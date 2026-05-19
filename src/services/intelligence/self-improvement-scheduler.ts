/**
 * Self-Improvement Scheduler — manages and sequences automated improvement
 * cycles for the intelligence pipeline. Schedules recalibration, model
 * updates, and performance reviews as discrete ImprovementTask records.
 *
 * Auto-schedules three recurring tasks on init (daily audit, weekly
 * backtest, monthly review). Supports on-demand task scheduling with
 * deduplication: no duplicate pending tasks of the same type+domain.
 *
 * Pure store: injectable Storage + clock. Persists under
 * `wm-self-improvement-scheduler` in a 200-record ring buffer.
 * getHistory() caps its output at 100 entries.
 */

// ── Public types ─────────────────────────────────────────────────────────

export type ImprovementTaskType = 'recalibrate' | 'retrain' | 'audit' | 'backtest' | 'review';
export type ImprovementTaskStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ImprovementTaskTrigger = 'schedule' | 'threshold' | 'manual';

export interface ImprovementTask {
  id: string;
  taskType: ImprovementTaskType;
  domain?: string;
  scheduledAt: number;
  completedAt?: number;
  status: ImprovementTaskStatus;
  result?: string;
  triggeredBy: ImprovementTaskTrigger;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SelfImprovementSchedulerOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-self-improvement-scheduler';
export const MAX_RECORDS = 200;
export const DAILY_AUDIT_MS = 24 * 60 * 60 * 1000;
export const WEEKLY_BACKTEST_MS = 7 * 24 * 60 * 60 * 1000;
export const MONTHLY_REVIEW_MS = 30 * 24 * 60 * 60 * 1000;

const HISTORY_CAP = 100;

// ── Helpers ───────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(nowMs: number): string {
  _idCounter += 1;
  return `sis-${nowMs.toString(36)}-${_idCounter.toString(36)}`;
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function deserializeTask(raw: unknown): ImprovementTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.scheduledAt !== 'number') return null;
  const taskType = r.taskType as string;
  if (!['recalibrate', 'retrain', 'audit', 'backtest', 'review'].includes(taskType)) return null;
  const status = r.status as string;
  if (!['pending', 'running', 'completed', 'failed'].includes(status)) return null;
  const triggeredBy = r.triggeredBy as string;
  if (!['schedule', 'threshold', 'manual'].includes(triggeredBy)) return null;
  return {
    id: r.id,
    taskType: taskType as ImprovementTaskType,
    domain: typeof r.domain === 'string' ? r.domain : undefined,
    scheduledAt: r.scheduledAt,
    completedAt: typeof r.completedAt === 'number' ? r.completedAt : undefined,
    status: status as ImprovementTaskStatus,
    result: typeof r.result === 'string' ? r.result : undefined,
    triggeredBy: triggeredBy as ImprovementTaskTrigger,
  };
}

function rehydrate(storage: StorageLike | null): ImprovementTask[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: ImprovementTask[] = [];
  for (const item of parsed) {
    const t = deserializeTask(item);
    if (t) out.push(t);
  }
  return out;
}

// ── Class ─────────────────────────────────────────────────────────────────

export class SelfImprovementScheduler {
  private static _instance: SelfImprovementScheduler | null = null;

  static getInstance(): SelfImprovementScheduler {
    SelfImprovementScheduler._instance ??= new SelfImprovementScheduler();
    return SelfImprovementScheduler._instance;
  }

  static _resetSingletonForTests(): void {
    SelfImprovementScheduler._instance = null;
  }

  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly tasks: ImprovementTask[];

  constructor(options: SelfImprovementSchedulerOptions = {}) {
    this.storage = resolveStorage(options.storage);
    this.clock = options.now ?? (() => Date.now());
    this.tasks = rehydrate(this.storage);
    this.initRecurring();
  }

  private initRecurring(): void {
    const nowMs = this.clock();
    this.scheduleRecurring('audit', nowMs + DAILY_AUDIT_MS);
    this.scheduleRecurring('backtest', nowMs + WEEKLY_BACKTEST_MS);
    this.scheduleRecurring('review', nowMs + MONTHLY_REVIEW_MS);
  }

  private scheduleRecurring(taskType: ImprovementTaskType, scheduledAt: number): void {
    const alreadyPending = this.tasks.some(
      t => t.taskType === taskType && t.domain === undefined &&
           (t.status === 'pending' || t.status === 'running'),
    );
    if (alreadyPending) return;
    const nowMs = this.clock();
    const task: ImprovementTask = {
      id: nextId(nowMs),
      taskType,
      scheduledAt,
      status: 'pending',
      triggeredBy: 'schedule',
    };
    this.tasks.push(task);
    this.persist();
  }

  scheduleTask(
    taskType: ImprovementTaskType,
    domain?: string,
    delayMs = 0,
  ): ImprovementTask {
    const existing = this.tasks.find(
      t => t.taskType === taskType &&
           t.domain === domain &&
           (t.status === 'pending' || t.status === 'running'),
    );
    if (existing) return { ...existing };

    const nowMs = this.clock();
    const task: ImprovementTask = {
      id: nextId(nowMs),
      taskType,
      domain,
      scheduledAt: nowMs + delayMs,
      status: 'pending',
      triggeredBy: 'manual',
    };
    this.tasks.push(task);
    this.capRingBuffer();
    this.persist();
    return { ...task };
  }

  tick(now: number): ImprovementTask[] {
    const due: ImprovementTask[] = [];
    for (const t of this.tasks) {
      if (t.status === 'pending' && t.scheduledAt <= now) {
        t.status = 'running';
        due.push({ ...t });
      }
    }
    if (due.length > 0) this.persist();
    return due;
  }

  completeTask(id: string, result: string): void {
    const task = this.tasks.find(t => t.id === id);
    if (!task || task.status === 'completed') return;
    task.status = 'completed';
    task.completedAt = this.clock();
    task.result = result;
    this.persist();
  }

  failTask(id: string, reason: string): void {
    const task = this.tasks.find(t => t.id === id);
    if (!task) return;
    task.status = 'failed';
    task.completedAt = this.clock();
    task.result = reason;
    this.persist();
  }

  getSchedule(): ImprovementTask[] {
    return this.tasks
      .filter(t => t.status === 'pending' || t.status === 'running')
      .sort((a, b) => a.scheduledAt - b.scheduledAt)
      .map(t => ({ ...t }));
  }

  getHistory(): ImprovementTask[] {
    return this.tasks
      .filter(t => t.status === 'completed' || t.status === 'failed')
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, HISTORY_CAP)
      .map(t => ({ ...t }));
  }

  private capRingBuffer(): void {
    if (this.tasks.length <= MAX_RECORDS) return;
    const drop = this.tasks.length - MAX_RECORDS;
    this.tasks.splice(0, drop);
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.tasks));
    } catch { /* quota / private-mode — non-critical */ }
  }
}
