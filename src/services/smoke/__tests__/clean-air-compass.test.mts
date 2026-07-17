import assert from 'node:assert/strict';
import test from 'node:test';

import { compassPoints, rankCompass, describeCompass } from '../clean-air-compass.ts';
import type { CompassSample } from '../smoke-types.ts';

test('generates 8 directions × given radii with plausible offsets', () => {
  const pts = compassPoints(41.6, -86.7, [30, 60]);
  assert.equal(pts.length, 16);
  const north30 = pts.find((p) => p.direction === 'N' && p.radiusMi === 30)!;
  // 30 mi ≈ 0.434° latitude
  assert.ok(Math.abs(north30.lat - (41.6 + 0.434)) < 0.01, `lat ${north30.lat}`);
  assert.ok(Math.abs(north30.lon - -86.7) < 0.001);
  const east30 = pts.find((p) => p.direction === 'E' && p.radiusMi === 30)!;
  // longitude offset scales by cos(lat): 0.434 / cos(41.6°) ≈ 0.581
  assert.ok(Math.abs(east30.lon - (-86.7 + 0.581)) < 0.01, `lon ${east30.lon}`);
});

function sample(direction: CompassSample['direction'], radiusMi: number, avg: number | null): CompassSample {
  return { direction, bearingDeg: 0, radiusMi, lat: 0, lon: 0, avgAqi6h: avg, deltaPctVsHome: null, placeName: null };
}

test('ranking: cleaner first, deltas vs home, null data last', () => {
  const ranked = rankCompass([sample('S', 60, 60), sample('N', 60, 140), sample('W', 60, null)], 100);
  assert.equal(ranked[0]!.direction, 'S');
  assert.equal(ranked[0]!.deltaPctVsHome, -40);
  assert.equal(ranked[1]!.deltaPctVsHome, 40);
  assert.equal(ranked.at(-1)!.avgAqi6h, null);
});

test('describe: names the best direction or reports unavailable', () => {
  const good = describeCompass([{ ...sample('S', 60, 60), deltaPctVsHome: -40, placeName: 'Lafayette' }], 100);
  assert.match(good, /40% cleaner/);
  assert.match(good, /60 mi S/);
  assert.match(good, /Lafayette/);
  assert.match(describeCompass([sample('W', 60, null)], 100), /unavailable/i);
  // Nowhere better:
  assert.match(describeCompass([{ ...sample('N', 30, 150), deltaPctVsHome: 25 }], 100), /no cleaner air/i);
});
