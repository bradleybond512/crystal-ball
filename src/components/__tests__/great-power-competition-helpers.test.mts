import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreMilitaryPower,
  scoreEconomicDominance,
  scoreDiplomaticReach,
  scoreTechLeadership,
  scoreInfoWarfare,
  buildCompositeIndex,
  calculateDomainBalance,
  classifyTrend,
  getMockActorData,
  buildRenderData,
} from '../great-power-competition-helpers.js';

// ── scoreMilitaryPower ────────────────────────────────────────────────────────

describe('scoreMilitaryPower', () => {
  it('returns average of four sub-scores', () => {
    const score = scoreMilitaryPower({ forceProjection: 80, nuclearPosture: 60, cyberCapability: 40, spaceAssets: 20 });
    assert.equal(score, 50);
  });

  it('returns 100 when all inputs are 100', () => {
    const score = scoreMilitaryPower({ forceProjection: 100, nuclearPosture: 100, cyberCapability: 100, spaceAssets: 100 });
    assert.equal(score, 100);
  });

  it('returns 0 when all inputs are 0', () => {
    const score = scoreMilitaryPower({ forceProjection: 0, nuclearPosture: 0, cyberCapability: 0, spaceAssets: 0 });
    assert.equal(score, 0);
  });

  it('handles mid-range values correctly', () => {
    const score = scoreMilitaryPower({ forceProjection: 50, nuclearPosture: 50, cyberCapability: 50, spaceAssets: 50 });
    assert.equal(score, 50);
  });
});

// ── scoreEconomicDominance ────────────────────────────────────────────────────

describe('scoreEconomicDominance', () => {
  it('returns average of four sub-scores', () => {
    const score = scoreEconomicDominance({ gdpShare: 100, tradeDominance: 80, techInvestment: 60, sanctionsLeverage: 40 });
    assert.equal(score, 70);
  });

  it('returns 100 when all inputs are 100', () => {
    const score = scoreEconomicDominance({ gdpShare: 100, tradeDominance: 100, techInvestment: 100, sanctionsLeverage: 100 });
    assert.equal(score, 100);
  });

  it('returns 0 when all inputs are 0', () => {
    const score = scoreEconomicDominance({ gdpShare: 0, tradeDominance: 0, techInvestment: 0, sanctionsLeverage: 0 });
    assert.equal(score, 0);
  });

  it('handles asymmetric inputs', () => {
    const score = scoreEconomicDominance({ gdpShare: 90, tradeDominance: 10, techInvestment: 50, sanctionsLeverage: 50 });
    assert.equal(score, 50);
  });
});

// ── scoreDiplomaticReach ──────────────────────────────────────────────────────

describe('scoreDiplomaticReach', () => {
  it('returns average of three sub-scores', () => {
    const score = scoreDiplomaticReach({ allianceCount: 90, unVotingAlignment: 60, softPowerIndex: 30 });
    assert.equal(score, 60);
  });

  it('returns 100 when all inputs are 100', () => {
    const score = scoreDiplomaticReach({ allianceCount: 100, unVotingAlignment: 100, softPowerIndex: 100 });
    assert.equal(score, 100);
  });

  it('returns 0 when all inputs are 0', () => {
    const score = scoreDiplomaticReach({ allianceCount: 0, unVotingAlignment: 0, softPowerIndex: 0 });
    assert.equal(score, 0);
  });
});

// ── scoreTechLeadership ───────────────────────────────────────────────────────

describe('scoreTechLeadership', () => {
  it('returns average of three sub-scores', () => {
    const score = scoreTechLeadership({ aiChipLeadership: 90, fiveGDeployment: 60, spacePrograms: 30 });
    assert.equal(score, 60);
  });

  it('returns 100 when all inputs are 100', () => {
    const score = scoreTechLeadership({ aiChipLeadership: 100, fiveGDeployment: 100, spacePrograms: 100 });
    assert.equal(score, 100);
  });

  it('returns 0 when all inputs are 0', () => {
    const score = scoreTechLeadership({ aiChipLeadership: 0, fiveGDeployment: 0, spacePrograms: 0 });
    assert.equal(score, 0);
  });
});

// ── scoreInfoWarfare ──────────────────────────────────────────────────────────

describe('scoreInfoWarfare', () => {
  it('returns average of three sub-scores', () => {
    const score = scoreInfoWarfare({ mediaReach: 60, disinformationCapability: 90, narrativeDominance: 30 });
    assert.equal(score, 60);
  });

  it('returns 100 when all inputs are 100', () => {
    const score = scoreInfoWarfare({ mediaReach: 100, disinformationCapability: 100, narrativeDominance: 100 });
    assert.equal(score, 100);
  });

  it('returns 0 when all inputs are 0', () => {
    const score = scoreInfoWarfare({ mediaReach: 0, disinformationCapability: 0, narrativeDominance: 0 });
    assert.equal(score, 0);
  });
});

// ── buildCompositeIndex ───────────────────────────────────────────────────────

describe('buildCompositeIndex', () => {
  it('returns weighted average with default weights', () => {
    const score = buildCompositeIndex(100, 100, 100, 100, 100);
    assert.ok(Math.abs(score - 100) < 0.001, `Expected ~100, got ${score}`);
  });

  it('returns 0 when all domain scores are 0', () => {
    const score = buildCompositeIndex(0, 0, 0, 0, 0);
    assert.equal(score, 0);
  });

  it('respects custom weights', () => {
    // 100% military weight → composite = military score
    const score = buildCompositeIndex(80, 0, 0, 0, 0, { military: 1, economic: 0, diplomatic: 0, tech: 0, info: 0 });
    assert.ok(Math.abs(score - 80) < 0.001, `Expected 80, got ${score}`);
  });

  it('normalizes weights that do not sum to 1', () => {
    // Both weights 2 → they are equal → composite = average of the two non-zero scores
    const score = buildCompositeIndex(60, 40, 0, 0, 0, { military: 2, economic: 2, diplomatic: 0, tech: 0, info: 0 });
    assert.ok(Math.abs(score - 50) < 0.001, `Expected 50, got ${score}`);
  });

  it('handles boundary value of 50 for all domains', () => {
    const score = buildCompositeIndex(50, 50, 50, 50, 50);
    assert.ok(Math.abs(score - 50) < 0.001, `Expected ~50, got ${score}`);
  });
});

// ── calculateDomainBalance ────────────────────────────────────────────────────

describe('calculateDomainBalance', () => {
  it('correctly identifies the leader', () => {
    const balance = calculateDomainBalance({ US: 90, China: 75, Russia: 50, EU: 70 });
    assert.equal(balance.leader, 'US');
  });

  it('correctly calculates gap between 1st and 2nd', () => {
    const balance = calculateDomainBalance({ US: 90, China: 75, Russia: 50, EU: 70 });
    assert.equal(balance.gap, 15);
  });

  it('returns rankings sorted descending', () => {
    const balance = calculateDomainBalance({ US: 90, China: 75, Russia: 50, EU: 70 });
    const scores = balance.rankings.map((r) => r.score);
    assert.deepEqual(scores, [90, 75, 70, 50]);
  });

  it('handles single actor', () => {
    const balance = calculateDomainBalance({ US: 80 });
    assert.equal(balance.leader, 'US');
    assert.equal(balance.gap, 0);
    assert.equal(balance.rankings.length, 1);
  });

  it('handles tied scores (gap is 0)', () => {
    const balance = calculateDomainBalance({ US: 80, China: 80 });
    assert.equal(balance.gap, 0);
  });

  it('returns empty result for empty input', () => {
    const balance = calculateDomainBalance({});
    assert.equal(balance.leader, '');
    assert.equal(balance.gap, 0);
    assert.equal(balance.rankings.length, 0);
  });
});

// ── classifyTrend ─────────────────────────────────────────────────────────────

describe('classifyTrend', () => {
  it('returns rising when current > previous by more than 2', () => {
    assert.equal(classifyTrend(80, 75), 'rising');
  });

  it('returns falling when current < previous by more than 2', () => {
    assert.equal(classifyTrend(70, 75), 'falling');
  });

  it('returns stable when difference is exactly 2', () => {
    assert.equal(classifyTrend(77, 75), 'stable');
  });

  it('returns stable when difference is exactly -2', () => {
    assert.equal(classifyTrend(73, 75), 'stable');
  });

  it('returns stable when values are identical', () => {
    assert.equal(classifyTrend(75, 75), 'stable');
  });

  it('returns rising just above threshold (2.001)', () => {
    assert.equal(classifyTrend(77.1, 75), 'rising');
  });

  it('returns falling just below threshold (-2.001)', () => {
    assert.equal(classifyTrend(72.9, 75), 'falling');
  });
});

// ── getMockActorData ──────────────────────────────────────────────────────────

describe('getMockActorData', () => {
  const data = getMockActorData();

  it('returns all four actors', () => {
    const names = Object.keys(data.actors);
    assert.ok(names.includes('US'));
    assert.ok(names.includes('China'));
    assert.ok(names.includes('Russia'));
    assert.ok(names.includes('EU'));
  });

  it('all domains are populated for each actor', () => {
    for (const [name, actor] of Object.entries(data.actors)) {
      assert.ok(actor.military, `${name} missing military`);
      assert.ok(actor.economic, `${name} missing economic`);
      assert.ok(actor.diplomatic, `${name} missing diplomatic`);
      assert.ok(actor.tech, `${name} missing tech`);
      assert.ok(actor.info, `${name} missing info`);
    }
  });

  it('all military sub-scores are in 0-100 range', () => {
    for (const [name, actor] of Object.entries(data.actors)) {
      for (const [key, val] of Object.entries(actor.military)) {
        assert.ok(val >= 0 && val <= 100, `${name}.military.${key} = ${val} out of range`);
      }
    }
  });

  it('all economic sub-scores are in 0-100 range', () => {
    for (const [name, actor] of Object.entries(data.actors)) {
      for (const [key, val] of Object.entries(actor.economic)) {
        assert.ok(val >= 0 && val <= 100, `${name}.economic.${key} = ${val} out of range`);
      }
    }
  });

  it('US has stronger military than Russia economically (by design)', () => {
    const usEco = data.actors['US']!.economic.gdpShare;
    const ruEco = data.actors['Russia']!.economic.gdpShare;
    assert.ok(usEco > ruEco, 'US gdpShare should exceed Russia');
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  const actorDataSet = getMockActorData();
  const renderData = buildRenderData(actorDataSet);

  it('returns all four actors', () => {
    assert.equal(renderData.actors.length, 4);
  });

  it('all five domains are present on each actor profile', () => {
    for (const actor of renderData.actors) {
      assert.ok('military' in actor.domains, `${actor.name} missing military domain`);
      assert.ok('economic' in actor.domains, `${actor.name} missing economic domain`);
      assert.ok('diplomatic' in actor.domains, `${actor.name} missing diplomatic domain`);
      assert.ok('tech' in actor.domains, `${actor.name} missing tech domain`);
      assert.ok('info' in actor.domains, `${actor.name} missing info domain`);
    }
  });

  it('trend directions are valid TrendDirection values', () => {
    const valid = new Set(['rising', 'falling', 'stable']);
    for (const actor of renderData.actors) {
      for (const [domain, ds] of Object.entries(actor.domains)) {
        assert.ok(valid.has(ds.trend), `${actor.name}.${domain} has invalid trend: ${ds.trend}`);
      }
    }
  });

  it('composite scores are between 0 and 100', () => {
    for (const actor of renderData.actors) {
      assert.ok(actor.composite >= 0 && actor.composite <= 100, `${actor.name} composite ${actor.composite} out of range`);
    }
  });

  it('actors are sorted by composite descending', () => {
    const composites = renderData.actors.map((a) => a.composite);
    for (let i = 1; i < composites.length; i++) {
      assert.ok(
        composites[i - 1]! >= composites[i]!,
        `Actors not sorted: index ${i - 1} (${composites[i - 1]}) < index ${i} (${composites[i]})`,
      );
    }
  });

  it('domainBalances has an entry for each of the five domains', () => {
    const domains = ['military', 'economic', 'diplomatic', 'tech', 'info'];
    for (const d of domains) {
      assert.ok(d in renderData.domainBalances, `Missing domainBalance for ${d}`);
    }
  });

  it('updatedAt is a valid ISO date string', () => {
    const parsed = new Date(renderData.updatedAt);
    assert.ok(!isNaN(parsed.getTime()), `updatedAt is not a valid date: ${renderData.updatedAt}`);
  });

  it('handles empty actor set gracefully', () => {
    const empty = buildRenderData({ actors: {} });
    assert.equal(empty.actors.length, 0);
  });
});
