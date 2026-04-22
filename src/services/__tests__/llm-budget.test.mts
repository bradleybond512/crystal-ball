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

class StubCE<T = unknown> {
  detail: T | undefined;
  type: string;
  constructor(type: string, init?: { detail?: T }) { this.type = type; this.detail = init?.detail; }
}
(globalThis as unknown as { CustomEvent: unknown }).CustomEvent = StubCE;
(globalThis as unknown as { document: { dispatchEvent: () => boolean } }).document = {
  dispatchEvent: () => true,
};

import {
  canSpend, recordCall, getBudgetStatus, setCloudCap, getCloudCap, resetBudget,
} from '../llm-budget.ts';

test('local calls are always allowed', () => {
  resetBudget();
  setCloudCap(0);
  assert.equal(canSpend('local'), true);
});

test('cloud calls respect the cap', () => {
  resetBudget();
  setCloudCap(2);
  assert.equal(canSpend('cloud-agent'), true);
  recordCall('cloud-agent');
  assert.equal(canSpend('cloud-agent'), true);
  recordCall('cloud-agent');
  assert.equal(canSpend('cloud-agent'), false);
  assert.equal(getBudgetStatus().exhausted, true);
  assert.equal(getBudgetStatus().remaining, 0);
});

test('recordCall buckets local vs cloud correctly', () => {
  resetBudget();
  setCloudCap(50);
  recordCall('local');
  recordCall('local');
  recordCall('cloud-agent');
  const status = getBudgetStatus();
  assert.equal(status.local, 2);
  assert.equal(status.cloud, 1);
});

test('provider=none is uncounted', () => {
  resetBudget();
  recordCall('none');
  assert.equal(getBudgetStatus().local, 0);
  assert.equal(getBudgetStatus().cloud, 0);
});

test('setCloudCap clamps to sane range', () => {
  setCloudCap(-10);
  assert.equal(getCloudCap(), 0);
  setCloudCap(9999);
  assert.equal(getCloudCap(), 1000);
});
