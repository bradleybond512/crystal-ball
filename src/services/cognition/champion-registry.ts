/**
 * ACC-402 — Champion registry with one-call rollback.
 *
 * The single mutator for "which model is champion in a slot". The
 * promotion gate (`promotion-gate.ts`) only *recommends*; this registry
 * is where a recommendation becomes configuration — and where it can be
 * undone with one call. Consumers read `getActiveChampion(slot)`;
 * nothing flips implicitly.
 *
 * Discipline:
 *   - `promote()` REFUSES any decision whose recommendation is not
 *     'promote' — the gate cannot be bypassed through the registry.
 *   - `rollback()` restores the most recent previously-active model in
 *     the slot's history (one-click rollback, roadmap deliverable).
 *     Refuses when there is nothing earlier to return to.
 *   - Every activation keeps its evidence: promotions store the full
 *     PromotionDecision alongside the entry for audit.
 *   - History is capped per slot; the active entry is never trimmed.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Injectable
 * storage + clock. Persists under 'crystalball-champion-registry-v1'.
 */

import type { PromotionDecision } from './promotion-gate';

// ── Public types ──────────────────────────────────────────────────────

export type ActivationReason = 'initial' | 'promotion' | 'rollback';

export interface ChampionEntry {
  slot: string;
  modelId: string;
  version?: string;
  activatedAt: number;
  reason: ActivationReason;
  /** Present on promotions — the full gate evidence that justified it. */
  decision?: PromotionDecision;
}

export interface ChampionActionResult {
  ok: boolean;
  reason: string;
  active?: ChampionEntry;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface ChampionRegistryOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

export const CHAMPION_STORAGE_KEY = 'crystalball-champion-registry-v1';

/** Newest-last history per slot; the last entry is the active champion. */
const MAX_HISTORY_PER_SLOT = 20;

// ── Registry ─────────────────────────────────────────────────────────

export class ChampionRegistry {
  private history = new Map<string, ChampionEntry[]>();
  private storage: StorageLike | null;
  private clock: () => number;
  private hydrated = false;

  constructor(options: ChampionRegistryOptions = {}) {
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.clock = options.clock ?? (() => Date.now());
  }

  /** Seed a slot's first champion. Refuses when the slot already has one
   *  (promote/rollback are the only transitions after that). */
  setInitial(slot: string, modelId: string, version?: string): ChampionActionResult {
    this.ensureHydrated();
    if (this.history.get(slot)?.length) {
      return { ok: false, reason: `Slot '${slot}' already has a champion — use promote() or rollback().` };
    }
    const entry: ChampionEntry = {
      slot,
      modelId,
      ...(version === undefined ? {} : { version }),
      activatedAt: this.clock(),
      reason: 'initial',
    };
    this.pushEntry(slot, entry);
    return { ok: true, reason: `Initial champion '${modelId}' installed in slot '${slot}'.`, active: { ...entry } };
  }

  /** Activate a challenger. Refuses unless the decision's
   *  recommendation is 'promote' and names the same model. */
  promote(slot: string, decision: PromotionDecision): ChampionActionResult {
    this.ensureHydrated();
    if (decision.recommendation !== 'promote') {
      const failed = decision.gates.filter((g) => !g.pass).map((g) => g.id).join(', ');
      return { ok: false, reason: `Refused: gate recommendation is '${decision.recommendation}' (failing gates: ${failed || 'none listed'}).` };
    }
    const current = this.activeEntry(slot);
    if (current?.modelId === decision.challengerId) {
      return { ok: false, reason: `Refused: '${decision.challengerId}' is already the active champion of slot '${slot}'.` };
    }
    const entry: ChampionEntry = {
      slot,
      modelId: decision.challengerId,
      activatedAt: this.clock(),
      reason: 'promotion',
      decision,
    };
    this.pushEntry(slot, entry);
    return { ok: true, reason: `Promoted '${decision.challengerId}' over '${decision.incumbentId}' in slot '${slot}'.`, active: { ...entry } };
  }

  /** One-call rollback: reactivate the most recent previously-active
   *  model that differs from the current champion. */
  rollback(slot: string): ChampionActionResult {
    this.ensureHydrated();
    const entries = this.history.get(slot) ?? [];
    const current = entries[entries.length - 1];
    if (!current) {
      return { ok: false, reason: `Slot '${slot}' has no champion to roll back.` };
    }
    let previous: ChampionEntry | undefined;
    for (let i = entries.length - 2; i >= 0; i -= 1) {
      if (entries[i]!.modelId !== current.modelId) {
        previous = entries[i];
        break;
      }
    }
    if (!previous) {
      return { ok: false, reason: `Slot '${slot}' has no earlier champion to roll back to.` };
    }
    const entry: ChampionEntry = {
      slot,
      modelId: previous.modelId,
      ...(previous.version === undefined ? {} : { version: previous.version }),
      activatedAt: this.clock(),
      reason: 'rollback',
    };
    this.pushEntry(slot, entry);
    return { ok: true, reason: `Rolled slot '${slot}' back from '${current.modelId}' to '${previous.modelId}'.`, active: { ...entry } };
  }

  /** The active champion of a slot, or undefined when none installed. */
  getActiveChampion(slot: string): ChampionEntry | undefined {
    this.ensureHydrated();
    const active = this.activeEntry(slot);
    return active ? { ...active } : undefined;
  }

  /** Full activation history for a slot, oldest first. */
  getHistory(slot: string): ChampionEntry[] {
    this.ensureHydrated();
    return (this.history.get(slot) ?? []).map((e) => ({ ...e }));
  }

  /** Every slot with an installed champion. */
  getSlots(): string[] {
    this.ensureHydrated();
    return [...this.history.keys()].filter((slot) => (this.history.get(slot)?.length ?? 0) > 0);
  }

  /** Test seam — clears state + the persisted blob. */
  resetForTesting(): void {
    this.history.clear();
    this.hydrated = true;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(CHAMPION_STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ─────────────────────────────────────────────────────

  private activeEntry(slot: string): ChampionEntry | undefined {
    const entries = this.history.get(slot);
    return entries?.[entries.length - 1];
  }

  private pushEntry(slot: string, entry: ChampionEntry): void {
    const entries = this.history.get(slot) ?? [];
    entries.push(entry);
    if (entries.length > MAX_HISTORY_PER_SLOT) {
      entries.splice(0, entries.length - MAX_HISTORY_PER_SLOT);
    }
    this.history.set(slot, entries);
    this.persist();
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(CHAMPION_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, ChampionEntry[]> | null;
      if (!parsed || typeof parsed !== 'object') return;
      for (const [slot, entries] of Object.entries(parsed)) {
        if (!Array.isArray(entries)) continue;
        const valid = entries.filter(
          (e) => e && typeof e.modelId === 'string' && typeof e.activatedAt === 'number',
        );
        if (valid.length > 0) this.history.set(slot, valid.map((e) => ({ ...e })));
      }
    } catch {
      // corrupt — leave empty
    }
  }

  private persist(): void {
    if (!this.storage) return;
    const payload: Record<string, ChampionEntry[]> = {};
    for (const [slot, entries] of this.history) payload[slot] = entries;
    try { this.storage.setItem(CHAMPION_STORAGE_KEY, JSON.stringify(payload)); } catch { /* best effort */ }
  }
}

function defaultStorage(): StorageLike | null {
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let _singleton: ChampionRegistry | null = null;

export function getChampionRegistry(): ChampionRegistry {
  _singleton ??= new ChampionRegistry();
  return _singleton;
}

export function __resetChampionRegistrySingleton(): void {
  _singleton = null;
}
