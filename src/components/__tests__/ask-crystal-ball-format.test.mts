import assert from 'node:assert/strict';
import test from 'node:test';

import { formatAnswerForChat } from '../ask-crystal-ball-format.ts';
import type { AnswerPacket } from '@/services/insights/ask-the-data.ts';

function makePacket(overrides: Partial<AnswerPacket>): AnswerPacket {
  return {
    question: 'Why is risk high?',
    intent: 'why_high_risk',
    answer: 'Risk is elevated.',
    evidence: [],
    followUps: [],
    ...overrides,
  };
}

test('answer only returns exactly the answer string', () => {
  const out = formatAnswerForChat(makePacket({ answer: 'All calm.' }));
  assert.equal(out, 'All calm.');
  assert.ok(!out.includes('Evidence:'));
  assert.ok(!out.includes('You might ask next:'));
});

test('evidence rows render one bullet per row under Evidence:', () => {
  const out = formatAnswerForChat(
    makePacket({
      evidence: [
        { id: 'a', label: 'Weather', fact: 'STALE' },
        { id: 'b', label: 'Grid', fact: 'DEGRADED' },
      ],
    }),
  );
  assert.ok(out.includes('Evidence:'));
  assert.ok(out.includes('• Weather: STALE'));
  assert.ok(out.includes('• Grid: DEGRADED'));
});

test('follow-ups render one bullet per question under You might ask next:', () => {
  const out = formatAnswerForChat(
    makePacket({
      followUps: ['What changed?', 'What to watch?'],
    }),
  );
  assert.ok(out.includes('You might ask next:'));
  assert.ok(out.includes('• What changed?'));
  assert.ok(out.includes('• What to watch?'));
});

test('with everything, answer comes first, then Evidence, then follow-ups', () => {
  const out = formatAnswerForChat(
    makePacket({
      answer: 'Risk is elevated.',
      evidence: [{ id: 'a', label: 'Weather', fact: 'STALE' }],
      followUps: ['What changed?'],
    }),
  );
  const answerIdx = out.indexOf('Risk is elevated.');
  const evidenceIdx = out.indexOf('Evidence:');
  const followUpIdx = out.indexOf('You might ask next:');
  assert.ok(answerIdx >= 0 && evidenceIdx >= 0 && followUpIdx >= 0);
  assert.ok(answerIdx < evidenceIdx);
  assert.ok(evidenceIdx < followUpIdx);
});
