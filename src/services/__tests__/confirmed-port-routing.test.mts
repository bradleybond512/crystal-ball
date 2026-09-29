import assert from 'node:assert/strict';
import { test } from 'node:test';

// R4-BUG-004: the renderer only ever caches a port the native side confirmed,
// and secret-bearing calls re-resolve it every time. Own file: the port cache
// is module state.

let confirmedPort: number | null = null;
let portCalls = 0;
Object.assign(globalThis, {
  window: globalThis,
  location: { href: 'tauri://localhost/index.html', protocol: 'tauri:', host: 'localhost', origin: 'tauri://localhost' },
  __TAURI_INTERNALS__: {
    invoke: (command: string) => {
      if (command !== 'get_local_api_port') return Promise.resolve(null);
      portCalls += 1;
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
