# Q19: latent cloud items (R4-SEC-007 + R4-LOW-006)

Status: **approved by Bradley on October 4, 2026** with every recommended
option (A: fix now; B: sanitize and fence context; C: 500 per day per route;
D: fix caches and require the app key).
Stacked on `claude/r4-sec-008-csp-owned-domains` (#1769), which already
rewrote the trusted-origin list in `api/_api-key.js`. Basing elsewhere would
conflict there.

Latent: no cloud API is deployed (Part 1b). The goal is that deploying `api/`
later can't expose a free LLM proxy or let anyone exhaust a feed quota.

## Problem (verified at the #1769 tip)

1. **A GET to an LLM route needs no key.** `validateApiKey` lets any GET
   through when `Origin` is a trusted browser origin and `Sec-Fetch-Site` is
   `same-origin` or `same-site`. Only a real browser guarantees those
   headers; `curl` can send them too.
   - `get-country-intel-brief` is the one LLM-backed GET RPC.
   - `classify-event` and `summarize-article` are POSTs, which already need
     a key.
2. **`countryCode` is only checked for presence.** It is pasted into the
   prompt.
3. **The free-form `context` parameter breaks the cache.** Up to 4,000
   characters of `context` are hashed into the cache key and appended to the
   prompt. So every unique value is a fresh Groq call, which makes it a
   general-purpose LLM proxy through prompt injection. The desktop renderer
   also puts **feed headlines** (untrusted text) into this field.
4. **The CDN can serve an authenticated answer to anyone.** The gateway
   marks the brief `s-maxage=3600` (public CDN cache). Once a key is
   required, the CDN would still hand the cached response to callers without
   one, because the cache key is the URL only.
5. **Rate limiting has gaps.**
   - `checkRateLimit` already fails closed when Upstash errors (503), but it
     applies **no** limit when Upstash isn't configured.
   - `api/claude-agent.js` fails **open** on limiter errors.
   - There is no daily spend cap.
6. **R4-LOW-006: quota-bearing feeds accept caller parameters.**
   - `api/newsapi-headlines.js` passes any caller `q` upstream with no cache,
     against a free tier of about 100 requests a day.
   - `api/mediastack-news.js` keeps one global cache whatever the
     `categories`/`limit` parameters are. The first caller's choice is served
     to everyone (a correctness bug).

**Local relevance.** The desktop sidecar runs the same gateway (the
`[rpc].js` bundle) with `LOCAL_API_MODE=tauri-sidecar`. There
`validateApiKey` passes because `LOCAL_API_TOKEN` already authenticated the
caller, and Upstash is unset. So every cloud-only rule below must stay off in
sidecar mode, or desktop briefs would break. The `countryCode` and `context`
hardening applies in both modes. The sidecar serves its own inline
`/api/newsapi-headlines` and `/api/mediastack-news`, so R4-LOW-006 is
cloud-only.

## Design (recommended options shown)

1. **Cost-bearing routes need a key in cloud mode, whatever the method.**
   - A `COST_BEARING_ROUTES` set covers the three LLM RPCs.
     `validateApiKey(req, { costBearing: true })` ignores the
     fetch-metadata relaxation for them.
   - `claude-agent.js` already requires a key.
   - Free, cached, non-LLM reads keep the relaxation.
   - Sidecar mode is unchanged.
2. **`countryCode` must be ISO 3166-1 alpha-2**, plus `XK` (Kosovo, which the
   map uses).
   - Anything else returns 400 through the generated `validateRequest` hook,
     in both modes.
   - The allowlist is a new `server/_shared/iso-3166.ts`.
3. **`context` is sanitized and fenced as data** (decision B).
   - Control and format characters are stripped, and the length is capped at
     2,200 (what the renderer sends).
   - It goes into the prompt inside a delimited block, with an instruction to
     treat it as untrusted data and never follow instructions inside it.
   - The cache key still uses the sanitized text, so in cloud mode only a
     keyed caller can cause misses, and decision C caps them.
4. **No public CDN caching of LLM answers.** The brief's cache tier becomes
   `no-store`. The Redis cache still prevents repeat Groq calls.
5. **Cloud mode fails closed for cost-bearing routes.**
   - No limiter configured, or a limiter error, returns 503.
   - A per-route **daily cap** (a Redis `INCR` keyed by UTC day, with a 48 h
     expiry) returns 429 once exceeded (decision C).
   - `claude-agent.js` fails closed on limiter errors too.
   - Sidecar mode keeps today's behavior.
6. **R4-LOW-006** (decision D):
   - **`newsapi-headlines`** ignores the caller's `q` and serves the app's
     fixed query. `pageSize` is clamped and the response is cached.
   - **`mediastack-news`** builds its cache key from normalized parameters:
     allowlisted categories (sorted and deduplicated) and a clamped limit.
   - **Both** require `requireAppAuth`, which fails closed when
     `CRYSTALBALL_APP_KEY` is unset.

## Decisions for you

| | Recommended | Alternatives |
|---|---|---|
| **A. Scope** | Fix now as designed (no live impact; the shared code also hardens the desktop path) | Defer: add a deploy tripwire and fix when a deployment is planned |
| **B. Brief `context`** | Keep it (headlines make briefs specific), sanitized and fenced as untrusted data, in every mode | A closed numeric schema only (drops headlines, so desktop briefs get blander); drop `context` entirely in cloud mode |
| **C. Daily LLM cap (cloud only)** | 500 calls a day per route, set by `CRYSTALBALL_LLM_DAILY_CAP` | 100 a day; no cap (limiter only) |
| **D. NewsAPI/MediaStack** | Fix the cache keys and require the app key | Fix the cache keys only (a future keyless web deployment could still show them) |

## Tests (fakes only; mutation proof per behavior)

- **`validateApiKey`:**
  - an unauthenticated GET with spoofed browser headers is rejected when
    cost-bearing and accepted for a free read;
  - sidecar mode passes;
  - desktop and POST rules are unchanged.
- **Gateway** (`api/__tests__`, the existing scaffold):
  - a spoofed GET to `get-country-intel-brief` returns 401;
  - an invalid `countryCode` returns 400;
  - a limiter that is missing or failing returns 503 for cost-bearing routes
    and changes nothing for free routes;
  - the daily cap returns 429;
  - the brief's tier is `no-store`.
- **Brief prompt:** control characters are stripped, the 2,200-character cap
  holds, and the fence and instruction are present (the Groq call is faked).
- **`claude-agent`:** a limiter error returns 503.
- **NewsAPI:** a caller's `q` is ignored, and an unkeyed call gets 401.
- **MediaStack:** different categories get different cache entries, unknown
  categories are dropped, and an unkeyed call gets 401.
- New script `test:latent-cloud`, added to the targeted-test overrides.

## Approval requirement

Implementation starts only after Bradley answers A–D.
