import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCachedPowerGridAlerts } from '../power-grid-alerts.ts';

// getCachedPowerGridAlerts() gives the survival energy_water axis a synchronous
// read of the warm grid-alert cache. The warm path is exercised end-to-end via the
// adapter tests through the contributor; here we pin the cold, fail-safe behavior
// (its TTL logic mirrors the disease-intel / IODA / chokepoint getters).

test('getCachedPowerGridAlerts() returns [] before any fetch (cold, fail-safe)', () => {
  assert.deepEqual(getCachedPowerGridAlerts(), []);
});

test('getCachedPowerGridAlerts() returns [] for a far-future clock (stale, fail-safe)', () => {
  assert.deepEqual(getCachedPowerGridAlerts(Date.now() + 60 * 60 * 1000), []);
});
