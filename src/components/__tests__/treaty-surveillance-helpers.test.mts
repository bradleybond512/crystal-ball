import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  computeGlobalComplianceScore,
  getInForceTreaties,
  getCriticalHealthTreaties,
  getNonCompliantRecords,
  getOngoingViolations,
  getByDomain,
  rankByHealth,
  healthClass,
  complianceClass,
  statusClass,
  buildRenderData,
  type Treaty,
  type ComplianceRecord,
  type TreatyDomain,
  type ComplianceRating,
} from '../treaty-surveillance-helpers.ts';

// ── computeGlobalComplianceScore ─────────────────────────────────────────────
describe('computeGlobalComplianceScore', () => {
  it('returns 100 for empty array', () => {
    assert.equal(computeGlobalComplianceScore([]), 100);
  });

  it('returns 100 for all-Compliant records', () => {
    const r: ComplianceRecord[] = [{ id: 'x', country: 'A', treaty: 'T', rating: 'Compliant', issue: '', yearReported: '2020', ongoing: false }];
    assert.equal(computeGlobalComplianceScore(r), 100);
  });

  it('deducts 10 per Non-Compliant record — single', () => {
    const make = (id: string): ComplianceRecord => ({ id, country: 'A', treaty: 'T', rating: 'Non-Compliant', issue: '', yearReported: '2020', ongoing: false });
    assert.equal(computeGlobalComplianceScore([make('a')]), 90);
  });

  it('deducts 10 per Non-Compliant record — two records', () => {
    const make = (id: string): ComplianceRecord => ({ id, country: 'A', treaty: 'T', rating: 'Non-Compliant', issue: '', yearReported: '2020', ongoing: false });
    assert.equal(computeGlobalComplianceScore([make('a'), make('b')]), 80);
  });

  it('deducts 10 per Non-Compliant record — three records', () => {
    const make = (id: string): ComplianceRecord => ({ id, country: 'A', treaty: 'T', rating: 'Non-Compliant', issue: '', yearReported: '2020', ongoing: false });
    assert.equal(computeGlobalComplianceScore([make('a'), make('b'), make('c')]), 70);
  });

  it('deducts 3 per Partial record', () => {
    const r: ComplianceRecord[] = [{ id: 'x', country: 'A', treaty: 'T', rating: 'Partial', issue: '', yearReported: '2020', ongoing: false }];
    assert.equal(computeGlobalComplianceScore(r), 97);
  });

  it('combines Non-Compliant and Partial penalties', () => {
    const nc: ComplianceRecord = { id: 'a', country: 'A', treaty: 'T', rating: 'Non-Compliant', issue: '', yearReported: '2020', ongoing: false };
    const p: ComplianceRecord  = { id: 'b', country: 'B', treaty: 'T', rating: 'Partial',       issue: '', yearReported: '2020', ongoing: false };
    assert.equal(computeGlobalComplianceScore([nc, p]), 87);
  });

  it('never returns below 0', () => {
    const recs: ComplianceRecord[] = Array.from({ length: 15 }, (_, i) => ({
      id: `r${i}`, country: 'X', treaty: 'T', rating: 'Non-Compliant' as ComplianceRating, issue: '', yearReported: '2020', ongoing: false,
    }));
    assert.equal(computeGlobalComplianceScore(recs), 0);
  });

  it('ignores Unknown rating — no penalty', () => {
    const r: ComplianceRecord[] = [
      { id: 'a', country: 'A', treaty: 'T', rating: 'Unknown', issue: '', yearReported: '2020', ongoing: false },
    ];
    assert.equal(computeGlobalComplianceScore(r), 100);
  });

  it('ignores N/A (Non-Member) rating — no penalty', () => {
    const r: ComplianceRecord[] = [
      { id: 'b', country: 'B', treaty: 'T', rating: 'N/A (Non-Member)', issue: '', yearReported: '2020', ongoing: false },
    ];
    assert.equal(computeGlobalComplianceScore(r), 100);
  });
});

// ── getInForceTreaties ───────────────────────────────────────────────────────
describe('getInForceTreaties', () => {
  it('returns only In Force treaties from real data', () => {
    const data = buildRenderData();
    const inForce = getInForceTreaties(data.treaties);
    assert.ok(inForce.length > 0, 'should have at least one In Force treaty');
    for (const t of inForce) {
      assert.equal(t.status, 'In Force');
    }
  });

  it('returns empty array when no In Force treaties', () => {
    const treaties: Treaty[] = [
      { id: 'a', name: 'X', abbreviation: 'X', domain: 'Nuclear', status: 'Withdrawn', parties: 0, entryInForce: '2000', purpose: '', overallHealth: 'Defunct', keyCompliers: [], keyViolators: [], recentDevelopment: '' },
    ];
    assert.equal(getInForceTreaties(treaties).length, 0);
  });

  it('does not return Suspended treaties', () => {
    const data = buildRenderData();
    for (const t of getInForceTreaties(data.treaties)) {
      assert.notEqual(t.status, 'Suspended');
    }
  });

  it('does not return Withdrawn treaties', () => {
    const data = buildRenderData();
    for (const t of getInForceTreaties(data.treaties)) {
      assert.notEqual(t.status, 'Withdrawn');
    }
  });

  it('count matches buildRenderData inForceCount', () => {
    const data = buildRenderData();
    assert.equal(getInForceTreaties(data.treaties).length, data.inForceCount);
  });
});

// ── getCriticalHealthTreaties ────────────────────────────────────────────────
describe('getCriticalHealthTreaties', () => {
  it('result contains only Critical or Defunct entries', () => {
    const data = buildRenderData();
    for (const t of getCriticalHealthTreaties(data.treaties)) {
      assert.ok(t.overallHealth === 'Critical' || t.overallHealth === 'Defunct');
    }
  });

  it('at least one Critical or Defunct treaty exists in real data', () => {
    const data = buildRenderData();
    assert.ok(getCriticalHealthTreaties(data.treaties).length > 0);
  });

  it('excludes Strong treaties', () => {
    const data = buildRenderData();
    for (const t of getCriticalHealthTreaties(data.treaties)) {
      assert.notEqual(t.overallHealth, 'Strong');
    }
  });

  it('excludes Weakening treaties', () => {
    const data = buildRenderData();
    for (const t of getCriticalHealthTreaties(data.treaties)) {
      assert.notEqual(t.overallHealth, 'Weakening');
    }
  });

  it('count matches buildRenderData criticalHealthCount', () => {
    const data = buildRenderData();
    assert.equal(getCriticalHealthTreaties(data.treaties).length, data.criticalHealthCount);
  });

  it('returns empty for all-Strong input', () => {
    const treaties: Treaty[] = [
      { id: 'a', name: 'X', abbreviation: 'X', domain: 'Nuclear', status: 'In Force', parties: 5, entryInForce: '2000', purpose: '', overallHealth: 'Strong', keyCompliers: [], keyViolators: [], recentDevelopment: '' },
    ];
    assert.equal(getCriticalHealthTreaties(treaties).length, 0);
  });
});

// ── getNonCompliantRecords ───────────────────────────────────────────────────
describe('getNonCompliantRecords', () => {
  it('returns only Non-Compliant records', () => {
    for (const r of getNonCompliantRecords(buildRenderData().compliance)) {
      assert.equal(r.rating, 'Non-Compliant');
    }
  });

  it('count matches buildRenderData majorViolationCount', () => {
    const d = buildRenderData();
    assert.equal(getNonCompliantRecords(d.compliance).length, d.majorViolationCount);
  });

  it('count matches nonCompliantRecords field', () => {
    const d = buildRenderData();
    assert.equal(getNonCompliantRecords(d.compliance).length, d.nonCompliantRecords.length);
  });

  it('returns empty for all-Compliant input', () => {
    const r: ComplianceRecord[] = [{ id: 'a', country: 'A', treaty: 'T', rating: 'Compliant', issue: '', yearReported: '2020', ongoing: false }];
    assert.equal(getNonCompliantRecords(r).length, 0);
  });

  it('does not include Partial records', () => {
    for (const r of getNonCompliantRecords(buildRenderData().compliance)) {
      assert.notEqual(r.rating, 'Partial');
    }
  });
});

// ── getOngoingViolations ─────────────────────────────────────────────────────
describe('getOngoingViolations', () => {
  it('returns only ongoing + Non-Compliant records', () => {
    for (const r of getOngoingViolations(buildRenderData().compliance)) {
      assert.equal(r.ongoing, true);
      assert.equal(r.rating, 'Non-Compliant');
    }
  });

  it('excludes non-ongoing Non-Compliant records', () => {
    const recs: ComplianceRecord[] = [
      { id: 'a', country: 'A', treaty: 'T', rating: 'Non-Compliant', issue: '', yearReported: '2020', ongoing: false },
      { id: 'b', country: 'B', treaty: 'T', rating: 'Non-Compliant', issue: '', yearReported: '2021', ongoing: true  },
    ];
    const ov = getOngoingViolations(recs);
    assert.equal(ov.length, 1);
    assert.equal(ov[0]!.id, 'b');
  });

  it('excludes ongoing Partial records', () => {
    const recs: ComplianceRecord[] = [
      { id: 'a', country: 'A', treaty: 'T', rating: 'Partial', issue: '', yearReported: '2020', ongoing: true },
    ];
    assert.equal(getOngoingViolations(recs).length, 0);
  });

  it('returns empty for empty input', () => {
    assert.equal(getOngoingViolations([]).length, 0);
  });

  it('ongoing violations are a subset of non-compliant records', () => {
    const d = buildRenderData();
    const ncIds = new Set(getNonCompliantRecords(d.compliance).map((r) => r.id));
    for (const r of getOngoingViolations(d.compliance)) {
      assert.ok(ncIds.has(r.id));
    }
  });
});

// ── getByDomain ───────────────────────────────────────────────────────────────
describe('getByDomain', () => {
  it('returns only Nuclear treaties', () => {
    const nuclear = getByDomain(buildRenderData().treaties, 'Nuclear');
    assert.ok(nuclear.length > 0);
    for (const t of nuclear) assert.equal(t.domain, 'Nuclear');
  });

  it('returns only Chemical treaties', () => {
    const chem = getByDomain(buildRenderData().treaties, 'Chemical');
    assert.ok(chem.length > 0);
    for (const t of chem) assert.equal(t.domain, 'Chemical');
  });

  it('returns only Biological treaties', () => {
    const bio = getByDomain(buildRenderData().treaties, 'Biological');
    assert.ok(bio.length > 0);
    for (const t of bio) assert.equal(t.domain, 'Biological');
  });

  it('returns only Space treaties', () => {
    const space = getByDomain(buildRenderData().treaties, 'Space');
    assert.ok(space.length > 0);
    for (const t of space) assert.equal(t.domain, 'Space');
  });

  it('returns only Environment treaties', () => {
    const env = getByDomain(buildRenderData().treaties, 'Environment');
    assert.ok(env.length > 0);
    for (const t of env) assert.equal(t.domain, 'Environment');
  });

  it('returns only Conventional treaties', () => {
    const conv = getByDomain(buildRenderData().treaties, 'Conventional');
    assert.ok(conv.length > 0);
    for (const t of conv) assert.equal(t.domain, 'Conventional');
  });

  it('returns empty for Cyber domain (none in dataset)', () => {
    assert.equal(getByDomain(buildRenderData().treaties, 'Cyber').length, 0);
  });

  it('domain partition does not exceed total treaties', () => {
    const domains: TreatyDomain[] = ['Nuclear','Chemical','Biological','Conventional','Space','Cyber','Trade','Environment','Human Rights'];
    const d = buildRenderData();
    let sum = 0;
    for (const dom of domains) sum += getByDomain(d.treaties, dom).length;
    assert.ok(sum <= d.treaties.length);
  });
});

// ── rankByHealth ─────────────────────────────────────────────────────────────
describe('rankByHealth', () => {
  it('Defunct comes before Critical', () => {
    const input: Treaty[] = [
      { id: 'a', name: 'A', abbreviation: 'A', domain: 'Nuclear', status: 'In Force', parties: 1, entryInForce: '2000', purpose: '', overallHealth: 'Critical', keyCompliers: [], keyViolators: [], recentDevelopment: '' },
      { id: 'b', name: 'B', abbreviation: 'B', domain: 'Nuclear', status: 'In Force', parties: 1, entryInForce: '2000', purpose: '', overallHealth: 'Defunct',  keyCompliers: [], keyViolators: [], recentDevelopment: '' },
    ];
    const ranked = rankByHealth(input);
    assert.equal(ranked[0]!.overallHealth, 'Defunct');
    assert.equal(ranked[1]!.overallHealth, 'Critical');
  });

  it('Strong comes last', () => {
    const input: Treaty[] = [
      { id: 'a', name: 'A', abbreviation: 'A', domain: 'Nuclear', status: 'In Force', parties: 1, entryInForce: '2000', purpose: '', overallHealth: 'Strong',    keyCompliers: [], keyViolators: [], recentDevelopment: '' },
      { id: 'b', name: 'B', abbreviation: 'B', domain: 'Nuclear', status: 'In Force', parties: 1, entryInForce: '2000', purpose: '', overallHealth: 'Defunct',   keyCompliers: [], keyViolators: [], recentDevelopment: '' },
      { id: 'c', name: 'C', abbreviation: 'C', domain: 'Nuclear', status: 'In Force', parties: 1, entryInForce: '2000', purpose: '', overallHealth: 'Weakening', keyCompliers: [], keyViolators: [], recentDevelopment: '' },
    ];
    const ranked = rankByHealth(input);
    assert.equal(ranked.at(-1)!.overallHealth, 'Strong');
    assert.equal(ranked[0]!.overallHealth, 'Defunct');
  });

  it('full order: Defunct < Critical < Weakening < Strong', () => {
    const input: Treaty[] = [
      { id: 'a', name: 'A', abbreviation: 'A', domain: 'Nuclear', status: 'In Force', parties: 1, entryInForce: '2000', purpose: '', overallHealth: 'Strong',    keyCompliers: [], keyViolators: [], recentDevelopment: '' },
      { id: 'b', name: 'B', abbreviation: 'B', domain: 'Nuclear', status: 'In Force', parties: 1, entryInForce: '2000', purpose: '', overallHealth: 'Defunct',   keyCompliers: [], keyViolators: [], recentDevelopment: '' },
      { id: 'c', name: 'C', abbreviation: 'C', domain: 'Nuclear', status: 'In Force', parties: 1, entryInForce: '2000', purpose: '', overallHealth: 'Critical',  keyCompliers: [], keyViolators: [], recentDevelopment: '' },
      { id: 'd', name: 'D', abbreviation: 'D', domain: 'Nuclear', status: 'In Force', parties: 1, entryInForce: '2000', purpose: '', overallHealth: 'Weakening', keyCompliers: [], keyViolators: [], recentDevelopment: '' },
    ];
    const ranked = rankByHealth(input);
    assert.deepEqual(ranked.map((t) => t.overallHealth), ['Defunct', 'Critical', 'Weakening', 'Strong']);
  });

  it('does not mutate the input array', () => {
    const d = buildRenderData();
    const original = d.treaties.map((t) => t.id);
    rankByHealth(d.treaties);
    assert.deepEqual(d.treaties.map((t) => t.id), original);
  });

  it('preserves all elements', () => {
    const d = buildRenderData();
    assert.equal(rankByHealth(d.treaties).length, d.treaties.length);
  });
});

// ── healthClass ───────────────────────────────────────────────────────────────
describe('healthClass', () => {
  it('returns treaty-strong for Strong', () => {
    assert.equal(healthClass('Strong'), 'treaty-strong');
  });

  it('returns treaty-weakening for Weakening', () => {
    assert.equal(healthClass('Weakening'), 'treaty-weakening');
  });

  it('returns treaty-critical for Critical', () => {
    assert.equal(healthClass('Critical'), 'treaty-critical');
  });

  it('returns treaty-defunct for Defunct', () => {
    assert.equal(healthClass('Defunct'), 'treaty-defunct');
  });
});

// ── complianceClass ───────────────────────────────────────────────────────────
describe('complianceClass', () => {
  it('returns comp-ok for Compliant', () => {
    assert.equal(complianceClass('Compliant'), 'comp-ok');
  });

  it('returns comp-partial for Partial', () => {
    assert.equal(complianceClass('Partial'), 'comp-partial');
  });

  it('returns comp-fail for Non-Compliant', () => {
    assert.equal(complianceClass('Non-Compliant'), 'comp-fail');
  });

  it('returns comp-unknown for Unknown', () => {
    assert.equal(complianceClass('Unknown'), 'comp-unknown');
  });

  it('returns comp-na for N/A (Non-Member)', () => {
    assert.equal(complianceClass('N/A (Non-Member)'), 'comp-na');
  });
});

// ── statusClass ───────────────────────────────────────────────────────────────
describe('statusClass', () => {
  it('returns status-active for In Force', () => {
    assert.equal(statusClass('In Force'), 'status-active');
  });

  it('returns status-suspended for Suspended', () => {
    assert.equal(statusClass('Suspended'), 'status-suspended');
  });

  it('returns status-withdrawn for Withdrawn', () => {
    assert.equal(statusClass('Withdrawn'), 'status-withdrawn');
  });

  it('returns status-expired for Expired', () => {
    assert.equal(statusClass('Expired'), 'status-expired');
  });

  it('returns status-negotiating for Under Negotiation', () => {
    assert.equal(statusClass('Under Negotiation'), 'status-negotiating');
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────
describe('buildRenderData', () => {
  it('returns non-empty treaties array', () => {
    assert.ok(buildRenderData().treaties.length > 0);
  });

  it('returns non-empty compliance array', () => {
    assert.ok(buildRenderData().compliance.length > 0);
  });

  it('inForceCount matches filtered treaty count', () => {
    const d = buildRenderData();
    assert.equal(d.inForceCount, d.treaties.filter((t) => t.status === 'In Force').length);
  });

  it('criticalHealthCount matches filtered treaty count', () => {
    const d = buildRenderData();
    assert.equal(d.criticalHealthCount, d.treaties.filter((t) => t.overallHealth === 'Critical' || t.overallHealth === 'Defunct').length);
  });

  it('majorViolationCount matches filtered compliance count', () => {
    const d = buildRenderData();
    assert.equal(d.majorViolationCount, d.compliance.filter((r) => r.rating === 'Non-Compliant').length);
  });

  it('nonCompliantRecords length equals majorViolationCount', () => {
    const d = buildRenderData();
    assert.equal(d.nonCompliantRecords.length, d.majorViolationCount);
  });

  it('globalComplianceScore is between 0 and 100', () => {
    const d = buildRenderData();
    assert.ok(d.globalComplianceScore >= 0 && d.globalComplianceScore <= 100);
  });

  it('all treaty ids are unique', () => {
    const d = buildRenderData();
    const ids = d.treaties.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('all compliance ids are unique', () => {
    const d = buildRenderData();
    const ids = d.compliance.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('every treaty has non-empty abbreviation', () => {
    for (const t of buildRenderData().treaties) {
      assert.ok(t.abbreviation.length > 0, `treaty ${t.id} has empty abbreviation`);
    }
  });

  it('every compliance record has non-empty country', () => {
    for (const r of buildRenderData().compliance) {
      assert.ok(r.country.length > 0, `record ${r.id} has empty country`);
    }
  });

  it('every compliance record has non-empty issue', () => {
    for (const r of buildRenderData().compliance) {
      assert.ok(r.issue.length > 0, `record ${r.id} has empty issue`);
    }
  });
});
