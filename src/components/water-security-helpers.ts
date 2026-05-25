/**
 * Pure helpers for WaterSecurityPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type StressLevel = 0 | 1 | 2 | 3 | 4;
export type WaterDriver = 'overuse' | 'drought' | 'pollution' | 'conflict';
export type ConflictType = 'diplomatic' | 'armed' | 'economic';
export type TensionLevel = 'low' | 'medium' | 'high' | 'critical';
export type DamType = 'structural concern' | 'low storage' | 'weaponization risk';
export type DamSeverity = 'watch' | 'warning' | 'critical';
export type AttackType = 'contamination' | 'physical destruction' | 'cyber';
export type HydroRisk = 0 | 1 | 2 | 3 | 4;

export interface WaterStressHotspot {
  region: string;
  stressLevel: StressLevel;
  primaryDriver: WaterDriver;
  populationAffectedM: number;
}

export interface TransboundaryConflict {
  waterBody: string;
  countries: string;
  conflictType: ConflictType;
  tensionLevel: TensionLevel;
  downstreamPopM: number;
}

export interface DamWatch {
  facility: string;
  country: string;
  type: DamType;
  severity: DamSeverity;
}

export interface InfraAttack {
  location: string;
  attackType: AttackType;
  perpetrator: string;
  impact: string;
}

export interface HydroRegion {
  region: string;
  risk: HydroRisk;
}

// ── Stress level helpers ──────────────────────────────────────────────────

export function stressColor(level: StressLevel): string {
  const colors: Record<StressLevel, string> = {
    0: 'var(--severity-none,     #9e9e9e)',
    1: 'var(--severity-low,      #4caf50)',
    2: 'var(--severity-medium,   #facc15)',
    3: 'var(--severity-high,     #fb923c)',
    4: 'var(--severity-critical, #ef4444)',
  };
  return colors[level];
}

export function stressLabel(level: StressLevel): string {
  const labels: Record<StressLevel, string> = {
    0: 'Low',
    1: 'Medium',
    2: 'High',
    3: 'Very High',
    4: 'Extremely High',
  };
  return labels[level];
}

// ── Driver label ──────────────────────────────────────────────────────────

export function driverLabel(d: WaterDriver): string {
  const labels: Record<WaterDriver, string> = {
    overuse:  'Overuse',
    drought:  'Drought',
    pollution: 'Pollution',
    conflict: 'Conflict',
  };
  return labels[d];
}

// ── Conflict helpers ──────────────────────────────────────────────────────

export function conflictTypeLabel(t: ConflictType): string {
  const labels: Record<ConflictType, string> = {
    diplomatic: 'Diplomatic',
    armed:      'Armed',
    economic:   'Economic',
  };
  return labels[t];
}

export function tensionColor(t: TensionLevel): string {
  const colors: Record<TensionLevel, string> = {
    low:      'var(--severity-low,      #4caf50)',
    medium:   'var(--severity-medium,   #facc15)',
    high:     'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[t];
}

// ── Dam / reservoir helpers ───────────────────────────────────────────────

export function damTypeLabel(t: DamType): string {
  const labels: Record<DamType, string> = {
    'structural concern':  'Structural Concern',
    'low storage':         'Low Storage',
    'weaponization risk':  'Weaponization Risk',
  };
  return labels[t];
}

export function damSeverityColor(s: DamSeverity): string {
  const colors: Record<DamSeverity, string> = {
    watch:    'var(--severity-medium,   #facc15)',
    warning:  'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

// ── Attack type helpers ───────────────────────────────────────────────────

export function attackTypeLabel(t: AttackType): string {
  const labels: Record<AttackType, string> = {
    contamination:        'Contamination',
    'physical destruction': 'Physical Destruction',
    cyber:                'Cyber',
  };
  return labels[t];
}

export function attackTypeColor(t: AttackType): string {
  const colors: Record<AttackType, string> = {
    contamination:        'var(--severity-high,     #fb923c)',
    'physical destruction': 'var(--severity-critical, #ef4444)',
    cyber:                'var(--severity-medium,   #facc15)',
  };
  return colors[t];
}

// ── Hydro risk helpers ────────────────────────────────────────────────────

export function hydroRiskColor(r: HydroRisk): string {
  const colors: Record<HydroRisk, string> = {
    0: 'var(--severity-none,     #9e9e9e)',
    1: 'var(--severity-low,      #4caf50)',
    2: 'var(--severity-medium,   #facc15)',
    3: 'var(--severity-high,     #fb923c)',
    4: 'var(--severity-critical, #ef4444)',
  };
  return colors[r];
}

export function hydroRiskLabel(r: HydroRisk): string {
  const labels: Record<HydroRisk, string> = {
    0: 'Minimal',
    1: 'Low',
    2: 'Moderate',
    3: 'High',
    4: 'Severe',
  };
  return labels[r];
}

// ── Formatting helpers ────────────────────────────────────────────────────

export function formatPopM(m: number): string {
  if (m >= 100) return `${Math.round(m)}M`;
  if (m >= 10)  return `${m.toFixed(0)}M`;
  return `${m.toFixed(1)}M`;
}

// ── Count helpers ─────────────────────────────────────────────────────────

export function countCriticalStress(hotspots: WaterStressHotspot[]): number {
  return hotspots.filter((h) => h.stressLevel >= 3).length;
}

export function countArmedConflicts(conflicts: TransboundaryConflict[]): number {
  return conflicts.filter((c) => c.conflictType === 'armed' || c.tensionLevel === 'critical').length;
}

// ── Static demo data ──────────────────────────────────────────────────────

export const STRESS_HOTSPOTS: WaterStressHotspot[] = [
  { region: 'Middle East / Arabian Peninsula', stressLevel: 4, primaryDriver: 'overuse',   populationAffectedM: 180 },
  { region: 'North Africa (MENA)',             stressLevel: 4, primaryDriver: 'drought',    populationAffectedM: 120 },
  { region: 'Indus Basin (Pakistan/India)',    stressLevel: 3, primaryDriver: 'overuse',   populationAffectedM: 300 },
  { region: 'Central Asia (Aral Basin)',       stressLevel: 3, primaryDriver: 'overuse',   populationAffectedM: 60  },
  { region: 'Southwest US (Colorado Basin)',   stressLevel: 3, primaryDriver: 'drought',   populationAffectedM: 40  },
  { region: 'Yellow River Basin (China)',      stressLevel: 2, primaryDriver: 'pollution', populationAffectedM: 150 },
];

export const TRANSBOUNDARY_CONFLICTS: TransboundaryConflict[] = [
  { waterBody: 'Nile River',         countries: 'Ethiopia / Egypt / Sudan',    conflictType: 'diplomatic', tensionLevel: 'critical', downstreamPopM: 105 },
  { waterBody: 'Mekong River',       countries: 'China / Lower Mekong States', conflictType: 'economic',   tensionLevel: 'high',     downstreamPopM: 60  },
  { waterBody: 'Indus River',        countries: 'India / Pakistan',            conflictType: 'diplomatic', tensionLevel: 'high',     downstreamPopM: 220 },
  { waterBody: 'Euphrates / Tigris', countries: 'Turkey / Syria / Iraq',       conflictType: 'armed',      tensionLevel: 'critical', downstreamPopM: 35  },
  { waterBody: 'Jordan River',       countries: 'Israel / Palestine / Jordan', conflictType: 'armed',      tensionLevel: 'critical', downstreamPopM: 12  },
];

export const DAM_WATCH: DamWatch[] = [
  { facility: 'Grand Ethiopian Renaissance Dam', country: 'Ethiopia', type: 'structural concern',  severity: 'warning'  },
  { facility: 'Mosul Dam',                       country: 'Iraq',     type: 'structural concern',  severity: 'critical' },
  { facility: 'Lake Mead (Hoover Dam)',           country: 'USA',      type: 'low storage',         severity: 'warning'  },
  { facility: 'Kakhovka Dam (post-breach)',       country: 'Ukraine',  type: 'weaponization risk',  severity: 'critical' },
  { facility: 'Tarbela Dam',                     country: 'Pakistan', type: 'structural concern',  severity: 'watch'    },
];

export const INFRA_ATTACKS: InfraAttack[] = [
  { location: 'Kherson Oblast, Ukraine',  attackType: 'physical destruction', perpetrator: 'Russian forces (alleged)', impact: 'Regional flooding, 40K displaced' },
  { location: 'Gaza Strip',               attackType: 'physical destruction', perpetrator: 'IDF operations',           impact: 'Water treatment facilities destroyed' },
  { location: 'Yemen (Sanaa province)',   attackType: 'physical destruction', perpetrator: 'Saudi-led coalition',      impact: 'Municipal supply cut for 2M people'  },
  { location: 'Sahel region',             attackType: 'contamination',        perpetrator: 'Unknown armed groups',     impact: 'Well poisoning, 8 villages affected'  },
  { location: 'Ukraine (multiple sites)', attackType: 'cyber',                perpetrator: 'State-sponsored hackers',  impact: 'SCADA system disruption, 6-hour outage' },
];

export const HYDRO_INDEX: HydroRegion[] = [
  { region: 'Middle East',     risk: 4 },
  { region: 'North Africa',    risk: 4 },
  { region: 'Central Asia',    risk: 3 },
  { region: 'South Asia',      risk: 3 },
  { region: 'Sub-Saharan Africa', risk: 2 },
  { region: 'Southwest US',    risk: 2 },
];
