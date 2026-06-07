import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setDatacenterSite, getDatacenterPosture, recomputeDatacenterPosture,
  subscribeDatacenterPosture, __resetDatacenterStateForTests,
} from '../datacenter-state.ts';
import type { SiteConfig } from '../datacenter-types.ts';
import type { GridStatus } from '../../power-grid.ts';

const SITE: SiteConfig = { id: 's1', name: 'DC1', lat: 41.6, lon: -86.7, radiusKm: 25, eiaRegion: 'MISO' };
const NOW = 1_700_000_000_000;
function gridStatus(util: number): GridStatus {
  return { region: 'MISO', demand: util, capacity: 100, utilizationPct: util, alerts: [], lastUpdate: NOW };
}

test('posture is null until a site is set', () => {
  __resetDatacenterStateForTests();
  assert.equal(getDatacenterPosture(), null);
});

test('recompute produces a posture and notifies subscribers', () => {
  __resetDatacenterStateForTests();
  setDatacenterSite(SITE);
  let notified = 0;
  const unsub = subscribeDatacenterPosture(() => { notified += 1; });
  recomputeDatacenterPosture({ gridStatus: gridStatus(94), weatherAlerts: [], nearbyOutageCount: 0, now: NOW });
  assert.equal(getDatacenterPosture()?.overall, 'warning');
  assert.ok(notified >= 1);
  unsub();
});

test('recompute is a no-op (returns null) when no site is configured', () => {
  __resetDatacenterStateForTests();
  const result = recomputeDatacenterPosture({ gridStatus: gridStatus(94), weatherAlerts: [], nearbyOutageCount: 0, now: NOW });
  assert.equal(result, null);
  assert.equal(getDatacenterPosture(), null);
});
