import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reconstructProviderSnapshots,
  snapshotFromAggregateResponse,
  type AggregateResponse,
} from '../adsb-aggregate-bridge.ts';

function sampleResponse(): AggregateResponse {
  return {
    fetchedAt: 10_000,
    sources: {
      opensky: { ok: true, count: 1, ms: 10 },
      airplanesLive: { ok: true, count: 1, ms: 12 },
      adsbFi: { ok: false, count: 0, ms: 5, error: 'timeout' },
      adsbLol: { ok: true, count: 1, ms: 8 },
    },
    aircraft: [
      // seen by 2 providers → confidence 0.85; ~10000 m alt, ~100 m/s
      { icao: 'abc123', callsign: 'TEST1', country: 'United States', lat: 41.6, lon: -86.7,
        alt: 32_808, speed: 194, track: 90, vsi: 0, squawk: '1200', type: null, military: null,
        ts: 10_000, sources: ['opensky', 'airplanesLive'] },
      // seen by 1 provider → confidence 0.55; emergency squawk
      { icao: 'def456', callsign: null, country: null, lat: 42, lon: -87,
        alt: null, speed: null, track: null, vsi: null, squawk: '7700', type: null, military: null,
        ts: 10_000, sources: ['adsbLol'] },
    ],
  };
}

test('reconstructProviderSnapshots rebuilds per-provider snapshots incl. degraded ones', () => {
  const snaps = reconstructProviderSnapshots(sampleResponse());
  const byId = new Map(snaps.map((s) => [s.providerId, s]));
  // all 4 queried providers present (adsbFi has 0 aircraft but was queried → degraded)
  assert.equal(snaps.length, 4);
  assert.equal(byId.get('opensky')?.aircraft.length, 1);
  assert.equal(byId.get('airplanesLive')?.aircraft.length, 1);
  assert.equal(byId.get('adsbLol')?.aircraft.length, 1);
  assert.equal(byId.get('adsbFi')?.aircraft.length, 0);
  assert.equal(byId.get('adsbFi')?.degraded, true);
  assert.equal(byId.get('opensky')?.degraded, false);
});

test('snapshotFromAggregateResponse scores confidence by provider count + converts units', () => {
  const snap = snapshotFromAggregateResponse(sampleResponse(), 10_000);
  const f1 = snap.flights.find((f) => f.icao24 === 'abc123')!;
  const f2 = snap.flights.find((f) => f.icao24 === 'def456')!;

  // 2 providers, fresh → 0.85; 1 provider → 0.55
  assert.ok(Math.abs((f1.confidence ?? 0) - 0.85) < 1e-9, `two-source conf ${f1.confidence}`);
  assert.ok(Math.abs((f2.confidence ?? 0) - 0.55) < 1e-9, `one-source conf ${f2.confidence}`);
  assert.deepEqual([...(f1.providers ?? [])].sort(), ['airplanesLive', 'opensky']);

  // units: 32808 ft → ~10000 m; 194 kt → ~100 m/s
  assert.ok(Math.abs((f1.altitude ?? 0) - 10_000) < 5, `alt m ${f1.altitude}`);
  assert.ok(Math.abs((f1.velocity ?? 0) - 100) < 1, `vel m/s ${f1.velocity}`);

  // full fields preserved (country + squawk) so the panel's stats still work
  assert.equal(f1.originCountry, 'United States');
  assert.equal(f2.originCountry, 'Unknown');
  assert.equal(f2.squawk, '7700');

  // aggregate metadata present
  assert.ok(snap.aggregate);
  assert.ok(['healthy', 'degraded', 'silent'].includes(snap.aggregate!.status));
  assert.equal(snap.aggregate!.tracks.length, 2);
});
