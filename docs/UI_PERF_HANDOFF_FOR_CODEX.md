# Crystal Ball — Handoff for Codex

- **Current as of:** 2026-09-21, 10:45 local (supersedes every earlier version of this file)
- **Reviewed code:** `bradleybond512/main` @ `7230cef6` — all line numbers below are on that SHA
- **Author:** Claude (Opus 5), with the operator present for live verification
- **Evidence log:** [`CLAUDE_UI_PERF_REVIEW_2026-09-20.md`](CLAUDE_UI_PERF_REVIEW_2026-09-20.md) — ten rounds, every measurement, every retraction. This file is the action list; that one is the proof.

## How to use this document

1. Read **State of play** so you know what is already in flight.
2. Take work from **Open work, in order**. The order is deliberate: the first four items decide whether the triage surface tells the truth during a real weather event.
3. Before touching anything, read **Retracted** — each entry is a plausible-looking lead that has already been disproved.
4. Follow **Working rules**; they are this repo's, condensed from `AGENTS.md`.

---

## State of play

| PR | What | State |
|---|---|---|
| #1730 | Summary strip pinned correctly (sticky double-offset); critical posture banner moved into the notification stack; `DataCenterPinnedStrip` styled | Open. Only failing check: `cross-agent-review` |
| #1731 | This handoff and the evidence log (docs only) | Open. Failing: `cross-agent-review`, and `axe` — cannot be caused by a docs-only diff; re-run it |
| #1732 | H10/H15 — situation-engine feedback loop broken; weather no longer labelled civil unrest; one-time purges | Open. **Incomplete — do not merge before H16 lands on it.** Failing: `cross-agent-review` |

**The operator's Mac runs a local build (`18301b45`) = #1730 + #1732, not `main`.** It was installed with `desktop:build:full`, which records the local SHA so the main-sync agent does not overwrite it. The Cyber notification category was switched off as an interim mitigation for H15 and can be switched back on.

---

## Open work, in order

### 1. H16 — Finish #1732: stop eviction churn from re-seeding the engine

**Found this morning, on the build that already contains #1732.** The #1732 loop fix holds — the engine no longer reads its own output — but a second path produces the same symptom:

1. The store holds `MAX_ALERTS = 500` (`unified-alerts.ts:127`) and evicts oldest-by-timestamp first (`:463`).
2. Local storm reports keep their *report* time as `timestamp` (`intel-channels-bridge.ts:127`, id `lsr-${r.id}` at `:122`), so they are the oldest entries and are evicted first.
3. They are re-polled every 15 minutes (`intel-channels-bridge.ts:21`). An evicted report is re-ingested as a **new** alert — and `ingest()` dispatches its notification again (`unified-alerts.ts:373`).
4. `situation-feed.ts:30` decides "new" by diffing against the store's *current* contents, so the re-added report seeds a new situation → a new `correlation` alert → which evicts more reports.

**Measured on the live installation** (no restart between 00:20 and 10:45): 126 `correlation` alerts created 01:00–03:00; "FLOODING — Vinton, OH" has 28 correlation alerts against 17 source reports, arriving in batches at 00:20:37, 00:50:38, 01:20:39; "Clermont, OH" has 14 correlation alerts and **0** source reports still in the store. The rate had decayed to 2 per 30 minutes by 10:45, but it is not zero.

**Fix, in `situation-feed.ts`:** track ids already fed to the engine in a bounded map with a TTL at least as long as the store's prune age (48 h), and feed only never-seen ids. Do not diff against store contents.
**Also consider, in `unified-alerts.ts`:** short-lived tombstones for evicted ids so a re-ingested alert is not treated as new and not re-notified; and evicting derived `correlation` alerts before source alerts at the cap.
**Acceptance:** with the store at its cap during an active LSR period, no source alert produces more than one situation, and no alert is notified twice.

### 2. H14 — Put NWS ingest on a schedule

`loadNWSAlerts()` (`data-loader.ts:3271`) is the only writer of NWS warnings into the unified store (ingest at `:3292`). It runs only at boot, on any panel's Retry, or on leaving playback, goes through a 1-hour offline cache, and records no freshness. The scheduled `weather` refresh (10 min) feeds storm mode, not the store.

**Re-measured this morning:** NWS has issued **224 alerts since the 00:20 boot; none of them are in the store** after more than ten hours.

**Fix:** register it with the refresh scheduler at the `weather` cadence (return `void` so it never backs off), record `nws-alerts` freshness, and have the summary strip report sources *overdue against their own cadence* rather than a raw median age. Also make a panel's Retry re-run that panel's source — today any Retry reloads all 116 sources.
**Architecture:** there are two NWS pipelines. The personal/site one (`weather-posture.ts:28` → `matchAlertToPlace()`) was verified correct against live NWS. Feed the unified store from it; do not build a second lifecycle implementation.
**Acceptance:** a warning newly issued at `/alerts/active` appears in the triage bar within one refresh interval with no user action.

### 3. H12 + H13 — Warning lifecycle and honest timestamps (land with H14)

- `normalizeNWSAlert()` (`alert-normalizer.ts:120`) keys on the CAP *message* id and ignores `references`, `messageType` and `expires`, so every update is a new alert and cancellations are never applied. The store has no removal operation, and `raw` is shed on persist, so expiry is unknowable after a reload.
- `alert-normalizer.ts:127` timestamps with `onset ?? sent`; river flood onsets are days out. `TriageBar.ts:295` clamps negative age to 0 and prints **"now"**.

**Re-measured this morning:** only **16 of 133** stored NWS alerts (12%) are still active at NWS; 16 carry future timestamps. Last night it was 13 of 65, including two expired Tornado Warnings shown as live.

**Fix:** key on the event (collapse via `references`, honour Cancel); carry `expiresAt`/`onset`/`ends` as first-class fields; add a source-scoped reconcile to the store; timestamp with `sent`/`effective`; never clamp a negative age silently. `nws-polygon-match.ts:73` already implements the lifecycle rules correctly — reuse it.
**Acceptance:** after a refresh every stored NWS alert is in `/alerts/active`; no superseded version coexists with its replacement; a future-onset warning shows its start time.

### 4. H11 — GDACS has been down (one-word fix)

`gdacs.ts:92` calls `…/geteventlist/MAP`; the API now returns `HTTP 400 {"message":"Eventtype is required."}` in every form. `…/geteventlist/SEARCH` returns HTTP 200 with the same GeoJSON schema, and every field the parser reads is present. **Re-checked this morning: still 400 / 200.** Change `MAP` → `SEARCH`, update the probe at `api-diagnostic.ts:94`, add a contract test asserting a FeatureCollection.

### 5. M12 — Align RSS timeouts so the sidecar answers first

The renderer's news fetch (`rss.ts:242`) inherits the 15 s default from the runtime fetch patch (`runtime.ts:311`). The sidecar's `/api/rss-proxy` allows 20 s for Google News and 12 s otherwise (`local-api-server.mjs:15743`) — **per redirect hop**, up to 4 hops. All 323 logged proxy failures were renderer-side aborts; none was the sidecar's own `504`. Make the sidecar budget a total and set it below the renderer's.

### 6. H15 remainder — Notification policy for derived alerts

PR #1732 stopped the flood; the policy that let it through is unchanged. `correlation` maps to the `cyber` notification domain (`notification-dispatcher.ts:158`); critical alerts bypass quiet hours (`:293`) and the per-source rate limit; web notifications are `requireInteraction` for critical with a unique tag. Derived alerts should not bypass quiet hours or rate limits, should not share a domain with cyber, and same-title bursts should coalesce.

### 7. M13 — Every news keyword spike is labelled civil unrest

`situation-types.ts:209` maps `keyword_spike → civil_unrest` unconditionally. This morning 19 of 20 persisted situations were `civil_unrest`, built from genuine news keyword spikes titled "care: 6 mentions across 3 sources", "statement: 6 mentions…", "centers: 6 mentions…". #1732 fixed this for *alert-derived* signals via `domainHint`; news-derived spikes need a topic-aware domain, or a neutral one until they have it.

### 8. Boot and runtime performance

| ID | Finding | Start at |
|---|---|---|
| P0 | Boot awaits both data waves (116 tasks, 2 waves, concurrency 12, already `mapSettled`) before finishing — 70–78 s measured. Fix the awaiting, not the deadlines (every fetch already has a 15 s default) | `App.ts:524`, `data-loader.ts:889` |
| H7 | `panelLayout.init` p50 666 ms / p90 883 ms over 278 boots; construction dominates parse ~6× — build panels lazily | `panel-layout.ts:1245` |
| H3 | 110 of 285 timer-bearing panels bypass the visibility gate; 29 also fetch off-screen | `Panel.ts:1114` |
| M1 | 58 panels share a 30 s cadence started together, no jitter | panel `REFRESH_MS` constants |
| M7 | Alert fan-out throttled in frequency, not cost — `notify()` passes no payload; 13 of 26 subscribers rescan all 500 alerts | `unified-alerts.ts:444` |
| M3 | Battery cadence multiplier reaches no panel | `adaptive-cadence.ts:41` |

### 9. Layout

| ID | Finding | Start at |
|---|---|---|
| H1 | Notification stack may grow to the full viewport; its height becomes content padding with no cap | `NotificationStack.ts:34`, `main.css:908` |
| H2 | Fixed surfaces pinned to `--below-banners` reserve no space and overlap the grid | `main.css:15439` and the list in the evidence log |
| M2 | A z-index token scale exists (`main.css:82`); 155 hardcoded values ignore it — add a ratchet like `lint:colors` | `main.css:82` |

### 10. Housekeeping

| ID | Finding | Start at |
|---|---|---|
| M11 | 6 of 38 API keys invalid, including `NEWSAPI_KEY` (boot-critical news); four last validated in April; nothing re-validates | Settings key-status |
| M10 | `tools/mcp-server` (a local HTTP server with open SSRF advisories), `tools/cb-control` and `scripts/` lockfiles are audited by no CI job; root audit is high-only | `security-audit.yml:22` |
| M9 | localStorage at ~6 MB / 318 keys (ML embedding cache is the largest key); 64 MB orphaned backup WAL since July; 292 MB IndexedDB | WebKit storage |
| M4/M8 | 1020 of 2214 catch blocks silent; 19,812 WARN vs 91 ERROR in the live log; blocked (403) and malformed-request (400) feeds look like quiet days | `log-bridge.ts` |
| L1 | `channel.handle` interpolated into an `href` unescaped | `LiveNewsPanel.ts:936` |
| L2 | Six interval callbacks persist on every tick | evidence log |
| L3 | Critical posture banner has no `role`/`aria-live` | `panel-layout.ts:1153` |
| — | Seismic dedup merges 42 of 43 same quakes; the miss is `mb` vs `ml` magnitude types | `seismic-normalizer.ts` |

---

## Done — do not redo

- **Summary strip, posture banner, data-center strip** — #1730.
- **H10 feedback loop and H15 notification flood** — #1732 (+ H16 still required). Verified live: critical `correlation` alerts 281 → 4; "civil unrest" alert bodies 405 → 0; no correlation alert created by the engine reading its own output. Includes one-time purges of pre-fix echoes from both the alert store and the situation store, with migration flags recorded before any early return.
- **Lint gate on `situation-correlator.ts`** — 3 of 4 pre-existing errors fixed in #1732 (one was a real bug: `generateTitle` sorted the caller's signal array in place). `sonarjs/cognitive-complexity` on `correlateSignalToSituation` is suppressed with a justification and needs a real refactor.

## Retracted — do not chase

Each was stated with confidence at some point and then disproved against code or live data. Details in the evidence log.

- **H9** "relative `/api` fetches never reach the sidecar" — the runtime fetch patch (`runtime.ts:263`) routes them.
- **H4** as High — every desktop fetch already gets a 15 s timeout from the same patch; it explains the 2,483 "Fetch is aborted" log lines.
- **M5** "unguarded `setItem` can throw" — a global patch catches quota errors and never rethrows.
- "Sidecar listens on the wrong port" — it listens on 46123 and answers health checks in 3.5 ms.
- "Sidecar heartbeat stalls cause the failures" — no correlation with failures (1% vs a 1% baseline); long "stalls" are the app being closed.
- "Renderer watchdog reload loop" — fired once in about 23 days.
- "News feeds are sent without the bearer token" — `127.0.0.1` is in `APP_HOSTS`, so they are intercepted and authorised.
- "A global 30 s native notification limit lets echoes suppress real warnings" — that Rust command is not on the web-notification path.
- "The work site has no UGC zones" — true of the saved record only; zones are resolved at runtime.
- "Median refresh time is 40 s" — `Slow refresh` logs only above 15 s; 40 s is the median *of slow refreshes*.

## Verified clean

Tauri IPC surface (35 commands, all trusted-window gated; `open_url` https-only with a private-range block list) · CSP · HTML escaping · the RSS proxy's SSRF defence · the personal/site weather-posture pipeline · cross-agency seismic dedup · listener and timer lifecycle · snapshot deserialisation.

---

## How the evidence was gathered — reuse these

- **Boot timings:** `desktop.log` logs `[BOOT-TIMING] … panelLayout.init took Nms` on every boot, unconditionally. `bootTrace()` (`log-bridge.ts:54`) also writes marks to `localStorage['cb-boot-trace']`.
- **Live store:** copy `~/Library/WebKit/com.bradleybond.crystalball/WebsiteData/Default/*/*/LocalStorage/localstorage.sqlite3*` (all three files) and read `ItemTable` with Python `sqlite3`; values are UTF-16LE JSON. Useful keys: `wm-unified-alerts-v1`, `wm-situations-v1`, `cb:key-status:*`.
- **Ground truth:** `https://api.weather.gov/alerts/active` (compare ids after stripping the `nws-` prefix; use `references` for supersession), `?point=lat,lon` for a site.
- **Caveats that bit this review:** localStorage is flushed lazily, so a reading minutes after a restart can undercount — judge by alert *timestamps* (created after boot?), not by totals. `Slow refresh` logs only ≥ 15 s and `[INPUT-LATENCY]` only ≥ 500 ms; sleep/wake inflates both maxima. The `fetch failure burst` line fires at exactly 5 failures per 5 minutes and records the host, never the path.

## Working rules (from `AGENTS.md`)

- Branch `codex/*` from canonical `main`; resolve the remote name rather than assuming it.
- One task per PR. H16 is the exception: it belongs on #1732, which must not merge without it.
- Claim a `UX-NNN` row in `docs/USABILITY_UPLIFT_FOR_CODEX.md` in the same PR.
- Behaviour changes need behaviour tests with a mutation proof. #1732's `test:alert-loop` (15 tests, 12 of 12 mutations killed) is a template.
- `codex/*` branches are reviewed by Claude: record the verdict with `scripts/verify-review-verdict.mjs --record`, then `bash scripts/pr-closeout.sh`.
- The pre-commit hook lints every touched file **in full**; pre-existing errors in a file you touch must be fixed or explicitly justified.
- Items 1–3 and P0 touch situation/alerting logic and the boot path — "high assurance" under `AGENTS.md`: stop for human approval after design, before implementation.
