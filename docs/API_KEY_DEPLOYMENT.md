# Cloud API Access

This document describes how the Vercel-hosted API routes decide whether a request may proceed.

## Overview

Crystal Ball desktop is local-first, but the cloud API remains an explicit trust boundary separate from the localhost sidecar.

The former `crystalball.app` product/API domains are retired and must not be used
as deployment or trust recommendations. No replacement public API origin has been
verified. These rules describe the auth helpers; a deployment's origin allowlist
must also reflect the domain-retirement repair. Removal from this revision's runtime/API
allowlists remains pending [#1813](https://github.com/bradleybond512/crystal-ball/pull/1813);
the retirement recommendation alone does not remove those trust entries. A custom `VITE_WS_API_URL` should
name only an operator-controlled or independently verified endpoint. Leaving it
empty preserves same-origin requests and does not provision a backend for a static
web deployment.

- Local desktop calls go to the sidecar first and use `Authorization: Bearer <LOCAL_API_TOKEN>`.
- Vercel-hosted routes use origin-aware validation plus browser fetch metadata checks in `api/_api-key.js`.
- Read requests from trusted Crystal Ball origins can omit `X-CrystalBall-Key` when they have accepted browser fetch metadata; non-read requests require a valid key.
- Desktop-origin requests to Vercel routes require `X-CrystalBall-Key` and must match `CRYSTALBALL_VALID_KEYS`.
- Unknown origins also require a valid key.

## Access Rules

`validateApiKey(req)` in `api/_api-key.js` applies these rules:

| Request origin | Header requirement | Result |
| --- | --- | --- |
| Browser origin accepted by the deployed, retirement-corrected allowlist, with browser fetch metadata (`Sec-Fetch-Site: same-origin` or `same-site`), GET/HEAD/OPTIONS | None required | Allowed |
| Same trusted browser metadata, non-read method | Valid key required | Rejected without valid key |
| Trusted browser origin with `X-CrystalBall-Key` | Optional key, but if present it must validate | Allowed only when valid |
| Desktop origin (`tauri.localhost`, `tauri://localhost`, `asset://localhost`) | `X-CrystalBall-Key` required | Allowed only when valid |
| Unknown origin with `X-CrystalBall-Key` | Required and validated | Allowed only when valid |
| Unknown origin without key | Missing required key | Rejected |

## Environment Variables

| Variable | Purpose | Required |
| --- | --- | --- |
| `CRYSTALBALL_VALID_KEYS` | Comma-separated allowlist for desktop-origin and unknown-origin access | Required if those callers must reach the Vercel API |
| `CRYSTALBALL_API_KEY` | Desktop client credential sent as `X-CrystalBall-Key` | Must match the relevant server gate for the requested route |
| `CRYSTALBALL_APP_KEY` | Server-only single-key gate used by `requireAppAuth` for protected arbitrary-input lookups | Unset refuses those cloud lookups; never prefix with `VITE_` |
| `NODE_ENV` | Controls whether localhost browser origins are trusted outside production | Platform-managed |

If `CRYSTALBALL_VALID_KEYS` is empty, trusted browser origins still work without a key, but desktop-origin and unknown-origin requests will be rejected when they require validation.

These are distinct checks. `api/_auth.js` protects key-spending arbitrary-input
lookups separately from `validateApiKey`: outside the sidecar it requires a header
matching server-side `CRYSTALBALL_APP_KEY`, even for otherwise trusted browser
requests. An unset app key returns 403; a missing/wrong header with a configured
app key returns 401. The local sidecar uses its existing bearer gate. Do not expose
the server app-key variable in a frontend build or assume configuring VALID_KEYS
also configures this lookup gate. See the empty placeholders in [`.env.example`](../.env.example).

## Architecture

```text
Desktop renderer Local sidecar Vercel routes
----------------- --------------------------- ---------------------------
/api/... fetch ---->  localhost sidecar auth token api/[domain]/v1/[rpc].ts
 (LOCAL_API_TOKEN) api/bootstrap.js
 | api/claude-agent.js
 | optional cloud path validateApiKey(req)
 v
 operator-configured verified cloud API origin (none supplied here)
```

## Source Files

| File | Role |
| --- | --- |
| `src/services/runtime.ts` | Local-first fetch patch and remote fallback selection |
| `api/_api-key.js` | Origin, fetch-metadata, and key validation rules |
| `api/_cors.js` | CORS headers, including `X-CrystalBall-Key` |
| `api/[domain]/v1/[rpc].ts` | Generated RPC gateway entrypoint |
| `api/bootstrap.js` | Bootstrap route using the same validation helper |
| `api/claude-agent.js` | Claude agent route using the same validation helper |
