import assert from 'node:assert/strict';
import test from 'node:test';

import { recordExchange, getHistory, clearHistory } from '../crystal-ball-chat.ts';

test('recordExchange appends both roles to history in order', () => {
  clearHistory();
  recordExchange('Why is risk high?', 'Supply is elevated.');
  const h = getHistory();
  assert.equal(h.length, 2);
  assert.equal(h[0]!.role, 'user');
  assert.equal(h[0]!.content, 'Why is risk high?');
  assert.equal(h[1]!.role, 'assistant');
  assert.equal(h[1]!.content, 'Supply is elevated.');
});

test('recordExchange accumulates across calls (transcript continuity)', () => {
  clearHistory();
  recordExchange('q1', 'a1');
  recordExchange('q2', 'a2');
  assert.deepEqual(
    getHistory().map((m) => `${m.role}:${m.content}`),
    ['user:q1', 'assistant:a1', 'user:q2', 'assistant:a2'],
  );
});
