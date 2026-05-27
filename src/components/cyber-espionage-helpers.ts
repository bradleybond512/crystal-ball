/**
 * Pure helpers for CyberEspionagePanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 *
 * Sections:
 *   1. APT group profiles (state-sponsored threat actors)
 *   2. Active campaign records
 *   3. Target sector risk assessments
 *   4. Render-data builders (HTML string helpers)
 */

import { escapeHtml } from '@/utils/sanitize';

// ── Types ─────────────────────────────────────────────────────────────────

export type SophisticationTier = 'nation_state' | 'advanced' | 'moderate' | 'basic';
export type AttributionConfidence = 'confirmed' | 'high' | 'moderate' | 'low' | 'unattributed';
export type CampaignIntent = 'espionage' | 'sabotage' | 'disruption' | 'financial' | 'hybrid';
export type TargetSector =
  | 'defense'
  | 'energy'
  | 'finance'
  | 'government'
  | 'telecom'
  | 'healthcare'
  | 'technology'
  | 'critical_infrastructure';
export type NationState = 'russia' | 'china' | 'dprk' | 'iran' | 'usa' | 'unknown';
export type CampaignStatus = 'active' | 'dormant' | 'concluded' | 'emerging';

export interface AptGroup {
  id: string;
  name: string;
  aliases: string[];
  nation: NationState;
  sophistication: SophisticationTier;
  primaryIntents: CampaignIntent[];
  typicalTargets: TargetSector[];
  notableTools: string[];
  firstSeen: number; // year
  description: string;
}

export interface ActiveCampaign {
  id: string;
  aptGroupId: string;
  name: string;
  status: CampaignStatus;
  intent: CampaignIntent;
  targetSectors: TargetSector[];
  attributionConfidence: AttributionConfidence;
  sophistication: SophisticationTier;
  startYear: number;
  victimCount: number;
  description: string;
  indicators: string[];
}

export interface SectorRisk {
  sector: TargetSector;
  riskScore: number; // 0-100
  activeCampaignCount: number;
  primaryThreats: string[]; // APT group names
  notes: string;
}

export interface CyberEspionageRenderData {
  aptGroups: AptGroup[];
  campaigns: ActiveCampaign[];
  sectorRisks: SectorRisk[];
  totalActiveCampaigns: number;
  nationStateCampaignCount: number;
  highConfidenceAttributionCount: number;
  topTargetSector: TargetSector | null;
}

// ── Color / label tables ──────────────────────────────────────────────────

export function sophisticationColor(tier: SophisticationTier): string {
  const colors: Record<SophisticationTier, string> = {
    nation_state: 'var(--severity-critical, #ef4444)',
    advanced:     'var(--severity-high,     #fb923c)',
    moderate:     'var(--severity-medium,   #f59e0b)',
    basic:        'var(--severity-low,      #22c55e)',
  };
  return colors[tier];
}

export function sophisticationLabel(tier: SophisticationTier): string {
  const labels: Record<SophisticationTier, string> = {
    nation_state: 'Nation-State',
    advanced:     'Advanced',
    moderate:     'Moderate',
    basic:        'Basic',
  };
  return labels[tier];
}

export function attributionColor(level: AttributionConfidence): string {
  const colors: Record<AttributionConfidence, string> = {
    confirmed:    'var(--severity-critical, #ef4444)',
    high:         'var(--severity-high,     #fb923c)',
    moderate:     'var(--severity-medium,   #f59e0b)',
    low:          'var(--severity-info,     #3b82f6)',
    unattributed: 'var(--severity-low,      #22c55e)',
  };
  return colors[level];
}

export function attributionLabel(level: AttributionConfidence): string {
  const labels: Record<AttributionConfidence, string> = {
    confirmed:    'Confirmed',
    high:         'High',
    moderate:     'Moderate',
    low:          'Low',
    unattributed: 'Unattributed',
  };
  return labels[level];
}

export function intentColor(intent: CampaignIntent): string {
  const colors: Record<CampaignIntent, string> = {
    espionage:  '#3b82f6',
    sabotage:   '#ef4444',
    disruption: '#fb923c',
    financial:  '#a855f7',
    hybrid:     '#f59e0b',
  };
  return colors[intent];
}

export function intentLabel(intent: CampaignIntent): string {
  const labels: Record<CampaignIntent, string> = {
    espionage:  'Espionage',
    sabotage:   'Sabotage',
    disruption: 'Disruption',
    financial:  'Financial',
    hybrid:     'Hybrid',
  };
  return labels[intent];
}

export function sectorLabel(sector: TargetSector): string {
  const labels: Record<TargetSector, string> = {
    defense:                 'Defense',
    energy:                  'Energy',
    finance:                 'Finance',
    government:              'Government',
    telecom:                 'Telecom',
    healthcare:              'Healthcare',
    technology:              'Technology',
    critical_infrastructure: 'Critical Infrastructure',
  };
  return labels[sector];
}

export function nationLabel(nation: NationState): string {
  const labels: Record<NationState, string> = {
    russia:  'Russia',
    china:   'China',
    dprk:    'DPRK',
    iran:    'Iran',
    usa:     'USA',
    unknown: 'Unknown',
  };
  return labels[nation];
}

export function campaignStatusColor(status: CampaignStatus): string {
  const colors: Record<CampaignStatus, string> = {
    active:    '#ef4444',
    emerging:  '#fb923c',
    dormant:   '#f59e0b',
    concluded: '#6b7280',
  };
  return colors[status];
}

export function campaignStatusLabel(status: CampaignStatus): string {
  const labels: Record<CampaignStatus, string> = {
    active:    'Active',
    emerging:  'Emerging',
    dormant:   'Dormant',
    concluded: 'Concluded',
  };
  return labels[status];
}

// ── APT sophistication classifiers ────────────────────────────────────────

/** Returns true if the group operates at nation-state tier. */
export function isNationStateTier(group: AptGroup): boolean {
  return group.sophistication === 'nation_state';
}

/** Returns true if the group is at nation-state or advanced tier. */
export function isHighSophistication(group: AptGroup): boolean {
  return group.sophistication === 'nation_state' || group.sophistication === 'advanced';
}

/** Numeric rank for sophistication tiers: nation_state > advanced > moderate > basic. */
export function sophisticationRank(tier: SophisticationTier): number {
  const ranks: Record<SophisticationTier, number> = {
    nation_state: 4,
    advanced:     3,
    moderate:     2,
    basic:        1,
  };
  return ranks[tier];
}

/** Sorts APT groups by sophistication descending. */
export function sortGroupsBySophistication(groups: AptGroup[]): AptGroup[] {
  return [...groups].sort(
    (a, b) => sophisticationRank(b.sophistication) - sophisticationRank(a.sophistication),
  );
}

// ── Attribution confidence scorers ────────────────────────────────────────

/** Maps attribution confidence to a numeric score 0-100. */
export function attributionScore(level: AttributionConfidence): number {
  const scores: Record<AttributionConfidence, number> = {
    confirmed:    100,
    high:         75,
    moderate:     50,
    low:          25,
    unattributed: 0,
  };
  return scores[level];
}

/** Returns true if attribution is at least "high" confidence. */
export function isHighConfidenceAttribution(campaign: ActiveCampaign): boolean {
  return campaign.attributionConfidence === 'confirmed' || campaign.attributionConfidence === 'high';
}

/** Counts campaigns with high or confirmed attribution. */
export function countHighConfidenceAttributions(campaigns: ActiveCampaign[]): number {
  return campaigns.filter(isHighConfidenceAttribution).length;
}

// ── Campaign intent classifiers ───────────────────────────────────────────

/** Returns true if a campaign's primary intent is espionage. */
export function isEspionageCampaign(campaign: ActiveCampaign): boolean {
  return campaign.intent === 'espionage';
}

/** Returns true if a campaign involves destructive intent (sabotage or disruption). */
export function isDestructiveCampaign(campaign: ActiveCampaign): boolean {
  return campaign.intent === 'sabotage' || campaign.intent === 'disruption';
}

/** Counts campaigns matching a given intent. */
export function countByIntent(campaigns: ActiveCampaign[], intent: CampaignIntent): number {
  return campaigns.filter(c => c.intent === intent).length;
}

/** Counts active campaigns (status === 'active'). */
export function countActiveCampaigns(campaigns: ActiveCampaign[]): number {
  return campaigns.filter(c => c.status === 'active').length;
}

/** Counts campaigns with nation_state sophistication. */
export function countNationStateCampaigns(campaigns: ActiveCampaign[]): number {
  return campaigns.filter(c => c.sophistication === 'nation_state').length;
}

// ── Target sector risk assessors ──────────────────────────────────────────

/** Returns the sector with the highest riskScore, or null if empty. */
export function topRiskSector(sectors: SectorRisk[]): SectorRisk | null {
  if (sectors.length === 0) return null;
  return [...sectors].sort((a, b) => b.riskScore - a.riskScore)[0] ?? null;
}

/** Filters sectors with risk score >= threshold. */
export function highRiskSectors(sectors: SectorRisk[], threshold = 70): SectorRisk[] {
  return sectors.filter(s => s.riskScore >= threshold);
}

/** Sorts sector risks by riskScore descending. */
export function sortSectorsByRisk(sectors: SectorRisk[]): SectorRisk[] {
  return [...sectors].sort((a, b) => b.riskScore - a.riskScore);
}

/** Returns a CSS color string for a numeric risk score 0-100. */
export function riskScoreColor(score: number): string {
  if (score >= 85) return 'var(--severity-critical, #ef4444)';
  if (score >= 70) return 'var(--severity-high,     #fb923c)';
  if (score >= 50) return 'var(--severity-medium,   #f59e0b)';
  if (score >= 30) return 'var(--severity-info,     #3b82f6)';
  return 'var(--severity-low, #22c55e)';
}

// ── Active campaign counters ──────────────────────────────────────────────

/** Counts campaigns targeting a given sector. */
export function countCampaignsByTargetSector(
  campaigns: ActiveCampaign[],
  sector: TargetSector,
): number {
  return campaigns.filter(c => c.targetSectors.includes(sector)).length;
}

/** Counts campaigns attributed to a given APT group id. */
export function countCampaignsByGroup(campaigns: ActiveCampaign[], aptGroupId: string): number {
  return campaigns.filter(c => c.aptGroupId === aptGroupId).length;
}

/** Sums victim counts across all provided campaigns. */
export function totalVictimCount(campaigns: ActiveCampaign[]): number {
  return campaigns.reduce((sum, c) => sum + c.victimCount, 0);
}

// ── Threat actor profile builders ────────────────────────────────────────

/** Builds a display profile for an APT group combining group data with campaigns. */
export function buildGroupProfile(
  group: AptGroup,
  campaigns: ActiveCampaign[],
): {
  group: AptGroup;
  activeCampaigns: ActiveCampaign[];
  campaignCount: number;
  topIntent: CampaignIntent | null;
} {
  const groupCampaigns = campaigns.filter(c => c.aptGroupId === group.id);
  const activeCampaigns = groupCampaigns.filter(c => c.status === 'active');

  const intentCounts = new Map<CampaignIntent, number>();
  for (const c of activeCampaigns) {
    intentCounts.set(c.intent, (intentCounts.get(c.intent) ?? 0) + 1);
  }
  let topIntent: CampaignIntent | null = null;
  let topCount = 0;
  for (const [intent, count] of intentCounts) {
    if (count > topCount) {
      topIntent = intent;
      topCount = count;
    }
  }

  return { group, activeCampaigns, campaignCount: groupCampaigns.length, topIntent };
}

// ── Render-data builders ──────────────────────────────────────────────────

/** Assembles the full render data object from raw inputs. */
export function buildCyberEspionageRenderData(
  aptGroups: AptGroup[],
  campaigns: ActiveCampaign[],
  sectorRisks: SectorRisk[],
): CyberEspionageRenderData {
  const top = topRiskSector(sectorRisks);
  return {
    aptGroups,
    campaigns,
    sectorRisks,
    totalActiveCampaigns: countActiveCampaigns(campaigns),
    nationStateCampaignCount: countNationStateCampaigns(campaigns),
    highConfidenceAttributionCount: countHighConfidenceAttributions(campaigns),
    topTargetSector: top ? top.sector : null,
  };
}

// ── HTML section renderers ─────────────────────────────────────────────────

export function renderSummaryBar(data: CyberEspionageRenderData): string {
  const topSector = data.topTargetSector ? sectorLabel(data.topTargetSector) : 'N/A';
  return `<div style="display:flex;gap:12px;padding:8px 12px;flex-wrap:wrap;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px;"><div style="text-align:center;"><div style="font-size:var(--text-lg);font-weight:var(--fw-bold);color:#ef4444;">${data.totalActiveCampaigns}</div><div style="font-size:var(--text-2xs);color:#6b7280;">Active</div></div><div style="text-align:center;"><div style="font-size:var(--text-lg);font-weight:var(--fw-bold);color:#fb923c;">${data.nationStateCampaignCount}</div><div style="font-size:var(--text-2xs);color:#6b7280;">Nation-State</div></div><div style="text-align:center;"><div style="font-size:var(--text-lg);font-weight:var(--fw-bold);color:#f59e0b;">${data.highConfidenceAttributionCount}</div><div style="font-size:var(--text-2xs);color:#6b7280;">Attributed</div></div><div style="text-align:center;flex:1;min-width:80px;"><div style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:#3b82f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(topSector)}</div><div style="font-size:var(--text-2xs);color:#6b7280;">Top Target</div></div></div>`;
}

export function renderAptGroupsSection(groups: AptGroup[], campaigns: ActiveCampaign[]): string {
  if (groups.length === 0) return '';
  const sorted = sortGroupsBySophistication(groups);
  const rows = sorted.map(g => {
    const profile = buildGroupProfile(g, campaigns);
    const sophColor = sophisticationColor(g.sophistication);
    const sophLbl = sophisticationLabel(g.sophistication);
    const aliasText = g.aliases.slice(0, 2).map(escapeHtml).join(', ');
    const intentsText = g.primaryIntents.map(intentLabel).join(', ');
    const activeCount = profile.activeCampaigns.length;
    return `<div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;"><div style="flex:1;min-width:0;"><div style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:#e5e5e5;">${escapeHtml(g.name)}<span style="font-size:var(--text-2xs);color:#9ca3af;margin-left:4px;">(${aliasText})</span></div><div style="font-size:var(--text-xs);color:#9ca3af;margin-top:2px;">${escapeHtml(nationLabel(g.nation))} &middot; ${escapeHtml(intentsText)}</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;"><span style="font-size:var(--text-2xs);padding:2px 6px;border-radius:3px;background:${sophColor}22;color:${sophColor};">${escapeHtml(sophLbl)}</span>${activeCount > 0 ? `<span style="font-size:var(--text-2xs);color:#fb923c;">${activeCount} active</span>` : ''}</div></div><div style="font-size:var(--text-2xs);color:#6b7280;margin-top:4px;line-height:1.4;">${escapeHtml(g.description)}</div></div>`;
  }).join('');
  return `<div style="margin-bottom:12px;"><div style="font-size:var(--text-xs);font-weight:var(--fw-semibold);color:#9ca3af;padding:6px 12px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid rgba(255,255,255,0.08);">Tracked APT Groups</div>${rows}</div>`;
}

export function renderActiveCampaignsSection(campaigns: ActiveCampaign[]): string {
  const active = campaigns.filter(c => c.status === 'active' || c.status === 'emerging');
  if (active.length === 0) {
    return `<div style="margin-bottom:12px;"><div style="font-size:var(--text-xs);font-weight:var(--fw-semibold);color:#9ca3af;padding:6px 12px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid rgba(255,255,255,0.08);">Active Campaigns</div><div style="padding:12px;font-size:var(--text-xs);color:#6b7280;">No active campaigns tracked.</div></div>`;
  }
  const sorted = [...active].sort(
    (a, b) => attributionScore(b.attributionConfidence) - attributionScore(a.attributionConfidence),
  );
  const rows = sorted.map(c => {
    const statusColor = campaignStatusColor(c.status);
    const intentCol = intentColor(c.intent);
    const attrCol = attributionColor(c.attributionConfidence);
    const sophColor = sophisticationColor(c.sophistication);
    const sectors = c.targetSectors.slice(0, 3).map(sectorLabel).join(', ');
    return `<div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06);"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;"><div style="flex:1;min-width:0;"><div style="font-size:var(--text-sm);font-weight:var(--fw-semibold);color:#e5e5e5;">${escapeHtml(c.name)}</div><div style="font-size:var(--text-xs);color:#9ca3af;margin-top:2px;">Targets: ${escapeHtml(sectors)}</div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;"><span style="font-size:var(--text-2xs);padding:2px 5px;border-radius:3px;background:${statusColor}22;color:${statusColor};">${escapeHtml(campaignStatusLabel(c.status))}</span><span style="font-size:var(--text-2xs);padding:2px 5px;border-radius:3px;background:${intentCol}22;color:${intentCol};">${escapeHtml(intentLabel(c.intent))}</span></div></div><div style="display:flex;gap:8px;margin-top:5px;flex-wrap:wrap;"><span style="font-size:var(--text-2xs);color:${attrCol};">Attribution: ${escapeHtml(attributionLabel(c.attributionConfidence))}</span><span style="font-size:var(--text-2xs);color:${sophColor};">${escapeHtml(sophisticationLabel(c.sophistication))}</span><span style="font-size:var(--text-2xs);color:#6b7280;">${c.victimCount} known victims</span></div><div style="font-size:var(--text-2xs);color:#6b7280;margin-top:4px;line-height:1.4;">${escapeHtml(c.description)}</div></div>`;
  }).join('');
  return `<div style="margin-bottom:12px;"><div style="font-size:var(--text-xs);font-weight:var(--fw-semibold);color:#9ca3af;padding:6px 12px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid rgba(255,255,255,0.08);">Active Campaigns</div>${rows}</div>`;
}

export function renderSectorRiskSection(sectorRisks: SectorRisk[]): string {
  if (sectorRisks.length === 0) return '';
  const sorted = sortSectorsByRisk(sectorRisks);
  const rows = sorted.map(s => {
    const color = riskScoreColor(s.riskScore);
    const barWidth = Math.min(100, Math.max(0, s.riskScore));
    const threats = s.primaryThreats.slice(0, 2).map(escapeHtml).join(', ');
    return `<div style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;"><span style="font-size:var(--text-xs);font-weight:var(--fw-semibold);color:#e5e5e5;">${escapeHtml(sectorLabel(s.sector))}</span><span style="font-size:var(--text-xs);color:${color};font-weight:var(--fw-semibold);">${s.riskScore}</span></div><div style="height:3px;background:rgba(255,255,255,0.1);border-radius:2px;margin-bottom:4px;"><div style="height:100%;width:${barWidth}%;background:${color};border-radius:2px;"></div></div><div style="font-size:var(--text-2xs);color:#6b7280;">${s.activeCampaignCount} campaign${s.activeCampaignCount === 1 ? '' : 's'}${threats ? ` &middot; ${threats}` : ''}</div></div>`;
  }).join('');
  return `<div style="margin-bottom:12px;"><div style="font-size:var(--text-xs);font-weight:var(--fw-semibold);color:#9ca3af;padding:6px 12px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid rgba(255,255,255,0.08);">Sector Risk</div>${rows}</div>`;
}

// ── Static mock data ──────────────────────────────────────────────────────

export const APT_GROUPS: AptGroup[] = [
  {
    id: 'apt28',
    name: 'APT28',
    aliases: ['Fancy Bear', 'Sofacy', 'Pawn Storm'],
    nation: 'russia',
    sophistication: 'nation_state',
    primaryIntents: ['espionage', 'disruption'],
    typicalTargets: ['government', 'defense', 'energy'],
    notableTools: ['X-Agent', 'Sofacy', 'Zebrocy', 'CHOPSTICK'],
    firstSeen: 2004,
    description: 'GRU Unit 26165 — advanced persistent threat focused on political espionage and election interference.',
  },
  {
    id: 'apt41',
    name: 'APT41',
    aliases: ['Winnti', 'Double Dragon', 'Barium'],
    nation: 'china',
    sophistication: 'nation_state',
    primaryIntents: ['espionage', 'financial'],
    typicalTargets: ['technology', 'healthcare', 'telecom', 'finance'],
    notableTools: ['ShadowPad', 'PlugX', 'Speculoos', 'DUSTPAN'],
    firstSeen: 2012,
    description: 'MSS-affiliated dual-mission group conducting both state espionage and financially motivated intrusions.',
  },
  {
    id: 'lazarus',
    name: 'Lazarus Group',
    aliases: ['Hidden Cobra', 'ZINC', 'Guardians of Peace'],
    nation: 'dprk',
    sophistication: 'nation_state',
    primaryIntents: ['financial', 'sabotage', 'espionage'],
    typicalTargets: ['finance', 'defense', 'government', 'critical_infrastructure'],
    notableTools: ['BLINDINGCAN', 'Manuscrypt', 'ELECTRICFISH', 'AppleJeus'],
    firstSeen: 2009,
    description: 'RGB Bureau 121 — generates foreign currency through cybercrime while conducting strategic espionage and destructive attacks.',
  },
  {
    id: 'charming_kitten',
    name: 'Charming Kitten',
    aliases: ['APT35', 'Phosphorus', 'TA453'],
    nation: 'iran',
    sophistication: 'advanced',
    primaryIntents: ['espionage', 'disruption'],
    typicalTargets: ['government', 'defense', 'technology', 'healthcare'],
    notableTools: ['HYPERSCRAPE', 'CharmPower', 'PowerLess', 'BellaCPP'],
    firstSeen: 2014,
    description: 'IRGC intelligence unit targeting dissidents, journalists, and policy makers via phishing and credential theft.',
  },
  {
    id: 'equation_group',
    name: 'Equation Group',
    aliases: ['APT-C-01', 'EQGRP'],
    nation: 'usa',
    sophistication: 'nation_state',
    primaryIntents: ['espionage'],
    typicalTargets: ['government', 'energy', 'telecom', 'critical_infrastructure'],
    notableTools: ['DOUBLEPULSAR', 'ETERNALDARKNESS', 'GrayFish', 'EquationDrug'],
    firstSeen: 2001,
    description: 'NSA TAO — highest-capability cyber espionage unit; developed foundational implant frameworks and zero-day exploit libraries.',
  },
  {
    id: 'apt10',
    name: 'APT10',
    aliases: ['Stone Panda', 'MenuPass', 'Cloud Hopper'],
    nation: 'china',
    sophistication: 'nation_state',
    primaryIntents: ['espionage'],
    typicalTargets: ['defense', 'technology', 'government', 'energy'],
    notableTools: ['RedLeaves', 'QuasarRAT', 'PlugX', 'UPPERCUT'],
    firstSeen: 2009,
    description: 'MSS Tianjin Bureau — specialized in managed service provider compromise to conduct downstream supply-chain espionage.',
  },
];

export const ACTIVE_CAMPAIGNS: ActiveCampaign[] = [
  {
    id: 'op-forest-blizzard',
    aptGroupId: 'apt28',
    name: 'Forest Blizzard',
    status: 'active',
    intent: 'espionage',
    targetSectors: ['government', 'defense', 'energy'],
    attributionConfidence: 'confirmed',
    sophistication: 'nation_state',
    startYear: 2022,
    victimCount: 47,
    description: 'Ongoing credential-harvesting campaign targeting NATO-member government networks via CVE-2023-23397.',
    indicators: ['T1566.002', 'T1078', 'CVE-2023-23397'],
  },
  {
    id: 'op-earth-longzhi',
    aptGroupId: 'apt41',
    name: 'Earth Longzhi',
    status: 'active',
    intent: 'espionage',
    targetSectors: ['technology', 'healthcare', 'finance'],
    attributionConfidence: 'high',
    sophistication: 'nation_state',
    startYear: 2021,
    victimCount: 33,
    description: 'ShadowPad-based intrusion campaign against APAC technology and healthcare targets.',
    indicators: ['ShadowPad', 'T1059.003', 'T1105'],
  },
  {
    id: 'op-tradertraitor',
    aptGroupId: 'lazarus',
    name: 'TraderTraitor',
    status: 'active',
    intent: 'financial',
    targetSectors: ['finance', 'technology'],
    attributionConfidence: 'confirmed',
    sophistication: 'nation_state',
    startYear: 2022,
    victimCount: 12,
    description: 'Social engineering campaign targeting blockchain and cryptocurrency firms to steal digital assets for DPRK funding.',
    indicators: ['AppleJeus', 'T1566.003', 'T1218.011'],
  },
  {
    id: 'op-mint-sandstorm',
    aptGroupId: 'charming_kitten',
    name: 'Mint Sandstorm',
    status: 'active',
    intent: 'espionage',
    targetSectors: ['government', 'defense', 'technology'],
    attributionConfidence: 'high',
    sophistication: 'advanced',
    startYear: 2023,
    victimCount: 28,
    description: 'Spear-phishing campaign impersonating journalists to harvest credentials from US policy researchers.',
    indicators: ['HYPERSCRAPE', 'T1566.001', 'T1078.004'],
  },
  {
    id: 'op-cloud-hopper-revival',
    aptGroupId: 'apt10',
    name: 'Cloud Hopper Revival',
    status: 'emerging',
    intent: 'espionage',
    targetSectors: ['technology', 'defense', 'government'],
    attributionConfidence: 'moderate',
    sophistication: 'nation_state',
    startYear: 2024,
    victimCount: 9,
    description: 'Renewed MSP-targeting campaign leveraging supply-chain access to pivot to downstream defense contractors.',
    indicators: ['PlugX', 'T1199', 'T1078.002'],
  },
  {
    id: 'op-volt-typhoon',
    aptGroupId: 'apt41',
    name: 'Volt Typhoon',
    status: 'active',
    intent: 'sabotage',
    targetSectors: ['critical_infrastructure', 'energy', 'telecom'],
    attributionConfidence: 'confirmed',
    sophistication: 'nation_state',
    startYear: 2023,
    victimCount: 21,
    description: 'Pre-positioning in US critical infrastructure networks via living-off-the-land techniques ahead of potential kinetic conflict.',
    indicators: ['T1078', 'T1036', 'LOLBins', 'T1572'],
  },
];

export const SECTOR_RISKS: SectorRisk[] = [
  {
    sector: 'government',
    riskScore: 92,
    activeCampaignCount: 4,
    primaryThreats: ['APT28', 'Charming Kitten', 'APT10'],
    notes: 'Highest-priority target across all major nation-state actors; credential theft and lateral movement primary vectors.',
  },
  {
    sector: 'defense',
    riskScore: 90,
    activeCampaignCount: 4,
    primaryThreats: ['APT28', 'APT10', 'Lazarus Group'],
    notes: 'Defense industrial base targeted for R&D theft, weapons systems blueprints, and strategic planning documents.',
  },
  {
    sector: 'critical_infrastructure',
    riskScore: 88,
    activeCampaignCount: 2,
    primaryThreats: ['APT28', 'APT41'],
    notes: 'Pre-positioning for potential destructive attacks; OT/ICS networks increasingly targeted alongside IT.',
  },
  {
    sector: 'technology',
    riskScore: 82,
    activeCampaignCount: 4,
    primaryThreats: ['APT41', 'APT10', 'Lazarus Group'],
    notes: 'Supply-chain compromise and IP theft from semiconductor, cloud, and defense-tech sectors.',
  },
  {
    sector: 'finance',
    riskScore: 75,
    activeCampaignCount: 2,
    primaryThreats: ['Lazarus Group', 'APT41'],
    notes: 'SWIFT fraud, cryptocurrency theft, and financial data exfiltration; DPRK primary driver.',
  },
  {
    sector: 'energy',
    riskScore: 73,
    activeCampaignCount: 2,
    primaryThreats: ['APT28', 'Equation Group'],
    notes: 'Oil, gas, and power-grid targets sought for strategic intelligence and potential disruption contingency.',
  },
  {
    sector: 'telecom',
    riskScore: 68,
    activeCampaignCount: 2,
    primaryThreats: ['APT41', 'Equation Group'],
    notes: 'Mass surveillance via lawful-intercept system compromise; SS7/Diameter protocol exploitation ongoing.',
  },
  {
    sector: 'healthcare',
    riskScore: 60,
    activeCampaignCount: 2,
    primaryThreats: ['APT41', 'Charming Kitten'],
    notes: 'Vaccine research theft continues; patient-data monetization and PII exfiltration.',
  },
];
