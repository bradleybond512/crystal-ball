import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASK_SUGGESTED_QUESTIONS,
  buildAskAnswerHtml,
  buildAskFollowupChipHtml,
} from '../ask-the-data-view.ts';
import type { AnswerPacket } from '@/services/insights/ask-the-data';

const packet: AnswerPacket = {
  question: 'Why is risk high?',
  intent: 'why_high_risk',
  answer: 'Two features are degraded: Weather Warning, ADS-B Aggregation.',
  evidence: [
    { id: 'feature:weather_warning', label: 'Weather Warning', fact: 'NWS feed unreachable', confidence: 0.4 },
    { id: 'feature:adsb', label: 'ADS-B Aggregation', fact: 'all providers silent' },
  ],
  followUps: ['What would raise confidence?', 'What should I watch next?'],
};

test('answer HTML carries intent, answer, evidence, and follow-up chips', () => {
  const html = buildAskAnswerHtml(packet);
  assert.ok(html.includes('why high risk'));
  assert.ok(html.includes('Two features are degraded'));
  assert.ok(html.includes('Weather Warning'));
  assert.ok(html.includes('NWS feed unreachable'));
  assert.ok(html.includes('40%'));
  assert.ok(html.includes('data-ask-followup="What would raise confidence?"'));
});

test('answer and evidence text is HTML-escaped', () => {
  const html = buildAskAnswerHtml({
    ...packet,
    answer: '<img src=x onerror=alert(1)>',
    evidence: [{ id: 'e', label: '<b>bold</b>', fact: 'a & b' }],
    followUps: ['"quoted" <question>'],
  });
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<b>bold</b>'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('a &amp; b'));
  assert.ok(!html.includes('data-ask-followup=""quoted"'));
});

test('empty evidence and follow-ups render no list or chip row', () => {
  const html = buildAskAnswerHtml({ ...packet, evidence: [], followUps: [] });
  assert.ok(!html.includes('<ul'));
  assert.ok(!html.includes('data-ask-followup'));
});

test('suggested questions each render as a chip', () => {
  for (const q of ASK_SUGGESTED_QUESTIONS) {
    const chip = buildAskFollowupChipHtml(q);
    assert.ok(chip.includes(`data-ask-followup="${q}"`));
  }
});
