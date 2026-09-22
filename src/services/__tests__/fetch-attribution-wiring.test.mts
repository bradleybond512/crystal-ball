import assert from 'node:assert/strict';
import { test } from 'node:test';

// Binds attribution to the wrapper as installed, not just to the helper it calls:
// reverting log-bridge to resolve against location.href fails these, not only the
// fetchTargetHost unit tests.
//
// installFetchInstrumentation reads window.fetch at call time, and the desktop gate
// keys off location.protocol — both have to exist before log-bridge is imported.
const fakeLocation = {
  href: 'tauri://localhost/index.html',
  protocol: 'tauri:',
  host: 'localhost',
  origin: 'tauri://localhost',
};
Object.assign(globalThis, { window: globalThis, location: fakeLocation });

const { installFetchInstrumentation, getFetchFailureSummary } = await import('../log-bridge.js');

const requested: string[] = [];
globalThis.fetch = ((input: RequestInfo | URL) => {
  requested.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  return Promise.resolve(new Response('{}', { status: 200 }));
}) as typeof fetch;

installFetchInstrumentation();

test('the installed wrapper buckets sidecar calls under the sidecar host', async () => {
  await fetch('/api/health');
  await fetch('https://api.weather.gov/alerts');

  const hosts = getFetchFailureSummary().map(s => s.host);

  assert.ok(hosts.includes('127.0.0.1:46123'), `sidecar bucket missing from ${JSON.stringify(hosts)}`);
  assert.ok(
    !hosts.includes('localhost'),
    'the phantom tauri://localhost host must not appear — that is the bucket split this fixes',
  );
  assert.ok(hosts.includes('api.weather.gov'), 'external hosts keep their own bucket');
});

test('the wrapper still forwards the original input untouched', () => {
  // Attribution must not rewrite what is actually requested — the routing wrappers
  // installed underneath this one own that.
  assert.deepEqual(requested, ['/api/health', 'https://api.weather.gov/alerts']);
});
