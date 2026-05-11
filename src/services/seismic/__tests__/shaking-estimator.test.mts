import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __INTERNAL,
  estimateSavedPlaceShaking,
  type SavedPlaceLite,
} from '../shaking-estimator.ts';
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

function place(id: string, lat: number, lon: number, name = id): SavedPlaceLite {
  return { id, name, lat, lon };
}

function fuseOne(canonical: CanonicalSeismicEvent) {
  const fused = fuseCanonicalEvents([canonical]);
  return fused[0]!;
}

// ── Intensity classification (unit) ────────────────────────────────────

test('intensity: distant low magnitude → none', () => {
  const out = __INTERNAL.classifyIntensity({ magnitude: 3.0, depthKm: 10, distanceKm: 800 });
  assert.equal(out, 'none');
});

test('intensity: shallow nearby M6 → strong/severe class', () => {
  const out = __INTERNAL.classifyIntensity({ magnitude: 6.0, depthKm: 8, distanceKm: 5 });
  assert.ok(['strong', 'severe', 'violent'].includes(out), `got ${out}`);
});

test('intensity: deep quake gets a depth penalty', () => {
  const shallow = __INTERNAL.classifyIntensity({ magnitude: 6.5, depthKm: 10, distanceKm: 50 });
  const deep = __INTERNAL.classifyIntensity({ magnitude: 6.5, depthKm: 200, distanceKm: 50 });
  // Score can stay in the same label for boundary cases, but deep
  // should never be ranked higher.
  const order: Record<string, number> = {
    none: 0, weak: 1, light: 2, moderate: 3, strong: 4, severe: 5, violent: 6,
  };
  assert.ok(order[deep]! <= order[shallow]!, `deep ${deep} should attenuate vs shallow ${shallow}`);
});

test('intensity: beyond TOO_FAR_KM → none even for huge magnitudes', () => {
  const out = __INTERNAL.classifyIntensity({ magnitude: 9.0, depthKm: 10, distanceKm: 5000 });
  assert.equal(out, 'none');
});

test('intensity: null magnitude → none', () => {
  const out = __INTERNAL.classifyIntensity({ magnitude: null, depthKm: 10, distanceKm: 50 });
  assert.equal(out, 'none');
});

// ── Wave timing math ───────────────────────────────────────────────────

test('estimate: P-wave/S-wave times reflect distance / wave speed', () => {
  const event = fuseOne(quake({ id: 'usgs:a', occurredAt: NOW, lat: 0, lon: 0, magnitude: 6 }));
  // A place 35 km away → P arrives at ~5.83s, S at ~10s.
  const out = estimateSavedPlaceShaking({
    event, places: [place('home', 0.314, 0)], nowMs: NOW + 1_000,
  });
  const home = out[0]!;
  assert.ok(home.distanceKm > 30 && home.distanceKm < 40, `distance ${home.distanceKm}`);
  assert.ok(home.estimatedPWaveArrivalSec > 5 && home.estimatedPWaveArrivalSec < 7);
  assert.ok(home.estimatedSWaveArrivalSec > 9 && home.estimatedSWaveArrivalSec < 11);
});

test('estimate: usefulWarningWindowSec ≥ 0 always', () => {
  const event = fuseOne(quake({ id: 'usgs:a', occurredAt: NOW - 30_000, lat: 0, lon: 0, magnitude: 6 }));
  const out = estimateSavedPlaceShaking({
    event, places: [place('home', 0.5, 0)], nowMs: NOW,
  });
  assert.ok(out[0]!.usefulWarningWindowSec >= 0);
});

// ── Timing states ──────────────────────────────────────────────────────

test('timing: nearby quake just happened → may_arrive_soon', () => {
  // Place ~80 km away. S-wave arrival ≈ 22s. nowMs = origin + 1s →
  // S-wave hasn't arrived yet, feed-fresh.
  const event = fuseOne(quake({ id: 'usgs:a', occurredAt: NOW, lat: 0, lon: 0, magnitude: 6.5, depthKm: 10 }));
  const out = estimateSavedPlaceShaking({
    event, places: [place('home', 0.7, 0)], nowMs: NOW + 1_000, feedLatencyMs: 200,
  });
  assert.equal(out[0]!.timing, 'may_arrive_soon');
});

test('timing: feed latency exceeds P-wave window → likely_arrived', () => {
  const event = fuseOne(quake({ id: 'usgs:a', occurredAt: NOW, lat: 0, lon: 0, magnitude: 6.5 }));
  // Place ~50 km away → P-wave arrival ≈ 8.3s. Feed latency 30 s.
  const out = estimateSavedPlaceShaking({
    event, places: [place('home', 0.45, 0)], nowMs: NOW + 1_000, feedLatencyMs: 30_000,
  });
  assert.equal(out[0]!.timing, 'likely_arrived');
});

test('timing: nowMs past S-wave arrival → likely_arrived', () => {
  const event = fuseOne(quake({ id: 'usgs:a', occurredAt: NOW, lat: 0, lon: 0, magnitude: 6.5 }));
  // Place ~50 km away → S-wave arrival ≈ 14s. nowMs = origin + 60 s.
  const out = estimateSavedPlaceShaking({
    event, places: [place('home', 0.45, 0)], nowMs: NOW + 60_000, feedLatencyMs: 0,
  });
  assert.equal(out[0]!.timing, 'likely_arrived');
});

test('timing: distance > TOO_FAR_KM → too_far', () => {
  const event = fuseOne(quake({ id: 'usgs:a', occurredAt: NOW, lat: 0, lon: 0, magnitude: 7.5 }));
  // Place 20° away → ~2200 km
  const out = estimateSavedPlaceShaking({
    event, places: [place('home', 20, 0)], nowMs: NOW + 1_000,
  });
  assert.equal(out[0]!.timing, 'too_far');
});

test('timing: parentMagnitude triggers aftershock_watch when within reach', () => {
  // M5.5 aftershock close to a saved place inside an M7 mainshock's
  // reach (200 km).
  const event = fuseOne(quake({ id: 'usgs:after', occurredAt: NOW, lat: 0, lon: 0, magnitude: 5.5, depthKm: 12 }));
  const out = estimateSavedPlaceShaking({
    event, places: [place('home', 1.0, 0)], nowMs: NOW + 1_000, parentMagnitude: 7.0,
  });
  assert.equal(out[0]!.timing, 'aftershock_watch');
});

test('timing: parentMagnitude=M5 (reach=0) does NOT trigger aftershock watch', () => {
  const event = fuseOne(quake({ id: 'usgs:after', occurredAt: NOW, lat: 0, lon: 0, magnitude: 4.5 }));
  const out = estimateSavedPlaceShaking({
    event, places: [place('home', 0.5, 0)], nowMs: NOW + 1_000, parentMagnitude: 4.5,
  });
  assert.notEqual(out[0]!.timing, 'aftershock_watch');
});

test('timing: null magnitude → unknown', () => {
  const event = fuseOne(quake({ id: 'usgs:a', occurredAt: NOW, lat: 0, lon: 0, magnitude: null }));
  const out = estimateSavedPlaceShaking({
    event, places: [place('home', 0.5, 0)], nowMs: NOW + 1_000,
  });
  assert.equal(out[0]!.timing, 'unknown');
});

// ── Recommended actions ───────────────────────────────────────────────

test('action: strong shaking + may_arrive_soon → drop_cover_hold_on', () => {
  const out = __INTERNAL.chooseAction({ intensity: 'strong', timing: 'may_arrive_soon' });
  assert.equal(out, 'drop_cover_hold_on');
});

test('action: severe shaking + likely_arrived → inspect_damage', () => {
  const out = __INTERNAL.chooseAction({ intensity: 'severe', timing: 'likely_arrived' });
  assert.equal(out, 'inspect_damage');
});

test('action: aftershock_watch always → prepare_aftershock', () => {
  const a = __INTERNAL.chooseAction({ intensity: 'weak', timing: 'aftershock_watch' });
  const b = __INTERNAL.chooseAction({ intensity: 'strong', timing: 'aftershock_watch' });
  assert.equal(a, 'prepare_aftershock');
  assert.equal(b, 'prepare_aftershock');
});

test('action: too_far + any intensity → none', () => {
  const out = __INTERNAL.chooseAction({ intensity: 'moderate', timing: 'too_far' });
  assert.equal(out, 'none');
});

test('action: light shaking + likely_arrived → monitor', () => {
  const out = __INTERNAL.chooseAction({ intensity: 'light', timing: 'likely_arrived' });
  assert.equal(out, 'monitor');
});

// ── Multiple places fan-out ───────────────────────────────────────────

test('estimate: returns one entry per place, in input order', () => {
  const event = fuseOne(quake({ id: 'usgs:a', occurredAt: NOW, lat: 0, lon: 0, magnitude: 6 }));
  const out = estimateSavedPlaceShaking({
    event,
    places: [place('a', 0.5, 0), place('b', 1, 0), place('c', 50, 50)],
    nowMs: NOW + 1_000,
  });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((e) => e.placeId), ['a', 'b', 'c']);
});

// ── Confidence ────────────────────────────────────────────────────────

test('confidence: distance penalty applies past 500 km', () => {
  const event = fuseOne(quake({ id: 'usgs:a', occurredAt: NOW, lat: 0, lon: 0, magnitude: 7, confidence: 0.9 }));
  const close = estimateSavedPlaceShaking({
    event, places: [place('a', 0.5, 0)], nowMs: NOW + 1_000,
  });
  const far = estimateSavedPlaceShaking({
    event, places: [place('a', 8, 0)], nowMs: NOW + 1_000,
  });
  assert.ok(close[0]!.confidence > far[0]!.confidence);
});

test('confidence: null depth applies an uncertainty penalty', () => {
  const known = fuseOne(quake({ id: 'usgs:a', occurredAt: NOW, lat: 0, lon: 0, magnitude: 6, depthKm: 10, confidence: 0.9 }));
  const unknown = fuseOne(quake({ id: 'usgs:b', occurredAt: NOW, lat: 0, lon: 0, magnitude: 6, depthKm: null, confidence: 0.9 }));
  const a = estimateSavedPlaceShaking({ event: known, places: [place('a', 0.5, 0)], nowMs: NOW + 1_000 })[0]!;
  const b = estimateSavedPlaceShaking({ event: unknown, places: [place('a', 0.5, 0)], nowMs: NOW + 1_000 })[0]!;
  assert.ok(a.confidence > b.confidence);
});

// ── JSON serializable ─────────────────────────────────────────────────

test('estimates are JSON-serializable', () => {
  const event = fuseOne(quake({ id: 'usgs:a', occurredAt: NOW, lat: 0, lon: 0, magnitude: 6 }));
  const out = estimateSavedPlaceShaking({
    event, places: [place('home', 0.5, 0)], nowMs: NOW + 1_000,
  });
  const round = JSON.parse(JSON.stringify(out));
  assert.equal(round[0].placeId, 'home');
});
