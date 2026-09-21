# Claude Review — UI Layout, Performance, Load Behavior, Security

- **Date:** 2026-09-20
- **Author:** Claude (Opus 5), Cowork session
- **Reviewed SHA:** `bradleybond512/main` @ `7230cef6942871fb9eea04ebed4dffdb258ca6b7`
- **Scope:** layout/overlay system, runtime performance, render correctness under load, security & data handling
- **Trigger:** the summary strip floated mid-screen during severe weather (fixed in PR #1730). This review asks: what else in the codebase can fail the same way?
- **Status:** findings only — no `UX-NNN` claimed. Proposed IDs below are suggestions for `docs/USABILITY_UPLIFT_FOR_CODEX.md`.

Every finding carries either a re-runnable command or exact file:line paths at the reviewed SHA. Line numbers move; re-derive with the commands before acting.

---

## Summary

| # | Sev | Finding | Area |
|---|-----|---------|------|
| H1 | High | Notification stack can consume the whole viewport and push all content off-screen | Layout |
| H2 | High | Six fixed surfaces pin to `--below-banners` but nothing reserves space for them | Layout |
| H3 | High | 110 of 285 timer-bearing panels bypass the visibility gate; 29 fetch while off-screen | Perf |
| M1 | Medium | 58 panels share an identical 30s cadence with no jitter — synchronized wake-ups | Perf |
| M2 | Medium | The z-index token layer exists but 155 hardcoded values ignore it | Layout |
| M3 | Medium | The battery/context cadence multiplier has no panel consumers | Perf |
| L1 | Low | `channel.handle` is interpolated into an `href` without escaping | Security |
| L2 | Low | Six interval callbacks write to `localStorage` on every tick | Perf |
| H4 | High | 248 of 463 `fetch()` sites have no timeout or abort signal | Async |
| M4 | Medium | 1020 of 2214 catch blocks swallow the error; only 170 log anything | Async |
| M5 | Medium | 57 `localStorage.setItem` calls unguarded, despite quota helpers existing | Data |
| M6 | Medium | 582–669 ms constructing 428 panels at boot (measured); parse is ~100 ms | Startup |
| M7 | Medium | Alert fan-out is throttled in frequency but costs O(subscribers x alerts) | Perf |
| P0 | High | First data wave takes 70–78 s behind one boot-path `Promise.all` (measured) | Startup |
| L3 | Low | The critical posture banner is never announced to a screen reader | A11y |

Two issues of this family are already fixed in PR #1730 and are not re-listed: the summary strip's double sticky offset, and the critical posture banner living outside the stack.

---

## The systemic cause

The app has exactly one mechanism that makes vertical space at the top of the window honest: `NotificationStack` measures itself with a `ResizeObserver` and publishes `--notification-stack-h` (`src/components/NotificationStack.ts:43-51`). `.main-content` reserves that much padding (`src/styles/main.css:908`) and the macOS sidebar nav does the same (`src/styles/macos-native.css:135`).

That mechanism is correct. The bugs come from surfaces that sit in the same physical space **without joining it** — they position themselves with `--below-banners` instead, which offsets them but reserves nothing. Every layout bug found here, including the two already fixed, is one of two shapes:

1. **Double-counted offset** — an element inside the padded scroll container also adds the stack height itself.
2. **Unmeasured overlay** — an element fixed at `--below-banners` that no container reserves space for, so it covers content.

A surface belongs in the stack, or it accepts that it overlays content. There is currently no rule stating which, and no check enforcing one.

---

## High

### H1 — The notification stack can push every pixel of content off-screen

**Where:** `src/components/NotificationStack.ts:34`, consumed at `src/styles/main.css:908` and `src/styles/macos-native.css:135`.

The stack is capped at `calc(100dvh - var(--below-eew))` — the entire viewport below the status bar. Its height is published verbatim as `--notification-stack-h`, and `.main-content` turns that into `padding-top`. There is no upper bound between the two.

Six independent sources mount rows into the stack:

```
src/app/panel-layout.ts:888   StalenessBanner
src/app/panel-layout.ts:1226  Personal Storm Mode
src/app/panel-layout.ts:1242  TriageBar
src/app/panel-layout.ts:1318  sidebar heat / review trail
src/main.ts:265               offline staleness banner
(PR #1730)                    critical posture banner
```

Severe weather is precisely the state that lights up the most of them at once. As the stack grows, content is pushed down one-for-one; at the limit the map and the entire panels grid are scrolled out of the window while the stack itself is the only thing visible. The sidebar nav shifts by the same amount, so navigation also walks off the bottom.

**Why it matters:** the failure mode is worst exactly when the app matters most, and it degrades silently — nothing errors, the content is just gone.

**Suggested fix:** cap the stack (e.g. `max-height: min(40dvh, 320px)`) so its internal `overflow-y: auto` becomes reachable, and clamp the published variable at the same ceiling so padding can never exceed it. Rows beyond the cap scroll inside the stack rather than displacing the app.

**Evidence:**

```bash
grep -n "maxHeight" src/components/NotificationStack.ts
grep -rn "notification-stack-h" src/styles/*.css
grep -rn "notificationStack.element" src --include=*.ts | grep -v __tests__
```

### H2 — Six fixed surfaces pin to `--below-banners`, and nothing reserves space for them

**Where:**

```
src/styles/main.css:15439   .breaking-news-container   z-index 1001
src/styles/main.css:19123   .just-in-rail              z-index 10002
src/styles/main.css:19251   .entity-heat-rail          z-index 45
src/styles/main.css:19679   .related-strip             z-index 1060
src/styles/main.css:19318   .alert-timeline            z-index 44
src/styles/main.css:15196   .critical-posture-banner   (fixed in PR #1730)
```

`--below-banners` is `calc(var(--below-eew) + var(--notification-stack-h))` (`src/styles/main.css:79`), so these do track the stack correctly. What none of them do is contribute their own height to anything. They land on top of the first rows of the panels grid and on top of each other.

The stacking order is also unowned. The summary strip is `z-index: 40` (`src/styles/main.css:923`), `.alert-timeline` is 44 (`main.css:19330`) and `.entity-heat-rail` is 45 (`main.css:19265`) — both of which pin to the same top edge and will cover the strip whenever they are visible. `BreakingNewsBanner` already hand-computes its own top from the stack's bounding rect (`src/components/BreakingNewsBanner.ts:97-108`), which is the workaround this gap forces on each new surface.

**Suggested fix:** decide per surface. Rails and strips that are part of the header region should become stack rows, which makes them measured for free. Anything that stays fixed should be documented as deliberately overlaying, and given a z-index from the token scale (see M2) rather than a number picked to win a local fight.

**Evidence:**

```bash
grep -n -- "--below-banners" src/styles/main.css
grep -rn "getBoundingClientRect" src/components/BreakingNewsBanner.ts
```

### H3 — 110 timer-bearing panels bypass the visibility gate; 29 of those fetch off-screen

**Where:** `src/components/Panel.ts:1067-1096` (IntersectionObserver), `Panel.ts:1114` (`renderWhenVisible`), `Panel.ts:1168` (visibilitychange).

The base class is well built: off-screen panels skip DOM writes, CSS animations are paused via `.panel-offscreen`, and the comment at `Panel.ts:1080-1086` shows the compositing cost was measured with ~185 panels. The gate is opt-in, though, and a large minority of panels never opt in.

Measured at the reviewed SHA:

```
Panel subclasses:                     441
… with their own setInterval:         285
… using renderWhenVisible/isPanelInView: 175
… NOT using it:                       110
… of those, also doing fetch/invoke:   29
… never calling clearInterval:          0
```

The last line is the good news — teardown hygiene is universal. The problem is that a timer that fires while its panel is off-screen still computes, still re-renders, and in 29 cases still hits the network. With most of 441 panels off-screen at any moment, this is steady-state cost for output nobody sees.

**Suggested fix:** route panel refresh through the gate rather than per-panel `setInterval` — either make the base class own the timer (subclasses supply a cadence and a refresh function) or have `renderWhenVisible` wrap the fetch as well as the paint. A lint rule forbidding bare `setInterval` in a `Panel` subclass would keep it from regrowing.

**Evidence:**

```bash
python3 - <<'PY'
import glob,re
sub=[f for f in glob.glob('src/components/**/*.ts',recursive=True)
     if '__tests__' not in f and 'extends Panel' in open(f).read()]
wi=[f for f in sub if 'setInterval' in open(f).read()]
gated=[f for f in wi if re.search(r'renderWhenVisible|isPanelInView',open(f).read())]
print(len(sub),len(wi),len(gated),len(wi)-len(gated))
PY
```

---

## Medium

### M1 — 58 panels share an identical 30s cadence, started together, with no jitter

`grep -rlE "REFRESH_MS *= *30_000" src/components --include=*.ts | wc -l` returns 58, and `createPanels()` constructs them in one pass (`src/app/panel-layout.ts:1245`, 428 registrations). Timers created within the same tick stay phase-aligned, so every 30 seconds those panels wake, recompute and repaint together — a periodic spike rather than spread load. No jitter or stagger exists anywhere in the component tree.

**Suggested fix:** add a small random offset per panel (`REFRESH_MS + Math.random() * 2000`), or schedule through one shared ticker that distributes work across the interval. Combined with H3 this is the single largest idle-CPU lever in the app.

### M2 — The z-index token layer exists but is ignored

`src/styles/main.css:82-93` defines a clean scale: `--z-strip: 1040`, `--z-strip-raised: 1050`, `--z-shift-overlay: 1200`, `--z-status-bar: 9000`, `--z-modal: 10000` … `--z-help: 10004`. Across `src/styles/*.css` there are **155 hardcoded numeric `z-index` values** and only a handful of token uses.

The result is 48 fixed layers with values from 1 to 10004 assigned ad hoc. The posture banner sitting at 999 over a strip at 40 was not a typo; it is what happens when each surface picks its own number. `.today-view` at 9999 and `.cb-operator-feed-strip` at 9999 also sit above the notification stack at 9001, meaning transient UI can cover the severe-weather banners.

**Suggested fix:** ratchet, like `lint:colors` already does for hardcoded colors — record today's count per file in a baseline and fail only when a file exceeds it. Migrate the top-of-window surfaces first, since that is where the collisions are load-bearing.

**Evidence:**

```bash
for f in src/styles/*.css; do grep -HcE "z-index: *[0-9]+" "$f"; done | sort -t: -k2 -rn | head
```

### M3 — The battery/context cadence multiplier reaches no panels

`src/services/adaptive-cadence.ts:41` exports `getContextCadenceMultiplier()`, and `installBatteryMonitor()` tracks battery state. Only `src/app/refresh-scheduler.ts` and `src/app/panel-layout.ts` reference the module — no panel cadence consults it. A laptop on battery with the window in the background still runs all 285 panel timers at full rate.

**Suggested fix:** apply the multiplier wherever the H3 fix centralizes cadence. The two land naturally in one change.

---

## Low

### L1 — `channel.handle` is interpolated into an `href` without escaping

`src/components/LiveNewsPanel.ts:936`:

```ts
: `https://www.youtube.com/${channel.handle}`;
```

The sibling branch escapes its input (`encodeURIComponent(channel.videoId)`) and `channel.name` is passed through `escapeHtml`, so this one path stands out. The URL then goes straight into an `href` attribute in the template below. Channel handles come from the app's own config today, which is why this is Low and not higher, but a handle containing a quote would break out of the attribute, and a `javascript:`-style value would be worth defending against if that list ever becomes remote or user-editable.

**Suggested fix:** `encodeURIComponent(channel.handle)` plus `sanitizeUrl()` — the project already has the latter in `src/utils/sanitize.ts` with SSRF-aware private-host checks.

### L2 — Six interval callbacks write to `localStorage` on every tick

```
src/components/PhishstatsFeedPanel.ts:51
src/services/notification-digest.ts:68
src/services/tv-mode.ts:103
src/services/intelligence/improvement-scheduler.ts:336
src/services/cognition/self-tuning.ts:633
src/services/cognition/consolidation-cadence.ts:20
```

`localStorage` writes are synchronous and block the main thread, and this repo has a documented history of quota exhaustion (noted in `panel-layout.ts` around the mode-advisory wiring). Writing on a timer rather than on change multiplies both risks.

**Suggested fix:** write on state change, or coalesce to a single debounced persist per store.

---

## What is already right

Worth stating plainly, because it constrains how the fixes above should be built:

- **CSP is strict.** `default-src 'self'` with an explicit `connect-src` allowlist; no `dangerous*` flags; three narrow capability files.
- **HTML escaping is disciplined.** Of 123 `innerHTML` template sites, a targeted sweep for unescaped feed-derived interpolation found one attribute case (L1). Panels that render feed text use `escapeHtml` consistently.
- **The alert store is bounded.** `MAX_ALERTS = 500` with a mid-ingest backstop at `2× MAX` and a persist-time bound (`src/services/unified-alerts.ts:127,365,459,487`).
- **Timer teardown is universal.** Zero panels with a `setInterval` lack a `clearInterval`.
- **Layout thrash is rare.** Only six places read geometry inside a timer or observer callback.
- **The panel visibility gate is genuinely good** — including pausing off-screen CSS animations, which is a subtler cost than it looks.

---

## Proposed tracker entries

For `docs/USABILITY_UPLIFT_FOR_CODEX.md` (highest existing ID is UX-032). One task per PR, per AGENTS.md:

| ID | Task | From |
|----|------|------|
| UX-033 | Cap notification stack height and clamp the published variable | H1 |
| UX-034 | Give top-of-window rails and strips one owner: stack row or documented overlay | H2 |
| UX-035 | Centralize panel refresh through the visibility gate; lint bare `setInterval` in panels | H3 |
| UX-036 | Add jitter or a shared ticker to panel cadences; wire the battery multiplier | M1, M3 |
| UX-037 | `lint:layers` ratchet for hardcoded z-index, mirroring `lint:colors` | M2 |
| UX-038 | Escape/sanitize the YouTube handle URL; move timer-driven persists to change-driven | L1, L2 |

---

## Round 2 — three further scans

Run after the findings above, covering lifecycle/leak hygiene, async correctness, and data integrity. One of the three came back clean; that result is recorded here too, because a negative result is worth as much as a finding when deciding where to spend effort.

### H4 — 248 of 463 `fetch()` sites have no timeout or abort signal

**Measured at the reviewed SHA:**

```
fetch() call sites:                      463
… with no AbortSignal / AbortController: 248  (across 160 files)
… of those, inside Panel subclasses:      54
```

Examples: `FeedHealthPanel.ts:104`, `OpenaqMonitorPanel.ts:289`, `SupplyChainDisruptionPanel.ts:93`, `ETFFlowsPanel.ts:57`, `StablecoinPanel.ts:45`.

A `fetch` with no timeout does not fail — it hangs. The panel's refresh promise never settles, so the panel keeps showing its last value with no error state, and the next timer tick starts another request behind the first. For an app whose entire proposition is knowing whether what you are looking at is current, a silent stall is worse than a visible failure: the operator cannot distinguish "nothing has changed" from "nothing is arriving". It also compounds H3 and M1 — ungated panels keep firing requests while off-screen, and 58 of them do it on the same 30-second boundary.

The correct pattern already exists in the codebase: `AbortSignal.timeout(10_000)` at `src/app/desktop-updater.ts:124`, `AbortSignal.timeout(1500)` at `src/app/data-loader.ts:652`, an explicit `AbortController` at `src/utils/geocode.ts:31`.

**Suggested fix:** one `fetchWithTimeout()` helper in `src/utils/`, then a ratcheted lint (like `lint:colors`) on bare `fetch(` so the count can only fall. Panels first — a stalled panel is the visible symptom.

**Evidence:** count sites, then count those whose next 400 characters contain no `signal`:

    grep -rho "fetch(" src --include=*.ts | wc -l

### M4 — Half of all catch blocks swallow the error, and almost none report it

```
catch blocks:                     2214
… that log or report anything:     170   (7.7%)
… empty or comment-only:          1020   (46%)
… doing something else:           1024
```

Many of the silent ones are deliberate and correct — the `catch { /* isolate */ }` around a single panel's render, so one bad feed cannot take down the grid. That pattern is right. The problem is that at this scale it is indistinguishable from a genuine failure being discarded: there is no counter, no breadcrumb, no "this panel has failed N times" signal. `src/services/log-bridge.ts` provides `recordBreadcrumb()` and a boot trace, but 170 call sites out of 2214 means the great majority of failures leave no trace.

This is the mechanism behind a symptom already visible in the UI: a panel reporting "no active alerts" or a stale timestamp when the truth is that its fetch threw and was swallowed. A panel that failed and a panel with nothing to report look identical.

**Suggested fix:** keep isolating, but make isolation observable. A small `isolate(panelId, fn)` helper that catches, increments a per-panel failure counter and records one breadcrumb would let the Communications Health and Feed Health panels tell the truth without changing control flow. The panel health registry referenced at `Panel.ts:1071` is the natural home.

### M5 — 57 `localStorage.setItem` calls are unguarded, though quota helpers exist

`src/utils/storage-quota.ts` exports `isQuotaError()`, `markStorageQuotaExceeded()` and friends, and 148 of 206 `setItem` sites sit inside a `try`. The remaining 57 do not, concentrated in `App.ts` (8), `event-handlers.ts` (5), `sound-manager.ts` (5), `main.ts` (3).

`setItem` throws `QuotaExceededError` synchronously when storage is full. An unguarded call therefore aborts whatever function it is in — mid-render, mid-boot, mid-handler — in exactly the state where storage is already under pressure. The module that detects quota exhaustion exists; what is missing is a single write path that uses it.

**Suggested fix:** add `safeSetItem(key, value)` to `storage-quota.ts` — try/catch, call `markStorageQuotaExceeded()` on a quota error, return a boolean. Convert the 57, then lint direct `localStorage.setItem` outside that module.

### Clean — lifecycle and leak hygiene

No finding. Recorded because it rules out a whole family of suspects for long-session slowdown:

- 91 net `document`/`window` listeners are added and never removed, but **every** owning class is instantiated exactly once (`PanelLayoutManager`, `EventHandlerManager`, `DataLoaderManager`, `DesktopUpdater`, …). App-lifetime singletons, not leaks.
- Only 5 listeners are added inside a re-callable method with an inline (therefore unremovable) handler — `ShiftHandoffCard`, `AlertReplayScrubber`, `RelatedStrip` (x2), `CrystalBallSays` — and all five are in `mount()`, called once at boot.
- Zero panels with a `setInterval` lack a matching `clearInterval`.
- Only 6 places read geometry inside a timer or observer callback, so layout thrash is not a contributor.

If the app slows over a long session, the cause is steady-state work (H3, M1, H4), not accumulating handlers.

### Also clean — snapshot and cache deserialization

The `JSON.parse` surface is in good shape: 352 of 360 sites are guarded. More importantly the paths that matter most are deliberately fail-closed. `src/services/survival/snapshot-integrity.ts:5-18` documents exactly why a blind `JSON.parse(...) as WorldSnapshot` is unacceptable for a grid-down save file, and `world-snapshot.ts:62` validates version and structure before trusting a snapshot. `correlation-store.ts:124` revives `detectedAt` into a real `Date` on hydrate — the bug class from PR #1636 is handled correctly here.

### Proposed tracker entries, round 2

| ID | Task | From |
|----|------|------|
| UX-039 | `fetchWithTimeout()` helper + ratcheted lint on bare `fetch(`; convert panel fetches first | H4 |
| UX-040 | Observable isolation: per-panel failure counters and breadcrumbs behind an `isolate()` helper | M4 |
| UX-041 | `safeSetItem()` in `storage-quota.ts`; convert the 57 unguarded writes; lint direct `setItem` | M5 |

---

## Round 3 — startup, store fan-out, accessibility

### M6 — Boot preloads ~2.4 MB gzipped of JS, then constructs 428 panels synchronously

> **Measured 2026-09-20, after this section was written.** Two boot traces from the
> installed build give `panelLayout.init` = **582 ms / 669 ms**, while V8 parse+compile
> of the 3.86 MB panels chunk is **~85–100 ms**. Construction dominates parse by roughly
> 6×, so the fix is lazy panel construction, not the import split suggested below.
> The measurement also exposed a larger problem — the first data wave takes 70–78 s
> behind a single boot-path `Promise.all` — recorded as P0 in
> [`UI_PERF_HANDOFF_FOR_CODEX.md`](UI_PERF_HANDOFF_FOR_CODEX.md), which supersedes this
> section's suggested fix.

Measured from the build this branch produced:

```
modulepreloaded chunks in index.html:  35        total 2409 KB gz
  panels-*.js                        1093 KB gz  (3958 KB raw)
  deck-stack-*.js                     323 KB gz  (1172 KB raw)
  maplibre-*.js                       267 KB gz  (1008 KB raw)
  panels-analysis-*.js                201 KB gz  ( 760 KB raw)
  + 31 more
GodsVisionView-*.js (1088 KB gz)     NOT preloaded — correctly lazy
```

Then `createPanels()` (`src/app/panel-layout.ts:1245`) registers 428 panels in one synchronous pass, and `panel-layout.ts` statically imports 400 panel modules, which is why the panels chunk is preloaded rather than deferred.

So the cold-start path parses roughly 8.5 MB of raw JavaScript and builds several hundred component instances before the first alert can be read. The `Panel` base class then does the right thing — off-screen panels skip rendering — but that gate only applies *after* construction.

Budget headroom is effectively gone. `scripts/check-bundle-size.mjs` sets `mainEntryGzipBytes: 460 * 1024`; the main entry is **457 KB gz**, 0.7% under the limit. The panels chunk is 1095 KB gz against a 1200 KB per-chunk limit (91%). The gate is real and passing, but the next feature of any size fails CI, and the usual response to that pressure — raising the limit, as the comment at `check-bundle-size.mjs:21` records happening once already — spends startup time that is not being measured.

**Suggested fix:** split panel construction from panel registration — register a factory per panel id and construct on first reveal, so boot pays for the visible grid only. That also lets `panel-layout.ts` dynamic-import panel modules by group, which is what would let the panels chunk stop being preloaded.

**Caveat:** this is a structural argument, not a measured one. Before acting, record a boot profile (`performance.mark` around `createPanels()`, plus a DevTools trace of the preload/parse phase). If construction turns out cheap and parse dominates, the import split alone is the fix. Promote to High if a profile confirms either.

### M7 — Alert fan-out is throttled in frequency, not in cost

`src/services/unified-alerts.ts:130-136` documents the problem it solved: ~26 subscribers re-running on every notify, several of them re-ingesting from their own callback, driving an ingest-burst stall. The fix was a leading+trailing throttle at 100 ms (`notifyThrottleMs`), plus rAF-coalesced persist+notify (`:221`). That is sound work and it bounds how *often* the fan-out runs.

What it does not bound is what each fan-out costs. `notify()` (`:444`) calls every listener with **no payload**:

```ts
private notify(): void {
  for (const fn of this.listeners) {
    try { fn(); } catch { /* noop */ }
  }
}
```

With no payload and no selector API, a subscriber cannot know what changed, so it re-derives. Measured: **26 subscribe sites, 13 of whose callbacks re-scan the full set** (`getAll()`, `.filter()`, `.sort()`) — `panel-layout.ts:3423`, `AlertTimeline.ts:35`, `TodayView.ts:97`, `JustInRail.ts:34`, `alert-fatigue.ts:91`, `relevance-learner.ts:235`, and others.

At the 500-alert cap that is ~6,500 alert visits per fan-out, up to ten times a second during exactly the ingest bursts the throttle exists to survive. The throttle turned an unbounded loop into a bounded one; the per-cycle cost is still O(subscribers x alerts).

Two smaller things in the same function: subscriber errors are swallowed with `catch { /* noop */ }` (the M4 pattern, in the highest-traffic path in the app), and the store has no selector or diff API at all.

**Suggested fix:** pass a payload — changed ids, or at minimum a monotonic revision — so subscribers can skip work when nothing they care about moved. A `subscribeWhere(predicate, cb)` selector would let the 13 full-scan subscribers become incremental. Count one failure per subscriber instead of discarding it.

### L3 — The critical posture banner is never announced to a screen reader

The severe-weather surfaces are mostly well covered:

```
PersonalStormMode        role="alert"   aria-live ✓
StalenessBanner          role="status"  aria-live ✓
EEWStatusBar             role="region"  aria-live ✓
DataCenterPinnedStrip    role="status"  aria-live ✓
SummaryStrip             role="region"  no aria-live
critical posture banner  no role        no aria-live
```

The banner created at `src/app/panel-layout.ts:1153-1161` carries no ARIA at all, and its content is the most urgent text the app produces — the headline, aircraft count, and a `STRIKE CAPABLE` flag. A screen-reader user is told nothing when it appears. It is worth noting that this is the same element that was mispositioned in PR #1730: it was added outside both the layout contract and the accessibility one.

`SummaryStrip` is a lesser case of the same thing — `role="region"` means a user can navigate to it, but its counts changing (0 → 99+ critical) is silent.

Overlay semantics are patchier than the banners: 61 components carry overlay/modal classes, 10 set `role="dialog"`, 7 set `aria-modal`. 32 Escape-key handlers exist across them. Worth a pass, though the `axe` CI job covers static violations and is green.

**Suggested fix:** `role="alert"` plus `aria-live="assertive"` on the posture banner (it is already interrupting by design), and `aria-live="polite"` on the summary strip's counts.

### Clean — module-scope side effects and reduced motion

- Exactly **2** module-scope timers or listeners run at import time across the whole `src/` tree (one in `main.ts`, one in `settings-main.ts`). Importing a module does not start work; everything is behind an explicit `start*()`. That is unusual discipline at this size and it is why the startup cost in M6 is parse and construction, not hidden side effects.
- Motion is globally handled: a `@media (prefers-reduced-motion: reduce)` rule targeting `*, *::before, *::after` exists in `main.css`, so all 98 animation names are covered without per-animation opt-in.

### Proposed tracker entries, round 3

| ID | Task | From |
|----|------|------|
| UX-042 | Lazy panel construction (factory per id, build on first reveal) + grouped dynamic imports | M6 |
| UX-043 | Alert store: notify payload / revision + `subscribeWhere` selector; count subscriber failures | M7 |
| UX-044 | ARIA on the posture banner and summary strip counts; overlay dialog-semantics pass | L3 |

## Method and limits

Three rounds of static analysis, at the reviewed SHA, plus three measured checks: sticky offset resolution inside a padded scroll container was verified in a headless Chromium run (`top:0` pins at the padding edge; `top:<stack height>` pins a further stack-height down), which is what PR #1730 rests on; and round 3's bundle figures are measured from a real `desktop:build:full` output (raw and gzipped chunk sizes, modulepreload list), not estimated; and the boot path was measured directly from the app's own `bootTrace` marks recovered from the installed build's WebKit localStorage (two independent boots), which confirmed M6 and surfaced P0. See `UI_PERF_HANDOFF_FOR_CODEX.md`.

Round 2 shares these limits: the counts are real, but the severity of H4 and M4 is argued from what the code cannot do (report a stall, report a swallowed error), not from an observed incident. Not covered: no profiler run, no memory snapshot, no measurement of actual frame cost during a severe-weather surge. H3 and M1 are structural arguments backed by counts, not by a recorded flame graph. Before investing in the H3 refactor, a 60-second profile with the window backgrounded would confirm the size of the prize. The Rust side was checked only for its security surface, not reviewed for correctness.
