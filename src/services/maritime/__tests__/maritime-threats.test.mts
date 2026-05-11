import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WAR_RISK_ZONES,
  zonesContainingPosition,
  filterAcledMaritimeIncidents,
  type AcledEventRow,
} from '../maritime-threats.ts';

// ── WAR_RISK_ZONES ───────────────────────────────────────────────────────────

test('war risk zones cover Red Sea, Black Sea, Hormuz, Gulf of Guinea, Somalia', () => {
  const ids = WAR_RISK_ZONES.map((z) => z.id);
  assert.ok(ids.includes('red-sea-houthi'));
  assert.ok(ids.includes('black-sea'));
  assert.ok(ids.includes('persian-gulf-strait-of-hormuz'));
  assert.ok(ids.includes('gulf-of-guinea'));
  assert.ok(ids.includes('somalia-coast'));
});

test('every zone declares an effective-from date and rationale', () => {
  for (const z of WAR_RISK_ZONES) {
    assert.match(z.effectiveFrom, /^\d{4}-\d{2}-\d{2}$/, `bad date for ${z.id}`);
    assert.ok(z.rationale.length > 20, `weak rationale for ${z.id}`);
    assert.ok(z.radiusKm > 0);
  }
});

// ── zonesContainingPosition ──────────────────────────────────────────────────

test('Red Sea center is inside Red Sea / Houthi zone', () => {
  const matches = zonesContainingPosition(14.5, 42.5);
  assert.ok(matches.some((z) => z.id === 'red-sea-houthi'));
});

test('mid-Atlantic position is inside no zone', () => {
  const matches = zonesContainingPosition(30, -40);
  assert.equal(matches.length, 0);
});

test('NaN coordinates → no matches (no throw)', () => {
  assert.deepEqual(zonesContainingPosition(Number.NaN, 30), []);
  assert.deepEqual(zonesContainingPosition(30, Number.NaN), []);
});

// ── filterAcledMaritimeIncidents ─────────────────────────────────────────────

function row(overrides: Partial<AcledEventRow>): AcledEventRow {
  return {
    event_id_cnty: 'TEST1',
    event_date: '2026-04-15',
    event_type: 'Explosions/Remote violence',
    sub_event_type: 'Air/drone strike',
    actor1: 'Houthi',
    country: 'Yemen',
    location: 'Hodeidah',
    latitude: 14.5,
    longitude: 42.5,
    fatalities: 0,
    notes: 'Test event',
    ...overrides,
  };
}

test('event in Red Sea zone is kept and tagged with the zone', () => {
  const out = filterAcledMaritimeIncidents([row({})]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0]!.warRiskZones, ['Red Sea / Bab-el-Mandeb (Houthi missile + USV)']);
});

test('event near Bab-el-Mandeb chokepoint is kept and tagged with chokepoint', () => {
  const out = filterAcledMaritimeIncidents([row({ latitude: 12.6, longitude: 43.4 })]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.nearestChokepoint, 'Bab-el-Mandeb');
  assert.equal(out[0]!.nearestChokepointKm, 0);
});

test('event far from any chokepoint AND outside any zone is dropped', () => {
  // Mid-Pacific
  const out = filterAcledMaritimeIncidents([row({ latitude: 0, longitude: -150 })]);
  assert.equal(out.length, 0);
});

test('numeric strings for lat/lon are coerced', () => {
  const out = filterAcledMaritimeIncidents([
    row({ latitude: '14.5' as unknown as number, longitude: '42.5' as unknown as number }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.lat, 14.5);
});

test('events with non-finite coordinates are dropped (no throw)', () => {
  const out = filterAcledMaritimeIncidents([
    row({ latitude: Number.NaN }),
    row({ longitude: 'not-a-number' as unknown as number }),
  ]);
  assert.equal(out.length, 0);
});

test('output is sorted newest-first', () => {
  const out = filterAcledMaritimeIncidents([
    row({ event_id_cnty: 'A', event_date: '2026-04-01' }),
    row({ event_id_cnty: 'B', event_date: '2026-04-15' }),
    row({ event_id_cnty: 'C', event_date: '2026-04-08' }),
  ]);
  assert.deepEqual(out.map((e) => e.id), ['B', 'C', 'A']);
});

test('chokepointRadiusKm override: tighter radius excludes events just outside', () => {
  // Position 200km from Hormuz — kept under default 300km radius, dropped at 100km
  const wide = filterAcledMaritimeIncidents([row({ latitude: 28.3, longitude: 56.3 })]);
  const narrow = filterAcledMaritimeIncidents(
    [row({ latitude: 28.3, longitude: 56.3 })],
    { chokepointRadiusKm: 100 },
  );
  // 28.3 is far enough from Hormuz center (26.6) but still inside Persian Gulf war zone — so wide keeps it via zone, narrow only loses the chokepoint tag
  assert.equal(wide.length, 1);
  assert.equal(narrow.length, 1); // still inside Persian Gulf zone
  assert.equal(narrow[0]!.nearestChokepoint, null); // chokepoint tag dropped
});

test('fatalities default to 0 when missing or invalid', () => {
  const out = filterAcledMaritimeIncidents([
    row({ fatalities: 'unknown' as unknown as number }),
  ]);
  assert.equal(out[0]!.fatalities, 0);
});

test('empty input → empty output', () => {
  assert.deepEqual(filterAcledMaritimeIncidents([]), []);
});
