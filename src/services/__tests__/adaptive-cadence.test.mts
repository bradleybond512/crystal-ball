import assert from 'node:assert/strict';
import test from 'node:test';

const store: Record<string, string> = {};
const G = globalThis as Record<string, unknown>;
G.localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
} as Storage;
// setPreset / setLowPowerMode dispatch CustomEvents.
G.document = { dispatchEvent: () => true, addEventListener: () => { /* noop */ } };
G.CustomEvent = class { constructor(public type: string, public detail?: unknown) {} };

const { getContextCadenceMultiplier, _setOnBatteryForTest } = await import('../adaptive-cadence.ts');
const { setPreset } = await import('../alerting-prefs.ts');
const { setLowPowerMode } = await import('../low-power.ts');

function reset(): void {
  for (const k of Object.keys(store)) delete store[k];
  _setOnBatteryForTest(false);
  setPreset('loud');
  setLowPowerMode(false);
}

test('default context ⇒ multiplier 1', () => {
  reset();
  assert.equal(getContextCadenceMultiplier(), 1);
});

test('silent preset halves cadence (×2)', () => {
  reset();
  setPreset('silent');
  assert.equal(getContextCadenceMultiplier(), 2);
});

test('on battery halves cadence (×2)', () => {
  reset();
  _setOnBatteryForTest(true);
  assert.equal(getContextCadenceMultiplier(), 2);
});

test('low power mode quarters cadence (×4)', () => {
  reset();
  setLowPowerMode(true);
  assert.equal(getContextCadenceMultiplier(), 4);
});

test('signals do not stack — strongest wins', () => {
  reset();
  setPreset('silent');       // ×2
  _setOnBatteryForTest(true); // ×2
  setLowPowerMode(true);      // ×4
  assert.equal(getContextCadenceMultiplier(), 4);
});
