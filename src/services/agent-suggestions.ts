/**
 * Agent suggestions - pending hypothesis feedback from external agents
 * (R4-SEC-004).
 *
 * MCP tools let an outside agent thumbs-up, thumbs-down or dismiss a
 * hypothesis. That agent reads feed text anyone can publish, so an injected
 * instruction could bury a real threat or skew calibration. Its feedback
 * therefore never reaches the feedback stats or the dismissed set directly:
 * it waits here until the user confirms or discards it in the Analyst HUD.
 *
 * The store is bounded (50 items, 7-day expiry), persisted in localStorage,
 * and validated on load. Text from the agent is cleaned of invisible and
 * control characters and length-capped; the HUD renders it as text only.
 */

export type AgentSuggestionKind = 'thumbs_up' | 'thumbs_down' | 'dismiss';

export interface AgentSuggestion {
  /** Sidecar command id. */
  id: string;
  kind: AgentSuggestionKind;
  /** Feedback signature of the matched hypothesis, computed locally. */
  signature: string;
  hypothesisId: string;
  /** The matched hypothesis's statement at the time the agent suggested. */
  statement: string;
  /** Free text from the agent: untrusted. */
  note: string | null;
  issuedAt: number;
  receivedAt: number;
}

export type AgentSuggestionInput = Omit<AgentSuggestion, 'receivedAt'>;

export const AGENT_SUGGESTION_KINDS: readonly AgentSuggestionKind[] = ['thumbs_up', 'thumbs_down', 'dismiss'];
export const AGENT_SUGGESTIONS_STORAGE_KEY = 'crystalball-agent-suggestions-v1';
export const AGENT_SUGGESTIONS_MAX = 50;
export const AGENT_SUGGESTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_ID = 128;
const MAX_SIGNATURE = 512;
const MAX_STATEMENT = 300;
const MAX_NOTE = 400;

// Control and format characters (zero-width, bidi overrides, Unicode tags),
// lone surrogates and other invisible fillers. Newlines and tabs become
// spaces: the HUD shows each field on one line.
const INVISIBLE =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]|\u034F|\u115F|\u1160|\u17B4|\u17B5|[\u180B-\u180F]|\u3164|\uFFA0|[\uFE00-\uFE0F]|[\u{E0100}-\u{E01EF}]/gu;

/** Remove invisible characters, collapse whitespace, cap the length. */
export function cleanAgentText(value: string, max: number): string {
  return value
    .replace(/[\t\n\r\u2028\u2029]+/gu, ' ')
    .replace(INVISIBLE, '')
    .replace(/ {2,}/gu, ' ')
    .trim()
    .slice(0, max);
}

function isKind(value: unknown): value is AgentSuggestionKind {
  return typeof value === 'string' && (AGENT_SUGGESTION_KINDS as readonly string[]).includes(value);
}

function isFiniteTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Validate and clean one suggestion; null when it cannot be trusted as shaped. */
export function normalizeAgentSuggestion(raw: unknown): AgentSuggestion | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isKind(r.kind)) return null;
  if (typeof r.id !== 'string' || typeof r.signature !== 'string' || typeof r.hypothesisId !== 'string') return null;
  if (typeof r.statement !== 'string') return null;
  if (r.note !== null && r.note !== undefined && typeof r.note !== 'string') return null;
  if (!isFiniteTime(r.issuedAt) || !isFiniteTime(r.receivedAt)) return null;
  const id = cleanAgentText(r.id, MAX_ID);
  // The signature is a lookup key, not display text: reject rather than alter it.
  if (!id || !r.signature || r.signature.length > MAX_SIGNATURE) return null;
  const note = typeof r.note === 'string' ? cleanAgentText(r.note, MAX_NOTE) : '';
  return {
    id,
    kind: r.kind,
    signature: r.signature,
    hypothesisId: cleanAgentText(r.hypothesisId, MAX_ID),
    statement: cleanAgentText(r.statement, MAX_STATEMENT),
    note: note || null,
    issuedAt: r.issuedAt,
    receivedAt: r.receivedAt,
  };
}

let items: AgentSuggestion[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(AGENT_SUGGESTIONS_STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    items = parsed
      .map((entry) => normalizeAgentSuggestion(entry))
      .filter((s): s is AgentSuggestion => s !== null)
      .slice(-AGENT_SUGGESTIONS_MAX);
  } catch {
    items = [];
  }
}

function save(): void {
  try {
    localStorage.setItem(AGENT_SUGGESTIONS_STORAGE_KEY, JSON.stringify(items));
  } catch { /* quota or private mode: the in-memory list still works */ }
}

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* a broken subscriber must not block the rest */ }
  }
}

/** Drop expired items. Returns true when anything was removed. */
function prune(now: number): boolean {
  const before = items.length;
  items = items.filter((s) => now - s.receivedAt < AGENT_SUGGESTION_TTL_MS);
  return items.length !== before;
}

/**
 * Hold an agent's suggestion for confirmation. A newer suggestion of the same
 * kind for the same hypothesis signature replaces the older one; past the cap
 * the oldest is dropped.
 */
export function queueAgentSuggestion(input: AgentSuggestionInput, now = Date.now()): AgentSuggestion | null {
  load();
  const suggestion = normalizeAgentSuggestion({ ...input, receivedAt: now });
  if (!suggestion) return null;
  prune(now);
  items = items.filter((s) => s.id !== suggestion.id
    && !(s.kind === suggestion.kind && s.signature === suggestion.signature));
  items.push(suggestion);
  if (items.length > AGENT_SUGGESTIONS_MAX) items = items.slice(-AGENT_SUGGESTIONS_MAX);
  save();
  notify();
  return suggestion;
}

/** Pending suggestions, newest first. */
export function listAgentSuggestions(now = Date.now()): AgentSuggestion[] {
  load();
  if (prune(now)) save();
  return [...items].reverse();
}

/** Remove and return a pending, unexpired suggestion (for Confirm). */
export function takeAgentSuggestion(id: string, now = Date.now()): AgentSuggestion | null {
  load();
  const expired = prune(now);
  const found = items.find((s) => s.id === id) ?? null;
  if (found) items = items.filter((s) => s !== found);
  if (found || expired) {
    save();
    notify();
  }
  return found;
}

/** Drop a pending suggestion without applying it. */
export function discardAgentSuggestion(id: string, now = Date.now()): boolean {
  return takeAgentSuggestion(id, now) !== null;
}

export function subscribeAgentSuggestions(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test-only: forget in-memory state so the next call reloads storage. */
export function _resetAgentSuggestionsForTests(): void {
  items = [];
  loaded = false;
  listeners.clear();
}
