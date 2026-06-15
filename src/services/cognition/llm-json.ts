/**
 * LLM JSON — shared strict JSON parser for cognition LLM responses.
 *
 * All cognition services that call generateText() and expect a JSON response
 * must use parseStrictJson<T> instead of hand-rolling JSON repair logic.
 *
 * Behavior:
 *   1. Direct JSON.parse attempt.
 *   2. On failure: ONE repair attempt —
 *      a. Strip markdown code fences (```json ... ``` or ``` ... ```).
 *      b. Extract outermost {...} or [...] via bracket matching.
 *      c. Try JSON.parse on the extracted text.
 *   3. Apply the caller-supplied type guard (validate).
 *   4. Return null on any failure — never throws, never loops.
 *
 * Bracket matching is bracket-count based (not regex): counts open/close
 * braces or brackets to find the first outermost balanced block, which is
 * more robust than a simple /\{[\s\S]*\}/ regex when the LLM emits nested
 * objects in its preamble text.
 *
 * Design invariants:
 *   - Pure function — no side effects, no imports from browser APIs.
 *   - Exactly one repair attempt: no loops, no recursion.
 *   - The validate type guard is the caller's contract; parseStrictJson
 *     cannot know what shape is expected without it.
 *   - Null means "couldn't parse or validate" — callers degrade gracefully.
 *
 * Per docs/COGNITIVE_ENHANCEMENT_PLAN.md PR 15.
 */

// ── Bracket extraction (more robust than simple regex) ─────────────────────────

/**
 * Find the first outermost balanced {...} or [...] block in the text.
 * Returns the extracted substring or null if none found.
 */
export function extractOutermostJsonBlock(text: string): string | null {
  for (const [open, close] of [
    ['{', '}'] as const,
    ['[', ']'] as const,
  ]) {
    const start = text.indexOf(open);
    if (start === -1) continue;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i]!;

      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

/**
 * Strip markdown code fences from LLM output.
 * Removes ```json, ```JSON, and plain ``` fences.
 */
export function stripMarkdownFences(text: string): string {
  // Remove opening fence with optional language tag.
  let stripped = text.replace(/^```(?:json)?\s*/im, '');
  // Remove closing fence.
  stripped = stripped.replace(/\s*```\s*$/im, '');
  return stripped.trim();
}

// ── Main API ───────────────────────────────────────────────────────────────────

/**
 * Parse and validate a JSON response from an LLM call.
 *
 * @param text     Raw LLM response text.
 * @param validate Type guard that asserts the parsed value is the expected type T.
 * @returns        The parsed and validated value, or null on any failure.
 *
 * @example
 * ```ts
 * interface PersonaResponse { probability: number; rationale: string; }
 * function isPersonaResponse(x: unknown): x is PersonaResponse {
 *   const o = x as Record<string, unknown>;
 *   return typeof o?.probability === 'number' && typeof o?.rationale === 'string';
 * }
 * const parsed = parseStrictJson(llmText, isPersonaResponse);
 * if (parsed === null) { // degrade gracefully }
 * ```
 */
export function parseStrictJson<T>(
  text: string,
  validate: (x: unknown) => x is T,
): T | null {
  // Attempt 1: direct parse.
  try {
    const parsed: unknown = JSON.parse(text);
    if (validate(parsed)) return parsed;
  } catch {
    // Fall through to repair.
  }

  // Attempt 2: one repair pass.
  // a. Strip markdown fences.
  const stripped = stripMarkdownFences(text);

  // b. Try stripped text directly first.
  if (stripped !== text) {
    try {
      const parsed: unknown = JSON.parse(stripped);
      if (validate(parsed)) return parsed;
    } catch {
      // Fall through to bracket extraction.
    }
  }

  // c. Extract outermost {...} or [...] via bracket matching.
  const extracted = extractOutermostJsonBlock(stripped.length > 0 ? stripped : text);
  if (extracted !== null && extracted !== text && extracted !== stripped) {
    try {
      const parsed: unknown = JSON.parse(extracted);
      if (validate(parsed)) return parsed;
    } catch {
      // Fall through to null.
    }
  }

  // All attempts exhausted.
  return null;
}
