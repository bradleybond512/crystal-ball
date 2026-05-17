import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createImprovementScheduler,
  TASK_STORAGE_KEY,
  HISTORY_STORAGE_KEY,
  HISTORY_LIMIT,
  TASK_DEFINITIONS,
  type ScheduledTaskId,
  type SchedulerRun,
} from '../../src/services/intelligence/improvement-scheduler.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.get(key) ?? null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    key(i: number) { return [...store.keys()][i] ?? null; },
    get length() { return store.size; },
  };
}

const NOW = new Date('2026-05-16T12:00:00Z').getTime();

// ── Constants + defaults ─────────────────────────────────────────────────

test('TASK_STORAGE_KEY is "wm-scheduler-tasks"', () => {
  assert.equal(TASK_STORAGE_KEY, 'wm-scheduler-tasks');
});

test('HISTORY_STORAGE_KEY is "wm-scheduler-history"', () => {
  assert.equal(HISTORY_STORAGE_KEY, 'wm-scheduler-history');
});

test('HISTORY_LIMIT is 500', () => {
  assert.equal(HISTORY_LIMIT, 500);
});

test('TASK_DEFINITIONS includes all 8 scheduled tasks', () => {
  const ids = TASK_DEFINITIONS.map((t) => t.id).sort();
  assert.deepEqual(ids, [
    'adjust-trust-budgets',
    'generate-repair-recs',
    'purge-expired-learning-items',
    'recalibrate-attention',
    'run-safety-evaluation',
    'scan-bias',
    'scan-quality-debt',
    'update-domain-scorecards',
  ]);
});

test('getAllTasks: returns 8 tasks with correct shape', () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  const tasks = svc.getAllTasks();
  assert.equal(tasks.length, 8);
  for (const t of tasks) {
    assert.ok(t.id);
    assert.ok(t.name);
    assert.ok(typeof t.intervalMs === 'number' && t.intervalMs > 0);
    assert.ok(t.nextRunAt instanceof Date);
    assert.equal(typeof t.enabled, 'boolean');
  }
});

test('default intervals match spec: hourly trust budgets, every 4h bias scan, daily attention', () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  const tasks = new Map(svc.getAllTasks().map((t) => [t.id, t]));
  assert.equal(tasks.get('adjust-trust-budgets')!.intervalMs, 60 * 60_000);
  assert.equal(tasks.get('scan-bias')!.intervalMs, 4 * 60 * 60_000);
  assert.equal(tasks.get('recalibrate-attention')!.intervalMs, 24 * 60 * 60_000);
  assert.equal(tasks.get('run-safety-evaluation')!.intervalMs, 6 * 60 * 60_000);
  assert.equal(tasks.get('scan-quality-debt')!.intervalMs, 12 * 60 * 60_000);
});

test('getTask returns single task by id', () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  const task = svc.getTask('scan-bias');
  assert.equal(task.id, 'scan-bias');
});

// ── runNow ───────────────────────────────────────────────────────────────

test('runNow returns SchedulerRun with success result for enabled task', async () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  const run = await svc.runNow('scan-bias');
  assert.equal(run.taskId, 'scan-bias');
  assert.equal(run.result, 'success');
  assert.ok(run.id);
  assert.ok(run.startedAt instanceof Date);
  assert.ok(run.completedAt instanceof Date);
});

test('runNow records the run in history', async () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  await svc.runNow('scan-bias');
  assert.equal(svc.getHistory().length, 1);
});

test('runNow updates lastRunAt and nextRunAt', async () => {
  let clock = NOW;
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => clock });
  await svc.runNow('scan-bias');
  const t = svc.getTask('scan-bias');
  assert.equal(t.lastRunAt?.getTime(), NOW);
  assert.equal(t.nextRunAt.getTime(), NOW + 4 * 60 * 60_000);
});

test('runNow on disabled task returns result=skipped without recording history', async () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  svc.disableTask('scan-bias');
  const run = await svc.runNow('scan-bias');
  assert.equal(run.result, 'skipped');
  // Skipped runs still appear in history so the operator can see why it didn't fire.
  assert.equal(svc.getHistory().length, 1);
  assert.equal(svc.getHistory()[0]!.result, 'skipped');
});

test('runNow records error result when task runner throws', async () => {
  const svc = createImprovementScheduler({
    storage: createMemoryStorage(), now: () => NOW,
    taskRunners: {
      'scan-bias': () => { throw new Error('boom'); },
    },
  });
  const run = await svc.runNow('scan-bias');
  assert.equal(run.result, 'error');
  assert.match(run.errorMessage ?? '', /boom/);
});

test('runNow increments runCount on the task', async () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  await svc.runNow('scan-bias');
  await svc.runNow('scan-bias');
  assert.equal(svc.getTask('scan-bias').runCount, 2);
});

// ── enable / disable ─────────────────────────────────────────────────────

test('enableTask + disableTask toggle the enabled flag', () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  svc.disableTask('scan-bias');
  assert.equal(svc.getTask('scan-bias').enabled, false);
  svc.enableTask('scan-bias');
  assert.equal(svc.getTask('scan-bias').enabled, true);
});

// ── tick / start / stop ──────────────────────────────────────────────────

test('isRunning is false before start, true after start, false after stop', () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  assert.equal(svc.isRunning(), false);
  svc.start();
  assert.equal(svc.isRunning(), true);
  svc.stop();
  assert.equal(svc.isRunning(), false);
});

test('start is idempotent — calling twice does not start two timers', () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  svc.start();
  svc.start();
  assert.equal(svc.isRunning(), true);
  svc.stop();
});

test('tick: runs tasks whose nextRunAt has passed and skips others', async () => {
  let clock = NOW;
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => clock });
  // First tick: all tasks have nextRunAt = NOW → all fire
  await svc.tick();
  const firstRoundCount = svc.getHistory().filter((h) => h.result === 'success').length;
  assert.equal(firstRoundCount, 8);
  // Advance only 30 min — no task should re-fire (shortest interval is 60m)
  clock = NOW + 30 * 60_000;
  await svc.tick();
  assert.equal(svc.getHistory().length, 8);
});

test('tick: hourly task fires again after 60 min elapsed', async () => {
  let clock = NOW;
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => clock });
  await svc.tick();
  clock = NOW + 61 * 60_000;
  await svc.tick();
  const trustRuns = svc.getHistory().filter((h) => h.taskId === 'adjust-trust-budgets');
  assert.equal(trustRuns.length, 2);
});

test('tick: disabled tasks do not auto-fire', async () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  svc.disableTask('scan-bias');
  await svc.tick();
  const biasRuns = svc.getHistory().filter((h) => h.taskId === 'scan-bias' && h.result === 'success');
  assert.equal(biasRuns.length, 0);
});

// ── getHistory ───────────────────────────────────────────────────────────

test('getHistory: respects limit', async () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < 5; i++) await svc.runNow('scan-bias');
  assert.equal(svc.getHistory(undefined, 3).length, 3);
});

test('getHistory: filters by taskId', async () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  await svc.runNow('scan-bias');
  await svc.runNow('recalibrate-attention');
  await svc.runNow('scan-bias');
  assert.equal(svc.getHistory('scan-bias').length, 2);
});

test('getHistory: newest first', async () => {
  let clock = NOW;
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => clock });
  await svc.runNow('scan-bias');
  clock = NOW + 1000;
  await svc.runNow('scan-bias');
  const hist = svc.getHistory();
  assert.ok(hist[0]!.startedAt.getTime() >= hist[1]!.startedAt.getTime());
});

// ── stats ────────────────────────────────────────────────────────────────

test('stats: totalRuns and successRate', async () => {
  const svc = createImprovementScheduler({
    storage: createMemoryStorage(), now: () => NOW,
    taskRunners: { 'scan-bias': () => { throw new Error('x'); } },
  });
  await svc.runNow('recalibrate-attention'); // success
  await svc.runNow('recalibrate-attention'); // success
  await svc.runNow('scan-bias'); // error
  const s = svc.stats();
  assert.equal(s.totalRuns, 3);
  assert.ok(Math.abs(s.successRate - 2 / 3) < 0.0001);
});

test('stats: avgDurationMs >= 0', async () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  await svc.runNow('scan-bias');
  assert.ok(svc.stats().avgDurationMs >= 0);
});

// ── ring buffer ──────────────────────────────────────────────────────────

test('history ring buffer caps at HISTORY_LIMIT', async () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) await svc.runNow('scan-bias');
  assert.equal(svc.getHistory().length, HISTORY_LIMIT);
});

// ── subscribe ────────────────────────────────────────────────────────────

test('subscribe fires once per runNow', async () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  let count = 0;
  svc.subscribe(() => { count += 1; });
  await svc.runNow('scan-bias');
  await svc.runNow('recalibrate-attention');
  assert.equal(count, 2);
});

test('subscribe returns unsubscribe function', async () => {
  const svc = createImprovementScheduler({ storage: createMemoryStorage(), now: () => NOW });
  let count = 0;
  const off = svc.subscribe(() => { count += 1; });
  await svc.runNow('scan-bias');
  off();
  await svc.runNow('scan-bias');
  assert.equal(count, 1);
});

// ── persistence ──────────────────────────────────────────────────────────

test('persist + rehydrate preserves task enabled state + lastRunAt', async () => {
  const storage = createMemoryStorage();
  const svc1 = createImprovementScheduler({ storage, now: () => NOW });
  svc1.disableTask('scan-bias');
  await svc1.runNow('recalibrate-attention');
  const svc2 = createImprovementScheduler({ storage, now: () => NOW + 1 });
  assert.equal(svc2.getTask('scan-bias').enabled, false);
  assert.ok(svc2.getTask('recalibrate-attention').lastRunAt instanceof Date);
});

test('persist + rehydrate preserves history', async () => {
  const storage = createMemoryStorage();
  const svc1 = createImprovementScheduler({ storage, now: () => NOW });
  await svc1.runNow('scan-bias');
  await svc1.runNow('recalibrate-attention');
  const svc2 = createImprovementScheduler({ storage, now: () => NOW });
  assert.equal(svc2.getHistory().length, 2);
});

// ── injected taskRunners ─────────────────────────────────────────────────

test('taskRunners override is invoked for the matching task id', async () => {
  let scanBiasCalls = 0;
  const svc = createImprovementScheduler({
    storage: createMemoryStorage(), now: () => NOW,
    taskRunners: { 'scan-bias': () => { scanBiasCalls += 1; } },
  });
  await svc.runNow('scan-bias');
  assert.equal(scanBiasCalls, 1);
});

test('taskRunners can be async', async () => {
  const svc = createImprovementScheduler({
    storage: createMemoryStorage(), now: () => NOW,
    taskRunners: { 'scan-bias': async () => { await Promise.resolve(); } },
  });
  const run = await svc.runNow('scan-bias');
  assert.equal(run.result, 'success');
});
