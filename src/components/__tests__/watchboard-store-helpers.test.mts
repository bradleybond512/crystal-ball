import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pointInPolygon,
  pointInCircle,
  pointInShape,
  evaluateTripwire,
  generateId,
  getTemplates,
} from '../watchboard-store-helpers.js';
import type {
  GeoPolygon,
  GeoCircle,
  Tripwire,
  TripwireCondition,
  WatchboardSignal,
} from '../../types/watchboard.js';

// ── Fixtures ─────────────────────────────────────────────────────────────

// A 10×10 axis-aligned square, vertices given as [lon, lat] (ring left open;
// the ray-caster closes it implicitly).
const SQUARE: GeoPolygon = {
  type: 'polygon',
  coordinates: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
};

// A concave "C"/notched polygon: a 10×10 square with a rectangular notch
// carved out of the right side between lat 4 and lat 6.
const CONCAVE: GeoPolygon = {
  type: 'polygon',
  coordinates: [
    [0, 0],
    [10, 0],
    [10, 4],
    [4, 4],
    [4, 6],
    [10, 6],
    [10, 10],
    [0, 10],
  ],
};

const HORMUZ_CIRCLE: GeoCircle = { type: 'circle', center: [56.3, 26.5], radiusKm: 150 };

const MERIDIAN_KM_PER_DEG = (6371 * Math.PI) / 180; // ≈ 111.195 km per degree of latitude

function tripwire(conditions: TripwireCondition[], shape: GeoPolygon | GeoCircle = SQUARE): Tripwire {
  return {
    id: 'tw1',
    watchboardId: 'wb1',
    name: 'Test tripwire',
    shape,
    conditions,
    dwellLogic: { enabled: false },
    enabled: true,
    createdAt: '2026-06-10T00:00:00.000Z',
    fireCount: 0,
  };
}

function cond(type: TripwireCondition['type'], value: string | number): TripwireCondition {
  return { id: `c-${type}`, type, value, description: `${type}=${value}` };
}

function sig(over: Partial<WatchboardSignal>): WatchboardSignal {
  return { lon: 5, lat: 5, ...over };
}

// ── pointInPolygon ────────────────────────────────────────────────────────

test('pointInPolygon: a point well inside the square is inside', () => {
  assert.equal(pointInPolygon(5, 5, SQUARE), true);
});

test('pointInPolygon: points outside the square are outside', () => {
  assert.equal(pointInPolygon(20, 20, SQUARE), false);
  assert.equal(pointInPolygon(-5, 5, SQUARE), false);
  assert.equal(pointInPolygon(5, -50, SQUARE), false);
});

test('pointInPolygon: a point exactly on an edge is boundary-inclusive (inside)', () => {
  assert.equal(pointInPolygon(5, 0, SQUARE), true); // bottom edge midpoint
  assert.equal(pointInPolygon(10, 5, SQUARE), true); // right edge midpoint
  assert.equal(pointInPolygon(0, 10, SQUARE), true); // top-left vertex region
});

test('pointInPolygon: a vertex counts as inside', () => {
  assert.equal(pointInPolygon(0, 0, SQUARE), true);
});

test('pointInPolygon: just inside an edge is inside, just outside is outside', () => {
  assert.equal(pointInPolygon(0.001, 5, SQUARE), true);
  assert.equal(pointInPolygon(-0.001, 5, SQUARE), false);
});

test('pointInPolygon: convex (triangle) membership', () => {
  const triangle: GeoPolygon = {
    type: 'polygon',
    coordinates: [
      [0, 0],
      [10, 0],
      [5, 10],
    ],
  };
  assert.equal(pointInPolygon(5, 1, triangle), true);
  assert.equal(pointInPolygon(1, 8, triangle), false); // outside the apex taper
});

test('pointInPolygon: concave polygon excludes the carved-out notch', () => {
  assert.equal(pointInPolygon(2, 5, CONCAVE), true); // left of the notch, inside
  assert.equal(pointInPolygon(7, 5, CONCAVE), false); // inside the carved-out notch
});

test('pointInPolygon: a degenerate polygon (<3 vertices) is never inside', () => {
  const degenerate: GeoPolygon = { type: 'polygon', coordinates: [[0, 0], [1, 1]] };
  assert.equal(pointInPolygon(0.5, 0.5, degenerate), false);
});

test('pointInPolygon: empty polygon (0 coords) is never inside', () => {
  const empty: GeoPolygon = { type: 'polygon', coordinates: [] };
  assert.equal(pointInPolygon(0, 0, empty), false);
});

test('pointInPolygon: works for a high-latitude polygon near the pole', () => {
  const arctic: GeoPolygon = {
    type: 'polygon',
    coordinates: [
      [-10, 80],
      [10, 80],
      [10, 89],
      [-10, 89],
    ],
  };
  assert.equal(pointInPolygon(0, 85, arctic), true);
  assert.equal(pointInPolygon(0, 70, arctic), false);
});

// ── pointInCircle ───────────────────────────────────────────────────────

test('pointInCircle: the centre itself is inside', () => {
  assert.equal(pointInCircle(56.3, 26.5, HORMUZ_CIRCLE), true);
});

test('pointInCircle: a point inside the radius is inside', () => {
  const circle: GeoCircle = { type: 'circle', center: [0, 0], radiusKm: 200 };
  assert.equal(pointInCircle(0, 1, circle), true); // ~111 km north of centre
});

test('pointInCircle: a point outside the radius is outside', () => {
  const circle: GeoCircle = { type: 'circle', center: [0, 0], radiusKm: 50 };
  assert.equal(pointInCircle(0, 1, circle), false); // ~111 km away, radius only 50
});

test('pointInCircle: a point exactly on the boundary is inside (<= radius)', () => {
  const onBoundary: GeoCircle = { type: 'circle', center: [0, 0], radiusKm: MERIDIAN_KM_PER_DEG };
  assert.equal(pointInCircle(0, 1, onBoundary), true);
  const justInside: GeoCircle = { type: 'circle', center: [0, 0], radiusKm: MERIDIAN_KM_PER_DEG - 0.5 };
  assert.equal(pointInCircle(0, 1, justInside), false);
});

test('pointInCircle: a point within 1 meter of the boundary from inside is still inside', () => {
  // ~111.195 km per degree; set radius to 1 metre less than that to place the
  // point at [0,1] just outside, then add 2 m to put it just inside.
  const radiusJustShort = MERIDIAN_KM_PER_DEG - 0.001; // 1 m short
  const justOutside: GeoCircle = { type: 'circle', center: [0, 0], radiusKm: radiusJustShort };
  assert.equal(pointInCircle(0, 1, justOutside), false);
  const radiusJustOver = MERIDIAN_KM_PER_DEG + 0.001; // 1 m over
  const justInside: GeoCircle = { type: 'circle', center: [0, 0], radiusKm: radiusJustOver };
  assert.equal(pointInCircle(0, 1, justInside), true);
});

test('pointInCircle: works at the equator', () => {
  const circle: GeoCircle = { type: 'circle', center: [0, 0], radiusKm: 200 };
  assert.equal(pointInCircle(1, 0, circle), true);
});

test('pointInCircle: works across the antimeridian', () => {
  const circle: GeoCircle = { type: 'circle', center: [179.5, 0], radiusKm: 200 };
  assert.equal(pointInCircle(-179.5, 0, circle), true); // 1° apart straddling ±180
});

test('pointInCircle: works at the poles', () => {
  const northPole: GeoCircle = { type: 'circle', center: [0, 90], radiusKm: 300 };
  assert.equal(pointInCircle(180, 90, northPole), true); // same pole, any lon → distance 0
  assert.equal(pointInCircle(0, 89, northPole), true); // ~111 km away, within 300
  assert.equal(pointInCircle(0, 87, northPole), false); // ~333 km away, outside 300
});

test('pointInCircle: antipodal-scale distances do not produce NaN', () => {
  const circle: GeoCircle = { type: 'circle', center: [0, 0], radiusKm: 100 };
  assert.equal(pointInCircle(180, 0, circle), false); // ~20000 km away
});

// ── pointInShape ──────────────────────────────────────────────────────────

test('pointInShape: dispatches to polygon membership', () => {
  assert.equal(pointInShape(5, 5, SQUARE), true);
  assert.equal(pointInShape(50, 50, SQUARE), false);
});

test('pointInShape: dispatches to circle membership', () => {
  assert.equal(pointInShape(56.3, 26.5, HORMUZ_CIRCLE), true);
  assert.equal(pointInShape(0, 0, HORMUZ_CIRCLE), false);
});

// ── evaluateTripwire ────────────────────────────────────────────────────────

test('evaluateTripwire: a point outside the shape never fires, even with matching conditions', () => {
  const tw = tripwire([cond('domain', 'cyber')]);
  assert.equal(evaluateTripwire(tw, sig({ lon: 50, lat: 50, domain: 'cyber' })), false);
});

test('evaluateTripwire: domain match inside the shape fires', () => {
  const tw = tripwire([cond('domain', 'cyber')]);
  assert.equal(evaluateTripwire(tw, sig({ domain: 'cyber' })), true);
});

test('evaluateTripwire: domain mismatch does not fire', () => {
  const tw = tripwire([cond('domain', 'cyber')]);
  assert.equal(evaluateTripwire(tw, sig({ domain: 'weather' })), false);
});

test('evaluateTripwire: severity at or above the threshold fires; below does not', () => {
  const tw = tripwire([cond('severity', 0.6)]);
  assert.equal(evaluateTripwire(tw, sig({ severity: 0.7 })), true);
  assert.equal(evaluateTripwire(tw, sig({ severity: 0.6 })), true);
  assert.equal(evaluateTripwire(tw, sig({ severity: 0.4 })), false);
});

test('evaluateTripwire: a severity condition with no severity on the signal does not fire', () => {
  const tw = tripwire([cond('severity', 0.6)]);
  assert.equal(evaluateTripwire(tw, sig({})), false);
});

test('evaluateTripwire: entity id match fires; absence does not', () => {
  const tw = tripwire([cond('entity', 'IRGCN')]);
  assert.equal(evaluateTripwire(tw, sig({ entityIds: ['NAVY', 'IRGCN'] })), true);
  assert.equal(evaluateTripwire(tw, sig({ entityIds: ['NAVY'] })), false);
  assert.equal(evaluateTripwire(tw, sig({})), false);
});

test('evaluateTripwire: keyword matches case-insensitively inside an object payload', () => {
  const tw = tripwire([cond('keyword', 'tanker')]);
  assert.equal(evaluateTripwire(tw, sig({ payload: { title: 'Oil TANKER seized' } })), true);
  assert.equal(evaluateTripwire(tw, sig({ payload: { title: 'Cargo ship' } })), false);
});

test('evaluateTripwire: keyword matches a plain string payload', () => {
  const tw = tripwire([cond('keyword', 'dark')]);
  assert.equal(evaluateTripwire(tw, sig({ payload: 'AIS went DARK off Fujairah' })), true);
});

test('evaluateTripwire: keyword with no payload does not fire', () => {
  const tw = tripwire([cond('keyword', 'tanker')]);
  assert.equal(evaluateTripwire(tw, sig({})), false);
});

test('evaluateTripwire: event-type match fires; mismatch does not', () => {
  const tw = tripwire([cond('event-type', 'emergency_squawk')]);
  assert.equal(evaluateTripwire(tw, sig({ eventType: 'emergency_squawk' })), true);
  assert.equal(evaluateTripwire(tw, sig({ eventType: 'vessel_dark' })), false);
  assert.equal(evaluateTripwire(tw, sig({})), false);
});

test('evaluateTripwire: multiple conditions are ANDed together', () => {
  const tw = tripwire([cond('domain', 'maritime'), cond('severity', 0.5)]);
  assert.equal(evaluateTripwire(tw, sig({ domain: 'maritime', severity: 0.8 })), true);
  // domain matches but severity below threshold → no fire
  assert.equal(evaluateTripwire(tw, sig({ domain: 'maritime', severity: 0.1 })), false);
  // severity matches but domain wrong → no fire
  assert.equal(evaluateTripwire(tw, sig({ domain: 'cyber', severity: 0.8 })), false);
});

test('evaluateTripwire: a tripwire with no conditions fires on any in-shape signal', () => {
  const tw = tripwire([]);
  assert.equal(evaluateTripwire(tw, sig({})), true);
  assert.equal(evaluateTripwire(tw, sig({ lon: 50, lat: 50 })), false);
});

test('evaluateTripwire: works with a circle shape', () => {
  const tw = tripwire([cond('domain', 'maritime')], HORMUZ_CIRCLE);
  assert.equal(evaluateTripwire(tw, sig({ lon: 56.3, lat: 26.5, domain: 'maritime' })), true);
  assert.equal(evaluateTripwire(tw, sig({ lon: 0, lat: 0, domain: 'maritime' })), false);
});

// ── generateId ──────────────────────────────────────────────────────────────

test('generateId: returns a non-empty string', () => {
  const id = generateId();
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 0);
});

test('generateId: is not null or undefined', () => {
  const id = generateId();
  assert.notEqual(id, null);
  assert.notEqual(id, undefined);
});

test('generateId: returns unique strings on repeated calls', () => {
  assert.notEqual(generateId(), generateId());
});

test('generateId: 1000 calls produce 1000 unique ids', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
  assert.equal(ids.size, 1000);
});

// ── getTemplates ────────────────────────────────────────────────────────────

test('getTemplates: returns at least 4 templates', () => {
  assert.ok(getTemplates().length >= 4);
});

test('getTemplates: every template has a name, at least one valid shape, and at least one condition', () => {
  for (const tpl of getTemplates()) {
    assert.ok(tpl.name.length > 0, 'template missing name');
    assert.ok(Array.isArray(tpl.shapes) && tpl.shapes.length >= 1, `${tpl.name} has no shapes`);
    assert.ok(tpl.conditions.length >= 1, `${tpl.name} has no conditions`);
    for (const shape of tpl.shapes) {
      if (shape.type === 'polygon') {
        assert.ok(shape.coordinates.length >= 3, `${tpl.name} polygon needs >= 3 vertices`);
      } else {
        assert.equal(shape.center.length, 2, `${tpl.name} circle needs a [lon,lat] centre`);
        assert.ok(shape.radiusKm > 0, `${tpl.name} circle needs a positive radius`);
      }
    }
  }
});

test('getTemplates: every condition carries a value and a description', () => {
  for (const tpl of getTemplates()) {
    for (const c of tpl.conditions) {
      assert.notEqual(c.value, undefined);
      assert.ok(c.description.length > 0, `${tpl.name} condition needs a description`);
    }
  }
});

test('getTemplates: includes the documented built-in watchboards', () => {
  const names = getTemplates().map((t) => t.name.toLowerCase());
  for (const needle of ['hormuz', 'taiwan', 'black sea', 'squawk', 'earthquake']) {
    assert.ok(names.some((n) => n.includes(needle)), `missing template matching "${needle}"`);
  }
});

test('getTemplates: Earthquake Watch fires on seismic domain at severity >= 0.6', () => {
  const eq = getTemplates().find((t) => t.name.toLowerCase().includes('earthquake'));
  assert.ok(eq, 'Earthquake Watch template exists');
  const domain = eq!.conditions.find((c) => c.type === 'domain');
  const severity = eq!.conditions.find((c) => c.type === 'severity');
  assert.equal(domain?.value, 'seismic');
  assert.equal(severity?.value, 0.6);
});

test('getTemplates: Global Emergency Squawks uses an emergency_squawk event-type condition', () => {
  const sq = getTemplates().find((t) => t.name.toLowerCase().includes('squawk'));
  assert.ok(sq, 'Global Emergency Squawks template exists');
  assert.ok(sq!.conditions.some((c) => c.type === 'event-type' && c.value === 'emergency_squawk'));
});

test('getTemplates: at least one template uses a circle shape', () => {
  const templates = getTemplates();
  const hasCircle = templates.some((t) => t.shapes.some((s) => s.type === 'circle'));
  assert.ok(hasCircle, 'expected at least one template with a circle shape');
});

test('getTemplates: a global template matches both poles and the antimeridian', () => {
  const sq = getTemplates().find((t) => t.name.toLowerCase().includes('squawk'));
  const shape = sq!.shapes[0]!;
  assert.equal(pointInShape(0, 90, shape), true); // north pole
  assert.equal(pointInShape(0, -90, shape), true); // south pole
  assert.equal(pointInShape(180, 0, shape), true); // antimeridian
});
