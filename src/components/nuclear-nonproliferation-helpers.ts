/**
 * Pure helpers for NuclearNonproliferationPanel.
 *
 * Strictly analytical / security-intelligence monitoring. All static data
 * is a synthetic illustrative seed (the panel is a frame for live feeds;
 * this file makes sure the surface renders deterministically in tests).
 *
 * Sections:
 *   1. NPT / treaty compliance status by country
 *   2. Enrichment program activity indicators
 *   3. IAEA safeguards access events
 *   4. Proliferation network interdictions
 *   5. Dual-use technology transfer alerts
 *   6. Nuclear-capable delivery system developments
 *   7. Radiological / dirty-bomb material security events
 *
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type Severity = 0 | 1 | 2 | 3 | 4;
export type Confidence = 0 | 1 | 2 | 3;

export type TreatyStatus =
  | 'signatory_compliant'
  | 'signatory_non_compliant'
  | 'non_signatory_declared'
  | 'non_signatory_undeclared'
  | 'withdrawn';

export type EnrichmentLevel =
  | 'natural'
  | 'low_enriched'
  | 'highly_enriched'
  | 'weapons_grade';

export type IaeaAccessStatus =
  | 'full_access'
  | 'limited_access'
  | 'denied_access'
  | 'inspection_pending'
  | 'no_agreement';

export type NetworkRole =
  | 'supplier'
  | 'transshipment'
  | 'end_user'
  | 'financier'
  | 'broker';

export type DeliverySystemType =
  | 'ballistic_missile'
  | 'cruise_missile'
  | 'gravity_bomb'
  | 'submarine_launched'
  | 'hypersonic_glide';

export type RadiologicalMaterialType =
  | 'highly_enriched_uranium'
  | 'plutonium'
  | 'cesium_137'
  | 'cobalt_60'
  | 'strontium_90'
  | 'americium_241';

export type AlertStatus =
  | 'monitoring'
  | 'elevated'
  | 'urgent'
  | 'critical';

export type ProgramStage =
  | 'declared_civilian'
  | 'ambiguous'
  | 'suspected_military'
  | 'confirmed_weapons'
  | 'operational';

// ── Interfaces ─────────────────────────────────────────────────────────────

export interface TreatyComplianceRecord {
  country: string;
  treaty: string;
  status: TreatyStatus;
  /** Composite 0–4 compliance concern score. */
  concernScore: Severity;
  lastReviewYear: number;
  keyIssue: string;
}

export interface EnrichmentProgramIndicator {
  country: string;
  facility: string;
  enrichmentLevel: EnrichmentLevel;
  programStage: ProgramStage;
  /** Separative work units per year. */
  estimatedSWU: number;
  alertStatus: AlertStatus;
  confidence: Confidence;
}

export interface IaeaAccessEvent {
  country: string;
  facility: string;
  accessStatus: IaeaAccessStatus;
  severity: Severity;
  daysWithoutAccess: number;
  notes: string;
}

export interface ProliferationNetworkInterdiction {
  networkName: string;
  originCountry: string;
  destinationCountry: string;
  role: NetworkRole;
  materialOrTechnology: string;
  interdicted: boolean;
  severity: Severity;
  confidence: Confidence;
}

export interface DualUseTechnologyAlert {
  technology: string;
  exportingCountry: string;
  receivingCountry: string;
  concernLevel: Severity;
  /** e.g. "NSG", "MTCR", "Wassenaar" */
  flaggedByRegime: string;
  underReview: boolean;
}

export interface DeliverySystemDevelopment {
  country: string;
  systemType: DeliverySystemType;
  programName: string;
  estimatedRangeKm: number;
  stage: ProgramStage;
  alertStatus: AlertStatus;
  confidence: Confidence;
}

export interface RadiologicalSecurityEvent {
  location: string;
  materialType: RadiologicalMaterialType;
  quantityGrams: number;
  secured: boolean;
  severity: Severity;
  confidence: Confidence;
  notes: string;
}

// ── Severity / confidence shared helpers ───────────────────────────────────

export function severityColor(s: Severity): string {
  const colors: Record<Severity, string> = {
    0: 'var(--severity-none,     #9e9e9e)',
    1: 'var(--severity-low,      #4caf50)',
    2: 'var(--severity-medium,   #facc15)',
    3: 'var(--severity-high,     #fb923c)',
    4: 'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function severityLabel(s: Severity): string {
  const labels: Record<Severity, string> = {
    0: 'Minimal',
    1: 'Low',
    2: 'Moderate',
    3: 'High',
    4: 'Critical',
  };
  return labels[s];
}

export function confidenceLabel(c: Confidence): string {
  const labels: Record<Confidence, string> = {
    0: 'Unverified',
    1: 'Low',
    2: 'Moderate',
    3: 'High',
  };
  return labels[c];
}

// ── Treaty status helpers ──────────────────────────────────────────────────

export function treatyStatusColor(s: TreatyStatus): string {
  const colors: Record<TreatyStatus, string> = {
    signatory_compliant:       'var(--severity-low,      #4caf50)',
    signatory_non_compliant:   'var(--severity-critical, #ef4444)',
    non_signatory_declared:    'var(--severity-high,     #fb923c)',
    non_signatory_undeclared:  'var(--severity-critical, #ef4444)',
    withdrawn:                 'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function treatyStatusLabel(s: TreatyStatus): string {
  const labels: Record<TreatyStatus, string> = {
    signatory_compliant:       'Compliant',
    signatory_non_compliant:   'Non-Compliant',
    non_signatory_declared:    'Non-Signatory (Declared)',
    non_signatory_undeclared:  'Non-Signatory (Undeclared)',
    withdrawn:                 'Withdrawn',
  };
  return labels[s];
}

// ── Enrichment level helpers ───────────────────────────────────────────────

export function enrichmentLevelColor(e: EnrichmentLevel): string {
  const colors: Record<EnrichmentLevel, string> = {
    natural:         'var(--severity-none,     #9e9e9e)',
    low_enriched:    'var(--severity-low,      #4caf50)',
    highly_enriched: 'var(--severity-high,     #fb923c)',
    weapons_grade:   'var(--severity-critical, #ef4444)',
  };
  return colors[e];
}

export function enrichmentLevelLabel(e: EnrichmentLevel): string {
  const labels: Record<EnrichmentLevel, string> = {
    natural:         'Natural',
    low_enriched:    'Low-Enriched',
    highly_enriched: 'Highly Enriched',
    weapons_grade:   'Weapons-Grade',
  };
  return labels[e];
}

// ── IAEA access helpers ────────────────────────────────────────────────────

export function iaeaAccessColor(a: IaeaAccessStatus): string {
  const colors: Record<IaeaAccessStatus, string> = {
    full_access:        'var(--severity-low,      #4caf50)',
    limited_access:     'var(--severity-medium,   #facc15)',
    denied_access:      'var(--severity-critical, #ef4444)',
    inspection_pending: 'var(--severity-high,     #fb923c)',
    no_agreement:       'var(--severity-critical, #ef4444)',
  };
  return colors[a];
}

export function iaeaAccessLabel(a: IaeaAccessStatus): string {
  const labels: Record<IaeaAccessStatus, string> = {
    full_access:        'Full Access',
    limited_access:     'Limited',
    denied_access:      'Denied',
    inspection_pending: 'Pending',
    no_agreement:       'No Agreement',
  };
  return labels[a];
}

// ── Alert status helpers ───────────────────────────────────────────────────

export function alertStatusColor(a: AlertStatus): string {
  const colors: Record<AlertStatus, string> = {
    monitoring: 'var(--severity-low,      #4caf50)',
    elevated:   'var(--severity-medium,   #facc15)',
    urgent:     'var(--severity-high,     #fb923c)',
    critical:   'var(--severity-critical, #ef4444)',
  };
  return colors[a];
}

export function alertStatusLabel(a: AlertStatus): string {
  const labels: Record<AlertStatus, string> = {
    monitoring: 'Monitoring',
    elevated:   'Elevated',
    urgent:     'Urgent',
    critical:   'Critical',
  };
  return labels[a];
}

// ── Program stage helpers ──────────────────────────────────────────────────

export function programStageLabel(s: ProgramStage): string {
  const labels: Record<ProgramStage, string> = {
    declared_civilian:  'Declared Civilian',
    ambiguous:          'Ambiguous',
    suspected_military: 'Suspected Military',
    confirmed_weapons:  'Confirmed Weapons',
    operational:        'Operational',
  };
  return labels[s];
}

export function programStageColor(s: ProgramStage): string {
  const colors: Record<ProgramStage, string> = {
    declared_civilian:  'var(--severity-low,      #4caf50)',
    ambiguous:          'var(--severity-medium,   #facc15)',
    suspected_military: 'var(--severity-high,     #fb923c)',
    confirmed_weapons:  'var(--severity-critical, #ef4444)',
    operational:        'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

// ── Delivery system helpers ────────────────────────────────────────────────

export function deliverySystemLabel(d: DeliverySystemType): string {
  const labels: Record<DeliverySystemType, string> = {
    ballistic_missile:  'Ballistic Missile',
    cruise_missile:     'Cruise Missile',
    gravity_bomb:       'Gravity Bomb',
    submarine_launched: 'Submarine-Launched',
    hypersonic_glide:   'Hypersonic Glide',
  };
  return labels[d];
}

// ── Radiological material helpers ──────────────────────────────────────────

export function radiologicalMaterialLabel(m: RadiologicalMaterialType): string {
  const labels: Record<RadiologicalMaterialType, string> = {
    highly_enriched_uranium: 'HEU',
    plutonium:               'Plutonium',
    cesium_137:              'Cs-137',
    cobalt_60:               'Co-60',
    strontium_90:            'Sr-90',
    americium_241:           'Am-241',
  };
  return labels[m];
}

// ── Network role helpers ───────────────────────────────────────────────────

export function networkRoleLabel(r: NetworkRole): string {
  const labels: Record<NetworkRole, string> = {
    supplier:      'Supplier',
    transshipment: 'Transshipment',
    end_user:      'End User',
    financier:     'Financier',
    broker:        'Broker',
  };
  return labels[r];
}

// ── Formatting helpers ─────────────────────────────────────────────────────

export function formatSWU(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M SWU/yr`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k SWU/yr`;
  return `${n} SWU/yr`;
}

export function formatRangeKm(km: number): string {
  if (km >= 1_000) return `${(km / 1_000).toFixed(1)}k km`;
  return `${km} km`;
}

export function formatGrams(g: number): string {
  if (g >= 1_000_000) return `${(g / 1_000_000).toFixed(2)} kg`;
  if (g >= 1_000)     return `${(g / 1_000).toFixed(1)} kg`;
  return `${g} g`;
}

// ── Classifier helpers ─────────────────────────────────────────────────────

/**
 * Derive an alert status from enrichment level and program stage.
 * Weapons-grade enrichment or confirmed/operational program → critical.
 */
export function classifyEnrichmentAlert(
  enrichmentLevel: EnrichmentLevel,
  programStage: ProgramStage,
): AlertStatus {
  if (enrichmentLevel === 'weapons_grade') return 'critical';
  if (enrichmentLevel === 'highly_enriched') {
    if (programStage === 'confirmed_weapons' || programStage === 'operational') return 'critical';
    if (programStage === 'suspected_military') return 'urgent';
    return 'elevated';
  }
  if (programStage === 'confirmed_weapons' || programStage === 'operational') return 'urgent';
  if (programStage === 'suspected_military') return 'elevated';
  return 'monitoring';
}

/**
 * Derive proliferation risk tier (0–4) from network role and interdiction status.
 */
export function proliferationRiskTier(
  role: NetworkRole,
  interdicted: boolean,
  confidence: Confidence,
): Severity {
  if (interdicted) return confidence >= 2 ? 2 : 1;
  const baseRisk: Record<NetworkRole, Severity> = {
    supplier:      4,
    end_user:      4,
    broker:        3,
    financier:     3,
    transshipment: 2,
  };
  const base = baseRisk[role];
  if (confidence === 0) return Math.max(0, base - 2) as Severity;
  if (confidence === 1) return Math.max(0, base - 1) as Severity;
  return base;
}

/**
 * Returns true when an IAEA access event represents a critical safeguards gap.
 */
export function isCriticalSafeguardsGap(event: IaeaAccessEvent): boolean {
  if (event.accessStatus === 'denied_access' && event.daysWithoutAccess > 30) return true;
  if (event.accessStatus === 'no_agreement') return true;
  if (event.severity >= 4) return true;
  return false;
}

// ── Count / aggregation helpers ────────────────────────────────────────────

export function countNonCompliantTreaties(records: TreatyComplianceRecord[]): number {
  return records.filter((r) =>
    r.status === 'signatory_non_compliant' ||
    r.status === 'non_signatory_undeclared' ||
    r.status === 'withdrawn',
  ).length;
}

export function countCriticalEnrichmentPrograms(programs: EnrichmentProgramIndicator[]): number {
  return programs.filter((p) => p.alertStatus === 'critical' || p.alertStatus === 'urgent').length;
}

export function countSafeguardsGaps(events: IaeaAccessEvent[]): number {
  return events.filter(isCriticalSafeguardsGap).length;
}

export function countActiveNetworkThreats(
  interdictions: ProliferationNetworkInterdiction[],
): number {
  return interdictions.filter((i) => !i.interdicted && i.severity >= 3).length;
}

export function countHighConcernDualUse(alerts: DualUseTechnologyAlert[]): number {
  return alerts.filter((a) => a.concernLevel >= 3).length;
}

export function countCriticalDeliverySystems(
  systems: DeliverySystemDevelopment[],
): number {
  return systems.filter(
    (s) => s.alertStatus === 'critical' || s.alertStatus === 'urgent',
  ).length;
}

export function countUnsecuredRadiologicalEvents(
  events: RadiologicalSecurityEvent[],
): number {
  return events.filter((e) => !e.secured && e.severity >= 3).length;
}

export function composeBadgeCount(
  treaties: TreatyComplianceRecord[],
  enrichment: EnrichmentProgramIndicator[],
  iaea: IaeaAccessEvent[],
  networks: ProliferationNetworkInterdiction[],
  dualUse: DualUseTechnologyAlert[],
  delivery: DeliverySystemDevelopment[],
  radiological: RadiologicalSecurityEvent[],
): number {
  return (
    countNonCompliantTreaties(treaties)
    + countCriticalEnrichmentPrograms(enrichment)
    + countSafeguardsGaps(iaea)
    + countActiveNetworkThreats(networks)
    + countHighConcernDualUse(dualUse)
    + countCriticalDeliverySystems(delivery)
    + countUnsecuredRadiologicalEvents(radiological)
  );
}

// ── Static seed data (synthetic, illustrative) ─────────────────────────────

export const TREATY_COMPLIANCE_RECORDS: TreatyComplianceRecord[] = [
  { country: 'DPRK',         treaty: 'NPT', status: 'withdrawn',               concernScore: 4, lastReviewYear: 2023, keyIssue: 'Withdrawal 2003; active weapons program' },
  { country: 'Iran',         treaty: 'NPT', status: 'signatory_non_compliant',  concernScore: 4, lastReviewYear: 2024, keyIssue: 'Enrichment beyond JCPOA limits; IAEA gaps' },
  { country: 'Israel',       treaty: 'NPT', status: 'non_signatory_undeclared', concernScore: 3, lastReviewYear: 2023, keyIssue: 'Undeclared posture; no IAEA safeguards' },
  { country: 'India',        treaty: 'NPT', status: 'non_signatory_declared',   concernScore: 2, lastReviewYear: 2023, keyIssue: 'NSG member; declared posture; CTBT non-signatory' },
  { country: 'Pakistan',     treaty: 'NPT', status: 'non_signatory_declared',   concernScore: 3, lastReviewYear: 2023, keyIssue: 'Tactical weapons doctrine; AQ Khan legacy risk' },
  { country: 'Russia',       treaty: 'NPT', status: 'signatory_compliant',      concernScore: 2, lastReviewYear: 2024, keyIssue: 'New START suspended; modernization program' },
  { country: 'China',        treaty: 'NPT', status: 'signatory_compliant',      concernScore: 2, lastReviewYear: 2024, keyIssue: 'Warhead expansion; modernization acceleration' },
  { country: 'Myanmar',      treaty: 'NPT', status: 'signatory_non_compliant',  concernScore: 3, lastReviewYear: 2023, keyIssue: 'Junta nuclear interest; IAEA safeguards gaps' },
];

export const ENRICHMENT_PROGRAMS: EnrichmentProgramIndicator[] = [
  { country: 'Iran',         facility: 'Fordow / Natanz',  enrichmentLevel: 'highly_enriched', programStage: 'suspected_military', estimatedSWU: 14_000, alertStatus: classifyEnrichmentAlert('highly_enriched', 'suspected_military'), confidence: 3 },
  { country: 'DPRK',         facility: 'Yongbyon',         enrichmentLevel: 'weapons_grade',   programStage: 'operational',        estimatedSWU:  6_000, alertStatus: classifyEnrichmentAlert('weapons_grade',   'operational'),        confidence: 3 },
  { country: 'Saudi Arabia', facility: 'Undisclosed',      enrichmentLevel: 'low_enriched',    programStage: 'ambiguous',          estimatedSWU:    500, alertStatus: classifyEnrichmentAlert('low_enriched',    'ambiguous'),          confidence: 1 },
  { country: 'Russia',       facility: 'Multiple',         enrichmentLevel: 'weapons_grade',   programStage: 'operational',        estimatedSWU: 50_000, alertStatus: classifyEnrichmentAlert('weapons_grade',   'operational'),        confidence: 3 },
  { country: 'Myanmar',      facility: 'Suspected site',   enrichmentLevel: 'natural',         programStage: 'ambiguous',          estimatedSWU:      0, alertStatus: classifyEnrichmentAlert('natural',         'ambiguous'),          confidence: 1 },
];

export const IAEA_ACCESS_EVENTS: IaeaAccessEvent[] = [
  { country: 'Iran',    facility: 'Fordow',          accessStatus: 'limited_access',     severity: 3, daysWithoutAccess:  14, notes: 'Cameras removed; partial reinstatement pending' },
  { country: 'DPRK',   facility: 'Yongbyon',        accessStatus: 'denied_access',      severity: 4, daysWithoutAccess: 365, notes: 'No IAEA presence since 2009' },
  { country: 'Syria',  facility: 'Al-Kibar site',   accessStatus: 'no_agreement',       severity: 4, daysWithoutAccess: 999, notes: 'Destroyed 2007; outstanding IAEA questions' },
  { country: 'Myanmar', facility: 'Suspected site', accessStatus: 'inspection_pending', severity: 3, daysWithoutAccess:  90, notes: 'IAEA request outstanding; no response' },
  { country: 'Iran',   facility: 'Natanz',           accessStatus: 'limited_access',     severity: 3, daysWithoutAccess:  30, notes: 'Enhanced safeguards suspended' },
];

export const PROLIFERATION_NETWORK_INTERDICTIONS: ProliferationNetworkInterdiction[] = [
  { networkName: 'AQ Khan network remnant',  originCountry: 'Pakistan', destinationCountry: 'Iran',    role: 'broker',        materialOrTechnology: 'Centrifuge design data',     interdicted: false, severity: 4, confidence: 2 },
  { networkName: 'Illicit procurement ring', originCountry: 'China',    destinationCountry: 'DPRK',    role: 'supplier',      materialOrTechnology: 'Specialty steel alloys',      interdicted: true,  severity: 4, confidence: 3 },
  { networkName: 'EU-based front company',   originCountry: 'Germany',  destinationCountry: 'Iran',    role: 'transshipment', materialOrTechnology: 'Vacuum pump components',      interdicted: true,  severity: 3, confidence: 3 },
  { networkName: 'Gulf transshipment node',  originCountry: 'UAE',      destinationCountry: 'DPRK',    role: 'transshipment', materialOrTechnology: 'Dual-use electronics',        interdicted: false, severity: 3, confidence: 2 },
  { networkName: 'East Asian broker cell',   originCountry: 'Malaysia', destinationCountry: 'Iran',    role: 'broker',        materialOrTechnology: 'Maraging steel',              interdicted: false, severity: 3, confidence: 2 },
  { networkName: 'Caucasus financing node',  originCountry: 'Georgia',  destinationCountry: 'Iran',    role: 'financier',     materialOrTechnology: 'Trade-based value transfer',  interdicted: true,  severity: 2, confidence: 2 },
];

export const DUAL_USE_TECHNOLOGY_ALERTS: DualUseTechnologyAlert[] = [
  { technology: 'Carbon fibre centrifuge rotors',     exportingCountry: 'Japan',    receivingCountry: 'Iran',    concernLevel: 4, flaggedByRegime: 'NSG',       underReview: true  },
  { technology: 'High-speed oscilloscopes',           exportingCountry: 'Germany',  receivingCountry: 'DPRK',   concernLevel: 4, flaggedByRegime: 'Wassenaar', underReview: false },
  { technology: 'Electron beam welders',              exportingCountry: 'Russia',   receivingCountry: 'Myanmar', concernLevel: 3, flaggedByRegime: 'NSG',      underReview: true  },
  { technology: 'Ring magnets (IR-1 compatible)',     exportingCountry: 'China',    receivingCountry: 'Iran',    concernLevel: 4, flaggedByRegime: 'NSG',       underReview: true  },
  { technology: 'Tritium handling equipment',         exportingCountry: 'India',    receivingCountry: 'Unknown', concernLevel: 3, flaggedByRegime: 'NSG',      underReview: false },
  { technology: 'Radiological dispersal components', exportingCountry: 'Belarus',   receivingCountry: 'Syria',   concernLevel: 3, flaggedByRegime: 'Wassenaar', underReview: true },
];

export const DELIVERY_SYSTEM_DEVELOPMENTS: DeliverySystemDevelopment[] = [
  { country: 'DPRK',         systemType: 'ballistic_missile',  programName: 'Hwasong-17',            estimatedRangeKm: 15_000, stage: 'operational',        alertStatus: 'critical',   confidence: 3 },
  { country: 'Iran',         systemType: 'ballistic_missile',  programName: 'Shahab-3 / Emad',        estimatedRangeKm:  2_000, stage: 'operational',        alertStatus: 'urgent',     confidence: 3 },
  { country: 'China',        systemType: 'hypersonic_glide',   programName: 'DF-17 / DF-ZF',          estimatedRangeKm:  2_500, stage: 'operational',        alertStatus: 'elevated',   confidence: 3 },
  { country: 'Russia',       systemType: 'hypersonic_glide',   programName: 'Avangard',               estimatedRangeKm: 20_000, stage: 'operational',        alertStatus: 'elevated',   confidence: 3 },
  { country: 'Saudi Arabia', systemType: 'ballistic_missile',  programName: 'Domestic program',       estimatedRangeKm:  1_000, stage: 'ambiguous',          alertStatus: 'monitoring', confidence: 1 },
  { country: 'DPRK',         systemType: 'submarine_launched', programName: 'Pukguksong-3',           estimatedRangeKm:  1_900, stage: 'suspected_military', alertStatus: 'urgent',     confidence: 2 },
];

export const RADIOLOGICAL_SECURITY_EVENTS: RadiologicalSecurityEvent[] = [
  { location: 'Eastern Europe (transit)',  materialType: 'cesium_137',              quantityGrams:     500, secured: false, severity: 4, confidence: 2, notes: 'Reported missing from decommissioned facility' },
  { location: 'South Asia (seized)',       materialType: 'highly_enriched_uranium', quantityGrams:      85, secured: true,  severity: 4, confidence: 3, notes: 'Interdicted at border crossing; origin unknown' },
  { location: 'MENA (unaccounted)',        materialType: 'cobalt_60',               quantityGrams:  10_000, secured: false, severity: 3, confidence: 2, notes: 'Medical source unaccounted from conflict zone' },
  { location: 'Former Soviet facility',   materialType: 'strontium_90',            quantityGrams:   2_000, secured: false, severity: 3, confidence: 1, notes: 'RTG battery from decommissioned satellite' },
  { location: 'Southeast Asia (seized)',  materialType: 'americium_241',            quantityGrams:     200, secured: true,  severity: 2, confidence: 3, notes: 'Industrial source seized from black-market sale' },
  { location: 'West Africa (missing)',    materialType: 'cobalt_60',               quantityGrams:   5_000, secured: false, severity: 4, confidence: 2, notes: 'Radiotherapy source stolen from hospital' },
];
