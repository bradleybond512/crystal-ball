// src/services/survival/__tests__/world-snapshot.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, serializeSnapshot, deserializeSnapshot, projectView, SNAPSHOT_VERSION } from '../world-snapshot.ts';
import { computePosture } from '../survival-posture.ts';
import { availableMoves } from '../survival-moves.ts';
import { commitMove, emptyPlan } from '../survival-plan.ts';
import type { NwsAlertMinimal, AlertPolygon, SavedPlace } from '../../weather/weather-threat-types.ts';

const NOW = 1_700_000_000_000;
const HOME: SavedPlace = { id: 'home', label: 'Home', lat: 41.6, lon: -86.7, radiusKm: 25 };
function around(lat: number, lon: number): AlertPolygon {
  const d = 0.2;
  return { rings: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] };
}
const ALERTS: NwsAlertMinimal[] = [{ id: 'al-t', event: 'Tornado Warning', polygon: around(HOME.lat, HOME.lon), sent: new Date(NOW - 60_000).toISOString(), expires: new Date(NOW + 3_600_000).toISOString() }];

test('buildSnapshot computes posture and stamps version + freshness', () => {
  const snap = buildSnapshot({ weatherAlerts: ALERTS, savedPlaces: [HOME], weatherFetchedAtMs: NOW - 60_000 }, { now: NOW });
  assert.equal(snap.version, SNAPSHOT_VERSION);
  assert.equal(snap.posture.worstAxis, 'physical_safety');
  assert.equal(snap.posture.overallBand, 'critical');
  assert.equal(snap.freshness[0]!.ok, true);
});

test('GRID-DOWN: serialize -> deserialize -> project yields full posture with no live inputs', () => {
  const online = buildSnapshot({ weatherAlerts: ALERTS, savedPlaces: [HOME], weatherFetchedAtMs: NOW - 60_000 }, { now: NOW });
  const bytes = serializeSnapshot(online);
  // Simulate cold start hours later with NO network: only the bytes survive.
  const offline = deserializeSnapshot(bytes);
  const view = projectView(offline, { now: NOW + 3 * 3_600_000 });
  assert.equal(view.posture.overallBand, 'critical');
  assert.equal(view.posture.worstAxis, 'physical_safety');
  assert.equal(view.isStale, true); // 3h old > 15min threshold
  assert.ok(view.weatherAgeMs >= 3 * 3_600_000);
  assert.equal(view.worstAxisLabel, 'Physical safety');
  assert.ok(view.posture.staleInputs.some((s) => s.includes('weather')), 'projected stale snapshot must surface stale weather input');
});

test('recomputing posture from the deserialized snapshot equals the stored posture', () => {
  const online = buildSnapshot({ weatherAlerts: ALERTS, savedPlaces: [HOME], weatherFetchedAtMs: NOW - 60_000 }, { now: NOW });
  const offline = deserializeSnapshot(serializeSnapshot(online));
  const recomputed = computePosture(offline, { now: NOW });
  assert.equal(recomputed.overallLevel, online.posture.overallLevel);
  assert.equal(recomputed.worstAxis, online.posture.worstAxis);
});

test('deserialize rejects an unknown version', () => {
  assert.throws(() => deserializeSnapshot(JSON.stringify({ version: 999 })), /Unsupported snapshot version/);
});

test('buildSnapshot applies a committed plan so the persisted posture is mitigated', () => {
  const base = buildSnapshot({ weatherAlerts: ALERTS, savedPlaces: [HOME], weatherFetchedAtMs: NOW - 60_000 }, { now: NOW });
  const moves = availableMoves(base.posture, base, { now: NOW });
  assert.ok(moves.length >= 2);
  const plan = commitMove(commitMove(emptyPlan(), moves[0]!, NOW), moves[1]!, NOW);
  const withPlan = buildSnapshot({ weatherAlerts: ALERTS, savedPlaces: [HOME], weatherFetchedAtMs: NOW - 60_000, plan }, { now: NOW });
  assert.ok(withPlan.posture.overallLevel < base.posture.overallLevel, 'committed plan should lower the persisted posture');
});
