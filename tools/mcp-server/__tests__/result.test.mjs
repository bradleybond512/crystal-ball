import test from 'node:test';
import assert from 'node:assert/strict';

import { textResult } from '../result.mjs';

test('textResult preserves readable text and exposes structured content', () => {
  const payload = {
    summary: 'Current status',
    timestamp: '2026-07-30T00:00:00.000Z',
    healthy: true,
  };

  const result = textResult(payload);

  assert.deepEqual(result.structuredContent, { result: payload });
  assert.deepEqual(JSON.parse(result.content[0].text), payload);
});

test('textResult always returns an object in structured content', () => {
  const result = textResult(['one', 'two']);

  assert.deepEqual(result.structuredContent, { result: ['one', 'two'] });
});
