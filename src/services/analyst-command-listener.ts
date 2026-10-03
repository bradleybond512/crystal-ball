/**
 * Analyst Command Listener — polls the sidecar's /api/analyst-commands
 * queue and applies any commands submitted by external agents (MCP
 * tools: submit_hypothesis_feedback, dismiss_hypothesis, run_skeptic_now).
 *
 * This is the inbound half of the bidirectional MCP channel. The
 * sidecar-pusher handles the outbound half (renderer state → sidecar).
 *
 * Commands:
 *   - thumbs_up, thumbs_down, dismiss → held as a pending agent suggestion
 *     until the user confirms it in the Analyst HUD (R4-SEC-004). An agent
 *     reads feed text anyone can publish, so it must not be able to move
 *     calibration or hide a hypothesis on its own.
 *   - run_skeptic → enqueue an immediate skeptic review for the hypothesis
 *     (it only adds a review; it changes no ranking or visibility).
 *
 * Matching uses signature first (stable across cycles), hypothesisId
 * second (stable within a snapshot). Commands that can't match current
 * hypotheses are quietly dropped — the external agent may be working
 * from stale data.
 *
 * Polling interval:
 *   - 10s default (30s in Ghost Mode)
 *   - Commands are queued in the sidecar for up to 64 at a time, so we
 *     don't lose anything if the renderer pauses briefly.
 */

import { isDesktopRuntime } from './runtime';
import { isGhostMode } from './mode-manager';
import type { Hypothesis, AnalystSnapshot } from './analyst-loop';
import { recordFeedbackForSignature, signatureFor } from './hypothesis-feedback';
import {
  discardAgentSuggestion,
  queueAgentSuggestion,
  takeAgentSuggestion,
  type AgentSuggestionKind,
} from './agent-suggestions';
import { putMemory, getMemory } from './reasoning-memory';
import { logDebug } from './reasoning-debug';
import { recordLatency, incrementCounter } from './reasoning-metrics';

// ── Constants ─────────────────────────────────────────────────────────────────

const ENDPOINT = '/api/analyst-commands';
const POLL_INTERVAL_MS = 10_000;
const GHOST_POLL_INTERVAL_MS = 30_000;
const EVENT_DISMISSED = 'cb:hypothesis-dismissed';
const EVENT_RUN_SKEPTIC = 'cb:hypothesis-skeptic-requested';
const DISMISSED_STORAGE_KEY = 'crystalball-dismissed-hypotheses-v1';
const DISMISSED_TTL_MS = 24 * 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

type AnalystCommandKind = AgentSuggestionKind | 'run_skeptic';

interface AnalystCommand {
  id: string;
  issuedAt: number;
  kind: AnalystCommandKind;
  /** Set by the sidecar to 'external'; never treated as a reason to skip confirmation. */
  origin?: string;
  hypothesisId: string | null;
  signature: string | null;
  note?: string | null;
}

const COMMAND_KINDS: readonly AnalystCommandKind[] = ['thumbs_up', 'thumbs_down', 'dismiss', 'run_skeptic'];

const optionalString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Shape-check one command from the sidecar; null when it is malformed. */
export function parseAnalystCommand(raw: unknown): AnalystCommand | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.issuedAt !== 'number' || !Number.isFinite(r.issuedAt)) return null;
  if (typeof r.kind !== 'string' || !(COMMAND_KINDS as readonly string[]).includes(r.kind)) return null;
  return {
    id: r.id,
    issuedAt: r.issuedAt,
    kind: r.kind as AnalystCommandKind,
    origin: optionalString(r.origin) ?? undefined,
    hypothesisId: optionalString(r.hypothesisId),
    signature: optionalString(r.signature),
    note: optionalString(r.note),
  };
}

interface CommandResponse { commands?: unknown[] }

// ── Dismissed set (cross-session) ────────────────────────────────────────────

interface DismissRecord { signature: string; at: number }

const dismissed = new Map<string, number>();
let dismissLoaded = false;
let dismissWrittenSinceLoad = false;

function loadDismissed(): void {
  if (dismissLoaded) return;
  dismissLoaded = true;
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as DismissRecord[];
      for (const r of arr) dismissed.set(r.signature, r.at);
    }
  } catch { /* ignore */ }
  void getMemory<DismissRecord[]>(DISMISSED_STORAGE_KEY).then(arr => {
    if (dismissWrittenSinceLoad) return;
    if (!arr) return;
    for (const r of arr) dismissed.set(r.signature, r.at);
  });
  prune();
}

function prune(): void {
  const cutoff = Date.now() - DISMISSED_TTL_MS;
  for (const [k, at] of dismissed) if (at < cutoff) dismissed.delete(k);
}

function saveDismissed(): void {
  dismissWrittenSinceLoad = true;
  const arr: DismissRecord[] = [...dismissed].map(([signature, at]) => ({ signature, at }));
  try { localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(arr)); } catch { /* quota */ }
  void putMemory(DISMISSED_STORAGE_KEY, arr);
}

export function isDismissed(h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>): boolean {
  loadDismissed();
  const sig = signatureFor(h);
  const at = dismissed.get(sig);
  if (at === undefined) return false;
  // Lazy TTL enforcement — `prune()` only runs at load, so long-running
  // sessions would otherwise hold dismissed entries past their 24h
  // window. Check + delete on read.
  if (Date.now() - at > DISMISSED_TTL_MS) {
    // Prune the expired entry in-memory. Skip the save here — rank()
    // calls isDismissed many times per cycle and batching saves would
    // require API changes; expired entries get re-persisted on the
    // next markDismissed/clearDismissed write, and on reload the lazy
    // check prunes them again (self-healing).
    dismissed.delete(sig);
    return false;
  }
  return true;
}

/** Dismiss by feedback signature (used by a confirmed agent suggestion). */
export function markDismissedSignature(signature: string): void {
  loadDismissed();
  dismissed.set(signature, Date.now());
  saveDismissed();
  document.dispatchEvent(new CustomEvent<{ signature: string }>(EVENT_DISMISSED, {
    detail: { signature },
  }));
}

export function markDismissed(h: Pick<Hypothesis, 'kind' | 'evidence' | 'region'>): void {
  markDismissedSignature(signatureFor(h));
}

export function clearDismissed(): void {
  dismissed.clear();
  saveDismissed();
}

// ── Command application ─────────────────────────────────────────────────────

let latestSnapshot: AnalystSnapshot | null = null;
let _snapshotListener: ((e: Event) => void) | null = null;

function findHypothesis(cmd: AnalystCommand): Hypothesis | null {
  if (!latestSnapshot) return null;
  if (cmd.hypothesisId) {
    const byId = latestSnapshot.hypotheses.find(h => h.id === cmd.hypothesisId);
    if (byId) return byId;
  }
  if (cmd.signature) {
    const bySig = latestSnapshot.hypotheses.find(h => signatureFor(h) === cmd.signature);
    if (bySig) return bySig;
  }
  return null;
}

type CommandOutcome = 'applied' | 'queued' | 'dropped';

/**
 * Skeptic requests apply at once. Feedback and dismissals become pending
 * agent suggestions, whatever origin the command carries. Commands that
 * match no current hypothesis are dropped: the agent may hold stale data.
 */
function applyCommand(cmd: AnalystCommand): CommandOutcome {
  const h = findHypothesis(cmd);
  if (!h) return 'dropped';
  if (cmd.kind === 'run_skeptic') {
    document.dispatchEvent(new CustomEvent<Hypothesis>(EVENT_RUN_SKEPTIC, { detail: h }));
    return 'applied';
  }
  const queued = queueAgentSuggestion({
    id: cmd.id,
    kind: cmd.kind,
    signature: signatureFor(h),
    hypothesisId: h.id,
    statement: h.statement,
    note: cmd.note ?? null,
    issuedAt: cmd.issuedAt,
  });
  return queued ? 'queued' : 'dropped';
}

/**
 * Apply a pending agent suggestion the user confirmed. Returns false when it
 * no longer exists (already handled, discarded or expired).
 */
export function confirmAgentSuggestion(id: string): boolean {
  const suggestion = takeAgentSuggestion(id);
  if (!suggestion) return false;
  switch (suggestion.kind) {
    case 'thumbs_up': { recordFeedbackForSignature(suggestion.signature, 'up'); break; }
    case 'thumbs_down': { recordFeedbackForSignature(suggestion.signature, 'down'); break; }
    case 'dismiss': { markDismissedSignature(suggestion.signature); break; }
  }
  logDebug({ level: 'info', category: 'commands', source: 'analyst-command-listener',
    message: 'agent suggestion confirmed', data: { kind: suggestion.kind } });
  return true;
}

/** Drop a pending agent suggestion without applying it. */
export function rejectAgentSuggestion(id: string): boolean {
  const removed = discardAgentSuggestion(id);
  if (removed) {
    logDebug({ level: 'info', category: 'commands', source: 'analyst-command-listener',
      message: 'agent suggestion discarded', data: {} });
  }
  return removed;
}

// ── Polling loop ─────────────────────────────────────────────────────────────

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSeenAt = 0;

/** Validate and apply one drained batch; exported for tests. */
export function processAnalystCommands(commands: readonly unknown[]): Record<CommandOutcome, number> {
  const counts: Record<CommandOutcome, number> = { applied: 0, queued: 0, dropped: 0 };
  for (const raw of commands) {
    const cmd = parseAnalystCommand(raw);
    if (!cmd) { counts.dropped += 1; continue; }
    lastSeenAt = Math.max(lastSeenAt, cmd.issuedAt);
    counts[applyCommand(cmd)] += 1;
  }
  return counts;
}

async function poll(): Promise<void> {
  if (!isDesktopRuntime()) return;
  const t0 = performance.now();
  try {
    const res = await fetch(`${ENDPOINT}?since=${lastSeenAt}`, {
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) {
      recordLatency('cmd-poll', performance.now() - t0);
      incrementCounter('cmd-poll.non-ok');
      return;
    }
    const parsed = await res.json() as CommandResponse;
    if (!parsed || !Array.isArray(parsed.commands)) {
      recordLatency('cmd-poll', performance.now() - t0);
      return;
    }
    const commands = parsed.commands;
    const counts = processAnalystCommands(commands);
    recordLatency('cmd-poll', performance.now() - t0);
    if (commands.length > 0) {
      logDebug({ level: 'info', category: 'commands', source: 'analyst-command-listener',
        message: `drained ${commands.length}`,
        data: { total: commands.length, ...counts } });
      incrementCounter('cmd-poll.drained', commands.length);
      incrementCounter('cmd-poll.queued', counts.queued);
      incrementCounter('cmd-poll.dropped', counts.dropped);
    }
  } catch (error) {
    recordLatency('cmd-poll', performance.now() - t0);
    incrementCounter('cmd-poll.error');
    logDebug({ level: 'warn', category: 'commands', source: 'analyst-command-listener',
      message: 'poll threw',
      data: { error: error instanceof Error ? error.message : String(error) } });
  }
}

function scheduleNext(): void {
  if (!started) return;
  const interval = isGhostMode() ? GHOST_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
  timer = setTimeout(() => {
    if (!started) return;
    void poll().finally(scheduleNext);
  }, interval);
}

export function startAnalystCommandListener(): void {
  if (started) return;
  started = true;
  loadDismissed();
  _snapshotListener = (e: Event) => {
    const ce = e as CustomEvent<AnalystSnapshot>;
    latestSnapshot = ce.detail;
  };
  document.addEventListener('cb:analyst-hypotheses', _snapshotListener);
  if (!isDesktopRuntime()) return;
  scheduleNext();
}

export function stopAnalystCommandListener(): void {
  started = false;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (_snapshotListener !== null) {
    document.removeEventListener('cb:analyst-hypotheses', _snapshotListener);
    _snapshotListener = null;
  }
}
