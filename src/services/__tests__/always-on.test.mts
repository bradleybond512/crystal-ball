import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage shim for Node test
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { isAlwaysOn, setAlwaysOnSetting } = await import('../always-on.ts');

describe('always-on setting', () => {
  beforeEach(() => store.clear());
  it('defaults to true when unset', () => {
    assert.equal(isAlwaysOn(), true);
  });
  it('returns false when explicitly disabled', () => {
    setAlwaysOnSetting(false);
    assert.equal(isAlwaysOn(), false);
  });
  it('returns true when re-enabled', () => {
    setAlwaysOnSetting(false);
    setAlwaysOnSetting(true);
    assert.equal(isAlwaysOn(), true);
  });
});
