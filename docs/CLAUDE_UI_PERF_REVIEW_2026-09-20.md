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
| H15 | **High** — **fix in PR #1732** | Alert-loop echoes become sticky critical notifications that bypass quiet hours and rate limits — **confirmed by operator** | Notifications |
| H14 | **High** | NWS warnings on triage/inbox/strip are a boot snapshot: no scheduled ingest, no freshness record — 76 alerts behind live | Detection |
| H12 | **High** | 80% of displayed NWS warnings are stale — 52 of 65 expired, cancelled or superseded, incl. 2 tornado warnings | Correctness |
| H13 | **High** | Future-onset warnings (up to +90 h) render as "now" and outlive their expiry | Display |
| H10 | **High** — **fix in PR #1732** | Alert feedback loop: 286 of 289 "critical" alerts are correlation echoes of weather warnings, labelled civil unrest | Correctness |
| H11 | **High** | GDACS silently down: `/MAP` now returns HTTP 400; `/SEARCH` works with the same schema | Correctness |
| M12 | Medium | Renderer aborts RSS at 15 s; sidecar allows 12–20 s *per hop* — 323 of 323 proxy failures are aborts | Perf |
| H1 | High | Notification stack can consume the whole viewport and push all content off-screen | Layout |
| H2 | High | Six fixed surfaces pin to `--below-banners` but nothing reserves space for them | Layout |
| H3 | High | 110 of 285 timer-bearing panels bypass the visibility gate; 29 fetch while off-screen | Perf |
| M1 | Medium | 58 panels share an identical 30s cadence with no jitter — synchronized wake-ups | Perf |
| M2 | Medium | The z-index token layer exists but 155 hardcoded values ignore it | Layout |
| M3 | Medium | The battery/context cadence multiplier has no panel consumers | Perf |
| L1 | Low | `channel.handle` is interpolated into an `href` without escaping | Security |
| L2 | Low | Six interval callbacks write to `localStorage` on every tick | Perf |
| H4 | ~~High~~ **Low** | 248 `fetch()` sites lack their own signal — but the desktop fetch patch adds a 15 s default (see round 6) | Async |
| M4 | Medium | 1020 of 2214 catch blocks swallow the error; only 170 log anything | Async |
| M5 | ~~Medium~~ **Low** | 57 unguarded `setItem` calls — but a global patch catches quota errors and never rethrows (round 6) | Data |
| M6 | Medium | 582–669 ms constructing 428 panels at boot (measured); parse is ~100 ms | Startup |
| M7 | Medium | Alert fan-out is throttled in frequency but costs O(subscribers x alerts) | Perf |
| P0 | High | First data wave takes 70–78 s behind one boot-path `Promise.all` (measured) | Startup |
| H7 | High | `panelLayout.init` p50 666 ms / p90 883 ms across 278 logged boots | Startup |
| H8 | High | ~48k failed sidecar fetches (9,593 burst episodes); IPC degrades to postMessage 6x/boot | Runtime |
| M8 | Medium | Chronic feed failure is warning-only: 19,812 WARN vs 91 ERROR | Observability |
| M9 | Medium | localStorage at 6.1 MB ceiling; 292 MB IndexedDB; 64 MB orphaned WAL | Data |
| M10 | Medium | Three subproject lockfiles are outside every audit gate (9 open Dependabot alerts) | Supply chain |
| M11 | Medium | 6 of 38 API keys are invalid, incl. boot-critical `NEWSAPI_KEY`; nothing re-validates | Config |
| H9 | ~~High~~ **RETRACTED** | Relative `/api/…` fetches DO reach the sidecar via the runtime fetch patch (round 6) | Correctness |
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

---

## Round 4 — evidence from the running app

Rounds 1–3 read the code. This round reads what the installed build actually did, from its own log (`~/Library/Logs/com.bradleybond.crystalball/desktop.log` plus rotations, ~20 k lines live, 4 rotated files) and its own storage. Several earlier findings move from inference to measurement, and one of my own corrections was itself corrected.

### H7 — `panelLayout.init` measured across 278 boots

The app logs `[BOOT-TIMING] preload+routing gated boot for <n>ms; panelLayout.init took <n>ms` on every boot. Across all retained logs:

| Boot metric | n | min | p50 | p90 | max |
|---|---|---|---|---|---|
| `panelLayout.init` | 278 | 424 ms | **666 ms** | 883 ms | 2209 ms |
| preload+routing gate | 278 | 12 ms | 367 ms | 573 ms | 1249 ms |
| `preloadIdbBackedStores` | 279 | 10 ms | 266 ms | 415 ms | 996 ms |

M6 is no longer an argument: **666 ms at p50, 883 ms at p90**, every boot, constructing 428 panels. The two traces quoted in the handoff (582 / 669 ms) sit right on the median.

### H8 — The sidecar fails constantly, and IPC has been falling back to the slow path

Across all retained logs:

```
fetch failure burst: localhost            9593   (each line = >=5 failures in 5 min)
fetch failure burst: 127.0.0.1:46123       301
fetch failure burst: droughtmonitor.unl.edu 1926
"IPC custom protocol failed, Tauri will now use
 the postMessage interface instead"         438  (live log alone)
```

`127.0.0.1:46123` is the sidecar, explicitly allowed in the CSP `connect-src`. Whatever the cause, the app's own burst detector fired on localhost nearly ten thousand times. The IPC line is separate and worse for latency: Tauri's custom-protocol IPC is the fast path, and the app has been repeatedly degrading to `postMessage` — every IPC payload then pays serialization through the webview bridge.

Neither surfaces in the UI. Both are `console.warn`.

### M8 — Chronic feed failure is invisible: 19,812 warnings, 91 errors

The live log is 20,911 lines, of which **19,812 match WARN and only 91 ERROR**. Top failing feeds across all retained logs:

```
1324  Atlantic Council   (HTTP 403 — looks permanently blocked, not flaky)
 686  Lawfare
 683  Japan Today
 676  GDELT Tensions
 654  GDACS              (HTTP 400 — a malformed request is a bug, not an outage)
 638  War on the Rocks
 633  ThisDay
 632  Financial Times
 489  News Summarization
```

Cooldowns entered: GDACS 416, News Summarization 319, UCDP Events 185, Chokepoint Status 173, ADS-B 146. One more line worth reading twice: `[IntelProvider] Circuit breaker open after 405 failures`.

The cooldown and circuit-breaker machinery is doing its job — the app stays up. But M4 predicted exactly this: a feed that has been 403-ing 1,324 times and a feed returning HTTP 400 (which no amount of retrying will fix) are indistinguishable, from the UI, from a quiet day. A panel showing nothing looks the same either way.

**Suggested fix:** promote a feed that has exhausted its cooldowns to a visible state — the Feed Health and Communications Health panels already exist and are the natural surface. HTTP 400 and 403 in particular should be classified as "broken, stop retrying, tell someone" rather than "temporarily unavailable".

### M9 — Storage: 6.1 MB of localStorage at the ceiling, 292 MB of IndexedDB, 64 MB orphaned

Read directly from the installed build's WebKit storage:

```
localStorage (live):      318 keys, 6.1 MB
  crystalball-cognition-embed-cache-v1    1525 KB
  crystalball-forecast-calibration-v1      923 KB
  wm-correlation-store                     588 KB
  wm_offline_weather-alerts                514 KB
  crystalball-cognition-episodic-v1        339 KB
localstorage.sqlite3 + WAL:  7.4 MB + 16.2 MB (WAL was 74 MB before checkpoint)
LocalStorage.backup.1783443073/:  5.9 MB + 63.8 MB WAL   (orphaned since 2026-07-07)
IndexedDB total:           292.3 MB
IDB→memory mirror at boot:  19.0 MB  (p50 266 ms, per H7 table)
```

Three separate problems:

1. **localStorage is at its practical ceiling.** ~6 MB across 318 keys, and the largest consumers are an ML embedding cache and calibration history — data that belongs in IndexedDB, which the app already uses. This is the mechanism behind the quota incidents the code comments reference, and it makes M5's 57 unguarded `setItem` calls a live risk rather than a theoretical one.
2. **The WAL churns to 74 MB between checkpoints**, which is a lot of write traffic for a 6 MB store — consistent with L2 (timer-driven persists).
3. **A 64 MB orphaned backup WAL** has been sitting since July. Whatever created `LocalStorage.backup.*` never reclaims it.

### Input latency — strong signal, contaminated measurement

The app logs `[INPUT-LATENCY]` when event delivery is slow: **6,703 samples, p50 1,360 ms, 4,312 of them over 1 second**, many with `handlers 0ms` — meaning the delay is in delivery, not in the handler.

I am not filing this as a finding, because the maximum is 7,214,088 ms, which is not a real input delay — it is the app being suspended and waking. Sleep/wake contamination inflates an unknown share of the distribution, and the same caveat applies to the `Slow refresh` figures below. A controlled run (launch, interact for five minutes, no sleep) would separate real main-thread blocking from suspend artifacts. Given H3, M1 and H7, I expect a real signal underneath, but expectation is not measurement.

### Refresh durations, for context

`SLOW_REFRESH_THRESHOLD_MS` is 15 s (`src/app/refresh-scheduler.ts:21`) and the line is logged **only when a refresh breaches it**, so what follows counts breach episodes, not typical refreshes (see the verification pass below, which corrects an earlier misreading of exactly this):

```
domain        episodes >=15s   median of those   worst
news                     329          40,060 ms   849,251 ms
etf-flows                264          40,165 ms   747,645 ms
intelligence             262          31,087 ms   933,758 ms
stablecoins              240          40,158 ms   981,494 ms
markets                  203          40,698 ms   487,250 ms
```

`news` and `intelligence` are both in the boot-critical wave. Maxima carry the sleep/wake caveat; the episode counts do not.

### Round 4 verification pass

Every round-4 number was re-checked against the emitters that produce it, because a log line that is only written when something is slow cannot be used to describe the typical case. One of my own figures failed that test.

**Confirmed — H7 is sound.** `[BOOT-TIMING]` is emitted unconditionally on every non-E2E boot (`src/App.ts:441`, guarded only by `bootLayoutT > 0`), so it is not a slow-boot-only sample. Checking for rotation double-counting: of 122,144 distinct log lines across the live log and its three rotations, **zero appear in more than one file**. The 278 BOOT-TIMING lines are 278 distinct boots (73 + 89 + 49 + 67). `panelLayout.init` p50 **666 ms**, p90 883 ms, max 2209 ms stands as written.

**Corrected — the "40 second median refresh" figure was wrong.** `Slow refresh` is logged only when `elapsed >= SLOW_REFRESH_THRESHOLD_MS` (15 s, `refresh-scheduler.ts:115`). The sample therefore contains only refreshes that already breached the threshold, and a median computed over it is the median *of slow refreshes*, not of refreshes. The correct statement:

```
domain        episodes >=15s   median of those   worst
news                     329          40,060 ms   849,251 ms
etf-flows                264          40,165 ms   747,645 ms
intelligence             262          31,087 ms   933,758 ms
stablecoins              240          40,158 ms   981,494 ms
markets                  203          40,698 ms   487,250 ms
```

So: `news` has breached 15 s **329 times**, and when it does, the median is 40 s. What share of all `news` refreshes that represents is not recoverable from the log, because fast refreshes are never written. It remains strong evidence for the P0 direction — a boot-critical source routinely running 40 s with no deadline — but it is not a typical-case measurement, and the handoff has been corrected in place. The same selection bias applies to `[INPUT-LATENCY]`, which only fires above 500 ms (`log-bridge.ts:181`), which is why it was not filed as a finding.

**Sharpened — H8 is worse and more specific than first stated.** Three details from the emitter (`log-bridge.ts:436-457`):

1. The burst line fires only when a host reaches **exactly 5 failures inside a rolling 5-minute window**, and only after a 20 s startup grace that exists specifically to suppress panel-init races. So each line is one burst episode of at least five failures — 9,593 localhost lines means **at least ~48,000 failed fetches**, not 9,593.
2. `host` comes from `new URL(url, location.href).host`. In the desktop webview `location.href` is `tauri://localhost`, so every **relative** fetch buckets as `localhost`. The app makes many (`/api/sms/config`, `/api/maritime/vessels`, `/api/freight-stress`, `/api/supplychain/bdi`, …) — these are sidecar API calls. The separate `127.0.0.1:46123` bucket (301 lines) is the absolute-URL path to the same sidecar.
3. The IPC fallback is **not** a startup transient. Across the live log's 73 boots, 438 fallback lines is 6.0 per boot, and **330 of them occur more than 10 minutes into a session** (median 2,894 s after boot). The fast custom-protocol IPC path is degrading during steady-state operation.

**New lead tying H8 to P0.** The failing sidecar calls include `http://127.0.0.1:46123/api/rss-proxy?url=…` — the RSS proxy behind the `news` pipeline, and `news` is in the boot-critical wave. There is also a comment at `src/services/runtime-config.ts:1392-1394` noting that callers build URLs from a default port 46123 while the sidecar may be listening on an OS-assigned fallback port. If that mismatch is happening in practice it would explain the localhost bursts, the slow `news` refreshes and part of the 70–78 s first wave in one stroke. **This is a hypothesis, not a finding** — confirm by checking the sidecar's actual listening port against what the renderer requests during a session where bursts appear.

---

## Round 5 — the sidecar investigation

The round-4 verification ended with a hypothesis: a default-port-vs-fallback-port mismatch explaining the sidecar failures, the slow `news` refreshes and part of the boot wave. That hypothesis is **wrong**. Chasing it turned up a different, concrete bug.

### Disproved — there is no port mismatch

With the app running:

```
lsof: node (pid 38117)  TCP 127.0.0.1:46123 (LISTEN)
curl http://127.0.0.1:46123/api/health   ->  HTTP 200 in 3.5 ms
curl .../api/rss-proxy?url=…             ->  HTTP 401 {"error":"Unauthorized"}
```

The sidecar is listening on exactly the port the renderer targets, and it answers its health check in single-digit milliseconds. The 401 is correct behaviour, not a fault: every route below `local-api-server.mjs:487` requires a `LOCAL_API_TOKEN` bearer, and my curl has no token. `getApiBaseUrl()` (`src/services/runtime.ts:100-111`) returns `http://127.0.0.1:${getLocalApiPort()}` in desktop and can never be empty, so the guarded call path resolves correctly too. **The port hypothesis is dead — do not spend time on it.**

### Disproved — the sidecar is not wedging, and the renderer watchdog is not reloading

Two more candidate explanations, both eliminated:

- `sidecar heartbeat stale` appears **252 times** with 252 matching `heartbeat recovered` lines, which looks alarming until you measure the gaps: p50 **5 s**, p90 938 s, max 500,278 s (5.8 days). A 5.8-day "stall" is the app not running, not a hang. These are mostly sleep/close artifacts.
- More decisively, they do not correlate with the failures. Of 2,483 aborted-fetch lines, **1% fall within ±60 s of a stale episode — exactly the 1% baseline** you would expect by chance given how much of the timeline sits near one. For the localhost bursts it is 0% against a 3% baseline.
- The Rust renderer watchdog (`src-tauri/src/main.rs:4704`, reloads a webview with no heartbeat) fired **once** in ~23 days of logs. So H7's 278 boots are genuine launches, not watchdog reload loops — which also confirms the H7 sample is what it claims to be.

### H9 — 20 relative `/api/…` fetches can never reach the sidecar in the desktop build

This is what the investigation actually found.

`proxyUrl()` / `toRuntimeUrl()` exist to turn `/api/x` into `http://127.0.0.1:46123/api/x` when running under Tauri. **20 call sites skip them and call `fetch('/api/…')` directly.** In the desktop webview `location.href` is `tauri://localhost/`, so a relative fetch resolves against the app's own asset origin — `tauri://localhost/api/…` — which is not the sidecar and never will be.

**15 of those 20 target routes that genuinely exist on the sidecar:**

```
MaritimeIntelPanel.ts:220   /api/dark-vessels
MaritimeIntelPanel.ts:233   /api/freight-stress
MaritimeIntelPanel.ts:251   /api/acled-events
MaritimeIntelPanel.ts:264   /api/maritime/vessels
GlobeDataManager.ts:2129    /api/maritime/vessels
MaritimeSuperpowerPanel.ts:180  /api/freight-stress
DiseaseOutbreakPanel.ts:112 /api/cdc-ari
SupplyChainDisruptionPanel.ts:93  /api/supplychain/bdi
SmsSettingsPanel.ts:60/95/102/119  /api/sms/{config,status,command}
S2UndergroundPanel.ts:131   /api/patreon/authorize-url
s2-underground-media.ts:116 /api/patreon/audio-rss
agent-monitor-projection.ts:122  /api/local-agent-monitor
```

The other five (`/api/floods/gauges`, `/api/floods/warnings`, `/api/intelligence/prioritized`, `/api/bootstrap`, `/api/ucdp-classifications`) have no matching sidecar route at all, so they fail for two reasons at once.

Read plainly: **maritime vessel tracking, dark-vessel detection, freight stress, ACLED events, CDC respiratory-illness data, supply-chain BDI, the SMS settings panel and its command path, and the local agent monitor cannot reach their data in the installed desktop app.** Each failure is caught and rendered as an empty or stale panel — M4 again: a dead feature and a quiet day look identical.

**The fix is mechanical:** route these through `fetchWithProxy()` or wrap the path in `toRuntimeUrl()`. The guard that would prevent regression is a lint rule banning a string literal starting `/api/` as the first argument to `fetch(` outside `src/utils/proxy.ts`.

### What is still unexplained

The ~48,000 failed fetches in the `localhost` bucket are **consistent** with H9 — that bucket is precisely the tauri origin — but not proven to be it. The burst line records only the host, never the path, and none of the fifteen paths above appears anywhere in the logs, so the attribution cannot be closed from existing evidence. Likewise the 2,483 aborted fetches now have no confirmed cause: not the watchdog, not sidecar stalls, and `fetchWithProxy` passes no `AbortSignal` of its own.

**Next step, cheap and decisive:** add the pathname to the burst alarm (`log-bridge.ts:452-455` currently logs `host` only). One field turns ~48,000 anonymous failures into a named list, and would confirm or refute H9 in a single session.

---

## Round 6 — corrections: three findings retracted or downgraded

This round started as three new scans (dependencies, the Tauri IPC surface, configuration completeness) and ended by invalidating earlier work. `src/main.ts:271-274` installs two global patches I had not accounted for, and they change what several source-level counts mean at runtime:

```ts
installLocalStoragePatch();   // src/utils/safe-storage.ts:169
installRuntimeFetchPatch();   // src/services/runtime.ts:263
```

Anything below that contradicts an earlier round supersedes it. Codex should not work from the retracted versions.

### RETRACTED — H9 was wrong. Relative `/api/…` fetches do reach the sidecar

H9 claimed that 20 call sites using `fetch('/api/…')` skip `toRuntimeUrl()` and therefore resolve to `tauri://localhost/api/…`, leaving maritime, SMS, disease and supply-chain features unable to reach their data.

That is false. `installRuntimeFetchPatch()` replaces `window.fetch` in desktop builds. `getApiTargetFromRequestInput()` (`runtime.ts:166-188`) returns the path for **any string input starting with `/`**, and for any URL on the app origin. The patched fetch then rewrites it to `${getApiBaseUrl()}${target}`, attaches the `Authorization: Bearer` token, retries on a cold-start 401, and can fall back to the cloud API. The relative call sites work.

What survives is much smaller: those 20 sites are inconsistent with the 21st and rely on a global monkey-patch rather than the explicit helper. Worth a tidy-up and a lint rule for consistency; **not** a broken-feature bug. My apologies — I asserted a user-visible outage that does not exist.

### DOWNGRADED — H4 does not describe desktop runtime

H4 counted 248 of 463 `fetch()` sites with no `AbortSignal` and called a hung request unbounded. The patched fetch supplies one for every call that lacks its own:

```ts
const withTimeout = (base?: RequestInit): RequestInit =>
  callerSignal ? { ...base } : { ...base, signal: AbortSignal.timeout(15_000) };
```

The comment above it names the exact situation I "found": *"~100 data feeds route through this patched fetch with no timeout of their own, so a hung connection would otherwise stall forever."* It was already solved. On desktop every fetch has a 15 s deadline per attempt.

**This also closes the open question from round 5.** The 2,483 `Fetch is aborted` lines that had no confirmed cause are this timeout firing. Not the watchdog, not sidecar stalls — the app's own 15 s abort, working as designed.

H4 survives only as: (a) web builds get no such default, since the patch is desktop-only; (b) relying on a global patch means a caller that constructs its own `Request` off the app origin bypasses it. Severity drops from High to Low.

### DOWNGRADED — M5's unguarded `setItem` calls cannot throw

M5 flagged 57 `localStorage.setItem` calls outside a `try`. `installLocalStoragePatch()` wraps `setItem` globally: on a quota error it evicts the largest disposable cache entries, retries once, calls `markStorageQuotaExceeded()`, and — explicitly — never rethrows to the caller (`safe-storage.ts:180-198`). The callers cannot see a `QuotaExceededError`.

M9's measurement (6.1 MB across 318 keys, at the ceiling) still stands, and the eviction path being exercised is itself a symptom. But "57 unguarded writes can abort a render mid-flight" was wrong. Low, as a style point.

### What the timeout finding means for P0

P0 listed two mechanisms: both waves awaited on the boot path, and no task deadline. The second was wrong — every fetch attempt is bounded at 15 s. The first still stands, and the arithmetic now works better: a task can chain a local attempt (15 s), a startup retry loop (`fetchLocalWithStartupRetry`, up to 4 attempts), and a cloud fallback (another 15 s). A `news` refresh landing at ~40 s is a few bounded attempts in sequence, not one unbounded hang. **Fix the awaiting, not the deadlines.**

### M10 — the dependency audit gate has a blind spot

Dependabot reports 9 open alerts (4 high, 5 medium) while `npm audit` at the repo root reports **zero**. Both are correct; they look at different manifests:

```
root package-lock.json      fast-uri 3.1.7   dev: true
tools/mcp-server/           fast-uri 3.1.5   production   <- 4 high SSRF alerts
tools/mcp-server/           hono 4.13.1      production   <- 3 medium
tools/mcp-server/           qs 6.15.2        production   <- 2 medium
src-tauri/sidecar           (zero dependencies)
```

`.github/workflows/security-audit.yml:22` runs `npm audit --audit-level=high` at the root only, plus `cargo audit`/`cargo deny` in `src-tauri`. Nothing audits `tools/mcp-server`, `tools/cb-control` or `scripts/`, each of which has its own lockfile. And `--audit-level=high` means a medium never fails CI anywhere.

**The good news:** none of this ships. The desktop sidecar has zero dependencies and the vulnerable packages live in developer tooling. **The gap:** `tools/mcp-server` is an HTTP server (hono) run locally and driven by an agent, and the fast-uri advisories are SSRF and host-confusion — exactly the class that matters for a local server that fetches URLs on request.

**Suggested fix:** add the subproject lockfiles to the audit job (a matrix over the four directories), and decide deliberately whether medium should gate.

### M11 — Six of 38 API keys are invalid, and nothing re-checks them

From the installed app's own key-status records:

```
invalid  NEWSAPI_KEY           last checked 2026-11-23
invalid  GOOGLE_MAPS_API_KEY   last checked 2026-11-23
invalid  FINNHUB_API_KEY       last checked 2026-04-25
invalid  FMP_API_KEY           last checked 2026-04-25
invalid  VULNERS_API_KEY       last checked 2026-04-25
invalid  BITCOINABUSE_API_KEY  last checked 2026-04-25
valid    (32 others)
```

`NEWSAPI_KEY` is invalid, and `news` is in the boot-critical wave — the same source with 329 slow-refresh breaches. Four of the six were last validated in April; nothing re-validates on a schedule, so a key that lapsed months ago sits in the same silent state as M4 and M8 describe. The Settings surface shows status when opened; nothing surfaces it otherwise.

### Secrets timing at startup — real, but already mitigated

Worth recording because it looks alarming in the log and is not:

```
injected 0 keychain secrets into sidecar env        (at spawn)
injected 14/18 keychain secrets via IPC             (+4 s)
```

The sidecar starts with no provider keys and receives them about four seconds later, while `loadDesktopSecretsWhenReady()` (`main.ts:276`) is deliberately fire-and-forget so a slow Touch ID never blocks the window. The bearer-token path is defended — `fetchLocalWithStartupRetry` retries up to four times and a cold-start 401 triggers a token refresh and one retry. The residual is narrow: an upstream provider call made inside that ~4 s window can run without its API key and fail for a reason unrelated to the provider. Given the boot wave starts at ~1.5 s, the window overlaps the first seconds of feed loading. Low, and worth a single ordering assertion rather than a redesign.

### Clean — the Tauri IPC surface is well defended

35 `#[tauri::command]` handlers. Every one I inspected calls `require_trusted_window(webview.label())` first, and the sensitive ones are properly constrained:

- `open_url` rejects any scheme but `https`, then blocks `localhost`, `127.0.0.0/8`, `0.0.0.0`, `::1`, RFC-1918 ranges, `169.254.0.0/16` and `.local` — with a comment naming the exact threat (a compromised webview reaching the sidecar through the system browser).
- `send_imessage` rate-limits, truncates recipient to 64 and body to 512 bytes, and strips quotes, backslashes, newlines and control characters before AppleScript interpolation.
- `write_cache_entry` caps key at 256 bytes and value at 5 MB, parses the payload as JSON, and keys an in-memory map — no filesystem path derived from caller input.
- `save_brief` whitelists filename characters and rejects `.`, `..` and NUL.
- `get_local_api_token` is gated the same way; the token never leaves a trusted window.

One design note deserves credit: `runtime-config.ts:1388-1394` deliberately skips the JS→sidecar secret push at boot because a foreign process squatting port 46123 would otherwise receive every secret and the bearer token. That is precisely the attack my round-4 port hypothesis implied, already considered and defended.

---

## Round 7 — high-value targets

Chosen by expected payoff rather than coverage, and checked against the global runtime patches before anything was filed (the round-6 lesson). One candidate finding was dropped during that check and is recorded at the end.

### H10 — A feedback loop turns weather warnings into "critical civil unrest" and floods the alert store

**This is the direct cause of the symptom that started this review.** The original screenshot showed `SEVERE WEATHER · 99+ crit · 99+ high`, `Situation Awareness 277 unreviewed`, and the line *"11 correlated civil unrest signals detected: keyword_spike, convergence."* — during a flood and gale event.

**Measured, from the installed app's live alert store** (`wm-unified-alerts-v1`):

```
alerts stored                 500   (the MAX_ALERTS cap — full)
  critical                    289
    from source 'correlation' 286
    from source 'nws'           2
  all 500 unacknowledged
alerts from 'correlation'     429   (86% of the store)
alerts from 'nws'              65   (NWS itself rated them: 30 medium, 33 high, 2 critical)
```

And the duplication:

```
"Flood Warning"                    71 alerts, 71 distinct ids, median gap 0 s
   ids: sit-sit-muaheaov-33, -34, -35 …   (one timestamp, a counter climbing)
   body: "1 correlated civil unrest signal detected: keyword_spike."
"FLOODING — Dubuque, IA"           31 alerts in 5 minutes, median gap 0 s
   body: "1 correlated civil unrest signal detected: convergence."
"Cascading Infrastructure Failure" 47 alerts, sequential ids …5966456, 457, 458
```

**The loop, traced through the code:**

1. `src/services/situation-feed.ts:28-32` subscribes to the unified alert store and passes **every alert with a new id** to `situationEngine.observeAlerts()`. There is no source filter.
2. `situation-engine.ts:~68-76` turns each critical/high alert into a pseudo-signal. `alertSourceToSignalType()` (`:102-107`) maps `nws → 'keyword_spike'` and **everything else — including `'correlation'` — to `'convergence'`**.
3. `situation-types.ts` `SIGNAL_DOMAIN_MAP` hardcodes `keyword_spike → 'civil_unrest'` and `convergence → 'civil_unrest'`. So a Flood Warning becomes a civil-unrest signal, and the situation's summary is generated from that domain (`situation-correlator.ts:155`), which is where *"civil unrest signal detected"* comes from.
4. The situation engine mints a **new** situation per signal via `nextSituationId()` (`situation-store.ts:37-40`) rather than merging into the existing one for the same event.
5. `situation-alert-bridge.ts` promotes active situations to alerts with `severity: 'critical'` when confidence ≥ 0.75. The pseudo-signal for a critical alert carries confidence 0.85. So the output is `critical`, `source: 'correlation'`, with a **new** id.
6. That new id is "new" to step 1. **The engine consumes its own output.**

The bridge's comment says ids are stable "so updates replace, not duplicate" — and the bridge is correct. The id instability comes from step 4, one level up, and it is what lets the loop run: a stable id would stop at step 1.

**Consequences:**

- The triage signal is meaningless during precisely the events it exists for. "99+ critical" was ~2 real critical alerts and ~286 echoes.
- **It crowds out real alerts.** The store holds 500 and evicts by age; 86% of it is echoes, so genuine NWS alerts are the ones being pushed out.
- **It mislabels severe weather as civil unrest** in a tool built for crisis awareness.
- It is the loop that `unified-alerts.ts:130-136` describes ("several re-ingest from their callback — a feedback loop"). The 100 ms throttle added there paces the loop; it does not stop it. M7's fan-out cost is this loop's cost.

**Suggested fix, in order of leverage:**

1. `situation-feed.ts`: exclude derived sources (`correlation`, and any other bridge output) from `observeAlerts`. This alone breaks the loop.
2. `alertSourceToSignalType`: map weather sources to a natural-hazard signal type, not `keyword_spike`; stop defaulting unknown sources to a civil-unrest type.
3. Merge situations for the same underlying event (source alert id, or title + geo cell) instead of minting one per signal.

**Acceptance:** during a flood event, `correlation`-sourced alerts do not outnumber their source alerts; no alert body names a domain unrelated to its title; the critical count in the summary strip matches the critical count in the source feeds to within the situations genuinely synthesized.

### H11 — GDACS has been silently down: the API now rejects the request the app sends

`src/services/gdacs.ts:92` calls `https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP` with no parameters. Reproduced against the live API:

```
GET …/geteventlist/MAP                             HTTP 400  {"message":"Eventtype is required."}
GET …/geteventlist/MAP?eventtypes=&alertlevel=…    HTTP 400  (same)
GET …/geteventlist/MAP?eventtypes=EQ,TC,FL,VO,DR,WF HTTP 400  (same)
GET …/geteventlist/MAP?eventlist=EQ;TC;FL;VO;DR;WF HTTP 400  (same)
GET …/geteventlist/SEARCH                          HTTP 200  137 KB GeoJSON FeatureCollection
GET …/geteventlist/SEARCH?eventlist=…&alertlevel=Orange;Red  HTTP 200  96 features
```

GDACS changed its API contract; `/MAP` fails in every form tried. `/SEARCH` returns the same GeoJSON shape, and every field `parseGDACSResponse` reads is present — `eventid`, `eventtype`, `alertlevel`, `name`, `fromdate`, `severitydata`, `url`, `country` — across all six event types (DR, EQ, FL, TC, VO, WF).

This is the "654 failures on HTTP 400" from M8, root-caused. GDACS is the global disaster feed — earthquakes, cyclones, floods, volcanoes — and `gdacsAlerts` is in the boot-critical wave. Its circuit breaker is configured with `persistCache: true`, so for as long as this has been broken the app has been serving a cached snapshot or nothing, with no user-visible signal that the source is dead. `src/services/api-diagnostic.ts:94` probes the same broken URL, so the diagnostic has been reporting the failure correctly the whole time; nothing acted on it.

**Fix:** change `MAP` to `SEARCH` at `gdacs.ts:92`, optionally with `?eventlist=EQ;TC;FL;VO;DR;WF&alertlevel=Orange;Red` (the code already drops Green client-side). Update `api-diagnostic.ts:94` to match. A contract test that asserts the endpoint returns a FeatureCollection would have caught this on day one.

### M12 — Timeout budgets are inverted between the renderer and the RSS proxy

- The renderer's news fetch (`rss.ts` → `fetchWithProxy(url)`) passes no signal, so the runtime patch applies its **15 s** default.
- The sidecar's `/api/rss-proxy` (`local-api-server.mjs:15729`) allows **20 s** for `news.google.com` and 12 s otherwise — **per redirect hop**, because `fetchWithTimeout` is called fresh inside the manual-redirect loop, which allows up to 3 redirects. Worst case at the sidecar is 4 × 20 s = 80 s.

233 of the 431 RSS feeds in `src/config/feeds.ts` go through Google News. The renderer therefore always gives up before the sidecar does: the sidecar keeps fetching for a caller that has already left, and a slow feed never returns a clean `504 Feed timeout` — it becomes an anonymous abort. The log agrees exactly: **all 323 logged rss-proxy failures are aborts, and none is the sidecar's own 504.** 136 of them (42%) name Google News.

**Fix:** make the sidecar's budget a total across hops, and set it below the renderer's (e.g. 12 s total, renderer 15 s), so the sidecar always answers first with a classifiable error. This also gives M4 a real signal to surface: "feed timed out" instead of "aborted".

**Related, lower severity:** the proxy reads the upstream body with `await response.text()` and no size cap. Behind the bearer token and with URLs from the app's own feed list this is a robustness issue rather than an exploit, but one oversized or broken feed is buffered whole into sidecar memory. A byte cap on the read would close it.

### Checked and cleared — the proxy's SSRF defense is solid

`/api/rss-proxy` validates every URL with `isSafeUrl()` (private ranges plus DNS-rebinding resolution), pins the resolved IPv4 address for the first hop, follows redirects manually, re-validates each hop's target, and caps redirects at three. For an endpoint that fetches arbitrary URLs by design, that is the right shape.

### Dropped during verification — "the news feeds get no bearer token"

`src/config/feeds.ts:6` builds RSS URLs as absolute `http://127.0.0.1:46123/api/rss-proxy?…`. An absolute URL takes the fetch patch's passthrough branch unless it is recognised as app-origin, and the passthrough branch attaches the timeout but **not** the `Authorization` header — which would have meant every news feed receiving the same 401 my unauthenticated curl got. It does not happen: `127.0.0.1` is in `APP_HOSTS` (`runtime.ts:145-153`), so the URL is intercepted and the token is attached. Recorded so nobody re-derives it.

---

## Round 8 — detection and display under live load

Run while the app was busy with a real multi-state flood, gale and severe-thunderstorm event. Three questions: is H10 live, does the NWS path handle warning lifecycle, and does the screen match the truth. Every figure below is from the running app's live alert store or the live NWS API, taken the same evening.

### H12 — 80% of the NWS warnings the app is showing are no longer current

The live store held 65 NWS alerts. Compared against `https://api.weather.gov/alerts/active` at the same moment (333 active nationally):

```
stored NWS alerts                                   65
  still active at NWS                               13   (20%)
  superseded — an active alert references it        21   (32%)
  no longer active at all (expired or cancelled)    31   (48%)
```

Superseded or gone, by event: Flood Warning 19, Special Weather Statement 10, Beach Hazards Statement 9, **Severe Thunderstorm Warning 5**, Special Marine Warning 3, **Flash Flood Warning 3**, **Tornado Warning 2**, Gale Warning 1.

**The app is displaying two tornado warnings that NWS has already expired or cancelled**, as live and unacknowledged. The same mechanism produces the 20 surplus copies measured in the same store — 65 alerts for 45 distinct (event, area) pairs: Beach Hazards Statement ×10, Gale Warning ×8, and pairs of Flood Warnings including **La Porte, IN / St. Joseph, IN / Starke, IN**.

**Mechanism** — four gaps, each confirmed in code:

1. `normalizeNWSAlert()` (`src/services/alert-normalizer.ts:120-137`) keys each alert on `nws-${alert.id}`, the id of one CAP *message*. NWS issues a new message id for every update, so each update becomes a new alert rather than replacing its predecessor. `references` and `messageType` are never read on this path.
2. Nothing on the path to the unified store reads `expires`. The NWS lifecycle *is* handled correctly elsewhere — `nws-polygon-match.ts:72-74` and `evacuation-hazard-exposure.ts:278-281` both treat `messageType` and `expires` properly — but not in the pipeline that feeds triage, the inbox and the summary strip.
3. `unifiedAlertStore` has no removal operation (`unified-alerts.ts`: `ingest`, `acknowledge*`, `snooze`, `togglePin` only). An alert that leaves the source feed can only leave the store by age (48 h after its timestamp) or by cap eviction.
4. `raw` is shed before persistence (`unified-alerts.ts:323-326`), so after any reload the app can no longer tell when a warning expires, even in principle. `TriageBar`, `SummaryStrip`, `UnifiedAlertInboxPanel` and `unified-alerts.ts` contain zero references to `expires`.

**Suggested fix:** (a) key NWS alerts on the *event*, not the message — collapse via `references` so an update replaces its predecessor and a `Cancel` removes it; (b) carry `expiresAt` as a first-class field on `UnifiedAlert` so it survives persistence; (c) add a source-scoped reconcile to the store — "these are the currently active NWS ids; drop the rest"; (d) filter `expiresAt < now` at render time as a backstop.

**Acceptance:** after an NWS refresh, every NWS alert in the store is present in `/alerts/active`; no superseded version coexists with its replacement; a cancelled warning disappears within one refresh.

### H13 — Future-dated warnings are shown as "now" and never age out

`alert-normalizer.ts:127` sets `timestamp: new Date(alert.onset ?? alert.sent)`. River flood warnings routinely carry an onset days out, so **21 of the 65 stored NWS alerts are timestamped in the future — up to 90 hours ahead**. Then:

- `TriageBar.ts:295-296` computes `Math.max(0, now - timestamp)` and labels anything under a minute `now`. A future timestamp clamps to zero: **a warning whose onset is 90 hours away renders as "now".** Visible in the live screenshot: *"NWS Hazardous Seas Warning — now"*, stored with an onset about 18 hours in the future.
- Newest-first ordering puts these at the top of the triage bar indefinitely.
- Pruning is 48 h after `timestamp`, so a warning dated 90 h out survives roughly six days from ingest — well past its own expiry.

**Suggested fix:** use `sent` (or `effective`) as the event time, and carry `onset`/`ends` as separate fields a display can present honestly ("begins in 3 d"). Never clamp a negative age to zero silently.

### Display versus truth — one frame

Screenshot of the running app, compared field by field with the store and the NWS feed at the same moment:

| On screen | What it actually is |
|---|---|
| `SEVERE WEATHER · 99+ crit` | 285 correlation echoes (H10) + 2 NWS criticals (+1 comms-health) |
| `Situation Awareness · 429 unreviewed` | exactly the 429 correlation alerts in the store — every one an echo candidate |
| `Alert Inbox · 65 unreviewed` | the 65 stored NWS alerts, of which **13** are still active (H12) |
| `NWS Hazardous Seas Warning · now` | onset ~18 h in the future (H13) |
| Inbox AI summary: *"…civil unrest signals, and severe weather warnings…"* | H10's mislabel, now propagated into generated narrative |
| `data 48m median · 2h 45m worst` | not root-caused in this round — recorded as observed |

**The generated summary line is worth a second look.** H10 no longer only miscounts; the "civil unrest" label is being read back by the narrative layer and presented to the user as analysis. Any fix to H10 should include purging existing echoes from the store, or the summary will keep citing them after the loop is closed.

### Priority, restated

For an operator relying on this app during a real event, these three together mean the triage surface is dominated by echoes (H10), a majority of the genuine weather warnings shown are stale or superseded (H12), and some are labelled as happening now when they begin days later (H13). All three are in the same small area of code — `alert-normalizer.ts`, `situation-feed.ts`, `unified-alerts.ts` — and all three have measurable acceptance criteria against live NWS data. They should land together, ahead of any performance work.

---

## Round 9 — trace: "data 48m median · 2h 45m worst"

Round 8 recorded this figure from the summary strip during a live event without explaining it. Traced end to end; it turned out to hide the root cause of H12.

### What the number is

`SummaryStrip.freshnessSegHtml()` (`src/components/SummaryStrip.ts:220-236`) takes every freshness source that is enabled **and has a non-null `lastUpdate`**, computes raw `now - lastUpdate`, and shows the median and maximum. It reads neither the registry's own `status`, nor `lastError`, nor any per-source expected cadence.

### Why the median is 48 minutes — mostly by design

The 41 scheduled refreshes (`src/App.ts`, `registerAll`) have a **median designed interval of 30 minutes** (7 at ≤5 min, 9 at 5–15 min, 18 at 15–60 min, 4 at 1–6 h, 3 dynamic). On top of that, `refresh-scheduler.ts:58-100` computes each delay as:

```
base × ghost multiplier × battery/context multiplier × hidden (10×) × backoff (1–4×) ± 10% jitter
```

Backoff doubles, up to 4×, whenever a refresh returns `false` ("nothing changed"). A 30-minute source that has had two quiet cycles runs every two hours. Given those mechanics a median age near 48 minutes is expected, and **the number does not by itself mean data is 48 minutes behind**. As a health signal it mixes sources whose correct age ranges from seconds to hours.

Two things it gets actively wrong:

1. **It hides sources that have never succeeded.** The `lastUpdate !== null` filter drops them. GDACS (H11) only ever calls `recordError` on its failure paths (`data-loader.ts:3160-3173`), so the most broken feed in the app is invisible to the figure, and "worst" understates reality.
2. **It measures fetches, not what the user is looking at.** That is where the real problem was.

### The real finding — H14: the NWS warnings on the triage surfaces are a boot-time snapshot

- The **only** code path that writes NWS warnings into the unified alert store is `loadNWSAlerts()` → `unifiedAlertStore.ingest(alerts.map(normalizeNWSAlert))` (`data-loader.ts:3292`; `normalizeNWSAlert` has no other caller).
- `loadNWSAlerts()` has **no scheduled refresh.** It runs only inside `loadAllData()`, which runs at boot (`App.ts:524`), when a user clicks **Retry** on any panel (`Panel.ts:861` → `App.ts:503`), and on leaving playback mode (`event-handlers.ts:865`). It also fetches through `withOfflineCache('nws-alerts', …, 1 h)`.
- `loadNWSAlerts()` records **no freshness at all**, so its age is invisible to every freshness surface.
- Meanwhile the *scheduled* weather refresh, `loadWeatherAlerts()` (every 10 min, and it returns `void` so it never backs off), records `weather` as fresh. It drives the personal storm banner and notifications, **not** the unified store.

So the strip reports weather data as current, while the NWS warnings in the triage bar, the Alert Inbox and the `SEVERE WEATHER` counts are frozen at the last boot or retry.

**Measured against the live NWS API at the same moment:** the newest NWS alert in the store was sent 89 minutes earlier. Since then NWS had issued **76 alerts the store never received** — 20 Small Craft Advisories, 15 Flood Warnings, 10 Beach Hazards Statements, 7 Flood Watches, 6 Flood Advisories, **5 Flash Flood Warnings**, 4 Special Weather Statements, **3 Severe Thunderstorm Warnings**.

This **is the mechanism behind H12.** Round 8 measured 80% of stored NWS warnings as expired or superseded and attributed it to the normalizer ignoring lifecycle fields. That is true, but it is the smaller half: even a perfect normalizer cannot keep a snapshot current if it only ever runs at boot. The two need fixing together.

A side effect worth knowing: because the only way to re-run `loadNWSAlerts()` is `loadAllData()`, **clicking Retry on any single panel reloads all 116 data sources**.

**Suggested fix:**

1. Register `nwsAlerts` with the refresh scheduler at the same cadence as `weather` (or fold the unified-store ingest into `loadWeatherAlerts()`, which already fetches NWS), returning `void` so it is never backed off.
2. Record freshness for it (`nws-alerts`), so a stalled ingest shows up.
3. Make `SummaryStrip` report *overdue sources against their own cadence* (for example "3 sources overdue") instead of a raw median, and include never-succeeded sources.
4. Make panel Retry re-run that panel's source, not `loadAllData()`.

**Acceptance:** during a session, a warning newly issued at `/alerts/active` appears in the triage bar within one refresh interval without any user action, and the strip flags the NWS ingest as overdue if it stops.

### Detection latency, for the record

Even the scheduled path polls NWS every 10 minutes ±10%. Tornado warnings commonly give lead times on the order of ten minutes, so a warning can be issued and much of its lead time used up before the next poll. The storm-mode path should poll considerably faster during active weather (the refresh scheduler already supports per-source intervals), or subscribe to a push source.

### Round 9 scans — own site, earthquakes, notifications

Three scans aimed at impact on the operator personally, run during the same live event.

#### Clean — the site and saved-place weather posture is correct, and that matters

The data-center strip read *"New Carlisle AWS · Watch · rising rivers + extended-duration flooding"*. Against the live NWS API at the same moment: nothing is active at the site's point or at the Home point, and there is **one** active warning nearby — a **Severe** river Flood Warning whose polygon lies **30.7 km** from the site and whose affected zones include the site's own county. "Watch" is a defensible tier for a river flood 30 km away.

The path behind it is sound in the ways the triage path is not:

- It uses `matchAlertToPlace()` (`nws-polygon-match.ts`), which honours `messageType`, `references`, cancellation and `expires`.
- It resolves the site's UGC zones at runtime (`data-loader.ts:1861-1876`) so zone-only products (winter storm, heat, high wind, and many flood products) can match. A persisted saved-place record carries no zones, which briefly looked like a gap; the runtime resolution closes it.
- `fetchUgcZonesForPoint()` (`weather.ts:589-600`) deliberately **throws** on ambiguous failures and returns `[]` only on a genuine 404, specifically so a failed lookup is never cached as "no zones". Saved places (Home, Parents) resolve through an adapter that reports an explicit `degraded` flag.
- It runs on the 10-minute `weather` refresh and never backs off.

**The consequence for H12/H14 is architectural:** there are two NWS pipelines. The personal/site pipeline is correct. The unified-store pipeline behind triage, the inbox and the summary strip is boot-only, lifecycle-blind and untracked. **The fix should feed the unified store from the correct pipeline rather than repair the second one in parallel.**

#### Clean, with one edge case — cross-agency earthquake deduplication

USGS, EMSC and GEOFON are each polled every 8 minutes and deduplicated in `seismic-normalizer.ts` (90 s / 50 km / 0.5 magnitude, plus id grouping for revisions). Replayed against the last 24 hours of live data (USGS 47 events M2.5+, EMSC 210):

```
pairs that are clearly the same quake (<= 20 s, <= 30 km)   43
  merged by the app's thresholds                            42   (98%)
  split into duplicates                                      1
    USGS M4.6 mb vs EMSC M4.0 ml, 1.2 s and 19.9 km apart
```

The one miss is a magnitude-*type* mismatch (body-wave `mb` against local `ml`), which routinely differ by more than 0.5 for the same event. **Low:** when time and distance agree tightly (for example ≤ 10 s and ≤ 30 km), treat the magnitude delta as advisory, or compare only like-for-like magnitude types.

#### H15 — The alert loop's echoes are delivered as sticky critical notifications, at any hour

`unifiedAlertStore.ingest()` dispatches a notification for every alert with a new id (`unified-alerts.ts:371-374`), with the action chosen by `actionForSeverity()` — `critical` → `sound+banner`. In `notification-dispatcher.ts`:

1. `correlation` maps to the **`cyber`** notification domain (`alertSourceToDomain`). So an echo titled "Flood Warning" is governed by the operator's *cyber* preference, not their weather preference.
2. Default settings enable every domain at threshold `medium` (`notification-settings-service.ts:68-73`), and this installation has no saved overrides.
3. **Critical alerts bypass quiet hours** (`if (isQuietHoursActive() && alert.severity !== 'critical')`).
4. **Critical alerts bypass the per-source rate limit** (`if (alert.severity !== 'critical' && …)`).
5. Delivery goes through the Web Notifications API with `tag: wm-${source}-${id}` (unique per echo, so nothing coalesces) and **`requireInteraction: alert.severity === 'critical'`** — each one stays on screen until dismissed.

Put together with H10: a single flood warning re-emitted 71 times at a median gap of 0 s is, on this code path, 71 critical notifications that ignore quiet hours and rate limits, each sticky, each under the wrong preference, each describing weather as civil unrest.

**Confirmed by the operator (2026-09-20):** bursts of Crystal Ball notifications about floods and civil unrest that stay on screen until dismissed have been appearing. H15 is observed behaviour, not only a code-path argument. (Delivery traces are in-memory only, so the log could not show it.)

**Interim mitigation, no code change:** Settings → Notifications → turn the **Cyber** domain off. `evaluateNotificationPreference()` (`notification-settings-service.ts:194`) rejects a disabled domain before the quiet-hours and rate-limit checks, so echoes stop. Cost: `cyber` also carries `cyber`, `local-ids`, `radiation` and `air-quality` sources (`alertSourceToDomain`), so those notifications stop too until the fix lands. Their panels and the triage bar are unaffected.

**Also noted:** the `visual` alerting preset this installation uses sets `sound: false`, but `notification-dispatcher.ts` never reads `alerting-prefs`. It does not matter today only because the web-notification path ignores `_withSound` entirely. If a native path is ever wired up, the preset will not be honoured.

**Suggested fix:** closing H10 removes the flood. Independently, the dispatcher should not let derived `correlation` alerts bypass quiet hours or rate limits, `correlation` should not share a domain with `cyber`, and a burst of alerts with the same title inside a short window should coalesce into one notification.

#### Dropped during verification

- **"A single global 30-second native limiter lets echoes suppress real warnings."** `src-tauri/src/main.rs:1556-1570` does have one global 30 s window in `send_notification`, which silently returns `Ok(())` when suppressed. But `sendTauriNotification()` never calls that command — it falls through to `sendWebNotification()` (`notification-dispatcher.ts:398-401`). The limiter is not on this path.
- **"The site has no UGC zones, so zone-only warnings are missed."** True of the persisted record, false at runtime (see above).

---

## Status update — H10 and H15 fixed in PR #1732

Implemented the same night at the operator's request, because H15 was actively producing sticky critical notifications. Verified on the operator's installation during the live event (full numbers in the PR comment):

- critical `correlation` alerts **281 → 4**, all four legitimate (real military-surge signals, two Tornado Warnings)
- "civil unrest" bodies **405 → 0**; persisted situations now 18 `natural_hazard`, 1 `military`, 1 `health`
- **no correlation alert created after boot** across a 22-minute window — the loop does not run

Beyond the plan in round 7, verification exposed two gaps that are also fixed: the situation engine persists open situations and re-promoted a pre-fix one after the alert purge (now purged too), and both purges recorded their migration flag after an early return (would have purged legitimate data on a later boot).

**Residual for Codex:** the boot-time seed still produces ~92 derived alerts in one burst — one situation per 1–3 NWS alerts, amplified by H12's duplicate CAP messages, with evicted situations leaving their alerts behind. That is not the loop; H14 + H12 (event-keyed, scheduled NWS ingest) is what shrinks it.

**Interim mitigation can be reverted:** with the loop closed, the Cyber notification domain can be re-enabled.

## Method and limits

Seven rounds — three of static analysis at the reviewed SHA, one reading the installed build's own log and storage, one probing the running sidecar, one that re-read the runtime patches and retracted or downgraded three earlier findings, one aimed at high-value targets using the live alert store and the live GDACS API, and one run during a live severe-weather event against the live NWS feed and a screenshot of the running app — plus three measured checks: sticky offset resolution inside a padded scroll container was verified in a headless Chromium run (`top:0` pins at the padding edge; `top:<stack height>` pins a further stack-height down), which is what PR #1730 rests on; and round 3's bundle figures are measured from a real `desktop:build:full` output (raw and gzipped chunk sizes, modulepreload list), not estimated; and the boot path was measured directly from the app's own `bootTrace` marks recovered from the installed build's WebKit localStorage (two independent boots), which confirmed M6 and surfaced P0. See `UI_PERF_HANDOFF_FOR_CODEX.md`.

Round 2 shares these limits: the counts are real, but the severity of H4 and M4 is argued from what the code cannot do (report a stall, report a swallowed error), not from an observed incident. Not covered: no profiler run, no memory snapshot, no measurement of actual frame cost during a severe-weather surge. H3 and M1 are structural arguments backed by counts, not by a recorded flame graph. Before investing in the H3 refactor, a 60-second profile with the window backgrounded would confirm the size of the prize. The Rust side was checked only for its security surface, not reviewed for correctness.
