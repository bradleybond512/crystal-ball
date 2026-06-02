// debt-trap-diplomacy-helpers.ts
// Pure logic for DebtTrapDiplomacyPanel -- no DOM, no Panel imports

export type LeverageType =
  | 'Port/Infrastructure'
  | 'Resource Extraction'
  | 'Strategic Access'
  | 'Currency Swap'
  | 'Railway/Transport'
  | 'Mixed';

export type DebtorStatus =
  | 'At Risk'
  | 'Restructuring'
  | 'Defaulted'
  | 'Repaying';

export interface BriDebtor {
  id: string;
  country: string;
  iso3: string;
  /** USD billions owed directly to Chinese entities (EXIM, CDB, PBOC). */
  debtToChinaBn: number;
  /** Total external debt as % of GDP. */
  debtToGdpPct: number;
  /** Chinese-held debt as % of GDP -- the primary coercion metric. */
  chineseDebtToGdpPct: number;
  strategicAsset: string;
  status: DebtorStatus;
  leverageType: LeverageType;
  notes: string;
}

export interface GlobalBriStats {
  /** China total overseas lending (Policy + commercial), USD billions. */
  chinaOverseasLendingBn: number;
  /** World Bank + IMF combined outstanding loans, USD billions. */
  worldBankImfCombinedBn: number;
  briCountriesAtRisk: number;
  totalBriDebtBn: number;
  /** 0-100 composite vulnerability index. */
  vulnerabilityIndex: number;
}

export interface BriRenderData {
  debtors: BriDebtor[];
  stats: GlobalBriStats;
  atRiskCount: number;
  defaultedCount: number;
  restructuringCount: number;
}

// ---- Country data ---------------------------------------------------------------

const BRI_DEBTORS: BriDebtor[] = [
  {
    id: 'D001',
    country: 'Sri Lanka',
    iso3: 'LKA',
    debtToChinaBn: 7.4,
    debtToGdpPct: 119,
    chineseDebtToGdpPct: 10,
    strategicAsset: 'Hambantota Port (99-yr lease 2017)',
    status: 'Defaulted',
    leverageType: 'Port/Infrastructure',
    notes: 'Defaulted on sovereign debt 2022; Hambantota Port leased 99 yrs to CMPort after default; IMF $2.9B bailout; textbook asset-seizure outcome.',
  },
  {
    id: 'D002',
    country: 'Zambia',
    iso3: 'ZMB',
    debtToChinaBn: 6.6,
    debtToGdpPct: 143,
    chineseDebtToGdpPct: 30,
    strategicAsset: 'ZESCO power infrastructure; Copperbelt mining concessions',
    status: 'Restructuring',
    leverageType: 'Resource Extraction',
    notes: 'First African BRI debt restructuring 2023 under G20 Common Framework; Chinese creditors hold ~30% external debt; copper sector leverage.',
  },
  {
    id: 'D003',
    country: 'Pakistan',
    iso3: 'PAK',
    debtToChinaBn: 65,
    debtToGdpPct: 74,
    chineseDebtToGdpPct: 22,
    strategicAsset: 'Gwadar Port; CPEC corridor (3,000 km)',
    status: 'At Risk',
    leverageType: 'Port/Infrastructure',
    notes: 'CPEC total commitment ~$65B; chronic IMF dependency; Gwadar Port provides PLAN Indian Ocean access; high-cost power agreements.',
  },
  {
    id: 'D004',
    country: 'Kenya',
    iso3: 'KEN',
    debtToChinaBn: 8.7,
    debtToGdpPct: 67,
    chineseDebtToGdpPct: 21,
    strategicAsset: 'Mombasa Port (SGR loan collateral)',
    status: 'At Risk',
    leverageType: 'Railway/Transport',
    notes: 'SGR Nairobi-Mombasa railway; Mombasa Port named as collateral in EXIM Bank contract; renegotiation ongoing; ~$5B owed to China.',
  },
  {
    id: 'D005',
    country: 'Ecuador',
    iso3: 'ECU',
    debtToChinaBn: 17.4,
    debtToGdpPct: 58,
    chineseDebtToGdpPct: 15,
    strategicAsset: 'Coca Codo Sinclair hydrodam; oil reserves',
    status: 'Repaying',
    leverageType: 'Resource Extraction',
    notes: 'Oil-backed loans to CNPC/Sinopec; dam defects post-construction; oil pre-sale repayment mechanism; governance concerns.',
  },
  {
    id: 'D006',
    country: 'Montenegro',
    iso3: 'MNE',
    debtToChinaBn: 1,
    debtToGdpPct: 89,
    chineseDebtToGdpPct: 25,
    strategicAsset: 'E762 Bar-Boljare highway',
    status: 'Restructuring',
    leverageType: 'Port/Infrastructure',
    notes: 'EXIM Bank loan at above-market rates; Montenegro sought EU bailout EUR 944M; EU intervened 2021 to prevent Chinese asset-seizure clause.',
  },
  {
    id: 'D007',
    country: 'Laos',
    iso3: 'LAO',
    debtToChinaBn: 13.3,
    debtToGdpPct: 128,
    chineseDebtToGdpPct: 55,
    strategicAsset: 'Laos-China High-Speed Railway; national power grid stake',
    status: 'At Risk',
    leverageType: 'Railway/Transport',
    notes: 'Chinese debt ~55% of GDP, highest ratio in BRI portfolio; transferred 90% of national grid operator EDL-T to Chinese firm as debt relief; railway $6B.',
  },
  {
    id: 'D008',
    country: 'Angola',
    iso3: 'AGO',
    debtToChinaBn: 25,
    debtToGdpPct: 88,
    chineseDebtToGdpPct: 40,
    strategicAsset: 'Offshore oil blocks; Lobito corridor port',
    status: 'Repaying',
    leverageType: 'Resource Extraction',
    notes: 'Largest African Chinese debtor; oil-backed loans from CDB/EXIM repaid via crude exports; Lobito corridor competes with US-backed rail project.',
  },
  {
    id: 'D009',
    country: 'Tanzania',
    iso3: 'TZA',
    debtToChinaBn: 4.2,
    debtToGdpPct: 38,
    chineseDebtToGdpPct: 8,
    strategicAsset: 'Bagamoyo Port (mega-port; suspended)',
    status: 'Repaying',
    leverageType: 'Port/Infrastructure',
    notes: 'Bagamoyo port ($10B) renegotiated after sovereignty concerns over exclusivity and operational control clauses; project stalled; Magufuli rejected terms.',
  },
  {
    id: 'D010',
    country: 'Ethiopia',
    iso3: 'ETH',
    debtToChinaBn: 13.7,
    debtToGdpPct: 56,
    chineseDebtToGdpPct: 30,
    strategicAsset: 'Addis Ababa-Djibouti Railway; Djibouti port access',
    status: 'Restructuring',
    leverageType: 'Railway/Transport',
    notes: 'EXIM Bank financed ADR; China is largest bilateral creditor; IMF/World Bank DSA indicates debt distress; G20 Common Framework restructuring talks.',
  },
  {
    id: 'D011',
    country: 'Argentina',
    iso3: 'ARG',
    debtToChinaBn: 18.5,
    debtToGdpPct: 89,
    chineseDebtToGdpPct: 9,
    strategicAsset: 'PBOC currency swap line ($18.5B)',
    status: 'At Risk',
    leverageType: 'Currency Swap',
    notes: 'PBOC swap used as emergency FX reserve lever; China demands policy concessions for renewals; Milei govt attempting exit from swap dependency.',
  },
  {
    id: 'D012',
    country: 'Cambodia',
    iso3: 'KHM',
    debtToChinaBn: 9.6,
    debtToGdpPct: 72,
    chineseDebtToGdpPct: 40,
    strategicAsset: 'Ream Naval Base; Sihanoukville SEZ',
    status: 'At Risk',
    leverageType: 'Strategic Access',
    notes: 'Ream Naval Base expanded with Chinese funding; US intelligence assesses exclusive PLAN access granted; ~40% of Sihanoukville Chinese-owned.',
  },
];

/** Fixed reference lending figures (2023 AidData estimates). */
const BASE_GLOBAL_STATS = {
  chinaOverseasLendingBn: 843,
  worldBankImfCombinedBn: 489,
} as const;

// ---- Helper functions -----------------------------------------------------------

/** Returns debtors with status 'At Risk'. */
export function getAtRiskCountries(debtors: BriDebtor[]): BriDebtor[] {
  return debtors.filter((d) => d.status === 'At Risk');
}

/** Filters debtors by the given status value. */
export function getByStatus(debtors: BriDebtor[], status: DebtorStatus): BriDebtor[] {
  return debtors.filter((d) => d.status === status);
}

/**
 * Returns debtors where chineseDebtToGdpPct >= thresholdPct.
 * Default threshold is 20%, widely used as the 'high-leverage' benchmark.
 */
export function getHighDebtRatio(debtors: BriDebtor[], thresholdPct = 20): BriDebtor[] {
  return debtors.filter((d) => d.chineseDebtToGdpPct >= thresholdPct);
}

/**
 * Computes a 0-100 BRI vulnerability index for the supplied debtor set.
 * Status weights: Defaulted=4, Restructuring=3, At Risk=2, Repaying=1.
 * Score is normalised against the maximum possible (all Defaulted = 100).
 */
export function computeVulnerabilityIndex(debtors: BriDebtor[]): number {
  if (!debtors.length) return 0;
  const weights: Record<DebtorStatus, number> = {
    Defaulted: 4,
    Restructuring: 3,
    'At Risk': 2,
    Repaying: 1,
  };
  const score = debtors.reduce((s, d) => s + weights[d.status], 0);
  const maxPossible = debtors.length * 4;
  return Math.round((score / maxPossible) * 100);
}

const STATUS_CLASSES: Record<DebtorStatus, string> = {
  'At Risk': 'status-at-risk',
  Restructuring: 'status-restructuring',
  Defaulted: 'status-defaulted',
  Repaying: 'status-repaying',
};

/** Returns the CSS class name for a debtor status badge. */
export function statusClass(status: DebtorStatus): string {
  return STATUS_CLASSES[status] ?? 'status-unknown';
}

const LEVERAGE_CLASSES: Record<LeverageType, string> = {
  'Port/Infrastructure': 'lev-port',
  'Resource Extraction': 'lev-resource',
  'Strategic Access': 'lev-strategic',
  'Currency Swap': 'lev-currency',
  'Railway/Transport': 'lev-railway',
  Mixed: 'lev-mixed',
};

/** Returns the CSS class name for a leverage type badge. */
export function leverageClass(type: LeverageType): string {
  return LEVERAGE_CLASSES[type] ?? 'lev-mixed';
}

/** Builds the full render data payload for DebtTrapDiplomacyPanel. */
export function buildRenderData(): BriRenderData {
  const debtors = BRI_DEBTORS;
  const totalBriDebtBn = debtors.reduce((s, d) => s + d.debtToChinaBn, 0);
  const atRiskCount = getByStatus(debtors, 'At Risk').length;
  const defaultedCount = getByStatus(debtors, 'Defaulted').length;
  const restructuringCount = getByStatus(debtors, 'Restructuring').length;
  const vulnerabilityIndex = computeVulnerabilityIndex(debtors);

  const stats: GlobalBriStats = {
    ...BASE_GLOBAL_STATS,
    briCountriesAtRisk: atRiskCount,
    totalBriDebtBn: Math.round(totalBriDebtBn * 10) / 10,
    vulnerabilityIndex,
  };

  return {
    debtors,
    stats,
    atRiskCount,
    defaultedCount,
    restructuringCount,
  };
}
