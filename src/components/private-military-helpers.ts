/**
 * Pure helpers for PrivateMilitaryPanel.
 *
 * No DOM, no fetch — safe to import in Node.js tests. Every function is
 * deterministic (no Date.now() / Math.random() at module scope).
 *
 * Framing: STRICTLY analytical monitoring of publicly reported indicators
 * about private military contractor (PMC) and mercenary activity. Nothing
 * in this file generates operational guidance, recruitment material, or
 * mercenary playbooks. All severity and confidence tiers describe what
 * has been REPORTED in open sources, not what should be done.
 *
 * Covers six monitoring surfaces:
 *   1. PMC/mercenary deployment tracker by region.
 *   2. State sponsorship mapping with a 4-tier confidence ladder.
 *   3. Reported operational casualty events.
 *   4. Publicly reported contract awards.
 *   5. Regulatory action / ban events.
 *   6. Proxy warfare logistics indicators.
 */

// ── Type unions ───────────────────────────────────────────────────────────

export type Region =
  | 'Sahel'
  | 'Horn of Africa'
  | 'Central Africa'
  | 'North Africa'
  | 'Levant'
  | 'Eastern Europe'
  | 'South Caucasus'
  | 'South Asia'
  | 'Latin America'
  | 'Indo-Pacific';

export type ActivityScale = 'monitoring' | 'limited' | 'moderate' | 'significant' | 'mass';

export type SponsorConfidence = 'unknown' | 'suspected' | 'likely' | 'confirmed';

export type CasualtyKind = 'combat' | 'aviation' | 'accident' | 'detention' | 'unclear';

export type CasualtySeverity = 'minor' | 'moderate' | 'major' | 'mass-casualty';

export type ContractType =
  | 'training'
  | 'logistics'
  | 'security'
  | 'aviation-support'
  | 'maritime-security'
  | 'cyber'
  | 'embassy-protection';

export type RegulatoryActionType =
  | 'sanctions-designation'
  | 'visa-ban'
  | 'asset-freeze'
  | 'criminal-charges'
  | 'parliamentary-ban'
  | 'export-control';

export type RegulatoryBody = 'OFAC' | 'EU' | 'UK' | 'UN' | 'Canada' | 'Australia';

export type LogisticsIndicator =
  | 'cargo-flight'
  | 'materiel-transfer'
  | 'basing-change'
  | 'maritime-shipment'
  | 'fuel-resupply';

export type LogisticsConfidence = 'weak' | 'moderate' | 'strong' | 'corroborated';

// ── Section 1 — Deployment Tracker by Region ──────────────────────────────

export interface PmcDeployment {
  /** Name as commonly used in open-source reporting (analytical label only). */
  formation: string;
  region: Region;
  /** Specific countries/areas of reported presence. */
  reportedAreas: readonly string[];
  /** Scale reflects size of reported activity, not endorsement. */
  scale: ActivityScale;
  /** Year activity in this region was first reported. */
  firstReportedYear: number;
  /** Most-recently reported activity within this region. */
  lastObservedAt: number;
  /** Short analytical note (must not be operational guidance). */
  observerNote: string;
}

const SCALE_COLORS: Record<ActivityScale, string> = {
  monitoring: '#4b5563',
  limited: '#0e7490',
  moderate: '#ca8a04',
  significant: '#ea580c',
  mass: '#b91c1c',
};

const SCALE_LABELS: Record<ActivityScale, string> = {
  monitoring: 'Monitoring',
  limited: 'Limited',
  moderate: 'Moderate',
  significant: 'Significant',
  mass: 'Mass',
};

export function activityScaleColor(s: ActivityScale): string { return SCALE_COLORS[s]; }
export function activityScaleLabel(s: ActivityScale): string { return SCALE_LABELS[s]; }

const SCALE_RANK: Record<ActivityScale, number> = {
  monitoring: 0,
  limited: 1,
  moderate: 2,
  significant: 3,
  mass: 4,
};

export function activityScaleRank(s: ActivityScale): number { return SCALE_RANK[s]; }

export function countDeploymentsByRegion(rows: readonly PmcDeployment[], region: Region): number {
  return rows.filter((d) => d.region === region).length;
}

export function countSignificantDeployments(rows: readonly PmcDeployment[]): number {
  return rows.filter((d) => d.scale === 'significant' || d.scale === 'mass').length;
}

/** Group rows by region, preserving input order within each group. */
export function deploymentsByRegion(rows: readonly PmcDeployment[]): Map<Region, PmcDeployment[]> {
  const map = new Map<Region, PmcDeployment[]>();
  for (const d of rows) {
    const list = map.get(d.region) ?? [];
    list.push(d);
    map.set(d.region, list);
  }
  return map;
}

// ── Section 2 — State Sponsorship Mapping ─────────────────────────────────

export interface SponsorshipLink {
  formation: string;
  sponsorState: string;
  confidence: SponsorConfidence;
  /** Short rationale citing open-source reporting basis. */
  basis: string;
}

const SPONSOR_COLORS: Record<SponsorConfidence, string> = {
  unknown: '#4b5563',
  suspected: '#ca8a04',
  likely: '#ea580c',
  confirmed: '#b91c1c',
};

const SPONSOR_LABELS: Record<SponsorConfidence, string> = {
  unknown: 'Unknown',
  suspected: 'Suspected',
  likely: 'Likely',
  confirmed: 'Confirmed',
};

export function sponsorConfidenceColor(c: SponsorConfidence): string { return SPONSOR_COLORS[c]; }
export function sponsorConfidenceLabel(c: SponsorConfidence): string { return SPONSOR_LABELS[c]; }

const SPONSOR_RANK: Record<SponsorConfidence, number> = {
  unknown: 0,
  suspected: 1,
  likely: 2,
  confirmed: 3,
};

export function sponsorConfidenceRank(c: SponsorConfidence): number { return SPONSOR_RANK[c]; }

export function countSponsorsForFormation(rows: readonly SponsorshipLink[], formation: string): number {
  return rows.filter((r) => r.formation === formation).length;
}

export function countHighConfidenceSponsorships(rows: readonly SponsorshipLink[]): number {
  return rows.filter((r) => r.confidence === 'likely' || r.confidence === 'confirmed').length;
}

// ── Section 3 — Reported Operational Casualty Events ──────────────────────

export interface CasualtyEvent {
  formation: string;
  region: Region;
  kind: CasualtyKind;
  /** Total reported killed/wounded/detained from public reporting (defensive estimate). */
  reportedCount: number;
  occurredAt: number;
  /** Short open-source description (analytical only). */
  summary: string;
}

const CASUALTY_KIND_LABELS: Record<CasualtyKind, string> = {
  combat: 'Combat',
  aviation: 'Aviation',
  accident: 'Accident',
  detention: 'Detention',
  unclear: 'Unclear',
};

export function casualtyKindLabel(k: CasualtyKind): string { return CASUALTY_KIND_LABELS[k]; }

const CASUALTY_SEVERITY_COLORS: Record<CasualtySeverity, string> = {
  minor: '#4b5563',
  moderate: '#ca8a04',
  major: '#ea580c',
  'mass-casualty': '#b91c1c',
};

const CASUALTY_SEVERITY_LABELS: Record<CasualtySeverity, string> = {
  minor: 'Minor',
  moderate: 'Moderate',
  major: 'Major',
  'mass-casualty': 'Mass Casualty',
};

export function casualtySeverityColor(s: CasualtySeverity): string { return CASUALTY_SEVERITY_COLORS[s]; }
export function casualtySeverityLabel(s: CasualtySeverity): string { return CASUALTY_SEVERITY_LABELS[s]; }

/**
 * Classify a reported casualty count into a severity tier.
 *   0..2  → minor
 *   3..9  → moderate
 *   10..49 → major
 *   50+   → mass-casualty
 * Negative input is treated as 0 (defensive).
 */
export function classifyCasualtySeverity(reportedCount: number): CasualtySeverity {
  const n = Math.max(0, reportedCount);
  if (n >= 50) return 'mass-casualty';
  if (n >= 10) return 'major';
  if (n >= 3) return 'moderate';
  return 'minor';
}

const RECENT_CASUALTY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export function isRecentCasualty(e: Pick<CasualtyEvent, 'occurredAt'>, nowMs: number): boolean {
  return nowMs - e.occurredAt <= RECENT_CASUALTY_WINDOW_MS;
}

export function countRecentCasualties(events: readonly CasualtyEvent[], nowMs: number): number {
  return events.filter((e) => isRecentCasualty(e, nowMs)).length;
}

/** Sum reportedCount across recent events (defensive: floor non-finite/negative at 0). */
export function totalRecentReportedCount(events: readonly CasualtyEvent[], nowMs: number): number {
  let sum = 0;
  for (const e of events) {
    if (!isRecentCasualty(e, nowMs)) continue;
    const n = Number.isFinite(e.reportedCount) ? e.reportedCount : 0;
    sum += Math.max(0, n);
  }
  return sum;
}

// ── Section 4 — Publicly Reported Contract Awards ─────────────────────────

export interface ContractAward {
  formation: string;
  awardingBody: string;
  contractType: ContractType;
  valueUsdM: number;
  awardedAt: number;
  /** Public-source citation summary (e.g., USASpending solicitation #, gazette notice). */
  publicSource: string;
}

const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  training: 'Training',
  logistics: 'Logistics',
  security: 'Security',
  'aviation-support': 'Aviation Support',
  'maritime-security': 'Maritime Security',
  cyber: 'Cyber',
  'embassy-protection': 'Embassy Protection',
};

export function contractTypeLabel(t: ContractType): string { return CONTRACT_TYPE_LABELS[t]; }

export function totalContractValueUsdM(rows: readonly ContractAward[]): number {
  let sum = 0;
  for (const c of rows) {
    if (!Number.isFinite(c.valueUsdM)) continue;
    sum += Math.max(0, c.valueUsdM);
  }
  return Math.round(sum * 10) / 10;
}

export function contractValueByType(rows: readonly ContractAward[]): Map<ContractType, number> {
  const map = new Map<ContractType, number>();
  for (const c of rows) {
    const prev = map.get(c.contractType) ?? 0;
    const v = Number.isFinite(c.valueUsdM) ? Math.max(0, c.valueUsdM) : 0;
    map.set(c.contractType, prev + v);
  }
  return map;
}

// ── Section 5 — Regulatory Action / Ban Events ────────────────────────────

export interface RegulatoryAction {
  formation: string;
  actionType: RegulatoryActionType;
  body: RegulatoryBody;
  effectiveAt: number;
  /** Public statute / regulation citation. */
  citation: string;
  notes: string;
}

const REGULATORY_LABELS: Record<RegulatoryActionType, string> = {
  'sanctions-designation': 'Sanctions Designation',
  'visa-ban': 'Visa Ban',
  'asset-freeze': 'Asset Freeze',
  'criminal-charges': 'Criminal Charges',
  'parliamentary-ban': 'Parliamentary Ban',
  'export-control': 'Export Control',
};

const REGULATORY_COLORS: Record<RegulatoryActionType, string> = {
  'sanctions-designation': '#b91c1c',
  'visa-ban': '#ea580c',
  'asset-freeze': '#ca8a04',
  'criminal-charges': '#7c3aed',
  'parliamentary-ban': '#0e7490',
  'export-control': '#4b5563',
};

export function regulatoryActionLabel(t: RegulatoryActionType): string { return REGULATORY_LABELS[t]; }
export function regulatoryActionColor(t: RegulatoryActionType): string { return REGULATORY_COLORS[t]; }

export function countActionsByBody(rows: readonly RegulatoryAction[], body: RegulatoryBody): number {
  return rows.filter((a) => a.body === body).length;
}

const RECENT_ACTION_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export function isRecentAction(a: Pick<RegulatoryAction, 'effectiveAt'>, nowMs: number): boolean {
  return nowMs - a.effectiveAt <= RECENT_ACTION_WINDOW_MS;
}

export function countRecentActions(rows: readonly RegulatoryAction[], nowMs: number): number {
  return rows.filter((a) => isRecentAction(a, nowMs)).length;
}

// ── Section 6 — Proxy Warfare Logistics Indicators ────────────────────────

export interface LogisticsObservation {
  indicator: LogisticsIndicator;
  origin: string;
  destination: string;
  associatedFormation: string;
  confidence: LogisticsConfidence;
  observedAt: number;
  /** Open-source reporting basis (e.g., OSINT flight tracker, port AIS). */
  observerNote: string;
}

const LOGISTICS_INDICATOR_LABELS: Record<LogisticsIndicator, string> = {
  'cargo-flight': 'Cargo Flight',
  'materiel-transfer': 'Materiel Transfer',
  'basing-change': 'Basing Change',
  'maritime-shipment': 'Maritime Shipment',
  'fuel-resupply': 'Fuel Resupply',
};

const LOGISTICS_CONFIDENCE_LABELS: Record<LogisticsConfidence, string> = {
  weak: 'Weak',
  moderate: 'Moderate',
  strong: 'Strong',
  corroborated: 'Corroborated',
};

const LOGISTICS_CONFIDENCE_COLORS: Record<LogisticsConfidence, string> = {
  weak: '#4b5563',
  moderate: '#ca8a04',
  strong: '#ea580c',
  corroborated: '#b91c1c',
};

export function logisticsIndicatorLabel(i: LogisticsIndicator): string { return LOGISTICS_INDICATOR_LABELS[i]; }
export function logisticsConfidenceLabel(c: LogisticsConfidence): string { return LOGISTICS_CONFIDENCE_LABELS[c]; }
export function logisticsConfidenceColor(c: LogisticsConfidence): string { return LOGISTICS_CONFIDENCE_COLORS[c]; }

export function highConfidenceLogisticsCount(rows: readonly LogisticsObservation[]): number {
  return rows.filter((r) => r.confidence === 'strong' || r.confidence === 'corroborated').length;
}

// ── Aggregate alert count (used by Panel.setCount) ────────────────────────

export function totalAlertCount(input: {
  deployments: readonly PmcDeployment[];
  casualties: readonly CasualtyEvent[];
  actions: readonly RegulatoryAction[];
  logistics: readonly LogisticsObservation[];
  nowMs: number;
}): number {
  return (
    countSignificantDeployments(input.deployments) +
    countRecentCasualties(input.casualties, input.nowMs) +
    countRecentActions(input.actions, input.nowMs) +
    highConfidenceLogisticsCount(input.logistics)
  );
}

// ── Seed snapshots (illustrative, deterministic fixtures) ─────────────────
//
// All strings below are framed as analytical observations about what has
// been REPORTED in open sources. None of them describe operational
// recommendations, recruitment, or offensive playbooks. A framing audit
// test in tests/components/private-military-panel.test.mts asserts this
// stays the case.

const Y = (y: number, m: number, d: number): number => Date.UTC(y, m, d);

/** Reference "now" for fixtures — keeps the 30/90/365-day windows stable in CI. */
export const REFERENCE_NOW_MS = Y(2026, 4, 18);

export const PMC_DEPLOYMENTS: PmcDeployment[] = [
  {
    formation: 'Africa Corps (Russia-affiliated successor formation)',
    region: 'Sahel',
    reportedAreas: ['Mali', 'Burkina Faso', 'Niger'],
    scale: 'significant',
    firstReportedYear: 2023,
    lastObservedAt: Y(2026, 4, 10),
    observerNote: 'Reported presence at multiple bases; activity scale inferred from OSINT imagery and government communiqués.',
  },
  {
    formation: 'Wagner remnant cells',
    region: 'Central Africa',
    reportedAreas: ['Central African Republic', 'Libya'],
    scale: 'moderate',
    firstReportedYear: 2017,
    lastObservedAt: Y(2026, 3, 22),
    observerNote: 'Residual footprint after 2023 leadership disruption; activity observed by UN panel reporting.',
  },
  {
    formation: 'Academi-lineage US contractor consortium',
    region: 'Levant',
    reportedAreas: ['Iraq', 'Saudi Arabia'],
    scale: 'limited',
    firstReportedYear: 2014,
    lastObservedAt: Y(2026, 4, 2),
    observerNote: 'Embassy and convoy protection roles disclosed in State Department contract notices.',
  },
  {
    formation: 'SADAT (Türkiye-affiliated training firm)',
    region: 'North Africa',
    reportedAreas: ['Libya'],
    scale: 'moderate',
    firstReportedYear: 2019,
    lastObservedAt: Y(2026, 2, 27),
    observerNote: 'Training-role activity reported by regional press and Libyan ministry statements.',
  },
  {
    formation: 'PRC-affiliated security services (e.g., DeWe-style firms)',
    region: 'Horn of Africa',
    reportedAreas: ['Djibouti', 'Sudan'],
    scale: 'limited',
    firstReportedYear: 2020,
    lastObservedAt: Y(2026, 3, 5),
    observerNote: 'Site-protection and convoy escort roles reported around Chinese investment projects.',
  },
  {
    formation: 'Reported UAE-aligned contractor formations',
    region: 'Horn of Africa',
    reportedAreas: ['Somalia', 'Yemen border zone'],
    scale: 'moderate',
    firstReportedYear: 2018,
    lastObservedAt: Y(2026, 3, 18),
    observerNote: 'Open-source reporting cites training and counter-piracy support contracts.',
  },
  {
    formation: 'UK-domiciled risk-management firms',
    region: 'Indo-Pacific',
    reportedAreas: ['Philippines', 'Malacca corridor'],
    scale: 'limited',
    firstReportedYear: 2012,
    lastObservedAt: Y(2026, 4, 7),
    observerNote: 'Maritime escort and risk-advisory roles disclosed in IMO and insurer filings.',
  },
  {
    formation: 'Latin American security contractor pool',
    region: 'Latin America',
    reportedAreas: ['Colombia', 'Honduras'],
    scale: 'monitoring',
    firstReportedYear: 2008,
    lastObservedAt: Y(2026, 1, 30),
    observerNote: 'Veteran-pool recruitment patterns tracked through public job postings (analytical only).',
  },
  {
    formation: 'Reported Iran-affiliated advisory cadres',
    region: 'Levant',
    reportedAreas: ['Syria', 'Lebanon'],
    scale: 'significant',
    firstReportedYear: 2015,
    lastObservedAt: Y(2026, 4, 12),
    observerNote: 'Advisory and training presence cited by UN reports and regional press.',
  },
  {
    formation: 'Polish-domiciled training firms (NATO-adjacent)',
    region: 'Eastern Europe',
    reportedAreas: ['Ukraine western oblasts'],
    scale: 'moderate',
    firstReportedYear: 2022,
    lastObservedAt: Y(2026, 4, 9),
    observerNote: 'Training-role reporting via government press releases and parliamentary disclosures.',
  },
];

export const SPONSORSHIP_LINKS: SponsorshipLink[] = [
  { formation: 'Africa Corps (Russia-affiliated successor formation)', sponsorState: 'Russia',  confidence: 'confirmed', basis: 'State media acknowledgement and budget line items disclosed publicly.' },
  { formation: 'Wagner remnant cells',                                 sponsorState: 'Russia',  confidence: 'likely',    basis: 'Continuity of personnel and contracts reported by UN panel of experts.' },
  { formation: 'Academi-lineage US contractor consortium',             sponsorState: 'United States', confidence: 'confirmed', basis: 'DoD/State Department public award notices.' },
  { formation: 'SADAT (Türkiye-affiliated training firm)',             sponsorState: 'Türkiye', confidence: 'likely',    basis: 'Founder-government ties documented in Turkish press.' },
  { formation: 'PRC-affiliated security services (e.g., DeWe-style firms)', sponsorState: 'China', confidence: 'likely', basis: 'Service contracts linked to SOE projects reported in public filings.' },
  { formation: 'Reported UAE-aligned contractor formations',           sponsorState: 'UAE',     confidence: 'suspected', basis: 'Investigative reporting cites payments routed through UAE entities.' },
  { formation: 'UK-domiciled risk-management firms',                   sponsorState: 'United Kingdom', confidence: 'confirmed', basis: 'Companies House filings + UK MoD framework contracts.' },
  { formation: 'Reported Iran-affiliated advisory cadres',             sponsorState: 'Iran',    confidence: 'likely',    basis: 'IRGC linkage cited in US Treasury and UN reporting.' },
  { formation: 'Polish-domiciled training firms (NATO-adjacent)',      sponsorState: 'Poland',  confidence: 'confirmed', basis: 'Polish MoD framework agreements published in the gazette.' },
  { formation: 'Latin American security contractor pool',              sponsorState: 'Various', confidence: 'suspected', basis: 'Open-source veteran-network reporting; no formal state contract identified.' },
];

export const CASUALTY_EVENTS: CasualtyEvent[] = [
  { formation: 'Africa Corps (Russia-affiliated successor formation)', region: 'Sahel',         kind: 'combat',    reportedCount: 14, occurredAt: Y(2026, 4, 8),  summary: 'Convoy ambush near Tinzaouaten reported by multiple regional outlets.' },
  { formation: 'Wagner remnant cells',                                 region: 'Central Africa',kind: 'aviation',  reportedCount: 7,  occurredAt: Y(2026, 3, 12), summary: 'Cargo aircraft loss reported in the CAR; cause under investigation per OSINT trackers.' },
  { formation: 'Academi-lineage US contractor consortium',             region: 'Levant',        kind: 'accident',  reportedCount: 1,  occurredAt: Y(2026, 4, 1),  summary: 'Vehicle accident reported during routine movement; non-combat.' },
  { formation: 'SADAT (Türkiye-affiliated training firm)',             region: 'North Africa',  kind: 'unclear',   reportedCount: 2,  occurredAt: Y(2026, 2, 19), summary: 'Press reporting cites unspecified incident at a training compound.' },
  { formation: 'Reported Iran-affiliated advisory cadres',             region: 'Levant',        kind: 'combat',    reportedCount: 22, occurredAt: Y(2026, 3, 28), summary: 'Strike reported on advisory compound; casualty figures vary by source.' },
  { formation: 'Reported UAE-aligned contractor formations',           region: 'Horn of Africa',kind: 'detention', reportedCount: 5,  occurredAt: Y(2026, 1, 5),  summary: 'Personnel reportedly detained at a port; later released per local press.' },
];

export const CONTRACT_AWARDS: ContractAward[] = [
  { formation: 'Academi-lineage US contractor consortium',             awardingBody: 'US Department of State',  contractType: 'embassy-protection', valueUsdM: 312, awardedAt: Y(2026, 3, 14), publicSource: 'SAM.gov solicitation 19AQMM26C00045' },
  { formation: 'Academi-lineage US contractor consortium',             awardingBody: 'US Department of Defense',contractType: 'training',          valueUsdM: 95,  awardedAt: Y(2026, 2, 28), publicSource: 'DoD contracts daily release 2026-02-28' },
  { formation: 'SADAT (Türkiye-affiliated training firm)',             awardingBody: 'Libyan GNU',              contractType: 'training',          valueUsdM: 18,  awardedAt: Y(2026, 1, 12), publicSource: 'Libyan gazette notice 2026/04' },
  { formation: 'UK-domiciled risk-management firms',                   awardingBody: 'UK Ministry of Defence',  contractType: 'maritime-security', valueUsdM: 41,  awardedAt: Y(2026, 3, 2),  publicSource: 'UK MoD Contracts Finder DEFCON-2026-0117' },
  { formation: 'Polish-domiciled training firms (NATO-adjacent)',      awardingBody: 'Polish MoN',              contractType: 'training',          valueUsdM: 23,  awardedAt: Y(2026, 3, 21), publicSource: 'Monitor Polski item 2026/318' },
  { formation: 'PRC-affiliated security services (e.g., DeWe-style firms)', awardingBody: 'PRC SOE consortium',  contractType: 'security',          valueUsdM: 12,  awardedAt: Y(2026, 2, 6),  publicSource: 'SASAC quarterly disclosure 2026Q1' },
  { formation: 'Reported UAE-aligned contractor formations',           awardingBody: 'UAE Ministry of Interior',contractType: 'aviation-support',  valueUsdM: 9,   awardedAt: Y(2025, 11, 18), publicSource: 'UAE Federal Gazette notice 2025/812' },
];

export const REGULATORY_ACTIONS: RegulatoryAction[] = [
  { formation: 'Africa Corps (Russia-affiliated successor formation)', actionType: 'sanctions-designation', body: 'OFAC', effectiveAt: Y(2026, 1, 24), citation: '31 CFR 587 — Russia EO 14024', notes: 'OFAC designation listing Africa Corps as a successor to a previously designated formation.' },
  { formation: 'Wagner remnant cells',                                 actionType: 'asset-freeze',          body: 'EU',   effectiveAt: Y(2025, 11, 8), citation: 'Council Decision (CFSP) 2025/2147',  notes: 'EU asset-freeze listing of named cell entities.' },
  { formation: 'Wagner remnant cells',                                 actionType: 'parliamentary-ban',    body: 'UK',   effectiveAt: Y(2024, 8, 30), citation: 'Terrorism Act 2000 schedule 2 amendment', notes: 'UK proscription of the formation under the Terrorism Act.' },
  { formation: 'Reported Iran-affiliated advisory cadres',             actionType: 'sanctions-designation', body: 'OFAC', effectiveAt: Y(2026, 3, 7),  citation: 'IRGC E.O. 13224',                    notes: 'OFAC SDN listing of named advisory units.' },
  { formation: 'Reported UAE-aligned contractor formations',           actionType: 'visa-ban',              body: 'UK',   effectiveAt: Y(2025, 10, 12), citation: 'UK Global Human Rights Sanctions Regs 2020', notes: 'UK Magnitsky-style visa ban on listed individuals.' },
  { formation: 'SADAT (Türkiye-affiliated training firm)',             actionType: 'export-control',        body: 'OFAC', effectiveAt: Y(2025, 6, 4),  citation: 'EAR Part 744 Entity List',           notes: 'Bureau of Industry and Security Entity List addition.' },
  { formation: 'PRC-affiliated security services (e.g., DeWe-style firms)', actionType: 'criminal-charges', body: 'Canada', effectiveAt: Y(2025, 9, 2), citation: 'Canadian Criminal Code s.83.05',  notes: 'Charges filed against individuals associated with a listed entity.' },
];

export const LOGISTICS_OBSERVATIONS: LogisticsObservation[] = [
  { indicator: 'cargo-flight',     origin: 'Latakia',     destination: 'Bangui',       associatedFormation: 'Wagner remnant cells',                              confidence: 'strong',       observedAt: Y(2026, 4, 4),  observerNote: 'IL-76 movements correlated with OSINT flight-tracker gaps.' },
  { indicator: 'cargo-flight',     origin: 'Krasnodar',   destination: 'Bamako',       associatedFormation: 'Africa Corps (Russia-affiliated successor formation)', confidence: 'corroborated', observedAt: Y(2026, 4, 11), observerNote: 'Repeated AN-124 rotations tracked by multiple OSINT collectives.' },
  { indicator: 'maritime-shipment',origin: 'Tartus',      destination: 'Tobruk',       associatedFormation: 'Wagner remnant cells',                              confidence: 'moderate',     observedAt: Y(2026, 3, 19), observerNote: 'AIS dark-period and port-AIS reactivation patterns reported.' },
  { indicator: 'basing-change',    origin: 'Bangui',      destination: 'Sebha',        associatedFormation: 'Wagner remnant cells',                              confidence: 'weak',         observedAt: Y(2026, 2, 8),  observerNote: 'Local press reports of compound relocation; not yet corroborated.' },
  { indicator: 'fuel-resupply',    origin: 'Algiers',     destination: 'Niamey',       associatedFormation: 'Africa Corps (Russia-affiliated successor formation)', confidence: 'moderate',     observedAt: Y(2026, 3, 26), observerNote: 'Cross-border fuel convoy footage circulated on regional channels.' },
  { indicator: 'materiel-transfer',origin: 'Türkiye port',destination: 'Tripoli',      associatedFormation: 'SADAT (Türkiye-affiliated training firm)',           confidence: 'strong',       observedAt: Y(2026, 3, 31), observerNote: 'Port AIS + shipping manifests cited in regional press.' },
  { indicator: 'cargo-flight',     origin: 'Tehran',      destination: 'Damascus',     associatedFormation: 'Reported Iran-affiliated advisory cadres',           confidence: 'corroborated', observedAt: Y(2026, 4, 6),  observerNote: 'Pattern-of-life consistent with previously documented rotations.' },
];
