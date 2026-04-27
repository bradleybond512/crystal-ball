import { matchesShape, hasShape } from './key-shape-registry';
import { isDesktopRuntime } from './runtime';
import { invokeTauri } from './tauri-bridge';
import type { RuntimeSecretKey } from './runtime-config';

let pollHandle: number | null = null;
let lastSeen = '';
let activeKey: RuntimeSecretKey | null = null;
let onMatch: ((value: string) => void) | null = null;
// Tracks every clipboard value we've already auto-filled (across keys/steps).
// Once a value has been used by the wizard, we don't re-fire on it again — the
// user has to copy something new. Prevents the same key getting auto-filled
// into multiple subsequent inputs whose shapes accidentally match.
const consumedValues = new Set<string>();
const POLL_MS = 500;

export function startWatching(key: RuntimeSecretKey, callback: (value: string) => void): void {
  if (!isDesktopRuntime()) return;
  if (!hasShape(key)) return;
  stopWatching();
  activeKey = key;
  onMatch = callback;
  // Don't reset lastSeen — keep it as the last clipboard content observed by the
  // poller. That way, if the clipboard hasn't changed since the previous step, we
  // skip immediately on the next tick instead of firing again.
  pollHandle = window.setInterval(poll, POLL_MS);
}

export function stopWatching(): void {
  if (pollHandle !== null) { clearInterval(pollHandle); pollHandle = null; }
  activeKey = null;
  onMatch = null;
}

/** Mark a value as consumed so we never re-fire on it. Call when the user clicks
 *  Save (or otherwise commits the auto-filled value). */
export function markConsumed(value: string): void {
  if (value) consumedValues.add(value);
}

/** Test helper — clear all consumed-value memory. */
export function resetClipboardWatcher(): void {
  stopWatching();
  consumedValues.clear();
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
  if (consumedValues.has(text.trim())) return;
  if (matchesShape(activeKey, text)) onMatch(text.trim());
}
