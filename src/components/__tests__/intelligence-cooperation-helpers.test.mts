import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGlobalCoopIndex,
  getByTier,
  getStrainedPartners,
  getSuspendedPartners,
  computeAverageTrust,
  getPositiveEvents,
  getCriticalEvents,
  healthClass,
  tierClass,
  buildRenderData,
  type IntelPartner,
  type IntelSharingEvent,
  type IntelTier,
  type PartnershipHealth,
} from '../intelligence-cooperation-helpers.js';

const MOCK_PARTNERS: IntelPartner[] = [
  { id: 'P1', country: 'UK', code: 'UK', tier: 'Tier 1 (Core)', primaryAgency: 'GCHQ', domainsShared: ['SIGINT'], partnershipHealth: 'Strong', keyAgreement: 'UKUSA', establishedYear: 1946, trustScore: 10, recentDevelopment: 'Active' },
  { id: 'P2', country: 'Germany', code: 'DE', tier: 'Tier 2 (Enhanced)', primaryAgency: 'BND', domainsShared: ['SIGINT'], partnershipHealth: 'Strained', keyAgreement: 'Bilateral', establishedYear: 1968, trustScore: 7, recentDevelopment: 'Rebuilding' },
  { id: 'P3', country: 'Russia', code: 'RU', tier: 'Adversarial', primaryAgency: 'FSB', domainsShared: [], partnershipHealth: 'Suspended', keyAgreement: 'None', establishedYear: 0, trustScore: 0, recentDevelopment: 'Hostile' },
  { id: 'P4', country: 'India', code: 'IN', tier: 'Tier 3 (Liaison)', primaryAgency: 'RAW', domainsShared: ['HUMINT'], partnershipHealth: 'Rebuilding', keyAgreement: 'Partial', establishedYear: 2005, trustScore: 6, recentDevelopment: 'Partial' },
  { id: 'P5', country: 'France', code: 'FR', tier: 'Tier 2 (Enhanced)', primaryAgency: 'DGSE', domainsShared: ['HUMINT'], partnershipHealth: 'Strong', keyAgreement: 'Bilateral', establishedYear: 1950, trustScore: 8, recentDevelopment: 'Active' },
];

const MOCK_EVENTS: IntelSharingEvent[] = [
  { id: 'EV1', date: '2024-01', actors: ['USA', 'UK'], domain: 'SIGINT', description: 'Joint attribution', significance: 'Critical', positive: true },
  { id: 'EV2', date: '2023-10', actors: ['USA', 'Israel'], domain: 'HUMINT', description: 'Intelligence failure', significance: 'Notable', positive: false },
  { id: 'EV3', date: '2024-03', actors: ['NATO'], domain: 'CYBINT', description: 'Routine sharing', significance: 'Routine', positive: true },
  { id: 'EV4', date: '2024-06', actors: ['USA', 'Japan'], domain: 'GEOINT', description: 'QUAD intel cell', significance: 'Critical', positive: true },
];

describe('computeGlobalCoopIndex', () => {
  it('returns a number between 0 and 100', () => {
    const idx = computeGlobalCoopIndex(MOCK_PARTNERS);
    assert.ok(idx >= 0 && idx <= 100);
  });
  it('returns 0 for empty array', () => {
    assert.equal(computeGlobalCoopIndex([]), 0);
  });
  it('excludes Adversarial partners from calculation', () => {
    const withAdv = MOCK_PARTNERS;
    const noAdv = MOCK_PARTNERS.filter(p => p.tier !== 'Adversarial');
    const idxWith = computeGlobalCoopIndex(withAdv);
    const idxNo = computeGlobalCoopIndex(noAdv);
    assert.equal(idxWith, idxNo);
  });
  it('returns 0 when only adversarial partners', () => {
    const all = MOCK_PARTNERS.map(p => ({ ...p, tier: 'Adversarial' as IntelTier }));
    assert.equal(computeGlobalCoopIndex(all), 0);
  });
  it('returns integer', () => {
    const idx = computeGlobalCoopIndex(MOCK_PARTNERS);
    assert.equal(idx, Math.round(idx));
  });
});

describe('getByTier', () => {
  it('returns only Tier 1 partners', () => {
    const t1 = getByTier(MOCK_PARTNERS, 'Tier 1 (Core)');
    assert.equal(t1.length, 1);
    assert.equal(t1[0].code, 'UK');
  });
  it('returns only Tier 2 partners', () => {
    const t2 = getByTier(MOCK_PARTNERS, 'Tier 2 (Enhanced)');
    assert.equal(t2.length, 2);
  });
  it('returns Adversarial partners', () => {
    const adv = getByTier(MOCK_PARTNERS, 'Adversarial');
    assert.equal(adv.length, 1);
  });
  it('returns empty when tier not present', () => {
    const all = MOCK_PARTNERS.map(p => ({ ...p, tier: 'Tier 1 (Core)' as IntelTier }));
    assert.equal(getByTier(all, 'Adversarial').length, 0);
  });
});

describe('getStrainedPartners', () => {
  it('returns Strained and Suspended partners', () => {
    const strained = getStrainedPartners(MOCK_PARTNERS);
    assert.equal(strained.length, 2); // Germany=Strained, Russia=Suspended
    assert.ok(strained.every(p => p.partnershipHealth === 'Strained' || p.partnershipHealth === 'Suspended'));
  });
  it('returns empty when all Strong', () => {
    const all = MOCK_PARTNERS.map(p => ({ ...p, partnershipHealth: 'Strong' as PartnershipHealth }));
    assert.equal(getStrainedPartners(all).length, 0);
  });
});

describe('getSuspendedPartners', () => {
  it('returns only Suspended partners', () => {
    const susp = getSuspendedPartners(MOCK_PARTNERS);
    assert.equal(susp.length, 1);
    assert.equal(susp[0].code, 'RU');
  });
  it('returns empty when none suspended', () => {
    const none = MOCK_PARTNERS.filter(p => p.partnershipHealth !== 'Suspended');
    assert.equal(getSuspendedPartners(none).length, 0);
  });
});

describe('computeAverageTrust', () => {
  it('excludes adversarial partners from average', () => {
    const withAdv = MOCK_PARTNERS;
    const noAdv = MOCK_PARTNERS.filter(p => p.tier !== 'Adversarial');
    assert.equal(computeAverageTrust(withAdv), computeAverageTrust(noAdv));
  });
  it('returns 0 for empty non-adversarial list', () => {
    const all = MOCK_PARTNERS.map(p => ({ ...p, tier: 'Adversarial' as IntelTier }));
    assert.equal(computeAverageTrust(all), 0);
  });
  it('returns correct average for single partner', () => {
    assert.equal(computeAverageTrust([MOCK_PARTNERS[0]]), 10);
  });
  it('returns a number', () => {
    assert.equal(typeof computeAverageTrust(MOCK_PARTNERS), 'number');
  });
});

describe('getPositiveEvents', () => {
  it('returns only positive events', () => {
    const pos = getPositiveEvents(MOCK_EVENTS);
    assert.equal(pos.length, 3);
    assert.ok(pos.every(e => e.positive));
  });
  it('returns empty when all negative', () => {
    const all = MOCK_EVENTS.map(e => ({ ...e, positive: false }));
    assert.equal(getPositiveEvents(all).length, 0);
  });
});

describe('getCriticalEvents', () => {
  it('returns only Critical significance events', () => {
    const crit = getCriticalEvents(MOCK_EVENTS);
    assert.equal(crit.length, 2);
    assert.ok(crit.every(e => e.significance === 'Critical'));
  });
  it('returns empty when none Critical', () => {
    const all = MOCK_EVENTS.map(e => ({ ...e, significance: 'Routine' as const }));
    assert.equal(getCriticalEvents(all).length, 0);
  });
});

describe('healthClass', () => {
  it('returns health-strong for Strong', () => { assert.equal(healthClass('Strong'), 'health-strong'); });
  it('returns health-strained for Strained', () => { assert.equal(healthClass('Strained'), 'health-strained'); });
  it('returns health-suspended for Suspended', () => { assert.equal(healthClass('Suspended'), 'health-suspended'); });
  it('returns health-rebuilding for Rebuilding', () => { assert.equal(healthClass('Rebuilding'), 'health-rebuilding'); });
});

describe('tierClass', () => {
  it('returns tier-1 for Tier 1 (Core)', () => { assert.equal(tierClass('Tier 1 (Core)'), 'tier-1'); });
  it('returns tier-2 for Tier 2 (Enhanced)', () => { assert.equal(tierClass('Tier 2 (Enhanced)'), 'tier-2'); });
  it('returns tier-3 for Tier 3 (Liaison)', () => { assert.equal(tierClass('Tier 3 (Liaison)'), 'tier-3'); });
  it('returns tier-adv for Adversarial', () => { assert.equal(tierClass('Adversarial'), 'tier-adv'); });
});

describe('buildRenderData', () => {
  it('returns all required fields', () => {
    const d = buildRenderData();
    assert.ok(Array.isArray(d.partners));
    assert.ok(Array.isArray(d.events));
    assert.equal(typeof d.globalCoopIndex, 'number');
    assert.equal(typeof d.tier1Count, 'number');
    assert.equal(typeof d.tier2Count, 'number');
    assert.equal(typeof d.strainedCount, 'number');
    assert.equal(typeof d.suspendedCount, 'number');
    assert.equal(typeof d.averageTrustScore, 'number');
  });
  it('partners array is non-empty', () => { assert.ok(buildRenderData().partners.length > 0); });
  it('events array is non-empty', () => { assert.ok(buildRenderData().events.length > 0); });
  it('tier1Count matches actual Tier 1 count', () => {
    const d = buildRenderData();
    assert.equal(d.tier1Count, d.partners.filter(p => p.tier === 'Tier 1 (Core)').length);
  });
  it('tier2Count matches actual Tier 2 count', () => {
    const d = buildRenderData();
    assert.equal(d.tier2Count, d.partners.filter(p => p.tier === 'Tier 2 (Enhanced)').length);
  });
  it('suspendedCount matches actual suspended partners', () => {
    const d = buildRenderData();
    assert.equal(d.suspendedCount, d.partners.filter(p => p.partnershipHealth === 'Suspended').length);
  });
  it('globalCoopIndex is 0-100', () => {
    const idx = buildRenderData().globalCoopIndex;
    assert.ok(idx >= 0 && idx <= 100);
  });
  it('all trust scores are 0-10', () => {
    for (const p of buildRenderData().partners) {
      assert.ok(p.trustScore >= 0 && p.trustScore <= 10);
    }
  });
  it('all health values are valid', () => {
    const valid = new Set(['Strong', 'Strained', 'Suspended', 'Rebuilding']);
    for (const p of buildRenderData().partners) {
      assert.ok(valid.has(p.partnershipHealth));
    }
  });
  it('all tier values are valid', () => {
    const valid = new Set(['Tier 1 (Core)', 'Tier 2 (Enhanced)', 'Tier 3 (Liaison)', 'Adversarial']);
    for (const p of buildRenderData().partners) {
      assert.ok(valid.has(p.tier));
    }
  });
  it('all significance values are valid', () => {
    const valid = new Set(['Routine', 'Notable', 'Critical']);
    for (const e of buildRenderData().events) {
      assert.ok(valid.has(e.significance));
    }
  });
});
