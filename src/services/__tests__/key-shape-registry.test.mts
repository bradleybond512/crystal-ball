import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesShape, hasShape } from '../key-shape-registry.ts';

test('Anthropic shape matches a real-format token', () => {
  assert.equal(matchesShape('ANTHROPIC_API_KEY', 'sk-ant-api03-' + 'a'.repeat(80)), true);
});

test('Anthropic shape rejects a Groq-format token', () => {
  assert.equal(matchesShape('ANTHROPIC_API_KEY', 'gsk_' + 'a'.repeat(50)), false);
});

test('Groq shape matches', () => {
  assert.equal(matchesShape('GROQ_API_KEY', 'gsk_' + 'a'.repeat(52)), true);
});

test('FRED matches 32 hex chars', () => {
  assert.equal(matchesShape('FRED_API_KEY', 'a'.repeat(32)), true);
  assert.equal(matchesShape('FRED_API_KEY', 'a'.repeat(31)), false);
  assert.equal(matchesShape('FRED_API_KEY', 'g'.repeat(32)), false);
});

test('hasShape returns false for keys with no registered regex', () => {
  assert.equal(hasShape('GEONAMES_USERNAME'), false);
  assert.equal(hasShape('OLLAMA_MODEL'), false);
});

test('matchesShape returns false for keys with no registered regex', () => {
  assert.equal(matchesShape('GEONAMES_USERNAME', 'anything'), false);
});

test('matchesShape rejects empty / whitespace input', () => {
  assert.equal(matchesShape('ANTHROPIC_API_KEY', ''), false);
  assert.equal(matchesShape('ANTHROPIC_API_KEY', '   '), false);
});
