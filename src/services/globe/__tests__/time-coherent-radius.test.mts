/**
 * timeCoherentRadius — guarantees a Cesium ellipse's semiMajorAxis and
 * semiMinorAxis (two separate getValue() reads of the same property) see one
 * value per rendered frame, so an animated radius can't make semiMinor >
 * semiMajor and halt the render loop — while still advancing between frames so
 * the pulse animates even when the Cesium clock is frozen (shouldAnimate=false).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { timeCoherentRadius, __bumpFrameForTest } from '../time-coherent-radius.ts';

test('two reads within the SAME frame return the identical value even as the source grows', () => {
  let n = 0;
  const r = timeCoherentRadius(() => (n += 100)); // grows 100 every actual compute
  // Both axis reads happen in one frame (no frame bump between them) → same
  // cached value → the "semiMajorAxis must be >= semiMinorAxis" invariant holds.
  const semiMajor = r.getValue();
  const semiMinor = r.getValue();
  assert.equal(semiMajor, semiMinor);
});

test('a new rendered frame recomputes (animation advances) — NOT tied to the clock', () => {
  let n = 0;
  const r = timeCoherentRadius(() => (n += 100));
  const frame1 = r.getValue();
  const frame1Again = r.getValue(); // same frame → cached
  assert.equal(frame1, frame1Again);
  __bumpFrameForTest(); // scene.postRender fired → next frame
  const frame2 = r.getValue();
  assert.notEqual(frame1, frame2); // recomputed on the new frame
  assert.ok(frame2 > frame1);
});

test('the value ignores the JulianDate/time argument entirely (clock-independent)', () => {
  let n = 0;
  const r = timeCoherentRadius(() => (n += 5));
  // Passing wildly different "times" must NOT invalidate the cache — only a
  // frame bump does. This is what makes it work while the clock is frozen.
  const a = r.getValue(undefined as unknown as never);
  const b = r.getValue({} as unknown as never);
  assert.equal(a, b);
});
