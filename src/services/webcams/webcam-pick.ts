import type { WebcamFeed } from './webcam-types';

/**
 * Pure routing for a globe/map webcam pick — kept Cesium-free so the click
 * behaviour is unit-testable. A clustered pin picks as an array of its member
 * entities (→ zoom to expand); an individual pin picks as an entity carrying a
 * string `id` that maps to a feed (→ open its viewer). Anything else is a miss.
 */
export type WebcamPickResult =
  | { kind: 'cluster'; entities: readonly unknown[] }
  | { kind: 'feed'; feed: WebcamFeed }
  | null;

export function resolveWebcamPick(
  entityId: unknown,
  feedById: ReadonlyMap<string, WebcamFeed>,
): WebcamPickResult {
  if (Array.isArray(entityId)) return { kind: 'cluster', entities: entityId };
  if (entityId && typeof entityId === 'object') {
    const id = (entityId as { id?: unknown }).id;
    if (typeof id === 'string') {
      const feed = feedById.get(id);
      if (feed) return { kind: 'feed', feed };
    }
  }
  return null;
}
