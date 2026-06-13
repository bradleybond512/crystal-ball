# Privacy — Accepted Residual Risks

**Last audited:** 2026-06-12
**Source audit:** `docs/PRIVACY_AUDIT_2026-06-11.md` (Privacy Fix 1 — secret-in-query-string containment)

This document records privacy exposures that have been reviewed and **accepted as
residual** because no client-side mitigation is possible. Each entry has a stated
reason and is revisited when the upstream changes its auth model.

## Secret-in-query-string (API keys in outbound URLs)

The fix goal was to move API keys out of URL query strings (where they can appear
in provider access logs) and into request headers or POST bodies. For the upstream
APIs below, this is **not possible**: the vendor's documented and only supported
auth mechanism is a query-string parameter. There is no header or POST-body auth to
move the key to. Forcing a header would simply break the integration.

These hosts are therefore allowlisted in the sidecar tripwire
(`QUERY_ONLY_KEY_HOST_SUFFIXES` in `src-tauri/sidecar/local-api-server.mjs`). The
tripwire still fires for **any other** host that carries an `access_key`, `apikey`,
or `key` query param — that signals a new code path reintroduced key-in-query where
header auth was actually available, and the key should be relocated instead of
allowlisted.

| Host suffix | Credential param | Why query-only | Notes |
|---|---|---|---|
| `mediastack.com` | `access_key` | Vendor docs: auth is `access_key` query param only; no header auth. | Free tier is also HTTPS-restricted; live key probe is skipped rather than sent over HTTP. |
| `aviationstack.com` | `access_key` | Vendor docs: `access_key` query param only; no header auth. | Same apilayer-family design as mediastack. |
| `geonames.org` | `username` | GeoNames identifies callers with a registered `username` query param; no header auth. | `username` is a semi-public quota identifier, not a bearer secret. Not flagged by the tripwire (param not in the credential set) but allowlisted for clarity. |
| `financialmodelingprep.com` | `apikey` | FMP auth is `apikey` query param only; no header auth. | |
| `newsdata.io` | `apikey` | NewsData.io documents `apikey` query param only; no confirmed header auth. | Re-check if NewsData adds an `X-ACCESS-KEY` (or similar) header — then migrate. |
| `511ny.org` | `key` | NY 511 events API uses a `key` query param; no header auth. | |
| `acleddata.com` | `key` | ACLED legacy API authenticates with `key` (+ email) query params. | If migrating to ACLED's newer OAuth flow, drop the query key and remove from allowlist. |
| `maptiler.com` | `key` | MapTiler tile/style URLs require the `key` query param by design (keys are referrer-restricted instead). | |
| `googleapis.com` | `key` | Google Maps Platform uses a `key` query param; no header auth. Keys are restricted by referrer/IP instead. | |
| `pulsedive.com` | `key` | Pulsedive API authenticates with a `key` query param; no header auth. | |

### Compensating controls

- **Tripwire / regression guard** — `warnIfSecretInQuery()` logs a non-fatal warning
  if any non-allowlisted host carries a credential query param, so new endpoints
  can't silently reintroduce key-in-query where header auth exists.
- **Log redaction** — `redactSecretsInUrl()` strips credential query params before a
  URL reaches any log line, so a credentialed URL is never written intact.
- **HTTPS-only** — all of these calls go over HTTPS (see PR for H-1/H-2), so the key
  is not exposed in transit; the residual exposure is limited to the provider's own
  server-side access logs, which is outside client control.

### Re-evaluation triggers

Revisit an entry when:

- the vendor announces header or OAuth auth (migrate the key off the query string);
- the integration is removed (drop the host from the allowlist);
- a new key-bearing integration is added (verify header auth first; only allowlist
  if the vendor is genuinely query-only).
