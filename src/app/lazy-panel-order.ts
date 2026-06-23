/**
 * Pure ordering helper for lazily-mounted panels. Kept DOM-free so the
 * insertion rule can be unit-tested without a browser.
 */

/**
 * Given the canonical panel order, the set of panel keys currently present in
 * the grid, and a key being inserted, return the key of the nearest already-
 * present panel that comes *after* it (so the new element is inserted before
 * that one), or null to append.
 */
export function findInsertBeforeKey(
  order: string[],
  presentKeys: Set<string>,
  key: string,
): string | null {
  const idx = order.indexOf(key);
  if (idx === -1) return null;
  for (let i = idx + 1; i < order.length; i++) {
    const candidate = order[i];
    if (candidate !== undefined && presentKeys.has(candidate)) return candidate;
  }
  return null;
}
