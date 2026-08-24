import test from 'node:test';
import assert from 'node:assert/strict';
import { dataFreshness, isDeliveringEmpty } from '../data-freshness.ts';
import { getGDACSSuccessfulUpdate } from '../gdacs.ts';

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

test('keyless source metadata exists and no-saved-place Open-Meteo is explicit unknown, not failure', () => {
  assert.equal(dataFreshness.getSource('gdacs')?.name, 'GDACS Disasters');
  assert.equal(dataFreshness.getSource('open-meteo')?.name, 'Open-Meteo Local Forecast');
  dataFreshness.recordUnknown('open-meteo', 'Add a saved place to start local forecasts.');
  const source = dataFreshness.getSource('open-meteo')!;
  assert.equal(source.status, 'no_data');
  assert.equal(source.lastError, null);
  assert.match(source.unknownReason ?? '', /saved place/i);
});

test('GDACS breaker fallback empty cannot be recorded as a successful refresh', () => {
  assert.equal(getGDACSSuccessfulUpdate({
    events: [],
    dataState: { mode: 'unavailable', timestamp: null, offline: false },
  }), null, 'fallback [] has no freshness evidence, so the loader cannot call recordUpdate');
  assert.deepEqual(getGDACSSuccessfulUpdate({
    events: [],
    dataState: { mode: 'live', timestamp: 1_752_000_000_000, offline: false },
  }), {
    itemCount: 0,
    updatedAt: 1_752_000_000_000,
  }, 'a validated live zero-row response is still a successful refresh');
});

test('GDACS breaker cache cannot claim a successful fresh adapter update', () => {
  assert.equal(getGDACSSuccessfulUpdate({
    events: [],
    dataState: { mode: 'cached', timestamp: 1_752_000_000_000, offline: true },
  }), null, 'cached breaker data remains useful fallback data, but is not a live adapter success');
});
