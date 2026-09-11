# Crystal Ball — Code Review & Performance Handoff (for ChatGPT)

**Date:** 2026-09-11
**Reviewed commit:** `54a9b92`
**Branch reviewed:** `claude/vigilant-fermi-t9quzg`
**Repo:** `bradleybond512/crystal-ball` (canonical local path `~/developer/crystalball`)
**Scale:** 2,145 TypeScript files · 558,348 lines · ~408 panels

This document is a self-contained handoff. It assumes the reader has **no prior
context** and **may not be able to run the repo**. Every claim below was
verified by executing the command shown. Line numbers are from commit `54a9b92`
and should be re-confirmed with `grep` before editing, since the files are large
and actively changed.

---

## 0. TL;DR

The codebase is in **strong** shape. Code-quality metrics are unusually good
for this scale, and every gate passed at the reviewed commit. There is **one
concentrated performance problem** (eager startup module graph) worth real
effort, one moderate battery issue, and a handful of small guardrail gaps.

**Read §2.4.1 first.** A MapLibre advisory published after the reviewed commit
has since turned the `npm-audit` CI gate red repo-wide — no code change
involved. It blocks every PR until resolved, and the remedy is already open as
PR #1713. That is the only item here that is time-sensitive.

**Do not rewrite this codebase.** The architecture is sound and the fixes below
are incremental and mechanical. Most of the work is applying patterns that
**already exist and are proven in-repo**.

| # | Finding | Severity | Effort | Risk |
|---|---|---|---|---|
| 1 | 9.83 MB JS eagerly parsed at startup (400 static panel imports) | **P1** | L | Med |
| 2 | Lazy panels are still eagerly mounted at boot | **P1** | S | Low |
| 3 | ~25 services bypass `RefreshScheduler` (battery) | **P2** | M | Low |
| 4 | MapLibre critical CVE — not reachable, but **red-gating all CI** | **P0** | S | Med |
| 5 | Lint baseline not ratcheted (48 findings of silent headroom) | **P3** | XS | None |
| 6 | Bundle budget measures total, not startup path | **P3** | S | None |
| 7 | `escapeHtml` falsy-input edge case | **P4** | XS | None |
| 8 | `lint:ci` takes 9+ minutes | **P4** | M | None |
| 9 | 37/40 runtime deps float on `^` | **P4** | S | Low |

---

## 1. Verified baseline — the current state is GREEN

Run these first to confirm nothing has regressed before starting work.

```bash
npm ci
npm run typecheck:all    # → 0 errors across tsconfig.json AND tsconfig.api.json
npm run smoke:offline    # → GREEN (5 replay fixtures + pipeline invariants)
npm run lint:ci          # → passes, 1203 baseline findings, no increases
npx vite build && npm run bundle:check   # → passes, 4.91 MB / 6.00 MB gzip
```

**All four pass at `54a9b92`.** Any change you make must keep all four green.

### Code-quality metrics (verified, whole repo)

| Metric | Count | Notes |
|---|---|---|
| `@ts-ignore` / `@ts-expect-error` | **0** | Across 558k lines |
| `as any` | 20 | ~1 per 28k lines |
| `TODO` / `FIXME` / `HACK` / `XXX` | 10 | Effectively no debt markers |
| `eval()` / `new Function()` | **0** | |
| `escapeHtml` call sites | 4,396 | vs 271 `innerHTML` sinks (~16:1) |
| ESLint suppressions | 490 | Majority `no-console`; each carries a justification comment |

> These are not padded numbers — they were counted with `grep -r` over `src/`.
> Treat the existing quality bar as high and match it.

---

## 2. Security review — what was checked and what it found

**Bottom line: no exploitable vulnerability found.** The security engineering
here is genuinely above average. Details so you don't re-audit from scratch:

### 2.1 HTML injection — CLEAN

- Central sanitizer: `src/utils/sanitize.ts`
- `escapeHtml` (line 9) escapes `& < > " '` — correct 5-character set.
- `sanitizeUrl` (line 66) enforces an `http:`/`https:` allowlist, so
  `javascript:` and `data:` URIs are rejected.
- `isPrivateHostname` (line 18) blocks client-side SSRF across loopback,
  RFC1918, link-local, `0.0.0.0/8`, multicast, IPv6 ULA/link-local — **and**
  correctly decodes IPv4-mapped IPv6 in both dotted (`::ffff:127.0.0.1`) and
  hex (`::ffff:7f00:1`) forms. That second form is where most hand-rolled
  SSRF filters fail. Leave this alone.

### 2.2 The one `srcdoc` sink — CLEAN (defense in depth)

`src/components/IntelligenceBriefingExportPanel.ts:185` assigns
`frame.srcdoc = this.current.htmlContent`. This is safe because **both**
controls are in place:

1. The iframe is declared `sandbox=""` at line 137 — fully sandboxed, no
   `allow-scripts`.
2. The producer `renderHtml()` in
   `src/services/intelligence/intelligence-briefing-export.ts:253` escapes
   **every** interpolation (`title`, `periodLabel`, `id`, section titles and
   bodies).

**Do not remove either control.** If you touch this file, keep `sandbox=""`.

### 2.3 ReDoS suppressions — ACCEPTABLE

24 `sonarjs/slow-regex` suppressions exist. Sampled review: most are
`/<[^>]+>/g`-style negated character classes that are genuinely linear-time,
and each carries a justification comment (e.g. `ofac-parser.ts:190`,
`ntsb-investigations.ts:6`, `phmsa-pipeline.ts:218`).

One mild exception worth a look (low priority, **not** a security hole):

- `src/services/food-insecurity.ts:81` —
  `/^([A-Z][a-zA-Z\s]+?)(?:\s*[-–:|]|\s+Food)/`
  The lazy `[a-zA-Z\s]+?` followed by an alternation is **polynomial (O(n²))**,
  not exponential, on a title that never matches the delimiter. Input is a
  bounded RSS title, so impact is minimal. Bound the quantifier (e.g. `{1,80}`)
  if you want it airtight.

### 2.4 Dependency audit — one CRITICAL, not reachable, but NOW BLOCKING CI

> **⚠️ Status change since first draft — this is the most time-sensitive item
> in this document.** The `npm-audit` CI gate
> (`.github/workflows/security-audit.yml`, `npm audit --audit-level=high`) is
> now **RED repo-wide**, and the remedy is already staged in an open PR. Detail
> in §2.4.1 below. The reachability analysis is unchanged — this is a CI and
> supply-chain-hygiene emergency, not an active exploit.

```bash
npm audit --omit=dev
# → 8 vulnerabilities (5 moderate, 2 high, 1 critical)
```

**CRITICAL — `GHSA-jrc7-96c5-q579`**, MapLibre GL JS XSS sanitizer bypass in
`DOM.sanitize()`. Installed: `maplibre-gl@5.24.0` (declared `^5.24.0`). Fix
requires `maplibre-gl@6.9.0` — a **breaking major**.

**I verified this is not reachable in this app:**

| Check | Result |
|---|---|
| `setHTML` call sites | **0** |
| `setDOMContent` call sites | **0** |
| `new maplibregl.Popup(...)` | **0** |
| `attributionControl` | `false` (`src/components/DeckGLMap.ts:844`) |
| Basemap styles | Self-hosted (`/map-styles/*.json`), not third-party |
| Popup rendering | Custom `src/components/MapPopup.ts`, not MapLibre's |

The vulnerable code path is MapLibre's own popup/attribution HTML sanitizer.
The app never feeds it untrusted HTML. **Recommendation:** schedule the v6
upgrade as planned maintenance (to keep `npm audit` clean and avoid future
reachability), but **do not treat it as an emergency** and do not run
`npm audit fix --force`, which would breaking-upgrade MapLibre *and* downgrade
`@xenova/transformers` to 1.4.2.

**HIGH — `sharp` < 0.35.4** (libheif CVEs `GHSA-g89c-p67h-r497`,
`GHSA-2jg2-4ch7-h545`) reached via `@xenova/transformers`. This is on the
local ML path. Same guidance: planned upgrade, verify the transformers/ONNX
pipeline still works after.

#### 2.4.1 The advisory is new, and it has turned the CI gate red

Evidence that this landed between 2026-09-08 and 2026-09-11, with **no code
change involved**:

| Fact | Source |
|---|---|
| Security Audit **passed** on `main` at `54a9b92` | Actions run `34182565071`, 2026-09-08, conclusion `success` |
| Security Audit **fails** on a docs-only PR off that same commit | PR #1714, check run `103294281170` |
| That PR's diff | 1 file, `+684`, one Markdown doc — no `package.json`, no lockfile |
| Local `npm audit` on the unchanged `54a9b92` lockfile | reproduces the critical |

Same lockfile, opposite results three days apart. `npm audit` queries the live
advisory database, so a newly published advisory flips the gate with no commit.
**Consequence: `npm-audit` is now red on every PR in the repo until MapLibre is
upgraded**, including PRs that touch nothing related.

**There is no patched 5.x.** `npm view 'maplibre-gl@^5' version` → `5.24.0` is
the newest 5.x. The only remedy is the 6.x major.

**The upgrade is already staged:**
[#1713 — `build(deps): bump maplibre-gl from 5.24.0 to 6.9.0`](https://github.com/bradleybond512/crystal-ball/pull/1713)
(Dependabot, opened 2026-09-10, based on `54a9b92`, 2 files, `+14830/-14871` —
`package.json` + lockfile only). The 6.9.0 changelog contains the actual fix:
*"Fix DOM sanitization for iframe and srcdoc"* (upstream
[#8396](https://github.com/maplibre/maplibre-gl-js/pull/8396), commit
`b51d10a` "improve sanitization").

**Before merging #1713, verify these breaking-change surfaces by hand** — this
is the core map engine and the repo has no automated map regression test:

- **`setRTLTextPlugin` / `getRTLTextPluginStatus` are deprecated in 6.9.0**
  (upstream #8343 replaced them with built-in bidi). Check whether the app
  calls either; right-to-left label rendering is the risk.
- `src/components/DeckGLMap.ts` — the deck.gl ↔ MapLibre overlay integration
  (`addControl(this.deckOverlay as unknown as maplibregl.IControl)`, line ~883)
  is the most likely breakage point across a major.
- `src/components/NavigationPanel.ts` — `NavigationControl`, `ScaleControl`.
- `src/services/emergency-pack/emergency-pack-map-protocol.ts` — uses
  `AddProtocolAction`; custom protocol signatures are a common major-version
  break.
- All four basemaps (`dark` / `light` / `satellite` / `terrain`) still render,
  and the `wm-basemap` switcher works.
- `deck.gl` / `@deck.gl/mapbox` peer-dependency compatibility with MapLibre 6.

Do **not** reach for `npm audit fix --force` as a shortcut: it also downgrades
`@xenova/transformers` to 1.4.2, which is an unrelated and unwanted change.

### 2.5 Rust — CLEAN

```bash
grep -rn "unsafe " src-tauri/src --include=*.rs | wc -l   # → 54
```

All 54 are Objective-C FFI in `src-tauri/src/current_location.rs` (CoreLocation
selector dispatch — `selector()`, `send_no_args()`, session start/cleanup).
This is unavoidable for native macOS location APIs and is properly contained to
one file. **Not a finding.** 41 `.unwrap()`/`.expect()` calls are worth a
robustness pass eventually but none were in an obviously panicking path.

---

## 3. P1 — The startup module graph (the finding that matters)

### 3.1 The measurement

```bash
npx vite build
# then, from repo root:
node -e "
const fs=require('fs'),zlib=require('zlib');
const html=fs.readFileSync('dist/index.html','utf8');
const files=[...new Set([...html.matchAll(/(?:src|href)=\"(\/assets\/[^\"]*\.js)\"/g)].map(m=>m[1]))];
let r=0,g=0;for(const f of files){const b=fs.readFileSync('dist'+f);r+=b.length;g+=zlib.gzipSync(b).length;}
console.log('eager chunks',files.length,'raw',(r/1048576).toFixed(2),'MB gzip',(g/1048576).toFixed(2),'MB');"
```

**Result at `54a9b92`:**

```
EAGER chunks: 36
EAGER raw   : 9.83 MB
EAGER gzip  : 2.73 MB      ← 56% of ALL JS (4.91 MB gz) is on the startup path
```

Top eager offenders:

```
 3942 KB raw  1094 KB gz  panels-51M6eUR6.js      ← catch-all chunk
 1579 KB raw   445 KB gz  main.js
 1004 KB raw   264 KB gz  maplibre.js
  917 KB raw   263 KB gz  deck-stack.js
  760 KB raw   202 KB gz  panels-analysis.js
  375 KB raw    98 KB gz  panels-alerts.js
```

The `panels-*` family alone: **12 eager chunks, 6.18 MB raw / 1.70 MB gzip.**

### 3.2 Root cause

`src/app/panel-layout.ts` (3,788 lines) contains **400 static
`import … Panel` statements**, spanning roughly lines 62–650:

```bash
grep -cE "^import .*Panel" src/app/panel-layout.ts    # → 400
grep -oE "import\('@/components/[A-Za-z]+Panel'\)" src/app/panel-layout.ts | wc -l   # → ~8
```

Because these are **static** imports, Rollup must include every panel *and its
entire transitive service graph* in the boot module graph. Vite's
`manualChunks` (`vite.config.ts:1030`, panel logic at line 1076) then splits
them by **filename prefix** into `panels-diagnostic`, `panels-analysis`,
`panels-security`, etc., with `panels` as the catch-all.

**The split currently buys close to zero startup benefit for the `full`
variant**, because every resulting chunk is `modulepreload`ed in
`dist/index.html`. The in-code comment says the goal is "so the browser can
skip irrelevant chunks for variants that don't use them" — that works for the
`tech`/`finance` variants, but the `full` build preloads all of them.

Two compounding issues:

- The prefix allowlist is **hand-maintained**. Any new panel whose filename
  doesn't match a listed prefix silently falls into the `panels` catch-all,
  which is how it reached 3.85 MB.
- The comment at `vite.config.ts:1095` notes `panels` is also "the catch-all
  ownership anchor for shared service modules" — so it holds shared services
  too, not just unmatched panels.

### 3.3 ⚠️ Do not be misled by the existing analysis in `check-bundle-size.mjs`

`scripts/check-bundle-size.mjs` lines 21–34 contain a detailed prior
investigation concluding:

> "The on-demand surfaces that could be lazy-split … total only ~40 KB gzipped
> … Follow-up perf opportunity (not required to pass): lazy-load those
> on-demand components to trim ~40 KB off the boot payload."

**That analysis measured the `main-*.js` entry chunk only.** It is correct
about that chunk and should not be contradicted. The finding in *this*
document is a **different metric**: the aggregate `modulepreload` graph
(36 chunks / 2.73 MB gzip), which that analysis never measured. The ~40 KB
figure applies to the main entry; the opportunity here is ~1.7 MB gzip of
eager `panels-*`.

Please add a note to that header comment when you fix this, so the next
reader doesn't re-derive the confusion.

### 3.4 The fix — the pattern already exists in-repo

`panel-layout.ts` already has a working lazy-factory mechanism:

- Declaration: `private lazyFactories = new Map<string, () => Promise<Panel>>();`
  (`panel-layout.ts:750`)
- Consumption: `mountLazyPanel(key)` (`panel-layout.ts:3562`)
- Public entry: `ensurePanelMounted(key)` (`panel-layout.ts:3026`)
- **Proven usage:** `registerOsintPanels()` (`panel-layout.ts:3596`) registers
  7 panels this way, plus `maritime-intel` at line 1977:

```ts
private registerOsintPanels(): void {
  const slots: Array<[string, () => Promise<Panel>]> = [
    ['hibp-breaches',   () => import('@/components/HibpBreachesPanel').then((m) => new m.HibpBreachesPanel())],
    ['ipinfo-lookup',   () => import('@/components/IpInfoPanel').then((m) => new m.IpInfoPanel())],
    // … 5 more
  ];
  for (const [id, factory] of slots) this.lazyFactories.set(id, factory);
}
```

**Task: extend this pattern from ~8 panels to the remaining ~400.**

Recommended approach — **incremental, one category per PR**, so each step is
independently verifiable and revertible:

1. Pick one `manualChunks` category (start with `panels-diagnostic` — it is
   admin-only, lowest user-visible risk, and the chunk comment already says it
   is "only mounted when the user opens the diagnostic surfaces").
2. Delete those static imports from the top of `panel-layout.ts`.
3. Register each as a `lazyFactories.set(id, () => import(…).then(…))` entry,
   following `registerOsintPanels()` exactly.
4. Rebuild, re-run the eager-measurement command in §3.1, and record the delta
   in the PR body.
5. Confirm `npm run typecheck:all`, `npm run smoke:offline`, and
   `npm run bundle:check` all stay green.

Suggested order (lowest → highest risk):
`panels-diagnostic` → `panels-wisdom` → `panels-webcams` → `panels-transit` →
`panels-markets` → `panels-military` → `panels-hazards` → `panels-feeds` →
`panels-security` → `panels-alerts` → `panels-analysis` → `panels` (catch-all).

### 3.5 Known hazard when converting

`panel-layout.ts:1967` documents a bug already hit once with this pattern:

> "…dynamic import, and mountLazyPanel inserts them at their canonical grid
> position once resolved (fixing the prior orphaned-off-DOM bug)."

Lazily-mounted panels must be inserted at their **canonical grid slot**, not
appended. `mountLazyPanel` already handles this — use it, don't hand-roll
insertion.

---

## 4. P1 — Lazy panels are still eagerly mounted at boot

Even the panels that *are* lazy get mounted immediately. `panel-layout.ts:1978`:

```ts
this.lazyFactories.set('maritime-intel', () => import('@/components/MaritimeIntelPanel').then((m) => new m.MaritimeIntelPanel()));
for (const id of this.lazyFactories.keys()) {
  if (this.ctx.panelSettings[id]?.enabled ?? true) void this.mountLazyPanel(id);   // ← line 1979
}
```

So today, "lazy" only avoids work for **disabled** panels. And essentially
nothing is disabled:

```bash
grep -o 'enabled: true'  src/config/panels.ts | wc -l   # → 484
grep -o 'enabled: false' src/config/panels.ts | wc -l   # → 1
```

**Converting §3 without also fixing this captures far less than the headline
number** — the dynamic imports would still all fire during boot. They would at
least be non-blocking and parallel, but the parse cost stays.

### The lever that already exists

`src/config/panels.ts` already assigns every panel a `priority`:

```
priority: 1  → 264 panels
priority: 2  → 199 panels
priority: 3  →  22 panels
```

Example shape (`panels.ts:75`):

```ts
'comms-health': { name: 'Communications Health', enabled: true, priority: 2 },
```

**Proposed change:** at boot, mount only `priority: 1`. Defer `priority: 2` and
`3` to `requestIdleCallback` (with a `setTimeout` fallback), and let
`ensurePanelMounted()` handle anything the user navigates to sooner. That alone
moves 221 panels off the critical path using metadata that already exists.

> ⚠️ Counting caveat, per `CLAUDE.md`: `src/config/panels.ts:80` defines **two
> panels on one line**, which defeats line-anchored counting. The `enabled:` /
> `priority:` occurrence counts above (484 / 264 / 199 / 22) are token counts
> and are reliable; don't derive panel counts by line number.
> `src/config/panel-metadata.ts` has 421 keyed entries; `CLAUDE.md` cites ~408
> panels. Use the metadata file as the source of truth for iteration.

---

## 5. P2 — ~25 services bypass `RefreshScheduler` (battery / wakeups)

### What's good

`src/app/refresh-scheduler.ts` is well-built and should be the single cadence
authority. It provides:

- 10% jitter (`JITTER_FRACTION`, line ~63) to de-synchronize timers
- Ghost Mode multiplier via `getGhostRefreshMultiplier()`
- Hidden-window ×10 backoff via `hiddenMultiplier()` (line 7), disabled when
  `isAlwaysOn()`
- Capped exponential backoff (`MAX_BACKOFF_MULTIPLIER = 4`)
- Adaptive cadence via `getContextCadenceMultiplier()`
- Proper `destroy()` that clears all timeouts (line ~38)
- A `SLOW_REFRESH_THRESHOLD_MS = 15_000` perf breadcrumb

### The problem

26 modules register raw `window.setInterval` that never reaches it. Verified
inventory (file · first `setInterval` line · visibility-check count):

| File | Line | Visibility-aware |
|---|---|---|
| `src/services/pattern-memory.ts` | 107 | no |
| `src/services/infrastructure/grid-intelligence-loader.ts` | 311 | no |
| `src/services/gps-tracker.ts` | 127 | no |
| `src/services/silence-anomaly.ts` | 81 | no |
| `src/services/proximity-cascade.ts` | 116 | no |
| `src/services/geofence-alerts.ts` | 98 | no |
| `src/services/alert-lifecycle.ts` | 122 | no |
| `src/services/offline-staleness.ts` | 174 | no |
| `src/services/alert-fatigue.ts` | 101 | no |
| `src/services/watchlist-proximity.ts` | 125 | no |
| `src/services/periodicity-detector.ts` | 136 | no |
| `src/services/severity-recalibration.ts` | 79 | no |
| `src/services/intelligence/cascade-registration.ts` | 109 | no |
| `src/services/silence-detector.ts` | 104 | no |
| `src/services/military-vessels.ts` | 492 | no |
| `src/services/escalation-lifecycle.ts` | 172 | no |
| `src/services/military-flights.ts` | 502 | no |
| `src/services/anomaly-baselines.ts` | 127 | no |
| `src/services/blackout-signature.ts` | 86 | no |
| `src/services/forecast-accuracy.ts` | 134 | no |
| `src/services/threat-corridor.ts` | 121 | no |
| `src/services/cognition/consolidation-cadence.ts` | 71 | no |
| `src/services/cognition/self-tuning.ts` | 633 | no |
| `src/services/compound-alert-bridge.ts` | 110 | no |
| `src/services/intel-channels-bridge.ts` | 342 | no |
| `src/main.ts` | 426 | **yes** |

Typical cadences: `SCAN_INTERVAL` of 60 s / 90 s / 2 min / 3 min;
`CHECK_MS` 60 s.

### Accurate severity — read this before escalating

- **These are NOT memory leaks.** They use a correct idempotent guard:

  ```ts
  let started = false;
  export function startSilenceAnomaly(): void {
    if (started) return;
    started = true;
    window.setInterval(safeScan, SCAN_INTERVAL);
  }
  ```

- **These do NOT leak network traffic in Ghost Mode.** I checked each for
  `fetch`/`apiFetch`/`invokeTauri` — they are CPU-only. I initially suspected
  `military-flights.ts:502` was fetching on a raw interval; it is **not** —
  that is `cleanupFlightHistory`, a bounded memory-cleanup job, and the actual
  network call goes through the scheduler correctly. Do not report this as a
  privacy hole.

**The real cost is battery.** ~25 unsynchronized timers with no jitter and no
hidden-window backoff prevent macOS from coalescing CPU wakeups, and they run
at full rate with the window hidden.

### Corroboration from the repo itself

`panel-layout.ts:1973` documents this exact bug class already biting:

> "…a constructed MaritimeIntelPanel starts a 60s poll loop (dark-vessels,
> freight-stress, acled, ais) **with no visibility guard**, which otherwise ran
> invisibly forever and double-fetched /api/freight-stress."

### Fix

Route these through `RefreshScheduler.scheduleRefresh(name, fn, intervalMs)`.
They inherit jitter, hidden-window ×10, Ghost multiplier, and `destroy()`
cleanup for free. Where a service genuinely has no `AppContext` access, the
minimum acceptable fix is a visibility guard:

```ts
if (document.visibilityState === 'hidden' && !isAlwaysOn()) return;
```

Keep the `started` guards — they're correct.

---

## 6. P3 — Two gaps in the project's own guardrails

### 6.1 Lint baseline not ratcheted (1 command, do this first)

`npm run lint:ci` output:

```
[lint:baseline] OK — 1203 existing findings, no increases.
Debt dropped by 48; run npm run lint:baseline:update to ratchet it down.
```

The ratchet only protects what it records. Until the baseline is updated, there
are **48 findings of silent regression headroom** — someone can reintroduce
that much lint debt and CI stays green.

```bash
npm run lint:baseline:update   # then commit the updated baseline
```

### 6.2 Bundle budget measures total, not startup path

`scripts/check-bundle-size.mjs` (115 lines) enforces three limits (line 43):

```js
const LIMITS = {
  mainEntryGzipBytes:   460 * 1024,
  singleChunkGzipBytes: 1200 * 1024,
  totalJsGzipBytes:     6 * 1024 * 1024,
};
```

This passes at 4.91/6.00 MB **because it counts lazy chunks identically to
eager ones**. The correctly-lazy `GodsVisionView` chunk (4.02 MB raw / 1.07 MB
gzip of Cesium — this one is done right, `App.ts:600` dynamically imports it)
consumes budget while costing nothing at startup, and the 2.73 MB gzip eager
path is entirely unbudgeted.

**Recommended:** add a fourth limit that parses `dist/index.html` for
`modulepreload` + entry `<script>` tags and sums only those:

```js
eagerPreloadGzipBytes: 2.8 * 1024 * 1024,   // start at current 2.73 MB, ratchet DOWN
```

Do this **before** §3 — it makes the P1 work measurable, prevents regression,
and would have caught this class of bloat automatically.

---

## 7. P4 — Minor items

### 7.1 `escapeHtml` falsy-input edge case

`src/utils/sanitize.ts:10`:

```ts
export function escapeHtml(str: string): string {
  if (!str) return '';        // ← numeric 0 or false → '' instead of '0' / 'false'
```

A `0` arriving through an `any` boundary renders as empty rather than `"0"`.
The signature says `string`, so impact is low. Tighter guard:

```ts
if (str == null) return '';
```

Check for callers relying on the current behavior before changing it.

### 7.2 `lint:ci` takes 9+ minutes

`scripts/lint-baseline.mjs` scans the full repo; observed ~570 s wall clock
(progress logged every 30 s). Worth ESLint caching (`--cache
--cache-location`) or restricting the full scan to `main` pushes while PRs lint
only changed files.

### 7.3 Dependency pinning

37 of 40 runtime dependencies float on `^`. For a project where
`CLAUDE.md` states "Safety and security are high priorities," consider exact
pinning plus Renovate/Dependabot, so upgrades become reviewable PRs and builds
are reproducible.

---

## 8. Non-negotiable constraints (read before touching anything)

These come from `CLAUDE.md` and repo policy. Violating them has caused a real
incident before.

1. **🔴 NEVER touch the macOS Keychain.** No `security add/delete/find-generic-password`,
   no `keyring` crate `Entry::delete()`. A violation on 2026-05-08 caused full
   key loss requiring manual re-entry of 29 credentials. Do not run
   `npm run backup-keys` / `restore-keys` on the user's behalf without an
   explicit in-turn instruction.
2. **Branch discipline.** Never commit to local `main`. Branch from
   `origin/main` as `codex/*` (ChatGPT/Codex) or `claude/*`. Open a PR.
3. **Cross-agent review is enforced.** `.github/workflows/cross-agent-review.yml`
   blocks merge of `claude/*` / `codex/*` / `copilot/*` branches without a
   recorded cross-agent review. Run `npm run cross-check` to see who must
   review. **A Codex branch requires a Claude review.**
4. **Never skip, disable, or quarantine a test** to get CI green.
5. **`script-src 'unsafe-eval'` must stay.** Cesium requires it for shader
   compilation. Removing it breaks God's Eye. Compensating controls are
   documented in `CLAUDE.md` § CSP Posture.
6. **Keep `sandbox=""`** on the briefing preview iframe (§2.2).
7. **Releases are tag-driven only.** `npm run release:prepare -- --bump patch --push`.
   Never `gh release create` or hand-edit tags.
8. **Secret scanning is mandatory.** Keep `npm run secrets:scan:staged` and
   `npm run secrets:scan` passing.
9. Commit trailer: `Co-Authored-By:` per repo convention.

---

## 9. Recommended execution order

**Phase 0a — Unblock CI (do before anything else)**

0. Verify the breaking-change surfaces in §2.4.1 by hand, then land
   [#1713](https://github.com/bradleybond512/crystal-ball/pull/1713)
   (maplibre-gl 5.24.0 → 6.9.0). Until this merges, `npm-audit` is red on
   every PR in the repo and nothing else can cleanly go green. [§2.4.1]

**Phase 0b — Guardrails (minutes, zero risk)**

1. `npm run lint:baseline:update` → commit. [§6.1]
2. Add `eagerPreloadGzipBytes` to `check-bundle-size.mjs`, seeded at 2.8 MB. [§6.2]

**Phase 1 — Quick wins (hours)**

3. Fix `escapeHtml` falsy guard. [§7.1]
4. Bound the `food-insecurity.ts:81` quantifier. [§2.3]
5. Add ESLint caching. [§7.2]

**Phase 2 — Battery (days)**

6. Route the 25 services through `RefreshScheduler`, or add visibility guards.
   One PR per 5–6 services. [§5]

**Phase 3 — The big one (weeks, incremental)**

7. Defer `priority: 2`/`3` panels off the boot-mount loop. [§4] ← *do this
   before §3; it's smaller and unlocks most of the benefit*
8. Convert static panel imports to `lazyFactories`, one chunk category per PR,
   recording the eager-payload delta in each PR body. [§3]

**Phase 4 — Maintenance**

9. `sharp` / `@xenova/transformers` upgrade, verifying the ML pipeline after.
   **Not** via `npm audit fix --force`. (MapLibre is handled in Phase 0a.) [§2.4]
10. Dependency pinning + Renovate. [§7.3] — note that §2.4.1 is a live example
    of why this matters: a floating `^5.24.0` went from clean to critical with
    no commit, and the repo had no patched minor to fall back to.

---

## 10. Definition of done for any PR here

```bash
npm run typecheck:all     # 0 errors, both configs
npm run smoke:offline     # GREEN
npm run lint:ci           # no increases
npx vite build && npm run bundle:check   # all policies satisfied
npm run cross-check       # identify required cross-agent reviewer
```

For performance PRs, additionally paste the **before/after eager payload**
using the measurement command in §3.1. A perf PR without a measured delta
should not be merged.

---

## Appendix A — Verification commands used for this review

```bash
# Scale
find src -name '*.ts' | wc -l && find src -name '*.ts' -exec cat {} + | wc -l

# Quality metrics
grep -rn "@ts-ignore\|@ts-expect-error" src --include=*.ts | wc -l
grep -rn "as any" src --include=*.ts | wc -l
grep -rn "\beval(\|new Function(" src --include=*.ts | wc -l
grep -rn "escapeHtml\|escapeHTML" src --include=*.ts | wc -l
grep -rn "\.innerHTML\s*=" src --include=*.ts | wc -l

# Static vs lazy panel imports
grep -cE "^import .*Panel" src/app/panel-layout.ts
grep -oE "import\('@/components/[A-Za-z]+Panel'\)" src/app/panel-layout.ts | wc -l

# Uncleaned intervals
for f in $(grep -rl "setInterval(" src --include=*.ts); do
  si=$(grep -c "setInterval(" "$f"); ci=$(grep -c "clearInterval(" "$f")
  [ "$si" -gt "$ci" ] && echo "$f setInterval=$si clearInterval=$ci"
done

# Panel enablement / priority
grep -o 'enabled: true' src/config/panels.ts | wc -l
grep -oE "priority: [0-9]" src/config/panels.ts | sort | uniq -c

# Security
npm audit --omit=dev
grep -rn "setHTML\|setDOMContent" src --include=*.ts | wc -l
grep -rn "unsafe " src-tauri/src --include=*.rs | wc -l
```

## Appendix B — What was checked and found CLEAN

So you don't spend budget re-auditing:

- ✅ `typecheck:all` — 0 errors, both configs
- ✅ `smoke:offline` — 5 replay fixtures + pipeline invariants GREEN
- ✅ `lint:ci` — passing, debt trending down
- ✅ `bundle:check` — all policies satisfied
- ✅ No `eval` / `new Function` anywhere
- ✅ No `@ts-ignore` anywhere
- ✅ XSS sanitizer correct, incl. IPv4-mapped-IPv6 SSRF handling
- ✅ Only `srcdoc` sink is double-protected (sandbox + escaping)
- ✅ MapLibre CVE **not reachable** (no `setHTML`/`setDOMContent`/Popup,
  attribution disabled, self-hosted styles) — but it red-gates CI regardless,
  see §2.4.1; "not reachable" is not "no action needed"
- ✅ Rust `unsafe` confined to CoreLocation FFI in one file
- ✅ Interval singletons are idempotent — not leaks
- ✅ `GodsVisionView` (Cesium, 4.02 MB) correctly lazy-loaded
- ✅ ReDoS suppressions mostly legitimate, each justified
- ✅ No network activity escapes Ghost Mode

---

*Prepared by Claude Code, 2026-09-11, against commit `54a9b92`. Every metric
was executed, not estimated. Where an initial hypothesis was disproven by
verification (the `military-flights` fetch, the MapLibre reachability), the
corrected finding is recorded above rather than the original suspicion.*
