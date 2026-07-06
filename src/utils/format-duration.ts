/**
 * Shared human-readable duration formatter.
 *
 * One implementation for every "how long" string the UI shows so users
 * never see raw unit dumps like "120h" or "7620m". Output keeps at most
 * the two largest units and drops a zero-valued second unit:
 *
 *   45      → "45m"
 *   200     → "3h 20m"
 *   180     → "3h"
 *   7620    → "5d 7h"
 *   7200    → "5d"
 *
 * Pure — safe to import from the deterministic service layers.
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** Format a duration given in minutes, e.g. "45m", "3h 20m", "5d 7h". */
export function formatDurationMinutes(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  if (mins < MINUTES_PER_HOUR) return `${mins}m`;
  if (mins < MINUTES_PER_DAY) {
    const hours = Math.floor(mins / MINUTES_PER_HOUR);
    const rem = mins % MINUTES_PER_HOUR;
    return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
  }
  const days = Math.floor(mins / MINUTES_PER_DAY);
  const remHours = Math.floor((mins % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

/**
 * Format a duration given in milliseconds. Sub-minute durations render
 * as seconds ("42s"); everything else delegates to formatDurationMinutes.
 */
export function formatDurationMs(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 60_000) return `${Math.floor(clamped / 1000)}s`;
  return formatDurationMinutes(clamped / 60_000);
}
