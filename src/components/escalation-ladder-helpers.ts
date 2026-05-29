// escalation-ladder-helpers.ts
// Pure logic for EscalationLadderPanel — no DOM, no Panel imports

export type EscalationTrend = 'ascending' | 'stable' | 'descending';

export type EscalationDomain =
  | 'Conventional Military'
  | 'Nuclear'
  | 'Proxy/Hybrid'
  | 'Maritime'
  | 'Economic'
  | 'Paramilitary'
  | 'Nuclear Adjacent';

export interface CrisisEscalation {
  id: string;
  name: string;
  domain: EscalationDomain;
  rung: number; // 0-20 current position on Kahn ladder
  maxRung: 20;
  trend: EscalationTrend;
  description: string; // current situation summary
  thresholdToNext: string; // conditions that would move rung up
  weight: number; // relative weight for global barometer (sums to ~1)
  lastUpdated: string;
}

export interface EscalationRenderData {
  crises: CrisisEscalation[];
  globalBarometer: number; // weighted average rung, 0-20
  highEscalationCount: number; // crises at rung >= 10
  crossedThresholdCount: number; // crises exactly at a major rung (5,10,15,20)
  ascendingCount: number; // crises with trend === 'ascending'
}

// ---------------------------------------------------------------------------
// Static crisis dataset
// ---------------------------------------------------------------------------

const CRISES: CrisisEscalation[] = [
  {
    id: 'EL001',
    name: 'Ukraine-Russia',
    domain: 'Conventional Military',
    rung: 14,
    maxRung: 20,
    trend: 'stable',
    description:
      'Strategic bombardment of Ukrainian energy infrastructure; Kremlin nuclear signaling via doctrine updates; NATO proxy involvement through arms transfers, intelligence sharing, and HIMARS/Patriot deployments.',
    thresholdToNext:
      'NATO direct-fire engagement with Russian forces; Russian tactical nuclear detonation in Ukraine; large-scale ICBM exercise explicitly targeting NATO capitals.',
    weight: 0.25,
    lastUpdated: '2025-05',
  },
  {
    id: 'EL002',
    name: 'Taiwan Strait',
    domain: 'Conventional Military',
    rung: 7,
    maxRung: 20,
    trend: 'ascending',
    description:
      'Sustained ADIZ incursions by PLAAF; large-scale PLA joint exercises simulating full blockade scenarios; economic coercion via rare-earth export restrictions; PRC coast guard confrontations in Taiwan-controlled waters.',
    thresholdToNext:
      'PLA live-fire exercise within 12 nm of Taiwan coastline; interdiction of Taiwan-bound US military shipments; US carrier strike group directly confronted by PLA surface combatants.',
    weight: 0.22,
    lastUpdated: '2025-05',
  },
  {
    id: 'EL003',
    name: 'Israel-Iran',
    domain: 'Proxy/Hybrid',
    rung: 11,
    maxRung: 20,
    trend: 'stable',
    description:
      'Direct missile and drone exchanges (April and October 2024); Israeli airstrikes on Iranian air-defense nodes and S-300 systems; sustained proxy attrition via Hezbollah, Houthi, and Iraqi militias.',
    thresholdToNext:
      'Israeli strike on Iranian nuclear enrichment facilities; Iranian ballistic missile salvo targeting Israeli population centers; US forces directly engaged in Iranian strikes.',
    weight: 0.18,
    lastUpdated: '2025-05',
  },
  {
    id: 'EL004',
    name: 'North Korea-USA/ROK',
    domain: 'Nuclear',
    rung: 6,
    maxRung: 20,
    trend: 'ascending',
    description:
      'ICBM tests at full range including Hwasong-18 solid-fuel missile; DPRK troops deployed to Russia; ROK-US Freedom Shield exercises at record scale; Kim Jong-un declares ROK a permanent enemy state in constitution.',
    thresholdToNext:
      'DPRK seventh nuclear detonation; provocative missile overflight of Japan targeting Pacific waters; DPRK conventional strike on ROK territory or US military installation.',
    weight: 0.12,
    lastUpdated: '2025-05',
  },
  {
    id: 'EL005',
    name: 'South China Sea',
    domain: 'Maritime',
    rung: 8,
    maxRung: 20,
    trend: 'ascending',
    description:
      'Kinetic maritime incidents including water cannons, laser dazzling, and ramming of Philippine Coast Guard vessels at Second Thomas Shoal; PLA artificial island militarization complete; PLAN gray-zone operations at full cadence.',
    thresholdToNext:
      'Sinking of a Philippine military or coast guard vessel with fatalities; US warship fired upon during freedom-of-navigation operation; PLA seizure of Philippine-occupied Ayungin Shoal.',
    weight: 0.10,
    lastUpdated: '2025-05',
  },
  {
    id: 'EL006',
    name: 'India-Pakistan',
    domain: 'Nuclear Adjacent',
    rung: 8,
    maxRung: 20,
    trend: 'ascending',
    description:
      'Post-Pahalgam terrorist attack (April 2025, 26 killed); Indian military mobilization along Line of Control; Pakistan Army placed on high alert; Indus Waters Treaty suspended; diplomatic ties severed.',
    thresholdToNext:
      'Indian surgical cross-LoC ground incursion; Pakistani artillery strikes on Indian forward positions; nuclear-capable missile test by either side as coercive signaling.',
    weight: 0.08,
    lastUpdated: '2025-05',
  },
  {
    id: 'EL007',
    name: 'Sudan Civil War',
    domain: 'Paramilitary',
    rung: 13,
    maxRung: 20,
    trend: 'stable',
    description:
      'Full-scale SAF vs RSF war since April 2023; resumption of Darfur genocide by RSF; UAE and Egyptian external interference with arms and logistics; 10M+ internally displaced, worst humanitarian crisis in the world.',
    thresholdToNext:
      'Direct military intervention by Egypt (SAF-allied) or overt UAE ground forces (RSF-allied); SAF use of confirmed chemical weapons; collapse of Khartoum creating regional state-failure contagion.',
    weight: 0.10,
    lastUpdated: '2025-05',
  },
  {
    id: 'EL008',
    name: 'Iran Nuclear Program',
    domain: 'Nuclear Adjacent',
    rung: 9,
    maxRung: 20,
    trend: 'ascending',
    description:
      '90% weapons-grade enrichment threshold crossed; breakout time estimated at days to weeks; IAEA comprehensive safeguards access blocked; US and Israeli military options publicly signaled at senior government levels.',
    thresholdToNext:
      'Iranian weaponization decision (produce functional nuclear device); Israeli or US unilateral preventive strike on Fordow or Natanz; Iranian NPT withdrawal declaration.',
    weight: 0.15,
    lastUpdated: '2025-05',
  },
];

// ---------------------------------------------------------------------------
// Kahn ladder rung reference
// ---------------------------------------------------------------------------

export const RUNG_REFERENCE: Record<number, string> = {
  0: 'Peace',
  5: 'Crisis',
  10: 'Military Action',
  15: 'Limited War',
  20: 'General War',
};

const RUNG_THRESHOLDS: Array<{ min: number; label: string }> = [
  { min: 20, label: 'General War' },
  { min: 15, label: 'Limited War' },
  { min: 10, label: 'Military Action' },
  { min: 5, label: 'Crisis' },
  { min: 0, label: 'Peace' },
];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Returns the Kahn ladder label for a given rung (0-20). */
export function rungLabel(rung: number): string {
  for (const { min, label } of RUNG_THRESHOLDS) {
    if (rung >= min) return label;
  }
  return 'Peace';
}

/** Returns a CSS class name reflecting the escalation severity of a rung. */
export function rungClass(rung: number): string {
  if (rung >= 15) return 'el-general-war';
  if (rung >= 10) return 'el-limited-war';
  if (rung >= 5) return 'el-crisis';
  return 'el-peace';
}

/** Returns a CSS class for a trend direction. */
export function trendClass(trend: EscalationTrend): string {
  if (trend === 'ascending') return 'el-trend-up';
  if (trend === 'descending') return 'el-trend-down';
  return 'el-trend-stable';
}

/** Returns an arrow glyph for a trend direction. */
export function trendArrow(trend: EscalationTrend): string {
  if (trend === 'ascending') return 'up';
  if (trend === 'descending') return 'down';
  return 'stable';
}

/**
 * Returns all crises at or above a given escalation rung threshold.
 * Defaults to rung >= 10 (Military Action tier).
 */
export function getHighEscalation(
  crises: CrisisEscalation[],
  threshold = 10,
): CrisisEscalation[] {
  return crises.filter(c => c.rung >= threshold);
}

/**
 * Returns crises whose rung exactly equals one of the major Kahn
 * thresholds (5, 10, 15, 20), indicating a meaningful tier crossing.
 */
export function getCrossedThresholds(crises: CrisisEscalation[]): CrisisEscalation[] {
  const majorRungs = new Set([5, 10, 15, 20]);
  return crises.filter(c => majorRungs.has(c.rung));
}

/**
 * Computes the global escalation barometer as a weighted average
 * of all crisis rungs, rounded to one decimal place. Returns 0 for
 * an empty array or zero total weight.
 */
export function computeGlobalBarometer(crises: CrisisEscalation[]): number {
  if (crises.length === 0) return 0;
  const totalWeight = crises.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = crises.reduce((s, c) => s + c.rung * c.weight, 0);
  return Math.round((weighted / totalWeight) * 10) / 10;
}

/** Builds the full render data object consumed by EscalationLadderPanel. */
export function buildRenderData(): EscalationRenderData {
  const crises = CRISES;
  return {
    crises,
    globalBarometer: computeGlobalBarometer(crises),
    highEscalationCount: getHighEscalation(crises).length,
    crossedThresholdCount: getCrossedThresholds(crises).length,
    ascendingCount: crises.filter(c => c.trend === 'ascending').length,
  };
}
