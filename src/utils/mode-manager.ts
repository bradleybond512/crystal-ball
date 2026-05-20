export type AppMode = 'normal' | 'elevated' | 'crisis' | 'blackout';

export const STORAGE_KEY = 'wm-app-mode';
const DEFAULT_MODE: AppMode = 'normal';
const VALID_MODES = new Set<string>(['normal', 'elevated', 'crisis', 'blackout']);

export type ModeChangeCallback = (mode: AppMode, prev: AppMode) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isValidMode(value: string | null): value is AppMode {
  return value !== null && VALID_MODES.has(value);
}

function applyToDataset(mode: AppMode): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.mode = mode;
  }
}

export class ModeManager {
  private static instance: ModeManager | undefined;

  private current: AppMode;
  private readonly listeners = new Set<ModeChangeCallback>();
  private readonly storage: StorageLike;

  private constructor(storage: StorageLike) {
    this.storage = storage;
    const stored = storage.getItem(STORAGE_KEY);
    this.current = isValidMode(stored) ? stored : DEFAULT_MODE;
    applyToDataset(this.current);
  }

  static getInstance(storage: StorageLike = localStorage): ModeManager {
    ModeManager.instance ??= new ModeManager(storage);
    return ModeManager.instance;
  }

  static resetForTests(): void {
    ModeManager.instance = undefined;
  }

  getMode(): AppMode {
    return this.current;
  }

  setMode(mode: AppMode): void {
    const prev = this.current;
    this.current = mode;
    this.storage.setItem(STORAGE_KEY, mode);
    applyToDataset(mode);
    const snapshot = [...this.listeners];
    for (const cb of snapshot) {
      cb(mode, prev);
    }
  }

  onModeChange(cb: ModeChangeCallback): void {
    this.listeners.add(cb);
  }

  offModeChange(cb: ModeChangeCallback): void {
    this.listeners.delete(cb);
  }
}
