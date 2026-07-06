import assert from 'node:assert/strict';
import test from 'node:test';

import { buildShareBriefing } from '../share-briefing.ts';
import type { ShareBriefingInput } from '../share-briefing.ts';

function baseInput(overrides: Partial<ShareBriefingInput> = {}): ShareBriefingInput {
  return {
    headline: 'All systems nominal',
    concerns: [],
    watch: [],
    actions: [],
    generatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

test('minimal input yields title with headline, matching summary, no sections/metadata', () => {
  const briefing = buildShareBriefing(baseInput());
  assert.ok(briefing.title.includes('All systems nominal'));
  assert.equal(briefing.summary, 'All systems nominal');
  assert.equal(briefing.generatedAt, 1_700_000_000_000);
  assert.deepEqual(briefing.sections, []);
  assert.equal(briefing.metadata, undefined);
});

test('non-empty concerns/watch/actions produce three sections in order with matching bullets', () => {
  const briefing = buildShareBriefing(baseInput({
    concerns: ['Weather: severe wind inbound'],
    watch: ['NWS polygon update'],
    actions: ['Charge devices', 'Move car under cover'],
  }));
  assert.deepEqual(
    briefing.sections.map((s) => s.heading),
    ['Top concerns', 'What to watch', 'Recommended actions'],
  );
  assert.deepEqual(briefing.sections[0].bullets, ['Weather: severe wind inbound']);
  assert.deepEqual(briefing.sections[1].bullets, ['NWS polygon update']);
  assert.deepEqual(briefing.sections[2].bullets, ['Charge devices', 'Move car under cover']);
});

test('location + sourceCount populate metadata with correct label/value', () => {
  const briefing = buildShareBriefing(baseInput({ location: 'La Porte, IN', sourceCount: 3 }));
  assert.deepEqual(briefing.metadata, [
    { label: 'Location', value: 'La Porte, IN' },
    { label: 'Sources', value: '3' },
  ]);
});

test('severityScore and confidence pass through', () => {
  const briefing = buildShareBriefing(baseInput({ severityScore: 72, confidence: 'high' }));
  assert.equal(briefing.severityScore, 72);
  assert.equal(briefing.confidence, 'high');
});
