# UI Performance — Handoff for Codex

- **Date:** 2026-09-20
- **Author:** Claude (Opus 5), Cowork session
- **Reviewed SHA:** `bradleybond512/main` @ `7230cef6942871fb9eea04ebed4dffdb258ca6b7`
- **Companion:** [`docs/CLAUDE_UI_PERF_REVIEW_2026-09-20.md`](CLAUDE_UI_PERF_REVIEW_2026-09-20.md) — the full 14-finding review this distills
- **Status:** ready to pick up. Nothing here is claimed. No code in this handoff.
- **Round 4 evidence** (installed build's own log and storage: 278 logged boots, feed-failure counts, storage sizes) is in the review doc; H7/H8/M8/M9 there supersede the inferred versions of the same points.
- **Audience:** Codex / ChatGPT sessions working this repo

This document exists because one finding (M6) was a structural argument until it was measured. It is now measured, and the measurement **changed the fix** and **found a larger problem**. Everything below separates what was measured from what is still inferred, so you do not inherit my guesses as facts.

---

## What was measured, and how

The app already instruments its own boot. `bootTrace()` (`src/services/log-bridge.ts:55`) writes `ms<TAB>label` lines into `localStorage['cb-boot-trace']`, synchronously, so marks survive a main-thread freeze. `src/App.ts` emits 17 marks across the six boot phases.

WebKit keeps that localStorage in a SQLite file, so the trace can be read **without instrumenting anything and without a debug build**, from the installed release app:

```
~/Library/WebKit/com.bradleybond.crystalball/WebsiteData/Default/*/*/LocalStorage/localstorage.sqlite3
```

Values are UTF-16LE. Scan the file (and its `-wal`) for `panelLayout.init:done` encoded UTF-16LE, decode ±12 KB around each hit, and regex out `(\d+)\t([\w:.\-]+)` pairs. Older boots survive in the WAL, so several runs are recoverable at once. A small reader is sketched in the appendix.

**Two independent boots of the installed build (`21606497`):**

| Mark | Boot A | Boot B |
|------|--------|--------|
| `panelLayout.init` (start → done) | **669 ms** | **582 ms** |
| boot start → `phase6:data-load:start` | 1609 ms | 1500 ms |
| first data wave (`awaiting` → `done`) | **77,624 ms** | **69,764 ms** |

Full sequence from boot B:

```
    22 ms  init:start
    95 ms  preload:stores:start
   372 ms  preload:perstore            (+277 ms)
   525 ms  preload:stores:done         (+153 ms)
   525 ms  panelLayout.init:start
  1107 ms  panelLayout.init:done       (+582 ms)  ← largest pre-data block
  1300 ms  phase3:ui-setup:start
  1497 ms  phase4:search-mapslayers-countryintel:start
  1500 ms  phase6:data-load:start
  1508 ms  phase6:data-load:awaiting
 71272 ms  phase6:data-load:done       (+69,764 ms)  ← first data wave
 71275 ms  startLearning:done
```

**Separately measured:** parse+compile cost of the two largest eagerly-preloaded chunks, in V8 (`vm.SourceTextModule`, 3 runs each):

```
panels-Ck9hW0U0.js   3.86 MB   parse+compile: 103 / 85 / 84 ms
main-CUywjLvG.js     1.60 MB   parse+compile:  38 / 38 / 37 ms
```

---

## P0 — The first data wave takes 70–78 seconds, and boot waits for all of it

**This was not in the original review. It came out of the measurement.**

`src/App.ts:524`:

```ts
await Promise.all([preloadCountryGeometry(), this.dataLoader.loadAllData()]);
```

**Correction, after reading `loadAllData()` properly (lines 700–905):** the load is *not* a naive fan-out. It builds 116 tasks, splits them into 11 critical and ~105 deferred, and runs each wave through `createConcurrencyLimiter(12).mapSettled(...)`. Failures are already settled, not thrown, and the two-wave split is deliberate. My first draft of this section implied the fix was `allSettled`; it is already `allSettled`. Do not "fix" that.

The real mechanism is two things the structure does not bound:

1. **Both waves are fully awaited before `loadAllData()` resolves**, and the boot path awaits that. So boot completion waits for the slowest of ~105 deferred tasks, none of which any user is waiting on.
2. **No task has a deadline.** `SLOW_REFRESH_THRESHOLD_MS` (`refresh-scheduler.ts:21`) is 15 s, but it only *warns*. In `data-loader.ts`, 10 of 12 `fetch` sites carry no `AbortSignal`, and none of `loadNews`, `loadMarkets`, `loadIntelligenceSignals`, `loadWeatherAlerts` — four of the eleven critical tasks — pass one.

Measured consequence, from the app's own log across all retained runs: median refresh duration is **40.1 s for `news`** (n=329), 31.1 s for `intelligence` (n=262), 40.1 s for `stablecoins` (n=240). `news` and `intelligence` are both in the critical set, so wave 1 alone can plausibly account for 40 s of the 70–78 s. (Maxima in that data run to hundreds of seconds, but they are contaminated by sleep/wake — treat medians as the reliable figure.)

**Direction, not a prescription:**

1. Give every fetch in `data-loader.ts` a deadline — per-source, generous (15–30 s), but finite. This is the H4 fix applied to the boot path first.
2. Do not await wave 2 on the boot path at all. Let deferred sources land into the existing freshness/staleness machinery as they arrive.
3. Consider a boot-completion deadline for wave 1 too: mark `phase6:data-load:done` when the critical set finishes *or* a budget expires, whichever comes first, and let stragglers report themselves stale.
4. Whatever runs after the await (`startLearning()`, the layer fixups at `App.ts:528-540`) should not be gated on any feed.

**Acceptance:** `phase6:data-load:done` lands within a bounded, documented budget on a cold boot with a deliberately stalled source; no boot-path `Promise.all` over network work; a stalled feed shows as stale in the UI rather than delaying boot completion.

---

## P1 — 582–669 ms constructing 428 panels at boot (the fix is *not* import splitting)

The original review (M6) argued this was preload weight plus construction. The measurement splits those cleanly:

- **Construction: 582–669 ms.** `createPanels()` (`src/app/panel-layout.ts:1245`) registers 428 panels in one synchronous pass. This is the largest single block before data loading starts, ~40% of the 1.5 s to reach phase 6.
- **Parse: ~85–100 ms** for the 3.86 MB panels chunk. Real, but an order of magnitude smaller.

**So: build lazily, do not chase the bundle split first.** The earlier suggestion to dynamic-import panel groups would buy ~100 ms; deferring construction targets ~600 ms. Register a factory per panel id and construct on first reveal — `Panel`'s existing IntersectionObserver (`src/components/Panel.ts:1067`) already knows when that is.

Caveats worth keeping: 428 constructions is measured, but *what* is expensive inside them is not. Before designing, sample a few constructors — if a handful dominate, targeted fixes may beat the architectural change. The bundle budget pressure noted in the review still stands independently (main entry 457 KB gz against a 460 KB limit, panels chunk at 91% of its per-chunk limit).

**Acceptance:** `panelLayout.init` under 150 ms on the same trace; panels still render correctly on first scroll-in; no panel constructed before it is revealed except those in the initial viewport.

---

## P2 — Everything else, in priority order

Full evidence for each is in the review doc; these are the one-line versions with where to start.

| ID | Finding | Start at |
|----|---------|----------|
| H1 | Notification stack can grow to full viewport height and push all content off-screen | `NotificationStack.ts:34`, `main.css:908` |
| H2 | Six fixed surfaces pin to `--below-banners`; nothing reserves space for them | `main.css:15439, 19123, 19251, 19679, 19318` |
| H3 | 110 of 285 timer-bearing panels bypass the visibility gate; 29 also fetch off-screen | `Panel.ts:1114` |
| H4 | 248 of 463 `fetch()` sites have no timeout (the P0 root cause) | `data-loader.ts`, then panels |
| M7 | Alert fan-out throttled in frequency, not cost: 13 of 26 subscribers re-derive from 500 alerts | `unified-alerts.ts:444` |
| M1 | 58 panels share an identical 30 s cadence with no jitter | `REFRESH_MS` constants |
| M4 | 1020 of 2214 catch blocks silent; 170 log anything | repo-wide |
| M2 | z-index token scale exists; 155 hardcoded values ignore it | `main.css:82-93` |
| M5 | 57 unguarded `localStorage.setItem` despite quota helpers | `storage-quota.ts` |
| M3 | Battery cadence multiplier reaches no panels | `adaptive-cadence.ts:41` |
| L1 | `channel.handle` unescaped into an `href` | `LiveNewsPanel.ts:936` |
| L2 | Six interval callbacks persist on every tick | listed in review |
| L3 | Critical posture banner has no `role`/`aria-live` | `panel-layout.ts:1153` |

**One more observation from the measurement, not yet a finding:** the installed app's localStorage WAL is **74 MB** (`localstorage.sqlite3-wal`), with an 8 MB main database and an older 61 MB WAL in a `LocalStorage.backup.*` directory. Given the documented history of quota exhaustion, someone should establish what is writing that much and whether the backup directories are ever reclaimed. I did not investigate; treat it as a lead, not a conclusion.

---

## Already fixed — do not re-fix

PR #1730 (`claude/summary-strip-sticky-offset`, open) contains:

1. `.cb-summary-strip` sticky offset `var(--notification-stack-h)` → `0`. The scroll container already pads by that amount and WebKit resolves sticky offsets from the padding edge, so it was counted twice. Verified in headless Chromium: with 100 px padding, `top:0` pins at 100 px and `top:100px` pins at 200 px.
2. `.critical-posture-banner` moved into the notification stack and de-fixed, so its height reaches `--notification-stack-h`; `BreakingNewsBanner.updatePosition()` no longer adds that height a second time.
3. New `.dc-strip*` styles — `DataCenterPinnedStrip` previously had no CSS at all.

If #1730 has not landed when you start, branch from it or expect conflicts in `main.css` around the summary strip and posture banner.

---

## Working rules for this handoff

From [`AGENTS.md`](../AGENTS.md), condensed:

- Branch `codex/*` off canonical `main`; resolve the remote name, do not assume it.
- One task per PR. Do not bundle P0 and P1.
- UI work claims a `UX-NNN` row in `docs/USABILITY_UPLIFT_FOR_CODEX.md` in the same PR. Suggested IDs: UX-033…UX-044 are proposed at the end of the review doc; the P0 above has no ID yet and deserves its own.
- Behavior changes need behavior-focused tests carrying a mutation proof.
- Cross-agent review: a `codex/*` branch is reviewed by **Claude**. Record the verdict with `scripts/verify-review-verdict.mjs --record --reviewer claude --evidence-file …`, then `bash scripts/pr-closeout.sh`.
- P0 touches the boot path and P1 touches panel lifecycle — both are "high assurance" by the AGENTS.md classification, so stop for human approval after design, before implementation.

---

## Appendix — reading the boot trace

No code needs to be added to the app. Against the installed build:

```python
import glob, re
files = glob.glob('/Users/bradleybond/Library/WebKit/com.bradleybond.crystalball'
                  '/WebsiteData/Default/*/*/LocalStorage/localstorage.sqlite3*')
pat = 'panelLayout.init:done'.encode('utf-16-le')
for f in files:
    b = open(f, 'rb').read()
    i = b.find(pat)
    while i != -1:
        seg = b[max(0, i - 12000): i + 12000].decode('utf-16-le', 'ignore')
        marks = re.findall(r'(\d+)\t([a-zA-Z0-9:._\-]+)', seg)
        # first occurrence of each label wins; one boot per hit, older boots live in -wal
        i = b.find(pat, i + 2)
```

Quit the app before reading if you want the current boot flushed out of the WAL. `resetBootTrace()` clears the key at the start of each boot, so the live key holds one run; the WAL holds the previous ones.

To measure chunk parse cost the way it was measured here:

```
node --experimental-vm-modules -e "
const fs=require('fs'),vm=require('vm');
const s=fs.readFileSync('dist/assets/panels-<hash>.js','utf8');
const t=process.hrtime.bigint(); new vm.SourceTextModule(s);
console.log(Number(process.hrtime.bigint()-t)/1e6,'ms');"
```

This is V8, not JavaScriptCore, so treat it as an order-of-magnitude check — which is all it needs to be to rank parse against construction.
