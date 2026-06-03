// intelligence-cooperation-helpers.ts
// Pure logic for IntelligenceCooperationPanel — no DOM, no Panel imports

export type IntelTier = 'Tier 1 (Core)' | 'Tier 2 (Enhanced)' | 'Tier 3 (Liaison)' | 'Adversarial';
export type IntelDomain = 'SIGINT' | 'HUMINT' | 'GEOINT' | 'OSINT' | 'CYBINT' | 'MASINT' | 'FININT';
export type PartnershipHealth = 'Strong' | 'Strained' | 'Suspended' | 'Rebuilding';

export interface IntelPartner {
  id: string;
  country: string;
  code: string;
  tier: IntelTier;
  primaryAgency: string;
  domainsShared: IntelDomain[];
  partnershipHealth: PartnershipHealth;
  keyAgreement: string;
  establishedYear: number;
  recentDevelopment: string;
  trustScore: number; // 0-10
}

export interface IntelSharingEvent {
  id: string;
  date: string;
  actors: string[];
  domain: IntelDomain;
  description: string;
  significance: 'Routine' | 'Notable' | 'Critical';
  positive: boolean; // true = cooperation, false = friction
}

export interface IntelCoopData {
  partners: IntelPartner[];
  events: IntelSharingEvent[];
  globalCoopIndex: number; // 0-100
  tier1Count: number;
  tier2Count: number;
  strainedCount: number;
  suspendedCount: number;
  averageTrustScore: number;
}

const PARTNERS: IntelPartner[] = [
  { id: 'P001', country: 'United Kingdom', code: 'UK', tier: 'Tier 1 (Core)', primaryAgency: 'GCHQ / MI6 / MI5', domainsShared: ['SIGINT', 'HUMINT', 'GEOINT', 'CYBINT'], partnershipHealth: 'Strong', keyAgreement: 'UKUSA Agreement (1946)', establishedYear: 1946, trustScore: 10, recentDevelopment: 'AUKUS Pillar II cyberspace/AI cooperation extended 2024' },
  { id: 'P002', country: 'Canada', code: 'CA', tier: 'Tier 1 (Core)', primaryAgency: 'CSE / CSIS', domainsShared: ['SIGINT', 'HUMINT', 'CYBINT'], partnershipHealth: 'Strong', keyAgreement: 'UKUSA / Five Eyes', establishedYear: 1946, trustScore: 10, recentDevelopment: 'Joint attribution of Chinese APT campaigns 2024' },
  { id: 'P003', country: 'Australia', code: 'AU', tier: 'Tier 1 (Core)', primaryAgency: 'ASD / ASIS', domainsShared: ['SIGINT', 'HUMINT', 'GEOINT', 'CYBINT'], partnershipHealth: 'Strong', keyAgreement: 'UKUSA / Five Eyes / AUKUS', establishedYear: 1946, trustScore: 10, recentDevelopment: 'Pine Gap base upgrade for satellite surveillance expanded' },
  { id: 'P004', country: 'New Zealand', code: 'NZ', tier: 'Tier 1 (Core)', primaryAgency: 'GCSB / NZSIS', domainsShared: ['SIGINT', 'HUMINT'], partnershipHealth: 'Strong', keyAgreement: 'UKUSA / Five Eyes', establishedYear: 1946, trustScore: 9, recentDevelopment: 'NZ excluded from AUKUS submarine track; SIGINT remains full' },
  { id: 'P005', country: 'Germany', code: 'DE', tier: 'Tier 2 (Enhanced)', primaryAgency: 'BND / BfV', domainsShared: ['SIGINT', 'HUMINT', 'CYBINT'], partnershipHealth: 'Strained', keyAgreement: 'BND-NSA SIGINT agreement (classified)', establishedYear: 1968, trustScore: 7, recentDevelopment: 'NSA-BND scandal fallout; Snowden revelations strained sharing until 2018' },
  { id: 'P006', country: 'France', code: 'FR', tier: 'Tier 2 (Enhanced)', primaryAgency: 'DGSE / DGSI', domainsShared: ['HUMINT', 'CYBINT', 'FININT'], partnershipHealth: 'Strained', keyAgreement: 'Bilateral intelligence frameworks; AUKUS submarine fallout', establishedYear: 1950, trustScore: 6, recentDevelopment: 'France excluded from AUKUS; relations recovering; joint CT ops continue' },
  { id: 'P007', country: 'Israel', code: 'IL', tier: 'Tier 2 (Enhanced)', primaryAgency: 'Mossad / Shin Bet / Unit 8200', domainsShared: ['HUMINT', 'SIGINT', 'CYBINT'], partnershipHealth: 'Strong', keyAgreement: 'ISOINT bilateral sharing; Abraham Accords intelligence annex', establishedYear: 1951, trustScore: 8, recentDevelopment: 'Hamas attack intelligence failure scrutinized; US-Israel SIGINT maintained despite Gaza ops' },
  { id: 'P008', country: 'Japan', code: 'JP', tier: 'Tier 2 (Enhanced)', primaryAgency: 'CIRO / DIA', domainsShared: ['SIGINT', 'GEOINT', 'HUMINT'], partnershipHealth: 'Strong', keyAgreement: 'US-Japan Treaty; Secret Protection Law 2014; GSOMIA', establishedYear: 1960, trustScore: 8, recentDevelopment: 'Japan joined US cyber attribution framework 2023; QUAD intelligence sharing deepened' },
  { id: 'P009', country: 'South Korea', code: 'KR', tier: 'Tier 2 (Enhanced)', primaryAgency: 'NIS / DSC', domainsShared: ['SIGINT', 'HUMINT', 'GEOINT'], partnershipHealth: 'Rebuilding', keyAgreement: 'GSOMIA (near-terminated 2019, renewed)', establishedYear: 1953, trustScore: 7, recentDevelopment: 'GSOMIA preserved; Japan-Korea intel normalization after Yoon-Kishida summit' },
  { id: 'P010', country: 'NATO Alliance', code: 'NATO', tier: 'Tier 2 (Enhanced)', primaryAgency: 'NATO Intelligence Fusion Centre', domainsShared: ['SIGINT', 'GEOINT', 'HUMINT', 'CYBINT'], partnershipHealth: 'Strong', keyAgreement: 'Article 5 + NATO-SOFA; BICES network', establishedYear: 1949, trustScore: 8, recentDevelopment: 'NIFC expanded HUMINT cell for Ukraine; classified battlefield intelligence sharing with Kyiv' },
  { id: 'P011', country: 'Ukraine', code: 'UA', tier: 'Tier 3 (Liaison)', primaryAgency: 'SBU / GUR', domainsShared: ['HUMINT', 'GEOINT', 'SIGINT'], partnershipHealth: 'Strong', keyAgreement: 'Ad hoc wartime intelligence sharing framework', establishedYear: 2022, trustScore: 8, recentDevelopment: 'US/UK sharing targeting intelligence for missile strikes; satellite imagery real-time feed' },
  { id: 'P012', country: 'Saudi Arabia', code: 'SA', tier: 'Tier 3 (Liaison)', primaryAgency: 'GIP / GDI', domainsShared: ['HUMINT', 'FININT'], partnershipHealth: 'Strained', keyAgreement: 'Bilateral CT intelligence sharing', establishedYear: 1979, trustScore: 5, recentDevelopment: 'Khashoggi murder strained ties; MBS intelligence brief resumption 2023' },
  { id: 'P013', country: 'China', code: 'CN', tier: 'Adversarial', primaryAgency: 'MSS / PLA-SSF', domainsShared: [], partnershipHealth: 'Suspended', keyAgreement: 'None (adversarial relationship)', establishedYear: 0, trustScore: 0, recentDevelopment: 'Volt Typhoon / Salt Typhoon campaigns attributed to PRC; FBI/CISA joint advisory 2024' },
  { id: 'P014', country: 'Russia', code: 'RU', tier: 'Adversarial', primaryAgency: 'FSB / SVR / GRU', domainsShared: [], partnershipHealth: 'Suspended', keyAgreement: 'None post-Ukraine invasion', establishedYear: 0, trustScore: 0, recentDevelopment: 'SVR/GRU operations targeted NATO members; Cozy Bear / Fancy Bear active in 2024' },
  { id: 'P015', country: 'India', code: 'IN', tier: 'Tier 3 (Liaison)', primaryAgency: 'RAW / IB', domainsShared: ['HUMINT', 'CYBINT'], partnershipHealth: 'Rebuilding', keyAgreement: 'QUAD intelligence framework (partial)', establishedYear: 2005, trustScore: 6, recentDevelopment: 'India-Canada friction over Sikh activist killing complicates Five Eyes adjacent sharing' },
];

const EVENTS: IntelSharingEvent[] = [
  { id: 'EV001', date: '2024-09', actors: ['USA', 'UK', 'Australia', 'Canada', 'New Zealand'], domain: 'CYBINT', description: 'Five Eyes joint advisory attributing Salt Typhoon telecom infiltration campaign to Chinese MSS.', significance: 'Critical', positive: true },
  { id: 'EV002', date: '2024-03', actors: ['USA', 'UK', 'Germany', 'France'], domain: 'SIGINT', description: 'Joint SIGINT operation disrupted GRU Unit 26165 cyber campaign targeting European elections.', significance: 'Critical', positive: true },
  { id: 'EV003', date: '2023-10', actors: ['USA', 'Israel'], domain: 'HUMINT', description: 'Post-Hamas attack review revealed HUMINT gaps in Gaza; US-Israel sharing on hostage locations.', significance: 'Notable', positive: false },
  { id: 'EV004', date: '2024-04', actors: ['USA', 'Ukraine', 'UK'], domain: 'GEOINT', description: 'Real-time satellite imagery sharing enabled Ukrainian targeting of Black Sea Fleet.', significance: 'Critical', positive: true },
  { id: 'EV005', date: '2023-06', actors: ['Germany', 'USA'], domain: 'SIGINT', description: 'BND renewed NSA SIGINT-sharing under revised legal framework following Constitutional Court ruling.', significance: 'Notable', positive: true },
  { id: 'EV006', date: '2024-07', actors: ['USA', 'Japan', 'Australia'], domain: 'SIGINT', description: 'QUAD+ intelligence fusion cell established for Pacific SIGINT coverage and PLA monitoring.', significance: 'Notable', positive: true },
  { id: 'EV007', date: '2023-11', actors: ['USA', 'Saudi Arabia'], domain: 'HUMINT', description: 'Biden-MBS intelligence brief resumed after 2-year suspension; Iran nuclear program focus.', significance: 'Notable', positive: true },
  { id: 'EV008', date: '2024-02', actors: ['UK', 'Germany', 'France', 'Poland'], domain: 'HUMINT', description: 'EU4 HUMINT sharing cell on Russian sabotage operations (Nord Stream investigation, Baltic cables).', significance: 'Notable', positive: true },
];

export function computeGlobalCoopIndex(partners: IntelPartner[]): number {
  if (!partners.length) return 0;
  const nonAdversarial = partners.filter(p => p.tier !== 'Adversarial');
  if (!nonAdversarial.length) return 0;
  const avg = nonAdversarial.reduce((s, p) => s + p.trustScore, 0) / nonAdversarial.length;
  return Math.min(100, Math.round(avg * 10));
}

export function getByTier(partners: IntelPartner[], tier: IntelTier): IntelPartner[] {
  return partners.filter(p => p.tier === tier);
}

export function getStrainedPartners(partners: IntelPartner[]): IntelPartner[] {
  return partners.filter(p => p.partnershipHealth === 'Strained' || p.partnershipHealth === 'Suspended');
}

export function getSuspendedPartners(partners: IntelPartner[]): IntelPartner[] {
  return partners.filter(p => p.partnershipHealth === 'Suspended');
}

export function computeAverageTrust(partners: IntelPartner[]): number {
  const nonAdv = partners.filter(p => p.tier !== 'Adversarial');
  if (!nonAdv.length) return 0;
  return Math.round((nonAdv.reduce((s, p) => s + p.trustScore, 0) / nonAdv.length) * 10) / 10;
}

export function getPositiveEvents(events: IntelSharingEvent[]): IntelSharingEvent[] {
  return events.filter(e => e.positive);
}

export function getCriticalEvents(events: IntelSharingEvent[]): IntelSharingEvent[] {
  return events.filter(e => e.significance === 'Critical');
}

export function healthClass(health: PartnershipHealth): string {
  const map: Record<PartnershipHealth, string> = { Strong: 'health-strong', Strained: 'health-strained', Suspended: 'health-suspended', Rebuilding: 'health-rebuilding' };
  return map[health] ?? 'health-strained';
}

export function tierClass(tier: IntelTier): string {
  const map: Record<IntelTier, string> = { 'Tier 1 (Core)': 'tier-1', 'Tier 2 (Enhanced)': 'tier-2', 'Tier 3 (Liaison)': 'tier-3', 'Adversarial': 'tier-adv' };
  return map[tier] ?? 'tier-3';
}

export function buildRenderData(): IntelCoopData {
  return {
    partners: PARTNERS,
    events: EVENTS,
    globalCoopIndex: computeGlobalCoopIndex(PARTNERS),
    tier1Count: getByTier(PARTNERS, 'Tier 1 (Core)').length,
    tier2Count: getByTier(PARTNERS, 'Tier 2 (Enhanced)').length,
    strainedCount: getStrainedPartners(PARTNERS).length,
    suspendedCount: getSuspendedPartners(PARTNERS).length,
    averageTrustScore: computeAverageTrust(PARTNERS),
  };
}
