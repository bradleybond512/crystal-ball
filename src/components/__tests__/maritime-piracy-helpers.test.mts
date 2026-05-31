import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  computeGlobalPiracyIndex,
  getHighSeverity,
  getIncreasingRegions,
  getByAttackType,
  severityClass,
  trendClass,
  attackTypeClass,
  buildRenderData,
  type PiracyHotspot,
  type PiracyIncident,
  type SeverityLevel,
  type PiracyTrend,
  type AttackType,
} from '../maritime-piracy-helpers.ts';

// -- Mock data --

const MOCK_HOTSPOTS: PiracyHotspot[] = [
  { id: 'H1', region: 'Alpha Waters', annualIncidents: 60, trend: 'increasing', primaryTactics: ['Missiles'], severityLevel: 'Critical', primaryGroups: ['Group A'], description: 'Desc A', economicImpactBn: 10.0 },
  { id: 'H2', region: 'Beta Gulf', annualIncidents: 80, trend: 'stable', primaryTactics: ['Boarding'], severityLevel: 'High', primaryGroups: ['Group B'], description: 'Desc B', economicImpactBn: 1.2 },
  { id: 'H3', region: 'Gamma Strait', annualIncidents: 40, trend: 'decreasing', primaryTactics: ['Theft'], severityLevel: 'Medium', primaryGroups: ['Group C'], description: 'Desc C', economicImpactBn: 0.4 },
  { id: 'H4', region: 'Delta Bay', annualIncidents: 25, trend: 'stable', primaryTactics: ['Robbery'], severityLevel: 'Low', primaryGroups: ['Group D'], description: 'Desc D', economicImpactBn: 0.2 },
  { id: 'H5', region: 'Epsilon Reef', annualIncidents: 30, trend: 'stable', primaryTactics: ['Bunkering'], severityLevel: 'High', primaryGroups: ['Group E'], description: 'Desc E', economicImpactBn: 1.5 },
];

const MOCK_INCIDENTS: PiracyIncident[] = [
  { id: 'I1', date: '2023-11-19', region: 'Alpha Waters', shipType: 'Car Carrier', attackType: 'Hijacking', outcome: 'Hijacked', description: 'Seized', significance: 9 },
  { id: 'I2', date: '2024-03-06', region: 'Alpha Waters', shipType: 'Bulk Carrier', attackType: 'Fired Upon', outcome: 'Fired Upon', description: 'Struck', significance: 9 },
  { id: 'I3', date: '2023-08-14', region: 'Beta Gulf', shipType: 'Supply Vessel', attackType: 'Kidnapping', outcome: 'Crew Kidnapped', description: 'Abducted', significance: 7 },
  { id: 'I4', date: '2024-02-03', region: 'Gamma Strait', shipType: 'Product Tanker', attackType: 'Boarding', outcome: 'Repelled', description: 'Repelled', significance: 5 },
  { id: 'I5', date: '2023-09-21', region: 'Delta Bay', shipType: 'Bulk Carrier', attackType: 'Attempted Boarding', outcome: 'Repelled', description: 'Failed attempt', significance: 4 },
  { id: 'I6', date: '2023-06-05', region: 'Epsilon Reef', shipType: 'Tanker', attackType: 'Armed Robbery', outcome: 'Hijacked', description: 'Bunkering op', significance: 8 },
];

// -- computeGlobalPiracyIndex --

describe('computeGlobalPiracyIndex', () => {
  it('returns 0 for empty array', () => {
    assert.equal(computeGlobalPiracyIndex([]), 0);
  });
  it('returns a number between 0 and 100', () => {
    const idx = computeGlobalPiracyIndex(MOCK_HOTSPOTS);
    assert.ok(idx >= 0 && idx <= 100);
  });
  it('Critical hotspot yields higher index than Low', () => {
    const hi = [{ ...MOCK_HOTSPOTS[0], severityLevel: 'Critical' as SeverityLevel, trend: 'stable' as PiracyTrend }];
    const lo = [{ ...MOCK_HOTSPOTS[0], severityLevel: 'Low' as SeverityLevel, trend: 'stable' as PiracyTrend }];
    assert.ok(computeGlobalPiracyIndex(hi) > computeGlobalPiracyIndex(lo));
  });
  it('increasing trend yields higher index than decreasing', () => {
    const up = [{ ...MOCK_HOTSPOTS[0], severityLevel: 'Medium' as SeverityLevel, trend: 'increasing' as PiracyTrend }];
    const dn = [{ ...MOCK_HOTSPOTS[0], severityLevel: 'Medium' as SeverityLevel, trend: 'decreasing' as PiracyTrend }];
    assert.ok(computeGlobalPiracyIndex(up) > computeGlobalPiracyIndex(dn));
  });
  it('returns an integer', () => {
    const idx = computeGlobalPiracyIndex(MOCK_HOTSPOTS);
    assert.equal(idx, Math.round(idx));
  });
  it('single Critical+increasing hotspot caps at 100', () => {
    const hot = [{ ...MOCK_HOTSPOTS[0], severityLevel: 'Critical' as SeverityLevel, trend: 'increasing' as PiracyTrend }];
    assert.equal(computeGlobalPiracyIndex(hot), 100);
  });
  it('single Low+decreasing hotspot returns 10', () => {
    const cool = [{ ...MOCK_HOTSPOTS[0], severityLevel: 'Low' as SeverityLevel, trend: 'decreasing' as PiracyTrend }];
    assert.equal(computeGlobalPiracyIndex(cool), 10);
  });
  it('real data produces expected index of 54', () => {
    assert.equal(buildRenderData().globalPiracyIndex, 54);
  });
});

// -- getHighSeverity --

describe('getHighSeverity', () => {
  it('returns Critical and High hotspots', () => {
    const hs = getHighSeverity(MOCK_HOTSPOTS);
    assert.ok(hs.every(h => h.severityLevel === 'Critical' || h.severityLevel === 'High'));
  });
  it('returns 3 from mock data (H1 Critical, H2 High, H5 High)', () => {
    assert.equal(getHighSeverity(MOCK_HOTSPOTS).length, 3);
  });
  it('excludes Medium hotspots', () => {
    const hs = getHighSeverity(MOCK_HOTSPOTS);
    assert.ok(!hs.some(h => h.severityLevel === 'Medium'));
  });
  it('excludes Low hotspots', () => {
    const hs = getHighSeverity(MOCK_HOTSPOTS);
    assert.ok(!hs.some(h => h.severityLevel === 'Low'));
  });
  it('returns empty when all are Low/Medium', () => {
    const all = MOCK_HOTSPOTS.map(h => ({ ...h, severityLevel: 'Low' as SeverityLevel }));
    assert.equal(getHighSeverity(all).length, 0);
  });
  it('does not mutate input array', () => {
    const before = MOCK_HOTSPOTS.length;
    getHighSeverity(MOCK_HOTSPOTS);
    assert.equal(MOCK_HOTSPOTS.length, before);
  });
  it('real data: highRiskRegions has 3 entries', () => {
    assert.equal(buildRenderData().highRiskRegions.length, 3);
  });
});

// -- getIncreasingRegions --

describe('getIncreasingRegions', () => {
  it('returns only increasing hotspots', () => {
    const inc = getIncreasingRegions(MOCK_HOTSPOTS);
    assert.ok(inc.every(h => h.trend === 'increasing'));
  });
  it('returns 1 from mock data (H1)', () => {
    assert.equal(getIncreasingRegions(MOCK_HOTSPOTS).length, 1);
    assert.equal(getIncreasingRegions(MOCK_HOTSPOTS)[0].id, 'H1');
  });
  it('returns empty when none are increasing', () => {
    const none = MOCK_HOTSPOTS.map(h => ({ ...h, trend: 'stable' as PiracyTrend }));
    assert.equal(getIncreasingRegions(none).length, 0);
  });
  it('returns all when all are increasing', () => {
    const all = MOCK_HOTSPOTS.map(h => ({ ...h, trend: 'increasing' as PiracyTrend }));
    assert.equal(getIncreasingRegions(all).length, MOCK_HOTSPOTS.length);
  });
  it('does not mutate input', () => {
    const origIds = MOCK_HOTSPOTS.map(h => h.id);
    getIncreasingRegions(MOCK_HOTSPOTS);
    assert.deepEqual(MOCK_HOTSPOTS.map(h => h.id), origIds);
  });
  it('real data: exactly 1 increasing region (Red Sea)', () => {
    const inc = getIncreasingRegions(buildRenderData().hotspots);
    assert.equal(inc.length, 1);
    assert.equal(inc[0].id, 'H001');
  });
});

// -- getByAttackType --

describe('getByAttackType', () => {
  it('returns Hijacking incidents', () => {
    const h = getByAttackType(MOCK_INCIDENTS, 'Hijacking');
    assert.equal(h.length, 1);
    assert.equal(h[0].id, 'I1');
  });
  it('returns Fired Upon incidents', () => {
    const h = getByAttackType(MOCK_INCIDENTS, 'Fired Upon');
    assert.equal(h.length, 1);
    assert.equal(h[0].id, 'I2');
  });
  it('returns Kidnapping incidents', () => {
    const h = getByAttackType(MOCK_INCIDENTS, 'Kidnapping');
    assert.equal(h.length, 1);
    assert.equal(h[0].id, 'I3');
  });
  it('returns Boarding incidents', () => {
    const h = getByAttackType(MOCK_INCIDENTS, 'Boarding');
    assert.equal(h.length, 1);
    assert.equal(h[0].id, 'I4');
  });
  it('returns Attempted Boarding incidents', () => {
    const h = getByAttackType(MOCK_INCIDENTS, 'Attempted Boarding');
    assert.equal(h.length, 1);
    assert.equal(h[0].id, 'I5');
  });
  it('returns Armed Robbery incidents', () => {
    const h = getByAttackType(MOCK_INCIDENTS, 'Armed Robbery');
    assert.equal(h.length, 1);
    assert.equal(h[0].id, 'I6');
  });
  it('returns empty when type has no matches', () => {
    const none = MOCK_INCIDENTS.map(i => ({ ...i, attackType: 'Boarding' as AttackType }));
    assert.equal(getByAttackType(none, 'Hijacking').length, 0);
  });
  it('does not mutate input', () => {
    const before = MOCK_INCIDENTS.length;
    getByAttackType(MOCK_INCIDENTS, 'Hijacking');
    assert.equal(MOCK_INCIDENTS.length, before);
  });
  it('real data: 2 Kidnapping incidents', () => {
    assert.equal(getByAttackType(buildRenderData().incidents, 'Kidnapping').length, 2);
  });
  it('real data: 2 Fired Upon incidents', () => {
    assert.equal(getByAttackType(buildRenderData().incidents, 'Fired Upon').length, 2);
  });
  it('real data: 2 Hijacking incidents', () => {
    assert.equal(getByAttackType(buildRenderData().incidents, 'Hijacking').length, 2);
  });
});

// -- severityClass --

describe('severityClass', () => {
  it('Low -> sev-low', () => { assert.equal(severityClass('Low'), 'sev-low'); });
  it('Medium -> sev-medium', () => { assert.equal(severityClass('Medium'), 'sev-medium'); });
  it('High -> sev-high', () => { assert.equal(severityClass('High'), 'sev-high'); });
  it('Critical -> sev-critical', () => { assert.equal(severityClass('Critical'), 'sev-critical'); });
});

// -- trendClass --

describe('trendClass', () => {
  it('increasing -> trend-up', () => { assert.equal(trendClass('increasing'), 'trend-up'); });
  it('stable -> trend-flat', () => { assert.equal(trendClass('stable'), 'trend-flat'); });
  it('decreasing -> trend-down', () => { assert.equal(trendClass('decreasing'), 'trend-down'); });
});

// -- attackTypeClass --

describe('attackTypeClass', () => {
  it('Boarding -> attack-boarding', () => { assert.equal(attackTypeClass('Boarding'), 'attack-boarding'); });
  it('Hijacking -> attack-hijacking', () => { assert.equal(attackTypeClass('Hijacking'), 'attack-hijacking'); });
  it('Attempted Boarding -> attack-attempted', () => { assert.equal(attackTypeClass('Attempted Boarding'), 'attack-attempted'); });
  it('Fired Upon -> attack-fired', () => { assert.equal(attackTypeClass('Fired Upon'), 'attack-fired'); });
  it('Kidnapping -> attack-kidnapping', () => { assert.equal(attackTypeClass('Kidnapping'), 'attack-kidnapping'); });
  it('Armed Robbery -> attack-robbery', () => { assert.equal(attackTypeClass('Armed Robbery'), 'attack-robbery'); });
});

// -- buildRenderData --

describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.hotspots));
    assert.ok(Array.isArray(d.incidents));
    assert.equal(typeof d.globalPiracyIndex, 'number');
    assert.equal(typeof d.totalIncidentsYTD, 'number');
    assert.ok(Array.isArray(d.highRiskRegions));
    assert.equal(typeof d.crewsAtRisk, 'number');
  });
  it('hotspots array is non-empty', () => { assert.ok(buildRenderData().hotspots.length > 0); });
  it('incidents array is non-empty', () => { assert.ok(buildRenderData().incidents.length > 0); });
  it('has exactly 7 hotspots', () => { assert.equal(buildRenderData().hotspots.length, 7); });
  it('has exactly 10 incidents', () => { assert.equal(buildRenderData().incidents.length, 10); });
  it('globalPiracyIndex is in range 0-100', () => {
    const idx = buildRenderData().globalPiracyIndex;
    assert.ok(idx >= 0 && idx <= 100, 'Index ' + idx + ' out of range');
  });
  it('totalIncidentsYTD equals sum of annualIncidents', () => {
    const d = buildRenderData();
    const sum = d.hotspots.reduce((s, h) => s + h.annualIncidents, 0);
    assert.equal(d.totalIncidentsYTD, sum);
  });
  it('totalIncidentsYTD is 270', () => { assert.equal(buildRenderData().totalIncidentsYTD, 270); });
  it('highRiskRegions matches Critical+High hotspot regions', () => {
    const d = buildRenderData();
    const expected = d.hotspots
      .filter(h => h.severityLevel === 'Critical' || h.severityLevel === 'High')
      .map(h => h.region);
    assert.deepEqual(d.highRiskRegions, expected);
  });
  it('crewsAtRisk is positive', () => { assert.ok(buildRenderData().crewsAtRisk > 0); });
  it('crewsAtRisk is 60 (4 Hijacked/Crew Kidnapped incidents * 15)', () => {
    assert.equal(buildRenderData().crewsAtRisk, 60);
  });
  it('all hotspot IDs are unique', () => {
    const ids = buildRenderData().hotspots.map(h => h.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('all incident IDs are unique', () => {
    const ids = buildRenderData().incidents.map(i => i.id);
    assert.equal(new Set(ids).size, ids.length);
  });
  it('all annualIncidents are positive', () => {
    for (const h of buildRenderData().hotspots) {
      assert.ok(h.annualIncidents > 0, h.region + ' has non-positive annualIncidents');
    }
  });
  it('all economicImpactBn are positive', () => {
    for (const h of buildRenderData().hotspots) {
      assert.ok(h.economicImpactBn > 0);
    }
  });
  it('all significance values are in range 1-10', () => {
    for (const i of buildRenderData().incidents) {
      assert.ok(i.significance >= 1 && i.significance <= 10, 'Significance ' + i.significance + ' out of range');
    }
  });
  it('all severity levels are valid', () => {
    const valid = new Set(['Low', 'Medium', 'High', 'Critical']);
    for (const h of buildRenderData().hotspots) {
      assert.ok(valid.has(h.severityLevel), 'Invalid level: ' + h.severityLevel);
    }
  });
  it('all trends are valid', () => {
    const valid = new Set(['increasing', 'stable', 'decreasing']);
    for (const h of buildRenderData().hotspots) {
      assert.ok(valid.has(h.trend), 'Invalid trend: ' + h.trend);
    }
  });
  it('all attack types are valid', () => {
    const valid = new Set(['Boarding', 'Hijacking', 'Attempted Boarding', 'Fired Upon', 'Kidnapping', 'Armed Robbery']);
    for (const i of buildRenderData().incidents) {
      assert.ok(valid.has(i.attackType), 'Invalid type: ' + i.attackType);
    }
  });
  it('all outcomes are valid', () => {
    const valid = new Set(['Hijacked', 'Repelled', 'Crew Kidnapped', 'Escaped', 'Fired Upon']);
    for (const i of buildRenderData().incidents) {
      assert.ok(valid.has(i.outcome), 'Invalid outcome: ' + i.outcome);
    }
  });
  it('all hotspots have non-empty region', () => {
    for (const h of buildRenderData().hotspots) {
      assert.ok(h.region.trim().length > 0);
    }
  });
  it('all hotspots have non-empty description', () => {
    for (const h of buildRenderData().hotspots) {
      assert.ok(h.description.trim().length > 0);
    }
  });
  it('all incidents have non-empty shipType', () => {
    for (const i of buildRenderData().incidents) {
      assert.ok(i.shipType.trim().length > 0);
    }
  });
  it('all incidents have non-empty description', () => {
    for (const i of buildRenderData().incidents) {
      assert.ok(i.description.trim().length > 0);
    }
  });
  it('highRiskRegions is non-empty', () => { assert.ok(buildRenderData().highRiskRegions.length > 0); });
  it('Red Sea is among highRiskRegions (Critical)', () => {
    assert.ok(buildRenderData().highRiskRegions.includes('Red Sea / Gulf of Aden'));
  });
  it('Bangladesh East Coast is NOT in highRiskRegions (Low)', () => {
    assert.ok(!buildRenderData().highRiskRegions.includes('Bangladesh / India East Coast'));
  });
});
