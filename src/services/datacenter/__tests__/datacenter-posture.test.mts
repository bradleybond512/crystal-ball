import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDatacenterPosture } from '../datacenter-posture.ts';
import type { SiteConfig } from '../datacenter-types.ts';
import type { NwsAlertMinimal, AlertPolygon } from '../../weather/weather-threat-types.ts';
import type { GridStatus } from '../../power-grid.ts';

const SITE: SiteConfig = { id: 's1', name: 'DC1', lat: 41.6, lon: -86.7, radiusKm: 25, eiaRegion: 'MISO' };
const NOW = 1_700_000_000_000;

function gridStatus(util: number): GridStatus {
  return { region: 'MISO', demand: util, capacity: 100, utilizationPct: util, alerts: [], lastUpdate: NOW };
}
function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}
function alert(event: string): NwsAlertMinimal {
  return { id: event, event, polygon: around(SITE.lat, SITE.lon), sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() };
}

test('all clear: overall normal, headline mentions monitoring, no actions', () => {
  const p = computeDatacenterPosture({ site: SITE, gridStatus: gridStatus(55), weatherAlerts: [], nearbyOutageCount: 0, now: NOW });
  assert.equal(p.overall, 'normal');
  assert.equal(p.actions.length, 0);
  assert.match(p.headline, /monitor/i);
});

test('grid-only stress: overall follows power level', () => {
  const p = computeDatacenterPosture({ site: SITE, gridStatus: gridStatus(94), weatherAlerts: [], nearbyOutageCount: 0, now: NOW });
  assert.equal(p.overall, 'warning');
});

test('weather-only warning: overall follows weather level', () => {
  const p = computeDatacenterPosture({ site: SITE, gridStatus: gridStatus(55), weatherAlerts: [alert('Severe Thunderstorm Warning')], nearbyOutageCount: 0, now: NOW });
  assert.ok(['warning', 'critical'].includes(p.overall));
});

test('both elevated bumps one rung above the higher input (amplifier)', () => {
  const winterAdvisory: NwsAlertMinimal = { id: 'wx', event: 'Winter Weather Advisory', polygon: around(SITE.lat, SITE.lon), sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() };
  const p = computeDatacenterPosture({ site: SITE, gridStatus: gridStatus(88), weatherAlerts: [winterAdvisory], nearbyOutageCount: 0, now: NOW });
  assert.equal(p.power.level, 'advisory');
  assert.equal(p.weather.level, 'advisory');
  assert.equal(p.overall, 'warning'); // bumped from advisory
});

test('stale/missing grid feed is reported in staleInputs, not hidden', () => {
  const p = computeDatacenterPosture({ site: SITE, gridStatus: null, weatherAlerts: [], nearbyOutageCount: null, now: NOW });
  assert.ok(p.staleInputs.includes('grid'));
  assert.equal(p.power.gridUtilizationPct, null);
});
