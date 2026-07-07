/**
 * Idle Scheduler — defer heavy cognition passes off the synchronous call
 * stack so they never block a rendered frame (PR 14: Compute Placement +
 * Hygiene).
 *
 * `scheduleIdleWork()` wraps `requestIdleCallback` (browser) with a
 * `setTimeout(0)` fallback (Node / older WebKit) and a visibility guard:
 * work is skipped entirely while `document.visibilityState === 'hidden'`
 * so a backgrounded tab never burns CPU the user isn't looking at. Callers
 * that need the work to still happen eventually (e.g. a periodic cadence)
 * simply rely on their own retry tick — nothing here silently drops work
 * forever, it just declines to run *this* tick.
 *
 * Pure module: no DOM/globals touched at import time — every dependency
 * (requestIdleCallback, visibility check, setTimeout) is resolved lazily
 * inside scheduleIdleWork() and is fully injectable for tests.
 *
 * Any fallback setTimeout is `.unref()`'d using the guarded pattern from
 * reasoning-metrics.ts so a Node test runner (which has no real
 * requestIdleCallback) never leaks a timer that keeps the process alive.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining: () => number;
}

export type RequestIdleCallbackFn = (
  callback: (deadline: IdleDeadlineLike) => void,
  options?: { timeout: number },
) => number;

export type SetTimeoutFn = (callback: () => void, ms: number) => unknown;

export interface ScheduleIdleWorkOptions {
  /** Override requestIdleCallback (tests / non-browser). */
  requestIdleCallbackFn?: RequestIdleCallbackFn;
  /** Override the visibility check (tests). Default: true unless
   *  document.visibilityState === 'hidden'. */
  isVisible?: () => boolean;
  /** Guaranteed-to-run timeout passed to requestIdleCallback (default 10s). */
  timeoutMs?: number;
  /** Override setTimeout for the no-rIC fallback path (tests). */
  setTimeoutFn?: SetTimeoutFn;
}

const DEFAULT_TIMEOUT_MS = 10_000;

// ── Defaults (resolved lazily, never at import time) ────────────────────────

function defaultIsVisible(): boolean {
  try {
    const doc = (globalThis as unknown as { document?: { visibilityState?: string } }).document;
    if (doc && typeof doc.visibilityState === 'string') {
      return doc.visibilityState !== 'hidden';
    }
  } catch { /* non-browser environment */ }
  // No Document/visibility API available (Node test runner, worker context) —
  // don't block on a signal that doesn't exist.
  return true;
}

function defaultRequestIdleCallback(): RequestIdleCallbackFn | undefined {
  try {
    const g = globalThis as unknown as { requestIdleCallback?: RequestIdleCallbackFn };
    if (typeof g.requestIdleCallback === 'function') {
      return g.requestIdleCallback.bind(globalThis) as RequestIdleCallbackFn;
    }
  } catch { /* non-browser environment */ }
  return undefined;
}

function unrefIfPossible(timer: unknown): void {
  const t = timer as unknown as { unref?: () => void };
  if (typeof t?.unref === 'function') t.unref();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Schedule `task` to run off the current call stack, deferring to browser
 * idle time when available. Skips entirely (does not run, does not queue)
 * when the page is hidden — callers driven by a periodic cadence will pick
 * the work back up on their next tick, so this is a "not now" rather than
 * a "never."
 */
export function scheduleIdleWork(task: () => void, opts: ScheduleIdleWorkOptions = {}): void {
  const isVisible = opts.isVisible ?? defaultIsVisible;
  if (!isVisible()) return;

  const ric = opts.requestIdleCallbackFn ?? defaultRequestIdleCallback();
  if (ric) {
    ric(() => task(), { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    return;
  }

  // Fallback: setTimeout(0) still yields the current stack frame so the
  // caller's own frame isn't blocked, even without a real idle-time API.
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const timer = setTimeoutFn(() => task(), 0);
  unrefIfPossible(timer);
}
