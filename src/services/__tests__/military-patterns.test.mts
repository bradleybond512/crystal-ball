import assert from 'node:assert/strict';
import test from 'node:test';
import { matchPatterns, CONFLICT_PATTERNS } from '../military-patterns.ts';
import type { TheaterPostureSummary } from '../military-surge.ts';

function makePosture(overrides: Partial<TheaterPostureSummary> = {}): TheaterPostureSummary {
  return {
    // Use a theater NOT in THEATER_CALIBRATIONS so these tests exercise base
    // pattern-matching logic (DEFAULT_CALIBRATION: 1× minAircraft, no penalty).
    // 'iran-theater' carries a 1.8× minAircraft multiplier + score penalty that
    // these modest fixtures (10-18 aircraft) are not sized to clear.
    theaterId: 'test-theater',
    theaterName: 'Test Theater',
    shortName: 'TEST',
    targetNation: 'Testland',
    fighters: 0,
    tankers: 0,
    awacs: 0,
    reconnaissance: 0,
    transport: 0,
    bombers: 0,
    drones: 0,
    totalAircraft: 0,
    destroyers: 0,
    frigates: 0,
    carriers: 0,
    submarines: 0,
    patrol: 0,
    auxiliaryVessels: 0,
    totalVessels: 0,
    byOperator: {},
    postureLevel: 'normal',
    strikeCapable: false,
    trend: 'stable',
    changePercent: 0,
    summary: '',
    headline: '',
    centerLat: 27,
    centerLon: 51,
    ...overrides,
  };
}

test('returns empty array when aircraft below minimum', () => {
  const posture = makePosture({ totalAircraft: 2, fighters: 2 });
  const matches = matchPatterns(posture);
  assert.equal(matches.length, 0);
});

test('matches air campaign pattern with fighter-heavy posture', () => {
  const posture = makePosture({
    totalAircraft: 12,
    fighters: 8,
    tankers: 2,
    awacs: 1,
    transport: 1,
    strikeCapable: true,
    byOperator: { usaf: 12 },
  });
  const matches = matchPatterns(posture);
  const airCampaign = matches.find(m => m.patternId === 'air-campaign');
  assert.ok(airCampaign, 'should match air campaign');
  assert.ok(airCampaign.matchScore >= 60, `score ${airCampaign.matchScore} should be >= 60`);
});

test('matches airlift pattern with transport-heavy posture', () => {
  const posture = makePosture({
    totalAircraft: 10,
    transport: 7,
    fighters: 1,
    tankers: 1,
    awacs: 0,
    reconnaissance: 1,
    byOperator: { usaf: 10 },
  });
  const matches = matchPatterns(posture);
  const airlift = matches.find(m => m.patternId === 'airlift-deployment');
  assert.ok(airlift, 'should match airlift/deployment');
  assert.ok(airlift.matchScore >= 60, `score ${airlift.matchScore} should be >= 60`);
});

test('coalition pattern requires multi-operator', () => {
  const posture = makePosture({
    totalAircraft: 16,
    fighters: 6,
    tankers: 3,
    transport: 4,
    awacs: 2,
    reconnaissance: 1,
    strikeCapable: true,
    byOperator: { usaf: 16 },
  });
  const matches = matchPatterns(posture);
  const coalition = matches.find(m => m.patternId === 'desert-storm');
  assert.ok(!coalition || coalition.matchScore < 60, 'single-operator should not match coalition');
});

test('coalition pattern matches with multi-operator', () => {
  const posture = makePosture({
    totalAircraft: 18,
    fighters: 7,
    tankers: 3,
    transport: 5,
    awacs: 2,
    reconnaissance: 1,
    strikeCapable: true,
    byOperator: { usaf: 10, raf: 4, faf: 4 },
  });
  const matches = matchPatterns(posture);
  const coalition = matches.find(m => m.patternId === 'desert-storm');
  assert.ok(coalition, 'multi-operator should match coalition');
  assert.ok(coalition.matchScore >= 60, `score ${coalition.matchScore} should be >= 60`);
});

test('rapid reaction requires high surge multiple', () => {
  const posture = makePosture({
    totalAircraft: 6,
    fighters: 3,
    transport: 3,
    byOperator: { usaf: 6 },
  });
  const matches = matchPatterns(posture);
  const rapid = matches.find(m => m.patternId === 'rapid-reaction');
  assert.ok(!rapid || rapid.matchScore < 60, 'no surge data should not match rapid reaction');
});

test('results sorted by score descending', () => {
  const posture = makePosture({
    totalAircraft: 12,
    fighters: 8,
    tankers: 2,
    awacs: 1,
    transport: 1,
    strikeCapable: true,
    byOperator: { usaf: 12 },
  });
  const matches = matchPatterns(posture);
  for (let i = 1; i < matches.length; i++) {
    assert.ok(matches[i - 1]!.matchScore >= matches[i]!.matchScore, 'should be sorted descending');
  }
});

test('CONFLICT_PATTERNS has 6 entries', () => {
  assert.equal(CONFLICT_PATTERNS.length, 6);
});
