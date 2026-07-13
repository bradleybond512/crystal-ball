/**
 * Bootstrap glue between the pure shortcut registry and the live DOM.
 *
 * Owns three responsibilities:
 *   1. Register the shipped shortcuts (⌘K, ⌘/, ⌘1…⌘9) into the registry.
 *   2. Attach a single document keydown listener that dispatches via the
 *      registry (so the matching/suppression rules are centralized).
 *   3. Refresh ⌘1…⌘9 panel hint badges in the sidebar whenever the panel
 *      list changes (initial render + reorder + variant switch).
 *
 * Kept thin: this is glue, not logic. All logic lives in shortcut-registry.ts.
 */

import {
  createShortcutRegistry,
  parseChord,
  buildPanelFocusBindings,
  type ShortcutRegistry,
} from './shortcut-registry';
import { isHomeShellDefaultOn } from '@/services/home-shell/shell-gate';

const HINT_CLASS = 'mac-sidebar-panel-hint';
const SIDEBAR_SELECTOR = '.mac-sidebar-panel-item[data-panel-key]';

let activeRegistry: ShortcutRegistry | null = null;
let activeListener: ((e: KeyboardEvent) => void) | null = null;

export interface BootstrapHandles {
  registry: ShortcutRegistry;
  refreshPanelHints: () => void;
  destroy: () => void;
}

/**
 * Install the global shortcut handlers. Returns handles for tests / hot reload.
 * Safe to call multiple times — previous registration is torn down first.
 */
export function installShortcuts(): BootstrapHandles {
  // Tear down any previous installation.
  if (activeListener) {
    document.removeEventListener('keydown', activeListener);
    activeListener = null;
  }

  const reg = createShortcutRegistry();
  activeRegistry = reg;

  reg.register({
    id: 'cmd-k',
    label: 'Open command palette',
    group: 'Navigation',
    display: '⌘K',
    chord: parseChord('Cmd+K'),
    run: () => document.dispatchEvent(new CustomEvent('cb:toggle-cmdk')),
  });
  reg.register({
    id: 'cmd-slash',
    label: 'Show keyboard shortcuts',
    group: 'Help',
    display: '⌘/',
    chord: parseChord('Cmd+/'),
    run: () => document.dispatchEvent(new CustomEvent('cb:toggle-help')),
  });
  // Registers whenever the shell can appear per the gate — avoids swallowing
  // Ctrl+Shift+O in web builds and a phantom help-overlay entry on variants/
  // viewports where the shell never boots (see shell-gate.ts).
  if (isHomeShellDefaultOn()) {
    reg.register({
      id: 'cmd-shift-o',
      label: 'Toggle Home Shell',
      group: 'Navigation',
      display: '⌘⇧O',
      chord: parseChord('Cmd+Shift+O'),
      run: () => document.dispatchEvent(new CustomEvent('cb:toggle-home-shell')),
    });
  }

  // ⌘1…⌘9 — bound to the *current* sidebar order at registration time, and
  // re-bound whenever refreshPanelHints() runs (so reorders take effect).
  const refreshPanelHints = () => {
    const keys = readPanelKeysFromSidebar();
    // Wipe any previously registered panel-focus-* bindings.
    for (const b of reg.list()) {
      if (b.id.startsWith('panel-focus-')) reg.unregister(b.id);
    }
    const bindings = buildPanelFocusBindings(keys, (key) => {
      // Route through cb:navigate-panel → navigateToPanel (lazy-mounts + always
      // gives visible feedback) instead of the silent jumpToPanel/flashPanel,
      // which no-op on unmounted/disabled panels — the cause of "dead" ⌘-number
      // keys while sidebar clicks worked (Defect B2).
      document.dispatchEvent(new CustomEvent('cb:navigate-panel', { detail: { panelKey: key } }));
    });
    for (const b of bindings) reg.register(b);
    paintHintBadges(keys.slice(0, 9));
  };

  refreshPanelHints();

  // Re-paint badges when the sidebar re-renders. We watch for child additions
  // / removals on the sidebar panel list; debounce via rAF so a batch of
  // mutations only triggers one repaint.
  //
  // refreshPanelHints() → paintHintBadges() removes and re-appends badge <span>s
  // INSIDE this observed subtree. With the observer still attached, those self-
  // inflicted mutations retrigger onMutate → rAF → repaint → mutate … a runaway
  // feedback loop that repainted the badges every frame and pinned the whole
  // WebKit rendering pipeline at ~60fps on an idle dashboard. Disconnect while
  // we mutate, then re-observe, so only genuine sidebar changes (panel add /
  // remove / reorder) schedule a repaint.
  const OBSERVE_OPTS: MutationObserverInit = { childList: true, subtree: true };
  const observers: { obs: MutationObserver; target: Node }[] = [];
  const observeAll = (): void => {
    for (const { obs, target } of observers) obs.observe(target, OBSERVE_OPTS);
  };
  let scheduled = false;
  const onMutate = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      for (const { obs } of observers) obs.disconnect();
      refreshPanelHints();
      observeAll();
    });
  };
  for (const list of document.querySelectorAll('.mac-sidebar-panels, .mac-sidebar-panel-list, aside.mac-sidebar, #sidebar, .mac-sidebar')) {
    observers.push({ obs: new MutationObserver(onMutate), target: list });
  }
  observeAll();

  const listener = (e: KeyboardEvent) => {
    const matched = reg.dispatch({
      key: e.key,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      target: e.target,
    });
    if (matched) e.preventDefault();
  };
  document.addEventListener('keydown', listener);
  activeListener = listener;

  return {
    registry: reg,
    refreshPanelHints,
    destroy: () => {
      document.removeEventListener('keydown', listener);
      for (const { obs } of observers) obs.disconnect();
      if (activeRegistry === reg) activeRegistry = null;
      if (activeListener === listener) activeListener = null;
    },
  };
}

export function getActiveRegistry(): ShortcutRegistry | null {
  return activeRegistry;
}

function readPanelKeysFromSidebar(): string[] {
  const out: string[] = [];
  document.querySelectorAll<HTMLElement>(SIDEBAR_SELECTOR).forEach(el => {
    const key = el.dataset.panelKey;
    if (key) out.push(key);
  });
  return out;
}

function paintHintBadges(firstNineKeys: readonly string[]): void {
  // Clear existing badges first.
  document.querySelectorAll(`.${HINT_CLASS}`).forEach(el => el.remove());
  firstNineKeys.forEach((key, i) => {
    const el = document.querySelector<HTMLElement>(`.mac-sidebar-panel-item[data-panel-key="${CSS.escape(key)}"]`);
    if (!el) return;
    const badge = document.createElement('span');
    badge.className = HINT_CLASS;
    badge.textContent = `⌘${i + 1}`;
    el.append(badge);
  });
}
