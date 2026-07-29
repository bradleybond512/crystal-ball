# Auto-Update: Background Staging + Visible Check State

**Date:** 2026-07-27
**Branch:** `claude/auto-update-staging`
**Status:** Design approved (in-session)

## Problem

The custom GitHub-Releases updater (`src/app/desktop-updater.ts` + Rust `install_update`)
already checks 5 s after launch, hourly, and on window focus. But two things make it feel
broken and under-automated:

1. **Silent when up-to-date.** No "last checked" indicator, no reassurance the check ran.
   Users perceive the app as never checking.
2. **Nothing is automatic.** Even when an update is found, the app downloads *nothing* until
   the user manually clicks "Update Now" — which then blocks on a full DMG download.

## Goal

- Make the check **visible**: the sidebar version chip reflects `checking / up-to-date /
  downloading / restart-ready`, with a "last checked N ago" tooltip.
- Make the update **auto-download**: as soon as a newer release is found, silently download +
  verify + stage it in the background. Then prompt **"Update ready — Restart now / Later"**.
- **Auto-apply on next manual quit/relaunch**: never relaunch mid-session, but if the user
  quits while an update is staged, the next launch applies it seamlessly before any window
  shows.

Explicitly **out of scope** (YAGNI): fully-silent mid-session auto-install, a Settings toggle,
and a download-progress percentage (the Rust download is not streamed).

## Security invariant (unchanged)

Trust is anchored exactly as today — no new trust surface:
mandatory SHA-256 from the CI `release-manifest.json`, GitHub-host allowlist, bundle-ID pin
(`com.bradleybond.crystalball`), Apple codesign `--verify --deep --strict`. The split *adds*
one guarantee: the staged bundle's signature is **re-verified at apply time** (and again at
boot-apply), so tampering between download and restart is caught.

## Design

### Layer 1 — Rust (`src-tauri/src/main.rs`)

Split the one-shot `install_update` into two commands over a shared swap helper, and remove
`install_update` (no back-compat shim):

- `swap_staged_into_place(staged, dest, backup)` — the existing atomic-swap block
  (rename dest→backup, staged→dest, `verify_app_bundle_signature(&dest, "Installed app")`,
  cleanup, rollback on failure). Extracted verbatim so the signature test's invariants hold.
- **`stage_update(download_url, expected_sha256)`** — download → SHA-256 verify → `hdiutil
  attach` → bundle-ID check → `verify_app_bundle_signature` (mounted) → `ditto` copy to a
  **persistent** `{dest}.update-staged` → `verify_app_bundle_signature` (staged) → detach.
  Does **not** swap or relaunch. Returns `Ok(())`.
- **`apply_staged_update()`** — require-trusted-window → assert `{dest}.update-staged` exists →
  re-verify staged signature → `swap_staged_into_place` → `open` + `exit(0)`.
- **`maybe_apply_staged_update_on_boot()`** — a plain fn (not a command) called at the top of
  `main()` right after the panic hook, macOS-only. Fast-exits if `{dest}.update-staged` is
  absent. Otherwise: read the staged bundle's `CFBundleShortVersionString`, compare with
  `env!("CARGO_PKG_VERSION")`; if staged **strictly newer** and it passes bundle-ID +
  signature re-verification → swap + relaunch + `exit(0)`. Any failure → delete the staged
  bundle, log, continue normal boot. Never blocks startup; no relaunch loop (after apply,
  running version == staged version, and the staged dir is removed).

`stage_update` + `apply_staged_update` are registered in `generate_handler!`; a pure
`is_semver_newer(candidate, current)` helper gets a unit test alongside the existing
`updater_gate_tests`.

### Layer 2 — State model (`src/app/app-context.ts`)

```ts
export type UpdateState = {
  phase: 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'installing';
  version?: string;
  downloadUrl?: string;
  expectedSha256?: string;
  lastCheckedAt?: number; // epoch ms, for the "last checked N ago" tooltip
} | null;
```

- `available` becomes the **fallback** state (stage impossible / failed / non-macOS): offer a
  browser download.
- `downloading` = staging in progress. `ready` = staged, awaiting restart.

### Layer 3 — Flow (`src/app/desktop-updater.ts`)

1. Check finds newer release → set `downloading` → call `stage_update` in the background.
2. On stage success → set `ready` → show **"Update ready — Restart now / Later"** toast +
   one native notification per version. "Restart now" → `apply_staged_update`.
3. On stage failure (or non-macOS) → set `available` → today's browser "Download" toast + retry.
4. Every completed check sets `lastCheckedAt` (persisted to `localStorage['wm-update-last-checked']`).

Boot-apply is owned by Rust, so a staged update never lingers across a full process restart.

### Layer 4 — Visibility (`src/app/layout/html.ts`, `src/app/panel-layout.ts`)

`buildSidebarUpdateBtnHtml` renders every phase:
`Checking… → vX ✓ (Latest) → Downloading update… → Restart to update`, and the recheck chip's
`title` shows "Last checked N ago · click to check". `renderSidebarUpdateBtn` wires the `ready`
chip → `apply_staged_update` and treats `downloading` as inert.

## Non-macOS

Unchanged: `stage_update`/`apply_staged_update` return "only supported on macOS"; the flow
falls to `available` and offers the browser download to the releases page.

## Testing

- `tests/desktop-updater-signature.test.mjs` — keeps asserting `ditto`,
  `verify_app_bundle_signature(&dest, "Installed app")`, `staged|backup`, no `/Applications`,
  no `cp -r` / `rm -rf`. Add assertions that `stage_update` and `apply_staged_update` exist and
  that `install_update` is gone.
- Rust: unit test for `is_semver_newer`.
- `npm run typecheck:all` at zero; `cargo check` (worktree recipe) clean.
