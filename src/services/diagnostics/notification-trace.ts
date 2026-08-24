/**
 * Notification Trace Registry — per
 * docs/DIAGNOSTICS_OBSERVABILITY_ENHANCEMENT_PLAN.md PR 5 (lines 461-471)
 * and section "Notification Trace Registry" (lines 335-354).
 *
 * Generalizes the weather-warning diagnostic style to all
 * high-importance notifications (weather, cyber, conflict, market,
 * shortage, system, reasoning). For every candidate this registry
 * tracks the full pipeline:
 *
 *   register → urgency check → relevance check → dedupe decision →
 *     quiet-hours decision → dispatch rung → native result → user action
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time. The
 * caller (notification-router / notification-dispatcher / weather
 * warning router) drives the registry by recording events as the
 * candidate moves through the pipeline.
 *
 * Plan invariants:
 *   - Every suppression is diagnosable ("why didn't I get warned?")
 *   - Every entry is JSON-serializable for the diagnostics export
 *     bundle (PR 8)
 *   - The summary output matches `NotificationTraceSummary` so the
 *     System Health aggregator can consume it without a join
 */

import type { NotificationTraceSummary } from './system-health-types';

// ── Public API ──────────────────────────────────────────────────────────

export type NotificationDomain =
  | 'weather'
  | 'cyber'
  | 'conflict'
  | 'market'
  | 'shortage'
  | 'energy'
  | 'system'
  | 'reasoning'
  | 'other';

/** The plan's notification ladder — the dispatcher picks one rung
 *  based on urgency + relevance + quiet-hours state. */
export type NotificationRung =
  | 'silent'         // logged only; no UI, no sound
  | 'in_app'         // panel badge / inbox only
  | 'banner'         // standard macOS banner
  | 'banner_sound'   // banner with sound
  | 'critical'       // critical alert, breaks DND
  | 'announcement';  // critical + read-aloud (storm mode)

export type NotificationUrgency = 'critical' | 'high' | 'normal' | 'low';

export type NotificationDecision =
  | 'pending'
  | 'dispatched'
  | 'suppressed'
  | 'expired';

export interface NotificationCandidate {
  candidateId: string;
  /** Upstream alert / situation / story id. Optional — system
   *  notifications (sidecar restart, self-test) don't have one. */
  situationId?: string;
  domain: NotificationDomain;
  urgency: NotificationUrgency;
  /** 0..1 confidence the dispatcher uses when picking a rung. */
  confidence: number;
  /** 0..1 user-relevance score (e.g. how close the alert is to a
   *  saved place; how heavily the user weights the watchlist entry). */
  userRelevance?: number;
  /** Whether this notification is treated as safety-critical. A
   *  critical+safety pair is what the gameplan invariant means by
   *  "never miss what matters" — suppressing one of these is what we
   *  record into `unsafeSuppressions` for the system summary. */
  safetyCritical?: boolean;
  createdAt: number;
  /** Headline shown to the user when delivered. Used in the trace UI. */
  headline?: string;
}

export type TraceEventKind =
  | 'created'
  | 'urgency_check'
  | 'relevance_check'
  | 'dedupe_check'
  | 'quiet_hours_check'
  | 'rung_selected'
  | 'native_result'
  | 'user_action'
  | 'suppressed'
  | 'expired';

export interface TraceEvent {
  id: string;
  at: number;
  kind: TraceEventKind;
  /** Free-text reason — surfaced in the trace UI. */
  reason: string;
  /** Optional structured detail (e.g. `{ score: 0.42, threshold: 0.6 }`). */
  detail?: Record<string, unknown>;
}

export interface NativeNotificationResult {
  /** Did the OS report a successful presentation? */
  delivered: boolean;
  /** OS-level surface: 'banner' | 'critical' | 'critical_sound' | 'in_app' | 'failed'. */
  surface: 'banner' | 'critical' | 'critical_sound' | 'in_app' | 'failed';
  /** ms timestamp the OS handed us. */
  at?: number;
  /** Optional error message when delivered=false. */
  error?: string;
}

export type UserActionKind =
  | 'opened'
  | 'dismissed'
  | 'snoozed'
  | 'acted_on'
  | 'ignored';

export interface UserActionRecord {
  kind: UserActionKind;
  at: number;
  /** Optional metadata — what the user did inside the app after
   *  opening (clicked the action button, opened the inspector, etc.). */
  detail?: Record<string, unknown>;
}

export interface NotificationTraceEntry {
  candidate: NotificationCandidate;
  events: readonly TraceEvent[];
  decision: NotificationDecision;
  decisionReason?: string;
  rung?: NotificationRung;
  nativeResult?: NativeNotificationResult;
  userAction?: UserActionRecord;
}

export interface NotificationTraceRegistry {
  /** Register a new candidate. Idempotent on candidateId — re-registering
   *  with the same id throws so the caller spots a logic bug. */
  register: (candidate: NotificationCandidate) => NotificationTraceEntry;
  recordEvent: (
    candidateId: string,
    event: Omit<TraceEvent, 'id' | 'at'> & { at?: number; id?: string },
  ) => TraceEvent;
  /** Mark the candidate suppressed by reason. Locks the entry. */
  suppress: (candidateId: string, reason: string, at?: number) => NotificationTraceEntry;
  /** Mark the candidate dispatched at a particular rung. The native
   *  result is recorded separately so the dispatcher can report back. */
  dispatch: (candidateId: string, rung: NotificationRung, at?: number) => NotificationTraceEntry;
  /** Record what the OS did with the dispatch. */
  recordNativeResult: (
    candidateId: string,
    result: NativeNotificationResult,
  ) => NotificationTraceEntry;
  recordUserAction: (
    candidateId: string,
    action: Omit<UserActionRecord, 'at'> & { at?: number },
  ) => NotificationTraceEntry;
  /** Mark the candidate expired (e.g. it sat in 'pending' too long). */
  expire: (candidateId: string, reason: string, at?: number) => NotificationTraceEntry;
  get: (candidateId: string) => NotificationTraceEntry | undefined;
  all: () => NotificationTraceEntry[];
  byDomain: (domain: NotificationDomain) => NotificationTraceEntry[];
  bySituation: (situationId: string) => NotificationTraceEntry[];
  /** Summary that the system-health aggregator consumes. */
  summary: (windowMs?: number) => NotificationTraceSummary;
  /** Drop entries older than the cap. Returns the number trimmed. */
  trim: (maxEntries: number) => number;
  clear: () => void;
}

export interface NotificationTraceRegistryOptions {
  /** Optional clock for tests. Defaults to Date.now(). */
  now?: () => number;
}

const USER_AUTHORIZED_SUPPRESSIONS = new Set([
  'master-mute',
  'domain-disabled',
  'ghost-mode',
]);

export function createNotificationTraceRegistry(
  options: NotificationTraceRegistryOptions = {},
): NotificationTraceRegistry {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, NotificationTraceEntry>();
  // Insertion order for stable .all() output.
  const order: string[] = [];
  let nextEventId = 1;

  function freshEventId(): string {
    return `nt-${nextEventId++}`;
  }

  function appendEvent(
    entry: NotificationTraceEntry,
    event: Omit<TraceEvent, 'id' | 'at'> & { at?: number; id?: string },
  ): TraceEvent {
    const recorded: TraceEvent = {
      id: event.id ?? freshEventId(),
      at: event.at ?? now(),
      kind: event.kind,
      reason: event.reason,
      detail: event.detail,
    };
    const updated: NotificationTraceEntry = {
      ...entry,
      events: [...entry.events, recorded],
    };
    entries.set(entry.candidate.candidateId, updated);
    return recorded;
  }

  function ensureEntry(candidateId: string): NotificationTraceEntry {
    const e = entries.get(candidateId);
    if (!e) throw new Error(`Notification candidate "${candidateId}" not registered`);
    return e;
  }

  function register(candidate: NotificationCandidate): NotificationTraceEntry {
    if (entries.has(candidate.candidateId)) {
      throw new Error(`Notification candidate "${candidate.candidateId}" already registered`);
    }
    const entry: NotificationTraceEntry = {
      candidate: { ...candidate },
      events: [
        {
          id: freshEventId(),
          at: candidate.createdAt,
          kind: 'created',
          reason: `Candidate created (${candidate.domain}, ${candidate.urgency}).`,
        },
      ],
      decision: 'pending',
    };
    entries.set(candidate.candidateId, entry);
    order.push(candidate.candidateId);
    return entry;
  }

  function recordEvent(
    candidateId: string,
    event: Omit<TraceEvent, 'id' | 'at'> & { at?: number; id?: string },
  ): TraceEvent {
    const entry = ensureEntry(candidateId);
    return appendEvent(entry, event);
  }

  function lockDecision(
    candidateId: string,
    decision: NotificationDecision,
    reason: string | undefined,
    at: number,
    extras: Partial<NotificationTraceEntry> = {},
  ): NotificationTraceEntry {
    const entry = ensureEntry(candidateId);
    appendEvent(entry, {
      kind: decisionEventKind(decision),
      reason: reason ?? `Decision: ${decision}.`,
      at,
    });
    const post = entries.get(candidateId)!;
    const updated: NotificationTraceEntry = {
      ...post,
      decision,
      decisionReason: reason ?? post.decisionReason,
      ...extras,
    };
    entries.set(candidateId, updated);
    return updated;
  }

  function suppress(candidateId: string, reason: string, at?: number): NotificationTraceEntry {
    return lockDecision(candidateId, 'suppressed', reason, at ?? now());
  }

  function dispatch(
    candidateId: string,
    rung: NotificationRung,
    at?: number,
  ): NotificationTraceEntry {
    return lockDecision(
      candidateId,
      'dispatched',
      `Dispatched at rung "${rung}".`,
      at ?? now(),
      { rung },
    );
  }

  function recordNativeResult(
    candidateId: string,
    result: NativeNotificationResult,
  ): NotificationTraceEntry {
    const entry = ensureEntry(candidateId);
    appendEvent(entry, {
      kind: 'native_result',
      reason: result.delivered
        ? `OS delivered as ${result.surface}.`
        : `OS reported failure: ${result.error ?? result.surface}.`,
      at: result.at ?? now(),
      detail: { ...result },
    });
    const post = entries.get(candidateId)!;
    const updated = { ...post, nativeResult: { ...result } };
    entries.set(candidateId, updated);
    return updated;
  }

  function recordUserAction(
    candidateId: string,
    action: Omit<UserActionRecord, 'at'> & { at?: number },
  ): NotificationTraceEntry {
    const entry = ensureEntry(candidateId);
    const at = action.at ?? now();
    appendEvent(entry, {
      kind: 'user_action',
      reason: `User ${action.kind}.`,
      at,
      detail: action.detail,
    });
    const post = entries.get(candidateId)!;
    const userAction: UserActionRecord = { kind: action.kind, at, detail: action.detail };
    const updated = { ...post, userAction };
    entries.set(candidateId, updated);
    return updated;
  }

  function expire(candidateId: string, reason: string, at?: number): NotificationTraceEntry {
    return lockDecision(candidateId, 'expired', reason, at ?? now());
  }

  function get(candidateId: string): NotificationTraceEntry | undefined {
    return entries.get(candidateId);
  }

  function all(): NotificationTraceEntry[] {
    return order.map((id) => entries.get(id)).filter((e): e is NotificationTraceEntry => !!e);
  }

  function byDomain(domain: NotificationDomain): NotificationTraceEntry[] {
    return all().filter((e) => e.candidate.domain === domain);
  }

  function bySituation(situationId: string): NotificationTraceEntry[] {
    return all().filter((e) => e.candidate.situationId === situationId);
  }

  function summary(windowMs?: number): NotificationTraceSummary {
    const t = now();
    const windowed =
      windowMs === undefined
        ? all()
        : all().filter((e) => t - e.candidate.createdAt <= windowMs);
    let candidates = 0;
    let dispatched = 0;
    const suppressedByReason: Record<string, number> = {};
    const unsafeSuppressions: { candidateId: string; reason: string; at: number }[] = [];
    for (const entry of windowed) {
      candidates += 1;
      if (entry.decision === 'dispatched') dispatched += 1;
      if (entry.decision === 'suppressed' || entry.decision === 'expired') {
        const reason = entry.decisionReason ?? `Decision: ${entry.decision}`;
        suppressedByReason[reason] = (suppressedByReason[reason] ?? 0) + 1;
        if (entry.candidate.safetyCritical && !USER_AUTHORIZED_SUPPRESSIONS.has(reason)) {
          // Find the suppression event timestamp (or fall back to "now").
          const ev = entry.events.find((e) => e.kind === 'suppressed' || e.kind === 'expired');
          unsafeSuppressions.push({
            candidateId: entry.candidate.candidateId,
            reason,
            at: ev?.at ?? t,
          });
        }
      }
    }
    return {
      generatedAt: t,
      candidates,
      dispatched,
      suppressedByReason,
      unsafeSuppressions,
    };
  }

  function trim(maxEntries: number): number {
    if (order.length <= maxEntries) return 0;
    const removeCount = order.length - maxEntries;
    const removed = order.splice(0, removeCount);
    for (const id of removed) entries.delete(id);
    return removeCount;
  }

  function clear(): void {
    entries.clear();
    order.length = 0;
    nextEventId = 1;
  }

  return {
    register,
    recordEvent,
    suppress,
    dispatch,
    recordNativeResult,
    recordUserAction,
    expire,
    get,
    all,
    byDomain,
    bySituation,
    summary,
    trim,
    clear,
  };
}

function decisionEventKind(decision: NotificationDecision): TraceEventKind {
  if (decision === 'suppressed') return 'suppressed';
  if (decision === 'expired') return 'expired';
  return 'rung_selected';
}

// ── Convenience helpers ────────────────────────────────────────────────

/** Map a notification ladder rung to its OS surface. Used by the
 *  dispatcher when it doesn't have a real OS result yet (e.g. a dry-run
 *  suppression diagnostic). */
export function defaultSurfaceForRung(rung: NotificationRung): NativeNotificationResult['surface'] {
  switch (rung) {
    case 'silent': {
      return 'in_app';
    }
    case 'in_app': {
      return 'in_app';
    }
    case 'banner': {
      return 'banner';
    }
    case 'banner_sound': {
      return 'banner';
    }
    case 'critical': {
      return 'critical';
    }
    case 'announcement': {
      return 'critical_sound';
    }
  }
}
