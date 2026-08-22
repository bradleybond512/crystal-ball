import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyOdinOutageUpdate,
  deriveOdinOutageState,
  emptyOdinOutageHistory,
  type OdinOutageHistoryUpdate,
} from '../odin-outage-history.ts';

const NOW = Date.parse('2026-08-14T14:00:00.000Z');
const FIPS = '18091';

function reported(customersOut: number, observedAt = NOW, expiresAt = NOW + 60 * 60_000): OdinOutageHistoryUpdate {
  return {
    kind: 'reported',
    sample: {
      countyFips: FIPS,
      customersOut,
      observedAt: new Date(observedAt),
      expiresAt: new Date(expiresAt),
    },
  };
}

test('a reported zero is accepted as known data, not treated as empty', () => {
  const result = applyOdinOutageUpdate(emptyOdinOutageHistory(FIPS), reported(0));
  const state = deriveOdinOutageState(result.history, NOW);

  assert.equal(result.disposition, 'accepted-reported');
  assert.equal(result.history.samples.length, 1);
  assert.equal(state.coverage, 'reported');
  assert.equal(state.customersOut, 0);
});

test('an empty successful response changes current coverage to unknown without inventing zero', () => {
  const first = applyOdinOutageUpdate(emptyOdinOutageHistory(FIPS), reported(75, NOW - 60_000));
  const empty = applyOdinOutageUpdate(first.history, {
    kind: 'empty',
    countyFips: FIPS,
    observedAt: new Date(NOW),
  });
  const state = deriveOdinOutageState(empty.history, NOW);

  assert.equal(empty.disposition, 'accepted-empty-unknown');
  assert.equal(empty.history.samples.length, 1, 'history is retained for later comparison');
  assert.equal(state.coverage, 'unknown');
  assert.equal(state.customersOut, null);
  assert.equal(state.reason, 'empty-response');
});

test('an out-of-order report cannot overwrite a newer known or unknown outcome', () => {
  const newest = applyOdinOutageUpdate(emptyOdinOutageHistory(FIPS), reported(10, NOW));
  const stale = applyOdinOutageUpdate(newest.history, reported(999, NOW - 60_000));
  assert.equal(stale.disposition, 'rejected-out-of-order');
  assert.equal(stale.history.samples.length, 1);
  assert.equal(deriveOdinOutageState(stale.history, NOW).customersOut, 10);

  const empty = applyOdinOutageUpdate(newest.history, {
    kind: 'empty', countyFips: FIPS, observedAt: new Date(NOW + 60_000),
  });
  const lateArrival = applyOdinOutageUpdate(empty.history, reported(500, NOW + 30_000));
  assert.equal(lateArrival.disposition, 'rejected-out-of-order');
  assert.equal(deriveOdinOutageState(lateArrival.history, NOW + 60_000).coverage, 'unknown');
});

test('history is deterministically capped while retaining the newest samples', () => {
  let history = emptyOdinOutageHistory(FIPS);
  for (let index = 0; index < 6; index += 1) {
    history = applyOdinOutageUpdate(history, reported(index, NOW + index * 60_000), {
      maxSamples: 3,
      retentionMs: 24 * 60 * 60_000,
    }).history;
  }

  assert.equal(history.samples.length, 3);
  assert.deepEqual(history.samples.map((sample) => sample.customersOut), [3, 4, 5]);
});

test('a current history reports a descriptive improving/worsening/steady trend only', () => {
  let history = applyOdinOutageUpdate(emptyOdinOutageHistory(FIPS), reported(10, NOW - 120_000)).history;
  history = applyOdinOutageUpdate(history, reported(30, NOW - 60_000)).history;
  let state = deriveOdinOutageState(history, NOW - 60_000);
  assert.equal(state.trend, 'worsening');
  assert.equal(state.deltaCustomersOut, 20);

  history = applyOdinOutageUpdate(history, reported(5, NOW)).history;
  state = deriveOdinOutageState(history, NOW);
  assert.equal(state.trend, 'improving');
  assert.equal(state.deltaCustomersOut, -25);

  history = applyOdinOutageUpdate(history, reported(5, NOW + 60_000)).history;
  assert.equal(deriveOdinOutageState(history, NOW + 60_000).trend, 'steady');
});

test('expired and unavailable latest outcomes are unknown', () => {
  const expired = applyOdinOutageUpdate(
    emptyOdinOutageHistory(FIPS),
    reported(15, NOW - 60_000, NOW),
  );
  assert.equal(deriveOdinOutageState(expired.history, NOW).reason, 'expired');

  const unavailable = applyOdinOutageUpdate(expired.history, {
    kind: 'unavailable', countyFips: FIPS, observedAt: new Date(NOW + 1),
  });
  assert.equal(unavailable.disposition, 'accepted-unavailable-unknown');
  assert.equal(deriveOdinOutageState(unavailable.history, NOW + 1).reason, 'provider-unavailable');
});

test('a coverage gap resets the descriptive trend baseline', () => {
  let history = applyOdinOutageUpdate(emptyOdinOutageHistory(FIPS), reported(100, NOW - 120_000)).history;
  history = applyOdinOutageUpdate(history, {
    kind: 'empty', countyFips: FIPS, observedAt: new Date(NOW - 60_000),
  }).history;
  history = applyOdinOutageUpdate(history, reported(25, NOW)).history;

  const state = deriveOdinOutageState(history, NOW);
  assert.equal(state.coverage, 'reported');
  assert.equal(state.customersOut, 25);
  assert.equal(state.trend, 'unknown', 'must not compare across an unknown-coverage gap');
  assert.equal(state.deltaCustomersOut, null);
});

test('invalid samples and a different county fail closed without moving the watermark', () => {
  const initial = emptyOdinOutageHistory(FIPS);
  const invalid = applyOdinOutageUpdate(initial, reported(-1));
  assert.equal(invalid.disposition, 'rejected-invalid');
  assert.equal(invalid.history.watermarkAt, null);

  const wrongCounty = applyOdinOutageUpdate(initial, {
    kind: 'empty', countyFips: '06037', observedAt: new Date(NOW),
  });
  assert.equal(wrongCounty.disposition, 'rejected-invalid');
  assert.equal(wrongCounty.history.watermarkAt, null);
});
