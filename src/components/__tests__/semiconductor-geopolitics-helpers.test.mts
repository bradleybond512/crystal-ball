import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  CHIP_POWERS,
  EXPORT_CONTROLS,
  CHOKEPOINT_NODES,
  getByRole,
  getChokepoints,
  getCriticalChokepoints,
  getControlsByImpact,
  computeGlobalSupplyChainRiskIndex,
  sortChokepointsByRisk,
  sortControlsByImpact,
  trendClass,
  riskClass,
  buildRenderData,
} from '../semiconductor-geopolitics-helpers.ts';
import type {
  ChipPower,
  ExportControl,
  ChokepointNode,
} from '../semiconductor-geopolitics-helpers.ts';

const makeChokepoint = (overrides: Partial<ChokepointNode> = {}): ChokepointNode => ({
  id: 'test-node',
  name: 'Test Node',
  type: 'fab',
  controlledBy: 'Testco',
  marketDominance: 50,
  substituteAvailability: 'limited',
  strategicRisk: 'medium',
  notes: 'test',
  ...overrides,
});

describe('dataset presence', () => {
  it('has all 8 chip powers', () => {
    assert.equal(CHIP_POWERS.length, 8);
  });

  it('has all 6 export controls', () => {
    assert.equal(EXPORT_CONTROLS.length, 6);
  });

  it('has all 8 chokepoints', () => {
    assert.equal(CHOKEPOINT_NODES.length, 8);
  });

  it('all chip power ids are unique', () => {
    const ids = new Set(CHIP_POWERS.map((p) => p.id));
    assert.equal(ids.size, 8);
  });

  it('all export control ids are unique', () => {
    const ids = new Set(EXPORT_CONTROLS.map((c) => c.id));
    assert.equal(ids.size, 6);
  });

  it('all chokepoint ids are unique', () => {
    const ids = new Set(CHOKEPOINT_NODES.map((n) => n.id));
    assert.equal(ids.size, 8);
  });

  it('includes the expected chip power ids', () => {
    const ids = CHIP_POWERS.map((p) => p.id).sort();
    assert.deepEqual(ids, [
      'china',
      'germany',
      'india',
      'japan',
      'netherlands',
      'south-korea',
      'taiwan',
      'usa',
    ]);
  });

  it('includes the expected chokepoint ids', () => {
    const ids = CHOKEPOINT_NODES.map((n) => n.id).sort();
    assert.deepEqual(ids, [
      'advanced-packaging',
      'eda-tools',
      'euv-lenses',
      'euv-machine',
      'hbm-memory',
      'photoresist',
      'silicon-wafers',
      'tsmc-advanced-nodes',
    ]);
  });

  it('includes the expected export control ids', () => {
    const ids = EXPORT_CONTROLS.map((c) => c.id).sort();
    assert.deepEqual(ids, [
      'dutch-chipequip-2024',
      'japan-2023',
      'netherlands-2023',
      'us-2024-controls',
      'us-oct2022',
      'us-oct2023',
    ]);
  });
});

describe('chip power field integrity', () => {
  it('every chip power has non-empty keyCompanies', () => {
    for (const p of CHIP_POWERS) assert.ok(p.keyCompanies.length > 0, p.id);
  });

  it('every chip power has strategicAssets and vulnerabilities', () => {
    for (const p of CHIP_POWERS) {
      assert.ok(p.strategicAssets.length > 0, p.id);
      assert.ok(p.vulnerabilities.length > 0, p.id);
    }
  });

  it('every chip power has notes', () => {
    for (const p of CHIP_POWERS) assert.ok(p.notes.length > 0, p.id);
  });

  it('marketSharePct in range 0-100 for every chip power', () => {
    for (const p of CHIP_POWERS) {
      assert.ok(p.marketSharePct >= 0 && p.marketSharePct <= 100, p.id);
    }
  });

  it('exportControlStatus is a valid enum value', () => {
    const valid = new Set(['restricted', 'controlled', 'open']);
    for (const p of CHIP_POWERS) assert.ok(valid.has(p.exportControlStatus), p.id);
  });

  it('trend is a valid enum value', () => {
    const valid = new Set(['gaining', 'stable', 'losing']);
    for (const p of CHIP_POWERS) assert.ok(valid.has(p.trend), p.id);
  });

  it('role is a valid enum value', () => {
    const valid = new Set(['manufacturer', 'designer', 'equipment-maker', 'materials-supplier']);
    for (const p of CHIP_POWERS) assert.ok(valid.has(p.role), p.id);
  });

  it('Taiwan has 92% marketSharePct', () => {
    const taiwan = CHIP_POWERS.find((p) => p.id === 'taiwan');
    assert.equal(taiwan?.marketSharePct, 92);
  });

  it('Netherlands is equipment-maker with ASML', () => {
    const nl = CHIP_POWERS.find((p) => p.id === 'netherlands');
    assert.equal(nl?.role, 'equipment-maker');
    assert.ok(nl?.keyCompanies.includes('ASML'));
  });

  it('China has 7% marketSharePct and gaining trend', () => {
    const china = CHIP_POWERS.find((p) => p.id === 'china');
    assert.equal(china?.marketSharePct, 7);
    assert.equal(china?.trend, 'gaining');
  });

  it('India is open export control status', () => {
    const india = CHIP_POWERS.find((p) => p.id === 'india');
    assert.equal(india?.exportControlStatus, 'open');
  });

  it('Germany strategic asset references Zeiss EUV lenses', () => {
    const de = CHIP_POWERS.find((p) => p.id === 'germany');
    assert.ok(de?.strategicAssets.some((a) => /Zeiss/.test(a)));
  });
});

describe('export control field integrity', () => {
  it('every control targets China', () => {
    for (const c of EXPORT_CONTROLS) assert.equal(c.targetCountry, 'China', c.id);
  });

  it('impactLevel is a valid enum value', () => {
    const valid = new Set(['severe', 'significant', 'moderate']);
    for (const c of EXPORT_CONTROLS) assert.ok(valid.has(c.impactLevel), c.id);
  });

  it('implementedYear within plausible range', () => {
    for (const c of EXPORT_CONTROLS) {
      assert.ok(c.implementedYear >= 2022 && c.implementedYear <= 2024, c.id);
    }
  });

  it('every control has controlledItems and keyRestrictions', () => {
    for (const c of EXPORT_CONTROLS) {
      assert.ok(c.controlledItems.length > 0, c.id);
      assert.ok(c.keyRestrictions.length > 0, c.id);
    }
  });

  it('there are exactly 2 severe controls', () => {
    assert.equal(EXPORT_CONTROLS.filter((c) => c.impactLevel === 'severe').length, 2);
  });

  it('us-oct2022 is severe and from 2022', () => {
    const c = EXPORT_CONTROLS.find((x) => x.id === 'us-oct2022');
    assert.equal(c?.impactLevel, 'severe');
    assert.equal(c?.implementedYear, 2022);
  });
});

describe('chokepoint field integrity', () => {
  it('all marketDominance values in range 0-100', () => {
    for (const n of CHOKEPOINT_NODES) {
      assert.ok(n.marketDominance >= 0 && n.marketDominance <= 100, n.id);
    }
  });

  it('strategicRisk is a valid enum value', () => {
    const valid = new Set(['critical', 'high', 'medium']);
    for (const n of CHOKEPOINT_NODES) assert.ok(valid.has(n.strategicRisk), n.id);
  });

  it('substituteAvailability is a valid enum value', () => {
    const valid = new Set(['none', 'limited', 'developing', 'available']);
    for (const n of CHOKEPOINT_NODES) assert.ok(valid.has(n.substituteAvailability), n.id);
  });

  it('type is a valid enum value', () => {
    const valid = new Set(['fab', 'equipment', 'materials', 'design-tool', 'packaging']);
    for (const n of CHOKEPOINT_NODES) assert.ok(valid.has(n.type), n.id);
  });

  it('every chokepoint has controlledBy and notes', () => {
    for (const n of CHOKEPOINT_NODES) {
      assert.ok(n.controlledBy.length > 0, n.id);
      assert.ok(n.notes.length > 0, n.id);
    }
  });

  it('ASML EUV machine has 100% market dominance and no substitute', () => {
    const euv = CHOKEPOINT_NODES.find((n) => n.id === 'euv-machine');
    assert.equal(euv?.marketDominance, 100);
    assert.equal(euv?.substituteAvailability, 'none');
    assert.ok(/ASML/.test(euv?.controlledBy ?? ''));
  });

  it('Zeiss EUV lenses have 100% market dominance', () => {
    const lenses = CHOKEPOINT_NODES.find((n) => n.id === 'euv-lenses');
    assert.equal(lenses?.marketDominance, 100);
    assert.equal(lenses?.strategicRisk, 'critical');
  });

  it('HBM memory has 96% market dominance', () => {
    const hbm = CHOKEPOINT_NODES.find((n) => n.id === 'hbm-memory');
    assert.equal(hbm?.marketDominance, 96);
  });

  it('TSMC advanced nodes match 92% dominance', () => {
    const tsmc = CHOKEPOINT_NODES.find((n) => n.id === 'tsmc-advanced-nodes');
    assert.equal(tsmc?.marketDominance, 92);
  });
});

describe('getByRole', () => {
  it('returns the 3 manufacturers (taiwan, south-korea, china)', () => {
    const ids = getByRole(CHIP_POWERS, 'manufacturer')
      .map((p) => p.id)
      .sort();
    assert.deepEqual(ids, ['china', 'south-korea', 'taiwan']);
  });

  it('returns the 2 designers (usa, india)', () => {
    const ids = getByRole(CHIP_POWERS, 'designer')
      .map((p) => p.id)
      .sort();
    assert.deepEqual(ids, ['india', 'usa']);
  });

  it('returns the 2 equipment makers (netherlands, germany)', () => {
    const ids = getByRole(CHIP_POWERS, 'equipment-maker')
      .map((p) => p.id)
      .sort();
    assert.deepEqual(ids, ['germany', 'netherlands']);
  });

  it('returns the 1 materials supplier (japan)', () => {
    const ids = getByRole(CHIP_POWERS, 'materials-supplier').map((p) => p.id);
    assert.deepEqual(ids, ['japan']);
  });

  it('returns [] for empty input', () => {
    assert.deepEqual(getByRole([], 'manufacturer'), []);
  });

  it('every power belongs to exactly one returned role bucket', () => {
    const total =
      getByRole(CHIP_POWERS, 'manufacturer').length +
      getByRole(CHIP_POWERS, 'designer').length +
      getByRole(CHIP_POWERS, 'equipment-maker').length +
      getByRole(CHIP_POWERS, 'materials-supplier').length;
    assert.equal(total, CHIP_POWERS.length);
  });
});

describe('getChokepoints / getCriticalChokepoints', () => {
  it('getCriticalChokepoints returns the 5 critical nodes', () => {
    const ids = getCriticalChokepoints(CHOKEPOINT_NODES)
      .map((n) => n.id)
      .sort();
    assert.deepEqual(ids, [
      'eda-tools',
      'euv-lenses',
      'euv-machine',
      'hbm-memory',
      'tsmc-advanced-nodes',
    ]);
  });

  it('getChokepoints with critical matches getCriticalChokepoints', () => {
    assert.equal(getChokepoints(CHOKEPOINT_NODES, 'critical').length, 5);
  });

  it('getChokepoints with high returns 3 nodes', () => {
    assert.equal(getChokepoints(CHOKEPOINT_NODES, 'high').length, 3);
  });

  it('getChokepoints with medium returns 0 nodes', () => {
    assert.equal(getChokepoints(CHOKEPOINT_NODES, 'medium').length, 0);
  });

  it('getChokepoints returns [] for empty input', () => {
    assert.deepEqual(getChokepoints([], 'critical'), []);
  });

  it('getCriticalChokepoints returns [] for empty input', () => {
    assert.deepEqual(getCriticalChokepoints([]), []);
  });
});

describe('getControlsByImpact', () => {
  it('returns 2 severe controls', () => {
    assert.equal(getControlsByImpact(EXPORT_CONTROLS, 'severe').length, 2);
  });

  it('returns 3 significant controls', () => {
    assert.equal(getControlsByImpact(EXPORT_CONTROLS, 'significant').length, 3);
  });

  it('returns 1 moderate control', () => {
    assert.equal(getControlsByImpact(EXPORT_CONTROLS, 'moderate').length, 1);
  });

  it('partitions exactly across all impact levels', () => {
    const total =
      getControlsByImpact(EXPORT_CONTROLS, 'severe').length +
      getControlsByImpact(EXPORT_CONTROLS, 'significant').length +
      getControlsByImpact(EXPORT_CONTROLS, 'moderate').length;
    assert.equal(total, EXPORT_CONTROLS.length);
  });

  it('returns [] for empty input', () => {
    assert.deepEqual(getControlsByImpact([], 'severe'), []);
  });
});

describe('computeGlobalSupplyChainRiskIndex', () => {
  it('returns a value in 0-100 for the real dataset', () => {
    const idx = computeGlobalSupplyChainRiskIndex({ chokepoints: CHOKEPOINT_NODES });
    assert.ok(idx >= 0 && idx <= 100, `got ${idx}`);
  });

  it('returns 0 for empty chokepoints', () => {
    assert.equal(computeGlobalSupplyChainRiskIndex({ chokepoints: [] }), 0);
  });

  it('returns 100 when all nodes are critical/none/100%', () => {
    const nodes = [
      makeChokepoint({ id: 'a', strategicRisk: 'critical', substituteAvailability: 'none', marketDominance: 100 }),
      makeChokepoint({ id: 'b', strategicRisk: 'critical', substituteAvailability: 'none', marketDominance: 100 }),
    ];
    assert.equal(computeGlobalSupplyChainRiskIndex({ chokepoints: nodes }), 100);
  });

  it('lower-risk dataset scores below the real dataset', () => {
    const low = [
      makeChokepoint({ id: 'a', strategicRisk: 'medium', substituteAvailability: 'available', marketDominance: 10 }),
    ];
    const lowIdx = computeGlobalSupplyChainRiskIndex({ chokepoints: low });
    const realIdx = computeGlobalSupplyChainRiskIndex({ chokepoints: CHOKEPOINT_NODES });
    assert.ok(lowIdx < realIdx);
  });

  it('no-substitute node scores higher than available-substitute node', () => {
    const noSub = [makeChokepoint({ substituteAvailability: 'none', strategicRisk: 'critical', marketDominance: 100 })];
    const avail = [makeChokepoint({ substituteAvailability: 'available', strategicRisk: 'critical', marketDominance: 100 })];
    assert.ok(
      computeGlobalSupplyChainRiskIndex({ chokepoints: noSub }) >
        computeGlobalSupplyChainRiskIndex({ chokepoints: avail }),
    );
  });

  it('result is an integer', () => {
    const idx = computeGlobalSupplyChainRiskIndex({ chokepoints: CHOKEPOINT_NODES });
    assert.equal(idx, Math.round(idx));
  });
});

describe('sorting helpers', () => {
  it('sortChokepointsByRisk puts critical first', () => {
    const sorted = sortChokepointsByRisk(CHOKEPOINT_NODES);
    assert.equal(sorted[0]?.strategicRisk, 'critical');
    assert.equal(sorted[sorted.length - 1]?.strategicRisk, 'high');
  });

  it('sortChokepointsByRisk does not mutate the input', () => {
    const before = CHOKEPOINT_NODES.map((n) => n.id);
    sortChokepointsByRisk(CHOKEPOINT_NODES);
    assert.deepEqual(CHOKEPOINT_NODES.map((n) => n.id), before);
  });

  it('sortControlsByImpact puts severe first', () => {
    const sorted = sortControlsByImpact(EXPORT_CONTROLS);
    assert.equal(sorted[0]?.impactLevel, 'severe');
    assert.equal(sorted[sorted.length - 1]?.impactLevel, 'moderate');
  });

  it('sortControlsByImpact does not mutate the input', () => {
    const before = EXPORT_CONTROLS.map((c) => c.id);
    sortControlsByImpact(EXPORT_CONTROLS);
    assert.deepEqual(EXPORT_CONTROLS.map((c) => c.id), before);
  });

  it('sorts return same length as input', () => {
    assert.equal(sortChokepointsByRisk(CHOKEPOINT_NODES).length, CHOKEPOINT_NODES.length);
    assert.equal(sortControlsByImpact(EXPORT_CONTROLS).length, EXPORT_CONTROLS.length);
  });
});

describe('css class helpers', () => {
  it('trendClass maps each trend', () => {
    assert.equal(trendClass('gaining'), 'trend-gaining');
    assert.equal(trendClass('stable'), 'trend-stable');
    assert.equal(trendClass('losing'), 'trend-losing');
  });

  it('riskClass maps each risk', () => {
    assert.equal(riskClass('critical'), 'risk-critical');
    assert.equal(riskClass('high'), 'risk-high');
    assert.equal(riskClass('medium'), 'risk-medium');
  });
});

describe('buildRenderData', () => {
  it('returns the full shape', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.chipPowers));
    assert.ok(Array.isArray(d.exportControls));
    assert.ok(Array.isArray(d.chokepoints));
    assert.equal(typeof d.lastUpdated, 'string');
    assert.equal(typeof d.globalSupplyChainRiskIndex, 'number');
  });

  it('bundles all datasets at full length', () => {
    const d = buildRenderData();
    assert.equal(d.chipPowers.length, 8);
    assert.equal(d.exportControls.length, 6);
    assert.equal(d.chokepoints.length, 8);
  });

  it('risk index in range 0-100', () => {
    const d = buildRenderData();
    assert.ok(d.globalSupplyChainRiskIndex >= 0 && d.globalSupplyChainRiskIndex <= 100);
  });

  it('lastUpdated is non-empty', () => {
    assert.ok(buildRenderData().lastUpdated.length > 0);
  });

  it('risk index matches direct computation', () => {
    const d = buildRenderData();
    assert.equal(
      d.globalSupplyChainRiskIndex,
      computeGlobalSupplyChainRiskIndex({ chokepoints: CHOKEPOINT_NODES }),
    );
  });
});

describe('type guards stay sound', () => {
  it('ChipPower sample is well-formed', () => {
    const p: ChipPower = CHIP_POWERS[0]!;
    assert.equal(typeof p.country, 'string');
  });

  it('ExportControl sample is well-formed', () => {
    const c: ExportControl = EXPORT_CONTROLS[0]!;
    assert.equal(typeof c.enforcedBy, 'string');
  });
});
