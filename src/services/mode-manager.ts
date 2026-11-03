/**
 * App Mode Manager — Ghost / God's Vision (manual only).
 *
 * Mode is purely manual. All auto-trigger logic has been removed; data feeds
 * stay intact but no longer drive mode transitions.
 */

/**
 * Canonical modes: 'ghost' and 'gods-vision'. `null` represents the default
 * (no special mode) state — formerly the "peace" sentinel. All peace/finance/
 * war/disaster behaviors have been inlined into the default (null) state.
 */
export type AppMode = 'ghost' | 'gods-vision';

const MODE_STORAGE_KEY = 'wm-app-mode';

export const GHOST_COUNT_LIMIT = 9999;

type Preference = 'saved' | 'unknown' | 'window-only';

export interface GhostModeState {
  mode: AppMode | null;
  preference: Preference;
  generation: number;
  muted: number;
  critical: number;
}

let initialized = false;
let currentMode: AppMode | null = null;
let lastSavedMode: AppMode | null | undefined;
let preference: Preference = 'saved';
let preGhostMode: AppMode | null = null;
let generation = 0;
let muted = 0;
let critical = 0;
const subscribers = new Set<() => void>();

function notifySubscribers(): void {
  for (const listener of subscribers) listener();
}

function applyMode(mode: AppMode | null, nextPreference: Preference, auto = false): void {
  if (mode === currentMode && nextPreference === preference) return;
  const prev = currentMode;
  if (mode !== prev) {
    preGhostMode = mode === 'ghost' ? prev : null;
    muted = 0;
    critical = 0;
  }
  if ((mode === 'ghost' && prev !== 'ghost') || (nextPreference === 'unknown' && preference !== 'unknown')) {
    generation++;
  }
  currentMode = mode;
  preference = nextPreference;
  if (prev !== mode && typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent<ModeChangedDetail>('wm:mode-changed', {
      detail: { mode, prev, auto },
    }));
  }
  notifySubscribers();
}

function parseMode(saved: string | null): AppMode | null {
  return saved === 'ghost' || saved === 'gods-vision' ? saved : null;
}

function readMode(): AppMode | null {
  return parseMode(localStorage.getItem(MODE_STORAGE_KEY));
}

function isNewRemoteChoice(event: StorageEvent, saved: string | null, mode: AppMode | null): boolean {
  return lastSavedMode !== undefined && mode !== lastSavedMode
    && event.key === MODE_STORAGE_KEY && event.newValue === saved && saved === mode;
}

function syncStorage(event: StorageEvent): void {
  if (event.key !== MODE_STORAGE_KEY && event.key !== null) return;
  let saved: string | null;
  try {
    if (event.storageArea !== localStorage) return;
    saved = localStorage.getItem(MODE_STORAGE_KEY);
  } catch {
    if (preference !== 'window-only') applyMode(currentMode, 'unknown');
    return;
  }
  const mode = parseMode(saved);
  // After a read error, only a changed, explicit mode key with a known
  // baseline can resolve the hold remotely. A generic clear cannot.
  if (preference === 'unknown' && !isNewRemoteChoice(event, saved, mode)) return;
  // A queued event can predate a newer choice in this window. Read the
  // current value, but invalidate pending sends if Ghost intervened briefly.
  if (event.newValue === 'ghost' && currentMode !== 'ghost' && mode !== 'ghost') generation++;
  if (preference === 'window-only' && mode === lastSavedMode) return;
  lastSavedMode = mode;
  applyMode(mode, 'saved');
}

export function initMode(): AppMode | null {
  if (initialized) return currentMode;
  initialized = true;
  if (typeof window !== 'undefined') window.addEventListener?.('storage', syncStorage);
  try {
    currentMode = readMode();
    lastSavedMode = currentMode;
    if (currentMode === 'ghost') generation++;
  } catch {
    preference = 'unknown';
    generation++;
  }
  return currentMode;
}

export function getMode(): AppMode | null {
  return initMode();
}

export function getGhostModeState(): GhostModeState {
  initMode();
  return { mode: currentMode, preference, generation, muted, critical };
}

// Storage events from another window are asynchronous. At an outward delivery
// boundary, compare the saved choice again before permitting the side effect.
export function getNotificationModeState(): GhostModeState {
  initMode();
  if (preference === 'saved') {
    try {
      lastSavedMode = readMode();
    } catch {
      applyMode(currentMode, 'unknown');
      return getGhostModeState();
    }
    applyMode(lastSavedMode, 'saved');
  }
  return getGhostModeState();
}

export function subscribeGhostMode(listener: () => void): () => void {
  initMode();
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}

export function recordGhostSuppression(isCritical: boolean): void {
  if (getMode() !== 'ghost' || preference === 'unknown') return;
  const nextMuted = Math.min(muted + 1, GHOST_COUNT_LIMIT);
  const nextCritical = Math.min(critical + Number(isCritical), GHOST_COUNT_LIMIT);
  if (muted === nextMuted && critical === nextCritical) return;
  muted = nextMuted;
  critical = nextCritical;
  notifySubscribers();
}

export function setMode(mode: AppMode | null, auto = false): void {
  if (mode === getMode() && preference === 'saved') return;
  let saved = false;
  try {
    if (mode) localStorage.setItem(MODE_STORAGE_KEY, mode);
    else localStorage.removeItem(MODE_STORAGE_KEY);
    // The quota patch can swallow a failed write. Verify the chosen value.
    const observed = localStorage.getItem(MODE_STORAGE_KEY);
    saved = observed === mode;
    lastSavedMode = parseMode(observed);
  } catch { /* this selection still applies in the current window */ }
  applyMode(mode, saved ? 'saved' : 'window-only', auto);
}

export function toggleGhostMode(): void {
  setMode(getMode() === 'ghost' ? preGhostMode : 'ghost');
}

export function isGodsVisionMode(): boolean {
  return getMode() === 'gods-vision';
}

export function isGhostMode(): boolean {
  return getMode() === 'ghost';
}

export function getGhostRefreshMultiplier(): number {
  return getMode() === 'ghost' ? 5 : 1;
}

export interface ModeChangedDetail {
  mode: AppMode | null;
  prev: AppMode | null;
  auto: boolean;
}

export interface WarScoreDetail {
  score: number;
  threshold: number;
}
