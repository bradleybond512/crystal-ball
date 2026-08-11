import assert from 'node:assert/strict';
import { test } from 'node:test';

// The sidecar's port is discovered over IPC and cached on the first /api/ call
// the router handles. Attribution runs one layer above that router, so it has to
// ask for the host AFTER the call — asking before names the default port for the
// single request that resolves the real one, splitting one backend in two.
//
// Its own file: the resolved port is a one-shot latch, so the pre-resolution
// state exists only once per process.
const FALLBACK_PORT = 46_124;

Object.assign(globalThis, {
  window: globalThis,
  location: {
    href: 'tauri://localhost/index.html',
    protocol: 'tauri:',
    host: 'localhost',
    origin: 'tauri://localhost',
  },
  __TAURI_INTERNALS__: {
    invoke: (command: string) =>
      command === 'get_local_api_port' ? Promise.resolve(FALLBACK_PORT) : Promise.resolve(null),
  },
});

const { resolveLocalApiPort, getApiBaseUrl } = await import('../runtime');
const { installFetchInstrumentation, getFetchFailureSummary } = await import('../log-bridge.js');

// Stands in for the routing wrapper this instrumentation is installed over:
// installRuntimeFetchPatch resolves the port before it sends the request.
globalThis.fetch = (async () => {
  await resolveLocalApiPort();
  return new Response('{}', { status: 200 });
}) as unknown as typeof fetch;

installFetchInstrumentation();

test('the first sidecar call is bucketed under the port its own request resolved', async () => {
  assert.equal(getApiBaseUrl(), 'http://127.0.0.1:46123', 'precondition: nothing resolved yet');

  await fetch('/api/health');

  assert.deepEqual(
    getFetchFailureSummary().map(s => s.host),
    [`127.0.0.1:${FALLBACK_PORT}`],
    'one backend must not be split across the default port and the real one',
  );
});

test('later calls join the same bucket', async () => {
  await fetch('/api/analyst-state');

  const summary = getFetchFailureSummary();
  assert.equal(summary.length, 1);
  assert.equal(summary[0]!.ok, 2);
});
