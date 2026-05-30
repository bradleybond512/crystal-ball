import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  getByThreatLevel,
  getDisrupted,
  getContested,
  getByRegion,
  computeGlobalDisruptionIndex,
  getMostThreatenedRegion,
  threatLevelClass,
  statusClass,
  buildRenderData,
  type LogisticsChokepoint,
  type ThreatLevel,
  type ChokepointStatus,
  type ChokepointType,
} from '../global-logistics-chokepoints-helpers.ts';

// ── buildRenderData ────────────────────────────────────────────────────────────
describe('buildRenderData', () => {
  it('returns an object with chokepoints array', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.chokepoints));
  });
  it('returns exactly 12 chokepoints', () => {
    assert.equal(buildRenderData().chokepoints.length, 12);
  });
  it('globalDisruptionIndex is in [0, 100]', () => {
    const idx = buildRenderData().globalDisruptionIndex;
    assert.ok(idx >= 0 && idx <= 100, `idx out of range: ${idx}`);
  });
  it('criticalCount is at least 3', () => {
    assert.ok(buildRenderData().criticalCount >= 3);
  });
  it('disruptedCount is at least 1', () => {
    assert.ok(buildRenderData().disruptedCount >= 1);
  });
  it('mostThreatenedRegion is a non-empty string', () => {
    const r = buildRenderData().mostThreatenedRegion;
    assert.ok(typeof r === 'string' && r.length > 0);
  });
  it('globalDisruptionIndex matches computed value from chokepoints', () => {
    const d = buildRenderData();
    assert.equal(d.globalDisruptionIndex, computeGlobalDisruptionIndex(d.chokepoints));
  });
  it('criticalCount matches getByThreatLevel result', () => {
    const d = buildRenderData();
    assert.equal(d.criticalCount, getByThreatLevel(d.chokepoints, 'Critical').length);
  });
  it('disruptedCount matches getDisrupted result', () => {
    const d = buildRenderData();
    assert.equal(d.disruptedCount, getDisrupted(d.chokepoints).length);
  });
  it('globalDisruptionIndex is positive (disruptions exist)', () => {
    assert.ok(buildRenderData().globalDisruptionIndex > 0);
  });
});

// ── getByThreatLevel ───────────────────────────────────────────────────────────
describe('getByThreatLevel', () => {
  it('returns Critical chokepoints from real data', () => {
    const result = getByThreatLevel(buildRenderData().chokepoints, 'Critical');
    assert.ok(result.length > 0);
  });
  it('all returned items match the requested level', () => {
    for (const level of ['Low', 'Elevated', 'High', 'Critical'] as ThreatLevel[]) {
      const result = getByThreatLevel(buildRenderData().chokepoints, level);
      assert.ok(result.every((c) => c.threatLevel === level));
    }
  });
  it('returns empty array for Low (no Low-threat chokepoints defined)', () => {
    assert.equal(getByThreatLevel(buildRenderData().chokepoints, 'Low').length, 0);
  });
  it('returns empty array for empty input', () => {
    assert.equal(getByThreatLevel([], 'Critical').length, 0);
  });
  it('Strait of Hormuz is in Critical results', () => {
    const critical = getByThreatLevel(buildRenderData().chokepoints, 'Critical');
    assert.ok(critical.some((c) => c.name === 'Strait of Hormuz'));
  });
  it('Taiwan Strait is in Critical results', () => {
    const critical = getByThreatLevel(buildRenderData().chokepoints, 'Critical');
    assert.ok(critical.some((c) => c.name === 'Taiwan Strait'));
  });
  it('Bab-el-Mandeb is in Critical results', () => {
    const critical = getByThreatLevel(buildRenderData().chokepoints, 'Critical');
    assert.ok(critical.some((c) => c.name === 'Bab-el-Mandeb'));
  });
  it('Suez Canal is in Critical results', () => {
    const critical = getByThreatLevel(buildRenderData().chokepoints, 'Critical');
    assert.ok(critical.some((c) => c.name.includes('Suez')));
  });
  it('exactly 4 Critical chokepoints in real data', () => {
    assert.equal(getByThreatLevel(buildRenderData().chokepoints, 'Critical').length, 4);
  });
  it('High threat level returns at least 3 chokepoints', () => {
    assert.ok(getByThreatLevel(buildRenderData().chokepoints, 'High').length >= 3);
  });
  it('Elevated returns at least 2 chokepoints', () => {
    assert.ok(getByThreatLevel(buildRenderData().chokepoints, 'Elevated').length >= 2);
  });
});

// ── getDisrupted ───────────────────────────────────────────────────────────────
describe('getDisrupted', () => {
  it('returns only Disrupted status chokepoints', () => {
    const result = getDisrupted(buildRenderData().chokepoints);
    assert.ok(result.every((c) => c.currentStatus === 'Disrupted'));
  });
  it('Suez Canal is Disrupted', () => {
    const result = getDisrupted(buildRenderData().chokepoints);
    assert.ok(result.some((c) => c.name.includes('Suez')));
  });
  it('Bab-el-Mandeb is Disrupted', () => {
    const result = getDisrupted(buildRenderData().chokepoints);
    assert.ok(result.some((c) => c.name === 'Bab-el-Mandeb'));
  });
  it('returns empty array for empty input', () => {
    assert.equal(getDisrupted([]).length, 0);
  });
  it('Open chokepoints are absent from disrupted results', () => {
    const disrupted = new Set(getDisrupted(buildRenderData().chokepoints).map((c) => c.id));
    for (const c of buildRenderData().chokepoints.filter((c) => c.currentStatus === 'Open')) {
      assert.ok(!disrupted.has(c.id), `${c.name} should not be in disrupted`);
    }
  });
  it('Contested chokepoints are absent from disrupted results', () => {
    const disrupted = new Set(getDisrupted(buildRenderData().chokepoints).map((c) => c.id));
    for (const c of buildRenderData().chokepoints.filter((c) => c.currentStatus === 'Contested')) {
      assert.ok(!disrupted.has(c.id), `${c.name} should not be in disrupted`);
    }
  });
});

// ── getContested ───────────────────────────────────────────────────────────────
describe('getContested', () => {
  it('returns only Contested status chokepoints', () => {
    const result = getContested(buildRenderData().chokepoints);
    assert.ok(result.every((c) => c.currentStatus === 'Contested'));
  });
  it('Taiwan Strait is Contested', () => {
    assert.ok(getContested(buildRenderData().chokepoints).some((c) => c.name === 'Taiwan Strait'));
  });
  it('GIUK Gap is Contested', () => {
    assert.ok(getContested(buildRenderData().chokepoints).some((c) => c.name === 'GIUK Gap'));
  });
  it('South China Sea Lanes is Contested', () => {
    assert.ok(getContested(buildRenderData().chokepoints).some((c) => c.name === 'South China Sea Lanes'));
  });
  it('returns at least 3 contested chokepoints', () => {
    assert.ok(getContested(buildRenderData().chokepoints).length >= 3);
  });
  it('returns empty for empty input', () => {
    assert.equal(getContested([]).length, 0);
  });
});

// ── getByRegion ────────────────────────────────────────────────────────────────
describe('getByRegion', () => {
  it('Middle East returns at least 2 chokepoints', () => {
    assert.ok(getByRegion(buildRenderData().chokepoints, 'Middle East').length >= 2);
  });
  it('Strait of Hormuz is in Middle East results', () => {
    assert.ok(
      getByRegion(buildRenderData().chokepoints, 'Middle East').some(
        (c) => c.name === 'Strait of Hormuz',
      ),
    );
  });
  it('returns empty for unknown region', () => {
    assert.equal(getByRegion(buildRenderData().chokepoints, 'Antarctica').length, 0);
  });
  it('returns empty for empty chokepoints array', () => {
    assert.equal(getByRegion([], 'Middle East').length, 0);
  });
  it('Southeast Asia returns Strait of Malacca', () => {
    assert.ok(
      getByRegion(buildRenderData().chokepoints, 'Southeast Asia').some(
        (c) => c.name === 'Strait of Malacca',
      ),
    );
  });
  it('Arctic returns Arctic Northern Sea Route', () => {
    assert.ok(
      getByRegion(buildRenderData().chokepoints, 'Arctic').some(
        (c) => c.name === 'Arctic Northern Sea Route',
      ),
    );
  });
  it('all returned chokepoints contain the region string', () => {
    const region = 'East Asia';
    const result = getByRegion(buildRenderData().chokepoints, region);
    assert.ok(result.every((c) => c.region.includes(region)));
  });
});

// ── computeGlobalDisruptionIndex ───────────────────────────────────────────────
describe('computeGlobalDisruptionIndex', () => {
  it('returns 0 for empty array', () => {
    assert.equal(computeGlobalDisruptionIndex([]), 0);
  });
  it('returns 0 when all chokepoints are Open', () => {
    const all = buildRenderData().chokepoints.map((c) => ({ ...c, currentStatus: 'Open' as const }));
    assert.equal(computeGlobalDisruptionIndex(all), 0);
  });
  it('returns 100 when all chokepoints are Disrupted', () => {
    const all = buildRenderData().chokepoints.map((c) => ({
      ...c,
      currentStatus: 'Disrupted' as const,
    }));
    assert.equal(computeGlobalDisruptionIndex(all), 100);
  });
  it('single Contested chokepoint returns 50', () => {
    const single: LogisticsChokepoint[] = [
      {
        id: 'X',
        name: 'Test',
        type: 'Maritime Strait',
        throughputNote: '',
        threatLevel: 'High',
        currentStatus: 'Contested',
        controllingActors: [],
        alternatives: [],
        criticalityScore: 5,
        region: 'Test',
      },
    ];
    assert.equal(computeGlobalDisruptionIndex(single), 50);
  });
  it('returns value in [0, 100] for real data', () => {
    const idx = computeGlobalDisruptionIndex(buildRenderData().chokepoints);
    assert.ok(idx >= 0 && idx <= 100, `idx=${idx}`);
  });
  it('higher-criticality Disrupted chokepoint produces higher index than low-criticality Disrupted', () => {
    const make = (id: string, criticality: number, status: ChokepointStatus): LogisticsChokepoint => ({
      id,
      name: id,
      type: 'Maritime Strait',
      throughputNote: '',
      threatLevel: 'High',
      currentStatus: status,
      controllingActors: [],
      alternatives: [],
      criticalityScore: criticality,
      region: 'X',
    });
    const lowCrit = [make('a', 1, 'Disrupted'), make('b', 9, 'Open')];
    const highCrit = [make('a', 9, 'Disrupted'), make('b', 1, 'Open')];
    assert.ok(computeGlobalDisruptionIndex(highCrit) > computeGlobalDisruptionIndex(lowCrit));
  });
  it('Disrupted produces higher index than Contested for same criticality', () => {
    const makeOne = (status: ChokepointStatus): LogisticsChokepoint[] => [
      {
        id: '1',
        name: 'X',
        type: 'Canal',
        throughputNote: '',
        threatLevel: 'Critical',
        currentStatus: status,
        controllingActors: [],
        alternatives: [],
        criticalityScore: 5,
        region: 'X',
      },
    ];
    assert.ok(
      computeGlobalDisruptionIndex(makeOne('Disrupted')) >
        computeGlobalDisruptionIndex(makeOne('Contested')),
    );
  });
  it('result is always an integer', () => {
    const idx = computeGlobalDisruptionIndex(buildRenderData().chokepoints);
    assert.equal(idx, Math.round(idx));
  });
});

// ── getMostThreatenedRegion ────────────────────────────────────────────────────
describe('getMostThreatenedRegion', () => {
  it('returns Unknown for empty array', () => {
    assert.equal(getMostThreatenedRegion([]), 'Unknown');
  });
  it('returns a non-empty string for real data', () => {
    const r = getMostThreatenedRegion(buildRenderData().chokepoints);
    assert.ok(typeof r === 'string' && r.length > 0);
  });
  it('returns a region that exists in the chokepoints', () => {
    const result = getMostThreatenedRegion(buildRenderData().chokepoints);
    const regions = buildRenderData().chokepoints.map((c) => c.region.split(' / ')[0]);
    assert.ok(regions.includes(result), `Region "${result}" not in data`);
  });
  it('single chokepoint returns its own region prefix', () => {
    const c = buildRenderData().chokepoints[0];
    const result = getMostThreatenedRegion([c]);
    assert.ok(c.region.startsWith(result));
  });
  it('two Critical entries in one region beats one Critical in another', () => {
    const make = (id: string, region: string, level: ThreatLevel): LogisticsChokepoint => ({
      id,
      name: id,
      type: 'Maritime Strait',
      throughputNote: '',
      threatLevel: level,
      currentStatus: 'Open',
      controllingActors: [],
      alternatives: [],
      criticalityScore: 5,
      region,
    });
    const data = [
      make('a', 'Middle East', 'Critical'),
      make('b', 'Middle East', 'Critical'),
      make('c', 'East Asia', 'Critical'),
    ];
    assert.equal(getMostThreatenedRegion(data), 'Middle East');
  });
  it('Critical outweighs multiple Low entries', () => {
    const make = (id: string, region: string, level: ThreatLevel): LogisticsChokepoint => ({
      id,
      name: id,
      type: 'Maritime Strait',
      throughputNote: '',
      threatLevel: level,
      currentStatus: 'Open',
      controllingActors: [],
      alternatives: [],
      criticalityScore: 5,
      region,
    });
    const data = [
      make('a', 'Region A', 'Critical'),
      make('b', 'Region B', 'Low'),
      make('c', 'Region B', 'Low'),
      make('d', 'Region B', 'Low'),
    ];
    // Region A: 4 points; Region B: 3 points — A wins
    assert.equal(getMostThreatenedRegion(data), 'Region A');
  });
});

// ── threatLevelClass ───────────────────────────────────────────────────────────
describe('threatLevelClass', () => {
  it('Low returns threat-low', () => {
    assert.equal(threatLevelClass('Low'), 'threat-low');
  });
  it('Elevated returns threat-elevated', () => {
    assert.equal(threatLevelClass('Elevated'), 'threat-elevated');
  });
  it('High returns threat-high', () => {
    assert.equal(threatLevelClass('High'), 'threat-high');
  });
  it('Critical returns threat-critical', () => {
    assert.equal(threatLevelClass('Critical'), 'threat-critical');
  });
  it('returns a string for all known levels', () => {
    for (const level of ['Low', 'Elevated', 'High', 'Critical'] as ThreatLevel[]) {
      assert.equal(typeof threatLevelClass(level), 'string');
    }
  });
  it('Low and Critical return different strings', () => {
    assert.notEqual(threatLevelClass('Low'), threatLevelClass('Critical'));
  });
  it('all four levels map to distinct strings', () => {
    const vals = (['Low', 'Elevated', 'High', 'Critical'] as ThreatLevel[]).map(threatLevelClass);
    assert.equal(vals.length, new Set(vals).size);
  });
});

// ── statusClass ────────────────────────────────────────────────────────────────
describe('statusClass', () => {
  it('Open returns status-open', () => {
    assert.equal(statusClass('Open'), 'status-open');
  });
  it('Disrupted returns status-disrupted', () => {
    assert.equal(statusClass('Disrupted'), 'status-disrupted');
  });
  it('Contested returns status-contested', () => {
    assert.equal(statusClass('Contested'), 'status-contested');
  });
  it('all three statuses map to distinct strings', () => {
    const vals = (['Open', 'Disrupted', 'Contested'] as ChokepointStatus[]).map(statusClass);
    assert.equal(vals.length, new Set(vals).size);
  });
  it('returns a string for all known statuses', () => {
    for (const s of ['Open', 'Disrupted', 'Contested'] as ChokepointStatus[]) {
      assert.equal(typeof statusClass(s), 'string');
    }
  });
});

// ── data integrity ─────────────────────────────────────────────────────────────
describe('data integrity', () => {
  it('all criticalityScores are in [1, 10]', () => {
    for (const c of buildRenderData().chokepoints) {
      assert.ok(c.criticalityScore >= 1 && c.criticalityScore <= 10, `${c.name} out of range`);
    }
  });
  it('all chokepoints have unique ids', () => {
    const ids = buildRenderData().chokepoints.map((c) => c.id);
    assert.equal(ids.length, new Set(ids).size);
  });
  it('all chokepoints have non-empty names', () => {
    for (const c of buildRenderData().chokepoints) {
      assert.ok(c.name.length > 0, `Empty name for id=${c.id}`);
    }
  });
  it('all chokepoints have at least one controlling actor', () => {
    for (const c of buildRenderData().chokepoints) {
      assert.ok(c.controllingActors.length > 0, `${c.name} has no actors`);
    }
  });
  it('all chokepoints have at least one alternative route', () => {
    for (const c of buildRenderData().chokepoints) {
      assert.ok(c.alternatives.length > 0, `${c.name} has no alternatives`);
    }
  });
  it('Strait of Hormuz has criticalityScore 10', () => {
    const c = buildRenderData().chokepoints.find((c) => c.name === 'Strait of Hormuz');
    assert.equal(c?.criticalityScore, 10);
  });
  it('Panama Canal has type Canal', () => {
    const c = buildRenderData().chokepoints.find((c) => c.name === 'Panama Canal');
    assert.equal(c?.type, 'Canal');
  });
  it('GIUK Gap has type Military Choke', () => {
    const c = buildRenderData().chokepoints.find((c) => c.name === 'GIUK Gap');
    assert.equal(c?.type, 'Military Choke');
  });
  it('Cape of Good Hope has type Sea Route', () => {
    const c = buildRenderData().chokepoints.find((c) => c.name === 'Cape of Good Hope');
    assert.equal(c?.type, 'Sea Route');
  });
  it('Suez Canal is type Canal', () => {
    const c = buildRenderData().chokepoints.find((c) => c.name.includes('Suez'));
    assert.equal(c?.type, 'Canal');
  });
  it('all type values are valid ChokepointType', () => {
    const valid = new Set<ChokepointType>([
      'Maritime Strait',
      'Canal',
      'Sea Route',
      'Military Choke',
    ]);
    for (const c of buildRenderData().chokepoints) {
      assert.ok(valid.has(c.type as ChokepointType), `Unknown type: ${c.type}`);
    }
  });
  it('all threatLevel values are valid ThreatLevel', () => {
    const valid = new Set<ThreatLevel>(['Low', 'Elevated', 'High', 'Critical']);
    for (const c of buildRenderData().chokepoints) {
      assert.ok(valid.has(c.threatLevel as ThreatLevel), `Unknown level: ${c.threatLevel}`);
    }
  });
  it('all currentStatus values are valid ChokepointStatus', () => {
    const valid = new Set<ChokepointStatus>(['Open', 'Disrupted', 'Contested']);
    for (const c of buildRenderData().chokepoints) {
      assert.ok(valid.has(c.currentStatus as ChokepointStatus), `Unknown status: ${c.currentStatus}`);
    }
  });
  it('all regions are non-empty strings', () => {
    for (const c of buildRenderData().chokepoints) {
      assert.ok(typeof c.region === 'string' && c.region.length > 0, `${c.name} has empty region`);
    }
  });
  it('Taiwan Strait has criticalityScore 10', () => {
    const c = buildRenderData().chokepoints.find((c) => c.name === 'Taiwan Strait');
    assert.equal(c?.criticalityScore, 10);
  });
});
