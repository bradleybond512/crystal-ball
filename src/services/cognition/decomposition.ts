/**
 * Decomposition — LLM "inside view" for the superforecaster pipeline.
 *
 * Asks the LLM to decompose a hypothesis into 2–4 necessary conditions,
 * each with a probability. The conjunction of these conditions produces a
 * composite probability that represents the inside view of how likely the
 * hypothesis is to materialize.
 *
 * Conjunction with a dependence correction:
 *   p_inside = (Π p_i)^(1/√n)
 *
 * The exponent 1/√n is a deliberate dependence correction: conditions in the
 * same forecast are never truly independent (they share causal ancestors and
 * evidence sources). Multiplying their raw probabilities assumes independence
 * and would underestimate p_inside when conditions are correlated. The
 * geometric mean over the product — via the (1/√n) exponent — shrinks the
 * conjunction toward the arithmetic mean of the individual p_i values, which
 * is a pragmatic and widely-used approximation when true correlations are
 * unknown. (n=1: no correction; n=4: exponent = 0.5 = square root of product.)
 *
 * Defensive parsing (like hypothesis-projection.ts repair pattern):
 *   1. Parse the raw LLM response as JSON.
 *   2. On failure: extract the outermost `{…}` or `[…]` block with regex and
 *      try again.
 *   3. On second failure: return null. The orchestrator proceeds without the
 *      inside view.
 *
 * Prompt-injection hardening: all feed-derived text is wrapped in <evidence>
 * tags per analyst-context-builder.ts convention.
 *
 * Design invariants (house plan):
 *   - Pure deterministic except the generateText() call.
 *   - generateText() is injectable for tests (accept a parameter).
 *   - Every output carries an explanation.
 *   - Stale/missing data returns null gracefully rather than crashing.
 *
 * Per docs/COGNITIVE_ENHANCEMENT_PLAN.md PR 3.
 */

import type { HypothesisLike } from './base-rates';
import type { LlmResult } from '@/services/llm-adapter';
import { parseStrictJson } from './llm-json';
import { sanitizeForPrompt } from '@/utils/prompt-sanitize';

// ── Types ──────────────────────────────────────────────────────────────────────

/** A single necessary condition in the decomposition. */
export interface DecompositionCondition {
  /** Short label for the condition. */
  label: string;
  /** Probability the condition holds (0–1). */
  probability: number;
  /** Optional brief rationale. */
  rationale?: string;
}

/** The result of decomposing a hypothesis into necessary conditions. */
export interface DecompositionResult {
  conditions: DecompositionCondition[];
  /**
   * Conjunction probability with dependence correction:
   * p_inside = (Π p_i)^(1/√n)
   *
   * This is the "inside view" probability estimate from the decomposition.
   */
  pInside: number;
  explanation: string;
}

// ── LLM adapter interface (injectable for tests) ───────────────────────────────

export type GenerateTextFn = (
  prompt: string,
  options?: { maxTokens?: number; preferCloud?: boolean },
) => Promise<LlmResult>;

// ── Prompt construction ────────────────────────────────────────────────────────

/**
 * Build the decomposition prompt. All feed-derived text is wrapped in
 * <evidence> tags for prompt-injection hardening.
 */
export function buildDecompositionPrompt(h: HypothesisLike & { statement: string }): string {
  const evidenceSection = (() => {
    if ('evidence' in h && Array.isArray((h as unknown as { evidence: { source: string; label: string }[] }).evidence)) {
      const evArr = (h as unknown as { evidence: { source: string; label: string }[] }).evidence;
      return evArr
        .slice(0, 6)
        .map((e) => `  - [${sanitizeForPrompt(e.source, 40)}] ${sanitizeForPrompt(e.label, 200)}`)
        .join('\n');
    }
    return '  (none provided)';
  })();

  return (
    `You are a structured forecasting assistant applying the superforecaster method.\n\n` +
    `Break the following hypothesis into 2–4 NECESSARY AND SUFFICIENT conditions.\n` +
    `Each condition must independently need to hold for the hypothesis to materialize.\n` +
    `Assign a probability (0.00–1.00) to each condition.\n\n` +
    `Hypothesis (kind: ${h.kind}):\n` +
    `<evidence>\n` +
    `"${sanitizeForPrompt(h.statement, 280)}"\n` +
    `</evidence>\n\n` +
    `Supporting evidence:\n` +
    `<evidence>\n` +
    `${evidenceSection}\n` +
    `</evidence>\n\n` +
    `IMPORTANT: respond ONLY with a JSON object in EXACTLY this format, no other text:\n` +
    `{\n` +
    `  "conditions": [\n` +
    `    { "label": "condition name", "probability": 0.XX, "rationale": "1 sentence why" },\n` +
    `    ...\n` +
    `  ]\n` +
    `}\n\n` +
    `Rules:\n` +
    `- 2 to 4 conditions, no more, no less\n` +
    `- Each probability must be a number between 0.02 and 0.98\n` +
    `- Conditions must be specific and falsifiable\n` +
    `- Do not include any text outside the JSON object`
  );
}

// ── JSON repair ────────────────────────────────────────────────────────────────

/**
 * Try to parse JSON, and if that fails attempt to extract the outermost
 * JSON object or array (one repair attempt, via llm-json.ts).
 * Returns null on complete failure.
 *
 * @deprecated Use parseStrictJson from llm-json.ts with an explicit type guard.
 * This wrapper is retained for backward compatibility with existing tests and
 * call sites that relied on the untyped form. New code must use parseStrictJson.
 */
export function tryParseJson(raw: string): unknown | null {
  // Delegate to the shared strict parser with an identity validator
  // (accept anything that parses — the caller validates structure separately).
  return parseStrictJson<unknown>(raw, (x): x is unknown => x !== null && x !== undefined);
}

// ── Response validation ────────────────────────────────────────────────────────

interface RawCondition {
  label?: unknown;
  probability?: unknown;
  rationale?: unknown;
}

function isValidRawCondition(v: unknown): v is RawCondition {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return typeof c['label'] === 'string' && typeof c['probability'] === 'number';
}

function validateConditions(parsed: unknown): DecompositionCondition[] | null {
  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;
  const rawConditions: unknown[] = Array.isArray(obj['conditions'])
    ? (obj['conditions'] as unknown[])
    : Array.isArray(parsed)
      ? (parsed as unknown[])
      : [];

  if (rawConditions.length < 2 || rawConditions.length > 4) return null;

  const conditions: DecompositionCondition[] = [];
  for (const raw of rawConditions) {
    if (!isValidRawCondition(raw)) return null;
    const p = Number(raw.probability);
    if (!Number.isFinite(p) || p < 0 || p > 1) return null;
    conditions.push({
      label: String(raw.label).slice(0, 120),
      probability: Math.max(0.02, Math.min(0.98, p)),
      rationale: typeof raw.rationale === 'string' ? raw.rationale.slice(0, 200) : undefined,
    });
  }

  return conditions;
}

// ── Conjunction with dependence correction ─────────────────────────────────────

/**
 * Compute the conjunction probability with a dependence correction.
 *
 * Formula: p_inside = (Π p_i)^(1/√n)
 *
 * Conditions in a hypothesis decomposition are never truly independent —
 * they share causal ancestors and evidence sources. Raw conjunction
 * (Π p_i) assumes independence and would severely underestimate the joint
 * probability when conditions are correlated. The (1/√n) exponent is a
 * pragmatic correction: it shrinks the product toward the geometric mean
 * of the individual probabilities, assuming intermediate correlation.
 *
 * Special cases:
 *   n=1 → exponent=1 → p_inside = p_0 (identity, no correction needed)
 *   n=2 → exponent≈0.707 → moderate correction
 *   n=4 → exponent=0.5 → product is square-rooted (strong correction)
 */
export function conjunctionWithDependenceCorrection(
  conditions: readonly DecompositionCondition[],
): number {
  if (conditions.length === 0) return 0;
  if (conditions.length === 1) return conditions[0]!.probability;

  const n = conditions.length;
  const product = conditions.reduce((acc, c) => acc * c.probability, 1);

  // Apply 1/√n exponent (dependence correction).
  const exponent = 1 / Math.sqrt(n);
  return Math.max(0.02, Math.min(0.98, Math.pow(product, exponent)));
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Decompose a hypothesis into 2–4 necessary conditions via one LLM call.
 *
 * Returns null when:
 *   - The LLM call fails or returns empty text (budget exhausted, provider 'none').
 *   - The response cannot be parsed as valid JSON after one repair attempt.
 *   - The parsed conditions are not 2–4 in count or have invalid probabilities.
 *
 * In all failure cases, the orchestrator proceeds without the inside view —
 * the pipeline degrades gracefully rather than crashing.
 *
 * @param h             The hypothesis to decompose.
 * @param generateTextFn Injectable generateText for tests (defaults to the real adapter).
 */
export async function decomposeHypothesis(
  h: HypothesisLike & { statement: string },
  generateTextFn?: GenerateTextFn,
): Promise<DecompositionResult | null> {
  // Lazy import the real adapter if no mock is injected.
  const generate = generateTextFn ?? await importGenerateText();
  if (!generate) return null;

  let responseText: string;
  try {
    const result = await generate(buildDecompositionPrompt(h), { maxTokens: 500 });
    if (!result.text || result.provider === 'none') return null;
    responseText = result.text;
  } catch {
    return null;
  }

  // Parse and validate using the shared strict parser.
  // The validator runs validateConditions internally to keep behavior identical.
  interface RawDecompositionResponse { conditions: unknown[] }
  const parsed = parseStrictJson<RawDecompositionResponse>(
    responseText,
    (x): x is RawDecompositionResponse =>
      x !== null &&
      typeof x === 'object' &&
      !Array.isArray(x) &&
      Array.isArray((x as Record<string, unknown>)['conditions']),
  );
  const conditions = validateConditions(parsed);
  if (!conditions || conditions.length < 2) return null;

  const pInside = conjunctionWithDependenceCorrection(conditions);
  const conditionSummary = conditions
    .map(c => `${c.label} (${(c.probability * 100).toFixed(0)}%)`)
    .join(', ');
  const n = conditions.length;
  const exponent = (1 / Math.sqrt(n)).toFixed(3);

  const explanation =
    `inside view: ${n} conditions [${conditionSummary}]; ` +
    `conjunction with dependence correction (1/√${n} = ${exponent}) → ` +
    `p_inside = ${(pInside * 100).toFixed(0)}%`;

  return { conditions, pInside, explanation };
}

// ── Lazy adapter import (avoids circular deps in tests) ───────────────────────

async function importGenerateText(): Promise<GenerateTextFn | null> {
  try {
    const mod = await import('@/services/llm-adapter');
    return mod.generateText;
  } catch {
    return null;
  }
}
