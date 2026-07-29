import assert from 'node:assert/strict';
import test from 'node:test';

import { isUsableMatchRing } from '../ring-geometry.ts';

// P0 (Codex): a polygon ring is only usable for point-in-polygon matching if it
// has ≥3 vertices AND encloses non-zero area. F-review-3 already sanitizes
// non-finite vertices at the producer, but a FINITE degenerate ring (all
// identical, or all collinear) still passes a naive `length >= 3` check while
// containing no point. A severe alert carrying only such geometry is spatially
// unplaceable, so it must NOT read as "has a usable polygon" — otherwise it is
// not counted zone-only and can reach a false clear behind a degraded UGC-zone
// lookup. Reject ONLY exactly-zero area (never epsilon-reject a thin polygon),
// so a legitimately narrow NWS warning polygon still matches (fail-stuck guard).

test('a proper triangle is usable', () => {
  assert.equal(isUsableMatchRing([[0, 0], [1, 0], [0, 1]]), true);
});

test('fewer than 3 vertices is never usable', () => {
  assert.equal(isUsableMatchRing([[0, 0], [1, 1]]), false);
  assert.equal(isUsableMatchRing([[0, 0]]), false);
  assert.equal(isUsableMatchRing([]), false);
});

test('3 identical vertices (zero area) is not usable', () => {
  assert.equal(isUsableMatchRing([[5, 5], [5, 5], [5, 5]]), false);
});

test('collinear vertices (zero area) is not usable', () => {
  assert.equal(isUsableMatchRing([[0, 0], [1, 1], [2, 2], [3, 3]]), false);
});

test('a closed ring (first === last) with real area stays usable', () => {
  assert.equal(isUsableMatchRing([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]), true);
});

test('a real thin sliver polygon (small but non-zero area) stays usable', () => {
  assert.equal(isUsableMatchRing([[0, 0], [10, 0], [10, 0.0001]]), true);
});

// P0 (Codex round-4): a ring can carry FINITE vertices that are outside the
// valid geographic range (|lon| > 180 or |lat| > 90). Such a ring still has a
// non-zero shoelace area, so it passed the area check and read as "usable" —
// yet no real saved place can lie inside it, so matching returns exposure 0,
// matching stays "complete," and the clear path mints a false ALL CLEAR over a
// spatially-unplaceable severe alert. A vertex out of range means the geometry
// cannot be trusted to place a point, so the whole ring is unusable (all-or-
// nothing: never drop a single vertex and silently distort the polygon).
test('a vertex with out-of-range longitude (>180) makes the ring unusable', () => {
  assert.equal(isUsableMatchRing([[181, 40], [182, 40], [181, 41]]), false);
});

test('a vertex with out-of-range longitude (<-180) makes the ring unusable', () => {
  assert.equal(isUsableMatchRing([[-181, 40], [-182, 40], [-181, 41]]), false);
});

test('a vertex with out-of-range latitude (>90) makes the ring unusable', () => {
  assert.equal(isUsableMatchRing([[-95, 91], [-94, 91], [-95, 92]]), false);
});

test('a vertex with out-of-range latitude (<-90) makes the ring unusable', () => {
  assert.equal(isUsableMatchRing([[-95, -91], [-94, -91], [-95, -92]]), false);
});

test('one out-of-range vertex among valid ones still makes the whole ring unusable', () => {
  assert.equal(isUsableMatchRing([[181, 40], [-95, 40], [-95, 41], [-96, 41]]), false);
});

test('a legitimate antimeridian polygon at exactly ±180 / ±90 stays usable (fail-stuck guard)', () => {
  assert.equal(isUsableMatchRing([[180, 89], [-180, 89], [-180, 90]]), true);
  assert.equal(isUsableMatchRing([[179.9, -89.9], [180, -89.9], [180, -90]]), true);
});
