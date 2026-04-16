// src-tauri/sidecar/sitrep-filter.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { filterDomain, filterAllDomains } from './sitrep-filter.mjs';

test('filterDomain: severity 1 strips items, returns summary only', () => {
  const result = filterDomain('conflicts', 1, {
    events: Array.from({ length: 3 }, () => ({ country: 'X' })),
  });
  assert.equal(result.items, undefined);
  assert.equal(typeof result.summary, 'string');
  assert.equal(result.count, 3);
});

test('filterDomain: severity 2 returns top 5 items', () => {
  const events = Array.from({ length: 20 }, (_, i) => ({ id: i }));
  const result = filterDomain('conflicts', 2, { events });
  assert.equal(result.items.length, 5);
});

test('filterDomain: severity 4 returns up to 20 items', () => {
  const events = Array.from({ length: 50 }, (_, i) => ({ id: i }));
  const result = filterDomain('conflicts', 4, { events });
  assert.equal(result.items.length, 20);
});

test('filterDomain: weather severity 1 strips polygon geometry', () => {
  const result = filterDomain('weather', 1, [
    { event: 'Flood', severity: 'Moderate', geometry: { type: 'Polygon', coordinates: [[[1,2],[3,4]]] } },
  ]);
  assert.equal(result.items, undefined);
});

test('filterDomain: weather severity 3 strips polygon geometry from items', () => {
  const result = filterDomain('weather', 3, [
    { event: 'Flood', severity: 'Severe', geometry: { type: 'Polygon', coordinates: [[[1,2],[3,4]]] } },
  ]);
  assert.ok(result.items.length > 0);
  assert.equal(result.items[0].geometry, undefined);
});

test('filterDomain: military strips non-military aircraft', () => {
  const aircraft = [
    { callsign: 'RCH001', military: true },
    { callsign: 'THY123', military: false },
    { callsign: 'ZEUS22', military: true },
  ];
  const result = filterDomain('military', 3, { aircraft, vessels: [], posture: {} });
  const milOnly = result.items.filter(a => a.callsign);
  assert.ok(milOnly.every(a => a.military === true || /^(RCH|ZEUS|KYOTE|BOMR|ENT|OTIS|MUSEL|WATTS|CARGO|VVHK|SCHNR)/.test(a.callsign)));
});

test('filterAllDomains: applies correct filter per domain', () => {
  const severity = { conflicts: 1, weather: 3, seismic: 1 };
  const raw = {
    conflicts: { events: [{ country: 'X' }] },
    weather: [{ event: 'Flood', severity: 'Severe', geometry: {} }],
    seismic: { earthquakes: [] },
  };
  const result = filterAllDomains(severity, raw);
  assert.equal(result.conflicts.items, undefined);
  assert.ok(result.weather.items.length > 0);
});
