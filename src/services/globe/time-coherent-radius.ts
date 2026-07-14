import { CallbackProperty, JulianDate } from 'cesium';

/**
 * A Cesium `CallbackProperty` whose value is computed at most once per clock
 * tick, so repeated reads within a single frame return the identical value.
 *
 * WHY: Cesium evaluates an ellipse's `semiMajorAxis` and `semiMinorAxis` as two
 * separate `getValue()` calls, even when both point at the same property
 * instance. When the radius is derived from `Date.now()` / live animation state
 * it can GROW between those two calls, making `semiMinorAxis > semiMajorAxis` —
 * which throws `DeveloperError: semiMajorAxis must be greater than or equal to
 * the semiMinorAxis` and HALTS the entire Cesium render loop (observed live
 * 2026-07-14 in God's Eye). Caching by the evaluation time guarantees both axes
 * see the same value.
 *
 * Use for any animated/pulsing ellipse that feeds one radius into both axes:
 *   ellipse: { semiMajorAxis: r, semiMinorAxis: r }  where  r = timeCoherentRadius(...)
 */
export function timeCoherentRadius(compute: () => number): CallbackProperty {
  let lastKey = Number.NaN;
  let lastValue = 0;
  return new CallbackProperty((time?: JulianDate) => {
    const key = time === undefined ? Number.NaN : JulianDate.toDate(time).getTime();
    if (!Number.isNaN(key) && key === lastKey) return lastValue;
    lastKey = key;
    lastValue = compute();
    return lastValue;
  }, false);
}
