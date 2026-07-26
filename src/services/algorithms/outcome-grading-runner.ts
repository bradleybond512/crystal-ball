/**
 * Outcome Grading Runner — B1b of the self-improvement gameplan.
 *
 * The evaluation ledger fills with algorithm decisions (B1), but those
 * records stay `pending` (no ground-truth outcome) until something grades
 * them. The adaptive-tuner can only optimize against *graded* fixtures, so
 * this runner closes that gap: it pulls pending records that have aged past
 * the resolver's timeout, grades them via the LLM grader (using the app's
 * local-first `llm-adapter`), and writes the resulting outcome back into the
 * ledger.
 *
 * The pure grading logic lives in `outcome-resolver.ts` + `llm-grader.ts`;
 * this module only wires those to the live singleton ledger + the real LLM
 * and runs them on a cadence. Fully injectable for tests.
 */

import { getAlgorithmEvaluationLedger } from './algorithms-state';
import { resolvePendingViaLlm } from './outcome-resolver';
import type { LlmFn } from './llm-grader';
import type { AlgorithmEvaluationLedger } from './algorithm-evaluation-ledger';
import { generateText } from '@/services/llm-adapter';

/** Adapt the app's local-first LLM to the grader's `(prompt) => text` shape.
 *  `generateText` returns `{ provider: 'none', text: '' }` (no throw) when no
 *  LLM is available or the cloud budget is exhausted — throw in that case so
 *  the grader marks the result `llmUnavailable` and the runner leaves the
 *  record pending instead of falsely grading it inconclusive. */
const defaultLlmFn: LlmFn = async (prompt: string): Promise<string> => {
  const result = await generateText(prompt);
  if (result.provider === 'none' || result.text.trim() === '') {
    throw new Error('llm unavailable: no provider or empty response');
  }
  return result.text;
};

export interface OutcomeGradingDeps {
  ledger?: AlgorithmEvaluationLedger;
  llmFn?: LlmFn;
  now?: number;
  timeoutMs?: number;
  maxBatchSize?: number;
}

export interface OutcomeGradingResult {
  /** Records eligible (aged past timeout, no outcome) this run. */
  eligible: number;
  /** Records whose outcome was successfully written back. */
  graded: number;
}

/**
 * Grade pending ledger records via the LLM grader and write the outcomes
 * back. Safe to call repeatedly — already-graded records are skipped, and a
 * grading failure (e.g. no LLM available) leaves records pending for a later
 * run rather than forcing a garbage outcome.
 */
export async function runOutcomeGrading(deps: OutcomeGradingDeps = {}): Promise<OutcomeGradingResult> {
  const ledger = deps.ledger ?? getAlgorithmEvaluationLedger();
  const pending = ledger.pending();
  if (pending.length === 0) return { eligible: 0, graded: 0 };

  let resolutions;
  try {
    resolutions = await resolvePendingViaLlm(pending, {
      llmFn: deps.llmFn ?? defaultLlmFn,
      now: deps.now,
      timeoutMs: deps.timeoutMs,
      maxRecords: deps.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE,
    });
  } catch {
    // LLM unavailable / batch failed — leave records pending, retry next cycle.
    return { eligible: 0, graded: 0 };
  }

  let graded = 0;
  for (const r of resolutions) {
    // Don't persist an outcome when the LLM was unavailable — that's transient,
    // and writing 'inconclusive' would permanently remove the record from
    // pending without it ever being graded. Leave it for a later cycle.
    if (r.llm.llmUnavailable) continue;
    try {
      ledger.recordOutcome(r.record.id, r.ledgerOutcome, r.ledgerReason, deps.now);
      graded += 1;
    } catch {
      // Already graded or evicted — skip.
    }
  }
  return { eligible: resolutions.length, graded };
}

/** Default cadence. Eligibility is independently gated by the resolver's
 *  48h record-age timeout, so most ticks are cheap no-ops. */
const DEFAULT_CADENCE_MS = 60 * 60 * 1000; // hourly
const DEFAULT_MAX_BATCH_SIZE = 20;

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/** Start the periodic grading cadence (idempotent). Returns a stop fn. */
export function startOutcomeGradingCadence(intervalMs: number = DEFAULT_CADENCE_MS): () => void {
  if (_timer !== null) return stopOutcomeGradingCadence;
  _timer = setInterval(() => {
    // Re-entrancy guard: a grading batch can take longer than the interval
    // (LLM latency); skip ticks while one is in flight so the same pending
    // records aren't re-sent and cloud budget isn't burned twice.
    if (_running) return;
    _running = true;
    void runOutcomeGrading()
      .catch(() => { /* never let the cadence throw */ })
      .finally(() => { _running = false; });
  }, intervalMs);
  // Don't keep the process alive on this timer (no-op in browsers).
  (_timer as unknown as { unref?: () => void }).unref?.();
  return stopOutcomeGradingCadence;
}

export function stopOutcomeGradingCadence(): void {
  if (_timer !== null) {
    clearInterval(_timer);
    _timer = null;
  }
}
