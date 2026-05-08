import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBiosurveillanceWastewater } from '../biosurveillance-wastewater.mjs';

const NOW = Date.parse('2026-05-05T00:00:00Z');

function row(partial) {
  return {
    key_plot_id: partial.key_plot_id ?? 'site',
    wwtp_jurisdiction: partial.wwtp_jurisdiction ?? 'California',
    wwtp_name: partial.wwtp_name ?? 'Plant',
    county_names: partial.county_names ?? 'County',
    population_served: partial.population_served ?? 100_000,
    date_end: partial.date_end ?? '2026-05-04',
    percentile: partial.percentile ?? 50,
    ptc_15d: partial.ptc_15d ?? 0,
    ...partial,
  };
}

test('sidecar aggregator: matches TS shape (national, states, topSites, asOfDate)', () => {
  const out = buildBiosurveillanceWastewater(
    [
      row({ key_plot_id: 'ca-1', wwtp_jurisdiction: 'California', percentile: 80, ptc_15d: 35 }),
      row({ key_plot_id: 'ny-1', wwtp_jurisdiction: 'New York', percentile: 30, ptc_15d: -50 }),
    ],
    NOW,
  );
  assert.equal(out.states.length, 2);
  assert.equal(out.states[0].stateCode, 'CA');
  assert.equal(out.states[0].level, 'high');
  assert.ok(Array.isArray(out.topSites));
  assert.equal(out.asOfDate, '2026-05-04');
  assert.equal(out.national.activeStates, 2);
});

test('sidecar aggregator: empty / non-array input → degraded-shape result', () => {
  const out = buildBiosurveillanceWastewater(null, NOW);
  assert.equal(out.states.length, 0);
  assert.equal(out.national.activeStates, 0);
  assert.equal(out.asOfDate, null);
});

test('sidecar aggregator: dedupes site rows by key_plot_id (latest wins)', () => {
  const out = buildBiosurveillanceWastewater(
    [
      row({ key_plot_id: 's1', date_end: '2026-04-01', percentile: 30 }),
      row({ key_plot_id: 's1', date_end: '2026-05-01', percentile: 75 }),
    ],
    NOW,
  );
  assert.equal(out.topSites.length, 1);
  assert.equal(out.topSites[0].percentile15d, 75);
});
