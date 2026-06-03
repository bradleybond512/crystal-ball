# S2 Underground Panel — Design

**Date:** 2026-06-01
**Status:** Approved (design); pending spec review
**Approach:** A — public YouTube video briefings + optional Patreon supporter layer (audio-RSS + OAuth verified-patron badge)

## Summary

A single Crystal Ball panel surfacing S2 Underground intelligence content:

1. **Briefings (video)** — S2 Underground's latest public YouTube videos, listed and played in-app. Always available, no login.
2. **Supporter audio** — when the user provides their personal Patreon audio-RSS URL, lists and plays their patron audio episodes.
3. **Verified patron badge** — optional Patreon OAuth login that confirms active patronage and shows a tier badge plus a deep-link into S2's patron posts.

## Why not "native Patreon video"

Researched and ruled out (2026-06-01). Patreon offers **no legitimate path** to a patron's locked video:

- **No media API** — the API exposes no post media/video object (Patreon developer forum, "Access Media from posts").
- **Audio-only RSS** — the private patron RSS feed contains audio posts only; "video and text posts will not appear" (Patreon Help Center).
- **DRM** — Patreon video uses real-time decryption keys bound to an authorized streaming session; it cannot play outside Patreon's player.
- The only extraction method is scrapers/downloaders that circumvent DRM and violate Patreon's ToS (risking the user's S2 account) — explicitly out of scope.

S2 Underground publishes its actual video intelligence summaries **publicly and free on YouTube**, which is fully embeddable. That is the video source for this panel.

## Architecture

One panel, three stacked sections. Pure parsing/logic lives in fixture-tested helper/service modules; the sidecar proxies all upstream fetches (CORS + credential isolation).

### Components

| File | Purpose |
|---|---|
| `src/components/S2UndergroundPanel.ts` | Panel UI: three sections, lifecycle, render. |
| `src/services/s2-underground.ts` | Fetches video list + audio list + patron status from the sidecar; pure-ish orchestration. |
| `src/services/__tests__/s2-underground-parse.test.mts` | Fixture tests for the YouTube-RSS and Patreon-RSS parsers. |
| `src-tauri/sidecar/local-api-server.mjs` | New routes (below). |
| `src-tauri/sidecar/__tests__/s2-routes.test.mjs` | Smoke tests for the new routes. |
| `src/config/panels.ts`, `src/app/panel-layout.ts` | Standard panel registration. |
| `src/services/runtime-config.ts`, `src-tauri/src/main.rs` | New secret keys (below). |

### Sidecar routes

- `GET /api/youtube/channel-feed?channelId=<id>`
  Proxies `https://www.youtube.com/feeds/videos.xml?channel_id=<id>` (keyless), parses Atom → JSON `{ items: [{ videoId, title, published, thumbnail }] }`. ~15 latest videos.
- `GET /api/patreon/audio-rss`
  Reads the stored `PATREON_AUDIO_RSS_URL` secret server-side, fetches + parses the feed → JSON `{ episodes: [{ title, published, durationSec, audioUrl }] }`. The token-bearing URL never reaches the renderer.
- `GET /oauth/patreon/callback?code=&state=`
  OAuth redirect target. Verifies `state`, exchanges `code` (+ `client_secret`) for tokens at `https://www.patreon.com/api/oauth2/token`, fetches `identity?include=memberships`, computes patron status, returns a minimal success page that hands tokens + status back to the renderer to persist. `client_secret` is read from the sidecar's injected secrets and never logged.
- `GET /api/patreon/verify`
  Renderer supplies the stored access token; sidecar calls Patreon `identity` and returns `{ active: bool, tier, amountCents }`. On 401, renderer calls `/api/patreon/refresh`.
- `GET /api/patreon/refresh`
  Exchanges the stored refresh token (+ client creds) for a new token pair; returns them for the renderer to persist.

### Video playback

Reuse the existing `/api/youtube-embed` iframe bridge (already used by `LiveNewsPanel`) — origin-locked to `127.0.0.1`. No new playback code.

### Audio playback

Plain HTML5 `<audio src=enclosureUrl>` (media elements load cross-origin without CORS). If a Patreon CDN URL fails to play directly, fall back to streaming it through a sidecar proxy route. The enclosure URL carries the user's own token and stays local.

## Data sources & constants

- `S2_YOUTUBE_CHANNEL_ID` — constant in `s2-underground.ts`. **To confirm at implementation.**
- `S2_PATREON_CAMPAIGN_ID` — constant used to match the user's membership during verification. **To confirm at implementation.**
- `S2_PATREON_URL` — static "Support S2 on Patreon" / patron-posts deep-link.

## Secrets / config

Added to `runtime-config.ts` key definitions + `SUPPORTED_SECRET_KEYS` in `main.rs`, stored via keychain (desktop) / web vault (browser):

- `PATREON_OAUTH_CLIENT_ID` — from the registered Patreon client.
- `PATREON_OAUTH_CLIENT_SECRET` — sidecar-only; never sent to the renderer.
- `PATREON_ACCESS_TOKEN`, `PATREON_REFRESH_TOKEN` — the single user's tokens, written after OAuth, refreshed by the sidecar.
- `PATREON_AUDIO_RSS_URL` — the user's personal patron audio-RSS URL (token-bearing).

No secret needed for the YouTube section (keyless RSS).

## OAuth flow (desktop, v1)

1. "Connect Patreon" → app opens the system browser to the Patreon authorize URL with `client_id`, `redirect_uri=http://127.0.0.1:46123/oauth/patreon/callback`, `scope=identity identity[memberships]`, random `state`.
2. User authorizes on patreon.com → redirect to the sidecar callback.
3. Sidecar verifies `state`, exchanges `code` → tokens, fetches identity, computes patron status, returns a success page that posts tokens + status back into the app.
4. Renderer persists tokens as secrets; panel shows the verified-patron badge + tier and a deep-link to S2's patron posts page.
5. Ongoing: `/api/patreon/verify`; on expiry, `/api/patreon/refresh`.

**Redirect choice:** loopback to the already-running sidecar (RFC 8252 native-app pattern). If Patreon's client registration rejects an `http://127.0.0.1` redirect URI, fall back to a `crystalball://oauth/patreon` custom scheme via the Tauri deep-link plugin (capability addition). **To confirm against Patreon's client settings at implementation.**

**Web build:** OAuth is desktop-only in v1 (no sidecar loopback off-desktop). Web keeps the YouTube + audio-RSS + static deep-link features; the badge is hidden.

## Error handling / freshness

- Both feeds run through the existing `dataFreshness` / `recordFeedSuccess|Failure` trackers. Unreachable/stale → show last-known list with a staleness note; never a blank panel.
- No `PATREON_AUDIO_RSS_URL` set → supporter-audio section shows a one-line "paste your patron RSS URL" prompt, not an error.
- Not logged in / not an active patron → badge shows "Not connected" / "Membership not active"; video + audio sections are unaffected.
- OAuth `state` mismatch or token-exchange failure → surfaced as a non-fatal connect error; existing features keep working.

## Testing

- **Pure parsers** (YouTube Atom → items; Patreon RSS → episodes; identity JSON → patron status) as fixture-tested helpers, matching the repo's pure-helper convention. No live fetch in unit tests.
- **Sidecar routes** smoke-tested alongside existing sidecar route tests (happy path + missing-secret + upstream-error).
- `npm run typecheck:all` clean; eslint clean.

## Prerequisites (user-provided, at implementation)

1. Register a Patreon API client (patreon.com developer portal) → `client_id` + `client_secret`, with redirect URI `http://127.0.0.1:46123/oauth/patreon/callback`.
2. Confirm `S2_YOUTUBE_CHANNEL_ID` and `S2_PATREON_CAMPAIGN_ID`.
3. The user's personal Patreon audio-RSS URL (for the supporter-audio section).

## Out of scope (v1)

- Native Patreon video playback (not legitimately obtainable).
- Per-post patron deep-links (not API-enumerable; badge links to the patron posts page instead).
- Downloading / offline caching of any media.
- Multi-account / multi-creator generalization (single creator: S2 Underground).
