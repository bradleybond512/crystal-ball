import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('cesium-three-bridge', () => {
  describe('cartesian3ToThreeJS', () => {
 it('converts ECEF origin to Three.js origin', async () => {
 const { cartesian3ToThreeJS } = await import(
 '../src/services/cesium-three-bridge.ts'
 );
 const result = cartesian3ToThreeJS({ x: 0, y: 0, z: 0 });
 assert.deepStrictEqual(result, { x: 0, y: 0, z: 0 });
 });

 it('swaps Y and Z axes (ECEF Z-up to Three.js Y-up)', async () => {
 const { cartesian3ToThreeJS } = await import(
 '../src/services/cesium-three-bridge.ts'
 );
 const result = cartesian3ToThreeJS({ x: 1000, y: 2000, z: 3000 });
 assert.equal(result.x, 1000);
 assert.equal(result.y, 3000);
 assert.equal(result.z, -2000);
 });
  });

  describe('threeJSToCartesian3', () => {
 it('round-trips through both transforms', async () => {
 const { cartesian3ToThreeJS, threeJSToCartesian3 } = await import(
 '../src/services/cesium-three-bridge.ts'
 );
 const original = { x: 6378137, y: 0, z: 6356752 };
 const threePos = cartesian3ToThreeJS(original);
 const back = threeJSToCartesian3(threePos);
 assert.equal(back.x, original.x);
 assert.equal(back.y, original.y);
 assert.equal(back.z, original.z);
 });
  });

  describe('metersToSceneUnits', () => {
 it('scales Earth radius to manageable scene units', async () => {
 const { metersToSceneUnits, SCENE_SCALE } = await import(
 '../src/services/cesium-three-bridge.ts'
 );
 const earthRadius = 6378137;
 const scaled = metersToSceneUnits(earthRadius);
 assert.equal(scaled, earthRadius * SCENE_SCALE);
 assert(scaled < 10000, `Scaled value ${scaled} should be < 10000`);
 });
  });
});
