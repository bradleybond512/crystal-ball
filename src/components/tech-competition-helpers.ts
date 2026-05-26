/**
 * Pure helper functions and static data for TechCompetitionPanel.
 *
 * Side-effect-free so unit tests can import them without DOM or live
 * services. The panel covers seven tech-competition surfaces:
 *   1. Semiconductor export control events
 *   2. AI compute restriction signals
 *   3. 5G infrastructure battles by country
 *   4. Quantum computing milestone tracker
 *   5. Tech decoupling indicators
 *   6. Dual-use tech transfer cases
 *   7. Chip fab capacity distribution
 */

// ── Shared types ─────────────────────────────────────────────────────────

export type TechSeverity = 'low' | 'medium' | 'high' | 'critical';

export type TechPosture = 'open' | 'cautious' | 'restricted' | 'blocked';

// ── 1. Semiconductor export control events ───────────────────────────────

export type ExportControlScope = 'eda_tools' | 'lithography' | 'advanced_logic' | 'memory_hbm' | 'wide_bandgap' | 'packaging';

export interface ExportControlEvent {
  issuingCountry: string;
  targetCountry: string;
  scope: ExportControlScope;
  severity: TechSeverity;
  /** ISO date the control was announced. */
  announcedAt: string;
  /** Human-readable rule reference (e.g. "BIS Oct 7 rule"). */
  reference: string;
  detail: string;
}

// ── 2. AI compute restriction signals ────────────────────────────────────

export type AiRestrictionKind = 'gpu_export_ban' | 'cluster_size_cap' | 'cloud_access_ban' | 'model_weights_ban' | 'license_required';

export interface AiComputeRestriction {
  kind: AiRestrictionKind;
  issuingCountry: string;
  targetCountry: string;
  severity: TechSeverity;
  /** Approximate ceiling, e.g. TFLOPS or H100-equivalents. -1 if unbounded. */
  thresholdValue: number;
  thresholdUnit: string;
  detail: string;
}

// ── 3. 5G infrastructure battles by country ──────────────────────────────

export type FiveGVendor = 'huawei' | 'zte' | 'ericsson' | 'nokia' | 'samsung' | 'mixed' | 'banned';

export interface FiveGCountryStatus {
  countryCode: string;
  countryName: string;
  /** Whether Huawei/ZTE equipment is permitted in RAN. */
  huaweiPosture: TechPosture;
  primaryVendor: FiveGVendor;
  /** Percent of population covered by 5G, 0-100. */
  coveragePct: number;
  note: string;
}

// ── 4. Quantum computing milestones ──────────────────────────────────────

export type QuantumMilestoneKind = 'qubit_count' | 'error_correction' | 'quantum_advantage' | 'commercial_service' | 'cryptanalytic_demo';

export interface QuantumMilestone {
  org: string;
  countryCode: string;
  kind: QuantumMilestoneKind;
  /** Claimed physical or logical qubit count, -1 if not applicable. */
  qubits: number;
  /** ISO date of the milestone announcement. */
  announcedAt: string;
  /** Whether the claim has been peer-reviewed or independently verified. */
  peerReviewed: boolean;
  detail: string;
}

// ── 5. Tech decoupling indicators ────────────────────────────────────────

export type DecouplingDomain = 'investment_screening' | 'visa_research' | 'data_localization' | 'app_ban' | 'standards_split' | 'supply_chain_exit';

export type DecouplingTrend = 'rising' | 'stable' | 'falling';

export interface DecouplingIndicator {
  domain: DecouplingDomain;
  countryPair: string;
  /** Index 0-100; higher means more decoupled. */
  intensity: number;
  /** Direction of change vs prior quarter. */
  trend: DecouplingTrend;
  detail: string;
}

// ── 6. Dual-use tech transfer cases ──────────────────────────────────────

export type DualUseDomain = 'semiconductors' | 'aerospace' | 'biotech' | 'quantum' | 'ai_models' | 'cyber_tools';

export interface DualUseTransferCase {
  caseId: string;
  domain: DualUseDomain;
  originCountry: string;
  destinationCountry: string;
  severity: TechSeverity;
  status: 'investigation' | 'indictment' | 'conviction' | 'sanctioned';
  detail: string;
}

// ── 7. Chip fab capacity distribution ────────────────────────────────────

export interface ChipFabCapacity {
  countryCode: string;
  countryName: string;
  /** Sub-10nm wafer starts per month, normalized 0-100 share of global. */
  leadingEdgeShare: number;
  /** Mature node (28nm+) share, 0-100. */
  matureNodeShare: number;
  /** Number of operational sub-7nm fabs. */
  leadingEdgeFabs: number;
  note: string;
}

// ── Color and label helpers ──────────────────────────────────────────────

export function severityColor(s: TechSeverity): string {
  switch (s) {
    case 'critical': { return '#b71c1c';
    }
    case 'high': {     return '#e53935';
    }
    case 'medium': {   return '#fb8c00';
    }
    case 'low': {      return '#fdd835';
    }
  }
}

export function postureColor(p: TechPosture): string {
  switch (p) {
    case 'blocked': {    return '#b71c1c';
    }
    case 'restricted': { return '#e53935';
    }
    case 'cautious': {   return '#fb8c00';
    }
    case 'open': {       return '#43a047';
    }
  }
}

export function postureLabel(p: TechPosture): string {
  switch (p) {
    case 'blocked': {    return 'Blocked';
    }
    case 'restricted': { return 'Restricted';
    }
    case 'cautious': {   return 'Cautious';
    }
    case 'open': {       return 'Open';
    }
  }
}

export function exportScopeLabel(s: ExportControlScope): string {
  switch (s) {
    case 'eda_tools': {      return 'EDA Tools';
    }
    case 'lithography': {    return 'Lithography';
    }
    case 'advanced_logic': { return 'Advanced Logic';
    }
    case 'memory_hbm': {     return 'HBM Memory';
    }
    case 'wide_bandgap': {   return 'Wide-Bandgap';
    }
    case 'packaging': {      return 'Advanced Packaging';
    }
  }
}

export function aiRestrictionLabel(k: AiRestrictionKind): string {
  switch (k) {
    case 'gpu_export_ban': {   return 'GPU Export Ban';
    }
    case 'cluster_size_cap': { return 'Cluster Size Cap';
    }
    case 'cloud_access_ban': { return 'Cloud Access Ban';
    }
    case 'model_weights_ban': { return 'Model Weights Ban';
    }
    case 'license_required': { return 'License Required';
    }
  }
}

export function vendorLabel(v: FiveGVendor): string {
  switch (v) {
    case 'huawei': {    return 'Huawei';
    }
    case 'zte': {       return 'ZTE';
    }
    case 'ericsson': {  return 'Ericsson';
    }
    case 'nokia': {     return 'Nokia';
    }
    case 'samsung': {   return 'Samsung';
    }
    case 'mixed': {     return 'Mixed Vendors';
    }
    case 'banned': {    return 'CN Vendors Banned';
    }
  }
}

export function quantumMilestoneLabel(k: QuantumMilestoneKind): string {
  switch (k) {
    case 'qubit_count': {        return 'Qubit Count';
    }
    case 'error_correction': {   return 'Error Correction';
    }
    case 'quantum_advantage': {  return 'Quantum Advantage';
    }
    case 'commercial_service': { return 'Commercial Service';
    }
    case 'cryptanalytic_demo': { return 'Cryptanalytic Demo';
    }
  }
}

export function decouplingDomainLabel(d: DecouplingDomain): string {
  switch (d) {
    case 'investment_screening': { return 'Investment Screening';
    }
    case 'visa_research': {        return 'Researcher Visas';
    }
    case 'data_localization': {    return 'Data Localization';
    }
    case 'app_ban': {              return 'App Bans';
    }
    case 'standards_split': {      return 'Standards Split';
    }
    case 'supply_chain_exit': {    return 'Supply Chain Exit';
    }
  }
}

export function dualUseDomainLabel(d: DualUseDomain): string {
  switch (d) {
    case 'semiconductors': { return 'Semiconductors';
    }
    case 'aerospace': {      return 'Aerospace';
    }
    case 'biotech': {        return 'Biotech';
    }
    case 'quantum': {        return 'Quantum';
    }
    case 'ai_models': {      return 'AI Models';
    }
    case 'cyber_tools': {    return 'Cyber Tools';
    }
  }
}

export function trendArrow(t: DecouplingTrend): string {
  switch (t) {
    case 'rising': {  return '↑';
    }
    case 'stable': {  return '→';
    }
    case 'falling': { return '↓';
    }
  }
}

export function trendColor(t: DecouplingTrend): string {
  switch (t) {
    case 'rising': {  return '#e53935';
    }
    case 'stable': {  return '#9e9e9e';
    }
    case 'falling': { return '#43a047';
    }
  }
}

// ── Aggregate counts ─────────────────────────────────────────────────────

export function countSevereExportControls(events: readonly ExportControlEvent[]): number {
  return events.filter((e) => e.severity === 'critical' || e.severity === 'high').length;
}

export function countActiveAiRestrictions(restrictions: readonly AiComputeRestriction[]): number {
  return restrictions.filter((r) => r.severity === 'critical' || r.severity === 'high').length;
}

export function countBlockedHuaweiMarkets(status: readonly FiveGCountryStatus[]): number {
  return status.filter((s) => s.huaweiPosture === 'blocked' || s.huaweiPosture === 'restricted').length;
}

export function countVerifiedQuantumMilestones(milestones: readonly QuantumMilestone[]): number {
  return milestones.filter((m) => m.peerReviewed).length;
}

export function countHighDecouplingPairs(indicators: readonly DecouplingIndicator[]): number {
  return indicators.filter((i) => i.intensity >= 60).length;
}

export function countActiveTransferCases(cases: readonly DualUseTransferCase[]): number {
  return cases.filter((c) => c.status !== 'sanctioned').length;
}

export function leadingEdgeShareTotal(fabs: readonly ChipFabCapacity[]): number {
  return fabs.reduce((acc, f) => acc + f.leadingEdgeShare, 0);
}

/**
 * Total panel badge count: number of meaningfully escalated surfaces across
 * all seven sections. Static-data-only baseline.
 */
export function totalEscalationCount(input: {
  exportControls: readonly ExportControlEvent[];
  aiRestrictions: readonly AiComputeRestriction[];
  fiveG: readonly FiveGCountryStatus[];
  quantum: readonly QuantumMilestone[];
  decoupling: readonly DecouplingIndicator[];
  transfers: readonly DualUseTransferCase[];
}): number {
  return (
    countSevereExportControls(input.exportControls) +
    countActiveAiRestrictions(input.aiRestrictions) +
    countBlockedHuaweiMarkets(input.fiveG) +
    countVerifiedQuantumMilestones(input.quantum) +
    countHighDecouplingPairs(input.decoupling) +
    countActiveTransferCases(input.transfers)
  );
}

// ── Static data (representative real-world inventory) ────────────────────

export const EXPORT_CONTROL_EVENTS: ExportControlEvent[] = [
  {
    issuingCountry: 'US',
    targetCountry: 'CN',
    scope: 'advanced_logic',
    severity: 'critical',
    announcedAt: '2022-10-07',
    reference: 'BIS Oct 7 rule',
    detail: 'Prohibits export of sub-14nm logic chips and SME to China without license',
  },
  {
    issuingCountry: 'US',
    targetCountry: 'CN',
    scope: 'eda_tools',
    severity: 'high',
    announcedAt: '2022-08-12',
    reference: 'BIS EDA rule',
    detail: 'Restricts EDA software for GAA transistor design',
  },
  {
    issuingCountry: 'NL',
    targetCountry: 'CN',
    scope: 'lithography',
    severity: 'critical',
    announcedAt: '2023-06-30',
    reference: 'Dutch DUV regulation',
    detail: 'ASML DUV immersion lithography tools require export license',
  },
  {
    issuingCountry: 'JP',
    targetCountry: 'CN',
    scope: 'lithography',
    severity: 'high',
    announcedAt: '2023-07-23',
    reference: 'METI 23-item rule',
    detail: '23 categories of semiconductor manufacturing equipment under license',
  },
  {
    issuingCountry: 'US',
    targetCountry: 'CN',
    scope: 'memory_hbm',
    severity: 'high',
    announcedAt: '2024-12-02',
    reference: 'BIS HBM rule',
    detail: 'HBM2e and above to China entity list members blocked',
  },
  {
    issuingCountry: 'CN',
    targetCountry: 'US',
    scope: 'wide_bandgap',
    severity: 'medium',
    announcedAt: '2023-08-01',
    reference: 'MOFCOM gallium/germanium controls',
    detail: 'China restricts gallium and germanium exports — retaliatory measure',
  },
  {
    issuingCountry: 'US',
    targetCountry: 'RU',
    scope: 'advanced_logic',
    severity: 'critical',
    announcedAt: '2022-02-24',
    reference: 'BIS Russia FDPR',
    detail: 'Foreign Direct Product Rule extended to all advanced semiconductors',
  },
];

export const AI_COMPUTE_RESTRICTIONS: AiComputeRestriction[] = [
  {
    kind: 'gpu_export_ban',
    issuingCountry: 'US',
    targetCountry: 'CN',
    severity: 'critical',
    thresholdValue: 4800,
    thresholdUnit: 'TPP',
    detail: 'NVIDIA H100, H200, B100, B200 and equivalents blocked; A800/H800 also caught',
  },
  {
    kind: 'cluster_size_cap',
    issuingCountry: 'US',
    targetCountry: 'global',
    severity: 'high',
    thresholdValue: 100_000,
    thresholdUnit: 'H100-equiv',
    detail: 'Compute thresholds in AI Diffusion framework for tier 2 countries',
  },
  {
    kind: 'cloud_access_ban',
    issuingCountry: 'US',
    targetCountry: 'CN',
    severity: 'high',
    thresholdValue: -1,
    thresholdUnit: 'n/a',
    detail: 'KYC requirements for IaaS providers to prevent SaaS workaround',
  },
  {
    kind: 'model_weights_ban',
    issuingCountry: 'US',
    targetCountry: 'CN',
    severity: 'medium',
    thresholdValue: 1e26,
    thresholdUnit: 'FLOP',
    detail: 'Proposed control on frontier model weights export above 10^26 FLOP training',
  },
  {
    kind: 'license_required',
    issuingCountry: 'EU',
    targetCountry: 'global',
    severity: 'medium',
    thresholdValue: 1e25,
    thresholdUnit: 'FLOP',
    detail: 'AI Act systemic-risk model registration above 10^25 FLOP',
  },
];

export const FIVEG_COUNTRY_STATUS: FiveGCountryStatus[] = [
  {
    countryCode: 'US',
    countryName: 'United States',
    huaweiPosture: 'blocked',
    primaryVendor: 'ericsson',
    coveragePct: 90,
    note: 'Federal rip-and-replace program for small carriers ongoing',
  },
  {
    countryCode: 'GB',
    countryName: 'United Kingdom',
    huaweiPosture: 'blocked',
    primaryVendor: 'nokia',
    coveragePct: 78,
    note: 'Huawei removal deadline 2027 for 5G core',
  },
  {
    countryCode: 'DE',
    countryName: 'Germany',
    huaweiPosture: 'restricted',
    primaryVendor: 'mixed',
    coveragePct: 85,
    note: 'Huawei core gear must be removed by 2026, RAN by 2029',
  },
  {
    countryCode: 'FR',
    countryName: 'France',
    huaweiPosture: 'restricted',
    primaryVendor: 'ericsson',
    coveragePct: 80,
    note: 'Anti-5G law forces vendor diversity in major cities',
  },
  {
    countryCode: 'CN',
    countryName: 'China',
    huaweiPosture: 'open',
    primaryVendor: 'huawei',
    coveragePct: 95,
    note: 'Largest 5G deployment globally; standalone networks majority',
  },
  {
    countryCode: 'IN',
    countryName: 'India',
    huaweiPosture: 'blocked',
    primaryVendor: 'samsung',
    coveragePct: 60,
    note: 'Trusted source rules exclude Chinese vendors',
  },
  {
    countryCode: 'BR',
    countryName: 'Brazil',
    huaweiPosture: 'open',
    primaryVendor: 'mixed',
    coveragePct: 50,
    note: 'No formal Huawei restrictions; Anatel auction outcome',
  },
  {
    countryCode: 'JP',
    countryName: 'Japan',
    huaweiPosture: 'blocked',
    primaryVendor: 'nokia',
    coveragePct: 88,
    note: 'Procurement guidelines effectively bar Chinese vendors',
  },
  {
    countryCode: 'KR',
    countryName: 'South Korea',
    huaweiPosture: 'restricted',
    primaryVendor: 'samsung',
    coveragePct: 95,
    note: 'Samsung dominates; LG U+ uses limited Huawei in some regions',
  },
  {
    countryCode: 'AU',
    countryName: 'Australia',
    huaweiPosture: 'blocked',
    primaryVendor: 'ericsson',
    coveragePct: 82,
    note: 'First Five Eyes country to ban Huawei in 2018',
  },
];

export const QUANTUM_MILESTONES: QuantumMilestone[] = [
  {
    org: 'IBM',
    countryCode: 'US',
    kind: 'qubit_count',
    qubits: 1121,
    announcedAt: '2023-12-04',
    peerReviewed: true,
    detail: 'IBM Condor 1,121-qubit processor with cross-talk improvements',
  },
  {
    org: 'Google Quantum AI',
    countryCode: 'US',
    kind: 'error_correction',
    qubits: 105,
    announcedAt: '2024-12-09',
    peerReviewed: true,
    detail: 'Willow chip below threshold for surface-code error suppression',
  },
  {
    org: 'USTC',
    countryCode: 'CN',
    kind: 'quantum_advantage',
    qubits: 66,
    announcedAt: '2024-04-25',
    peerReviewed: true,
    detail: 'Zuchongzhi 3.0 claims advantage over classical simulation',
  },
  {
    org: 'QuEra',
    countryCode: 'US',
    kind: 'error_correction',
    qubits: 256,
    announcedAt: '2023-12-06',
    peerReviewed: true,
    detail: 'Neutral atom array with 48 logical qubits demonstrated',
  },
  {
    org: 'Origin Quantum',
    countryCode: 'CN',
    kind: 'commercial_service',
    qubits: 72,
    announcedAt: '2024-01-06',
    peerReviewed: false,
    detail: 'Wukong superconducting quantum cloud service launched',
  },
  {
    org: 'PsiQuantum',
    countryCode: 'AU',
    kind: 'qubit_count',
    qubits: -1,
    announcedAt: '2024-04-30',
    peerReviewed: false,
    detail: 'Photonic million-qubit fault-tolerant system targeted for Brisbane',
  },
  {
    org: 'Quantinuum',
    countryCode: 'GB',
    kind: 'error_correction',
    qubits: 56,
    announcedAt: '2024-06-05',
    peerReviewed: true,
    detail: 'H2-1 trapped-ion fidelity benchmark exceeds 99.9%',
  },
];

export const DECOUPLING_INDICATORS: DecouplingIndicator[] = [
  {
    domain: 'investment_screening',
    countryPair: 'US-CN',
    intensity: 82,
    trend: 'rising',
    detail: 'Outbound investment EO covering semiconductors, AI, quantum',
  },
  {
    domain: 'visa_research',
    countryPair: 'US-CN',
    intensity: 67,
    trend: 'rising',
    detail: 'Section 10043 visa restrictions on PLA-affiliated researchers',
  },
  {
    domain: 'data_localization',
    countryPair: 'EU-US',
    intensity: 38,
    trend: 'stable',
    detail: 'Data Privacy Framework restored but still litigated',
  },
  {
    domain: 'app_ban',
    countryPair: 'IN-CN',
    intensity: 75,
    trend: 'stable',
    detail: '>300 Chinese apps banned including TikTok, WeChat, PUBG',
  },
  {
    domain: 'standards_split',
    countryPair: 'US-CN',
    intensity: 54,
    trend: 'rising',
    detail: 'Divergence in AI safety, semiconductors, IoT standards bodies',
  },
  {
    domain: 'supply_chain_exit',
    countryPair: 'US-CN',
    intensity: 48,
    trend: 'rising',
    detail: 'Friend-shoring + IRA + CHIPS Act incentives accelerating exit',
  },
  {
    domain: 'app_ban',
    countryPair: 'US-CN',
    intensity: 62,
    trend: 'rising',
    detail: 'TikTok divestiture law; pending court challenges',
  },
];

export const DUAL_USE_TRANSFER_CASES: DualUseTransferCase[] = [
  {
    caseId: 'DOJ-2024-1145',
    domain: 'semiconductors',
    originCountry: 'US',
    destinationCountry: 'CN',
    severity: 'high',
    status: 'indictment',
    detail: 'NVIDIA H100 GPUs allegedly shipped through Singapore intermediary',
  },
  {
    caseId: 'BIS-2023-0421',
    domain: 'aerospace',
    originCountry: 'US',
    destinationCountry: 'RU',
    severity: 'critical',
    status: 'sanctioned',
    detail: 'Aircraft parts diverted via Turkey and UAE; Entity List addition',
  },
  {
    caseId: 'DOJ-2023-0876',
    domain: 'quantum',
    originCountry: 'US',
    destinationCountry: 'CN',
    severity: 'high',
    status: 'investigation',
    detail: 'IonQ-related know-how transfer under DOJ disruptive technology strike force review',
  },
  {
    caseId: 'BIS-2024-2231',
    domain: 'ai_models',
    originCountry: 'US',
    destinationCountry: 'CN',
    severity: 'medium',
    status: 'investigation',
    detail: 'Frontier model weights allegedly accessed via dummy cloud accounts',
  },
  {
    caseId: 'DOJ-2024-0998',
    domain: 'biotech',
    originCountry: 'US',
    destinationCountry: 'CN',
    severity: 'medium',
    status: 'indictment',
    detail: 'Gene-editing technology trade secret misappropriation indictment',
  },
  {
    caseId: 'EU-2023-0312',
    domain: 'cyber_tools',
    originCountry: 'IL',
    destinationCountry: 'multiple',
    severity: 'high',
    status: 'conviction',
    detail: 'Commercial spyware vendor sanctioned for downstream abuse',
  },
];

export const CHIP_FAB_CAPACITY: ChipFabCapacity[] = [
  {
    countryCode: 'TW',
    countryName: 'Taiwan',
    leadingEdgeShare: 90,
    matureNodeShare: 20,
    leadingEdgeFabs: 6,
    note: 'TSMC Fab 18 dominates sub-5nm; concentration risk in Hsinchu/Tainan',
  },
  {
    countryCode: 'KR',
    countryName: 'South Korea',
    leadingEdgeShare: 8,
    matureNodeShare: 17,
    leadingEdgeFabs: 3,
    note: 'Samsung Pyeongtaek and SK hynix Icheon; memory leadership',
  },
  {
    countryCode: 'US',
    countryName: 'United States',
    leadingEdgeShare: 0,
    matureNodeShare: 10,
    leadingEdgeFabs: 0,
    note: 'TSMC Arizona Fab 21 ramping 4nm 2025; Intel 18A targeted',
  },
  {
    countryCode: 'CN',
    countryName: 'China',
    leadingEdgeShare: 0,
    matureNodeShare: 28,
    leadingEdgeFabs: 0,
    note: 'SMIC 7nm via DUV multi-patterning; mature node expansion accelerating',
  },
  {
    countryCode: 'JP',
    countryName: 'Japan',
    leadingEdgeShare: 0,
    matureNodeShare: 8,
    leadingEdgeFabs: 0,
    note: 'Rapidus 2nm Hokkaido fab targeted for 2027 pilot',
  },
  {
    countryCode: 'EU',
    countryName: 'European Union',
    leadingEdgeShare: 0,
    matureNodeShare: 9,
    leadingEdgeFabs: 0,
    note: 'TSMC Dresden + Intel Magdeburg + GlobalFoundries; EU Chips Act',
  },
  {
    countryCode: 'IL',
    countryName: 'Israel',
    leadingEdgeShare: 2,
    matureNodeShare: 4,
    leadingEdgeFabs: 1,
    note: 'Intel Kiryat Gat Fab 28 + Tower Semiconductor mature nodes',
  },
];

// ── Formatters ───────────────────────────────────────────────────────────

export function formatThreshold(value: number, unit: string): string {
  if (value < 0) return 'unbounded';
  if (unit === 'FLOP') {
    const exp = Math.log10(value);
    return `10^${Math.round(exp)} FLOP`;
  }
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ${unit}`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k ${unit}`;
  return `${value} ${unit}`;
}

export function formatSharePct(pct: number): string {
  if (pct <= 0) return '—';
  if (pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

export function formatQubits(q: number): string {
  if (q < 0) return 'roadmap';
  if (q >= 1000) return `${(q / 1000).toFixed(1)}k`;
  return `${q}`;
}
