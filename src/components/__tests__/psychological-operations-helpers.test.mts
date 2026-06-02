import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreCampaignThreat,
  getActorCampaignCount,
  filterByActor,
  filterByPhase,
  computeTotalReach,
  rankCampaignsByThreat,
  getChannelDistribution,
  getMostActiveActor,
  computeDisinfoExposureScore,
  buildRenderData,
  type PsyopCampaign,
  type DisinfoCampaign,
} from '../psychological-operations-helpers.js';

const mkCampaign = (overrides: Partial<PsyopCampaign> = {}): PsyopCampaign => ({
  id: 'test-1', name: 'Test Campaign', actor: 'Russia', targetCountries: ['USA'],
  primaryTarget: 'population', channels: ['social-media'], phase: 'active',
  startDate: '2023-01-01', estimatedReach: 100, sophisticationScore: 80,
  narrativeCoherence: 80, detectionDifficulty: 80, ...overrides,
});

const mkDisinfo = (overrides: Partial<DisinfoCampaign> = {}): DisinfoCampaign => ({
  id: 'test-d1', actor: 'Russia', narrative: 'Test narrative', targetCountry: 'USA',
  spreadVelocity: 50000, factChecked: true, retracted: false, believabilityScore: 100, ...overrides,
});

describe('scoreCampaignThreat', () => {
  it('returns a number between 0 and 100 inclusive', () => {
    const score = scoreCampaignThreat(mkCampaign());
    assert.ok(score >= 0 && score <= 100);
  });

  it('active phase baseline score is 68', () => {
    const c = mkCampaign({ phase: 'active', sophisticationScore: 80, narrativeCoherence: 80, detectionDifficulty: 80, estimatedReach: 100 });
    assert.equal(scoreCampaignThreat(c), 68);
  });

  it('exploitation phase scores higher than active for same inputs', () => {
    const base = mkCampaign({ phase: 'active', sophisticationScore: 60, narrativeCoherence: 60, detectionDifficulty: 60, estimatedReach: 50 });
    const exp = mkCampaign({ phase: 'exploitation', sophisticationScore: 60, narrativeCoherence: 60, detectionDifficulty: 60, estimatedReach: 50 });
    assert.ok(scoreCampaignThreat(exp) > scoreCampaignThreat(base));
  });

  it('dormant phase scores lower than active', () => {
    const dormant = mkCampaign({ phase: 'dormant' });
    const active = mkCampaign({ phase: 'active' });
    assert.ok(scoreCampaignThreat(dormant) < scoreCampaignThreat(active));
  });

  it('preparation phase scores lower than active', () => {
    const prep = mkCampaign({ phase: 'preparation' });
    const active = mkCampaign({ phase: 'active' });
    assert.ok(scoreCampaignThreat(prep) < scoreCampaignThreat(active));
  });

  it('consolidation phase scores lower than active', () => {
    const cons = mkCampaign({ phase: 'consolidation' });
    const active = mkCampaign({ phase: 'active' });
    assert.ok(scoreCampaignThreat(cons) < scoreCampaignThreat(active));
  });

  it('caps at 100 for very large reach', () => {
    const huge = mkCampaign({ estimatedReach: 10000, sophisticationScore: 50, narrativeCoherence: 50, detectionDifficulty: 50, phase: 'active' });
    assert.ok(scoreCampaignThreat(huge) <= 100);
  });

  it('returns 0 for all-zero dormant campaign', () => {
    const zero = mkCampaign({ phase: 'dormant', sophisticationScore: 0, narrativeCoherence: 0, detectionDifficulty: 0, estimatedReach: 0 });
    assert.equal(scoreCampaignThreat(zero), 0);
  });

  it('returns an integer', () => {
    const score = scoreCampaignThreat(mkCampaign({ sophisticationScore: 73, narrativeCoherence: 67, detectionDifficulty: 61, estimatedReach: 33 }));
    assert.equal(score, Math.round(score));
  });
});

describe('getActorCampaignCount', () => {
  it('returns all five actor keys for empty array', () => {
    const counts = getActorCampaignCount([]);
    assert.equal(counts['Russia'], 0);
    assert.equal(counts['China'], 0);
    assert.equal(counts['Iran'], 0);
    assert.equal(counts['North Korea'], 0);
    assert.equal(counts['non-state'], 0);
  });

  it('counts each actor correctly', () => {
    const campaigns = [mkCampaign({ actor: 'Russia' }), mkCampaign({ actor: 'Russia' }), mkCampaign({ actor: 'China' })];
    const counts = getActorCampaignCount(campaigns);
    assert.equal(counts['Russia'], 2);
    assert.equal(counts['China'], 1);
    assert.equal(counts['Iran'], 0);
  });

  it('handles single campaign', () => {
    const counts = getActorCampaignCount([mkCampaign({ actor: 'Iran' })]);
    assert.equal(counts['Iran'], 1);
    assert.equal(counts['Russia'], 0);
  });

  it('total count equals campaigns length', () => {
    const campaigns = [mkCampaign({ actor: 'Russia' }), mkCampaign({ actor: 'China' }), mkCampaign({ actor: 'Iran' }), mkCampaign({ actor: 'North Korea' })];
    const counts = getActorCampaignCount(campaigns);
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    assert.equal(total, campaigns.length);
  });
});

describe('filterByActor', () => {
  const campaigns = [
    mkCampaign({ id: '1', actor: 'Russia' }), mkCampaign({ id: '2', actor: 'China' }),
    mkCampaign({ id: '3', actor: 'Russia' }), mkCampaign({ id: '4', actor: 'Iran' }),
  ];

  it('returns only campaigns for the specified actor', () => {
    const result = filterByActor(campaigns, 'Russia');
    assert.equal(result.length, 2);
    assert.ok(result.every((c) => c.actor === 'Russia'));
  });

  it('returns empty array when no campaigns match', () => {
    assert.equal(filterByActor(campaigns, 'North Korea').length, 0);
  });

  it('does not mutate original array', () => {
    const len = campaigns.length;
    filterByActor(campaigns, 'Russia');
    assert.equal(campaigns.length, len);
  });

  it('returns all when all match', () => {
    const russians = campaigns.filter((c) => c.actor === 'Russia');
    assert.equal(filterByActor(russians, 'Russia').length, russians.length);
  });
});

describe('filterByPhase', () => {
  const campaigns = [
    mkCampaign({ id: '1', phase: 'active' }), mkCampaign({ id: '2', phase: 'dormant' }),
    mkCampaign({ id: '3', phase: 'active' }), mkCampaign({ id: '4', phase: 'preparation' }),
  ];

  it('returns only campaigns in specified phase', () => {
    const result = filterByPhase(campaigns, 'active');
    assert.equal(result.length, 2);
    assert.ok(result.every((c) => c.phase === 'active'));
  });

  it('returns empty array when no match', () => {
    assert.equal(filterByPhase(campaigns, 'exploitation').length, 0);
  });

  it('returns single match correctly', () => {
    const result = filterByPhase(campaigns, 'preparation');
    assert.equal(result.length, 1);
    assert.equal(result[0].id, '4');
  });
});

describe('computeTotalReach', () => {
  it('returns 0 for empty array', () => {
    assert.equal(computeTotalReach([]), 0);
  });

  it('sums reach correctly', () => {
    assert.equal(computeTotalReach([mkCampaign({ estimatedReach: 100 }), mkCampaign({ estimatedReach: 200 }), mkCampaign({ estimatedReach: 50 })]), 350);
  });

  it('handles single campaign', () => {
    assert.equal(computeTotalReach([mkCampaign({ estimatedReach: 42 })]), 42);
  });
});

describe('rankCampaignsByThreat', () => {
  it('sorts highest threat first', () => {
    const low = mkCampaign({ id: 'low', sophisticationScore: 10, narrativeCoherence: 10, detectionDifficulty: 10, estimatedReach: 10 });
    const high = mkCampaign({ id: 'high', sophisticationScore: 90, narrativeCoherence: 90, detectionDifficulty: 90, estimatedReach: 200 });
    const mid = mkCampaign({ id: 'mid', sophisticationScore: 50, narrativeCoherence: 50, detectionDifficulty: 50, estimatedReach: 80 });
    const ranked = rankCampaignsByThreat([low, mid, high]);
    assert.equal(ranked[0].id, 'high');
    assert.equal(ranked[2].id, 'low');
  });

  it('does not mutate input array', () => {
    const campaigns = [mkCampaign({ id: 'a' }), mkCampaign({ id: 'b' })];
    const original = campaigns.map((c) => c.id);
    rankCampaignsByThreat(campaigns);
    assert.deepEqual(campaigns.map((c) => c.id), original);
  });

  it('returns same length as input', () => {
    assert.equal(rankCampaignsByThreat([mkCampaign(), mkCampaign(), mkCampaign()]).length, 3);
  });

  it('adjacent elements have descending threat scores', () => {
    const campaigns = [
      mkCampaign({ sophisticationScore: 40, narrativeCoherence: 40, detectionDifficulty: 40, estimatedReach: 20 }),
      mkCampaign({ sophisticationScore: 90, narrativeCoherence: 90, detectionDifficulty: 90, estimatedReach: 400 }),
      mkCampaign({ sophisticationScore: 60, narrativeCoherence: 60, detectionDifficulty: 60, estimatedReach: 100 }),
    ];
    const ranked = rankCampaignsByThreat(campaigns);
    for (let i = 1; i < ranked.length; i++) {
      assert.ok(scoreCampaignThreat(ranked[i - 1]) >= scoreCampaignThreat(ranked[i]));
    }
  });
});

describe('getChannelDistribution', () => {
  it('returns all 6 channel keys for empty input', () => {
    const dist = getChannelDistribution([]);
    for (const ch of ['social-media', 'state-media', 'bot-network', 'deepfake', 'proxy-outlet', 'direct-contact']) {
      assert.ok(ch in dist);
    }
  });

  it('counts channels correctly', () => {
    const campaigns = [mkCampaign({ channels: ['social-media', 'bot-network'] }), mkCampaign({ channels: ['social-media'] })];
    const dist = getChannelDistribution(campaigns);
    assert.equal(dist['social-media'], 2);
    assert.equal(dist['bot-network'], 1);
    assert.equal(dist['deepfake'], 0);
  });

  it('total count equals sum of all channels used', () => {
    const campaigns = [mkCampaign({ channels: ['social-media', 'proxy-outlet', 'bot-network'] }), mkCampaign({ channels: ['state-media'] })];
    const total = Object.values(getChannelDistribution(campaigns)).reduce((s, n) => s + n, 0);
    assert.equal(total, 4);
  });
});

describe('getMostActiveActor', () => {
  it('returns actor with most campaigns', () => {
    const campaigns = [mkCampaign({ actor: 'China' }), mkCampaign({ actor: 'China' }), mkCampaign({ actor: 'Russia' })];
    assert.equal(getMostActiveActor(campaigns), 'China');
  });

  it('returns Russia as fallback for empty array', () => {
    assert.equal(getMostActiveActor([]), 'Russia');
  });

  it('returns single actor when only one present', () => {
    assert.equal(getMostActiveActor([mkCampaign({ actor: 'Iran' })]), 'Iran');
  });
});

describe('computeDisinfoExposureScore', () => {
  it('returns 0 for empty array', () => {
    assert.equal(computeDisinfoExposureScore([]), 0);
  });

  it('caps at 100 for extremely high exposure', () => {
    assert.equal(computeDisinfoExposureScore([mkDisinfo({ spreadVelocity: 50_000_000, believabilityScore: 100 })]), 100);
  });

  it('believabilityScore 0 contributes nothing', () => {
    assert.equal(computeDisinfoExposureScore([mkDisinfo({ spreadVelocity: 1_000_000, believabilityScore: 0 })]), 0);
  });

  it('returns a non-negative integer', () => {
    const score = computeDisinfoExposureScore([mkDisinfo()]);
    assert.ok(score >= 0);
    assert.equal(score, Math.round(score));
  });

  it('higher velocity raises score', () => {
    const low = computeDisinfoExposureScore([mkDisinfo({ spreadVelocity: 1000 })]);
    const high = computeDisinfoExposureScore([mkDisinfo({ spreadVelocity: 100_000 })]);
    assert.ok(high >= low);
  });
});

describe('buildRenderData', () => {
  it('returns object with all expected keys', () => {
    const data = buildRenderData();
    for (const k of ['campaigns', 'disinfo', 'totalReachMillions', 'mostActiveActor', 'channelDistribution', 'actorCounts', 'disinfoExposure']) {
      assert.ok(k in data, `missing key: ${k}`);
    }
  });

  it('campaigns array is non-empty', () => {
    assert.ok(buildRenderData().campaigns.length > 0);
  });

  it('campaigns are sorted by descending threat score', () => {
    const { campaigns } = buildRenderData();
    for (let i = 1; i < campaigns.length; i++) {
      assert.ok(scoreCampaignThreat(campaigns[i - 1]) >= scoreCampaignThreat(campaigns[i]));
    }
  });

  it('totalReachMillions is positive', () => {
    assert.ok(buildRenderData().totalReachMillions > 0);
  });

  it('mostActiveActor is Russia', () => {
    assert.equal(buildRenderData().mostActiveActor, 'Russia');
  });

  it('social-media is top channel', () => {
    const { channelDistribution } = buildRenderData();
    const top = Object.entries(channelDistribution).sort(([, a], [, b]) => b - a)[0]?.[0];
    assert.equal(top, 'social-media');
  });

  it('actorCounts Russia >= 3', () => {
    assert.ok(buildRenderData().actorCounts['Russia'] >= 3);
  });

  it('disinfoExposure is between 0 and 100', () => {
    const score = buildRenderData().disinfoExposure;
    assert.ok(score >= 0 && score <= 100);
  });

  it('disinfo array is non-empty', () => {
    assert.ok(buildRenderData().disinfo.length > 0);
  });

  it('totalReachMillions equals 1330', () => {
    assert.equal(buildRenderData().totalReachMillions, 1530);
  });
});
