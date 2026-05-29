import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGlobalComplianceIndex,
  getCasesByBody,
  getActiveCases,
  getVetoedResolutions,
  getMostSevereCases,
  getViolationsByType,
  statusClass,
  severityClass,
  bodyBadgeClass,
  buildRenderData,
  type LegalCase,
  type SCResolution,
  type CaseStatus,
  type CourtBody,
  type ViolationType,
} from '../intl-law-violations-helpers.js';

const MOCK_CASES: LegalCase[] = [
  { id: 'C1', title: 'A v B', body: 'ICJ', applicant: 'A', respondent: 'B', violationType: 'Genocide', status: 'Active', filedDate: '2022-01', description: 'Desc1', severity: 10 },
  { id: 'C2', title: 'C v D', body: 'ICC', applicant: 'C', respondent: 'D', violationType: 'War Crimes', status: 'Pending', filedDate: '2023-03', description: 'Desc2', severity: 8 },
  { id: 'C3', title: 'E v F', body: 'ICJ', applicant: 'E', respondent: 'F', violationType: 'Treaty Violation', status: 'Ruled', filedDate: '2018-01', ruling: 'Partial compliance ordered', description: 'Desc3', severity: 5 },
  { id: 'C4', title: 'G v H', body: 'ECHR', applicant: 'G', respondent: 'H', violationType: 'Human Rights', status: 'Active', filedDate: '2021-06', description: 'Desc4', severity: 7 },
  { id: 'C5', title: 'I v J', body: 'ICC', applicant: 'I', respondent: 'J', violationType: 'War Crimes', status: 'Dismissed', filedDate: '2020-01', description: 'Desc5', severity: 3 },
];

const MOCK_RESOLUTIONS: SCResolution[] = [
  { id: 'R1', resolution: 'S/2022/1', date: '2022-02', topic: 'Ukraine', vetoedBy: ['Russia'], passed: false, description: 'Vetoed by Russia' },
  { id: 'R2', resolution: 'S/2023/1', date: '2023-10', topic: 'Gaza', vetoedBy: ['USA'], passed: false, description: 'Vetoed by USA' },
  { id: 'R3', resolution: '2728', date: '2024-03', topic: 'Gaza ceasefire', vetoedBy: [], passed: true, description: 'Passed with US abstention' },
];

describe('computeGlobalComplianceIndex', () => {
  it('returns a number between 0 and 100', () => {
    const idx = computeGlobalComplianceIndex(MOCK_CASES);
    assert.ok(idx >= 0 && idx <= 100);
  });
  it('returns 50 for empty array', () => {
    assert.equal(computeGlobalComplianceIndex([]), 50);
  });
  it('more severe active cases yield lower index', () => {
    const manyActive = Array.from({ length: 10 }, (_, i) => ({ ...MOCK_CASES[0], id: `X${i}`, severity: 10 }));
    const fewActive = [MOCK_CASES[2]]; // status Ruled
    assert.ok(computeGlobalComplianceIndex(manyActive) < computeGlobalComplianceIndex(fewActive));
  });
  it('never goes below 0', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...MOCK_CASES[0], id: `X${i}` }));
    assert.ok(computeGlobalComplianceIndex(many) >= 0);
  });
  it('returns integer', () => {
    const idx = computeGlobalComplianceIndex(MOCK_CASES);
    assert.equal(idx, Math.round(idx));
  });
  it('single non-severe case returns near-max', () => {
    const low = [{ ...MOCK_CASES[2], severity: 2, status: 'Ruled' as CaseStatus }];
    assert.ok(computeGlobalComplianceIndex(low) >= 80);
  });
});

describe('getCasesByBody', () => {
  it('returns only ICJ cases', () => {
    const icj = getCasesByBody(MOCK_CASES, 'ICJ');
    assert.equal(icj.length, 2);
    assert.ok(icj.every(c => c.body === 'ICJ'));
  });
  it('returns only ICC cases', () => {
    const icc = getCasesByBody(MOCK_CASES, 'ICC');
    assert.equal(icc.length, 2);
  });
  it('returns empty for body with no cases', () => {
    assert.equal(getCasesByBody(MOCK_CASES, 'ITLOS').length, 0);
  });
  it('returns all when all same body', () => {
    const all = MOCK_CASES.map(c => ({ ...c, body: 'ICJ' as CourtBody }));
    assert.equal(getCasesByBody(all, 'ICJ').length, MOCK_CASES.length);
  });
  it('does not return cases of other bodies', () => {
    const echr = getCasesByBody(MOCK_CASES, 'ECHR');
    assert.equal(echr.length, 1);
    assert.equal(echr[0].id, 'C4');
  });
  it('returns correct count for WTO (none)', () => {
    assert.equal(getCasesByBody(MOCK_CASES, 'WTO').length, 0);
  });
});

describe('getActiveCases', () => {
  it('returns Active and Pending cases', () => {
    const active = getActiveCases(MOCK_CASES);
    assert.equal(active.length, 3); // C1=Active, C2=Pending, C4=Active
    assert.ok(active.every(c => c.status === 'Active' || c.status === 'Pending'));
  });
  it('returns empty when all resolved', () => {
    const all = MOCK_CASES.map(c => ({ ...c, status: 'Ruled' as CaseStatus }));
    assert.equal(getActiveCases(all).length, 0);
  });
  it('excludes Dismissed and Withdrawn cases', () => {
    const active = getActiveCases(MOCK_CASES);
    assert.ok(active.every(c => c.status !== 'Dismissed' && c.status !== 'Withdrawn'));
  });
  it('includes Pending status', () => {
    const active = getActiveCases(MOCK_CASES);
    assert.ok(active.some(c => c.status === 'Pending'));
  });
});

describe('getVetoedResolutions', () => {
  it('returns only vetoed (not passed) resolutions', () => {
    const vetoed = getVetoedResolutions(MOCK_RESOLUTIONS);
    assert.equal(vetoed.length, 2);
    assert.ok(vetoed.every(r => !r.passed));
  });
  it('returns empty when all passed', () => {
    const all = MOCK_RESOLUTIONS.map(r => ({ ...r, passed: true }));
    assert.equal(getVetoedResolutions(all).length, 0);
  });
  it('returns all when none passed', () => {
    const all = MOCK_RESOLUTIONS.map(r => ({ ...r, passed: false }));
    assert.equal(getVetoedResolutions(all).length, MOCK_RESOLUTIONS.length);
  });
  it('excludes passed resolutions', () => {
    const vetoed = getVetoedResolutions(MOCK_RESOLUTIONS);
    assert.ok(vetoed.every(r => r.id !== 'R3'));
  });
});

describe('getMostSevereCases', () => {
  it('returns cases sorted by severity descending', () => {
    const top = getMostSevereCases(MOCK_CASES, 3);
    assert.equal(top.length, 3);
    for (let i = 1; i < top.length; i++) {
      assert.ok(top[i - 1].severity >= top[i].severity);
    }
  });
  it('defaults to 5 entries', () => {
    assert.equal(getMostSevereCases(MOCK_CASES).length, 5);
  });
  it('does not mutate original array', () => {
    const orig = MOCK_CASES.map(c => c.id);
    getMostSevereCases(MOCK_CASES, 2);
    assert.deepEqual(MOCK_CASES.map(c => c.id), orig);
  });
  it('returns all if N > length', () => {
    assert.equal(getMostSevereCases(MOCK_CASES, 100).length, MOCK_CASES.length);
  });
  it('top case is highest severity', () => {
    const top = getMostSevereCases(MOCK_CASES, 1);
    assert.equal(top[0].severity, 10);
  });
  it('returns 1 when n=1', () => {
    assert.equal(getMostSevereCases(MOCK_CASES, 1).length, 1);
  });
});

describe('getViolationsByType', () => {
  it('returns only Genocide cases', () => {
    const g = getViolationsByType(MOCK_CASES, 'Genocide');
    assert.equal(g.length, 1);
    assert.equal(g[0].id, 'C1');
  });
  it('returns multiple War Crimes cases', () => {
    const wc = getViolationsByType(MOCK_CASES, 'War Crimes');
    assert.equal(wc.length, 2);
  });
  it('returns empty for type not present', () => {
    assert.equal(getViolationsByType(MOCK_CASES, 'Trade Law').length, 0);
  });
  it('returns Human Rights case', () => {
    const hr = getViolationsByType(MOCK_CASES, 'Human Rights');
    assert.equal(hr.length, 1);
    assert.equal(hr[0].id, 'C4');
  });
});

describe('statusClass', () => {
  it('returns status-active for Active', () => { assert.equal(statusClass('Active'), 'status-active'); });
  it('returns status-pending for Pending', () => { assert.equal(statusClass('Pending'), 'status-pending'); });
  it('returns status-ruled for Ruled', () => { assert.equal(statusClass('Ruled'), 'status-ruled'); });
  it('returns status-dismissed for Dismissed', () => { assert.equal(statusClass('Dismissed'), 'status-dismissed'); });
  it('returns status-withdrawn for Withdrawn', () => { assert.equal(statusClass('Withdrawn'), 'status-withdrawn'); });
  it('returns status-enforcement for Enforcement', () => { assert.equal(statusClass('Enforcement'), 'status-enforcement'); });
});

describe('severityClass', () => {
  it('returns sev-critical for score 9', () => { assert.equal(severityClass(9), 'sev-critical'); });
  it('returns sev-critical for score 10', () => { assert.equal(severityClass(10), 'sev-critical'); });
  it('returns sev-high for score 7', () => { assert.equal(severityClass(7), 'sev-high'); });
  it('returns sev-high for score 8', () => { assert.equal(severityClass(8), 'sev-high'); });
  it('returns sev-medium for score 5', () => { assert.equal(severityClass(5), 'sev-medium'); });
  it('returns sev-medium for score 6', () => { assert.equal(severityClass(6), 'sev-medium'); });
  it('returns sev-low for score 4', () => { assert.equal(severityClass(4), 'sev-low'); });
  it('returns sev-low for score 0', () => { assert.equal(severityClass(0), 'sev-low'); });
});

describe('bodyBadgeClass', () => {
  it('returns body-icj for ICJ', () => { assert.equal(bodyBadgeClass('ICJ'), 'body-icj'); });
  it('returns body-icc for ICC', () => { assert.equal(bodyBadgeClass('ICC'), 'body-icc'); });
  it('returns body-unsc for UNSC', () => { assert.equal(bodyBadgeClass('UNSC'), 'body-unsc'); });
  it('returns body-echr for ECHR', () => { assert.equal(bodyBadgeClass('ECHR'), 'body-echr'); });
  it('returns body-iachr for IACHR', () => { assert.equal(bodyBadgeClass('IACHR'), 'body-iachr'); });
  it('returns body-wto for WTO', () => { assert.equal(bodyBadgeClass('WTO'), 'body-wto'); });
  it('returns body-itlos for ITLOS', () => { assert.equal(bodyBadgeClass('ITLOS'), 'body-itlos'); });
});

describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.cases));
    assert.ok(Array.isArray(d.resolutions));
    assert.equal(typeof d.globalComplianceIndex, 'number');
    assert.equal(typeof d.activeCaseCount, 'number');
    assert.equal(typeof d.iccCaseCount, 'number');
    assert.equal(typeof d.icjCaseCount, 'number');
    assert.equal(typeof d.vetoedResolutionsCount, 'number');
    assert.ok(Array.isArray(d.mostSevereCases));
  });
  it('cases array is non-empty', () => { assert.ok(buildRenderData().cases.length > 0); });
  it('resolutions array is non-empty', () => { assert.ok(buildRenderData().resolutions.length > 0); });
  it('activeCaseCount matches actual active', () => {
    const d = buildRenderData();
    assert.equal(d.activeCaseCount, d.cases.filter(c => c.status === 'Active' || c.status === 'Pending').length);
  });
  it('icjCaseCount matches ICJ cases', () => {
    const d = buildRenderData();
    assert.equal(d.icjCaseCount, d.cases.filter(c => c.body === 'ICJ').length);
  });
  it('iccCaseCount matches ICC cases', () => {
    const d = buildRenderData();
    assert.equal(d.iccCaseCount, d.cases.filter(c => c.body === 'ICC').length);
  });
  it('vetoedResolutionsCount matches unpassed resolutions', () => {
    const d = buildRenderData();
    assert.equal(d.vetoedResolutionsCount, d.resolutions.filter(r => !r.passed).length);
  });
  it('mostSevereCases is sorted descending', () => {
    const ms = buildRenderData().mostSevereCases;
    for (let i = 1; i < ms.length; i++) {
      assert.ok(ms[i - 1].severity >= ms[i].severity);
    }
  });
  it('globalComplianceIndex is 0-100', () => {
    const idx = buildRenderData().globalComplianceIndex;
    assert.ok(idx >= 0 && idx <= 100);
  });
  it('all severity scores are 1-10', () => {
    for (const c of buildRenderData().cases) {
      assert.ok(c.severity >= 1 && c.severity <= 10);
    }
  });
  it('all case statuses are valid', () => {
    const valid = new Set(['Active', 'Pending', 'Ruled', 'Enforcement', 'Dismissed', 'Withdrawn']);
    for (const c of buildRenderData().cases) {
      assert.ok(valid.has(c.status));
    }
  });
  it('mostSevereCases has at most 5 entries', () => {
    assert.ok(buildRenderData().mostSevereCases.length <= 5);
  });
  it('all cases have non-empty titles', () => {
    assert.ok(buildRenderData().cases.every(c => c.title.length > 0));
  });
  it('all resolutions have a date', () => {
    assert.ok(buildRenderData().resolutions.every(r => r.date.length > 0));
  });
});
