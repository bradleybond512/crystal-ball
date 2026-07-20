// src/services/survival/time-scrubber.ts
/**
 * Unified time control for the World Stage board (Grand-Strategy Survival OS, E4).
 * One axis: replay ⟵ now ⟶ projected futures. A pure, immutable scrubber model
 * the board glue drives — the slider maps to `cursorFraction`, the play button to
 * `togglePlay`, and a render-gated rAF loop advances via `advance` only when
 * `shouldTick` says so (visibility + throttle — the map-render idle-CPU lesson).
 *
 * Pure: no DOM/timers/globals. Every function returns a new state (immutable) so
 * it's trivially testable and safe to memoize.
 */

export type TimeZone = 'past' | 'now' | 'future';

export interface ScrubberState {
  /** Left edge of the window (oldest replayable moment), ms since epoch. */
  readonly startMs: number;
  /** "Now" anchor, ms since epoch. */
  readonly nowMs: number;
  /** Right edge (furthest projected future), ms since epoch. */
  readonly endMs: number;
  /** Cursor position, ms since epoch, always within [startMs, endMs]. */
  readonly cursorMs: number;
  /** Whether playback is advancing the cursor. */
  readonly playing: boolean;
  /** Playback speed multiplier (wall-ms → timeline-ms). */
  readonly speed: number;
  /** ± tolerance (ms) within which the cursor counts as "now". */
  readonly nowToleranceMs: number;
}

const DEFAULT_NOW_TOLERANCE_MS = 60_000; // ±1 min around now reads as "now"

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, value));
}

export interface CreateScrubberOptions {
  /** How far back the window reaches (ms before now). */
  pastSpanMs: number;
  /** How far forward the window projects (ms after now). */
  futureSpanMs: number;
  speed?: number;
  nowToleranceMs?: number;
}

/** Build a scrubber anchored at `nowMs`, cursor parked on now, paused. */
export function createScrubber(nowMs: number, opts: CreateScrubberOptions): ScrubberState {
  const past = Math.max(0, opts.pastSpanMs);
  const future = Math.max(0, opts.futureSpanMs);
  return {
    startMs: nowMs - past,
    nowMs,
    endMs: nowMs + future,
    cursorMs: nowMs,
    playing: false,
    speed: opts.speed && opts.speed > 0 && Number.isFinite(opts.speed) ? opts.speed : 1,
    nowToleranceMs: opts.nowToleranceMs ?? DEFAULT_NOW_TOLERANCE_MS,
  };
}

/** Seek the cursor to an absolute ms, clamped to the window. */
export function seekTo(state: ScrubberState, ms: number): ScrubberState {
  return { ...state, cursorMs: clamp(ms, state.startMs, state.endMs) };
}

/** Park the cursor back on the now anchor (and stop playing). */
export function seekToNow(state: ScrubberState): ScrubberState {
  return { ...state, cursorMs: state.nowMs, playing: false };
}

/** Fraction 0..1 of the cursor across the full window (0 = oldest, 1 = furthest future). */
export function cursorFraction(state: ScrubberState): number {
  const span = state.endMs - state.startMs;
  if (span <= 0) return 0;
  return clamp((state.cursorMs - state.startMs) / span, 0, 1);
}

/** Fraction 0..1 where the now anchor sits — for drawing the "now" tick. */
export function nowFraction(state: ScrubberState): number {
  const span = state.endMs - state.startMs;
  if (span <= 0) return 0;
  return clamp((state.nowMs - state.startMs) / span, 0, 1);
}

/** Seek by fraction 0..1 of the window (slider drag). */
export function seekFraction(state: ScrubberState, fraction: number): ScrubberState {
  const f = clamp(fraction, 0, 1);
  return seekTo(state, state.startMs + f * (state.endMs - state.startMs));
}

/** Which zone the cursor is in — 'now' within tolerance, else past/future. */
export function zone(state: ScrubberState): TimeZone {
  if (Math.abs(state.cursorMs - state.nowMs) <= state.nowToleranceMs) return 'now';
  return state.cursorMs < state.nowMs ? 'past' : 'future';
}

export function togglePlay(state: ScrubberState): ScrubberState {
  // Pressing play while parked at the far end restarts from the window start.
  if (!state.playing && state.cursorMs >= state.endMs) {
    return { ...state, playing: true, cursorMs: state.startMs };
  }
  return { ...state, playing: !state.playing };
}

export function setSpeed(state: ScrubberState, speed: number): ScrubberState {
  return { ...state, speed: speed > 0 && Number.isFinite(speed) ? speed : state.speed };
}

/**
 * Advance the cursor by `wallElapsedMs` of real time (× speed) while playing.
 * Stops (playing → false) when it reaches the end. No-op when paused. Pure.
 */
export function advance(state: ScrubberState, wallElapsedMs: number): ScrubberState {
  if (!state.playing || !Number.isFinite(wallElapsedMs) || wallElapsedMs <= 0) return state;
  const next = state.cursorMs + wallElapsedMs * state.speed;
  if (next >= state.endMs) return { ...state, cursorMs: state.endMs, playing: false };
  return { ...state, cursorMs: next };
}

export interface TickGate {
  /** Is the board visible (foreground tab / not occluded)? */
  visible: boolean;
  /** Wall-clock now, ms. */
  nowMs: number;
  /** When the last tick actually ran, ms (or null if never). */
  lastTickMs: number | null;
  /** Minimum wall-ms between ticks (throttle). */
  minIntervalMs: number;
}

/**
 * Render-gate for the playback loop: only advance when playing AND the board is
 * visible AND at least `minIntervalMs` has elapsed since the last tick. This is
 * the map-render idle-CPU discipline as a pure predicate — the rAF/interval glue
 * calls it before doing any work, so a hidden or paused board burns nothing.
 */
export function shouldTick(state: ScrubberState, gate: TickGate): boolean {
  if (!state.playing || !gate.visible) return false;
  if (gate.lastTickMs === null) return true;
  return gate.nowMs - gate.lastTickMs >= gate.minIntervalMs;
}
