# Crystal Ball — Privacy Audit

**Date:** 2026-06-11
**Scope:** Sidecar external transmission, data persistence, logging, telemetry, API key privacy, local network exposure, user-generated data lifecycle.
**Method:** Read-only source audit of `src-tauri/sidecar/*.mjs` (16,165-line `local-api-server.mjs` fully enumerated — all 333 external URL literals traced), `src-tauri/src/main.rs`, `src/services/`, `tools/mcp-server/`, plus on-disk inspection of `~/Library/Application Support/com.bradleybond.crystalball/` and `~/Library/Logs/com.bradleybond.crystalball/`. Four parallel investigation passes with independent re-verification of every High finding against source. This report supersedes and incorporates an earlier same-day audit pass that previously occupied this file (its unique findings — `/gps/nmea`, SMS phone-number exposure, CORS web-origin observation — were re-verified and merged; two of its claims were corrected against source, noted inline). No files modified other than this report. No Keychain access performed.

---

## Privacy Risk Summary

| Data type | Where it goes | User-controlled | Risk |
|---|---|---|---|
| API keys (3 providers) | mediastack / aviationstack / geonames over **plain HTTP** during key verification | Yes (verify button) | **High** |
| Usage analytics (pseudonymous events, 73-key presence profile, `OLLAMA_MODEL` value) | PostHog (`us.i.posthog.com`) — **no opt-out UI exists**; Vercel Analytics on web | No | **High** |
| Analyst prompts (can embed watchlist terms/entities) | Groq cloud via **silent fallback** on the "local" LLM path; Anthropic (opt-in features) | Partially | **High** |
| Full request paths + query strings (lat/lon, watchlist terms) | `~/Library/Logs/.../local-api.log` when verbose mode on; exportable via ⌘⇧D clipboard diagnostics | Toggle persists across restarts | **High** |
| Cached API responses (news/intel bodies, 46 MB observed) | `persistent-cache.json`, plaintext, mode 0644, **no eviction ever** | No | **High** |
| Real-time GPS coordinates (if USB GPS attached) | `/gps/nmea` — served **before the auth gate**, no token required | No | Medium |
| Phone numbers + SMS command log | `/api/sms/status` — pre-auth, no token required (SMS off by default) | No | Medium |
| Saved-place coordinates | Open-Meteo ×4, AirNow, OpenAQ, Windy, ArcGIS, 4 ADS-B flight providers (bounding box) | Yes (per feature) | Medium |
| Watchlist / search terms / entity names | Reddit, GDELT, SEC EDGAR, OpenSanctions, NewsAPI/NewsData | Yes (per query) | Medium |
| Portfolio tickers / wallet addresses | Finnhub, Stooq, CoinGecko, blockchain.info | Yes | Medium |
| User email address | ACLED (legacy path puts it **in a GET query string**) | Yes (ACLED creds) | Medium |
| All API keys, plaintext | `.env.local` (exists now, 651 B, mode **0644**) + synced to iCloud Drive by backup script | Yes | Medium |
| Full path + query + **Authorization header** | `crystalball.app` cloud fallback when `LOCAL_API_CLOUD_FALLBACK=1` (default off) | Env opt-in | Medium |
| Submitted URLs | urlscan.io with **default public visibility** | Yes (feature use) | Medium |
| Webcam imagery + camera names/locations | Anthropic (camera-analysis cloud fallback) — no UI disclosure | Yes (feature use) | Medium |
| Intel observations (headlines, coordinates, entity IDs) | `events.db` SQLite **inside ~/Library/Logs**, 3-month retention | No | Medium |
| Saved places (home/work/school/medical lat/lon), watchlists, geofences, alert rules | localStorage / IndexedDB / `~/.crystal-ball/*.json`, all plaintext | No | Medium |
| Watched-entity dossiers (full last API response per item) | `~/.crystal-ball/watchlists/*.json`, retained **indefinitely** | Partially | Medium |
| Error reports (web build only) | Sentry (`sendDefaultPii: false`, desktop excluded) | No | Low |
| API keys in HTTPS URL query strings | ~17 providers (FRED, EIA, Finnhub, NASA, AirNow, WhoisXML, Mapbox/MapTiler/Google, …) | Inherent to provider APIs | Low |
| IOC threat-feed IPs (not user IPs) | `ip-api.com` over **plain HTTP** | No | Low |
| Update check (IP + UA only) | `api.github.com` releases endpoint | No | Informational |
| Weather location | **None** — NWS alerts are fetched nationwide and matched to saved places locally | — | Informational (good) |

**Overall posture:** The architecture is fundamentally privacy-respecting — loopback-only sidecar with timing-safe bearer auth, fail-closed CORS, keychain-backed secrets with trusted-window IPC gating, no secret values in logs, local-first LLM ordering, an in-memory-only personal profile, and a deliberately privacy-preserving nationwide-NWS design. The high-severity items are all fixable seams: three plain-HTTP verify probes, a dead-code analytics opt-out, a silent Groq fallback, a verbose-log sanitization bypass, and an unbounded plaintext response cache.

---

## High Severity Findings

### H1. API keys transmitted over plain HTTP during verification

`local-api-server.mjs:4335` (MediaStack), `:4466` (AviationStack), `:4541` (GeoNames).

The "verify key" probes for these three providers use `http://` URLs with the secret in the query string:

- `http://api.mediastack.com/v1/news?access_key=<KEY>`
- `http://api.aviationstack.com/v1/flights?access_key=<KEY>`
- `http://api.geonames.org/searchJSON?...&username=<VALUE>`

Any on-path observer (coffee-shop Wi-Fi, compromised router) captures the credential in cleartext the moment the user clicks verify. This is the weakest link in an otherwise strong key-storage story (Keychain + AES-GCM web vault + encrypted iCloud backups). All three providers support HTTPS on paid tiers; at minimum the probes should attempt `https://` first.

### H2. No working analytics opt-out; consent defaults to on; Ghost Mode gates are bypassed

`src/services/analytics.ts:32-46, 286, 309-330, 344-348`; `src/main.ts:250`.

- The `wm-analytics-consent` localStorage key absent ⇒ analytics **on by default** (analytics.ts:32-36).
- `setAnalyticsConsent()` exists but has **zero callers anywhere in `src/`** outside analytics.ts itself — there is no settings UI to opt out. Verified by grep.
- Ghost Mode suppression is incomplete: `trackEventBeforeUnload` (analytics.ts:344-348) checks neither ghost mode nor consent; the init-time `$pageview` (analytics.ts:286) and the desktop offline-queue replay (`flushOfflineQueue`, analytics.ts:319-330, up to 200 queued events) also bypass the ghost check.
- On web builds, Vercel Analytics `inject()` runs unconditionally (`src/main.ts:250`) with no consent or ghost gate at all, and Sentry has no opt-out UI (web-only; desktop is excluded at main.ts:22).
- The `wm_api_keys_configured` event (analytics.ts:354-373) sends a `has_<provider>` boolean for all 73 secret keys plus the **literal `OLLAMA_MODEL` value** — for a security professional, which services they hold accounts with (Shodan, VirusTotal, MISP, OpenCTI, …) is itself a sensitive profile, and it sits in PostHog subject to PostHog's breach surface. `wm_deeplink_opened` sends a `target` string that can include geographic or entity names.
- Super properties on every event (platform, variant, version, screen/viewport dims, pixel ratio, language, OS, arch — analytics.ts:252-274) are fingerprint-adjacent: sufficient for probabilistic re-identification in aggregate, even though `distinct_id` is a random UUID.

Mitigating factors: no email/name is ever sent, autocapture and session recording are off, properties are allowlisted per event, and a `sanitize_properties` hook redacts strings shaped like secrets (analytics.ts:188-208). The problem is consent and the gate bypasses, not the payload hygiene.

### H3. Verbose traffic log persists full query strings — undoing the endpoint's own sanitization

`local-api-server.mjs:1685` (console write), `:16014/:16046` (`entry.path = pathname + search`), `:6519-6527` (verbose state persists across restarts), `src-tauri/src/main.rs:2497-2498` (sidecar stdout → `local-api.log`), `main.rs:2657-2686` (`copy_diagnostics`).

The HTTP endpoint `/api/local-traffic-log` deliberately strips query strings "to avoid leaking feed URLs and user research patterns" (local-api-server.mjs:16022-16028). But when verbose mode is on, the same entries — full path **including** query string (lat/lon, watchlist terms, tickers, feed URLs) — are written via `console.log` to `~/Library/Logs/.../local-api.log` and persist on disk. Verbose mode is toggleable at runtime via `/api/local-debug-toggle` and **survives restarts** (`verbose-mode.json`). The ⌘⇧D `copy_diagnostics` command then copies the last 200 lines of that log to the clipboard, so coordinates and watchlist queries can leave the machine inside a pasted bug report.

(Correction to the earlier audit pass: it reported the inverse. Verified against source: the `WM_TRACE` `[req]` line logs **pathname only** — correctly sanitized (`:16030`) — while the verbose `[traffic]` line is the one that includes the query string.)

### H4. `persistent-cache.json`: 46 MB of plaintext API responses with zero eviction

`src-tauri/src/main.rs:162, 804-812, 838-860`; `src/utils/proxy.ts:62-91`; `src/services/persistent-cache.ts:99-128`. Observed on disk: 46 MB, mode 0644, at `~/Library/Application Support/com.bradleybond.crystalball/persistent-cache.json`.

Every successful proxied `/api/` response body (full RSS/news content, security-intel feeds, financial data, disease-outbreak data, headers, parsed feeds, risk scores, the Insights world brief) is persisted keyed by URL — with no TTL, no size cap, and no cleanup of stale keys. Entries are only ever overwritten per-URL. This is an unbounded plaintext archive of everything the app has ever read, including content that reflects the user's configured interests. Per-entry limits exist (256 B key / 5 MB value, main.rs:840-845) but nothing bounds the file.

### H5. Silent Groq cloud fallback on the "local" LLM path; bypasses the cloud budget

`local-api-server.mjs:4843-4855`; `src/services/llm-adapter.ts:58-79, 104-106, 166`; `src/services/llm-budget.ts:183`.

`generateText()` is documented local-first, and the sidecar's `/api/intel-generate` does try Ollama (127.0.0.1:11434) then LM Studio (127.0.0.1:1234) — but when both are down and `GROQ_API_KEY` is set, it **silently falls back to `api.groq.com`** (llama-3.1-8b-instant). Consequences:

1. The full prompt (≤8,000 chars + ≤2,000-char system) — which embeds hypothesis statements and up to 6-8 evidence labels, including user watchlist terms and entity names (`watchlist-hypothesis-bridge.ts:156`, `hypothesis-ensemble.ts:102-114`) — leaves the device for Groq's cloud, unscrubbed.
2. The adapter records the result as `provider: 'local'`, so these calls **never count against the 50/day cloud budget** (`llm-budget.ts`) — the budget only meters the Anthropic path.
3. There is no user-facing "never use cloud LLMs" switch; the only off-switch is deleting the Groq key. The only signal a fallback occurred is a sidecar log line.

Related: camera-analysis routes fall back to Anthropic — `/api/webcam/analyze` (`local-api-server.mjs:8539`) sends a full base64 webcam JPEG plus an alert-context label (e.g. "near Severe Thunderstorm Warning") and `/api/faa-cam-digest` (`:8574`) sends up to 6 camera names/locations, both revealing the user's monitored geography, with **no UI disclosure** that imagery and location context leave the device.

---

## Medium Severity Findings

### M1. `.env.local` — plaintext shadow copy of API keys, mode 0644, synced to iCloud

`local-api-server.mjs:115-128`; `env-local-loader.mjs:1-12`; `scripts/backup-keys.sh:72`. Confirmed present: 651 bytes, mode 0644, dated 2026-04-07.

The keychain-loss fallback file (created after the 2026-05-08 keychain wipe incident) holds `KEY=value` pairs in plaintext, readable by any process running as the user, and `backup-keys.sh` syncs it to iCloud Drive (`com~apple~CloudDocs/CrystalBall`) — a *separate*, unencrypted artifact from the sanctioned encrypted backup archive. The sidecar token file gets 0600 treatment (main.rs:2459-2467); this far more sensitive file does not. The startup log line reveals only the key count, not names or values. Recommend: delete once keychain is healthy, or chmod 0600 and exclude from iCloud.

### M2. User email address sent to ACLED in a GET query string

`local-api-server.mjs:6809` (legacy `?email=...&key=...`), `:6689-6724` (OAuth path: email as username + password in POST body).

ACLED is the only route transmitting the user's actual email — a direct personal identifier — and the legacy path embeds it in a URL where it lands in ACLED's, CDN edges', and intermediaries' access logs. Prefer the OAuth path exclusively.

### M3. Cloud fallback replays failed requests to `crystalball.app` including the Authorization header

`local-api-server.mjs:1514-1548` (`toHeaders` strips host/origin/referer but **not** Authorization), `:15244-15301`, `:1722`.

With `LOCAL_API_CLOUD_FALLBACK=1` (default **off**), any failed local route is replayed verbatim — full path, query string (lat/lon, watchlist terms), body, and bearer token — to the remote base. A broad, silent re-route of potentially sensitive traffic. Additionally, `/api/military/v1/get-theater-posture` (`:12303`) tries `api.crystalball.app` **unconditionally**, not gated by the fallback flag (low-sensitivity params — see L3).

### M4. urlscan.io submissions default to public visibility

`local-api-server.mjs:14037-14096`. The submit route forwards user URLs without forcing `visibility: 'unlisted'` or `'private'` — anything the user scans becomes publicly browsable on urlscan.io, including internal or personally identifying URLs. Users almost certainly don't expect a "scan this link" feature to publish the link.

### M5. Saved-place coordinates fan out to ~10 independent third parties

Open-Meteo forecast/air-quality/flood/marine (`:9382, :9203, :9480, :9504`), AirNow (`:11808`), ArcGIS hospital lookup (`:13629`), OpenAQ (`:10570`), Windy webcams (`:14478`), four ADS-B providers as a bounding box (OpenSky, airplanes.live, adsb.fi, adsb.lol — `:12905-12962`), and USGS aftershock queries with a bounding box around a quake of interest (`:11345`). Inherent to the features, but collectively these reveal home/work locations to many operators, with no in-app disclosure. Counter-examples done right: the NOAA CO-OPS flood-gauge route computes the nearest station **locally** and sends only a station ID (`:9440`); METAR fetching uses nationwide pulls + local matching (`:577-613`). Where feasible, the station-ID pattern could be extended.

### M6. Watchlist terms, entity names, and tickers go to third-party search APIs

Reddit (`:6882-6908`), GDELT (`:13030-13050`), SEC EDGAR (`:9966-9994`), OpenSanctions (`:7559-7583`), NewsAPI/NewsData (`:7788/:7818`), Finnhub/Stooq tickers (`:9705-9744`), CoinGecko (`:9781`), blockchain.info wallet addresses (`:10493`), GeoNames place searches (`:10634-10669`), haveibeenpwned domains (`:10235`), Censys/SecurityTrails/WhoisXML/pulsedive indicators (`:12005-12121`). The terms a user watches (people, companies, CVEs, wallets) are themselves sensitive intelligence about the user. Inherent to the features — but worth documenting for the user, since no in-app disclosure exists.

### M7. `/gps/nmea` serves real-time GPS coordinates with no authentication

`local-api-server.mjs:15575-15605`. The handler runs **before** the `/api/` path check and before the global auth gate. Any unauthenticated request reads 5 lines from the connected USB GPS serial device (port from `~/.crystalball-gps.json`, default `/dev/tty.usbserial-0001`) and returns the first NMEA sentence — i.e. the user's live position. Exposure is bounded by the loopback bind and fail-closed CORS (a malicious website can fire the request but cannot read the response; a same-user process could read the token anyway), so this is defense-in-depth rather than a remote leak — but it is the single most sensitive datum the sidecar serves, and it is the only personal-data route outside the gate. Move it behind the token.

### M8. SMS routes sit above the auth gate; `/api/sms/status` returns phone numbers; no Twilio signature validation

`local-api-server.mjs:5058, 5077-5091`; `sms-security.mjs`; `sms-command-parser.mjs:66`. `/api/sms/command` and `/api/sms/status` are reachable without the bearer token. `/api/sms/status` returns the recent command log (20 entries), watches, alerts, and the per-phone rate-limit map — **including the phone numbers** of everyone who has texted the app — pre-auth, while the adjacent `/api/sms/config` (`:5094`) correctly requires the token. `/api/sms/command` relies solely on a phone-number allowlist on the `from` field — forgeable by any same-host caller — with **no Twilio request-signature (HMAC) check**. Mitigations: SMS is disabled by default, and the allowlist file is mode 0600. If SMS is ever enabled, add `X-Twilio-Signature` validation and token-gate `/api/sms/status`.

### M9. MCP watchlist files retain the full last API response per watched entity, forever

`tools/mcp-server/tools/stateful.mjs:138-159`; `tools/mcp-server/storage.mjs:5, 21-55`. On every `watchlist_check`, each item's `last_status` is overwritten with the **entire JSON API response** (GreyNoise/AIS/ADS-B/ACLED/market data) in `~/.crystal-ball/watchlists/<name>.json` — a growing plaintext dossier of every tracked IP/vessel/ticker/callsign plus matched intel. `storage.pruneOlderThan` exists but has **zero callers**. (Directory does not currently exist on this machine; risk activates on first use.) Files are not mode-restricted, unlike the SMS allowlist (0600). Related: `~/.crystal-ball/sentinel/alerts.json` is appended indefinitely with no code-level prune — the 7-day history prune exists only as a prompt instruction in `.claude/commands/sentinel.md:27-31`, and retention enforced by an LLM following instructions is not a retention policy.

### M10. The intelligence event database lives inside `~/Library/Logs`

`src-tauri/src/main.rs:2484-2491` sets `LOCAL_API_DATA_DIR` to the **logs** directory; `event-store.mjs:78-81` puts `events.db` there (observed: 520 KB + 4.1 MB WAL), and `ofac-cache.mjs:25` adds a 9.5 MB cache. Users and tooling treat `~/Library/Logs` as shareable/disposable — log cleaners may delete the user's 3-month intel history, and "send me your logs" support flows could ship a database of headlines, coordinates, and entity IDs. The DB belongs in Application Support.

### M11. No user-generated data is encrypted at rest

Saved places — including lat/lon with tags like home/work/medical/school (`src/services/saved-places.ts:41, 212`, key `wm_saved_places_v1`) — watchlist (`watchlist.ts:11, 35`, key `crystalball-watchlist-v1`), multi-location watchlist (`cb-watched-locations`), geofences (`crystalball-geofences`), alert rules (`cb-alert-rules`), CII tier-2 watchlist (`cb-cii-tier2`), webhook configs incl. Slack/Discord URLs and optional secrets (`webhook-dispatcher.ts:3-39`), hypothesis threads, briefing archive, and IDB `crystalball_db` reasoning memory are all plaintext. The only encrypted store is the web key vault. On desktop this sits in the WKWebView container protected only by FileVault. Acceptable for a single-user Mac, but saved-place coordinates are the most sensitive plaintext item in the app.

### M12. User-supplied feed URLs logged verbatim on SSRF block

`local-api-server.mjs:12177, :12213`. Private RSS URLs frequently embed auth tokens (the app itself treats `PATREON_AUDIO_RSS_URL` as a secret) — a blocked fetch writes the full credentialed URL into `local-api.log`.

### M13. IOC IPs geolocated over plain HTTP

`local-api-server.mjs:1120-1160` POSTs IP batches to `http://ip-api.com/batch` (the provider's free tier is HTTP-only). Today the sole caller (`:7628`) sends threat-feed IOC IPs from OTX, not user IPs — but the helper is generic and a future caller could leak user-relevant IPs in cleartext.

---

## Low Severity Findings

### L1. API keys in HTTPS URL query strings for ~17 providers

FRED (`:4030`), EIA (`:4044, :14183`), FMP (`:4266`), NewsData (`:4325`), OpenWeatherMap (`:4346`), NASA (`:4355, :9044`), ICAO (`:4477`), NPS (`:14832`), WhoisXML (`:12047`), AirNow (`:11808`), FIRMS (`:11754`), Finnhub (`:9705`), GeoNames username (`:10634`), ipinfo (`:10732`); renderer-side MapTiler/Google/OWM tile URLs (`runtime-config.ts:1239`, `building-tiles.ts:77`, `owm-weather-tiles.ts:37`). Encrypted in transit but exposed in provider/proxy access logs — inherent to those providers' API designs, not a code bug. Providers that support headers already use them (Anthropic, Groq, OpenRouter, OTX, AbuseIPDB, urlscan, Cesium, ACLED OAuth). The AISStream key travels in a WSS frame body per that provider's protocol (`:775-784`) — visible to TLS-intercepting proxies, otherwise fine.

### L2. Upstream response-body excerpts and full error objects written to log

`local-api-server.mjs:4762` (rejects with 200 chars of provider response body, logged at `:4835/:4850`); `:16038` logs full error objects with stacks. Occasionally echoes request fragments into `local-api.log`.

### L3. `get-theater-posture` contacts `api.crystalball.app` unconditionally

`local-api-server.mjs:12303` — the only first-party cloud call not gated by `LOCAL_API_CLOUD_FALLBACK`. Sends the route's query string (theater identifiers; low sensitivity) before falling back to local computation. Should be gated like everything else.

### L4. XMPP nickname exposure in S2U MUC rooms

`s2u-xmpp-source.mjs:24-38, 186-212`. The JID local-part becomes the visible nick broadcast to all occupants of the 5 rooms. Receive-only otherwise; credentials are user-supplied.

### L5. events.db pruned only at sidecar startup

`local-api-server.mjs:15556-15561`. A long-running session never prunes; retention can exceed the 3-month default until next restart. The 4.1 MB WAL also carries recent payloads. No row-count or size cap. Manual prune exists (`POST /api/events/prune`, `:6011-6020`).

### L6. `local-api.log` rotates only at sidecar spawn

`main.rs:2413-2420`. A long session can exceed the 5 MB cap. (`desktop.log` rotates properly: 5 MB, 3 backups — `main.rs:31-32, 881-930`.)

### L7. Little Snitch baseline file accumulates connection metadata indefinitely

`local-api-server.mjs:11973-11998` (opt-in via `LITTLE_SNITCH_BASELINE_PATH`). `app::remoteHost` pairs are added, never removed.

### L8. Patreon OAuth links the install to a real-world identity

`local-api-server.mjs:1956, 5021-5030, 5160`. Standard OAuth (client ID + code exchange, then bearer identity fetch); noted because it is the one feature tying the app to a named account.

### L9. CORS allowlist includes the production web domains

`local-api-server.mjs:1841-1849`. `crystalball.app` and 4 subdomains are allowed origins, so a browser tab on the production web app can complete CORS requests against the locally running sidecar. The bearer token still blocks unauthorized access, but the surface is wider than the desktop app needs (the Tauri renderer uses `tauri://`, not `crystalball.app`). Defense-in-depth: drop the web origins from the desktop sidecar's allowlist if unneeded.

### L10. No inbound Host-header allowlist (DNS rebinding)

There is no explicit inbound `Host:` validation; the check near `:14072` is an outbound SSRF guard for urlscan submissions. Practical exploitation is blocked anyway by loopback-only bind + fail-closed CORS + the bearer token, and outbound rebinding TOCTOU is closed by resolved-IP pinning in `ipv4Fetch` (`:1036-1049`). Defense-in-depth only.

### L11. Frontend JS errors forwarded into desktop.log

`main.rs:2637-2653` (truncated to 1000/2000 bytes, CR/LF-sanitized). Error strings could embed data fragments; rotation bounds exposure.

### L12. Sidecar analyst-state mirror — low residual exposure

`src/services/sidecar-pusher.ts:44-59, 155-176` pushes analyst snapshot, forecast, hypothesis threads (signature/kind/region/confidence), hot entities, debug log, metrics. **No saved places, no watchlist contents, no coordinates** — and the sidecar whitelists fields on receipt (`local-api-server.mjs:5247-5259`). Thread `region` strings are coarse (country/theater). Reachable only with the bearer token. Note: code comments at `:5692/:5736` claim "No bearer auth: loopback-only," but those routes sit **below** the global gate and do require the token — the comments are misleading and should be fixed.

---

## Informational Findings (including strengths)

### I1. Local network exposure — strong posture (audit scope §6 answer)

- **Bind:** `server.listen(port, '127.0.0.1')` — loopback only (`local-api-server.mjs:16074`); falls back to an OS-assigned port on conflict, never `0.0.0.0`.
- **Auth:** global bearer gate covering all routes below `:5108-5118`, compared with `timingSafeEqual` (`:170-177`); token is 32 CSPRNG bytes generated per session (`main.rs:574-578`), written to `sidecar.token` mode **0600** (`main.rs:2459-2467`), handed to the renderer only via trusted-window-gated IPC (`main.rs:588-598`), deleted at shutdown.
- **Can another app call the sidecar without the token?** A different-user process: no (cannot read the 0600 file; rejected at the gate). A same-user process: yes — it can read the token file and then reach everything (analyst state, command queue, quota-spending proxy routes, cached data). That is the documented single-user trust boundary. Token-less pre-auth routes: `/gps/nmea` (M7), `/api/sms/command` + `/api/sms/status` (M8), `/api/service-status`, `/api/youtube-embed`, `/api/feeds/health`, and the Patreon OAuth endpoints (`:4990-5028`) — the latter group intentionally pre-auth and non-sensitive.
- **CORS:** fail-closed — Origin reflected only against a fixed allowlist, otherwise `tauri://localhost` is returned, which no browser sends (`:1841-1849`). No wildcard, no override env. A malicious website cannot read sidecar responses and cannot obtain the token. (Allowlist breadth: L9.)

### I2. API key storage and handling — clean (audit scope §5 answer)

- Keychain: single `secrets-vault` entry under service `crystal-ball`, 73-key allowlist (`main.rs:42, 563-572`); ACL is per-signed-app. `get_secret`/`set_secret`/`delete_secret` all require trusted-window IPC first (`main.rs:729, 747, 770`; `require_trusted_window` `:580-586`) and perform **no logging at all** — not even key names. Error messages return key names only.
- Sidecar receives keys as env vars injected at spawn (`main.rs:2504-2517`); the runtime-update route `/api/local-env-update` is token-gated and key-allowlisted, and logs **key names only** (`:12248, :12251`).
- Both secret-carrying routes are excluded from the traffic ring (`skipRecord`, `:15995-15999`). No sidecar endpoint returns key values; diagnostics expose only **missing-key names** (`:6404-6410`). PostHog strips secret-shaped strings.
- Web vault verified as documented: AES-GCM-256 / PBKDF2-SHA-256 600k iterations / per-save random IV / AAD-bound / 15-min auto-lock; key material never leaves module closure.
- Backup scripts write only encrypted archives to iCloud (age/gpg/openssl); the residual issue is `.env.local` (M1), not the backups.

### I3. Weather location privacy — done right

There is **no `api.weather.gov/points/{lat},{lon}` call anywhere** — NWS alerts are pulled nationwide (UA `CrystalBall-NWS/1.0`) and matched to saved places locally, so the most frequent location-sensitive feature leaks nothing. Same pattern for METARs (nationwide station pull, `:577-613`) and NOAA flood gauges (local nearest-station resolution, `:9440`). NASA FIRMS uses 6 static global bboxes, not user location (`:11754-11766`). AISStream subscribes to the entire globe — `BoundingBoxes: [[[-90,-180],[90,180]]]` — and filters locally (`:775-784`), so the provider never learns which area the user watches.

### I4. Personal profile is in-memory only

`local-api-server.mjs:5400-5430`. The profile POSTed to `/api/personal/profile` — saved places (≤500), watchlist (≤200), interests (≤50), travel dates (≤100, with lat/lon) — is sanitized, capped, and held only in `context._personalProfile`. It is never written to `events.db`, `persistent-cache.json`, or any disk location, and never transmitted externally. Token-gated. This is the right pattern for the most sensitive aggregate in the system.

### I5. No telemetry from the sidecar; no other SDKs

No PostHog/Sentry/Segment/Amplitude/Bugsnag/crashpad in any sidecar file or in package.json beyond the three renderer integrations (PostHog, Sentry web-only with `sendDefaultPii: false`, Vercel web-only). The only phone-home besides analytics is the GitHub releases update check (`desktop-updater.ts:119-121` — IP + UA only, 5 s after boot / hourly / on focus; DMG verified via sha256 manifest; no Tauri updater plugin). All internal "telemetry" modules (threshold-telemetry, reasoning-metrics) are local-only.

### I6. Other positives

- **S2U TAK client hardened:** GET-only, SHA-256 cert pinning with explicit opt-in bypass, refuses to run without user creds (`s2u-tak-client.mjs:27-28, 184-197`).
- **SEC EDGAR UA** uses the project contact address (`contact@crystalball.app`), not the user's email (`:9966`).
- **Twilio is receive-only** — the sidecar never originates SMS (`:5056`).
- **Arbitrary-URL routes** (`/api/rss-proxy`, `/api/feed-discovery`) are SSRF-guarded via private-IP blocking and resolved-IP pinning (`:12092-12170`).
- **Export paths are clean:** `buildSharePacket`, `presentation-export`, `hypothesis-export` serialize only the briefing content handed to them — no code path serializes `wm_saved_places_v1` or raw coordinates into an export (`share-packet.ts:50-106`).
- **Clipboard watcher** (key-entry wizard) polls the clipboard at 500 ms but only while the wizard is open, matches key shapes only, persists nothing (`clipboard-watcher.ts:48-60`).
- **Key-verification probes** (~40 providers, `:3990-4570`) use fixed test parameters only (8.8.8.8, AAPL, London, Denver) — never user data.
- **FAA weathercam header spoofing** (`:8388-8459`) — Origin/Referer set to `weathercams.faa.gov` to pass their referrer check. Not a privacy issue; documented as an undocumented impersonation pattern.

---

## Detailed answers to the audit scope questions

### §1 External data transmission — destination inventory

**~333 external URL literals enumerated.** Categories (full per-route details in findings above):

- **First-party cloud:** `crystalball.app` (opt-in fallback, M3), `api.crystalball.app` (theater posture, L3).
- **LLM:** Ollama/LM Studio (loopback), Groq (H5), Anthropic (camera routes H5; cloud-agent path via `api/claude-agent.js:430`).
- **User-query carriers:** Reddit, GDELT, EDGAR, OpenSanctions, NewsAPI/NewsData, Finnhub, Stooq, CoinGecko, GeoNames, blockchain.info, haveibeenpwned, urlscan.io, pulsedive, Censys, SecurityTrails, WhoisXML, ipinfo, user-configured MISP, arbitrary RSS URLs, YouTube channel handles (M6).
- **Location carriers:** Open-Meteo ×4, AirNow, OpenAQ, Windy, ArcGIS/HIFLD, OpenSky + 3 ADS-B providers, USGS aftershock bboxes, USGS water / EPA SDWIS passthrough proxies (M5).
- **Identity carriers:** ACLED (email — M2), Patreon OAuth (L8), S2U TAK/XMPP (credentials; nick exposure L4), user-configured Oref relay (shared secret header).
- **Fixed-destination feeds (no user data):** ~120 government/scientific/OSINT endpoints — NOAA/SWPC/SPC/NHC, USGS, CDC, WHO, ReliefWeb, FEMA, NVD/EPSS, CISA KEV, abuse.ch, Spamhaus, Tor onionoo, Celestrak, World Bank/IMF/FAO, Treasury/OFAC, RIPE, poweroutage.us, EIA, InciWeb/NIFC, ~14 state DOT camera APIs, promedmail, GDACS, FAA TFRs, and others. Constant or nationwide queries only.
- **Key-verification probes (~40 providers, `:3990-4570`):** fixed test parameters; three over plain HTTP (H1).

### §2 Data persistence — answers

- **dataDir** resolves to the **logs directory** (`main.rs:2484-2491` → `local-api-server.mjs:1730`), see M10. Contents: `events.db` (+WAL/SHM), `data/ofac-cache.json` (public sanctions data, 7-day refresh — third-party PII, not user PII), `sidecar.health.json` (PID/port/memory/AIS state, 10 s overwrite, no user data), `sidecar.port`/`sidecar.token` (deleted at shutdown), `verbose-mode.json`, `desktop.log`/`local-api.log` (+ rotations).
- **Temporal World Store (`event-store.mjs`):** stores `observation | situation_* | alert_fired | score_updated` events; observations carry full JSON payloads — **headline title, location coordinates, entityIds, tags, sourceId, severity, domain** (`local-api-server.mjs:5940-5953`). Retention: **3 months** default (`EVENT_STORE_RETENTION_MONTHS`, `event-store.mjs:24-29`), pruned at startup + manual endpoint only (L5). No size cap. (`alert_fired` is defined but currently has no writer.)
- **Watchboard firings:** the literal term "watchboard" does not exist in the repo (verified by case-insensitive grep across .ts/.mjs/.js/.md/.rs). The nearest equivalents and what they retain: MCP `watchlist_check` persists the full last API response per item indefinitely (M9); sentinel sweeps append alert records forever (M9); renderer watchlist matches persist matched titles (first 100 chars) as hypothesis evidence in localStorage/IDB with stale-thread pruning (`hypothesis-threads.ts:137`) and a 12-entry confidence-history cap; and everything flowing through the observation pipeline lands in `events.db` for 3 months.
- **Cached API responses with sensitive content:** yes — `persistent-cache.json` (H4) holds full news/security-intel/financial/health response bodies; `ofac-cache.json` holds public sanctions PII.
- **Sidecar in-memory only (not disk):** observation ring mirror (200 cap), analyst state, personal profile (I4), SMS command log (50 cap), traffic ring (200 cap), feed tracker.

### §3 Logging — answers

43 console/logger statements in `local-api-server.mjs`; zero in other non-test sidecar files. `context.logger` **is** `console` (`:1733`) and Rust pipes sidecar stdout/stderr to `local-api.log` (`main.rs:2497-2498`) — so every sidecar log line persists to disk. Problem lines: verbose traffic with query strings (H3), feed URLs on SSRF block (M12), upstream body excerpts (L2). Secrets are never logged (I2). Tauri side uses a custom `append_desktop_log` (CR/LF-sanitized, 5 MB ×3 rotation), not tauri-plugin-log; keychain commands log nothing.

### §4 Telemetry — answers

PostHog (desktop + web, default-on, no working opt-out — H2), Sentry (web only, PII off), Vercel Analytics (web only, ungated). No Segment/Amplitude/crash reporters. Cloud LLM data flows per H5: watchlist-derived hypothesis content can reach Groq (silent fallback, uncounted by the budget) and Anthropic (opt-in skeptic/ensemble/auto-brief, ghost-suppressed, 50/day budget — but the budget only meters the Anthropic path; the MCP-triggered skeptic bypasses the enabled/ghost guards by design, `hypothesis-skeptic.ts:181-185`). Saved-place names/coordinates do **not** enter LLM prompts directly; the personal/insights services are LLM-free. The prompt sanitizer (`sanitizeForPrompt`) is used by the skeptic but **not** by `hypothesis-ensemble.ts:105`.

### §5 API key privacy — answers

Stored in: Keychain (primary, gated, clean), `.env.local` (M1 — plaintext fallback), sidecar process env (runtime), encrypted web vault (browser). Leak vectors found: plain-HTTP verify probes (H1), URL query-string placement at ~17 providers (L1), `.env.local` + iCloud (M1), WSS frame body for AISStream (L1). **Not** leaked via: logs, error messages, diagnostics endpoints, analytics, or any sidecar read route — all verified.

### §6 Local network exposure — answers

`127.0.0.1` only; timing-safe bearer auth on all routes except the enumerated pre-auth set (`/gps/nmea` and `/api/sms/status` being the two that matter — M7/M8); 0600 token file; fail-closed CORS. Same-user processes can use the token by design; different users and websites cannot. See I1, L9, L10.

### §7 User-generated data — answers

Saved places / watchlists / geofences / alert rules / webhooks → plaintext localStorage + IDB (M11). MCP watchlists → plaintext `~/.crystal-ball` (M9). Nothing user-generated is encrypted at rest except web-vault keys. The personal profile pushed to the sidecar is in-memory only (I4). Export/share paths do not auto-include coordinates or watchlist contents (I6); no automatic sync exists for user data — the only cloud flows are the analytics stream (H2) and the explicitly user-invoked encrypted key backup.

---

## Prioritized remediation list

1. **H1** — Switch mediastack/aviationstack/geonames verify probes to HTTPS (or drop the probe and report "Saved" like other unverifiable providers).
2. **H2** — Wire `setAnalyticsConsent` into Settings (ideally opt-in on first launch); gate `trackEventBeforeUnload`, init `$pageview`, offline replay, and Vercel `inject()` on consent + ghost mode; drop `OLLAMA_MODEL` and the 73-key presence map from `wm_api_keys_configured`.
3. **H3** — Strip query strings in the verbose `[traffic]` console line (reuse the `/api/local-traffic-log` sanitizer).
4. **H5** — Make the Groq fallback opt-in (or at least chargeable to the cloud budget and labeled `provider: 'cloud'`); disclose in the webcam-analysis UI that imagery goes to Anthropic.
5. **H4** — Add TTL/size-cap eviction to `persistent-cache.json`; chmod 0600.
6. **M7** — Move `/gps/nmea` behind the auth gate.
7. **M1** — Delete or 0600 `.env.local`; keep it out of iCloud.
8. **M4** — Force `visibility: 'unlisted'` on urlscan submissions.
9. **M2** — Remove the ACLED legacy email-in-URL path in favor of OAuth.
10. **M3/L3** — Strip `Authorization` in `toHeaders` for cloud-fallback replays; gate the theater-posture route on the fallback flag.
11. **M8** — Token-gate `/api/sms/status`; add Twilio signature validation before ever enabling SMS.
12. **M9** — Wire up `storage.pruneOlderThan`; add a code-level prune for sentinel `alerts.json`/history; chmod 0600 on `~/.crystal-ball/watchlists/*.json`.
13. **M10** — Move `events.db` and `ofac-cache.json` out of `~/Library/Logs` into Application Support.
14. **M11** — Consider encrypting saved-place coordinates at rest (same key-derivation chain as the web vault).

---

*Audit produced by Claude Code on 2026-06-11. Four parallel investigation passes (external transmission, persistence, logging/telemetry, keys/network/user-data) with independent verification of all High findings against source, merged with the unique findings of a prior same-day pass. Read-only: no code, config, or data was modified.*
