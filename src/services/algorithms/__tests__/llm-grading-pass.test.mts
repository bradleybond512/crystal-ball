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

test('respects maxPerPass cap — graded is capped but eligible reflects full pool', async () => {
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
  assert.equal(result.eligible, 10, 'eligible should reflect full pool, not batch size');
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

test('malformed JSON response leaves record pending and counts as failed', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  ledger.recordEvaluation({
    id: 'malformed1',
    algorithmId: 'a',
    domain: 'other',
    at: now - 72 * 3_600_000,
    durationMs: 1,
    label: 'x',
  });

  // Returns non-JSON — parseLlmGradeResponse yields grade=INCONCLUSIVE, confidence=0
  const malformedLlm = (): Promise<string> => Promise.resolve('not json at all');
  const result = await runLlmGradingPass({ ledger, llmFn: malformedLlm, now, maxPerPass: 5 });

  assert.equal(result.failed, 1, 'malformed response should count as failed');
  assert.equal(result.graded, 0, 'malformed response should not count as graded');
  const rec = ledger.get('malformed1');
  assert.equal(rec?.outcome, undefined, 'malformed response should leave record pending for retry');
});

test('genuine high-confidence INCONCLUSIVE verdict is written to ledger', async () => {
  const ledger = createAlgorithmEvaluationLedger();
  ledger.recordEvaluation({
    id: 'genuine-inc',
    algorithmId: 'a',
    domain: 'other',
    at: now - 72 * 3_600_000,
    durationMs: 1,
    label: 'x',
  });

  // LLM confidently says INCONCLUSIVE — confidence above threshold (0.75)
  const genuineInconclusiveLlm = (): Promise<string> =>
    Promise.resolve(
      JSON.stringify({ grade: 'INCONCLUSIVE', confidence: 0.85, reasoning: 'genuinely ambiguous outcome' }),
    );
  const result = await runLlmGradingPass({ ledger, llmFn: genuineInconclusiveLlm, now, maxPerPass: 5 });

  assert.equal(result.graded, 1, 'genuine inconclusive should be written');
  assert.equal(result.failed, 0);
  const rec = ledger.get('genuine-inc');
  assert.equal(rec?.outcome, 'inconclusive');
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
