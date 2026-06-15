import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptLiveAlert, adaptSavedPlace, type LiveAlertInput } from '../storm-posture-adapter.ts';

const HOME = { id: 'home', name: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };

test('adaptSavedPlace maps app place -> weather place (name->label)', () => {
  const p = adaptSavedPlace(HOME);
  assert.equal(p.id, 'home');
  assert.equal(p.label, 'Home');
  assert.equal(p.lat, 41.6);
  assert.equal(p.radiusKm, 25);
});

test('adaptLiveAlert uses GeoJSON Polygon geometry when present', () => {
  const raw: LiveAlertInput = {
    id: 'a1', event: 'Tornado Warning', severity: 'Extreme',
    onset: '2026-06-14T10:00:00Z', expires: '2026-06-14T11:00:00Z',
    geometry: { type: 'Polygon', coordinates: [[[-87, 41], [-86, 41], [-86, 42], [-87, 42], [-87, 41]]] },
    centroid: [-86.5, 41.5],
  };
  const m = adaptLiveAlert(raw);
  assert.equal(m.id, 'a1');
  assert.equal(m.event, 'Tornado Warning');
  assert.equal(m.severity, 'extreme');
  assert.equal(m.sent, '2026-06-14T10:00:00Z');
  assert.ok(m.polygon && m.polygon.rings.length === 1);
  assert.equal(m.polygon!.rings[0]!.length, 5);
});

test('adaptLiveAlert synthesizes a circle around centroid when geometry is absent', () => {
  const raw: LiveAlertInput = {
    id: 'a2', event: 'Severe Thunderstorm Warning', severity: 'Severe',
    onset: '2026-06-14T10:00:00Z', expires: '2026-06-14T11:00:00Z',
    centroid: [-86.7, 41.6],
  };
  const m = adaptLiveAlert(raw);
  assert.ok(m.polygon && m.polygon.rings[0]!.length >= 8, 'synthetic ring has several points');
  const lons = m.polygon!.rings[0]!.map((c) => c[0]);
  assert.ok(Math.min(...lons) < -86.7 && Math.max(...lons) > -86.7);
});

test('adaptLiveAlert with neither geometry nor centroid -> no polygon (no_match downstream)', () => {
  const m = adaptLiveAlert({ id: 'a3', event: 'Flood Watch', severity: 'Minor', onset: 'x', expires: 'y' });
  assert.equal(m.polygon, undefined);
});

test('adaptLiveAlert threads + normalizes messageType for isCancellation detection', () => {
  const base = { id: 'm', event: 'Tornado Warning', severity: 'Extreme', onset: 'x', expires: 'y' } as const;
  assert.equal(adaptLiveAlert({ ...base, messageType: 'Cancel' }).messageType, 'cancel');
  assert.equal(adaptLiveAlert({ ...base, messageType: 'Update' }).messageType, 'update');
  assert.equal(adaptLiveAlert({ ...base, messageType: 'Alert' }).messageType, 'alert');
  assert.equal(adaptLiveAlert({ ...base, messageType: 'Ack' }).messageType, 'unknown');
  assert.equal(adaptLiveAlert({ ...base, messageType: null }).messageType, 'unknown');
  assert.equal(adaptLiveAlert(base).messageType, 'unknown');
});
