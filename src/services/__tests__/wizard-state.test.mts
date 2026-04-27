import assert from 'node:assert/strict';
import test from 'node:test';

const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (i: number) => [...storage.keys()][i] ?? null,
} as Storage;

import {
  getPosition, setPosition,
  getDontAsk, addDontAsk, removeDontAsk,
  getSkipped, addSkipped, clearSkipped,
  getKeyStatus, setKeyStatus,
  resetWizardState,
} from '../wizard-state.ts';

test('position round-trip', () => {
  resetWizardState();
  assert.equal(getPosition(), null);
  setPosition({ tier: 3, stepIndex: 2 });
  assert.deepEqual(getPosition(), { tier: 3, stepIndex: 2 });
});

test('dontAsk add/remove with dedup', () => {
  resetWizardState();
  assert.deepEqual(getDontAsk(), []);
  addDontAsk('SHODAN_API_KEY');
  addDontAsk('HIBP_API_KEY');
  addDontAsk('SHODAN_API_KEY');
  assert.deepEqual(getDontAsk().sort(), ['HIBP_API_KEY', 'SHODAN_API_KEY']);
  removeDontAsk('SHODAN_API_KEY');
  assert.deepEqual(getDontAsk(), ['HIBP_API_KEY']);
});

test('skipped clears on demand', () => {
  resetWizardState();
  addSkipped('NEWSDATA_API_KEY');
  assert.deepEqual(getSkipped(), ['NEWSDATA_API_KEY']);
  clearSkipped();
  assert.deepEqual(getSkipped(), []);
});

test('per-key status round-trip', () => {
  resetWizardState();
  assert.equal(getKeyStatus('FRED_API_KEY'), null);
  setKeyStatus('FRED_API_KEY', { state: 'valid', lastChecked: 1700000000000 });
  assert.deepEqual(getKeyStatus('FRED_API_KEY'), { state: 'valid', lastChecked: 1700000000000 });
});

test('corrupted JSON entries return null', () => {
  resetWizardState();
  localStorage.setItem('cb:setup-wizard:position', 'not-json');
  assert.equal(getPosition(), null);
});
