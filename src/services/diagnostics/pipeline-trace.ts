/**
 * Pipeline trace registry — tracks facts through the intelligence pipeline.
 *
 * Every incoming fact (alert, event, observation) gets a traceId that it carries
 * from ingestion through scoring, clustering, evaluation, and ladder routing.
 * The registry records each stage transition so "why didn't this trigger a
 * notification?" has a deterministic, inspectable audit trail.
 *
 * Pure: no DOM, no fetch, no Date.now() default deep inside logic.
 * Invariants:
 *  - record() auto-creates an entry on first call (createdAt = first event's at).
 *  - A new `ingested` event starts a fresh lifecycle, but a consecutive
 *    nonterminal retry retains the failure streak's original createdAt.
 *  - FIFO eviction at cap (default 500) so memory is bounded.
 *  - snapshot() is JSON-round-trippable (all values are primitives).
 */

// ── Types ────────────────────────────────────────────────────────────────

export type PipelineStage =
  | 'ingested'    // fact entered via data-bridge / data-loader
  | 'scored'      // truth-score / shortage-score / posture computed
  | 'clustered'   // joined a Situation
  | 'evaluated'   // big-event detector ran
  | 'routed'      // ladder decision recorded
  | 'dropped';    // explicitly filtered out (with reason)

export interface PipelineTraceEvent {
  at: number;
  stage: PipelineStage;
  reason?: string;
  detail?: Record<string, string | number | boolean | null>;
}

export interface PipelineTraceEntry {
  traceId: string;    // caller-supplied stable id (alert id, fact id)
  domain: string;     // 'weather' | 'shortage' | ... free-form
  createdAt: number;
  events: PipelineTraceEvent[];
}

export interface PipelineTraceRegistry {
  /** Record a stage transition for a fact. Auto-creates the entry if new. */
  record(
    traceId: string,
    domain: string,
    event: Omit<PipelineTraceEvent, 'at'> & { at?: number },
  ): void;
  /** Get the current trace entry for a fact. Returns undefined if unknown. */
  get(traceId: string): PipelineTraceEntry | undefined;
  /** Entries that entered >= staleMs ago and never reached 'routed' or 'dropped'. */
  stalled(now: number, staleMs: number): readonly PipelineTraceEntry[];
  /** JSON-serializable snapshot of all current entries. */
  snapshot(): { entries: readonly PipelineTraceEntry[]; total: number };
}

export interface PipelineTraceRegistryOptions {
  /** Max entries. FIFO eviction when exceeded. Default 500. */
  cap?: number;
  /** Optional clock for tests. Defaults to Date.now(). */
  now?: () => number;
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createPipelineTraceRegistry(
  opts: PipelineTraceRegistryOptions = {},
): PipelineTraceRegistry {
  const cap = opts.cap ?? 500;
  const now = opts.now ?? (() => Date.now());

  /** Map preserves insertion order (FIFO eviction). */
  const entries = new Map<string, PipelineTraceEntry>();

  function evictIfNeeded(): void {
    while (entries.size >= cap) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey !== undefined) entries.delete(oldestKey);
    }
  }

  return {
    record(traceId, domain, event) {
      const at = event.at ?? now();
      const traceEvent: PipelineTraceEvent = {
        at,
        stage: event.stage,
        ...(event.reason === undefined ? {} : { reason: event.reason }),
        ...(event.detail === undefined ? {} : { detail: event.detail }),
      };

      const existing = entries.get(traceId);
      if (existing) {
        if (event.stage === 'ingested') {
          const priorLifecycleComplete = existing.events.some(
            (priorEvent) => priorEvent.stage === 'routed' || priorEvent.stage === 'dropped',
          );
          entries.delete(traceId);
          entries.set(traceId, {
            traceId,
            domain,
            createdAt: priorLifecycleComplete ? at : existing.createdAt,
            events: [traceEvent],
          });
        } else {
          entries.set(traceId, { ...existing, events: [...existing.events, traceEvent] });
        }
      } else {
        evictIfNeeded();
        entries.set(traceId, { traceId, domain, createdAt: at, events: [traceEvent] });
      }
    },

    get(traceId) {
      return entries.get(traceId);
    },

    stalled(nowMs, staleMs) {
      const cutoff = nowMs - staleMs;
      const result: PipelineTraceEntry[] = [];
      for (const entry of entries.values()) {
        if (entry.createdAt > cutoff) continue;
        const hasTerminal = entry.events.some(
          (e) => e.stage === 'routed' || e.stage === 'dropped',
        );
        if (!hasTerminal) result.push(entry);
      }
      return result;
    },

    snapshot() {
      const all = [...entries.values()];
      return { entries: all, total: all.length };
    },
  };
}
