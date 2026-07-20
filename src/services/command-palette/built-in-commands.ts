/**
 * Built-in command factory. Builds the standard set of palette commands from
 * the panel registry + a small library of hard-coded navigation/actions/search
 * shortcuts. Kept pure — callers register the returned commands themselves so
 * tests can inspect them without DOM side effects.
 */

import { DEFAULT_PANELS } from '@/config/panels';
import { PANEL_METADATA } from '@/config/panel-metadata';
import type { PaletteCommand } from './command-registry';

/**
 * Dispatchers default to `document.dispatchEvent` of a `CustomEvent`. Tests
 * pass a stub so they can assert which events would fire without touching
 * the global document.
 */
export interface BuiltinDeps {
  dispatch: (eventName: string, detail?: unknown) => void;
  /** Source of panel ids → display name pairs (defaults to DEFAULT_PANELS). */
  panels?: Record<string, { name: string }>;
}

const NAVIGATION_TARGETS: { id: string; title: string; keywords: string[]; icon?: string }[] = [
  { id: 'command-center', title: 'Go to Command Center', keywords: ['home', 'overview', 'dashboard'], icon: '◎' },
  { id: 'gods-vision',    title: 'Go to Globe',          keywords: ['globe', 'world', '3d', "god's eye"], icon: '◯' },
  { id: 'map',            title: 'Go to Map',            keywords: ['map', '2d', 'deck'], icon: '▦' },
  { id: 'intelligence-feed', title: 'Go to Intelligence Feed', keywords: ['intel', 'feed', 'news'], icon: '☰' },
];

const ACTION_COMMANDS: { id: string; title: string; event: string; keywords: string[]; icon?: string; subtitle?: string }[] = [
  { id: 'run-self-test', title: 'Run Self-Test', event: 'cb:run-self-test', keywords: ['diagnostic', 'health', 'check', 'probe'], icon: '✓', subtitle: 'Run the full system probe' },
  { id: 'export-diagnostic-bundle', title: 'Export Diagnostic Bundle', event: 'cb:export-diagnostic-bundle', keywords: ['diagnostic', 'bundle', 'download', 'support'], icon: '⤓' },
  { id: 'toggle-operator-mode', title: 'Toggle Operator Mode', event: 'cb:toggle-operator-mode', keywords: ['operator', 'shift', 'handoff'], icon: '◐' },
  { id: 'clear-notifications', title: 'Clear Notifications', event: 'cb:clear-notifications', keywords: ['clear', 'reset', 'notifications', 'inbox'], icon: '⌫' },
];

const SEARCH_COMMANDS: { id: string; title: string; scope: string; keywords: string[]; icon?: string }[] = [
  { id: 'search-alerts',     title: 'Search alerts…',     scope: 'alerts',     keywords: ['find', 'alert', 'search'],     icon: '⌕' },
  { id: 'search-situations', title: 'Search situations…', scope: 'situations', keywords: ['find', 'situation', 'cluster'], icon: '⌕' },
];

export function buildBuiltinCommands(deps: BuiltinDeps): PaletteCommand[] {
  const panels = deps.panels ?? DEFAULT_PANELS;
  const out: PaletteCommand[] = [];

  // ── Navigation (always first in the palette) ───────────────────────────────
  for (const nav of NAVIGATION_TARGETS) {
    out.push({
      id: `nav:${nav.id}`,
      title: nav.title,
      keywords: [...nav.keywords, 'go', 'navigate', 'open'],
      category: 'navigation',
      icon: nav.icon,
      action: () => deps.dispatch('cb:navigate-panel', { panelKey: nav.id }),
    });
  }

  out.push({
    id: 'navigation:library',
    title: 'Open Library',
    keywords: ['library', 'catalog', 'browse', 'panels', 'domains'],
    category: 'navigation',
    icon: '📚',
    action: () => deps.dispatch('cb:toggle-library'),
  });

  // ── One command per registered panel ──────────────────────────────────────
  for (const [panelKey, cfg] of Object.entries(panels)) {
    if (!cfg) continue;
    const meta = PANEL_METADATA[panelKey];
    out.push({
      id: `panel:${panelKey}`,
      title: `Open ${cfg.name}`,
      subtitle: panelKey,
      keywords: [
        ...new Set([
          panelKey.replace(/-/g, ' '),
          cfg.name.toLowerCase(),
          'panel',
          'open',
          ...(meta?.tags ?? []),
        ]),
      ],
      category: 'panel',
      icon: meta?.icon,
      weight: meta?.tier === 'system' ? -1.5 : 0,
      action: () => deps.dispatch('cb:navigate-panel', { panelKey }),
    });
  }

  // ── Common actions ────────────────────────────────────────────────────────
  for (const a of ACTION_COMMANDS) {
    out.push({
      id: `action:${a.id}`,
      title: a.title,
      subtitle: a.subtitle,
      keywords: a.keywords,
      category: 'action',
      icon: a.icon,
      action: () => deps.dispatch(a.event),
    });
  }

  // ── Search prefixes ───────────────────────────────────────────────────────
  for (const s of SEARCH_COMMANDS) {
    out.push({
      id: `search:${s.id}`,
      title: s.title,
      keywords: s.keywords,
      category: 'search',
      icon: s.icon,
      action: () => deps.dispatch('cb:palette-search-scope', { scope: s.scope }),
    });
  }

  return out;
}

/** Convenience: register the standard built-ins onto a registry. */
export function registerBuiltinCommands(
  registry: { register: (c: PaletteCommand) => void },
  deps?: Partial<BuiltinDeps>,
): void {
  const dispatch = deps?.dispatch ?? ((name, detail) => {
    document.dispatchEvent(new CustomEvent(name, detail === undefined ? undefined : { detail }));
  });
  for (const cmd of buildBuiltinCommands({ dispatch, panels: deps?.panels })) {
    registry.register(cmd);
  }
}
