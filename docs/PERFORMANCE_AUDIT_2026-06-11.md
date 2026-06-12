# Crystal Ball — Performance Audit (2026-06-11)

**Scope:** Read-only analysis. No source files were modified.
**Method:** Five parallel investigation passes (sidecar routes/caching, SQLite event store, panel refresh/memory, Cesium/startup, external feeds), followed by hand-verification of contested claims. All findings carry `file:line` references against the working tree as of 2026-06-11.

> This report supersedes an earlier same-day draft at this path. Two of that draft's claims were re-verified against source: (1) the `dispose()`-vs-`destroy()` naming hazard is **real** (55 components, confirmed below); (2) the claim that Cesium ships in the main bundle is **contradicted by source** — `GodsVisionView` is dynamically imported at `App.ts:511` and is the only static importer of `CesiumGlobe`, so Cesium lives in a lazy chunk.

---

## Performance Summary

| Component | Current behavior | Risk | Recommendation |
|---|---|---|---|
| Sidecar concurrency model | Single Node process, single event loop, ~293-route linear if-chain; sync SQLite (`node:sqlite` DatabaseSync), sync file tails, `execFileSync` on `/gps/nmea` | **High** | Move sync work (SQLite, OFAC XML parse, log tails) off the event loop; replace `execFileSync` with async |
| Uncached external routes | 68 of 185 outbound routes have no cache; `/api/market-quotes` fans out N Finnhub calls per request; `/api/weather/alerts` fetches multi-MB NWS GeoJSON per request | **High** | Short-TTL caches + in-flight dedupe on the hot uncached routes |
| Event store ingestion | Every push mints a fresh `randomUUID()`, bypassing the PK dedupe — live DB shows 3.6× row duplication; inserts un-transactioned; prune runs only at sidecar startup | **High** | Derive id from `obs.id`; wrap insert loop in a transaction; add periodic prune timer |
| OpenSky `states/all` | Full ~2 MB global snapshot fetched by 3 independent routes under 3 cache keys ≈ 85 downloads/h (~150–250 MB/h) | **High** | One shared fetcher/TTL for all 3 routes |
| FRED full-history CSVs | `/api/freight-stress` + `/api/macro-stress` uncached; full series history downloaded, last 13–30 rows used; ~3,700 upstream hits/day driven by a 60 s panel timer | **High** | 6–24 h cache; FRED data is daily/monthly |
| Raw `setInterval` sprawl | 375 raw intervals in 349 files bypass the RefreshScheduler's ghost/hidden/jitter/backoff protections; only 5 loops use the `recurring-loops` registry | **Medium-High** | Migrate panel timers to `recurring-loops` or the scheduler |
| Panel instantiation | 398 registered panels, ~471 instantiated eagerly at boot, never destroyed; all DOM trees exist for app lifetime; hidden panels keep ticking | **Medium** | Lazy instantiation, or at minimum pause timers for disabled/hidden panels |
| `dispose()` vs `destroy()` naming | 55 components put their `clearInterval` in a `dispose()` method that nothing ever calls and base `Panel.destroy()` doesn't invoke | **Medium** (latent) | Rename to `override destroy()` so any future teardown pass actually cleans them |
| EEWStatusBar | Sidecar fetch every **5 s**, always-on from boot | **Medium** | 30–60 s with hidden-pause |
| `aisState.darkHistory` | 24 h TTL but pruned only inside the `/api/dark-vessels` handler; global AIS bounding box can accumulate 100k+ MMSI entries/day if the route is never called | **Medium** | Prune in the message or snapshot path |
| NASA FIRMS | 6 parallel global VIIRS CSVs (3–15 MB), zero sidecar cache; source updates every 3 h | **Medium** | 30 min cache (the repo's own `feed-latency-config.mjs` already prescribes it) |
| NWS `alerts/active` | Four uncoordinated full-US GeoJSON pulls (one renderer-direct with no timeout); no `If-Modified-Since` anywhere in the codebase | **Medium** | One shared, conditionally-revalidated sidecar route |
| poweroutage.us | ~0.5–3 MB county JSON; TTL 60 s == panel poll 60 s → near-every-poll cache miss, around the clock | **Medium** | Raise TTL to 5 min; decouple panel cadence |
| Cesium globe | Lazy-init, `requestRenderMode`, thorough teardown — but a 50 ms render tick makes active sessions ~20 fps, and `GlobeSeismicWaves` polls the sidecar every 5 s | **Low-Medium** | Gate the 50 ms tick on pulse-layer visibility; seismic poll → 60 s |
| Startup | Two-wave boot fetch (concurrency 12), single keychain vault read, jittered refreshes — well remediated. Largest remaining cost: synchronous ~471-panel DOM construction before data load | **Low-Medium** | Chunk/idle-defer panel construction |
| Memory-leak hygiene (renderer) | No `innerHTML +=` anywhere; interval-driven stores are capped; listeners paired | **Low** | None — hygiene is good; cost is churn, not growth |

---

## 1. Sidecar API performance

### 1.1 Route handling & concurrency model

The sidecar is a **single Node process with a single event loop** — no `cluster`, no `worker_threads`. `createServer` at [local-api-server.mjs:15568](../src-tauri/sidecar/local-api-server.mjs) binds to `127.0.0.1`. Dispatch is two-tiered:

1. A handful of routes handled inline in the server callback (`/gps/nmea` :15575, `/api/health` :15626, intelligence situations :15678–15917, `/api/ollama-stream` :15965).
2. Everything else funnels into `dispatch()` at line 4984 — a **~10,500-line sequential if-chain of ~293 exact-match `pathname ===` comparisons** (lines 4990–15241). Routes near the bottom pay ~290 string comparisons per request. Cheap individually, but O(routes), not a table.

Responses are **fully buffered** (`Buffer.from(await response.arrayBuffer())` at :16004) then optionally brotli/gzip compressed (:16021). Only `/api/ollama-stream` streams. Unknown routes fall through to dynamic `api/*.js` handler modules (`pickModule` :1550, `moduleCache` :1562) and then an optional cloud proxy (:1532, 15 s timeout).

A heartbeat `setInterval` (10 s) at :16124 measures event-loop lag and writes `sidecar.health.json` — loop stalls are already a recognized risk class.

**Synchronous work that blocks the entire sidecar:**

| Location | Blocker |
|---|---|
| local-api-server.mjs:15588 | `/gps/nmea` runs **`execFileSync('head', …, {timeout: 3000})`** on a serial device — can stall the event loop **up to 3 s per request**. Worst single blocker. |
| local-api-server.mjs:3895–3908 | `_tailFile` uses `statSync`/`readSync`; called by `/api/local-ids` (:13380) **on every request, uncached**, reading up to ~500 KB of Suricata/Zeek logs and regexing every line. |
| event-store.mjs:9 | `node:sqlite` `DatabaseSync` — every query is synchronous on the loop (see §4). |
| ofac-cache.mjs:80–95 | Weekly SDN refresh parses the **entire multi-MB sdn.xml synchronously** in-process, plus `JSON.stringify` of all entries to disk. Once per 7 days (or first boot). |
| local-api-server.mjs:743 | AIS websocket: `JSON.parse` per message on a **global bounding box** firehose (`[[-90,-180],[90,180]]`, :781) — constant background CPU; snapshot `JSON.stringify` (~1,500 reports) at :726, invalidated on every message (:762). |
| :16004 + JSON.parse sites | Whole-body buffering + sync `JSON.parse` of multi-MB upstream payloads (NWS GeoJSON, Celestrak GP). |

Request bodies are capped at 16 MB (`MAX_REQUEST_BODY_BYTES`, :1479) — good. But `fetchWithTimeout` (:3613, 277 call sites) **buffers upstream bodies with no size cap** (:3634–3637) — a misbehaving upstream can balloon memory.

### 1.2 Slowest likely routes

**Fan-out routes** (one request → many upstream calls):

| Route | Line | Fan-out | Cached? |
|---|---|---|---|
| `/api/sitrep-bundle` | :6307 | 21 internal sub-requests (each may hit external APIs), 12 s each, parallel | 5 min |
| `/api/celestrak-gp` | :6455 | 11 parallel Celestrak groups incl. Starlink (~7k sats) | 4 h, but the cached combined array is multi-MB |
| `/api/adsb-aggregate` | :12834 | 4 sources (OpenSky + airplanes.live + adsb.fi + adsb.lol), 3 s each | 30 s per query string |
| `/api/webcams/dot-extended` | :15003 | up to 9 jurisdiction APIs | 5 min |
| `/api/market-quotes` | :9705 | **N parallel Finnhub calls — one per symbol** + Stooq CSV + FRED VIX | **uncached** |
| `/api/fred-fallback` | :9832 | 5 parallel sources | **uncached** |
| `/api/economic-stress` | :12487 | 7 parallel sources | cached |
| `/api/disease-intel` | :8661 | 4 parallel sources | cached |

**CPU-intensive routes:** `/api/gdelt/summary` (:418 — sleeps 5.5 s between two sequential GDELT calls; first-miss latency 6–18 s, 15 min cache with in-flight dedupe), `/api/local-ids` (:13380 — sync tail + heavy regex per request, uncached), `/api/weather/seaice` (:8292 — full-series CSV median computation), `/api/aviation/flights` (:13834 — classifies every OpenSky state vector, 10 min cache), `/api/faa-cam-analyze` (:8488 — image fetch + in-process base64 + 25 s Ollama vision call, per request, uncached), `/api/intel-generate` (:15981→:4776 — a single request can hold **90 s**: 60 s local + 30 s Groq fallback; circuit breaker after 2 failures, :4861).

### 1.3 Cache inventory

**Bounded / well-behaved:**

- `_sidecarCache` (`getCached`/`setCached`, :3810) — the main cache, ~117 routes; per-key TTL 30 s–24 h; **hard cap 500 entries + 5-min sweep** (:3811–3828). ✔ (Minor: the trim sorts on insert at the cap — O(n log n) churn under pressure; an LRU would be cleaner.)
- `aisState.vessels` (:671) — 30 min TTL, cap 20,000 with oldest-evict (:700–712). ✔
- `_entities` registry (:2809) — capped 5,000 FIFO (:2855–2858). ✔
- `trafficLog` (:1651) — fixed ring of 200. ✔
- `SECURITY_CVE_CACHE` 24 h keyed by severity (:3448–3449, few keys), `securityVulnersCache` 6 h (:3450), space-weather caches 5–15 min (:2353–2356) — single-value or few-key. ✔
- `feed-resilience.mjs` circuits + last-good cache ([feed-resilience.mjs:9–18](../src-tauri/sidecar/feed-resilience.mjs)) — keyed by feed, no eviction but bounded by feed count.
- `ofac-cache.mjs` (:34–37) — single SDN dataset, 7-day TTL, on-disk persistence. Large but correct design.

**Unbounded or weakly bounded:**

- **`aisState.darkHistory`** (:675) — 24 h TTL but **pruning happens only inside the `/api/dark-vessels` handler** (:6864–6866). With the global AIS bounding box, if that route is never requested the Map accumulates one entry per MMSI seen worldwide — easily 100k+ entries/day. The biggest unbounded-growth candidate in the sidecar.
- `_responseCache` (`cachedFetch`, :321–340) — eviction only deletes *expired* entries when size > 200 (:332–334); **no hard cap** on unexpired keys. Practically self-limiting (per-key TTLs 5 min–24 h) but unbounded in principle. Has in-flight dedupe (`_inflight`, :322) — which `getCached`/`setCached` (the other 117 routes) **lacks**: N concurrent cache-miss requests for the same key all fan out upstream simultaneously.
- `wmHostStats`/`wmHostFailures` (:214/:216) — keyed per upstream host, never pruned; `rss-proxy` targets make this partially user-controlled.

### 1.4 Uncached hot paths (external HTTP on every request)

Scan of all 293 route blocks: **185 make outbound calls; 68 have no caching.** Worst by likely traffic:

1. **`/api/market-quotes`** (:9705) — N Finnhub calls per request, polled by market panels. No cache, no dedupe → concurrent renderer polls multiply upstream calls and burn Finnhub quota.
2. **`/api/weather/alerts`** (:8068) — full NWS `alerts/active` GeoJSON (1–8 MB) fetched and parsed **per request**, geometry retained (:8102). Its siblings `/api/nws-alerts` (:8027) and `/api/weather/active-warnings` (:8137) are cached; this one isn't.
3. **`/api/rss-proxy`** (:12170) — pass-through by design, zero caching; every renderer feed refresh is an upstream hit.
4. `/api/fred-fallback` (:9832), `/api/macro-signals` (:9646), `/api/macro-stress` (:6935), `/api/freight-stress` (:6827), `/api/crypto-quotes` (:9777 — CoinGecko, rate-limit-sensitive), `/api/stablecoin-markets` (:9602), `/api/btc-etf-flows` (:9260).
5. Cyber feeds fetched fresh each call: `/api/threatfox-iocs` (:7162), `/api/openphish-feed` (:7308), `/api/spamhaus-drop` (:7338), `/api/cisa-kev` (:7374), `/api/otx-iocs` (:7587 — includes per-IP geolocation fan-out at :7628).
6. Metered news APIs uncached: `/api/newsapi-headlines` (:7780), `/api/newsdata-feed` (:7811).
7. `/api/nasa-firms` (:11704 — per-area fan-out at :11755), `/api/inpe-fires` (:11867), `/api/wildfire/*` (:11774–11838), `/api/donki-events` (:9039 — 3 NASA calls).

### 1.5 Timeouts and retry behavior

- `fetchWithTimeout` (:3613) default 12 s with destroy-on-timeout — 277 call sites. ✔
- **Four bare `fetch()` calls with no timeout/abort**: :1956 (Patreon OAuth), :5127 (YouTube channel-feed), :5144 (Patreon audio-RSS), :5162 (Patreon verify) — hung-request risk.
- GDELT has exemplary exponential backoff 5 s→300 s with stale-serving (:13085–13117). `feed-resilience.mjs` circuit breaker (3 failures/5 min → open 10 min, half-open probe) is solid but **only a handful of routes use it** (nws-alerts, gdacs).
- AIS websocket reconnects on a **fixed 5 s delay, no backoff** (`AIS_RECONNECT_DELAY_MS`, :796) — a dead upstream gets hit every 5 s indefinitely.
- Brotli compression of multi-MB JSON runs at default quality 11 (`maybeCompressResponseBody` :1366, no `BROTLI_PARAM_QUALITY` set) — itself CPU-heavy.

---

## 2. Panel refresh rates

### 2.1 Two parallel refresh systems

**A. Central `RefreshScheduler`** ([refresh-scheduler.ts](../src/app/refresh-scheduler.ts)) — self-rescheduling `setTimeout` chains with, per tick: ghost ×5 multiplier (:68), hidden-window ×10 (:6–9), ±10% jitter with 1 s floor (:60–74), no-change/error backoff ×2 up to ×4 (:102, :107), in-flight dedupe (:87), and foreground stale-flush capped at 6 concurrent with 150 ms stagger (:117–158). **53 refreshes are scheduler-managed**, registered in [App.ts:579–730](../src/App.ts). Fastest scheduled task is 60 s (`littleSnitch` :608, `adsb` :688). Nothing scheduled is under 30 s. This is well-designed infrastructure.

**B. Raw `setInterval` — 375 call sites across 349 files**, all bypassing the scheduler: 299 component files + 44 services. None get ghost/hidden/jitter/backoff/dedupe. A third registry, [recurring-loops.ts](../src/services/diagnostics/recurring-loops.ts) (priority-based, `'low'` loops pause when hidden), exists but has **only 5 adopters** ([panel-layout.ts:1872–1899](../src/app/panel-layout.ts)).

### 2.2 Raw-interval distribution

228 panels share the pattern `this.refreshTimer = setInterval(() => this.render(), REFRESH_MS)` — local recompute + debounced render:

| Interval | Panels | | Interval | Panels |
|---|---|---|---|---|
| 1 s | 1 | | 5 min | 20 |
| 5 s | 3 | | 10 min | 7 |
| 10 s | 21 | | 15 min | 5 |
| 15 s | 12 | | 30 min | 24 |
| 20 s | 1 | | 1 h | 35 |
| 30 s | 53 | | 6 h | 2 |
| 45 s–3 min | 24 | | 24 h | 24 |

### 2.3 Sub-30 s refreshers — flagged

**Network per tick (the ones that matter):**

| Where | Interval | Hits |
|---|---|---|
| [EEWStatusBar.ts:155](../src/components/EEWStatusBar.ts) (`POLL_INTERVAL_MS=5000` :31) | **5 s** | Sidecar fetch, instantiated at boot (panel-layout.ts:841), polls forever. ~12 req/min — the heaviest always-on poller in the app. |
| [S2UIntelPanel.ts:90](../src/components/S2UIntelPanel.ts) | **10 s** | Sidecar `/api/s2u-xmpp` (:112); TAK at 60 s (:91). |
| [CorrelationAlertBanner.ts:19](../src/components/CorrelationAlertBanner.ts) (started at panel-layout.ts:863–866) | **15 s** | Sidecar `/api/synthesis/correlations`, app lifetime, bypasses both the scheduler and recurring-loops. |
| UnifiedSettings.ts:1479 / settings-main.ts:646 | 3 s | Sidecar traffic log — gated: only while settings is open with auto-refresh on. Acceptable. |
| [clipboard-watcher.ts:26](../src/services/clipboard-watcher.ts) (`POLL_MS=500`) | 500 ms | Tauri IPC clipboard read — gated to the API-key wizard, cleared on stop. Acceptable. |
| [CorrelationMapPanel.ts:84](../src/components/CorrelationMapPanel.ts), [WhatChangedPanel.ts:34](../src/components/WhatChangedPanel.ts) | 30 s | Sidecar fetches, unconditional from boot. |

**Local-only sub-30 s ticks (compute + render, no network):** 1 s — Globe4D HUD counters (God's Eye only), UTC clock (gated on `isAppActive`), EEWStatusBar subtitle re-render; 5 s — one shared static heartbeat ticker for all panel instances ([Panel.ts:960](../src/components/Panel.ts), good design), JustInRail prune, 3 full-re-render panels; 10 s — 21 panels re-render (CommandCenterPanel :144, FeedHealthDashboardPanel :40, ApiDiagnosticPanel :59, …); 15 s — 12 panels; 20 s — [SeismicSuperpowerPanel.ts:311](../src/components/SeismicSuperpowerPanel.ts) queries 500 events from the observation store per tick.

**Key concern:** only 8 of 299 component files gate their tick on visibility. `Panel.setContent` suppresses *DOM writes* when hidden/off-screen (IntersectionObserver with 200 px rootMargin, Panel.ts:913–926; app-visibility :783), but the per-tick **compute** (store queries, HTML string building) runs regardless — ~38 panels every ≤15 s plus 53 more at 30 s, for the app's lifetime, even when hidden.

### 2.4 Sidecar-calling vs. local panels

Scheduler-managed refreshes are all sidecar/network loads through `data-loader.ts`. The 228-panel raw-interval pattern is overwhelmingly **local recompute** over in-memory stores. The network-on-tick exceptions are the table above plus service pollers: `oref-alerts` 2 min, maritime snapshot 5 min, `grid-intelligence-loader` 5/10/15 min, `intel-channels-bridge` 5/15 min, spaceweather status bar 5 min, and the bare-interval panels in §7 (MaritimeIntelPanel / InfraRiskMatrixPanel at 60 s).

---

## 3. Memory footprint

### 3.1 Panel count and instantiation

- **398 panel configs** in `FULL_PANELS` ([panels.ts:9–412](../src/config/panels.ts)), all `enabled: true`.
- **~471 `new XPanel(...)` instantiations in panel-layout.ts, all eager at startup**, plus 7 OSINT panels whose *code chunk* is lazy-loaded but which are still instantiated at boot (`loadOsintPanels`, panel-layout.ts:2612–2629, invoked at :1393). [Panel.ts:230](../src/components/Panel.ts) itself documents "473+ panel instances."
- All panel DOM trees are appended to the grid at boot (:2193, :2513). Disabling a panel is `display:none` (:826) — **the DOM stays and the panel's intervals keep firing**. No virtualization or unmounting.
- Mitigations in place: per-panel IntersectionObserver skips DOM writes off-screen, 150 ms content debounce + cached-HTML no-op detection (Panel.ts:771–794), one shared heartbeat ticker for all instances, heartbeat animation paused off-screen (:942).

### 3.2 Leak-pattern audit

**Verdict: renderer hygiene is good in the steady state; the risks are (a) lifetime timers by design and (b) a latent teardown bug.**

- **Intervals**: component files with `setInterval` consistently pair it with `clearInterval` in a cleanup method. The dominant pattern stores timer ids and clears them in `override destroy()`; base `Panel.destroy()` (Panel.ts:1280–1374) removes all document/window listeners, disconnects observers, cancels RAFs and debounce timers, and aborts in-flight fetches via `AbortController`.
- **Latent teardown bug (verified)**: **55 components put their cleanup in a method named `dispose()` instead of `destroy()`** (e.g. [HybridWarfarePanel.ts:26–28](../src/components/HybridWarfarePanel.ts) clears `refreshTimer` in `dispose()`). Nothing in `panel-layout.ts` or `App.ts` calls `.dispose()`, and since the method doesn't override `Panel.destroy()`, even a future teardown pass that calls `destroy()` would not clear these timers. Today this is moot — panel `destroy()` is essentially never called in the full variant anyway (only module teardown at App.ts:488), so **all ~473 panels' timers run for the app lifetime regardless**. That lifetime ticking, not growth, is the dominant idle-CPU cost. But the `dispose()` naming makes any future "destroy panels on disable" fix silently incomplete for 55 panels.
- **Listeners**: 118 `document/window.addEventListener` across 60 files; sampled hot spots all use bound-handler-in-constructor or paired add/remove. One minor: `AnalystHUD.mount` (:146–168) adds 4 unremovable document listeners — singleton mounted once, harmless. Listeners attached to children inside `render()` are discarded with the innerHTML swap — no accumulation.
- **DOM accumulation**: **zero `innerHTML +=` and zero `insertAdjacentHTML` in the entire src/ tree.** All rendering funnels through `setContent` or `replaceChildren`.
- **Unbounded arrays**: all sampled interval-driven stores are capped — `pressure-history.ts:121–122` (splice to HISTORY_MAX), `reasoning-debug.ts:93–94` (200-entry ring), `military-flights.ts:218–220` (20 track points), `alert-correlator.ts:191` (1,000-cap + hourly prune at :589).

The genuine unbounded-growth risks are sidecar-side: `darkHistory` (§1.3) and event-store duplication (§4).

---

## 4. SQLite event store (Temporal World Store)

### 4.1 Driver, schema, pragmas

- **Driver: `node:sqlite` `DatabaseSync`** ([event-store.mjs:9](../src-tauri/sidecar/event-store.mjs)) — fully synchronous; every query blocks the same event loop serving all API traffic. Chosen deliberately to avoid native modules (file header), but a slow query stalls every sidecar route.
- One table, five secondary indexes (event-store.mjs:57–74): `idx_events_occurred_at`, `idx_events_domain`, `idx_events_partition`, `idx_events_type`, `idx_events_source`. **`occurred_at`, `domain`, and `partition_key` are all indexed.** WAL mode + `synchronous = NORMAL` (:80–81). ✔
- `idx_events_partition` is near-dead weight: no query filters on `partition_key`; its only consumer is `SELECT DISTINCT partition_key` in `health()` (:186). Six B-trees (incl. PK) are maintained per insert.

### 4.2 Query patterns

`queryEvents()` (:131–160): time/domain/source/type filters all hit single-column indexes; bounded (default LIMIT 1000 :22, HTTP cap 5000 at local-api-server.mjs:5989); no `SELECT *`. Issues:

- `entity_ids LIKE '%"id"%'` (:142–149) — leading-wildcard LIKE over JSON-as-TEXT: **never indexable**; a rare-entity query approaches a full-table reverse scan.
- `ORDER BY occurred_at DESC, id DESC` is only partially index-satisfied; the common shape `domain = ? ORDER BY occurred_at DESC LIMIT n` has no composite `(domain, occurred_at)` index, forcing either a sort of all domain rows or row-by-row filtering of the time index.
- `OFFSET` pagination (:158) is O(offset); keyset pagination would be O(1).
- `health()` (:181–207) does full-table `COUNT(*)` + `GROUP BY domain` **per request** at `/api/events/health` (local-api-server.mjs:6006) — synchronous; at GB scale this becomes the route most likely to stall the sidecar.
- No N+1 read patterns found; the only query-in-loop is the insert loop below.

### 4.3 Write patterns — the biggest event-store findings

**(a) Inserts are one-at-a-time auto-commit, never transactioned.** local-api-server.mjs:5953 loops up to 200 individual INSERTs (each its own implicit commit) per POST, synchronously on the request path. The prepared statement is reused (event-store.mjs:86–90); per-statement commit is the cost.

**(b) Ingestion duplicates rows — confirmed in the live DB.** The renderer POSTs the most-recent-200 slice of the observation ring ([data-loader.ts:4004–4012](../src/app/data-loader.ts)) from `loadNatural()` (hourly) and `loadAisSignals()` (every 10 min). The store has dedupe — `id TEXT PRIMARY KEY` with a fail-closed append check (event-store.mjs:84–85, :123–128) — but ingestion **bypasses it**: `appendObservationToEventStore` discards the observation's own id and mints a fresh `randomUUID()` per append (local-api-server.mjs:70). Live DB (`~/Library/Logs/com.bradleybond.crystalball/events.db`): **819 rows, only 227 distinct payloads — 3.6× amplification after ~2 days**; one `open-meteo-wind` observation stored 5 times; `open-meteo-forecast` accounts for 720 of 819 rows. An observation that stays in the top-200 ring for 24 h with AIS enabled gets re-inserted up to 144 times. (`appendSituationToEventStore` at :95 has the same `randomUUID()` pattern; its call site is per-mutation, so lower risk.)

**(c)** Open-meteo forecast observations carry **future** `occurred_at` (live rows dated 3 days ahead) — they age out of retention ~3 days late and always sort to the top of default `ORDER BY occurred_at DESC` queries, shadowing real recent events.

### 4.4 Pruning / growth

- Retention: 3 months default (`EVENT_STORE_RETENTION_MONTHS`, :24–29). `pruneOlderThan()` (:175–179) is indexed. ✔
- **Prune runs only at sidecar startup** (local-api-server.mjs:15556–15561) and via manual `POST /api/events/prune` (:6011). **No periodic timer** — weeks-long uptime means zero pruning.
- Growth estimate: live rate ~410 rows/day at ~635 B/row all-in (~0.25 MB/day — trivial today). Worst case (all feeds emitting, full ring, no dedupe fix): 168 pushes/day × 200 rows ≈ **34 K rows/day ≈ 21 MB/day → ~1.9 GB steady state at 3-month retention**; ~640 MB/month unbounded if pruning never runs — at which point the synchronous `health()` aggregates and the DELETE itself become loop-blocking operations measured in hundreds of ms.
- Live file: 520 KB DB + **4.1 MB WAL** + 33 KB SHM — the WAL at ~8× the main DB rides the auto-checkpoint threshold; no explicit `wal_checkpoint`, and `close()` (:209–211) is never called on shutdown.
- Location: `dataDir/events.db`, where Tauri sets `LOCAL_API_DATA_DIR` to the logs dir ([main.rs:2484–2491](../src-tauri/src/main.rs)) → `~/Library/Logs/com.bradleybond.crystalball/events.db`. Dev fallback is `process.cwd()` (local-api-server.mjs:1730) — hence the stray gitignored `events.db` in the repo root. Size monitoring exists but is pull-only: `health()` reports `dbSizeBytes` (:195–203); nothing polls or alerts on it.

---

## 5. Cesium 3D globe (God's Vision)

### 5.1 Layers

[gods-vision-layers.ts](../src/config/gods-vision-layers.ts) defines **44 layers** (`DEFAULT_GODS_VISION_LAYERS`, :10–279), **21 enabled by default**; `GlobeDataManager.initialize()` registers 42 loadable layers ([GlobeDataManager.ts:631–681](../src/components/GlobeDataManager.ts)). Refresh model: **layers load once per God's Vision session** (`loaded` flag, :753–767); 11 layers are altitude-deferred (:592–604). Pollers inside the globe:

| Poller | Interval | Network? |
|---|---|---|
| **GlobeSeismicWaves** ([GlobeSeismicWaves.ts:44](../src/components/GlobeSeismicWaves.ts)) | **5 s** | **yes** — `/api/seismic-globe-overlays`. The only sub-60 s network poller on the globe. |
| maritimeVessels AIS refresh (GlobeDataManager.ts:1931–1937) | 5 min | yes |
| Satellite SGP4 worker positions | 1 Hz | no (worker compute) — but `updateSatellitePositions` does `removeAll()` + re-add of the whole `PointPrimitiveCollection` every second (:2933–2950): steady allocation churn with a large catalog |
| GlobeTrails 5 s, GlobePillars 10 s, Globe4D HUD 1 s, GlobeArcs 30 s, GodsVisionView HUD 100 ms | — | no, local |

### 5.2 Initialization, rendering, caching

- **Lazy-init: yes (verified).** The Cesium chunk is dynamically imported only when the user toggles God's Vision ([App.ts:501–518](../src/App.ts); `await import('@/components/GodsVisionView')` at :511, the sole static importer of `CesiumGlobe`); the viewer is constructed in `enter()`; full teardown on exit frees the WebGL context.
- **`requestRenderMode: true`** with `maximumRenderTimeChange: Infinity` ([CesiumGlobe.ts:83–84](../src/components/CesiumGlobe.ts)) — not a continuous loop. **However**, a 50 ms render tick for CallbackProperty pulses (:285–292) plus a 1 s heartbeat (:499–506) mean an active, focused session effectively renders **~20 fps**, not the "~1 fps idle" the comment at :93–96 claims. Both ticks are gated on `isAppActive()` (0 fps when hidden/blurred).
- **`tileCacheSize` is not configured** — Cesium's default 100 tiles applies. No `maximumScreenSpaceError`/`preloadSiblings` tuning. Usually acceptable, but repeated theater-jumping (keys 1–6) re-fetches evicted tiles. `msaaSamples: 2`, `resolutionScale = min(devicePixelRatio, 2)`.
- **Cleanup on exit: thorough.** `GodsVisionView.exit()` (:390–431) and `GlobeDataManager.destroy()` (:2952–2987) clear the maritime interval, terminate the SGP4 worker, destroy the seismic poller, and remove all data sources. Minor nit: one-shot layer fetches carry no AbortController (except floodAlerts), so exiting mid-load lets in-flight requests complete into removed data sources — wasted bytes, not a leak.

---

## 6. Startup

### 6.1 Launch sequence

`main.ts`: Sentry + analytics + theme synchronously (trivial); heavy modules dynamically imported; on desktop `app.init()` starts **behind the vault intro overlay** (:335–337), overlapping the biometric gate — good. `App.init()` ([App.ts:345–481](../src/App.ts)) is fully sequential: `initDB()` (IDB open) → `initI18n()` → `mlWorker.init()` → `fetchBootstrapData()` (single `/api/bootstrap`, 800 ms timeout) → **`panelLayout.init()` — synchronous all-panels DOM construction** → UI phases → `preloadCountryGeometry()` (214 KB GeoJSON fetch+parse, awaited) → `loadAllData()` → refresh registration.

**The single largest synchronous block is `createPanels()`** ([panel-layout.ts:655–700](../src/app/panel-layout.ts) onward): ~471 panel constructions + DOM appends + dozens of inline `start*()` service boots (:873–984), all before any data loads.

### 6.2 Tauri / Rust side

- `setup()` ([main.rs:2974](../src-tauri/src/main.rs)) loads the PersistentCache from disk **synchronously on the main thread** — a one-time multi-MB JSON read+parse (the comment at :2975–2977 explains it avoids per-IPC file I/O).
- **Keychain: a single consolidated `secrets-vault` read in steady state** (:186, :253–285), on `spawn_blocking`. Only the one-time migration scans all 73 keys individually; a `migration_done` marker prevents repeats. The frontend's 73 parallel `get_secret` IPC calls ([runtime-config.ts:1326–1337](../src/services/runtime-config.ts)) hit the in-memory Rust cache — IPC chatter, no prompts. **This previously painful path is remediated.**
- Sidecar spawn is unconditional (:3043–3056) after an orphan-listener kill via `lsof` (:2374–2396). The sidecar starts only light intervals at boot (DNS-cache clear, cache sweep, heartbeat writer).

### 6.3 Boot fetch volume

`loadAllData()` ([data-loader.ts:498–689](../src/app/data-loader.ts)) runs ~105 task groups in **two waves** (11 critical first, :666–671) through a **concurrency limiter capped at 12** (:673) — bounded, not a thundering herd. Some tasks fan out internally (`loadNews` walks a 429-URL feed config 5 categories at a time, :1052–1061). Boot-time interval starts: CorrelationAlertBanner 15 s (network — flagged in §2.3), provider-snapshot bridge 30 s, sidecar health probe 30 s, quality-debt collector 60 s, outcome grading hourly, tuning apply 6 h (panel-layout.ts:863–884, :1868–1930).

---

## 7. External API efficiency

**Conditional requests: confirmed — zero uses of ETag / If-None-Match / If-Modified-Since anywhere** (renderer or sidecar). The only mentions are the app acknowledging the debt ([quality-debt-tracker.ts:192–194](../src/services/intelligence/quality-debt-tracker.ts)). NWS, CISA KEV, and FRED all honor conditional GETs.

[feed-latency-config.mjs](../src-tauri/sidecar/feed-latency-config.mjs) is an honest in-repo self-audit of TTL-vs-source-cadence and **already documents several of the gaps below** — the fixes are pre-specified.

### Worst offenders, ranked by payload × frequency

**#1 — OpenSky `states/all` fetched by three independent routes.** Full global snapshot (~1.5–2.5 MB JSON, 8–12k aircraft) under three cache keys, never shared: `/api/adsb` (local-api-server.mjs:12670, TTL 55 s, renderer polls 60 s, **payload forwarded raw to the renderer and parsed twice**), `/api/adsb-military` (:13754, TTL 3 min, ~99% of payload discarded after military-hex filtering), `/api/aviation/flights` (:13834, TTL 10 min). ≈ **85 full-globe downloads/hour ≈ 150–250 MB/h** from an upstream that rate-limits anonymous users (~100 req/day per feed-latency-config.mjs:29). One shared fetcher would cut this ~3×.

**#2 — poweroutage.us county JSON every 60 s.** `/api/infrarisks/power` (:7066–7080): ~0.5–3 MB, TTL **60 s**, polled by [InfraRiskMatrixPanel.ts:24,42](../src/components/InfraRiskMatrixPanel.ts) every **60 s** via a bare interval — TTL == poll interval means nearly every poll is a cache miss, ~60 upstream hits/h around the clock, full payload re-parsed renderer-side each minute and reduced to aggregate scores.

**#3 — NASA FIRMS: 6 parallel global VIIRS CSVs, zero cache.** `/api/nasa-firms` (:11704–11772): ~3–15 MB total, **no sidecar cache** — the repo's own config admits it (feed-latency-config.mjs:174–178: "No cache — expensive multi-region fetch; 30-min cache would help" — source updates every **3 h**). Triggered every 30 min plus boot plus every `fetchFireIntelSnapshot()` ([fire-intel-service.ts:222](../src/services/wildfires/fire-intel-service.ts)). Same file flags `wildfire-perimeters` (NIFC ArcGIS GeoJSON, :179–183) as uncached.

**#4 — NWS `alerts/active`: four uncoordinated full-US GeoJSON pulls** (1–6 MB each with polygons): (1) renderer-direct in [weather.ts:41–53](../src/services/weather.ts) — bare `fetch`, **no timeout, no `limit` param**, every 10 min, parses everything and keeps the top 50 alerts; (2) `/api/nws-alerts` (:8027), deliberately uncached (feed-latency-config.mjs:48–52 suggests a 90 s cache); (3) `/api/weather/alerts` (:8355); (4) `/api/alerts/active` (:8314), whose only identified poller appears unwired. No conditional revalidation despite api.weather.gov supporting it.

**#5 — FRED full-history CSVs, uncached, driven by a 60 s panel.** `/api/freight-stress` (:6827–6857) and `/api/macro-stress` (:6936–6965) have **no cache**; each call downloads the entire `fredgraph.csv` series history (VIXCLS ≈ 9,000 daily rows) and uses the **last 13** (:2239–2249) or **last 30** (:1974–1988) observations. Drivers: [MaritimeIntelPanel.ts:47,227](../src/components/MaritimeIntelPanel.ts) every **60 s** + [EconomicIntelPanel.ts:75,120](../src/components/EconomicIntelPanel.ts) every 5 min + self-test runs. ≈ **3,700+ upstream FRED hits/day** for daily/monthly data. This is the exact debt item already logged in quality-debt-tracker.ts:192.

**Honorable mentions:** CISA KEV (~3–4 MB) re-downloaded every 30 min via `/api/infrarisks/kev` (:7082) **and the full blob shipped over loopback + reparsed by the renderer every 60 s**; a second KEV entry at feed-latency-config.mjs:136 uses a 24 h TTL — two routes, two policies. SWPC DONKI CME ~1 MB every 5 min, parsed down to a small struct. Celestrak GP (multi-MB, 4 h TTL, boot-only load, circuit-breaker cache) and OFAC SDN (7-day TTL, on-disk) are correctly designed.

**Parse efficiency:** most sidecar routes project upstream payloads to compact DTOs (dod-contracts :12743, wikidata :12800, gdacs-rss regex-parse, wastewater 60-row cap) — good. The bad cases are the five offenders above plus `/api/adsb` forwarding raw OpenSky verbatim.

**Resilience:** 47 renderer services use [circuit-breaker.ts](../src/utils/circuit-breaker.ts) (2 failures → 5 min cooldown, stale-serve); the scheduler backs off ×2→×4. No tight retry loops found — but bare-`setInterval` panels never slow down during outages (poweroutage.us gets a fresh attempt every 60 s for an outage's duration).

---

## Quick Wins — top 5 highest-impact, lowest-effort

1. **Dedupe event-store ingestion** — change local-api-server.mjs:70 to derive the event id from `obs.id` (e.g. `` `obs:${obs.id}` ``) instead of `randomUUID()`. The existing PRIMARY KEY + fail-closed catch then makes re-pushes no-ops, eliminating the confirmed 3.6×+ write amplification at its source. One line. While there, wrap the insert loop at :5953 in a transaction and add a daily prune `setInterval` next to the startup prune at :15556.

2. **Cache the FRED stress routes for 6–24 h** (local-api-server.mjs:6827, :6936) — the data updates daily/monthly; this converts ~3,700 upstream hits/day into ~4–8, using the `getCached`/`setCached` helpers already in the file. The same one-route pattern adds a 30 min cache to `/api/nasa-firms` (:11704), which the repo's own feed-latency-config.mjs:174 already prescribes.

3. **Share one OpenSky `states/all` fetcher across `/api/adsb`, `/api/adsb-military`, and `/api/aviation/flights`** (:12670, :13754, :13834) — a single cached raw snapshot with per-route projections cuts ~100–150 MB/h of upstream transfer ~3× and protects the anonymous rate limit.

4. **Slow the three worst always-on pollers**: EEWStatusBar 5 s → 30–60 s (EEWStatusBar.ts:31), CorrelationAlertBanner 15 s → 60 s with hidden-pause via `registerRecurringLoop` (CorrelationAlertBanner.ts:19), and decouple InfraRiskMatrixPanel's 60 s poll from the 60 s poweroutage.us TTL (raise TTL to 5 min). Constant changes; immediate battery/CPU/upstream relief.

5. **Add short-TTL caches + in-flight dedupe to the two hottest uncached sidecar routes**: `/api/market-quotes` (:9705 — 15–60 s TTL stops per-symbol Finnhub fan-out on every panel poll) and `/api/weather/alerts` (:8068 — 90 s TTL on a multi-MB NWS GeoJSON fetch, matching its already-cached siblings). Adding a generic in-flight dedupe to `getCached`/`setCached` (:3833–3846), mirroring the one `cachedFetch` already has (:322), fixes the thundering-herd-on-cache-miss class across all 117 cached routes at once.

**Runner-up worth a line:** replace `/gps/nmea`'s `execFileSync` (local-api-server.mjs:15588) with async `execFile` — it is a guaranteed up-to-3 s stall of the entire sidecar per request.
