/**
 * Alert bookmarks / collections — save important alerts into named
 * collections for later review.
 */

const STORAGE_KEY = 'crystalball-alert-bookmarks-v1';

export interface BookmarkCollection {
  id: string;
  name: string;
  alertIds: string[];
  createdAt: number;
}

let collections: BookmarkCollection[] = [];

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    collections = JSON.parse(raw) as BookmarkCollection[];
  } catch { /* noop */ }
}

function save(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collections)); } catch { /* noop */ }
}

export function getCollections(): BookmarkCollection[] {
  return [...collections];
}

export function createCollection(name: string): BookmarkCollection {
  const col: BookmarkCollection = {
    id: `col-${Date.now()}`,
    name,
    alertIds: [],
    createdAt: Date.now(),
  };
  collections.push(col);
  save();
  return col;
}

export function deleteCollection(id: string): void {
  collections = collections.filter(c => c.id !== id);
  save();
}

export function addToCollection(collectionId: string, alertId: string): void {
  const col = collections.find(c => c.id === collectionId);
  if (col && !col.alertIds.includes(alertId)) {
    col.alertIds.push(alertId);
    save();
  }
}

export function removeFromCollection(collectionId: string, alertId: string): void {
  const col = collections.find(c => c.id === collectionId);
  if (col) {
    col.alertIds = col.alertIds.filter(id => id !== alertId);
    save();
  }
}

export function isBookmarked(alertId: string): boolean {
  return collections.some(c => c.alertIds.includes(alertId));
}

export function getCollectionsForAlert(alertId: string): BookmarkCollection[] {
  return collections.filter(c => c.alertIds.includes(alertId));
}

export function initAlertBookmarks(): void {
  load();
}
