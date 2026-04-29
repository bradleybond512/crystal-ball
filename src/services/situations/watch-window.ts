/**
 * Watch-window evaluator — Phase 3 of
 * docs/CLAUDE_HIGH_IMPACT_EVENT_INTELLIGENCE_VISION_2026-04-29.md.
 *
 * Pure deterministic. Takes a Situation + a list of observed signal
 * ids + the current time, and produces an updated (confidence,
 * urgency, phase, diagnosticsTrace) so the host loop can re-emit
 * the situation through the store.
 *
 * Rules (all bounded so the math doesn't run away):
 *   - Confirmation: each expected signal observed within its
 *     watch window adds +0.05 confidence (max 0.95).
 *   - Decay: each expected signal MISSED past its window subtracts
 *     0.1 confidence and 0.1 urgency. After all expected signals
 *     have missed, urgency drops to ≤ 0.2 and the situation moves
 *     to 'de-escalating' / 'resolved' if confidence is below 0.3.
 *   - Invalidation: any invalidation signal observed → confidence
 *     0.1, phase 'resolved', verdict 'false_positive'.
 *   - Diagnostics: every adjustment writes a line to the trace.
 */

import type {
  ExpectedSignal,
  Situation,
} from './situation-types';

// ── Public API ──────────────────────────────────────────────────────────

export interface WatchWindowEvaluation {
  /** New confidence value (0..1). */
  confidence: number;
  /** New urgency value (0..1). */
  urgency: number;
  /** New phase verdict. */
  phase: Situation['phase'];
  /** Adjusted prediction outcome. Only populated when invalidation
   *  signal fires. */
  predictionOutcome?: Situation['predictionOutcome'];
  /** Additional rationale lines appended to diagnosticsTrace.
   *  Caller composes the new trace by joining these onto the
   *  situation's existing rationale. */
  diagnosticsAdditions: {
    confidenceRationale: string;
    severityRationale: string;
    thresholdsCrossed: readonly string[];
  };
  /** Confirmed signal ids (for whatChanged + UI). */
  confirmed: readonly string[];
  /** Missed signal ids (timed out). */
  missed: readonly string[];
  /** Invalidation signal ids that fired. */
  invalidated: readonly string[];
}

export interface WatchWindowInput {
  /** Situation under evaluation. */
  situation: Situation;
  /** Signal ids the host has observed since the last evaluation. */
  observedSignalIds: readonly string[];
  /** Current ms timestamp; defaults to Date.now(). */
  now?: () => number;
  /** Default watch window (ms) for expected signals that didn't
   *  declare an `expectByMs`. Defaults to 60 minutes. */
  defaultWindowMs?: number;
}

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

export function evaluateWatchWindow(input: WatchWindowInput): WatchWindowEvaluation {
  const now = (input.now ?? Date.now)();
  const defaultWindow = input.defaultWindowMs ?? DEFAULT_WINDOW_MS;
  const observed = new Set(input.observedSignalIds);
  const s = input.situation;

  // 1. Invalidation wins — collapse confidence + mark resolved.
  const invalidationsHit = s.invalidationSignals.filter((sig) => observed.has(sig.id));
  if (invalidationsHit.length > 0) {
    return {
      confidence: 0.1,
      urgency: 0.1,
      phase: 'resolved',
      predictionOutcome: {
        ...s.predictionOutcome,
        resolvedAt: now,
        verdict: 'false_positive',
        notes: `Invalidated by signal(s): ${invalidationsHit.map((sig) => sig.id).join(', ')}`,
      },
      diagnosticsAdditions: {
        confidenceRationale: `Invalidation signal(s) observed: ${invalidationsHit.map((sig) => sig.id).join(', ')} → confidence dropped to 0.1`,
        severityRationale: `Invalidation collapsed urgency to 0.1`,
        thresholdsCrossed: invalidationsHit.map((sig) => `invalidated:${sig.id}`),
      },
      confirmed: [],
      missed: [],
      invalidated: invalidationsHit.map((sig) => sig.id),
    };
  }

  // 2. Walk expected signals — confirmed vs. missed vs. still-pending.
  const confirmed: string[] = [];
  const missed: string[] = [];
  let confirmAdjust = 0;
  let missAdjust = 0;
  let urgencyAdjust = 0;
  for (const sig of s.expectedNextSignals) {
    if (observed.has(sig.id)) {
      confirmed.push(sig.id);
      confirmAdjust += 0.05;
    } else if (signalTimedOut(sig, s.firstSeen, now, defaultWindow)) {
      missed.push(sig.id);
      missAdjust -= 0.1;
      urgencyAdjust -= 0.1;
    }
    // Pending — within the window, not yet observed → no adjustment.
  }

  const newConfidence = clamp(s.confidence + confirmAdjust + missAdjust, 0.05, 0.95);
  const newUrgency = clamp(s.urgency + urgencyAdjust, 0, 1);

  // 3. Phase update.
  // If everything we expected has either confirmed or missed AND the
  // confidence drops below 0.3 → de-escalating / resolved.
  // If any confirmed signals fired AND nothing has missed → phase
  // moves toward 'active'.
  let phase: Situation['phase'] = s.phase;
  if (missed.length > 0 && newConfidence < 0.3) {
    phase = newConfidence < 0.15 ? 'resolved' : 'developing';
  } else if (confirmed.length > 0 && missed.length === 0) {
    phase = 'active';
  }

  return {
    confidence: newConfidence,
    urgency: newUrgency,
    phase,
    diagnosticsAdditions: {
      confidenceRationale: composeConfidenceRationale(confirmed, missed, confirmAdjust, missAdjust),
      severityRationale: urgencyAdjust < 0
        ? `Urgency decay −${Math.abs(urgencyAdjust).toFixed(2)} from ${missed.length} missed signal(s)`
        : '(urgency unchanged)',
      thresholdsCrossed: [
        ...confirmed.map((id) => `confirmed:${id}`),
        ...missed.map((id) => `missed:${id}`),
      ],
    },
    confirmed,
    missed,
    invalidated: [],
  };
}

/** Apply the evaluation to a Situation, producing a new Situation
 *  that the store can upsert. Convenience wrapper that does the
 *  diagnosticsTrace + whatChanged composition. */
export function applyWatchWindowEvaluation(
  situation: Situation,
  evaluation: WatchWindowEvaluation,
  now: number = Date.now(),
): Situation {
  const { confidence, urgency, phase, predictionOutcome, diagnosticsAdditions, confirmed, missed, invalidated } = evaluation;
  const whatChangedAdditions: { ts: number; text: string; source?: string }[] = [];
  if (confirmed.length > 0) {
    whatChangedAdditions.push({
      ts: now,
      text: `${confirmed.length} expected signal(s) confirmed`,
      source: 'watch-window',
    });
  }
  if (missed.length > 0) {
    whatChangedAdditions.push({
      ts: now,
      text: `${missed.length} expected signal(s) timed out`,
      source: 'watch-window',
    });
  }
  if (invalidated.length > 0) {
    whatChangedAdditions.push({
      ts: now,
      text: `Invalidation signal(s) fired — situation marked false-positive`,
      source: 'watch-window',
    });
  }

  return {
    ...situation,
    confidence,
    urgency,
    phase,
    predictionOutcome: predictionOutcome ?? situation.predictionOutcome,
    whatChanged: [...situation.whatChanged, ...whatChangedAdditions],
    timeline: [
      ...situation.timeline,
      ...whatChangedAdditions.map((e) => ({ ts: e.ts, text: e.text, source: e.source })),
    ],
    diagnosticsTrace: {
      ...situation.diagnosticsTrace,
      confidenceRationale: appendLine(
        situation.diagnosticsTrace.confidenceRationale,
        diagnosticsAdditions.confidenceRationale,
      ),
      severityRationale: appendLine(
        situation.diagnosticsTrace.severityRationale,
        diagnosticsAdditions.severityRationale,
      ),
      thresholdsCrossed: [
        ...situation.diagnosticsTrace.thresholdsCrossed,
        ...diagnosticsAdditions.thresholdsCrossed,
      ],
    },
    lastUpdated: now,
  };
}

// ── Internals ───────────────────────────────────────────────────────────

function signalTimedOut(
  sig: ExpectedSignal,
  firstSeen: number,
  now: number,
  defaultWindow: number,
): boolean {
  if (typeof sig.expectByMs === 'number') return now > sig.expectByMs;
  return now - firstSeen > defaultWindow;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function appendLine(existing: string, addition: string): string {
  if (!addition || addition === '(urgency unchanged)') return existing;
  return existing.endsWith('\n') ? `${existing}${addition}` : `${existing}\n${addition}`;
}

function composeConfidenceRationale(
  confirmed: readonly string[],
  missed: readonly string[],
  confirmAdjust: number,
  missAdjust: number,
): string {
  const parts: string[] = [];
  if (confirmed.length > 0) {
    parts.push(`${confirmed.length} confirmed (+${confirmAdjust.toFixed(2)})`);
  }
  if (missed.length > 0) {
    parts.push(`${missed.length} missed (${missAdjust.toFixed(2)})`);
  }
  if (parts.length === 0) return '(no watch-window changes)';
  return `Watch-window: ${parts.join(', ')}`;
}

// Re-exports so consumers can pass invalidation signals through this
// module without importing situation-types directly.
export type { ExpectedSignal, InvalidationSignal } from './situation-types';
