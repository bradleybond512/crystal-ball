import { matchesShape, hasShape } from './key-shape-registry';
import { isDesktopRuntime } from './runtime';
import { invokeTauri } from './tauri-bridge';
import type { RuntimeSecretKey } from './runtime-config';

let pollHandle: number | null = null;
let lastSeen = '';
let activeKey: RuntimeSecretKey | null = null;
let onMatch: ((value: string) => void) | null = null;
const POLL_MS = 500;

export function startWatching(key: RuntimeSecretKey, callback: (value: string) => void): void {
  if (!isDesktopRuntime()) return;
  if (!hasShape(key)) return;
  stopWatching();
  activeKey = key;
  onMatch = callback;
  lastSeen = '';
  pollHandle = window.setInterval(poll, POLL_MS);
}

export function stopWatching(): void {
  if (pollHandle !== null) { clearInterval(pollHandle); pollHandle = null; }
  activeKey = null;
  onMatch = null;
  lastSeen = '';
}

async function poll(): Promise<void> {
  if (!activeKey || !onMatch) return;
  let text: string;
  try {
    text = await invokeTauri<string>('plugin:clipboard-manager|read_text');
  } catch {
    return;
  }
  if (!text || text === lastSeen) return;
  lastSeen = text;
  if (matchesShape(activeKey, text)) onMatch(text.trim());
}
