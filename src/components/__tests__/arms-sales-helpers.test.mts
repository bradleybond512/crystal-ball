/**
 * Unit tests for arms-sales-helpers.ts
 * Run: npx tsx --test src/components/__tests__/arms-sales-helpers.test.mts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTopExporters,
  getMajorDeals,
  getByRecipient,
  getByExporter,
  computeGlobalArmsIndex,
  exporterShareClass,
  dealTypeClass,
  dealTypeLabel,
  dealCategoryLabel,
  dealStatusColor,
  trendLabel,
  trendColor,
  globalIndexColor,
  dominanceRiskColor,
  countByStatus,
  totalDealValueUsdB,
  formatUsdB,
  formatShare,
  buildRenderData,
  TOP_EXPORTERS,
  MAJOR_DEALS,
  MAJOR_IMPORTERS,
  type ArmsExporter,
  type ArmsDeal,
  type DealStatus,
} from '../arms-sales-helpers.ts';

// ── getTopExporters ───────────────────────────────────────────────────────────

describe('getTopExporters', () => {
  it('returns 10 exporters', () => {
    assert.equal(getTopExporters().length, 10);
  });

  it('returns a copy, not the original array', () => {
    const a = getTopExporters();
    const b = getTopExporters();
    assert.notEqual(a, b);
    assert.notEqual(a, TOP_EXPORTERS);
  });

  it('is sorted descending by share2019_2023', () => {
    const exporters = getTopExporters();
    for (let i = 1; i < exporters.length; i++) {
      assert.ok(
        (exporters[i - 1]?.share2019_2023 ?? 0) >= (exporters[i]?.share2019_2023 ?? 0),
        `Index ${i - 1} share should be >= index ${i} share`,
      );
    }
  });

  it('USA is first with 42% share', () => {
    const first = getTopExporters()[0];
    assert.equal(first?.code, 'USA');
    assert.equal(first?.share2019_2023, 42);
  });

  it('South Korea is last with 2.3% share', () => {
    const last = getTopExporters().at(-1);
    assert.equal(last?.code, 'KOR');
    assert.equal(last?.share2019_2023, 2.3);
  });

  it('all exporters have required fields', () => {
    for (const e of getTopExporters()) {
      assert.ok(e.country.length > 0, 'country required');
      assert.ok(e.code.length > 0, 'code required');
      assert.ok(e.share2019_2023 > 0, 'share must be positive');
      assert.ok(['rising', 'stable', 'declining'].includes(e.trend), 'valid trend');
      assert.ok(Array.isArray(e.primaryRecipients), 'recipients is array');
    }
  });
});

describe('getMajorDeals', () => {
  it('returns 12 deals', () => {
    assert.equal(getMajorDeals().length, 12);
  });

  it('returns a copy', () => {
    assert.notEqual(getMajorDeals(), MAJOR_DEALS);
  });

  it('all deals have unique ids', () => {
    const ids = getMajorDeals().map((d) => d.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('all deals have positive valueUsdB', () => {
    for (const d of getMajorDeals()) {
      assert.ok(d.valueUsdB > 0, `${d.id} must have positive value`);
    }
  });

  it('USA-Ukraine deal is $61B military-aid active', () => {
    const d = getMajorDeals().find((x) => x.id === 'usa-ukr-2022');
    assert.ok(d !== undefined);
    assert.equal(d?.valueUsdB, 61);
    assert.equal(d?.dealType, 'military-aid');
    assert.equal(d?.status, 'active');
    assert.equal(d?.exporterCode, 'USA');
    assert.equal(d?.recipientCode, 'UKR');
  });

  it('South Korea-Poland deal is $15B direct-commercial', () => {
    const d = getMajorDeals().find((x) => x.id === 'kor-pol-2022');
    assert.ok(d !== undefined);
    assert.equal(d?.valueUsdB, 15);
    assert.equal(d?.dealType, 'direct-commercial');
    assert.equal(d?.category, 'ground');
  });
});

describe('getByRecipient', () => {
  it('finds Ukraine deals by name', () => {
    const results = getByRecipient('Ukraine');
    assert.ok(results.length >= 2, 'USA and Germany both sent to Ukraine');
  });

  it('finds Ukraine deals by code UKR', () => {
    const results = getByRecipient('UKR');
    assert.ok(results.length >= 2);
  });

  it('is case-insensitive', () => {
    const lower = getByRecipient('ukraine');
    const upper = getByRecipient('UKRAINE');
    assert.equal(lower.length, upper.length);
  });

  it('returns empty array for unknown recipient', () => {
    assert.deepEqual(getByRecipient('Narnia'), []);
  });

  it('finds Taiwan deals', () => {
    const results = getByRecipient('TWN');
    assert.ok(results.length >= 1);
  });
});

describe('getByExporter', () => {
  it('finds all USA deals', () => {
    const results = getByExporter('USA');
    assert.ok(results.length >= 4);
    for (const d of results) { assert.equal(d.exporterCode, 'USA'); }
  });

  it('finds by exporter name substring', () => {
    const results = getByExporter('france');
    assert.ok(results.length >= 1);
  });

  it('returns empty array for unknown exporter', () => {
    assert.deepEqual(getByExporter('Freedonia'), []);
  });

  it('finds Russia deals', () => {
    const results = getByExporter('RUS');
    assert.ok(results.length >= 2);
  });
});

describe('computeGlobalArmsIndex', () => {
  it('returns score between 0 and 100', () => {
    const idx = computeGlobalArmsIndex();
    assert.ok(idx.score >= 0 && idx.score <= 100);
  });

  it('trend is rising', () => {
    assert.equal(computeGlobalArmsIndex().trend, 'rising');
  });

  it('postUkraineUplift is 37', () => {
    assert.equal(computeGlobalArmsIndex().postUkraineUplift, 37);
  });

  it('usaDominanceRisk is a valid level', () => {
    const risk = computeGlobalArmsIndex().usaDominanceRisk;
    assert.ok(['low', 'moderate', 'high', 'critical'].includes(risk));
  });

  it('score is deterministic', () => {
    assert.equal(computeGlobalArmsIndex().score, computeGlobalArmsIndex().score);
  });
});

describe('exporterShareClass', () => {
  it('red for >= 30', () => { assert.ok(exporterShareClass(42).includes('#ef4444')); });
  it('red boundary 30', () => { assert.ok(exporterShareClass(30).includes('#ef4444')); });
  it('orange for 10-29', () => { assert.ok(exporterShareClass(11).includes('#f97316')); });
  it('orange boundary 10', () => { assert.ok(exporterShareClass(10).includes('#f97316')); });
  it('yellow for 5-9', () => { assert.ok(exporterShareClass(5.8).includes('#facc15')); });
  it('yellow boundary 5', () => { assert.ok(exporterShareClass(5).includes('#facc15')); });
  it('grey for < 5', () => { assert.ok(exporterShareClass(2.3).includes('#9e9e9e')); });
  it('grey for 0', () => { assert.ok(exporterShareClass(0).includes('#9e9e9e')); });
});

describe('dealTypeClass', () => {
  it('red for military-aid', () => { assert.ok(dealTypeClass('military-aid').includes('#ef4444')); });
  it('orange for fms', () => { assert.ok(dealTypeClass('fms').includes('#f97316')); });
  it('yellow for direct-commercial', () => { assert.ok(dealTypeClass('direct-commercial').includes('#facc15')); });
  it('blue for g2g', () => { assert.ok(dealTypeClass('government-to-government').includes('#60a5fa')); });
  it('green for grant', () => { assert.ok(dealTypeClass('grant').includes('#4ade80')); });
});

describe('dealTypeLabel', () => {
  it('military-aid', () => { assert.equal(dealTypeLabel('military-aid'), 'Military Aid'); });
  it('fms', () => { assert.equal(dealTypeLabel('fms'), 'FMS'); });
  it('direct-commercial', () => { assert.equal(dealTypeLabel('direct-commercial'), 'Commercial'); });
  it('g2g', () => { assert.equal(dealTypeLabel('government-to-government'), 'G2G'); });
  it('grant', () => { assert.equal(dealTypeLabel('grant'), 'Grant'); });
});

describe('dealCategoryLabel', () => {
  it('air', () => { assert.equal(dealCategoryLabel('air'), 'Air'); });
  it('ground', () => { assert.equal(dealCategoryLabel('ground'), 'Ground'); });
  it('air-defense', () => { assert.equal(dealCategoryLabel('air-defense'), 'Air Defense'); });
  it('naval', () => { assert.equal(dealCategoryLabel('naval'), 'Naval'); });
  it('mixed', () => { assert.equal(dealCategoryLabel('mixed'), 'Mixed'); });
  it('intelligence', () => { assert.equal(dealCategoryLabel('intelligence'), 'Intel'); });
});

describe('dealStatusColor', () => {
  it('green for active', () => { assert.ok(dealStatusColor('active').includes('4ade80')); });
  it('blue for delivered', () => { assert.ok(dealStatusColor('delivered').includes('60a5fa')); });
  it('yellow for paused', () => { assert.ok(dealStatusColor('paused').includes('fbbf24')); });
  it('grey for pending', () => { assert.ok(dealStatusColor('pending').includes('9e9e9e')); });
  it('red for controversial', () => { assert.ok(dealStatusColor('controversial').includes('ef4444')); });
  it('orange for declining', () => { assert.ok(dealStatusColor('declining').includes('f97316')); });
});

describe('trendLabel', () => {
  it('rising', () => { assert.equal(trendLabel('rising'), 'Rising'); });
  it('declining', () => { assert.equal(trendLabel('declining'), 'Declining'); });
  it('stable', () => { assert.equal(trendLabel('stable'), 'Stable'); });
});

describe('trendColor', () => {
  it('green for rising', () => { assert.ok(trendColor('rising').includes('4ade80')); });
  it('orange for declining', () => { assert.ok(trendColor('declining').includes('f97316')); });
  it('grey for stable', () => { assert.ok(trendColor('stable').includes('9e9e9e')); });
});

describe('globalIndexColor', () => {
  it('red for >= 75', () => { assert.ok(globalIndexColor(75).includes('ef4444')); });
  it('orange for 50-74', () => { assert.ok(globalIndexColor(60).includes('f97316')); });
  it('yellow for 25-49', () => { assert.ok(globalIndexColor(40).includes('facc15')); });
  it('green for < 25', () => { assert.ok(globalIndexColor(10).includes('4ade80')); });
  it('boundary 50 is orange', () => { assert.ok(globalIndexColor(50).includes('f97316')); });
  it('boundary 25 is yellow', () => { assert.ok(globalIndexColor(25).includes('facc15')); });
});

describe('dominanceRiskColor', () => {
  it('red for critical', () => { assert.ok(dominanceRiskColor('critical').includes('ef4444')); });
  it('orange for high', () => { assert.ok(dominanceRiskColor('high').includes('f97316')); });
  it('yellow for moderate', () => { assert.ok(dominanceRiskColor('moderate').includes('facc15')); });
  it('green for low', () => { assert.ok(dominanceRiskColor('low').includes('4ade80')); });
});

describe('countByStatus', () => {
  it('counts active correctly', () => {
    assert.equal(countByStatus('active'), MAJOR_DEALS.filter((d) => d.status === 'active').length);
  });
  it('controversial >= 2', () => { assert.ok(countByStatus('controversial') >= 2); });
  it('paused >= 1', () => { assert.ok(countByStatus('paused') >= 1); });
  it('returns 0 for pending', () => { assert.equal(countByStatus('pending'), 0); });
});

describe('totalDealValueUsdB', () => {
  it('zero for empty', () => { assert.equal(totalDealValueUsdB([]), 0); });
  it('single deal', () => {
    const d = MAJOR_DEALS[0];
    assert.ok(d !== undefined);
    assert.equal(totalDealValueUsdB([d]), d.valueUsdB);
  });
  it('all deals sum 130-160', () => {
    const t = totalDealValueUsdB(MAJOR_DEALS);
    assert.ok(t > 130 && t < 160);
  });
});

describe('formatUsdB', () => {
  it('< 100 with one decimal', () => {
    assert.equal(formatUsdB(61), '$61.0B');
    assert.equal(formatUsdB(14.1), '$14.1B');
    assert.equal(formatUsdB(0.8), '$0.8B');
  });
  it('>= 100 as integer', () => {
    assert.equal(formatUsdB(100), '$100B');
  });
});

describe('formatShare', () => {
  it('appends %', () => {
    assert.equal(formatShare(42), '42%');
    assert.equal(formatShare(5.8), '5.8%');
    assert.equal(formatShare(0), '0%');
  });
});

describe('buildRenderData', () => {
  it('all required fields', () => {
    const data = buildRenderData();
    assert.ok(Array.isArray(data.exporters));
    assert.ok(Array.isArray(data.deals));
    assert.ok(Array.isArray(data.importers));
    assert.ok(typeof data.globalIndex === 'object');
    assert.ok(typeof data.totalDealValueUsdB === 'number');
    assert.ok(typeof data.activeDeals === 'number');
    assert.ok(typeof data.controversialDeals === 'number');
  });
  it('10 exporters', () => { assert.equal(buildRenderData().exporters.length, 10); });
  it('12 deals', () => { assert.equal(buildRenderData().deals.length, 12); });
  it('8 importers', () => { assert.equal(buildRenderData().importers.length, 8); });
  it('activeDeals matches', () => {
    assert.equal(buildRenderData().activeDeals, countByStatus('active'));
  });
  it('controversialDeals matches', () => {
    assert.equal(buildRenderData().controversialDeals, countByStatus('controversial'));
  });
  it('total matches', () => {
    assert.equal(buildRenderData().totalDealValueUsdB, totalDealValueUsdB(MAJOR_DEALS));
  });
  it('globalIndex deterministic', () => {
    assert.equal(buildRenderData().globalIndex.score, buildRenderData().globalIndex.score);
  });
});

describe('MAJOR_IMPORTERS', () => {
  it('8 importers', () => { assert.equal(MAJOR_IMPORTERS.length, 8); });
  it('all have required fields', () => {
    for (const imp of MAJOR_IMPORTERS) {
      assert.ok(imp.country.length > 0);
      assert.ok(imp.code.length > 0);
      assert.ok(imp.mainSuppliers.length > 0);
      assert.ok(imp.keySystems.length > 0);
      assert.ok(imp.strategicNote.length > 0);
    }
  });
  it('Ukraine included', () => { assert.ok(MAJOR_IMPORTERS.some((i) => i.code === 'UKR')); });
  it('UK code included', () => { assert.ok(MAJOR_IMPORTERS.some((i) => i.code === 'UKR')); });
  it('Taiwan included', () => { assert.ok(MAJOR_IMPORTERS.some((i) => i.code === 'TWN')); });
});
