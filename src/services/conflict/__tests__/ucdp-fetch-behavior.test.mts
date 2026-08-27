import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  assessUcdpDatasetCurrency,
  fetchUcdpClassifications,
  fetchUcdpEvents,
} from '../index.ts';
import { calculateCII, clearCountryData, ingestUcdpForCII } from '../../country-instability.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  clearCountryData();
});

function event(id: string) {
  return {
    id,
    dateStart: Date.UTC(2025, 9, 1),
    dateEnd: Date.UTC(2025, 9, 2),
    location: { latitude: 0, longitude: 0 },
    country: 'Ukraine', sideA: 'Side A', sideB: 'Side B',
    deathsBest: 1, deathsLow: 0, deathsHigh: 2,
    violenceType: 'UCDP_VIOLENCE_TYPE_STATE_BASED', sourceOriginal: '',
  };
}

test('renderer fetches exactly one bounded event response and never follows nextCursor', async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    assert.equal(new URL(String(input), 'http://localhost').searchParams.get('page_size'), '100');
    return Response.json({ events: [event('1')], pagination: { nextCursor: 'do-not-follow', totalCount: 7887 } });
  };
  const result = await fetchUcdpEvents();
  assert.equal(result.success, true);
  assert.equal(result.count, 1);
  assert.deepEqual(result.dataset, {
    kind: 'historical_window',
    version: '26.1',
    windowStart: '2025-09-02',
    windowEnd: '2025-12-31',
  });
  assert.equal(calls, 1);
});

test('renderer fetches classifications once and maps presence without event-count intensity', async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    assert.match(String(input), /\/api\/ucdp-classifications$/);
    return Response.json({
      classifications: [
        { country: 'Ukraine', countryId: 369, year: 2025, stateBased: true, nonState: false, oneSided: false },
        { country: 'Ghana', countryId: 452, year: 2025, stateBased: false, nonState: false, oneSided: false },
      ],
      totalCount: 2,
      version: '26.1',
      dataset: { kind: 'annual_classification', version: '26.1', year: 2025 },
    });
  };
  const result = await fetchUcdpClassifications();
  assert.equal(result.classifications.get('Ukraine')?.intensity, 'none');
  assert.equal(result.classifications.get('Ghana')?.intensity, 'none');
  assert.deepEqual(result.dataset, { kind: 'annual_classification', version: '26.1', year: 2025 });
  assert.equal(calls, 1);
});

test('annual conflict presence remains descriptive and does not impose a current CII floor', async () => {
  clearCountryData();
  ingestUcdpForCII(new Map([['ZA', {
    location: 'South Africa',
    countryId: 710,
    intensity: 'none',
    year: 2025,
    stateBased: false,
    nonState: false,
    oneSided: false,
  }]]));
  const baseline = calculateCII().find((score) => score.code === 'ZA')?.score;
  assert.ok(baseline !== undefined && baseline < 50);

  clearCountryData();
  globalThis.fetch = async () => Response.json({
    classifications: [
      { country: 'ZA', countryId: 710, year: 2025, stateBased: true, nonState: false, oneSided: true },
    ],
    totalCount: 1,
    version: '26.1',
    dataset: { kind: 'annual_classification', version: '26.1', year: 2025 },
  });

  const { classifications } = await fetchUcdpClassifications();
  ingestUcdpForCII(classifications);

  assert.equal(calculateCII().find((score) => score.code === 'ZA')?.score, baseline);
});

test('annual conflict presence retains official classification fields', async () => {
  globalThis.fetch = async () => Response.json({
    classifications: [
      { country: 'ZA', countryId: 710, year: 2025, stateBased: true, nonState: false, oneSided: true },
    ],
    totalCount: 1,
    version: '26.1',
    dataset: { kind: 'annual_classification', version: '26.1', year: 2025 },
  });

  const status = await fetchUcdpClassifications().then(({ classifications }) => classifications.get('ZA'));

  assert.deepEqual(status && {
    countryId: status.countryId,
    year: status.year,
    stateBased: status.stateBased,
    nonState: status.nonState,
    oneSided: status.oneSided,
  }, {
    countryId: 710,
    year: 2025,
    stateBased: true,
    nonState: false,
    oneSided: true,
  });
});

test('renderer rejects classification responses that normalize to zero usable observations', async () => {
  globalThis.fetch = async () => Response.json({
    classifications: [],
    totalCount: 0,
    version: '26.1',
    dataset: { kind: 'annual_classification', version: '26.1', year: 2025 },
  });
  await assert.rejects(() => fetchUcdpClassifications(), /usable UCDP classifications/);
});

test('dataset currency never treats historical transport as current and degrades annual data after rollover', () => {
  const historical = assessUcdpDatasetCurrency({
    kind: 'historical_window', version: '26.1', windowStart: '2025-09-02', windowEnd: '2025-12-31',
  }, Date.UTC(2025, 11, 31));
  assert.equal(historical.current, false);
  assert.match(historical.reason, /historical window 2025-09-02 through 2025-12-31/);

  const annualCurrent = assessUcdpDatasetCurrency(
    { kind: 'annual_classification', version: '26.1', year: 2025 },
    Date.UTC(2025, 11, 31),
  );
  assert.deepEqual(annualCurrent, { current: true, reason: '' });

  const rollover = assessUcdpDatasetCurrency(
    { kind: 'annual_classification', version: '26.1', year: 2025 },
    Date.UTC(2026, 2, 31, 23, 59, 59),
  );
  assert.equal(rollover.current, false);
  assert.match(rollover.reason, /annual rollover/);

  const degraded = assessUcdpDatasetCurrency(
    { kind: 'annual_classification', version: '26.1', year: 2025 },
    Date.UTC(2026, 7, 25),
  );
  assert.equal(degraded.current, false);
  assert.match(degraded.reason, /historical annual classification/);
});
