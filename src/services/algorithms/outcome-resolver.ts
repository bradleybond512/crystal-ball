/**
 * Outcome Resolver — minimal stub for PR 14.
 *
 * The full outcome-resolver is being built in a parallel session
 * (foundation PRs 3–10). This module provides just enough surface for
 * PR 14's LLM grader to wire into: routing pending records older
 * than a configurable timeout to the LLM grading path. The inline
 * router here is a placeholder — the full pipeline lands with
 * foundation PRs 3–10.
 *
 * Pure deterministic.
 */

import type { EvaluationRecord, EvaluationOutcome } from './algorithm-evaluation-ledger.ts';
import {
  gradeWithLlm,
  llmGradeToLedgerOutcome,
  type LlmFn,
  type LlmGradeInput,
  type LlmGradeResult,
} from './llm-grader.ts';

// ── Public types ──────────────────────────────────────────────────────

export interface ResolveOptions {
  /** Records older than this without an outcome are eligible for LLM
   *  grading. Default 48h. */
  timeoutMs?: number;
  /** Reference time for "now". */
  now?: number;
  /** LLM call function. When omitted, every eligible record gets the
   *  unavailable fallback. */
  llmFn?: LlmFn;
  /** Acceptance threshold passed through to the grader. */
  acceptanceThreshold?: number;
  /** Maximum records to send to the LLM in one pass. Oldest eligible
   *  records are processed first. */
  maxRecords?: number;
}

export interface ResolutionEntry {
  record: EvaluationRecord;
  llm: LlmGradeResult;
  ledgerOutcome: EvaluationOutcome;
  ledgerReason: string;
}

export const DEFAULT_OUTCOME_TIMEOUT_MS = 48 * 60 * 60 * 1000;

// ── API ───────────────────────────────────────────────────────────────

/** Pick the records that have aged past the timeout without an
 *  outcome. Pure function. */
export function pickEligibleForLlmGrading(
  records: readonly EvaluationRecord[],
  options: { timeoutMs?: number; now?: number } = {},
): EvaluationRecord[] {
  const timeoutMs = options.timeoutMs ?? DEFAULT_OUTCOME_TIMEOUT_MS;
  const now = options.now ?? Date.now();
  const cutoff = now - timeoutMs;
  return records.filter((r) => r.outcome === undefined && r.at <= cutoff);
}

/** Resolve a batch of pending records via the LLM grader. */
export async function resolvePendingViaLlm(
  records: readonly EvaluationRecord[],
  options: ResolveOptions = {},
): Promise<ResolutionEntry[]> {
  const eligible = pickEligibleForLlmGrading(records, {
    timeoutMs: options.timeoutMs,
    now: options.now,
  })
    .sort((a, b) => a.at - b.at)
    .slice(0, Math.max(0, options.maxRecords ?? Number.POSITIVE_INFINITY));
  const llmFn: LlmFn = options.llmFn ?? unavailableLlmFn;

  const out: ResolutionEntry[] = [];
  for (const r of eligible) {
    const input: LlmGradeInput = buildGradeInput(r);
    const llm = await gradeWithLlm(input, llmFn, {
      acceptanceThreshold: options.acceptanceThreshold,
      now: () => options.now ?? Date.now(),
    });
    out.push({
      record: r,
      llm,
      ledgerOutcome: llmGradeToLedgerOutcome(llm.grade),
      ledgerReason: `llm-grader: ${llm.reasoning}`,
    });
  }
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────

function buildGradeInput(r: EvaluationRecord): LlmGradeInput {
  const evidence: { kind: string; summary: string; at?: number }[] = [];
  if (r.label) evidence.push({ kind: 'label', summary: r.label, at: r.at });
  if (r.notes) evidence.push({ kind: 'notes', summary: r.notes, at: r.at });
  if (r.score !== undefined) {
    evidence.push({ kind: 'score', summary: `score=${r.score.toFixed(3)}`, at: r.at });
  }
  return {
    eventId: r.id,
    algorithmId: r.algorithmId,
    decision: r.label ?? `score=${r.score ?? 'n/a'}`,
    evidence,
  };
}

const unavailableLlmFn: LlmFn = (): Promise<string> =>
  Promise.reject(new Error('No llmFn configured (Ollama unavailable)'));
