import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  computeGlobalRiskIndex,
  getHighRiskSectors,
  getActiveInvestigations,
  getTechLeakageScore,
  rankByRisk,
  sectorRiskClass,
  caseStatusClass,
  riskLevelClass,
  complianceClass,
  buildRenderData,
  type TechTransferCase,
  type TechSector,
  type ExportControlScore,
  type RiskLevel,
  type CaseStatus,
} from '../tech-transfer-risk-helpers.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_CASES: TechTransferCase[] = [
  { id: 'C1', date: '2023-01', title: 'Alpha', description: 'desc', actorCountry: 'China', targetTech: ['Semiconductors'], actorType: 'State', status: 'Active', riskLevel: 'Critical', transferMethod: 'smuggling', estimatedImpact: 'high' },
  { id: 'C2', date: '2023-02', title: 'Beta', description: 'desc', actorCountry: 'Russia', targetTech: ['Radar/DEW'], actorType: 'State', status: 'Under Investigation', riskLevel: 'High', transferMethod: 'front co', estimatedImpact: 'medium' },
  { id: 'C3', date: '2023-03', title: 'Gamma', description: 'desc', actorCountry: 'Iran', targetTech: ['Biotech'], actorType: 'State-Proxied', status: 'Prosecuted', riskLevel: 'Medium', transferMethod: 'academic', estimatedImpact: 'low' },
  { id: 'C4', date: '2024-01', title: 'Delta', description: 'desc', actorCountry: 'North Korea', targetTech: ['Nuclear'], actorType: 'State', status: 'Sanctioned', riskLevel: 'Critical', transferMethod: 'front co', estimatedImpact: 'critical' },
  { id: 'C5', date: '2024-02', title: 'Epsilon', description: 'desc', actorCountry: 'China', targetTech: ['AI/ML'], actorType: 'Commercial', status: 'Blocked', riskLevel: 'Low', transferMethod: 'sale', estimatedImpact: 'minimal' },
];

const MOCK_SECTORS: TechSector[] = [
  { id: 'S1', name: 'Semiconductors', leakageRisk: 92, primaryThreats: ['threat1'], recentIncidents: 5, controlledBy: ['US'], criticalityScore: 10 },
  { id: 'S2', name: 'AI/ML', leakageRisk: 85, primaryThreats: ['threat2'], recentIncidents: 4, controlledBy: ['US', 'UK'], criticalityScore: 9 },
  { id: 'S3', name: 'Quantum', leakageRisk: 60, primaryThreats: ['threat3'], recentIncidents: 2, controlledBy: ['US'], criticalityScore: 8 },
  { id: 'S4', name: 'Nuclear', leakageRisk: 40, primaryThreats: ['threat4'], recentIncidents: 1, controlledBy: ['IAEA'], criticalityScore: 10 },
];

const MOCK_SCORES: ExportControlScore[] = [
  { country: 'US', complianceScore: 95, entityListEntries: 1600, violations2024: 5, multilateralMemberships: ['Wassenaar'] },
  { country: 'China', complianceScore: 14, entityListEntries: 0, violations2024: 90, multilateralMemberships: [] },
  { country: 'Russia', complianceScore: 11, entityListEntries: 0, violations2024: 120, multilateralMemberships: [] },
];

// ── computeGlobalRiskIndex ───────────────────────────────────────────────────
describe('computeGlobalRiskIndex', () => {
  it('returns 0 for empty arrays', () => {
    assert.equal(computeGlobalRiskIndex([], []), 0);
  });
  it('returns a number between 0 and 100', () => {
    const idx = computeGlobalRiskIndex(MOCK_CASES, MOCK_SECTORS);
    assert.ok(idx >= 0 && idx <= 100);
  });
  it('returns an integer', () => {
    const idx = computeGlobalRiskIndex(MOCK_CASES, MOCK_SECTORS);
    assert.equal(idx, Math.round(idx));
  });
  it('all-Critical cases score higher than all-Low cases', () => {
    const crit = MOCK_CASES.map(c => ({ ...c, riskLevel: 'Critical' as RiskLevel }));
    const low = MOCK_CASES.map(c => ({ ...c, riskLevel: 'Low' as RiskLevel }));
    assert.ok(computeGlobalRiskIndex(crit, MOCK_SECTORS) > computeGlobalRiskIndex(low, MOCK_SECTORS));
  });
  it('higher sector leakage risk yields higher index', () => {
    const highRisk = MOCK_SECTORS.map(s => ({ ...s, leakageRisk: 95 }));
    const lowRisk = MOCK_SECTORS.map(s => ({ ...s, leakageRisk: 10 }));
    assert.ok(computeGlobalRiskIndex(MOCK_CASES, highRisk) > computeGlobalRiskIndex(MOCK_CASES, lowRisk));
  });
  it('caps at 100', () => {
    const max = MOCK_CASES.map(c => ({ ...c, riskLevel: 'Critical' as RiskLevel }));
    const maxSectors = MOCK_SECTORS.map(s => ({ ...s, leakageRisk: 100 }));
    assert.ok(computeGlobalRiskIndex(max, maxSectors) <= 100);
  });
});

// ── getHighRiskSectors ────────────────────────────────────────────────────────
describe('getHighRiskSectors', () => {
  it('returns sectors at or above threshold', () => {
    const result = getHighRiskSectors(MOCK_SECTORS, 75);
    assert.ok(result.every(s => s.leakageRisk >= 75));
  });
  it('returns correct count at default threshold 75', () => {
    const result = getHighRiskSectors(MOCK_SECTORS);
    assert.equal(result.length, 2); // 92 and 85
  });
  it('returns all sectors at threshold 0', () => {
    assert.equal(getHighRiskSectors(MOCK_SECTORS, 0).length, MOCK_SECTORS.length);
  });
  it('returns empty array at threshold 100', () => {
    assert.equal(getHighRiskSectors(MOCK_SECTORS, 100).length, 0);
  });
  it('returns empty for empty input', () => {
    assert.deepEqual(getHighRiskSectors([], 75), []);
  });
  it('does not mutate original array', () => {
    const copy = [...MOCK_SECTORS];
    getHighRiskSectors(MOCK_SECTORS, 75);
    assert.equal(MOCK_SECTORS.length, copy.length);
  });
});

// ── getActiveInvestigations ───────────────────────────────────────────────────
describe('getActiveInvestigations', () => {
  it('returns Active and Under Investigation cases', () => {
    const result = getActiveInvestigations(MOCK_CASES);
    assert.ok(result.every(c => c.status === 'Active' || c.status === 'Under Investigation'));
  });
  it('returns correct count', () => {
    assert.equal(getActiveInvestigations(MOCK_CASES).length, 2);
  });
  it('returns empty for empty input', () => {
    assert.deepEqual(getActiveInvestigations([]), []);
  });
  it('excludes Prosecuted, Sanctioned, Blocked', () => {
    const nonActive = MOCK_CASES.filter(c => c.status !== 'Active' && c.status !== 'Under Investigation');
    assert.equal(getActiveInvestigations(nonActive).length, 0);
  });
});

// ── getTechLeakageScore ───────────────────────────────────────────────────────
describe('getTechLeakageScore', () => {
  it('returns 0 for empty array', () => {
    assert.equal(getTechLeakageScore([]), 0);
  });
  it('returns a rounded integer', () => {
    const score = getTechLeakageScore(MOCK_SECTORS);
    assert.equal(score, Math.round(score));
  });
  it('returns value between 0 and 100', () => {
    const score = getTechLeakageScore(MOCK_SECTORS);
    assert.ok(score >= 0 && score <= 100);
  });
  it('single sector returns its leakageRisk', () => {
    const s = [{ ...MOCK_SECTORS[0], leakageRisk: 80 }];
    assert.equal(getTechLeakageScore(s), 80);
  });
  it('caps at 100', () => {
    const s = MOCK_SECTORS.map(sec => ({ ...sec, leakageRisk: 100 }));
    assert.equal(getTechLeakageScore(s), 100);
  });
  it('averages correctly', () => {
    const s = [{ ...MOCK_SECTORS[0], leakageRisk: 60 }, { ...MOCK_SECTORS[1], leakageRisk: 80 }];
    assert.equal(getTechLeakageScore(s), 70);
  });
});

// ── rankByRisk ────────────────────────────────────────────────────────────────
describe('rankByRisk', () => {
  it('Critical cases come first', () => {
    const ranked = rankByRisk(MOCK_CASES);
    assert.equal(ranked[0].riskLevel, 'Critical');
  });
  it('Low cases come last', () => {
    const ranked = rankByRisk(MOCK_CASES);
    assert.equal(ranked[ranked.length - 1].riskLevel, 'Low');
  });
  it('does not mutate original array', () => {
    const before = MOCK_CASES.map(c => c.id);
    rankByRisk(MOCK_CASES);
    assert.deepEqual(MOCK_CASES.map(c => c.id), before);
  });
  it('returns all cases', () => {
    assert.equal(rankByRisk(MOCK_CASES).length, MOCK_CASES.length);
  });
  it('returns empty array for empty input', () => {
    assert.deepEqual(rankByRisk([]), []);
  });
});

// ── sectorRiskClass ───────────────────────────────────────────────────────────
describe('sectorRiskClass', () => {
  it('>=85 returns ttr-critical', () => assert.equal(sectorRiskClass(85), 'ttr-critical'));
  it('90 returns ttr-critical', () => assert.equal(sectorRiskClass(90), 'ttr-critical'));
  it('>=70 and <85 returns ttr-high', () => assert.equal(sectorRiskClass(70), 'ttr-high'));
  it('75 returns ttr-high', () => assert.equal(sectorRiskClass(75), 'ttr-high'));
  it('>=50 and <70 returns ttr-medium', () => assert.equal(sectorRiskClass(50), 'ttr-medium'));
  it('60 returns ttr-medium', () => assert.equal(sectorRiskClass(60), 'ttr-medium'));
  it('<50 returns ttr-low', () => assert.equal(sectorRiskClass(30), 'ttr-low'));
  it('0 returns ttr-low', () => assert.equal(sectorRiskClass(0), 'ttr-low'));
});

// ── caseStatusClass ───────────────────────────────────────────────────────────
describe('caseStatusClass', () => {
  it('Active returns ttr-status-active', () => assert.equal(caseStatusClass('Active'), 'ttr-status-active'));
  it('Prosecuted returns ttr-status-prosecuted', () => assert.equal(caseStatusClass('Prosecuted'), 'ttr-status-prosecuted'));
  it('Sanctioned returns ttr-status-sanctioned', () => assert.equal(caseStatusClass('Sanctioned'), 'ttr-status-sanctioned'));
  it('Under Investigation returns ttr-status-investigating', () => assert.equal(caseStatusClass('Under Investigation'), 'ttr-status-investigating'));
  it('Blocked returns ttr-status-blocked', () => assert.equal(caseStatusClass('Blocked'), 'ttr-status-blocked'));
  it('all statuses return a non-empty string', () => {
    const statuses: CaseStatus[] = ['Active', 'Prosecuted', 'Sanctioned', 'Under Investigation', 'Blocked'];
    for (const s of statuses) {
      assert.ok(caseStatusClass(s).length > 0);
    }
  });
});

// ── riskLevelClass ────────────────────────────────────────────────────────────
describe('riskLevelClass', () => {
  it('Critical returns ttr-risk-critical', () => assert.equal(riskLevelClass('Critical'), 'ttr-risk-critical'));
  it('High returns ttr-risk-high', () => assert.equal(riskLevelClass('High'), 'ttr-risk-high'));
  it('Medium returns ttr-risk-medium', () => assert.equal(riskLevelClass('Medium'), 'ttr-risk-medium'));
  it('Low returns ttr-risk-low', () => assert.equal(riskLevelClass('Low'), 'ttr-risk-low'));
  it('all risk levels return ttr- prefixed string', () => {
    const levels: RiskLevel[] = ['Critical', 'High', 'Medium', 'Low'];
    for (const l of levels) {
      assert.ok(riskLevelClass(l).startsWith('ttr-'));
    }
  });
});

// ── complianceClass ───────────────────────────────────────────────────────────
describe('complianceClass', () => {
  it('>=80 returns ttr-comply-good', () => assert.equal(complianceClass(80), 'ttr-comply-good'));
  it('95 returns ttr-comply-good', () => assert.equal(complianceClass(95), 'ttr-comply-good'));
  it('>=50 and <80 returns ttr-comply-moderate', () => assert.equal(complianceClass(50), 'ttr-comply-moderate'));
  it('65 returns ttr-comply-moderate', () => assert.equal(complianceClass(65), 'ttr-comply-moderate'));
  it('>=20 and <50 returns ttr-comply-poor', () => assert.equal(complianceClass(20), 'ttr-comply-poor'));
  it('35 returns ttr-comply-poor', () => assert.equal(complianceClass(35), 'ttr-comply-poor'));
  it('<20 returns ttr-comply-rogue', () => assert.equal(complianceClass(14), 'ttr-comply-rogue'));
  it('0 returns ttr-comply-rogue', () => assert.equal(complianceClass(0), 'ttr-comply-rogue'));
});

// ── buildRenderData (integration) ─────────────────────────────────────────────
describe('buildRenderData', () => {
  it('returns an object with all required keys', () => {
    const d = buildRenderData();
    assert.ok('cases' in d);
    assert.ok('bisEntries' in d);
    assert.ok('sectors' in d);
    assert.ok('exportScores' in d);
    assert.ok('globalRiskIndex' in d);
    assert.ok('activeCases' in d);
    assert.ok('criticalCases' in d);
    assert.ok('sanctionedEntities' in d);
    assert.ok('highRiskSectors' in d);
  });
  it('has at least 10 cases', () => {
    assert.ok(buildRenderData().cases.length >= 10);
  });
  it('has exactly 8 sectors', () => {
    assert.equal(buildRenderData().sectors.length, 8);
  });
  it('has at least 12 BIS entries', () => {
    assert.ok(buildRenderData().bisEntries.length >= 12);
  });
  it('has at least 10 export scores', () => {
    assert.ok(buildRenderData().exportScores.length >= 10);
  });
  it('globalRiskIndex is between 0 and 100', () => {
    const { globalRiskIndex } = buildRenderData();
    assert.ok(globalRiskIndex >= 0 && globalRiskIndex <= 100);
  });
  it('activeCases matches getActiveInvestigations count', () => {
    const d = buildRenderData();
    assert.equal(d.activeCases, d.cases.filter(c => c.status === 'Active' || c.status === 'Under Investigation').length);
  });
  it('criticalCases matches Critical risk count', () => {
    const d = buildRenderData();
    assert.equal(d.criticalCases, d.cases.filter(c => c.riskLevel === 'Critical').length);
  });
  it('sanctionedEntities equals bisEntries.length', () => {
    const d = buildRenderData();
    assert.equal(d.sanctionedEntities, d.bisEntries.length);
  });
  it('all case IDs are unique', () => {
    const ids = buildRenderData().cases.map(c => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('all BIS entry IDs are unique', () => {
    const ids = buildRenderData().bisEntries.map(e => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('all sector IDs are unique', () => {
    const ids = buildRenderData().sectors.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('all case titles are non-empty', () => {
    for (const c of buildRenderData().cases) {
      assert.ok(c.title.trim().length > 0);
    }
  });
  it('all leakageRisk values are in range 0-100', () => {
    for (const s of buildRenderData().sectors) {
      assert.ok(s.leakageRisk >= 0 && s.leakageRisk <= 100);
    }
  });
  it('all criticalityScores are in range 0-10', () => {
    for (const s of buildRenderData().sectors) {
      assert.ok(s.criticalityScore >= 0 && s.criticalityScore <= 10);
    }
  });
  it('all complianceScores are in range 0-100', () => {
    for (const e of buildRenderData().exportScores) {
      assert.ok(e.complianceScore >= 0 && e.complianceScore <= 100);
    }
  });
  it('all violations2024 are non-negative', () => {
    for (const e of buildRenderData().exportScores) {
      assert.ok(e.violations2024 >= 0);
    }
  });
  it('highRiskSectors are all above threshold', () => {
    const d = buildRenderData();
    assert.ok(d.highRiskSectors.every(s => s.leakageRisk >= 75));
  });
  it('all cases have valid riskLevel', () => {
    const valid = new Set(['Critical', 'High', 'Medium', 'Low']);
    for (const c of buildRenderData().cases) {
      assert.ok(valid.has(c.riskLevel), `Invalid riskLevel: ${c.riskLevel}`);
    }
  });
  it('all cases have valid status', () => {
    const valid = new Set(['Active', 'Prosecuted', 'Sanctioned', 'Under Investigation', 'Blocked']);
    for (const c of buildRenderData().cases) {
      assert.ok(valid.has(c.status), `Invalid status: ${c.status}`);
    }
  });
  it('all cases have valid actorType', () => {
    const valid = new Set(['State', 'State-Proxied', 'Commercial', 'Academic']);
    for (const c of buildRenderData().cases) {
      assert.ok(valid.has(c.actorType), `Invalid actorType: ${c.actorType}`);
    }
  });
  it('all cases have non-empty actorCountry', () => {
    for (const c of buildRenderData().cases) {
      assert.ok(c.actorCountry.trim().length > 0);
    }
  });
  it('all cases have at least one targetTech', () => {
    for (const c of buildRenderData().cases) {
      assert.ok(c.targetTech.length >= 1);
    }
  });
  it('all BIS entries have non-empty entity names', () => {
    for (const e of buildRenderData().bisEntries) {
      assert.ok(e.entity.trim().length > 0);
    }
  });
  it('all BIS entries have non-empty addedDate', () => {
    for (const e of buildRenderData().bisEntries) {
      assert.ok(e.addedDate.trim().length > 0);
    }
  });
  it('all sectors have at least one primaryThreat', () => {
    for (const s of buildRenderData().sectors) {
      assert.ok(s.primaryThreats.length >= 1);
    }
  });
  it('all sectors have at least one controlledBy', () => {
    for (const s of buildRenderData().sectors) {
      assert.ok(s.controlledBy.length >= 1);
    }
  });
  it('recentIncidents are non-negative', () => {
    for (const s of buildRenderData().sectors) {
      assert.ok(s.recentIncidents >= 0);
    }
  });
  it('Semiconductors sector exists in data', () => {
    const names = buildRenderData().sectors.map(s => s.name);
    assert.ok(names.includes('Semiconductors'));
  });
  it('Nuclear sector has criticalityScore of 10', () => {
    const nuclear = buildRenderData().sectors.find(s => s.name === 'Nuclear');
    assert.ok(nuclear);
    assert.equal(nuclear!.criticalityScore, 10);
  });
  it('US has highest compliance score', () => {
    const scores = buildRenderData().exportScores;
    const us = scores.find(e => e.country === 'United States');
    assert.ok(us);
    assert.ok(scores.every(e => e.complianceScore <= us!.complianceScore));
  });
  it('Iran has lowest compliance score', () => {
    const scores = buildRenderData().exportScores;
    const iran = scores.find(e => e.country === 'Iran');
    assert.ok(iran);
    assert.ok(scores.every(e => e.complianceScore >= iran!.complianceScore));
  });
  it('Semiconductors sector has highest leakageRisk', () => {
    const sectors = buildRenderData().sectors;
    const semi = sectors.find(s => s.name === 'Semiconductors');
    assert.ok(semi);
    assert.ok(sectors.every(s => s.leakageRisk <= semi!.leakageRisk));
  });
});
