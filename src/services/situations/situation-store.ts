/**
 * Situation store — singleton + pure registry for high-impact
 * situations across military, cyber, weather, and compound domains.
 *
 * Phase 1 of docs/CLAUDE_HIGH_IMPACT_EVENT_INTELLIGENCE_VISION_2026-04-29.md.
 *
 * Design:
 *   - Adapters call `upsertSituation(s)` to add or update a situation
 *     identified by `s.id`. The store keeps `firstSeen` stable across
 *     updates and refreshes `lastUpdated`.
 *   - `getRankedSituations(n)` returns the top N sorted by composite
 *     ranking (severity × confidence + urgency + userExposure).
 *   - `getActiveSituations()` returns everything not in `resolved`.
 *   - `markResolved(id, verdict, notes)` ends a situation and writes
 *     the after-action verdict — used by Phase 6.
 *   - All operations are sync; listeners run on demand.
 *
 * No DOM, no fetch, no globals at import time.
 */

import { rankingScore, type Situation, type PredictionOutcome } from './situation-types';

// ── Public API ──────────────────────────────────────────────────────────

export interface SituationStore {
  /** Insert or update a situation. Preserves firstSeen and merges the
   *  timeline + whatChanged across calls. Returns the stored copy. */
  upsert: (situation: Situation) => Situation;
  /** Read one. */
  get: (id: string) => Situation | undefined;
  /** Active situations (not resolved). */
  active: () => Situation[];
  /** Top N sorted by composite ranking. */
  ranked: (limit?: number) => Situation[];
  /** Mark a situation resolved with a verdict. */
  markResolved: (id: string, verdict: PredictionOutcome['verdict'], notes?: string) => Situation | undefined;
  /** Remove all situations. Tests + storybook only. */
  reset: () => void;
  /** Subscribe to change events. Returns an unsubscribe handle. */
  subscribe: (listener: SituationListener) => () => void;
  /** Snapshot for the diagnostics export bundle / agent handoff. */
  toJson: () => readonly Situation[];
}

export type SituationListener = (situations: readonly Situation[]) => void;

// ── Implementation ──────────────────────────────────────────────────────

interface CreateOptions {
  now?: () => number;
}

export function createSituationStore(options: CreateOptions = {}): SituationStore {
  const now = options.now ?? (() => Date.now());
  const items = new Map<string, Situation>();
  const listeners = new Set<SituationListener>();

  function snapshot(): readonly Situation[] {
    return [...items.values()];
  }

  function notify(): void {
    if (listeners.size === 0) return;
    const snap = snapshot();
    for (const fn of listeners) {
      try {
        fn(snap);
      } catch {
        // Listeners must not break the store.
      }
    }
  }

  return {
    upsert(situation) {
      const existing = items.get(situation.id);
      const merged: Situation = existing
        ? {
            ...situation,
            firstSeen: existing.firstSeen,
            lastUpdated: now(),
            // Append-only timeline: keep prior entries that aren't in
            // the incoming list (matched by ts + text).
            timeline: mergeTimeline(existing.timeline, situation.timeline),
          }
        : {
            ...situation,
            firstSeen: situation.firstSeen || now(),
            lastUpdated: situation.lastUpdated || now(),
          };
      items.set(merged.id, merged);
      notify();
      return merged;
    },

    get(id) {
      return items.get(id);
    },

    active() {
      return [...items.values()].filter((s) => s.phase !== 'resolved');
    },

    ranked(limit) {
      const out = [...items.values()]
        .filter((s) => s.phase !== 'resolved')
        .sort((a, b) => {
          const diff = rankingScore(b) - rankingScore(a);
          if (Math.abs(diff) > 1e-9) return diff;
          // Stable tiebreaker: most recent first, then id ascending.
          if (b.lastUpdated !== a.lastUpdated) return b.lastUpdated - a.lastUpdated;
          return a.id.localeCompare(b.id);
        });
      return typeof limit === 'number' ? out.slice(0, limit) : out;
    },

    markResolved(id, verdict, notes) {
      const existing = items.get(id);
      if (!existing) return undefined;
      const resolved: Situation = {
        ...existing,
        phase: 'resolved',
        lastUpdated: now(),
        predictionOutcome: {
          ...existing.predictionOutcome,
          resolvedAt: now(),
          verdict,
          notes,
        },
      };
      items.set(id, resolved);
      notify();
      return resolved;
    },

    reset() {
      items.clear();
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    toJson() {
      return snapshot();
    },
  };
}

function mergeTimeline(
  existing: readonly { ts: number; text: string; source?: string }[],
  incoming: readonly { ts: number; text: string; source?: string }[],
): readonly { ts: number; text: string; source?: string }[] {
  const seen = new Set<string>();
  const out: { ts: number; text: string; source?: string }[] = [];
  for (const e of [...existing, ...incoming]) {
    const key = `${e.ts}|${e.text}|${e.source ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// ── Singleton accessor ──────────────────────────────────────────────────

let singleton: SituationStore | undefined;

export function getSituationStore(): SituationStore {
  singleton ??= createSituationStore();
  return singleton;
}

/** Reset the singleton. Tests + storybook only. */
export function resetSituationStoreForTests(): void {
  singleton = undefined;
}
