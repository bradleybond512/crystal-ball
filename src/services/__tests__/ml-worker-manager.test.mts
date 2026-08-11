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
