import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMultiAxisPosture, type MultiAxisInput } from '../survival-posture.ts';
import { makeWeatherContributor } from '../weather-contributor.ts';
import type { PostureContributor } from '../posture-contributor.ts';
import type { PostureThreat } from '../survival-types.ts';
import type { NwsAlertMinimal, AlertPolygon, SavedPlace } from '../../weather/weather-threat-types.ts';

const NOW = 1_700_000_000_000;
const HOME: SavedPlace = { id: 'home', label: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };
function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}
const TORNADO: NwsAlertMinimal = { id: 'al-t', event: 'Tornado Warning', polygon: around(HOME.lat, HOME.lon), sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() };
const fresh = [{ domain: 'weather' as const, fetchedAtMs: NOW - 60_000, ageMs: 60_000, ok: true }];

function fakeSupplyContributor(severity: number): PostureContributor {
  const threat: PostureThreat = {
    sourceEventId: 'supply-1', axis: 'supply', severity, threatLevel: 'warning',
    hazardKind: 'other', hazardLabel: 'Diesel shortage', timeToImpactMins: null,
    arrivalLabel: null, why: 'inventory below floor', confidenceLabel: 'medium',
  };
  return { id: 'supply', contribute: () => [threat] };
}

test('two contributors populate two different axes; worst axis wins', () => {
  const input: MultiAxisInput = {
    contributors: [makeWeatherContributor([TORNADO], [HOME]), fakeSupplyContributor(60)],
    freshness: fresh, capturedAtMs: NOW,
  };
  const p = computeMultiAxisPosture(input, { now: NOW });
  assert.equal(p.axes.find((a) => a.axis === 'physical_safety')!.band, 'critical');
  assert.equal(p.axes.find((a) => a.axis === 'supply')!.level, 60);
  assert.equal(p.worstAxis, 'physical_safety'); // tornado 95 > supply 60
  assert.equal(p.overallBand, 'critical');
});

test('no contributors -> all axes secure', () => {
  const p = computeMultiAxisPosture({ contributors: [], freshness: fresh, capturedAtMs: NOW }, { now: NOW });
  assert.ok(p.axes.every((a) => a.band === 'secure'));
  assert.equal(p.overallBand, 'secure');
});
