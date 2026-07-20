/**
 * LLM Budget — per-day call caps and cost visibility for the reasoning
 * layer. `auto-brief`, `hypothesis-skeptic`, `hypothesis-projection`,
 * `question-suggester`, and the new multi-agent ensemble all route
 * through the llm-adapter, which now consults this service before
 * every call.
 *
 * Rules:
 *   - Each LLM call is classified as local / cloud-agent / cloud-chat.
 *   - We count cloud calls against a daily cap (default 50 / day).
 *   - Local calls are uncounted (no $$ cost, no network risk).
 *   - When the cap is hit, the adapter returns `{ provider: 'none' }`
 *     and the callers already handle that path (swallow + retry later).
 *   - The day rolls over at UTC midnight. Counters persist to localStorage
 *     + IDB so state survives reloads.
 *
 * HUD: a small "N / cap cloud calls today" footer reads from this service.
 * Users can change the cap via setCloudCap().
 */

import type { LlmProvider } from './llm-adapter';
import { getMemory, putMemory } from './reasoning-memory';

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'crystalball-llm-budget-v1';
const CAP_KEY = 'crystalball-llm-cloud-cap';
const DEFAULT_CAP = 50;
const EVENT_NAME = 'cb:llm-budget';

// ── State ─────────────────────────────────────────────────────────────────────

interface DailyCounts {
  /** YYYY-MM-DD (UTC) of the day these counts apply to. */
  date: string;
  local: number;
  cloudAgent: number;
  cloudChat: number;
  cloudGroq: number;
  lastReset: number;
}

let state: DailyCounts = initialState();
let loaded = false;
let writtenSinceLoad = false;

function utcDateStr(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function initialState(): DailyCounts {
  return { date: utcDateStr(), local: 0, cloudAgent: 0, cloudChat: 0, cloudGroq: 0, lastReset: Date.now() };
}

function applyLoaded(value: DailyCounts | null): void {
  if (!value || typeof value !== 'object') return;
  state = {
    date: typeof value.date === 'string' ? value.date : utcDateStr(),
    local: Number(value.local) || 0,
    cloudAgent: Number(value.cloudAgent) || 0,
    cloudChat: Number(value.cloudChat) || 0,
    cloudGroq: Number((value as DailyCounts).cloudGroq) || 0,
    lastReset: Number(value.lastReset) || Date.now(),
  };
  rolloverIfNeeded();
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) applyLoaded(JSON.parse(raw) as DailyCounts);
  } catch { /* ignore */ }
  void getMemory<DailyCounts>(STORAGE_KEY).then(value => {
    if (writtenSinceLoad) return;
    applyLoaded(value);
  });
}

function save(): void {
  writtenSinceLoad = true;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
  void putMemory(STORAGE_KEY, state);
}

function rolloverIfNeeded(): void {
  const today = utcDateStr();
  if (state.date === today) return;
  state = initialState();
  save();
}

// ── Cap config ───────────────────────────────────────────────────────────────

export function getCloudCap(): number {
  try {
    const raw = localStorage.getItem(CAP_KEY);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return Math.min(1000, n);
    }
  } catch { /* ignore */ }
  return DEFAULT_CAP;
}

export function setCloudCap(cap: number): void {
  const clamped = Math.max(0, Math.min(1000, Math.floor(cap)));
  try { localStorage.setItem(CAP_KEY, String(clamped)); } catch { /* ignore */ }
  document.dispatchEvent(new CustomEvent<BudgetStatus>(EVENT_NAME, { detail: getBudgetStatus() }));
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface BudgetStatus {
  date: string;
  local: number;
  cloud: number;
  cloudGroq: number;
  cap: number;
  remaining: number;
  exhausted: boolean;
}

export function getBudgetStatus(): BudgetStatus {
  load();
  rolloverIfNeeded();
  const cap = getCloudCap();
  const cloud = state.cloudAgent + state.cloudChat;
  return {
    date: state.date,
    local: state.local,
    cloud,
    cloudGroq: state.cloudGroq,
    cap,
    remaining: Math.max(0, cap - cloud),
    exhausted: cloud >= cap,
  };
}

/**
 * Check whether a call of the given provider is permitted right now.
 * Local calls are always allowed; cloud calls are gated by the cap.
 * If provider is 'none', we always return true (nothing to charge).
 */
export function canSpend(provider: LlmProvider): boolean {
  if (provider === 'local' || provider === 'none') return true;
  const status = getBudgetStatus();
  return !status.exhausted;
}

/**
 * Atomically check + reserve a cloud-call slot. Returns true iff the
 * counter was incremented. Use this from llm-adapter before issuing a
 * cloud request so that N parallel callers (e.g. the multi-persona
 * ensemble) cannot all race past canSpend() and overshoot the cap.
 *
 * If the call never actually issues (the provider returned nothing or
 * threw before spending a real slot), the caller must release the
 * reservation via refundCloudCall() — typically from a finally block —
 * so a failed attempt doesn't permanently burn budget.
 */
export function reserveCloudCall(provider: LlmProvider): boolean {
  if (provider === 'local' || provider === 'none') return true;
  load();
  rolloverIfNeeded();
  const cap = getCloudCap();
  const cloud = state.cloudAgent + state.cloudChat;
  if (cloud >= cap) return false;
  if (provider === 'cloud-agent') state.cloudAgent += 1;
  else if (provider === 'cloud-chat') state.cloudChat += 1;
  save();
  document.dispatchEvent(new CustomEvent<BudgetStatus>(EVENT_NAME, { detail: getBudgetStatus() }));
  return true;
}

/**
 * Release a slot previously taken by reserveCloudCall() when the cloud
 * call did not actually happen (empty result or thrown error). The
 * counter is clamped at zero so a stray refund can never drive the
 * budget negative.
 */
export function refundCloudCall(provider: LlmProvider): void {
  if (provider === 'local' || provider === 'none') return;
  load();
  rolloverIfNeeded();
  if (provider === 'cloud-agent') state.cloudAgent = Math.max(0, state.cloudAgent - 1);
  else if (provider === 'cloud-chat') state.cloudChat = Math.max(0, state.cloudChat - 1);
  else return;
  save();
  document.dispatchEvent(new CustomEvent<BudgetStatus>(EVENT_NAME, { detail: getBudgetStatus() }));
}

/**
 * Record that a call of the given provider was made. Writes the counter
 * and dispatches cb:llm-budget so the HUD refreshes. Cloud calls should
 * use reserveCloudCall() instead, which is race-safe.
 */
export function recordCall(provider: LlmProvider): void {
  if (provider === 'none') return;
  load();
  rolloverIfNeeded();
  if (provider === 'local') state.local += 1;
  else if (provider === 'cloud-agent') state.cloudAgent += 1;
  else if (provider === 'cloud-chat') state.cloudChat += 1;
  else if (provider === 'cloud-groq') state.cloudGroq += 1;
  save();
  document.dispatchEvent(new CustomEvent<BudgetStatus>(EVENT_NAME, { detail: getBudgetStatus() }));
}

export function resetBudget(): void {
  state = initialState();
  save();
  document.dispatchEvent(new CustomEvent<BudgetStatus>(EVENT_NAME, { detail: getBudgetStatus() }));
}

export function subscribeBudget(cb: (status: BudgetStatus) => void): () => void {
  const handler = (e: Event): void => {
    const ce = e as CustomEvent<BudgetStatus>;
    cb(ce.detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => { document.removeEventListener(EVENT_NAME, handler); };
}
