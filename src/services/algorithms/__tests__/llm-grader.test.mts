import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLlmGradePrompt,
  parseLlmGradeResponse,
  gradeWithLlm,
  llmGradeToLedgerOutcome,
  recordLlmGrade,
  getLlmGrade,
  listLlmGrades,
  _resetLlmGradeCacheForTests,
  type LlmFn,
  type LlmGradeInput,
} from '../llm-grader.ts';
import {
  pickEligibleForLlmGrading,
  resolvePendingViaLlm,
} from '../outcome-resolver.ts';
import type { EvaluationRecord } from '../algorithm-evaluation-ledger.ts';

const NOW = 1_745_000_000_000;

const baseInput: LlmGradeInput = {
  algorithmId: 'compound-risk',
  eventId: 'evt-1',
  decision: 'fire (escalation expected within 24h)',
  evidence: [{ kind: 'fact', summary: 'troop movement reported', at: NOW }],
};

// ── Prompt construction ───────────────────────────────────────────────

test('buildLlmGradePrompt: includes the structured fields', () => {
  const prompt = buildLlmGradePrompt(baseInput);
  const parsed = JSON.parse(prompt);
  assert.equal(parsed.algorithmId, 'compound-risk');
  assert.equal(parsed.eventId, 'evt-1');
  assert.equal(parsed.question, 'Did this prediction come true?');
  assert.ok(Array.isArray(parsed.evidence));
  assert.match(parsed.instructions, /strict JSON/i);
});

// ── Response parsing ──────────────────────────────────────────────────

test('parseLlmGradeResponse: parses well-formed JSON', () => {
  const r = parseLlmGradeResponse('{"grade":"TRUE_POSITIVE","confidence":0.9,"reasoning":"matches reports"}');
  assert.equal(r.grade, 'TRUE_POSITIVE');
  assert.equal(r.confidence, 0.9);
  assert.equal(r.malformed, false);
});

test('parseLlmGradeResponse: strips code fences', () => {
  const r = parseLlmGradeResponse('```json\n{"grade":"FALSE_POSITIVE","confidence":0.8,"reasoning":"no escalation"}\n```');
  assert.equal(r.grade, 'FALSE_POSITIVE');
});

test('parseLlmGradeResponse: malformed JSON → INCONCLUSIVE', () => {
  const r = parseLlmGradeResponse('not json');
  assert.equal(r.grade, 'INCONCLUSIVE');
  assert.equal(r.malformed, true);
});

test('parseLlmGradeResponse: invalid grade label → INCONCLUSIVE', () => {
  const r = parseLlmGradeResponse('{"grade":"MAYBE","confidence":0.9,"reasoning":"x"}');
  assert.equal(r.grade, 'INCONCLUSIVE');
  assert.equal(r.malformed, true);
});

test('parseLlmGradeResponse: clamps confidence to [0,1]', () => {
  const r = parseLlmGradeResponse('{"grade":"TRUE_POSITIVE","confidence":2.5,"reasoning":"x"}');
  assert.equal(r.confidence, 1);
});

test('parseLlmGradeResponse: missing confidence defaults to 0', () => {
  const r = parseLlmGradeResponse('{"grade":"TRUE_POSITIVE","reasoning":"x"}');
  assert.equal(r.confidence, 0);
});

// ── End-to-end gradeWithLlm ───────────────────────────────────────────

test('gradeWithLlm: high-confidence TRUE_POSITIVE accepted', async () => {
  const llmFn: LlmFn = async () =>
    '{"grade":"TRUE_POSITIVE","confidence":0.85,"reasoning":"verified"}';
  const r = await gradeWithLlm(baseInput, llmFn, { now: () => NOW });
  assert.equal(r.grade, 'TRUE_POSITIVE');
  assert.equal(r.belowConfidenceThreshold, false);
  assert.equal(r.llmUnavailable, false);
});

test('gradeWithLlm: low-confidence call downgraded to INCONCLUSIVE', async () => {
  const llmFn: LlmFn = async () =>
    '{"grade":"TRUE_POSITIVE","confidence":0.5,"reasoning":"weak signal"}';
  const r = await gradeWithLlm(baseInput, llmFn, { now: () => NOW, acceptanceThreshold: 0.75 });
  assert.equal(r.grade, 'INCONCLUSIVE');
  assert.equal(r.belowConfidenceThreshold, true);
});

test('gradeWithLlm: thrown llmFn → INCONCLUSIVE with llmUnavailable=true', async () => {
  const llmFn: LlmFn = () => Promise.reject(new Error('Ollama not running'));
  const r = await gradeWithLlm(baseInput, llmFn, { now: () => NOW });
  assert.equal(r.grade, 'INCONCLUSIVE');
  assert.equal(r.llmUnavailable, true);
  assert.match(r.reasoning, /Ollama not running/);
});

test('gradeWithLlm: malformed LLM response → INCONCLUSIVE', async () => {
  const llmFn: LlmFn = async () => 'this is not JSON at all';
  const r = await gradeWithLlm(baseInput, llmFn, { now: () => NOW });
  assert.equal(r.grade, 'INCONCLUSIVE');
});

// ── Outcome mapping ───────────────────────────────────────────────────

test('llmGradeToLedgerOutcome: maps grades to ledger outcomes', () => {
  assert.equal(llmGradeToLedgerOutcome('TRUE_POSITIVE'), 'hit');
  assert.equal(llmGradeToLedgerOutcome('FALSE_POSITIVE'), 'miss');
  assert.equal(llmGradeToLedgerOutcome('INCONCLUSIVE'), 'inconclusive');
});

// ── Outcome resolver integration ─────────────────────────────────────

const HOUR = 60 * 60 * 1000;

function pendingRec(at: number, id = 'r1'): EvaluationRecord {
  return {
    id,
    algorithmId: 'a',
    domain: 'truth_score',
    at,
    durationMs: 1,
    score: 0.7,
    label: 'fire',
    notes: 'test',
  };
}

test('pickEligibleForLlmGrading: only records older than timeout', () => {
  const records = [
    pendingRec(NOW - 50 * HOUR, 'old'),
    pendingRec(NOW - 10 * HOUR, 'recent'),
  ];
  const eligible = pickEligibleForLlmGrading(records, { now: NOW, timeoutMs: 48 * HOUR });
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0]!.id, 'old');
});

test('pickEligibleForLlmGrading: skips records that already have an outcome', () => {
  const r = pendingRec(NOW - 100 * HOUR, 'graded');
  r.outcome = 'hit';
  const eligible = pickEligibleForLlmGrading([r], { now: NOW });
  assert.equal(eligible.length, 0);
});

test('resolvePendingViaLlm: routes eligible records through llmFn', async () => {
  const records = [pendingRec(NOW - 100 * HOUR, 'old1'), pendingRec(NOW - 100 * HOUR, 'old2')];
  const llmFn: LlmFn = async () =>
    '{"grade":"TRUE_POSITIVE","confidence":0.85,"reasoning":"ok"}';
  const out = await resolvePendingViaLlm(records, { now: NOW, llmFn });
  assert.equal(out.length, 2);
  assert.equal(out[0]!.ledgerOutcome, 'hit');
});

test('resolvePendingViaLlm: missing llmFn → INCONCLUSIVE for every record', async () => {
  const records = [pendingRec(NOW - 100 * HOUR, 'r')];
  const out = await resolvePendingViaLlm(records, { now: NOW });
  assert.equal(out[0]!.ledgerOutcome, 'inconclusive');
  assert.equal(out[0]!.llm.llmUnavailable, true);
});

// ── Cache ─────────────────────────────────────────────────────────────

test('record / get / list LlmGrade: round-trip', () => {
  _resetLlmGradeCacheForTests();
  recordLlmGrade({
    eventId: 'e1',
    algorithmId: 'a',
    grade: 'TRUE_POSITIVE',
    confidence: 0.9,
    reasoning: 'x',
    belowConfidenceThreshold: false,
    llmUnavailable: false,
    generatedAt: NOW,
  });
  assert.equal(getLlmGrade('e1')?.grade, 'TRUE_POSITIVE');
  assert.equal(listLlmGrades().length, 1);
});
