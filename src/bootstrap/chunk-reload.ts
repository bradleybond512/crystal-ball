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
 const detail = (event as Event & { payload?: { message?: string } }).payload;
 const message = detail?.message ?? (event as unknown as { message?: string }).message ?? 'unknown';

 // In Tauri, all chunks are bundled into the binary — a reload can't fix
 // a missing chunk. Optional dynamic imports (e.g. @tauri-apps/plugin-notification)
 // trigger this harmlessly; demote to warn so it doesn't flood error logs.
 const isTauri =
 typeof window !== 'undefined' &&
 ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
 if (isTauri) {
 console.warn(`[chunk-reload] preload skipped (Tauri): ${message}`);
 return;
 }

 console.error(`[chunk-reload] vite:preloadError: ${message}`, event);

 if (storage.getItem(storageKey)) return;
 storage.setItem(storageKey, '1');
 reload();
  });

  return storageKey;
}

export function clearChunkReloadGuard(storageKey: string, storage: StorageLike = sessionStorage): void {
  storage.removeItem(storageKey);
}
