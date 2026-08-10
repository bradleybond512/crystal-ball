/**
 * Distinguishes a caller's own cancellation from an abort the runtime raised on
 * its own behalf.
 *
 * `installRuntimeFetchPatch` arms a fresh `AbortSignal.timeout(15_000)` on every
 * request that does not carry a caller signal, so a slow sidecar body read surfaces
 * in a catch block as an `AbortError` with no caller involved. Rethrowing that on
 * sight escapes as an `unhandledrejection` — reported as a renderer ERROR — instead
 * of taking the cache fallback every other failure gets. Only rethrow when the
 * caller's signal is the one that fired.
 */
export function isCallerCancellation(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true && error instanceof DOMException && error.name === 'AbortError';
}
