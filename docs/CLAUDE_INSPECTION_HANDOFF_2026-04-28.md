# Claude Inspection Handoff - 2026-04-28

## Context

Branch: `claude/fix-broken-panels`

Open PR: `#176` - Restore broken panels: 34 free-tier API handlers + UCDP token + classifier dedup

Base: `main`

Risk tier: `High`

This branch restores a large internet-facing API surface. The code checks are mostly green, but the PR is not ready to land until the process blockers and security/input-validation gaps below are handled.

## Current PR Status

`#176` is mergeable at the git level, but GitHub reports it as `UNSTABLE`.

Passing required/code checks:

- `actionlint`
- `bundle-size`
- `ESLint`
- `static-lint`
- `integrity-checks`
- `secret-scan`
- `typecheck`
- `release-doctor`

Blocking/non-green checks:

- `Cross-agent review marker` failed.
- `Create or update PR` failed.
- `Auto-merge when checks pass` skipped because the PR is not fully green.

Main still shows an older `Release Integrity` failure at commit `95d18b3`. PR `#177` appears intended to fix the tag-at-head/release-doctor issue before or alongside this branch.

## Local Verification Evidence

Fresh local checks run on `claude/fix-broken-panels`:

- `npm run lint:strict` - passed.
- `npm run typecheck:all` - passed.
- `npm run secrets:scan` - passed across 1974 files.
- `npm run secrets:scan:staged` - passed with no staged files.
- `npm run test:api` - passed, 36 tests.
- `npm run test:sidecar` - passed, 77 tests.
- `npm run build` - passed.
- Changed-file ESLint via `git diff --name-only origin/main...HEAD | rg '\.(js|mjs|ts|mts)$' | xargs npx eslint` - passed.

Important caveat: full `npm run lint` still reports a large pre-existing backlog because it scans broad repo/worktree paths, including `.claude/worktrees`. Do not use that failure as evidence against this branch unless the lint scope is fixed.

## Findings To Fix Before Main

### P0 - PR process blockers prevent auto-merge

PR `#176` will not make it to `main` until the failed cross-agent review marker and PR automation check are repaired.

Actions:

- Add or repair the required cross-agent review marker according to the repo workflow.
- Re-run or repair the failed `Create or update PR` automation.
- Re-enable auto-merge after all required checks are green.

### P1 - Key-backed arbitrary lookup endpoints need stronger abuse controls

Several public handlers accept arbitrary user input and spend provider API keys without application authentication or rate limiting. CORS is not an auth boundary, and no-origin server-to-server requests are usually allowed by these handlers.

Audit and harden these files first:

- `api/hibp-breaches.js`
- `api/virustotal-lookup.js`
- `api/ipinfo-lookup.js`
- `api/vulners-search.js`

Specific concerns:

- `api/hibp-breaches.js` exposes per-account breach lookup through the server HIBP key. That can become a breach oracle and quota drain.
- `api/virustotal-lookup.js` forwards arbitrary `indicator` values to VirusTotal with the server key.
- `api/ipinfo-lookup.js` forwards arbitrary `ip` values to IPinfo with the server token.
- `api/vulners-search.js` forwards arbitrary `query` values to Vulners with the server key.

Recommended fix:

- Require the app API key for key-backed arbitrary lookups, or make those lookup modes desktop-sidecar-only.
- Add rate limiting if this remains public.
- Clamp query lengths and validate indicator/IP/query shapes before making upstream calls.
- Add negative-path tests for missing auth, malformed inputs, and missing provider keys.

### P1 - `api/cyber-threats.js` likely uses the wrong runtime aggregation model

`api/cyber-threats.js` is an Edge route, but it aggregates by fetching `http://127.0.0.1:${LOCAL_API_PORT}`. In Vercel Edge/production, `127.0.0.1` will not reach sibling API handlers or the desktop sidecar.

Recommended fix:

- Aggregate sibling routes through the request origin, for example `new URL(s.path, req.url)`, if this route is meant for deployed web.
- Or share pure provider fetch functions and call them directly.
- Or explicitly mark this aggregate as local-desktop-only and avoid exposing a misleading deployed endpoint.
- Add a test that proves the route calls the intended origin instead of localhost in the deployed/API runtime.

### P1 - New API handlers lack systematic route-level coverage

`npm run test:api` passes, but the 34 new handlers are not systematically covered for:

- OPTIONS/CORS behavior.
- Required params.
- Bad params.
- Missing provider keys.
- Upstream failure/degraded response shape.
- Auth requirements for key-backed lookups.
- Limit/page-size clamps.

Recommended fix:

- Add focused tests for the highest-risk handlers first: HIBP, VirusTotal, IPinfo, Vulners, UCDP, and cyber aggregate.
- Add a small generic smoke table for all new API files so future additions cannot land without at least basic route coverage.

### P2 - Bad `limit` values can silently return empty CISA KEV results

`api/cisa-kev.js` parses `limit` with `Number.parseInt`, then clamps with `Math.min`/`Math.max`. If `limit=abc`, the value becomes `NaN` and `slice(0, NaN)` returns an empty array while the reported upstream count remains nonzero.

Recommended fix:

- Default non-finite limits to `100`.
- Clamp finite limits to `1..500`.
- Add tests for missing, valid, over-large, zero/negative, and non-numeric `limit`.

### P2 - UCDP query params need validation and page-size clamps

`api/ucdp.js` copies `Country`, `Region`, `StartDate`, `EndDate`, and `pagesize` to the upstream API. `pagesize` defaults to `200`, but untrusted query values should still be clamped and dates should be validated.

Recommended fix:

- Clamp `pagesize` to the upstream-supported range.
- Validate dates as ISO-like dates before forwarding.
- Constrain country/region fields to expected simple values.
- Add tests for invalid dates, nonnumeric page sizes, and over-large page sizes.

### P3 - Build warnings remain

`npm run build` passes, but still emits warnings:

- `index.html` line 14 parse5 warning for malformed attributes.
- Large chunk warnings over the configured warning budget.
- Dependency `eval` warning from Cesium/protobuf.
- Ineffective dynamic import warnings.

Recommended fix:

- Fix the malformed `index.html` tag now if the target is "highest standards".
- Track chunk and dependency warnings separately if they are pre-existing and not caused by this branch.

## Suggested Fix Order For Claude

1. Repair PR process requirements for `#176`: cross-agent marker, PR automation failure, and auto-merge setup.
2. Harden key-backed lookup routes with auth/rate-limit/input validation.
3. Fix `api/cyber-threats.js` aggregation so it works in the intended runtime.
4. Add focused tests for the hardened routes and the aggregate route.
5. Fix `api/cisa-kev.js` limit parsing and `api/ucdp.js` parameter validation.
6. Fix the `index.html` parse warning or explicitly document it as pre-existing if another PR owns it.
7. Re-run the verification commands below.

## Verification Commands

Run these after fixes:

```bash
npm run lint:strict
npm run typecheck:all
npm run secrets:scan
npm run test:api
npm run test:sidecar
npm run build
git diff --name-only origin/main...HEAD | rg '\.(js|mjs|ts|mts)$' | xargs npx eslint
gh pr checks 176
```

Use `npm run lint` only after fixing the repo lint scope, because the current broad lint command reports unrelated existing issues from extra worktree paths.

## Claude Prompt

```text
You are working in /Users/bradleybond/Developer/crystalball on branch claude/fix-broken-panels for PR #176.

Goal: get PR #176 genuinely ready to auto-merge into main under the Crystal Ball repo rules.

Start by reading docs/CLAUDE_INSPECTION_HANDOFF_2026-04-28.md, AGENTS.md, and the changed API handlers. Do not commit to main. Do not push to upstream/origin; use the configured user fork remote only. Stage specific files by name.

Fix the blockers in this order:
1. Repair the failed cross-agent review marker / PR automation state so required checks can go green and auto-merge can run.
2. Harden public key-backed lookup routes: api/hibp-breaches.js, api/virustotal-lookup.js, api/ipinfo-lookup.js, and api/vulners-search.js. CORS is not authentication. Require app API auth or otherwise restrict arbitrary provider-key spending paths, clamp inputs, and add negative-path tests.
3. Fix api/cyber-threats.js so the Edge/API runtime does not aggregate by fetching 127.0.0.1 unless the route is explicitly desktop-only. Prefer request-origin sibling URLs or shared provider functions.
4. Add route-level tests for the new handlers, prioritizing HIBP, VirusTotal, IPinfo, Vulners, UCDP, CISA KEV, and cyber-threats.
5. Fix api/cisa-kev.js nonnumeric limit behavior and api/ucdp.js page/date/query validation.
6. Fix the index.html parse5 build warning if it is in this branch's scope.

Before claiming done, run:
npm run lint:strict
npm run typecheck:all
npm run secrets:scan
npm run test:api
npm run test:sidecar
npm run build
git diff --name-only origin/main...HEAD | rg '\.(js|mjs|ts|mts)$' | xargs npx eslint
gh pr checks 176

Report exact files changed, test results, remaining PR checks, and any accepted residual risks.
```
