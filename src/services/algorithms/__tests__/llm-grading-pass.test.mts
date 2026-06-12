import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLlmGradingPass } from '../llm-grading-pass.js';
import { createAlgorithmEvaluationLedger } from '../algorithm-evaluation-ledger.js';

const now = 100 * 60 * 60 * 1000; // 100h epoch

function fakeLlmHit(): Promise<string> {
  return Promise.resolve(
    JSON.stringify({ grade: 'TRUE_POSITIVE', confidence: 0.9, reasoning: 'confirmed by follow-on alerts' }),
  );
}

function fakeLlmMiss(): Promise<string> {
  return Promise.resolve(
    JSON.stringify({ grade: 'FALSE_POSITIVE', confidence: 0.85, reasoning: 'no follow-on' }),
  );
}

test('grades aged ungraded records via injected llmFn and writes outcomes back', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  ledger.recordEvaluation({
    id: 'e1',
    algorithmId: 'big-event-detector',
    domain: 'other',
    at: now - 72 * 3_600_000,
    durationMs: 1,
    label: 'big event fired',
    score: 0.8,
  });

  const result = await runLlmGradingPass({ ledger, llmFn: fakeLlmHit, now, maxPerPass: 5 });

  assert.equal(result.graded, 1);
  assert.equal(result.eligible, 1);
  const rec = ledger.all().find((r) => r.id === 'e1');
  assert.notEqual(rec?.outcome, undefined);
  assert.equal(rec?.outcome, 'hit');
});

test('respects maxPerPass cap', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  for (let i = 0; i < 10; i++) {
    ledger.recordEvaluation({
      id: `e${i}`,
      algorithmId: 'a',
      domain: 'other',
      at: now - 72 * 3_600_000,
      durationMs: 1,
      label: 'x',
    });
  }

  const result = await runLlmGradingPass({ ledger, llmFn: fakeLlmMiss, now, maxPerPass: 3 });

  assert.equal(result.graded, 3);
});

test('skips records younger than 48h', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  ledger.recordEvaluation({
    id: 'young',
    algorithmId: 'a',
    domain: 'other',
    at: now - 1 * 3_600_000,
    durationMs: 1,
    label: 'recent',
  });

  const result = await runLlmGradingPass({ ledger, llmFn: fakeLlmHit, now, maxPerPass: 5 });

  assert.equal(result.eligible, 0);
  assert.equal(result.graded, 0);
});

test('does not overwrite already-graded records', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  ledger.recordEvaluation({
    id: 'already',
    algorithmId: 'a',
    domain: 'other',
    at: now - 72 * 3_600_000,
    durationMs: 1,
    label: 'done',
  });
  ledger.recordOutcome('already', 'miss', 'manual', now);

  const result = await runLlmGradingPass({ ledger, llmFn: fakeLlmHit, now, maxPerPass: 5 });

  assert.equal(result.graded, 0);
  const rec = ledger.get('already');
  assert.equal(rec?.outcome, 'miss');
});

test('counts failed (unavailable) separately from graded', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  ledger.recordEvaluation({
    id: 'fail1',
    algorithmId: 'a',
    domain: 'other',
    at: now - 72 * 3_600_000,
    durationMs: 1,
    label: 'x',
  });

  const throwingLlm = (): Promise<string> => Promise.reject(new Error('ollama down'));
  const result = await runLlmGradingPass({ ledger, llmFn: throwingLlm, now, maxPerPass: 5 });

  assert.equal(result.failed, 1);
  assert.equal(result.graded, 0);
  const rec = ledger.get('fail1');
  assert.equal(rec?.outcome, undefined, 'unavailable should leave record pending');
});
