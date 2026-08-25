import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { loadLatestSnapshot } from '../snapshot-store.ts';
import { buildSnapshot } from '../world-snapshot.ts';

const NOW = 2_000_000_000_000;
const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function installStoredValue(value: string | null): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => value,
      setItem: () => undefined,
    },
  });
}

afterEach(() => {
  if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('restores a structurally valid persisted survival snapshot', async () => {
  const snapshot = buildSnapshot({
    weatherAlerts: [],
    savedPlaces: [],
    weatherFetchedAtMs: NOW - 60_000,
  }, { now: NOW });
  installStoredValue(JSON.stringify(snapshot));

  assert.deepEqual(await loadLatestSnapshot(), snapshot);
});

test('rejects a parseable but structurally invalid persisted survival snapshot', async () => {
  installStoredValue(JSON.stringify({ version: 1, capturedAtMs: NOW }));

  assert.equal(await loadLatestSnapshot(), null);
});

test('rejects malformed persisted survival snapshot JSON without throwing', async () => {
  installStoredValue('{not-json');

  assert.equal(await loadLatestSnapshot(), null);
});
