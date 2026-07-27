/**
 * Evaluation-recording helper.
 *
 * Live algorithm call sites (orchestrators / wrappers, not pure
 * scorers) use this to log a decision into the singleton evaluation
 * ledger. The plan invariant is "keep pure modules pure" — so this
 * helper sits between the call site and the ledger, and never reaches
 * back into the algorithm internals.
 *
 *   recordAlgorithmEvaluation('truth-score', {
 *     score: 0.62,
 *     durationMs: 4,
 *     inputHash: 'sha1:abc…',
 *     detail: { sourceCount: 3 },
 *   });
 *
 * What it does:
 *   - Looks up the algorithm in the registry to populate
 *     `algorithmId`, `domain`, and `version` automatically.
 *   - Refuses to record raw large payloads (the `detail` field is
 *     bounded by JSON.stringify length; oversized callers get a clear
 *     error so they can hash the input instead).
 *   - Returns the recorded EvaluationRecord (with assigned id) so the
 *     caller can later append a ground-truth outcome via
 *     `ledger.recordOutcome(id, …)`.
 *
 * Pure with respect to the algorithm modules; touches only the
 * algorithms-state singleton. No DOM, no fetch.
 */

import { getAlgorithm } from './algorithm-registry';
import type {
  AlgorithmDomain,
  EvaluationOutcome,
  EvaluationOutcomeAttribution,
  EvaluationRecord,
  ForecastEvaluationTarget,
} from './algorithm-evaluation-ledger';
import { getAlgorithmEvaluationLedger } from './algorithms-state';

/** Bound the detail payload so a buggy caller can't inflate the
 *  diagnostics export bundle. 4 KB is generous for structured detail
 *  but rejects raw event payloads / source documents.  */
const MAX_DETAIL_BYTES = 4 * 1024;

export interface RecordEvaluationInput {
  /** Latency of the algorithm call in ms. */
  durationMs: number;
  /** Score the algorithm produced (typically 0..1). */
  score?: number;
  /** Discrete label the algorithm produced. */
  label?: string;
  /** Cheap hash / fingerprint of the inputs. The ledger never stores
   *  raw inputs — caller is responsible for hashing if a fingerprint
   *  is needed for replay. */
  inputHash?: string;
  /** Compact structured detail useful for replay/debug. Bounded to
   *  4 KB after JSON serialization; oversized payloads throw. */
  detail?: Record<string, unknown>;
  /** Free-text notes. Trimmed to 1 KB. */
  notes?: string;
  /** ms timestamp when the algorithm ran. Defaults to `Date.now()`. */
  at?: number;
  /** Override the registry version (useful for canary builds). */
  version?: string;
  /** Override the registry healthDomain (rare; e.g. cross-cutting
   *  algorithms that emit into multiple health domains). */
  domain?: AlgorithmDomain;
  /** Exact forecast target owned by the authoritative outcome bridge. */
  forecastTarget?: ForecastEvaluationTarget;
}

export class UnknownAlgorithmError extends Error {
  constructor(id: string) {
    super(`Algorithm "${id}" is not registered. Add it to algorithm-registry.ts before recording evaluations.`);
    this.name = 'UnknownAlgorithmError';
  }
}

export class DetailTooLargeError extends Error {
  constructor(bytes: number) {
    super(`Evaluation detail is ${bytes} bytes; ledger refuses payloads above ${MAX_DETAIL_BYTES}. Hash the input and pass inputHash instead.`);
    this.name = 'DetailTooLargeError';
  }
}

function clampNotes(notes?: string): string | undefined {
  if (typeof notes !== 'string') return undefined;
  return notes.length > 1024 ? notes.slice(0, 1024) : notes;
}

function checkDetailSize(detail?: Record<string, unknown>): void {
  if (!detail) return;
  const serialized = JSON.stringify(detail);
  if (serialized.length > MAX_DETAIL_BYTES) {
    throw new DetailTooLargeError(serialized.length);
  }
}

/**
 * Record an algorithm decision into the singleton ledger. Returns the
 * stored record so callers can later append an outcome.
 */
export function recordAlgorithmEvaluation(
  algorithmId: string,
  input: RecordEvaluationInput,
): EvaluationRecord {
  const def = getAlgorithm(algorithmId);
  if (!def) throw new UnknownAlgorithmError(algorithmId);
  checkDetailSize(input.detail);

  const ledger = getAlgorithmEvaluationLedger();
  return ledger.recordEvaluation({
    algorithmId,
    domain: input.domain ?? (def.healthDomain ?? 'other'),
    version: input.version ?? def.version,
    at: input.at ?? Date.now(),
    durationMs: input.durationMs,
    inputHash: input.inputHash,
    score: input.score,
    label: input.label,
    detail: input.detail,
    notes: clampNotes(input.notes),
    forecastTarget: input.forecastTarget,
  });
}

/**
 * Convenience: append an outcome to a previously recorded evaluation.
 * Throws when `recordId` is unknown or already has an outcome.
 */
export function recordAlgorithmOutcome(
  recordId: string,
  outcome: EvaluationOutcome,
  reason: string,
  at?: number,
  attribution?: EvaluationOutcomeAttribution,
): EvaluationRecord {
  return getAlgorithmEvaluationLedger().recordOutcome(
    recordId,
    outcome,
    reason,
    at,
    attribution,
  );
}

/**
 * Time an algorithm call and record the result in one step. The
 * caller's function returns its value AND the score/label/detail to
 * record; the helper handles `Date.now()` bracketing. Errors thrown
 * inside the algorithm propagate to the caller — we don't swallow
 * them, but we DO record an evaluation marked as label='error' so the
 * health aggregator sees the failure.
 */
export async function timeAndRecord<T>(
  algorithmId: string,
  fn: () => Promise<T> | T,
  describe: (result: T) => Omit<RecordEvaluationInput, 'durationMs' | 'at'>,
): Promise<{ result: T; record: EvaluationRecord }> {
  const at = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - at;
    const meta = describe(result);
    const record = recordAlgorithmEvaluation(algorithmId, { ...meta, durationMs, at });
    return { result, record };
  } catch (error) {
    const durationMs = Date.now() - at;
    recordAlgorithmEvaluation(algorithmId, {
      durationMs,
      at,
      label: 'error',
      notes: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
