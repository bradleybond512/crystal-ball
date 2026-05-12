/**
 * Pure helpers used by NotificationHistoryPanel. Extracted so tests can
 * import without dragging in `i18n` / Vite's import.meta.glob.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface TimeRangePreset {
  id: 'all' | 'h1' | 'h24' | 'd7';
  label: string;
  sinceOffsetMs: number | null;
}

export const TIME_RANGES: TimeRangePreset[] = [
  { id: 'all', label: 'All time', sinceOffsetMs: null },
  { id: 'h1',  label: 'Last 1 h', sinceOffsetMs: HOUR_MS },
  { id: 'h24', label: 'Last 24 h', sinceOffsetMs: DAY_MS },
  { id: 'd7',  label: 'Last 7 d', sinceOffsetMs: 7 * DAY_MS },
];

export function sinceMsForRange(rangeId: TimeRangePreset['id'], now = Date.now()): number | undefined {
  const preset = TIME_RANGES.find((r) => r.id === rangeId);
  if (!preset?.sinceOffsetMs) return undefined;
  return now - preset.sinceOffsetMs;
}

export function formatTimestamp(ms: number, now = Date.now()): string {
  const ageMs = now - ms;
  if (ageMs < 0) return 'just now';
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s ago`;
  if (ageMs < HOUR_MS) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < DAY_MS) return `${Math.floor(ageMs / HOUR_MS)}h ago`;
  return `${Math.floor(ageMs / DAY_MS)}d ago`;
}

/** Pretty-print a payload object as multiline `key: value`. Skips
 *  undefined values and stringifies non-primitives via JSON. */
export function formatPayload(payload: Record<string, unknown> | undefined): string {
  if (!payload || typeof payload !== 'object') return '(no payload)';
  const lines: string[] = [];
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) continue;
    if (v === null) { lines.push(`${k}: null`); continue; }
    if (typeof v === 'object') {
      lines.push(`${k}: ${safeStringify(v)}`);
    } else if (typeof v === 'string' || typeof v === 'number'
      || typeof v === 'boolean' || typeof v === 'bigint') {
      lines.push(`${k}: ${String(v)}`);
    } else {
      lines.push(`${k}: ${safeStringify(v)}`);
    }
  }
  return lines.join('\n') || '(empty)';
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '[unstringifiable]';
  }
}
