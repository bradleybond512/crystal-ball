// treaty-surveillance-helpers.ts
// Pure logic for TreatySurveillancePanel — no DOM, no Panel imports

export type TreatyStatus = 'In Force' | 'Suspended' | 'Withdrawn' | 'Expired' | 'Under Negotiation';
export type ComplianceRating = 'Compliant' | 'Partial' | 'Non-Compliant' | 'Unknown' | 'N/A (Non-Member)';
export type TreatyDomain = 'Nuclear' | 'Chemical' | 'Biological' | 'Conventional' | 'Space' | 'Cyber' | 'Trade' | 'Environment' | 'Human Rights';

export interface Treaty {
  id: string;
  name: string;
  abbreviation: string;
  domain: TreatyDomain;
  status: TreatyStatus;
  parties: number;
  entryInForce: string;
  purpose: string;
  overallHealth: 'Strong' | 'Weakening' | 'Critical' | 'Defunct';
  keyCompliers: string[];
  keyViolators: string[];
  recentDevelopment: string;
}

export interface ComplianceRecord {
  id: string;
  country: string;
  treaty: string;
  rating: ComplianceRating;
  issue: string;
  yearReported: string;
  ongoing: boolean;
}

export interface TreatyData {
  treaties: Treaty[];
  compliance: ComplianceRecord[];
  globalComplianceScore: number;
  inForceCount: number;
  criticalHealthCount: number;
  majorViolationCount: number;
  nonCompliantRecords: ComplianceRecord[];
}

const TREATIES: Treaty[] = [
  { id: 'T001', name: 'Treaty on the Non-Proliferation of Nuclear Weapons', abbreviation: 'NPT', domain: 'Nuclear', status: 'In Force', parties: 191, entryInForce: '1970', purpose: 'Prevent spread of nuclear weapons; promote disarmament; enable peaceful nuclear energy', overallHealth: 'Weakening', keyCompliers: ['USA','UK','France','Germany','Japan'], keyViolators: ['North Korea (withdrew 2003)','Iran (enrichment violations)','Israel (non-signatory)'], recentDevelopment: 'NPT RevCon 2022 failed without consensus; P5 modernizing arsenals while calling for disarmament; credibility crisis' },
  { id: 'T002', name: 'Chemical Weapons Convention', abbreviation: 'CWC', domain: 'Chemical', status: 'In Force', parties: 193, entryInForce: '1997', purpose: 'Eliminate chemical weapons; prohibit development, production, stockpiling, and use', overallHealth: 'Weakening', keyCompliers: ['USA','UK','EU members','Japan'], keyViolators: ['Russia (Novichok: Skripal 2018, Navalny 2020)','Syria (sarin/chlorine attacks)'], recentDevelopment: 'Syria retains CW capacity despite declared destruction; Russia used Novichok twice on UK soil; OPCW attribution mechanism contested' },
  { id: 'T003', name: 'Biological Weapons Convention', abbreviation: 'BWC', domain: 'Biological', status: 'In Force', parties: 183, entryInForce: '1975', purpose: 'Prohibit development, production and stockpiling of biological weapons', overallHealth: 'Critical', keyCompliers: ['USA','UK','EU members'], keyViolators: ['Russia (secret Biopreparat program suspected)','China (dual-use concerns)'], recentDevelopment: 'No verification mechanism; Russia accused Ukraine of US-funded bioweapons labs (disproven); BWC lacks teeth relative to CWC' },
  { id: 'T004', name: 'New START', abbreviation: 'New START', domain: 'Nuclear', status: 'Suspended', parties: 2, entryInForce: '2011', purpose: 'Limit US-Russia strategic nuclear warheads and delivery vehicles', overallHealth: 'Defunct', keyCompliers: ['USA (pre-suspension)'], keyViolators: ['Russia (suspended Feb 2023)'], recentDevelopment: 'Russia suspended participation Feb 2023; last remaining US-Russia nuclear arms control treaty; expires 2026; no replacement negotiations underway' },
  { id: 'T005', name: 'Intermediate-Range Nuclear Forces Treaty', abbreviation: 'INF', domain: 'Nuclear', status: 'Withdrawn', parties: 0, entryInForce: '1988', purpose: 'Eliminate all land-based ballistic and cruise missiles with ranges 500-5,500 km', overallHealth: 'Defunct', keyCompliers: [], keyViolators: ['Russia (SSC-8/9M729 violations)', 'USA (withdrew 2019 citing Russian violations)'], recentDevelopment: 'Both parties withdrew 2019; Russia and USA now testing/deploying previously banned missiles; Europe faces renewed INF-range missile threat' },
  { id: 'T006', name: 'Open Skies Treaty', abbreviation: 'Open Skies', domain: 'Conventional', status: 'Withdrawn', parties: 32, entryInForce: '2002', purpose: 'Allow unarmed aerial surveillance flights over member territories for transparency', overallHealth: 'Defunct', keyCompliers: ['Remaining EU members'], keyViolators: ['Russia (restricted flights)','USA (withdrew 2020)','Russia (withdrew 2021)'], recentDevelopment: 'USA and Russia both withdrew; treaty effectively dead; European members still operating within the remainder' },
  { id: 'T007', name: 'Treaty on the Prohibition of Nuclear Weapons', abbreviation: 'TPNW', domain: 'Nuclear', status: 'In Force', parties: 93, entryInForce: '2021', purpose: 'Comprehensive ban on nuclear weapons; complementary to NPT', overallHealth: 'Weakening', keyCompliers: ['Austria','New Zealand','Mexico','Ireland'], keyViolators: ['All P5 nations (non-signatories)','All NATO members (non-signatories)'], recentDevelopment: 'No nuclear power or NATO ally has joined; symbolic but excluded from key actors; 2nd Meeting of States Parties 2023' },
  { id: 'T008', name: 'Outer Space Treaty', abbreviation: 'OST', domain: 'Space', status: 'In Force', parties: 114, entryInForce: '1967', purpose: 'Prohibit WMD in space; Moon/planets free for all; no national appropriation of space', overallHealth: 'Weakening', keyCompliers: ['USA','EU members','Japan'], keyViolators: ['Russia (ASAT test 2021: debris field)','China (ASAT test 2007: debris field)','Russia (nuclear satellite GLONASS militarization)'], recentDevelopment: 'Russia developing nuclear ASAT system (COSMOS-2553); China FOBS test 2021; OST gaps on conventional weapons in orbit exploited' },
  { id: 'T009', name: 'UN Convention on the Law of the Sea', abbreviation: 'UNCLOS', domain: 'Conventional', status: 'In Force', parties: 168, entryInForce: '1994', purpose: 'Define rights and responsibilities in ocean use; EEZ; territorial waters; seabed', overallHealth: 'Weakening', keyCompliers: ['EU members','Japan','Australia','Philippines'], keyViolators: ['China (nine-dash line; UNCLOS tribunal ruling ignored 2016)','USA (non-signatory)'], recentDevelopment: 'China coast guard harassment of Philippines in SCS; Hague tribunal ruling ignored; Arctic sovereignty disputes; Red Sea freedom of navigation ops' },
  { id: 'T010', name: 'Paris Agreement', abbreviation: 'Paris', domain: 'Environment', status: 'In Force', parties: 195, entryInForce: '2016', purpose: 'Limit global warming to 1.5-2 degrees C above pre-industrial levels through NDCs', overallHealth: 'Weakening', keyCompliers: ['EU','UK','Canada','Japan'], keyViolators: ['USA (withdrew 2025 under Trump)','Brazil (under Bolsonaro)','No country on track for 1.5 degrees C'], recentDevelopment: 'COP29 2024: $300B climate finance pledged (below $1T developing country demand); Trump withdrew USA Jan 2025; global emissions still rising' },
];

const COMPLIANCE: ComplianceRecord[] = [
  { id: 'CR001', country: 'Russia', treaty: 'CWC', rating: 'Non-Compliant', issue: 'Novichok use against Sergei Skripal (2018) and Alexei Navalny (2020) on British soil and in Russia', yearReported: '2018', ongoing: false },
  { id: 'CR002', country: 'Russia', treaty: 'New START', rating: 'Non-Compliant', issue: 'Suspended treaty participation Feb 2023; ceased inspections; refused data exchanges', yearReported: '2023', ongoing: true },
  { id: 'CR003', country: 'China', treaty: 'UNCLOS', rating: 'Non-Compliant', issue: 'Nine-dash line; ignored 2016 Permanent Court of Arbitration ruling; island-building in Spratlys', yearReported: '2016', ongoing: true },
  { id: 'CR004', country: 'Syria', treaty: 'CWC', rating: 'Non-Compliant', issue: 'Multiple confirmed sarin and chlorine attacks 2013-2018; OPCW investigation confirmed; Syria denies', yearReported: '2013', ongoing: false },
  { id: 'CR005', country: 'Iran', treaty: 'NPT', rating: 'Non-Compliant', issue: 'Uranium enrichment to 60%+ (weapon-grade threshold 90%); blocked IAEA inspections; reduced transparency', yearReported: '2019', ongoing: true },
  { id: 'CR006', country: 'North Korea', treaty: 'NPT', rating: 'Non-Compliant', issue: 'Withdrew from NPT 2003; conducted 6 nuclear tests; estimated 40-50 warheads; ICBM development', yearReported: '2003', ongoing: true },
  { id: 'CR007', country: 'Russia', treaty: 'INF', rating: 'Non-Compliant', issue: '9M729 (SSC-8) cruise missile violates INF range limits; US assessment confirmed by NATO 2019', yearReported: '2014', ongoing: true },
  { id: 'CR008', country: 'USA', treaty: 'Paris', rating: 'Non-Compliant', issue: 'President Trump signed executive order withdrawing USA from Paris Agreement Jan 2025', yearReported: '2025', ongoing: true },
];

export function computeGlobalComplianceScore(records: ComplianceRecord[]): number {
  if (!records.length) return 100;
  const violations = records.filter(r => r.rating === 'Non-Compliant').length;
  const partial = records.filter(r => r.rating === 'Partial').length;
  const penalty = violations * 10 + partial * 3;
  return Math.max(0, 100 - penalty);
}

export function getInForceTreaties(treaties: Treaty[]): Treaty[] {
  return treaties.filter(t => t.status === 'In Force');
}

export function getCriticalHealthTreaties(treaties: Treaty[]): Treaty[] {
  return treaties.filter(t => t.overallHealth === 'Critical' || t.overallHealth === 'Defunct');
}

export function getNonCompliantRecords(records: ComplianceRecord[]): ComplianceRecord[] {
  return records.filter(r => r.rating === 'Non-Compliant');
}

export function getOngoingViolations(records: ComplianceRecord[]): ComplianceRecord[] {
  return records.filter(r => r.ongoing && r.rating === 'Non-Compliant');
}

export function getByDomain(treaties: Treaty[], domain: TreatyDomain): Treaty[] {
  return treaties.filter(t => t.domain === domain);
}

export function rankByHealth(treaties: Treaty[]): Treaty[] {
  const order: Record<string, number> = { Defunct: 0, Critical: 1, Weakening: 2, Strong: 3 };
  return [...treaties].sort((a, b) => (order[a.overallHealth] ?? 2) - (order[b.overallHealth] ?? 2));
}

export function healthClass(health: Treaty['overallHealth']): string {
  const m: Record<string, string> = { Strong: 'treaty-strong', Weakening: 'treaty-weakening', Critical: 'treaty-critical', Defunct: 'treaty-defunct' };
  return m[health] ?? 'treaty-weakening';
}

export function complianceClass(rating: ComplianceRating): string {
  const m: Record<ComplianceRating, string> = { Compliant: 'comp-ok', Partial: 'comp-partial', 'Non-Compliant': 'comp-fail', Unknown: 'comp-unknown', 'N/A (Non-Member)': 'comp-na' };
  return m[rating] ?? 'comp-unknown';
}

export function statusClass(status: TreatyStatus): string {
  const m: Record<TreatyStatus, string> = { 'In Force': 'status-active', Suspended: 'status-suspended', Withdrawn: 'status-withdrawn', Expired: 'status-expired', 'Under Negotiation': 'status-negotiating' };
  return m[status] ?? 'status-active';
}

export function buildRenderData(): TreatyData {
  return {
    treaties: TREATIES,
    compliance: COMPLIANCE,
    globalComplianceScore: computeGlobalComplianceScore(COMPLIANCE),
    inForceCount: getInForceTreaties(TREATIES).length,
    criticalHealthCount: getCriticalHealthTreaties(TREATIES).length,
    majorViolationCount: getNonCompliantRecords(COMPLIANCE).length,
    nonCompliantRecords: getNonCompliantRecords(COMPLIANCE),
  };
}
