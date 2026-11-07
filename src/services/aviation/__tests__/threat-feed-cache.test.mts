import assert from 'node:assert/strict';
import test from 'node:test';
import { clearAviationCache, fetchAirportDelays, fetchSigmets } from '../aviation-intel-service.ts';

test('malformed and partially malformed envelopes do not block recovery for five minutes', async t => {
  const stop = { airport: 'FLL', reason: 'weather', programType: 'ground_stop', startedAt: null, endsAt: null, avgDelayMinutes: null, maxDelayMinutes: null };
  const good = { source: 'nasstatus.faa.gov', fetchedAt: Date.now(), degraded: false, data: [stop] };
  const responses = [{ source: 'nasstatus.faa.gov', data: {} }, { ...good, data: [stop, { invalid: true }] }, good];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json(responses[calls++]));
  clearAviationCache();
  try {
    assert.equal((await fetchAirportDelays()).degraded, true);
    const partial = await fetchAirportDelays();
    assert.equal(partial.degraded, true);
    assert.deepEqual(partial.data, [stop]);
    assert.deepEqual(await fetchAirportDelays(), good);
    assert.deepEqual(await fetchAirportDelays(), good);
    assert.equal(calls, 3);
  } finally {
    clearAviationCache();
  }
});

test('SIGMET provider rejects a misattributed body and invalid rows before caching', async t => {
  const good = { source: 'aviationweather.gov', fetchedAt: Date.now(), degraded: false, data: [] };
  const responses = [{ ...good, source: 'unverified' }, { ...good, data: [null] }, good];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json(responses[calls++]));
  clearAviationCache();
  try {
    assert.equal((await fetchSigmets()).degraded, true);
    assert.equal((await fetchSigmets()).degraded, true);
    assert.deepEqual(await fetchSigmets(), good);
    assert.equal(calls, 3);
  } finally {
    clearAviationCache();
  }
});
