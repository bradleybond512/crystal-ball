import assert from 'node:assert/strict';
import test from 'node:test';

import {
  vesselColorCss,
  vesselRotationDeg,
  vesselTooltip,
  dedupeVesselsByMmsi,
  classifyVesselsByCategory,
  type MaritimeVesselWire,
} from '../vessel-globe-helpers.ts';

const NOW_MS = 1_745_000_000_000;

function vessel(over: Partial<MaritimeVesselWire> = {}): MaritimeVesselWire {
  return {
    mmsi: '111111111',
    name: 'TestShip',
    lat: 25,
    lon: -90,
    speedKnots: 10,
    headingDeg: 90,
    shipType: 80,
    category: 'tanker',
    flag: 'US',
    zoneId: 'gulf',
    zoneName: 'Gulf of Mexico',
    observedAt: NOW_MS,
    ...over,
  };
}

// ── vesselColorCss ─────────────────────────────────────────────────────────

test('vesselColorCss: tanker → orange', () => {
  assert.equal(vesselColorCss('tanker'), '#ff8c00');
});

test('vesselColorCss: bulk_carrier and container both → blue (cargo)', () => {
  assert.equal(vesselColorCss('bulk_carrier'), '#1e90ff');
  assert.equal(vesselColorCss('container'), '#1e90ff');
});

test('vesselColorCss: military → red', () => {
  assert.equal(vesselColorCss('military'), '#dc143c');
});

test('vesselColorCss: other → gray', () => {
  assert.equal(vesselColorCss('other'), '#9e9e9e');
});

test('vesselColorCss: unknown category → gray (graceful)', () => {
  // Cast to bypass TS narrowing for the resilience check.
  assert.equal(vesselColorCss('unknown' as unknown as 'other'), '#9e9e9e');
});

// ── vesselRotationDeg ──────────────────────────────────────────────────────

test('vesselRotationDeg: null → 0', () => {
  assert.equal(vesselRotationDeg(null), 0);
});

test('vesselRotationDeg: 0..360 passes through', () => {
  assert.equal(vesselRotationDeg(0), 0);
  assert.equal(vesselRotationDeg(180), 180);
  assert.equal(vesselRotationDeg(359.5), 359.5);
});

test('vesselRotationDeg: > 360 wraps modulo', () => {
  assert.equal(vesselRotationDeg(370), 10);
  assert.equal(vesselRotationDeg(720), 0);
});

test('vesselRotationDeg: negative wraps into [0,360)', () => {
  assert.equal(vesselRotationDeg(-10), 350);
  assert.equal(vesselRotationDeg(-370), 350);
});

test('vesselRotationDeg: NaN / non-finite → 0', () => {
  assert.equal(vesselRotationDeg(Number.NaN), 0);
  assert.equal(vesselRotationDeg(Number.POSITIVE_INFINITY), 0);
});

// ── vesselTooltip ──────────────────────────────────────────────────────────

test('vesselTooltip: includes name, mmsi, speed, heading, zone', () => {
  const t = vesselTooltip(vessel({ name: 'NORDIC STAR', mmsi: '232123456', speedKnots: 14.6, headingDeg: 270, zoneName: 'Strait of Hormuz' }));
  assert.match(t, /NORDIC STAR/);
  assert.match(t, /232123456/);
  assert.match(t, /14.6 kts/);
  assert.match(t, /270°/);
  assert.match(t, /Strait of Hormuz/);
});

test('vesselTooltip: falls back to mmsi when name is empty', () => {
  const t = vesselTooltip(vessel({ name: '', mmsi: '232123456' }));
  assert.match(t, /232123456/);
});

test('vesselTooltip: shows "—" for null speed/heading', () => {
  const t = vesselTooltip(vessel({ speedKnots: null, headingDeg: null }));
  assert.match(t, /Speed: —/);
  assert.match(t, /Hdg: —/);
});

// ── dedupeVesselsByMmsi ────────────────────────────────────────────────────

test('dedupeVesselsByMmsi: keeps the newest observation per mmsi', () => {
  const v1 = vessel({ mmsi: 'A', observedAt: NOW_MS - 60_000, name: 'OLD' });
  const v2 = vessel({ mmsi: 'A', observedAt: NOW_MS, name: 'NEW' });
  const out = dedupeVesselsByMmsi([v1, v2]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.name, 'NEW');
});

test('dedupeVesselsByMmsi: treats null observedAt as oldest', () => {
  const noTs = vessel({ mmsi: 'A', observedAt: null, name: 'NULL_TS' });
  const newer = vessel({ mmsi: 'A', observedAt: NOW_MS, name: 'WITH_TS' });
  const out = dedupeVesselsByMmsi([noTs, newer]);
  assert.equal(out[0]?.name, 'WITH_TS');
});

test('dedupeVesselsByMmsi: distinct mmsis all preserved', () => {
  const a = vessel({ mmsi: 'A' });
  const b = vessel({ mmsi: 'B' });
  const c = vessel({ mmsi: 'C' });
  const out = dedupeVesselsByMmsi([a, b, c]);
  assert.equal(out.length, 3);
});

// ── classifyVesselsByCategory ──────────────────────────────────────────────

test('classifyVesselsByCategory: counts by category', () => {
  const out = classifyVesselsByCategory([
    vessel({ mmsi: '1', category: 'tanker' }),
    vessel({ mmsi: '2', category: 'tanker' }),
    vessel({ mmsi: '3', category: 'military' }),
    vessel({ mmsi: '4', category: 'other' }),
  ]);
  assert.equal(out.tanker, 2);
  assert.equal(out.military, 1);
  assert.equal(out.other, 1);
  assert.equal(out.bulk_carrier, 0);
  assert.equal(out.container, 0);
});

test('classifyVesselsByCategory: empty list yields zeros', () => {
  const out = classifyVesselsByCategory([]);
  assert.equal(out.tanker, 0);
  assert.equal(out.military, 0);
  assert.equal(out.bulk_carrier, 0);
  assert.equal(out.container, 0);
  assert.equal(out.other, 0);
});
