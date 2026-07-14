/**
 * Pure helper functions and static data for GlobalMigrationCrisisPanel.
 *
 * Extracted into a side-effect-free module so unit tests can import them
 * without pulling in the DOM or live services.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type MigrationSeverity = 'low' | 'medium' | 'high' | 'critical';

export type DisplacementCause =
  | 'conflict'
  | 'climate'
  | 'disaster'
  | 'persecution';

export type DisplacementTrend = 'increasing' | 'stable' | 'decreasing';

export type BorderCapacityStatus =
  | 'normal'
  | 'stressed'
  | 'overwhelmed'
  | 'closed';

export type ProgramStatus = 'active' | 'suspended' | 'planned' | 'completed';

export type BorderTensionLevel = 0 | 1 | 2 | 3 | 4;

export interface DisplacementCrisis {
  name: string;
  region: string;
  /** Displaced persons in thousands. */
  displacedThousands: number;
  cause: DisplacementCause;
  trend: DisplacementTrend;
  severity: MigrationSeverity;
}

export interface BorderPressurePoint {
  /** E.g. "Darién Gap — Panama/Colombia". */
  name: string;
  dailyCrossings: number;
  capacityStatus: BorderCapacityStatus;
  tensionLevel: BorderTensionLevel;
}

export interface CampStatus {
  name: string;
  country: string;
  /** Current population in thousands. */
  populationThousands: number;
  /** Percentage of design capacity. */
  capacityPct: number;
  primaryNationality: string;
  criticalNeeds: string[];
}

export interface RepatriationProgram {
  originCountry: string;
  /** E.g. "Pakistan → Afghanistan". */
  destination: string;
  status: ProgramStatus;
  beneficiariesPerMonth: number;
}

export interface RegionalDisplacementScore {
  region: string;
  /** 0 = stable, 1 = watch, 2 = elevated, 3 = high, 4 = critical. */
  score: BorderTensionLevel;
}

// ── Static data ───────────────────────────────────────────────────────────

export const DISPLACEMENT_CRISES: DisplacementCrisis[] = [
  {
    name: 'Sudan Civil War',
    region: 'Sub-Saharan Africa',
    displacedThousands: 10_800,
    cause: 'conflict',
    trend: 'increasing',
    severity: 'critical',
  },
  {
    name: 'Syria Ongoing Displacement',
    region: 'Middle East',
    displacedThousands: 13_500,
    cause: 'conflict',
    trend: 'stable',
    severity: 'critical',
  },
  {
    name: 'Ukraine War Displacement',
    region: 'Europe',
    displacedThousands: 8200,
    cause: 'conflict',
    trend: 'decreasing',
    severity: 'high',
  },
  {
    name: 'Afghanistan Crisis',
    region: 'Central Asia',
    displacedThousands: 5900,
    cause: 'persecution',
    trend: 'increasing',
    severity: 'critical',
  },
  {
    name: 'Venezuela Migration',
    region: 'Latin America',
    displacedThousands: 7700,
    cause: 'persecution',
    trend: 'stable',
    severity: 'high',
  },
  {
    name: 'DRC Conflict Displacement',
    region: 'Sub-Saharan Africa',
    displacedThousands: 6900,
    cause: 'conflict',
    trend: 'increasing',
    severity: 'high',
  },
];

export const BORDER_PRESSURE_POINTS: BorderPressurePoint[] = [
  {
    name: 'Darién Gap — Panama/Colombia',
    dailyCrossings: 2500,
    capacityStatus: 'overwhelmed',
    tensionLevel: 4,
  },
  {
    name: 'Eagle Pass — Mexico/US',
    dailyCrossings: 3200,
    capacityStatus: 'overwhelmed',
    tensionLevel: 4,
  },
  {
    name: 'Evros River — Turkey/Greece',
    dailyCrossings: 800,
    capacityStatus: 'stressed',
    tensionLevel: 3,
  },
  {
    name: 'Calais — France/UK',
    dailyCrossings: 350,
    capacityStatus: 'stressed',
    tensionLevel: 3,
  },
  {
    name: 'Libya–Italy (Central Med)',
    dailyCrossings: 420,
    capacityStatus: 'stressed',
    tensionLevel: 3,
  },
  {
    name: 'Belarusian–Polish Border',
    dailyCrossings: 310,
    capacityStatus: 'stressed',
    tensionLevel: 2,
  },
];

export const CAMP_STATUSES: CampStatus[] = [
  {
    name: "Cox's Bazar",
    country: 'Bangladesh',
    populationThousands: 950,
    capacityPct: 145,
    primaryNationality: 'Rohingya',
    criticalNeeds: ['water', 'sanitation', 'protection'],
  },
  {
    name: 'Dadaab Complex',
    country: 'Kenya',
    populationThousands: 230,
    capacityPct: 130,
    primaryNationality: 'Somali',
    criticalNeeds: ['food', 'shelter', 'water'],
  },
  {
    name: 'Kakuma',
    country: 'Kenya',
    populationThousands: 200,
    capacityPct: 120,
    primaryNationality: 'South Sudanese',
    criticalNeeds: ['food', 'healthcare'],
  },
  {
    name: 'Zaatari',
    country: 'Jordan',
    populationThousands: 80,
    capacityPct: 110,
    primaryNationality: 'Syrian',
    criticalNeeds: ['healthcare', 'education'],
  },
  {
    name: 'Azraq',
    country: 'Jordan',
    populationThousands: 38,
    capacityPct: 95,
    primaryNationality: 'Syrian',
    criticalNeeds: ['livelihood', 'shelter'],
  },
];

export const REPATRIATION_PROGRAMS: RepatriationProgram[] = [
  {
    originCountry: 'Syria',
    destination: 'Jordan/Lebanon → Syria',
    status: 'active',
    beneficiariesPerMonth: 3200,
  },
  {
    originCountry: 'DRC',
    destination: 'Rwanda → DRC',
    status: 'active',
    beneficiariesPerMonth: 2100,
  },
  {
    originCountry: 'South Sudan',
    destination: 'Uganda → South Sudan',
    status: 'active',
    beneficiariesPerMonth: 1800,
  },
  {
    originCountry: 'Afghanistan',
    destination: 'Pakistan → Afghanistan',
    status: 'suspended',
    beneficiariesPerMonth: 0,
  },
  {
    originCountry: 'Myanmar',
    destination: 'Bangladesh → Myanmar',
    status: 'planned',
    beneficiariesPerMonth: 0,
  },
];

export const REGIONAL_DISPLACEMENT_INDEX: RegionalDisplacementScore[] = [
  { region: 'Sub-Saharan Africa', score: 4 },
  { region: 'Middle East',        score: 4 },
  { region: 'Central Asia',       score: 3 },
  { region: 'South Asia',         score: 3 },
  { region: 'Latin America',      score: 2 },
  { region: 'Europe',             score: 2 },
];

// ── Helper functions ──────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<MigrationSeverity, string> = {
  low:      '#4caf50',
  medium:   '#ff9800',
  high:     '#ff453a',
  critical: '#b71c1c',
};

export function migrationSeverityColor(sev: MigrationSeverity): string {
  return SEVERITY_COLOR[sev];
}

const CAUSE_LABEL: Record<DisplacementCause, string> = {
  conflict:    'Conflict',
  climate:     'Climate',
  disaster:    'Disaster',
  persecution: 'Persecution',
};

const CAUSE_ICON: Record<DisplacementCause, string> = {
  conflict:    '⚔',
  climate:     '🌡',
  disaster:    '⚡',
  persecution: '🛡',
};

export function causeLabel(cause: DisplacementCause): string {
  return CAUSE_LABEL[cause] ?? cause;
}

export function causeIcon(cause: DisplacementCause): string {
  return CAUSE_ICON[cause] ?? '?';
}

export function trendArrow(trend: DisplacementTrend): string {
  if (trend === 'increasing') return '↑';
  if (trend === 'decreasing') return '↓';
  return '→';
}

export function trendColor(trend: DisplacementTrend): string {
  if (trend === 'increasing') return '#ff453a';
  if (trend === 'decreasing') return '#4caf50';
  return '#9e9e9e';
}

// Maps tension level 0-4 to CSS variable with inline fallback.
const TENSION_COLOR = [
  'var(--severity-ok, #4caf50)',        // 0 — normal
  'var(--severity-info, #9e9e9e)',      // 1 — watch
  'var(--severity-medium, #ff9800)',    // 2 — elevated
  'var(--severity-high, #ff453a)',      // 3 — high
  'var(--severity-critical, #b71c1c)', // 4 — critical
] as const;

export function tensionColor(level: BorderTensionLevel): string {
  return TENSION_COLOR[level]!;
}

const TENSION_TIER_LABEL = ['Normal', 'Watch', 'Elevated', 'High', 'Critical'] as const;

export function tensionTierLabel(level: BorderTensionLevel): string {
  return TENSION_TIER_LABEL[level]!;
}

const CAPACITY_STATUS_LABEL: Record<BorderCapacityStatus, string> = {
  normal:      'Normal',
  stressed:    'Stressed',
  overwhelmed: 'Overwhelmed',
  closed:      'Closed',
};

export function capacityStatusLabel(status: BorderCapacityStatus): string {
  return CAPACITY_STATUS_LABEL[status] ?? status;
}

const CAPACITY_STATUS_COLOR: Record<BorderCapacityStatus, string> = {
  normal:      '#4caf50',
  stressed:    '#ff9800',
  overwhelmed: '#ff453a',
  closed:      '#9e9e9e',
};

export function capacityStatusColor(status: BorderCapacityStatus): string {
  return CAPACITY_STATUS_COLOR[status];
}

export function campCapacityColor(pct: number): string {
  if (pct > 120) return '#b71c1c';
  if (pct > 100) return '#ff453a';
  if (pct > 80)  return '#ff9800';
  return '#4caf50';
}

const PROGRAM_STATUS_LABEL: Record<ProgramStatus, string> = {
  active:    'Active',
  suspended: 'Suspended',
  planned:   'Planned',
  completed: 'Completed',
};

export function programStatusLabel(status: ProgramStatus): string {
  return PROGRAM_STATUS_LABEL[status] ?? status;
}

const PROGRAM_STATUS_COLOR: Record<ProgramStatus, string> = {
  active:    '#4caf50',
  suspended: '#ff453a',
  planned:   '#ff9800',
  completed: '#9e9e9e',
};

export function programStatusColor(status: ProgramStatus): string {
  return PROGRAM_STATUS_COLOR[status];
}

/**
 * Format a displaced person count in thousands into a human-readable string.
 * Values >= 1000K are shown as "X.XM"; values < 1000K are shown as "XXXK".
 */
export function formatDisplacedCount(thousands: number): string {
  if (thousands >= 1000) {
    const millions = thousands / 1000;
    return `${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  return `${thousands}K`;
}

/** Format beneficiaries per month; returns "—" when zero. */
export function formatBeneficiaries(n: number): string {
  if (n === 0) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K/mo`;
  return `${n}/mo`;
}

/** Count camps at or above the critical overcapacity threshold (>= 120%). */
export function criticalCampCount(camps: CampStatus[]): number {
  return camps.filter((c) => c.capacityPct >= 120).length;
}

/** Count border pressure points at tension level >= 3 (high or critical). */
export function activeBorderCrisisCount(borders: BorderPressurePoint[]): number {
  return borders.filter((b) => b.tensionLevel >= 3).length;
}

/** Sum all displaced persons across crises and return total in millions (rounded to 1 dp). */
export function totalDisplacedMillions(crises: DisplacementCrisis[]): number {
  const total = crises.reduce((sum, c) => sum + c.displacedThousands, 0);
  return Math.round((total / 1000) * 10) / 10;
}
