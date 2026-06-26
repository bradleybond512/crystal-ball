/**
 * Safety-critical realtime feed paths: NWS alerts, IPAWS active alerts,
 * severe-weather outlooks, volcano alerts, earthquakes.
 *
 * For these feeds a STALE response served during a connectivity gap is
 * dangerous — an active tornado/severe warning would render as a fresh
 * "all-clear" with no staleness indicator. So the web-build service worker must
 * NEVER cache them: they get a NetworkOnly (fail-closed) handler and are
 * excluded from the catch-all `api-responses` NetworkFirst rule, ensuring the
 * sidecar's deliberate 503 `{stale:true}` reaches the renderer instead of a
 * up-to-4h-stale cached 200. (Desktop/Tauri purges the SW + is cross-origin, so
 * this only affects the web build.)
 *
 * Imported by vite.config.ts (the Workbox runtimeCaching rules) and unit-tested
 * so the safety set can't silently drift back into the cacheable rule.
 */
export const SAFETY_FEED_PATH_RE =
  /^\/api\/(?:nws-alerts|alerts\/active|volcano-alerts|earthquakes|weather\/active-warnings|weather\/spc-outlook)(?:\/|$)/;

/** True when `pathname` is a safety-critical realtime feed that must not be
 *  served from the service-worker cache. */
export function isSafetyFeedPath(pathname: string): boolean {
  return SAFETY_FEED_PATH_RE.test(pathname);
}
