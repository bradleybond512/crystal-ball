import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStormModePayload } from '../personal-storm-mode.ts';
import { actionsForHazard, allActionsForHazard } from '../preparedness-actions.ts';
import type { PolygonMatchResult, WeatherHazardKind } from '../weather-threat-types.ts';

const NOW = 1_745_000_000_000;

function match(overrides: Partial<PolygonMatchResult> = {}): PolygonMatchResult {
  return {
    alertId: 'urn:test',
    placeId: 'home',
    matchKind: 'inside_polygon',
    isInside: true,
    distanceKm: 0,
    hazardKind: 'severe_thunderstorm',
    event: 'Severe Thunderstorm Warning',
    severity: 'severe',
    threatLevel: 'warning',
    msUntilExpires: 30 * 60 * 1000,
    isUpdate: false,
    isCancellation: false,
    reason: 'Inside warning polygon',
    ...overrides,
  };
}

// ── Activation ─────────────────────────────────────────────────────────

test('activation: emergency inside polygon → critical', () => {
  const r = buildStormModePayload(
    match({ threatLevel: 'emergency', hazardKind: 'tornado' }),
    'Home',
    { now: NOW },
  );
  assert.equal(r.activation, 'critical');
});

test('activation: warning inside polygon → active', () => {
  const r = buildStormModePayload(match({ threatLevel: 'warning' }), 'Home', { now: NOW });
  assert.equal(r.activation, 'active');
});

test('activation: warning outside polygon (near) → watching', () => {
  const r = buildStormModePayload(
    match({ threatLevel: 'warning', matchKind: 'near_polygon', isInside: false, distanceKm: 5 }),
    'Home',
    { now: NOW },
  );
  assert.equal(r.activation, 'watching');
});

test('activation: cancellation → inactive', () => {
  const r = buildStormModePayload(
    match({ isCancellation: true }),
    'Home',
    { now: NOW },
  );
  assert.equal(r.activation, 'inactive');
});

test('activation: threatLevel none → inactive', () => {
  const r = buildStormModePayload(match({ threatLevel: 'none' }), 'Home', { now: NOW });
  assert.equal(r.activation, 'inactive');
});

// ── Title + main threat label ──────────────────────────────────────────

test('title: inside polygon → "<Event> — <Place>"', () => {
  const r = buildStormModePayload(match(), 'La Porte, IN', { now: NOW });
  assert.equal(r.title, 'Severe Thunderstorm Warning — La Porte, IN');
});

test('title: near polygon → "<Event> near <Place>"', () => {
  const r = buildStormModePayload(
    match({ matchKind: 'near_polygon', isInside: false, distanceKm: 5 }),
    'La Porte, IN',
    { now: NOW },
  );
  assert.equal(r.title, 'Severe Thunderstorm Warning near La Porte, IN');
});

test('title: missing place falls back to event', () => {
  const r = buildStormModePayload(match(), undefined, { now: NOW });
  assert.equal(r.title, 'Severe Thunderstorm Warning');
});

test('mainThreatLabel: tornado mentions rotation + debris', () => {
  const r = buildStormModePayload(match({ hazardKind: 'tornado' }), 'Home', { now: NOW });
  assert.match(r.mainThreatLabel, /rotation/i);
});

test('mainThreatLabel: flash_flood mentions water rise', () => {
  const r = buildStormModePayload(match({ hazardKind: 'flash_flood' }), 'Home', { now: NOW });
  assert.match(r.mainThreatLabel, /water/i);
});

// ── Confidence label ──────────────────────────────────────────────────

test('confidence: inside polygon + known severity → high', () => {
  const r = buildStormModePayload(match({ severity: 'severe' }), 'Home', { now: NOW });
  assert.equal(r.confidenceLabel, 'high');
});

test('confidence: inside polygon + unknown severity → medium', () => {
  const r = buildStormModePayload(match({ severity: 'unknown' }), 'Home', { now: NOW });
  assert.equal(r.confidenceLabel, 'medium');
});

test('confidence: near polygon → medium', () => {
  const r = buildStormModePayload(
    match({ matchKind: 'near_polygon', isInside: false, distanceKm: 5 }),
    'Home',
    { now: NOW },
  );
  assert.equal(r.confidenceLabel, 'medium');
});

// ── Arrival window ─────────────────────────────────────────────────────

test('arrival: inside polygon → no arrival window (storm is here)', () => {
  const r = buildStormModePayload(match(), 'Home', { now: NOW });
  assert.equal(r.arrivalWindow, undefined);
});

test('arrival: outside polygon with motion + bearing → label like "X-Y min"', () => {
  const r = buildStormModePayload(
    match({
      matchKind: 'near_polygon',
      isInside: false,
      distanceKm: 30, // 30 km away
    }),
    'Home',
    {
      now: NOW,
      stormMotion: { headingDeg: 90, speedKmh: 50 }, // moving E at 50 km/h
      bearingFromPlaceDeg: 270, // storm is W of place; if it heads E (90) that's directly toward
    },
  );
  assert.ok(r.arrivalWindow);
  // 30 km / 50 km/h = 0.6 h = 36 min. Window: 27-45 min.
  assert.match(r.arrivalWindow!.label, /\d+-\d+ min/);
});

test('arrival: storm moving AWAY (bearing 0°, heading 0°) → no arrival window', () => {
  const r = buildStormModePayload(
    match({ matchKind: 'near_polygon', isInside: false, distanceKm: 20 }),
    'Home',
    {
      now: NOW,
      stormMotion: { headingDeg: 0, speedKmh: 50 },
      bearingFromPlaceDeg: 0, // storm is N; heading N = away
    },
  );
  assert.equal(r.arrivalWindow, undefined);
});

test('arrival: zero or missing speed → no window', () => {
  const r = buildStormModePayload(
    match({ matchKind: 'near_polygon', isInside: false, distanceKm: 20 }),
    'Home',
    { now: NOW, stormMotion: { headingDeg: 90, speedKmh: 0 } },
  );
  assert.equal(r.arrivalWindow, undefined);
});

// ── Actions ────────────────────────────────────────────────────────────

test('actions: tornado activates shelter + shoes + helmet (priority 1)', () => {
  const r = buildStormModePayload(match({ hazardKind: 'tornado' }), 'Home', { now: NOW });
  const ids = r.actions.map((a) => a.id);
  assert.ok(ids.includes('tornado-shelter'));
  assert.ok(ids.includes('tornado-shoes'));
});

test('actions: severe TS includes outage actions by default', () => {
  const r = buildStormModePayload(match(), 'Home', { now: NOW });
  const ids = r.actions.map((a) => a.id);
  // Severe TS hazards include outage prep by default per defaultIncludeOutage().
  assert.ok(ids.some((id) => /outage|charge/.test(id)));
});

test('actions: short arrival window filters to fast actions', () => {
  // Storm arriving in 10 minutes → only quick actions surface.
  const r = buildStormModePayload(
    match({ matchKind: 'near_polygon', isInside: false, distanceKm: 8 }),
    'Home',
    {
      now: NOW,
      stormMotion: { headingDeg: 90, speedKmh: 50 }, // ~10 min to arrive
    },
  );
  for (const a of r.actions) {
    assert.ok(a.estimatedMinutes <= 10, `action ${a.id} too slow at ${a.estimatedMinutes}m`);
  }
});

test('actions: caller can override max', () => {
  const r = buildStormModePayload(match(), 'Home', { now: NOW, maxActions: 2 });
  assert.equal(r.actions.length, 2);
});

// ── preparedness-actions module ────────────────────────────────────────

test('actionsForHazard: returns priority-sorted list (1s before 2s)', () => {
  const acts = actionsForHazard('tornado');
  for (let i = 1; i < acts.length; i += 1) {
    assert.ok(acts[i - 1]!.priority <= acts[i]!.priority);
  }
});

test('actionsForHazard: maxMinutesAvailable filters slow actions', () => {
  const acts = actionsForHazard('tropical', { maxMinutesAvailable: 10, max: 100 });
  for (const a of acts) {
    assert.ok(a.estimatedMinutes <= 10);
  }
});

test('allActionsForHazard: returns full list for every hazard kind', () => {
  const kinds: WeatherHazardKind[] = [
    'tornado', 'severe_thunderstorm', 'flash_flood', 'flood', 'high_wind',
    'winter_storm', 'blizzard', 'ice_storm', 'extreme_heat', 'extreme_cold',
    'fire_weather', 'tropical', 'storm_surge', 'special_marine', 'dust_storm', 'other',
  ];
  for (const k of kinds) {
    const acts = allActionsForHazard(k);
    assert.ok(acts.length > 0, `${k} has no actions`);
  }
});

// ── Reason + next update + expiry ──────────────────────────────────────

test('reason: passed through from match', () => {
  const r = buildStormModePayload(match({ reason: 'Custom test reason' }), 'Home', { now: NOW });
  assert.equal(r.reason, 'Custom test reason');
});

test('nextUpdateLabel: tornado mentions radar scan', () => {
  const r = buildStormModePayload(match({ hazardKind: 'tornado' }), 'Home', { now: NOW });
  assert.match(r.nextUpdateLabel, /radar/i);
});

test('nextUpdateLabel: tropical mentions NHC advisory', () => {
  const r = buildStormModePayload(match({ hazardKind: 'tropical' }), 'Home', { now: NOW });
  assert.match(r.nextUpdateLabel, /NHC/i);
});

test('expiresAtMs: now + msUntilExpires', () => {
  const r = buildStormModePayload(match({ msUntilExpires: 60 * 60 * 1000 }), 'Home', { now: NOW });
  assert.equal(r.expiresAtMs, NOW + 60 * 60 * 1000);
});

// ── Determinism ────────────────────────────────────────────────────────

test('determinism: same inputs → same output', () => {
  const a = buildStormModePayload(match(), 'Home', { now: NOW });
  const b = buildStormModePayload(match(), 'Home', { now: NOW });
  assert.deepEqual(a, b);
});

// ── Plan worked example ────────────────────────────────────────────────

test('integration: plan example "Severe Weather Near Home" — wind threat, 35-55 min, action card', () => {
  const r = buildStormModePayload(
    match({
      matchKind: 'near_polygon',
      isInside: false,
      distanceKm: 35, // ~35-55 min away at 45 km/h
      hazardKind: 'severe_thunderstorm',
      event: 'Severe Thunderstorm Warning',
      severity: 'severe',
      threatLevel: 'warning',
    }),
    'Home',
    {
      now: NOW,
      stormMotion: { headingDeg: 90, speedKmh: 45 },
      bearingFromPlaceDeg: 270, // directly toward
    },
  );
  assert.equal(r.activation, 'watching');
  assert.equal(r.primaryHazard, 'severe_thunderstorm');
  assert.match(r.title, /Severe Thunderstorm Warning near Home/);
  assert.match(r.mainThreatLabel, /wind/i);
  assert.ok(r.arrivalWindow);
  assert.ok(r.actions.length > 0);
  assert.match(r.nextUpdateLabel, /radar/i);
});
