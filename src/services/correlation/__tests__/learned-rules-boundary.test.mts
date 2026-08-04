import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { learnedRulesFromEdges } from '../learned-rules.ts';
import type { InhibitoryLeadLagEdge } from '../lead-lag.ts';

test('learned-rule synthesis is statically restricted to promoting edges', () => {
  const source = readFileSync(new URL('../learned-rules.ts', import.meta.url), 'utf8');
  assert.match(source, /import type \{ PromotingLeadLagEdge \} from '\.\/lead-lag';/);
  assert.match(source, /learnedRulesFromEdges\(edges: readonly PromotingLeadLagEdge\[\]\)/);
  assert.match(source, /function toRule\(edge: PromotingLeadLagEdge\)/);
  assert.doesNotMatch(source, /import type \{ LeadLagEdge \}/);
});

const inhibitory: InhibitoryLeadLagEdge = {
  effect: 'inhibitory', from: 'a', to: 'b', windowMs: 1,
  support: 0, antecedents: 5, followRate: 0, expectedRate: 0.5,
  lift: 0, zScore: -4, strength: 0, explanation: 'suppression',
};

if (false) {
  // @ts-expect-error Inhibitory evidence must never enter learned rule synthesis.
  learnedRulesFromEdges([inhibitory]);
}
