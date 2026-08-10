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
  const request = worker.messages.find((message) => (
    typeof message === 'object' && message !== null && 'type' in message
    && message.type === 'correlation'
  )) as { id: string } | undefined;
  assert.ok(request, 'correlation request should be queued immediately');
  return { request, result };
}

test('correlation request queues immediately without waiting for a ready signal', async () => {
  const { manager, worker } = makeManager();
  const result = manager.analyzeCorrelations([], [], []);
  const outcome = result.catch(() => {});

  try {
    const request = worker.messages.find((message) => (
      typeof message === 'object' && message !== null && 'type' in message
      && message.type === 'correlation'
    ));
    assert.ok(request, 'worker should queue the request while its script is starting');
  } finally {
    manager.terminate();
    await outcome;
  }
});

test('cluster request queues immediately without waiting for a ready signal', async () => {
  const { manager, worker } = makeManager();
  const result = manager.clusterNews([]);
  const outcome = result.catch(() => {});

  try {
    const request = worker.messages.find((message) => (
      typeof message === 'object' && message !== null && 'type' in message
      && message.type === 'cluster'
    ));
    assert.ok(request, 'worker should queue clustering while its script is starting');
  } finally {
    manager.terminate();
    await outcome;
  }
});

test('ready is telemetry and does not gate a queued correlation request', async () => {
  const { manager, worker } = makeManager();
  const result = manager.analyzeCorrelations([], [], []);
  const request = worker.messages.find((message) => (
    typeof message === 'object' && message !== null && 'type' in message
    && message.type === 'correlation'
  )) as { id: string } | undefined;
  assert.ok(request);
  assert.equal(manager.ready, false);

  worker.emit({ type: 'ready' });
  assert.equal(manager.ready, true);
  worker.emit({ type: 'correlation-result', id: request.id, signals: [] });

  assert.deepEqual(await result, []);
});

test('worker load failure rejects an already-queued request', async () => {
  const { manager, timers, worker } = makeManager();
  const result = manager.analyzeCorrelations([], [], []);

  worker.emitError('load failed');

  await assert.rejects(result, /Worker error: load failed/);
  assert.equal(timers.size, 0);
  assert.equal(manager.ready, false);
});

test('worker creation failures are normalized to Error objects', async () => {
  const manager = new AnalysisWorkerManager({
    createWorker: () => { throw 'worker unavailable'; },
  });

  await assert.rejects(
    manager.analyzeCorrelations([], [], []),
    (error: unknown) => error instanceof Error && error.message === 'worker unavailable',
  );
});

test('terminate rejects a request queued while the worker starts', async () => {
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

test('terminate makes an already-queued request timeout callback harmless', () => {
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

test('a stale worker error cannot reject a replacement worker request', async () => {
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
  const request = replacementWorker.messages.find((message) => (
    typeof message === 'object' && message !== null && 'type' in message
    && message.type === 'correlation'
  )) as { id: string } | undefined;
  assert.ok(request, 'replacement worker should receive the correlation request');

  replacementWorker.emit({ type: 'correlation-result', id: request.id, signals: [] });

  assert.deepEqual(await replacementResult, []);
  assert.equal(timers.size, 0);
});

test('a post-ready worker error cleans up before the next request', async () => {
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
  firstWorker.emit({ type: 'ready' });
  assert.equal(manager.ready, true);

  firstWorker.emitError('worker crashed');

  await assert.rejects(firstResult, /Worker error: worker crashed/);
  assert.equal(manager.ready, false);

  const replacementResult = manager.clusterNews([]);
  const request = replacementWorker.messages.find((message) => (
    typeof message === 'object' && message !== null && 'type' in message
    && message.type === 'cluster'
  )) as { id: string } | undefined;
  assert.ok(request, 'the next request should create and use a fresh worker');

  replacementWorker.emit({ type: 'cluster-result', id: request.id, clusters: [] });

  assert.deepEqual(await replacementResult, []);
  assert.equal(timers.size, 0);
});

test('a stale worker result cannot settle a replacement worker request', async () => {
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
  const request = replacementWorker.messages.find((message) => (
    typeof message === 'object' && message !== null && 'type' in message
    && message.type === 'correlation'
  )) as { id: string } | undefined;
  assert.ok(request);
  let settled = false;
  void replacementResult.finally(() => { settled = true; });

  firstWorker.emit({ type: 'correlation-result', id: request.id, signals: [{ stale: true }] });
  await Promise.resolve();
  assert.equal(settled, false);

  replacementWorker.emit({ type: 'correlation-result', id: request.id, signals: [] });

  assert.deepEqual(await replacementResult, []);
  assert.equal(timers.size, 0);
});

test('analyzeCorrelations rejects an on-time worker hang without a ready signal', async () => {
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
