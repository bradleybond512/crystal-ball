/**
 * Shared auth helper for handlers that spend provider-side API keys on
 * arbitrary user input (HIBP account lookup, VirusTotal indicator
 * lookup, IPinfo IP lookup, Vulners query, etc.).
 *
 * Why this exists: CORS is not authentication. An origin allowlist
 * blocks browsers, but no-origin server-to-server requests sail
 * through. Without a real auth gate these routes can be turned into a
 * key-spending oracle and / or a quota drain by anyone who can reach
 * the deployment.
 *
 * Two-mode gate:
 *
 * - Sidecar runtime (process.env.LOCAL_API_PORT is set): the sidecar
 *   already enforces a global LOCAL_API_TOKEN auth check before the
 *   route handler runs, so we no-op here.
 * - Cloud / edge runtime (LOCAL_API_PORT is absent): require the
 *   request to carry an `X-CrystalBall-Key` header matching the
 *   server-side `CRYSTALBALL_APP_KEY` env var. Without that env var
 *   set, we refuse outright — fail-closed by design so a deploy that
 *   forgets to configure the gate does not leak the provider key.
 */

const CORS_HEADER_NAME = 'X-CrystalBall-Key';

function jsonError(status, payload, cors) {
  return Response.json(payload, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  });
}

/**
 * Returns null when the request is allowed to proceed. Otherwise
 * returns a fully-formed Response that the handler must return as-is.
 */
export function requireAppAuth(req, cors) {
  // Sidecar mode — the global auth gate already ran before us.
  if (process.env.LOCAL_API_PORT) return null;

  // Cloud / edge mode.
  const expected = process.env.CRYSTALBALL_APP_KEY;
  if (!expected) {
    // Fail-closed. The deployment hasn't been configured for arbitrary
    // lookups, so refuse. Sidecar callers never hit this path.
    return jsonError(403, {
      error: 'Server-side lookup is sidecar-only on this deployment.',
      hint: `Set CRYSTALBALL_APP_KEY server-side and pass ${CORS_HEADER_NAME} on the client to enable.`,
    }, cors);
  }
  const provided = req.headers.get('x-crystalball-key') || '';
  if (provided !== expected) {
    return jsonError(401, { error: 'Auth required' }, cors);
  }
  return null;
}

/**
 * Bound a free-text query parameter so a malicious caller can't push
 * arbitrarily long payloads through to the upstream provider. Returns
 * the trimmed/clamped string, or '' if missing.
 */
export function clampQueryParam(value, maxLength) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

const RE_IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
// IPv6 acceptance is intentionally lenient — we just block obvious junk.
const RE_IPV6_CHARS = /^[0-9a-f:.]{1,45}$/i;

export function isLikelyIp(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (RE_IPV4.test(v)) return v.split('.').every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
  return RE_IPV6_CHARS.test(v) && v.includes(':');
}

// Conservative account-identifier validator: emails (RFC-ish) or simple
// alphanumeric handles. We don't need to be exhaustive — we just need
// to refuse newlines, NULs, and obvious injection vectors before
// shipping the value to a provider.
const RE_ACCOUNT = /^[A-Za-z0-9._@+-]{1,256}$/;
export function isLikelyAccount(value) {
  return typeof value === 'string' && RE_ACCOUNT.test(value);
}
