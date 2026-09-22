import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// Binds the request bookkeeping to the manager as wired, not just to the pure
// budget helper: reverting the per-method budgets, the eviction handling, or the
// termination path fails these, not only ml-request-budget.test.mts.
//
// Capability detection runs before the worker is created and reaches for browser
// globals; the worker itself is injected, so nothing here loads Vite's loader.
const realSetTimeout = globalThis.setTimeout;
const flush = () => new Promise<void>(resolve => { realSetTimeout(resolve, 0); });

Object.assign(globalThis, {
  window: globalThis,
  document: { createElement: () => ({ getContext: () => ({}) }) },
});

const { ML_THRESHOLDS } = await import('../../config/ml-config.js');
const { MLWorkerManager } = await import('../ml-worker.js');
const { clearCapabilitiesCache } = await import('../ml-capabilities.js');

const COLD = ML_THRESHOLDS.modelLoadTimeoutMs + ML_THRESHOLDS.inferenceTimeoutMs;
const WARM = ML_THRESHOLDS.inferenceTimeoutMs;

// ─── Fake timers ────────────────────────────────────────────────────────────
// Every timer the manager arms is an assertion about a budget, and none of them
// may actually be waited out — the cold one is ten minutes. Installed after the
// imports above so the module loader keeps the real ones.

interface FakeTimer { id: number; delay: number; fn: () => void; cleared: boolean }

let timers: FakeTimer[] = [];
let nextTimerId = 1;

globalThis.setTimeout = ((fn: () => void, delay?: number) => {
  const timer: FakeTimer = { id: nextTimerId++, delay: delay ?? 0, fn, cleared: false };
  timers.push(timer);
  return timer.id;
}) as unknown as typeof setTimeout;

globalThis.clearTimeout = ((id: unknown) => {
  const timer = timers.find(t => t.id === id);
  if (timer) timer.cleared = true;
}) as unknown as typeof clearTimeout;

const armed = () => timers.filter(t => !t.cleared);
const lastTimer = () => timers.at(-1)!;

// ─── Fake worker ────────────────────────────────────────────────────────────

interface PostedMessage { type: string; id?: string }

class FakeWorker {
  readonly posted: PostedMessage[] = [];
  terminated = 0;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;

  postMessage(message: PostedMessage): void { this.posted.push(message); }
  terminate(): void { this.terminated += 1; }

  emit(data: unknown): void { this.onmessage?.({ data } as MessageEvent<unknown>); }
  lastRequestId(): string { return this.posted.at(-1)!.id!; }
}

async function readyManager(): Promise<{ fake: FakeWorker; manager: InstanceType<typeof MLWorkerManager> }> {
  timers = [];
  const fake = new FakeWorker();
  const manager = new MLWorkerManager(() => fake as unknown as Worker);

  const started = manager.init();
  // The factory is awaited before onmessage is attached; a macrotask lands after.
  await flush();
  fake.emit({ type: 'worker-ready' });

  assert.equal(await started, true, 'handshake should complete');
  return { fake, manager };
}

/** Mark a model resident the way the worker does after an implicit load. */
function markLoaded(fake: FakeWorker, modelId: string): void {
  fake.emit({ type: 'model-loaded', modelId });
}

// ─── Method budgets ─────────────────────────────────────────────────────────

test('each inference method budgets for the model it will actually load', async () => {
  const { fake, manager } = await readyManager();

  const cases: [string, () => Promise<unknown>][] = [
 ['embeddings', () => manager.embedTexts(['x'])],
 ['summarization', () => manager.summarize(['x'])],
 ['sentiment', () => manager.classifySentiment(['x'])],
 ['ner', () => manager.extractEntities(['x'])],
  ];

  for (const [modelId, call] of cases) {
 const cold = call();
 assert.equal(lastTimer().delay, COLD, `${modelId} is cold and must outlast its load`);
 fake.emit({ type: 'error', id: fake.lastRequestId(), error: 'stop' });
 await assert.rejects(cold);

 markLoaded(fake, modelId);

 const warm = call();
 assert.equal(lastTimer().delay, WARM, `${modelId} is resident and needs only the inference budget`);
 fake.emit({ type: 'error', id: fake.lastRequestId(), error: 'stop' });
 await assert.rejects(warm);
  }
});

test('one resident model does not make the others look warm', async () => {
  // The budget is per model, so a loaded embeddings pipeline must not shorten an
  // NER request that still has its own download ahead of it.
  const { fake, manager } = await readyManager();
  markLoaded(fake, 'embeddings');

  const ner = manager.extractEntities(['x']);
  assert.equal(lastTimer().delay, COLD);

  fake.emit({ type: 'error', id: fake.lastRequestId(), error: 'stop' });
  await assert.rejects(ner);
});

// ─── Eviction ───────────────────────────────────────────────────────────────

test('an evicted model goes back to the cold budget', async () => {
  // The worker caps resident pipelines below the number of configured models, so
  // it drops one without being asked. Still believing it is loaded charges the
  // next request the warm budget and times it out mid-reload.
  const { fake, manager } = await readyManager();

  markLoaded(fake, 'embeddings');
  const warm = manager.embedTexts(['x']);
  assert.equal(lastTimer().delay, WARM);
  fake.emit({ type: 'error', id: fake.lastRequestId(), error: 'stop' });
  await assert.rejects(warm);

  fake.emit({ type: 'model-evicted', modelId: 'embeddings' });
  assert.equal(manager.isModelLoaded('embeddings'), false, 'eviction must be believed');

  const cold = manager.embedTexts(['x']);
  assert.equal(lastTimer().delay, COLD, 'the implicit reload needs the load budget again');
  fake.emit({ type: 'error', id: fake.lastRequestId(), error: 'stop' });
  await assert.rejects(cold);
});

// ─── Timeout bookkeeping ────────────────────────────────────────────────────

test('a settled request leaves no timer armed', async () => {
  const { fake, manager } = await readyManager();

  const embeddings = manager.embedTexts(['x']);
  fake.emit({ type: 'embed-result', id: fake.lastRequestId(), embeddings: [[1, 2]] });

  assert.deepEqual(await embeddings, [[1, 2]]);
  assert.deepEqual(armed(), [], 'both the handshake timer and the request timer are cleared');
});

test('a late error for a timed-out request is not reported a second time', async () => {
  const { fake, manager } = await readyManager();

  const embeddings = manager.embedTexts(['x']);
  const id = fake.lastRequestId();

  lastTimer().fn(); // the request's own budget runs out
  await assert.rejects(embeddings, /timed out/);

  const errors: unknown[] = [];
  const debugs: unknown[] = [];
  const { error: realError, debug: realDebug } = console;
  console.error = (...args: unknown[]) => { errors.push(args); };
  console.debug = (...args: unknown[]) => { debugs.push(args); };
  try {
 fake.emit({ type: 'error', id, error: 'model download failed' });
  } finally {
 console.error = realError;
 console.debug = realDebug;
  }

  assert.deepEqual(errors, [], 'the caller was already rejected — reporting again double-counts it');
  assert.equal(debugs.length, 1, 'the late reply is still recorded, at debug level');
});

// ─── Termination ────────────────────────────────────────────────────────────

test('terminating settles the callers still waiting', async () => {
  // Dropping the pending entries without settling them strands each caller until
  // its own budget expires — up to the cold ten minutes after the worker is gone.
  const { fake, manager } = await readyManager();

  const embeddings = manager.embedTexts(['x']);
  const entities = manager.extractEntities(['y']);

  manager.terminate();

  await assert.rejects(embeddings, /terminated/);
  await assert.rejects(entities, /terminated/);
  assert.equal(fake.terminated, 1);
  assert.deepEqual(armed(), [], 'no orphaned timer survives the worker');
});

test('a worker error settles the callers still waiting', async () => {
  const { fake, manager } = await readyManager();

  const embeddings = manager.embedTexts(['x']);
  fake.onerror?.({ message: 'worker crashed' });

  await assert.rejects(embeddings, /worker crashed/);
  assert.deepEqual(armed(), []);
});

// ─── Async worker creation vs. termination ────────────────────────────────

test('a worker factory that resolves after terminate() is discarded, not attached', async () => {
  // createWorker() is awaited before there is a worker to hold onto. If
  // terminate() (or the ready timeout) runs while that await is still
  // pending, a factory that resolves afterward must not resurrect the
  // manager it was already given up on.
  timers = [];
  let resolveFactory!: (worker: Worker) => void;
  const factory = () => new Promise<Worker>(resolve => { resolveFactory = resolve; });
  const manager = new MLWorkerManager(factory);

  const started = manager.init();
  await flush(); // let init() reach the pending createWorker() await

  manager.terminate();
  assert.equal(await started, false, 'terminate before the factory resolves must fail init');

  const late = new FakeWorker();
  resolveFactory(late as unknown as Worker);
  await flush();
  await flush();

  assert.equal(late.terminated, 1, 'the late worker must be discarded, not attached');
  assert.equal(manager.isAvailable, false, 'a discarded worker must not revive availability');
});

// ─── Eviction vs. in-flight replies ────────────────────────────────────────

test('a late id-bearing model-loaded reply does not undo an eviction', async () => {
  // A genuinely new load always posts the unsolicited model-loaded notice
  // before its own id-bearing reply, but concurrent loads can still interleave
  // an eviction of that same model between the two. The id-bearing reply must
  // only settle its caller — residency is tracked from the unsolicited
  // channel alone.
  const { fake, manager } = await readyManager();

  const loaded = manager.loadModel('embeddings');
  const id = fake.lastRequestId();

  fake.emit({ type: 'model-loaded', modelId: 'embeddings' }); // unsolicited
  assert.equal(manager.isModelLoaded('embeddings'), true);

  fake.emit({ type: 'model-evicted', modelId: 'embeddings' }); // raced in from another load
  assert.equal(manager.isModelLoaded('embeddings'), false);

  fake.emit({ type: 'model-loaded', id, modelId: 'embeddings' }); // this request's own late reply
  assert.equal(await loaded, true, 'the caller still sees its own request succeed');
  assert.equal(manager.isModelLoaded('embeddings'), false, 'the eviction must not be undone');
});


function deferredGpuDetection(): { probes: Array<(adapter: unknown) => void>; restore: () => void } {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'gpu');
  const probes: Array<(adapter: unknown) => void> = [];
  clearCapabilitiesCache();
  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    value: { requestAdapter: () => new Promise(resolve => { probes.push(resolve); }) },
  });
  return {
    probes,
    restore: () => {
      if (descriptor) Object.defineProperty(navigator, 'gpu', descriptor);
      else Reflect.deleteProperty(navigator, 'gpu');
      clearCapabilitiesCache();
    },
  };
}

test('terminate during capability detection cannot create a worker or revive availability', async () => {
  timers = [];
  const detection = deferredGpuDetection();
  const fake = new FakeWorker();
  let factoryCalls = 0;
  const manager = new MLWorkerManager(() => { factoryCalls++; return fake as unknown as Worker; });
  try {
    const started = manager.init();
    await flush();
    assert.equal(detection.probes.length, 1);
    manager.terminate();
    detection.probes[0]!(null);
    await flush();
    fake.emit({ type: 'worker-ready' });
    assert.equal(factoryCalls, 0, 'a terminated detector must not reach worker creation');
    assert.equal(manager.isAvailable, false, 'a late handshake must not revive a terminated attempt');
    assert.equal(manager.mlCapabilities, null, 'a terminated detector must not publish manager capabilities');
    assert.equal(await started, false);
    assert.deepEqual(armed(), []);
  } finally {
    manager.terminate();
    detection.restore();
  }
});

for (const oldResolvesFirst of [true, false]) {
  test(`a fresh init owns capabilities and its promise when the old detector resolves ${oldResolvesFirst ? 'first' : 'last'}`, async () => {
    timers = [];
    const detection = deferredGpuDetection();
    const fake = new FakeWorker();
    let factoryCalls = 0;
    const manager = new MLWorkerManager(() => { factoryCalls++; return fake as unknown as Worker; });
    try {
      const old = manager.init();
      await flush();
      manager.terminate();
      const fresh = manager.init();
      await flush();
      assert.equal(detection.probes.length, 2, 'termination must release the old init promise immediately');
      if (oldResolvesFirst) {
        detection.probes[0]!(null);
        await flush();
        assert.equal(factoryCalls, 0);
        assert.equal(manager.mlCapabilities, null);
        assert.equal(await old, false);
      }
      const joined = manager.init();
      await flush();
      assert.equal(detection.probes.length, 2, 'another caller joins the current detection');
      assert.equal(factoryCalls, 0, 'the old finally must not release the new pending init');
      detection.probes[1]!({});
      await flush();
      assert.equal(factoryCalls, 1);
      assert.ok(fake.onmessage, 'the current worker is attached before awaiting readiness');
      fake.emit({ type: 'worker-ready' });
      assert.equal(await fresh, true);
      assert.equal(await joined, true);
      assert.equal(manager.mlCapabilities?.hasWebGPU, true);
      if (!oldResolvesFirst) {
        detection.probes[0]!(null);
        await flush();
        assert.equal(await old, false);
      }
      assert.equal(factoryCalls, 1);
      assert.equal(manager.mlCapabilities?.hasWebGPU, true, 'stale detector cannot overwrite current capabilities');
      assert.equal(manager.isAvailable, true);
      assert.equal(fake.terminated, 0);
    } finally {
      manager.terminate();
      detection.restore();
    }
  });
}

test('a cleared ready timeout callback cannot clean up a newer initialization', async () => {
  timers = [];
  const workers: FakeWorker[] = [];
  const manager = new MLWorkerManager(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  try {
    const old = manager.init();
    await flush();
    const oldTimeout = lastTimer();
    manager.terminate();
    assert.equal(await old, false);
    const fresh = manager.init();
    await flush();
    assert.equal(workers.length, 2);
    assert.equal(oldTimeout.cleared, true);
    oldTimeout.fn();
    assert.equal(workers[1]!.terminated, 0, 'an already queued old callback cannot terminate the new worker');
    assert.equal(armed().length, 1, 'the current ready deadline remains active');
    workers[1]!.emit({ type: 'worker-ready' });
    assert.equal(await fresh, true);
    assert.equal(manager.isAvailable, true);
  } finally {
    manager.terminate();
  }
});

test('a timed-out factory is discarded after a replacement becomes ready', async () => {
  timers = [];
  let resolveOld!: (worker: Worker) => void;
  const oldFactory = new Promise<Worker>(resolve => { resolveOld = resolve; });
  const current = new FakeWorker();
  let calls = 0;
  const manager = new MLWorkerManager(() => ++calls === 1 ? oldFactory : current as unknown as Worker);
  try {
    const old = manager.init();
    await flush();
    lastTimer().fn();
    assert.equal(await old, false);
    const fresh = manager.init();
    await flush();
    assert.ok(current.onmessage);
    current.emit({ type: 'worker-ready' });
    assert.equal(await fresh, true);
    const late = new FakeWorker();
    resolveOld(late as unknown as Worker);
    await flush();
    assert.equal(late.terminated, 1);
    assert.equal(late.onmessage, null);
    assert.equal(manager.isAvailable, true);
    assert.equal(current.terminated, 0);
  } finally {
    manager.terminate();
  }
});

test('concurrent initial callers share one worker-creation attempt', async () => {
  timers = [];
  const fake = new FakeWorker();
  let calls = 0;
  const manager = new MLWorkerManager(() => { calls++; return fake as unknown as Worker; });
  try {
    const first = manager.init();
    const second = manager.init();
    await flush();
    assert.equal(calls, 1);
    assert.ok(fake.onmessage);
    fake.emit({ type: 'worker-ready' });
    assert.equal(await first, true);
    assert.equal(await second, true);
  } finally {
    manager.terminate();
  }
});

test('stale worker ready, model and error callbacks cannot affect the current attempt', async () => {
  timers = [];
  const workers: FakeWorker[] = [];
  const manager = new MLWorkerManager(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  try {
    const old = manager.init();
    await flush();
    manager.terminate();
    assert.equal(await old, false);
    const fresh = manager.init();
    await flush();
    assert.equal(workers.length, 2);
    workers[0]!.emit({ type: 'worker-ready' });
    workers[0]!.emit({ type: 'model-loaded', modelId: 'embeddings' });
    workers[0]!.onerror?.({ message: 'stale worker error' });
    assert.equal(manager.isAvailable, false);
    assert.equal(manager.isModelLoaded('embeddings'), false);
    assert.equal(workers[1]!.terminated, 0);
    workers[1]!.emit({ type: 'worker-ready' });
    assert.equal(await fresh, true);
    const request = manager.embedTexts(['x']);
    workers[0]!.onerror?.({ message: 'stale error during a current request' });
    workers[1]!.emit({ type: 'embed-result', id: workers[1]!.lastRequestId(), embeddings: [[1]] });
    assert.deepEqual(await request, [[1]]);
  } finally {
    manager.terminate();
  }
});

test('a rejected obsolete factory cannot fail its replacement initialization', async () => {
  timers = [];
  let rejectOld!: (error: Error) => void;
  const oldFactory = new Promise<Worker>((_resolve, reject) => { rejectOld = reject; });
  const current = new FakeWorker();
  let calls = 0;
  const manager = new MLWorkerManager(() => ++calls === 1 ? oldFactory : current as unknown as Worker);
  try {
    const old = manager.init();
    await flush();
    manager.terminate();
    assert.equal(await old, false);
    const fresh = manager.init();
    await flush();
    assert.equal(calls, 2);
    rejectOld(new Error('obsolete factory failed'));
    await flush();
    assert.equal(current.terminated, 0);
    assert.equal(armed().length, 1);
    assert.ok(current.onmessage);
    current.emit({ type: 'worker-ready' });
    assert.equal(await fresh, true);
  } finally {
    manager.terminate();
  }
});

test('a current factory failure returns false and permits a successful retry', async () => {
  timers = [];
  const current = new FakeWorker();
  let calls = 0;
  const manager = new MLWorkerManager(() => {
    if (++calls === 1) throw new Error('current factory failed');
    return current as unknown as Worker;
  });
  try {
    assert.equal(await manager.init(), false);
    assert.equal(manager.isAvailable, false);
    assert.deepEqual(armed(), []);
    const retry = manager.init();
    await flush();
    assert.equal(calls, 2);
    assert.ok(current.onmessage);
    current.emit({ type: 'worker-ready' });
    assert.equal(await retry, true);
    assert.equal(manager.isAvailable, true);
  } finally {
    manager.terminate();
  }
});

test('current unsupported capabilities return false without creating a worker', async () => {
  timers = [];
  const detection = deferredGpuDetection();
  const originalDocument = globalThis.document;
  Object.assign(globalThis, { document: { createElement: () => ({ getContext: () => null }) } });
  let calls = 0;
  const manager = new MLWorkerManager(() => { calls++; return new FakeWorker() as unknown as Worker; });
  try {
    const started = manager.init();
    await flush();
    assert.equal(detection.probes.length, 1);
    detection.probes[0]!(null);
    await flush();
    assert.equal(calls, 0);
    assert.equal(manager.mlCapabilities?.isSupported, false);
    assert.equal(await started, false);
    assert.equal(manager.isAvailable, false);
    assert.deepEqual(armed(), []);
  } finally {
    manager.terminate();
    Object.assign(globalThis, { document: originalDocument });
    detection.restore();
  }
});
