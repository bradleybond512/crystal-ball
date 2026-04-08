export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const SCENE_SCALE = 1 / 6_378_137;

export function cartesian3ToThreeJS(ecef: Vec3): Vec3 {
  return {
 x: ecef.x,
 y: ecef.z,
 z: -ecef.y || 0,
  };
}

export function threeJSToCartesian3(three: Vec3): Vec3 {
  return {
 x: three.x,
 y: -three.z || 0,
 z: three.y,
  };
}

export function metersToSceneUnits(meters: number): number {
  return meters * SCENE_SCALE;
}

export function sceneUnitsToMeters(units: number): number {
  return units / SCENE_SCALE;
}

export function extractCameraMatrices(
  viewMatrix: ArrayLike<number>,
  projectionMatrix: ArrayLike<number>,
): { view: Float64Array; projection: Float64Array } {
  return {
 view: Float64Array.from(viewMatrix),
 projection: Float64Array.from(projectionMatrix),
  };
}
