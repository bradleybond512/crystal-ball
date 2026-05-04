# Claude Extra Bug And Security Checks - 2026-04-29

Use this as a supplement to `docs/CLAUDE_REVIEW_FINDINGS_AND_PANEL_DATA_ROADMAP_2026-04-29.md`.
The goal is not a broad refactor. Close the remaining bug/security gaps that could
hide bad panel data, leak diagnostics, or let local/edge proxy routes drift into unsafe
behavior before the work lands on `main`.

## Current Verification Snapshot

These checks were run locally on 2026-04-29 and passed:

```bash
npm run secrets:scan
npm run lint:ci
npm run typecheck:all
npm run test:diagnostics
npm run test:sidecar
npm audit --omit=dev
```

Observed results:

- `secrets:scan`: passed for 2062 files.
- `lint:ci`: changed-file lint completed with exit 0.
- `typecheck:all`: completed with exit 0.
- `test:diagnostics`: 151 passing tests, 0 failures.
- `test:sidecar`: 77 passing tests, 0 failures.
- `npm audit --omit=dev`: 0 production vulnerabilities.

Do not treat those passes as "done." They prove the current baseline is clean; the
items below are the remaining hardening work to make the baseline meaningful.

## Priority 0 - Fold In The Existing Roadmap

Start by completing the known findings from the companion roadmap:

- Unknown algorithm metadata must fail closed and require user approval.
- Strategic diagnostics export sections must be structurally redacted.
- Panel smoke must exit non-zero when `node:test` reports failures, not only when
  the JSON offender report shows new baseline violations.
- Panel data gaps need route-by-route fixes, not cosmetic loading/degraded states.

Keep the route/panel work tied to tests so it actually makes it to `main` through PR
checks and auto-merge.

## Priority 1 - Diagnostics Redaction End To End

Diagnostics unit tests now cover strategic export redaction, but the app still has
multiple diagnostics surfaces:

- `src/services/diagnostics/export-bundle.ts`
- `src/services/log-bridge.ts`
- `src-tauri/src/main.rs` around `copy_diagnostics`
- sidecar `/api/diag`
- desktop and sidecar log tails included in copied diagnostics

Add an end-to-end diagnostics privacy test that builds or simulates the final copied
bundle and injects canary values:

- bearer tokens
- API keys
- emails
- raw lat/lng pairs
- long hex tokens
- provider request URLs containing query credentials

Expected behavior:

- No raw secret canary appears anywhere in the final copied bundle.
- Coordinates are coarsened or redacted consistently.
- Log lines are sanitized before they enter the copy bundle, not only after export.
- The test fails if a new section is added without redaction.

Security note: `copy_diagnostics` currently appends last log lines and `/api/diag`.
That is useful, but it means every future log/debug addition becomes part of the
privacy boundary.

## Priority 1 - Local Sidecar Trust Boundary Tests

The sidecar already has good coverage for token auth, CORS, RSS SSRF blocking, and
secret validation. Extend the coverage to the sensitive routes that can leak state or
mutate runtime configuration:

- `/api/local-env-update`
- `/api/local-validate-secret`
- `/api/local-status`
- `/api/local-traffic-log`
- `/api/local-debug-toggle`
- `/api/diag`
- any request-proxy or handler-forwarding path that can reach arbitrary upstreams

Add negative tests for each sensitive route:

- no `LOCAL_API_TOKEN`
- wrong token
- browser origin without trusted fetch metadata
- trusted referer without origin
- unsupported method
- malformed JSON body
- unknown env key

Expected behavior:

- Sensitive routes reject unauthenticated access when a token is configured.
- Health-only routes are the only intentional unauthenticated exceptions.
- Errors do not echo submitted secret values.
- Runtime env updates log key names only, never values.

Keep `LOCAL_API_TOKEN` fail-closed behavior intact; do not weaken it to make tests
easier.

## Priority 1 - SSRF And Open Proxy Regression Matrix

Current RSS proxy tests cover localhost, private IPv4 ranges, non-HTTP protocols, and
URLs with credentials. Add regression cases for the remaining bypass shapes:

- IPv6 loopback and private/reserved IPv6 literals.
- IPv4-mapped IPv6.
- decimal, octal, hex, and mixed IP encodings if Node URL accepts them.
- redirects from public URL to private/reserved URL.
- DNS names that resolve to both public and private addresses.
- DNS cache behavior when the same hostname changes from public to private.
- very long URLs and query strings.
- userinfo or credential-like data after redirects.

Expected behavior:

- The proxy blocks private/reserved destinations before the outbound request.
- Redirects are revalidated before following.
- The actual connection cannot go to a different address than the checked address.
- Logs strip query strings or redact sensitive parameters before writing.

Relevant files:

- `src-tauri/sidecar/local-api-server.mjs`
- `src-tauri/sidecar/local-api-server.test.mjs`
- `api/rss-proxy.js`
- `api/__tests__/rss-proxy.test.mjs`

## Priority 1 - Panel HTML/XSS Fixture Coverage

`src/components/Panel.ts` centralizes rendering through `setContent(html)` and writes
the string via `innerHTML`. Many panel implementations are safe only because they
manually call `escapeHtml`, `safeHtml`, or render controlled strings.

Add a fixture test suite for panels that render remote titles, descriptions, URLs,
feed names, provider errors, or diagnostics text. Inject malicious strings such as:

```html
<img src=x onerror=alert(1)>
<script>alert(1)</script>
javascript:alert(1)
" onmouseover="alert(1)
```

Expected behavior:

- Rendered HTML contains escaped text, not executable markup.
- Link URLs reject or neutralize `javascript:` and other unsafe schemes.
- The test fails when a panel passes remote strings directly into `innerHTML`.
- Any unavoidable raw HTML path is centralized and documented with a sanitizer.

Start with panels fed by external feeds or diagnostics data, then expand to the full
panel catalog.

## Priority 2 - Replace Scaffold-Only API Tests

Several API tests are still TODO scaffolds that only prove the handler imports and
handles trivial methods. Prioritize real assertions for high-risk or user-visible
routes:

- `api/__tests__/claude-agent.test.mjs`
- `api/__tests__/download.test.mjs`
- `api/__tests__/newsdata-feed.test.mjs`
- `api/__tests__/newsapi-headlines.test.mjs`
- `api/__tests__/rss-proxy.test.mjs`
- `api/__tests__/telegram-feed.test.mjs`
- `api/__tests__/ais-snapshot.test.mjs`
- `api/__tests__/opensky.test.mjs`
- `api/__tests__/gpsjam.test.mjs`
- `api/__tests__/local-logistics.test.mjs`

Minimum assertions:

- method handling
- CORS and origin behavior
- missing credential behavior
- upstream failure behavior
- timeout/degraded response shape
- no secret echoing in error responses
- cache headers where applicable

## Priority 2 - Make Production Scaffolds Explicitly Non-Default

`api/news-aggregate.js` is intentionally a scaffold and returns an empty response
shape with `scaffold: true`. Confirm no production/default client path treats that
as valid news data.

Fix criteria:

- Any client consuming `news-aggregate` must detect `scaffold: true` and fall back to
  live feed routes or show a clear degraded state.
- The panel smoke and data smoke should fail if scaffold data is rendered as if it is
  real data.
- The route should have a test proving that scaffold responses cannot silently satisfy
  user-facing "has data" checks.

## Priority 2 - Silent Catch Audit For Diagnostics-Critical Code

There are many `catch {}` and `catch { /* noop */ }` blocks. Some are acceptable for
storage quota, optional caches, or best-effort cleanup. They are not acceptable where
they hide:

- diagnostics export failures
- route import failures
- provider authentication failures
- sidecar startup or auth failures
- panel data loader failures
- self-test and sentinel feed audit failures

Add a lightweight rule and targeted tests:

- Silent catches are allowed for localStorage/cache cleanup only when the failure is
  intentionally non-actionable.
- Diagnostics-critical catches must emit a diagnostic event, log a sanitized warning,
  or surface a degraded reason.
- Provider auth failures must not collapse into generic "no data."

## Priority 2 - Degraded State Must Not Equal Success

The sidecar can gracefully return degraded shapes for missing local handlers. That is
better than crashing, but it can also hide broken panels if callers treat HTTP 200 as
success.

Add tests that assert:

- `degraded: true`, `rateLimited: true`, `scaffold: true`, or `error` payloads do not
  count as successful data.
- Panel health registries record degraded/failing status for those payloads.
- The panel smoke report separates "rendered fallback" from "has live data."
- Missing local handlers include route id, reason, and remediation in diagnostics.

## Priority 3 - Runtime Security Header And Origin Verification

Existing `_cors` and sidecar tests are strong, but add a runtime smoke that verifies
the headers that matter in the served app/API responses:

- `Vary: Origin` on CORS responses.
- No wildcard CORS for credentialed/sensitive routes.
- Trusted desktop/Tauri origins still work.
- Untrusted origins fail.
- Security headers/CSP are either present at runtime or explicitly documented as
  supplied by the hosting layer.

Do not widen CORS to make panels load. Fix missing local handlers, credentials, or
provider adapters instead.

## Priority 3 - Dependency And Runtime Drift

Current production dependency audit is clean. Add this to CI/release confidence:

```bash
npm audit --omit=dev
npm run secrets:scan
npm run lockfile:check
```

Also verify the release/runtime Node version. The local sidecar test output showed
Node `25.8.2`, while recent live sidecar diagnostics showed Node `22.14.0`. The app
should document and enforce the supported runtime so agent machines, CI, and the
installed desktop sidecar do not diverge.

## Required Final Verification

Before opening or updating the PR to `main`, run:

```bash
npm run lockfile:check
npm ci
npm run secrets:scan
npm run lint:ci
npm run typecheck:all
npm run test:diagnostics
npm run test:sidecar
npm run test:panels
npm audit --omit=dev
npm run build
```

If a command is too slow or blocked by missing credentials, document exactly why and
add the smallest deterministic mock/fixture test that covers the same behavior.

## Claude Prompt

```text
You are working in /Users/bradleybond/Developer/crystalball. Read AGENTS.md first and follow the branch/PR-to-main rules. Then read docs/CLAUDE_REVIEW_FINDINGS_AND_PANEL_DATA_ROADMAP_2026-04-29.md and docs/CLAUDE_EXTRA_BUG_SECURITY_CHECKS_2026-04-29.md. Fix the P1/P2 review findings, panel-data failures, diagnostics/privacy gaps, sidecar trust-boundary gaps, SSRF/open-proxy regression gaps, panel HTML/XSS fixture coverage, scaffold-only API tests, and degraded-state success masking. Keep changes scoped, add tests for each fix, run the required verification commands, then push an agent branch and open a PR targeting main with auto-merge after required checks pass.
```
