import assert from 'node:assert/strict';
import test from 'node:test';
import { createSchedulerHarness } from '../../../tests/helpers/refresh-scheduler-clock.mjs';

async function fixture(t) {
  const harness = await createSchedulerHarness({ randomValues: [0.5] }); t.after(() => harness.dispose()); return harness;
}

test('default context ⇒ multiplier 1', async t => {
  const h = await fixture(t); assert.equal(h.cadence.getContextCadenceMultiplier(), 1);
});

test('silent preset halves cadence (×2)', async t => {
  const h = await fixture(t); await h.policy({ silent: true }); assert.equal(h.cadence.getContextCadenceMultiplier(), 2);
});

test('on battery halves cadence (×2)', async t => {
  const h = await fixture(t); h.cadence._setOnBatteryForTest(true); assert.equal(h.cadence.getContextCadenceMultiplier(), 2);
});

test('low power mode quarters cadence (×4)', async t => {
  const h = await fixture(t); await h.policy({ lowPower: true }); assert.equal(h.cadence.getContextCadenceMultiplier(), 4);
});

test('signals do not stack — strongest wins', async t => {
  const h = await fixture(t); await h.policy({ silent: true, onBattery: true, lowPower: true }); assert.equal(h.cadence.getContextCadenceMultiplier(), 4);
});

test('real battery monitor samples initial charging and follows both chargingchange transitions', async t => {
  const h = await fixture(t), battery = new EventTarget(); battery.charging = false; let requests = 0;
  h.navigator.getBattery = async () => { requests++; return battery; };
  h.cadence.installBatteryMonitor(); await h.clock.flushMicrotasks(); assert.equal(requests, 1); assert.equal(h.cadence.getContextCadenceMultiplier(), 2);
  battery.charging = true; battery.dispatchEvent(new Event('chargingchange')); assert.equal(h.cadence.getContextCadenceMultiplier(), 1);
  battery.charging = false; battery.dispatchEvent(new Event('chargingchange')); assert.equal(h.cadence.getContextCadenceMultiplier(), 2);
  await h.policy({ silent: true }); assert.equal(h.cadence.getContextCadenceMultiplier(), 2);
  await h.policy({ lowPower: true }); assert.equal(h.cadence.getContextCadenceMultiplier(), 4);
});

test('absent battery API leaves fresh context unchanged', async t => {
  const h = await fixture(t); delete h.navigator.getBattery; h.cadence.installBatteryMonitor(); await h.clock.flushMicrotasks(); assert.equal(h.cadence.getContextCadenceMultiplier(), 1);
});

test('rejected battery promise leaves fresh context unchanged without unhandled failure', async t => {
  const h = await fixture(t); h.navigator.getBattery = async () => { throw new Error('Synthetic permission refusal'); };
  h.cadence.installBatteryMonitor(); await h.clock.flushMicrotasks(); assert.equal(h.cadence.getContextCadenceMultiplier(), 1); assert.deepEqual(h.messages, []);
});
