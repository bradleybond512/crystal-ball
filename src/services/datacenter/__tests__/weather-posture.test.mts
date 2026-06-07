import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeatherPosture } from '../weather-posture.ts';
import type { SiteConfig } from '../datacenter-types.ts';
import type { NwsAlertMinimal, AlertPolygon } from '../../weather/weather-threat-types.ts';

const SITE: SiteConfig = { id: 's1', name: 'DC1', lat: 41.6, lon: -86.7, radiusKm: 25, eiaRegion: 'MISO' };
const NOW = 1_700_000_000_000;

// A square polygon around the site (so point-in-polygon is true).
function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}

function alert(event: string, polygon: AlertPolygon | undefined): NwsAlertMinimal {
  return { id: `al-${event}`, event, polygon, sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() };
}

test('no alerts -> normal, no hazards', () => {
  const p = computeWeatherPosture(SITE, [], { now: NOW });
  assert.equal(p.level, 'normal');
  assert.deepEqual(p.activeHazards, []);
  assert.equal(p.stormMode, null);
});

test('tornado warning over the site -> critical with storm mode payload', () => {
  const p = computeWeatherPosture(SITE, [alert('Tornado Warning', around(SITE.lat, SITE.lon))], { now: NOW });
  assert.equal(p.level, 'critical');
  assert.ok(p.activeHazards.includes('tornado'));
  assert.notEqual(p.stormMode, null);
});

test('severe thunderstorm warning over the site -> warning or higher', () => {
  const p = computeWeatherPosture(SITE, [alert('Severe Thunderstorm Warning', around(SITE.lat, SITE.lon))], { now: NOW });
  assert.ok(['warning', 'critical'].includes(p.level));
  assert.ok(p.activeHazards.includes('severe_thunderstorm'));
});

test('an alert far away does not match', () => {
  const p = computeWeatherPosture(SITE, [alert('Tornado Warning', around(10, 10))], { now: NOW });
  assert.equal(p.level, 'normal');
});
