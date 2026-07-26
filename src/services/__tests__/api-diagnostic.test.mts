import assert from 'node:assert/strict';
import test from 'node:test';

import { diagnoseAll } from '../api-diagnostic.ts';
import { dataFreshness } from '../data-freshness.ts';

test('diagnostics never report all sources healthy while failures and unknowns exist', () => {
  const [healthySource, failingSource] = dataFreshness.getAllSources();
  dataFreshness.recordUpdate(healthySource.id, 1);
  dataFreshness.recordError(failingSource.id, 'upstream unavailable');

  const report = diagnoseAll();

  assert.ok(report.failing > 0);
  assert.ok(report.unknown > 0);
  assert.equal(
    report.recommendations.includes('All sources within expected freshness windows.'),
    false,
  );
  assert.ok(report.recommendations.some((recommendation) => /failing/i.test(recommendation)));
  assert.ok(report.recommendations.some((recommendation) => /unknown/i.test(recommendation)));
});
