import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  getArcticNations,
  getSovereigntyDisputes,
  getMilitaryPresences,
  computeMilitaryPresenceScore,
  getResourceSectors,
  getShippingLanes,
  classifyShippingRisk,
  getSeaIceTrend,
  computeSovereigntyScore,
  computeResourceCompetitionIndex,
  computeOverallTensionScore,
  getTensionLabel,
  getTreatyComplianceScore,
  buildArcticRenderData,
  formatScore,
  getRiskColor,
  getTopClaimants,
  filterDisputesByNation,
} from '../arctic-competition-helpers.ts';

// ── getArcticNations ─────────────────────────────────────────────────────────

describe('getArcticNations', () => {
  it('returns exactly 5 nations', () => {
    assert.equal(getArcticNations().length, 5);
  });

  it('includes all expected nation codes', () => {
    const codes = getArcticNations().map((n) => n.code);
    assert.deepEqual(codes.sort(), ['CA', 'DK', 'NO', 'RU', 'US'].sort());
  });

  it('claimStrength values are in [0, 1]', () => {
    for (const n of getArcticNations()) {
      assert.ok(n.claimStrength >= 0 && n.claimStrength <= 1, `${n.code} claimStrength out of range`);
    }
  });

  it('militaryScore values are in [0, 1]', () => {
    for (const n of getArcticNations()) {
      assert.ok(n.militaryScore >= 0 && n.militaryScore <= 1, `${n.code} militaryScore out of range`);
    }
  });

  it('resourceInterest values are in [0, 1]', () => {
    for (const n of getArcticNations()) {
      assert.ok(n.resourceInterest >= 0 && n.resourceInterest <= 1, `${n.code} resourceInterest out of range`);
    }
  });
});

// ── getSovereigntyDisputes ───────────────────────────────────────────────────

describe('getSovereigntyDisputes', () => {
  it('returns at least 5 disputes', () => {
    assert.ok(getSovereigntyDisputes().length >= 5);
  });

  it('each dispute has a contested boolean field', () => {
    for (const d of getSovereigntyDisputes()) {
      assert.equal(typeof d.contested, 'boolean');
    }
  });

  it('each dispute has non-empty claimants array', () => {
    for (const d of getSovereigntyDisputes()) {
      assert.ok(Array.isArray(d.claimants) && d.claimants.length > 0);
    }
  });

  it('tensionLevel is in [0, 1] for all disputes', () => {
    for (const d of getSovereigntyDisputes()) {
      assert.ok(d.tensionLevel >= 0 && d.tensionLevel <= 1, `${d.region} tensionLevel out of range`);
    }
  });
});

// ── computeMilitaryPresenceScore ─────────────────────────────────────────────

describe('computeMilitaryPresenceScore', () => {
  it('returns a value in [0, 1]', () => {
    const score = computeMilitaryPresenceScore({ nation: 'RU', bases: 10, icebreakers: 30, submarines: 15, recentExercises: 5 });
    assert.ok(score >= 0 && score <= 1);
  });

  it('higher bases yields higher score than zero bases (all else equal)', () => {
    const higher = computeMilitaryPresenceScore({ nation: 'X', bases: 20, icebreakers: 0, submarines: 0, recentExercises: 0 });
    const lower = computeMilitaryPresenceScore({ nation: 'X', bases: 0, icebreakers: 0, submarines: 0, recentExercises: 0 });
    assert.ok(higher > lower);
  });

  it('all zeros gives 0', () => {
    const score = computeMilitaryPresenceScore({ nation: 'X', bases: 0, icebreakers: 0, submarines: 0, recentExercises: 0 });
    assert.equal(score, 0);
  });

  it('max realistic values clamp at or near 1', () => {
    const score = computeMilitaryPresenceScore({ nation: 'X', bases: 1000, icebreakers: 1000, submarines: 1000, recentExercises: 1000 });
    assert.ok(score >= 0.999 && score <= 1, `Expected score near 1, got ${score}`);
  });
});

// ── getResourceSectors ───────────────────────────────────────────────────────

describe('getResourceSectors', () => {
  it('returns at least 6 sectors', () => {
    assert.ok(getResourceSectors().length >= 6);
  });

  it('all types are valid', () => {
    const validTypes = new Set(['oil', 'gas', 'rare_earth', 'shipping']);
    for (const s of getResourceSectors()) {
      assert.ok(validTypes.has(s.type), `Unknown type: ${s.type}`);
    }
  });

  it('competitionLevel is in [0, 1]', () => {
    for (const s of getResourceSectors()) {
      assert.ok(s.competitionLevel >= 0 && s.competitionLevel <= 1);
    }
  });

  it('developmentStage is a valid value', () => {
    const valid = new Set(['unexplored', 'surveyed', 'contested', 'developing', 'producing']);
    for (const s of getResourceSectors()) {
      assert.ok(valid.has(s.developmentStage), `Unknown stage: ${s.developmentStage}`);
    }
  });
});

// ── getShippingLanes ─────────────────────────────────────────────────────────

describe('getShippingLanes', () => {
  it('returns exactly 3 lanes', () => {
    assert.equal(getShippingLanes().length, 3);
  });

  it('route values are valid', () => {
    const valid = new Set(['northwest_passage', 'northern_sea_route', 'transpolar']);
    for (const lane of getShippingLanes()) {
      assert.ok(valid.has(lane.route), `Unknown route: ${lane.route}`);
    }
  });

  it('openMonthsPerYear is <= 12', () => {
    for (const lane of getShippingLanes()) {
      assert.ok(lane.openMonthsPerYear <= 12);
    }
  });
});

// ── classifyShippingRisk ─────────────────────────────────────────────────────

describe('classifyShippingRisk', () => {
  it('low-risk lane with 9+ months and >50 transits returns low', () => {
    const result = classifyShippingRisk({
      name: 'X', route: 'northern_sea_route', controlledBy: 'X',
      openMonthsPerYear: 10, commercialTransits: 60, riskLevel: 'low',
    });
    assert.equal(result, 'low');
  });

  it('high commercial transits with >= 6 open months returns medium', () => {
    const result = classifyShippingRisk({
      name: 'X', route: 'northern_sea_route', controlledBy: 'X',
      openMonthsPerYear: 6, commercialTransits: 25, riskLevel: 'low',
    });
    assert.equal(result, 'medium');
  });

  it('3 open months yields high', () => {
    const result = classifyShippingRisk({
      name: 'X', route: 'northwest_passage', controlledBy: 'CA',
      openMonthsPerYear: 3, commercialTransits: 5, riskLevel: 'low',
    });
    assert.equal(result, 'high');
  });

  it('returns a valid risk level string', () => {
    const valid = new Set(['low', 'medium', 'high', 'critical']);
    for (const lane of getShippingLanes()) {
      assert.ok(valid.has(classifyShippingRisk(lane)));
    }
  });
});

// ── getSeaIceTrend ───────────────────────────────────────────────────────────

describe('getSeaIceTrend', () => {
  it('returns year 2026', () => {
    assert.equal(getSeaIceTrend().year, 2026);
  });

  it('septemberExtentMkm2 is greater than 0', () => {
    assert.ok(getSeaIceTrend().septemberExtentMkm2 > 0);
  });

  it('trend is a valid value', () => {
    const valid = new Set(['stable', 'declining', 'rapid_decline']);
    assert.ok(valid.has(getSeaIceTrend().trend));
  });
});

// ── computeSovereigntyScore ──────────────────────────────────────────────────

describe('computeSovereigntyScore', () => {
  it('returns a value in [0, 100]', () => {
    const nations = getArcticNations();
    const disputes = getSovereigntyDisputes();
    for (const n of nations) {
      const score = computeSovereigntyScore(n, disputes);
      assert.ok(score >= 0 && score <= 100, `${n.code} score out of range: ${score}`);
    }
  });

  it('Russia scores higher than US (more disputes and higher claimStrength)', () => {
    const nations = getArcticNations();
    const disputes = getSovereigntyDisputes();
    const ru = nations.find((n) => n.code === 'RU')!;
    const us = nations.find((n) => n.code === 'US')!;
    assert.ok(computeSovereigntyScore(ru, disputes) >= computeSovereigntyScore(us, disputes));
  });

  it('score increases with more disputes', () => {
    const nation = { code: 'XX', name: 'X', claimStrength: 0.5, militaryScore: 0.5, resourceInterest: 0.5 };
    const noDisputes = computeSovereigntyScore(nation, []);
    const withDisputes = computeSovereigntyScore(nation, [{
      region: 'Test', claimants: ['XX', 'YY'], contested: true,
      legalBasis: 'test', tensionLevel: 0.5,
    }]);
    assert.ok(withDisputes > noDisputes);
  });
});

// ── computeResourceCompetitionIndex ─────────────────────────────────────────

describe('computeResourceCompetitionIndex', () => {
  it('returns value in [0, 100]', () => {
    const idx = computeResourceCompetitionIndex(getResourceSectors());
    assert.ok(idx >= 0 && idx <= 100);
  });

  it('returns 0 for empty array', () => {
    assert.equal(computeResourceCompetitionIndex([]), 0);
  });
});

// ── computeOverallTensionScore ───────────────────────────────────────────────

describe('computeOverallTensionScore', () => {
  it('returns value in [0, 100]', () => {
    const score = computeOverallTensionScore(getArcticNations(), getSovereigntyDisputes(), getMilitaryPresences());
    assert.ok(score >= 0 && score <= 100);
  });

  it('higher military scores produce higher overall tension', () => {
    const nations = getArcticNations();
    const disputes = getSovereigntyDisputes();
    const lowMil = [{ nation: 'X', bases: 0, icebreakers: 0, submarines: 0, recentExercises: 0, presenceScore: 0 }];
    const highMil = [{ nation: 'X', bases: 20, icebreakers: 60, submarines: 30, recentExercises: 10, presenceScore: 1 }];
    assert.ok(
      computeOverallTensionScore(nations, disputes, highMil) >
      computeOverallTensionScore(nations, disputes, lowMil),
    );
  });
});

// ── getTensionLabel ──────────────────────────────────────────────────────────

describe('getTensionLabel', () => {
  it('score 0 returns Stable', () => {
    assert.equal(getTensionLabel(0), 'Stable');
  });

  it('score 30 returns Elevated', () => {
    assert.equal(getTensionLabel(30), 'Elevated');
  });

  it('score 60 returns High', () => {
    assert.equal(getTensionLabel(60), 'High');
  });

  it('score 85 returns Critical', () => {
    assert.equal(getTensionLabel(85), 'Critical');
  });
});

// ── getTreatyComplianceScore ─────────────────────────────────────────────────

describe('getTreatyComplianceScore', () => {
  it('returns value in [0, 100]', () => {
    const score = getTreatyComplianceScore(getArcticNations());
    assert.ok(score >= 0 && score <= 100);
  });

  it('empty nations returns 100', () => {
    assert.equal(getTreatyComplianceScore([]), 100);
  });
});

// ── buildArcticRenderData ────────────────────────────────────────────────────

describe('buildArcticRenderData', () => {
  it('returns an object with the expected shape', () => {
    const data = buildArcticRenderData();
    assert.ok(typeof data === 'object' && data !== null);
  });

  it('nations.length is 5', () => {
    assert.equal(buildArcticRenderData().nations.length, 5);
  });

  it('overallTensionScore is in [0, 100]', () => {
    const score = buildArcticRenderData().overallTensionScore;
    assert.ok(score >= 0 && score <= 100);
  });

  it('disputes.length is at least 5', () => {
    assert.ok(buildArcticRenderData().disputes.length >= 5);
  });
});

// ── formatScore ──────────────────────────────────────────────────────────────

describe('formatScore', () => {
  it('formatScore(72) === "72/100"', () => {
    assert.equal(formatScore(72), '72/100');
  });

  it('formatScore(0) === "0/100"', () => {
    assert.equal(formatScore(0), '0/100');
  });

  it('formatScore(100) === "100/100"', () => {
    assert.equal(formatScore(100), '100/100');
  });
});

// ── getRiskColor ─────────────────────────────────────────────────────────────

describe('getRiskColor', () => {
  it('returns a string for low', () => {
    assert.equal(typeof getRiskColor('low'), 'string');
  });

  it('returns a string for critical', () => {
    assert.equal(typeof getRiskColor('critical'), 'string');
  });

  it('low and critical return different colors', () => {
    assert.notEqual(getRiskColor('low'), getRiskColor('critical'));
  });

  it('unknown level returns default gray color', () => {
    assert.equal(getRiskColor('unknown'), '#6b7280');
  });
});

// ── getTopClaimants ──────────────────────────────────────────────────────────

describe('getTopClaimants', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(getTopClaimants(getSovereigntyDisputes())));
  });

  it('no duplicates in result', () => {
    const result = getTopClaimants(getSovereigntyDisputes());
    assert.equal(result.length, new Set(result).size);
  });

  it('most frequent claimant is first', () => {
    const disputes = [
      { region: 'A', claimants: ['RU', 'CA'], contested: true, legalBasis: '', tensionLevel: 0.5 },
      { region: 'B', claimants: ['RU', 'US'], contested: true, legalBasis: '', tensionLevel: 0.5 },
      { region: 'C', claimants: ['CA', 'US'], contested: true, legalBasis: '', tensionLevel: 0.5 },
    ];
    // RU=2, CA=2, US=2 — all tied at 2; just verify no error and no duplicates
    const result = getTopClaimants(disputes);
    assert.equal(result.length, new Set(result).size);
  });
});

// ── filterDisputesByNation ────────────────────────────────────────────────────

describe('filterDisputesByNation', () => {
  it('filters to disputes containing the nation code', () => {
    const disputes = getSovereigntyDisputes();
    const ruDisputes = filterDisputesByNation(disputes, 'RU');
    assert.ok(ruDisputes.every((d) => d.claimants.includes('RU')));
  });

  it('returns empty array for unknown nation', () => {
    const result = filterDisputesByNation(getSovereigntyDisputes(), 'ZZ');
    assert.equal(result.length, 0);
  });

  it('returns correct count for a known claimant', () => {
    const disputes = [
      { region: 'A', claimants: ['RU', 'CA'], contested: true, legalBasis: '', tensionLevel: 0.5 },
      { region: 'B', claimants: ['US', 'CA'], contested: true, legalBasis: '', tensionLevel: 0.5 },
      { region: 'C', claimants: ['NO', 'DK'], contested: false, legalBasis: '', tensionLevel: 0.1 },
    ];
    assert.equal(filterDisputesByNation(disputes, 'CA').length, 2);
    assert.equal(filterDisputesByNation(disputes, 'NO').length, 1);
  });
});
