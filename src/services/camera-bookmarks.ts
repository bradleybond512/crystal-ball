const STORAGE_KEY = 'crystalball-camera-bookmarks';

export interface CameraBookmark {
  lon: number;
  lat: number;
  alt: number;
  heading: number;
  pitch: number;
  label?: string;
}

export function loadBookmarks(): Record<string, CameraBookmark> {
  try {
 return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, CameraBookmark>;
  } catch {
 return {};
  }
}

export function saveBookmark(slot: string, bm: CameraBookmark): void {
  const all = loadBookmarks();
  all[slot] = bm;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function clearBookmark(slot: string): void {
  const all = loadBookmarks();
  delete all[slot];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
