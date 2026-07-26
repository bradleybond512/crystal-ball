import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeNgaMsiWarnings,
  fetchMaritimeWarningsResult,
  resetMaritimeWarningsCacheForTests,
} from '../maritime-safety.ts';

test('NGA decoder distinguishes healthy empty data from invalid payloads', () => {
  assert.deepEqual(decodeNgaMsiWarnings({ broadcastWarn: [] }), []);
  assert.throws(
    () => decodeNgaMsiWarnings('<html>provider error</html>'),
    /invalid NGA MSI response/i,
  );
  assert.throws(
    () => decodeNgaMsiWarnings({ broadcastWarn: [{ msgYear: '2026' }] }),
    /invalid NGA MSI warning/i,
  );
});

test('maritime fetch result distinguishes healthy-empty from failed-empty', async () => {
  const originalFetch = globalThis.fetch;
  try {
    resetMaritimeWarningsCacheForTests();
    globalThis.fetch = async () => new Response(JSON.stringify({ broadcastWarn: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const healthy = await fetchMaritimeWarningsResult();
    assert.equal(healthy.status, 'fresh');
    assert.deepEqual(healthy.data, []);

    resetMaritimeWarningsCacheForTests();
    globalThis.fetch = async () => new Response('upstream unavailable', { status: 503 });
    const failed = await fetchMaritimeWarningsResult();
    assert.equal(failed.status, 'degraded');
    assert.deepEqual(failed.data, []);
    assert.equal(failed.errorCode, 'http-503');
  } finally {
    globalThis.fetch = originalFetch;
    resetMaritimeWarningsCacheForTests();
  }
});
