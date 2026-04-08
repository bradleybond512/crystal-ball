interface EventTargetLike {
  addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
}

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

interface ChunkReloadGuardOptions {
  eventTarget?: EventTargetLike;
  storage?: StorageLike;
  eventName?: string;
  reload?: () => void;
}

export function buildChunkReloadStorageKey(version: string): string {
  return `wm-chunk-reload:${version}`;
}

export function installChunkReloadGuard(
  version: string,
  options: ChunkReloadGuardOptions = {}
): string {
  const storageKey = buildChunkReloadStorageKey(version);
  const eventName = options.eventName ?? 'vite:preloadError';
  const eventTarget = options.eventTarget ?? window;
  const storage = options.storage ?? sessionStorage;
  const reload = options.reload ?? (() => window.location.reload());

  eventTarget.addEventListener(eventName, (event: Event) => {
 // Log the underlying failure so we can see what chunk/URL failed to preload.
 // Without this, we only see the symptom (a reload) and never the cause.
 const detail = (event as Event & { payload?: { message?: string } }).payload;
 const message = detail?.message ?? (event as unknown as { message?: string }).message ?? 'unknown';
 console.error(`[chunk-reload] vite:preloadError: ${message}`, event);

 // In Tauri, all chunks are bundled into the binary at build time. A reload
 // cannot fix a missing/broken chunk — it just re-runs vault intro and
 // leaves the user staring at a dead app. Skip the reload entirely.
 const isTauri =
 typeof window !== 'undefined' &&
 ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
 if (isTauri) return;

 if (storage.getItem(storageKey)) return;
 storage.setItem(storageKey, '1');
 reload();
  });

  return storageKey;
}

export function clearChunkReloadGuard(storageKey: string, storage: StorageLike = sessionStorage): void {
  storage.removeItem(storageKey);
}
