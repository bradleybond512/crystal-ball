// src/services/survival/scrubber-loop.ts
/**
 * Render-gated step for the time-scrubber playback loop (E4 glue).
 *
 * The rAF/interval glue calls `stepScrubber` once per frame with a `TickGate`
 * (visibility + throttle + wall-clock). It returns the next state, whether a
 * tick actually happened, and the `lastTickMs` to carry forward — so the loop
 * only repaints when `ticked` is true and burns nothing while paused or hidden
 * (the map-render idle-CPU discipline, expressed as pure bookkeeping around the
 * already-pure `shouldTick`/`advance`).
 */
import { advance, shouldTick, type ScrubberState, type TickGate } from './time-scrubber.ts';

export interface ScrubberStep {
  state: ScrubberState;
  /** True when the cursor actually advanced this frame (glue should repaint). */
  ticked: boolean;
  /** The `lastTickMs` the loop should remember for the next gate. */
  nextLastTickMs: number | null;
}

/**
 * One gated step. Advances by the wall time elapsed since the previous tick
 * (× speed, inside `advance`), but only when `shouldTick` passes the gate.
 */
export function stepScrubber(state: ScrubberState, gate: TickGate): ScrubberStep {
  if (!shouldTick(state, gate)) {
    return { state, ticked: false, nextLastTickMs: gate.lastTickMs };
  }
  // First tick after (re)starting has no prior timestamp — advance zero so the
  // cursor doesn't jump by an arbitrary amount; subsequent ticks use real delta.
  const elapsed = gate.lastTickMs === null ? 0 : Math.max(0, gate.nowMs - gate.lastTickMs);
  return { state: advance(state, elapsed), ticked: true, nextLastTickMs: gate.nowMs };
}
