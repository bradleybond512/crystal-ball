import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGlobeOverlays, __INTERNAL } from '../globe-overlay-emitter.ts';
import { fuseCanonicalEvents } from '../seismic-fusion.ts';
import type { CanonicalSeismicEvent } from '../seismic-types.ts';

const NOW = 1_745_000_000_000;

function quake(overrides: Partial<CanonicalSeismicEvent> & { id: string }): CanonicalSeismicEvent {
  return {
    id: overrides.id,
    source: overrides.source ?? 'usgs',
    sourceEventId: overrides.sourceEventId ?? overrides.id,
    magnitude: 'magnitude' in overrides ? overrides.magnitude! : 6.0,
    depthKm: 'depthKm' in overrides ? overrides.depthKm! : 10,
    lat: overrides.lat ?? 0,
    lon: overrides.lon ?? 0,
    place: overrides.place ?? '',
    occurredAt: overrides.occurredAt ?? NOW,
    status: overrides.status ?? 'reviewed',
    confidence: overrides.confidence ?? 0.85,
    pagerAlert: overrides.pagerAlert,
    updatedAt: overrides.updatedAt,
  };
}

function fuse(canonical: CanonicalSeismicEvent) {
  return fuseCanonicalEvents([canonical])[0]!;
}

// ── Magnitude filter ───────────────────────────────────────────────────

test('M < 4.5 events are filtered out', () => {
  const events = [fuse(quake({ id: 'a', magnitude: 4.4 }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 1000 });
  assert.equal(out.length, 0);
});

test('M >= 4.5 events are included', () => {
  const events = [fuse(quake({ id: 'a', magnitude: 4.5 }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 1000 });
  assert.equal(out.length, 1);
});

test('null magnitude is filtered out', () => {
  const events = [fuse(quake({ id: 'a', magnitude: null }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 1000 });
  assert.equal(out.length, 0);
});

test('custom minMagnitude lowers the floor', () => {
  const events = [fuse(quake({ id: 'a', magnitude: 3.0 }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 1000, minMagnitude: 3.0 });
  assert.equal(out.length, 1);
});

// ── Wave radius computation ────────────────────────────────────────────

test('P-wave radius at t=10s = 60 km', () => {
  const events = [fuse(quake({ id: 'a' }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 10_000 });
  assert.equal(out[0]!.pWaveRadiusKm, 60);
});

test('P-wave radius at t=100s = 600 km', () => {
  const events = [fuse(quake({ id: 'a' }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 100_000 });
  assert.equal(out[0]!.pWaveRadiusKm, 600);
});

test('S-wave radius at t=10s = 35 km', () => {
  const events = [fuse(quake({ id: 'a' }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 10_000 });
  assert.equal(out[0]!.sWaveRadiusKm, 35);
});

test('S-wave lags P-wave at every time t', () => {
  const events = [fuse(quake({ id: 'a' }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 50_000 });
  assert.ok(out[0]!.sWaveRadiusKm < out[0]!.pWaveRadiusKm);
});

test('future event (occurredAt > nowMs) clamps radii to 0 and opacity to 1', () => {
  const events = [fuse(quake({ id: 'a', occurredAt: NOW + 1000 }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW });
  assert.equal(out[0]!.pWaveRadiusKm, 0);
  assert.equal(out[0]!.sWaveRadiusKm, 0);
  assert.equal(out[0]!.pWaveOpacity, 1);
  assert.equal(out[0]!.sWaveOpacity, 1);
});

// ── Antipodal cap ──────────────────────────────────────────────────────

test('P-wave radius capped at antipodal distance (~20015 km)', () => {
  // 4000 seconds × 6 km/s = 24000 km, well past antipode
  const events = [fuse(quake({ id: 'a' }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 4000 * 1000 });
  assert.ok(out[0]!.pWaveRadiusKm <= __INTERNAL.ANTIPODE_KM + 0.001);
  assert.equal(out[0]!.pWaveRadiusKm, __INTERNAL.ANTIPODE_KM);
});

test('S-wave radius capped at antipodal distance', () => {
  const events = [fuse(quake({ id: 'a' }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 7000 * 1000 });
  assert.equal(out[0]!.sWaveRadiusKm, __INTERNAL.ANTIPODE_KM);
});

// ── Opacity decay ──────────────────────────────────────────────────────

test('opacity = 1 at t=0 (origin)', () => {
  const events = [fuse(quake({ id: 'a' }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW });
  assert.equal(out[0]!.pWaveOpacity, 1);
  assert.equal(out[0]!.sWaveOpacity, 1);
});

test('opacity at antipode = 0', () => {
  const events = [fuse(quake({ id: 'a' }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 4000 * 1000 });
  assert.equal(out[0]!.pWaveOpacity, 0);
});

test('opacity halfway across the globe is ~0.5', () => {
  // P-wave half-travel = 10000 km / 6 km/s ≈ 1666.67 s
  const halfMs = (__INTERNAL.ANTIPODE_KM / 2 / __INTERNAL.P_WAVE_KM_PER_SEC) * 1000;
  const events = [fuse(quake({ id: 'a' }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + halfMs });
  assert.ok(Math.abs(out[0]!.pWaveOpacity - 0.5) < 0.01, `got ${out[0]!.pWaveOpacity}`);
});

// ── 4-hour expiry ──────────────────────────────────────────────────────

test('events older than 4h are excluded', () => {
  const events = [fuse(quake({ id: 'a' }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 4 * 3600 * 1000 + 1 });
  assert.equal(out.length, 0);
});

test('events at exactly 4h are still included', () => {
  const events = [fuse(quake({ id: 'a' }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 4 * 3600 * 1000 });
  assert.equal(out.length, 1);
});

// ── 50-event cap with magnitude priority ───────────────────────────────

test('cap limits to maxOverlays prioritizing higher magnitude', () => {
  const events = Array.from({ length: 60 }, (_, i) =>
    fuse(quake({ id: `e-${i}`, sourceEventId: `e-${i}`, magnitude: 4.5 + i * 0.05, lat: i * 0.1 })),
  );
  const out = buildGlobeOverlays({ events, nowMs: NOW + 1000, maxOverlays: 10 });
  assert.equal(out.length, 10);
  // Highest 10 magnitudes should be the ones retained.
  const retainedIds = new Set(out.map((o) => o.eventId));
  for (let i = 50; i < 60; i += 1) {
    assert.ok(retainedIds.has(`e-${i}`), `expected e-${i}`);
  }
});

test('default maxOverlays is 50', () => {
  const events = Array.from({ length: 60 }, (_, i) =>
    fuse(quake({ id: `e-${i}`, sourceEventId: `e-${i}`, magnitude: 4.5 + i * 0.05, lat: i * 0.1 })),
  );
  const out = buildGlobeOverlays({ events, nowMs: NOW + 1000 });
  assert.equal(out.length, 50);
});

test('events under cap return all of them', () => {
  const events = [
    fuse(quake({ id: 'a', magnitude: 5 })),
    fuse(quake({ id: 'b', sourceEventId: 'b', magnitude: 6, lat: 1 })),
  ];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 1000, maxOverlays: 50 });
  assert.equal(out.length, 2);
});

// ── Field plumbing ─────────────────────────────────────────────────────

test('overlay carries eventId, lat, lon, magnitude, ageSec', () => {
  const events = [fuse(quake({ id: 'a', magnitude: 5.5, lat: 12.5, lon: -45.25 }))];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 30_000 });
  assert.equal(out[0]!.eventId, 'a');
  assert.equal(out[0]!.lat, 12.5);
  assert.equal(out[0]!.lon, -45.25);
  assert.equal(out[0]!.magnitude, 5.5);
  assert.equal(out[0]!.ageSec, 30);
  assert.equal(out[0]!.expired, false);
});

// ── Empty / boundary inputs ────────────────────────────────────────────

test('empty events → empty output', () => {
  const out = buildGlobeOverlays({ events: [], nowMs: NOW });
  assert.deepEqual(out, []);
});

test('output is sorted by magnitude desc', () => {
  const events = [
    fuse(quake({ id: 'low', magnitude: 4.6 })),
    fuse(quake({ id: 'hi', sourceEventId: 'hi', magnitude: 7.2, lat: 1 })),
    fuse(quake({ id: 'mid', sourceEventId: 'mid', magnitude: 5.5, lat: 2 })),
  ];
  const out = buildGlobeOverlays({ events, nowMs: NOW + 1000 });
  assert.equal(out[0]!.eventId, 'hi');
  assert.equal(out[1]!.eventId, 'mid');
  assert.equal(out[2]!.eventId, 'low');
});
