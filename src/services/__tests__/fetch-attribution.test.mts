import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apiAwareBaseFor } from '../log-bridge';
import { isCallerCancellation } from '../caller-abort';

const TAURI_HREF = 'tauri://localhost/index.html';
const SIDECAR = 'http://127.0.0.1:46123';

test('relative /api paths are attributed to the sidecar, not the tauri origin', () => {
  // The bug: log-bridge wraps fetch OUTSIDE installRuntimeFetchPatch, so it sees
  // '/api/x' before the rewrite. Resolved against tauri://localhost that produced
  // the phantom host 'localhost' — a host the app never contacts, since CSP allows
  // 127.0.0.1 only — and split each sidecar failure across two burst buckets.
  const host = new URL('/api/health', apiAwareBaseFor('/api/health', SIDECAR, TAURI_HREF)).host;
  assert.equal(host, '127.0.0.1:46123');
  assert.notEqual(host, 'localhost');
});

test('a sidecar-bound relative path and its already-absolute twin share one bucket', () => {
  const relative = new URL('/api/health', apiAwareBaseFor('/api/health', SIDECAR, TAURI_HREF)).host;
  const absolute = new URL(`${SIDECAR}/api/health`, apiAwareBaseFor(`${SIDECAR}/api/health`, SIDECAR, TAURI_HREF)).host;
  assert.equal(relative, absolute, 'the same backend must not be counted under two host names');
});

test('off-desktop (empty api base) keeps resolving against the page', () => {
  const href = 'https://crystalball.app/app';
  assert.equal(apiAwareBaseFor('/api/health', '', href), href);
  assert.equal(new URL('/api/health', apiAwareBaseFor('/api/health', '', href)).host, 'crystalball.app');
});

test('non-/api requests are unaffected', () => {
  assert.equal(apiAwareBaseFor('/map-styles/dark.json', SIDECAR, TAURI_HREF), TAURI_HREF);
  assert.equal(apiAwareBaseFor('https://api.weather.gov/alerts', SIDECAR, TAURI_HREF), TAURI_HREF);
  assert.equal(
    new URL('https://api.weather.gov/alerts', apiAwareBaseFor('https://api.weather.gov/alerts', SIDECAR, TAURI_HREF)).host,
    'api.weather.gov',
  );
});

test('a path merely containing /api/ is not rewritten', () => {
  // Only the leading-slash form is what installRuntimeFetchPatch rewrites.
  assert.equal(apiAwareBaseFor('https://example.com/api/v1', SIDECAR, TAURI_HREF), TAURI_HREF);
});

const abortError = () => new DOMException('Fetch is aborted', 'AbortError');

test('the runtime 15s fetch timeout is not treated as caller cancellation', () => {
  // No caller signal at all — the abort came from AbortSignal.timeout inside the
  // runtime fetch patch. Rethrowing it is what produced the observed
  // "unhandledrejection: Fetch is aborted" errors from getTheaterPosture/getRiskScores.
  assert.equal(isCallerCancellation(abortError(), undefined), false);
});

test('an un-fired caller signal does not claim an abort', () => {
  const controller = new AbortController();
  assert.equal(isCallerCancellation(abortError(), controller.signal), false);
});

test('a fired caller signal does propagate its cancellation', () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(isCallerCancellation(abortError(), controller.signal), true);
});

test('a non-abort failure is never mistaken for cancellation', () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(isCallerCancellation(new TypeError('Load failed'), controller.signal), false);
  assert.equal(isCallerCancellation(new DOMException('timed out', 'TimeoutError'), controller.signal), false);
});
