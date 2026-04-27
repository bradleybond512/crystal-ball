import type { RuntimeSecretKey } from './runtime-config';

const POSITION_KEY = 'cb:setup-wizard:position';
const DONT_ASK_KEY = 'cb:setup-wizard:dont-ask';
const SKIPPED_KEY = 'cb:setup-wizard:skipped';
const STATUS_PREFIX = 'cb:key-status:';

export interface WizardPosition { tier: number; stepIndex: number }
export type KeyStatusState = 'valid' | 'unvalidated' | 'invalid' | 'unset' | 'skipped';
export interface KeyStatus { state: KeyStatusState; lastChecked?: number; lastError?: string }

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getPosition(): WizardPosition | null {
  return readJson<WizardPosition>(POSITION_KEY);
}
export function setPosition(pos: WizardPosition): void {
  writeJson(POSITION_KEY, pos);
}

export function getDontAsk(): RuntimeSecretKey[] {
  return readJson<RuntimeSecretKey[]>(DONT_ASK_KEY) ?? [];
}
export function addDontAsk(key: RuntimeSecretKey): void {
  const set = new Set(getDontAsk());
  set.add(key);
  writeJson(DONT_ASK_KEY, [...set]);
}
export function removeDontAsk(key: RuntimeSecretKey): void {
  writeJson(DONT_ASK_KEY, getDontAsk().filter((k) => k !== key));
}

export function getSkipped(): RuntimeSecretKey[] {
  return readJson<RuntimeSecretKey[]>(SKIPPED_KEY) ?? [];
}
export function addSkipped(key: RuntimeSecretKey): void {
  const set = new Set(getSkipped());
  set.add(key);
  writeJson(SKIPPED_KEY, [...set]);
}
export function clearSkipped(): void {
  localStorage.removeItem(SKIPPED_KEY);
}

export function getKeyStatus(key: RuntimeSecretKey): KeyStatus | null {
  return readJson<KeyStatus>(STATUS_PREFIX + key);
}
export function setKeyStatus(key: RuntimeSecretKey, status: KeyStatus): void {
  writeJson(STATUS_PREFIX + key, status);
}

// Test helper. Clears all wizard-state entries.
export function resetWizardState(): void {
  localStorage.removeItem(POSITION_KEY);
  localStorage.removeItem(DONT_ASK_KEY);
  localStorage.removeItem(SKIPPED_KEY);
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k?.startsWith(STATUS_PREFIX)) localStorage.removeItem(k);
  }
}
