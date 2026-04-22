/**
 * Action Memory / Playbooks — records what the user does after a
 * hypothesis appears, and surfaces "last time this pattern appeared,
 * you did X, Y, Z" as a playbook on recurrence.
 *
 * Actions tracked (via explicit recordAction() calls from the HUD):
 *   - 'panel-jump'    user clicked an evidence chip → panel
 *   - 'thumbs-up'     user voted useful
 *   - 'thumbs-down'   user voted noise
 *   - 'dismiss'       user dismissed the hypothesis
 *   - 'export'        user exported a brief while viewing
 *
 * Per-signature log (capped at 50 entries) persisted in the IDB
 * reasoning_memory store. `getPlaybookFor()` returns a compact
 * summary used by the HUD.
 */

import type { Hypothesis } from './analyst-loop';
import { signatureFor } from './hypothesis-feedback';
import { getMemory, putMemory } from './reasoning-memory';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActionKind = 'panel-jump' | 'thumbs-up' | 'thumbs-down' | 'dismiss' | 'export';

/** Narrow alias that captures "hypothesis-shaped" inputs for the signatureFor call. */
export type HypothesisRef = Pick<Hypothesis, 'kind' | 'evidence' | 'region'>;

export interface ActionRecord {
  kind: ActionKind;
  timestamp: number;
  /** Context: panel id for panel-jump, brief id for export, etc. */
  detail?: string;
}

export interface Playbook {
  signature: string;
  actions: ActionRecord[];
  lastRecurrence: number;
  recurrenceCount: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-action-memory-v1';
const MAX_ACTIONS_PER_SIG = 50;
const EVENT_NAME = 'cb:action-recorded';

// ── State ─────────────────────────────────────────────────────────────────────

const playbooks = new Map<string, Playbook>();
let loaded = false;
let writtenSinceLoad = false;

function applyLoaded(arr: Playbook[] | null): void {
  if (!arr) return;
  for (const p of arr) playbooks.set(p.signature, p);
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyLoaded(JSON.parse(raw) as Playbook[]);
  } catch { /* ignore */ }
  void getMemory<Playbook[]>(STORAGE_KEY).then(arr => {
    if (writtenSinceLoad) return;
    applyLoaded(arr);
  });
}

function save(): void {
  writtenSinceLoad = true;
  const arr = [...playbooks.values()];
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); } catch { /* quota */ }
  void putMemory(STORAGE_KEY, arr);
}

// ── Public write API ─────────────────────────────────────────────────────────

/**
 * Record an action taken by the user in the context of a specific hypothesis.
 * Called by the HUD from its click/action handlers.
 */
export function recordAction(
  hypothesis: HypothesisRef,
  kind: ActionKind,
  detail?: string,
): void {
  load();
  const sig = signatureFor(hypothesis);
  const existing = playbooks.get(sig);
  const record: ActionRecord = { kind, timestamp: Date.now(), detail };
  if (existing) {
    existing.actions.push(record);
    if (existing.actions.length > MAX_ACTIONS_PER_SIG) {
      existing.actions.splice(0, existing.actions.length - MAX_ACTIONS_PER_SIG);
    }
    playbooks.set(sig, existing);
  } else {
    playbooks.set(sig, {
      signature: sig,
      actions: [record],
      lastRecurrence: Date.now(),
      recurrenceCount: 1,
    });
  }
  save();
  document.dispatchEvent(new CustomEvent<{ signature: string; kind: ActionKind }>(EVENT_NAME, {
    detail: { signature: sig, kind },
  }));
}

/** Mark that a hypothesis has recurred (signature seen again). Called by HUD. */
export function noteRecurrence(hypothesis: HypothesisRef): void {
  load();
  const sig = signatureFor(hypothesis);
  const existing = playbooks.get(sig);
  if (!existing) return;
  existing.lastRecurrence = Date.now();
  existing.recurrenceCount += 1;
  playbooks.set(sig, existing);
  save();
}

// ── Public read API ──────────────────────────────────────────────────────────

/**
 * Return a compact playbook summary for a hypothesis, or null if there's
 * no prior history for its signature.
 */
export function getPlaybookFor(hypothesis: HypothesisRef): Playbook | null {
  load();
  return playbooks.get(signatureFor(hypothesis)) ?? null;
}

const ACTION_LABEL: Record<Exclude<ActionKind, 'panel-jump'>, string> = {
  'thumbs-up': 'voted useful',
  'thumbs-down': 'voted noise',
  dismiss: 'dismissed',
  export: 'exported brief',
};

function labelForAction(a: ActionRecord): string {
  if (a.kind === 'panel-jump') return `opened ${a.detail ?? 'a panel'}`;
  return ACTION_LABEL[a.kind];
}

function formatCountEntry(label: string, n: number): string {
  return n > 1 ? `${label} (${n}×)` : label;
}

/**
 * Build a one-line human-readable summary of the most common past actions.
 * Returns e.g. "Last time: opened situation-awareness, voted useful (3×)."
 */
export function summarizePlaybook(book: Playbook): string {
  const counts = new Map<string, number>();
  // Look at most recent 10 actions for recency bias.
  for (const a of book.actions.slice(-10)) {
    const label = labelForAction(a);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const parts = sorted.map(([label, n]) => formatCountEntry(label, n));
  const header = book.recurrenceCount > 1
    ? `Seen ${book.recurrenceCount}×. Last time: `
    : 'Last time: ';
  return header + parts.join(', ') + '.';
}

/** Expose raw playbooks for debug / export. */
export function getAllPlaybooks(): Playbook[] {
  load();
  return [...playbooks.values()];
}

export function resetActionMemory(): void {
  playbooks.clear();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  void putMemory(STORAGE_KEY, []);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let started = false;
export function startActionMemory(): void {
  if (started) return;
  started = true;
  load();
}
