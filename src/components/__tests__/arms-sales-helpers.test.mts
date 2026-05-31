import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  computeGlobalArmsIndex,
  exporterShareClass,
  dealStatusClass,
  getTopExporters,
  getMajorDeals,
  getByRecipient,
  getByExporter,
  buildRenderData,
  type ArmsExporter,
  type ArmsDeal,
  type DealStatus,
} from '../arms-sales-helpers.ts';

// ── Mock data ─────────────────────────────────────────────────────────────────
const MOCK_EXPORTERS: ArmsExporter[] = [
  { country: 'Alpha', globalSharePct: 42.0, trend: 'rising',   topRecipients: ['X', 'Y', 'Z'] },
  { country: 'Beta',  globalSharePct: 11.0, trend: 'stable',   topRecipients: ['A', 'B'] },
  { country: 'Gamma', globalSharePct:  5.8, trend: 'declining', topRecipients: ['C'] },
  { country: 'Delta', globalSharePct:  3.1, trend: 'stable',   topRecipients: ['D', 'E'] },
  { country: 'Epsilon',globalSharePct: 2.3, trend: 'rising',   topRecipients: ['F'] },
];

const MOCK_DEALS: ArmsDeal[] = [
  { id: 'T1', exporter: 'Alpha', recipient: 'X', systemType: 'Mixed/Aid',       valueB: 61.0, year: 2022, status: 'In Progress', significance: 10, description: 'Big deal A' },
  { id: 'T2', exporter: 'Alpha', recipient: 'Y', systemType: 'Fighter Aircraft',valueB: 19.0, year: 2023, status: 'In Progress', significance: 9,  description: 'Big deal B' },
  { id: 'T3', exporter: 'Beta',  recipient: 'A', systemType: 'Tanks',           valueB:  5.0, year: 2022, status: 'Delivered',   significance: 8,  description: 'Medium deal' },
  { id: 'T4', exporter: 'Gamma', recipient: 'C', systemType: 'Fighter Aircraft',valueB:  1.4, year: 2022, status: 'Delivered',   significance: 7,  description: 'Smaller deal' },
  { id: 'T5', exporter: 'Delta', recipient: 'D', systemType: 'Air Defense',     valueB:  3.8, year: 2023, status: 'Contracted',  significance: 6,  description: 'Air def deal' },
  { id: 'T6', exporter: 'Alpha', recipient: 'Z', systemType: 'Submarines',      valueB: 368.0,year: 2023, status: 'Contracted',  significance: 10, description: 'AUKUS-like' },
  { id: 'T7', exporter: 'Beta',  recipient: 'B', systemType: 'Mixed/Aid',       valueB:  1.2, year: 2024, status: 'Suspended',   significance: 5,  description: 'Suspended deal' },
];

// ── computeGlobalArmsIndex ────────────────────────────────────────────────────
describe('computeGlobalArmsIndex', () => {
  it('returns 0 for empty deals array', () => {
    assert.equal(computeGlobalArmsIndex([]), 0);
  });

  it('returns a number between 0 and 100', () => {
    const idx = computeGlobalArmsIndex(MOCK_DEALS);
    assert.ok(idx >= 0 && idx <= 100);
  });

  it('returns an integer', () => {
    const idx = computeGlobalArmsIndex(MOCK_DEALS);
    assert.equal(idx, Math.round(idx));
  });

  it('higher total value yields higher index (same exporters)', () => {
    const low  = MOCK_DEALS.map(d => ({ ...d, valueB: 1 }));
    const high = MOCK_DEALS.map(d => ({ ...d, valueB: 100 }));
    assert.ok(computeGlobalArmsIndex(high) >= computeGlobalArmsIndex(low));
  });

  it('single deal returns a positive number', () => {
    assert.ok(computeGlobalArmsIndex([MOCK_DEALS[0]]) > 0);
  });

  it('caps at 100 for very large values', () => {
    const huge = MOCK_DEALS.map(d => ({ ...d, valueB: 1e6 }));
    assert.equal(computeGlobalArmsIndex(huge), 100);
  });
});

// ── exporterShareClass ────────────────────────────────────────────────────────
describe('exporterShareClass', () => {
  it('returns share-dominant for 42%', () => {
    assert.equal(exporterShareClass(42), 'share-dominant');
  });

  it('returns share-dominant for exactly 30%', () => {
    assert.equal(exporterShareClass(30), 'share-dominant');
  });

  it('returns share-major for 11%', () => {
    assert.equal(exporterShareClass(11), 'share-major');
  });

  it('returns share-major for exactly 10%', () => {
    assert.equal(exporterShareClass(10), 'share-major');
  });

  it('returns share-significant for 5.8%', () => {
    assert.equal(exporterShareClass(5.8), 'share-significant');
  });

  it('returns share-significant for exactly 3%', () => {
    assert.equal(exporterShareClass(3), 'share-significant');
  });

  it('returns share-minor for 2.3%', () => {
    assert.equal(exporterShareClass(2.3), 'share-minor');
  });

  it('returns share-minor for 0%', () => {
    assert.equal(exporterShareClass(0), 'share-minor');
  });

  it('boundary: 29.9% is share-major not dominant', () => {
    assert.equal(exporterShareClass(29.9), 'share-major');
  });

  it('boundary: 9.9% is share-significant not major', () => {
    assert.equal(exporterShareClass(9.9), 'share-significant');
  });

  it('boundary: 2.9% is share-minor not significant', () => {
    assert.equal(exporterShareClass(2.9), 'share-minor');
  });
});

// ── dealStatusClass ───────────────────────────────────────────────────────────
describe('dealStatusClass', () => {
  it('returns status-delivered for Delivered', () => {
    assert.equal(dealStatusClass('Delivered'), 'status-delivered');
  });

  it('returns status-in-progress for In Progress', () => {
    assert.equal(dealStatusClass('In Progress'), 'status-in-progress');
  });

  it('returns status-contracted for Contracted', () => {
    assert.equal(dealStatusClass('Contracted'), 'status-contracted');
  });

  it('returns status-suspended for Suspended', () => {
    assert.equal(dealStatusClass('Suspended'), 'status-suspended');
  });
});

// ── getTopExporters ───────────────────────────────────────────────────────────
describe('getTopExporters', () => {
  it('returns top N exporters sorted by share descending', () => {
    const top = getTopExporters(MOCK_EXPORTERS, 3);
    assert.equal(top.length, 3);
    for (let i = 1; i < top.length; i++) {
      assert.ok(top[i - 1].globalSharePct >= top[i].globalSharePct);
    }
  });

  it('defaults to top 5', () => {
    assert.equal(getTopExporters(MOCK_EXPORTERS).length, 5);
  });

  it('first result is highest share exporter', () => {
    const top = getTopExporters(MOCK_EXPORTERS, 1);
    assert.equal(top[0].country, 'Alpha');
  });

  it('does not mutate original array order', () => {
    const origOrder = MOCK_EXPORTERS.map(e => e.country);
    getTopExporters(MOCK_EXPORTERS, 3);
    assert.deepEqual(MOCK_EXPORTERS.map(e => e.country), origOrder);
  });

  it('returns all when N > length', () => {
    assert.equal(getTopExporters(MOCK_EXPORTERS, 100).length, MOCK_EXPORTERS.length);
  });

  it('returns empty for empty input', () => {
    assert.equal(getTopExporters([]).length, 0);
  });
});

// ── getMajorDeals ─────────────────────────────────────────────────────────────
describe('getMajorDeals', () => {
  it('returns deals at or above significance threshold', () => {
    const major = getMajorDeals(MOCK_DEALS, 8);
    assert.ok(major.every(d => d.significance >= 8));
  });

  it('defaults to threshold of 7', () => {
    const major = getMajorDeals(MOCK_DEALS);
    assert.ok(major.every(d => d.significance >= 7));
  });

  it('threshold boundary: significance equal to threshold is included', () => {
    const major = getMajorDeals(MOCK_DEALS, 7);
    assert.ok(major.some(d => d.significance === 7));
  });

  it('threshold boundary: below threshold is excluded', () => {
    const major = getMajorDeals(MOCK_DEALS, 7);
    assert.ok(!major.some(d => d.significance < 7));
  });

  it('returns empty when no deals meet threshold', () => {
    assert.equal(getMajorDeals(MOCK_DEALS, 11).length, 0);
  });

  it('returns all when threshold is 1', () => {
    assert.equal(getMajorDeals(MOCK_DEALS, 1).length, MOCK_DEALS.length);
  });

  it('does not mutate input array', () => {
    const before = MOCK_DEALS.length;
    getMajorDeals(MOCK_DEALS, 8);
    assert.equal(MOCK_DEALS.length, before);
  });
});

// ── getByRecipient ────────────────────────────────────────────────────────────
describe('getByRecipient', () => {
  it('returns deals for the specified recipient', () => {
    const deals = getByRecipient(MOCK_DEALS, 'X');
    assert.ok(deals.every(d => d.recipient.toLowerCase() === 'x'));
  });

  it('is case-insensitive', () => {
    const lower = getByRecipient(MOCK_DEALS, 'x');
    const upper = getByRecipient(MOCK_DEALS, 'X');
    assert.equal(lower.length, upper.length);
  });

  it('returns empty for unknown recipient', () => {
    assert.equal(getByRecipient(MOCK_DEALS, 'Nonexistent Country').length, 0);
  });

  it('returns multiple deals for same recipient when applicable', () => {
    // Z is recipient for T6
    assert.equal(getByRecipient(MOCK_DEALS, 'Z').length, 1);
  });

  it('does not return deals from other recipients', () => {
    const deals = getByRecipient(MOCK_DEALS, 'A');
    assert.ok(!deals.some(d => d.recipient !== 'A'));
  });
});

// ── getByExporter ─────────────────────────────────────────────────────────────
describe('getByExporter', () => {
  it('returns deals from the specified exporter', () => {
    const deals = getByExporter(MOCK_DEALS, 'Alpha');
    assert.ok(deals.every(d => d.exporter.toLowerCase() === 'alpha'));
  });

  it('is case-insensitive', () => {
    const lower = getByExporter(MOCK_DEALS, 'alpha');
    const upper = getByExporter(MOCK_DEALS, 'ALPHA');
    assert.equal(lower.length, upper.length);
  });

  it('returns multiple deals for the same exporter', () => {
    const alphaDeals = getByExporter(MOCK_DEALS, 'Alpha');
    assert.ok(alphaDeals.length > 1); // T1, T2, T6
  });

  it('returns empty for unknown exporter', () => {
    assert.equal(getByExporter(MOCK_DEALS, 'UnknownNation').length, 0);
  });

  it('does not return deals from other exporters', () => {
    const deals = getByExporter(MOCK_DEALS, 'Beta');
    assert.ok(!deals.some(d => d.exporter !== 'Beta'));
  });
});

// ── buildRenderData (integration) ─────────────────────────────────────────────
describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.exporters));
    assert.ok(Array.isArray(d.deals));
    assert.equal(typeof d.globalArmsIndex, 'number');
    assert.equal(typeof d.usaDominanceScore, 'number');
    assert.equal(typeof d.totalValueB, 'number');
  });

  it('exporters array is non-empty', () => {
    assert.ok(buildRenderData().exporters.length > 0);
  });

  it('deals array is non-empty', () => {
    assert.ok(buildRenderData().deals.length > 0);
  });

  it('globalArmsIndex is in range 0-100', () => {
    const idx = buildRenderData().globalArmsIndex;
    assert.ok(idx >= 0 && idx <= 100);
  });

  it('usaDominanceScore matches USA exporter share', () => {
    const d = buildRenderData();
    const usa = d.exporters.find(e => e.country === 'USA');
    assert.ok(usa !== undefined);
    assert.equal(d.usaDominanceScore, Math.round(usa!.globalSharePct));
  });

  it('usaDominanceScore is 42 (USA 42% share)', () => {
    assert.equal(buildRenderData().usaDominanceScore, 42);
  });

  it('totalValueB equals sum of all deal values', () => {
    const d = buildRenderData();
    const sum = d.deals.reduce((acc, deal) => acc + deal.valueB, 0);
    assert.ok(Math.abs(d.totalValueB - sum) < 0.001);
  });

  it('all exporter shares sum to approximately 100%', () => {
    const total = buildRenderData().exporters.reduce((s, e) => s + e.globalSharePct, 0);
    assert.ok(total > 80 && total < 120, `Total share ${total} outside expected range`);
  });

  it('all deal IDs are unique', () => {
    const ids = buildRenderData().deals.map(d => d.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('all exporter countries are unique', () => {
    const countries = buildRenderData().exporters.map(e => e.country);
    assert.equal(new Set(countries).size, countries.length);
  });

  it('all globalSharePct values are positive', () => {
    for (const e of buildRenderData().exporters) {
      assert.ok(e.globalSharePct > 0, `${e.country} has non-positive share`);
    }
  });

  it('all deal values are positive', () => {
    for (const d of buildRenderData().deals) {
      assert.ok(d.valueB > 0, `Deal ${d.id} has non-positive value`);
    }
  });

  it('all significance scores are 1-10', () => {
    for (const d of buildRenderData().deals) {
      assert.ok(d.significance >= 1 && d.significance <= 10, `Deal ${d.id} sig ${d.significance} out of range`);
    }
  });

  it('all deal statuses are valid', () => {
    const valid = new Set(['Delivered', 'In Progress', 'Contracted', 'Suspended']);
    for (const d of buildRenderData().deals) {
      assert.ok(valid.has(d.status), `Invalid status: ${d.status}`);
    }
  });

  it('all deal years are in expected range', () => {
    for (const d of buildRenderData().deals) {
      assert.ok(d.year >= 2020 && d.year <= 2030, `Year ${d.year} unexpected`);
    }
  });

  it('all exporter trends are valid', () => {
    const valid = new Set(['rising', 'stable', 'declining']);
    for (const e of buildRenderData().exporters) {
      assert.ok(valid.has(e.trend), `Invalid trend: ${e.trend}`);
    }
  });

  it('all exporters have at least one top recipient', () => {
    for (const e of buildRenderData().exporters) {
      assert.ok(e.topRecipients.length > 0, `${e.country} has no recipients`);
    }
  });

  it('all deal descriptions are non-empty', () => {
    for (const d of buildRenderData().deals) {
      assert.ok(d.description.trim().length > 0, `Deal ${d.id} has empty description`);
    }
  });

  it('contains exactly 10 exporters', () => {
    assert.equal(buildRenderData().exporters.length, 10);
  });

  it('contains exactly 12 deals', () => {
    assert.equal(buildRenderData().deals.length, 12);
  });

  it('USA is present as an exporter', () => {
    const usa = buildRenderData().exporters.find(e => e.country === 'USA');
    assert.ok(usa !== undefined);
  });

  it('AUKUS deal (AD011) has highest value', () => {
    const d = buildRenderData();
    const aukus = d.deals.find(deal => deal.id === 'AD011');
    assert.ok(aukus !== undefined);
    const maxVal = Math.max(...d.deals.map(deal => deal.valueB));
    assert.equal(aukus!.valueB, maxVal);
  });

  it('at least one deal has status In Progress', () => {
    assert.ok(buildRenderData().deals.some(d => d.status === 'In Progress'));
  });

  it('at least one deal has status Delivered', () => {
    assert.ok(buildRenderData().deals.some(d => d.status === 'Delivered'));
  });

  it('at least one deal has status Contracted', () => {
    assert.ok(buildRenderData().deals.some(d => d.status === 'Contracted'));
  });

  it('at least one deal has status Suspended', () => {
    assert.ok(buildRenderData().deals.some(d => d.status === 'Suspended'));
  });
});
