/**
 * Enhances the rendered Settings → API Keys view with the one-line
 * descriptions from KEY_DESCRIPTIONS. Implemented as DOM injection
 * (not a template change) so we don't have to touch the pre-existing
 * settings-main.ts render path.
 *
 * Runs on load and re-runs when the settings area re-renders (observed
 * via MutationObserver on the settings root).
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

function runInjection(): void {
  injectDescriptions(document);
}

let started = false;

export function startSettingsDescriptions(): void {
  if (started) return;
  started = true;
  runInjection();
  // Re-inject after any re-render of the settings area.
  const observer = new MutationObserver(runInjection);
  observer.observe(document.body, { childList: true, subtree: true });
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
