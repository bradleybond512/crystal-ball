import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  computeGlobalSeabedRiskIndex,
  getCriticalAssets,
  getHighThreatAssets,
  getMostVulnerable,
  getUnresolvedIncidents,
  getConfirmedSabotage,
  threatLevelClass,
  incidentTypeClass,
  buildRenderData,
  type SeabedAsset,
  type SeabedIncident,
  type ThreatLevel,
  type IncidentType,
} from '../seabed-warfare-helpers.ts';

// ── Test fixtures ─────────────────────────────────────────────────────────────

function makeAsset(overrides: Partial<SeabedAsset> = {}): SeabedAsset {
  return {
    id: 'TEST',
    name: 'Test Asset',
    type: 'Submarine Cable',
    route: 'A — B',
    operators: ['TestCo'],
    capacityNote: 'test capacity',
    threatLevel: 'Low',
    threatActors: ['None'],
    criticalityScore: 5,
    ...overrides,
  };
}

function makeIncident(overrides: Partial<SeabedIncident> = {}): SeabedIncident {
  return {
    id: 'TINC',
    date: '2024-01-01',
    asset: 'Test Asset',
    type: 'Surveillance',
    location: 'Test Sea',
    suspectedActor: 'Unknown',
    attribution: 'Unknown',
    description: 'test description',
    impactSeverity: 3,
    resolved: false,
    ...overrides,
  };
}

// ── computeGlobalSeabedRiskIndex ──────────────────────────────────────────────

describe('computeGlobalSeabedRiskIndex', () => {
  it('returns 0 for empty assets array', () => {
    assert.equal(computeGlobalSeabedRiskIndex([], []), 0);
  });

  it('returns 0 when all assets are Low threat and no unresolved sabotage', () => {
    const assets = [makeAsset({ threatLevel: 'Low' }), makeAsset({ threatLevel: 'Low' })];
    assert.equal(computeGlobalSeabedRiskIndex(assets, []), 0);
  });

  it('returns >=60 when all assets are Critical', () => {
    const assets = [makeAsset({ threatLevel: 'Critical' }), makeAsset({ threatLevel: 'Critical' })];
    const score = computeGlobalSeabedRiskIndex(assets, []);
    assert.ok(score >= 60, `Expected >=60, got ${score}`);
  });

  it('returns >=60 when all assets are High threat', () => {
    const assets = [makeAsset({ threatLevel: 'High' }), makeAsset({ threatLevel: 'High' })];
    const score = computeGlobalSeabedRiskIndex(assets, []);
    assert.ok(score >= 60, `Expected >=60, got ${score}`);
  });

  it('adds incident score for unresolved Sabotage (Confirmed)', () => {
    const assets = [makeAsset({ threatLevel: 'Low' })];
    const incidents = [makeIncident({ type: 'Sabotage (Confirmed)', resolved: false })];
    const score = computeGlobalSeabedRiskIndex(assets, incidents);
    assert.ok(score > 0, `Expected >0, got ${score}`);
  });

  it('adds incident score for unresolved Sabotage (Suspected)', () => {
    const assets = [makeAsset({ threatLevel: 'Low' })];
    const incidents = [makeIncident({ type: 'Sabotage (Suspected)', resolved: false })];
    const score = computeGlobalSeabedRiskIndex(assets, incidents);
    assert.ok(score > 0, `Expected >0, got ${score}`);
  });

  it('does not add score for resolved sabotage incidents', () => {
    const assets = [makeAsset({ threatLevel: 'Low' })];
    const incidents = [makeIncident({ type: 'Sabotage (Confirmed)', resolved: true })];
    assert.equal(computeGlobalSeabedRiskIndex(assets, incidents), 0);
  });

  it('does not add score for Surveillance incidents', () => {
    const assets = [makeAsset({ threatLevel: 'Low' })];
    const base = computeGlobalSeabedRiskIndex(assets, []);
    const withSurv = computeGlobalSeabedRiskIndex(assets, [makeIncident({ type: 'Surveillance', resolved: false })]);
    assert.equal(withSurv, base);
  });

  it('does not add score for Positioning incidents', () => {
    const assets = [makeAsset({ threatLevel: 'Low' })];
    const base = computeGlobalSeabedRiskIndex(assets, []);
    const withPos = computeGlobalSeabedRiskIndex(assets, [makeIncident({ type: 'Positioning', resolved: false })]);
    assert.equal(withPos, base);
  });

  it('caps result at 100', () => {
    const assets = Array.from({ length: 20 }, (_, i) => makeAsset({ id: `A${i}`, threatLevel: 'Critical' }));
    const incidents = Array.from({ length: 10 }, (_, i) => makeIncident({ id: `I${i}`, type: 'Sabotage (Confirmed)', resolved: false }));
    const score = computeGlobalSeabedRiskIndex(assets, incidents);
    assert.ok(score <= 100, `Expected <=100, got ${score}`);
  });

  it('returns an integer (Math.round applied)', () => {
    const assets = [makeAsset({ threatLevel: 'High' }), makeAsset({ threatLevel: 'Low' })];
    const score = computeGlobalSeabedRiskIndex(assets, []);
    assert.equal(score, Math.round(score));
  });

  it('mixed threat levels score lower than all-Critical', () => {
    const mixed = computeGlobalSeabedRiskIndex(
      [makeAsset({ threatLevel: 'Critical' }), makeAsset({ threatLevel: 'Low' })], []);
    const allCrit = computeGlobalSeabedRiskIndex(
      [makeAsset({ threatLevel: 'Critical' }), makeAsset({ threatLevel: 'Critical' })], []);
    assert.ok(mixed < allCrit, 'Mixed should score lower than all-Critical');
  });

  it('Elevated threat level is not counted as high threat', () => {
    const assets = [makeAsset({ threatLevel: 'Elevated' })];
    assert.equal(computeGlobalSeabedRiskIndex(assets, []), 0);
  });

  it('two unresolved sabotage incidents score higher than one', () => {
    const assets = [makeAsset({ threatLevel: 'Low' })];
    const one = computeGlobalSeabedRiskIndex(assets, [makeIncident({ id: 'I1', type: 'Sabotage (Confirmed)', resolved: false })]);
    const two = computeGlobalSeabedRiskIndex(assets, [
      makeIncident({ id: 'I1', type: 'Sabotage (Confirmed)', resolved: false }),
      makeIncident({ id: 'I2', type: 'Sabotage (Suspected)', resolved: false }),
    ]);
    assert.ok(two >= one, 'Two sabotage incidents should score >= one');
  });
});

// ── getCriticalAssets ─────────────────────────────────────────────────────────

describe('getCriticalAssets', () => {
  it('returns empty array when no Critical assets', () => {
    const assets = [makeAsset({ threatLevel: 'Low' }), makeAsset({ threatLevel: 'High' })];
    assert.deepEqual(getCriticalAssets(assets), []);
  });

  it('returns only Critical assets from mixed list', () => {
    const crit = makeAsset({ id: 'C1', threatLevel: 'Critical' });
    const high = makeAsset({ id: 'H1', threatLevel: 'High' });
    const result = getCriticalAssets([crit, high]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'C1');
  });

  it('returns all when all are Critical', () => {
    const assets = [makeAsset({ id: 'C1', threatLevel: 'Critical' }), makeAsset({ id: 'C2', threatLevel: 'Critical' })];
    assert.equal(getCriticalAssets(assets).length, 2);
  });

  it('returns empty for empty input', () => {
    assert.deepEqual(getCriticalAssets([]), []);
  });

  it('excludes Low, Elevated, and High assets', () => {
    const assets = [
      makeAsset({ id: 'L', threatLevel: 'Low' }),
      makeAsset({ id: 'E', threatLevel: 'Elevated' }),
      makeAsset({ id: 'H', threatLevel: 'High' }),
      makeAsset({ id: 'C', threatLevel: 'Critical' }),
    ];
    const result = getCriticalAssets(assets);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'C');
  });
});

// ── getHighThreatAssets ───────────────────────────────────────────────────────

describe('getHighThreatAssets', () => {
  it('returns High and Critical assets', () => {
    const assets = [
      makeAsset({ id: 'L', threatLevel: 'Low' }),
      makeAsset({ id: 'E', threatLevel: 'Elevated' }),
      makeAsset({ id: 'H', threatLevel: 'High' }),
      makeAsset({ id: 'C', threatLevel: 'Critical' }),
    ];
    const result = getHighThreatAssets(assets);
    assert.equal(result.length, 2);
    assert.ok(result.some((a) => a.id === 'H'));
    assert.ok(result.some((a) => a.id === 'C'));
  });

  it('excludes Low and Elevated assets', () => {
    const assets = [makeAsset({ id: 'L', threatLevel: 'Low' }), makeAsset({ id: 'E', threatLevel: 'Elevated' })];
    assert.deepEqual(getHighThreatAssets(assets), []);
  });

  it('returns empty for empty input', () => {
    assert.deepEqual(getHighThreatAssets([]), []);
  });

  it('returns all when all are High', () => {
    const assets = [makeAsset({ id: 'H1', threatLevel: 'High' }), makeAsset({ id: 'H2', threatLevel: 'High' })];
    assert.equal(getHighThreatAssets(assets).length, 2);
  });

  it('count is always >= getCriticalAssets count', () => {
    const assets = [
      makeAsset({ id: 'C1', threatLevel: 'Critical' }),
      makeAsset({ id: 'H1', threatLevel: 'High' }),
      makeAsset({ id: 'L1', threatLevel: 'Low' }),
    ];
    assert.ok(getHighThreatAssets(assets).length >= getCriticalAssets(assets).length);
  });
});

// ── getMostVulnerable ─────────────────────────────────────────────────────────

describe('getMostVulnerable', () => {
  const assets: SeabedAsset[] = [
    makeAsset({ id: 'A1', criticalityScore: 3 }),
    makeAsset({ id: 'A2', criticalityScore: 10 }),
    makeAsset({ id: 'A3', criticalityScore: 7 }),
    makeAsset({ id: 'A4', criticalityScore: 1 }),
    makeAsset({ id: 'A5', criticalityScore: 9 }),
    makeAsset({ id: 'A6', criticalityScore: 5 }),
  ];

  it('returns assets sorted by criticalityScore descending', () => {
    const result = getMostVulnerable(assets, 6);
    const scores = result.map((a) => a.criticalityScore);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i - 1] >= scores[i], `Not descending at index ${i}`);
    }
  });

  it('returns at most n assets when n is specified', () => {
    assert.equal(getMostVulnerable(assets, 3).length, 3);
  });

  it('default n=5 returns at most 5 assets', () => {
    assert.equal(getMostVulnerable(assets).length, 5);
  });

  it('first result has the highest criticalityScore', () => {
    const result = getMostVulnerable(assets);
    assert.equal(result[0].id, 'A2');
    assert.equal(result[0].criticalityScore, 10);
  });

  it('second result has the second-highest criticalityScore', () => {
    const result = getMostVulnerable(assets);
    assert.equal(result[1].id, 'A5');
    assert.equal(result[1].criticalityScore, 9);
  });

  it('does not mutate the original array order', () => {
    const originalIds = assets.map((a) => a.id);
    getMostVulnerable(assets);
    assert.deepEqual(assets.map((a) => a.id), originalIds);
  });

  it('returns all assets when n > length', () => {
    const small = [makeAsset({ id: 'X1', criticalityScore: 8 })];
    assert.equal(getMostVulnerable(small, 10).length, 1);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(getMostVulnerable([]), []);
  });

  it('n=1 returns exactly one asset', () => {
    assert.equal(getMostVulnerable(assets, 1).length, 1);
  });
});

// ── getUnresolvedIncidents ────────────────────────────────────────────────────

describe('getUnresolvedIncidents', () => {
  it('returns only unresolved incidents', () => {
    const incidents = [
      makeIncident({ id: 'U1', resolved: false }),
      makeIncident({ id: 'R1', resolved: true }),
      makeIncident({ id: 'U2', resolved: false }),
    ];
    const result = getUnresolvedIncidents(incidents);
    assert.equal(result.length, 2);
    assert.ok(result.every((i) => !i.resolved));
  });

  it('returns empty when all incidents are resolved', () => {
    const incidents = [makeIncident({ resolved: true }), makeIncident({ resolved: true })];
    assert.deepEqual(getUnresolvedIncidents(incidents), []);
  });

  it('returns all when none are resolved', () => {
    const incidents = [makeIncident({ id: 'U1', resolved: false }), makeIncident({ id: 'U2', resolved: false })];
    assert.equal(getUnresolvedIncidents(incidents).length, 2);
  });

  it('returns empty for empty input', () => {
    assert.deepEqual(getUnresolvedIncidents([]), []);
  });

  it('does not include resolved incidents in output', () => {
    const incidents = [makeIncident({ id: 'U', resolved: false }), makeIncident({ id: 'R', resolved: true })];
    const result = getUnresolvedIncidents(incidents);
    assert.ok(!result.some((i) => i.id === 'R'));
  });
});

// ── getConfirmedSabotage ──────────────────────────────────────────────────────

describe('getConfirmedSabotage', () => {
  it('returns only Sabotage (Confirmed) incidents', () => {
    const incidents = [
      makeIncident({ id: 'S1', type: 'Sabotage (Confirmed)' }),
      makeIncident({ id: 'S2', type: 'Sabotage (Suspected)' }),
      makeIncident({ id: 'S3', type: 'Surveillance' }),
    ];
    const result = getConfirmedSabotage(incidents);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'S1');
  });

  it('returns empty when no confirmed sabotage', () => {
    const incidents = [makeIncident({ type: 'Sabotage (Suspected)' }), makeIncident({ type: 'Positioning' })];
    assert.deepEqual(getConfirmedSabotage(incidents), []);
  });

  it('returns multiple confirmed sabotage incidents', () => {
    const incidents = [makeIncident({ id: 'C1', type: 'Sabotage (Confirmed)' }), makeIncident({ id: 'C2', type: 'Sabotage (Confirmed)' })];
    assert.equal(getConfirmedSabotage(incidents).length, 2);
  });

  it('returns empty for empty input', () => {
    assert.deepEqual(getConfirmedSabotage([]), []);
  });

  it('does not include Accident type incidents', () => {
    assert.deepEqual(getConfirmedSabotage([makeIncident({ type: 'Accident' })]), []);
  });
});

// ── threatLevelClass ──────────────────────────────────────────────────────────

describe('threatLevelClass', () => {
  it('returns threat-low for Low', () => {
    assert.equal(threatLevelClass('Low'), 'threat-low');
  });

  it('returns threat-elevated for Elevated', () => {
    assert.equal(threatLevelClass('Elevated'), 'threat-elevated');
  });

  it('returns threat-high for High', () => {
    assert.equal(threatLevelClass('High'), 'threat-high');
  });

  it('returns threat-critical for Critical', () => {
    assert.equal(threatLevelClass('Critical'), 'threat-critical');
  });

  it('all 4 threat levels produce distinct class strings', () => {
    const levels: ThreatLevel[] = ['Low', 'Elevated', 'High', 'Critical'];
    const classes = levels.map((l) => threatLevelClass(l));
    assert.equal(new Set(classes).size, 4);
  });

  it('all class strings start with threat-', () => {
    const levels: ThreatLevel[] = ['Low', 'Elevated', 'High', 'Critical'];
    for (const level of levels) {
      assert.ok(threatLevelClass(level).startsWith('threat-'), `${level} class should start with threat-`);
    }
  });
});

// ── incidentTypeClass ─────────────────────────────────────────────────────────

describe('incidentTypeClass', () => {
  it('returns inc-sabotage for Sabotage (Confirmed)', () => {
    assert.equal(incidentTypeClass('Sabotage (Confirmed)'), 'inc-sabotage');
  });

  it('returns inc-suspected for Sabotage (Suspected)', () => {
    assert.equal(incidentTypeClass('Sabotage (Suspected)'), 'inc-suspected');
  });

  it('returns inc-accident for Accident', () => {
    assert.equal(incidentTypeClass('Accident'), 'inc-accident');
  });

  it('returns inc-surv for Surveillance', () => {
    assert.equal(incidentTypeClass('Surveillance'), 'inc-surv');
  });

  it('returns inc-position for Positioning', () => {
    assert.equal(incidentTypeClass('Positioning'), 'inc-position');
  });

  it('all 5 incident types produce distinct class strings', () => {
    const types: IncidentType[] = ['Sabotage (Confirmed)', 'Sabotage (Suspected)', 'Accident', 'Surveillance', 'Positioning'];
    const classes = types.map((t) => incidentTypeClass(t));
    assert.equal(new Set(classes).size, 5);
  });

  it('all class strings start with inc-', () => {
    const types: IncidentType[] = ['Sabotage (Confirmed)', 'Sabotage (Suspected)', 'Accident', 'Surveillance', 'Positioning'];
    for (const type of types) {
      assert.ok(incidentTypeClass(type).startsWith('inc-'), `${type} class should start with inc-`);
    }
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns an object with all required fields', () => {
    const data = buildRenderData();
    assert.ok(Array.isArray(data.assets));
    assert.ok(Array.isArray(data.incidents));
    assert.ok(typeof data.globalSeabedRiskIndex === 'number');
    assert.ok(typeof data.criticalAssetCount === 'number');
    assert.ok(typeof data.highThreatCount === 'number');
    assert.ok(typeof data.recentIncidentCount === 'number');
    assert.ok(Array.isArray(data.mostVulnerableAssets));
  });

  it('returns exactly 10 assets', () => {
    assert.equal(buildRenderData().assets.length, 10);
  });

  it('returns exactly 6 incidents', () => {
    assert.equal(buildRenderData().incidents.length, 6);
  });

  it('criticalAssetCount matches actual Critical assets in array', () => {
    const data = buildRenderData();
    const actual = data.assets.filter((a) => a.threatLevel === 'Critical').length;
    assert.equal(data.criticalAssetCount, actual);
  });

  it('highThreatCount matches High+Critical asset count', () => {
    const data = buildRenderData();
    const actual = data.assets.filter((a) => a.threatLevel === 'High' || a.threatLevel === 'Critical').length;
    assert.equal(data.highThreatCount, actual);
  });

  it('recentIncidentCount matches incidents array length', () => {
    const data = buildRenderData();
    assert.equal(data.recentIncidentCount, data.incidents.length);
  });

  it('mostVulnerableAssets has at most 5 entries', () => {
    assert.ok(buildRenderData().mostVulnerableAssets.length <= 5);
  });

  it('mostVulnerableAssets are sorted by criticalityScore descending', () => {
    const { mostVulnerableAssets } = buildRenderData();
    const scores = mostVulnerableAssets.map((a) => a.criticalityScore);
    for (let i = 1; i < scores.length; i++) {
      assert.ok(scores[i - 1] >= scores[i], `Not descending at index ${i}`);
    }
  });

  it('globalSeabedRiskIndex is in [0, 100]', () => {
    const { globalSeabedRiskIndex } = buildRenderData();
    assert.ok(globalSeabedRiskIndex >= 0 && globalSeabedRiskIndex <= 100);
  });

  it('globalSeabedRiskIndex is an integer', () => {
    const { globalSeabedRiskIndex } = buildRenderData();
    assert.equal(globalSeabedRiskIndex, Math.round(globalSeabedRiskIndex));
  });

  it('all assets have valid ThreatLevel values', () => {
    const valid = new Set(['Low', 'Elevated', 'High', 'Critical']);
    for (const a of buildRenderData().assets) {
      assert.ok(valid.has(a.threatLevel), `Invalid threatLevel: ${a.threatLevel}`);
    }
  });

  it('all assets have criticalityScore in [1, 10]', () => {
    for (const a of buildRenderData().assets) {
      assert.ok(a.criticalityScore >= 1 && a.criticalityScore <= 10, `${a.id} criticalityScore out of range`);
    }
  });

  it('all incidents have impactSeverity in [1, 10]', () => {
    for (const inc of buildRenderData().incidents) {
      assert.ok(inc.impactSeverity >= 1 && inc.impactSeverity <= 10, `${inc.id} impactSeverity out of range`);
    }
  });

  it('all assets have non-empty operators array', () => {
    for (const a of buildRenderData().assets) {
      assert.ok(a.operators.length > 0, `${a.id} has no operators`);
    }
  });

  it('all assets have non-empty threatActors array', () => {
    for (const a of buildRenderData().assets) {
      assert.ok(a.threatActors.length > 0, `${a.id} has no threatActors`);
    }
  });

  it('all assets have unique ids', () => {
    const ids = buildRenderData().assets.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length, 'Asset IDs are not unique');
  });

  it('all incidents have unique ids', () => {
    const ids = buildRenderData().incidents.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length, 'Incident IDs are not unique');
  });

  it('highThreatCount is >= criticalAssetCount', () => {
    const { highThreatCount, criticalAssetCount } = buildRenderData();
    assert.ok(highThreatCount >= criticalAssetCount);
  });

  it('mostVulnerableAssets are a subset of assets', () => {
    const data = buildRenderData();
    const assetIds = new Set(data.assets.map((a) => a.id));
    for (const a of data.mostVulnerableAssets) {
      assert.ok(assetIds.has(a.id), `mostVulnerable asset ${a.id} not in assets array`);
    }
  });

  it('all assets have non-empty name and route strings', () => {
    for (const a of buildRenderData().assets) {
      assert.ok(a.name.length > 0, `${a.id} has empty name`);
      assert.ok(a.route.length > 0, `${a.id} has empty route`);
    }
  });

  it('all incidents have non-empty description strings', () => {
    for (const inc of buildRenderData().incidents) {
      assert.ok(inc.description.length > 0, `${inc.id} has empty description`);
    }
  });

  it('globalSeabedRiskIndex is high given real-world threat distribution', () => {
    const { globalSeabedRiskIndex } = buildRenderData();
    assert.ok(globalSeabedRiskIndex >= 50, `Expected >=50 with real data, got ${globalSeabedRiskIndex}`);
  });
});
