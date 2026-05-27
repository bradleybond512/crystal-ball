/**
 * Pure helpers for EconomicCoercionPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 *
 * Covers:
 *   1. State-Directed Boycotts        — consumer/diplomatic/state-led
 *   2. Export Controls as Leverage    — tech controls, critical-materials bans
 *   3. Economic Statecraft Incidents  — coercive episodes with outcomes
 *   4. Coercion Risk Matrix           — bilateral pair risk scores
 *   5. Active Sanctions Pressure      — multilateral pressure ladder
 *   6. Commodity Weaponisation        — energy, food, minerals as coercion tools
 */

// ── Type unions ───────────────────────────────────────────────────────────

export type BoycottType = 'consumer' | 'diplomatic' | 'state-directed' | 'hybrid';
export type BoycottIntensity = 'symbolic' | 'moderate' | 'severe' | 'paralysing';
export type ControlScope = 'unilateral' | 'multilateral' | 'coordinated-allies';
export type ControlSeverity = 'monitoring' | 'targeted' | 'comprehensive' | 'total-denial';
export type OutcomeVerdict = 'coercer-won' | 'target-resisted' | 'partial-concession' | 'ongoing' | 'backfired';
export type RiskLevel = 'low' | 'elevated' | 'high' | 'critical';
export type PressureRung = 0 | 1 | 2 | 3 | 4 | 5;
export type CommodityClass = 'energy' | 'food' | 'critical-minerals' | 'semiconductors' | 'finance';
export type WeaponisationStage = 'latent' | 'signalled' | 'partial' | 'active' | 'weaponised';

// ── Section 1 — State-Directed Boycotts ──────────────────────────────────

export interface BoycottEntry {
  coercer: string;
  target: string;
  sector: string;
  type: BoycottType;
  intensity: BoycottIntensity;
  /** Estimated annual trade impact USD billions. */
  tradeImpactUsdBn: number;
  /** YYYY-MM date the episode started. */
  startedAt: string;
  trigger: string;
}

const BOYCOTT_INTENSITY_COLORS: Record<BoycottIntensity, string> = {
  symbolic:    'var(--severity-low,      #4caf50)',
  moderate:    'var(--severity-medium,   #facc15)',
  severe:      'var(--severity-high,     #fb923c)',
  paralysing:  'var(--severity-critical, #ef4444)',
};

const BOYCOTT_INTENSITY_LABELS: Record<BoycottIntensity, string> = {
  symbolic:    'Symbolic',
  moderate:    'Moderate',
  severe:      'Severe',
  paralysing:  'Paralysing',
};

const BOYCOTT_TYPE_LABELS: Record<BoycottType, string> = {
  consumer:         'Consumer',
  diplomatic:       'Diplomatic',
  'state-directed': 'State-Directed',
  hybrid:           'Hybrid',
};

export function boycottIntensityColor(i: BoycottIntensity): string { return BOYCOTT_INTENSITY_COLORS[i]; }
export function boycottIntensityLabel(i: BoycottIntensity): string { return BOYCOTT_INTENSITY_LABELS[i]; }
export function boycottTypeLabel(t: BoycottType): string           { return BOYCOTT_TYPE_LABELS[t]; }

export function countSevereBoycotts(entries: BoycottEntry[]): number {
  return entries.filter((e) => e.intensity === 'severe' || e.intensity === 'paralysing').length;
}

export function totalBoycottImpactUsdBn(entries: BoycottEntry[]): number {
  return entries.reduce((acc, e) => acc + e.tradeImpactUsdBn, 0);
}

// ── Section 2 — Export Controls as Geopolitical Leverage ─────────────────

export interface ExportControlEntry {
  imposer: string;
  target: string;
  commodity: string;
  scope: ControlScope;
  severity: ControlSeverity;
  /** Entities added to a denial list. 0 = blanket rule, no entity count. */
  entityCount: number;
  effectiveDate: string;
  strategicRationale: string;
}

const CONTROL_SEVERITY_COLORS: Record<ControlSeverity, string> = {
  monitoring:         'var(--severity-low,      #4caf50)',
  targeted:           'var(--severity-medium,   #facc15)',
  comprehensive:      'var(--severity-high,     #fb923c)',
  'total-denial':     'var(--severity-critical, #ef4444)',
};

const CONTROL_SEVERITY_LABELS: Record<ControlSeverity, string> = {
  monitoring:         'Monitoring',
  targeted:           'Targeted',
  comprehensive:      'Comprehensive',
  'total-denial':     'Total Denial',
};

const CONTROL_SCOPE_LABELS: Record<ControlScope, string> = {
  unilateral:           'Unilateral',
  multilateral:         'Multilateral',
  'coordinated-allies': 'Allied',
};

export function controlSeverityColor(s: ControlSeverity): string { return CONTROL_SEVERITY_COLORS[s]; }
export function controlSeverityLabel(s: ControlSeverity): string { return CONTROL_SEVERITY_LABELS[s]; }
export function controlScopeLabel(s: ControlScope): string        { return CONTROL_SCOPE_LABELS[s]; }

export function countComprehensiveControls(entries: ExportControlEntry[]): number {
  return entries.filter(
    (e) => e.severity === 'comprehensive' || e.severity === 'total-denial',
  ).length;
}

// ── Section 3 — Economic Statecraft Incidents ─────────────────────────────

export interface StatecraftIncident {
  id: string;
  coercer: string;
  target: string;
  tool: string;
  duration: string;
  outcome: OutcomeVerdict;
  gdpImpactTargetPct: number;
  lesson: string;
}

const OUTCOME_COLORS: Record<OutcomeVerdict, string> = {
  'coercer-won':          'var(--severity-critical, #ef4444)',
  'target-resisted':      'var(--severity-low,      #4caf50)',
  'partial-concession':   'var(--severity-medium,   #facc15)',
  'ongoing':              'var(--severity-high,     #fb923c)',
  'backfired':            '#8b5cf6',
};

const OUTCOME_LABELS: Record<OutcomeVerdict, string> = {
  'coercer-won':          'Coercer Won',
  'target-resisted':      'Target Resisted',
  'partial-concession':   'Partial Concession',
  'ongoing':              'Ongoing',
  'backfired':            'Backfired',
};

export function outcomeColor(o: OutcomeVerdict): string { return OUTCOME_COLORS[o]; }
export function outcomeLabel(o: OutcomeVerdict): string { return OUTCOME_LABELS[o]; }

export function coercerSuccessRate(incidents: StatecraftIncident[]): number {
  if (incidents.length === 0) return 0;
  const wins = incidents.filter((i) => i.outcome === 'coercer-won').length;
  return Math.round((wins / incidents.length) * 100);
}

export function highestImpactIncident(incidents: StatecraftIncident[]): StatecraftIncident | null {
  if (incidents.length === 0) return null;
  let best = incidents[0] as StatecraftIncident;
  for (const i of incidents) {
    if (i.gdpImpactTargetPct > best.gdpImpactTargetPct) best = i;
  }
  return best;
}

// ── Section 4 — Bilateral Coercion Risk Matrix ────────────────────────────

export interface CoercionRiskPair {
  coercer: string;
  target: string;
  /** 0–100 composite risk score. */
  riskScore: number;
  /** Key dependency the coercer can exploit. */
  leverageVector: string;
  targetVulnerability: string;
  hedgingCapacity: 'none' | 'low' | 'moderate' | 'high';
}

export function classifyRiskLevel(score: number): RiskLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'elevated';
  return 'low';
}

const RISK_LEVEL_COLORS: Record<RiskLevel, string> = {
  low:      'var(--severity-low,      #4caf50)',
  elevated: 'var(--severity-medium,   #facc15)',
  high:     'var(--severity-high,     #fb923c)',
  critical: 'var(--severity-critical, #ef4444)',
};

const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  low:      'Low',
  elevated: 'Elevated',
  high:     'High',
  critical: 'Critical',
};

export function riskLevelColor(r: RiskLevel): string { return RISK_LEVEL_COLORS[r]; }
export function riskLevelLabel(r: RiskLevel): string { return RISK_LEVEL_LABELS[r]; }

export function sortByRisk(pairs: CoercionRiskPair[]): CoercionRiskPair[] {
  return [...pairs].sort((a, b) => b.riskScore - a.riskScore);
}

export function countCriticalPairs(pairs: CoercionRiskPair[]): number {
  return pairs.filter((p) => classifyRiskLevel(p.riskScore) === 'critical').length;
}

const HEDGING_LABELS: Record<CoercionRiskPair['hedgingCapacity'], string> = {
  none:     'None',
  low:      'Low',
  moderate: 'Moderate',
  high:     'High',
};

export function hedgingLabel(h: CoercionRiskPair['hedgingCapacity']): string {
  return HEDGING_LABELS[h];
}

// ── Section 5 — Active Sanctions Pressure Ladder ─────────────────────────

export interface SanctionsPressureEntry {
  country: string;
  iso3: string;
  rung: PressureRung;
  regimes: string[];
  frozenAssetsUsdBn: number;
  tradeRestrictedUsdBn: number;
  lastEscalation: string;
  nextEscalationRisk: 'none' | 'possible' | 'likely' | 'imminent';
}

const RUNG_LABELS: Record<PressureRung, string> = {
  0: 'None',
  1: 'Designations',
  2: 'Sectoral',
  3: 'SDN-Equivalent',
  4: 'Comprehensive',
  5: 'Total Isolation',
};

const RUNG_COLORS: Record<PressureRung, string> = {
  0: 'var(--severity-none,     #9e9e9e)',
  1: 'var(--severity-low,      #4caf50)',
  2: 'var(--severity-medium,   #facc15)',
  3: 'var(--severity-high,     #fb923c)',
  4: 'var(--severity-critical, #ef4444)',
  5: '#7f1d1d',
};

export function rungLabel(r: PressureRung): string { return RUNG_LABELS[r]; }
export function rungColor(r: PressureRung): string { return RUNG_COLORS[r]; }

const ESCALATION_RISK_COLORS: Record<SanctionsPressureEntry['nextEscalationRisk'], string> = {
  none:     'var(--severity-none,     #9e9e9e)',
  possible: 'var(--severity-medium,   #facc15)',
  likely:   'var(--severity-high,     #fb923c)',
  imminent: 'var(--severity-critical, #ef4444)',
};

export function escalationRiskColor(r: SanctionsPressureEntry['nextEscalationRisk']): string {
  return ESCALATION_RISK_COLORS[r];
}

export function totalFrozenAssetsUsdBn(entries: SanctionsPressureEntry[]): number {
  return entries.reduce((acc, e) => acc + e.frozenAssetsUsdBn, 0);
}

export function countImminentEscalation(entries: SanctionsPressureEntry[]): number {
  return entries.filter((e) => e.nextEscalationRisk === 'imminent' || e.nextEscalationRisk === 'likely').length;
}

// ── Section 6 — Commodity Weaponisation ──────────────────────────────────

export interface CommodityWeaponEntry {
  commodity: string;
  commodityClass: CommodityClass;
  dominantSupplier: string;
  dependentTargets: string;
  stage: WeaponisationStage;
  substituteAvailability: 'none' | 'limited' | 'moderate' | 'ample';
  timeToAlternativeYears: number | null;
  notes: string;
}

const STAGE_COLORS: Record<WeaponisationStage, string> = {
  latent:       'var(--severity-none,     #9e9e9e)',
  signalled:    'var(--severity-low,      #4caf50)',
  partial:      'var(--severity-medium,   #facc15)',
  active:       'var(--severity-high,     #fb923c)',
  weaponised:   'var(--severity-critical, #ef4444)',
};

const STAGE_LABELS: Record<WeaponisationStage, string> = {
  latent:       'Latent',
  signalled:    'Signalled',
  partial:      'Partial',
  active:       'Active',
  weaponised:   'Weaponised',
};

const COMMODITY_CLASS_LABELS: Record<CommodityClass, string> = {
  energy:             'Energy',
  food:               'Food',
  'critical-minerals': 'Critical Minerals',
  semiconductors:     'Semiconductors',
  finance:            'Finance',
};

export function weaponisationStageColor(s: WeaponisationStage): string { return STAGE_COLORS[s]; }
export function weaponisationStageLabel(s: WeaponisationStage): string { return STAGE_LABELS[s]; }
export function commodityClassLabel(c: CommodityClass): string          { return COMMODITY_CLASS_LABELS[c]; }

export function countWeaponisedCommodities(entries: CommodityWeaponEntry[]): number {
  return entries.filter((e) => e.stage === 'weaponised' || e.stage === 'active').length;
}

export function substituteScore(avail: CommodityWeaponEntry['substituteAvailability']): number {
  const scores: Record<CommodityWeaponEntry['substituteAvailability'], number> = {
    none: 0, limited: 1, moderate: 2, ample: 3,
  };
  return scores[avail];
}

// ── Aggregate scoring ─────────────────────────────────────────────────────

export interface CoercionSystemSummary {
  activeBoycotts: number;
  boycottImpactUsdBn: number;
  comprehensiveControls: number;
  criticalPairs: number;
  weaponisedCommodities: number;
  imminentEscalation: number;
}

export function buildSystemSummary(
  boycotts: BoycottEntry[],
  controls: ExportControlEntry[],
  pairs: CoercionRiskPair[],
  sanctions: SanctionsPressureEntry[],
  commodities: CommodityWeaponEntry[],
): CoercionSystemSummary {
  return {
    activeBoycotts:         countSevereBoycotts(boycotts),
    boycottImpactUsdBn:     Math.round(totalBoycottImpactUsdBn(boycotts) * 10) / 10,
    comprehensiveControls:  countComprehensiveControls(controls),
    criticalPairs:          countCriticalPairs(pairs),
    weaponisedCommodities:  countWeaponisedCommodities(commodities),
    imminentEscalation:     countImminentEscalation(sanctions),
  };
}

// ── Static reference data ─────────────────────────────────────────────────

export const BOYCOTTS: BoycottEntry[] = [
  {
    coercer: 'China',
    target: 'Australia',
    sector: 'Barley / Wine / Coal / Beef',
    type: 'state-directed',
    intensity: 'severe',
    tradeImpactUsdBn: 20,
    startedAt: '2020-05',
    trigger: 'Australia called for independent COVID-19 origins inquiry',
  },
  {
    coercer: 'China',
    target: 'Lithuania',
    sector: 'Baltic manufacturing exports',
    type: 'state-directed',
    intensity: 'severe',
    tradeImpactUsdBn: 0.3,
    startedAt: '2021-11',
    trigger: 'Lithuania allowed Taiwan representative office under its own name',
  },
  {
    coercer: 'Russia',
    target: 'Georgia',
    sector: 'Wine / Mineral water / Remittances',
    type: 'state-directed',
    intensity: 'moderate',
    tradeImpactUsdBn: 0.5,
    startedAt: '2006-03',
    trigger: 'Georgian NATO alignment signals',
  },
  {
    coercer: 'Saudi Arabia',
    target: 'Canada',
    sector: 'Medical / Education / Diplomatic',
    type: 'diplomatic',
    intensity: 'moderate',
    tradeImpactUsdBn: 0.15,
    startedAt: '2018-08',
    trigger: 'Canada criticised detention of Saudi women\'s rights activists',
  },
  {
    coercer: 'China',
    target: 'South Korea',
    sector: 'Tourism / K-pop / Retail',
    type: 'hybrid',
    intensity: 'severe',
    tradeImpactUsdBn: 7.5,
    startedAt: '2017-03',
    trigger: 'South Korea deployed THAAD missile defence system',
  },
  {
    coercer: 'Turkey',
    target: 'Netherlands',
    sector: 'Agricultural / Diplomatic',
    type: 'diplomatic',
    intensity: 'symbolic',
    tradeImpactUsdBn: 0.05,
    startedAt: '2017-03',
    trigger: 'Netherlands blocked Turkish ministers from addressing diaspora rallies',
  },
];

export const EXPORT_CONTROLS: ExportControlEntry[] = [
  {
    imposer: 'USA',
    target: 'China',
    commodity: 'Advanced Semiconductors / EDA Tools',
    scope: 'coordinated-allies',
    severity: 'total-denial',
    entityCount: 614,
    effectiveDate: '2022-10',
    strategicRationale: 'Deny PLA access to AI-capable chips; preserve US-led compute advantage',
  },
  {
    imposer: 'USA + EU + UK',
    target: 'Russia',
    commodity: 'Dual-use electronics / Aerospace components',
    scope: 'multilateral',
    severity: 'comprehensive',
    entityCount: 1200,
    effectiveDate: '2022-02',
    strategicRationale: 'Degrade Russian military-industrial complex following Ukraine invasion',
  },
  {
    imposer: 'China',
    target: 'Global',
    commodity: 'Gallium / Germanium',
    scope: 'unilateral',
    severity: 'targeted',
    entityCount: 0,
    effectiveDate: '2023-07',
    strategicRationale: 'Retaliation for US chip controls; signal leverage over EU/Japan defence',
  },
  {
    imposer: 'China',
    target: 'Global',
    commodity: 'Rare Earth Elements',
    scope: 'unilateral',
    severity: 'targeted',
    entityCount: 0,
    effectiveDate: '2023-10',
    strategicRationale: 'Signal leverage over Western EV and defence supply chains',
  },
  {
    imposer: 'Netherlands (ASML)',
    target: 'China',
    commodity: 'EUV / DUV Lithography',
    scope: 'coordinated-allies',
    severity: 'comprehensive',
    entityCount: 0,
    effectiveDate: '2023-06',
    strategicRationale: 'Align with US entity-list regime; block sub-14nm chip production',
  },
  {
    imposer: 'Japan',
    target: 'South Korea',
    commodity: 'Fluorinated polyimide / Resist / HF',
    scope: 'unilateral',
    severity: 'targeted',
    entityCount: 0,
    effectiveDate: '2019-07',
    strategicRationale: 'Pressure over WWII forced-labour court rulings',
  },
];

export const STATECRAFT_INCIDENTS: StatecraftIncident[] = [
  {
    id: 'rus-ukr-gas-2006',
    coercer: 'Russia',
    target: 'Ukraine',
    tool: 'Natural gas price shock / cutoff',
    duration: '3 months',
    outcome: 'partial-concession',
    gdpImpactTargetPct: 1.2,
    lesson: 'Gas cutoffs cause immediate pain but prompt diversification; EU pressure limited Russia\'s leverage',
  },
  {
    id: 'chn-aus-2020',
    coercer: 'China',
    target: 'Australia',
    tool: 'Multi-sector trade restrictions',
    duration: '36 months',
    outcome: 'target-resisted',
    gdpImpactTargetPct: 0.4,
    lesson: 'Australia pivoted exports to India/UK; China forfeited quality barley and coal supplies',
  },
  {
    id: 'us-iran-oil-2018',
    coercer: 'USA',
    target: 'Iran',
    tool: 'Secondary oil sanctions (SWIFT/INSTEX)',
    duration: 'Ongoing',
    outcome: 'ongoing',
    gdpImpactTargetPct: 8.5,
    lesson: 'Severe GDP impact but regime survived; Iran diversified via Russia/China corridors',
  },
  {
    id: 'chn-mng-coal-2021',
    coercer: 'China',
    target: 'Mongolia',
    tool: 'Coal inspection delays / port blockage',
    duration: '6 months',
    outcome: 'partial-concession',
    gdpImpactTargetPct: 2.1,
    lesson: 'Landlocked states with a single border crossing face acute coercion vulnerability',
  },
  {
    id: 'rus-belarus-2010',
    coercer: 'Russia',
    target: 'Belarus',
    tool: 'Oil supply interruption + price shock',
    duration: '2 months',
    outcome: 'coercer-won',
    gdpImpactTargetPct: 1.8,
    lesson: 'Tight economic integration creates rapid capitulation; Belarus signed deeper union terms',
  },
  {
    id: 'chn-nor-salmon-2010',
    coercer: 'China',
    target: 'Norway',
    tool: 'Norwegian salmon import curb',
    duration: '6 years',
    outcome: 'backfired',
    gdpImpactTargetPct: 0.03,
    lesson: "Nobel Peace Prize row — Norway's salmon found alternative buyers; China lost WTO credibility",
  },
];

export const COERCION_RISK_PAIRS: CoercionRiskPair[] = [
  {
    coercer: 'China',
    target: 'Taiwan',
    riskScore: 92,
    leverageVector: 'Trade dependence; rare earth access; manufacturing integration',
    targetVulnerability: '40% of exports to China; semiconductor supply chain concentration',
    hedgingCapacity: 'moderate',
  },
  {
    coercer: 'Russia',
    target: 'Germany',
    riskScore: 74,
    leverageVector: 'Natural gas (was 55% of imports pre-2022)',
    targetVulnerability: 'Industrial gas dependence; LNG capacity constraints',
    hedgingCapacity: 'high',
  },
  {
    coercer: 'China',
    target: 'South Korea',
    riskScore: 71,
    leverageVector: 'Tourism; rare earths; display chemicals; K-pop market',
    targetVulnerability: 'THAAD-era exposure; 25% exports to China',
    hedgingCapacity: 'moderate',
  },
  {
    coercer: 'USA',
    target: 'China',
    riskScore: 68,
    leverageVector: 'Advanced semiconductor / EDA denial; dollar system access',
    targetVulnerability: 'TSMC dependency; SWIFT exposure for energy payments',
    hedgingCapacity: 'low',
  },
  {
    coercer: 'China',
    target: 'Philippines',
    riskScore: 60,
    leverageVector: 'OFW remittances; banana/fruit exports; BRI projects',
    targetVulnerability: 'South China Sea resource access; OFW worker vulnerability',
    hedgingCapacity: 'low',
  },
  {
    coercer: 'China',
    target: 'Lithuania',
    riskScore: 45,
    leverageVector: 'EU supply-chain exposure via German/French intermediaries',
    targetVulnerability: 'Small economy; EU support limited China\'s effect',
    hedgingCapacity: 'high',
  },
  {
    coercer: 'Russia',
    target: 'Moldova',
    riskScore: 82,
    leverageVector: 'Electricity (Transnistrian plant); gas; remittances',
    targetVulnerability: 'Transnistria gas debt; limited alternative energy infrastructure',
    hedgingCapacity: 'none',
  },
  {
    coercer: 'Saudi Arabia',
    target: 'Pakistan',
    riskScore: 55,
    leverageVector: 'Oil credit lines; remittances (2.7M workers); FDI',
    targetVulnerability: 'Balance-of-payments fragility; IMF reliance',
    hedgingCapacity: 'low',
  },
];

export const SANCTIONS_PRESSURE: SanctionsPressureEntry[] = [
  {
    country: 'Russia',
    iso3: 'RUS',
    rung: 4,
    regimes: ['OFAC', 'EU', 'UK-OFSI', 'Canada', 'Japan', 'Australia'],
    frozenAssetsUsdBn: 300,
    tradeRestrictedUsdBn: 180,
    lastEscalation: '2023-02',
    nextEscalationRisk: 'possible',
  },
  {
    country: 'Iran',
    iso3: 'IRN',
    rung: 4,
    regimes: ['OFAC', 'EU', 'UN', 'UK-OFSI'],
    frozenAssetsUsdBn: 110,
    tradeRestrictedUsdBn: 90,
    lastEscalation: '2018-11',
    nextEscalationRisk: 'possible',
  },
  {
    country: 'North Korea',
    iso3: 'PRK',
    rung: 5,
    regimes: ['OFAC', 'EU', 'UN', 'UK-OFSI', 'Japan'],
    frozenAssetsUsdBn: 2,
    tradeRestrictedUsdBn: 95,
    lastEscalation: '2017-09',
    nextEscalationRisk: 'possible',
  },
  {
    country: 'Venezuela',
    iso3: 'VEN',
    rung: 3,
    regimes: ['OFAC', 'EU'],
    frozenAssetsUsdBn: 5,
    tradeRestrictedUsdBn: 14,
    lastEscalation: '2019-01',
    nextEscalationRisk: 'none',
  },
  {
    country: 'Belarus',
    iso3: 'BLR',
    rung: 3,
    regimes: ['OFAC', 'EU', 'UK-OFSI'],
    frozenAssetsUsdBn: 8,
    tradeRestrictedUsdBn: 20,
    lastEscalation: '2022-03',
    nextEscalationRisk: 'likely',
  },
  {
    country: 'Myanmar',
    iso3: 'MMR',
    rung: 2,
    regimes: ['OFAC', 'EU', 'UK-OFSI'],
    frozenAssetsUsdBn: 1,
    tradeRestrictedUsdBn: 4,
    lastEscalation: '2021-02',
    nextEscalationRisk: 'possible',
  },
];

export const COMMODITY_WEAPONS: CommodityWeaponEntry[] = [
  {
    commodity: 'Natural Gas (pipeline)',
    commodityClass: 'energy',
    dominantSupplier: 'Russia',
    dependentTargets: 'Central/Eastern Europe; Turkey; Serbia',
    stage: 'active',
    substituteAvailability: 'moderate',
    timeToAlternativeYears: 2,
    notes: 'European LNG terminals online; Russia lost 80% market share 2022–2024',
  },
  {
    commodity: 'Rare Earth Elements (heavy)',
    commodityClass: 'critical-minerals',
    dominantSupplier: 'China',
    dependentTargets: 'USA / EU / Japan (defence / EV)',
    stage: 'weaponised',
    substituteAvailability: 'limited',
    timeToAlternativeYears: 7,
    notes: 'China controls ~85% of global refining; Oct 2024 export controls activated',
  },
  {
    commodity: 'Gallium / Germanium',
    commodityClass: 'critical-minerals',
    dominantSupplier: 'China',
    dependentTargets: 'Semiconductor fabs globally',
    stage: 'weaponised',
    substituteAvailability: 'limited',
    timeToAlternativeYears: 5,
    notes: 'China = 94% Ga production, 67% Ge; July 2023 export controls enforced',
  },
  {
    commodity: 'Advanced Semiconductors',
    commodityClass: 'semiconductors',
    dominantSupplier: 'Taiwan (TSMC)',
    dependentTargets: 'China / Global AI infrastructure',
    stage: 'weaponised',
    substituteAvailability: 'none',
    timeToAlternativeYears: 10,
    notes: 'US/allied controls deny China sub-7nm; SMIC yields remain constrained',
  },
  {
    commodity: 'Wheat / Grain exports',
    commodityClass: 'food',
    dominantSupplier: 'Russia / Ukraine',
    dependentTargets: 'MENA / Sub-Saharan Africa',
    stage: 'active',
    substituteAvailability: 'limited',
    timeToAlternativeYears: 1,
    notes: 'Black Sea Grain Initiative collapsed 2023; Russia periodically weaponises access',
  },
  {
    commodity: 'Dollar SWIFT access',
    commodityClass: 'finance',
    dominantSupplier: 'USA / SWIFT consortium',
    dependentTargets: 'Iran / Russia / any sanctioned state',
    stage: 'weaponised',
    substituteAvailability: 'limited',
    timeToAlternativeYears: 4,
    notes: 'CIPS/SPFS alternatives emerging; dedollarisation momentum but deep USD moat persists',
  },
];
