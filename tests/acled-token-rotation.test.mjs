/**
 * ACLED OAuth token lifecycle — unit tests for the pure helper functions.
 *
 * Tests are offline and stateless: no HTTP, no sidecar process needed.
 *
 * Covers:
 *   - isAcledTokenExpiringSoon: null / fresh / expiring / expired
 *   - isRefreshTokenStale:      null / fresh / threshold / over-threshold
 *   - updateAcledTokenState:    expires_in capture / refresh token rotation / identity
 *   - exported constants
 */

import { strict as assert } from 'node:assert';
import test, { describe } from 'node:test';

import {
  isAcledTokenExpiringSoon,
  isRefreshTokenStale,
  updateAcledTokenState,
  ACLED_TOKEN_REFRESH_BUFFER_MS,
  ACLED_REFRESH_TOKEN_WARN_DAYS,
} from '../src-tauri/sidecar/acled-token-helpers.mjs';

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_780_000_000_000; // fixed reference timestamp

// ── Constants ─────────────────────────────────────────────────────────────────

describe('exported constants', () => {
  test('ACLED_TOKEN_REFRESH_BUFFER_MS is 5 minutes', () => {
    assert.equal(ACLED_TOKEN_REFRESH_BUFFER_MS, 5 * MIN_MS);
  });

  test('ACLED_REFRESH_TOKEN_WARN_DAYS is 90', () => {
    assert.equal(ACLED_REFRESH_TOKEN_WARN_DAYS, 90);
  });
});

// ── isAcledTokenExpiringSoon ──────────────────────────────────────────────────

describe('isAcledTokenExpiringSoon', () => {
  test('returns false when expiresAt is null (unknown expiry)', () => {
    assert.equal(isAcledTokenExpiringSoon(null, NOW), false);
  });

  test('returns false when expiresAt is undefined', () => {
    assert.equal(isAcledTokenExpiringSoon(undefined, NOW), false);
  });

  test('returns false when token expires well after the buffer window', () => {
    const expiresAt = NOW + 60 * MIN_MS; // 60 min from now
    assert.equal(isAcledTokenExpiringSoon(expiresAt, NOW), false);
  });

  test('returns true when token expires exactly at the buffer boundary', () => {
    const expiresAt = NOW + ACLED_TOKEN_REFRESH_BUFFER_MS; // now + 5 min
    assert.equal(isAcledTokenExpiringSoon(expiresAt, NOW), true);
  });

  test('returns true when token expires within the buffer window', () => {
    const expiresAt = NOW + 3 * MIN_MS; // 3 min → inside 5-min buffer
    assert.equal(isAcledTokenExpiringSoon(expiresAt, NOW), true);
  });

  test('returns true when token has already expired', () => {
    const expiresAt = NOW - MIN_MS; // 1 min ago
    assert.equal(isAcledTokenExpiringSoon(expiresAt, NOW), true);
  });

  test('respects a custom bufferMs argument', () => {
    const expiresAt = NOW + 2 * MIN_MS;
    assert.equal(isAcledTokenExpiringSoon(expiresAt, NOW, MIN_MS), false);   // 2 min left > 1 min buffer
    assert.equal(isAcledTokenExpiringSoon(expiresAt, NOW, 3 * MIN_MS), true); // 2 min left < 3 min buffer
  });
});

// ── isRefreshTokenStale ───────────────────────────────────────────────────────

describe('isRefreshTokenStale', () => {
  test('returns false when refreshIssuedAt is null (age unknown)', () => {
    assert.equal(isRefreshTokenStale(null, NOW), false);
  });

  test('returns false when refreshIssuedAt is undefined', () => {
    assert.equal(isRefreshTokenStale(undefined, NOW), false);
  });

  test('returns false when token is freshly issued (0 days)', () => {
    assert.equal(isRefreshTokenStale(NOW, NOW), false);
  });

  test('returns false when token is 89 days old', () => {
    const issuedAt = NOW - 89 * DAY_MS;
    assert.equal(isRefreshTokenStale(issuedAt, NOW), false);
  });

  test('returns true when token is exactly 90 days old', () => {
    const issuedAt = NOW - 90 * DAY_MS;
    assert.equal(isRefreshTokenStale(issuedAt, NOW), true);
  });

  test('returns true when token is 180 days old', () => {
    const issuedAt = NOW - 180 * DAY_MS;
    assert.equal(isRefreshTokenStale(issuedAt, NOW), true);
  });

  test('respects a custom warnDays argument', () => {
    const issuedAt = NOW - 30 * DAY_MS;
    assert.equal(isRefreshTokenStale(issuedAt, NOW, 60), false); // 30d < 60d threshold
    assert.equal(isRefreshTokenStale(issuedAt, NOW, 20), true);  // 30d > 20d threshold
  });
});

// ── updateAcledTokenState ────────────────────────────────────────────────────

describe('updateAcledTokenState', () => {
  const emptyState = { expiresAt: null, refreshToken: null, refreshIssuedAt: null };

  test('captures expiresAt from expires_in', () => {
    const result = updateAcledTokenState(emptyState, { access_token: 'tok', expires_in: 3600 }, NOW);
    assert.equal(result.expiresAt, NOW + 3600 * 1000);
  });

  test('preserves existing expiresAt when expires_in is absent', () => {
    const state = { ...emptyState, expiresAt: NOW + 1000 };
    const result = updateAcledTokenState(state, { access_token: 'tok' }, NOW);
    assert.equal(result.expiresAt, NOW + 1000);
  });

  test('preserves existing expiresAt when expires_in is non-numeric', () => {
    const state = { ...emptyState, expiresAt: NOW + 5000 };
    const result = updateAcledTokenState(state, { access_token: 'tok', expires_in: 'not-a-number' }, NOW);
    assert.equal(result.expiresAt, NOW + 5000);
  });

  test('stores a new refresh token from the response', () => {
    const result = updateAcledTokenState(emptyState, { access_token: 'tok', refresh_token: 'rt-new' }, NOW);
    assert.equal(result.refreshToken, 'rt-new');
  });

  test('resets refreshIssuedAt when a new refresh_token is returned', () => {
    const state = { ...emptyState, refreshToken: 'rt-old', refreshIssuedAt: NOW - DAY_MS };
    const result = updateAcledTokenState(state, { access_token: 'tok', refresh_token: 'rt-new' }, NOW);
    assert.equal(result.refreshIssuedAt, NOW);
  });

  test('preserves refreshIssuedAt when the same refresh_token is returned', () => {
    const originalIssuedAt = NOW - 10 * DAY_MS;
    const state = { ...emptyState, refreshToken: 'rt-same', refreshIssuedAt: originalIssuedAt };
    const result = updateAcledTokenState(state, { access_token: 'tok', refresh_token: 'rt-same' }, NOW);
    assert.equal(result.refreshIssuedAt, originalIssuedAt);
  });

  test('preserves refreshIssuedAt when no refresh_token is in the response', () => {
    const originalIssuedAt = NOW - 5 * DAY_MS;
    const state = { ...emptyState, refreshToken: 'rt-existing', refreshIssuedAt: originalIssuedAt };
    const result = updateAcledTokenState(state, { access_token: 'tok' }, NOW);
    assert.equal(result.refreshIssuedAt, originalIssuedAt);
  });

  test('does not mutate the input state object', () => {
    const state = { expiresAt: NOW + 1000, refreshToken: 'rt', refreshIssuedAt: NOW };
    updateAcledTokenState(state, { access_token: 'tok', expires_in: 7200, refresh_token: 'rt-new' }, NOW);
    assert.equal(state.expiresAt, NOW + 1000);
    assert.equal(state.refreshToken, 'rt');
    assert.equal(state.refreshIssuedAt, NOW);
  });

  test('handles zero expires_in as a valid expiry (already expired)', () => {
    const result = updateAcledTokenState(emptyState, { access_token: 'tok', expires_in: 0 }, NOW);
    assert.equal(result.expiresAt, NOW);
  });
});
