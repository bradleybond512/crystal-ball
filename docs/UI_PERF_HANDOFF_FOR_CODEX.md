# Crystal Ball — Handoff for Codex

- **Current as of:** 2026-09-22 (supersedes every earlier version of this file)
- **Reviewed code:** `bradleybond512/main` @ `7230cef6` — all line numbers below are on that SHA
- **Author:** Claude (Opus 5), with the operator present for live verification
- **Evidence log:** [`CLAUDE_UI_PERF_REVIEW_2026-09-20.md`](CLAUDE_UI_PERF_REVIEW_2026-09-20.md) — eleven rounds, every measurement, every retraction. This file is the action list; that one is the proof.

## How to use this document

1. Read **State of play** so you know what is already in flight.
2. Take work from **Open work, in order**. The order is deliberate: the first five items decide whether a warning that matters actually reaches the operator during a real weather event.
3. Before touching anything, read **Retracted** — each entry is a plausible-looking lead that has already been disproved.
4. **Coverage map** states what this review did and did not examine. Nothing outside it should be assumed clean.
5. Follow **Working rules**; they are this repo's, condensed from `AGENTS.md`.

---

## State of play

| PR | What | State |
|---|---|---|
| #1730 | Summary strip pinned correctly (sticky double-offset); critical posture banner moved into the notification stack; `DataCenterPinnedStrip` styled | Open. Only failing check: `cross-agent-review` |
| #1731 | This handoff and the evidence log (docs only) | Open. Failing: `cross-agent-review`, and `axe` — cannot be caused by a docs-only diff; re-run it |
| #1732 | H10/H15 — situation-engine feedback loop broken; weather no longer labelled civil unrest; one-time purges | Open. **Incomplete — do not merge before H16 and H22 land on it.** Failing: `cross-agent-review` |

**The operator's Mac runs a local build (`18301b45`) = #1730 + #1732, not `main`.** It was installed with `desktop:build:full`, which records the local SHA so the main-sync agent does not overwrite it. The Cyber notification category was switched off as an interim mitigation for H15 and can be switched back on.

---

## Open work, in order

### 1. H19 — A low-severity advisory silently cancels the warning behind it

`NotificationDispatcher.dispatchNotification()` rate-limits **per `alert.source`, ignoring severity**: one notification per source per `RATE_LIMIT_MS` = 2 min (`notification-dispatcher.ts:49`, `:298-305`). The slot is consumed by *any* dispatch that gets that far, including a `badge`-only one (`:307-312` runs after the map is written at `:305`), and the default domain threshold is `medium` (`notification-settings-service.ts:70`), so a Flood Advisory (`Moderate` → `medium` → `badge`, `alert-normalizer.ts:112-118`, `notification-dispatcher.ts:64-69`) takes the `nws` slot.

The next NWS alert in the same ingest batch — a Flash Flood Warning or Severe Thunderstorm Warning (`Severe` → `high` → `banner`) — is dropped. Not deferred: **dropped permanently**, because the store notifies once per id (`unified-alerts.ts:371-374`) and never retries a suppressed alert. Only `Extreme` (`critical`) bypasses the limit.

Reproduced (`R3` in the evidence log, round 11): badge 1, banners 0.

**Fix:** key the limit on `source + severity`, or let `high` pre-empt a slot taken by a lower severity; never let a `badge`/`silent` dispatch consume it; queue rather than discard, and coalesce a burst into one digest notification instead of dropping its tail.
**Acceptance:** an advisory arriving immediately before a warning from the same source cannot suppress the warning.

### 2. H17 — The 48 h prune deletes still-active alerts, then every poll re-notifies them

`prune()` deletes any unpinned alert older than `PRUNE_AGE_MS` = 48 h **by its `timestamp` field** (`unified-alerts.ts:128`, `:450-456`), and `flush()` runs `prune()` on every burst (`:281-282`). But most producers stamp `timestamp` with the *report/onset* time, not ingest time: GDACS `fromDate` (`alert-normalizer.ts:166`), NWS `onset ?? sent` (`:127`), disease `d.date`, maritime `w.issueTime`, travel `latestUpdate` (`intel-channels-bridge.ts:152`, `:186`, `:211`), power-grid `pubDate` (`infrastructure-alert-bridge.ts:55`).

A long-running event — a GDACS drought, a river Flood Warning issued five days ago and still in force — is therefore ingested, notified, and deleted in the same flush. On the next poll it is new again: notified again, deleted again, forever. Nothing about the event changed.

Reproduced (`R1`): one unchanged GDACS event, three polls → **3 notifications, 0 alerts in the store**. This is also the simplest explanation for H14's "224 NWS alerts issued since boot, none in the store" — an onset older than 48 h is deleted on arrival.

**Fix:** prune on an `ingestedAt`/`lastSeenAt` field (or `expiresAt` where the source provides one), never on source time; keep source time for display and ordering only. Pairs with H12/H13, which adds `expiresAt`.
**Acceptance:** an active multi-day warning stays in the store and notifies exactly once.

### 3. H22 — One flood produces dozens of "situations" because stale signals can never cluster

`computeAffinity()` scores temporal proximity as `1 - |signal.timestamp - situation.lastUpdated| / clusterWindowMs` (`situation-correlator.ts:88-92`), comparing the signal's **source timestamp** against the situation's **wall-clock last update**. `clusterWindowMs` is 6 h (`situation-types.ts:237`). A signal whose source timestamp is older than 6 h scores 0 there; with no `placeIds` it also scores 0 for geography (`extractSignalGeo()` returns `null` unless `placeIds` holds ISO-3 codes, `:45-57`), leaving only the domain match at 0.20 — under the 0.30 merge threshold (`:268`). **Every such signal mints a brand-new situation, even against an identical one created a millisecond earlier.**

Reproduced (`R4`): 12 identical "FLOODING — Vinton, OH" signals timestamped 14.9 h ago → **12 situations**; the same 12 timestamped 18 min ago → 1 situation.

Live, on the current build (which already contains #1732): the store holds 500 alerts, **416 of them `correlation`** — 361 titled `FLOODING — …`, including 51 for Vinton OH and 23 for Meigs OH alone — against 30 `nws` alerts. The persisted situation store shows the mechanism directly: `sit-mubobeat-af` and `-ag`, created in the same millisecond, are both "FLOODING — Greene, OH", each holding one LSR signal (`ua-lsr-lsr-67-…`, `ua-lsr-lsr-69-…`) timestamped 14.9 h before creation, each with `geo: {lat: 0, lon: 0, label: "Global"}`.

Each of those situations is promoted to a `correlation` alert by the bridge, which is where the operator's flood-notification bursts come from, and what crowds authoritative NWS alerts out of a 500-slot store.

**Fix (three parts, all needed):**

- Clamp temporal affinity to `min(|signalTs - lastUpdated|, |signalTs - situation newest signal ts|)`, or score against ingest time; a report being old must not make it uncorrelatable.
- Give alert-derived pseudo-signals real geography: alerts carry `location` (lat/lon); `extractSignalGeo()` should use it with `clusterRadiusKm`, instead of only ISO-3 `placeIds`, so same-county reports converge and situations stop being stamped "Global" at 0,0.
- Add a same-title/same-locality guard on creation, so an identical situation is merged rather than duplicated regardless of affinity scoring.
**Acceptance:** one county-level flood event produces one situation and one derived alert, whatever the report lag.

### 4. H16 — Finish #1732: stop eviction churn from re-seeding the engine

**Found this morning, on the build that already contains #1732.** The #1732 loop fix holds — the engine no longer reads its own output — but a second path produces the same symptom:

1. The store holds `MAX_ALERTS = 500` (`unified-alerts.ts:127`) and evicts oldest-by-timestamp within its (inverted — see H18) pinned/acknowledged ordering (`:458-468`).
2. Local storm reports keep their *report* time as `timestamp` (`intel-channels-bridge.ts:127`, id `lsr-${r.id}` at `:122`), so they are the oldest entries and are evicted first.
3. They are re-polled every 15 minutes (`intel-channels-bridge.ts:21`). An evicted report is re-ingested as a **new** alert — and `ingest()` dispatches its notification again (`unified-alerts.ts:373`).
4. `situation-feed.ts:30` decides "new" by diffing against the store's *current* contents, so the re-added report seeds a new situation → a new `correlation` alert → which evicts more reports.

**Measured on the live installation** (no restart between 00:20 and 10:45): 126 `correlation` alerts created 01:00–03:00; "FLOODING — Vinton, OH" has 28 correlation alerts against 17 source reports, arriving in batches at 00:20:37, 00:50:38, 01:20:39; "Clermont, OH" has 14 correlation alerts and **0** source reports still in the store. The rate had decayed to 2 per 30 minutes by 10:45, but it is not zero.

**Related:** H17 removes one of the two eviction paths (age) and H22 removes the duplicate-situation amplifier; H16 is still needed for the cap path. Land all three together on #1732.

**Fix, in `situation-feed.ts`:** track ids already fed to the engine in a bounded map with a TTL at least as long as the store's prune age (48 h), and feed only never-seen ids. Do not diff against store contents.
**Also consider, in `unified-alerts.ts`:** short-lived tombstones for evicted ids so a re-ingested alert is not treated as new and not re-notified; and evicting derived `correlation` alerts before source alerts at the cap.
**Acceptance:** with the store at its cap during an active LSR period, no source alert produces more than one situation, and no alert is notified twice.

### 6. H14 — Put NWS ingest on a schedule

`loadNWSAlerts()` (`data-loader.ts:3271`) is the only writer of NWS warnings into the unified store (ingest at `:3292`). It runs only at boot, on any panel's Retry, or on leaving playback, goes through a 1-hour offline cache, and records no freshness. The scheduled `weather` refresh (10 min) feeds storm mode, not the store.

**Re-measured this morning:** NWS has issued **224 alerts since the 00:20 boot; none of them are in the store** after more than ten hours.

**Fix:** register it with the refresh scheduler at the `weather` cadence (return `void` so it never backs off), record `nws-alerts` freshness, and have the summary strip report sources *overdue against their own cadence* rather than a raw median age. Also make a panel's Retry re-run that panel's source — today any Retry reloads all 116 sources.
**Architecture:** there are two NWS pipelines. The personal/site one (`weather-posture.ts:28` → `matchAlertToPlace()`) was verified correct against live NWS. Feed the unified store from it; do not build a second lifecycle implementation.
**Acceptance:** a warning newly issued at `/alerts/active` appears in the triage bar within one refresh interval with no user action.

### 7. H12 + H13 — Warning lifecycle and honest timestamps (land with H14)

- `normalizeNWSAlert()` (`alert-normalizer.ts:120`) keys on the CAP *message* id and ignores `references`, `messageType` and `expires`, so every update is a new alert and cancellations are never applied. The store has no removal operation, and `raw` is shed on persist, so expiry is unknowable after a reload.
- `alert-normalizer.ts:127` timestamps with `onset ?? sent`; river flood onsets are days out. `TriageBar.ts:295` clamps negative age to 0 and prints **"now"**.

**Re-measured this morning:** only **16 of 133** stored NWS alerts (12%) are still active at NWS; 16 carry future timestamps. Last night it was 13 of 65, including two expired Tornado Warnings shown as live.

**Fix:** key on the event (collapse via `references`, honour Cancel); carry `expiresAt`/`onset`/`ends` as first-class fields; add a source-scoped reconcile to the store; timestamp with `sent`/`effective`; never clamp a negative age silently. `nws-polygon-match.ts:73` already implements the lifecycle rules correctly — reuse it.
**Acceptance:** after a refresh every stored NWS alert is in `/alerts/active`; no superseded version coexists with its replacement; a future-onset warning shows its start time.

### 8. H11 — GDACS has been down (one-word fix)

`gdacs.ts:92` calls `…/geteventlist/MAP`; the API now returns `HTTP 400 {"message":"Eventtype is required."}` in every form. `…/geteventlist/SEARCH` returns HTTP 200 with the same GeoJSON schema, and every field the parser reads is present. **Re-checked this morning: still 400 / 200.** Change `MAP` → `SEARCH`, update the probe at `api-diagnostic.ts:94`, add a contract test asserting a FeatureCollection.

### 5. H18 — The size cap evicts pinned and unacknowledged alerts first

`prune()`'s cap sort is inverted against its own comment (`unified-alerts.ts:458-468`). It sorts pinned first (`a.pinned ? -1 : 1`) and unacknowledged first (`a.acknowledged ? 1 : -1`), then drops from the **front** (`sorted.slice(0, sorted.length - MAX_ALERTS)`). Drop order is therefore: pinned → unacknowledged → acknowledged. A pinned alert is the first thing thrown away, and an alert the operator has already dealt with outlives one they have not.

Reproduced (`R2`): with 500 acknowledged alerts plus one pinned and one unacknowledged, both the pinned and the unacknowledged alert are evicted and all 500 acknowledged ones are kept. The persist-time backstop (`entriesForPersist()`, `:484-495`) has the intended behaviour, which is why this survived: the correct logic sits one function away from the broken one.

The store is **at its cap right now** on the live build (500/500), so this is live, not theoretical — currently masked only because nothing is pinned or acknowledged.

**Fix:** invert both comparators (`a.pinned ? 1 : -1`, `a.acknowledged ? -1 : 1`), or reuse `entriesForPersist()`'s partition. Consider evicting derived `correlation` alerts before source alerts (see H16/H22).
**Acceptance:** a unit test asserting that at the cap, pinned alerts are never evicted and acknowledged ones go first.

### 9. H21 — "All sensors quiet · checked just now" cannot be falsified

`ThreatDashboard.renderAllQuiet()` prints `checked ${formatRelativeTime(lastChecked)}` over `${DOMAINS.length} sensors` (`ThreatDashboard.ts:158-175`), where `lastChecked` is `Math.max(...)` of each domain's `lastUpdatedMs`. But the aggregator stamps every domain with the **aggregation clock**, not the feed's fetch time — `lastUpdatedMs: nowMs` at `threat-aggregator.ts:186` (the `emptyThreat()` fallback for a domain with no data) and at `:225, 264, 280, 298, 316, 348, 371, 397, 423, 453, 480`. And a domain with no data is levelled `NONE`, identical to a domain that is genuinely quiet; `ThreatLevel` has no `UNKNOWN`/`STALE` member.

So a feed that has been failing since boot renders as a quiet sensor, checked seconds ago, and the dashboard collapses all eleven behind one green line. This is the "all quiet while feeds are dead" state the operator saw.

**Fix:** carry each feed's real fetch timestamp into its snapshot; add an `UNKNOWN` level for no-data/stale domains; show "n of 11 reporting" and never collapse to all-quiet while any domain is unknown or older than its cadence.
**Acceptance:** killing one feed makes the dashboard say so within one cadence, instead of reporting eleven quiet sensors.

### 10. H20 — Ghost Mode silences critical alerts, including the operator's own site

`isGhostMode()` is the outermost gate in `dispatchNotification()` (`notification-dispatcher.ts:107-113`, `:280-283`): when `wm-app-mode === 'ghost'`, **every** notification is suppressed — including `critical`, which bypasses quiet hours and the rate limit everywhere else, and including the site-level weather ladder (`data-loader.ts:2192`) and the analyst path (`hypothesis-notifier.ts:68`). Ghost Mode also multiplies every poll interval by 5 (`mode-manager.ts:74`).

`wm-app-mode` is `'ghost'` on the live install right now. The mode survives restarts, is toggled by a single keystroke (⌘⇧G, `event-handlers.ts:441`), and its only indicator is the toolbar button state.

**Fix:** decide the policy deliberately — either critical/life-safety alerts pierce Ghost Mode (matching the quiet-hours rule), or Ghost Mode shows a persistent, unmissable banner stating that alerts are suppressed, with the count of alerts suppressed while it was on. A five-times-slower poll plus total silence should not be one keystroke away with no standing indicator.
**Acceptance:** with Ghost Mode on, a critical alert either notifies or is visibly accounted for in the UI.

### 11. M12 — Align RSS timeouts so the sidecar answers first

The renderer's news fetch (`rss.ts:242`) inherits the 15 s default from the runtime fetch patch (`runtime.ts:311`). The sidecar's `/api/rss-proxy` allows 20 s for Google News and 12 s otherwise (`local-api-server.mjs:15743`) — **per redirect hop**, up to 4 hops. All 323 logged proxy failures were renderer-side aborts; none was the sidecar's own `504`. Make the sidecar budget a total and set it below the renderer's.

### 12. H15 remainder — Notification policy for derived alerts

PR #1732 stopped the flood; the policy that let it through is unchanged. `correlation` maps to the `cyber` notification domain (`notification-dispatcher.ts:158`); critical alerts bypass quiet hours (`:293`) and the per-source rate limit; web notifications are `requireInteraction` for critical with a unique tag. Derived alerts should not bypass quiet hours or rate limits, should not share a domain with cyber, and same-title bursts should coalesce.

### 13. M13 — Every news keyword spike is labelled civil unrest

`situation-types.ts:209` maps `keyword_spike → civil_unrest` unconditionally. This morning 19 of 20 persisted situations were `civil_unrest`, built from genuine news keyword spikes titled "care: 6 mentions across 3 sources", "statement: 6 mentions…", "centers: 6 mentions…". #1732 fixed this for *alert-derived* signals via `domainHint`; news-derived spikes need a topic-aware domain, or a neutral one until they have it.

### 14. Boot and runtime performance

| ID | Finding | Start at |
|---|---|---|
| P0 | Boot awaits both data waves (116 tasks, 2 waves, concurrency 12, already `mapSettled`) before finishing — 70–78 s measured. Fix the awaiting, not the deadlines (every fetch already has a 15 s default) | `App.ts:524`, `data-loader.ts:889` |
| H7 | `panelLayout.init` p50 666 ms / p90 883 ms over 278 boots; construction dominates parse ~6× — build panels lazily | `panel-layout.ts:1245` |
| H3 | 110 of 285 timer-bearing panels bypass the visibility gate; 29 also fetch off-screen | `Panel.ts:1114` |
| M1 | 58 panels share a 30 s cadence started together, no jitter | panel `REFRESH_MS` constants |
| M7 | Alert fan-out throttled in frequency, not cost — `notify()` passes no payload; 13 of 26 subscribers rescan all 500 alerts | `unified-alerts.ts:444` |
| M3 | Battery cadence multiplier reaches no panel | `adaptive-cadence.ts:41` |

### 15. Layout

| ID | Finding | Start at |
|---|---|---|
| H1 | Notification stack may grow to the full viewport; its height becomes content padding with no cap | `NotificationStack.ts:34`, `main.css:908` |
| H2 | Fixed surfaces pinned to `--below-banners` reserve no space and overlap the grid | `main.css:15439` and the list in the evidence log |
| M2 | A z-index token scale exists (`main.css:82`); 155 hardcoded values ignore it — add a ratchet like `lint:colors` | `main.css:82` |

### 16. Housekeeping

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

## Coverage map — what this review did and did not examine

Stated plainly, because "we have them all" is not a claim any review can make. Eleven rounds covered:

**Examined closely (code read end-to-end, most claims measured live):** the unified alert store (ingest, dedupe, prune, persist, archive, subscriber fan-out) · the notification dispatcher and every caller of it, including the seven direct-dispatch sites that bypass the store · all 33 `unifiedAlertStore.ingest()` producers for id stability, timestamp source and severity mapping · the situation engine, correlator and both alert bridges · NWS/GDACS/LSR/tsunami normalisation · the refresh scheduler and adaptive cadence · boot sequencing · the sticky/fixed layout surfaces and the z-index scale · the Tauri IPC surface, CSP, HTML escaping and the RSS proxy's SSRF defence · localStorage/IndexedDB footprint · the sidecar's fetch patch, auth and timeouts.

**Examined shallowly — a targeted pass, not an audit:** the ~285 panels as a population (timer/visibility gating counted, individual panel logic not read) · the ML/embedding subsystem · playback/replay mode · map rendering and layer management · the digest and briefing generators · settings persistence beyond the notification keys.

**Not examined at all:** the Rust/Tauri side beyond the command surface (updater, tray, window management, file system access) · the sidecar's non-RSS routes · build and release tooling · the web build's service worker beyond the one staleness note · test-suite quality · accessibility beyond three specific findings · i18n · anything under `tools/` except the audit-coverage gap in M10.

**Systematic risks to carry forward.** Three defect *classes* were confirmed more than once, so assume more instances exist than are listed:

1. **Source time used as system time** — H17, H22, H12/H13 are the same mistake in three subsystems: a feed's report/onset timestamp is used for retention, clustering or freshness. Grep every `timestamp:` assignment that takes a value from a payload.
2. **"No data" rendered as "nothing is happening"** — H21, plus the offline-cache panels that show hours-old cached rows with no staleness marker (`withOfflineCache` returns `isStale`/`staleDurationMs`/`source`; almost every caller in `data-loader.ts` destructures `{ data }` and discards them). Every empty state should be able to distinguish "clear" from "blind".
3. **Suppression without accounting** — H19, H20, H15: alerts are dropped by rate limit, mode or policy with no user-visible record and no retry. Every suppression path should be counted and surfaceable.

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
