/**
 * timeCoherentRadius — guarantees a Cesium ellipse's semiMajorAxis and
 * semiMinorAxis (two separate getValue() reads of the same property) see one
 * value per frame, so an animated radius can't make semiMinor > semiMajor and
 * halt the render loop.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JulianDate } from 'cesium';

import { timeCoherentRadius } from '../time-coherent-radius.ts';

const at = (ms: number): JulianDate => JulianDate.fromDate(new Date(ms));

test('two reads at the SAME time return the identical value even as the source grows', () => {
  let n = 0;
  const r = timeCoherentRadius(() => (n += 100)); // grows 100 every actual compute
  const t = at(1000);
  const semiMajor = r.getValue(t);
  const semiMinor = r.getValue(t);
  // Both axis reads happen at the same JulianDate → same cached value → the
  // "semiMajorAxis must be >= semiMinorAxis" invariant holds (equal is valid).
  assert.equal(semiMajor, semiMinor);
  assert.equal(semiMajor, 100);
});

test('a later frame recomputes (animation still advances)', () => {
  let n = 0;
  const r = timeCoherentRadius(() => (n += 100));
  assert.equal(r.getValue(at(1000)), 100); // frame 1
  assert.equal(r.getValue(at(1000)), 100); // same frame, cached
  assert.equal(r.getValue(at(2000)), 200); // next frame recomputes
  assert.equal(r.getValue(at(2000)), 200); // cached again
});

test('a missing clock time is handled without crashing (defensive)', () => {
  const r = timeCoherentRadius(() => 42);
  // The ellipse code always passes a JulianDate; this just guards the no-clock
  // path from throwing.
  assert.equal(typeof r.getValue(undefined as unknown as JulianDate), 'number');
});
