/**
 * Palette search — pure ranking + filtering for the ⌘K command palette.
 *
 * The existing CommandPalette had its scoring inline (one-line substring +
 * length). That's too coarse once we mix panels + saved places + recent
 * alerts + common actions, because longer labels always lose to shorter ones
 * even when the shorter one is barely a match.
 *
 * This module separates concerns:
 *   - Each PaletteItem carries a `weight` (source priority).
 *   - Scoring is a subsequence match with a prefix bonus and a contiguity
 *     bonus, then weighted by source weight.
 *   - Empty query falls back to weight-sorted then alphabetical.
 */

export type PaletteCategory =
  | 'panel'
  | 'place'
  | 'alert'
  | 'action'
  | 'preset';

export interface PaletteItem<T = unknown> {
  /** Stable id within its source ("panel:markets", "place:abc"). */
  id: string;
  /** Display label. */
  label: string;
  /** Group, shown as a faint header in the palette ("Panels", "Saved places"). */
  category: PaletteCategory;
  /** Right-side hint, typically a keyboard hint or short subtitle. */
  hint?: string;
  /**
   * Source priority. Higher weights bias ranking when scores are close.
   * Suggested: action=3, alert=2.5, panel=2, place=2, preset=1.
   */
  weight: number;
  /** Optional payload for the caller's run handler. */
  data?: T;
}

export interface RankedItem<T = unknown> {
  item: PaletteItem<T>;
  score: number;
}

const PREFIX_BONUS = 12;
const WORD_BOUNDARY_BONUS = 6;
const CONTIGUITY_BONUS = 2;
const PER_GAP_PENALTY = 0.5;
const NO_MATCH = -Infinity;

/**
 * Subsequence-match score in [0, ∞). Higher is better. Returns NO_MATCH if
 * `query` is not a subsequence of `haystack`.
 *
 * Bonuses:
 * - Matching at index 0 (prefix) +PREFIX_BONUS
 * - Matching at a word-boundary (preceded by space/punct) +WORD_BOUNDARY_BONUS
 * - Each consecutive match in haystack +CONTIGUITY_BONUS
 * - Each gap inside the matched span -PER_GAP_PENALTY
 */
function bonusForMatch(h: string, hi: number, qi: number): number {
  if (hi === 0 && qi === 0) return PREFIX_BONUS;
  if (qi === 0 && isWordBoundary(h, hi)) return WORD_BOUNDARY_BONUS;
  return 0;
}

function contiguityAdjustment(hi: number, lastMatch: number): number {
  if (lastMatch === hi - 1) return CONTIGUITY_BONUS;
  if (lastMatch >= 0) return -PER_GAP_PENALTY * (hi - lastMatch - 1);
  return 0;
}

export function scoreMatch(haystack: string, query: string): number {
  if (!query) return 0;
  const h = haystack.toLowerCase();
  const q = query.toLowerCase();
  let hi = 0;
  let qi = 0;
  let score = 0;
  let lastMatch = -2;
  while (hi < h.length && qi < q.length) {
    if (h[hi] === q[qi]) {
      score += bonusForMatch(h, hi, qi) + contiguityAdjustment(hi, lastMatch);
      lastMatch = hi;
      qi += 1;
    }
    hi += 1;
  }
  if (qi < q.length) return NO_MATCH;
  return score;
}

function isWordBoundary(s: string, i: number): boolean {
  if (i === 0) return true;
  const prev = s[i - 1] ?? '';
  return /[\s\-_/.,:()[\]]/.test(prev);
}

/**
 * Filter and rank items against a query. Multi-word queries (`fire alert`)
 * AND the words together — each word must match somewhere in
 * `label + " " + hint + " " + category`.
 *
 * Empty query: returns items sorted by weight desc then label asc.
 */
export function rankPalette<T>(items: readonly PaletteItem<T>[], query: string, limit = 12): RankedItem<T>[] {
  const q = query.trim();
  if (!q) {
    return [...items]
      .sort((a, b) => (b.weight - a.weight) || a.label.localeCompare(b.label))
      .slice(0, limit)
      .map(item => ({ item, score: 0 }));
  }
  const words = q.split(/\s+/);
  const scored: RankedItem<T>[] = [];
  for (const item of items) {
    const hay = `${item.label} ${item.hint ?? ''} ${item.category}`;
    let total = 0;
    let allMatched = true;
    for (const w of words) {
      const s = scoreMatch(hay, w);
      if (s === NO_MATCH) { allMatched = false; break; }
      total += s;
    }
    if (!allMatched) continue;
    // Weight-bias: each unit of weight adds 1 to the score, so a high-weight
    // item barely matches still beats a low-weight one with the same raw score.
    total += item.weight;
    scored.push({ item, score: total });
  }
  scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
  return scored.slice(0, limit);
}

/**
 * Group ranked items by category in the order they first appear. Used by the
 * palette UI to draw section headers between groups.
 */
export function groupByCategory<T>(ranked: readonly RankedItem<T>[]): Map<PaletteCategory, RankedItem<T>[]> {
  const out = new Map<PaletteCategory, RankedItem<T>[]>();
  for (const r of ranked) {
    const arr = out.get(r.item.category) ?? [];
    arr.push(r);
    out.set(r.item.category, arr);
  }
  return out;
}

export const CATEGORY_LABELS: Record<PaletteCategory, string> = {
  action: 'Actions',
  alert: 'Recent alerts',
  panel: 'Panels',
  place: 'Saved places',
  preset: 'Presets',
};

export const CATEGORY_WEIGHTS: Record<PaletteCategory, number> = {
  action: 3,
  alert: 2.5,
  panel: 2,
  place: 2,
  preset: 1,
};
