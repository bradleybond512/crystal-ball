// src/services/survival/scrubber-view.ts
/**
 * Pure view-model for the World Stage time-scrubber HUD (Grand-Strategy Survival
 * OS, E4). Turns a `ScrubberState` into the labels + tick marks the DOM renders,
 * so the HUD component stays a thin shell over tested formatting logic.
 *
 * Pure: no DOM/state.
 */
import type { ScrubberState, TimeZone } from './time-scrubber.ts';
import { cursorFraction, nowFraction, zone } from './time-scrubber.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Human offset from now: "now" within a minute, else "−6h" / "+2d" / "−45m". */
export function formatTimeOffset(offsetMs: number): string {
  if (!Number.isFinite(offsetMs)) return 'now';
  const abs = Math.abs(offsetMs);
  if (abs < MIN) return 'now';
  const sign = offsetMs < 0 ? '−' : '+'; // U+2212 minus for a clean glyph
  if (abs < HOUR) return `${sign}${Math.round(abs / MIN)}m`;
  if (abs < DAY) return `${sign}${Math.round(abs / HOUR)}h`;
  return `${sign}${Math.round(abs / DAY)}d`;
}

/** The cursor's label relative to now (what the scrubber thumb reads). */
export function scrubberCursorLabel(state: ScrubberState): string {
  return formatTimeOffset(state.cursorMs - state.nowMs);
}

const ZONE_LABEL: Record<TimeZone, string> = {
  past: 'Replay',
  now: 'Now',
  future: 'Projected',
};

/** Mode word for the current zone — drives the HUD's badge. */
export function scrubberZoneLabel(state: ScrubberState): string {
  return ZONE_LABEL[zone(state)];
}

export interface ScrubberTick {
  /** Position 0..1 across the track. */
  fraction: number;
  /** Offset label at this tick ("−12h", "now", "+1d"). */
  label: string;
  /** True for the tick nearest the now anchor. */
  isNow: boolean;
}

/**
 * `count` evenly-spaced tick marks across the window (endpoints inclusive), each
 * with its offset-from-now label and a flag for the tick closest to now. Clamped
 * to at least 2 ticks (the two endpoints).
 */
export function scrubberTicks(state: ScrubberState, count: number): ScrubberTick[] {
  const n = Math.max(2, Number.isFinite(count) ? Math.floor(count) : 2);
  const span = state.endMs - state.startMs;
  const nowF = nowFraction(state);
  // Which tick index is closest to the now anchor?
  const nearestNow = span <= 0 ? 0 : Math.round(nowF * (n - 1));
  const ticks: ScrubberTick[] = [];
  for (let i = 0; i < n; i++) {
    const fraction = i / (n - 1);
    const ms = state.startMs + fraction * span;
    ticks.push({ fraction, label: formatTimeOffset(ms - state.nowMs), isNow: i === nearestNow });
  }
  return ticks;
}

/** Slider position (0..1) for the current cursor — what the DOM `<input range>` gets. */
export function scrubberThumbFraction(state: ScrubberState): number {
  return cursorFraction(state);
}

/** Play/pause glyph for the toggle button. */
export function playButtonLabel(state: ScrubberState): string {
  return state.playing ? '⏸' : '▶';
}
