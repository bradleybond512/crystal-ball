import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPersonalLens,
  axisForDomain,
  lensTint,
} from '../personal-lens.ts';
import type { SurvivalAxis, SurvivalPosture, AxisState } from '../survival-types.ts';
import type { IncomingEvent, PersonalProfile } from '../../personal/personal-impact.ts';

const NOW = 1_700_000_000_000;
const clock = () => NOW;

const EMPTY_PROFILE: PersonalProfile = {
  savedPlaces: [], watchedEntities: [], portfolio: [], travelRoutes: [], utilities: [],
};

function posture(levels: Partial<Record<SurvivalAxis, number>>): SurvivalPosture {
  const axes = Object.entries(levels).map(([axis, level]) => ({ axis, level } as AxisState));
  return { axes, overallLevel: 0, overallBand: 'secure', worstAxis: 'physical_safety', headline: '', capturedAtMs: NOW, staleInputs: [] } as SurvivalPosture;
}

function event(over: Partial<IncomingEvent> = {}): IncomingEvent {
  return { eventId: 'e1', description: 'x', domain: 'weather', severity: 50, at: NOW, ...over };
}

// ── axisForDomain ─────────────────────────────────────────────────────────────

test('axisForDomain maps known domains and is case/whitespace-insensitive', () => {
  assert.equal(axisForDomain('weather'), 'physical_safety');
  assert.equal(axisForDomain('Market'), 'financial');
  assert.equal(axisForDomain(' CYBER '), 'security');
  assert.equal(axisForDomain('disease'), 'health');
  assert.equal(axisForDomain('internet'), 'comms');
  assert.equal(axisForDomain('grid'), 'energy_water');
  assert.equal(axisForDomain('shipping'), 'mobility');
  assert.equal(axisForDomain('shortage'), 'supply');
});

test('axisForDomain falls back to physical_safety for unknown domains', () => {
  assert.equal(axisForDomain('quux'), 'physical_safety');
});

// ── lensTint ──────────────────────────────────────────────────────────────────

test('lensTint: core is opaque + labeled + top priority; background fades', () => {
  assert.deepEqual(lensTint('core'), { opacity: 1, priority: 3, labeled: true });
  const bg = lensTint('background');
  assert.ok(bg.opacity < 0.5 && bg.labeled === false && bg.priority === 0);
  // Opacity and priority are monotonic across tiers.
  assert.ok(lensTint('core').opacity > lensTint('elevated').opacity);
  assert.ok(lensTint('elevated').opacity > lensTint('ambient').opacity);
  assert.ok(lensTint('ambient').opacity > lensTint('background').opacity);
});

// ── applyPersonalLens: structure ──────────────────────────────────────────────

test('empty events → empty views', () => {
  assert.deepEqual(applyPersonalLens([], EMPTY_PROFILE, posture({}), { now: clock }), []);
});

test('every event gets exactly one view (nothing silently dropped)', () => {
  const events = [event({ eventId: 'a' }), event({ eventId: 'b' }), event({ eventId: 'c' })];
  const views = applyPersonalLens(events, EMPTY_PROFILE, posture({}), { now: clock });
  assert.equal(views.length, 3);
  assert.deepEqual([...views.map((v) => v.eventId)].sort(), ['a', 'b', 'c']);
});

test('each view carries the survival axis its domain maps to', () => {
  const [v] = applyPersonalLens([event({ domain: 'market' })], EMPTY_PROFILE, posture({}), { now: clock });
  assert.equal(v!.axis, 'financial');
});

// ── applyPersonalLens: dimension isolation via weight overrides ────────────────

test('axis-heat dimension: weights={axisHeat:1} → relevance equals axis level/100', () => {
  const [v] = applyPersonalLens(
    [event({ domain: 'market', severity: 0 })],
    EMPTY_PROFILE,
    posture({ financial: 60 }),
    { now: clock, weights: { personal: 0, axisHeat: 1, severity: 0 } },
  );
  assert.ok(Math.abs(v!.relevance - 0.6) < 1e-9);
  assert.equal(v!.tier, 'elevated'); // 0.6 → [0.45,0.7)
});

test('severity dimension: weights={severity:1} → relevance equals event.severity/100', () => {
  const [v] = applyPersonalLens(
    [event({ domain: 'weather', severity: 80 })],
    EMPTY_PROFILE,
    posture({}),
    { now: clock, weights: { personal: 0, axisHeat: 0, severity: 1 } },
  );
  assert.ok(Math.abs(v!.relevance - 0.8) < 1e-9);
  assert.equal(v!.tier, 'core'); // 0.8 → >=0.7
});

test('severity is clamped to [0,1] (out-of-range input does not break scoring)', () => {
  const [hi] = applyPersonalLens([event({ severity: 900 })], EMPTY_PROFILE, posture({}),
    { now: clock, weights: { personal: 0, axisHeat: 0, severity: 1 } });
  assert.equal(hi!.relevance, 1);
  const [lo] = applyPersonalLens([event({ severity: -50 })], EMPTY_PROFILE, posture({}),
    { now: clock, weights: { personal: 0, axisHeat: 0, severity: 1 } });
  assert.equal(lo!.relevance, 0);
  assert.equal(lo!.tier, 'background');
});

test('a hot axis lifts relevance vs a cold axis for the same event', () => {
  const ev = [event({ domain: 'market', severity: 30 })];
  const [hot] = applyPersonalLens(ev, EMPTY_PROFILE, posture({ financial: 95 }), { now: clock });
  const [cold] = applyPersonalLens(ev, EMPTY_PROFILE, posture({ financial: 0 }), { now: clock });
  assert.ok(hot!.relevance > cold!.relevance);
});

test('personal dimension is severity-independent (no double-counting of severity)', () => {
  const profile: PersonalProfile = {
    ...EMPTY_PROFILE,
    savedPlaces: [{ placeId: 'home', label: 'Home', latitude: 41.6, longitude: -86.7, role: 'home' }],
  };
  const loc = { latitude: 41.6, longitude: -86.7, radiusKm: 25 };
  // Same exposure category (weather at home), different raw severities. With
  // weights isolated to the personal dimension, relevance must be identical —
  // proving the personal weight keys off category, not severity.
  const mild = applyPersonalLens([event({ eventId: 'm', severity: 20, location: loc })], profile, posture({}),
    { now: clock, weights: { personal: 1, axisHeat: 0, severity: 0 } });
  const severe = applyPersonalLens([event({ eventId: 's', severity: 95, location: loc })], profile, posture({}),
    { now: clock, weights: { personal: 1, axisHeat: 0, severity: 0 } });
  assert.equal(mild[0]!.relevance, severe[0]!.relevance);
  assert.ok(mild[0]!.relevance > 0); // exposure did register
});

test('a personally-exposed event outranks an identical remote one', () => {
  const profile: PersonalProfile = {
    ...EMPTY_PROFILE,
    savedPlaces: [{ placeId: 'home', label: 'Home', latitude: 41.6, longitude: -86.7, role: 'home' }],
  };
  const near = event({ eventId: 'near', severity: 70, location: { latitude: 41.6, longitude: -86.7, radiusKm: 25 } });
  const far = event({ eventId: 'far', severity: 70, location: { latitude: -33.9, longitude: 151.2, radiusKm: 25 } });
  const views = applyPersonalLens([near, far], profile, posture({}), { now: clock });
  const nearV = views.find((v) => v.eventId === 'near')!;
  const farV = views.find((v) => v.eventId === 'far')!;
  assert.ok(nearV.relevance > farV.relevance);
});

// ── applyPersonalLens: sort + drivers ─────────────────────────────────────────

test('views are sorted by relevance desc, ties broken by eventId', () => {
  const events = [
    event({ eventId: 'z', domain: 'market', severity: 10 }),
    event({ eventId: 'a', domain: 'market', severity: 10 }),
    event({ eventId: 'big', domain: 'market', severity: 100 }),
  ];
  const views = applyPersonalLens(events, EMPTY_PROFILE, posture({ financial: 0 }),
    { now: clock, weights: { personal: 0, axisHeat: 0, severity: 1 } });
  assert.equal(views[0]!.eventId, 'big');
  // 'a' before 'z' among the equal-relevance pair.
  assert.deepEqual(views.slice(1).map((v) => v.eventId), ['a', 'z']);
});

test('drivers explain axis heat and high severity, with an ambient fallback', () => {
  const [hot] = applyPersonalLens([event({ domain: 'market', severity: 80 })], EMPTY_PROFILE,
    posture({ financial: 90 }), { now: clock });
  assert.ok(hot!.drivers.some((d) => /financial\/water|financial/i.test(d) && /axis/i.test(d)));
  assert.ok(hot!.drivers.some((d) => /severity/i.test(d)));

  const [quiet] = applyPersonalLens([event({ domain: 'weather', severity: 5 })], EMPTY_PROFILE,
    posture({}), { now: clock });
  assert.ok(quiet!.drivers.some((d) => /ambient board context/i.test(d)));
  assert.equal(quiet!.tier, 'background');
});
