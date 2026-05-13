/**
 * Command Center layout persistence.
 *
 * Pure, deterministic, localStorage-backed tile layout. Keeps the tile
 * order + visibility + per-place binding across reloads so users do
 * not lose their personalized Command Center each session.
 *
 * No DOM, no fetch — module is safe to unit-test under
 * `tsx --test` with a tiny in-memory storage shim.
 */

export type TileType = 'saved-place' | 'situation' | 'alert' | 'feed-health';

export interface TileConfig {
  id: string;
  type: TileType;
  order: number;
  visible: boolean;
  placeId?: string;
}

export interface SavedPlaceLike {
  id: string;
  name?: string;
}

export const LAYOUT_KEY = 'wm-cc-layout';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function readStorage(): StorageLike | null {
  try {
    const g = globalThis as { localStorage?: StorageLike };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

function isTileType(value: unknown): value is TileType {
  return value === 'saved-place'
    || value === 'situation'
    || value === 'alert'
    || value === 'feed-health';
}

function coerceTile(raw: unknown): TileConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0) return null;
  if (!isTileType(r.type)) return null;
  const order = typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : 0;
  const visible = typeof r.visible === 'boolean' ? r.visible : true;
  const tile: TileConfig = { id: r.id, type: r.type, order, visible };
  if (typeof r.placeId === 'string' && r.placeId.length > 0) tile.placeId = r.placeId;
  return tile;
}

export function loadLayout(storage: StorageLike | null = readStorage()): TileConfig[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(LAYOUT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const tiles: TileConfig[] = [];
    for (const entry of parsed) {
      const tile = coerceTile(entry);
      if (tile) tiles.push(tile);
    }
    return sortLayout(tiles);
  } catch {
    return [];
  }
}

export function saveLayout(
  layout: readonly TileConfig[],
  storage: StorageLike | null = readStorage(),
): void {
  if (!storage) return;
  const serializable = sortLayout(layout).map((tile, idx) => ({
    id: tile.id,
    type: tile.type,
    order: idx,
    visible: tile.visible,
    ...(tile.placeId ? { placeId: tile.placeId } : {}),
  }));
  storage.setItem(LAYOUT_KEY, JSON.stringify(serializable));
}

export function clearLayout(storage: StorageLike | null = readStorage()): void {
  if (!storage) return;
  storage.removeItem(LAYOUT_KEY);
}

export function defaultLayout(savedPlaces: readonly SavedPlaceLike[] = []): TileConfig[] {
  const tiles: TileConfig[] = [];
  let order = 0;
  for (const place of savedPlaces) {
    if (!place.id) continue;
    tiles.push({
      id: `saved-place:${place.id}`,
      type: 'saved-place',
      order: order++,
      visible: true,
      placeId: place.id,
    });
  }
  tiles.push(
    { id: 'situations', type: 'situation', order: order++, visible: true },
    { id: 'alerts', type: 'alert', order: order++, visible: true },
    { id: 'feed-health', type: 'feed-health', order: order++, visible: true },
  );
  return tiles;
}

/**
 * Merge a stored layout with the current set of saved places. Removes
 * tiles whose backing place no longer exists, and appends tiles for
 * newly-added places at the end so they don't silently disappear.
 */
export function reconcileLayout(
  stored: readonly TileConfig[],
  savedPlaces: readonly SavedPlaceLike[],
): TileConfig[] {
  const placeIds = new Set(savedPlaces.map((p) => p.id).filter(Boolean));
  const keep = stored.filter((tile) => {
    if (tile.type !== 'saved-place') return true;
    return tile.placeId !== undefined && placeIds.has(tile.placeId);
  });
  const seenPlaces = new Set(
    keep.filter((t) => t.type === 'saved-place' && t.placeId)
      .map((t) => t.placeId as string),
  );
  let maxOrder = keep.reduce((m, t) => Math.max(m, t.order), -1);
  for (const place of savedPlaces) {
    if (!place.id || seenPlaces.has(place.id)) continue;
    keep.push({
      id: `saved-place:${place.id}`,
      type: 'saved-place',
      order: ++maxOrder,
      visible: true,
      placeId: place.id,
    });
  }
  return sortLayout(keep);
}

/**
 * Move `tileId` to the slot currently held by `targetId`. Returns a new
 * array — input is not mutated. Stable order numbers are assigned by
 * position so persisted JSON stays compact.
 */
export function reorderLayout(
  layout: readonly TileConfig[],
  tileId: string,
  targetId: string,
): TileConfig[] {
  if (tileId === targetId) return [...layout];
  const sorted = sortLayout(layout);
  const fromIdx = sorted.findIndex((t) => t.id === tileId);
  const toIdx = sorted.findIndex((t) => t.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return sorted;
  const next = [...sorted];
  const moved = next[fromIdx];
  if (!moved) return sorted;
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next.map((tile, i) => ({ ...tile, order: i }));
}

export function setTileVisibility(
  layout: readonly TileConfig[],
  tileId: string,
  visible: boolean,
): TileConfig[] {
  return layout.map((t) => (t.id === tileId ? { ...t, visible } : t));
}

export function sortLayout(layout: readonly TileConfig[]): TileConfig[] {
  return [...layout].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  });
}
