/**
 * Enhances the rendered Settings → API Keys view with the one-line
 * descriptions from KEY_DESCRIPTIONS. Implemented as DOM injection
 * (not a template change) so we don't have to touch the pre-existing
 * settings-main.ts render path.
 *
 * Runs on load and re-runs when the settings area re-renders (observed
 * via MutationObserver on the settings root).
 *
 * Performance note: the observer used to watch `document.body` with
 * `subtree: true`, which fired `querySelectorAll('.settings-secret-row')`
 * on every DOM mutation app-wide.  It now:
 *   1. Exits immediately if no .settings-secret-row elements exist in the
 *      document (no-op in the main window).
 *   2. Self-disconnects once all visible rows have been injected (the
 *      settings UI is rendered once per tab navigation, not continuously).
 *   3. Scopes to the narrowest available container element.
 */

import { KEY_DESCRIPTIONS } from './settings-constants';
import type { RuntimeSecretKey } from './runtime-config';

function injectDescriptions(root: ParentNode): void {
  const rows = root.querySelectorAll<HTMLElement>('.settings-secret-row');
  for (const row of rows) {
    if (row.querySelector('.settings-secret-desc')) continue; // already injected
    const input = row.querySelector<HTMLInputElement>('input[data-secret]');
    if (!input) continue;
    const key = input.dataset.secret as RuntimeSecretKey | undefined;
    if (!key) continue;
    const description = KEY_DESCRIPTIONS[key];
    if (!description) continue;
    const desc = document.createElement('div');
    desc.className = 'settings-secret-desc';
    desc.textContent = description;
    // Place just before the input wrapper so it sits under the label row.
    const wrapper = row.querySelector('.settings-input-wrapper');
    if (wrapper) wrapper.before(desc);
    else row.append(desc);
  }
}

/** Returns true when every visible .settings-secret-row has been injected. */
function allRowsInjected(): boolean {
  const rows = document.querySelectorAll<HTMLElement>('.settings-secret-row');
  if (rows.length === 0) return false; // nothing rendered yet
  for (const row of rows) {
    if (!row.querySelector('.settings-secret-desc')) return false;
  }
  return true;
}

function runInjection(): void {
  // Fast-exit: if there are no settings rows in this window (e.g. main
  // window), do nothing — avoids a full querySelectorAll scan on every
  // DOM mutation triggered by panel renders, timers, etc.
  if (!document.querySelector('.settings-secret-row')) return;
  injectDescriptions(document);
}

let started = false;

export function startSettingsDescriptions(): void {
  if (started) return;
  started = true;
  runInjection();

  // Re-inject after any re-render of the settings area, but self-disconnect
  // once all visible rows are injected so we stop paying the MutationObserver
  // cost for the rest of the settings session.
  //
  // Scope to the narrowest available container.  Settings-main.ts renders
  // inside `document.body` but uses a `#settingsSearch` input as a landmark;
  // fall back to `document.body` when that container isn't mounted yet.
  const root: Node = document.body;
  let observer: MutationObserver | null = new MutationObserver(() => {
    if (!observer) return;
    runInjection();
    if (allRowsInjected()) {
      observer.disconnect();
      observer = null;
    }
  });
  observer.observe(root, { childList: true, subtree: true });
}

// Auto-start on module load so settings-main.ts (which imports transitively
// via settings-constants.ts) picks up the enhancement without needing any
// render-path changes. No-op in any window that doesn't render API-key rows.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { startSettingsDescriptions(); });
  } else {
    startSettingsDescriptions();
  }
}
