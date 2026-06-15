// src/services/survival/__tests__/threat-projection.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectWeatherThreats } from '../threat-projection.ts';
import type { NwsAlertMinimal, AlertPolygon, SavedPlace } from '../../weather/weather-threat-types.ts';

const NOW = 1_700_000_000_000;
const HOME: SavedPlace = { id: 'home', label: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };

function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}
function alert(event: string, polygon: AlertPolygon | undefined): NwsAlertMinimal {
  return { id: `al-${event}`, event, polygon, sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() };
}

test('no alerts -> no threats', () => {
  assert.deepEqual(projectWeatherThreats([], [HOME], { now: NOW }), []);
});

test('tornado warning over home -> a physical_safety threat', () => {
  const threats = projectWeatherThreats([alert('Tornado Warning', around(HOME.lat, HOME.lon))], [HOME], { now: NOW });
  assert.equal(threats.length, 1);
  assert.equal(threats[0]!.axis, 'physical_safety');
  assert.equal(threats[0]!.hazardKind, 'tornado');
  assert.equal(threats[0]!.threatLevel, 'emergency');
  assert.ok(threats[0]!.severity >= 75);
  assert.equal(threats[0]!.sourceEventId, 'al-Tornado Warning');
});

test('alert far from home -> no threat', () => {
  const threats = projectWeatherThreats([alert('Tornado Warning', around(10, 10))], [HOME], { now: NOW });
  assert.deepEqual(threats, []);
});

test('threats are sorted strongest first', () => {
  const threats = projectWeatherThreats(
    [alert('Flood Watch', around(HOME.lat, HOME.lon)), alert('Tornado Warning', around(HOME.lat, HOME.lon))],
    [HOME],
    { now: NOW },
  );
  assert.ok(threats.length >= 2);
  assert.ok(threats[0]!.severity >= threats[1]!.severity);
});
