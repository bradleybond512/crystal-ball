import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bandForMagnitude,
  colorForMagnitude,
  diffOverlays,
  entityKey,
  ENTITY_KEYS,
} from '../seismic-waves-helpers.ts';
import type { GlobeSeismicOverlay } from '../globe-overlay-emitter.ts';

function overlay(id: string, magnitude: number | null = 5.5): GlobeSeismicOverlay {
  return {
    eventId: id,
    lat: 0,
    lon: 0,
    magnitude,
    pWaveRadiusKm: 60,
    sWaveRadiusKm: 35,
    pWaveOpacity: 0.99,
    sWaveOpacity: 0.99,
    ageSec: 10,
    expired: false,
  };
}

// ── Magnitude bands ────────────────────────────────────────────────────

test('M4.0 → M4-5 band', () => {
  assert.equal(bandForMagnitude(4.0), 'M4-5');
});

test('M4.99 → M4-5 band', () => {
  assert.equal(bandForMagnitude(4.99), 'M4-5');
});

test('M5.0 → M5-6 band', () => {
  assert.equal(bandForMagnitude(5.0), 'M5-6');
});

test('M5.99 → M5-6 band', () => {
  assert.equal(bandForMagnitude(5.99), 'M5-6');
});

test('M6.0 → M6-7 band', () => {
  assert.equal(bandForMagnitude(6.0), 'M6-7');
});

test('M6.99 → M6-7 band', () => {
  assert.equal(bandForMagnitude(6.99), 'M6-7');
});

test('M7.0 → M7+ band', () => {
  assert.equal(bandForMagnitude(7.0), 'M7+');
});

test('M9.0 → M7+ band', () => {
  assert.equal(bandForMagnitude(9.0), 'M7+');
});

test('null magnitude defaults to M4-5 (defensive)', () => {
  assert.equal(bandForMagnitude(null), 'M4-5');
});

// ── Color mapping ──────────────────────────────────────────────────────

test('M4-5 color is green', () => {
  const c = colorForMagnitude(4.5);
  assert.equal(c.band, 'M4-5');
  assert.equal(c.hex, '#22cc66');
});

test('M5-6 color is yellow', () => {
  assert.equal(colorForMagnitude(5.5).hex, '#ffcc00');
});

test('M6-7 color is orange', () => {
  assert.equal(colorForMagnitude(6.5).hex, '#ff8800');
});

test('M7+ color is red', () => {
  assert.equal(colorForMagnitude(7.5).hex, '#ff2233');
});

// ── Diff ───────────────────────────────────────────────────────────────

test('diff: identical lists → no changes (everything in updated)', () => {
  const a = [overlay('a'), overlay('b')];
  const b = [overlay('a'), overlay('b')];
  const d = diffOverlays(a, b);
  assert.equal(d.added.length, 0);
  assert.equal(d.updated.length, 2);
  assert.equal(d.removedIds.length, 0);
});

test('diff: empty prev, populated next → all added', () => {
  const d = diffOverlays([], [overlay('a'), overlay('b')]);
  assert.equal(d.added.length, 2);
  assert.equal(d.updated.length, 0);
  assert.equal(d.removedIds.length, 0);
});

test('diff: populated prev, empty next → all removedIds', () => {
  const d = diffOverlays([overlay('a'), overlay('b')], []);
  assert.deepEqual(d.removedIds.sort(), ['a', 'b']);
  assert.equal(d.added.length, 0);
  assert.equal(d.updated.length, 0);
});

test('diff: one added, one removed', () => {
  const d = diffOverlays([overlay('a'), overlay('b')], [overlay('a'), overlay('c')]);
  assert.deepEqual(d.added.map((o) => o.eventId), ['c']);
  assert.deepEqual(d.updated.map((o) => o.eventId), ['a']);
  assert.deepEqual(d.removedIds, ['b']);
});

test('diff: a duplicate eventId within next is emitted ONCE (feed-dedup)', () => {
  // A live feed (e.g. GeoNet) can list the same event twice. Without dedup both
  // copies land in `added`, so the SECOND entities.add() throws "An entity with
  // id ... already exists", halting that overlay render. Dedup by eventId.
  const d = diffOverlays([], [overlay('dup'), overlay('dup')]);
  assert.equal(d.added.length, 1);
  assert.deepEqual(d.added.map((o) => o.eventId), ['dup']);
});

test('diff: a duplicate eventId already present in prev stays single in updated', () => {
  const d = diffOverlays([overlay('a')], [overlay('a'), overlay('a')]);
  assert.equal(d.updated.length, 1);
  assert.equal(d.added.length, 0);
  assert.equal(d.removedIds.length, 0);
});

test('diff: updated overlays carry the latest radii (next, not prev)', () => {
  const prev = [{ ...overlay('a'), pWaveRadiusKm: 100 }];
  const next = [{ ...overlay('a'), pWaveRadiusKm: 600 }];
  const d = diffOverlays(prev, next);
  assert.equal(d.updated[0]!.pWaveRadiusKm, 600);
});

// ── Entity key derivation ──────────────────────────────────────────────

test('entityKey: keys are deterministic and unique per suffix', () => {
  const e = entityKey('usgs:abc', ENTITY_KEYS.epicenter);
  const p = entityKey('usgs:abc', ENTITY_KEYS.pWave);
  const s = entityKey('usgs:abc', ENTITY_KEYS.sWave);
  assert.equal(e, 'usgs:abc::epicenter');
  assert.equal(p, 'usgs:abc::p-wave');
  assert.equal(s, 'usgs:abc::s-wave');
  assert.notEqual(e, p);
  assert.notEqual(p, s);
});
