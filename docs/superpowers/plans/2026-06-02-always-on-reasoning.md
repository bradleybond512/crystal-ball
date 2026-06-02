# Always-On Reasoning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Crystal Ball's analyst + data-refresh loops running at full cadence while the window is hidden on macOS, by preventing App Nap and un-throttling the scheduler, gated on a `cb-always-on` toggle (default on).

**Architecture:** A Rust Tauri command holds an `NSProcessInfo` user-initiated activity token (prevents App Nap, still allows system sleep). A renderer module (`always-on.ts`) owns the setting, calls the command on boot/change, and exposes `isAlwaysOn()`. The refresh scheduler skips its hidden×10 throttle when always-on is enabled. The analyst loop already ignores the hidden multiplier, so removing App Nap restores its cadence.

**Tech Stack:** Rust (Tauri 2, raw objc FFI — same pattern as `get_native_location_impl`), TypeScript renderer, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-06-02-always-on-reasoning-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/main.rs` | `AlwaysOnGuard` state + `set_always_on`/`get_always_on` commands (objc `beginActivity`/`endActivity`); registered in `generate_handler!`. |
| `src/services/always-on.ts` | Setting read/write (`cb-always-on`, default true) + `isAlwaysOn()` + `applyAlwaysOn()` (invokes the Tauri command). |
| `src/services/__tests__/always-on.test.mts` | Tests for setting default/read/write. |
| `src/app/refresh-scheduler.ts` | Gate the hidden×10 multiplier on `isAlwaysOn()`. |
| `src/app/__tests__/refresh-scheduler-throttle.test.mts` (new) | Test the multiplier gating. |
| `src/components/UnifiedSettings.ts` | A "24/7 background operation" toggle bound to the setting. |
| `src/main.ts` | Call `applyAlwaysOn()` once the Tauri bridge is ready. |

---

## Task 1: Rust — always-on activity commands

**Files:**
- Modify: `src-tauri/src/main.rs` (add state struct, two commands, register in `generate_handler!` at ~line 2806, manage state in builder)

- [ ] **Step 1: Add the state struct + commands** (place near the other `#[tauri::command]` fns, ~line 567+)

```rust
/// Holds the retained NSProcessInfo activity token (as a pointer-sized int so the
/// state is Send+Sync). None when no activity is held.
struct AlwaysOnGuard(std::sync::Mutex<Option<usize>>);

#[cfg(target_os = "macos")]
fn begin_activity_macos() -> Option<usize> {
    use std::ffi::c_void;
    extern "C" {
        fn objc_getClass(name: *const u8) -> *mut c_void;
        fn sel_registerName(name: *const u8) -> *mut c_void;
        fn objc_msgSend(receiver: *mut c_void, sel: *mut c_void, ...) -> *mut c_void;
    }
    // NSActivityUserInitiated prevents App Nap; clear IdleSystemSleepDisabled so the
    // Mac may still sleep normally (lid close). bit14=SuddenTermination, bit20=IdleSystemSleep.
    const NS_SUDDEN_TERM_DISABLED: u64 = 1 << 14;
    const NS_IDLE_SYSTEM_SLEEP_DISABLED: u64 = 1 << 20;
    const NS_USER_INITIATED: u64 = 0x00FF_FFFF | NS_SUDDEN_TERM_DISABLED;
    let options: u64 = NS_USER_INITIATED & !NS_IDLE_SYSTEM_SLEEP_DISABLED;
    unsafe {
        let pi_cls = objc_getClass(b"NSProcessInfo\0".as_ptr());
        let str_cls = objc_getClass(b"NSString\0".as_ptr());
        if pi_cls.is_null() || str_cls.is_null() { return None; }
        let process_info = objc_msgSend(pi_cls, sel_registerName(b"processInfo\0".as_ptr()));
        if process_info.is_null() { return None; }
        // reason: NSString
        let with_utf8 = sel_registerName(b"stringWithUTF8String:\0".as_ptr());
        let reason_fn: unsafe extern "C" fn(*mut c_void, *mut c_void, *const u8) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const ());
        let reason = reason_fn(str_cls, with_utf8, b"Crystal Ball 24/7 monitoring\0".as_ptr());
        // [processInfo beginActivityWithOptions:options reason:reason]
        let begin_sel = sel_registerName(b"beginActivityWithOptions:reason:\0".as_ptr());
        let begin_fn: unsafe extern "C" fn(*mut c_void, *mut c_void, u64, *mut c_void) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const ());
        let token = begin_fn(process_info, begin_sel, options, reason);
        if token.is_null() { return None; }
        // retain so it survives past this scope
        objc_msgSend(token, sel_registerName(b"retain\0".as_ptr()));
        Some(token as usize)
    }
}

#[cfg(target_os = "macos")]
fn end_activity_macos(token: usize) {
    use std::ffi::c_void;
    extern "C" {
        fn objc_getClass(name: *const u8) -> *mut c_void;
        fn sel_registerName(name: *const u8) -> *mut c_void;
        fn objc_msgSend(receiver: *mut c_void, sel: *mut c_void, ...) -> *mut c_void;
    }
    unsafe {
        let pi_cls = objc_getClass(b"NSProcessInfo\0".as_ptr());
        if pi_cls.is_null() { return; }
        let process_info = objc_msgSend(pi_cls, sel_registerName(b"processInfo\0".as_ptr()));
        let end_sel = sel_registerName(b"endActivity:\0".as_ptr());
        let end_fn: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const ());
        end_fn(process_info, end_sel, token as *mut c_void);
        objc_msgSend(token as *mut c_void, sel_registerName(b"release\0".as_ptr()));
    }
}

#[cfg(not(target_os = "macos"))]
fn begin_activity_macos() -> Option<usize> { None }
#[cfg(not(target_os = "macos"))]
fn end_activity_macos(_token: usize) {}

#[tauri::command]
fn set_always_on(state: tauri::State<AlwaysOnGuard>, enabled: bool) -> bool {
    let mut held = state.0.lock().unwrap();
    if enabled && held.is_none() {
        *held = begin_activity_macos();
    } else if !enabled {
        if let Some(token) = held.take() {
            end_activity_macos(token);
        }
    }
    held.is_some()
}

#[tauri::command]
fn get_always_on(state: tauri::State<AlwaysOnGuard>) -> bool {
    state.0.lock().unwrap().is_some()
}
```

- [ ] **Step 2: Manage the state + register the commands**

In the Tauri builder chain (where `.invoke_handler(tauri::generate_handler![` is, ~line 2806), add `set_always_on, get_always_on,` to the handler list. Add `.manage(AlwaysOnGuard(std::sync::Mutex::new(None)))` to the builder (near other `.manage(...)` calls; if none, add it right before `.invoke_handler`).

- [ ] **Step 3: Build the Rust to verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -20`
Expected: compiles (warnings OK). If `objc_msgSend`/`sel_registerName`/`objc_getClass` extern decls clash with an existing module-level decl, reuse the existing one instead of re-declaring inside these fns.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(always-on): macOS NSProcessInfo activity commands

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Renderer — always-on setting module

**Files:**
- Create: `src/services/always-on.ts`
- Test: `src/services/__tests__/always-on.test.mts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/__tests__/always-on.test.mts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage shim for Node test
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { isAlwaysOn, setAlwaysOnSetting } = await import('../always-on.ts');

describe('always-on setting', () => {
  beforeEach(() => store.clear());
  it('defaults to true when unset', () => {
    assert.equal(isAlwaysOn(), true);
  });
  it('returns false when explicitly disabled', () => {
    setAlwaysOnSetting(false);
    assert.equal(isAlwaysOn(), false);
  });
  it('returns true when re-enabled', () => {
    setAlwaysOnSetting(false);
    setAlwaysOnSetting(true);
    assert.equal(isAlwaysOn(), true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/__tests__/always-on.test.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// src/services/always-on.ts
import { tryInvokeTauri } from './tauri-bridge';

const KEY = 'cb-always-on';

/** Default ON: a missing/blank setting means always-on. */
export function isAlwaysOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

export function setAlwaysOnSetting(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, enabled ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

/** Push the current (or given) setting to the native layer. Safe off-desktop. */
export async function applyAlwaysOn(enabled: boolean = isAlwaysOn()): Promise<void> {
  await tryInvokeTauri('set_always_on', { enabled });
}

/** Persist + apply in one call (for the settings toggle). */
export async function setAlwaysOn(enabled: boolean): Promise<void> {
  setAlwaysOnSetting(enabled);
  await applyAlwaysOn(enabled);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/__tests__/always-on.test.mts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/always-on.ts src/services/__tests__/always-on.test.mts
git commit -m "feat(always-on): renderer setting module (default on)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Gate the scheduler's hidden throttle

**Files:**
- Modify: `src/app/refresh-scheduler.ts` (the `computeDelay` closure inside `scheduleRefresh`)
- Test: `src/app/__tests__/refresh-scheduler-throttle.test.mts` (new) — test the pure multiplier decision

The current `computeDelay` applies `HIDDEN_REFRESH_MULTIPLIER (10)` when `isHidden`. We want: when always-on is enabled, the hidden multiplier is NOT applied. To keep it unit-testable, extract the multiplier decision into a pure exported helper and use it in `computeDelay`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/__tests__/refresh-scheduler-throttle.test.mts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hiddenMultiplier } from '../refresh-scheduler.ts';

describe('hiddenMultiplier', () => {
  it('is 1 when not hidden', () => {
    assert.equal(hiddenMultiplier(false, false), 1);
    assert.equal(hiddenMultiplier(false, true), 1);
  });
  it('is 10 when hidden and always-on is OFF', () => {
    assert.equal(hiddenMultiplier(true, false), 10);
  });
  it('is 1 when hidden but always-on is ON', () => {
    assert.equal(hiddenMultiplier(true, true), 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/app/__tests__/refresh-scheduler-throttle.test.mts`
Expected: FAIL — `hiddenMultiplier` not exported.

- [ ] **Step 3: Add the helper + use it**

At module top of `src/app/refresh-scheduler.ts`, add the import and the exported helper:

```typescript
import { isAlwaysOn } from '@/services/always-on';

/** Hidden-window slowdown factor. Always-on disables the slowdown entirely. */
export function hiddenMultiplier(isHidden: boolean, alwaysOn: boolean): number {
  if (!isHidden || alwaysOn) return 1;
  return 10;
}
```

Then in `computeDelay` (inside `scheduleRefresh`), replace the inline `(isHidden ? HIDDEN_REFRESH_MULTIPLIER : 1)` with `hiddenMultiplier(isHidden, isAlwaysOn())`:

```typescript
    const computeDelay = (baseMs: number, isHidden: boolean) => {
      const ghostMultiplier = getGhostRefreshMultiplier();
      const adjusted = baseMs * ghostMultiplier * hiddenMultiplier(isHidden, isAlwaysOn());
      const jitterRange = adjusted * JITTER_FRACTION;
      // eslint-disable-next-line sonarjs/pseudo-random
      const jittered = adjusted + (Math.random() * 2 - 1) * jitterRange;
      return Math.max(MIN_REFRESH_MS, Math.round(jittered));
    };
```

(The now-unused `HIDDEN_REFRESH_MULTIPLIER` const can stay or be removed; if eslint flags it as unused, remove it.)

- [ ] **Step 4: Run test + typecheck**

Run: `npx tsx --test src/app/__tests__/refresh-scheduler-throttle.test.mts && npm run typecheck:all`
Expected: PASS; typecheck zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/refresh-scheduler.ts src/app/__tests__/refresh-scheduler-throttle.test.mts
git commit -m "feat(always-on): skip hidden refresh throttle when always-on

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Wire on boot

**Files:**
- Modify: `src/main.ts` (after the Tauri bridge / desktop runtime is established)

- [ ] **Step 1: Find the boot point**

Open `src/main.ts` and locate where desktop runtime is detected / the app finishes bootstrapping (search for `isDesktopRuntime` or where panels mount). Add the import at the top:

```typescript
import { applyAlwaysOn } from '@/services/always-on';
```

- [ ] **Step 2: Apply on boot**

After bootstrap completes (non-blocking), add:

```typescript
// Honor the 24/7 always-on setting once the bridge is ready (no-op off-desktop).
void applyAlwaysOn();
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck:all
git add src/main.ts
git commit -m "feat(always-on): apply setting on boot

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Settings toggle

**Files:**
- Modify: `src/components/UnifiedSettings.ts`

- [ ] **Step 1: Locate a settings section + the render pattern**

Open `src/components/UnifiedSettings.ts`. Find an existing simple boolean/toggle control (search for `checkbox` or `type = 'checkbox'`) to copy its exact element-creation/handler pattern, and identify the container a new row should append to (e.g. a "General" section). Match that pattern; the snippet below uses plain DOM (no innerHTML) and should be adapted to the file's helpers if it has them (e.g. a `h()` util).

- [ ] **Step 2: Add the toggle row**

Add the import:

```typescript
import { isAlwaysOn, setAlwaysOn } from '@/services/always-on';
```

Build the row with safe DOM APIs (no innerHTML):

```typescript
const alwaysOnRow = document.createElement('label');
alwaysOnRow.className = 'settings-row';

const alwaysOnInput = document.createElement('input');
alwaysOnInput.type = 'checkbox';
alwaysOnInput.checked = isAlwaysOn();
alwaysOnInput.addEventListener('change', () => { void setAlwaysOn(alwaysOnInput.checked); });

const alwaysOnText = document.createElement('span');
alwaysOnText.textContent = '24/7 background operation';
const alwaysOnHint = document.createElement('small');
alwaysOnHint.style.cssText = 'display:block;opacity:.6';
alwaysOnHint.textContent = 'Keep the algorithms running at full speed when the window is hidden (macOS; uses more battery).';
alwaysOnText.append(alwaysOnHint);

alwaysOnRow.append(alwaysOnInput, alwaysOnText);
// append alwaysOnRow to the chosen settings container element
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck:all
git add src/components/UnifiedSettings.ts
git commit -m "feat(always-on): settings toggle (default on)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Acceptance soak + fallback decision

**Files:** none unless the soak fails (then implement the native-tick fallback per spec §4).

- [ ] **Step 1: Build + install**

```bash
npm run desktop:build:full && node scripts/install-built-app.mjs --relaunch
```

- [ ] **Step 2: Hidden-window soak**

Hide the Crystal Ball window (Cmd+H / bring another app to the foreground) and leave it ~35 min. Then check freshness:

```bash
LOGDIR="$HOME/Library/Logs/com.bradleybond.crystalball"
PORT=$(cat "$LOGDIR/sidecar.port"); TOK=$(cat "$LOGDIR/sidecar.token")
curl -fsS -H "Authorization: Bearer $TOK" "http://127.0.0.1:$PORT/api/analyst-state" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('stale:',d.get('stale'),'ageMs:',d.get('ageMs'))"
```
Expected: `stale: False`, `ageMs` < ~360000 (6 min). PASS → done.

- [ ] **Step 3: If it FAILS (timers still throttled), implement native tick (spec §4)**

In `main.rs`, on `set_always_on(true)` spawn a `std::thread` loop that, every 60s while held, calls `app_handle.emit("cb:tick", ())`; stop when released (check the guard each iteration). In `analyst-loop.ts` and `refresh-scheduler.ts`, listen via the Tauri event API (`onTauriEvent('cb:tick', …)`) to trigger a cycle. Re-run Step 2. (Build this ONLY if Step 2 fails.)

- [ ] **Step 4: Push + PR**

```bash
git push -u origin claude/always-on-reasoning
gh pr create --base main --head claude/always-on-reasoning \
  --title "feat: always-on reasoning (24/7 hidden operation, macOS)" \
  --body "Implements docs/superpowers/specs/2026-06-02-always-on-reasoning-design.md"
```

---

## Self-Review

**Spec coverage:**
- Prevent App Nap (NSProcessInfo activity, allow system sleep) → Task 1 (`begin_activity_macos`, options clear `IdleSystemSleepDisabled`). ✓
- Un-throttle scheduler when hidden → Task 3 (`hiddenMultiplier`). ✓
- Setting `cb-always-on` default true + module → Task 2. ✓
- Boot wiring → Task 4. ✓
- Settings toggle → Task 5. ✓
- Fallback native tick (only if needed) → Task 6 Step 3. ✓
- Acceptance soak (`ageMs` < ~6 min hidden) → Task 6 Step 2. ✓
- macOS-only / no-op other OS → Task 1 `#[cfg(...)]`. ✓
- Idempotent acquire/release → Task 1 (`held.is_none()` / `held.take()`). ✓

**Placeholder scan:** Tasks 4 and 5 include a "locate the insertion point" discovery step because `src/main.ts` and `UnifiedSettings.ts` weren't read during planning; both still provide the exact code to insert. No TBD/TODO in code.

**Type/name consistency:** `isAlwaysOn` / `setAlwaysOn` / `setAlwaysOnSetting` / `applyAlwaysOn` defined in Task 2 and used consistently in Tasks 3–5. `set_always_on`/`get_always_on` command names match between Rust (Task 1) and TS (`applyAlwaysOn`, Task 2). `hiddenMultiplier(isHidden, alwaysOn)` signature consistent between Task 3 test and impl.
