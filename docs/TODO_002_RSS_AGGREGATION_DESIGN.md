# TODO-002 Revisited — Viable Server-Side RSS Aggregation

## What TODO-002 Is Trying To Accomplish

The original TODO-002 statement is terse. Unpacking what it actually
delivers, and why:

### Problem it addresses

Today, every Crystal Ball user fetches the same ~70 RSS feeds
independently from the client. That has four real costs:

1. **Upstream rate-limit exposure.** For N concurrent users, each feed
   provider sees N requests. Providers like Reuters, AP, BBC, and the
   intel/OSINT feeds will throttle, ban, or 403 the CDN IPs once the
   traffic crosses their thresholds. The app is currently *one viral
   moment away* from half its news going dark.
2. **Wasted bandwidth.** Every user downloads the same XML bytes for the
   same stories. Multiplied across 70 feeds and however many users, this
   is dozens of MB of redundant transfer per refresh cycle.
3. **Slow first paint.** 70 parallel fetches with variable latency means
   the slowest feed dictates perceived load time. Client-side Promise.all
   waits on the worst performer. A pre-aggregated response returns in one
   round trip.
4. **Inconsistent data across users.** Two users looking at the same
   dashboard at the same time can see different news depending on which
   feeds succeeded/failed for each client. Correlation signals become
   non-deterministic.

### What shipping it properly delivers

| Benefit | Impact |
|---------|--------|
| Single upstream fetcher regardless of user count | Rate-limit exposure collapses to O(1) |
| Shared response across users | Bandwidth cost per user drops by ~70× |
| Pre-parsed, pre-merged payload | First news paint in <200ms instead of 500-2000ms |
| Deterministic snapshot | Correlation engines see the same inputs across users |
| Free CDN edge caching | Responses cached at Vercel/Cloudflare edges worldwide |

---

## Why the Naive Version Is a Downgrade Risk

The original spec describes a single `/api/news` endpoint backed by
Redis cron. If that endpoint fails:

- **Every user loses news simultaneously** (it's a shared SPOF).
- **Custom feeds break** because they no longer go through the
  client-side path.
- **Localhost/dev experience regresses** if the endpoint isn't reachable
  (e.g., Vercel deploy is down but the local sidecar works fine).

These are the reasons I initially flagged TODO-002 as "potentially a
downgrade." They are real, but all addressable.

---

## The Viable Design

A **hybrid** that captures the upside while preserving every existing
escape hatch.

### Core principles

1. **Client never depends solely on the aggregator.** If the aggregate
   endpoint returns any error, 204, or takes longer than 2 seconds, the
   client falls back to the existing direct-RSS path. The aggregator is
   a fast path, not a hard dependency.
2. **Only baseline feeds go through the aggregator.** User-added custom
   feeds always stay client-side. The aggregator is for the curated
   default inventory per variant.
3. **Redis is nice-to-have, not required.** Primary caching is CDN edge
   (`Cache-Control: public, s-maxage=120, stale-while-revalidate=300`).
   Redis is a second-layer cache that improves fresh-miss latency but
   never gates the response.
4. **Variant-aware endpoints.** `/api/news-aggregate?variant=full|tech|
   finance|happy`. Each variant has its own baseline feed set. A user
   who changes variants gets a different cached response.
5. **Incremental response via `If-Modified-Since`.** Client can send the
   timestamp of its last successful fetch; aggregator returns only new
   items. For bandwidth-sensitive mobile users this is significant.
6. **Feature-flag gated rollout.** Introduce behind
   `refactor:news-aggregate` per `docs/REFACTOR_SAFETY.md`. First flip
   on for dev, then for a dogfood cohort via localStorage flag, then
   default-on in production.

### Architecture

```
           ┌────────────────────────────────────────────────────┐
           │                 Crystal Ball client                 │
           └────────────────────────────────────────────────────┘
                                  │
                                  ▼
                   ┌──────────────────────────────┐
                   │   fetchNews(variant)         │
                   │   Strategy:                  │
                   │   1. Try /api/news-aggregate │   ◄─ 2 s timeout
                   │   2. On fail: fan-out to     │
                   │      existing rss-proxy      │
                   │      (70× existing calls)    │
                   └──────────────────────────────┘
                                  │
                 fast path ───────┼─────── fallback
                                  │
                                  ▼
                   ┌──────────────────────────────┐
                   │  /api/news-aggregate.js      │
                   │  (edge function)             │
                   │  ┌────────────────────────┐  │
                   │  │ Serve from:            │  │
                   │  │ 1. Vercel edge cache   │  │
                   │  │ 2. Redis (if up)       │  │
                   │  │ 3. Upstream RSS fan-out│  │
                   │  │    (may partial-fail)  │  │
                   │  └────────────────────────┘  │
                   │  Response always includes:   │
                   │    generatedAt, staleness,   │
                   │    successfulSources,        │
                   │    failedSources             │
                   └──────────────────────────────┘
                                  │
                                  ▼
                   ┌──────────────────────────────┐
                   │  Upstream RSS providers      │
                   └──────────────────────────────┘
```

### API contract

```typescript
// GET /api/news-aggregate?variant=full&since=1718900000000
{
  generatedAt: number;           // unix ms — when the aggregator built this
  staleSinceMs: number;          // how old the underlying data is (0 if fresh)
  successfulSources: string[];   // URLs that returned data
  failedSources: { url: string; error: string }[];
  items: AggregatedNewsItem[];
  // Optional: if ?since was provided and no newer items exist:
  //   status: 304 Not Modified
  //   body: null
}
```

### Caching strategy

| Layer | TTL | Purpose |
|-------|-----|---------|
| Vercel edge | 2 min (`s-maxage=120`) | Global, free, works even if Redis is down |
| Vercel edge SWR | 5 min (`stale-while-revalidate=300`) | Users get instant responses; edge refreshes in background |
| Upstash Redis | 3 min | Shared cache between edge regions; skippable |
| Client localStorage | 30 min | Last-good snapshot for offline/dev fallback |

### Failure modes and responses

| Failure | Effect | User impact |
|---------|--------|-------------|
| Aggregator 5xx | Client falls back to direct RSS fan-out | Minor latency hit, no data loss |
| Aggregator timeout (>2s) | Client aborts, falls back | Minor latency hit |
| Some upstream RSS fails | Aggregator returns partial data + `failedSources` list | UI can show which sources are down |
| All upstream fails | Aggregator returns last-good cached data + `staleSinceMs` | User sees slightly stale news, UI shows "source feeds degraded" |
| Redis down | Edge serves, then upstream fan-out on cache miss | Slight latency increase, no failure |
| Edge down (Vercel outage) | Client fallback triggers | Same as today's behavior |

---

## Rollout Plan

Follows `docs/REFACTOR_SAFETY.md`:

1. **Step 1–2**: Catalog existing RSS fetch paths (done above) + add
   characterization tests that capture the current client-side fetch
   behavior (item counts, source coverage).
2. **Step 3**: Ship `api/news-aggregate.js` as a pure addition. Client
   doesn't call it yet. Test by hitting the endpoint manually.
3. **Step 4**: Add feature flag `refactor:news-aggregate`. When ON, the
   client tries the aggregator first with fallback; when OFF, client
   behavior is unchanged.
4. **Step 5**: Enable flag for dev builds only. Run for 24 h; compare
   item counts client-vs-aggregator; fix any drift.
5. **Step 6**: Flip production default. Old path still reachable via
   `?flag=news-direct`.
6. **Step 7**: Observe for one release cycle.
7. **Step 8**: Remove the direct-RSS fan-out from the initial-load
   path. Keep it for user-added custom feeds.

---

## What Does NOT Change

- The existing `api/rss-proxy.js` stays. Custom user-added feeds keep
  using it. It becomes a "single-feed fetch" primitive.
- The existing client-side RSS parsing code stays and is the fallback
  path.
- No breaking changes to panel APIs, news clustering, or the correlation
  engine — they all consume the same `NewsItem[]` shape.

---

## Scaffold Status

This session scaffolds the viability baseline:

- [x] Design doc (this file)
- [x] `api/news-aggregate.js` endpoint stub with the contract above
- [ ] Client-side `fetchNewsAggregated()` helper with 2s timeout fallback
- [ ] Feature flag wiring per `docs/REFACTOR_SAFETY.md`
- [ ] Characterization tests
- [ ] Dev-cohort rollout

The remaining steps are for a dedicated session that follows the
refactor-safety playbook end-to-end.
