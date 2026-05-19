import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SelfImprovementScheduler,
  STORAGE_KEY,
  MAX_RECORDS,
  DAILY_AUDIT_MS,
  WEEKLY_BACKTEST_MS,
  MONTHLY_REVIEW_MS,
  type ImprovementTask,
  type ImprovementTaskType,
  type StorageLike,
} from '../../src/services/intelligence/self-improvement-scheduler.ts';

// ── Test helpers ─────────────────────────────────────────────────────────

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, value); },
    removeItem(key: string) { store.delete(key); },
  };
}

const BASE_NOW = new Date('2026-05-19T12:00:00Z').getTime();

function makeScheduler(nowMs = BASE_NOW, storage?: StorageLike) {
  SelfImprovementScheduler._resetSingletonForTests();
  return new SelfImprovementScheduler({
    storage: storage ?? createMemoryStorage(),
    now: () => nowMs,
  });
}

// ── Constants ────────────────────────────────────────────────────────────

test('STORAGE_KEY is "wm-self-improvement-scheduler"', () => {
  assert.equal(STORAGE_KEY, 'wm-self-improvement-scheduler');
});

test('MAX_RECORDS is 200', () => {
  assert.equal(MAX_RECORDS, 200);
});

test('DAILY_AUDIT_MS is 24 hours in ms', () => {
  assert.equal(DAILY_AUDIT_MS, 24 * 60 * 60 * 1000);
});

test('WEEKLY_BACKTEST_MS is 7 days in ms', () => {
  assert.equal(WEEKLY_BACKTEST_MS, 7 * 24 * 60 * 60 * 1000);
});

test('MONTHLY_REVIEW_MS is 30 days in ms', () => {
  assert.equal(MONTHLY_REVIEW_MS, 30 * 24 * 60 * 60 * 1000);
});

// ── Singleton ────────────────────────────────────────────────────────────

test('getInstance returns the same instance on repeated calls', () => {
  SelfImprovementScheduler._resetSingletonForTests();
  const a = SelfImprovementScheduler.getInstance();
  const b = SelfImprovementScheduler.getInstance();
  assert.strictEqual(a, b);
  SelfImprovementScheduler._resetSingletonForTests();
});

// ── Auto-init recurring tasks ─────────────────────────────────────────────

test('auto-init: schedules daily audit task on construction', () => {
  const sched = makeScheduler();
  const schedule = sched.getSchedule();
  const audit = schedule.find(t => t.taskType === 'audit');
  assert.ok(audit, 'should have an audit task');
  assert.equal(audit.status, 'pending');
  assert.equal(audit.triggeredBy, 'schedule');
});

test('auto-init: schedules weekly backtest task on construction', () => {
  const sched = makeScheduler();
  const schedule = sched.getSchedule();
  const backtest = schedule.find(t => t.taskType === 'backtest');
  assert.ok(backtest, 'should have a backtest task');
  assert.equal(backtest.status, 'pending');
  assert.equal(backtest.triggeredBy, 'schedule');
});

test('auto-init: schedules monthly review task on construction', () => {
  const sched = makeScheduler();
  const schedule = sched.getSchedule();
  const review = schedule.find(t => t.taskType === 'review');
  assert.ok(review, 'should have a review task');
  assert.equal(review.status, 'pending');
  assert.equal(review.triggeredBy, 'schedule');
});

test('auto-init: audit scheduledAt is BASE_NOW + 24h', () => {
  const sched = makeScheduler();
  const audit = sched.getSchedule().find(t => t.taskType === 'audit')!;
  assert.equal(audit.scheduledAt, BASE_NOW + DAILY_AUDIT_MS);
});

test('auto-init: backtest scheduledAt is BASE_NOW + 7d', () => {
  const sched = makeScheduler();
  const backtest = sched.getSchedule().find(t => t.taskType === 'backtest')!;
  assert.equal(backtest.scheduledAt, BASE_NOW + WEEKLY_BACKTEST_MS);
});

test('auto-init: review scheduledAt is BASE_NOW + 30d', () => {
  const sched = makeScheduler();
  const review = sched.getSchedule().find(t => t.taskType === 'review')!;
  assert.equal(review.scheduledAt, BASE_NOW + MONTHLY_REVIEW_MS);
});

// ── scheduleTask ──────────────────────────────────────────────────────────

test('scheduleTask: returns a task with correct shape', () => {
  const sched = makeScheduler();
  const task = sched.scheduleTask('recalibrate');
  assert.equal(typeof task.id, 'string');
  assert.ok(task.id.length > 0);
  assert.equal(task.taskType, 'recalibrate');
  assert.equal(task.status, 'pending');
  assert.equal(task.triggeredBy, 'manual');
  assert.equal(typeof task.scheduledAt, 'number');
  assert.equal(task.completedAt, undefined);
  assert.equal(task.result, undefined);
});

test('scheduleTask: default delay schedules task at now', () => {
  const sched = makeScheduler();
  const task = sched.scheduleTask('recalibrate');
  assert.equal(task.scheduledAt, BASE_NOW);
});

test('scheduleTask: custom delayMs offsets scheduledAt from now', () => {
  const sched = makeScheduler();
  const task = sched.scheduleTask('retrain', undefined, 5_000);
  assert.equal(task.scheduledAt, BASE_NOW + 5_000);
});

test('scheduleTask: stores optional domain on task', () => {
  const sched = makeScheduler();
  const task = sched.scheduleTask('recalibrate', 'weather');
  assert.equal(task.domain, 'weather');
});

test('scheduleTask: task without domain has undefined domain', () => {
  const sched = makeScheduler();
  const task = sched.scheduleTask('retrain');
  assert.equal(task.domain, undefined);
});

test('scheduleTask: deduplication — skips if same type+domain pending exists', () => {
  const sched = makeScheduler();
  const first = sched.scheduleTask('recalibrate', 'geo');
  const second = sched.scheduleTask('recalibrate', 'geo');
  assert.strictEqual(first.id, second.id);
  assert.equal(sched.getSchedule().filter(t => t.taskType === 'recalibrate' && t.domain === 'geo').length, 1);
});

test('scheduleTask: deduplication — skips if same type (no domain) pending exists', () => {
  const sched = makeScheduler();
  const first = sched.scheduleTask('retrain');
  const second = sched.scheduleTask('retrain');
  assert.strictEqual(first.id, second.id);
});

test('scheduleTask: allows same type with different domains', () => {
  const sched = makeScheduler();
  const a = sched.scheduleTask('recalibrate', 'weather');
  const b = sched.scheduleTask('recalibrate', 'geo');
  assert.notEqual(a.id, b.id);
});

test('scheduleTask: allows different types for same domain', () => {
  const sched = makeScheduler();
  const a = sched.scheduleTask('recalibrate', 'weather');
  const b = sched.scheduleTask('retrain', 'weather');
  assert.notEqual(a.id, b.id);
});

test('scheduleTask: allows new task if prior same type+domain was completed', () => {
  const sched = makeScheduler();
  const first = sched.scheduleTask('audit', 'weather');
  sched.tick(BASE_NOW);
  sched.completeTask(first.id, 'done');
  const second = sched.scheduleTask('audit', 'weather');
  assert.notEqual(first.id, second.id);
});

test('scheduleTask: allows new task if prior same type+domain was failed', () => {
  const sched = makeScheduler();
  const first = sched.scheduleTask('audit', 'weather');
  sched.tick(BASE_NOW);
  sched.failTask(first.id, 'error');
  const second = sched.scheduleTask('audit', 'weather');
  assert.notEqual(first.id, second.id);
});

// ── tick ─────────────────────────────────────────────────────────────────

test('tick: returns tasks whose scheduledAt <= now and status=pending', () => {
  const sched = makeScheduler();
  const task = sched.scheduleTask('recalibrate');
  const running = sched.tick(BASE_NOW);
  assert.equal(running.length >= 1, true);
  assert.ok(running.some(t => t.id === task.id));
});

test('tick: marks returned tasks as running', () => {
  const sched = makeScheduler();
  const task = sched.scheduleTask('recalibrate');
  sched.tick(BASE_NOW);
  const inSchedule = sched.getSchedule().find(t => t.id === task.id)!;
  assert.equal(inSchedule.status, 'running');
});

test('tick: does not return future tasks', () => {
  const sched = makeScheduler();
  sched.scheduleTask('retrain', undefined, 10_000);
  const running = sched.tick(BASE_NOW);
  assert.ok(!running.some(t => t.taskType === 'retrain' && t.domain === undefined));
});

test('tick: does not re-return already-running tasks', () => {
  const sched = makeScheduler();
  sched.scheduleTask('recalibrate');
  sched.tick(BASE_NOW);
  const second = sched.tick(BASE_NOW);
  assert.ok(!second.some(t => t.taskType === 'recalibrate'));
});

test('tick: does not return completed tasks', () => {
  const sched = makeScheduler();
  const task = sched.scheduleTask('recalibrate');
  sched.tick(BASE_NOW);
  sched.completeTask(task.id, 'ok');
  const next = sched.tick(BASE_NOW);
  assert.ok(!next.some(t => t.id === task.id));
});

test('tick: returns multiple tasks due at same time', () => {
  const sched = makeScheduler();
  sched.scheduleTask('recalibrate');
  sched.scheduleTask('retrain');
  const running = sched.tick(BASE_NOW);
  assert.ok(running.some(t => t.taskType === 'recalibrate'));
  assert.ok(running.some(t => t.taskType === 'retrain'));
});

// ── completeTask ──────────────────────────────────────────────────────────

test('completeTask: marks task as completed', () => {
  const sched = makeScheduler();
  const task = sched.scheduleTask('recalibrate');
  sched.tick(BASE_NOW);
  sched.completeTask(task.id, 'accuracy improved');
  const history = sched.getHistory();
  const found = history.find(t => t.id === task.id)!;
  assert.equal(found.status, 'completed');
});

test('completeTask: sets completedAt to current time', () => {
  const sched = makeScheduler();
  const task = sched.scheduleTask('recalibrate');
  sched.tick(BASE_NOW);
  sched.completeTask(task.id, 'ok');
  const found = sched.getHistory().find(t => t.id === task.id)!;
  assert.equal(found.completedAt, BASE_NOW);
});

test('completeTask: stores result', () => {
  const sched = makeScheduler();
  const task = sched.scheduleTask('recalibrate');
  sched.tick(BASE_NOW);
  sched.completeTask(task.id, 'precision: 0.92');
  const found = sched.getHistory().find(t => t.id === task.id)!;
  assert.equal(found.result, 'precision: 0.92');
});

test('completeTask: no-op for unknown id', () => {
  const sched = makeScheduler();
  assert.doesNotThrow(() => sched.completeTask('nonexistent', 'ok'));
});

test('completeTask: no-op if task is already completed', () => {
  const sched = makeScheduler();
  const task = sched.scheduleTask('recalibrate');
  sched.tick(BASE_NOW);
  sched.completeTask(task.id, 'first');
  sched.completeTask(task.id, 'second');
  const found = sched.getHistory().find(t => t.id === task.id)!;
  assert.equal(found.result, 'first');
});

// ── failTask ─────────────────────────────────────────────────────────────

test('failTask: marks task as failed', () => {
  const sched = makeScheduler();
  const task = sched.scheduleTask('backtest');
  sched.tick(BASE_NOW);
  sched.failTask(task.id, 'timeout');
  const found = sched.getHistory().find(t => t.id === task.id)!;
  assert.equal(found.status, 'failed');
});

test('failTask: stores reason as result', () => {
  const sched = makeScheduler();
  const task = sched.scheduleTask('backtest');
  sched.tick(BASE_NOW);
  sched.failTask(task.id, 'network error');
  const found = sched.getHistory().find(t => t.id === task.id)!;
  assert.equal(found.result, 'network error');
});

test('failTask: no-op for unknown id', () => {
  const sched = makeScheduler();
  assert.doesNotThrow(() => sched.failTask('nonexistent', 'err'));
});

// ── getSchedule ───────────────────────────────────────────────────────────

test('getSchedule: returns pending and running tasks', () => {
  const sched = makeScheduler();
  const pendingTask = sched.scheduleTask('recalibrate', undefined, 5_000);
  const runningTask = sched.scheduleTask('retrain');
  sched.tick(BASE_NOW);
  const schedule = sched.getSchedule();
  assert.ok(schedule.some(t => t.id === pendingTask.id && t.status === 'pending'));
  assert.ok(schedule.some(t => t.id === runningTask.id && t.status === 'running'));
});

test('getSchedule: excludes completed and failed tasks', () => {
  const sched = makeScheduler();
  const t1 = sched.scheduleTask('recalibrate');
  const t2 = sched.scheduleTask('retrain');
  sched.tick(BASE_NOW);
  sched.completeTask(t1.id, 'ok');
  sched.failTask(t2.id, 'err');
  const schedule = sched.getSchedule();
  assert.ok(!schedule.some(t => t.id === t1.id));
  assert.ok(!schedule.some(t => t.id === t2.id));
});

test('getSchedule: sorted by scheduledAt ascending', () => {
  const sched = makeScheduler();
  sched.scheduleTask('review', undefined, 2_000);
  sched.scheduleTask('recalibrate', undefined, 1_000);
  const schedule = sched.getSchedule().filter(t => t.triggeredBy === 'manual');
  for (let i = 1; i < schedule.length; i++) {
    assert.ok(schedule[i]!.scheduledAt >= schedule[i - 1]!.scheduledAt);
  }
});

// ── getHistory ────────────────────────────────────────────────────────────

test('getHistory: returns completed and failed tasks', () => {
  const sched = makeScheduler();
  const t1 = sched.scheduleTask('recalibrate');
  const t2 = sched.scheduleTask('retrain');
  sched.tick(BASE_NOW);
  sched.completeTask(t1.id, 'ok');
  sched.failTask(t2.id, 'err');
  const history = sched.getHistory();
  assert.ok(history.some(t => t.id === t1.id));
  assert.ok(history.some(t => t.id === t2.id));
});

test('getHistory: excludes pending and running tasks', () => {
  const sched = makeScheduler();
  const pending = sched.scheduleTask('review', undefined, 5_000);
  const running = sched.scheduleTask('recalibrate');
  sched.tick(BASE_NOW);
  const history = sched.getHistory();
  assert.ok(!history.some(t => t.id === pending.id));
  assert.ok(!history.some(t => t.id === running.id));
});

test('getHistory: newest first (descending completedAt)', () => {
  const sched = makeScheduler();
  const t1 = sched.scheduleTask('recalibrate');
  const t2 = sched.scheduleTask('retrain');
  sched.tick(BASE_NOW);
  sched.completeTask(t1.id, 'first');
  sched.completeTask(t2.id, 'second');
  const history = sched.getHistory().filter(t => t.triggeredBy === 'manual');
  assert.ok(history.length >= 2);
  for (let i = 1; i < history.length; i++) {
    assert.ok((history[i]!.completedAt ?? 0) <= (history[i - 1]!.completedAt ?? 0));
  }
});

test('getHistory: caps result at 100 entries', () => {
  const sched = makeScheduler();
  for (let i = 0; i < 110; i++) {
    const task = sched.scheduleTask('recalibrate', `domain-${i}`);
    sched.tick(BASE_NOW);
    sched.completeTask(task.id, 'ok');
  }
  assert.ok(sched.getHistory().length <= 100);
});

// ── Persistence ───────────────────────────────────────────────────────────

test('persists tasks to storage on mutation', () => {
  const storage = createMemoryStorage();
  const sched = makeScheduler(BASE_NOW, storage);
  sched.scheduleTask('recalibrate');
  assert.ok(storage.getItem(STORAGE_KEY) !== null);
});

test('rehydrates tasks from storage on construction', () => {
  const storage = createMemoryStorage();
  const sched1 = makeScheduler(BASE_NOW, storage);
  const task = sched1.scheduleTask('recalibrate');

  SelfImprovementScheduler._resetSingletonForTests();
  const sched2 = new SelfImprovementScheduler({ storage, now: () => BASE_NOW });
  const found = sched2.getSchedule().find(t => t.id === task.id);
  assert.ok(found, 'task should survive round-trip to storage');
  assert.equal(found.taskType, 'recalibrate');
});

test('gracefully handles corrupted storage (returns empty + auto-init tasks)', () => {
  const storage = createMemoryStorage();
  storage.setItem(STORAGE_KEY, 'not-valid-json{{{');
  SelfImprovementScheduler._resetSingletonForTests();
  const sched = new SelfImprovementScheduler({ storage, now: () => BASE_NOW });
  const schedule = sched.getSchedule();
  assert.ok(schedule.length >= 3, 'should have at least the 3 auto-init tasks');
});

// ── Ring buffer ───────────────────────────────────────────────────────────

test('ring buffer: total records capped at MAX_RECORDS=200', () => {
  const sched = makeScheduler();
  for (let i = 0; i < 250; i++) {
    const task = sched.scheduleTask('recalibrate', `d-${i}`);
    sched.tick(BASE_NOW);
    sched.completeTask(task.id, 'ok');
  }
  const total = sched.getSchedule().length + sched.getHistory().length;
  assert.ok(total <= MAX_RECORDS, `total ${total} should be <= ${MAX_RECORDS}`);
});
