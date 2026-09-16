import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchTargetHost, type FetchRoutingEnv } from '../runtime';

const TAURI_HREF = 'tauri://localhost/index.html';
const SIDECAR = 'http://127.0.0.1:46123';
const EDGE = 'https://api.crystalball.app';

/** Desktop: installRuntimeFetchPatch reroutes app-origin /api/* to the sidecar. */
const desktop: FetchRoutingEnv = {
  apiBaseUrl: SIDECAR,
  webRedirectBaseUrl: '',
  pageHref: TAURI_HREF,
};

/** Web with the edge redirect installed. */
const web: FetchRoutingEnv = {
  apiBaseUrl: '',
  webRedirectBaseUrl: EDGE,
  pageHref: 'https://crystalball.app/app',
};

/** Web with no VITE_WS_API_URL, or one the allowlist rejected. */
const webNoRedirect: FetchRoutingEnv = { ...web, webRedirectBaseUrl: '' };

test('a relative /api path is attributed to the sidecar, not the tauri origin', () => {
  // The bug: log-bridge wraps fetch OUTSIDE installRuntimeFetchPatch, so it sees
  // '/api/x' before the rewrite. Resolved against tauri://localhost that produced
  // the phantom host 'localhost' — a host the app never contacts, since CSP allows
  // 127.0.0.1 only — and split each sidecar failure across two buckets.
  assert.equal(fetchTargetHost('/api/health', desktop), '127.0.0.1:46123');
});

// Every input shape getApiTargetFromRequestInput accepts is rerouted by the patch,
// so every one of them must be attributed to the sidecar rather than to the origin.
test('the app-origin absolute form of a sidecar call shares the sidecar bucket', () => {
  assert.equal(fetchTargetHost('tauri://localhost/api/health', desktop), '127.0.0.1:46123');
});

test('a URL instance for a sidecar call shares the sidecar bucket', () => {
  assert.equal(fetchTargetHost(new URL('tauri://localhost/api/health'), desktop), '127.0.0.1:46123');
});

test('a Request instance for a sidecar call shares the sidecar bucket', () => {
  assert.equal(fetchTargetHost(new Request('http://localhost/api/health'), desktop), '127.0.0.1:46123');
});

test('all four input shapes for one endpoint land in a single bucket', () => {
  const hosts = new Set([
    fetchTargetHost('/api/health', desktop),
    fetchTargetHost('tauri://localhost/api/health', desktop),
    fetchTargetHost(new URL('tauri://localhost/api/health'), desktop),
    fetchTargetHost(new Request('http://localhost/api/health'), desktop),
  ]);
  assert.deepEqual([...hosts], ['127.0.0.1:46123'], 'one backend must not be counted under several host names');
});

test('non-/api desktop requests keep their own host', () => {
  assert.equal(fetchTargetHost('https://api.weather.gov/alerts', desktop), 'api.weather.gov');
  assert.equal(fetchTargetHost('/map-styles/dark.json', desktop), 'localhost');
});

test('a path merely containing /api/ is not treated as a sidecar call', () => {
  // Only app-origin targets whose path starts with /api/ are rewritten.
  assert.equal(fetchTargetHost('https://example.com/api/v1', desktop), 'example.com');
});

test('web RPC calls are attributed to the edge the redirect sends them to', () => {
  // installWebApiRedirect rewrites /api/<service>/v1/* off desktop; resolving
  // against the page origin would credit those to crystalball.app instead.
  assert.equal(fetchTargetHost('/api/military/v1/posture', web), 'api.crystalball.app');
  assert.equal(fetchTargetHost(new URL('https://crystalball.app/api/military/v1/posture'), web), 'api.crystalball.app');
});

// The web redirect matches per input shape rather than on a normalized path, and
// attribution has to reproduce that or it credits the edge for calls the wrapper
// waved through. Desktop is unaffected: its router normalizes first.
test('an app-origin absolute string is NOT redirected on web', () => {
  // installWebApiRedirect tests the raw string against an anchored pattern, so
  // only a relative path matches — the absolute form reaches the page host.
  assert.equal(fetchTargetHost('https://crystalball.app/api/military/v1/posture', web), 'crystalball.app');
});

test('a sibling app host is not same-origin, so the redirect leaves it alone', () => {
  assert.equal(
    fetchTargetHost(new URL('https://tech.crystalball.app/api/military/v1/posture'), web),
    'tech.crystalball.app',
  );
});

test('a same-origin Request for an RPC path is redirected', () => {
  assert.equal(fetchTargetHost(new Request('https://crystalball.app/api/military/v1/posture'), web), 'api.crystalball.app');
});

test('the same absolute URL is attributed differently by shape, exactly as it is routed', () => {
  const raw = 'https://crystalball.app/api/military/v1/posture';
  assert.equal(fetchTargetHost(raw, web), 'crystalball.app', 'string: not redirected');
  assert.equal(fetchTargetHost(new URL(raw), web), 'api.crystalball.app', 'URL: redirected');
});

test('desktop still normalizes every shape onto the sidecar', () => {
  // Only the web wrapper is shape-sensitive; the desktop router asks
  // getApiTargetFromRequestInput, which accepts all four forms.
  assert.equal(fetchTargetHost('tauri://localhost/api/military/v1/posture', desktop), '127.0.0.1:46123');
});

test('web paths outside the RPC pattern stay on the page origin', () => {
  // The redirect only matches /api/<service>/v1/ — /api/health is served same-origin.
  assert.equal(fetchTargetHost('/api/health', web), 'crystalball.app');
  assert.equal(fetchTargetHost('/map-styles/dark.json', web), 'crystalball.app');
});

test('with no redirect installed, web RPC calls stay on the page origin', () => {
  assert.equal(fetchTargetHost('/api/military/v1/posture', webNoRedirect), 'crystalball.app');
});

test('unparseable input is bucketed as unknown rather than throwing', () => {
  assert.equal(fetchTargetHost('::::', { apiBaseUrl: '', webRedirectBaseUrl: '', pageHref: '' }), 'unknown');
});
