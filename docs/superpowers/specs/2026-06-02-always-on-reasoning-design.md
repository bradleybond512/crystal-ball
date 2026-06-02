# Always-On Reasoning (24/7 hidden operation) — Design

**Date:** 2026-06-02
**Status:** Approved (design); pending spec review
**Approach:** B — prevent macOS App Nap + un-throttle the scheduler when hidden (keep all reasoning in the renderer; no sidecar refactor)

## Problem

The analyst/algorithm reasoning loops run in the Tauri renderer (WKWebView). When the window is hidden/backgrounded, macOS **App Naps** the process — all JS timers freeze. Observed: analyst state went **~10 h stale overnight** while the always-alive Node sidecar kept heartbeating. The result is a "24/7 intelligence monitor" that stops reasoning whenever it isn't the foreground window.

## Goal

Keep the reasoning layer (analyst loop + data-feed refresh) running at **full real-time cadence even while hidden**, on macOS. Always-on by default, with a user toggle to disable. Battery cost is accepted (managed via the toggle).

## Why not move compute to the sidecar (A/C)

The five core services (analyst-loop, situation-engine, anomaly-detection, mode-forecast, threat-synthesis) all persist via `localStorage` and dispatch `document` events. Moving them to Node requires porting off browser APIs, adding sqlite for state, and a websocket bridge to the renderer — 8–18 days and a permanent split-brain. macOS provides a native primitive that solves the freeze directly, so B is the right scope now. A/C remain a future option if Windows/Linux 24/7 parity is ever required.

## Two distinct OS mechanisms

A hidden WKWebView can be slowed by **two** independent things:
1. **App Nap** — the OS suspends the whole process (this caused the 10 h stall).
2. **Background timer throttling** — JS `setTimeout`/`setInterval` clamped even when the process runs.

Killing App Nap is necessary; we then **verify** timers run at full rate, with a native-tick fallback (§4) if WKWebView still throttles them.

## Architecture

All changes are additive and gated on one setting; nothing changes when the feature is off.

### 1. Native keep-awake (Rust — `src-tauri/src/main.rs`)
- Hold an `NSProcessInfo.processInfo.beginActivityWithOptions:reason:` token.
- Options: `NSActivityUserInitiated` (prevents App Nap + sudden termination) **without** `NSActivityIdleSystemSleepDisabled` — keep *our app* alive when hidden, but do **not** force the whole Mac to stay awake. Lid-close / system sleep behaves normally (nothing runs then, which is correct).
- Two Tauri commands:
  - `set_always_on(enabled: bool)` — if `enabled` and no token held, acquire and store it in app state; if `!enabled` and a token is held, `endActivity:` and drop it.
  - `get_always_on() -> bool` — report current state (for UI sync).
- macOS-only via `#[cfg(target_os = "macos")]`; on other targets both commands are no-ops returning the stored boolean so the renderer code path is identical.
- Register the commands in the Tauri builder + `capabilities/default.json`.

### 2. Scheduler un-throttle (`src/app/refresh-scheduler.ts`)
- `computeDelay()` currently multiplies the base by `× 10` when `document.visibilityState === 'hidden'`.
- When always-on is enabled, skip the hidden multiplier (and the visibility backoff) so data feeds keep their normal cadence while hidden. Ghost-mode multiplier still applies (ghost is a separate, intentional slowdown).
- The analyst loop (`analyst-loop.ts`) already ignores the hidden multiplier, so once App Nap is gone it runs at its 5-min base with no change there.

### 3. Setting + wiring
- localStorage key `cb-always-on`, **default `true`** (treat missing as true).
- A small module `src/services/always-on.ts` owns: read/write the setting, call `invokeTauri('set_always_on', …)` on boot and on change, and expose `isAlwaysOn()` for the scheduler.
- Boot: read setting → call `set_always_on(value)` once the Tauri bridge is ready.
- UI: a toggle in Settings (a "Background / 24-7 operation" row) bound to the setting; flipping it calls the module (live effect, no restart).

### 4. Fallback — native tick (only if the soak shows throttling)
- If §1+§2 don't fully restore hidden-window cadence (WKWebView still throttles timers), add a Rust-side `tokio`/thread interval that `app.emit("cb:tick", …)` every N seconds while always-on.
- `analyst-loop.ts` and `refresh-scheduler.ts` would listen for `cb:tick` as an additional wake source (native timers aren't throttled). Built only if §5 proves it's needed; named here so it isn't a surprise.

## Setting / state summary
| Key | Default | Effect |
|---|---|---|
| `cb-always-on` (localStorage) | `true` | On boot + change → `set_always_on`; gates scheduler un-throttle |

No new secret keys, no new feeds.

## Error handling
- `set_always_on` failures (bridge not ready, non-macOS) are caught and logged at WARN; the renderer keeps working at default cadence. Acquiring/releasing the activity is idempotent (guard on whether a token is already held).
- Releasing a token that was never acquired is a no-op.

## Testing / acceptance
- **Rust:** unit-guard the acquire/release idempotency (no double-acquire, release-without-acquire safe).
- **Renderer:** unit test `computeDelay()` — with always-on true, hidden no longer applies the ×10; with always-on false, current behavior preserved. Test `always-on.ts` setting read/write/default.
- **Acceptance soak:** hide the window; over 30–60 min confirm via `/api/analyst-state` that `ageMs` stays < ~6 min and feed timestamps keep advancing. If they don't → implement §4 and re-run.

## Out of scope
- Moving reasoning compute to the sidecar (Approach A/C).
- Windows/Linux keep-awake (commands no-op; revisit if needed).
- Preventing system/display sleep (we intentionally allow the Mac to sleep).
- Changing ghost-mode behavior.
