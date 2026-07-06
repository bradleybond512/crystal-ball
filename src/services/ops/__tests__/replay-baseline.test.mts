import assert from 'node:assert/strict';
import test from 'node:test';

import { runReplay } from '../replay-harness.ts';
import { buildCatalogReplayFixtures } from '../replay-fixtures-catalog.ts';
import { compareReplayReportToBaseline, type ReplayBaseline } from '../replay-baseline.ts';
import committedBaseline from '../replay-baseline.json' with { type: 'json' };

function catalogReport() {
  return runReplay({ fixtures: buildCatalogReplayFixtures(), generatedAt: 0 });
}

test('committed baseline matches the live fixture catalog run', () => {
  const { ok, mismatches, fixtureCount } = compareReplayReportToBaseline(
    catalogReport(),
    committedBaseline as ReplayBaseline,
  );
  assert.equal(ok, true, `baseline drift:\n${mismatches.join('\n')}`);
  assert.equal(fixtureCount, Object.keys(committedBaseline.fixtures).length);
});

test('outcome drift on a fixture is reported as a mismatch', () => {
  const report = catalogReport();
  const flippedId = report.results[0]!.fixtureId;
  const drifted: ReplayBaseline = {
    fixtures: {
      ...(committedBaseline as ReplayBaseline).fixtures,
      [flippedId]: report.results[0]!.outcome === 'pass' ? 'fail' : 'pass',
    },
  };
  const { ok, mismatches } = compareReplayReportToBaseline(report, drifted);
  assert.equal(ok, false);
  assert.equal(mismatches.length, 1);
  assert.match(mismatches[0]!, new RegExp(`^${flippedId}: expected`));
});

test('fixture missing from the baseline is reported', () => {
  const report = catalogReport();
  const fixtures = { ...(committedBaseline as ReplayBaseline).fixtures };
  const removedId = report.results[0]!.fixtureId;
  delete fixtures[removedId];
  const { ok, mismatches } = compareReplayReportToBaseline(report, { fixtures });
  assert.equal(ok, false);
  assert.ok(mismatches.some((m) => m === `${removedId}: new fixture not in baseline (expected missing)`));
});

test('stale baseline entry with no matching fixture is reported', () => {
  const report = catalogReport();
  const drifted: ReplayBaseline = {
    fixtures: {
      ...(committedBaseline as ReplayBaseline).fixtures,
      'fixture-removed-from-catalog': 'pass',
    },
  };
  const { ok, mismatches } = compareReplayReportToBaseline(report, drifted);
  assert.equal(ok, false);
  assert.ok(mismatches.includes('fixture-removed-from-catalog: in baseline but no matching fixture'));
});

test('empty report vs empty baseline is ok with zero fixtures', () => {
  const empty = runReplay({ fixtures: [], generatedAt: 0 });
  const { ok, fixtureCount } = compareReplayReportToBaseline(empty, { fixtures: {} });
  assert.equal(ok, true);
  assert.equal(fixtureCount, 0);
});
