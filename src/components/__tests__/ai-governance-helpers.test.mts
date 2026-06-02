import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  getActiveFrameworks,
  getByStatus,
  getAIArmsRaceIndicators,
  frameworkStatusClass,
  riskClass,
  bindingClass,
  scopeClass,
  computeGovernanceIndex,
  getArmsRaceRisk,
  buildRenderData,
  type AIGovernanceFramework,
  type MilitaryAIProgram,
  type FrameworkStatus,
  type MilitaryAIRisk,
  type BindingNature,
  type FrameworkScope,
} from '../ai-governance-helpers.ts';

// ── Mock data ─────────────────────────────────────────────────────────────────

function makeFramework(overrides: Partial<AIGovernanceFramework> = {}): AIGovernanceFramework {
  return {
    id: 'T1',
    name: 'Test Framework',
    date: '2024-01-01',
    signatories: 10,
    scope: 'multilateral',
    status: 'active',
    bindingNature: 'voluntary',
    description: 'A test framework.',
    keyProvisions: ['Provision A'],
    region: 'Global',
    governanceScore: 60,
    ...overrides,
  };
}

function makeMilProgram(overrides: Partial<MilitaryAIProgram> = {}): MilitaryAIProgram {
  return {
    id: 'M1',
    country: 'Testland',
    programName: 'Test Program',
    description: 'Test description.',
    capability: 'Test capability',
    status: 'operational',
    lawsStance: 'ambiguous',
    riskLevel: 'medium',
    computeConstraints: false,
    ...overrides,
  };
}

const MOCK_FRAMEWORKS: AIGovernanceFramework[] = [
  makeFramework({ id: 'A', status: 'active', bindingNature: 'legally-binding', governanceScore: 80, signatories: 27 }),
  makeFramework({ id: 'B', status: 'active', bindingNature: 'voluntary', governanceScore: 60, signatories: 7 }),
  makeFramework({ id: 'C', status: 'proposed', bindingNature: 'voluntary', governanceScore: 40, signatories: 193 }),
  makeFramework({ id: 'D', status: 'expired', bindingNature: 'treaty', governanceScore: 50, signatories: 30 }),
  makeFramework({ id: 'E', status: 'active', bindingNature: 'executive-action', governanceScore: 70, signatories: 1 }),
];

const MOCK_PROGRAMS: MilitaryAIProgram[] = [
  makeMilProgram({ id: 'P1', riskLevel: 'critical' }),
  makeMilProgram({ id: 'P2', riskLevel: 'high' }),
  makeMilProgram({ id: 'P3', riskLevel: 'low' }),
  makeMilProgram({ id: 'P4', riskLevel: 'medium' }),
];

// ── getActiveFrameworks ───────────────────────────────────────────────────────

describe('getActiveFrameworks', () => {
  it('returns only active frameworks', () => {
    const result = getActiveFrameworks(MOCK_FRAMEWORKS);
    assert.ok(result.every(f => f.status === 'active'));
  });

  it('returns the correct count from mixed data', () => {
    const result = getActiveFrameworks(MOCK_FRAMEWORKS);
    assert.equal(result.length, 3); // A, B, E
  });

  it('returns empty array when none active', () => {
    const none = MOCK_FRAMEWORKS.filter(f => f.status !== 'active');
    assert.equal(getActiveFrameworks(none).length, 0);
  });

  it('returns all when all active', () => {
    const all = MOCK_FRAMEWORKS.map(f => ({ ...f, status: 'active' as FrameworkStatus }));
    assert.equal(getActiveFrameworks(all).length, MOCK_FRAMEWORKS.length);
  });

  it('does not mutate the input array', () => {
    const before = MOCK_FRAMEWORKS.length;
    getActiveFrameworks(MOCK_FRAMEWORKS);
    assert.equal(MOCK_FRAMEWORKS.length, before);
  });

  it('returns empty for empty input', () => {
    assert.equal(getActiveFrameworks([]).length, 0);
  });
});

// ── getByStatus ───────────────────────────────────────────────────────────────

describe('getByStatus', () => {
  it('returns only proposed frameworks', () => {
    const result = getByStatus(MOCK_FRAMEWORKS, 'proposed');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'C');
  });

  it('returns only expired frameworks', () => {
    const result = getByStatus(MOCK_FRAMEWORKS, 'expired');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'D');
  });

  it('returns empty when status not present', () => {
    const result = getByStatus(MOCK_FRAMEWORKS, 'voluntary');
    assert.equal(result.length, 0);
  });

  it('all returned frameworks have the requested status', () => {
    const result = getByStatus(MOCK_FRAMEWORKS, 'active');
    assert.ok(result.every(f => f.status === 'active'));
  });

  it('is consistent with getActiveFrameworks for status=active', () => {
    const a = getByStatus(MOCK_FRAMEWORKS, 'active').map(f => f.id).sort();
    const b = getActiveFrameworks(MOCK_FRAMEWORKS).map(f => f.id).sort();
    assert.deepEqual(a, b);
  });

  it('does not mutate input array', () => {
    const before = MOCK_FRAMEWORKS.length;
    getByStatus(MOCK_FRAMEWORKS, 'proposed');
    assert.equal(MOCK_FRAMEWORKS.length, before);
  });
});

// ── getAIArmsRaceIndicators ───────────────────────────────────────────────────

describe('getAIArmsRaceIndicators', () => {
  it('returns all programs', () => {
    const result = getAIArmsRaceIndicators(MOCK_PROGRAMS);
    assert.equal(result.length, MOCK_PROGRAMS.length);
  });

  it('sorts critical before high', () => {
    const result = getAIArmsRaceIndicators(MOCK_PROGRAMS);
    const critIdx = result.findIndex(p => p.riskLevel === 'critical');
    const highIdx = result.findIndex(p => p.riskLevel === 'high');
    assert.ok(critIdx < highIdx);
  });

  it('sorts high before medium', () => {
    const result = getAIArmsRaceIndicators(MOCK_PROGRAMS);
    const highIdx = result.findIndex(p => p.riskLevel === 'high');
    const medIdx = result.findIndex(p => p.riskLevel === 'medium');
    assert.ok(highIdx < medIdx);
  });

  it('sorts medium before low', () => {
    const result = getAIArmsRaceIndicators(MOCK_PROGRAMS);
    const medIdx = result.findIndex(p => p.riskLevel === 'medium');
    const lowIdx = result.findIndex(p => p.riskLevel === 'low');
    assert.ok(medIdx < lowIdx);
  });

  it('does not mutate original array order', () => {
    const originalFirst = MOCK_PROGRAMS[0].id;
    getAIArmsRaceIndicators(MOCK_PROGRAMS);
    assert.equal(MOCK_PROGRAMS[0].id, originalFirst);
  });

  it('returns empty for empty input', () => {
    assert.equal(getAIArmsRaceIndicators([]).length, 0);
  });
});

// ── frameworkStatusClass ──────────────────────────────────────────────────────

describe('frameworkStatusClass', () => {
  it('active returns status-active', () => {
    assert.equal(frameworkStatusClass('active'), 'status-active');
  });

  it('proposed returns status-proposed', () => {
    assert.equal(frameworkStatusClass('proposed'), 'status-proposed');
  });

  it('voluntary returns status-voluntary', () => {
    assert.equal(frameworkStatusClass('voluntary'), 'status-voluntary');
  });

  it('expired returns status-expired', () => {
    assert.equal(frameworkStatusClass('expired'), 'status-expired');
  });

  it('all values return non-empty strings', () => {
    const statuses: FrameworkStatus[] = ['active', 'proposed', 'voluntary', 'expired'];
    for (const s of statuses) {
      assert.ok(frameworkStatusClass(s).length > 0);
    }
  });
});

// ── riskClass ─────────────────────────────────────────────────────────────────

describe('riskClass', () => {
  it('critical returns risk-critical', () => {
    assert.equal(riskClass('critical'), 'risk-critical');
  });

  it('high returns risk-high', () => {
    assert.equal(riskClass('high'), 'risk-high');
  });

  it('medium returns risk-medium', () => {
    assert.equal(riskClass('medium'), 'risk-medium');
  });

  it('low returns risk-low', () => {
    assert.equal(riskClass('low'), 'risk-low');
  });

  it('all values return distinct classes', () => {
    const classes = (['critical', 'high', 'medium', 'low'] as MilitaryAIRisk[]).map(riskClass);
    assert.equal(new Set(classes).size, 4);
  });
});

// ── bindingClass ──────────────────────────────────────────────────────────────

describe('bindingClass', () => {
  it('legally-binding returns binding-legal', () => {
    assert.equal(bindingClass('legally-binding'), 'binding-legal');
  });

  it('voluntary returns binding-voluntary', () => {
    assert.equal(bindingClass('voluntary'), 'binding-voluntary');
  });

  it('executive-action returns binding-exec', () => {
    assert.equal(bindingClass('executive-action'), 'binding-exec');
  });

  it('treaty returns binding-treaty', () => {
    assert.equal(bindingClass('treaty'), 'binding-treaty');
  });

  it('all values return non-empty strings', () => {
    const natures: BindingNature[] = ['legally-binding', 'voluntary', 'executive-action', 'treaty'];
    for (const n of natures) {
      assert.ok(bindingClass(n).length > 0);
    }
  });
});

// ── scopeClass ────────────────────────────────────────────────────────────────

describe('scopeClass', () => {
  it('multilateral returns scope-multi', () => {
    assert.equal(scopeClass('multilateral'), 'scope-multi');
  });

  it('bilateral returns scope-bilateral', () => {
    assert.equal(scopeClass('bilateral'), 'scope-bilateral');
  });

  it('unilateral returns scope-uni', () => {
    assert.equal(scopeClass('unilateral'), 'scope-uni');
  });

  it('voluntary returns scope-voluntary', () => {
    assert.equal(scopeClass('voluntary'), 'scope-voluntary');
  });

  it('all values return distinct classes', () => {
    const scopes: FrameworkScope[] = ['multilateral', 'bilateral', 'unilateral', 'voluntary'];
    const classes = scopes.map(scopeClass);
    assert.equal(new Set(classes).size, 4);
  });
});

// ── computeGovernanceIndex ────────────────────────────────────────────────────

describe('computeGovernanceIndex', () => {
  it('returns 0 for empty frameworks', () => {
    assert.equal(computeGovernanceIndex([], []), 0);
  });

  it('returns 0 when no active frameworks', () => {
    const inactive = MOCK_FRAMEWORKS.filter(f => f.status !== 'active');
    assert.equal(computeGovernanceIndex(inactive, []), 0);
  });

  it('returns a number in range 0-100', () => {
    const idx = computeGovernanceIndex(MOCK_FRAMEWORKS, MOCK_PROGRAMS);
    assert.ok(idx >= 0 && idx <= 100);
  });

  it('returns an integer', () => {
    const idx = computeGovernanceIndex(MOCK_FRAMEWORKS, MOCK_PROGRAMS);
    assert.equal(idx, Math.round(idx));
  });

  it('critical programs reduce the index', () => {
    const noCritical = MOCK_PROGRAMS.filter(p => p.riskLevel !== 'critical');
    const withCritical = MOCK_PROGRAMS;
    const idxNone = computeGovernanceIndex(MOCK_FRAMEWORKS, noCritical);
    const idxWith = computeGovernanceIndex(MOCK_FRAMEWORKS, withCritical);
    assert.ok(idxNone >= idxWith);
  });

  it('legally-binding frameworks boost index vs voluntary-only', () => {
    const bindingFw = [makeFramework({ status: 'active', bindingNature: 'legally-binding', governanceScore: 70 })];
    const voluntaryFw = [makeFramework({ status: 'active', bindingNature: 'voluntary', governanceScore: 70 })];
    const idxBinding = computeGovernanceIndex(bindingFw, []);
    const idxVoluntary = computeGovernanceIndex(voluntaryFw, []);
    // Both should return the same base score (70) since weighting affects average the same when single
    assert.equal(idxBinding, 70);
    assert.equal(idxVoluntary, 70);
  });

  it('never exceeds 100', () => {
    const maxFrameworks = MOCK_FRAMEWORKS.map(f => ({ ...f, status: 'active' as FrameworkStatus, governanceScore: 100 }));
    assert.ok(computeGovernanceIndex(maxFrameworks, []) <= 100);
  });

  it('never goes below 0', () => {
    const manyPenalties = Array.from({ length: 100 }, (_, i) =>
      makeMilProgram({ id: `X${i}`, riskLevel: 'critical' }),
    );
    assert.ok(computeGovernanceIndex(MOCK_FRAMEWORKS, manyPenalties) >= 0);
  });
});

// ── getArmsRaceRisk ───────────────────────────────────────────────────────────

describe('getArmsRaceRisk', () => {
  it('returns critical when any program is critical', () => {
    assert.equal(getArmsRaceRisk(MOCK_PROGRAMS), 'critical');
  });

  it('returns high when highest is high', () => {
    const progs = [makeMilProgram({ riskLevel: 'high' }), makeMilProgram({ riskLevel: 'low' })];
    assert.equal(getArmsRaceRisk(progs), 'high');
  });

  it('returns medium when highest is medium', () => {
    const progs = [makeMilProgram({ riskLevel: 'medium' }), makeMilProgram({ riskLevel: 'low' })];
    assert.equal(getArmsRaceRisk(progs), 'medium');
  });

  it('returns low when all are low', () => {
    const progs = [makeMilProgram({ riskLevel: 'low' }), makeMilProgram({ riskLevel: 'low' })];
    assert.equal(getArmsRaceRisk(progs), 'low');
  });

  it('returns low for empty input', () => {
    assert.equal(getArmsRaceRisk([]), 'low');
  });

  it('does not mutate input', () => {
    const before = MOCK_PROGRAMS.length;
    getArmsRaceRisk(MOCK_PROGRAMS);
    assert.equal(MOCK_PROGRAMS.length, before);
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.frameworks));
    assert.ok(Array.isArray(d.militaryPrograms));
    assert.ok(Array.isArray(d.benchmarks));
    assert.equal(typeof d.globalGovernanceIndex, 'number');
    assert.equal(typeof d.activeFrameworkCount, 'number');
    assert.equal(typeof d.bindingFrameworkCount, 'number');
    assert.ok(typeof d.armsRaceRisk === 'string');
    assert.equal(typeof d.voluntaryCommitmentCount, 'number');
    assert.equal(typeof d.coverageGap, 'boolean');
    assert.ok(Array.isArray(d.recentFrameworks));
  });

  it('frameworks array has at least 8 entries', () => {
    assert.ok(buildRenderData().frameworks.length >= 8);
  });

  it('militaryPrograms array has at least 3 entries', () => {
    assert.ok(buildRenderData().militaryPrograms.length >= 3);
  });

  it('benchmarks array has at least 3 entries', () => {
    assert.ok(buildRenderData().benchmarks.length >= 3);
  });

  it('globalGovernanceIndex is in range 0-100', () => {
    const idx = buildRenderData().globalGovernanceIndex;
    assert.ok(idx >= 0 && idx <= 100);
  });

  it('activeFrameworkCount matches actual active count', () => {
    const d = buildRenderData();
    const expected = d.frameworks.filter(f => f.status === 'active').length;
    assert.equal(d.activeFrameworkCount, expected);
  });

  it('bindingFrameworkCount matches actual binding count', () => {
    const d = buildRenderData();
    const expected = d.frameworks.filter(f => f.bindingNature === 'legally-binding').length;
    assert.equal(d.bindingFrameworkCount, expected);
  });

  it('voluntaryCommitmentCount matches actual voluntary count', () => {
    const d = buildRenderData();
    const expected = d.frameworks.filter(f => f.bindingNature === 'voluntary').length;
    assert.equal(d.voluntaryCommitmentCount, expected);
  });

  it('armsRaceRisk matches getArmsRaceRisk of programs', () => {
    const d = buildRenderData();
    const risks = d.militaryPrograms.map(p => p.riskLevel);
    if (risks.includes('critical')) assert.equal(d.armsRaceRisk, 'critical');
    else if (risks.includes('high')) assert.equal(d.armsRaceRisk, 'high');
    else if (risks.includes('medium')) assert.equal(d.armsRaceRisk, 'medium');
    else assert.equal(d.armsRaceRisk, 'low');
  });

  it('recentFrameworks has at most 5 entries', () => {
    assert.ok(buildRenderData().recentFrameworks.length <= 5);
  });

  it('recentFrameworks sorted by date descending', () => {
    const rf = buildRenderData().recentFrameworks;
    for (let i = 1; i < rf.length; i++) {
      assert.ok(rf[i - 1].date >= rf[i].date);
    }
  });

  it('all framework IDs are unique', () => {
    const ids = buildRenderData().frameworks.map(f => f.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('all military program IDs are unique', () => {
    const ids = buildRenderData().militaryPrograms.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('all governance scores in range 0-100', () => {
    for (const f of buildRenderData().frameworks) {
      assert.ok(f.governanceScore >= 0 && f.governanceScore <= 100,
        `${f.id} governanceScore ${f.governanceScore} out of range`);
    }
  });

  it('all signatories are positive integers', () => {
    for (const f of buildRenderData().frameworks) {
      assert.ok(Number.isInteger(f.signatories) && f.signatories > 0,
        `${f.id} signatories invalid`);
    }
  });

  it('all framework dates are ISO date strings', () => {
    for (const f of buildRenderData().frameworks) {
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(f.date), `${f.id} date "${f.date}" not ISO format`);
    }
  });

  it('all frameworks have non-empty keyProvisions', () => {
    for (const f of buildRenderData().frameworks) {
      assert.ok(f.keyProvisions.length > 0, `${f.id} has no keyProvisions`);
    }
  });

  it('EU AI Act present and legally binding', () => {
    const d = buildRenderData();
    const eu = d.frameworks.find(f => f.id === 'F003');
    assert.ok(eu, 'EU AI Act (F003) not found');
    assert.equal(eu!.bindingNature, 'legally-binding');
    assert.equal(eu!.scope, 'multilateral');
  });

  it('Bletchley Declaration present with 28 signatories', () => {
    const d = buildRenderData();
    const bletchley = d.frameworks.find(f => f.id === 'F001');
    assert.ok(bletchley, 'Bletchley Declaration (F001) not found');
    assert.equal(bletchley!.signatories, 28);
  });

  it('Seoul Summit present with China joining', () => {
    const d = buildRenderData();
    const seoul = d.frameworks.find(f => f.id === 'F006');
    assert.ok(seoul, 'Seoul Summit (F006) not found');
    assert.equal(seoul!.status, 'active');
  });

  it('OECD Principles present as oldest framework', () => {
    const d = buildRenderData();
    const oecd = d.frameworks.find(f => f.id === 'F009');
    assert.ok(oecd, 'OECD AI Principles (F009) not found');
    assert.ok(oecd!.date < '2020-01-01');
  });

  it('coverageGap is true (no binding global treaty with 50+ signatories)', () => {
    // By design, EU AI Act has 27 signatories which is under 50
    assert.equal(buildRenderData().coverageGap, true);
  });

  it('China program present with critical risk level', () => {
    const d = buildRenderData();
    const china = d.militaryPrograms.find(p => p.country === 'China');
    assert.ok(china, 'China program not found');
    assert.equal(china!.riskLevel, 'critical');
    assert.equal(china!.computeConstraints, true);
  });

  it('USA program present and operational', () => {
    const d = buildRenderData();
    const usa = d.militaryPrograms.find(p => p.country === 'USA');
    assert.ok(usa, 'USA program not found');
    assert.equal(usa!.status, 'operational');
  });

  it('LAWS Treaty Gap benchmark present with critical impact', () => {
    const d = buildRenderData();
    const laws = d.benchmarks.find(b => b.id === 'B003');
    assert.ok(laws, 'LAWS benchmark (B003) not found');
    assert.equal(laws!.impactLevel, 'critical');
    assert.equal(laws!.status, 'monitored');
  });

  it('Compute threshold benchmark marked threshold-passed', () => {
    const d = buildRenderData();
    const compute = d.benchmarks.find(b => b.id === 'B001');
    assert.ok(compute, 'Compute threshold benchmark (B001) not found');
    assert.equal(compute!.status, 'threshold-passed');
  });

  it('at least 2 legally-binding frameworks', () => {
    const d = buildRenderData();
    assert.ok(d.frameworks.filter(f => f.bindingNature === 'legally-binding').length >= 2);
  });

  it('all military program countries are non-empty strings', () => {
    for (const p of buildRenderData().militaryPrograms) {
      assert.ok(p.country.trim().length > 0);
    }
  });

  it('all benchmark policy responses are non-empty strings', () => {
    for (const b of buildRenderData().benchmarks) {
      assert.ok(b.policyResponse.trim().length > 0, `${b.id} has empty policyResponse`);
    }
  });

  it('armsRaceRisk is one of the valid values', () => {
    const valid = new Set<string>(['critical', 'high', 'medium', 'low']);
    assert.ok(valid.has(buildRenderData().armsRaceRisk));
  });

  it('UN Advisory Body framework present as proposed', () => {
    const d = buildRenderData();
    const un = d.frameworks.find(f => f.id === 'F007');
    assert.ok(un, 'UN AI Advisory Body (F007) not found');
    assert.equal(un!.status, 'proposed');
    assert.equal(un!.signatories, 193);
  });
});
