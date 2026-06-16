/**
 * Pure helper logic for ACLED OAuth token lifecycle management.
 * Extracted here so the sidecar server and unit tests can share the same
 * implementations without spinning up an HTTP server in tests.
 */

export const ACLED_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // proactive refresh 5 min before expiry
export const ACLED_REFRESH_TOKEN_WARN_DAYS = 90; // warn when refresh token hasn't rotated in 90 days

/**
 * Returns true when the access token expires within `bufferMs` from `now`.
 * Returns false when expiresAt is null (unknown expiry → no proactive refresh).
 */
export function isAcledTokenExpiringSoon(
  expiresAt,
  now = Date.now(),
  bufferMs = ACLED_TOKEN_REFRESH_BUFFER_MS,
) {
  if (expiresAt == null) return false;
  return now >= expiresAt - bufferMs;
}

/**
 * Returns true when the refresh token was first seen more than `warnDays` ago.
 * Returns false when refreshIssuedAt is null (unknown age → no warning).
 */
export function isRefreshTokenStale(
  refreshIssuedAt,
  now = Date.now(),
  warnDays = ACLED_REFRESH_TOKEN_WARN_DAYS,
) {
  if (refreshIssuedAt == null) return false;
  return now - refreshIssuedAt >= warnDays * 24 * 60 * 60 * 1000;
}

/**
 * Merges a successful OAuth response into the in-memory token state.
 * Resets `refreshIssuedAt` only when a genuinely new refresh_token is returned.
 *
 * @param {object} state - current { expiresAt, refreshToken, refreshIssuedAt }
 * @param {object} oauthData - parsed OAuth response body
 * @param {number} now - current timestamp (ms)
 * @returns {object} next state (shallow-merge into caller's state object)
 */
export function updateAcledTokenState(state, oauthData, now = Date.now()) {
  const expiresIn = typeof oauthData.expires_in === 'number' ? oauthData.expires_in : null;
  const newRefreshToken = oauthData.refresh_token ?? null;
  const rotated = newRefreshToken != null && newRefreshToken !== state.refreshToken;
  return {
    expiresAt: expiresIn != null ? now + expiresIn * 1000 : state.expiresAt,
    refreshToken: newRefreshToken ?? state.refreshToken,
    refreshIssuedAt: rotated ? now : state.refreshIssuedAt,
  };
}
