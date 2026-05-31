/**
 * Tests for critical-minerals helpers — pure aggregator + rendering.
 *
 * The Panel class extends a base that pulls Vite-only `?worker` imports, so
 * this suite targets the testable boundary: helpers + buildViewModel +
 * renderHtml.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { ObservationEvent } from '../../src/types/intelligence.ts';

const NOW = 1_745_000_000_000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

function evt(overrides: Partial<ObservationEvent> & { id?: string; tags?: string[]; raw?: Record<string, unknown> } = {}): ObservationEvent {
  return {
    id: overrides.id ?? 'obs-1',
    sourceId: overrides.sourceId ?? 'usgs-minerals',
    domain: overrides.domain ?? 'resources',
    timestamp: overrides.timestamp ?? NOW,
    severity: overrides.severity ?? 'MEDIUM',
    title: overrides.title ?? 'Test observation',
    raw: overrides.raw ?? {},
    entityIds: overrides.entityIds ?? [],
    tags: overrides.tags ?? [],
    location: overrides.location,
  };
}

const {
  computeDisruptions,
  computeExportRestrictions,
  computeConcentrationRisk,
  computeProcessingBottlenecks,
  computeStrategicReserves,
  buildViewModel,
  renderHtml,
  MINERAL_PRODUCERS,
} = await import('../../src/components/critical-minerals-helpers.ts');

// ── computeDisruptions ─────────────────────────────────────────────────────

describe('computeDisruptions', () => {
  it('ignores events without the disruption tag', () => {
    const out = computeDisruptions([evt({ tags: ['other'], raw: { mineral: 'lithium' } })]);
    assert.equal(out.length, 0);
  });

  it('ignores events without a recognized mineral', () => {
    const out = computeDisruptions([evt({ tags: ['disruption'], raw: { mineral: 'unobtainium' } })]);
    assert.equal(out.length, 0);
  });

  it('ignores events with no mineral field', () => {
    const out = computeDisruptions([evt({ tags: ['disruption'], raw: {} })]);
    assert.equal(out.length, 0);
  });

  it('extracts disruption type, country, and affected supply pct from raw', () => {
    const out = computeDisruptions([evt({
      tags: ['disruption'],
      raw: { mineral: 'cobalt', disruptionType: 'mine-closure', country: 'COD', affectedSupplyPct: 12.5 },
    })]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.mineral, 'cobalt');
    assert.equal(out[0]!.disruptionType, 'mine-closure');
    assert.equal(out[0]!.country, 'COD');
    assert.equal(out[0]!.affectedSupplyPct, 12.5);
  });

  it('defaults to disruption type "other" for unknown values', () => {
    const out = computeDisruptions([evt({
      tags: ['disruption'],
      raw: { mineral: 'lithium', disruptionType: 'asteroid-strike' },
    })]);
    assert.equal(out[0]!.disruptionType, 'other');
  });

  it('sorts by severity rank descending, then newest first', () => {
    const out = computeDisruptions([
      evt({ id: 'low',  tags: ['disruption'], severity: 'LOW',      timestamp: NOW,        raw: { mineral: 'lithium' } }),
      evt({ id: 'crit', tags: ['disruption'], severity: 'CRITICAL', timestamp: NOW - 1000, raw: { mineral: 'lithium' } }),
      evt({ id: 'high1', tags: ['disruption'], severity: 'HIGH',    timestamp: NOW - 500,  raw: { mineral: 'lithium' } }),
      evt({ id: 'high2', tags: ['disruption'], severity: 'HIGH',    timestamp: NOW,        raw: { mineral: 'lithium' } }),
    ]);
    assert.deepEqual(out.map(d => d.id), ['crit', 'high2', 'high1', 'low']);
  });

  it('caps output at 12', () => {
    const events = Array.from({ length: 20 }, (_, i) => evt({
      id: `d${i}`, tags: ['disruption'], raw: { mineral: 'lithium' },
    }));
    assert.equal(computeDisruptions(events).length, 12);
  });
});

// ── computeExportRestrictions ──────────────────────────────────────────────

describe('computeExportRestrictions', () => {
  it('captures restriction type and affected importers', () => {
    const out = computeExportRestrictions([evt({
      tags: ['export-restriction'],
      raw: {
        mineral: 'rare-earths',
        country: 'CHN',
        restrictionType: 'license-required',
        affectedImporters: ['USA', 'JPN', 'KOR'],
      },
    })]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.country, 'CHN');
    assert.equal(out[0]!.restrictionType, 'license-required');
    assert.deepEqual(out[0]!.affectedImporters, ['USA', 'JPN', 'KOR']);
  });

  it('falls back to "Restriction" when type missing', () => {
    const out = computeExportRestrictions([evt({
      tags: ['export-restriction'], raw: { mineral: 'lithium' },
    })]);
    assert.equal(out[0]!.restrictionType, 'Restriction');
  });

  it('sorts by effectiveAt newest first (falls back to timestamp)', () => {
    const out = computeExportRestrictions([
      evt({ id: 'a', tags: ['export-restriction'], timestamp: NOW - 5 * ONE_DAY, raw: { mineral: 'cobalt', effectiveAt: NOW - 3 * ONE_DAY } }),
      evt({ id: 'b', tags: ['export-restriction'], timestamp: NOW,               raw: { mineral: 'cobalt', effectiveAt: NOW - ONE_DAY } }),
    ]);
    assert.equal(out[0]!.id, 'b');
  });

  it('returns empty when no export-restriction tag present', () => {
    assert.deepEqual(computeExportRestrictions([
      evt({ tags: ['disruption'], raw: { mineral: 'lithium' } }),
    ]), []);
  });

  it('drops non-string entries from affectedImporters', () => {
    const out = computeExportRestrictions([evt({
      tags: ['export-restriction'],
      raw: { mineral: 'lithium', affectedImporters: ['USA', 42, null, 'JPN'] },
    })]);
    assert.deepEqual(out[0]!.affectedImporters, ['USA', 'JPN']);
  });
});

// ── computeConcentrationRisk ──────────────────────────────────────────────

describe('computeConcentrationRisk', () => {
  it('returns one row per mineral in MINERAL_PRODUCERS', () => {
    const out = computeConcentrationRisk();
    assert.equal(out.length, Object.keys(MINERAL_PRODUCERS).length);
  });

  it('places highest-HHI minerals first', () => {
    const out = computeConcentrationRisk();
    for (let i = 1; i < out.length; i++) {
      assert.ok(out[i - 1]!.hhi >= out[i]!.hhi, `HHI ordering broke at ${i}`);
    }
  });

  it('computes top3 share as the sum of producer shares', () => {
    const tungsten = computeConcentrationRisk().find(r => r.mineral === 'tungsten');
    assert.ok(tungsten);
    const expected = MINERAL_PRODUCERS.tungsten.slice(0, 3).reduce((s, p) => s + p.mineSharePct, 0);
    assert.equal(tungsten.top3SharePct, expected);
  });

  it('assigns highest risk band (4) to minerals with HHI >= 6000', () => {
    const tungsten = computeConcentrationRisk().find(r => r.mineral === 'tungsten');
    // tungsten is 81% CHN → 81*81 = 6561, so band 4
    assert.equal(tungsten!.riskBand, 4);
  });

  it('returns top producers (at most 3) on each row', () => {
    const rows = computeConcentrationRisk();
    for (const r of rows) assert.ok(r.topProducers.length <= 3);
  });
});

// ── computeProcessingBottlenecks ──────────────────────────────────────────

describe('computeProcessingBottlenecks', () => {
  it('includes only countries with refiningSharePct >= 30', () => {
    const out = computeProcessingBottlenecks([]);
    for (const row of out) {
      assert.ok(row.refiningSharePct >= 30, `${row.mineral}/${row.processingCountry} had refining ${row.refiningSharePct}`);
    }
  });

  it('escalates status to "disrupted" when a CRITICAL processing alert matches', () => {
    const events = [evt({
      tags: ['processing'], severity: 'CRITICAL',
      raw: { mineral: 'rare-earths', country: 'CHN' },
    })];
    const cn = computeProcessingBottlenecks(events).find(r => r.mineral === 'rare-earths' && r.processingCountry === 'CHN');
    assert.equal(cn?.status, 'disrupted');
    assert.equal(cn?.liveAlerts, 1);
  });

  it('escalates status to "strained" for HIGH (no critical)', () => {
    const events = [evt({
      tags: ['processing'], severity: 'HIGH',
      raw: { mineral: 'rare-earths', country: 'CHN' },
    })];
    const cn = computeProcessingBottlenecks(events).find(r => r.mineral === 'rare-earths' && r.processingCountry === 'CHN');
    assert.equal(cn?.status, 'strained');
  });

  it('stays "normal" when no matching processing event exists', () => {
    const cn = computeProcessingBottlenecks([]).find(r => r.mineral === 'rare-earths' && r.processingCountry === 'CHN');
    assert.equal(cn?.status, 'normal');
    assert.equal(cn?.liveAlerts, 0);
  });

  it('ignores processing alerts for a different country', () => {
    const events = [evt({
      tags: ['processing'], severity: 'CRITICAL',
      raw: { mineral: 'rare-earths', country: 'USA' },
    })];
    const cn = computeProcessingBottlenecks(events).find(r => r.mineral === 'rare-earths' && r.processingCountry === 'CHN');
    assert.equal(cn?.status, 'normal');
  });

  it('orders disrupted before strained before normal', () => {
    const events = [
      evt({ id: 'a', tags: ['processing'], severity: 'CRITICAL', raw: { mineral: 'rare-earths', country: 'CHN' } }),
      evt({ id: 'b', tags: ['processing'], severity: 'HIGH',     raw: { mineral: 'tungsten', country: 'CHN' } }),
    ];
    const rows = computeProcessingBottlenecks(events);
    const firstDisrupted = rows.findIndex(r => r.status === 'disrupted');
    const firstStrained = rows.findIndex(r => r.status === 'strained');
    const firstNormal = rows.findIndex(r => r.status === 'normal');
    assert.ok(firstDisrupted < firstStrained, 'disrupted should appear before strained');
    assert.ok(firstStrained < firstNormal, 'strained should appear before normal');
  });
});

// ── computeStrategicReserves ──────────────────────────────────────────────

describe('computeStrategicReserves', () => {
  it('parses months of supply and trend', () => {
    const out = computeStrategicReserves([evt({
      tags: ['stockpile'],
      raw: { mineral: 'cobalt', country: 'USA', monthsOfSupply: 8.5, trend: 'depleting' },
    })]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.country, 'USA');
    assert.equal(out[0]!.monthsOfSupply, 8.5);
    assert.equal(out[0]!.trend, 'depleting');
  });

  it('defaults trend to "stable" when missing or unknown', () => {
    const out = computeStrategicReserves([evt({
      tags: ['stockpile'], raw: { mineral: 'cobalt', country: 'USA', trend: 'sideways' },
    })]);
    assert.equal(out[0]!.trend, 'stable');
  });

  it('sorts ascending by monthsOfSupply (lowest stockpiles first)', () => {
    const out = computeStrategicReserves([
      evt({ id: 'big',   tags: ['stockpile'], raw: { mineral: 'cobalt', country: 'A', monthsOfSupply: 24 } }),
      evt({ id: 'small', tags: ['stockpile'], raw: { mineral: 'cobalt', country: 'B', monthsOfSupply: 3 } }),
      evt({ id: 'mid',   tags: ['stockpile'], raw: { mineral: 'cobalt', country: 'C', monthsOfSupply: 12 } }),
    ]);
    assert.deepEqual(out.map(r => r.id), ['small', 'mid', 'big']);
  });

  it('drops events that don\'t carry the stockpile tag', () => {
    const out = computeStrategicReserves([
      evt({ tags: ['disruption'], raw: { mineral: 'cobalt', monthsOfSupply: 3 } }),
    ]);
    assert.equal(out.length, 0);
  });

  it('defaults monthsOfSupply to 0 when missing', () => {
    const out = computeStrategicReserves([evt({
      tags: ['stockpile'], raw: { mineral: 'cobalt', country: 'USA' },
    })]);
    assert.equal(out[0]!.monthsOfSupply, 0);
  });
});

// ── buildViewModel ────────────────────────────────────────────────────────

describe('buildViewModel', () => {
  it('produces a full snapshot when query succeeds', () => {
    const vm = buildViewModel({
      queryObservations: () => [
        evt({ id: 'd', tags: ['disruption'],         raw: { mineral: 'lithium', country: 'AUS' } }),
        evt({ id: 'r', tags: ['export-restriction'], raw: { mineral: 'rare-earths', country: 'CHN' } }),
        evt({ id: 'p', tags: ['processing'], severity: 'CRITICAL', raw: { mineral: 'rare-earths', country: 'CHN' } }),
        evt({ id: 's', tags: ['stockpile'],          raw: { mineral: 'cobalt', country: 'USA', monthsOfSupply: 12 } }),
      ],
      now: () => NOW,
    });
    assert.equal(vm.errors.length, 0);
    assert.equal(vm.disruptions.length, 1);
    assert.equal(vm.exportRestrictions.length, 1);
    assert.ok(vm.concentration.length > 0);
    assert.equal(vm.reserves.length, 1);
  });

  it('reports an error when the query throws', () => {
    const vm = buildViewModel({
      queryObservations: () => { throw new Error('store down'); },
      now: () => NOW,
    });
    assert.deepEqual(vm.errors, ['Observation store unavailable']);
    assert.deepEqual(vm.disruptions, []);
  });

  it('still renders concentration risk when no events flow', () => {
    const vm = buildViewModel({
      queryObservations: () => [],
      now: () => NOW,
    });
    assert.equal(vm.errors.length, 0);
    assert.ok(vm.concentration.length > 0);
  });
});

// ── renderHtml ────────────────────────────────────────────────────────────

describe('renderHtml', () => {
  function emptyVm() {
    return buildViewModel({ queryObservations: () => [], now: () => NOW });
  }

  it('renders all five section titles', () => {
    const html = renderHtml(emptyVm(), NOW);
    assert.ok(html.includes('Supply Disruption Watch'));
    assert.ok(html.includes('Export Restriction Tracker'));
    assert.ok(html.includes('Concentration Risk Map'));
    assert.ok(html.includes('Processing Bottleneck Alert'));
    assert.ok(html.includes('Strategic Reserve Status'));
  });

  it('emits empty-state copy for data-driven sections when there are no events', () => {
    const html = renderHtml(emptyVm(), NOW);
    assert.ok(html.includes('No supply disruptions tracked'));
    assert.ok(html.includes('No active export restrictions'));
    assert.ok(html.includes('No strategic reserve data'));
  });

  it('shows error banner when buildViewModel produced an error', () => {
    const vm = buildViewModel({
      queryObservations: () => { throw new Error('boom'); },
      now: () => NOW,
    });
    const html = renderHtml(vm, NOW);
    assert.ok(html.includes('cm-error-row'));
    assert.ok(html.includes('Observation store unavailable'));
  });

  it('escapes HTML in event titles + country fields', () => {
    const vm = buildViewModel({
      queryObservations: () => [evt({
        tags: ['disruption'],
        title: '<img src=x onerror=alert(1)>',
        raw: { mineral: 'lithium', country: '<script>alert(1)</script>' },
      })],
      now: () => NOW,
    });
    const html = renderHtml(vm, NOW);
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('renders a heat row for high-HHI minerals', () => {
    const html = renderHtml(emptyVm(), NOW);
    assert.ok(html.includes('Tungsten'));
    assert.ok(html.includes('HHI '));
  });

  it('omits the error row when there are no errors', () => {
    const html = renderHtml(emptyVm(), NOW);
    assert.ok(!html.includes('cm-error-row'));
  });
});

// ── ranking + integration ─────────────────────────────────────────────────

describe('integration', () => {
  it('ranks CRITICAL disruption above LOW for the same mineral', () => {
    const vm = buildViewModel({
      queryObservations: () => [
        evt({ id: 'low',  tags: ['disruption'], severity: 'LOW',      raw: { mineral: 'lithium' } }),
        evt({ id: 'crit', tags: ['disruption'], severity: 'CRITICAL', raw: { mineral: 'lithium' } }),
      ],
      now: () => NOW,
    });
    assert.equal(vm.disruptions[0]!.id, 'crit');
  });

  it('processing alert from a refining country bubbles to top', () => {
    const vm = buildViewModel({
      queryObservations: () => [
        evt({ tags: ['processing'], severity: 'CRITICAL', raw: { mineral: 'rare-earths', country: 'CHN' } }),
      ],
      now: () => NOW,
    });
    assert.equal(vm.processing[0]!.status, 'disrupted');
    assert.equal(vm.processing[0]!.mineral, 'rare-earths');
  });
});
