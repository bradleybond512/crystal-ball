import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  rungLabel,
  rungClass,
  trendClass,
  trendArrow,
  getHighEscalation,
  getCrossedThresholds,
  computeGlobalBarometer,
  buildRenderData,
  RUNG_REFERENCE,
  type CrisisEscalation,
  type EscalationTrend,
  type EscalationDomain,
} from '../escalation-ladder-helpers.ts';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeCrisis(overrides: Partial<CrisisEscalation> = {}): CrisisEscalation {
  return {
    id: 'T001',
    name: 'Test Crisis',
    domain: 'Conventional Military' as EscalationDomain,
    rung: 10,
    maxRung: 20,
    trend: 'stable',
    description: 'Test description',
    thresholdToNext: 'Test threshold',
    weight: 1.0,
    lastUpdated: '2025-05',
    ...overrides,
  };
}

const MOCK_CRISES: CrisisEscalation[] = [
  makeCrisis({ id: 'C001', rung: 14, trend: 'stable', weight: 0.25 }),
  makeCrisis({ id: 'C002', rung: 7, trend: 'ascending', weight: 0.22 }),
  makeCrisis({ id: 'C003', rung: 11, trend: 'stable', weight: 0.18 }),
  makeCrisis({ id: 'C004', rung: 6, trend: 'ascending', weight: 0.12 }),
  makeCrisis({ id: 'C005', rung: 8, trend: 'ascending', weight: 0.10 }),
  makeCrisis({ id: 'C006', rung: 8, trend: 'ascending', weight: 0.08 }),
  makeCrisis({ id: 'C007', rung: 13, trend: 'stable', weight: 0.10 }),
  makeCrisis({ id: 'C008', rung: 9, trend: 'ascending', weight: 0.15 }),
];

// ---------------------------------------------------------------------------
// rungLabel
// ---------------------------------------------------------------------------

describe('rungLabel', () => {
  it('returns Peace for rung 0', () => {
    assert.equal(rungLabel(0), 'Peace');
  });

  it('returns Peace for rung 4', () => {
    assert.equal(rungLabel(4), 'Peace');
  });

  it('returns Crisis for rung 5', () => {
    assert.equal(rungLabel(5), 'Crisis');
  });

  it('returns Crisis for rung 9', () => {
    assert.equal(rungLabel(9), 'Crisis');
  });

  it('returns Military Action for rung 10', () => {
    assert.equal(rungLabel(10), 'Military Action');
  });

  it('returns Military Action for rung 14', () => {
    assert.equal(rungLabel(14), 'Military Action');
  });

  it('returns Limited War for rung 15', () => {
    assert.equal(rungLabel(15), 'Limited War');
  });

  it('returns General War for rung 20', () => {
    assert.equal(rungLabel(20), 'General War');
  });

  it('returns Limited War for rung 19', () => {
    assert.equal(rungLabel(19), 'Limited War');
  });
});

// ---------------------------------------------------------------------------
// rungClass
// ---------------------------------------------------------------------------

describe('rungClass', () => {
  it('returns el-peace for rung 0', () => {
    assert.equal(rungClass(0), 'el-peace');
  });

  it('returns el-peace for rung 4', () => {
    assert.equal(rungClass(4), 'el-peace');
  });

  it('returns el-crisis for rung 5', () => {
    assert.equal(rungClass(5), 'el-crisis');
  });

  it('returns el-crisis for rung 9', () => {
    assert.equal(rungClass(9), 'el-crisis');
  });

  it('returns el-limited-war for rung 10', () => {
    assert.equal(rungClass(10), 'el-limited-war');
  });

  it('returns el-limited-war for rung 14', () => {
    assert.equal(rungClass(14), 'el-limited-war');
  });

  it('returns el-general-war for rung 15', () => {
    assert.equal(rungClass(15), 'el-general-war');
  });

  it('returns el-general-war for rung 20', () => {
    assert.equal(rungClass(20), 'el-general-war');
  });
});

// ---------------------------------------------------------------------------
// trendClass
// ---------------------------------------------------------------------------

describe('trendClass', () => {
  it('returns el-trend-up for ascending', () => {
    assert.equal(trendClass('ascending'), 'el-trend-up');
  });

  it('returns el-trend-down for descending', () => {
    assert.equal(trendClass('descending'), 'el-trend-down');
  });

  it('returns el-trend-stable for stable', () => {
    assert.equal(trendClass('stable'), 'el-trend-stable');
  });
});

// ---------------------------------------------------------------------------
// trendArrow
// ---------------------------------------------------------------------------

describe('trendArrow', () => {
  it('returns up string for ascending', () => {
    assert.equal(trendArrow('ascending'), 'up');
  });

  it('returns down string for descending', () => {
    assert.equal(trendArrow('descending'), 'down');
  });

  it('returns stable string for stable', () => {
    assert.equal(trendArrow('stable'), 'stable');
  });
});

// ---------------------------------------------------------------------------
// getHighEscalation
// ---------------------------------------------------------------------------

describe('getHighEscalation', () => {
  it('returns crises at or above default threshold (10)', () => {
    const result = getHighEscalation(MOCK_CRISES);
    assert.ok(result.every(c => c.rung >= 10));
  });

  it('returns 3 crises at or above rung 10 in MOCK_CRISES', () => {
    const result = getHighEscalation(MOCK_CRISES);
    assert.equal(result.length, 3); // rungs 14, 11, 13
  });

  it('returns empty array when no crises meet threshold', () => {
    const low = MOCK_CRISES.map(c => ({ ...c, rung: 3 }));
    assert.deepEqual(getHighEscalation(low), []);
  });

  it('respects custom threshold', () => {
    const result = getHighEscalation(MOCK_CRISES, 14);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, 'C001');
  });

  it('includes crises exactly at threshold', () => {
    const crisis = makeCrisis({ rung: 10 });
    const result = getHighEscalation([crisis], 10);
    assert.equal(result.length, 1);
  });

  it('returns all crises when threshold is 0', () => {
    const result = getHighEscalation(MOCK_CRISES, 0);
    assert.equal(result.length, MOCK_CRISES.length);
  });
});

// ---------------------------------------------------------------------------
// getCrossedThresholds
// ---------------------------------------------------------------------------

describe('getCrossedThresholds', () => {
  it('returns only crises at major rungs (5,10,15,20)', () => {
    const crises = [
      makeCrisis({ id: 'A', rung: 5 }),
      makeCrisis({ id: 'B', rung: 10 }),
      makeCrisis({ id: 'C', rung: 7 }),
      makeCrisis({ id: 'D', rung: 15 }),
      makeCrisis({ id: 'E', rung: 20 }),
      makeCrisis({ id: 'F', rung: 3 }),
    ];
    const result = getCrossedThresholds(crises);
    assert.equal(result.length, 4);
    assert.ok(result.every(c => [5, 10, 15, 20].includes(c.rung)));
  });

  it('returns empty array when no crises are at major rungs', () => {
    const crises = MOCK_CRISES.map(c => ({ ...c, rung: 3 }));
    assert.deepEqual(getCrossedThresholds(crises), []);
  });

  it('returns empty for MOCK_CRISES (none hit 5,10,15,20 exactly)', () => {
    // MOCK_CRISES have rungs 14,7,11,6,8,8,13,9 - none exactly 5/10/15/20
    const result = getCrossedThresholds(MOCK_CRISES);
    assert.equal(result.length, 0);
  });

  it('handles empty array', () => {
    assert.deepEqual(getCrossedThresholds([]), []);
  });
});

// ---------------------------------------------------------------------------
// computeGlobalBarometer
// ---------------------------------------------------------------------------

describe('computeGlobalBarometer', () => {
  it('returns 0 for empty array', () => {
    assert.equal(computeGlobalBarometer([]), 0);
  });

  it('returns 0 when total weight is zero', () => {
    const crises = MOCK_CRISES.map(c => ({ ...c, weight: 0 }));
    assert.equal(computeGlobalBarometer(crises), 0);
  });

  it('returns rung value for single crisis with full weight', () => {
    const crisis = makeCrisis({ rung: 14, weight: 1.0 });
    assert.equal(computeGlobalBarometer([crisis]), 14);
  });

  it('weighted average is lower when low-rung crises have more weight', () => {
    const high = makeCrisis({ rung: 18, weight: 0.1 });
    const low = makeCrisis({ rung: 2, weight: 0.9 });
    const result = computeGlobalBarometer([high, low]);
    assert.ok(result < 10);
  });

  it('weighted average is higher when high-rung crises have more weight', () => {
    const high = makeCrisis({ rung: 18, weight: 0.9 });
    const low = makeCrisis({ rung: 2, weight: 0.1 });
    const result = computeGlobalBarometer([high, low]);
    assert.ok(result > 10);
  });

  it('result is rounded to one decimal place', () => {
    const c1 = makeCrisis({ rung: 7, weight: 1 });
    const c2 = makeCrisis({ rung: 8, weight: 2 });
    const result = computeGlobalBarometer([c1, c2]);
    // weighted avg = (7*1 + 8*2) / 3 = 23/3 = 7.666... -> 7.7
    assert.equal(result, 7.7);
  });

  it('result is between 0 and 20 for real crisis data', () => {
    const result = computeGlobalBarometer(MOCK_CRISES);
    assert.ok(result >= 0 && result <= 20);
  });
});

// ---------------------------------------------------------------------------
// buildRenderData
// ---------------------------------------------------------------------------

describe('buildRenderData', () => {
  it('returns 8 crises', () => {
    const data = buildRenderData();
    assert.equal(data.crises.length, 8);
  });

  it('globalBarometer is between 0 and 20', () => {
    const { globalBarometer } = buildRenderData();
    assert.ok(globalBarometer >= 0 && globalBarometer <= 20, `got ${globalBarometer}`);
  });

  it('highEscalationCount matches crises with rung >= 10', () => {
    const data = buildRenderData();
    const expected = data.crises.filter(c => c.rung >= 10).length;
    assert.equal(data.highEscalationCount, expected);
  });

  it('crossedThresholdCount matches crises exactly at 5/10/15/20', () => {
    const data = buildRenderData();
    const expected = data.crises.filter(c => [5, 10, 15, 20].includes(c.rung)).length;
    assert.equal(data.crossedThresholdCount, expected);
  });

  it('ascendingCount matches crises with trend ascending', () => {
    const data = buildRenderData();
    const expected = data.crises.filter(c => c.trend === 'ascending').length;
    assert.equal(data.ascendingCount, expected);
  });

  it('all crises have rung in range 0-20', () => {
    const { crises } = buildRenderData();
    assert.ok(crises.every(c => c.rung >= 0 && c.rung <= 20));
  });

  it('all crises have weight > 0', () => {
    const { crises } = buildRenderData();
    assert.ok(crises.every(c => c.weight > 0));
  });

  it('all crises have non-empty id, name, description', () => {
    const { crises } = buildRenderData();
    for (const c of crises) {
      assert.ok(c.id.length > 0, `id empty for ${c.name}`);
      assert.ok(c.name.length > 0, `name empty for ${c.id}`);
      assert.ok(c.description.length > 0, `description empty for ${c.id}`);
    }
  });

  it('Ukraine-Russia is at rung 14', () => {
    const { crises } = buildRenderData();
    const ukr = crises.find(c => c.name.includes('Ukraine'));
    assert.ok(ukr, 'Ukraine-Russia crisis not found');
    assert.equal(ukr!.rung, 14);
  });

  it('Iran Nuclear Program is at rung 9 and ascending', () => {
    const { crises } = buildRenderData();
    const iran = crises.find(c => c.name.includes('Iran Nuclear'));
    assert.ok(iran, 'Iran Nuclear Program not found');
    assert.equal(iran!.rung, 9);
    assert.equal(iran!.trend, 'ascending');
  });

  it('India-Pakistan is at rung 8', () => {
    const { crises } = buildRenderData();
    const ip = crises.find(c => c.name.includes('India'));
    assert.ok(ip, 'India-Pakistan crisis not found');
    assert.equal(ip!.rung, 8);
  });
});

// ---------------------------------------------------------------------------
// RUNG_REFERENCE
// ---------------------------------------------------------------------------

describe('RUNG_REFERENCE', () => {
  it('has entry for rung 0 as Peace', () => {
    assert.equal(RUNG_REFERENCE[0], 'Peace');
  });

  it('has entry for rung 5 as Crisis', () => {
    assert.equal(RUNG_REFERENCE[5], 'Crisis');
  });

  it('has entry for rung 10 as Military Action', () => {
    assert.equal(RUNG_REFERENCE[10], 'Military Action');
  });

  it('has entry for rung 15 as Limited War', () => {
    assert.equal(RUNG_REFERENCE[15], 'Limited War');
  });

  it('has entry for rung 20 as General War', () => {
    assert.equal(RUNG_REFERENCE[20], 'General War');
  });
});
