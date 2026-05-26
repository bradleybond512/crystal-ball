/**
 * Pure helpers for ArmsProliferationPanel.
 *
 * Strictly analytical / security-intelligence monitoring. All static data
 * is a synthetic illustrative seed (the panel is a frame for live feeds;
 * this file makes sure the surface renders deterministically in tests).
 *
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type Severity = 0 | 1 | 2 | 3 | 4;
export type Confidence = 0 | 1 | 2 | 3;
export type WeaponCategory =
  | 'small arms'
  | 'light weapons'
  | 'MANPADS'
  | 'ATGM'
  | 'UAV'
  | 'artillery'
  | 'armored vehicles'
  | 'munitions';
export type EmbargoStatus = 'active' | 'pending' | 'expired';
export type ViolationStatus = 'reported' | 'investigating' | 'confirmed' | 'sanctioned';
export type ActorType = 'state' | 'non-state armed group' | 'criminal network' | 'private broker';
export type TransferRoute = 'air' | 'sea' | 'land' | 'multi-modal';
export type Region =
  | 'Sub-Saharan Africa'
  | 'MENA'
  | 'South Asia'
  | 'Southeast Asia'
  | 'Latin America'
  | 'Europe'
  | 'Eurasia'
  | 'Sahel';
export type ManpadsThreatLevel = 'low' | 'elevated' | 'high' | 'critical';
export type DealStatus = 'announced' | 'contracted' | 'delivered' | 'cancelled';
export type ControlRegime = 'ITAR' | 'EAR' | 'EU dual-use' | 'Wassenaar' | 'MTCR';
export type CaseStage = 'indictment' | 'plea' | 'conviction' | 'sentencing' | 'closed';

export interface EmbargoViolation {
  embargoTarget: string;
  unResolution: string;
  status: EmbargoStatus;
  violatingActor: string;
  actorType: ActorType;
  weaponCategory: WeaponCategory;
  severity: Severity;
  violationStatus: ViolationStatus;
}

export interface IllicitTransferEvent {
  origin: string;
  destination: string;
  route: TransferRoute;
  weaponCategory: WeaponCategory;
  quantity: number;
  interdicted: boolean;
  confidence: Confidence;
}

export interface ManpadsIndicator {
  region: Region;
  systemFamily: string;
  /** Estimated number of systems unaccounted for. */
  unaccountedSystems: number;
  threatLevel: ManpadsThreatLevel;
  proximityToAirRoutesKm: number;
}

export interface SmallArmsHotspot {
  region: Region;
  /** Composite 0–4 illicit-flow density score. */
  flowDensity: Severity;
  primarySource: string;
  primaryDestination: string;
  estimatedAnnualUnits: number;
}

export interface NonStateAcquisition {
  group: string;
  region: Region;
  weaponCategory: WeaponCategory;
  acquisitionPath: string;
  severity: Severity;
  confidence: Confidence;
}

export interface ArmsDealAnnouncement {
  seller: string;
  buyer: string;
  weaponCategory: WeaponCategory;
  valueUsdBn: number;
  status: DealStatus;
  /** True when at least one external monitor flagged human-rights or
   *  diversion concerns. */
  flagged: boolean;
}

export interface ExportControlCase {
  caseName: string;
  jurisdiction: string;
  regime: ControlRegime;
  stage: CaseStage;
  /** Fine or settlement amount, in millions of USD. */
  penaltyUsdM: number;
  severity: Severity;
}

// ── Severity / confidence shared helpers ─────────────────────────────────

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

// ── Weapon / actor labels ────────────────────────────────────────────────

export function weaponCategoryLabel(w: WeaponCategory): string {
  const labels: Record<WeaponCategory, string> = {
    'small arms':       'Small Arms',
    'light weapons':    'Light Weapons',
    MANPADS:            'MANPADS',
    ATGM:               'ATGM',
    UAV:                'UAV',
    artillery:          'Artillery',
    'armored vehicles': 'Armored Vehicles',
    munitions:          'Munitions',
  };
  return labels[w];
}

export function actorTypeLabel(a: ActorType): string {
  const labels: Record<ActorType, string> = {
    state:                   'State',
    'non-state armed group': 'Non-State Armed Group',
    'criminal network':      'Criminal Network',
    'private broker':        'Private Broker',
  };
  return labels[a];
}

// ── Embargo helpers ──────────────────────────────────────────────────────

export function embargoStatusColor(s: EmbargoStatus): string {
  const colors: Record<EmbargoStatus, string> = {
    active:  'var(--severity-critical, #ef4444)',
    pending: 'var(--severity-medium,   #facc15)',
    expired: 'var(--severity-none,     #9e9e9e)',
  };
  return colors[s];
}

export function violationStatusColor(v: ViolationStatus): string {
  const colors: Record<ViolationStatus, string> = {
    reported:      'var(--severity-medium,   #facc15)',
    investigating: 'var(--severity-high,     #fb923c)',
    confirmed:     'var(--severity-critical, #ef4444)',
    sanctioned:    'var(--severity-critical, #ef4444)',
  };
  return colors[v];
}

// ── Transfer route helpers ───────────────────────────────────────────────

export function routeLabel(r: TransferRoute): string {
  const labels: Record<TransferRoute, string> = {
    air:          'Air',
    sea:          'Sea',
    land:         'Land',
    'multi-modal': 'Multi-Modal',
  };
  return labels[r];
}

// ── MANPADS helpers ──────────────────────────────────────────────────────

export function manpadsThreatColor(t: ManpadsThreatLevel): string {
  const colors: Record<ManpadsThreatLevel, string> = {
    low:      'var(--severity-low,      #4caf50)',
    elevated: 'var(--severity-medium,   #facc15)',
    high:     'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[t];
}

export function classifyManpadsThreat(
  unaccountedSystems: number,
  proximityToAirRoutesKm: number,
): ManpadsThreatLevel {
  // Threat scales with stock AND proximity. A system within 50km of a
  // commercial air route is materially more threatening than one in a
  // remote stockpile, regardless of count.
  const closeToRoutes = proximityToAirRoutesKm <= 50;
  const veryClose     = proximityToAirRoutesKm <= 10;
  if (veryClose     && unaccountedSystems >= 50)  return 'critical';
  if (closeToRoutes && unaccountedSystems >= 100) return 'critical';
  if (closeToRoutes && unaccountedSystems >= 20)  return 'high';
  if (unaccountedSystems >= 500)                  return 'high';
  if (unaccountedSystems >= 100)                  return 'elevated';
  return 'low';
}

// ── Deal / control regime helpers ────────────────────────────────────────

export function dealStatusColor(s: DealStatus): string {
  const colors: Record<DealStatus, string> = {
    announced:  'var(--severity-medium,   #facc15)',
    contracted: 'var(--severity-high,     #fb923c)',
    delivered:  'var(--severity-critical, #ef4444)',
    cancelled:  'var(--severity-none,     #9e9e9e)',
  };
  return colors[s];
}

export function controlRegimeLabel(r: ControlRegime): string {
  return r;
}

export function caseStageColor(s: CaseStage): string {
  const colors: Record<CaseStage, string> = {
    indictment: 'var(--severity-medium,   #facc15)',
    plea:       'var(--severity-high,     #fb923c)',
    conviction: 'var(--severity-critical, #ef4444)',
    sentencing: 'var(--severity-critical, #ef4444)',
    closed:     'var(--severity-none,     #9e9e9e)',
  };
  return colors[s];
}

// ── Formatting helpers ───────────────────────────────────────────────────

export function formatUnits(n: number): string {
  if (n >= 1000)  return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${n}`;
}

export function formatUsdBn(b: number): string {
  if (b >= 1)    return `$${b.toFixed(1)} B`;
  if (b >= 0.01) return `$${(b * 1000).toFixed(0)} M`;
  return `$${(b * 1000).toFixed(1)} M`;
}

export function formatUsdM(m: number): string {
  if (m >= 1000) return `$${(m / 1000).toFixed(1)} B`;
  if (m >= 1)    return `$${m.toFixed(0)} M`;
  return `$${(m * 1000).toFixed(0)} K`;
}

export function formatKm(km: number): string {
  if (km >= 1000) return `${(km / 1000).toFixed(1)}k km`;
  return `${km} km`;
}

// ── Count / aggregation helpers ──────────────────────────────────────────

export function countConfirmedEmbargoViolations(v: EmbargoViolation[]): number {
  return v.filter((x) => x.violationStatus === 'confirmed' || x.violationStatus === 'sanctioned').length;
}

export function countNonInterdictedTransfers(t: IllicitTransferEvent[]): number {
  return t.filter((x) => !x.interdicted).length;
}

export function countCriticalManpads(m: ManpadsIndicator[]): number {
  return m.filter((x) => x.threatLevel === 'critical').length;
}

export function countHighFlowHotspots(h: SmallArmsHotspot[]): number {
  return h.filter((x) => x.flowDensity >= 3).length;
}

export function countHighConfidenceAcquisitions(a: NonStateAcquisition[]): number {
  return a.filter((x) => x.confidence >= 2 && x.severity >= 3).length;
}

export function countFlaggedDeals(d: ArmsDealAnnouncement[]): number {
  return d.filter((x) => x.flagged).length;
}

export function countActiveCases(c: ExportControlCase[]): number {
  return c.filter((x) => x.stage !== 'closed').length;
}

export function totalDealValueUsdBn(deals: ArmsDealAnnouncement[]): number {
  let total = 0;
  for (const d of deals) {
    if (d.status !== 'cancelled') total += d.valueUsdBn;
  }
  return Math.round(total * 10) / 10;
}

export function totalEnforcementPenaltyUsdM(cases: ExportControlCase[]): number {
  let total = 0;
  for (const c of cases) {
    if (c.stage === 'conviction' || c.stage === 'sentencing' || c.stage === 'closed') {
      total += c.penaltyUsdM;
    }
  }
  return Math.round(total * 10) / 10;
}

export function composeBadgeCount(
  embargoes: EmbargoViolation[],
  transfers: IllicitTransferEvent[],
  manpads: ManpadsIndicator[],
  hotspots: SmallArmsHotspot[],
  acquisitions: NonStateAcquisition[],
  cases: ExportControlCase[],
): number {
  return (
    countConfirmedEmbargoViolations(embargoes)
    + countNonInterdictedTransfers(transfers)
    + countCriticalManpads(manpads)
    + countHighFlowHotspots(hotspots)
    + countHighConfidenceAcquisitions(acquisitions)
    + countActiveCases(cases)
  );
}

// ── Static seed data (synthetic, illustrative) ───────────────────────────

export const EMBARGO_VIOLATIONS: EmbargoViolation[] = [
  { embargoTarget: 'DPRK',         unResolution: 'UNSCR 1718', status: 'active', violatingActor: 'Third-state broker',         actorType: 'private broker',         weaponCategory: 'small arms',       severity: 4, violationStatus: 'investigating' },
  { embargoTarget: 'Libya',        unResolution: 'UNSCR 1970', status: 'active', violatingActor: 'Multiple state actors',      actorType: 'state',                  weaponCategory: 'armored vehicles', severity: 4, violationStatus: 'confirmed'     },
  { embargoTarget: 'Somalia',      unResolution: 'UNSCR 733',  status: 'active', violatingActor: 'Trans-regional network',     actorType: 'criminal network',       weaponCategory: 'light weapons',    severity: 3, violationStatus: 'reported'      },
  { embargoTarget: 'CAR',          unResolution: 'UNSCR 2127', status: 'active', violatingActor: 'Private security operator',  actorType: 'private broker',         weaponCategory: 'small arms',       severity: 2, violationStatus: 'reported'      },
  { embargoTarget: 'Sudan',        unResolution: 'UNSCR 1591', status: 'active', violatingActor: 'Regional state proxy',       actorType: 'state',                  weaponCategory: 'munitions',        severity: 4, violationStatus: 'sanctioned'    },
  { embargoTarget: 'South Sudan',  unResolution: 'UNSCR 2428', status: 'active', violatingActor: 'Cross-border trafficker',    actorType: 'criminal network',       weaponCategory: 'small arms',       severity: 3, violationStatus: 'investigating' },
];

export const ILLICIT_TRANSFERS: IllicitTransferEvent[] = [
  { origin: 'Eastern Europe',  destination: 'West Africa',          route: 'sea',          weaponCategory: 'small arms',    quantity: 12_000, interdicted: false, confidence: 2 },
  { origin: 'Balkans',         destination: 'Sahel',                 route: 'multi-modal', weaponCategory: 'light weapons', quantity:  3500, interdicted: false, confidence: 3 },
  { origin: 'Levant',          destination: 'Horn of Africa',        route: 'sea',          weaponCategory: 'munitions',    quantity: 50_000, interdicted: true,  confidence: 3 },
  { origin: 'Caucasus',        destination: 'Eastern Mediterranean', route: 'land',         weaponCategory: 'ATGM',         quantity:    180, interdicted: false, confidence: 2 },
  { origin: 'Central Asia',    destination: 'South Asia',            route: 'land',         weaponCategory: 'small arms',   quantity:  6500, interdicted: false, confidence: 1 },
  { origin: 'Southeast Asia',  destination: 'Pacific',               route: 'air',          weaponCategory: 'UAV',          quantity:     40, interdicted: true,  confidence: 3 },
];

export const MANPADS_INDICATORS: ManpadsIndicator[] = [
  { region: 'MENA',               systemFamily: 'Igla / Strela family',  unaccountedSystems: 600, threatLevel: classifyManpadsThreat(600,   8), proximityToAirRoutesKm:   8 },
  { region: 'Sub-Saharan Africa', systemFamily: 'Igla / Strela family',  unaccountedSystems: 250, threatLevel: classifyManpadsThreat(250,  60), proximityToAirRoutesKm:  60 },
  { region: 'Sahel',              systemFamily: 'SA-7 / SA-14',          unaccountedSystems: 120, threatLevel: classifyManpadsThreat(120,  40), proximityToAirRoutesKm:  40 },
  { region: 'Eurasia',            systemFamily: 'Igla-S',                 unaccountedSystems:  80, threatLevel: classifyManpadsThreat( 80,  30), proximityToAirRoutesKm:  30 },
  { region: 'South Asia',         systemFamily: 'Stinger family',         unaccountedSystems:  35, threatLevel: classifyManpadsThreat( 35, 200), proximityToAirRoutesKm: 200 },
];

export const SMALL_ARMS_HOTSPOTS: SmallArmsHotspot[] = [
  { region: 'Sahel',              flowDensity: 4, primarySource: 'Libya / post-2011 stockpiles', primaryDestination: 'Mali, Burkina Faso, Niger', estimatedAnnualUnits: 250_000 },
  { region: 'Sub-Saharan Africa', flowDensity: 3, primarySource: 'Eastern Europe',                primaryDestination: 'Horn of Africa',             estimatedAnnualUnits: 120_000 },
  { region: 'Latin America',      flowDensity: 4, primarySource: 'US southern border',            primaryDestination: 'Mexico, Northern Triangle',  estimatedAnnualUnits: 200_000 },
  { region: 'MENA',               flowDensity: 3, primarySource: 'Levant conflict zones',         primaryDestination: 'Gulf, Yemen',                estimatedAnnualUnits:  90_000 },
  { region: 'Eurasia',            flowDensity: 3, primarySource: 'Conflict-zone diversion',       primaryDestination: 'Caucasus',                   estimatedAnnualUnits:  75_000 },
  { region: 'Southeast Asia',     flowDensity: 2, primarySource: 'Regional craft production',     primaryDestination: 'Mainland SEA + Pacific',     estimatedAnnualUnits:  40_000 },
];

export const NON_STATE_ACQUISITIONS: NonStateAcquisition[] = [
  { group: 'Sahel Coalition (composite)',         region: 'Sahel',              weaponCategory: 'UAV',           acquisitionPath: 'Commercial off-the-shelf adaptation', severity: 4, confidence: 3 },
  { group: 'East African Affiliate',              region: 'Sub-Saharan Africa', weaponCategory: 'munitions',     acquisitionPath: 'Battlefield capture',                 severity: 3, confidence: 2 },
  { group: 'Levant Insurgent Cluster',            region: 'MENA',               weaponCategory: 'ATGM',          acquisitionPath: 'State proxy supply',                  severity: 4, confidence: 3 },
  { group: 'Andean Trafficking Syndicate',        region: 'Latin America',      weaponCategory: 'small arms',    acquisitionPath: 'Cross-border diversion',              severity: 3, confidence: 3 },
  { group: 'South Asian Splinter Group',          region: 'South Asia',         weaponCategory: 'light weapons', acquisitionPath: 'Stockpile pilferage',                 severity: 2, confidence: 2 },
  { group: 'Caucasus Militant Network',           region: 'Eurasia',            weaponCategory: 'MANPADS',       acquisitionPath: 'Black-market broker chain',           severity: 4, confidence: 1 },
];

export const ARMS_DEALS: ArmsDealAnnouncement[] = [
  { seller: 'US',           buyer: 'Gulf state A',         weaponCategory: 'armored vehicles', valueUsdBn: 12.5, status: 'contracted', flagged: true  },
  { seller: 'Russia',       buyer: 'South Asia state',     weaponCategory: 'artillery',        valueUsdBn:  3.2, status: 'announced',  flagged: false },
  { seller: 'France',       buyer: 'Latin America state',  weaponCategory: 'UAV',              valueUsdBn:  1.8, status: 'contracted', flagged: false },
  { seller: 'Israel',       buyer: 'European NATO state',  weaponCategory: 'UAV',              valueUsdBn:  2.4, status: 'delivered',  flagged: false },
  { seller: 'China',        buyer: 'African state',        weaponCategory: 'small arms',       valueUsdBn:  0.6, status: 'delivered',  flagged: true  },
  { seller: 'UK',           buyer: 'Asia-Pacific state',   weaponCategory: 'munitions',        valueUsdBn:  4.1, status: 'announced',  flagged: false },
  { seller: 'South Korea',  buyer: 'European state',       weaponCategory: 'artillery',        valueUsdBn:  9, status: 'contracted', flagged: false },
];

export const EXPORT_CONTROL_CASES: ExportControlCase[] = [
  { caseName: 'Aerospace component diversion',      jurisdiction: 'US Federal',  regime: 'ITAR',         stage: 'indictment', penaltyUsdM:   0, severity: 4 },
  { caseName: 'Dual-use semiconductor case',         jurisdiction: 'US Federal',  regime: 'EAR',          stage: 'plea',       penaltyUsdM:  85, severity: 3 },
  { caseName: 'Encryption export disclosure case',   jurisdiction: 'EU member',   regime: 'EU dual-use',  stage: 'conviction', penaltyUsdM:  22, severity: 3 },
  { caseName: 'Night-vision optics diversion',       jurisdiction: 'US Federal',  regime: 'ITAR',         stage: 'sentencing', penaltyUsdM:  14, severity: 3 },
  { caseName: 'Missile-component re-export case',    jurisdiction: 'Multi',       regime: 'MTCR',         stage: 'indictment', penaltyUsdM:   0, severity: 4 },
  { caseName: 'Machine-tool transfer review',        jurisdiction: 'EU member',   regime: 'Wassenaar',    stage: 'plea',       penaltyUsdM:  46, severity: 2 },
  { caseName: 'Settled radar-component case',        jurisdiction: 'US Federal',  regime: 'ITAR',         stage: 'closed',     penaltyUsdM: 120, severity: 3 },
];
