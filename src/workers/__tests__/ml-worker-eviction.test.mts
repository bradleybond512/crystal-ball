import { strict as assert } from 'node:assert';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// The worker caps resident pipelines below the number of configured models, so
// in normal use it drops one nobody asked it to drop. The manager budgets each
// request on whether its model is resident, so that departure has to be
// announced — these bind the announcement to the eviction that causes it.
//
// @xenova/transformers is redirected to a stub: the test runner's TypeScript
// loader cannot parse its source, and no inference happens here anyway.
const TRANSFORMERS_STUB = `data:text/javascript,${encodeURIComponent(`
  export const env = {};
  export function pipeline() { return Promise.resolve(() => Promise.resolve({ data: new Float32Array() })); }
`)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@xenova/transformers') return { url: TRANSFORMERS_STUB, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

interface Posted {
  type: string;
  id?: string;
  modelId?: string;
  loadedModels?: string[];
}

const posted: Posted[] = [];

const fakeSelf = {
  postMessage(message: Posted) { posted.push(message); },
  onmessage: null as null | ((event: { data: unknown }) => Promise<void>),
};

Object.assign(globalThis, { self: fakeSelf });

await import('../ml.worker.js');

/** Deliver a message the way the worker's host would, and wait for it to settle. */
async function send(data: Record<string, unknown>): Promise<void> {
  await fakeSelf.onmessage!({ data });
}

/** Drop every resident pipeline, then start recording from a known-empty cache. */
async function resetWorker(): Promise<void> {
  await send({ type: 'reset' });
  posted.length = 0;
}

async function loadModel(modelId: string): Promise<void> {
  await send({ type: 'load-model', id: `req-${modelId}`, modelId });
}

async function residentModels(): Promise<string[] | undefined> {
  await send({ type: 'status', id: 'status' });
  return posted.findLast(m => m.type === 'status-result')?.loadedModels;
}

test('filling the cache to its limit evicts nothing', async () => {
  await resetWorker();

  for (const modelId of ['embeddings', 'sentiment', 'summarization']) await loadModel(modelId);

  assert.deepEqual(posted.filter(m => m.type === 'model-evicted'), []);
  assert.deepEqual(await residentModels(), ['embeddings', 'sentiment', 'summarization']);
});

test('the model dropped to make room is announced to the manager', async () => {
  await resetWorker();

  for (const modelId of ['embeddings', 'sentiment', 'summarization']) await loadModel(modelId);
  posted.length = 0;
  await loadModel('ner');

  const evicted = posted.filter(m => m.type === 'model-evicted');
  assert.deepEqual(
    evicted,
    [{ type: 'model-evicted', modelId: 'embeddings' }],
    'the least-recently-loaded pipeline leaves, and silently leaving is the bug',
  );
  assert.equal(evicted[0]!.id, undefined, 'no id — the manager routes this as a notification, not a reply');
});

test('the eviction is announced before the load that displaced it', async () => {
  // The manager applies these in arrival order. Announcing the departure after
  // the arrival is still correct here, but only by accident of the two ids
  // differing; sending it first keeps the cache view true at every step.
  await resetWorker();

  for (const modelId of ['embeddings', 'sentiment', 'summarization']) await loadModel(modelId);
  posted.length = 0;
  await loadModel('ner');

  assert.deepEqual(
    posted.map(m => [m.type, m.modelId]),
    [
      ['model-evicted', 'embeddings'],
      ['model-loaded', 'ner'],
      ['model-loaded', 'ner'],
    ],
    'unsolicited load notification, then the reply to the request itself',
  );
});

test('the evicted pipeline is actually gone, not merely announced', async () => {
  await resetWorker();

  for (const modelId of ['embeddings', 'sentiment', 'summarization', 'ner']) await loadModel(modelId);

  assert.deepEqual(await residentModels(), ['sentiment', 'summarization', 'ner']);
});
