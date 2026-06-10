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
import { aggregate } from './probability-aggregation';
import type { Estimate } from './probability-aggregation';
import { getRecalibrator } from '@/services/intelligence/forecast-calibration-adapter';
import { getCalibrationStore } from '@/services/intelligence/forecast-calibration-adapter';
import { forecastHypothesis } from '@/services/intelligence/hypothesis-forecast';
import type { GenerateTextFn } from './decomposition';

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
 */
function buildPersonaPrompt(h: Hypothesis, persona: PersonaKind): string {
  const evidenceLines = h.evidence
    .slice(0, 6)
    .map(e => `  - [${e.source}] ${e.label}`)
    .join('\n');

  return (
    `${PERSONA_PROBABILITY_SYSTEMS[persona]}\n\n` +
    `Hypothesis (${h.kind}, ${h.risk} risk):\n` +
    `<evidence>\n` +
    `"${h.statement}"\n` +
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

/** Parse a "probability": 0.XX response from a persona LLM call. */
function parsePersonaProbability(text: string): number | null {
  // First try: JSON parse.
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const p = Number(parsed['probability']);
    if (Number.isFinite(p) && p >= 0 && p <= 1) return Math.max(0.02, Math.min(0.98, p));
  } catch { /* fall through */ }

  // Repair attempt: extract outermost {…}.
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as Record<string, unknown>;
      const p = Number(parsed['probability']);
      if (Number.isFinite(p) && p >= 0 && p <= 1) return Math.max(0.02, Math.min(0.98, p));
    } catch { /* fall through */ }
  }

  // Last resort: regex scan for first decimal that looks like a probability.
  const probMatch = text.match(/["']?probability["']?\s*:\s*(0\.\d+|1\.0|0|1)\b/);
  if (probMatch?.[1]) {
    const p = Number(probMatch[1]);
    if (Number.isFinite(p) && p >= 0 && p <= 1) return Math.max(0.02, Math.min(0.98, p));
  }

  return null;
}

// ── Persona cache ──────────────────────────────────────────────────────────────
// Reuses the 60-min signature cache pattern from hypothesis-ensemble.ts.

interface PersonaProbabilityCache {
  [signature: string]: {
    probabilities: Partial<Record<PersonaKind, number>>;
    generatedAt: number;
  };
}

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
        rate: analogScore !== null ? analogScore : 0.28, // fallback prior
        explanation: analogScore !== null
          ? `no reference class matched; using episodic analog score (${(analogScore * 100).toFixed(0)}% from ${analogN} analog(s))`
          : 'no reference class matched; no episodic analogs — using 28% uninformative prior (superforecasting literature meta-analysis)',
      };

  const estimates: Estimate[] = [
    { source: 'base-rate', p: outsideRate, weight: 1.0 },
  ];

  // Model forecast from existing forecastHypothesis().
  try {
    const modelForecast = forecastHypothesis(h, null, analogScore);
    estimates.push({ source: 'model-forecast', p: modelForecast.probability, weight: 1.0 });
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
          allEstimates.push({ source: 'decomposition', p: decomp.pInside, weight: 1.0 });
          explanationParts.push(`[inside] ${decomp.explanation}`);
          llmTier = 'partial';
        }
      } catch {
        // Decomposition failed — continue without it.
      }

      // Step 2b: Persona probability elicitation (60-min cache).
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

        // Check budget before each call.
        const stillBudget = !(await isBudgetExhausted());
        if (!stillBudget) break;

        try {
          const res = await generate(buildPersonaPrompt(h, persona), { maxTokens: 200 });
          if (res.text && res.provider !== 'none') {
            const p = parsePersonaProbability(res.text);
            if (p !== null) {
              personaResults[persona] = p;
              anyPersonaSucceeded = true;
            }
          }
        } catch {
          // Persona call failed — skip and continue.
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
              weight: 1.0,
            });
          }
        }

        const personaSummary = personas
          .filter(p => personaResults[p] !== undefined)
          .map(p => `${p}=${(personaResults[p]! * 100).toFixed(0)}%`)
          .join(', ');
        explanationParts.push(`[personas] ${personaSummary}`);

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

  // ── Step 4: Recalibrate (PR 2) ───────────────────────────────────────────

  let finalP = aggregatedP;
  try {
    const recalibrator = getRecalibrator();
    const { p: recalibratedP, explanation: recalibrationExplanation } = recalibrator(aggregatedP);
    finalP = recalibratedP;
    explanationParts.push(`[recalibrated] ${recalibrationExplanation}`);
  } catch {
    // Recalibration not available — use aggregated probability as-is.
    explanationParts.push(`[recalibrated] skipped (calibration adapter unavailable)`);
  }

  // ── Step 5: Log to calibration store ────────────────────────────────────

  logToCalibrationStore(h.id, finalP, h);

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
  };
}
