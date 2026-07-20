/**
 * Superforecaster Pipeline — orchestrator.
 *
 * Produces a calibrated probability estimate for a hypothesis the way elite
 * human forecasters do:
 *
 *   1. Outside view: reference-class base rate (base-rates.ts), blended with
 *      the episodic analog score from PR 1.
 *   2. Inside view: LLM decomposition into 2–4 necessary conditions
 *      (decomposition.ts) — budget-gated.
 *   3. Persona elicitation: the three hypothesis-ensemble personas (analyst,
 *      skeptic, pragmatist) each give an explicit "probability": 0.XX alongside
 *      their qualitative take — budget-gated, 60-min signature cache reused
 *      from hypothesis-ensemble.ts.
 *   4. Aggregation: weighted geometric mean of odds + extremization
 *      (probability-aggregation.ts).
 *   5. Recalibration: final probability passes through PR 2's per-domain
 *      reliability curve (getRecalibrator from forecast-calibration-adapter.ts).
 *   6. Logging: every SuperForecast is recorded in the calibration store
 *      (getCalibrationStore().record(...), sourceId 'superforecast') so the
 *      system measurably self-improves over time.
 *
 * Degradation ladder (budget-gated):
 *   full           — base rate + decomposition + 3 persona probabilities
 *   partial        — base rate + some persona probabilities (budget ran out mid-run)
 *   deterministic-only — base rate + episodic + existing forecastHypothesis output
 *
 * The deterministic floor ALWAYS produces a result — the pipeline never returns
 * nothing because the budget ran out.
 *
 * Prompt-injection hardening: all feed-derived text is wrapped in <evidence>
 * tags per analyst-context-builder.ts convention.
 *
 * Design invariants (house plan):
 *   - Every probability carries an explanation trail.
 *   - Every estimate carries source + weight provenance.
 *   - Stale/missing data reduces confidence, never silently disappears.
 *   - No automatic cadence: expose superforecast(h) for on-demand callers.
 *     HUD wiring is PR 6. Cost control first.
 *
 * Per docs/COGNITIVE_ENHANCEMENT_PLAN.md PR 3.
 */

import type { Hypothesis } from '@/services/analyst-loop';
import { signatureFor } from '@/services/hypothesis-feedback';
import { recall, analogScoreFor } from '@/services/cognition/episodic-memory';
import { matchReferenceClass, blendWithEpisodic } from './base-rates';
import { decomposeHypothesis } from './decomposition';
import { sanitizeForPrompt } from '@/utils/prompt-sanitize';
import { aggregate } from './probability-aggregation';
import type { Estimate } from './probability-aggregation';
import { getRecalibrator } from '@/services/intelligence/forecast-calibration-adapter';
import { getCalibrationStore } from '@/services/intelligence/forecast-calibration-adapter';
import { forecastHypothesis } from '@/services/intelligence/hypothesis-forecast';
import type { GenerateTextFn } from './decomposition';
import { conformalInterval } from './conformal';
import type { ForecastInterval } from './conformal';
import { parseStrictJson } from './llm-json';
import { getTunedParam } from '@/services/algorithms/tunable-params-store';

// ── Types ──────────────────────────────────────────────────────────────────────

export type LlmTier = 'full' | 'partial' | 'deterministic-only';

/** The complete superforecaster output for one hypothesis. */
export interface SuperForecast {
  hypothesisId: string;
  /** Post-aggregation, post-recalibration probability. */
  probability: number;
  /** Full estimate provenance trail. */
  estimates: Estimate[];
  /** max − min across all estimates (surfaced per contradiction invariant). */
  spread: number;
  /** ID of the matched reference class (if any). */
  referenceClass?: string;
  /**
   * Human-readable chain: outside → inside → personas → aggregate → recalibrated.
   * Plan invariant: always non-empty.
   */
  explanation: string;
  /** Whether LLM calls succeeded fully, partially, or not at all. */
  llmTier: LlmTier;
  /**
   * Conformal prediction interval around `probability` (PR 7).
   * Present when the calibration store has enough resolved records.
   * Consumers should treat this as optional — it may be uninformative
   * (lo=0, hi=1) when history is insufficient.
   */
  interval?: ForecastInterval;
}

// ── Persona probability elicitation ───────────────────────────────────────────

type PersonaKind = 'analyst' | 'skeptic' | 'pragmatist';

const PERSONA_PROBABILITY_SYSTEMS: Record<PersonaKind, string> = {
  analyst:
    'You are a crisp geopolitical + financial analyst. ' +
    'Provide your probability estimate for the given hypothesis and a brief rationale.',
  skeptic:
    'You are a skeptical reviewer who is alert to overconfidence. ' +
    'Provide your probability estimate for the given hypothesis and note key counter-signals.',
  pragmatist:
    'You are a pragmatist who focuses on base rates and concrete evidence. ' +
    'Provide your probability estimate for the given hypothesis and cite the strongest evidence.',
};

/**
 * Build the persona probability elicitation prompt.
 * All feed-derived text is wrapped in <evidence> tags.
 *
 * Exported for prompt-fixtures tests (PR 15).
 */
export function buildPersonaPrompt(h: Hypothesis, persona: PersonaKind): string {
  const evidenceLines = h.evidence
    .slice(0, 6)
    .map(e => `  - [${sanitizeForPrompt(e.source, 40)}] ${sanitizeForPrompt(e.label, 200)}`)
    .join('\n');

  return (
    `${PERSONA_PROBABILITY_SYSTEMS[persona]}\n\n` +
    `Hypothesis (${h.kind}, ${h.risk} risk):\n` +
    `<evidence>\n` +
    `"${sanitizeForPrompt(h.statement, 280)}"\n` +
    `</evidence>\n\n` +
    `Supporting evidence:\n` +
    `<evidence>\n` +
    `${evidenceLines || '  (none)'}\n` +
    `</evidence>\n\n` +
    `IMPORTANT: respond ONLY with a JSON object in EXACTLY this format, no other text:\n` +
    `{ "probability": 0.XX, "rationale": "1-2 sentence reason" }\n\n` +
    `probability must be a decimal between 0.02 and 0.98.`
  );
}

// ── Persona response type ──────────────────────────────────────────────────────

interface PersonaResponse {
  probability: number;
  rationale?: string;
}

function isPersonaResponse(x: unknown): x is PersonaResponse {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  const p = Number(o.probability);
  return Number.isFinite(p) && p >= 0 && p <= 1;
}

/**
 * Parse a "probability": 0.XX response from a persona LLM call.
 * Uses the shared parseStrictJson with one repair attempt (PR 15).
 */
function parsePersonaProbability(text: string): number | null {
  const parsed = parseStrictJson<PersonaResponse>(text, isPersonaResponse);
  if (parsed === null) return null;
  const p = Number(parsed.probability);
  if (!Number.isFinite(p) || p < 0 || p > 1) return null;
  return Math.max(0.02, Math.min(0.98, p));
}

// ── Aggregate review prompt ────────────────────────────────────────────────────

/**
 * Build the aggregate-review prompt for the optional final LLM gate.
 * All feed-derived text is wrapped in <evidence> tags.
 * This is the ONLY call that may set preferCloud: true (difficulty routing).
 *
 * Exported for prompt-fixtures tests (PR 15).
 */
export function buildAggregateReviewPrompt(
  h: Hypothesis,
  aggregateP: number,
  estimates: readonly Estimate[],
): string {
  const estimateSummary = estimates
    .map(e => `  ${e.source}: ${(e.p * 100).toFixed(0)}% (weight ${e.weight.toFixed(1)})`)
    .join('\n');

  return (
    `You are a senior forecasting reviewer performing a final sanity check.\n\n` +
    `Review the aggregate probability for the following hypothesis and flag any obvious blunders.\n` +
    `Do NOT change the probability unless there is a clear error — conservative reviews are preferred.\n\n` +
    `Hypothesis (${h.kind}, ${h.risk} risk):\n` +
    `<evidence>\n` +
    `"${sanitizeForPrompt(h.statement, 280)}"\n` +
    `</evidence>\n\n` +
    `Individual estimates:\n` +
    `<evidence>\n` +
    `${estimateSummary}\n` +
    `</evidence>\n\n` +
    `Aggregate probability: ${(aggregateP * 100).toFixed(1)}%\n\n` +
    `IMPORTANT: respond ONLY with a JSON object in EXACTLY this format, no other text:\n` +
    `{ "keep": true/false, "adjustedP": 0.XX (optional), "reason": "1 sentence" }\n\n` +
    `Rules:\n` +
    `- If the aggregate looks reasonable, set keep=true and omit adjustedP.\n` +
    `- If you see a blunder, set keep=false and provide adjustedP.\n` +
    `- adjustedP must be within ±0.10 of ${aggregateP.toFixed(2)} (hard constraint).\n` +
    `- Do not include any text outside the JSON object.`
  );
}

// ── Aggregate review response type ────────────────────────────────────────────

interface AggregateReviewResponse {
  keep: boolean;
  adjustedP?: number;
  reason?: string;
}

function isAggregateReviewResponse(x: unknown): x is AggregateReviewResponse {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return typeof o.keep === 'boolean';
}

/**
 * Apply the aggregate review response to the aggregate probability.
 * Hard-clamps any adjustedP to ±0.10 of the original (plan invariant).
 */
export function applyAggregateReview(
  aggregateP: number,
  review: AggregateReviewResponse,
): number {
  if (review.keep || review.adjustedP === undefined) return aggregateP;
  const p = Number(review.adjustedP);
  if (!Number.isFinite(p)) return aggregateP;
  // Hard clamp: ±0.10 of the aggregate. Documented in this function.
  const MAX_DELTA = 0.1;
  const clamped = Math.max(aggregateP - MAX_DELTA, Math.min(aggregateP + MAX_DELTA, p));
  return Math.max(0.02, Math.min(0.98, clamped));
}

// ── Self-consistency median ────────────────────────────────────────────────────

/**
 * Compute the median of a sorted array of numbers.
 *
 * For odd-length arrays: returns the middle value (no averaging needed).
 * For even-length arrays: returns the lower of the two middle values to avoid
 * creating an artificial probability not in the original sample set.
 *
 * k=1: single sample → median = that sample → byte-identical to pre-PR-15 path.
 *
 * Exported for tests.
 */
export function medianOf(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  // Even length: lower middle (avoids synthetic intermediate probability).
  return sorted[mid - 1]!;
}

// ── Persona cache ──────────────────────────────────────────────────────────────
// Reuses the 60-min signature cache pattern from hypothesis-ensemble.ts.

type PersonaProbabilityCache = Record<string, {
    probabilities: Partial<Record<PersonaKind, number>>;
    generatedAt: number;
  }>;

const _personaCache: PersonaProbabilityCache = {};
const PERSONA_CACHE_MS = 60 * 60 * 1000; // 60 minutes

function getCachedPersonaProbabilities(
  sig: string,
): Partial<Record<PersonaKind, number>> | null {
  const entry = _personaCache[sig];
  if (!entry) return null;
  if (Date.now() - entry.generatedAt > PERSONA_CACHE_MS) return null;
  return entry.probabilities;
}

function cachePersonaProbabilities(
  sig: string,
  probabilities: Partial<Record<PersonaKind, number>>,
): void {
  _personaCache[sig] = { probabilities, generatedAt: Date.now() };
}

/** Clear persona cache (for tests). */
export function _clearPersonaCacheForTests(): void {
  for (const key of Object.keys(_personaCache)) {
    delete _personaCache[key];
  }
}

// ── LLM adapter injection ─────────────────────────────────────────────────────

let _generateTextOverride: GenerateTextFn | null = null;

/** Inject a fake generateText for tests. Pass null to restore the real adapter. */
export function _injectGenerateTextForTests(fn: GenerateTextFn | null): void {
  _generateTextOverride = fn;
}

async function getGenerateText(): Promise<GenerateTextFn | null> {
  if (_generateTextOverride !== null) return _generateTextOverride;
  try {
    const mod = await import('@/services/llm-adapter');
    return mod.generateText;
  } catch {
    return null;
  }
}

// ── Budget check ──────────────────────────────────────────────────────────────

async function isBudgetExhausted(): Promise<boolean> {
  try {
    const mod = await import('@/services/llm-budget');
    return mod.getBudgetStatus().exhausted;
  } catch {
    return false; // Fail open: assume budget is OK if module not available.
  }
}

// ── Calibration store logging ──────────────────────────────────────────────────

let _recordIdCounter = 0;

function genRecordId(hypothesisId: string): string {
  _recordIdCounter += 1;
  return `sf-${hypothesisId.slice(0, 12)}-${Date.now().toString(36)}-${_recordIdCounter}`;
}

function logToCalibrationStore(
  hypothesisId: string,
  probability: number,
  h: Hypothesis,
): void {
  try {
    const store = getCalibrationStore();
    const now = Date.now();
    // Horizon: 7 days default (hypothesis-level forecast).
    const resolveBy = now + 7 * 24 * 60 * 60 * 1000;
    store.record({
      id: genRecordId(hypothesisId),
      sourceId: 'superforecast',
      domain: 'other', // Hypotheses don't have a typed FactDomain; use 'other'.
      claim: h.statement.slice(0, 200),
      probability,
      predictedAt: now,
      resolveBy,
      status: 'pending',
      algorithmVersion: 'superforecast-v1',
    });
  } catch {
    // Never let calibration logging crash the pipeline.
  }
}

// ── Deterministic floor ────────────────────────────────────────────────────────

/**
 * Build the deterministic-only fallback estimates.
 * Uses: base rate (from reference class + episodic), and the existing
 * forecastHypothesis() output as a 'model-forecast' estimate.
 */
async function buildDeterministicEstimates(
  h: Hypothesis,
): Promise<{ estimates: Estimate[]; referenceClassId?: string; outsideExplanation: string }> {
  // Outside view: base rate + episodic blend.
  const recalls = await recall(h.statement, { k: 10, kinds: ['hypothesis'] });
  const analogScore = analogScoreFor(recalls);
  const analogN = recalls.filter(r => r.similarity >= 0.45 && r.episode.outcome !== undefined).length;

  const rc = matchReferenceClass(h);
  const { rate: outsideRate, explanation: outsideExplanation } = rc
    ? blendWithEpisodic(rc, analogScore, analogN)
    : {
        rate: analogScore ?? 0.28, // fallback prior
        explanation: analogScore === null
          ? 'no reference class matched; no episodic analogs — using 28% uninformative prior (superforecasting literature meta-analysis)'
          : `no reference class matched; using episodic analog score (${(analogScore * 100).toFixed(0)}% from ${analogN} analog(s))`,
      };

  const estimates: Estimate[] = [
    { source: 'base-rate', p: outsideRate, weight: 1 },
  ];

  // Model forecast from existing forecastHypothesis().
  try {
    const modelForecast = forecastHypothesis(h, null, analogScore);
    estimates.push({ source: 'model-forecast', p: modelForecast.probability, weight: 1 });
  } catch {
    // forecastHypothesis not available in test/isolated environments — skip.
  }

  return {
    estimates,
    referenceClassId: rc?.id,
    outsideExplanation,
  };
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

/**
 * Produce a SuperForecast for a hypothesis on demand.
 *
 * Degradation ladder:
 *   full            — all LLM calls succeeded
 *   partial         — budget exhausted mid-run; some persona calls skipped
 *   deterministic-only — LLM unavailable or budget exhausted before first call
 *
 * Never throws: all errors are caught and the pipeline degrades to the next rung.
 */
// The orchestrator is intentionally one linear degradation ladder (base-rate →
// decomposition → personas → aggregate → review → recalibrate → log); every rung
// is budget-gated and wrapped in its own try/catch that falls through to the
// next, sharing the explanation + estimate accumulators. Splitting it to satisfy
// the complexity threshold would scatter that shared state across helpers and
// obscure the ladder it exists to express. Behavior is pinned by the 492-test
// cognition suite; a structural decomposition is tracked separately.
// eslint-disable-next-line sonarjs/cognitive-complexity -- see justification above
export async function superforecast(h: Hypothesis): Promise<SuperForecast> {
  const sig = signatureFor(h);
  const explanationParts: string[] = [];

  // ── Step 1: Deterministic outside view (always runs) ─────────────────────

  const { estimates: baseEstimates, referenceClassId, outsideExplanation } =
    await buildDeterministicEstimates(h);
  explanationParts.push(`[outside] ${outsideExplanation}`);

  const allEstimates: Estimate[] = [...baseEstimates];
  let llmTier: LlmTier = 'deterministic-only';

  // ── Step 2: LLM calls (budget-gated) ────────────────────────────────────

  const budgetExhausted = await isBudgetExhausted();

  if (!budgetExhausted) {
    const generate = await getGenerateText();

    if (generate) {
      // Step 2a: Decomposition (inside view).
      try {
        const decomp = await decomposeHypothesis(h, generate);
        if (decomp !== null) {
          allEstimates.push({ source: 'decomposition', p: decomp.pInside, weight: 1 });
          explanationParts.push(`[inside] ${decomp.explanation}`);
          llmTier = 'partial';
        }
      } catch {
        // Decomposition failed — continue without it.
      }

      // Step 2b: Persona probability elicitation with self-consistency sampling (PR 15).
      //
      // Difficulty routing (PR 15): persona calls do NOT set preferCloud — they
      // run local-first. Only the final aggregate-review call (step 3b) may set
      // preferCloud: true. This is encoded here, not in the adapter.
      //
      // Self-consistency: for each persona, draw k samples (from the tunable store)
      // and take the median. k=1 is byte-identical to the pre-PR-15 path.

      const selfConsistencyK = Math.round(
        getTunedParam('superforecast', 'selfConsistencyK', 3),
      );

      const cachedPersonas = getCachedPersonaProbabilities(sig);
      const personaResults: Partial<Record<PersonaKind, number>> =
        cachedPersonas ? { ...cachedPersonas } : {};

      const personas: PersonaKind[] = ['analyst', 'skeptic', 'pragmatist'];
      let anyPersonaSucceeded = false;

      for (const persona of personas) {
        if (personaResults[persona] !== undefined) {
          anyPersonaSucceeded = true;
          continue; // Cache hit.
        }

        // Check budget before each persona.
        const stillBudget = !(await isBudgetExhausted());
        if (!stillBudget) break;

        // Self-consistency: collect up to k samples, stop early on budget exhaustion.
        const samples: number[] = [];
        const prompt = buildPersonaPrompt(h, persona);

        for (let sample = 0; sample < selfConsistencyK; sample++) {
          // For k=1: identical to the pre-PR-15 path (no extra budget checks, no median).
          if (sample > 0) {
            const budgetOk = !(await isBudgetExhausted());
            if (!budgetOk) break; // Use however many samples succeeded.
          }

          try {
            // No preferCloud — local-first (difficulty routing, PR 15).
            const res = await generate(prompt, { maxTokens: 200 });
            if (res.text && res.provider !== 'none') {
              const p = parsePersonaProbability(res.text);
              if (p !== null) samples.push(p);
            }
          } catch {
            // Sample failed — skip, use remaining samples.
          }
        }

        if (samples.length > 0) {
          // Compute median of samples.
          const p = medianOf(samples);
          personaResults[persona] = p;
          anyPersonaSucceeded = true;
        }
      }

      if (anyPersonaSucceeded || Object.keys(personaResults).length > 0) {
        // Cache whatever we got.
        if (Object.keys(personaResults).length > 0) {
          cachePersonaProbabilities(sig, personaResults);
        }

        // Add persona estimates.
        const personaSourceMap: Record<PersonaKind, Estimate['source']> = {
          analyst: 'persona-analyst',
          skeptic: 'persona-skeptic',
          pragmatist: 'persona-pragmatist',
        };
        for (const persona of personas) {
          const p = personaResults[persona];
          if (p !== undefined) {
            allEstimates.push({
              source: personaSourceMap[persona],
              p,
              weight: 1,
            });
          }
        }

        const personaSummary = personas
          .filter(p => personaResults[p] !== undefined)
          .map(p => `${p}=${(personaResults[p]! * 100).toFixed(0)}%`)
          .join(', ');
        const kNote = selfConsistencyK > 1 ? ` (k=${selfConsistencyK} samples, median)` : '';
        explanationParts.push(`[personas] ${personaSummary}${kNote}`);

        // Upgrade tier to 'full' if all three personas ran.
        const succeededPersonas = personas.filter(p => personaResults[p] !== undefined).length;
        if (succeededPersonas === 3 && llmTier === 'partial') {
          llmTier = 'full';
        } else if (succeededPersonas > 0) {
          llmTier = 'partial';
        }
      }
    }
  }

  // ── Step 3: Aggregate ────────────────────────────────────────────────────

  const { p: aggregatedP, spread, explanation: aggregationExplanation } = aggregate(allEstimates);
  explanationParts.push(`[aggregate] ${aggregationExplanation}`);

  // ── Step 3b: Optional aggregate-review call (difficulty routing, PR 15) ──
  //
  // This is the ONLY LLM call that may set preferCloud: true (the hardest
  // reasoning step, reviewing the aggregate for obvious blunders). It is
  // budget-gated and only fires when at least one persona succeeded (meaning
  // we have a meaningful aggregate to review).
  //
  // Hard clamp: adjustedP is restricted to ±0.10 of the aggregate.
  // Applied only when keep=false and an adjustedP is provided.

  let reviewedP = aggregatedP;
  try {
    const reviewBudgetOk = !(await isBudgetExhausted());
    const generate = await getGenerateText();
    const hasPersonaEstimates = allEstimates.some(
      e => e.source === 'persona-analyst' || e.source === 'persona-skeptic' || e.source === 'persona-pragmatist',
    );

    if (reviewBudgetOk && generate && hasPersonaEstimates) {
      // preferCloud: true — this is the one call allowed to use the cloud tier.
      const res = await generate(buildAggregateReviewPrompt(h, aggregatedP, allEstimates), {
        maxTokens: 150,
        preferCloud: true,
      });
      if (res.text && res.provider !== 'none') {
        const review = parseStrictJson<AggregateReviewResponse>(res.text, isAggregateReviewResponse);
        if (review !== null) {
          reviewedP = applyAggregateReview(aggregatedP, review);
          const reviewReasonSuffix = review.reason ? `: ${review.reason}` : '';
          if (reviewedP === aggregatedP) {
            explanationParts.push(`[review] kept aggregate${reviewReasonSuffix}`);
          } else {
            explanationParts.push(
              `[review] adjusted ${(aggregatedP * 100).toFixed(0)}% → ${(reviewedP * 100).toFixed(0)}%` +
              reviewReasonSuffix,
            );
          }
        }
      }
    }
  } catch {
    // Review failed — use the unadjusted aggregate.
  }

  // ── Step 4: Recalibrate (PR 2) ───────────────────────────────────────────

  let finalP = reviewedP;
  try {
    const recalibrator = getRecalibrator();
    const { p: recalibratedP, explanation: recalibrationExplanation } = recalibrator(reviewedP);
    finalP = recalibratedP;
    explanationParts.push(`[recalibrated] ${recalibrationExplanation}`);
  } catch {
    // Recalibration not available — use reviewed probability as-is.
    explanationParts.push(`[recalibrated] skipped (calibration adapter unavailable)`);
  }

  // ── Step 5: Log to calibration store ────────────────────────────────────

  logToCalibrationStore(h.id, finalP, h);

  // ── Step 6: Conformal prediction interval (PR 7) ─────────────────────────

  let interval: ForecastInterval | undefined;
  try {
    const store = getCalibrationStore();
    const allRecords = store.all();
    // Hypotheses are domain-agnostic ('other'); use the global pool.
    interval = conformalInterval(finalP, 'other', allRecords);
  } catch {
    // Never let interval computation crash the pipeline.
  }

  // ── Build result ─────────────────────────────────────────────────────────

  const explanation = explanationParts.join('\n');

  return {
    hypothesisId: h.id,
    probability: finalP,
    estimates: allEstimates,
    spread,
    referenceClass: referenceClassId,
    explanation,
    llmTier,
    interval,
  };
}
