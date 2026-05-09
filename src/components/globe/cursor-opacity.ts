/**
 * Cursor-window opacity classifier.
 *
 * Pure deterministic. Decides "what alpha should an entity render at
 * given the playback cursor and a per-entity timestamp?".
 *
 * Used by GlobeDataManager: on every `wm:globe-timeline-cursor`
 * event, walk the entity collections for time-stamped layers and call
 * `opacityForEntity` to decide the alpha. The Cesium glue applies the
 * resulting alpha to the entity's `point.color` / `billboard.color` /
 * `rectangle.material`.
 *
 * Plan invariants:
 *   - Default window is ±2h around the cursor. Entities outside the
 *     window get the dimmed alpha (default 0.3); inside-window get
 *     full alpha (1.0).
 *   - Entities with no timestamp keep full alpha — we don't fade
 *     timeless data (saved places, infrastructure, etc.).
 *   - The classifier is O(1) per entity; the caller iterates.
 */

// ── Public types ────────────────────────────────────────────────────────

export interface CursorOpacityOptions {
  /** Half-window in ms around the cursor. Default 2 h. */
  halfWindowMs?: number;
  /** Alpha for entities inside the window. Default 1.0. */
  insideAlpha?: number;
  /** Alpha for entities outside the window. Default 0.3. */
  outsideAlpha?: number;
}

const DEFAULT_HALF_WINDOW_MS = 2 * 60 * 60 * 1000;
const DEFAULT_INSIDE_ALPHA = 1;
const DEFAULT_OUTSIDE_ALPHA = 0.3;

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Classify a single entity timestamp against the cursor.
 *
 * `entityTimestamp === null` (no timestamp) returns `insideAlpha` —
 * timeless entities are never faded by the cursor.
 *
 * `entityTimestamp` outside the cursor's ±halfWindow returns
 * `outsideAlpha`. Inside returns `insideAlpha`.
 */
export function opacityForEntity(
  entityTimestamp: number | null | undefined,
  cursorMs: number,
  options: CursorOpacityOptions = {},
): number {
  const insideAlpha = options.insideAlpha ?? DEFAULT_INSIDE_ALPHA;
  if (entityTimestamp === null || entityTimestamp === undefined) return insideAlpha;
  if (!Number.isFinite(entityTimestamp)) return insideAlpha;
  const half = options.halfWindowMs ?? DEFAULT_HALF_WINDOW_MS;
  const outsideAlpha = options.outsideAlpha ?? DEFAULT_OUTSIDE_ALPHA;
  const delta = Math.abs(cursorMs - entityTimestamp);
  return delta <= half ? insideAlpha : outsideAlpha;
}

/**
 * Coerce a heterogeneous timestamp value (Date / ISO string / ms
 * number / undefined) to ms epoch. Returns `null` when the value
 * can't be normalised — the classifier treats null as "timeless".
 *
 * Cesium entities store timestamps as `Date` (via the `setEntityTimestamp`
 * helper in GlobeDataManager); some downstream code passes strings.
 * This shim handles both.
 */
export function coerceTimestampMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Bucket count helper — useful for tests and the panel-corner badge
 * ("3 in window / 12 outside").
 */
export function bucketCounts(
  entityTimestamps: readonly (number | null | undefined)[],
  cursorMs: number,
  options: CursorOpacityOptions = {},
): { inside: number; outside: number; timeless: number } {
  const half = options.halfWindowMs ?? DEFAULT_HALF_WINDOW_MS;
  const out = { inside: 0, outside: 0, timeless: 0 };
  for (const ts of entityTimestamps) {
    if (ts == null || !Number.isFinite(ts)) {
      out.timeless += 1;
      continue;
    }
    if (Math.abs(cursorMs - ts) <= half) out.inside += 1;
    else out.outside += 1;
  }
  return out;
}

// ── Re-export defaults so tests + downstream consumers agree ────────────

export const DEFAULTS = {
  halfWindowMs: DEFAULT_HALF_WINDOW_MS,
  insideAlpha: DEFAULT_INSIDE_ALPHA,
  outsideAlpha: DEFAULT_OUTSIDE_ALPHA,
} as const;
