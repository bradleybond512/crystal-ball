import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { AnalysisWorkerManager } from '../../src/services/analysis-worker.ts';

type TimerHandle = ReturnType<typeof setTimeout>;

class FakeTimers {
  now = 0;
  private nextId = 1;
  private tasks = new Map<number, { at: number; callback: () => void }>();

  setTimer = ((callback: () => void, delayMs: number): TimerHandle => {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + delayMs, callback });
    return id as unknown as TimerHandle;
  });

  clearTimer = ((timer: TimerHandle): void => {
    this.tasks.delete(timer as unknown as number);
  });

  advanceTo(now: number): void {
    this.now = now;
    const due = [...this.tasks.entries()]
      .filter(([, task]) => task.at <= now)
      .sort((a, b) => a[1].at - b[1].at);
    for (const [id, task] of due) {
      if (!this.tasks.delete(id)) continue;
      task.callback();
    }
  }

  captureNext(): () => void {
    const task = [...this.tasks.values()].sort((a, b) => a.at - b.at)[0];
    assert.ok(task, 'expected a scheduled timer');
    return task.callback;
  }

  get size(): number {
    return this.tasks.size;
  }
}

class FakeWorker extends EventTarget {
  readonly messages: unknown[] = [];

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  terminate(): void {}

  emit(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  emitError(message: string): void {
    const event = new Event('error');
    Object.defineProperty(event, 'message', { value: message });
    this.dispatchEvent(event);
  }
}

function makeManager() {
  const timers = new FakeTimers();
  const worker = new FakeWorker();
  const manager = new AnalysisWorkerManager({
    createWorker: () => worker as unknown as Worker,
    now: () => timers.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { manager, timers, worker };
}

async function startCorrelation(manager: AnalysisWorkerManager, worker: FakeWorker) {
  const result = manager.analyzeCorrelations([], [], []);
  worker.emit({ type: 'ready' });
  await Promise.resolve();
  await Promise.resolve();
  const request = worker.messages.find((message) => (
    typeof message === 'object' && message !== null && 'type' in message
    && message.type === 'correlation'
  )) as { id: string } | undefined;
  assert.ok(request, 'correlation request should be posted after worker readiness');
  return { request, result };
}

test('worker readiness accepts a queued ready event during the deadline grace period', async () => {
  const { manager, timers, worker } = makeManager();
  const result = manager.analyzeCorrelations([], [], []);
  const outcome = result.then(
    value => ({ value, error: null }),
    error => ({ value: null, error }),
  );

  timers.advanceTo(10_000);
  assert.equal(timers.size, 1, 'readiness deadline should install one grace timer');
  const queuedGraceTimeout = timers.captureNext();

  worker.emit({ type: 'ready' });
  queuedGraceTimeout();
  await Promise.resolve();
  await Promise.resolve();
  const request = worker.messages.find((message) => (
    typeof message === 'object' && message !== null && 'type' in message
    && message.type === 'correlation'
  )) as { id: string } | undefined;
  assert.ok(request, 'correlation request should be posted after delayed worker readiness');

  worker.emit({ type: 'correlation-result', id: request.id, signals: [] });

  assert.deepEqual(await outcome, { value: [], error: null });
  assert.equal(timers.size, 0);
});

test('worker readiness waits through its deadline grace period', async () => {
  const { manager, timers } = makeManager();
  const result = manager.analyzeCorrelations([], [], []);

  timers.advanceTo(10_000);
  assert.equal(timers.size, 1, 'readiness deadline should install one grace timer');

  timers.advanceTo(11_000);

  await assert.rejects(result, /Worker failed to become ready within timeout/);
  assert.equal(timers.size, 0);
});

test('worker readiness rejects after a late deadline callback and one grace period', async () => {
  const { manager, timers } = makeManager();
  const result = manager.analyzeCorrelations([], [], []);

  timers.advanceTo(11_000);
  assert.equal(timers.size, 1, 'late readiness deadline should install one grace timer');

  timers.advanceTo(12_000);

  await assert.rejects(result, /Worker failed to become ready within timeout/);
  assert.equal(timers.size, 0);
});

test('terminate rejects a request still waiting for worker readiness', async () => {
  const { manager } = makeManager();
  const result = manager.analyzeCorrelations([], [], []);
  const outcome = result.then(
    value => ({ value, error: null }),
    error => ({ value: null, error: error instanceof Error ? error.message : String(error) }),
  );

  manager.terminate();

  const settled = await Promise.race([
    outcome,
    new Promise(resolve => setTimeout(() => resolve({ value: null, error: 'pending' }), 25)),
  ]);
  assert.deepEqual(settled, { value: null, error: 'Worker terminated' });
});

test('terminate makes an already-queued readiness timeout callback harmless', () => {
  const { manager, timers } = makeManager();
  const result = manager.analyzeCorrelations([], [], []);
  const queuedTimeout = timers.captureNext();
  void result.catch(() => {});

  manager.terminate();
  queuedTimeout();

  assert.equal(timers.size, 0);
});

test('terminate makes an already-queued ready message harmless', () => {
  const { manager, worker } = makeManager();
  const result = manager.analyzeCorrelations([], [], []);
  void result.catch(() => {});

  manager.terminate();
  worker.emit({ type: 'ready' });

  assert.equal(manager.ready, false);
});

test('a stale worker error cannot reject replacement worker readiness', async () => {
  const timers = new FakeTimers();
  const firstWorker = new FakeWorker();
  const replacementWorker = new FakeWorker();
  const workers = [firstWorker, replacementWorker];
  const manager = new AnalysisWorkerManager({
    createWorker: () => workers.shift() as unknown as Worker,
    now: () => timers.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  const firstResult = manager.analyzeCorrelations([], [], []);
  void firstResult.catch(() => {});

  manager.terminate();
  const replacementResult = manager.analyzeCorrelations([], [], []);
  firstWorker.emitError('stale worker failure');
  replacementWorker.emit({ type: 'ready' });
  await Promise.resolve();
  await Promise.resolve();
  const request = replacementWorker.messages.find((message) => (
    typeof message === 'object' && message !== null && 'type' in message
    && message.type === 'correlation'
  )) as { id: string } | undefined;
  assert.ok(request, 'replacement worker should receive the correlation request');

  replacementWorker.emit({ type: 'correlation-result', id: request.id, signals: [] });

  assert.deepEqual(await replacementResult, []);
  assert.equal(timers.size, 0);
});

test('analyzeCorrelations rejects an on-time worker hang at ten seconds', async () => {
  const { manager, timers, worker } = makeManager();
  const { result } = await startCorrelation(manager, worker);

  timers.advanceTo(10_000);

  await assert.rejects(result, /Correlation analysis request timed out/);
  assert.equal(timers.size, 0);
});

test('analyzeCorrelations resolves a queued result during the one-time stall extension', async () => {
  const { manager, timers, worker } = makeManager();
  const { request, result } = await startCorrelation(manager, worker);

  timers.advanceTo(11_000);
  assert.equal(timers.size, 1, 'late timeout should install one replacement timer');

  worker.emit({ type: 'correlation-result', id: request.id, signals: [] });

  assert.deepEqual(await result, []);
  assert.equal(timers.size, 0, 'result should clear the replacement timer');
});

test('analyzeCorrelations rejects after the extension even when its timer is also late', async () => {
  const { manager, timers, worker } = makeManager();
  const { result } = await startCorrelation(manager, worker);

  timers.advanceTo(11_000);
  timers.advanceTo(22_000);

  await assert.rejects(result, /Correlation analysis request timed out/);
  assert.equal(timers.size, 0);
});

test('a result makes an already-queued timeout callback harmless', async () => {
  const { manager, timers, worker } = makeManager();
  const { request, result } = await startCorrelation(manager, worker);
  const queuedTimeout = timers.captureNext();

  worker.emit({ type: 'correlation-result', id: request.id, signals: [] });
  queuedTimeout();

  assert.deepEqual(await result, []);
  assert.equal(timers.size, 0);
});

test('reset and terminate make already-queued timeout callbacks harmless', async () => {
  for (const action of ['reset', 'terminate'] as const) {
    const { manager, timers, worker } = makeManager();
    const { result } = await startCorrelation(manager, worker);
    const queuedTimeout = timers.captureNext();

    manager[action]();
    queuedTimeout();

    await assert.rejects(result, new RegExp(`Worker ${action === 'reset' ? 'reset' : 'terminated'}`));
    assert.equal(timers.size, 0);
  }
});
