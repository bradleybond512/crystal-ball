import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeAlgorithmParameters } from '../algorithm-parameters-summary.ts';
import type { AlgorithmDefinition } from '@/services/algorithms/algorithm-health';

function def(overrides: Partial<AlgorithmDefinition> & Pick<AlgorithmDefinition, 'algorithmId' | 'label' | 'domain' | 'criticality'>): AlgorithmDefinition {
  return overrides;
}

test('summarizeAlgorithmParameters copies algorithmId, label, and domain verbatim', () => {
  const out = summarizeAlgorithmParameters([
    def({ algorithmId: 'shortage.wheat', label: 'Wheat Shortage', domain: 'shortage', criticality: 'high' }),
  ]);
  assert.equal(out[0]?.algorithmId, 'shortage.wheat');
  assert.equal(out[0]?.label, 'Wheat Shortage');
  assert.equal(out[0]?.domain, 'shortage');
});

test('summarizeAlgorithmParameters propagates threshold + window fields when present', () => {
  const out = summarizeAlgorithmParameters([
    def({
      algorithmId: 'a', label: 'A', domain: 'd', criticality: 'medium',
      minWeightedHitRate: 0.7,
      minGradedSamples: 25,
      maxMeanDurationMs: 1500,
    }),
  ]);
  assert.equal(out[0]?.minWeightedHitRate, 0.7);
  assert.equal(out[0]?.minGradedSamples, 25);
  assert.equal(out[0]?.maxMeanDurationMs, 1500);
});

test('summarizeAlgorithmParameters omits optional fields when undefined (no nulls in output)', () => {
  const out = summarizeAlgorithmParameters([
    def({ algorithmId: 'a', label: 'A', domain: 'd', criticality: 'low' }),
  ]);
  assert.equal('minWeightedHitRate' in out[0]!, false);
  assert.equal('minGradedSamples' in out[0]!, false);
  assert.equal('maxMeanDurationMs' in out[0]!, false);
  assert.equal('extras' in out[0]!, false);
});

test('summarizeAlgorithmParameters folds in matching extras by algorithmId', () => {
  const out = summarizeAlgorithmParameters(
    [def({ algorithmId: 'a', label: 'A', domain: 'd', criticality: 'low' })],
    { a: { warmupHours: 24, mode: 'shadow' } },
  );
  assert.deepEqual(out[0]?.extras, { warmupHours: 24, mode: 'shadow' });
});

test('summarizeAlgorithmParameters does not include extras when none match', () => {
  const out = summarizeAlgorithmParameters(
    [def({ algorithmId: 'a', label: 'A', domain: 'd', criticality: 'low' })],
    { b: { ignored: true } },
  );
  assert.equal('extras' in out[0]!, false);
});

test('summarizeAlgorithmParameters preserves input order', () => {
  const out = summarizeAlgorithmParameters([
    def({ algorithmId: 'z', label: 'Z', domain: 'd', criticality: 'low' }),
    def({ algorithmId: 'a', label: 'A', domain: 'd', criticality: 'low' }),
  ]);
  assert.deepEqual(out.map((r) => r.algorithmId), ['z', 'a']);
});
