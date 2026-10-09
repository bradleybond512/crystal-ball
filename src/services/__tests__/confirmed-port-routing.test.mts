import assert from 'node:assert/strict';
import { test } from 'node:test';

// R4-BUG-004: the renderer only ever caches a port the native side confirmed,
// and secret-bearing calls re-resolve it every time. Own file: the port cache
// is module state.

let confirmedPort: number | null = null;
let portCalls = 0;
let deferredPort: Promise<number> | null = null;
let onDeferredPortRequest: (() => void) | null = null;
Object.assign(globalThis, {
  window: globalThis,
  location: { href: 'tauri://localhost/index.html', protocol: 'tauri:', host: 'localhost', origin: 'tauri://localhost' },
  __TAURI_INTERNALS__: {
    invoke: (command: string) => {
      if (command !== 'get_local_api_port') return Promise.resolve(null);
      portCalls += 1;
      if (deferredPort) {
        onDeferredPortRequest?.();
        return deferredPort;
      }
      return confirmedPort === null
        ? Promise.reject(new Error('Port not yet assigned (awaiting sidecar confirmation)'))
        : Promise.resolve(confirmedPort);
    },
  },
});

const runtime = await import('../runtime');

test('an unconfirmed port resolves to null, never the default', async () => {
  assert.equal(await runtime.resolveConfirmedLocalApiPort(300), null);
  assert.ok(portCalls > 1, 'polls while the sidecar is booting or restarting');
  assert.equal(await runtime.resolveConfirmedLocalApiBase(0), null, 'no base for secret-bearing calls');
  assert.equal(runtime.getApiBaseUrl(), 'http://127.0.0.1:46123', 'display default is unchanged');
});

test('a confirmation that arrives during the wait is picked up and cached', async () => {
  setTimeout(() => { confirmedPort = 46_200; }, 100);
  assert.equal(await runtime.resolveConfirmedLocalApiPort(2_000), 46_200);
  const before = portCalls;
  assert.equal(await runtime.resolveConfirmedLocalApiPort(), 46_200);
  assert.equal(portCalls, before, 'cached after confirmation');
  assert.equal(runtime.getApiBaseUrl(), 'http://127.0.0.1:46200');
});

test('after a restart on a new port, invalidation re-resolves it', async () => {
  confirmedPort = 51_000;
  assert.equal(await runtime.resolveConfirmedLocalApiPort(), 46_200, 'still cached');
  runtime.invalidateLocalApiPort();
  assert.equal(await runtime.resolveConfirmedLocalApiPort(), 51_000);
});

test('secret-bearing calls always re-resolve instead of trusting the cache', async () => {
  confirmedPort = 52_000;
  assert.equal(await runtime.resolveConfirmedLocalApiBase(), 'http://127.0.0.1:52000');
  confirmedPort = null;
  assert.equal(await runtime.resolveConfirmedLocalApiBase(0), null, 'a port that died since caching is never used');
});

test('concurrent callers share one poll', async () => {
  confirmedPort = null;
  runtime.invalidateLocalApiPort();
  const before = portCalls;
  setTimeout(() => { confirmedPort = 53_000; }, 50);
  const results = await Promise.all([1, 2, 3, 4].map(() => runtime.resolveConfirmedLocalApiPort(2_000)));
  assert.deepEqual(results, [53_000, 53_000, 53_000, 53_000]);
  assert.ok(portCalls - before <= 3, `one shared poll, got ${portCalls - before} IPC calls`);
});

test('a failed cached health port is replaced on the next health request after confirmation', async () => {
  runtime.invalidateLocalApiPort();
  confirmedPort = 54_000;
  assert.equal(await runtime.resolveConfirmedLocalApiPort(), 54_000);
  const calls: string[] = [];
  const connectionError = new TypeError('fetch failed: ECONNREFUSED');
  const nativeFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url === 'http://127.0.0.1:54000/api/health') throw connectionError;
    assert.equal(url, 'http://127.0.0.1:54001/api/health');
    return new Response('healthy', { status: 200 });
  }) as typeof fetch;
  const routedFetch = runtime.createRuntimeFetch(nativeFetch, {
    resolvePort: () => runtime.resolveConfirmedLocalApiPort(2_000),
    invalidatePort: runtime.invalidateLocalApiPort,
    localBaseUrl: runtime.localApiBaseForPort,
    fetchToken: async () => 'fake-local-token',
    remoteBaseUrl: () => { throw new Error('health must not consult cloud routing'); },
    cloudApiKey: async () => { throw new Error('health must not consult cloud keys'); },
    debug: () => false,
  });

  await assert.rejects(routedFetch('/api/health'), (actual) => actual === connectionError);
  assert.deepEqual(calls, Array<string>(4).fill('http://127.0.0.1:54000/api/health'));
  const before = portCalls;
  let confirmReplacement!: (port: number) => void;
  deferredPort = new Promise<number>((resolve) => { confirmReplacement = resolve; });
  let requestedConfirmation!: () => void;
  const confirmationRequested = new Promise<void>((resolve) => { requestedConfirmation = resolve; });
  onDeferredPortRequest = requestedConfirmation;
  // Handle rejection immediately: restoring the old catch must fail the test,
  // rather than leave an unhandled rejection or an unresolved IPC fixture.
  const recovery = routedFetch('/api/health').then(
    (response) => ({ response, error: null }),
    (error: unknown) => ({ response: null, error }),
  );
  try {
    const askedNative = await Promise.race([
      confirmationRequested.then(() => true),
      recovery.then(() => false),
    ]);
    assert.equal(askedNative, true, 'the next health request must re-resolve the dead cached port');
    assert.equal(portCalls, before + 1);
    assert.equal(calls.length, 4, 'no fetch before the replacement port is confirmed');
    confirmReplacement(54_001);
    const result = await recovery;
    assert.equal(result.error, null);
    assert.equal(await result.response?.text(), 'healthy');
    assert.deepEqual(calls, [
      ...Array<string>(4).fill('http://127.0.0.1:54000/api/health'),
      'http://127.0.0.1:54001/api/health',
    ]);
  } finally {
    confirmReplacement(54_001);
    deferredPort = null;
    onDeferredPortRequest = null;
    await recovery;
    runtime.invalidateLocalApiPort();
  }
});
