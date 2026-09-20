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

## Method and limits

Static analysis only, at the reviewed SHA, plus one behavioral check: sticky offset resolution inside a padded scroll container was verified in a headless Chromium run (`top:0` pins at the padding edge; `top:<stack height>` pins a further stack-height down), which is what PR #1730 rests on.

Not covered: no profiler run, no memory snapshot, no measurement of actual frame cost during a severe-weather surge. H3 and M1 are structural arguments backed by counts, not by a recorded flame graph. Before investing in the H3 refactor, a 60-second profile with the window backgrounded would confirm the size of the prize. The Rust side was checked only for its security surface, not reviewed for correctness.
