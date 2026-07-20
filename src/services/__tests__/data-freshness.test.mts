import test from 'node:test';
import assert from 'node:assert/strict';
import { dataFreshness, isDeliveringEmpty } from '../data-freshness.ts';

// P0-5: a feed whose latest fetch returned zero items reads `fresh` by age
// alone (an empty 200 OK). lastBatchItemCount + isDeliveringEmpty make that
// distinguishable WITHOUT changing the freshness status risk logic depends on.

test('lastBatchItemCount tracks the latest refresh, not the cumulative total', () => {
  const id = dataFreshness.getAllSources()[0].id;
  dataFreshness.recordUpdate(id, 5);
  assert.equal(dataFreshness.getSource(id)!.lastBatchItemCount, 5);
  dataFreshness.recordUpdate(id, 3);
  assert.equal(dataFreshness.getSource(id)!.itemCount, 8); // cumulative, unchanged
  assert.equal(dataFreshness.getSource(id)!.lastBatchItemCount, 3); // latest batch
});

test('isDeliveringEmpty: fresh-but-empty is detected, and freshness status is unchanged', () => {
  const id = dataFreshness.getAllSources()[1].id;
  dataFreshness.recordUpdate(id, 5);
  assert.equal(isDeliveringEmpty(dataFreshness.getSource(id)!), false);

  // A successful refresh that returned zero items.
  dataFreshness.recordUpdate(id, 0);
  const s = dataFreshness.getSource(id)!;
  assert.equal(isDeliveringEmpty(s), true);
  // The additive empty signal must NOT change the freshness status — risk
  // aggregation keys off `status`, so this proves no behavior regression.
  assert.equal(s.status, 'fresh');
  assert.ok(dataFreshness.getEmptyDeliverySources().some((x) => x.id === id));
});

test('isDeliveringEmpty: never-updated and errored sources are not flagged empty', () => {
  const id = dataFreshness.getAllSources()[2].id;
  // Never updated → lastUpdate null → not "delivered empty", just no data yet.
  assert.equal(isDeliveringEmpty(dataFreshness.getSource(id)!), false);
  dataFreshness.recordUpdate(id, 0);
  assert.equal(isDeliveringEmpty(dataFreshness.getSource(id)!), true);
  // An error is a distinct (worse) state, not delivered-empty.
  dataFreshness.recordError(id, 'boom');
  assert.equal(isDeliveringEmpty(dataFreshness.getSource(id)!), false);
});
