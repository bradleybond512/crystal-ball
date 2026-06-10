# Performance Findings & Fixes (2026-06-10)

Source-verified diagnosis of why the running app feels slow, plus the quick wins
shipped in this PR and the structural follow-ups.

## Diagnosis (everyday use)

1. **Mount-everything architecture (root cause).** ~470 panels are `enabled: true`
   and mount into the DOM on boot. An `IntersectionObserver` (`Panel.ts`) correctly
   skips *render work* for off-screen panels, but the DOM nodes, timers, and
   listeners all persist — hundreds of live subtrees mean constant style/layout
   recalculation and high memory regardless of what's on screen. Fixed structurally
   by Workstream B (466 panels → ~12 hubs with lazy-mounted tabs) in the main plan.
2. **~290 panels run uncoordinated polling timers.** A smart central
   `RefreshScheduler` exists (slows polling 10× when the window is hidden, jitters to
   avoid thundering-herd bursts, can gate on visibility) — but only 2 panels use it.
   ~290 component files call raw `setInterval` directly (693 timer call sites total),
   so they keep polling at full rate when hidden/off-screen, in unsynchronized bursts.
3. **Listener accumulation.** 1,252 `addEventListener` vs 191 `removeEventListener`
   across `src/`. Many panels don't fully tear down, so handlers (and the closures
   they retain) pile up over a session — the "slower the longer it's open" pattern.
4. **Always-on DeckGL map.** `MapContainer → DeckGLMap` (233 KB) is mounted by default
   and renders WebGL at up to 2× device pixels even when not in view.

## Not the everyday culprit: God's Vision globe

The Cesium globe is lazy — dynamically imported only when God's Vision is toggled and
fully torn down on exit — so it does not affect normal use. But *while active* its
config was needlessly maxed out: continuous 60fps rendering (no `requestRenderMode`),
`msaaSamples: 4` on top of FXAA, full-retina resolution, and high-performance GPU.

## Shipped in this PR (safe, verifiable quick wins)

- **Cesium on-demand rendering** (`CesiumGlobe.ts`): `requestRenderMode: true` so the
  globe only paints when the scene changes, plus a 1s render heartbeat (cleared in
  `destroy()`) so imperative data mutations from `GlobeDataManager` (64 mutation sites,
  none self-flagging a render) still surface within ≤1s. Idle rendering drops from
  ~60fps to ~1fps; camera interaction still renders immediately via Cesium's own
  handling. MSAA reduced 4× → 2× (visually indistinguishable paired with FXAA).
- **Listener-leak ratchet** (`scripts/check-listener-leaks.mjs` + baseline + npm
  `perf:listeners{,:ci,:update}`): mirrors the a11y-baseline pattern. Reports the worst
  offenders (currently 1,036 unmatched listeners across 337 files; top: `Map.ts` 53,
  `panel-layout.ts` 35, `event-handlers.ts` 27) and, in `--ci` mode, fails only when a
  file's imbalance grows beyond baseline or a new offender appears. Prevents the leak
  class from worsening while the real teardown fixes are worked through the ranked list.

## Structural follow-ups (bigger PRs, ordered by impact)

1. **Route per-panel `setInterval` through `RefreshScheduler`.** Mechanical replacement;
   instantly stops off-screen/hidden panels from polling and adds jitter. Highest
   everyday win short of consolidation.
2. **Hub consolidation (Workstream B).** 470 mounted panels → ~12 hubs with lazy tabs is
   the largest single lever; attacks the root cause directly.
3. **Pay down the listener-leak baseline.** Work the ranked `perf:listeners` list,
   adding matching teardown in each `destroy()`; add a base-class `isDestroyed` guard +
   RAF/timer cancellation ordering so late callbacks can't touch torn-down panels.
4. **DeckGL fill-rate.** Consider a modest device-pixel cap on the always-on map and
   pausing its animation loop when the map section is hidden.
