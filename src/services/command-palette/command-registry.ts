/**
 * Command palette registry — Phase 2 keyboard-first navigation.
 *
 * Pure, testable command registry that backs the ⌘K palette. Commands are
 * registered with a stable id, a title, optional subtitle/icon, fuzzy-search
 * keywords, and an action thunk. Searching uses the same subsequence + prefix
 * + word-boundary scoring as `services/keyboard/palette-search` so the ranking
 * behavior stays consistent across the legacy and new palettes.
 */

import { scoreMatch } from '@/services/keyboard/palette-search';

export type PaletteCategory = 'panel' | 'action' | 'navigation' | 'search';

export interface PaletteCommand {
  /** Stable id ("panel:markets", "action:run-self-test", "search:alerts"). */
  id: string;
  /** Primary display label ("Open Markets", "Run Self-Test"). */
  title: string;
  /** Optional secondary line under the title. */
  subtitle?: string;
  /** Extra search terms beyond the title. Lowercased on register. */
  keywords: string[];
  /** Grouping bucket for the UI section headers. */
  category: PaletteCategory;
  /** Optional emoji or unicode glyph rendered before the title. */
  icon?: string;
  /** Additive rank bias. Negative demotes (e.g. system-tier panels). Default 0. */
  weight?: number;
  /** Run when the user picks the command. */
  action: () => void;
}

export interface CommandSearchResult {
  command: PaletteCommand;
  score: number;
}

export interface CommandRegistry {
  register(command: PaletteCommand): void;
  unregister(id: string): void;
  getAll(): PaletteCommand[];
  getByCategory(cat: PaletteCategory): PaletteCommand[];
  /** Fuzzy match against title + keywords + subtitle, ranked highest-first. */
  search(query: string, limit?: number): CommandSearchResult[];
  clear(): void;
}

const CATEGORY_WEIGHT: Record<PaletteCategory, number> = {
  action: 3,
  navigation: 2.5,
  panel: 2,
  search: 1,
};

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, PaletteCommand>();

  function normalize(cmd: PaletteCommand): PaletteCommand {
    return {
      ...cmd,
      keywords: cmd.keywords.map(k => k.toLowerCase().trim()).filter(Boolean),
    };
  }

  function rank(cmd: PaletteCommand, query: string): number {
    const q = query.trim();
    if (!q) return CATEGORY_WEIGHT[cmd.category] + (cmd.weight ?? 0);
    const titleScore = scoreMatch(cmd.title, q);
    const subtitleScore = cmd.subtitle ? scoreMatch(cmd.subtitle, q) : -Infinity;
    let keywordScore = -Infinity;
    for (const kw of cmd.keywords) {
      const s = scoreMatch(kw, q);
      if (s > keywordScore) keywordScore = s;
    }
    const best = Math.max(titleScore, subtitleScore, keywordScore);
    if (best === -Infinity) return -Infinity;
    // Bias by category so equally-ranked items prefer actions > navigation > panel > search,
    // plus any per-command weight (e.g. system-tier panels demoted below library panels).
    return best + CATEGORY_WEIGHT[cmd.category] + (cmd.weight ?? 0);
  }

  return {
    register(command) {
      commands.set(command.id, normalize(command));
    },
    unregister(id) {
      commands.delete(id);
    },
    getAll() {
      return [...commands.values()];
    },
    getByCategory(cat) {
      return [...commands.values()].filter(c => c.category === cat);
    },
    search(query, limit = 8) {
      const out: CommandSearchResult[] = [];
      for (const cmd of commands.values()) {
        const score = rank(cmd, query);
        if (score === -Infinity) continue;
        out.push({ command: cmd, score });
      }
      out.sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title));
      return out.slice(0, Math.max(0, limit));
    },
    clear() {
      commands.clear();
    },
  };
}

let singleton: CommandRegistry | null = null;

/** Process-wide registry. Reset via `resetCommandRegistry()` in tests. */
export function getCommandRegistry(): CommandRegistry {
  singleton ??= createCommandRegistry();
  return singleton;
}

export function resetCommandRegistry(): void {
  singleton = null;
}

export const PALETTE_CATEGORY_LABELS: Record<PaletteCategory, string> = {
  action: 'Actions',
  navigation: 'Navigate',
  panel: 'Panels',
  search: 'Search',
};

/** Category render order for the UI. */
export const PALETTE_CATEGORY_ORDER: PaletteCategory[] = ['navigation', 'panel', 'action', 'search'];
