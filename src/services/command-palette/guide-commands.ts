/**
 * ⌘K commands for survival guides: "Guide: Tornado" etc. Selecting one emits
 * cb:open-survival-guide, which the SurvivalGuidePanel handles (select + front).
 */

import type { CommandRegistry, PaletteCommand } from './command-registry';
import { allGuides } from '@/services/survival-guide/guide-library';

export function buildGuideCommands(dispatch: (name: string, detail?: unknown) => void): PaletteCommand[] {
  return allGuides().map((g) => ({
    id: `guide:${g.id}`,
    title: `Guide: ${g.title}`,
    subtitle: g.kind === 'hazard' ? 'survival guide' : 'preparedness guide',
    keywords: [g.title.toLowerCase(), 'guide', 'survival', 'preparedness', 'emergency', g.id],
    category: 'navigation',
    icon: '🧭',
    weight: 0,
    action: () => dispatch('cb:open-survival-guide', { guideId: g.id }),
  }));
}

/** Registers all guide commands once. Returns an uninstall thunk. */
export function installGuideCommands(
  registry: CommandRegistry,
  dispatch: (name: string, detail?: unknown) => void,
): () => void {
  const cmds = buildGuideCommands(dispatch);
  for (const c of cmds) registry.register(c);
  return () => {
    for (const c of cmds) registry.unregister(c.id);
  };
}
