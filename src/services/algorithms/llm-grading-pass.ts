import { resolvePendingViaLlm, pickEligibleForLlmGrading } from './outcome-resolver';
import type { AlgorithmEvaluationLedger } from './algorithm-evaluation-ledger';
import { getAlgorithmEvaluationLedger } from './algorithms-state';
import type { LlmFn } from './llm-grader';
import { generateText } from '@/services/llm-adapter';

export interface LlmGradingPassOptions {
  ledger?: AlgorithmEvaluationLedger;
  llmFn?: LlmFn;
  now?: number;
  maxPerPass?: number;
}

export interface LlmGradingPassResult {
  eligible: number;
  graded: number;
  failed: number;
}

const defaultLlmFn: LlmFn = async (prompt: string): Promise<string> => {
  const result = await generateText(prompt);
  if (result.provider === 'none' || result.text.trim() === '') {
    throw new Error('llm unavailable: no provider or empty response');
  }
  return result.text;
};

export async function runLlmGradingPass(options: LlmGradingPassOptions = {}): Promise<LlmGradingPassResult> {
  const ledger = options.ledger ?? getAlgorithmEvaluationLedger();
  const maxPerPass = options.maxPerPass ?? 5;
  const llmFn = options.llmFn ?? defaultLlmFn;

  const eligible = pickEligibleForLlmGrading(ledger.all(), { now: options.now });
  const batch = eligible.slice(0, maxPerPass);

  const resolutions = await resolvePendingViaLlm(batch, {
    now: options.now,
    llmFn,
  });

  let graded = 0;
  let failed = 0;

  for (const e of resolutions) {
    // Transient failures: LLM unavailable, or INCONCLUSIVE with zero/low confidence
    // (parse failures produce confidence=0 and grade=INCONCLUSIVE without setting
    // belowConfidenceThreshold because that flag only triggers when a non-INCONCLUSIVE
    // grade is downgraded). Skip both so the next 12h pass can retry.
    if (e.llm.llmUnavailable) {
      failed += 1;
      continue;
    }
    if (e.llm.grade === 'INCONCLUSIVE' && (e.llm.belowConfidenceThreshold || e.llm.confidence === 0)) {
      failed += 1;
      continue;
    }
    try {
      ledger.recordOutcome(e.record.id, e.ledgerOutcome, e.ledgerReason, options.now);
      graded += 1;
    } catch {
      // Already graded or evicted — skip.
    }
  }

  return { eligible: eligible.length, graded, failed };
}

const CADENCE_MS = 12 * 60 * 60 * 1000;
let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

export function startLlmGradingCadence(intervalMs: number = CADENCE_MS): () => void {
  if (_timer !== null) return stopLlmGradingCadence;
  _timer = setInterval(() => {
    if (_running) return;
    _running = true;
    void runLlmGradingPass()
      .catch(() => undefined)
      .finally(() => { _running = false; });
  }, intervalMs);
  (_timer as unknown as { unref?: () => void }).unref?.();
  return stopLlmGradingCadence;
}

export function stopLlmGradingCadence(): void {
  if (_timer !== null) {
    clearInterval(_timer);
    _timer = null;
  }
}
