/**
 * LLM-Graded Outcomes — PR 14.
 *
 * For events where ground truth is ambiguous (geopolitical / conflict
 * escalation), use the local Ollama LLM to grade the algorithm's
 * decision after a timeout. Returns INCONCLUSIVE gracefully when the
 * LLM is unavailable or its self-reported confidence is below the
 * acceptance threshold.
 *
 * Pure deterministic when given a deterministic llmFn. The default
 * production llmFn is a thin wrapper around the LLM adapter and is
 * only resolved lazily in non-test runtime.
 */

import type { EvaluationOutcome } from './algorithm-evaluation-ledger.ts';

// ── Public types ──────────────────────────────────────────────────────

export type LlmGrade = 'TRUE_POSITIVE' | 'FALSE_POSITIVE' | 'INCONCLUSIVE';

export interface LlmGradeInput {
  algorithmId: string;
  /** Free-form description of the original decision the algorithm
   *  made. */
  decision: string;
  /** Evidence rows the LLM should consider. Keep payloads small. */
  evidence: readonly { kind: string; summary: string; at?: number }[];
  /** Original event id (passed back for traceability). */
  eventId: string;
}

export interface LlmGradeResult {
  eventId: string;
  algorithmId: string;
  grade: LlmGrade;
  confidence: number;
  reasoning: string;
  /** True when the LLM responded with a confidence below the
   *  acceptance threshold and we forced INCONCLUSIVE. */
  belowConfidenceThreshold: boolean;
  /** True when the LLM call itself failed (Ollama unavailable). */
  llmUnavailable: boolean;
  generatedAt: number;
}

export type LlmFn = (prompt: string) => Promise<string>;

export interface LlmGraderOptions {
  /** Minimum self-reported confidence to accept the LLM's grade. */
  acceptanceThreshold?: number;
  now?: () => number;
}

const DEFAULT_THRESHOLD = 0.75;

// ── Prompt construction ───────────────────────────────────────────────

/** Build the structured JSON prompt the LLM is asked to grade. The
 *  shape is stable so the parser can rely on the LLM echoing back the
 *  same fields. */
export function buildLlmGradePrompt(input: LlmGradeInput): string {
  const payload = {
    algorithmId: input.algorithmId,
    eventId: input.eventId,
    decision: input.decision,
    evidence: input.evidence,
    question: 'Did this prediction come true?',
    instructions:
      'Reply with strict JSON: { "grade": "TRUE_POSITIVE" | "FALSE_POSITIVE" | "INCONCLUSIVE", "confidence": <number 0..1>, "reasoning": <short string> }. Do not include any other text.',
  };
  return JSON.stringify(payload, null, 2);
}

// ── Response parsing ──────────────────────────────────────────────────

/** Parse a raw LLM response string. Returns the parsed grade or
 *  INCONCLUSIVE on any failure. */
export function parseLlmGradeResponse(raw: string): {
  grade: LlmGrade;
  confidence: number;
  reasoning: string;
  malformed: boolean;
} {
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    return { grade: 'INCONCLUSIVE', confidence: 0, reasoning: 'unparseable LLM response', malformed: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
  } catch {
    return { grade: 'INCONCLUSIVE', confidence: 0, reasoning: 'invalid JSON in LLM response', malformed: true };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { grade: 'INCONCLUSIVE', confidence: 0, reasoning: 'non-object LLM response', malformed: true };
  }
  const obj = parsed as Record<string, unknown>;
  const grade = normalizeGrade(obj.grade);
  if (!grade) {
    return { grade: 'INCONCLUSIVE', confidence: 0, reasoning: 'unrecognized grade label', malformed: true };
  }
  const confidence = typeof obj.confidence === 'number' ? clamp01(obj.confidence) : 0;
  const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';
  return { grade, confidence, reasoning, malformed: false };
}

function normalizeGrade(x: unknown): LlmGrade | null {
  if (typeof x !== 'string') return null;
  const normalized = x.trim().toUpperCase();
  if (normalized === 'TRUE_POSITIVE' || normalized === 'FALSE_POSITIVE' || normalized === 'INCONCLUSIVE') {
    return normalized;
  }
  return null;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ── Top-level grader ──────────────────────────────────────────────────

/** Build the prompt, call the LLM, parse, and apply confidence
 *  gating. Falls back to INCONCLUSIVE on any failure path. */
export async function gradeWithLlm(
  input: LlmGradeInput,
  llmFn: LlmFn,
  options: LlmGraderOptions = {},
): Promise<LlmGradeResult> {
  const threshold = options.acceptanceThreshold ?? DEFAULT_THRESHOLD;
  const now = (options.now ?? (() => Date.now()))();
  const prompt = buildLlmGradePrompt(input);

  let raw: string;
  try {
    raw = await llmFn(prompt);
  } catch (error) {
    return {
      eventId: input.eventId,
      algorithmId: input.algorithmId,
      grade: 'INCONCLUSIVE',
      confidence: 0,
      reasoning: `llm unavailable: ${String((error as Error)?.message ?? error)}`,
      belowConfidenceThreshold: false,
      llmUnavailable: true,
      generatedAt: now,
    };
  }

  const parsed = parseLlmGradeResponse(raw);
  const belowThreshold = parsed.confidence < threshold && parsed.grade !== 'INCONCLUSIVE';
  const finalGrade: LlmGrade = belowThreshold ? 'INCONCLUSIVE' : parsed.grade;
  return {
    eventId: input.eventId,
    algorithmId: input.algorithmId,
    grade: finalGrade,
    confidence: parsed.confidence,
    reasoning: belowThreshold
      ? `${parsed.reasoning} (below threshold ${threshold}, downgraded to INCONCLUSIVE)`
      : parsed.reasoning,
    belowConfidenceThreshold: belowThreshold,
    llmUnavailable: false,
    generatedAt: now,
  };
}

/** Map a final LlmGrade → ledger EvaluationOutcome. */
export function llmGradeToLedgerOutcome(g: LlmGrade): EvaluationOutcome {
  switch (g) {
    case 'TRUE_POSITIVE': {
      return 'hit';
    }
    case 'FALSE_POSITIVE': {
      return 'miss';
    }
    case 'INCONCLUSIVE': {
      return 'inconclusive';
    }
  }
}

// ── Result cache (sidecar mirror) ─────────────────────────────────────

const llmGradesByEvent = new Map<string, LlmGradeResult>();

export function recordLlmGrade(result: LlmGradeResult): void {
  llmGradesByEvent.set(result.eventId, { ...result });
}

export function getLlmGrade(eventId: string): LlmGradeResult | undefined {
  return llmGradesByEvent.get(eventId);
}

export function listLlmGrades(): LlmGradeResult[] {
  return [...llmGradesByEvent.values()];
}

export function _resetLlmGradeCacheForTests(): void {
  llmGradesByEvent.clear();
}
