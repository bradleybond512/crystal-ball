// src/services/survival/__tests__/survival-moves.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableMoves, projectMoveEffect } from '../survival-moves.ts';
import { computePosture } from '../survival-posture.ts';
import type { NwsAlertMinimal, AlertPolygon, SavedPlace } from '../../weather/weather-threat-types.ts';
import type { WorldSnapshot } from '../survival-types.ts';

const NOW = 1_700_000_000_000;
const HOME: SavedPlace = { id: 'home', label: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };
function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}
function tornadoSnapshot(): WorldSnapshot {
  const alerts: NwsAlertMinimal[] = [{ id: 'al-t', event: 'Tornado Warning', polygon: around(HOME.lat, HOME.lon), sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() }];
  const freshness = [{ domain: 'weather' as const, fetchedAtMs: NOW - 60_000, ageMs: 60_000, ok: true }];
  const posture = computePosture({ weatherAlerts: alerts, savedPlaces: [HOME], freshness, capturedAtMs: NOW }, { now: NOW });
  return { version: 1, capturedAtMs: NOW, freshness, weatherAlerts: alerts, savedPlaces: [HOME], posture, plan: { committed: [] } };
}

test('no threats -> no moves', () => {
  const snap = tornadoSnapshot();
  const calm = { ...snap, posture: { ...snap.posture, axes: snap.posture.axes.map((a) => ({ ...a, threats: [], level: 0, band: 'secure' as const })) } };
  assert.deepEqual(availableMoves(calm.posture, calm, { now: NOW }), []);
});

test('tornado threat -> moves that affect physical_safety with negative (improving) effect', () => {
  const snap = tornadoSnapshot();
  const moves = availableMoves(snap.posture, snap, { now: NOW });
  assert.ok(moves.length >= 1);
  assert.ok(moves.every((m) => m.affects.includes('physical_safety')));
  const top = moves[0]!;
  const effect = projectMoveEffect(top, snap.posture);
  assert.ok(effect.some((d) => d.axis === 'physical_safety' && d.deltaLevel < 0));
  assert.ok(top.playbookRef);
});
