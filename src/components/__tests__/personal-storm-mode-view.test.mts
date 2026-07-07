import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MEANINGFUL_DISTANCE_DELTA_KM,
  STORM_MODE_UI_STORAGE_KEY,
  ackRecordFor,
  computeStormModeVisibility,
  emptyStormModeUiState,
  meaningfulChangeSinceAck,
  nextVisibilityTransitionAt,
  parseStormModeUiState,
  pruneStormModeUiState,
  serializeStormModeUiState,
  snoozeRecordFor,
  stormMetaPairs,
  stormStripTitle,
  stormTierLabel,
  withAck,
  withSnooze,
  type StormModeUiState,
} from '../personal-storm-mode-view.ts';
import { routeWeatherAlert, type WeatherDispatchDecision } from '@/services/weather/weather-warning-router';
import type { AlertPolygon, NwsAlertMinimal, SavedPlace } from '@/services/weather/weather-threat-types';

const NOW = 1_745_000_000_000;

const HOME: SavedPlace = {
  id: 'home',
  label: 'Home',
  lat: 41.610,
  lon: -86.722,
  radiusKm: 25,
};

/** Polygon that contains HOME. */
const ENVELOPING: AlertPolygon = {
  rings: [[
    [-87.0, 41.50],
    [-86.50, 41.50],
    [-86.50, 41.80],
    [-87.0, 41.80],
    [-87.0, 41.50],
  ]],
};

/** Polygon east of HOME — outside but within the 25 km near-buffer. */
const NEARBY: AlertPolygon = {
  rings: [[
    [-86.60, 41.50],
    [-86.30, 41.50],
    [-86.30, 41.80],
    [-86.60, 41.80],
    [-86.60, 41.50],
  ]],
};

function alert(overrides: Partial<NwsAlertMinimal> = {}): NwsAlertMinimal {
  return {
    // High Wind Warning inside polygon → threat 'warning' (high_wind is
    // not a HIGH_RISK hazard, so it doesn't jump to 'emergency'),
    // priority persistent_critical → payload built.
    id: 'urn:test-alert',
    event: 'High Wind Warning',
    polygon: ENVELOPING,
    sent: new Date(NOW - 5 * 60 * 1000).toISOString(),
    expires: new Date(NOW + 30 * 60 * 1000).toISOString(),
    severity: 'severe',
    messageType: 'alert',
    ...overrides,
  };
}

function insideDecision(overrides: Partial<NwsAlertMinimal> = {}): WeatherDispatchDecision {
  return routeWeatherAlert(alert(overrides), [HOME], { now: NOW });
}

/** Severe TS warning whose polygon is east of HOME → near_polygon match,
 *  threat 'warning' (high-risk hazard outside polygon), priority 'banner'
 *  → payload built with a distance. */
function nearbyDecision(overrides: Partial<NwsAlertMinimal> = {}): WeatherDispatchDecision {
  return routeWeatherAlert(
    alert({ polygon: NEARBY, event: 'Severe Thunderstorm Warning', ...overrides }),
    [HOME],
    { now: NOW },
  );
}

// ── Persistence shape ────────────────────────────────────────────────────

test('storage key uses crystalball-* naming', () => {
  assert.match(STORM_MODE_UI_STORAGE_KEY, /^crystalball-/);
});

test('parse: null / garbage / wrong shapes degrade to empty state', () => {
  assert.deepEqual(parseStormModeUiState(null), emptyStormModeUiState());
  assert.deepEqual(parseStormModeUiState('not json {'), emptyStormModeUiState());
  assert.deepEqual(parseStormModeUiState('42'), emptyStormModeUiState());
  assert.deepEqual(parseStormModeUiState('{"acks": "nope", "snoozes": 3}'), emptyStormModeUiState());
});

test('parse: filters malformed records but keeps valid ones', () => {
  const state: StormModeUiState = {
    acks: [{ alertId: 'a1', threatLevel: 'warning', wasInside: true, ackedAt: NOW, expiresAtMs: NOW + 1000 }],
    snoozes: [{ alertId: 'a1', untilMs: NOW + 1000 }],
  };
  const withJunk = JSON.parse(serializeStormModeUiState(state)) as { acks: unknown[]; snoozes: unknown[] };
  withJunk.acks.push({ alertId: 42 }, null, { alertId: 'a2', threatLevel: 'bogus', wasInside: true, ackedAt: NOW });
  withJunk.snoozes.push('nope', { alertId: 'a2' });
  const parsed = parseStormModeUiState(JSON.stringify(withJunk));
  assert.deepEqual(parsed, state);
});

test('serialize → parse round-trip preserves records', () => {
  const state: StormModeUiState = {
    acks: [{ alertId: 'a1', threatLevel: 'emergency', wasInside: false, distanceKm: 12.5, ackedAt: NOW, expiresAtMs: NOW + 60_000 }],
    snoozes: [{ alertId: 'a2', untilMs: NOW + 15 * 60_000 }],
  };
  assert.deepEqual(parseStormModeUiState(serializeStormModeUiState(state)), state);
});

test('prune: drops expired snoozes and expired acks, keeps live ones', () => {
  const state: StormModeUiState = {
    acks: [
      { alertId: 'live', threatLevel: 'warning', wasInside: true, ackedAt: NOW, expiresAtMs: NOW + 1000 },
      { alertId: 'expired', threatLevel: 'warning', wasInside: true, ackedAt: NOW - 5000, expiresAtMs: NOW - 1 },
      // No expiry recorded → falls back to the 12h max-age window.
      { alertId: 'old-no-expiry', threatLevel: 'warning', wasInside: true, ackedAt: NOW - 13 * 60 * 60 * 1000 },
    ],
    snoozes: [
      { alertId: 'live', untilMs: NOW + 1 },
      { alertId: 'done', untilMs: NOW },
    ],
  };
  const pruned = pruneStormModeUiState(state, NOW);
  assert.deepEqual(pruned.acks.map((a) => a.alertId), ['live']);
  assert.deepEqual(pruned.snoozes.map((s) => s.alertId), ['live']);
});

// ── Ack / snooze record builders ─────────────────────────────────────────

test('ackRecordFor snapshots threat level, inside flag, and expiry', () => {
  const decision = insideDecision();
  const ack = ackRecordFor(decision, NOW)!;
  assert.equal(ack.alertId, decision.alertId);
  assert.equal(ack.threatLevel, 'warning');
  assert.equal(ack.wasInside, true);
  assert.equal(ack.ackedAt, NOW);
  assert.equal(ack.expiresAtMs, decision.payload!.expiresAtMs);
});

test('snoozeRecordFor sets the wake time from minutes', () => {
  const decision = insideDecision();
  const snooze = snoozeRecordFor(decision, 15, NOW);
  assert.equal(snooze.untilMs, NOW + 15 * 60_000);
});

test('withAck replaces an earlier ack for the same alert', () => {
  const decision = insideDecision();
  const first = ackRecordFor(decision, NOW)!;
  const second = ackRecordFor(decision, NOW + 1000)!;
  const state = withAck(withAck(emptyStormModeUiState(), first), second);
  assert.equal(state.acks.length, 1);
  assert.equal(state.acks[0]!.ackedAt, NOW + 1000);
});

test('withSnooze replaces an earlier snooze for the same alert', () => {
  const decision = insideDecision();
  const state = withSnooze(
    withSnooze(emptyStormModeUiState(), snoozeRecordFor(decision, 15, NOW)),
    snoozeRecordFor(decision, 15, NOW + 1000),
  );
  assert.equal(state.snoozes.length, 1);
  assert.equal(state.snoozes[0]!.untilMs, NOW + 1000 + 15 * 60_000);
});

// ── Meaningful change (mirrors weather-urgency repeat suppression) ──────

test('meaningful change: threat escalation past the acked tier resurfaces', () => {
  const acked = ackRecordFor(insideDecision(), NOW)!; // warning tier
  assert.equal(acked.threatLevel, 'warning');
  const escalated = insideDecision({ event: 'Tornado Warning', severity: 'extreme' }); // emergency tier
  assert.equal(escalated.match!.threatLevel, 'emergency');
  assert.equal(meaningfulChangeSinceAck(acked, escalated), true);
});

test('meaningful change: outside → inside polygon resurfaces (same tier)', () => {
  const inside = insideDecision(); // warning tier, inside polygon
  // Same tier at ack time, but the place was outside the polygon then.
  const acked = { ...ackRecordFor(inside, NOW)!, wasInside: false, distanceKm: 8 };
  assert.equal(meaningfulChangeSinceAck(acked, inside), true);
});

test(`meaningful change: polygon edge >= ${MEANINGFUL_DISTANCE_DELTA_KM} km closer resurfaces, smaller shifts stay acked`, () => {
  const near = nearbyDecision();
  const baseDistance = near.match!.distanceKm!;
  assert.ok(baseDistance > 0);
  const acked = { ...ackRecordFor(near, NOW)!, distanceKm: baseDistance + MEANINGFUL_DISTANCE_DELTA_KM };
  assert.equal(meaningfulChangeSinceAck(acked, near), true);
  const ackedClose = { ...acked, distanceKm: baseDistance + MEANINGFUL_DISTANCE_DELTA_KM - 1 };
  assert.equal(meaningfulChangeSinceAck(ackedClose, near), false);
});

test('meaningful change: unchanged decision does not resurface', () => {
  const decision = insideDecision();
  const acked = ackRecordFor(decision, NOW)!;
  assert.equal(meaningfulChangeSinceAck(acked, decision), false);
});

// ── Visibility ──────────────────────────────────────────────────────────

test('visible: warning inside polygon with payload shows the strip', () => {
  const v = computeStormModeVisibility(insideDecision(), emptyStormModeUiState(), NOW);
  assert.deepEqual(v, { visible: true });
});

test('hidden: no decision / suppressed decision', () => {
  assert.deepEqual(
    computeStormModeVisibility(undefined, emptyStormModeUiState(), NOW),
    { visible: false, reason: 'no_decision' },
  );
  const suppressed = routeWeatherAlert(alert(), [], { now: NOW }); // no saved places
  assert.deepEqual(
    computeStormModeVisibility(suppressed, emptyStormModeUiState(), NOW),
    { visible: false, reason: 'suppressed' },
  );
});

test('hidden: payload-less decision (watch tier) never activates the strip', () => {
  const watch = insideDecision({ event: 'Severe Thunderstorm Watch', severity: 'moderate' });
  assert.equal(watch.payload, undefined);
  assert.deepEqual(
    computeStormModeVisibility(watch, emptyStormModeUiState(), NOW),
    { visible: false, reason: 'no_payload' },
  );
});

test('hidden: strip clears once the alert expires', () => {
  const decision = insideDecision();
  const afterExpiry = decision.payload!.expiresAtMs;
  assert.deepEqual(
    computeStormModeVisibility(decision, emptyStormModeUiState(), afterExpiry),
    { visible: false, reason: 'expired' },
  );
});

test('hidden while snoozed, visible again after the snooze ends', () => {
  const decision = insideDecision();
  const state = withSnooze(emptyStormModeUiState(), snoozeRecordFor(decision, 15, NOW));
  assert.deepEqual(
    computeStormModeVisibility(decision, state, NOW + 1),
    { visible: false, reason: 'snoozed' },
  );
  assert.deepEqual(
    computeStormModeVisibility(decision, state, NOW + 15 * 60_000 + 1),
    { visible: true },
  );
});

test('acknowledged threat stays hidden until it materially changes', () => {
  const decision = insideDecision();
  const state = withAck(emptyStormModeUiState(), ackRecordFor(decision, NOW)!);
  assert.deepEqual(
    computeStormModeVisibility(decision, state, NOW + 1),
    { visible: false, reason: 'acknowledged' },
  );
  const escalated = insideDecision({ event: 'Tornado Warning', severity: 'extreme' });
  assert.equal(escalated.alertId, decision.alertId);
  assert.deepEqual(computeStormModeVisibility(escalated, state, NOW + 1), { visible: true });
});

test('nextVisibilityTransitionAt: expiry when visible, snooze end when snoozed', () => {
  const decision = insideDecision();
  assert.equal(
    nextVisibilityTransitionAt(decision, emptyStormModeUiState(), NOW),
    decision.payload!.expiresAtMs,
  );
  const snoozed = withSnooze(emptyStormModeUiState(), snoozeRecordFor(decision, 15, NOW));
  assert.equal(nextVisibilityTransitionAt(decision, snoozed, NOW + 1), NOW + 15 * 60_000);
  const acked = withAck(emptyStormModeUiState(), ackRecordFor(decision, NOW)!);
  assert.equal(nextVisibilityTransitionAt(decision, acked, NOW + 1), undefined);
});

// ── Display strings ──────────────────────────────────────────────────────

test('tier label reflects the threat level', () => {
  assert.equal(stormTierLabel(insideDecision()), 'WARNING');
  assert.equal(stormTierLabel(insideDecision({ event: 'Tornado Warning', severity: 'extreme' })), 'EMERGENCY');
});

test('strip title puts the primary hazard first, then the place', () => {
  const inside = stormStripTitle(insideDecision());
  assert.equal(inside, 'Damaging wind at Home');
  const near = stormStripTitle(nearbyDecision());
  assert.equal(near, 'Damaging wind + large hail near Home');
});

test('meta pairs: main threat first; place, confidence, next update present', () => {
  const pairs = stormMetaPairs(insideDecision());
  assert.equal(pairs[0]!.label, 'Main threat');
  assert.equal(pairs[0]!.value, 'Damaging wind');
  const labels = pairs.map((p) => p.label);
  assert.ok(labels.includes('Place'));
  assert.ok(labels.includes('Confidence'));
  assert.ok(labels.includes('Next update'));
  // Inside the polygon → no distance row.
  assert.ok(!labels.includes('Distance'));
});

test('meta pairs: outside the polygon includes the distance row', () => {
  const pairs = stormMetaPairs(nearbyDecision());
  const distance = pairs.find((p) => p.label === 'Distance');
  assert.ok(distance, 'expected a Distance row for a near-polygon match');
  assert.match(distance!.value, /^\d+(\.\d)? km from warned area$/);
});
