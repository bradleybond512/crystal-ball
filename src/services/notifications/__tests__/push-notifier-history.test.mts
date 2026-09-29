/**
 * History-wiring tests: firePushForEvent should record the fire/suppress
 * decision into the notification history ring.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { firePushForEvent } from '../push-notifier.ts';
import { __reset, getHistory } from '../notification-history-service.ts';
import { createNotificationLedger } from '../notification-ledger.ts';

test('firePushForEvent records a "fired" history entry for an X-class flare', async () => {
  __reset();
  const result = await firePushForEvent(
    { kind: 'solar_flare', peakClass: 'X', peakLabel: 'X9.3' },
    { send: async () => 'delivered' as const },
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
    { send: async () => 'delivered' as const },
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
    { send: async () => 'delivered' as const, recordHistory: false },
  );
  assert.equal(getHistory().length, 0);
});

test('a push the native layer did not deliver is not fired and never enters the dedupe ledger (R4-BUG-002)', async () => {
  for (const outcome of ['rate_limited', 'failed', 'unavailable'] as const) {
    __reset();
    const ledger = createNotificationLedger();
    const result = await firePushForEvent(
      { kind: 'solar_flare', peakClass: 'X', peakLabel: 'X9.3' },
      { send: async () => outcome, ledger },
    );
    assert.equal(result.fired, false, outcome);
    assert.equal(result.reason, `native-${outcome}`);
    assert.equal(ledger.list().length, 0, `${outcome} must not be ledgered`);
    const history = getHistory();
    assert.equal(history.at(-1)?.action, 'suppressed');
    assert.equal(history.at(-1)?.suppressedReason, `native-${outcome}`);
  }
});

test('a delivered push is fired and ledgered once', async () => {
  __reset();
  const ledger = createNotificationLedger();
  const result = await firePushForEvent(
    { kind: 'solar_flare', peakClass: 'X', peakLabel: 'X9.3' },
    { send: async () => 'delivered' as const, ledger },
  );
  assert.equal(result.fired, true);
  assert.equal(ledger.list().length, 1);
});
