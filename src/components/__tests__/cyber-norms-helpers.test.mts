import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  getActiveFrameworks,
  getMajorIncidents,
  getByAttributedActor,
  complianceClass,
  attributionClass,
  attributionScore,
  computeGlobalNormsAdoptionScore,
  getMostActiveActor,
  getTopViolatedFramework,
  getOngoingOperations,
  getHighConfidenceOperations,
  getFrameworksByType,
  buildRenderData,
  FRAMEWORKS,
  OPERATIONS,
  COMPLIANCE_SCORES,
  type FrameworkStatus,
  type AttributionLevel,
  type AttributedActor,
  type ComplianceTier,
  type NormFramework,
  type CyberOperation,
  type ComplianceScore,
} from '../cyber-norms-helpers.ts';

// ── Fixtures ────────────────────────────────────────────────────────────────────

const makeFramework = (overrides: Partial<NormFramework> = {}): NormFramework => ({
  id: 'FX',
  name: 'Test Framework',
  shortName: 'TF',
  year: 2020,
  type: 'Voluntary Norms',
  status: 'Active',
  signatoryCount: 10,
  description: 'Test',
  keyProvisions: ['Provision A'],
  notableAbsences: [],
  usPosition: 'Signed',
  chinaRussiaPosition: 'Not Signed',
  geopoliticalSignificance: 'Significant',
  ...overrides,
});

const makeOperation = (overrides: Partial<CyberOperation> = {}): CyberOperation => ({
  id: 'OX',
  name: 'Test Op',
  year: '2024',
  attributedActor: 'China/PRC',
  attributionLevel: 'Confirmed',
  operationType: 'Espionage',
  targetedSectors: ['Government'],
  affectedCountries: ['USA'],
  estimatedImpact: 'High',
  description: 'Test operation description.',
  normViolations: ['UN GGE 2015 Norm 13(f)'],
  legalFrameworksImplicated: ['UN GGE 2015'],
  status: 'Ongoing',
  ...overrides,
});

const makeCompliance = (overrides: Partial<ComplianceScore> = {}): ComplianceScore => ({
  actor: 'Testistan',
  overallScore: 50,
  tier: 'Partial',
  espionageRestraint: 5,
  criticalInfraProtection: 5,
  normEngagement: 5,
  responseToAttribution: 5,
  notes: 'Test notes.',
  ...overrides,
});

// ── complianceClass ─────────────────────────────────────────────────────────────

describe('complianceClass', () => {
  it('Compliant returns comply-compliant', () => {
    assert.equal(complianceClass('Compliant'), 'comply-compliant');
  });
  it('Partial returns comply-partial', () => {
    assert.equal(complianceClass('Partial'), 'comply-partial');
  });
  it('Non-Compliant returns comply-noncompliant', () => {
    assert.equal(complianceClass('Non-Compliant'), 'comply-noncompliant');
  });
  it('No Data returns comply-nodata', () => {
    assert.equal(complianceClass('No Data'), 'comply-nodata');
  });
  it('unknown tier falls back to comply-nodata', () => {
    assert.equal(complianceClass('Unknown' as ComplianceTier), 'comply-nodata');
  });
});

// ── attributionClass ────────────────────────────────────────────────────────────

describe('attributionClass', () => {
  it('Confirmed returns attr-confirmed', () => {
    assert.equal(attributionClass('Confirmed'), 'attr-confirmed');
  });
  it('High returns attr-high', () => {
    assert.equal(attributionClass('High'), 'attr-high');
  });
  it('Moderate returns attr-moderate', () => {
    assert.equal(attributionClass('Moderate'), 'attr-moderate');
  });
  it('Low returns attr-low', () => {
    assert.equal(attributionClass('Low'), 'attr-low');
  });
  it('Unattributed returns attr-unattributed', () => {
    assert.equal(attributionClass('Unattributed'), 'attr-unattributed');
  });
  it('unknown level falls back to attr-unattributed', () => {
    assert.equal(attributionClass('Mystery' as AttributionLevel), 'attr-unattributed');
  });
});

// ── attributionScore ────────────────────────────────────────────────────────────

describe('attributionScore', () => {
  it('Confirmed is 100', () => {
    assert.equal(attributionScore('Confirmed'), 100);
  });
  it('High is 80', () => {
    assert.equal(attributionScore('High'), 80);
  });
  it('Moderate is 60', () => {
    assert.equal(attributionScore('Moderate'), 60);
  });
  it('Low is 30', () => {
    assert.equal(attributionScore('Low'), 30);
  });
  it('Unattributed is 0', () => {
    assert.equal(attributionScore('Unattributed'), 0);
  });
  it('ordering: Confirmed > High > Moderate > Low > Unattributed', () => {
    const levels: AttributionLevel[] = ['Confirmed', 'High', 'Moderate', 'Low', 'Unattributed'];
    for (let i = 1; i < levels.length; i++) {
      assert.ok(
        attributionScore(levels[i - 1]!) > attributionScore(levels[i]!),
        `Expected ${levels[i-1]} > ${levels[i]}`,
      );
    }
  });
  it('unknown level returns 0', () => {
    assert.equal(attributionScore('Ghost' as AttributionLevel), 0);
  });
});

// ── getActiveFrameworks ─────────────────────────────────────────────────────────

describe('getActiveFrameworks', () => {
  it('returns only Active status frameworks', () => {
    const fs = [
      makeFramework({ id: 'A', status: 'Active' }),
      makeFramework({ id: 'B', status: 'Contested' }),
      makeFramework({ id: 'C', status: 'Stalled' }),
      makeFramework({ id: 'D', status: 'Active' }),
    ];
    const result = getActiveFrameworks(fs);
    assert.equal(result.length, 2);
    assert.ok(result.every(f => f.status === 'Active'));
  });
  it('returns empty array when no active frameworks', () => {
    const fs = [makeFramework({ status: 'Stalled' })];
    assert.equal(getActiveFrameworks(fs).length, 0);
  });
  it('does not mutate input', () => {
    const original = [...FRAMEWORKS];
    getActiveFrameworks(FRAMEWORKS);
    assert.deepEqual(FRAMEWORKS, original);
  });
  it('returns all when all are active', () => {
    const fs = [makeFramework({ status: 'Active' }), makeFramework({ id: 'B', status: 'Active' })];
    assert.equal(getActiveFrameworks(fs).length, 2);
  });
});

// ── getMajorIncidents ───────────────────────────────────────────────────────────

describe('getMajorIncidents', () => {
  it('default threshold Moderate includes Confirmed, High, Moderate', () => {
    const ops = [
      makeOperation({ id: 'O1', attributionLevel: 'Confirmed' }),
      makeOperation({ id: 'O2', attributionLevel: 'High' }),
      makeOperation({ id: 'O3', attributionLevel: 'Moderate' }),
      makeOperation({ id: 'O4', attributionLevel: 'Low' }),
      makeOperation({ id: 'O5', attributionLevel: 'Unattributed' }),
    ];
    const result = getMajorIncidents(ops);
    assert.equal(result.length, 3);
  });
  it('Confirmed threshold returns only Confirmed', () => {
    const ops = [
      makeOperation({ id: 'O1', attributionLevel: 'Confirmed' }),
      makeOperation({ id: 'O2', attributionLevel: 'High' }),
    ];
    const result = getMajorIncidents(ops, 'Confirmed');
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, 'O1');
  });
  it('Unattributed threshold returns all', () => {
    const ops = [
      makeOperation({ id: 'O1', attributionLevel: 'Unattributed' }),
      makeOperation({ id: 'O2', attributionLevel: 'Low' }),
    ];
    assert.equal(getMajorIncidents(ops, 'Unattributed').length, 2);
  });
  it('does not mutate input', () => {
    const before = OPERATIONS.length;
    getMajorIncidents(OPERATIONS);
    assert.equal(OPERATIONS.length, before);
  });
  it('returns empty for empty input', () => {
    assert.equal(getMajorIncidents([]).length, 0);
  });
});

// ── getByAttributedActor ────────────────────────────────────────────────────────

describe('getByAttributedActor', () => {
  it('returns only operations by specified actor', () => {
    const ops = [
      makeOperation({ id: 'O1', attributedActor: 'China/PRC' }),
      makeOperation({ id: 'O2', attributedActor: 'Russia' }),
      makeOperation({ id: 'O3', attributedActor: 'China/PRC' }),
    ];
    const result = getByAttributedActor(ops, 'China/PRC');
    assert.equal(result.length, 2);
    assert.ok(result.every(op => op.attributedActor === 'China/PRC'));
  });
  it('returns empty when actor has no operations', () => {
    const ops = [makeOperation({ attributedActor: 'Russia' })];
    assert.equal(getByAttributedActor(ops, 'Iran').length, 0);
  });
  it('does not mutate input', () => {
    const before = OPERATIONS.length;
    getByAttributedActor(OPERATIONS, 'Russia');
    assert.equal(OPERATIONS.length, before);
  });
  it('is exact match on actor name', () => {
    const ops = [makeOperation({ attributedActor: 'China/PRC' })];
    assert.equal(getByAttributedActor(ops, 'Unknown').length, 0);
  });
});

// ── computeGlobalNormsAdoptionScore ────────────────────────────────────────────

describe('computeGlobalNormsAdoptionScore', () => {
  it('returns 0 for empty array', () => {
    assert.equal(computeGlobalNormsAdoptionScore([]), 0);
  });
  it('returns 100 when all Active and none Contested', () => {
    const fs = [
      makeFramework({ status: 'Active' }),
      makeFramework({ id: 'B', status: 'Active' }),
    ];
    assert.equal(computeGlobalNormsAdoptionScore(fs), 100);
  });
  it('returns a value in range 0-100', () => {
    const score = computeGlobalNormsAdoptionScore(FRAMEWORKS);
    assert.ok(score >= 0 && score <= 100);
  });
  it('contested frameworks reduce score vs all-active', () => {
    const allActive = [
      makeFramework({ id: 'A', status: 'Active' }),
      makeFramework({ id: 'B', status: 'Active' }),
    ];
    const withContested = [
      makeFramework({ id: 'A', status: 'Active' }),
      makeFramework({ id: 'B', status: 'Contested' }),
    ];
    assert.ok(
      computeGlobalNormsAdoptionScore(allActive) >= computeGlobalNormsAdoptionScore(withContested),
    );
  });
  it('returns integer', () => {
    const score = computeGlobalNormsAdoptionScore(FRAMEWORKS);
    assert.equal(score, Math.round(score));
  });
});

// ── getMostActiveActor ─────────────────────────────────────────────────────────

describe('getMostActiveActor', () => {
  it('returns null for empty array', () => {
    assert.equal(getMostActiveActor([]), null);
  });
  it('returns the actor with most operations', () => {
    const ops = [
      makeOperation({ id: 'O1', attributedActor: 'Russia' }),
      makeOperation({ id: 'O2', attributedActor: 'China/PRC' }),
      makeOperation({ id: 'O3', attributedActor: 'Russia' }),
    ];
    assert.equal(getMostActiveActor(ops), 'Russia');
  });
  it('returns the only actor if just one', () => {
    const ops = [makeOperation({ attributedActor: 'Iran' })];
    assert.equal(getMostActiveActor(ops), 'Iran');
  });
  it('does not mutate input', () => {
    const before = OPERATIONS.length;
    getMostActiveActor(OPERATIONS);
    assert.equal(OPERATIONS.length, before);
  });
});

// ── getTopViolatedFramework ─────────────────────────────────────────────────────

describe('getTopViolatedFramework', () => {
  it('returns null for empty array', () => {
    assert.equal(getTopViolatedFramework([]), null);
  });
  it('returns framework implicated by most operations', () => {
    const ops = [
      makeOperation({ id: 'O1', legalFrameworksImplicated: ['UN GGE 2015', 'Budapest Convention'] }),
      makeOperation({ id: 'O2', legalFrameworksImplicated: ['UN GGE 2015'] }),
      makeOperation({ id: 'O3', legalFrameworksImplicated: ['Budapest Convention'] }),
    ];
    // UN GGE 2015: 2 times, Budapest: 2 times — depends on insertion order
    const result = getTopViolatedFramework(ops);
    assert.ok(result === 'UN GGE 2015' || result === 'Budapest Convention');
  });
  it('returns the single framework for single operation', () => {
    const ops = [makeOperation({ legalFrameworksImplicated: ['Tallinn Manual 3.0'] })];
    assert.equal(getTopViolatedFramework(ops), 'Tallinn Manual 3.0');
  });
  it('does not mutate input', () => {
    const before = OPERATIONS.length;
    getTopViolatedFramework(OPERATIONS);
    assert.equal(OPERATIONS.length, before);
  });
});

// ── getOngoingOperations ────────────────────────────────────────────────────────

describe('getOngoingOperations', () => {
  it('returns only Ongoing operations', () => {
    const ops = [
      makeOperation({ id: 'O1', status: 'Ongoing' }),
      makeOperation({ id: 'O2', status: 'Concluded' }),
      makeOperation({ id: 'O3', status: 'Disrupted' }),
      makeOperation({ id: 'O4', status: 'Ongoing' }),
    ];
    const result = getOngoingOperations(ops);
    assert.equal(result.length, 2);
    assert.ok(result.every(op => op.status === 'Ongoing'));
  });
  it('returns empty when no ongoing', () => {
    assert.equal(getOngoingOperations([makeOperation({ status: 'Concluded' })]).length, 0);
  });
  it('does not mutate input', () => {
    const before = OPERATIONS.length;
    getOngoingOperations(OPERATIONS);
    assert.equal(OPERATIONS.length, before);
  });
});

// ── getHighConfidenceOperations ─────────────────────────────────────────────────

describe('getHighConfidenceOperations', () => {
  it('returns only Confirmed and High operations', () => {
    const ops = [
      makeOperation({ id: 'O1', attributionLevel: 'Confirmed' }),
      makeOperation({ id: 'O2', attributionLevel: 'High' }),
      makeOperation({ id: 'O3', attributionLevel: 'Moderate' }),
      makeOperation({ id: 'O4', attributionLevel: 'Low' }),
    ];
    const result = getHighConfidenceOperations(ops);
    assert.equal(result.length, 2);
    assert.ok(result.every(op => op.attributionLevel === 'Confirmed' || op.attributionLevel === 'High'));
  });
  it('returns empty for all-low confidence', () => {
    assert.equal(
      getHighConfidenceOperations([makeOperation({ attributionLevel: 'Unattributed' })]).length,
      0,
    );
  });
  it('does not mutate input', () => {
    const before = OPERATIONS.length;
    getHighConfidenceOperations(OPERATIONS);
    assert.equal(OPERATIONS.length, before);
  });
});

// ── getFrameworksByType ─────────────────────────────────────────────────────────

describe('getFrameworksByType', () => {
  it('returns only frameworks of specified type', () => {
    const fs = [
      makeFramework({ id: 'A', type: 'Treaty' }),
      makeFramework({ id: 'B', type: 'Voluntary Norms' }),
      makeFramework({ id: 'C', type: 'Treaty' }),
    ];
    const result = getFrameworksByType(fs, 'Treaty');
    assert.equal(result.length, 2);
    assert.ok(result.every(f => f.type === 'Treaty'));
  });
  it('returns empty when type not present', () => {
    assert.equal(getFrameworksByType([makeFramework({ type: 'Treaty' })], 'Expert Study').length, 0);
  });
  it('does not mutate input', () => {
    const before = FRAMEWORKS.length;
    getFrameworksByType(FRAMEWORKS, 'Treaty');
    assert.equal(FRAMEWORKS.length, before);
  });
});

// ── buildRenderData ─────────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.frameworks));
    assert.ok(Array.isArray(d.operations));
    assert.ok(Array.isArray(d.complianceScores));
    assert.equal(typeof d.activeFrameworkCount, 'number');
    assert.equal(typeof d.highConfidenceOperationCount, 'number');
    assert.equal(typeof d.ongoingOperationCount, 'number');
    assert.equal(typeof d.globalNormsAdoptionScore, 'number');
  });
  it('frameworks array is non-empty', () => {
    assert.ok(buildRenderData().frameworks.length > 0);
  });
  it('operations array is non-empty', () => {
    assert.ok(buildRenderData().operations.length > 0);
  });
  it('complianceScores array is non-empty', () => {
    assert.ok(buildRenderData().complianceScores.length > 0);
  });
  it('globalNormsAdoptionScore is in range 0-100', () => {
    const score = buildRenderData().globalNormsAdoptionScore;
    assert.ok(score >= 0 && score <= 100);
  });
  it('activeFrameworkCount matches actual active frameworks', () => {
    const d = buildRenderData();
    assert.equal(d.activeFrameworkCount, d.frameworks.filter(f => f.status === 'Active').length);
  });
  it('highConfidenceOperationCount matches actual high-confidence ops', () => {
    const d = buildRenderData();
    const expected = d.operations.filter(
      op => op.attributionLevel === 'Confirmed' || op.attributionLevel === 'High',
    ).length;
    assert.equal(d.highConfidenceOperationCount, expected);
  });
  it('ongoingOperationCount matches actual ongoing ops', () => {
    const d = buildRenderData();
    assert.equal(d.ongoingOperationCount, d.operations.filter(op => op.status === 'Ongoing').length);
  });
  it('mostActiveActor is not null', () => {
    assert.notEqual(buildRenderData().mostActiveActor, null);
  });
  it('topViolatedFramework is not null', () => {
    assert.notEqual(buildRenderData().topViolatedFramework, null);
  });
  it('all framework IDs are unique', () => {
    const ids = buildRenderData().frameworks.map(f => f.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('all operation IDs are unique', () => {
    const ids = buildRenderData().operations.map(op => op.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

// ── Static data integrity ────────────────────────────────────────────────────────

describe('FRAMEWORKS static data', () => {
  it('has exactly 10 frameworks', () => {
    assert.equal(FRAMEWORKS.length, 10);
  });
  it('every framework has a unique id', () => {
    const ids = FRAMEWORKS.map(f => f.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('every framework has a non-empty shortName', () => {
    for (const f of FRAMEWORKS) {
      assert.ok(f.shortName.trim().length > 0, `${f.id} has empty shortName`);
    }
  });
  it('every framework has at least one keyProvision', () => {
    for (const f of FRAMEWORKS) {
      assert.ok(f.keyProvisions.length > 0, `${f.id} has no keyProvisions`);
    }
  });
  it('every framework year is between 2000 and 2030', () => {
    for (const f of FRAMEWORKS) {
      assert.ok(f.year >= 2000 && f.year <= 2030, `${f.id} year out of range: ${f.year}`);
    }
  });
  it('every framework has valid status', () => {
    const valid: FrameworkStatus[] = ['Active', 'Emerging', 'Contested', 'Stalled'];
    for (const f of FRAMEWORKS) {
      assert.ok(valid.includes(f.status), `${f.id} invalid status: ${f.status}`);
    }
  });
  it('UN GGE 2015 has status Active and year 2015', () => {
    const gge = FRAMEWORKS.find(f => f.id === 'F001');
    assert.ok(gge, 'F001 not found');
    assert.equal(gge!.status, 'Active');
    assert.equal(gge!.year, 2015);
  });
  it('Tallinn Manual 3.0 has year 2023 and type Expert Study', () => {
    const tallinn = FRAMEWORKS.find(f => f.id === 'F002');
    assert.ok(tallinn, 'F002 not found');
    assert.equal(tallinn!.year, 2023);
    assert.equal(tallinn!.type, 'Expert Study');
  });
  it('Budapest Convention has type Treaty and over 60 signatories', () => {
    const budapest = FRAMEWORKS.find(f => f.id === 'F003');
    assert.ok(budapest, 'F003 not found');
    assert.equal(budapest!.type, 'Treaty');
    assert.ok(budapest!.signatoryCount >= 60);
  });
  it('UN OEWG has status Contested', () => {
    const oewg = FRAMEWORKS.find(f => f.id === 'F006');
    assert.ok(oewg, 'F006 not found');
    assert.equal(oewg!.status, 'Contested');
  });
  it('at least 7 frameworks are Active', () => {
    assert.ok(FRAMEWORKS.filter(f => f.status === 'Active').length >= 7);
  });
});

describe('OPERATIONS static data', () => {
  it('has exactly 6 operations', () => {
    assert.equal(OPERATIONS.length, 6);
  });
  it('every operation has a unique id', () => {
    const ids = OPERATIONS.map(op => op.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('every operation has at least one targeted sector', () => {
    for (const op of OPERATIONS) {
      assert.ok(op.targetedSectors.length > 0, `${op.id} has no targetedSectors`);
    }
  });
  it('every operation has at least one affected country', () => {
    for (const op of OPERATIONS) {
      assert.ok(op.affectedCountries.length > 0, `${op.id} has no affectedCountries`);
    }
  });
  it('every operation has at least one norm violation', () => {
    for (const op of OPERATIONS) {
      assert.ok(op.normViolations.length > 0, `${op.id} has no normViolations`);
    }
  });
  it('every operation has at least one implicated framework', () => {
    for (const op of OPERATIONS) {
      assert.ok(op.legalFrameworksImplicated.length > 0, `${op.id} has no frameworks`);
    }
  });
  it('Volt Typhoon is attributed to China/PRC with Confirmed confidence', () => {
    const vt = OPERATIONS.find(op => op.id === 'OP001');
    assert.ok(vt, 'OP001 not found');
    assert.equal(vt!.attributedActor, 'China/PRC');
    assert.equal(vt!.attributionLevel, 'Confirmed');
    assert.equal(vt!.status, 'Ongoing');
  });
  it('Salt Typhoon is attributed to China/PRC with Confirmed confidence', () => {
    const st = OPERATIONS.find(op => op.id === 'OP002');
    assert.ok(st, 'OP002 not found');
    assert.equal(st!.attributedActor, 'China/PRC');
    assert.equal(st!.operationType, 'Espionage');
  });
  it('Sandworm campaign is attributed to Russia and is Ongoing', () => {
    const sw = OPERATIONS.find(op => op.id === 'OP003');
    assert.ok(sw, 'OP003 not found');
    assert.equal(sw!.attributedActor, 'Russia');
    assert.equal(sw!.status, 'Ongoing');
    assert.equal(sw!.operationType, 'Sabotage');
  });
  it('Lazarus/Ronin is attributed to North Korea/DPRK with Financial type', () => {
    const laz = OPERATIONS.find(op => op.id === 'OP005');
    assert.ok(laz, 'OP005 not found');
    assert.equal(laz!.attributedActor, 'North Korea/DPRK');
    assert.equal(laz!.operationType, 'Financial');
  });
  it('Hafnium/Exchange attributed to China/PRC', () => {
    const haf = OPERATIONS.find(op => op.id === 'OP006');
    assert.ok(haf, 'OP006 not found');
    assert.equal(haf!.attributedActor, 'China/PRC');
  });
  it('all attribution levels are valid', () => {
    const valid: AttributionLevel[] = ['Confirmed', 'High', 'Moderate', 'Low', 'Unattributed'];
    for (const op of OPERATIONS) {
      assert.ok(valid.includes(op.attributionLevel), `${op.id} invalid level: ${op.attributionLevel}`);
    }
  });
  it('at least 4 operations have Confirmed attribution', () => {
    assert.ok(OPERATIONS.filter(op => op.attributionLevel === 'Confirmed').length >= 4);
  });
  it('UN GGE 2015 is implicated in at least 4 operations', () => {
    const count = OPERATIONS.filter(op => op.legalFrameworksImplicated.includes('UN GGE 2015')).length;
    assert.ok(count >= 4, `UN GGE 2015 implicated in only ${count}`);
  });
  it('China/PRC has more attributed operations than any single other actor', () => {
    const china = OPERATIONS.filter(op => op.attributedActor === 'China/PRC').length;
    const russia = OPERATIONS.filter(op => op.attributedActor === 'Russia').length;
    const iran = OPERATIONS.filter(op => op.attributedActor === 'Iran').length;
    assert.ok(china > russia, 'China should have more ops than Russia');
    assert.ok(china > iran, 'China should have more ops than Iran');
  });
});

describe('COMPLIANCE_SCORES static data', () => {
  it('has exactly 6 compliance scores', () => {
    assert.equal(COMPLIANCE_SCORES.length, 6);
  });
  it('every score is in range 0-100', () => {
    for (const cs of COMPLIANCE_SCORES) {
      assert.ok(cs.overallScore >= 0 && cs.overallScore <= 100, `${cs.actor}: ${cs.overallScore}`);
    }
  });
  it('every sub-score is in range 0-10', () => {
    for (const cs of COMPLIANCE_SCORES) {
      for (const key of ['espionageRestraint', 'criticalInfraProtection', 'normEngagement', 'responseToAttribution'] as const) {
        assert.ok(cs[key] >= 0 && cs[key] <= 10, `${cs.actor}.${key}: ${cs[key]}`);
      }
    }
  });
  it('Russia has lower score than USA', () => {
    const russia = COMPLIANCE_SCORES.find(cs => cs.actor === 'Russia')!;
    const usa = COMPLIANCE_SCORES.find(cs => cs.actor === 'United States')!;
    assert.ok(russia.overallScore < usa.overallScore);
  });
  it('China is Non-Compliant', () => {
    const china = COMPLIANCE_SCORES.find(cs => cs.actor === 'China')!;
    assert.equal(china.tier, 'Non-Compliant');
  });
  it('North Korea has lowest score', () => {
    const nk = COMPLIANCE_SCORES.find(cs => cs.actor === 'North Korea')!;
    const minScore = Math.min(...COMPLIANCE_SCORES.map(cs => cs.overallScore));
    assert.equal(nk.overallScore, minScore);
  });
  it('all tiers are valid ComplianceTier values', () => {
    const valid: ComplianceTier[] = ['Compliant', 'Partial', 'Non-Compliant', 'No Data'];
    for (const cs of COMPLIANCE_SCORES) {
      assert.ok(valid.includes(cs.tier), `${cs.actor}: invalid tier ${cs.tier}`);
    }
  });
  it('all actors have non-empty notes', () => {
    for (const cs of COMPLIANCE_SCORES) {
      assert.ok(cs.notes.trim().length > 0, `${cs.actor} has empty notes`);
    }
  });
  it('at least 3 actors are Non-Compliant', () => {
    assert.ok(COMPLIANCE_SCORES.filter(cs => cs.tier === 'Non-Compliant').length >= 3);
  });
});
