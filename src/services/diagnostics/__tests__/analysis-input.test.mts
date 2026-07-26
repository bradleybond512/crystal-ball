import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  MAX_CORRELATION_CLUSTERS,
  boundCorrelationClusters,
} from '../../analysis-input.ts';

test('correlation analysis keeps only the newest bounded cluster set', () => {
  const clusters = Array.from(
    { length: MAX_CORRELATION_CLUSTERS + 25 },
    (_, index) => ({ id: index }),
  );

  const bounded = boundCorrelationClusters(clusters);

  assert.equal(bounded.length, MAX_CORRELATION_CLUSTERS);
  assert.deepEqual(bounded.at(0), { id: 0 });
  assert.deepEqual(bounded.at(-1), { id: MAX_CORRELATION_CLUSTERS - 1 });
});

test('correlation analysis reuses inputs already within the limit', () => {
  const clusters = [{ id: 1 }, { id: 2 }];
  assert.equal(boundCorrelationClusters(clusters), clusters);
});
