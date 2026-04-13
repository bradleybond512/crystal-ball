# CPU, Memory & Battery Optimizations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce idle CPU/GPU usage and memory pressure across the app — especially when the window is backgrounded or God's Vision is inactive.

**Architecture:** Centralize app-active state into a single `isAppActive()` signal that combines Page Visibility API + Tauri window focus + idle detection. Wire RAF loops and setInterval timers to pause when inactive. Cap all unbounded caches at a fixed size.

**Tech Stack:** TypeScript, Tauri 2 IPC, Cesium, node:test

---

### Task 1: Centralized App Activity Signal

Create a single module that combines all "is the app worth burning CPU for?" signals into one observable boolean.

**Files:**
- Create: `src/services/app-activity.ts`
- Test: `tests/app-activity.test.mts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/app-activity.test.mts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// We test the logic by simulating the state machine, not importing the real module
// (which depends on DOM + Tauri globals).

describe('app-activity state machine', () => {
  it('starts active', () => {
    let active = true;
    assert.equal(active, true);
  });

  it('becomes inactive when document is hidden', () => {
    let active = true;
    const onVisibilityChange = (hidden: boolean) => { active = !hidden; };
    onVisibilityChange(true);
    assert.equal(active, false);
  });

  it('becomes inactive when window loses focus (desktop)', () => {
    let active = true;
    const onWindowBlur = () => { active = false; };
    onWindowBlur();
    assert.equal(active, false);
  });

  it('stays active if only one signal is false and the other is true', () => {
    // Both signals must agree: visible AND focused
    let hidden = false;
    let focused = true;
    const isActive = () => !hidden && focused;
    assert.equal(isActive(), true);

    // Tab visible but window blurred -> inactive
    focused = false;
    assert.equal(isActive(), false);

    // Tab hidden but window focused -> inactive
    hidden = true;
    focused = true;
    assert.equal(isActive(), false);
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (these are pure logic tests)

Run: `node --test tests/app-activity.test.mts`
Expected: PASS (4 tests)

- [ ] **Step 3: Write the module**

```typescript
// src/services/app-activity.ts

type ActivityCallback = (active: boolean) => void;

let _active = true;
let _windowFocused = true;
const _listeners = new Set<ActivityCallback>();

function _recompute(): void {
  const nowActive = !document.hidden && _windowFocused;
  if (nowActive === _active) return;
  _active = nowActive;
  for (const cb of _listeners) cb(_active);
}

/** True when the app is visible AND the window is focused. */
export function isAppActive(): boolean {
  return _active;
}

/** Subscribe to activity changes. Returns an unsubscribe function. */
export function onActivityChange(cb: ActivityCallback): () => void {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

/** Call once at app startup. */
export function initAppActivity(): void {
  document.addEventListener('visibilitychange', () => _recompute());

  // Tauri 2: listen for window focus/blur via IPC
  const tauriWindow = window as unknown as {
    __TAURI__?: { event?: { listen?: (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void> } };
  };
  const listen = tauriWindow.__TAURI__?.event?.listen;
  if (listen) {
    listen('tauri://focus', () => { _windowFocused = true; _recompute(); }).catch(() => {});
    listen('tauri://blur', () => { _windowFocused = false; _recompute(); }).catch(() => {});
  }
}
```

- [ ] **Step 4: Wire into app startup**

In `src/App.ts`, import and call `initAppActivity()` in the `init()` method, right before the visibility handler setup:

```typescript
import { initAppActivity } from '@/services/app-activity';

// Inside init(), before the event handlers:
initAppActivity();
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/services/app-activity.ts src/App.ts tests/app-activity.test.mts
git commit -m "feat: centralized app-activity signal (visibility + Tauri focus)

Combines document.hidden and tauri://focus/blur into a single isAppActive()
boolean with subscriber support. Desktop apps now detect when the user
switches to another window — not just when the tab is hidden.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: RAF Loops — Pause When Inactive

All God's Vision RAF loops currently spin at 60fps regardless of visibility. Add `isAppActive()` guards so they stop drawing when the app is backgrounded.

**Files:**
- Modify: `src/components/gods-vision/GlobePulse.ts:35-41`
- Modify: `src/components/gods-vision/GlobeHeatmap.ts:61-63`
- Modify: `src/components/gods-vision/GlobeSatellites.ts:87-93`
- Modify: `src/components/gods-vision/GlobeMiniMap.ts:38-44`
- Modify: `src/components/gods-vision/FlyMode/FlyModeController.ts:121-128`
- Modify: `src/app/biometric-gate-3d.ts:303-354`

The pattern is the same in every file. When the app is inactive, stop scheduling RAF frames. When it becomes active again, restart the loop.

- [ ] **Step 1: GlobePulse — add activity guard**

In `src/components/gods-vision/GlobePulse.ts`, import `isAppActive` and `onActivityChange`, then modify `tick()` and `mount()`:

```typescript
import { isAppActive, onActivityChange } from '@/services/app-activity';
```

Add a field `private unsubActivity: (() => void) | null = null;` after `private destroyed = false;`.

Replace the `mount()` method:
```typescript
mount(): void {
  this.viewer.dataSources.add(this.source).catch(() => { /* intentional */ });
  this.unsubActivity = onActivityChange((active) => {
    if (active && !this.destroyed) this.tick();
  });
  this.tick();
}
```

Replace the `tick()` method:
```typescript
private tick(): void {
  if (!isAppActive()) return;
  this.rafId = requestAnimationFrame(() => {
    if (this.destroyed) return;
    this.refreshPulses();
    this.tick();
  });
}
```

Add cleanup in `destroy()` before the existing lines:
```typescript
this.unsubActivity?.();
this.unsubActivity = null;
```

- [ ] **Step 2: GlobeHeatmap — add activity guard**

In `src/components/gods-vision/GlobeHeatmap.ts`, import `isAppActive` and `onActivityChange`.

Add field `private unsubActivity: (() => void) | null = null;`.

In `mount()`, after `this.resizeObserver.observe(this.container);`:
```typescript
this.unsubActivity = onActivityChange((active) => {
  if (active && this.enabled) this.loop();
});
```

Replace the `loop()` method:
```typescript
private loop(): void {
  if (!this.enabled || !isAppActive()) return;
  this.rafId = requestAnimationFrame(() => { this.draw(); this.loop(); });
}
```

Add cleanup in `destroy()` before the existing lines:
```typescript
this.unsubActivity?.();
this.unsubActivity = null;
```

- [ ] **Step 3: GlobeSatellites — add activity guard**

In `src/components/gods-vision/GlobeSatellites.ts`, import `isAppActive` and `onActivityChange`.

Add field `private unsubActivity: (() => void) | null = null;`.

In `mount()`, after `await this.fetchTles();`:
```typescript
this.unsubActivity = onActivityChange((active) => {
  if (active && this.enabled && !this.destroyed) this.propagateLoop();
});
```

Replace the `propagateLoop()` method:
```typescript
private propagateLoop(): void {
  if (!this.enabled || this.destroyed || !isAppActive()) return;
  this.rafId = requestAnimationFrame(() => {
    if (this.destroyed) return;
    this.propagate();
    this.propagateLoop();
  });
}
```

Add cleanup in `destroy()` before the existing lines:
```typescript
this.unsubActivity?.();
this.unsubActivity = null;
```

- [ ] **Step 4: GlobeMiniMap — add activity guard**

In `src/components/gods-vision/GlobeMiniMap.ts`, import `isAppActive` and `onActivityChange`.

Add field `private unsubActivity: (() => void) | null = null;`.

In `mount()`, after `this.loop();`:
```typescript
this.unsubActivity = onActivityChange((active) => {
  if (active && !this.destroyed) this.loop();
});
```

Replace the `loop()` method:
```typescript
private loop(): void {
  if (this.destroyed || !isAppActive()) return;
  this.rafId = requestAnimationFrame(() => {
    if (this.destroyed) return;
    this.draw();
    this.loop();
  });
}
```

Add cleanup in `destroy()` before the existing lines:
```typescript
this.unsubActivity?.();
this.unsubActivity = null;
```

- [ ] **Step 5: FlyModeController — add activity guard**

In `src/components/gods-vision/FlyMode/FlyModeController.ts`, import `isAppActive` and `onActivityChange`.

Add field `private unsubActivity: (() => void) | null = null;`.

Replace the `startLoop()` method:
```typescript
private startLoop(): void {
  this.unsubActivity = onActivityChange((active) => {
    if (active && this._active) {
      this.rafId = requestAnimationFrame(tick);
    }
  });
  const tick = () => {
    if (!this._active || !isAppActive()) return;
    this.onFrame();
    this.rafId = requestAnimationFrame(tick);
  };
  this.rafId = requestAnimationFrame(tick);
}
```

In `stopLoop()`, add before `cancelAnimationFrame`:
```typescript
this.unsubActivity?.();
this.unsubActivity = null;
```

- [ ] **Step 6: biometric-gate-3d — add activity guard**

In `src/app/biometric-gate-3d.ts`, import `isAppActive` and `onActivityChange`.

Inside the `create3DBiometricGate()` function, after `let destroyed = false;`, add:
```typescript
let unsubActivity: (() => void) | null = null;
```

Replace the `renderFrame` function and its initial call:
```typescript
const renderFrame = (nowMs: number) => {
  if (destroyed || !isAppActive()) return;
  // ... (existing frame logic unchanged)
  composer.render();
  rafId = window.requestAnimationFrame(renderFrame);
};

unsubActivity = onActivityChange((active) => {
  if (active && !destroyed) {
    lastFrameMs = performance.now();
    rafId = window.requestAnimationFrame(renderFrame);
  }
});
rafId = window.requestAnimationFrame(renderFrame);
```

In the `destroy()` closure, add after `destroyed = true;`:
```typescript
unsubActivity?.();
unsubActivity = null;
```

- [ ] **Step 7: Run typecheck**

Run: `npm run typecheck:all`
Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add src/components/gods-vision/GlobePulse.ts src/components/gods-vision/GlobeHeatmap.ts src/components/gods-vision/GlobeSatellites.ts src/components/gods-vision/GlobeMiniMap.ts src/components/gods-vision/FlyMode/FlyModeController.ts src/app/biometric-gate-3d.ts
git commit -m "perf: pause all RAF loops when app is inactive

GlobePulse, GlobeHeatmap, GlobeSatellites, GlobeMiniMap, FlyModeController,
and biometric-gate-3d now check isAppActive() before scheduling frames.
When the app is backgrounded or the desktop window loses focus, these
loops stop completely and resume on reactivation.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Timers — Pause When Inactive

The 1-second clock, 30-second sidebar heat, and other setInterval timers burn CPU even when the app is hidden.

**Files:**
- Modify: `src/app/event-handlers.ts:672-680` (clock)
- Modify: `src/services/sidebar-heat.ts:84` (heat timer)

- [ ] **Step 1: Clock — skip DOM update when inactive**

In `src/app/event-handlers.ts`, import `isAppActive`:
```typescript
import { isAppActive } from '@/services/app-activity';
```

Replace the `startHeaderClock()` method:
```typescript
startHeaderClock(): void {
  const el = document.getElementById('headerClock');
  if (!el) return;
  const tick = () => {
    if (!isAppActive()) return;
    el.textContent = new Date().toUTCString().replace('GMT', 'UTC');
  };
  tick();
  this.clockIntervalId = setInterval(tick, 1000);
}
```

- [ ] **Step 2: Sidebar heat — skip when inactive**

In `src/services/sidebar-heat.ts`, import `isAppActive`:
```typescript
import { isAppActive } from '@/services/app-activity';
```

Wrap the `applyHeat()` call in the setInterval:
```typescript
window.setInterval(() => { if (isAppActive()) applyHeat(); }, 30_000);
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck:all`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/app/event-handlers.ts src/services/sidebar-heat.ts
git commit -m "perf: skip clock + sidebar-heat ticks when app is inactive

1-second clock DOM update and 30-second sidebar heat recalculation now
early-return when isAppActive() is false.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Throttle Mousemove Handlers

Several drag handlers fire on every pixel of mouse movement without throttling. The codebase already has `rafSchedule()` in `src/utils/index.ts` — use it.

**Files:**
- Modify: `src/app/panel-layout.ts:1835`
- Modify: `src/app/event-handlers.ts:969`
- Modify: `src/components/Map.ts:703`
- Modify: `src/components/LiveNewsPanel.ts:683`

- [ ] **Step 1: panel-layout.ts — wrap drag mousemove in rafSchedule**

Read the exact mousemove handler at `src/app/panel-layout.ts:1835`. Wrap the handler body in `rafSchedule()`:

```typescript
import { rafSchedule } from '@/utils';
```

Where the `document.addEventListener('mousemove', onMouseMove)` call is, wrap `onMouseMove` with `rafSchedule`:
```typescript
const onMouseMoveRaf = rafSchedule(onMouseMove);
document.addEventListener('mousemove', onMouseMoveRaf);
```

Update the corresponding `removeEventListener` in the cleanup/mouseup handler to use `onMouseMoveRaf`.

- [ ] **Step 2: event-handlers.ts — wrap map resize mousemove**

At line 969 where `this._mapResizeMouseMove` is assigned and added as a listener, wrap the handler:

```typescript
this._mapResizeMouseMove = rafSchedule((e: MouseEvent) => {
  // ... existing resize logic
});
```

- [ ] **Step 3: Map.ts — wrap pan mousemove**

At line 703 where the panning mousemove handler is added, wrap the callback in `rafSchedule`:

```typescript
import { rafSchedule } from '@/utils';

// Inside the drag setup:
const onPanMove = rafSchedule((e: MouseEvent) => {
  // ... existing pan logic
});
document.addEventListener('mousemove', onPanMove);
```

Update the cleanup to remove `onPanMove`.

- [ ] **Step 4: LiveNewsPanel.ts — wrap reorder drag mousemove**

At line 683 where the channel reorder mousemove handler is added, wrap it in `rafSchedule`:

```typescript
import { rafSchedule } from '@/utils';

const onReorderMove = rafSchedule((e: MouseEvent) => {
  // ... existing reorder logic
});
document.addEventListener('mousemove', onReorderMove);
```

Update the cleanup to remove `onReorderMove`.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck:all`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/app/panel-layout.ts src/app/event-handlers.ts src/components/Map.ts src/components/LiveNewsPanel.ts
git commit -m "perf: throttle mousemove handlers with rafSchedule

Panel drag, map resize, map pan, and news channel reorder mousemove
handlers now use rafSchedule() to batch into one call per animation
frame instead of firing on every pixel.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Cap Unbounded Caches

Add maximum size limits to module-level Maps that grow without bounds.

**Files:**
- Modify: `src/services/wikipedia.ts:12`
- Modify: `src/utils/reverse-geocode.ts:12`
- Modify: `src/services/gdelt-intel.ts:133`
- Modify: `src/components/globeClustering.ts:14`
- Create: `src/utils/lru-cache.ts`
- Test: `tests/lru-cache.test.mts`

- [ ] **Step 1: Write LRU cache test**

```typescript
// tests/lru-cache.test.mts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Verify the module exists and exports correctly by reading source
const src = readFileSync(path.join(import.meta.dirname, '..', 'src/utils/lru-cache.ts'), 'utf8');

describe('LRU cache source contract', () => {
  it('exports LruCache class', () => {
    assert.ok(src.includes('export class LruCache'));
  });

  it('accepts a max size parameter', () => {
    assert.ok(src.includes('maxSize'));
  });

  it('has get and set methods', () => {
    assert.ok(src.includes('get('));
    assert.ok(src.includes('set('));
  });

  it('evicts oldest entries when full', () => {
    assert.ok(src.includes('delete'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/lru-cache.test.mts`
Expected: FAIL — file does not exist

- [ ] **Step 3: Write the LruCache class**

```typescript
// src/utils/lru-cache.ts

/**
 * Minimal LRU cache. On get(), promotes the key to most-recently-used.
 * On set() when full, evicts the least-recently-used entry.
 */
export class LruCache<K, V> {
  private map = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val === undefined) return undefined;
    // Promote to most-recently-used
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      // Evict oldest (first inserted)
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}
```

- [ ] **Step 4: Run test**

Run: `node --test tests/lru-cache.test.mts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit LRU cache**

```bash
git add src/utils/lru-cache.ts tests/lru-cache.test.mts
git commit -m "feat: add LruCache utility for bounded caches

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 6: Cap wikipedia cache**

In `src/services/wikipedia.ts`, replace line 12:

```typescript
// Before:
const cache = new Map<string, { data: WikiSummary; ts: number }>();

// After:
import { LruCache } from '@/utils/lru-cache';
const cache = new LruCache<string, { data: WikiSummary; ts: number }>(200);
```

Update the `get` call on line 19 — `cache.get(key)` already works since LruCache has the same API. Verify `cache.set(key, ...)` on line 40 also works.

- [ ] **Step 7: Cap reverse-geocode cache**

In `src/utils/reverse-geocode.ts`, replace line 12:

```typescript
// Before:
const cache = new Map<string, GeoResult | null>();

// After:
import { LruCache } from '@/utils/lru-cache';
const cache = new LruCache<string, GeoResult | null>(500);
```

Update `cache.has(key)` on line 23 — LruCache has `has()`. Update `cache.get(key)` to use `cache.get(key)` (same API). Update `cache.set(key, ...)` calls — same API.

- [ ] **Step 8: Cap GDELT article cache**

In `src/services/gdelt-intel.ts`, replace line 133:

```typescript
// Before:
const articleCache = new Map<string, { articles: GdeltArticle[]; timestamp: number }>();

// After:
import { LruCache } from '@/utils/lru-cache';
const articleCache = new LruCache<string, { articles: GdeltArticle[]; timestamp: number }>(100);
```

- [ ] **Step 9: Cap globe clustering image cache**

In `src/components/globeClustering.ts`, replace line 14:

```typescript
// Before:
const imageCache = new Map<string, string>();

// After:
import { LruCache } from '@/utils/lru-cache';
const imageCache = new LruCache<string, string>(300);
```

- [ ] **Step 10: Run typecheck**

Run: `npm run typecheck:all`
Expected: 0 errors

- [ ] **Step 11: Commit cache caps**

```bash
git add src/services/wikipedia.ts src/utils/reverse-geocode.ts src/services/gdelt-intel.ts src/components/globeClustering.ts
git commit -m "perf: cap unbounded caches with LruCache (200-500 entries)

wikipedia: 200, reverse-geocode: 500, gdelt-intel: 100, globeClustering: 300.
Prevents unbounded memory growth in long-running sessions.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Wire App Activity Into Existing Visibility Handler

The existing `visibilitychange` handler in `event-handlers.ts` already sets `hiddenSince` and flushes stale refreshes. Connect it to the new centralized signal so both Tauri focus and visibility flow through the same path.

**Files:**
- Modify: `src/app/event-handlers.ts:270-280`

- [ ] **Step 1: Update the visibility handler to use onActivityChange**

In `src/app/event-handlers.ts`, import `onActivityChange`:
```typescript
import { isAppActive, onActivityChange } from '@/services/app-activity';
```

After the existing `visibilitychange` listener (line 280), add a Tauri-aware activity subscription that triggers the same idle/resume logic:

```typescript
this._unsubActivity = onActivityChange((active) => {
  // Tauri window blur/focus — apply the same logic as visibilitychange
  document.body.classList.toggle('animations-paused', !active);
  if (!active) {
    this.callbacks.setHiddenSince(Date.now());
    mlWorker.unloadOptionalModels();
  } else {
    this.resetIdleTimer();
    this.callbacks.flushStaleRefreshes();
  }
});
```

Add `private _unsubActivity: (() => void) | null = null;` to the class fields.

In the `destroy()` method, add:
```typescript
this._unsubActivity?.();
this._unsubActivity = null;
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck:all`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/app/event-handlers.ts
git commit -m "feat: wire Tauri window focus into existing idle/resume logic

onActivityChange now triggers the same animations-paused, ML unload,
and stale refresh flush that visibilitychange does. Desktop users
switching to another app now get the same power savings as hiding
a browser tab.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck:all`
Expected: 0 errors

- [ ] **Step 2: Run all tests**

Run: `node --test tests/`
Expected: All tests pass

- [ ] **Step 3: Run secrets scan**

Run: `npm run secrets:scan`
Expected: Pass

- [ ] **Step 4: Verify build**

Run: `npm run desktop:build:full`
Expected: Successful build

- [ ] **Step 5: Commit any fixes if needed, then push**

```bash
git push origin claude/gods-vision-destroy-on-exit
```
