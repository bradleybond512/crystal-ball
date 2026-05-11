/**
 * History-wiring tests: firePushForEvent should record the fire/suppress
 * decision into the notification history ring.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { firePushForEvent } from '../push-notifier.ts';
import { __reset, getHistory } from '../notification-history-service.ts';

test('firePushForEvent records a "fired" history entry for an X-class flare', async () => {
  __reset();
  const result = await firePushForEvent(
    { kind: 'solar_flare', peakClass: 'X', peakLabel: 'X9.3' },
    { send: async () => { /* no-op */ } },
  );
  assert.equal(result.fired, true);
  const history = getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0]?.action, 'fired');
  assert.equal(history[0]?.domain, 'solar_flare');
  assert.equal(history[0]?.severity, 'high');
  assert.match(history[0]?.title ?? '', /X9\.3/);
});

test('firePushForEvent records a "suppressed" history entry when the event is below threshold', async () => {
  __reset();
  const result = await firePushForEvent(
    { kind: 'seismic', magnitude: 2.5, place: 'X' },
    { send: async () => { /* no-op */ } },
  );
  assert.equal(result.fired, false);
  const history = getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0]?.action, 'suppressed');
  assert.equal(history[0]?.suppressedReason, 'magnitude-below-threshold');
});

test('firePushForEvent honours recordHistory:false (no entry recorded)', async () => {
  __reset();
  await firePushForEvent(
    { kind: 'solar_flare', peakClass: 'X', peakLabel: 'X2.0' },
    { send: async () => { /* no-op */ }, recordHistory: false },
  );
  assert.equal(getHistory().length, 0);
});
