import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHADOW_VESSELS,
  SHADOW_FLEET_STATS,
  getBySanctionTarget,
  getByRiskLevel,
  getDarkOrSpoofing,
  getByFlagState,
  computeGlobalEvasionRiskIndex,
  riskLevelClass,
  aisStatusClass,
  buildRenderData,
  type ShadowVessel,
  type ShadowFleetStat,
  type AisStatus,
  type RiskLevel,
} from '../shadow-fleet-helpers.js';

// ── Static data presence ──────────────────────────────────────────────────────

describe('SHADOW_VESSELS dataset', () => {
  test('contains exactly 12 vessels', () => {
    assert.equal(SHADOW_VESSELS.length, 12);
  });

  test('all expected vessel ids present', () => {
    const ids = SHADOW_VESSELS.map(v => v.id).sort();
    assert.deepEqual(ids, [
      'arctic-navigator', 'endeavour', 'gulf-stallion', 'happiness-i', 'kpz-tanker',
      'lana', 'new-prosperity', 'ns-century', 'ocean-prima', 'pablo', 'pioneer', 'sun-ship',
    ]);
  });

  test('all vessel ids are unique', () => {
    const ids = SHADOW_VESSELS.map(v => v.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every vessel has a non-empty name', () => {
    for (const v of SHADOW_VESSELS) assert.ok(v.name.length > 0, v.id);
  });

  test('every vessel has a non-empty flagState', () => {
    for (const v of SHADOW_VESSELS) assert.ok(v.flagState.length > 0, v.id);
  });

  test('every vessel has a non-empty estimatedOwner', () => {
    for (const v of SHADOW_VESSELS) assert.ok(v.estimatedOwner.length > 0, v.id);
  });

  test('every vessel has a non-empty lastKnownPort', () => {
    for (const v of SHADOW_VESSELS) assert.ok(v.lastKnownPort.length > 0, v.id);
  });

  test('every vessel has a non-empty estimatedCargoType', () => {
    for (const v of SHADOW_VESSELS) assert.ok(v.estimatedCargoType.length > 0, v.id);
  });

  test('every vessel has non-empty notes', () => {
    for (const v of SHADOW_VESSELS) assert.ok(v.notes.length > 0, v.id);
  });

  test('every vesselType is valid', () => {
    const valid = new Set(['tanker', 'bulk-carrier', 'container', 'lng']);
    for (const v of SHADOW_VESSELS) assert.ok(valid.has(v.vesselType), v.id);
  });

  test('every sanctionTarget is valid', () => {
    const valid = new Set(['russia', 'iran', 'venezuela', 'north-korea', 'multiple', 'unknown']);
    for (const v of SHADOW_VESSELS) assert.ok(valid.has(v.sanctionTarget), v.id);
  });

  test('every aisStatus is valid', () => {
    const valid = new Set(['spoofing', 'dark', 'intermittent', 'active']);
    for (const v of SHADOW_VESSELS) assert.ok(valid.has(v.aisStatus), v.id);
  });

  test('every riskLevel is valid', () => {
    const valid = new Set(['critical', 'high', 'medium']);
    for (const v of SHADOW_VESSELS) assert.ok(valid.has(v.riskLevel), v.id);
  });

  test('all detectionEvents are >= 0', () => {
    for (const v of SHADOW_VESSELS) assert.ok(v.detectionEvents >= 0, v.id);
  });

  test('all detectionEvents are integers', () => {
    for (const v of SHADOW_VESSELS) assert.ok(Number.isInteger(v.detectionEvents), v.id);
  });

  test('all yearAdded are plausible (2017-2026)', () => {
    for (const v of SHADOW_VESSELS) assert.ok(v.yearAdded >= 2017 && v.yearAdded <= 2026, v.id);
  });
});

describe('SHADOW_FLEET_STATS dataset', () => {
  test('contains exactly 5 stats', () => {
    assert.equal(SHADOW_FLEET_STATS.length, 5);
  });

  test('all expected sanction targets present', () => {
    const targets = SHADOW_FLEET_STATS.map(s => s.sanctionTarget).sort();
    assert.deepEqual(targets, ['Iran', 'Multiple', 'North Korea', 'Russia', 'Venezuela']);
  });

  test('every stat has positive estimatedVessels', () => {
    for (const s of SHADOW_FLEET_STATS) assert.ok(s.estimatedVessels > 0, s.sanctionTarget);
  });

  test('every stat has positive estimatedBpdCapacity', () => {
    for (const s of SHADOW_FLEET_STATS) assert.ok(s.estimatedBpdCapacity > 0, s.sanctionTarget);
  });

  test('every stat has at least one primary flag state', () => {
    for (const s of SHADOW_FLEET_STATS) assert.ok(s.primaryFlagStates.length > 0, s.sanctionTarget);
  });

  test('every stat has at least one transshipment zone', () => {
    for (const s of SHADOW_FLEET_STATS) assert.ok(s.keyTransshipmentZones.length > 0, s.sanctionTarget);
  });

  test('Russia has the largest fleet', () => {
    const russia = SHADOW_FLEET_STATS.find(s => s.sanctionTarget === 'Russia')!;
    for (const s of SHADOW_FLEET_STATS) assert.ok(russia.estimatedVessels >= s.estimatedVessels);
  });

  test('total estimated vessels equals 535', () => {
    const total = SHADOW_FLEET_STATS.reduce((s, st) => s + st.estimatedVessels, 0);
    assert.equal(total, 535);
  });
});

// ── getBySanctionTarget ───────────────────────────────────────────────────────

describe('getBySanctionTarget', () => {
  test("russia returns 6 vessels with expected ids", () => {
    const result = getBySanctionTarget(SHADOW_VESSELS, 'russia');
    assert.equal(result.length, 6);
    const ids = result.map(v => v.id).sort();
    assert.deepEqual(ids, ['arctic-navigator', 'kpz-tanker', 'ns-century', 'pablo', 'pioneer', 'sun-ship']);
  });

  test("russia core dark-fleet vessels are all present", () => {
    const ids = new Set(getBySanctionTarget(SHADOW_VESSELS, 'russia').map(v => v.id));
    for (const id of ['pablo', 'ns-century', 'sun-ship', 'arctic-navigator', 'pioneer']) {
      assert.ok(ids.has(id), id);
    }
  });

  test('iran returns 3 vessels', () => {
    assert.equal(getBySanctionTarget(SHADOW_VESSELS, 'iran').length, 3);
  });

  test('venezuela returns 1 vessel', () => {
    const result = getBySanctionTarget(SHADOW_VESSELS, 'venezuela');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'endeavour');
  });

  test('north-korea returns 1 vessel', () => {
    const result = getBySanctionTarget(SHADOW_VESSELS, 'north-korea');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'new-prosperity');
  });

  test('multiple returns 1 vessel', () => {
    const result = getBySanctionTarget(SHADOW_VESSELS, 'multiple');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'ocean-prima');
  });

  test('unknown returns 0 vessels', () => {
    assert.equal(getBySanctionTarget(SHADOW_VESSELS, 'unknown').length, 0);
  });

  test('every returned vessel actually matches target', () => {
    const result = getBySanctionTarget(SHADOW_VESSELS, 'iran');
    for (const v of result) assert.equal(v.sanctionTarget, 'iran');
  });

  test('empty input returns empty array', () => {
    assert.deepEqual(getBySanctionTarget([], 'russia'), []);
  });
});

// ── getByRiskLevel ────────────────────────────────────────────────────────────

describe('getByRiskLevel', () => {
  test('critical returns at least 4 vessels', () => {
    assert.ok(getByRiskLevel(SHADOW_VESSELS, 'critical').length >= 4);
  });

  test('high returns at least 1 vessel', () => {
    assert.ok(getByRiskLevel(SHADOW_VESSELS, 'high').length >= 1);
  });

  test('medium returns at least 1 vessel', () => {
    assert.ok(getByRiskLevel(SHADOW_VESSELS, 'medium').length >= 1);
  });

  test('risk buckets partition the whole fleet', () => {
    const total = (['critical', 'high', 'medium'] as RiskLevel[])
      .reduce((s, lvl) => s + getByRiskLevel(SHADOW_VESSELS, lvl).length, 0);
    assert.equal(total, SHADOW_VESSELS.length);
  });

  test('every returned vessel matches risk level', () => {
    for (const v of getByRiskLevel(SHADOW_VESSELS, 'critical')) assert.equal(v.riskLevel, 'critical');
  });

  test('empty input returns empty array', () => {
    assert.deepEqual(getByRiskLevel([], 'critical'), []);
  });
});

// ── getDarkOrSpoofing ─────────────────────────────────────────────────────────

describe('getDarkOrSpoofing', () => {
  test('returns only dark or spoofing vessels', () => {
    const result = getDarkOrSpoofing(SHADOW_VESSELS);
    for (const v of result) assert.ok(v.aisStatus === 'dark' || v.aisStatus === 'spoofing', v.id);
  });

  test('count matches manual filter', () => {
    const expected = SHADOW_VESSELS.filter(v => v.aisStatus === 'dark' || v.aisStatus === 'spoofing').length;
    assert.equal(getDarkOrSpoofing(SHADOW_VESSELS).length, expected);
  });

  test('excludes intermittent and active', () => {
    const result = getDarkOrSpoofing(SHADOW_VESSELS);
    assert.ok(!result.some(v => v.aisStatus === 'intermittent'));
    assert.ok(!result.some(v => v.aisStatus === 'active'));
  });

  test('kpz-tanker (active) is excluded', () => {
    const result = getDarkOrSpoofing(SHADOW_VESSELS);
    assert.ok(!result.some(v => v.id === 'kpz-tanker'));
  });

  test('empty input returns empty array', () => {
    assert.deepEqual(getDarkOrSpoofing([]), []);
  });
});

// ── getByFlagState ────────────────────────────────────────────────────────────

describe('getByFlagState', () => {
  test('Gabon returns 2 vessels (pablo, pioneer)', () => {
    const ids = getByFlagState(SHADOW_VESSELS, 'Gabon').map(v => v.id).sort();
    assert.deepEqual(ids, ['pablo', 'pioneer']);
  });

  test('Cameroon returns 2 vessels', () => {
    assert.equal(getByFlagState(SHADOW_VESSELS, 'Cameroon').length, 2);
  });

  test('Marshall Islands returns 1 vessel', () => {
    assert.equal(getByFlagState(SHADOW_VESSELS, 'Marshall Islands').length, 1);
  });

  test('unknown flag returns 0 vessels', () => {
    assert.equal(getByFlagState(SHADOW_VESSELS, 'Atlantis').length, 0);
  });

  test('every returned vessel matches flag', () => {
    for (const v of getByFlagState(SHADOW_VESSELS, 'Gabon')) assert.equal(v.flagState, 'Gabon');
  });

  test('empty input returns empty array', () => {
    assert.deepEqual(getByFlagState([], 'Gabon'), []);
  });
});

// ── computeGlobalEvasionRiskIndex ─────────────────────────────────────────────

describe('computeGlobalEvasionRiskIndex', () => {
  test('returns a value within 0-100 for the real dataset', () => {
    const idx = computeGlobalEvasionRiskIndex(SHADOW_VESSELS, SHADOW_FLEET_STATS);
    assert.ok(idx >= 0 && idx <= 100, `idx=${idx}`);
  });

  test('returns an integer', () => {
    const idx = computeGlobalEvasionRiskIndex(SHADOW_VESSELS, SHADOW_FLEET_STATS);
    assert.ok(Number.isInteger(idx));
  });

  test('is deterministic across repeated calls', () => {
    const a = computeGlobalEvasionRiskIndex(SHADOW_VESSELS, SHADOW_FLEET_STATS);
    const b = computeGlobalEvasionRiskIndex(SHADOW_VESSELS, SHADOW_FLEET_STATS);
    assert.equal(a, b);
  });

  test('empty inputs return 0', () => {
    assert.equal(computeGlobalEvasionRiskIndex([], []), 0);
  });

  test('larger fleet raises the index', () => {
    const small: ShadowFleetStat[] = [{ ...SHADOW_FLEET_STATS[0], estimatedVessels: 10 }];
    const big: ShadowFleetStat[] = [{ ...SHADOW_FLEET_STATS[0], estimatedVessels: 600 }];
    assert.ok(
      computeGlobalEvasionRiskIndex(SHADOW_VESSELS, big) > computeGlobalEvasionRiskIndex(SHADOW_VESSELS, small),
    );
  });

  test('more detection events raises the index', () => {
    const calm = SHADOW_VESSELS.map(v => ({ ...v, detectionEvents: 0 }));
    const hot = SHADOW_VESSELS.map(v => ({ ...v, detectionEvents: 15 }));
    assert.ok(
      computeGlobalEvasionRiskIndex(hot, SHADOW_FLEET_STATS) > computeGlobalEvasionRiskIndex(calm, SHADOW_FLEET_STATS),
    );
  });

  test('all-critical vessels score higher than all-medium', () => {
    const crit = SHADOW_VESSELS.map(v => ({ ...v, riskLevel: 'critical' as RiskLevel }));
    const med = SHADOW_VESSELS.map(v => ({ ...v, riskLevel: 'medium' as RiskLevel }));
    assert.ok(
      computeGlobalEvasionRiskIndex(crit, SHADOW_FLEET_STATS) > computeGlobalEvasionRiskIndex(med, SHADOW_FLEET_STATS),
    );
  });

  test('saturated inputs never exceed 100', () => {
    const stats: ShadowFleetStat[] = [{ ...SHADOW_FLEET_STATS[0], estimatedVessels: 10000 }];
    const vessels = SHADOW_VESSELS.map(v => ({ ...v, detectionEvents: 1000, riskLevel: 'critical' as RiskLevel }));
    assert.ok(computeGlobalEvasionRiskIndex(vessels, stats) <= 100);
  });

  test('vessels-only (no stats) still returns 0-100', () => {
    const idx = computeGlobalEvasionRiskIndex(SHADOW_VESSELS, []);
    assert.ok(idx >= 0 && idx <= 100);
  });

  test('stats-only (no vessels) still returns 0-100', () => {
    const idx = computeGlobalEvasionRiskIndex([], SHADOW_FLEET_STATS);
    assert.ok(idx >= 0 && idx <= 100);
  });
});

// ── riskLevelClass / aisStatusClass ───────────────────────────────────────────

describe('riskLevelClass', () => {
  for (const level of ['critical', 'high', 'medium'] as RiskLevel[]) {
    test(`returns a non-empty string for ${level}`, () => {
      const cls = riskLevelClass(level);
      assert.equal(typeof cls, 'string');
      assert.ok(cls.length > 0);
      assert.ok(cls.includes(level));
    });
  }

  test('distinct levels produce distinct classes', () => {
    const classes = new Set((['critical', 'high', 'medium'] as RiskLevel[]).map(riskLevelClass));
    assert.equal(classes.size, 3);
  });
});

describe('aisStatusClass', () => {
  for (const status of ['spoofing', 'dark', 'intermittent', 'active'] as AisStatus[]) {
    test(`returns a non-empty string for ${status}`, () => {
      const cls = aisStatusClass(status);
      assert.equal(typeof cls, 'string');
      assert.ok(cls.length > 0);
      assert.ok(cls.includes(status));
    });
  }

  test('distinct statuses produce distinct classes', () => {
    const classes = new Set((['spoofing', 'dark', 'intermittent', 'active'] as AisStatus[]).map(aisStatusClass));
    assert.equal(classes.size, 4);
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  test('returns all 12 vessels', () => {
    assert.equal(buildRenderData().vessels.length, 12);
  });

  test('returns all 5 stats', () => {
    assert.equal(buildRenderData().stats.length, 5);
  });

  test('totalEstimatedFleetSize is 535', () => {
    assert.equal(buildRenderData().totalEstimatedFleetSize, 535);
  });

  test('globalEvasionRiskIndex is within 0-100', () => {
    const idx = buildRenderData().globalEvasionRiskIndex;
    assert.ok(idx >= 0 && idx <= 100);
  });

  test('lastUpdated is a non-empty string', () => {
    assert.ok(buildRenderData().lastUpdated.length > 0);
  });

  test('shape has all required keys', () => {
    const data = buildRenderData();
    for (const key of ['vessels', 'stats', 'lastUpdated', 'totalEstimatedFleetSize', 'globalEvasionRiskIndex']) {
      assert.ok(key in data, key);
    }
  });

  test('is deterministic', () => {
    assert.deepEqual(buildRenderData(), buildRenderData());
  });

  test('totalEstimatedFleetSize equals sum of stat vessels', () => {
    const data = buildRenderData();
    const sum = data.stats.reduce((s, st) => s + st.estimatedVessels, 0);
    assert.equal(data.totalEstimatedFleetSize, sum);
  });
});
