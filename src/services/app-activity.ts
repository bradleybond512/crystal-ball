type ActivityCallback = (active: boolean) => void;

let _active = true;
let _windowFocused = true;
const _listeners = new Set<ActivityCallback>();

function _recompute(): void {
  const nowActive = !document.hidden && _windowFocused;
  if (nowActive === _active) return;
  _active = nowActive;
  for (const cb of _listeners) cb(_active);
}

/** True when the app is visible AND the window is focused. */
export function isAppActive(): boolean {
  return _active;
}

/** Subscribe to activity changes. Returns an unsubscribe function. */
export function onActivityChange(cb: ActivityCallback): () => void {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

/** Call once at app startup. */
export function initAppActivity(): void {
  document.addEventListener('visibilitychange', () => _recompute());

  // Tauri 2: listen for window focus/blur via IPC
  const tauriWindow = window as unknown as {
    __TAURI__?: { event?: { listen?: (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void> } };
  };
  const listen = tauriWindow.__TAURI__?.event?.listen;
  if (listen) {
    void listen('tauri://focus', () => { _windowFocused = true; _recompute(); });
    void listen('tauri://blur', () => { _windowFocused = false; _recompute(); });
  }
}
