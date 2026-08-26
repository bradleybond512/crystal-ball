import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { fetchUcdpClassifications, fetchUcdpEvents } from '../index.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

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
    });
  };
  const result = await fetchUcdpClassifications();
  assert.equal(result.get('Ukraine')?.intensity, 'minor');
  assert.equal(result.get('Ghana')?.intensity, 'none');
  assert.equal(calls, 1);
});

test('renderer rejects classification responses that normalize to zero usable observations', async () => {
  globalThis.fetch = async () => Response.json({ classifications: [], totalCount: 0, version: '26.1' });
  await assert.rejects(() => fetchUcdpClassifications(), /usable UCDP classifications/);
});
