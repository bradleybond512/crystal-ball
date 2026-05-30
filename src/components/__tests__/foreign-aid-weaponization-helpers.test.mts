import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  computeWeaponizationIndex,
  getByDonor,
  getHighImpactEvents,
  getActiveConditionality,
  donorLeverageClass,
  impactClass,
  eventTypeClass,
  getImpactCategory,
  buildRenderData,
  type AidEvent,
  type DonorProfile,
  type LeverageType,
  type AidEventType,
} from '../foreign-aid-weaponization-helpers.ts';

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_EVENTS: AidEvent[] = [
  {
    id: 'M1',
    date: '2025-01-20',
    donor: 'Freedonia',
    recipient: 'Global',
    eventType: 'freeze',
    description: 'Froze all aid.',
    impactScore: 10,
    active: true,
    geopoliticalEffect: 'Major vacuum created.',
    sources: ['EO Jan 2025'],
  },
  {
    id: 'M2',
    date: '2024-04-24',
    donor: 'Freedonia',
    recipient: 'Ruritania',
    eventType: 'condition',
    description: 'Military aid conditioned on elections.',
    amountBillionUSD: 61,
    impactScore: 9,
    active: false,
    geopoliticalEffect: 'NATO allies nervous.',
    sources: ['HR 815'],
  },
  {
    id: 'M3',
    date: '2023-07-01',
    donor: 'Sylvania',
    recipient: 'Borduria',
    eventType: 'condition',
    description: 'Migration control conditionality.',
    amountBillionUSD: 0.105,
    impactScore: 7,
    active: true,
    geopoliticalEffect: 'Human rights norms weakened.',
    sources: ['MoU July 2023'],
  },
  {
    id: 'M4',
    date: '2022-07-22',
    donor: 'Ruritania',
    recipient: 'Global',
    eventType: 'weaponize',
    description: 'Grain deal used as leverage.',
    impactScore: 8,
    active: false,
    geopoliticalEffect: 'Food price spikes.',
    sources: ['UN reports'],
  },
  {
    id: 'M5',
    date: '2021-11-01',
    donor: 'Freedonia',
    recipient: 'Global',
    eventType: 'cut',
    description: 'ODA cut from 0.7% to 0.5% GDP.',
    amountBillionUSD: 4,
    impactScore: 6,
    active: false,
    geopoliticalEffect: 'Soft power decline.',
    sources: ['FCDO stats'],
  },
  {
    id: 'M6',
    date: '2022-01-01',
    donor: 'Sylvania',
    recipient: 'Borduria, Pottsylvania',
    eventType: 'competition',
    description: 'Competing aid in Horn region.',
    amountBillionUSD: 35,
    impactScore: 7,
    active: true,
    geopoliticalEffect: 'Peace process undermined.',
    sources: ['UN Panel report'],
  },
  {
    id: 'M7',
    date: '2023-01-01',
    donor: 'Multilateral Bank',
    recipient: 'Global South',
    eventType: 'reform',
    description: 'Structural adjustment conditionality reform.',
    amountBillionUSD: 3,
    impactScore: 5,
    active: true,
    geopoliticalEffect: 'Opening for alternative financing.',
    sources: ['IMF documents'],
  },
];

const MOCK_DONORS: DonorProfile[] = [
  {
    id: 'D1',
    name: 'Freedonia',
    category: 'Western',
    annualAidBillionUSD: 60,
    leverageTypes: ['military', 'economic'],
    conditionality: 'Democracy and human rights, selectively applied.',
    politicalAlignment: 'NATO allies.',
    keyInstruments: ['USAID', 'MCC'],
    incidentCount: 3,
    trend: 'declining',
  },
  {
    id: 'D2',
    name: 'Sylvania',
    category: 'BRICS',
    annualAidBillionUSD: 85,
    leverageTypes: ['infrastructure', 'diplomatic'],
    conditionality: 'Taiwan non-recognition, UN voting alignment.',
    politicalAlignment: 'Global South.',
    keyInstruments: ['EXIM Bank', 'Silk Road Fund'],
    incidentCount: 2,
    trend: 'escalating',
  },
  {
    id: 'D3',
    name: 'Ruritania',
    category: 'Gulf',
    annualAidBillionUSD: 20,
    leverageTypes: ['economic', 'military'],
    conditionality: 'Political silence, anti-Iran positioning.',
    politicalAlignment: 'Regional proxies.',
    keyInstruments: ['National Fund', 'Investment Authority'],
    incidentCount: 1,
    trend: 'stable',
  },
];

// ── computeWeaponizationIndex ──────────────────────────────────────────────────

describe('computeWeaponizationIndex', () => {
  it('returns 0 for empty array', () => {
    assert.equal(computeWeaponizationIndex([]), 0);
  });

  it('returns a number in range 0-100', () => {
    const idx = computeWeaponizationIndex(MOCK_EVENTS);
    assert.ok(idx >= 0 && idx <= 100, 'index out of range');
  });

  it('returns an integer', () => {
    const idx = computeWeaponizationIndex(MOCK_EVENTS);
    assert.equal(idx, Math.round(idx));
  });

  it('more active high-impact events yield higher index', () => {
    const highActive = Array.from({ length: 8 }, (_, i) => ({
      ...MOCK_EVENTS[0],
      id: 'H' + i,
      active: true,
      impactScore: 9,
    }));
    const lowActive = Array.from({ length: 8 }, (_, i) => ({
      ...MOCK_EVENTS[0],
      id: 'L' + i,
      active: false,
      impactScore: 3,
    }));
    assert.ok(
      computeWeaponizationIndex(highActive) > computeWeaponizationIndex(lowActive),
    );
  });

  it('all inactive events yield lower index than all active', () => {
    const active = MOCK_EVENTS.map(e => ({ ...e, active: true }));
    const inactive = MOCK_EVENTS.map(e => ({ ...e, active: false }));
    assert.ok(computeWeaponizationIndex(active) >= computeWeaponizationIndex(inactive));
  });

  it('caps at 100 with extreme inputs', () => {
    const extreme = Array.from({ length: 20 }, (_, i) => ({
      ...MOCK_EVENTS[0],
      id: 'X' + i,
      active: true,
      impactScore: 10,
    }));
    assert.ok(computeWeaponizationIndex(extreme) <= 100);
  });

  it('single inactive low-impact event yields low index', () => {
    const single = [{ ...MOCK_EVENTS[4], active: false, impactScore: 2 }];
    assert.ok(computeWeaponizationIndex(single) < 50);
  });
});

// ── getByDonor ────────────────────────────────────────────────────────────────

describe('getByDonor', () => {
  it('returns only events from matching donor', () => {
    const result = getByDonor(MOCK_EVENTS, 'Freedonia');
    assert.ok(result.length >= 1);
    assert.ok(result.every(e => e.donor === 'Freedonia'));
  });

  it('returns empty when donor not found', () => {
    assert.equal(getByDonor(MOCK_EVENTS, 'Nonexistentia').length, 0);
  });

  it('is case-sensitive', () => {
    assert.equal(getByDonor(MOCK_EVENTS, 'freedonia').length, 0);
  });

  it('returns multiple when several match', () => {
    const result = getByDonor(MOCK_EVENTS, 'Freedonia');
    assert.ok(result.length >= 2);
  });

  it('does not mutate the input array', () => {
    const before = MOCK_EVENTS.length;
    getByDonor(MOCK_EVENTS, 'Sylvania');
    assert.equal(MOCK_EVENTS.length, before);
  });

  it('all returned events have the requested donor', () => {
    const result = getByDonor(MOCK_EVENTS, 'Sylvania');
    assert.ok(result.every(e => e.donor === 'Sylvania'));
  });

  it('returns empty array (not null/undefined) for missing donor', () => {
    const result = getByDonor(MOCK_EVENTS, 'Nobody');
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });
});

// ── getHighImpactEvents ───────────────────────────────────────────────────────

describe('getHighImpactEvents', () => {
  it('returns events at or above threshold', () => {
    const result = getHighImpactEvents(MOCK_EVENTS, 8);
    assert.ok(result.every(e => e.impactScore >= 8));
  });

  it('uses default threshold of 7', () => {
    const result = getHighImpactEvents(MOCK_EVENTS);
    assert.ok(result.every(e => e.impactScore >= 7));
  });

  it('includes events exactly at threshold', () => {
    const result = getHighImpactEvents(MOCK_EVENTS, 10);
    assert.ok(result.every(e => e.impactScore >= 10));
    assert.ok(result.length >= 1);
  });

  it('returns empty when no events meet threshold', () => {
    const result = getHighImpactEvents(MOCK_EVENTS, 11);
    assert.equal(result.length, 0);
  });

  it('returns all when threshold is 1', () => {
    const result = getHighImpactEvents(MOCK_EVENTS, 1);
    assert.equal(result.length, MOCK_EVENTS.length);
  });

  it('does not mutate input array', () => {
    const before = MOCK_EVENTS.length;
    getHighImpactEvents(MOCK_EVENTS, 5);
    assert.equal(MOCK_EVENTS.length, before);
  });

  it('excludes events below threshold', () => {
    const result = getHighImpactEvents(MOCK_EVENTS, 9);
    assert.ok(result.every(e => e.impactScore >= 9));
    const excluded = MOCK_EVENTS.filter(e => e.impactScore < 9);
    assert.ok(excluded.length > 0, 'test assumes some events below 9');
  });
});

// ── getActiveConditionality ───────────────────────────────────────────────────

describe('getActiveConditionality', () => {
  it('returns only active condition events', () => {
    const result = getActiveConditionality(MOCK_EVENTS);
    assert.ok(result.every(e => e.active && e.eventType === 'condition'));
  });

  it('excludes inactive condition events', () => {
    const result = getActiveConditionality(MOCK_EVENTS);
    const inactiveConditions = MOCK_EVENTS.filter(e => !e.active && e.eventType === 'condition');
    for (const inact of inactiveConditions) {
      assert.ok(!result.some(r => r.id === inact.id));
    }
  });

  it('excludes active non-condition events', () => {
    const result = getActiveConditionality(MOCK_EVENTS);
    const activeNonCondition = MOCK_EVENTS.filter(e => e.active && e.eventType !== 'condition');
    for (const nonCond of activeNonCondition) {
      assert.ok(!result.some(r => r.id === nonCond.id));
    }
  });

  it('returns empty for empty input', () => {
    assert.equal(getActiveConditionality([]).length, 0);
  });

  it('does not mutate input array', () => {
    const before = MOCK_EVENTS.length;
    getActiveConditionality(MOCK_EVENTS);
    assert.equal(MOCK_EVENTS.length, before);
  });
});

// ── donorLeverageClass ────────────────────────────────────────────────────────

describe('donorLeverageClass', () => {
  it('military returns lev-military', () => {
    assert.equal(donorLeverageClass('military'), 'lev-military');
  });

  it('economic returns lev-economic', () => {
    assert.equal(donorLeverageClass('economic'), 'lev-economic');
  });

  it('diplomatic returns lev-diplomatic', () => {
    assert.equal(donorLeverageClass('diplomatic'), 'lev-diplomatic');
  });

  it('infrastructure returns lev-infra', () => {
    assert.equal(donorLeverageClass('infrastructure'), 'lev-infra');
  });

  it('food returns lev-food', () => {
    assert.equal(donorLeverageClass('food'), 'lev-food');
  });

  it('humanitarian returns lev-humanitarian', () => {
    assert.equal(donorLeverageClass('humanitarian'), 'lev-humanitarian');
  });

  it('returns a non-empty string for every valid type', () => {
    const types: LeverageType[] = ['military', 'economic', 'diplomatic', 'infrastructure', 'food', 'humanitarian'];
    for (const t of types) {
      const cls = donorLeverageClass(t);
      assert.ok(cls.length > 0, 'empty class for ' + t);
    }
  });
});

// ── impactClass ───────────────────────────────────────────────────────────────

describe('impactClass', () => {
  it('returns imp-critical for score 10', () => {
    assert.equal(impactClass(10), 'imp-critical');
  });

  it('returns imp-critical for score 9', () => {
    assert.equal(impactClass(9), 'imp-critical');
  });

  it('returns imp-high for score 8', () => {
    assert.equal(impactClass(8), 'imp-high');
  });

  it('returns imp-high for score 7', () => {
    assert.equal(impactClass(7), 'imp-high');
  });

  it('returns imp-medium for score 6', () => {
    assert.equal(impactClass(6), 'imp-medium');
  });

  it('returns imp-medium for score 5', () => {
    assert.equal(impactClass(5), 'imp-medium');
  });

  it('returns imp-low for score 4', () => {
    assert.equal(impactClass(4), 'imp-low');
  });

  it('returns imp-low for score 1', () => {
    assert.equal(impactClass(1), 'imp-low');
  });
});

// ── eventTypeClass ────────────────────────────────────────────────────────────

describe('eventTypeClass', () => {
  it('freeze returns et-freeze', () => {
    assert.equal(eventTypeClass('freeze'), 'et-freeze');
  });

  it('cut returns et-cut', () => {
    assert.equal(eventTypeClass('cut'), 'et-cut');
  });

  it('condition returns et-condition', () => {
    assert.equal(eventTypeClass('condition'), 'et-condition');
  });

  it('redirect returns et-redirect', () => {
    assert.equal(eventTypeClass('redirect'), 'et-redirect');
  });

  it('weaponize returns et-weaponize', () => {
    assert.equal(eventTypeClass('weaponize'), 'et-weaponize');
  });

  it('competition returns et-competition', () => {
    assert.equal(eventTypeClass('competition'), 'et-competition');
  });

  it('reform returns et-reform', () => {
    assert.equal(eventTypeClass('reform'), 'et-reform');
  });

  it('returns a non-empty string for every valid type', () => {
    const types: AidEventType[] = ['freeze', 'cut', 'condition', 'redirect', 'weaponize', 'competition', 'reform'];
    for (const t of types) {
      const cls = eventTypeClass(t);
      assert.ok(cls.length > 0, 'empty class for ' + t);
    }
  });
});

// ── getImpactCategory ─────────────────────────────────────────────────────────

describe('getImpactCategory', () => {
  it('returns Critical for score 10', () => {
    assert.equal(getImpactCategory(10), 'Critical');
  });

  it('returns Critical for score 9', () => {
    assert.equal(getImpactCategory(9), 'Critical');
  });

  it('returns High for score 8', () => {
    assert.equal(getImpactCategory(8), 'High');
  });

  it('returns High for score 7', () => {
    assert.equal(getImpactCategory(7), 'High');
  });

  it('returns Medium for score 6', () => {
    assert.equal(getImpactCategory(6), 'Medium');
  });

  it('returns Medium for score 5', () => {
    assert.equal(getImpactCategory(5), 'Medium');
  });

  it('returns Low for score 4', () => {
    assert.equal(getImpactCategory(4), 'Low');
  });

  it('returns Low for score 1', () => {
    assert.equal(getImpactCategory(1), 'Low');
  });
});

// ── buildRenderData ───────────────────────────────────────────────────────────

describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.events));
    assert.ok(Array.isArray(d.donors));
    assert.equal(typeof d.weaponizationIndex, 'number');
    assert.equal(typeof d.highImpactCount, 'number');
    assert.equal(typeof d.activeConditionCount, 'number');
    assert.ok(Array.isArray(d.topDonors));
    assert.ok(Array.isArray(d.recentEvents));
  });

  it('events array is non-empty', () => {
    assert.ok(buildRenderData().events.length > 0);
  });

  it('donors array is non-empty', () => {
    assert.ok(buildRenderData().donors.length > 0);
  });

  it('weaponizationIndex is in range 0-100', () => {
    const idx = buildRenderData().weaponizationIndex;
    assert.ok(idx >= 0 && idx <= 100, 'index out of range: ' + idx);
  });

  it('weaponizationIndex is an integer', () => {
    const idx = buildRenderData().weaponizationIndex;
    assert.equal(idx, Math.round(idx));
  });

  it('highImpactCount matches events with impactScore >= 7', () => {
    const d = buildRenderData();
    const expected = d.events.filter(e => e.impactScore >= 7).length;
    assert.equal(d.highImpactCount, expected);
  });

  it('activeConditionCount matches active condition events', () => {
    const d = buildRenderData();
    const expected = d.events.filter(e => e.active && e.eventType === 'condition').length;
    assert.equal(d.activeConditionCount, expected);
  });

  it('topDonors is sorted by annualAidBillionUSD descending', () => {
    const td = buildRenderData().topDonors;
    for (let i = 1; i < td.length; i++) {
      assert.ok(td[i - 1].annualAidBillionUSD >= td[i].annualAidBillionUSD);
    }
  });

  it('topDonors has at most 5 entries', () => {
    assert.ok(buildRenderData().topDonors.length <= 5);
  });

  it('recentEvents has at most 5 entries', () => {
    assert.ok(buildRenderData().recentEvents.length <= 5);
  });

  it('recentEvents is sorted by date descending', () => {
    const re = buildRenderData().recentEvents;
    for (let i = 1; i < re.length; i++) {
      assert.ok(re[i - 1].date >= re[i].date);
    }
  });

  it('all event IDs are unique', () => {
    const ids = buildRenderData().events.map(e => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('all donor IDs are unique', () => {
    const ids = buildRenderData().donors.map(d => d.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('all impact scores are in range 1-10', () => {
    for (const e of buildRenderData().events) {
      assert.ok(e.impactScore >= 1 && e.impactScore <= 10,
        e.id + ' impactScore ' + e.impactScore + ' out of range');
    }
  });

  it('all donor annualAidBillionUSD are positive', () => {
    for (const d of buildRenderData().donors) {
      assert.ok(d.annualAidBillionUSD > 0, d.name + ' has non-positive aid amount');
    }
  });

  it('all donor trends are valid', () => {
    const valid = new Set(['escalating', 'stable', 'declining']);
    for (const d of buildRenderData().donors) {
      assert.ok(valid.has(d.trend), 'invalid trend: ' + d.trend);
    }
  });

  it('all donor categories are valid', () => {
    const valid = new Set(['Western', 'BRICS', 'Gulf', 'Multilateral', 'Emerging']);
    for (const d of buildRenderData().donors) {
      assert.ok(valid.has(d.category), 'invalid category: ' + d.category);
    }
  });

  it('all event types are valid', () => {
    const valid = new Set(['freeze', 'cut', 'condition', 'redirect', 'weaponize', 'competition', 'reform']);
    for (const e of buildRenderData().events) {
      assert.ok(valid.has(e.eventType), 'invalid eventType: ' + e.eventType);
    }
  });

  it('all events have non-empty donor strings', () => {
    for (const e of buildRenderData().events) {
      assert.ok(e.donor.trim().length > 0, e.id + ' has empty donor');
    }
  });

  it('all events have non-empty recipient strings', () => {
    for (const e of buildRenderData().events) {
      assert.ok(e.recipient.trim().length > 0, e.id + ' has empty recipient');
    }
  });

  it('all events have at least one source', () => {
    for (const e of buildRenderData().events) {
      assert.ok(e.sources.length > 0, e.id + ' has no sources');
    }
  });

  it('all donors have at least one leverage type', () => {
    for (const d of buildRenderData().donors) {
      assert.ok(d.leverageTypes.length > 0, d.name + ' has no leverage types');
    }
  });

  it('all donors have at least one key instrument', () => {
    for (const d of buildRenderData().donors) {
      assert.ok(d.keyInstruments.length > 0, d.name + ' has no key instruments');
    }
  });

  it('all events have non-empty geopoliticalEffect', () => {
    for (const e of buildRenderData().events) {
      assert.ok(e.geopoliticalEffect.trim().length > 0, e.id + ' has empty geopoliticalEffect');
    }
  });

  it('has at least 10 events', () => {
    assert.ok(buildRenderData().events.length >= 10);
  });

  it('has at least 5 donors', () => {
    assert.ok(buildRenderData().donors.length >= 5);
  });

  it('FA001 (USA USAID freeze) is present with impact 10', () => {
    const d = buildRenderData();
    const ev = d.events.find(e => e.id === 'FA001');
    assert.ok(ev, 'FA001 not found');
    assert.equal(ev!.impactScore, 10);
    assert.equal(ev!.donor, 'USA');
    assert.equal(ev!.eventType, 'freeze');
    assert.equal(ev!.active, true);
  });

  it('FA004 (China BRI) is present as active condition', () => {
    const d = buildRenderData();
    const ev = d.events.find(e => e.id === 'FA004');
    assert.ok(ev, 'FA004 not found');
    assert.equal(ev!.donor, 'China');
    assert.equal(ev!.eventType, 'condition');
    assert.equal(ev!.active, true);
  });

  it('FA006 (Russia grain weaponization) is present as weaponize type', () => {
    const d = buildRenderData();
    const ev = d.events.find(e => e.id === 'FA006');
    assert.ok(ev, 'FA006 not found');
    assert.equal(ev!.eventType, 'weaponize');
    assert.equal(ev!.donor, 'Russia');
  });

  it('FA002 (USA Ukraine aid) is inactive (passed)', () => {
    const d = buildRenderData();
    const ev = d.events.find(e => e.id === 'FA002');
    assert.ok(ev, 'FA002 not found');
    assert.equal(ev!.active, false);
    assert.ok(ev!.amountBillionUSD !== undefined && ev!.amountBillionUSD >= 61);
  });

  it('USA donor exists with military leverage', () => {
    const d = buildRenderData();
    const usa = d.donors.find(dn => dn.name === 'USA');
    assert.ok(usa, 'USA donor not found');
    assert.ok(usa!.leverageTypes.includes('military'));
  });

  it('China donor exists as BRICS with escalating trend', () => {
    const d = buildRenderData();
    const china = d.donors.find(dn => dn.name === 'China');
    assert.ok(china, 'China donor not found');
    assert.equal(china!.category, 'BRICS');
    assert.equal(china!.trend, 'escalating');
  });

  it('at least 2 donors with escalating trend', () => {
    const d = buildRenderData();
    const escalating = d.donors.filter(dn => dn.trend === 'escalating');
    assert.ok(escalating.length >= 2, 'fewer than 2 escalating donors');
  });

  it('at least 3 active events', () => {
    const d = buildRenderData();
    const activeEvts = d.events.filter(e => e.active);
    assert.ok(activeEvts.length >= 3, 'fewer than 3 active events');
  });

  it('at least 1 redirect event', () => {
    const d = buildRenderData();
    const redirects = d.events.filter(e => e.eventType === 'redirect');
    assert.ok(redirects.length >= 1, 'no redirect events');
  });

  it('at least 1 competition event', () => {
    const d = buildRenderData();
    const comp = d.events.filter(e => e.eventType === 'competition');
    assert.ok(comp.length >= 1, 'no competition events');
  });
});
