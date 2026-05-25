/**
 * Pure helpers for OrganizedCrimeSuperpowerPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type ActivityLevel = 'dormant' | 'active' | 'elevated' | 'critical';
export type CriminalEnterprise = 'drug' | 'trafficking' | 'cyber' | 'arms';
export type SeizureTrend = 'up' | 'down' | 'flat';
export type TraffickingType = 'labor' | 'sexual' | 'organ';
export type LaunderingMethod = 'real estate' | 'crypto' | 'shell companies' | 'trade-based';
export type StabilityImpact = 0 | 1 | 2 | 3 | 4;

export interface CartelSyndicate {
  name: string;
  region: string;
  activityLevel: ActivityLevel;
  primaryEnterprise: CriminalEnterprise;
  territoryStatus: string;
}

export interface TraffickingRoute {
  origin: string;
  transit: string;
  destination: string;
  commodity: string;
  seizureTrend: SeizureTrend;
  estimatedVolume: string;
  interdictionPressure: 'low' | 'medium' | 'high';
}

export interface HumanTraffickingWatch {
  region: string;
  type: TraffickingType;
  estimatedVictims: number;
  networkSize: 'small' | 'medium' | 'large';
  enforcementResponse: 'none' | 'limited' | 'active' | 'strong';
}

export interface MoneyLaunderingSignal {
  jurisdiction: string;
  method: LaunderingMethod;
  estimatedVolumeBn: number;
  enforcementAction: 'none' | 'investigating' | 'prosecuting' | 'sanctioned';
}

export interface CrimeConflictNexus {
  region: string;
  primaryGroup: string;
  conflictLinkage: string;
  stabilityImpact: StabilityImpact;
}

export interface OrganizedCrimeData {
  cartels: CartelSyndicate[];
  routes: TraffickingRoute[];
  humanTrafficking: HumanTraffickingWatch[];
  laundering: MoneyLaunderingSignal[];
  nexus: CrimeConflictNexus[];
}

// ── Activity level helpers ────────────────────────────────────────────────

export function activityColor(level: ActivityLevel): string {
  const colors: Record<ActivityLevel, string> = {
    dormant:  'var(--severity-none,     #9e9e9e)',
    active:   'var(--severity-low,      #4caf50)',
    elevated: 'var(--severity-medium,   #facc15)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[level];
}

export function activityLabel(level: ActivityLevel): string {
  const labels: Record<ActivityLevel, string> = {
    dormant:  'Dormant',
    active:   'Active',
    elevated: 'Elevated',
    critical: 'Critical',
  };
  return labels[level];
}

// ── Enterprise label ──────────────────────────────────────────────────────

export function enterpriseLabel(e: CriminalEnterprise): string {
  const labels: Record<CriminalEnterprise, string> = {
    drug:        'Drug Trade',
    trafficking: 'Human Trafficking',
    cyber:       'Cybercrime',
    arms:        'Arms Trade',
  };
  return labels[e];
}

// ── Seizure trend ─────────────────────────────────────────────────────────

export function seizureTrendArrow(t: SeizureTrend): string {
  const arrows: Record<SeizureTrend, string> = { up: '▲', down: '▼', flat: '→' };
  return arrows[t];
}

export function seizureTrendColor(t: SeizureTrend): string {
  const colors: Record<SeizureTrend, string> = {
    up:   'var(--severity-high,   #fb923c)',
    down: 'var(--severity-low,    #4caf50)',
    flat: 'var(--severity-none,   #9e9e9e)',
  };
  return colors[t];
}

export function interdictionLabel(p: TraffickingRoute['interdictionPressure']): string {
  const labels: Record<TraffickingRoute['interdictionPressure'], string> = {
    low:    'Low pressure',
    medium: 'Moderate',
    high:   'High pressure',
  };
  return labels[p];
}

// ── Trafficking type ──────────────────────────────────────────────────────

export function traffickingTypeLabel(t: TraffickingType): string {
  const labels: Record<TraffickingType, string> = {
    labor:  'Labor',
    sexual: 'Sexual Exploitation',
    organ:  'Organ Trafficking',
  };
  return labels[t];
}

export function networkSizeLabel(s: HumanTraffickingWatch['networkSize']): string {
  const labels: Record<HumanTraffickingWatch['networkSize'], string> = {
    small:  'Small cell',
    medium: 'Mid-size network',
    large:  'Large organization',
  };
  return labels[s];
}

export function enforcementResponseLabel(r: HumanTraffickingWatch['enforcementResponse']): string {
  const labels: Record<HumanTraffickingWatch['enforcementResponse'], string> = {
    none:    'No response',
    limited: 'Limited',
    active:  'Active',
    strong:  'Strong',
  };
  return labels[r];
}

// ── Money laundering ──────────────────────────────────────────────────────

export function launderingMethodLabel(m: LaunderingMethod): string {
  const labels: Record<LaunderingMethod, string> = {
    'real estate':     'Real Estate',
    'crypto':          'Cryptocurrency',
    'shell companies': 'Shell Companies',
    'trade-based':     'Trade-Based',
  };
  return labels[m];
}

export function enforcementActionLabel(a: MoneyLaunderingSignal['enforcementAction']): string {
  const labels: Record<MoneyLaunderingSignal['enforcementAction'], string> = {
    none:          'No action',
    investigating: 'Investigating',
    prosecuting:   'Prosecuting',
    sanctioned:    'Sanctioned',
  };
  return labels[a];
}

export function enforcementActionColor(a: MoneyLaunderingSignal['enforcementAction']): string {
  const colors: Record<MoneyLaunderingSignal['enforcementAction'], string> = {
    none:          'var(--severity-none,     #9e9e9e)',
    investigating: 'var(--severity-medium,   #facc15)',
    prosecuting:   'var(--severity-high,     #fb923c)',
    sanctioned:    'var(--severity-critical, #ef4444)',
  };
  return colors[a];
}

export function formatVolumeBn(bn: number): string {
  if (bn >= 100) return `$${Math.round(bn)}B`;
  if (bn >= 10)  return `$${bn.toFixed(0)}B`;
  return `$${bn.toFixed(1)}B`;
}

// ── Stability impact ──────────────────────────────────────────────────────

export function stabilityColor(impact: StabilityImpact): string {
  const colors: Record<StabilityImpact, string> = {
    0: 'var(--severity-none,     #9e9e9e)',
    1: 'var(--severity-low,      #4caf50)',
    2: 'var(--severity-medium,   #facc15)',
    3: 'var(--severity-high,     #fb923c)',
    4: 'var(--severity-critical, #ef4444)',
  };
  return colors[impact];
}

export function stabilityLabel(impact: StabilityImpact): string {
  const labels: Record<StabilityImpact, string> = {
    0: 'Minimal',
    1: 'Low',
    2: 'Moderate',
    3: 'High',
    4: 'Severe',
  };
  return labels[impact];
}

// ── Count helpers ─────────────────────────────────────────────────────────

export function countCritical(cartels: CartelSyndicate[]): number {
  return cartels.filter(c => c.activityLevel === 'critical' || c.activityLevel === 'elevated').length;
}

export function countCrisisRoutes(routes: TraffickingRoute[]): number {
  return routes.filter(r => r.seizureTrend === 'up' && r.interdictionPressure === 'low').length;
}

// ── Static demo data ──────────────────────────────────────────────────────

export const CARTELS: CartelSyndicate[] = [
  { name: 'Sinaloa Cartel', region: 'Mexico / Western US', activityLevel: 'critical', primaryEnterprise: 'drug', territoryStatus: 'Expanding' },
  { name: 'CJNG', region: 'Mexico / Central America', activityLevel: 'critical', primaryEnterprise: 'drug', territoryStatus: 'Contested' },
  { name: 'Ndrangheta', region: 'Southern Italy / EU', activityLevel: 'elevated', primaryEnterprise: 'drug', territoryStatus: 'Consolidated' },
  { name: 'MS-13', region: 'Central America / US', activityLevel: 'elevated', primaryEnterprise: 'trafficking', territoryStatus: 'Active cells' },
  { name: 'Hells Angels', region: 'North America / EU', activityLevel: 'active', primaryEnterprise: 'drug', territoryStatus: 'Stable' },
  { name: 'Gulf Cartel', region: 'Northeast Mexico', activityLevel: 'active', primaryEnterprise: 'arms', territoryStatus: 'Diminished' },
];

export const ROUTES: TraffickingRoute[] = [
  { origin: 'Colombia', transit: 'Central America', destination: 'United States', commodity: 'Cocaine', seizureTrend: 'up', estimatedVolume: '800t/yr', interdictionPressure: 'medium' },
  { origin: 'Afghanistan', transit: 'Iran / Turkey', destination: 'EU', commodity: 'Heroin / Opiates', seizureTrend: 'flat', estimatedVolume: '350t/yr', interdictionPressure: 'low' },
  { origin: 'Myanmar', transit: 'Thailand / Laos', destination: 'SE Asia / AU', commodity: 'Methamphetamine', seizureTrend: 'up', estimatedVolume: '1,200t/yr', interdictionPressure: 'low' },
  { origin: 'Morocco', transit: 'Spain', destination: 'Northern EU', commodity: 'Cannabis resin', seizureTrend: 'down', estimatedVolume: '600t/yr', interdictionPressure: 'high' },
  { origin: 'Eastern Europe', transit: 'Balkans', destination: 'Western EU', commodity: 'Synthetic drugs', seizureTrend: 'up', estimatedVolume: 'Unknown', interdictionPressure: 'low' },
];

export const HUMAN_TRAFFICKING: HumanTraffickingWatch[] = [
  { region: 'Southeast Asia', type: 'labor', estimatedVictims: 11_000_000, networkSize: 'large', enforcementResponse: 'limited' },
  { region: 'South Asia', type: 'labor', estimatedVictims: 8_000_000, networkSize: 'large', enforcementResponse: 'limited' },
  { region: 'Sub-Saharan Africa', type: 'labor', estimatedVictims: 5_800_000, networkSize: 'large', enforcementResponse: 'none' },
  { region: 'Latin America', type: 'sexual', estimatedVictims: 1_800_000, networkSize: 'medium', enforcementResponse: 'active' },
  { region: 'Eastern Europe', type: 'sexual', estimatedVictims: 580_000, networkSize: 'medium', enforcementResponse: 'active' },
  { region: 'Middle East', type: 'organ', estimatedVictims: 12_000, networkSize: 'small', enforcementResponse: 'limited' },
];

export const LAUNDERING: MoneyLaunderingSignal[] = [
  { jurisdiction: 'UAE', method: 'real estate', estimatedVolumeBn: 26, enforcementAction: 'investigating' },
  { jurisdiction: 'Panama', method: 'shell companies', estimatedVolumeBn: 18, enforcementAction: 'prosecuting' },
  { jurisdiction: 'Malta', method: 'crypto', estimatedVolumeBn: 9.4, enforcementAction: 'investigating' },
  { jurisdiction: 'Myanmar', method: 'trade-based', estimatedVolumeBn: 7.1, enforcementAction: 'none' },
  { jurisdiction: 'Cayman Islands', method: 'shell companies', estimatedVolumeBn: 38, enforcementAction: 'sanctioned' },
  { jurisdiction: 'North Korea', method: 'crypto', estimatedVolumeBn: 3.2, enforcementAction: 'sanctioned' },
];

export const NEXUS: CrimeConflictNexus[] = [
  { region: 'Sahel', primaryGroup: 'JNIM / smuggling networks', conflictLinkage: 'Arms trafficking funds jihadist operations', stabilityImpact: 4 },
  { region: 'Myanmar', primaryGroup: 'Kokang / MNDAA', conflictLinkage: 'Drug trade sustains armed factions in Shan State', stabilityImpact: 4 },
  { region: 'Colombia', primaryGroup: 'ELN / FARC dissidents', conflictLinkage: 'Cocaine revenue finances guerrilla territorial control', stabilityImpact: 3 },
  { region: 'Libya', primaryGroup: 'Armed militias', conflictLinkage: 'Trafficking networks exploit governance vacuum', stabilityImpact: 3 },
  { region: 'Mexico', primaryGroup: 'Cartel militias', conflictLinkage: 'Cartel violence destabilizes municipal governance', stabilityImpact: 2 },
];
