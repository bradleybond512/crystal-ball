import { CallbackProperty } from 'cesium';
import type { Scene } from 'cesium';

/**
 * A shared, monotonically increasing render-frame counter. Bumped once per
 * rendered frame via each registered scene's `postRender` event.
 *
 * WHY NOT the clock: `timeCoherentRadius` originally keyed its cache on the
 * Cesium clock's `currentTime`. But `Clock.shouldAnimate` defaults to false and
 * God's Eye never turns it on (only GlobeTimeMachine flips it, transiently), so
 * `Clock.tick()` never advances `currentTime`. Keying on a frozen time meant the
 * radius was computed ONCE and never again — the pulsing/expanding rings froze
 * (alert pulses collapsed to ~0 radius, other layers to a static ring). Keying
 * on a per-frame counter instead animates regardless of the clock.
 */
let frameCounter = 0;
const wiredScenes = new WeakSet<object>();

/**
 * Register a scene to advance the shared frame counter once per rendered frame.
 * Idempotent per scene. Call once when the God's Eye viewer is created — every
 * `timeCoherentRadius` in every layer shares the one counter.
 *
 * `postRender` fires at the END of a frame (after the update pass that reads the
 * ellipse axes), never BETWEEN the two synchronous axis reads, so within a frame
 * the counter is constant and both axes always agree — the crash cannot recur.
 * The listener lives on the scene, so it stops when the viewer is destroyed (no
 * standalone rAF burning CPU while God's Eye is closed).
 */
export function ensureFrameCoherence(scene: Scene): void {
  if (wiredScenes.has(scene)) return;
  wiredScenes.add(scene);
  scene.postRender.addEventListener(() => { frameCounter += 1; });
}

/** Test-only: advance the frame counter without a live scene. */
export function __bumpFrameForTest(): void { frameCounter += 1; }

/**
 * A Cesium `CallbackProperty` whose value is recomputed at most once per rendered
 * frame, so the two reads of an ellipse's `semiMajorAxis` and `semiMinorAxis`
 * within one frame return the identical value.
 *
 * WHY: Cesium evaluates the two axes as separate `getValue()` calls even when
 * both point at the same property instance. A radius derived from `Date.now()`
 * can GROW between those calls, making `semiMinorAxis > semiMajorAxis` — which
 * throws `DeveloperError: semiMajorAxis must be greater than or equal to the
 * semiMinorAxis` and HALTS the entire Cesium render loop. Caching per frame
 * guarantees both axes see one value while still advancing between frames.
 *
 * Requires the hosting scene to be registered via {@link ensureFrameCoherence}.
 *
 * Use for any animated/pulsing ellipse that feeds one radius into both axes:
 *   ellipse: { semiMajorAxis: r, semiMinorAxis: r }  where  r = timeCoherentRadius(...)
 */
export function timeCoherentRadius(compute: () => number): CallbackProperty {
  let lastFrame = -1;
  let lastValue = 0;
  return new CallbackProperty(() => {
    if (frameCounter === lastFrame) return lastValue;
    lastFrame = frameCounter;
    lastValue = compute();
    return lastValue;
  }, false);
}
