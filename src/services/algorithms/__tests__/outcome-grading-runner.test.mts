import assert from 'node:assert/strict';
import test from 'node:test';

import { createAlgorithmEvaluationLedger } from '../algorithm-evaluation-ledger.ts';
import { runOutcomeGrading } from '../outcome-grading-runner.ts';
import type { LlmFn } from '../llm-grader.ts';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

function seededLedger() {
  const ledger = createAlgorithmEvaluationLedger({ now: () => T0 });
  ledger.recordEvaluation({ algorithmId: 'test-algo', domain: 'other', at: T0, durationMs: 2, score: 0.7, label: 'matched' });
  ledger.recordEvaluation({ algorithmId: 'test-algo', domain: 'other', at: T0, durationMs: 3, score: 0.4, label: 'quiet' });
  return ledger;
}

const acceptingLlm: LlmFn = async () =>
  JSON.stringify({ grade: 'TRUE_POSITIVE', confidence: 0.95, reasoning: 'confirmed' });

test('grades pending records past the timeout and writes outcomes back', async () => {
  const ledger = seededLedger();
  assert.equal(ledger.pending().length, 2);

  const res = await runOutcomeGrading({
    ledger,
    llmFn: acceptingLlm,
    now: T0 + 49 * HOUR, // past the 48h default timeout
    timeoutMs: 48 * HOUR,
  });

  assert.equal(res.eligible, 2);
  assert.equal(res.graded, 2);
  assert.equal(ledger.pending().length, 0);
  assert.equal(ledger.graded().length, 2);
  assert.ok(ledger.graded().every((record) => record.outcomeOrigin === 'llm'));
});

test('does not grade records that have not aged past the timeout', async () => {
  const ledger = seededLedger();
  const res = await runOutcomeGrading({
    ledger,
    llmFn: acceptingLlm,
    now: T0 + 1 * HOUR,
    timeoutMs: 48 * HOUR,
  });
  assert.equal(res.eligible, 0);
  assert.equal(res.graded, 0);
  assert.equal(ledger.pending().length, 2);
});

test('LLM fallback never grades records owned by an exact forecast outcome link', async () => {
  const ledger = createAlgorithmEvaluationLedger({ now: () => T0 });
  ledger.recordEvaluation({
    algorithmId: 'analyst-loop',
    domain: 'forecast_calibration',
    version: '2.0.0',
    at: T0,
    durationMs: 0,
    score: 0.7,
    forecastTarget: {
      predictionId: 'prediction-1',
      targetKey: 'target-1',
      predictedAt: T0,
      resolveBy: T0 + HOUR,
    },
  });
  let calls = 0;

  const result = await runOutcomeGrading({
    ledger,
    llmFn: async () => {
      calls += 1;
      return acceptingLlm('');
    },
    now: T0 + 49 * HOUR,
    timeoutMs: 48 * HOUR,
  });

  assert.deepEqual(result, { eligible: 0, graded: 0 });
  assert.equal(calls, 0);
  assert.equal(ledger.pending().length, 1);
});

test('leaves records pending when the LLM is unavailable (no false inconclusive)', async () => {
  const ledger = seededLedger();
  const throwingLlm: LlmFn = async () => { throw new Error('llm down'); };
  const res = await runOutcomeGrading({
    ledger,
    llmFn: throwingLlm,
    now: T0 + 49 * HOUR,
    timeoutMs: 48 * HOUR,
  });
  assert.equal(res.graded, 0);
  assert.equal(ledger.pending().length, 2);
  assert.equal(ledger.graded().length, 0);
});

test('no-op on an empty ledger', async () => {
  const ledger = createAlgorithmEvaluationLedger({ now: () => T0 });
  const res = await runOutcomeGrading({ ledger, llmFn: acceptingLlm, now: T0 });
  assert.deepEqual(res, { eligible: 0, graded: 0 });
});

test('bounds each LLM grading pass so a retained cohort cannot exhaust the provider', async () => {
  const ledger = createAlgorithmEvaluationLedger({ now: () => T0 });
  for (let index = 0; index < 5; index += 1) {
    ledger.recordEvaluation({
      algorithmId: 'test-algo',
      domain: 'other',
      at: T0 + index,
      durationMs: 2,
      label: `row-${index}`,
    });
  }
  let calls = 0;
  const countingLlm: LlmFn = async () => {
    calls += 1;
    return JSON.stringify({ grade: 'TRUE_POSITIVE', confidence: 0.95, reasoning: 'confirmed' });
  };

  const result = await runOutcomeGrading({
    ledger,
    llmFn: countingLlm,
    now: T0 + 49 * HOUR,
    timeoutMs: 48 * HOUR,
    maxBatchSize: 2,
  });

  assert.deepEqual(result, { eligible: 2, graded: 2 });
  assert.equal(calls, 2);
  assert.equal(ledger.pending().length, 3);
});

test('default LLM fallback batch is capped at five records', async () => {
  const ledger = createAlgorithmEvaluationLedger({ now: () => T0 });
  for (let index = 0; index < 8; index += 1) {
    ledger.recordEvaluation({
      algorithmId: 'test-algo',
      domain: 'other',
      at: T0 + index,
      durationMs: 1,
    });
  }
  let calls = 0;

  const result = await runOutcomeGrading({
    ledger,
    llmFn: async () => {
      calls += 1;
      return acceptingLlm('');
    },
    now: T0 + 49 * HOUR,
    timeoutMs: 48 * HOUR,
  });

  assert.deepEqual(result, { eligible: 5, graded: 5 });
  assert.equal(calls, 5);
  assert.equal(ledger.pending().length, 3);
});
