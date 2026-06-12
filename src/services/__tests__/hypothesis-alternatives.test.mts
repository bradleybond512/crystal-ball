import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAlternativesResponse } from '../hypothesis-alternatives';

test('parses a well-formed response', () => {
  const raw = JSON.stringify({
    alternative: 'Scheduled military exercise, not mobilization',
    alternativeConfidence: 0.35,
    premortem: 'Fails if flight density returns to baseline within 12h',
  });
  const out = parseAlternativesResponse(raw);
  assert.equal(out?.alternative.includes('exercise'), true);
  assert.equal(out?.alternativeConfidence, 0.35);
});

test('returns null on malformed/non-JSON output', () => {
  assert.equal(parseAlternativesResponse('Sure! Here are some thoughts...'), null);
});

test('extracts JSON embedded in prose fences', () => {
  const raw = '```json\n{"alternative":"a","alternativeConfidence":0.2,"premortem":"p"}\n```';
  assert.ok(parseAlternativesResponse(raw));
});

test('clamps out-of-range confidence', () => {
  const raw = JSON.stringify({ alternative: 'a', alternativeConfidence: 7, premortem: 'p' });
  assert.equal(parseAlternativesResponse(raw)?.alternativeConfidence, 1);
});

test('non-finite confidence falls back to 0', () => {
  // JSON.parse turns 1e999 into Infinity — must not survive the clamp
  const raw = '{"alternative":"a","alternativeConfidence":1e999,"premortem":"p"}';
  assert.equal(parseAlternativesResponse(raw)?.alternativeConfidence, 0);
});
