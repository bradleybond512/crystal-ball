/**
 * Build-time stand-in for `@spz-loader/core` (vite alias, R3-SEC-004).
 *
 * Cesium decodes SPZ-compressed Gaussian splats with an Emscripten embind
 * build that compiles its invokers with the Function constructor. The CSP has no
 * 'unsafe-eval', so that decoder could never run in Crystal Ball, and the app
 * loads no Gaussian-splat content. Aliasing it here keeps eval-capable code
 * out of the bundle; a splat tile fails with this error (Cesium records it as
 * the loader's error) instead of a CSP EvalError.
 */
export const SPZ_UNSUPPORTED_MESSAGE =
  "SPZ Gaussian splats are not supported in Crystal Ball: the decoder needs eval, which the CSP forbids (R3-SEC-004).";

export function loadSpz(): Promise<never> {
  return Promise.reject(new Error(SPZ_UNSUPPORTED_MESSAGE));
}

export function loadSpzFromUrl(): Promise<never> {
  return Promise.reject(new Error(SPZ_UNSUPPORTED_MESSAGE));
}
