import assert from 'node:assert/strict';
import test from 'node:test';

// Stubs for localStorage + document.
const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (i: number) => [...storage.keys()][i] ?? null,
} as Storage;
(globalThis as unknown as { document: { addEventListener: () => void } }).document = {
  addEventListener: () => { /* noop */ },
};

import { hourOfWeek, getBaseline, isAboveNormal, deviationSigma } from '../pressure-baselines.ts';

// pressure-baselines ingests via the cb:mode-advisory event internally, but
// since we can't easily dispatch in this environment, we test the read-only
// helpers after directly priming a bucket through many getBaseline reads.
// Instead: verify the hour-of-week math + the "insufficient baseline"
// default behavior — these are the load-bearing public shapes.

test('hourOfWeek: Sunday 00:00 UTC = 0', () => {
  // Feb 2 2025 00:15 UTC is a Sunday.
  const d = new Date('2025-02-02T00:15:00Z');
  assert.equal(hourOfWeek(d), 0);
});

test('hourOfWeek: Sunday 23:00 UTC = 23', () => {
  const d = new Date('2025-02-02T23:00:00Z');
  assert.equal(hourOfWeek(d), 23);
});

test('hourOfWeek: Monday 00:00 UTC = 24', () => {
  const d = new Date('2025-02-03T00:00:00Z');
  assert.equal(hourOfWeek(d), 24);
});

test('hourOfWeek: Saturday 23:00 UTC = 167', () => {
  const d = new Date('2025-02-08T23:00:00Z');
  assert.equal(hourOfWeek(d), 167);
});

test('getBaseline returns insufficient with no samples', () => {
  const b = getBaseline('finance');
  assert.equal(b.samples, 0);
  assert.equal(b.sufficient, false);
});

test('isAboveNormal returns false when baseline is insufficient', () => {
  // Even an extreme pressure reading shouldn't trigger with no history.
  assert.equal(isAboveNormal('security', 0.99), false);
});

test('deviationSigma returns 0 when baseline is insufficient', () => {
  assert.equal(deviationSigma('disaster', 0.99), 0);
});
