/**
 * The one quiet-hours rule (R4-BUG-003).
 *
 * Every caller — the dispatcher's preference check, the alert-trace
 * explanation and the weather ladder — evaluates quiet hours here, against
 * the single window stored by notification-settings-service.
 *
 * Fail toward delivery: a window that is malformed, blank, or has equal
 * start and end is NEVER quiet. Such windows are also rejected at save time,
 * so they only appear from old or hand-edited storage.
 */

export type QuietWindowValidity = 'ok' | 'invalid' | 'equal';

const QUIET_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes since midnight for a strict 24-hour `HH:MM`, else null. */
export function parseQuietTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = QUIET_TIME.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function validateQuietWindow(start: unknown, end: unknown): QuietWindowValidity {
  const s = parseQuietTime(start);
  const e = parseQuietTime(end);
  if (s === null || e === null) return 'invalid';
  return s === e ? 'equal' : 'ok';
}

/** Start inclusive, end exclusive; `start > end` wraps past midnight. */
export function isWithinQuietWindow(minutes: number, start: unknown, end: unknown): boolean {
  const s = parseQuietTime(start);
  const e = parseQuietTime(end);
  if (s === null || e === null || s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** Local wall-clock minutes, so DST days follow the clock on the wall. */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Whole-hour value (0–23) as `HH:00`, else null. */
export function hourToQuietTime(hour: unknown): string | null {
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:00`;
}
