import type { RuntimeSecretKey } from './runtime-config';

const POSITION_KEY = 'cb:setup-wizard:position';
const DONT_ASK_KEY = 'cb:setup-wizard:dont-ask';
const SKIPPED_KEY = 'cb:setup-wizard:skipped';

export interface WizardPosition { tier: number; stepIndex: number }
function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Wizard progress is optional. */ }
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
  try { localStorage.removeItem(SKIPPED_KEY); } catch { /* Wizard progress is optional. */ }
}

// Test helper. Clears all wizard-state entries.
export function resetWizardState(): void {
  localStorage.removeItem(POSITION_KEY);
  localStorage.removeItem(DONT_ASK_KEY);
  localStorage.removeItem(SKIPPED_KEY);
}
