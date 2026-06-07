/**
 * Pure helpers for ArmsSalesPanel.
 *
 * Tracks major conventional arms transfers as a geopolitical alignment
 * indicator (SIPRI-inspired data). Arms flows reveal alliances, dependencies,
 * and strategic intentions.
 *
 * Covers: top 10 exporters (2019-2023 share), 12 major deals (2022-2024),
 * major importer profiles, and a composite global arms trade index.
 *
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExporterTrend = 'rising' | 'stable' | 'declining';

export type DealType =
  | 'military-aid'
  | 'fms'
  | 'direct-commercial'
  | 'grant'
  | 'government-to-government';

export type DealStatus =
  | 'active'
  | 'delivered'
  | 'paused'
  | 'pending'
  | 'controversial'
  | 'declining';

export type DealCategory =
  | 'air'
  | 'ground'
  | 'air-defense'
  | 'naval'
  | 'mixed'
  | 'intelligence';

export type DominanceRisk = 'low' | 'moderate' | 'high' | 'critical';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface ArmsExporter {
  country: string;
  code: string;
  /** Share of global conventional arms transfers, 2019-2023 (percent). */
  share2019_2023: number;
  trend: ExporterTrend;
  primaryRecipients: string[];
}

export interface ArmsDeal {
  id: string;
  exporter: string;
  exporterCode: string;
  recipient: string;
  recipientCode: string;
  /** Estimated deal value in USD billions. */
  valueUsdB: number;
  systems: string[];
  period: string;
  dealType: DealType;
  status: DealStatus;
  category: DealCategory;
  notes: string;
}

export interface ImporterProfile {
  country: string;
  code: string;
  mainSuppliers: string[];
  keySystems: string[];
  strategicNote: string;
}

export interface GlobalArmsIndex {
  /** Composite 0-100 score. */
  score: number;
  trend: ExporterTrend;
  /** Percent increase in global arms transfers since 2022. */
  postUkraineUplift: number;
  usaDominanceRisk: DominanceRisk;
}

export interface RenderData {
  exporters: ArmsExporter[];
  deals: ArmsDeal[];
  importers: ImporterProfile[];
  globalIndex: GlobalArmsIndex;
  totalDealValueUsdB: number;
  activeDeals: number;
  controversialDeals: number;
}

// ── Static Data ───────────────────────────────────────────────────────────────

/** Top 10 arms exporters by global share, 2019-2023 (SIPRI-derived). */
export const TOP_EXPORTERS: ArmsExporter[] = [
  {
    country: 'United States',
    code: 'USA',
    share2019_2023: 42,
    trend: 'rising',
    primaryRecipients: ['Saudi Arabia', 'India', 'Australia', 'Taiwan', 'Ukraine'],
  },
  {
    country: 'Russia',
    code: 'RUS',
    share2019_2023: 11,
    trend: 'declining',
    primaryRecipients: ['India', 'China', 'Egypt', 'Algeria'],
  },
  {
    country: 'France',
    code: 'FRA',
    share2019_2023: 11,
    trend: 'rising',
    primaryRecipients: ['India', 'Qatar', 'Greece', 'Egypt'],
  },
  {
    country: 'China',
    code: 'CHN',
    share2019_2023: 5.8,
    trend: 'stable',
    primaryRecipients: ['Pakistan', 'Bangladesh', 'Myanmar'],
  },
  {
    country: 'Germany',
    code: 'DEU',
    share2019_2023: 5.6,
    trend: 'rising',
    primaryRecipients: ['Ukraine', 'Hungary', 'South Korea'],
  },
  {
    country: 'Italy',
    code: 'ITA',
    share2019_2023: 3.8,
    trend: 'stable',
    primaryRecipients: ['Qatar', 'Egypt', 'Turkey'],
  },
  {
    country: 'United Kingdom',
    code: 'GBR',
    share2019_2023: 3.1,
    trend: 'declining',
    primaryRecipients: ['Saudi Arabia', 'Oman', 'Ukraine'],
  },
  {
    country: 'Spain',
    code: 'ESP',
    share2019_2023: 2.8,
    trend: 'stable',
    primaryRecipients: ['Saudi Arabia', 'Turkey', 'Australia'],
  },
  {
    country: 'Israel',
    code: 'ISR',
    share2019_2023: 2.4,
    trend: 'declining',
    primaryRecipients: ['India', 'Azerbaijan', 'Philippines'],
  },
  {
    country: 'South Korea',
    code: 'KOR',
    share2019_2023: 2.3,
    trend: 'rising',
    primaryRecipients: ['Poland', 'UAE', 'Norway', 'Australia'],
  },
];

/** 12 major arms transfer deals, 2022-2024. */
export const MAJOR_DEALS: ArmsDeal[] = [
  {
    id: 'usa-ukr-2022',
    exporter: 'United States',
    exporterCode: 'USA',
    recipient: 'Ukraine',
    recipientCode: 'UKR',
    valueUsdB: 61,
    systems: ['HIMARS', 'M1 Abrams', 'Patriot PAC-3', 'F-16', 'ATACMS', 'M109 Paladin'],
    period: '2022-2024',
    dealType: 'military-aid',
    status: 'active',
    category: 'mixed',
    notes: '$61B+ security assistance; largest US aid package since WWII; 50+ nation coalition',
  },
  {
    id: 'usa-twn-2022',
    exporter: 'United States',
    exporterCode: 'USA',
    recipient: 'Taiwan',
    recipientCode: 'TWN',
    valueUsdB: 19,
    systems: ['F-16V Block 70', 'Harpoon Block II', 'HIMARS', 'M1A2T Abrams', 'Stinger'],
    period: '2022-2024',
    dealType: 'fms',
    status: 'controversial',
    category: 'mixed',
    notes: 'China protests each FMS notification; F-16V upgrade reshapes cross-strait air balance',
  },
  {
    id: 'usa-isr-2023',
    exporter: 'United States',
    exporterCode: 'USA',
    recipient: 'Israel',
    recipientCode: 'ISR',
    valueUsdB: 14.1,
    systems: ['F-35I Adir', 'JDAM', 'Hellfire', 'GBU-39 SDB'],
    period: '2023-2024',
    dealType: 'military-aid',
    status: 'controversial',
    category: 'mixed',
    notes: 'Cluster munitions controversy; $6.5B FMF + emergency supplementals; ICJ scrutiny',
  },
  {
    id: 'usa-sau-2024',
    exporter: 'United States',
    exporterCode: 'USA',
    recipient: 'Saudi Arabia',
    recipientCode: 'SAU',
    valueUsdB: 3.8,
    systems: ['MIM-104 Patriot PAC-3', 'GBU-39 SDB', 'AIM-120 AMRAAM'],
    period: '2024',
    dealType: 'fms',
    status: 'paused',
    category: 'air-defense',
    notes: 'Approved then suspended over Yemen war leverage; normalization diplomacy entangled',
  },
  {
    id: 'usa-kor-2023',
    exporter: 'United States',
    exporterCode: 'USA',
    recipient: 'South Korea',
    recipientCode: 'KOR',
    valueUsdB: 6.2,
    systems: ['F-35A Block 4', 'THAAD battery', 'AH-64E Apache Guardian'],
    period: '2022-2024',
    dealType: 'fms',
    status: 'active',
    category: 'mixed',
    notes: 'THAAD expansion despite Chinese pressure; DPRK missile escalation driver',
  },
  {
    id: 'fra-ind-2024',
    exporter: 'France',
    exporterCode: 'FRA',
    recipient: 'India',
    recipientCode: 'IND',
    valueUsdB: 7.4,
    systems: ['Rafale Marine', 'Scorpene submarine', 'SCALP-EG cruise missile'],
    period: '2022-2024',
    dealType: 'government-to-government',
    status: 'active',
    category: 'mixed',
    notes: '36 Rafale Air delivered; 26 Rafale Marine contracted 2024; India diversifying from Russia',
  },
  {
    id: 'deu-ukr-2022',
    exporter: 'Germany',
    exporterCode: 'DEU',
    recipient: 'Ukraine',
    recipientCode: 'UKR',
    valueUsdB: 5.4,
    systems: ['Leopard 2A6', 'Patriot system', 'IRIS-T SLM', 'PzH 2000'],
    period: '2022-2024',
    dealType: 'military-aid',
    status: 'active',
    category: 'mixed',
    notes: 'Post-Zeitenwende shift; Leopard 2 delivery after months of political controversy',
  },
  {
    id: 'rus-irn-2022',
    exporter: 'Russia',
    exporterCode: 'RUS',
    recipient: 'Iran',
    recipientCode: 'IRN',
    valueUsdB: 1.5,
    systems: ['Su-35', 'S-400 components', 'Mi-28 helicopter'],
    period: '2022-2024',
    dealType: 'government-to-government',
    status: 'controversial',
    category: 'air',
    notes: 'Evidence disputed; barter — Iran supplied Shahed-136 drones; UN sanctions evasion',
  },
  {
    id: 'rus-prk-2023',
    exporter: 'Russia',
    exporterCode: 'RUS',
    recipient: 'North Korea',
    recipientCode: 'PRK',
    valueUsdB: 0.8,
    systems: ['Artillery shells (1M+)', 'Ballistic missile tech', 'Fuel supply'],
    period: '2023-2024',
    dealType: 'government-to-government',
    status: 'controversial',
    category: 'mixed',
    notes: 'UN Panel of Experts report; shells-for-energy barter; DPRK troops reported in Russia',
  },
  {
    id: 'chn-pak-2022',
    exporter: 'China',
    exporterCode: 'CHN',
    recipient: 'Pakistan',
    recipientCode: 'PAK',
    valueUsdB: 2.3,
    systems: ['J-10C Vigorous Dragon', 'PL-15 BVRAAM', 'Type 054A/P frigate'],
    period: '2022-2024',
    dealType: 'government-to-government',
    status: 'active',
    category: 'mixed',
    notes: 'J-10C delivered; FC-31 stealth discussed; deepens China-Pakistan axis vs India',
  },
  {
    id: 'kor-pol-2022',
    exporter: 'South Korea',
    exporterCode: 'KOR',
    recipient: 'Poland',
    recipientCode: 'POL',
    valueUsdB: 15,
    systems: ['K2 Black Panther (1,000)', 'K9 Thunder SPH (648)', 'FA-50 fighter', 'Chunmoo MLRS'],
    period: '2022-2025',
    dealType: 'direct-commercial',
    status: 'active',
    category: 'ground',
    notes: '$15B framework; largest-ever Korean arms export; Poland building 4th-largest EU land force',
  },
  {
    id: 'isr-var-2022',
    exporter: 'Israel',
    exporterCode: 'ISR',
    recipient: 'Various',
    recipientCode: 'VAR',
    valueUsdB: 3.1,
    systems: ['Heron TP UAV', 'Hermes 900', 'Spike NLOS ATGM', 'Elbit systems'],
    period: '2022-2024',
    dealType: 'direct-commercial',
    status: 'declining',
    category: 'mixed',
    notes: 'Export momentum declining post-Gaza; India, Azerbaijan, Philippines primary customers',
  },
];

/** Major importer profiles with strategic context. */
export const MAJOR_IMPORTERS: ImporterProfile[] = [
  {
    country: 'Ukraine',
    code: 'UKR',
    mainSuppliers: ['USA', 'Germany', 'UK', 'France'],
    keySystems: ['HIMARS', 'Patriot PAC-3', 'Leopard 2', 'F-16', 'ATACMS'],
    strategicNote: 'Largest conventional arms recipient since 2022; 50+ nation coalition',
  },
  {
    country: 'Saudi Arabia',
    code: 'SAU',
    mainSuppliers: ['USA', 'UK', 'France'],
    keySystems: ['F-15SA', 'Patriot PAC-3', 'Eurofighter Typhoon', 'AH-64 Apache'],
    strategicNote: 'Oil leverage shapes supply politics; Yemen creates humanitarian controversy',
  },
  {
    country: 'India',
    code: 'IND',
    mainSuppliers: ['France', 'Russia', 'USA', 'Israel'],
    keySystems: ['Rafale', 'S-400 Triumf', 'MH-60R Seahawk', 'C-295'],
    strategicNote: 'Diversifying from Russia; strategic autonomy doctrine; largest global importer',
  },
  {
    country: 'Australia',
    code: 'AUS',
    mainSuppliers: ['USA', 'UK'],
    keySystems: ['F-35A', 'AUKUS SSN submarine', 'MQ-4C Triton', 'Tomahawk'],
    strategicNote: 'AUKUS reshaping Indo-Pacific balance; China deterrence primary driver',
  },
  {
    country: 'Qatar',
    code: 'QAT',
    mainSuppliers: ['USA', 'France', 'UK'],
    keySystems: ['F-15QA', 'Rafale', 'Eurofighter Typhoon', 'AH-64 Apache'],
    strategicNote: 'Small state hedging via diversified supplier base; gas wealth enables top-tier procurement',
  },
  {
    country: 'Taiwan',
    code: 'TWN',
    mainSuppliers: ['USA'],
    keySystems: ['F-16V Block 70', 'Patriot PAC-3', 'HIMARS', 'Harpoon Block II'],
    strategicNote: 'USA sole major supplier; porcupine strategy prioritizes asymmetric anti-access systems',
  },
  {
    country: 'Poland',
    code: 'POL',
    mainSuppliers: ['USA', 'South Korea', 'Germany'],
    keySystems: ['F-35A', 'K2 Black Panther', 'K9 Thunder', 'HIMARS', 'AH-64 Apache'],
    strategicNote: 'Largest NATO modernization post-2022; targeting largest land force in Europe',
  },
  {
    country: 'UAE',
    code: 'ARE',
    mainSuppliers: ['France', 'South Korea', 'USA'],
    keySystems: ['Rafale', 'K9 Thunder SPH', 'Patriot PAC-3', 'MQ-9B SeaGuardian'],
    strategicNote: 'F-35 deal cancelled over Huawei dispute; pivoting to French Rafale; Houthi threat driver',
  },
];

// ── Helper Functions ──────────────────────────────────────────────────────────

/** Returns all top exporters sorted by market share descending. */
export function getTopExporters(): ArmsExporter[] {
  return [...TOP_EXPORTERS].sort((a, b) => b.share2019_2023 - a.share2019_2023);
}

/** Returns all 12 major deals. */
export function getMajorDeals(): ArmsDeal[] {
  return [...MAJOR_DEALS];
}

/** Returns deals where recipient matches (case-insensitive code or name substring). */
export function getByRecipient(query: string): ArmsDeal[] {
  const q = query.toLowerCase();
  return MAJOR_DEALS.filter(
    (d) => d.recipient.toLowerCase().includes(q) || d.recipientCode.toLowerCase() === q,
  );
}

/** Returns deals where exporter matches (case-insensitive code or name substring). */
export function getByExporter(query: string): ArmsDeal[] {
  const q = query.toLowerCase();
  return MAJOR_DEALS.filter(
    (d) => d.exporter.toLowerCase().includes(q) || d.exporterCode.toLowerCase() === q,
  );
}

/**
 * Computes a composite Global Arms Trade Index (0-100).
 *
 * Factors:
 * - Volume score (0-50): total deal value relative to a $200B notional ceiling
 * - Active-conflict score (0-30): fraction of deals in active status
 * - USA dominance penalty (0-20): risk from single-supplier concentration
 */
export function computeGlobalArmsIndex(): GlobalArmsIndex {
  const totalVolume = MAJOR_DEALS.reduce((sum, d) => sum + d.valueUsdB, 0);
  const usaVolume = MAJOR_DEALS
    .filter((d) => d.exporterCode === 'USA')
    .reduce((sum, d) => sum + d.valueUsdB, 0);
  const usaShare = totalVolume > 0 ? usaVolume / totalVolume : 0;

  const volumeScore = Math.min(50, (totalVolume / 200) * 50);
  const activeCount = MAJOR_DEALS.filter((d) => d.status === 'active').length;
  const conflictScore = Math.min(30, (activeCount / MAJOR_DEALS.length) * 30);
  const dominancePenalty =
    usaShare > 0.55 ? 20 : usaShare > 0.4 ? 14 : usaShare > 0.25 ? 8 : 4;

  const score = Math.min(100, Math.round(volumeScore + conflictScore + dominancePenalty));
  const usaDominanceRisk: DominanceRisk =
    usaShare > 0.55
      ? 'critical'
      : usaShare > 0.4
        ? 'high'
        : usaShare > 0.25
          ? 'moderate'
          : 'low';

  return { score, trend: 'rising', postUkraineUplift: 37, usaDominanceRisk };
}

/** Returns an inline CSS color string based on an exporter global market share. */
export function exporterShareClass(share: number): string {
  if (share >= 30) return 'color:#ef4444';
  if (share >= 10) return 'color:#f97316';
  if (share >= 5)  return 'color:#facc15';
  return 'color:#9e9e9e';
}

/** Returns an inline CSS color string for a deal type. */
export function dealTypeClass(dealType: DealType): string {
  switch (dealType) {
    case 'military-aid':             return 'color:#ef4444';
    case 'fms':                       return 'color:#f97316';
    case 'direct-commercial':         return 'color:#facc15';
    case 'government-to-government':  return 'color:#60a5fa';
    case 'grant':                     return 'color:#4ade80';
    default:                           return 'color:#9e9e9e';
  }
}

/** Returns an inline CSS color string for a deal status. */
export function dealStatusColor(status: DealStatus): string {
  switch (status) {
    case 'active':        return '#4ade80';
    case 'delivered':     return '#60a5fa';
    case 'paused':        return '#fbbf24';
    case 'pending':       return '#9e9e9e';
    case 'controversial': return '#ef4444';
    case 'declining':     return '#f97316';
    default:               return '#9e9e9e';
  }
}

/** Returns a short display label for a deal type. */
export function dealTypeLabel(dealType: DealType): string {
  switch (dealType) {
    case 'military-aid':             return 'Military Aid';
    case 'fms':                       return 'FMS';
    case 'direct-commercial':         return 'Commercial';
    case 'government-to-government':  return 'G2G';
    case 'grant':                     return 'Grant';
    default:                           return dealType;
  }
}

/** Returns a short display label for a deal category. */
export function dealCategoryLabel(category: DealCategory): string {
  switch (category) {
    case 'air':          return 'Air';
    case 'ground':       return 'Ground';
    case 'air-defense':  return 'Air Defense';
    case 'naval':        return 'Naval';
    case 'mixed':        return 'Mixed';
    case 'intelligence': return 'Intel';
    default:              return category;
  }
}

/** Returns a display label for an exporter trend. */
export function trendLabel(trend: ExporterTrend): string {
  switch (trend) {
    case 'rising':   return 'Rising';
    case 'declining': return 'Declining';
    case 'stable':   return 'Stable';
    default:          return trend;
  }
}

/** Returns a CSS color string for an exporter trend. */
export function trendColor(trend: ExporterTrend): string {
  switch (trend) {
    case 'rising':   return '#4ade80';
    case 'declining': return '#f97316';
    case 'stable':   return '#9e9e9e';
    default:          return '#9e9e9e';
  }
}

/** Returns a CSS color string for a Global Arms Index score. */
export function globalIndexColor(score: number): string {
  if (score >= 75) return '#ef4444';
  if (score >= 50) return '#f97316';
  if (score >= 25) return '#facc15';
  return '#4ade80';
}

/** Returns a CSS color string for a USA dominance risk level. */
export function dominanceRiskColor(risk: DominanceRisk): string {
  switch (risk) {
    case 'critical': return '#ef4444';
    case 'high':     return '#f97316';
    case 'moderate': return '#facc15';
    case 'low':      return '#4ade80';
    default:          return '#9e9e9e';
  }
}

/** Counts deals matching a given status. */
export function countByStatus(status: DealStatus): number {
  return MAJOR_DEALS.filter((d) => d.status === status).length;
}

/** Sums deal values in USD billions for the provided deals array. */
export function totalDealValueUsdB(deals: ArmsDeal[]): number {
  return deals.reduce((sum, d) => sum + d.valueUsdB, 0);
}

/** Formats a USD-billions value to a compact display string. */
export function formatUsdB(value: number): string {
  if (value >= 100) return `$${Math.round(value)}B`;
  return `$${value.toFixed(1)}B`;
}

/** Formats a market share percentage. */
export function formatShare(share: number): string {
  return `${share}%`;
}

/** Assembles all render data for the panel in a single call. */
export function buildRenderData(): RenderData {
  const exporters = getTopExporters();
  const deals = getMajorDeals();
  const importers = MAJOR_IMPORTERS;
  const globalIndex = computeGlobalArmsIndex();

  return {
    exporters,
    deals,
    importers,
    globalIndex,
    totalDealValueUsdB: totalDealValueUsdB(deals),
    activeDeals: countByStatus('active'),
    controversialDeals: countByStatus('controversial'),
  };
}
