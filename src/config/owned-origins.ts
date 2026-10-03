/**
 * Web origins Bradley controls (R4-SEC-008). Only these may appear in a CSP,
 * a CORS allowlist, APP_HOSTS, share links or "canonical site" fallbacks.
 * The former `.app` product domain is NOT ours (it is for sale) and must never return;
 * tests/owned-domains.test.mjs enforces this across the codebase.
 *
 * Mirrors: SIDECAR_OWNED_WEB_HOSTS (src-tauri/sidecar/local-api-server.mjs),
 * api/_cors.js, api/_api-key.js, server/cors.ts.
 */
export const OWNED_WEB_HOSTS: readonly string[] = Object.freeze(['bradleybond512.github.io']);

/** Origin of the GitHub Pages web build. */
export const OWNED_SITE_ORIGIN = 'https://bradleybond512.github.io';

/** Public URL of the web build (GitHub Pages project site). */
export const OWNED_SITE_URL = 'https://bradleybond512.github.io/crystal-ball/';

/** Public source repository (used in User-Agent strings and "about" links). */
export const PROJECT_REPO_URL = 'https://github.com/bradleybond512/crystal-ball';
