// src/services/home-shell/pin-picker-filter.ts
/**
 * Pure filter for the Home Shell deck's pin picker. Kept DOM-free so it's unit
 * testable — the combobox in HomeShellOverlay renders whatever this returns.
 */

/** Panels pinnable right now (not already pinned) whose name matches the query,
 *  sorted by name and capped. An empty/whitespace query lists everything. */
export function matchPinnablePanels(
  query: string,
  entries: readonly (readonly [string, { name: string }])[],
  pinned: readonly string[],
  limit = 40,
): [string, string][] {
  const q = query.trim().toLowerCase();
  const pins = new Set(pinned);
  return entries
    .filter(([key, cfg]) => !pins.has(key) && (q === '' || cfg.name.toLowerCase().includes(q)))
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .slice(0, limit)
    .map(([key, cfg]) => [key, cfg.name]);
}
