/**
 * Timeline-event visibility cursor — companion to the existing
 * GlobeTimeMachine.
 *
 * GodsVisionView already ships GlobeTimeMachine (UI bar with play /
 * pause / speed / slider) that owns the time cursor. What's missing is
 * the pure rule "given a time cursor + a list of TimelineEvents, which
 * ones are visible right now and at what intensity?". This module is
 * that rule.
 *
 * Pure deterministic. No DOM, no fetch, no globals. Built on the
 * existing TimelineEvent shape from `services/timeline-scrubber`.
 *
 * Plan invariants:
 *   - Event visibility is bounded: events appear at their origin
 *     timestamp and fade over a finite window so the globe doesn't
 *     accumulate forever as the cursor advances.
 *   - Per-type fade window is documented so callers can tune (seismic
 *     fades faster than wildfire perimeters, etc.).
 *   - Output is JSON-serializable for replay fixtures.
 */

import type {
  TimelineEvent,
  TimelineEventType,
} from '../timeline-scrubber';

// ── Public types ───────────────────────────────────────────────────────

export interface VisibleTimelineEvent {
  event: TimelineEvent;
  /** Opacity in [0, 1]. 1 = freshly emitted, 0 = aged out. */
  opacity: number;
  /** ms since the event's origin timestamp at the cursor. */
  ageMs: number;
}

export interface CursorOptions {
  /** ms epoch of the playback cursor. */
  currentMs: number;
  /** Window the cursor "looks back" over. Events older than this are
   *  not visible. Default 6h (matches the spec's smallest window). */
  windowMs?: number;
  /** Per-type fade duration override. Defaults below. */
  fadeMs?: Partial<Record<TimelineEventType, number>>;
}

// ── Per-type fade defaults ─────────────────────────────────────────────

/** Fade duration in ms — how long after origin time an event remains
 *  visible. Outside this window the event is fully aged out.
 *
 *  Rationale per type:
 *  - earthquake: 4 h (felt-shaking + immediate aftershock window)
 *  - fire: 24 h (wildfire perimeters update slowly)
 *  - weather: 6 h (most NWS warnings expire within 6h)
 *  - airstrike / military / conflict / protest: 12 h (operational tempo)
 *  - cyber / sigint / nuclear: 12 h (analytical decay)
 *  - infrastructure: 24 h (outages persist)
 *  - maritime: 6 h (vessel positions stale fast). */
export const DEFAULT_FADE_MS: Readonly<Record<TimelineEventType, number>> = {
  earthquake:     4 * 3_600_000,
  fire:           24 * 3_600_000,
  weather:        6 * 3_600_000,
  airstrike:      12 * 3_600_000,
  military:       12 * 3_600_000,
  conflict:       12 * 3_600_000,
  protest:        12 * 3_600_000,
  cyber:          12 * 3_600_000,
  sigint:         12 * 3_600_000,
  nuclear:        12 * 3_600_000,
  infrastructure: 24 * 3_600_000,
  maritime:       6 * 3_600_000,
};

const DEFAULT_WINDOW_MS = 6 * 3_600_000;

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Filter `events` to those visible at `currentMs`. Returns a typed
 * record per visible event with its computed opacity (linear fade
 * from 1 → 0 across the per-type fade window) and age.
 *
 * Events whose timestamp is in the future relative to the cursor are
 * always hidden — that's the whole point of "playback".
 */
export function visibleAt(
  events: readonly TimelineEvent[],
  options: CursorOptions,
): VisibleTimelineEvent[] {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const fadeOverrides = options.fadeMs ?? {};
  const cutoff = options.currentMs - windowMs;
  const out: VisibleTimelineEvent[] = [];
  for (const event of events) {
    if (event.timestamp > options.currentMs) continue;        // future
    if (event.timestamp < cutoff) continue;                   // out of window
    const fade = fadeOverrides[event.type] ?? DEFAULT_FADE_MS[event.type];
    const ageMs = options.currentMs - event.timestamp;
    if (ageMs >= fade) continue;                              // aged out
    const opacity = clamp01(1 - ageMs / fade);
    out.push({ event, opacity, ageMs });
  }
  // Newest first — callers usually z-stack newest on top.
  out.sort((a, b) => b.event.timestamp - a.event.timestamp);
  return out;
}

/**
 * Per-type counts at the cursor — useful for the toolbar badge
 * ("3 quakes · 2 fires · 1 cyber"). Counts visible events only.
 */
export function countByType(visible: readonly VisibleTimelineEvent[]): Record<TimelineEventType, number> {
  const counts: Record<TimelineEventType, number> = {
    earthquake: 0, fire: 0, weather: 0, airstrike: 0, military: 0,
    conflict: 0, protest: 0, cyber: 0, sigint: 0, nuclear: 0,
    infrastructure: 0, maritime: 0,
  };
  for (const v of visible) counts[v.event.type] += 1;
  return counts;
}

/**
 * Build a list of "checkpoints" — distinct timestamps at which a new
 * event enters or an old one ages out. The playback UI uses this to
 * tick the globe rather than advancing every frame; with a sparse
 * event stream that's a big perf win.
 *
 * Returns timestamps sorted ascending, deduped.
 */
export function checkpoints(
  events: readonly TimelineEvent[],
  options: { startMs: number; endMs: number; fadeMs?: CursorOptions['fadeMs'] },
): number[] {
  const fadeOverrides = options.fadeMs ?? {};
  const set = new Set<number>();
  for (const event of events) {
    if (event.timestamp < options.startMs) continue;
    if (event.timestamp > options.endMs) continue;
    set.add(event.timestamp);
    const fade = fadeOverrides[event.type] ?? DEFAULT_FADE_MS[event.type];
    const out = event.timestamp + fade;
    if (out >= options.startMs && out <= options.endMs) set.add(out);
  }
  return [...set].sort((a, b) => a - b);
}

// ── Helpers ────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
