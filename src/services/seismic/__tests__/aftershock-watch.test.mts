import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  forecastAftershocks,
  summarizeKnownAftershocks,
  buildAftershockReport,
  haversineKm,
  OMORI_UTSU_DEFAULTS,
  DEFAULT_HORIZONS_HOURS,
} from '../aftershock-watch.ts';
import type { CanonicalSeismicEvent } from '../seismic-types.ts';

// ── forecastAftershocks ───────────────────────────────────────────────

test('forecast: M6 mainshock produces all three default horizons', () => {
  const f = forecastAftershocks({ magnitude: 6.0, occurredAt: 0 });
  assert.equal(f.horizons.length, 3);
  assert.deepEqual(f.horizons.map((h) => h.horizonHours), [...DEFAULT_HORIZONS_HOURS]);
});

test('forecast: K = 10^(1.5 + 1.0*(M - 2.0)) (per spec)', () => {
  const f = forecastAftershocks({ magnitude: 7.0, occurredAt: 0 });
  // 10^(1.5 + 5.0) = 10^6.5
  assert.ok(Math.abs(f.K - Math.pow(10, 6.5)) < 1);
});

test('forecast: c = 0.1, p = 1.1, b = 1.0 (per spec)', () => {
  const f = forecastAftershocks({ magnitude: 5.0, occurredAt: 0 });
  assert.equal(f.c, 0.1);
  assert.equal(f.p, 1.1);
  assert.equal(f.bValue, 1.0);
});

test('forecast: Bath largest expected = M_main - 1.2', () => {
  const f = forecastAftershocks({ magnitude: 7.4, occurredAt: 0 });
  assert.ok(Math.abs(f.largestExpected - 6.2) < 1e-6);
});

test('forecast: 168h count > 72h count > 24h count (Omori decay)', () => {
  const f = forecastAftershocks({ magnitude: 6.5, occurredAt: 0 });
  const [h24, h72, h168] = f.horizons;
  assert.ok(h24!.expectedCount < h72!.expectedCount);
  assert.ok(h72!.expectedCount < h168!.expectedCount);
});

test('forecast: 90% CI brackets the expected count', () => {
  const f = forecastAftershocks({ magnitude: 7.0, occurredAt: 0 });
  for (const h of f.horizons) {
    assert.ok(h.ci90.lower <= h.expectedCount, `lower ${h.ci90.lower} > expected ${h.expectedCount}`);
    assert.ok(h.ci90.upper >= h.expectedCount, `upper ${h.ci90.upper} < expected ${h.expectedCount}`);
    assert.ok(h.ci90.lower >= 0);
  }
});

test('forecast: P(M≥5) is always in [0,1]', () => {
  for (const M of [3, 5, 6.5, 7.5, 9]) {
    const f = forecastAftershocks({ magnitude: M, occurredAt: 0 });
    for (const h of f.horizons) {
      assert.ok(h.probAtLeastOneM5 >= 0 && h.probAtLeastOneM5 <= 1, `M=${M} h=${h.horizonHours}`);
      assert.ok(h.probAtLeastOneLargerThanBath >= 0 && h.probAtLeastOneLargerThanBath <= 1);
    }
  }
});

test('forecast: P(M≥5) is monotonically non-decreasing across horizons', () => {
  const f = forecastAftershocks({ magnitude: 4.0, occurredAt: 0 });
  const probs = f.horizons.map((h) => h.probAtLeastOneM5);
  for (let i = 1; i < probs.length; i++) {
    assert.ok(probs[i]! >= probs[i - 1]!, `prob ${probs[i]} < ${probs[i - 1]}`);
  }
});

test('forecast: P(M≥5) for a tiny M3 mainshock is well below 1', () => {
  // M3: K = 10^(1.5+1) = ~316; over 24h ≈ 316*5.32 ≈ 1681 events at M≥2;
  // scale to M≥5: 1.68 events; P ≈ 1 - exp(-1.68) ≈ 0.81. Still below 1.
  const f = forecastAftershocks({ magnitude: 3.0, occurredAt: 0 });
  const longest = f.horizons.at(-1)!;
  assert.ok(longest.probAtLeastOneM5 < 1.0);
});

test('forecast: custom horizons are honored', () => {
  const f = forecastAftershocks({ magnitude: 6.0, occurredAt: 0 }, { horizonsHours: [1, 6] });
  assert.equal(f.horizons.length, 2);
  assert.equal(f.horizons[0]!.horizonHours, 1);
  assert.equal(f.horizons[1]!.horizonHours, 6);
});

test('forecast: result is JSON-serializable', () => {
  const f = forecastAftershocks({ magnitude: 6.5, occurredAt: 1_700_000_000_000 });
  const round = JSON.parse(JSON.stringify(f));
  assert.deepEqual(round, f);
});

test('forecast: defaults are exported and unchanged', () => {
  assert.equal(OMORI_UTSU_DEFAULTS.a, 1.5);
  assert.equal(OMORI_UTSU_DEFAULTS.b, 1.0);
  assert.equal(OMORI_UTSU_DEFAULTS.mRef, 2.0);
  assert.equal(OMORI_UTSU_DEFAULTS.c, 0.1);
  assert.equal(OMORI_UTSU_DEFAULTS.p, 1.1);
  assert.equal(OMORI_UTSU_DEFAULTS.bathDelta, 1.2);
});

// ── haversineKm ───────────────────────────────────────────────────────

test('haversine: same point → 0', () => {
  assert.ok(Math.abs(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })) < 1e-9);
});

test('haversine: ~111 km per degree of latitude on the equator', () => {
  const d = haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
  assert.ok(Math.abs(d - 111.19) < 1, `got ${d}`);
});

// ── summarizeKnownAftershocks ─────────────────────────────────────────

function event(over: Partial<CanonicalSeismicEvent> = {}): CanonicalSeismicEvent {
  return {
    id: 'usgs:base',
    source: 'usgs',
    sourceEventId: 'base',
    magnitude: 4,
    depthKm: 10,
    lat: 0,
    lon: 0,
    place: 'test',
    occurredAt: 1_700_000_000_000,
    confidence: 0.9,
    ...over,
  };
}

test('summary: events outside 100 km radius are excluded', () => {
  const main = { lat: 0, lon: 0, occurredAt: 0 };
  const inside = event({ id: 'a', lat: 0.5, lon: 0.5, occurredAt: 1_000 });
  const outside = event({ id: 'b', lat: 5, lon: 5, occurredAt: 2_000 });
  const s = summarizeKnownAftershocks(main, [inside, outside]);
  assert.equal(s.count, 1);
  assert.equal(s.events[0]!.id, 'a');
});

test('summary: events before mainshock are excluded', () => {
  const main = { lat: 0, lon: 0, occurredAt: 1_000_000 };
  const before = event({ id: 'before', lat: 0.1, lon: 0.1, occurredAt: 999_000 });
  const after = event({ id: 'after', lat: 0.1, lon: 0.1, occurredAt: 1_001_000 });
  const s = summarizeKnownAftershocks(main, [before, after]);
  assert.equal(s.count, 1);
  assert.equal(s.events[0]!.id, 'after');
});

test('summary: events past +14 days are excluded', () => {
  const main = { lat: 0, lon: 0, occurredAt: 0 };
  const inside = event({ id: 'in', lat: 0.1, lon: 0.1, occurredAt: 13 * 24 * 60 * 60 * 1000 });
  const outside = event({ id: 'out', lat: 0.1, lon: 0.1, occurredAt: 15 * 24 * 60 * 60 * 1000 });
  const s = summarizeKnownAftershocks(main, [inside, outside]);
  assert.equal(s.count, 1);
});

test('summary: largestMagnitude tracks the strongest aftershock', () => {
  const main = { lat: 0, lon: 0, occurredAt: 0 };
  const ev1 = event({ id: 'a', lat: 0.1, lon: 0.1, magnitude: 4.5, occurredAt: 1 });
  const ev2 = event({ id: 'b', lat: 0.1, lon: 0.1, magnitude: 5.7, occurredAt: 2 });
  const ev3 = event({ id: 'c', lat: 0.1, lon: 0.1, magnitude: 4.9, occurredAt: 3 });
  const s = summarizeKnownAftershocks(main, [ev1, ev2, ev3]);
  assert.equal(s.count, 3);
  assert.equal(s.largestMagnitude, 5.7);
  assert.equal(s.largestAt, 2);
  assert.equal(s.latestAt, 3);
});

test('summary: the mainshock itself (matched by id) is excluded', () => {
  const main = { id: 'usgs:main', lat: 0, lon: 0, occurredAt: 0 };
  const itself = event({ id: 'usgs:main', lat: 0, lon: 0, occurredAt: 100 });
  const real = event({ id: 'usgs:after', lat: 0.1, lon: 0.1, occurredAt: 200 });
  const s = summarizeKnownAftershocks(main, [itself, real]);
  assert.equal(s.count, 1);
  assert.equal(s.events[0]!.id, 'usgs:after');
});

test('summary: empty input → all-null summary', () => {
  const s = summarizeKnownAftershocks({ lat: 0, lon: 0, occurredAt: 0 }, []);
  assert.equal(s.count, 0);
  assert.equal(s.largestMagnitude, null);
  assert.equal(s.largestAt, null);
  assert.equal(s.latestAt, null);
});

test('summary: events sorted ascending by time', () => {
  const main = { lat: 0, lon: 0, occurredAt: 0 };
  const a = event({ id: 'a', lat: 0.1, lon: 0.1, occurredAt: 300 });
  const b = event({ id: 'b', lat: 0.1, lon: 0.1, occurredAt: 100 });
  const c = event({ id: 'c', lat: 0.1, lon: 0.1, occurredAt: 200 });
  const s = summarizeKnownAftershocks(main, [a, b, c]);
  assert.deepEqual(s.events.map((e) => e.id), ['b', 'c', 'a']);
});

// ── buildAftershockReport ─────────────────────────────────────────────

test('report: ratio = observed/expected at the longest horizon', () => {
  const main = { magnitude: 7.0, lat: 0, lon: 0, occurredAt: 0, id: 'main' };
  const observed: CanonicalSeismicEvent[] = Array.from({ length: 5 }, (_, i) =>
    event({ id: `a${i}`, lat: 0.1, lon: 0.1, magnitude: 4 + i * 0.1, occurredAt: 1000 * (i + 1) }),
  );
  const r = buildAftershockReport(main, observed);
  assert.equal(r.observed.count, 5);
  assert.ok(r.observedToExpectedRatio !== null);
  const expected = r.forecast.horizons.at(-1)!.expectedCount;
  assert.ok(Math.abs(r.observedToExpectedRatio! - 5 / expected) < 0.01);
});

test('report: bathDelta = largestObserved − (M_main − 1.2)', () => {
  const main = { magnitude: 7.0, lat: 0, lon: 0, occurredAt: 0, id: 'main' };
  const observed = [event({ id: 'a', lat: 0.1, lon: 0.1, magnitude: 6.5, occurredAt: 1000 })];
  const r = buildAftershockReport(main, observed);
  // expected largest = 5.8; observed largest = 6.5; delta = 0.7
  assert.ok(Math.abs(r.bathDelta! - 0.7) < 1e-6);
});

test('report: bathDelta is null when there are no observed events', () => {
  const main = { magnitude: 7.0, lat: 0, lon: 0, occurredAt: 0, id: 'main' };
  const r = buildAftershockReport(main, []);
  assert.equal(r.bathDelta, null);
  assert.equal(r.observedToExpectedRatio, 0);
});

test('report: result is JSON-serializable', () => {
  const main = { magnitude: 6.5, lat: 0, lon: 0, occurredAt: 0, id: 'main' };
  const r = buildAftershockReport(main, [event({ lat: 0.1, lon: 0.1, occurredAt: 100 })]);
  const round = JSON.parse(JSON.stringify(r));
  assert.deepEqual(round, r);
});
