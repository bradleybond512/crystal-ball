// src/services/survival/__tests__/survival-posture.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePosture } from '../survival-posture.ts';
import type { PostureInput } from '../survival-posture.ts';
import type { NwsAlertMinimal, AlertPolygon, SavedPlace } from '../../weather/weather-threat-types.ts';

const NOW = 1_700_000_000_000;
const HOME: SavedPlace = { id: 'home', label: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };

function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}
function alert(event: string, polygon: AlertPolygon): NwsAlertMinimal {
  return { id: `al-${event}`, event, polygon, sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() };
}
function input(alerts: NwsAlertMinimal[], ok = true): PostureInput {
  return {
    weatherAlerts: alerts,
    savedPlaces: [HOME],
    freshness: [{ domain: 'weather', fetchedAtMs: NOW - 60_000, ageMs: 60_000, ok }],
    capturedAtMs: NOW,
  };
}

test('quiet world -> all 8 axes secure, overall secure', () => {
  const p = computePosture(input([]), { now: NOW });
  assert.equal(p.axes.length, 8);
  assert.ok(p.axes.every((a) => a.band === 'secure'));
  assert.equal(p.overallBand, 'secure');
});

test('tornado over home -> physical_safety critical, others still secure', () => {
  const p = computePosture(input([alert('Tornado Warning', around(HOME.lat, HOME.lon))]), { now: NOW });
  const phys = p.axes.find((a) => a.axis === 'physical_safety')!;
  assert.equal(phys.band, 'critical');
  assert.equal(phys.threats.length, 1);
  assert.equal(p.worstAxis, 'physical_safety');
  assert.equal(p.overallBand, 'critical');
  const supply = p.axes.find((a) => a.axis === 'supply')!;
  assert.equal(supply.band, 'secure');
});

test('every axis carries a confidence breakdown and explanation', () => {
  const p = computePosture(input([alert('Tornado Warning', around(HOME.lat, HOME.lon))]), { now: NOW });
  for (const a of p.axes) {
    assert.equal(a.confidence.max, 100);
    assert.ok(a.confidence.items.length >= 1);
    assert.ok(typeof a.explanation.headline === 'string');
  }
});

test('confidence.total equals the sum of its item values (contract), even with multiple threats on an axis', () => {
  const two = [alert('Tornado Warning', around(HOME.lat, HOME.lon)), alert('Severe Thunderstorm Warning', around(HOME.lat, HOME.lon))];
  const p = computePosture(input(two), { now: NOW });
  const phys = p.axes.find((a) => a.axis === 'physical_safety')!;
  assert.ok(phys.threats.length >= 2);
  const sum = phys.confidence.items.reduce((s, i) => s + i.value, 0);
  assert.equal(phys.confidence.total, sum);
});

test('a stale weather feed is surfaced, never dropped', () => {
  const p = computePosture(input([alert('Tornado Warning', around(HOME.lat, HOME.lon))], false), { now: NOW });
  assert.ok(p.staleInputs.some((s) => s.includes('weather')));
});
