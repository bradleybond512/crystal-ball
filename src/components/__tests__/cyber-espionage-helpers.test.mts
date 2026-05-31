import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sophisticationColor,
  sophisticationLabel,
  sophisticationRank,
  attributionColor,
  attributionLabel,
  attributionScore,
  intentColor,
  intentLabel,
  sectorLabel,
  nationLabel,
  campaignStatusColor,
  campaignStatusLabel,
  riskScoreColor,
  isNationStateTier,
  isHighSophistication,
  sortGroupsBySophistication,
  isHighConfidenceAttribution,
  countHighConfidenceAttributions,
  isEspionageCampaign,
  isDestructiveCampaign,
  countByIntent,
  countActiveCampaigns,
  countNationStateCampaigns,
  topRiskSector,
  highRiskSectors,
  sortSectorsByRisk,
  countCampaignsByTargetSector,
  countCampaignsByGroup,
  totalVictimCount,
  buildGroupProfile,
  buildCyberEspionageRenderData,
  renderSummaryBar,
  renderAptGroupsSection,
  renderActiveCampaignsSection,
  renderSectorRiskSection,
  APT_GROUPS,
  ACTIVE_CAMPAIGNS,
  SECTOR_RISKS,
  type SophisticationTier,
  type AttributionConfidence,
  type CampaignIntent,
  type TargetSector,
  type AptGroup,
  type ActiveCampaign,
  type SectorRisk,
} from '../cyber-espionage-helpers.ts';

// ── sophisticationColor ──────────────────────────────────────────────────

test('sophisticationColor covers every SophisticationTier', () => {
  const tiers: SophisticationTier[] = ['nation_state', 'advanced', 'moderate', 'basic'];
  for (const t of tiers) {
    const c = sophisticationColor(t);
    assert.ok(c.startsWith('var(') || c.startsWith('#'), `unexpected color for ${t}`);
  }
});

test('sophisticationColor nation_state is red', () => {
  assert.match(sophisticationColor('nation_state'), /ef4444/);
});

test('sophisticationColor basic is green', () => {
  assert.match(sophisticationColor('basic'), /22c55e/);
});

// ── sophisticationLabel ──────────────────────────────────────────────────

test('sophisticationLabel returns human-readable labels', () => {
  assert.equal(sophisticationLabel('nation_state'), 'Nation-State');
  assert.equal(sophisticationLabel('advanced'), 'Advanced');
  assert.equal(sophisticationLabel('moderate'), 'Moderate');
  assert.equal(sophisticationLabel('basic'), 'Basic');
});

// ── sophisticationRank ───────────────────────────────────────────────────

test('sophisticationRank nation_state > advanced > moderate > basic', () => {
  assert.ok(sophisticationRank('nation_state') > sophisticationRank('advanced'));
  assert.ok(sophisticationRank('advanced') > sophisticationRank('moderate'));
  assert.ok(sophisticationRank('moderate') > sophisticationRank('basic'));
});

// ── attributionColor ─────────────────────────────────────────────────────

test('attributionColor covers every AttributionConfidence', () => {
  const levels: AttributionConfidence[] = ['confirmed', 'high', 'moderate', 'low', 'unattributed'];
  for (const l of levels) {
    const c = attributionColor(l);
    assert.ok(c.startsWith('var(') || c.startsWith('#'), `unexpected color for ${l}`);
  }
});

// ── attributionLabel ─────────────────────────────────────────────────────

test('attributionLabel returns correct labels', () => {
  assert.equal(attributionLabel('confirmed'), 'Confirmed');
  assert.equal(attributionLabel('unattributed'), 'Unattributed');
  assert.equal(attributionLabel('moderate'), 'Moderate');
});

// ── attributionScore ─────────────────────────────────────────────────────

test('attributionScore confirmed is 100', () => {
  assert.equal(attributionScore('confirmed'), 100);
});

test('attributionScore unattributed is 0', () => {
  assert.equal(attributionScore('unattributed'), 0);
});

test('attributionScore ordering is confirmed > high > moderate > low > unattributed', () => {
  assert.ok(attributionScore('confirmed') > attributionScore('high'));
  assert.ok(attributionScore('high') > attributionScore('moderate'));
  assert.ok(attributionScore('moderate') > attributionScore('low'));
  assert.ok(attributionScore('low') > attributionScore('unattributed'));
});

// ── intentColor / intentLabel ─────────────────────────────────────────────

test('intentColor covers every CampaignIntent', () => {
  const intents: CampaignIntent[] = ['espionage', 'sabotage', 'disruption', 'financial', 'hybrid'];
  for (const i of intents) {
    const c = intentColor(i);
    assert.ok(c.startsWith('#'), `unexpected color for ${i}: ${c}`);
  }
});

test('intentLabel returns human-readable labels', () => {
  assert.equal(intentLabel('espionage'), 'Espionage');
  assert.equal(intentLabel('sabotage'), 'Sabotage');
  assert.equal(intentLabel('financial'), 'Financial');
});

// ── sectorLabel ───────────────────────────────────────────────────────────

test('sectorLabel covers every TargetSector', () => {
  const sectors: TargetSector[] = [
    'defense', 'energy', 'finance', 'government',
    'telecom', 'healthcare', 'technology', 'critical_infrastructure',
  ];
  for (const s of sectors) {
    const lbl = sectorLabel(s);
    assert.ok(lbl.length > 0, `empty label for ${s}`);
  }
});

test('sectorLabel critical_infrastructure has space', () => {
  assert.equal(sectorLabel('critical_infrastructure'), 'Critical Infrastructure');
});

// ── nationLabel ───────────────────────────────────────────────────────────

test('nationLabel returns correct strings', () => {
  assert.equal(nationLabel('russia'), 'Russia');
  assert.equal(nationLabel('dprk'), 'DPRK');
  assert.equal(nationLabel('unknown'), 'Unknown');
});

// ── campaignStatusColor / campaignStatusLabel ─────────────────────────────

test('campaignStatusColor active is red-ish', () => {
  assert.match(campaignStatusColor('active'), /ef4444/);
});

test('campaignStatusLabel returns strings', () => {
  assert.equal(campaignStatusLabel('active'), 'Active');
  assert.equal(campaignStatusLabel('concluded'), 'Concluded');
});

// ── riskScoreColor ────────────────────────────────────────────────────────

test('riskScoreColor returns critical for >= 85', () => {
  assert.match(riskScoreColor(90), /ef4444/);
  assert.match(riskScoreColor(85), /ef4444/);
});

test('riskScoreColor returns green for low scores', () => {
  assert.match(riskScoreColor(10), /22c55e/);
});

// ── isNationStateTier ─────────────────────────────────────────────────────

test('isNationStateTier true only for nation_state', () => {
  const ns: AptGroup = { ...APT_GROUPS[0]!, sophistication: 'nation_state' };
  const adv: AptGroup = { ...APT_GROUPS[0]!, sophistication: 'advanced' };
  assert.equal(isNationStateTier(ns), true);
  assert.equal(isNationStateTier(adv), false);
});

// ── isHighSophistication ──────────────────────────────────────────────────

test('isHighSophistication true for nation_state and advanced', () => {
  const ns: AptGroup = { ...APT_GROUPS[0]!, sophistication: 'nation_state' };
  const adv: AptGroup = { ...APT_GROUPS[0]!, sophistication: 'advanced' };
  const mod: AptGroup = { ...APT_GROUPS[0]!, sophistication: 'moderate' };
  assert.equal(isHighSophistication(ns), true);
  assert.equal(isHighSophistication(adv), true);
  assert.equal(isHighSophistication(mod), false);
});

// ── sortGroupsBySophistication ─────────────────────────────────────────────

test('sortGroupsBySophistication puts nation_state first', () => {
  const groups: AptGroup[] = [
    { ...APT_GROUPS[0]!, sophistication: 'moderate' },
    { ...APT_GROUPS[0]!, id: 'g2', sophistication: 'nation_state' },
    { ...APT_GROUPS[0]!, id: 'g3', sophistication: 'advanced' },
  ];
  const sorted = sortGroupsBySophistication(groups);
  assert.equal(sorted[0]!.sophistication, 'nation_state');
  assert.equal(sorted[1]!.sophistication, 'advanced');
  assert.equal(sorted[2]!.sophistication, 'moderate');
});

test('sortGroupsBySophistication does not mutate input', () => {
  const original = [...APT_GROUPS];
  sortGroupsBySophistication(APT_GROUPS);
  assert.deepEqual(APT_GROUPS, original);
});

// ── isHighConfidenceAttribution ───────────────────────────────────────────

test('isHighConfidenceAttribution true for confirmed and high', () => {
  const c1: ActiveCampaign = { ...ACTIVE_CAMPAIGNS[0]!, attributionConfidence: 'confirmed' };
  const c2: ActiveCampaign = { ...ACTIVE_CAMPAIGNS[0]!, attributionConfidence: 'high' };
  const c3: ActiveCampaign = { ...ACTIVE_CAMPAIGNS[0]!, attributionConfidence: 'moderate' };
  assert.equal(isHighConfidenceAttribution(c1), true);
  assert.equal(isHighConfidenceAttribution(c2), true);
  assert.equal(isHighConfidenceAttribution(c3), false);
});

// ── countHighConfidenceAttributions ───────────────────────────────────────

test('countHighConfidenceAttributions counts correctly', () => {
  const campaigns: ActiveCampaign[] = [
    { ...ACTIVE_CAMPAIGNS[0]!, attributionConfidence: 'confirmed' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c2', attributionConfidence: 'high' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c3', attributionConfidence: 'moderate' },
  ];
  assert.equal(countHighConfidenceAttributions(campaigns), 2);
});

// ── isEspionageCampaign / isDestructiveCampaign ───────────────────────────

test('isEspionageCampaign true only for espionage intent', () => {
  const esp: ActiveCampaign = { ...ACTIVE_CAMPAIGNS[0]!, intent: 'espionage' };
  const fin: ActiveCampaign = { ...ACTIVE_CAMPAIGNS[0]!, intent: 'financial' };
  assert.equal(isEspionageCampaign(esp), true);
  assert.equal(isEspionageCampaign(fin), false);
});

test('isDestructiveCampaign true for sabotage and disruption', () => {
  const sab: ActiveCampaign = { ...ACTIVE_CAMPAIGNS[0]!, intent: 'sabotage' };
  const dis: ActiveCampaign = { ...ACTIVE_CAMPAIGNS[0]!, intent: 'disruption' };
  const esp: ActiveCampaign = { ...ACTIVE_CAMPAIGNS[0]!, intent: 'espionage' };
  assert.equal(isDestructiveCampaign(sab), true);
  assert.equal(isDestructiveCampaign(dis), true);
  assert.equal(isDestructiveCampaign(esp), false);
});

// ── countByIntent ─────────────────────────────────────────────────────────

test('countByIntent counts matching campaigns', () => {
  const campaigns: ActiveCampaign[] = [
    { ...ACTIVE_CAMPAIGNS[0]!, intent: 'espionage' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c2', intent: 'espionage' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c3', intent: 'financial' },
  ];
  assert.equal(countByIntent(campaigns, 'espionage'), 2);
  assert.equal(countByIntent(campaigns, 'financial'), 1);
  assert.equal(countByIntent(campaigns, 'sabotage'), 0);
});

// ── countActiveCampaigns ──────────────────────────────────────────────────

test('countActiveCampaigns counts only active status', () => {
  const campaigns: ActiveCampaign[] = [
    { ...ACTIVE_CAMPAIGNS[0]!, status: 'active' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c2', status: 'active' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c3', status: 'dormant' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c4', status: 'emerging' },
  ];
  assert.equal(countActiveCampaigns(campaigns), 2);
});

// ── countNationStateCampaigns ─────────────────────────────────────────────

test('countNationStateCampaigns counts nation_state sophistication', () => {
  const campaigns: ActiveCampaign[] = [
    { ...ACTIVE_CAMPAIGNS[0]!, sophistication: 'nation_state' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c2', sophistication: 'advanced' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c3', sophistication: 'nation_state' },
  ];
  assert.equal(countNationStateCampaigns(campaigns), 2);
});

// ── topRiskSector ──────────────────────────────────────────────────────────

test('topRiskSector returns null for empty array', () => {
  assert.equal(topRiskSector([]), null);
});

test('topRiskSector returns highest riskScore sector', () => {
  const sectors: SectorRisk[] = [
    { sector: 'finance', riskScore: 50, activeCampaignCount: 1, primaryThreats: [], notes: '' },
    { sector: 'government', riskScore: 90, activeCampaignCount: 2, primaryThreats: [], notes: '' },
    { sector: 'energy', riskScore: 70, activeCampaignCount: 1, primaryThreats: [], notes: '' },
  ];
  const top = topRiskSector(sectors);
  assert.equal(top?.sector, 'government');
});

// ── highRiskSectors ────────────────────────────────────────────────────────

test('highRiskSectors filters by threshold', () => {
  const sectors: SectorRisk[] = [
    { sector: 'finance', riskScore: 50, activeCampaignCount: 1, primaryThreats: [], notes: '' },
    { sector: 'government', riskScore: 90, activeCampaignCount: 2, primaryThreats: [], notes: '' },
    { sector: 'energy', riskScore: 70, activeCampaignCount: 1, primaryThreats: [], notes: '' },
  ];
  assert.equal(highRiskSectors(sectors, 70).length, 2);
  assert.equal(highRiskSectors(sectors, 80).length, 1);
});

// ── sortSectorsByRisk ──────────────────────────────────────────────────────

test('sortSectorsByRisk sorts descending', () => {
  const sectors: SectorRisk[] = [
    { sector: 'finance', riskScore: 50, activeCampaignCount: 1, primaryThreats: [], notes: '' },
    { sector: 'government', riskScore: 90, activeCampaignCount: 2, primaryThreats: [], notes: '' },
    { sector: 'energy', riskScore: 70, activeCampaignCount: 1, primaryThreats: [], notes: '' },
  ];
  const sorted = sortSectorsByRisk(sectors);
  assert.equal(sorted[0]!.sector, 'government');
  assert.equal(sorted[2]!.sector, 'finance');
});

test('sortSectorsByRisk does not mutate input', () => {
  const input = [...SECTOR_RISKS];
  sortSectorsByRisk(SECTOR_RISKS);
  assert.deepEqual(SECTOR_RISKS, input);
});

// ── countCampaignsByTargetSector ───────────────────────────────────────────

test('countCampaignsByTargetSector counts campaigns containing sector', () => {
  const campaigns: ActiveCampaign[] = [
    { ...ACTIVE_CAMPAIGNS[0]!, targetSectors: ['government', 'defense'] },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c2', targetSectors: ['energy'] },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c3', targetSectors: ['government'] },
  ];
  assert.equal(countCampaignsByTargetSector(campaigns, 'government'), 2);
  assert.equal(countCampaignsByTargetSector(campaigns, 'energy'), 1);
  assert.equal(countCampaignsByTargetSector(campaigns, 'finance'), 0);
});

// ── countCampaignsByGroup ──────────────────────────────────────────────────

test('countCampaignsByGroup counts matching aptGroupId', () => {
  const campaigns: ActiveCampaign[] = [
    { ...ACTIVE_CAMPAIGNS[0]!, aptGroupId: 'apt28' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c2', aptGroupId: 'apt28' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c3', aptGroupId: 'lazarus' },
  ];
  assert.equal(countCampaignsByGroup(campaigns, 'apt28'), 2);
  assert.equal(countCampaignsByGroup(campaigns, 'lazarus'), 1);
  assert.equal(countCampaignsByGroup(campaigns, 'apt10'), 0);
});

// ── totalVictimCount ───────────────────────────────────────────────────────

test('totalVictimCount sums victims', () => {
  const campaigns: ActiveCampaign[] = [
    { ...ACTIVE_CAMPAIGNS[0]!, victimCount: 10 },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c2', victimCount: 25 },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c3', victimCount: 5 },
  ];
  assert.equal(totalVictimCount(campaigns), 40);
});

test('totalVictimCount returns 0 for empty array', () => {
  assert.equal(totalVictimCount([]), 0);
});

// ── buildGroupProfile ──────────────────────────────────────────────────────

test('buildGroupProfile returns correct active campaign count', () => {
  const group = APT_GROUPS[0]!; // apt28
  const campaigns: ActiveCampaign[] = [
    { ...ACTIVE_CAMPAIGNS[0]!, aptGroupId: 'apt28', status: 'active' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c2', aptGroupId: 'apt28', status: 'dormant' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c3', aptGroupId: 'lazarus', status: 'active' },
  ];
  const profile = buildGroupProfile(group, campaigns);
  assert.equal(profile.activeCampaigns.length, 1);
  assert.equal(profile.campaignCount, 2);
});

test('buildGroupProfile topIntent is most common active intent', () => {
  const group = APT_GROUPS[0]!;
  const campaigns: ActiveCampaign[] = [
    { ...ACTIVE_CAMPAIGNS[0]!, aptGroupId: 'apt28', status: 'active', intent: 'espionage' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c2', aptGroupId: 'apt28', status: 'active', intent: 'espionage' },
    { ...ACTIVE_CAMPAIGNS[0]!, id: 'c3', aptGroupId: 'apt28', status: 'active', intent: 'disruption' },
  ];
  const profile = buildGroupProfile(group, campaigns);
  assert.equal(profile.topIntent, 'espionage');
});

test('buildGroupProfile topIntent null when no active campaigns', () => {
  const group = APT_GROUPS[0]!;
  const profile = buildGroupProfile(group, []);
  assert.equal(profile.topIntent, null);
});

// ── buildCyberEspionageRenderData ──────────────────────────────────────────

test('buildCyberEspionageRenderData totalActiveCampaigns is correct', () => {
  const data = buildCyberEspionageRenderData(APT_GROUPS, ACTIVE_CAMPAIGNS, SECTOR_RISKS);
  const expected = ACTIVE_CAMPAIGNS.filter(c => c.status === 'active').length;
  assert.equal(data.totalActiveCampaigns, expected);
});

test('buildCyberEspionageRenderData nationStateCampaignCount correct', () => {
  const data = buildCyberEspionageRenderData(APT_GROUPS, ACTIVE_CAMPAIGNS, SECTOR_RISKS);
  const expected = ACTIVE_CAMPAIGNS.filter(c => c.sophistication === 'nation_state').length;
  assert.equal(data.nationStateCampaignCount, expected);
});

test('buildCyberEspionageRenderData topTargetSector is government', () => {
  const data = buildCyberEspionageRenderData(APT_GROUPS, ACTIVE_CAMPAIGNS, SECTOR_RISKS);
  assert.equal(data.topTargetSector, 'government');
});

test('buildCyberEspionageRenderData topTargetSector null for empty sectorRisks', () => {
  const data = buildCyberEspionageRenderData(APT_GROUPS, ACTIVE_CAMPAIGNS, []);
  assert.equal(data.topTargetSector, null);
});

// ── renderSummaryBar ───────────────────────────────────────────────────────

test('renderSummaryBar returns non-empty HTML string', () => {
  const data = buildCyberEspionageRenderData(APT_GROUPS, ACTIVE_CAMPAIGNS, SECTOR_RISKS);
  const html = renderSummaryBar(data);
  assert.ok(html.length > 0);
  assert.ok(html.includes('Active'));
  assert.ok(html.includes('Nation-State'));
});

// ── renderAptGroupsSection ─────────────────────────────────────────────────

test('renderAptGroupsSection returns empty string for empty groups', () => {
  assert.equal(renderAptGroupsSection([], []), '');
});

test('renderAptGroupsSection includes group names', () => {
  const html = renderAptGroupsSection(APT_GROUPS, ACTIVE_CAMPAIGNS);
  assert.ok(html.includes('APT28'));
  assert.ok(html.includes('Lazarus Group'));
  assert.ok(html.includes('Charming Kitten'));
});

test('renderAptGroupsSection escapes HTML in group name', () => {
  const dangerous: AptGroup = {
    ...APT_GROUPS[0]!,
    id: 'x',
    name: '<script>alert(1)</script>',
    aliases: [],
  };
  const html = renderAptGroupsSection([dangerous], []);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

// ── renderActiveCampaignsSection ───────────────────────────────────────────

test('renderActiveCampaignsSection shows "No active campaigns" for empty input', () => {
  const html = renderActiveCampaignsSection([]);
  assert.ok(html.includes('No active campaigns'));
});

test('renderActiveCampaignsSection shows "No active campaigns" when all are concluded', () => {
  const concluded: ActiveCampaign[] = ACTIVE_CAMPAIGNS.map(c => ({ ...c, status: 'concluded' as const }));
  const html = renderActiveCampaignsSection(concluded);
  assert.ok(html.includes('No active campaigns'));
});

test('renderActiveCampaignsSection includes active campaign names', () => {
  const html = renderActiveCampaignsSection(ACTIVE_CAMPAIGNS);
  assert.ok(html.includes('Forest Blizzard'));
  assert.ok(html.includes('Volt Typhoon'));
});

test('renderActiveCampaignsSection escapes HTML in campaign name', () => {
  const dangerous: ActiveCampaign = {
    ...ACTIVE_CAMPAIGNS[0]!,
    name: '<img src=x onerror=alert(1)>',
    status: 'active',
  };
  const html = renderActiveCampaignsSection([dangerous]);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

// ── renderSectorRiskSection ────────────────────────────────────────────────

test('renderSectorRiskSection returns empty string for empty input', () => {
  assert.equal(renderSectorRiskSection([]), '');
});

test('renderSectorRiskSection includes sector names', () => {
  const html = renderSectorRiskSection(SECTOR_RISKS);
  assert.ok(html.includes('Government'));
  assert.ok(html.includes('Defense'));
  assert.ok(html.includes('Critical Infrastructure'));
});

test('renderSectorRiskSection shows risk scores', () => {
  const html = renderSectorRiskSection(SECTOR_RISKS);
  assert.ok(html.includes('92'));
  assert.ok(html.includes('90'));
});

// ── Static data integrity ──────────────────────────────────────────────────

test('APT_GROUPS has exactly 6 entries', () => {
  assert.equal(APT_GROUPS.length, 6);
});

test('APT_GROUPS every group has a unique id', () => {
  const ids = APT_GROUPS.map(g => g.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length);
});

test('ACTIVE_CAMPAIGNS has at least 5 entries', () => {
  assert.ok(ACTIVE_CAMPAIGNS.length >= 5);
});

test('ACTIVE_CAMPAIGNS every campaign references a known APT group id', () => {
  const knownIds = new Set(APT_GROUPS.map(g => g.id));
  for (const c of ACTIVE_CAMPAIGNS) {
    assert.ok(knownIds.has(c.aptGroupId), `unknown aptGroupId: ${c.aptGroupId}`);
  }
});

test('SECTOR_RISKS has exactly 8 entries', () => {
  assert.equal(SECTOR_RISKS.length, 8);
});

test('SECTOR_RISKS every riskScore is between 0 and 100', () => {
  for (const s of SECTOR_RISKS) {
    assert.ok(s.riskScore >= 0 && s.riskScore <= 100, `score ${s.riskScore} out of range for ${s.sector}`);
  }
});
