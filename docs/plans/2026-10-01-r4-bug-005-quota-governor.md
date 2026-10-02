# Q12: Quota Governor for the sidecar (R4-BUG-005 step 2)

Status: **approved by Bradley on October 1, 2026** ("Approve as designed";
PurpleAir: track an estimate, no app cap; Anthropic: track only plus a
Console limit; reserve: background stops at 80%). Stacked on PR #1761
(step 1: persisted TTLs).

## Problem

Step 1 fixed the five feeds that ran out every day by choosing safe TTLs and
persisting their last good responses. Three gaps remain:

1. **Counts are not durable.** Nothing records how many calls were actually
   sent. A TTL change, a new route, a Settings "Test" click or a burst of
   restarts can still overspend, and nothing would notice.
2. **Provider signals are ignored.** A 429, `Retry-After`,
   `X-Rate-Limit-Remaining` (OpenSky) or `X-RateLimit-Reset` (AbuseIPDB)
   changes nothing; the next refresh calls again.
3. **Exhaustion is invisible.** A spent quota shows up as a generic 502 or,
   for GreyNoise, as an empty list that reads like "all clear".

## Verified facts this design relies on

- Every sidecar call to a governed host goes through `fetchWithTimeout`
  (317 call sites). The seven bare `fetch` calls hit GDELT, loopback, the
  cloud fallback and plain-http hosts, none of them governed. A test pins this.
- OpenSky: `X-Rate-Limit-Remaining` on success, 429 with
  `X-Rate-Limit-Retry-After-Seconds` when out, cost 1–4 credits by box area
  (≤25 / ≤100 / ≤400 / larger or global), checked against the OpenSky REST
  docs today.
- PurpleAir: cost is a base per call plus a per-field cost per row. The
  exact field costs are only in the developer portal, so the app can only
  **estimate** points.

## Design

### 1. `src-tauri/sidecar/quota-governor.mjs` (new, pure, injectable clock)

- **Rules** (in `quota-policy.mjs`, next to step 1's TTLs). Each rule has:
  - a host and path prefix to match;
  - a unit;
  - one or more windows, each with a limit (for example VirusTotal: 500/day
    **and** 4/min);
  - a cost function (OpenSky reads the bounding box from the URL);
  - the secret it belongs to.
- **Rolling windows**, not calendar days: the count is "spent in the last 24
  h", so no window ever exceeds a limit. Each window keeps at most 1,440
  time buckets, so memory and file size stay bounded.
- **Counted before sending.** `admit(url)` charges the cost and returns
  allow/deny synchronously, so concurrent calls cannot race past a limit.
- **Background vs. interactive** (decision D):
  - Background refreshes stop at **80%** of each limit.
  - The last 20% is the reserve for things you trigger: Settings key tests
    and explicit lookups. Those are counted but never blocked; the provider
    is the final judge, and a new key has its own quota.
  - The tag travels with the request through `AsyncLocalStorage`, so the key-test
    call sites need no edits: `validateSecretAgainstProvider` runs
    inside an "interactive" scope.
- **Pacing:** at 80% of the background budget, `ttlFor()` doubles the
  refresh interval, so the remainder lasts longer.
- **Provider headers win** (`observe()` after each response):
  - 429 starts a cooldown. Its length comes from `Retry-After` (seconds or
    HTTP date), `X-Rate-Limit-Retry-After-Seconds` or `X-RateLimit-Reset`.
  - `X-Rate-Limit-Remaining` / `X-RateLimit-Remaining: 0` also starts a
    cooldown.
  - Cooldowns are clamped between 1 minute and the window length, so a bad
    header cannot block a feed forever.
  - Any other host that answers 429 with `Retry-After` gets the same polite
    cooldown, capped at 1 hour, for background calls only.
- **Estimated costs settle afterwards.** PurpleAir charges an estimate up
  front (the last call's row count); `observe()` corrects it from the rows
  actually returned. It is labelled "estimate" everywhere.
- **Persisted ledger:** `quota-ledger.json` in `LOCAL_API_DATA_DIR`, written
  0600 with an atomic replace and coalesced to at most one write per second,
  plus a flush on shutdown. It gets the same hardening as step 1's cache:
  - regular files only;
  - size cap;
  - schema-checked;
  - unknown providers dropped;
  - future-dated buckets dropped.

  Dev runs and tests stay memory-only.
- **Key rotation:** when a governed secret changes, that provider's cooldown
  and header state are cleared. Counts are kept, which is conservative.

### 2. Wiring

- **`fetchWithTimeout`** calls `admit()` before opening the socket. A denial
  throws `QuotaExhaustedError` (`code: 'QUOTA_EXHAUSTED'`, provider,
  `retryAt`), and **no network call is made**. It calls `observe()` with the
  status and headers after each response.
- **The five step-1 routes** (GreyNoise, AbuseIPDB blacklist, NewsAPI,
  OpenSky ×3, PurpleAir):
  - They use `ttlFor()` for pacing.
  - On `QuotaExhaustedError` they serve the last good response with
    `X-Quota-State: stale_quota`, and record `quota_exhausted` in the feed
    health tracker. That is a failure, never a healthy vote.
  - With nothing saved, they return **503
    `{ error: 'quota_exhausted', provider, retryAt }`**, never an empty
    "all clear". This changes GreyNoise's current empty-list fallback.
- Other routes that hit governed hosts fail closed through their existing
  error paths.
- **Anthropic** (`/v1/messages`) and **Groq** are observe-only. The app
  records requests, 429s and token usage from the response `usage` field.
  It does not block them (decision C).

### 3. "API budgets" view

- **New route:** `GET /api/quota/status`, token-authenticated like the other
  routes. For each provider it returns:
  - use and limit per window;
  - the background ceiling;
  - the state: `ok`, `paced`, `background_paused` or `cooldown`;
  - when budget frees up;
  - the last provider-reported remaining value;
  - the last 429;
  - the estimate flag.

  It contains no keys and no URLs with query strings.
- **New "API budgets" tab** in System Diagnostic. One row per provider shows
  a use bar, the state chip and the time the next budget frees up.
  Everything is escaped.

### Governed providers (limits from the R4 table, checked September 29)

| Provider | Match | Limit(s) | Notes |
|---|---|---|---|
| GreyNoise Community | `api.greynoise.io/v3/community/` | 50/week | |
| AbuseIPDB blacklist | `api.abuseipdb.com/api/v2/blacklist` | 5/day | |
| AbuseIPDB check | `api.abuseipdb.com/api/v2/check` | 1,000/day | |
| OpenSky states | `opensky-network.org/api/states/` | 4,000 credits/day | cost by box area |
| NewsAPI | `newsapi.org/v2/` | 100/day | |
| PurpleAir | `api.purpleair.com/v1/` | decision B | estimated points |
| OpenWeatherMap | `api.openweathermap.org/` | 1,000,000/month, 60/min | |
| VirusTotal | `www.virustotal.com/api/v3/` | 500/day, 4/min | |
| GeoNames | `secure.geonames.org/` | 10,000/day, 1,000/hour | |
| NewsData.io | `newsdata.io/api/1/` | 200/day | *unverified* |
| OpenRouter free | `openrouter.ai/api/v1/` | 50/day, 20/min | |
| Groq | `api.groq.com/` | observe only | console is authoritative |
| Anthropic | `api.anthropic.com/v1/messages` | observe only + tokens | decision C |

Renderer-side traffic (Cesium ion, map tiles) is not visible to the
sidecar. It is out of scope and noted in the view.

## Decisions for you

- **A. Approve the design** above.
- **B. PurpleAir** (recommended: track an estimated point ledger and show
  it, with no app-side cap; PurpleAir's own out-of-points or 429 response
  starts a cooldown). The alternative is an app cap, for example 200,000
  estimated points per 30 days. Because the field costs are estimates, a cap
  could pause the feed too early or too late.
- **C. Anthropic spend** (recommended: track and show tokens; you set a
  monthly spend limit in the Anthropic Console, which is the real guard).
  The alternative is an app-side monthly token cap that blocks background
  AI calls.
- **D. Reserve** (recommended: background stops at 80% and the last 20% is
  only for things you trigger, which are never blocked). The alternative
  lets background use the full limit.

## Tests (fakes only; mutation proof per behavior)

- **Governor unit tests:**
  - rolling-window rollover;
  - multiple windows;
  - OpenSky box-area costs;
  - the 80% background stop and the 20% interactive reserve;
  - pacing;
  - each header form (seconds, HTTP date, epoch reset, remaining 0);
  - cooldown clamping;
  - estimate settling;
  - key-rotation reset.
- **Persistence:**
  - restart round-trip;
  - tampered, oversized, symlinked and future-dated ledgers are ignored;
  - write coalescing and flush.
- **Wiring through mocked HTTPS:**
  - a denied call opens no socket;
  - a 429 cooldown is honored;
  - the interactive scope reaches the key tests;
  - each route serves stale with `X-Quota-State` or returns 503, never
    `[]`;
  - `quota_exhausted` reaches feed health.
- **Static gates:**
  - every governed host is reached only via `fetchWithTimeout`;
  - every rule host is https;
  - step 1's budget test is extended to every rule window.
- **Panel:** rows render, the estimate and cooldown states show, and
  hostile provider text is escaped.

## Approval requirement

Per AGENTS.md, implementation starts only after Bradley approves this
design (decisions A–D).
