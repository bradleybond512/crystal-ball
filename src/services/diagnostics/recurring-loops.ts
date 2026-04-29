/**
 * Recurring-loop registry — per
 * docs/CLAUDE_FUNCTIONALITY_DIAGNOSTICS_PERFORMANCE_ROADMAP_2026-04-29.md
 * Priority 6.
 *
 * The renderer registers many setInterval-driven loops (provider
 * snapshot bridge, sidecar probe, quality-debt collector, panel
 * refreshes). Until now there was no central place to:
 *
 *   1. detect duplicate registrations of the same named loop
 *   2. pause non-critical loops while the document is hidden
 *   3. expose the active loop count to System Diagnostic
 *
 * This module wraps setInterval with a named registration. Each loop
 * declares its name, period, and priority. `priority: 'low'` loops
 * pause when document.visibilityState === 'hidden' and resume on
 * 'visible'. `priority: 'critical'` loops never pause.
 *
 * Pure-ish: depends on globalThis.document for visibility hooks but
 * everything else is sync. Tests can drive without document by
 * passing a custom listener target.
 */

export type LoopPriority = 'critical' | 'normal' | 'low';

export interface LoopRegistration {
  name: string;
  /** Tick period in ms. */
  intervalMs: number;
  /** Whether this loop pauses when the document is hidden. */
  priority: LoopPriority;
  /** When the loop was first registered. */
  registeredAt: number;
  /** Last tick at — informational, set by the wrapper. */
  lastTickAt?: number;
  /** Whether the loop is currently paused (visibility / manual). */
  paused: boolean;
  /** Number of ticks observed (excluding paused intervals). */
  tickCount: number;
}

export interface LoopHandle {
  /** Stop the loop and remove it from the registry. */
  cancel: () => void;
  /** Read current registration metadata (for tests / diagnostics). */
  inspect: () => LoopRegistration;
}

interface InternalLoop extends LoopRegistration {
  fn: () => void;
  timerId: ReturnType<typeof setInterval> | null;
}

const loops = new Map<string, InternalLoop>();
let visibilityWired = false;

function ensureVisibilityWired(): void {
  if (visibilityWired) return;
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    const hidden = document.visibilityState === 'hidden';
    for (const loop of loops.values()) {
      if (loop.priority !== 'low') continue;
      if (hidden && !loop.paused) {
        pauseLoop(loop);
      } else if (!hidden && loop.paused) {
        resumeLoop(loop);
      }
    }
  });
  visibilityWired = true;
}

function pauseLoop(loop: InternalLoop): void {
  if (loop.timerId !== null) {
    clearInterval(loop.timerId);
    loop.timerId = null;
  }
  loop.paused = true;
}

function resumeLoop(loop: InternalLoop): void {
  if (loop.timerId !== null) return;
  loop.timerId = setInterval(() => runTick(loop), loop.intervalMs);
  loop.paused = false;
}

function runTick(loop: InternalLoop): void {
  loop.lastTickAt = Date.now();
  loop.tickCount += 1;
  try {
    loop.fn();
  } catch (error) {
    // Recurring loops should never propagate errors — that breaks
    // the timer permanently in some browsers. Log and continue.
    // eslint-disable-next-line no-console
    console.warn(`[recurring-loops] ${loop.name} threw:`, error);
  }
}

/**
 * Register a named recurring loop. Returns a handle the caller can
 * use to cancel. If a loop with the same name is already registered,
 * the previous one is cancelled first (idempotent re-registration is
 * the documented behavior — duplicate registrations during HMR or
 * remount must NOT spawn a second timer).
 */
export function registerRecurringLoop(
  name: string,
  fn: () => void,
  intervalMs: number,
  options: { priority?: LoopPriority; runImmediately?: boolean } = {},
): LoopHandle {
  ensureVisibilityWired();

  // Cancel any existing loop with this name — protects against
  // duplicate registration during HMR / remount.
  const existing = loops.get(name);
  if (existing) {
    if (existing.timerId !== null) clearInterval(existing.timerId);
    loops.delete(name);
  }

  const priority = options.priority ?? 'normal';
  const startPaused = priority === 'low' && typeof document !== 'undefined' && document.visibilityState === 'hidden';

  const loop: InternalLoop = {
    name,
    intervalMs,
    priority,
    registeredAt: Date.now(),
    paused: startPaused,
    tickCount: 0,
    fn,
    timerId: null,
  };
  if (!startPaused) {
    loop.timerId = setInterval(() => runTick(loop), intervalMs);
  }
  loops.set(name, loop);

  if (options.runImmediately) {
    runTick(loop);
  }

  return {
    cancel: () => {
      const current = loops.get(name);
      if (!current) return;
      if (current.timerId !== null) clearInterval(current.timerId);
      loops.delete(name);
    },
    inspect: () => ({
      name: loop.name,
      intervalMs: loop.intervalMs,
      priority: loop.priority,
      registeredAt: loop.registeredAt,
      lastTickAt: loop.lastTickAt,
      paused: loop.paused,
      tickCount: loop.tickCount,
    }),
  };
}

/** Snapshot of all registered loops, sorted by name. */
export function getRecurringLoops(): readonly LoopRegistration[] {
  return [...loops.values()]
    .map<LoopRegistration>((l) => ({
      name: l.name,
      intervalMs: l.intervalMs,
      priority: l.priority,
      registeredAt: l.registeredAt,
      lastTickAt: l.lastTickAt,
      paused: l.paused,
      tickCount: l.tickCount,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Cancel all loops. Tests + storybook only. */
export function resetRecurringLoopsForTests(): void {
  for (const loop of loops.values()) {
    if (loop.timerId !== null) clearInterval(loop.timerId);
  }
  loops.clear();
  visibilityWired = false;
}
