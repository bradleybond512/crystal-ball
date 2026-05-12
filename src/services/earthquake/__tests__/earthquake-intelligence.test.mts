import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseUsgsEvents,
  buildEarthquakeIntelligence,
  nearestFault,
  estimatePopulationExposure,
  estimateMmi,
  mmiToLabel,
  regionalSeismicityRate,
  historicalContextFor,
  shakemapUrlFor,
  haversineKm,
  fetchEarthquakeIntelligence,
  getEarthquakeState,
  _resetEarthquakeStateForTests,
  FAULT_SYSTEMS,
  type UsgsEvent,
} from '../earthquake-intelligence.ts';

const NOW = Date.UTC(2026, 4, 12, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

function ev(over: Partial<UsgsEvent> = {}): UsgsEvent {
  return {
    id: 'usgs-1',
    magnitude: 5.0,
    magnitudeType: 'mw',
    place: 'somewhere',
    time: NOW - HOUR,
    depthKm: 10,
    lat: 35,
    lon: -120,
    ...over,
  };
}

// ── haversineKm sanity ────────────────────────────────────────────────

test('haversine: same point → 0', () => {
  assert.ok(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }) < 1e-6);
});

test('haversine: ~111 km per equator degree of latitude', () => {
  const d = haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
  assert.ok(Math.abs(d - 111.19) < 1, `got ${d}`);
});

// ── parseUsgsEvents ────────────────────────────────────────────────────

test('parser: shapes /api/earthquakes rows into UsgsEvent', () => {
  const raw = { events: [
    { id: 'a', magnitude: 5.1, place: 'X', time: NOW, depth: 12, lat: 35, lon: -120, magnitudeType: 'mw' },
  ]};
  const out = parseUsgsEvents(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, 'a');
  assert.equal(out[0]!.depthKm, 12);
});

test('parser: drops rows without id / magnitude / coords', () => {
  const raw = { events: [
    { magnitude: 5, place: 'no-id', time: NOW, lat: 0, lon: 0 },
    { id: 'a', place: 'no-mag', time: NOW, lat: 0, lon: 0 },
    { id: 'b', magnitude: 5, place: 'good', time: NOW, lat: 0, lon: 0 },
  ]};
  assert.equal(parseUsgsEvents(raw).length, 1);
});

test('parser: accepts bare array payload', () => {
  const raw = [{ id: 'a', magnitude: 5, place: 'X', time: NOW, lat: 0, lon: 0 }];
  assert.equal(parseUsgsEvents(raw).length, 1);
});

test('parser: empty / null input returns []', () => {
  assert.deepEqual(parseUsgsEvents(null), []);
  assert.deepEqual(parseUsgsEvents({}), []);
});

// ── nearestFault ───────────────────────────────────────────────────────

test('nearest fault: San Francisco Bay matches San Andreas family', () => {
  const m = nearestFault({ lat: 37.7, lon: -122.1 });
  assert.ok(m);
  assert.ok(['san-andreas', 'hayward'].includes(m!.faultId));
});

test('nearest fault: Tokyo matches Japan Trench / Nankai', () => {
  const m = nearestFault({ lat: 35.7, lon: 139.7 });
  assert.ok(m);
  assert.ok(['japan-trench', 'nankai'].includes(m!.faultId));
});

test('nearest fault: open Pacific ocean → null (no fault within threshold)', () => {
  assert.equal(nearestFault({ lat: 0, lon: -150 }), null);
});

test('fault table: 20+ entries cover all major regions', () => {
  assert.ok(FAULT_SYSTEMS.length >= 20);
  const regions = new Set(FAULT_SYSTEMS.map((f) => f.region));
  assert.ok(regions.size >= 5);
});

// ── estimatePopulationExposure ────────────────────────────────────────

test('population: mid-latitude land is denser than equatorial ocean', () => {
  const continental = estimatePopulationExposure(40, -100, 50);
  const ocean = estimatePopulationExposure(0, -140, 50);
  assert.ok(continental > ocean * 10);
});

test('population: open Pacific gets the ocean discount', () => {
  const pacific = estimatePopulationExposure(15, -130, 50);
  const land = estimatePopulationExposure(15, -100, 50);
  assert.ok(pacific < land);
});

test('population: zero radius → 0 people', () => {
  assert.equal(estimatePopulationExposure(40, -100, 0), 0);
});

test('population: polar latitudes return tiny estimates', () => {
  const arctic = estimatePopulationExposure(85, 0, 50);
  assert.ok(arctic < 1000);
});

// ── estimateMmi / mmiToLabel ──────────────────────────────────────────

test('mmi: large magnitude at near distance produces high MMI', () => {
  assert.ok(estimateMmi(7.5, 5) >= 8);
});

test('mmi: same magnitude at 1000 km is much lower', () => {
  const near = estimateMmi(7.5, 5);
  const far = estimateMmi(7.5, 1000);
  assert.ok(near > far);
});

test('mmi: distance 0 clamps to 1 (no divide-by-zero blowup)', () => {
  const mmi = estimateMmi(5, 0);
  assert.ok(Number.isFinite(mmi));
  assert.ok(mmi >= 1 && mmi <= 12);
});

test('mmi: label ladder covers I → X+', () => {
  assert.equal(mmiToLabel(1), 'I');
  assert.equal(mmiToLabel(3), 'II-III');
  assert.equal(mmiToLabel(4), 'IV');
  assert.equal(mmiToLabel(5), 'V');
  assert.equal(mmiToLabel(6), 'VI');
  assert.equal(mmiToLabel(7), 'VII');
  assert.equal(mmiToLabel(8), 'VIII');
  assert.equal(mmiToLabel(9), 'IX');
  assert.equal(mmiToLabel(10.5), 'X+');
});

// ── regionalSeismicityRate ────────────────────────────────────────────

test('rate: 0 events → quiet/normal labels (never throws)', () => {
  const r = regionalSeismicityRate([], NOW);
  assert.equal(r.last24hCount, 0);
  assert.equal(r.label, 'normal');
});

test('rate: ratio > 1.5 flags as elevated', () => {
  // 10 events in the last 24h, 1 event in the prior 29 days.
  const events: UsgsEvent[] = [
    ...Array.from({ length: 10 }, (_, i) => ev({ id: `r${i}`, time: NOW - 30 * 60_000 - i * 1000 })),
    ev({ id: 'old', time: NOW - 5 * 24 * HOUR }),
  ];
  const r = regionalSeismicityRate(events, NOW);
  assert.equal(r.last24hCount, 10);
  assert.equal(r.label, 'elevated');
});

test('rate: swarm requires both high count + high ratio', () => {
  const events: UsgsEvent[] = [
    ...Array.from({ length: 150 }, (_, i) => ev({ id: `s${i}`, time: NOW - 60_000 - i * 100 })),
  ];
  const r = regionalSeismicityRate(events, NOW);
  assert.equal(r.label, 'swarm');
});

// ── historicalContextFor ──────────────────────────────────────────────

test('history: identifies the largest nearby event', () => {
  const target = ev({ id: 't', magnitude: 4.5, lat: 35, lon: -120 });
  const all = [
    target,
    ev({ id: 'a', magnitude: 6.2, lat: 35.5, lon: -120.2, place: 'Big-One' }),
    ev({ id: 'b', magnitude: 3.0, lat: 36, lon: -121 }),
  ];
  const ctx = historicalContextFor(target, all);
  assert.match(ctx, /Strongest nearby: M6\.2/);
});

test('history: target is the strongest → reports so', () => {
  const target = ev({ id: 't', magnitude: 7.0, lat: 0, lon: 0 });
  const ctx = historicalContextFor(target, [target]);
  assert.match(ctx, /Strongest event in this region/);
});

// ── shakemapUrlFor ────────────────────────────────────────────────────

test('shakemap url: encodes the event id', () => {
  const url = shakemapUrlFor('us7000xy/z');
  assert.ok(url.includes('us7000xy%2Fz'));
  assert.ok(url.startsWith('https://earthquake.usgs.gov/'));
});

// ── buildEarthquakeIntelligence ──────────────────────────────────────

test('build: M5+ events get an Omori-Utsu aftershock forecast', () => {
  const events = [
    ev({ id: 'm6', magnitude: 6.0, time: NOW - HOUR }),
    ev({ id: 'm4', magnitude: 4.0, time: NOW - HOUR }),
  ];
  const state = buildEarthquakeIntelligence(events, NOW);
  assert.ok(state.aftershockForecasts.m6);
  assert.equal(state.aftershockForecasts.m4, undefined);
  // Sanity: integrated count over 168h is bigger than over 24h.
  const horizons = state.aftershockForecasts.m6!.horizons;
  assert.ok(horizons.at(-1)!.expectedCount >= horizons[0]!.expectedCount);
});

test('build: significantEvents filtered to M ≥ 4.0 and sorted newest first', () => {
  const events = [
    ev({ id: 'a', magnitude: 4.2, time: NOW - 6 * HOUR }),
    ev({ id: 'b', magnitude: 3.0, time: NOW - HOUR }),
    ev({ id: 'c', magnitude: 5.5, time: NOW - 2 * HOUR }),
  ];
  const state = buildEarthquakeIntelligence(events, NOW);
  assert.deepEqual(state.significantEvents.map((s) => s.event.id), ['c', 'a']);
});

test('build: each summary carries MMI + fault + population fields', () => {
  const state = buildEarthquakeIntelligence([ev({ magnitude: 5.5, lat: 35.7, lon: -120.3 })], NOW);
  const s = state.significantEvents[0]!;
  assert.ok(s.estimatedMmi > 0);
  assert.ok(s.estimatedMmiLabel);
  assert.ok(s.fault); // San Andreas region
  assert.ok(s.populationWithin50Km > 0);
  assert.match(s.shakemapUrl, /shakemap\/intensity/);
});

test('build: aftershockForecasts are JSON-serializable', () => {
  const state = buildEarthquakeIntelligence([ev({ magnitude: 6 })], NOW);
  const round = JSON.parse(JSON.stringify(state));
  assert.deepEqual(round, state);
});

// ── fetchEarthquakeIntelligence orchestrator ─────────────────────────

function mockFetch(payload: unknown): typeof fetch {
  return (async () => ({ ok: true, json: async () => payload } as Response)) as unknown as typeof fetch;
}

test('orchestrator: stub fetch → populated state', async () => {
  _resetEarthquakeStateForTests();
  const state = await fetchEarthquakeIntelligence({
    fetchImpl: mockFetch({ events: [{ id: 'a', magnitude: 5.5, place: 'X', time: NOW - HOUR, lat: 35, lon: -120 }] }),
    now: NOW,
  });
  assert.equal(state.significantEvents.length, 1);
  assert.equal(getEarthquakeState(), state);
});

test('orchestrator: fetch failure → empty state without throwing', async () => {
  _resetEarthquakeStateForTests();
  const f = (async () => ({ ok: false, json: async () => null } as Response)) as unknown as typeof fetch;
  const state = await fetchEarthquakeIntelligence({ fetchImpl: f, now: NOW });
  assert.equal(state.significantEvents.length, 0);
  assert.equal(state.regionalRate.last24hCount, 0);
});

test('orchestrator: exception in fetch is swallowed', async () => {
  _resetEarthquakeStateForTests();
  const f = (() => { throw new Error('boom'); }) as unknown as typeof fetch;
  const state = await fetchEarthquakeIntelligence({ fetchImpl: f, now: NOW });
  assert.equal(state.significantEvents.length, 0);
});

test('getEarthquakeState: starts null + reflects last fetch', async () => {
  _resetEarthquakeStateForTests();
  assert.equal(getEarthquakeState(), null);
  await fetchEarthquakeIntelligence({ fetchImpl: mockFetch({ events: [] }), now: NOW });
  assert.ok(getEarthquakeState() !== null);
});
