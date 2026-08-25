import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { loadLatestSnapshot } from '../snapshot-store.ts';
import { buildSnapshot } from '../world-snapshot.ts';
import { projectEmergencyReadiness } from '../../../components/emergency-readiness-view.ts';

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

  assert.deepEqual(await loadLatestSnapshot({ now: NOW }), snapshot);
});

test('rejects a parseable but structurally invalid persisted survival snapshot', async () => {
  installStoredValue(JSON.stringify({ version: 1, capturedAtMs: NOW }));

  assert.equal(await loadLatestSnapshot(), null);
});

test('rejects malformed persisted survival snapshot JSON without throwing', async () => {
  installStoredValue('{not-json');

  assert.equal(await loadLatestSnapshot(), null);
});

test('malformed nested posture data restores as unavailable readiness instead of throwing', async () => {
  const snapshot = buildSnapshot({
    weatherAlerts: [],
    savedPlaces: [],
    weatherFetchedAtMs: NOW - 60_000,
  }, { now: NOW });
  snapshot.posture.axes[0]!.drivers = [{} as never];
  snapshot.posture.axes[0]!.threats = [null as never];
  installStoredValue(JSON.stringify(snapshot));

  const restored = await loadLatestSnapshot({ now: NOW });
  const view = projectEmergencyReadiness(restored, null, { now: NOW });

  assert.equal(restored, null);
  assert.equal(view.cards.length, 4);
  assert.ok(view.cards.every((card) => card.status === 'unavailable'));
});

test('rejects a persisted snapshot captured beyond the allowed clock skew', async () => {
  const snapshot = buildSnapshot({
    weatherAlerts: [],
    savedPlaces: [],
    weatherFetchedAtMs: NOW - 60_000,
  }, { now: NOW + (5 * 60_000) + 1 });
  installStoredValue(JSON.stringify(snapshot));

  assert.equal(await loadLatestSnapshot({ now: NOW }), null);
});
