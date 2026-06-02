// tech-transfer-risk-helpers.ts
// Pure logic for TechTransferRiskPanel — no DOM, no Panel imports

export type CaseStatus = 'Active' | 'Prosecuted' | 'Sanctioned' | 'Under Investigation' | 'Blocked';
export type RiskLevel = 'Critical' | 'High' | 'Medium' | 'Low';
export type TechCategory =
  | 'Semiconductors'
  | 'AI/ML'
  | 'Quantum'
  | 'Biotech'
  | 'Hypersonics'
  | 'Radar/DEW'
  | 'Nuclear'
  | 'Space';
export type ActorType = 'State' | 'State-Proxied' | 'Commercial' | 'Academic';

export interface TechTransferCase {
  id: string;
  date: string;
  title: string;
  description: string;
  actorCountry: string;
  targetTech: TechCategory[];
  actorType: ActorType;
  status: CaseStatus;
  riskLevel: RiskLevel;
  transferMethod: string;
  estimatedImpact: string;
}

export interface BISEntityEntry {
  id: string;
  entity: string;
  country: string;
  addedDate: string;
  reason: string;
  techCategory: TechCategory[];
}

export interface TechSector {
  id: string;
  name: TechCategory;
  leakageRisk: number; // 0-100
  primaryThreats: string[];
  recentIncidents: number;
  controlledBy: string[];
  criticalityScore: number; // 0-10
}

export interface ExportControlScore {
  country: string;
  complianceScore: number; // 0-100, higher = more compliant
  entityListEntries: number;
  violations2024: number;
  multilateralMemberships: string[];
}

export interface TechTransferRenderData {
  cases: TechTransferCase[];
  bisEntries: BISEntityEntry[];
  sectors: TechSector[];
  exportScores: ExportControlScore[];
  globalRiskIndex: number;
  activeCases: number;
  criticalCases: number;
  sanctionedEntities: number;
  highRiskSectors: TechSector[];
}

// ── Static data ───────────────────────────────────────────────────────────────

const CASES: TechTransferCase[] = [
  {
    id: 'TT001',
    date: '2023-09',
    title: 'Huawei Mate 60 Pro — TSMC 7nm Chips',
    description: "Huawei's Mate 60 Pro smartphone revealed to contain TSMC-fabricated 7nm chips (Kirin 9000s) despite BIS export restrictions. TSMC halted shipments after US pressure; investigation found chips sourced via intermediary front companies in China.",
    actorCountry: 'China',
    targetTech: ['Semiconductors', 'AI/ML'],
    actorType: 'State-Proxied',
    status: 'Under Investigation',
    riskLevel: 'Critical',
    transferMethod: 'Front companies / order misrepresentation',
    estimatedImpact: 'Accelerated Chinese 5G deployment; demonstrated viability of export control circumvention at scale',
  },
  {
    id: 'TT002',
    date: '2023-10',
    title: 'ASML EUV Export Licence Revocation — Netherlands/China',
    description: "Netherlands revoked ASML's export licence for EUV lithography machines to China under US diplomatic pressure. China's SMIC blocked from acquiring EUV tools needed for sub-7nm nodes; ASML DUV shipments also restricted for advanced nodes.",
    actorCountry: 'China',
    targetTech: ['Semiconductors'],
    actorType: 'State',
    status: 'Blocked',
    riskLevel: 'Critical',
    transferMethod: 'Commercial sale — blocked by export licence denial',
    estimatedImpact: 'SMIC constrained to 7nm using multi-patterning DUV; estimated 3-5 year delay in Chinese leading-edge node capability',
  },
  {
    id: 'TT003',
    date: '2024-01',
    title: 'Nvidia H100/A100 GPU Smuggling via Singapore, Malaysia',
    description: 'US Commerce Dept investigation found Nvidia H100 and A100 GPUs being diverted to Chinese AI firms via third-country transshipment through Singapore, Malaysia, and UAE. Multiple freight forwarders and shell companies involved. Estimated thousands of units reached restricted end-users.',
    actorCountry: 'China',
    targetTech: ['Semiconductors', 'AI/ML'],
    actorType: 'State-Proxied',
    status: 'Under Investigation',
    riskLevel: 'Critical',
    transferMethod: 'Third-country transshipment / freight forwarder networks',
    estimatedImpact: 'Chinese AI training capacity boosted; directly enables PLA AI development programs',
  },
  {
    id: 'TT004',
    date: '2023-05',
    title: 'Russia Western Microelectronics via UAE, Turkey, Armenia',
    description: 'US and EU-origin microelectronics — including Texas Instruments chips, Intel components, and Analog Devices parts — found in destroyed Russian military equipment in Ukraine. Components sourced via UAE, Turkey, Armenia, and Kazakhstan as transshipment hubs despite sanctions.',
    actorCountry: 'Russia',
    targetTech: ['Semiconductors', 'Radar/DEW'],
    actorType: 'State',
    status: 'Active',
    riskLevel: 'Critical',
    transferMethod: 'Sanctions evasion via third-country transshipment',
    estimatedImpact: 'Sustained Russian precision munitions and Kh-101 cruise missile production; >$1B in restricted goods estimated transferred 2022-2024',
  },
  {
    id: 'TT005',
    date: '2022-11',
    title: 'Iran Shahed-136 Drone Tech — Chinese/Russian Components',
    description: 'IAEA and UK forensic analysis of Iranian Shahed-136 loitering munitions used in Ukraine found Chinese-origin navigation chips and Russian engine components. Iran leveraging China as component supplier for drone fleet sold to Russia.',
    actorCountry: 'Iran',
    targetTech: ['Semiconductors', 'Radar/DEW'],
    actorType: 'State',
    status: 'Active',
    riskLevel: 'High',
    transferMethod: 'State-to-state transfer via China intermediary',
    estimatedImpact: 'Enabled Iranian drone export to Russia; ~3,000+ Shaheds transferred to Russia for Ukraine campaign; threatens NATO air defense saturation',
  },
  {
    id: 'TT006',
    date: '2023-07',
    title: 'China Military-Civil Fusion — AI Chip Procurement for PLA',
    description: 'Commerce Dept identified Chinese MCF entities acquiring Nvidia A800/H800 chips (designed to comply with export rules) and reprogramming them for unrestricted military AI use. Companies including Biren Technology and Cambricon identified as PLA-linked.',
    actorCountry: 'China',
    targetTech: ['AI/ML', 'Semiconductors'],
    actorType: 'State',
    status: 'Sanctioned',
    riskLevel: 'Critical',
    transferMethod: 'Military-civil fusion entity acquisition of nominally commercial chips',
    estimatedImpact: 'Accelerated PLA AI logistics, targeting, and autonomous systems programs; chips found in hypersonic test facility supply chains',
  },
  {
    id: 'TT007',
    date: '2024-03',
    title: 'Quantum Sensing Tech Leakage via Academic Collaboration',
    description: 'DOJ investigation revealed PLA-affiliated scientists at US and UK universities accessed quantum magnetometer and atomic clock research under civilian pretexts. Papers published jointly contained dual-use navigation and detection IP; researchers returned to NUDT.',
    actorCountry: 'China',
    targetTech: ['Quantum', 'Radar/DEW'],
    actorType: 'Academic',
    status: 'Prosecuted',
    riskLevel: 'High',
    transferMethod: 'Academic collaboration / talent recruitment',
    estimatedImpact: 'Quantum navigation enables GPS-denied precision strike; quantum sensing advances submarine detection capability',
  },
  {
    id: 'TT008',
    date: '2024-06',
    title: 'North Korea Machine Tool Acquisition via Chinese Proxies',
    description: 'UN Panel of Experts documented North Korea acquiring 5-axis CNC machine tools and precision manufacturing equipment through Chinese front companies, enabling domestic ICBM component manufacturing.',
    actorCountry: 'North Korea',
    targetTech: ['Nuclear', 'Hypersonics'],
    actorType: 'State-Proxied',
    status: 'Sanctioned',
    riskLevel: 'Critical',
    transferMethod: 'Chinese front company procurement networks',
    estimatedImpact: 'Enhanced DPRK ICBM reliability and Hwasong-18 solid-fuel motor production; reduces dependence on Russian technical assistance',
  },
  {
    id: 'TT009',
    date: '2023-11',
    title: 'Hypersonic Glide Vehicle Tech — China Insider Theft',
    description: 'FBI charged three Chinese nationals with stealing hypersonic glide vehicle CFD modeling code and materials-science data from a US defense contractor. Thermal protection system material specs and re-entry aerodynamics data were exfiltrated; suspects linked to CASIC.',
    actorCountry: 'China',
    targetTech: ['Hypersonics'],
    actorType: 'State',
    status: 'Prosecuted',
    riskLevel: 'Critical',
    transferMethod: 'Insider theft / cyber exfiltration',
    estimatedImpact: 'Accelerated DF-ZF and DF-17 TPS development; closes US-China gap in maneuvering reentry vehicle technology',
  },
  {
    id: 'TT010',
    date: '2024-02',
    title: 'Russian RF/Radar Components via Central Asia',
    description: 'Kyrgyzstan and Kazakhstan identified as major transshipment points for Western radar components — Analog Devices ADC chips, Pasternack RF modules, Mini-Circuits synthesizers — destined for Russian Krasukha-4 EW systems and Pantsir-S1 air defense.',
    actorCountry: 'Russia',
    targetTech: ['Radar/DEW', 'Semiconductors'],
    actorType: 'State',
    status: 'Active',
    riskLevel: 'High',
    transferMethod: 'Central Asian transshipment corridor',
    estimatedImpact: 'Sustains Russian electronic warfare capability against Ukrainian C2 and NATO SIGINT platforms',
  },
  {
    id: 'TT011',
    date: '2023-08',
    title: 'Biotech Gene-Synthesis Equipment — China Dual-Use Procurement',
    description: 'BIS investigation found Chinese entities acquiring Twist Bioscience and IDT gene synthesis platforms through European intermediaries. Purchasers linked to BGI Genomics and AMMS; equipment capable of synthesizing pathogen-relevant gene sequences.',
    actorCountry: 'China',
    targetTech: ['Biotech'],
    actorType: 'State-Proxied',
    status: 'Under Investigation',
    riskLevel: 'High',
    transferMethod: 'Commercial purchase via European intermediaries',
    estimatedImpact: 'Enhances PLA biodefense and potential offensive biosynthesis capability; BGI genomic data collection compounds intelligence risk',
  },
  {
    id: 'TT012',
    date: '2024-04',
    title: 'SpaceX Raptor Engine Metallurgy Espionage Attempt',
    description: 'FBI counterintelligence disrupted a Chinese MSS-linked operation targeting SpaceX and Aerojet Rocketdyne employees for Raptor engine full-flow staged combustion cycle metallurgy and additive manufacturing specifications.',
    actorCountry: 'China',
    targetTech: ['Space', 'Hypersonics'],
    actorType: 'State',
    status: 'Blocked',
    riskLevel: 'High',
    transferMethod: 'Human intelligence / insider recruitment',
    estimatedImpact: 'Would have accelerated CZ-9 reusable launch vehicle and Long March hypersonic upper stage development',
  },
];

const BIS_ENTITIES: BISEntityEntry[] = [
  {
    id: 'BIS001',
    entity: 'Huawei Technologies Co.',
    country: 'China',
    addedDate: '2019-05-16',
    reason: 'Acting contrary to US national security and foreign policy interests; violations of Iran sanctions; surveillance tech to authoritarian regimes',
    techCategory: ['Semiconductors', 'AI/ML'],
  },
  {
    id: 'BIS002',
    entity: 'Semiconductor Manufacturing International Corp (SMIC)',
    country: 'China',
    addedDate: '2020-12-18',
    reason: 'Risk of diversion to military end-use; produces chips used by PLA; civil-military fusion obligations',
    techCategory: ['Semiconductors'],
  },
  {
    id: 'BIS003',
    entity: 'Biren Technology',
    country: 'China',
    addedDate: '2023-10-17',
    reason: 'GPU developer with PLA ties; acquiring advanced chips for military AI applications under MCF mandate',
    techCategory: ['Semiconductors', 'AI/ML'],
  },
  {
    id: 'BIS004',
    entity: 'Changxin Memory Technologies (CXMT)',
    country: 'China',
    addedDate: '2023-10-17',
    reason: 'DRAM manufacturer using US-origin equipment without licence; potential dual-use military memory supply',
    techCategory: ['Semiconductors'],
  },
  {
    id: 'BIS005',
    entity: 'Yangtze Memory Technologies Corp (YMTC)',
    country: 'China',
    addedDate: '2022-12-16',
    reason: 'NAND flash manufacturer supplying Huawei devices; used US equipment in violation of export controls',
    techCategory: ['Semiconductors'],
  },
  {
    id: 'BIS006',
    entity: 'AECC (Aero Engine Corp of China)',
    country: 'China',
    addedDate: '2023-07-18',
    reason: 'Develops PLA aircraft engines; acquired Western turbine blade alloy compositions and CFD software via academic channels',
    techCategory: ['Hypersonics', 'Space'],
  },
  {
    id: 'BIS007',
    entity: 'Novatek Microelectronics',
    country: 'Russia',
    addedDate: '2023-02-24',
    reason: 'Semiconductor design firm supplying Russian military electronics; circumventing sanctions on microcontrollers',
    techCategory: ['Semiconductors', 'Radar/DEW'],
  },
  {
    id: 'BIS008',
    entity: 'Shahed Aviation Industries',
    country: 'Iran',
    addedDate: '2022-09-08',
    reason: "Manufacturer of Shahed-136 loitering munitions transferred to Russia; incorporates US-origin components",
    techCategory: ['Semiconductors', 'Radar/DEW'],
  },
  {
    id: 'BIS009',
    entity: 'Huludao Huafeng Industry Co.',
    country: 'China',
    addedDate: '2024-01-12',
    reason: 'Front company procuring CNC machine tools and precision equipment for DPRK missile programs via Chinese ports',
    techCategory: ['Nuclear', 'Hypersonics'],
  },
  {
    id: 'BIS010',
    entity: 'BGI Genomics Co.',
    country: 'China',
    addedDate: '2023-03-29',
    reason: 'Genomic data collection posing national security risk; gene synthesis equipment acquisition for dual-use research; PLA-AMMS links',
    techCategory: ['Biotech'],
  },
  {
    id: 'BIS011',
    entity: 'Phytium Technology Co.',
    country: 'China',
    addedDate: '2021-04-08',
    reason: 'CPU designer whose chips used in PLA supercomputers for nuclear weapons simulation and hypersonic design',
    techCategory: ['Semiconductors', 'Nuclear', 'Hypersonics'],
  },
  {
    id: 'BIS012',
    entity: 'Spacety China (Tianjin Lanjian)',
    country: 'China',
    addedDate: '2023-01-27',
    reason: 'Provided satellite imagery of Ukraine to Wagner Group; dual-use remote sensing constellation with PLA applications',
    techCategory: ['Space'],
  },
];

const SECTORS: TechSector[] = [
  {
    id: 'S001',
    name: 'Semiconductors',
    leakageRisk: 92,
    primaryThreats: ['China MCF procurement', 'Third-country transshipment', 'SMIC/Huawei ecosystem'],
    recentIncidents: 8,
    controlledBy: ['US', 'Netherlands', 'Japan', 'Taiwan', 'South Korea'],
    criticalityScore: 10,
  },
  {
    id: 'S002',
    name: 'AI/ML',
    leakageRisk: 85,
    primaryThreats: ['GPU smuggling networks', 'Academic collaboration exploitation', 'Cloud compute arbitrage'],
    recentIncidents: 6,
    controlledBy: ['US', 'UK', 'Canada'],
    criticalityScore: 9,
  },
  {
    id: 'S003',
    name: 'Quantum',
    leakageRisk: 78,
    primaryThreats: ['University research exploitation', 'Talent poaching by China/Russia', 'Component supply chain'],
    recentIncidents: 4,
    controlledBy: ['US', 'UK', 'Germany', 'Japan'],
    criticalityScore: 9,
  },
  {
    id: 'S004',
    name: 'Biotech',
    leakageRisk: 72,
    primaryThreats: ['BGI genomic data collection', 'Gene synthesis equipment diversion', 'Academic journal leakage'],
    recentIncidents: 3,
    controlledBy: ['US', 'UK', 'EU'],
    criticalityScore: 8,
  },
  {
    id: 'S005',
    name: 'Hypersonics',
    leakageRisk: 88,
    primaryThreats: ['Insider threat / cleared contractor espionage', 'CFD code theft', 'Materials-science exfiltration'],
    recentIncidents: 5,
    controlledBy: ['US', 'Russia', 'China'],
    criticalityScore: 10,
  },
  {
    id: 'S006',
    name: 'Radar/DEW',
    leakageRisk: 80,
    primaryThreats: ['RF component smuggling via Central Asia', 'Iranian drone program proliferation', 'Chinese EW reverse-engineering'],
    recentIncidents: 5,
    controlledBy: ['US', 'UK', 'Israel', 'Russia'],
    criticalityScore: 8,
  },
  {
    id: 'S007',
    name: 'Nuclear',
    leakageRisk: 65,
    primaryThreats: ['DPRK machine tool procurement', 'AQ Khan network legacy nodes', 'Iranian centrifuge component sourcing'],
    recentIncidents: 2,
    controlledBy: ['US', 'UK', 'France', 'Russia', 'IAEA/NSG'],
    criticalityScore: 10,
  },
  {
    id: 'S008',
    name: 'Space',
    leakageRisk: 70,
    primaryThreats: ['ASAT technology espionage', 'Satellite imagery sale to adversaries', 'Launch vehicle metallurgy theft'],
    recentIncidents: 3,
    controlledBy: ['US', 'EU', 'Russia', 'China'],
    criticalityScore: 8,
  },
];

const EXPORT_SCORES: ExportControlScore[] = [
  { country: 'United States', complianceScore: 95, entityListEntries: 1650, violations2024: 12, multilateralMemberships: ['Wassenaar', 'NSG', 'MTCR', 'AG', 'Australia Group'] },
  { country: 'Netherlands', complianceScore: 88, entityListEntries: 0, violations2024: 1, multilateralMemberships: ['Wassenaar', 'NSG', 'MTCR', 'AG'] },
  { country: 'Japan', complianceScore: 86, entityListEntries: 0, violations2024: 2, multilateralMemberships: ['Wassenaar', 'NSG', 'MTCR', 'AG'] },
  { country: 'Germany', complianceScore: 83, entityListEntries: 0, violations2024: 3, multilateralMemberships: ['Wassenaar', 'NSG', 'MTCR', 'AG'] },
  { country: 'United Kingdom', complianceScore: 84, entityListEntries: 0, violations2024: 2, multilateralMemberships: ['Wassenaar', 'NSG', 'MTCR', 'AG'] },
  { country: 'South Korea', complianceScore: 79, entityListEntries: 0, violations2024: 4, multilateralMemberships: ['Wassenaar', 'NSG', 'MTCR'] },
  { country: 'Taiwan', complianceScore: 81, entityListEntries: 0, violations2024: 3, multilateralMemberships: ['Wassenaar (observer)'] },
  { country: 'France', complianceScore: 80, entityListEntries: 0, violations2024: 5, multilateralMemberships: ['Wassenaar', 'NSG', 'MTCR', 'AG'] },
  { country: 'Israel', complianceScore: 68, entityListEntries: 0, violations2024: 7, multilateralMemberships: ['Wassenaar (partial)', 'MTCR'] },
  { country: 'China', complianceScore: 14, entityListEntries: 0, violations2024: 87, multilateralMemberships: ['NSG (member, limited compliance)'] },
  { country: 'Russia', complianceScore: 11, entityListEntries: 0, violations2024: 120, multilateralMemberships: ['Wassenaar (suspended)', 'NSG (suspended)'] },
  { country: 'Iran', complianceScore: 4, entityListEntries: 0, violations2024: 210, multilateralMemberships: [] },
];

// ── Helper functions ──────────────────────────────────────────────────────────

export function getHighRiskSectors(sectors: TechSector[], threshold = 75): TechSector[] {
  return sectors.filter(s => s.leakageRisk >= threshold);
}

export function getActiveInvestigations(cases: TechTransferCase[]): TechTransferCase[] {
  return cases.filter(c => c.status === 'Active' || c.status === 'Under Investigation');
}

export function getTechLeakageScore(sectors: TechSector[]): number {
  if (!sectors.length) return 0;
  const avg = sectors.reduce((sum, s) => sum + s.leakageRisk, 0) / sectors.length;
  return Math.min(100, Math.round(avg));
}

export function rankByRisk(cases: TechTransferCase[]): TechTransferCase[] {
  const order: Record<RiskLevel, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  return [...cases].sort((a, b) => order[a.riskLevel] - order[b.riskLevel]);
}

export function sectorRiskClass(risk: number): string {
  if (risk >= 85) return 'ttr-critical';
  if (risk >= 70) return 'ttr-high';
  if (risk >= 50) return 'ttr-medium';
  return 'ttr-low';
}

export function caseStatusClass(status: CaseStatus): string {
  const map: Record<CaseStatus, string> = {
    Active: 'ttr-status-active',
    Prosecuted: 'ttr-status-prosecuted',
    Sanctioned: 'ttr-status-sanctioned',
    'Under Investigation': 'ttr-status-investigating',
    Blocked: 'ttr-status-blocked',
  };
  return map[status] ?? 'ttr-status-active';
}

export function riskLevelClass(level: RiskLevel): string {
  const map: Record<RiskLevel, string> = {
    Critical: 'ttr-risk-critical',
    High: 'ttr-risk-high',
    Medium: 'ttr-risk-medium',
    Low: 'ttr-risk-low',
  };
  return map[level] ?? 'ttr-risk-medium';
}

export function complianceClass(score: number): string {
  if (score >= 80) return 'ttr-comply-good';
  if (score >= 50) return 'ttr-comply-moderate';
  if (score >= 20) return 'ttr-comply-poor';
  return 'ttr-comply-rogue';
}

export function computeGlobalRiskIndex(cases: TechTransferCase[], sectors: TechSector[]): number {
  if (!cases.length && !sectors.length) return 0;
  const caseScore = cases.length
    ? cases.reduce((s, c) => {
        const w: Record<RiskLevel, number> = { Critical: 10, High: 7, Medium: 4, Low: 1 };
        return s + w[c.riskLevel];
      }, 0) / cases.length
    : 0;
  const sectorScore = sectors.length
    ? sectors.reduce((s, sec) => s + sec.leakageRisk, 0) / sectors.length / 10
    : 0;
  return Math.min(100, Math.round((caseScore * 5 + sectorScore * 5)));
}

export function buildRenderData(): TechTransferRenderData {
  const globalRiskIndex = computeGlobalRiskIndex(CASES, SECTORS);
  return {
    cases: CASES,
    bisEntries: BIS_ENTITIES,
    sectors: SECTORS,
    exportScores: EXPORT_SCORES,
    globalRiskIndex,
    activeCases: getActiveInvestigations(CASES).length,
    criticalCases: CASES.filter(c => c.riskLevel === 'Critical').length,
    sanctionedEntities: BIS_ENTITIES.length,
    highRiskSectors: getHighRiskSectors(SECTORS),
  };
}
