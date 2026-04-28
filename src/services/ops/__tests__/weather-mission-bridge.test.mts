/**
 * Coverage for `weather-mission-bridge.ts` — verifies that:
 *   - A matched alert opens one mission with origin algorithm tag.
 *   - app_watch fires once per mission, even on re-routes.
 *   - user_notified fires only when urgency was set and not suppressed.
 *   - no_match / suppressed alerts do NOT open a mission.
 *   - Mission id is stable across re-routes (same alertId + placeId →
 *     same missionId).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { bridgeWeatherDecisionToMission, legacyAlertToNwsMinimal, routeAndBridgeWeatherAlerts } from '../weather-mission-bridge.ts';
import { getMissionLedger, resetMissionState } from '../mission-state.ts';
import { routeWeatherAlert } from '@/services/weather/weather-warning-router';
import type { AlertPolygon, NwsAlertMinimal, SavedPlace } from '@/services/weather/weather-threat-types';

const NOW = 1_745_000_000_000;

const HOME: SavedPlace = { id: 'home', label: 'La Porte, IN', lat: 41.610, lon: -86.722 };

const ENVELOPING: AlertPolygon = {
  rings: [[
    [-87.0, 41.50], [-86.50, 41.50], [-86.50, 41.80], [-87.0, 41.80], [-87.0, 41.50],
  ]],
};

const FAR: AlertPolygon = {
  rings: [[
    [-83.5, 42.0], [-83.0, 42.0], [-83.0, 42.5], [-83.5, 42.5], [-83.5, 42.0],
  ]],
};

function alert(overrides: Partial<NwsAlertMinimal> = {}): NwsAlertMinimal {
  return {
    id: 'urn:test',
    event: 'Severe Thunderstorm Warning',
    polygon: ENVELOPING,
    sent: new Date(NOW - 5 * 60 * 1000).toISOString(),
    expires: new Date(NOW + 30 * 60 * 1000).toISOString(),
    severity: 'severe',
    messageType: 'alert',
    ...overrides,
  };
}

test.beforeEach(() => resetMissionState());

test('matched alert opens one mission tagged with origin algorithm + place + factId', () => {
  const decision = routeWeatherAlert(alert(), [HOME], { now: NOW });
  const result = bridgeWeatherDecisionToMission(decision, { now: NOW });
  assert.ok(result, 'bridge should return a mission record');
  const mission = result!.mission;
  assert.equal(mission.domain, 'weather_safety');
  assert.equal(mission.placeId, 'home');
  assert.equal(mission.factId, 'urn:test');
  assert.equal(mission.originAlgorithmId, 'weather-urgency');
  assert.equal(mission.status, 'active');
});

test('matched alert appends app_watch + user_notified events', () => {
  const decision = routeWeatherAlert(alert(), [HOME], { now: NOW });
  const result = bridgeWeatherDecisionToMission(decision, { now: NOW });
  const kinds = result!.mission.events.map((e) => e.kind).sort();
  assert.ok(kinds.includes('app_watch'));
  assert.ok(kinds.includes('user_notified'));
});

test('re-routing the same alert does NOT duplicate app_watch', () => {
  const decision1 = routeWeatherAlert(alert(), [HOME], { now: NOW });
  bridgeWeatherDecisionToMission(decision1, { now: NOW });
  const decision2 = routeWeatherAlert(alert(), [HOME], { now: NOW + 60_000 });
  const result2 = bridgeWeatherDecisionToMission(decision2, { now: NOW + 60_000 });
  const watchCount = result2!.mission.events.filter((e) => e.kind === 'app_watch').length;
  assert.equal(watchCount, 1, 'app_watch must only fire once per mission');
});

test('re-routing the same alert MAY append a new user_notified (e.g. escalation)', () => {
  const decision1 = routeWeatherAlert(alert(), [HOME], { now: NOW });
  bridgeWeatherDecisionToMission(decision1, { now: NOW });
  const decision2 = routeWeatherAlert(alert(), [HOME], { now: NOW + 60_000 });
  const result2 = bridgeWeatherDecisionToMission(decision2, { now: NOW + 60_000 });
  const notifyCount = result2!.mission.events.filter((e) => e.kind === 'user_notified').length;
  // Two routings → two notifies (the dispatcher itself dedupes via
  // previousDelivery; the bridge is faithful to the decisions it sees).
  assert.equal(notifyCount, 2);
});

test('no_match alert does NOT open a mission', () => {
  const decision = routeWeatherAlert(alert({ polygon: FAR }), [HOME], { now: NOW });
  const result = bridgeWeatherDecisionToMission(decision, { now: NOW });
  assert.equal(result, undefined);
  assert.equal(getMissionLedger().all().length, 0);
});

test('mission id is stable across re-routes (same alert + place → same id)', () => {
  const decision1 = routeWeatherAlert(alert(), [HOME], { now: NOW });
  const r1 = bridgeWeatherDecisionToMission(decision1, { now: NOW });
  const decision2 = routeWeatherAlert(alert(), [HOME], { now: NOW + 60_000 });
  const r2 = bridgeWeatherDecisionToMission(decision2, { now: NOW + 60_000 });
  assert.equal(r1!.mission.id, r2!.mission.id);
});

test('mission id includes alertId + placeId so two places see two missions for the same alert', () => {
  const office: SavedPlace = { id: 'office', label: 'Office', lat: 41.61, lon: -86.72 };
  const decisionHome = routeWeatherAlert(alert(), [HOME], { now: NOW });
  const decisionOffice = routeWeatherAlert(alert(), [office], { now: NOW });
  bridgeWeatherDecisionToMission(decisionHome, { now: NOW });
  bridgeWeatherDecisionToMission(decisionOffice, { now: NOW });
  const all = getMissionLedger().all();
  assert.equal(all.length, 2);
  const placeIds = all.map((m) => m.placeId).sort();
  assert.deepEqual(placeIds, ['home', 'office']);
});

test('suppressed decision (e.g. quiet hours blocks non-bypass hazard) does NOT open a mission', () => {
  // Winter Storm Warning is non-bypass + quiet hours active + bypass off
  // → router returns shouldSuppress: true. The bridge must respect that
  // contract; otherwise we'd record warnings the user never saw.
  const decision = routeWeatherAlert(
    alert({ event: 'Winter Storm Warning', severity: 'moderate' }),
    [HOME],
    { now: NOW, quietHoursActive: true, quietHoursBypassEnabled: false },
  );
  assert.equal(decision.shouldSuppress, true);
  assert.notEqual(decision.match!.matchKind, 'no_match', 'sanity: it WAS a real match');
  const result = bridgeWeatherDecisionToMission(decision, { now: NOW });
  assert.equal(result, undefined, 'suppressed → no mission opened');
  assert.equal(getMissionLedger().all().length, 0);
});

test('digest-tier alert opens mission (app_watch) but does NOT record user_notified', () => {
  // Wind Advisory → priority 'digest' → queued for next morning/evening
  // digest, NOT delivered now. user_notified must wait for digest render.
  const decision = routeWeatherAlert(
    alert({ event: 'Wind Advisory', severity: 'minor' }),
    [HOME],
    { now: NOW },
  );
  assert.equal(decision.urgency!.priority, 'digest');
  assert.equal(decision.shouldSuppress, false, 'digest is NOT a suppression');
  const result = bridgeWeatherDecisionToMission(decision, { now: NOW });
  assert.ok(result, 'digest alert still opens an active mission');
  const kinds = result!.mission.events.map((e) => e.kind).sort();
  assert.ok(kinds.includes('app_watch'));
  assert.ok(!kinds.includes('user_notified'),
    'digest-tier user_notified should be deferred to digest-render time');
});

// ── Adapter + production orchestrator ──────────────────────────────────

test('legacyAlertToNwsMinimal: lowercases severity + wraps single ring', () => {
  const minimal = legacyAlertToNwsMinimal({
    id: 'urn:legacy',
    event: 'Severe Thunderstorm Warning',
    severity: 'Severe',
    onset: new Date(NOW),
    expires: new Date(NOW + 60_000),
    coordinates: [
      [-87.0, 41.50], [-86.50, 41.50], [-86.50, 41.80], [-87.0, 41.80], [-87.0, 41.50],
    ],
  });
  assert.equal(minimal.severity, 'severe');
  assert.equal(minimal.polygon!.rings.length, 1);
  assert.equal(minimal.polygon!.rings[0]!.length, 5);
  assert.equal(minimal.messageType, 'alert');
});

test('legacyAlertToNwsMinimal: missing/short coordinates → no polygon (zone fallback)', () => {
  const minimal = legacyAlertToNwsMinimal({
    id: 'urn:no-poly',
    event: 'Wind Advisory',
    severity: 'Minor',
    onset: new Date(NOW),
    expires: new Date(NOW + 60_000),
  });
  assert.equal(minimal.polygon, undefined);
});

test('routeAndBridgeWeatherAlerts: opens missions for matched alerts only', () => {
  resetMissionState();
  const places = [{ placeId: 'home', label: 'La Porte, IN', latitude: 41.610, longitude: -86.722 }];
  const matched = {
    id: 'urn:matched',
    event: 'Severe Thunderstorm Warning',
    severity: 'Severe' as const,
    onset: new Date(NOW),
    expires: new Date(NOW + 30 * 60_000),
    coordinates: ENVELOPING.rings[0]!.map(([lng, lat]) => [lng, lat] as [number, number]),
  };
  const farAway = {
    id: 'urn:far',
    event: 'Severe Thunderstorm Warning',
    severity: 'Severe' as const,
    onset: new Date(NOW),
    expires: new Date(NOW + 30 * 60_000),
    coordinates: FAR.rings[0]!.map(([lng, lat]) => [lng, lat] as [number, number]),
  };
  const results = routeAndBridgeWeatherAlerts([matched, farAway], places, { now: NOW });
  assert.equal(results.length, 1, 'far alert is dropped (no matched place)');
  assert.equal(results[0]!.alertId, 'urn:matched');
  assert.equal(results[0]!.placeId, 'home');
  assert.ok(results[0]!.mission, 'matched alert opened a mission');
  assert.equal(getMissionLedger().all().length, 1);
});

test('bridge is JSON-serializable (audit-trail invariant)', () => {
  const decision = routeWeatherAlert(alert(), [HOME], { now: NOW });
  bridgeWeatherDecisionToMission(decision, { now: NOW });
  const snapshot = getMissionLedger().toJson();
  // JSON.stringify drops undefined-valued fields; serialize both
  // sides and compare to confirm the data round-trips losslessly.
  const round = JSON.parse(JSON.stringify(snapshot));
  assert.equal(JSON.stringify(round), JSON.stringify(snapshot));
});
