/**
 * Pure helpers for SanctionsTrackerPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 *
 * Covers: active OFAC/EU/UN sanctions regimes, newly designated
 * entities, evasion network detection signals, secondary sanctions
 * exposure by country, sanctions-busting trade corridors, and frozen
 * asset tracking by jurisdiction.
 */

// ── Type unions ───────────────────────────────────────────────────────────

export type SanctionsBody = 'OFAC' | 'EU' | 'UN' | 'UK-OFSI' | 'Canada-OSFI';
export type RegimeScope = 'comprehensive' | 'sectoral' | 'targeted' | 'secondary-risk';
export type DesignationType = 'individual' | 'entity' | 'vessel' | 'aircraft' | 'crypto-address';
export type EvasionPattern =
  | 'shell-company'
  | 'dark-fleet'
  | 'port-hopping'
  | 'crypto-laundering'
  | 'front-financier'
  | 'trade-mis-invoicing';
export type EvasionConfidence = 'weak' | 'moderate' | 'strong' | 'confirmed';
export type ExposureTier = 'low' | 'moderate' | 'high' | 'extreme';
export type CorridorStatus = 'active' | 'disrupted' | 'hardened';
export type FrozenAssetType = 'financial' | 'real-estate' | 'luxury' | 'vessel' | 'aircraft';
export type ContagionLevel = 0 | 1 | 2 | 3 | 4;

// ── Section 1 — Active Sanctions Regimes ──────────────────────────────────

export interface ActiveSanctionsRegime {
  country: string;
  iso3: string;
  body: SanctionsBody;
  regimeName: string;
  scope: RegimeScope;
  sinceYear: number;
}

const SCOPE_COLORS: Record<RegimeScope, string> = {
  comprehensive: '#b91c1c',
  sectoral: '#ea580c',
  targeted: '#ca8a04',
  'secondary-risk': '#4b5563',
};

const SCOPE_LABELS: Record<RegimeScope, string> = {
  comprehensive: 'Comprehensive',
  sectoral: 'Sectoral',
  targeted: 'Targeted',
  'secondary-risk': 'Secondary Risk',
};

export function regimeScopeColor(s: RegimeScope): string { return SCOPE_COLORS[s]; }
export function regimeScopeLabel(s: RegimeScope): string { return SCOPE_LABELS[s]; }

export function countRegimesByBody(regimes: readonly ActiveSanctionsRegime[], body: SanctionsBody): number {
  return regimes.filter((r) => r.body === body).length;
}

export function countComprehensiveRegimes(regimes: readonly ActiveSanctionsRegime[]): number {
  return regimes.filter((r) => r.scope === 'comprehensive').length;
}

// ── Section 2 — Newly Designated Entities ─────────────────────────────────

export interface NewlyDesignated {
  name: string;
  type: DesignationType;
  country: string;
  designator: SanctionsBody;
  sectoralProgram: string;
  designatedAt: number;
}

const DESIGNATION_COLORS: Record<DesignationType, string> = {
  individual: '#4b5563',
  entity: '#ca8a04',
  vessel: '#0e7490',
  aircraft: '#7c3aed',
  'crypto-address': '#b91c1c',
};

const DESIGNATION_LABELS: Record<DesignationType, string> = {
  individual: 'Individual',
  entity: 'Entity',
  vessel: 'Vessel',
  aircraft: 'Aircraft',
  'crypto-address': 'Crypto Address',
};

export function designationColor(t: DesignationType): string { return DESIGNATION_COLORS[t]; }
export function designationLabel(t: DesignationType): string { return DESIGNATION_LABELS[t]; }

/** Designations are "new" within the last 30 days from the reference timestamp. */
const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function isRecentlyDesignated(d: Pick<NewlyDesignated, 'designatedAt'>, nowMs: number): boolean {
  return nowMs - d.designatedAt <= NEW_WINDOW_MS;
}

export function countRecentDesignations(items: readonly NewlyDesignated[], nowMs: number): number {
  return items.filter((d) => isRecentlyDesignated(d, nowMs)).length;
}

// ── Section 3 — Evasion Network Signals ───────────────────────────────────

export interface EvasionSignal {
  pattern: EvasionPattern;
  target: string;
  confidence: EvasionConfidence;
  notes: string;
  observedAt: number;
}

const EVASION_PATTERN_LABELS: Record<EvasionPattern, string> = {
  'shell-company': 'Shell Company',
  'dark-fleet': 'Dark Fleet',
  'port-hopping': 'Port Hopping',
  'crypto-laundering': 'Crypto Laundering',
  'front-financier': 'Front Financier',
  'trade-mis-invoicing': 'Trade Mis-Invoicing',
};

const EVASION_CONFIDENCE_COLORS: Record<EvasionConfidence, string> = {
  weak: '#4b5563',
  moderate: '#ca8a04',
  strong: '#ea580c',
  confirmed: '#b91c1c',
};

const EVASION_CONFIDENCE_LABELS: Record<EvasionConfidence, string> = {
  weak: 'Weak',
  moderate: 'Moderate',
  strong: 'Strong',
  confirmed: 'Confirmed',
};

export function evasionPatternLabel(p: EvasionPattern): string { return EVASION_PATTERN_LABELS[p]; }
export function evasionConfidenceColor(c: EvasionConfidence): string { return EVASION_CONFIDENCE_COLORS[c]; }
export function evasionConfidenceLabel(c: EvasionConfidence): string { return EVASION_CONFIDENCE_LABELS[c]; }

export function highConfidenceEvasionCount(signals: readonly EvasionSignal[]): number {
  return signals.filter((s) => s.confidence === 'strong' || s.confidence === 'confirmed').length;
}

// ── Section 4 — Secondary Sanctions Exposure ──────────────────────────────

export interface CountryExposure {
  country: string;
  iso3: string;
  /** Trade share with sanctioned counterparties (0..1). */
  tradeShareWithTarget: number;
  /** Number of financial channels (correspondent banks, SWIFT relays, etc.). */
  financialChannels: number;
  riskNotes: string;
}

/**
 * Composite exposure score 0..100:
 *   tradeShare * 60  (max 60)
 *   financialChannels * 8 capped at 32 (max 32)
 *   +8 bonus when both signals are non-trivial (≥0.1 share AND ≥2 channels).
 * Clamped to 100.
 */
export function computeExposureScore(e: Pick<CountryExposure, 'tradeShareWithTarget' | 'financialChannels'>): number {
  const tradePart = Math.max(0, Math.min(1, e.tradeShareWithTarget)) * 60;
  const channelPart = Math.min(32, Math.max(0, e.financialChannels) * 8);
  const synergyBonus = e.tradeShareWithTarget >= 0.1 && e.financialChannels >= 2 ? 8 : 0;
  return Math.min(100, Math.round(tradePart + channelPart + synergyBonus));
}

export function classifyExposure(score: number): ExposureTier {
  if (score >= 75) return 'extreme';
  if (score >= 50) return 'high';
  if (score >= 25) return 'moderate';
  return 'low';
}

const EXPOSURE_COLORS: Record<ExposureTier, string> = {
  low: '#15803d',
  moderate: '#ca8a04',
  high: '#ea580c',
  extreme: '#b91c1c',
};

const EXPOSURE_LABELS: Record<ExposureTier, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  extreme: 'Extreme',
};

export function exposureTierColor(t: ExposureTier): string { return EXPOSURE_COLORS[t]; }
export function exposureTierLabel(t: ExposureTier): string { return EXPOSURE_LABELS[t]; }

// ── Section 5 — Sanctions-Busting Trade Corridors ─────────────────────────

export interface TradeCorridor {
  from: string;
  to: string;
  commodity: string;
  monthlyVolumeUsdM: number;
  status: CorridorStatus;
}

const CORRIDOR_COLORS: Record<CorridorStatus, string> = {
  active: '#b91c1c',
  disrupted: '#ca8a04',
  hardened: '#15803d',
};

const CORRIDOR_LABELS: Record<CorridorStatus, string> = {
  active: 'Active',
  disrupted: 'Disrupted',
  hardened: 'Hardened',
};

export function corridorStatusColor(s: CorridorStatus): string { return CORRIDOR_COLORS[s]; }
export function corridorStatusLabel(s: CorridorStatus): string { return CORRIDOR_LABELS[s]; }

export function totalActiveCorridorVolumeUsdM(corridors: readonly TradeCorridor[]): number {
  return corridors
    .filter((c) => c.status === 'active')
    .reduce((sum, c) => sum + Math.max(0, c.monthlyVolumeUsdM), 0);
}

// ── Section 6 — Frozen Asset Tracking ─────────────────────────────────────

export interface FrozenAssets {
  jurisdiction: string;
  originCountry: string;
  assetType: FrozenAssetType;
  valueUsdBn: number;
  program: string;
}

const ASSET_TYPE_LABELS: Record<FrozenAssetType, string> = {
  financial: 'Financial',
  'real-estate': 'Real Estate',
  luxury: 'Luxury',
  vessel: 'Vessel',
  aircraft: 'Aircraft',
};

export function frozenAssetTypeLabel(t: FrozenAssetType): string { return ASSET_TYPE_LABELS[t]; }

export function totalFrozenAssetsUsdBn(assets: readonly FrozenAssets[]): number {
  const sum = assets.reduce((acc, a) => acc + Math.max(0, a.valueUsdBn), 0);
  return Math.round(sum * 10) / 10;
}

export function frozenAssetsByJurisdiction(assets: readonly FrozenAssets[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of assets) {
    const prev = map.get(a.jurisdiction) ?? 0;
    map.set(a.jurisdiction, prev + Math.max(0, a.valueUsdBn));
  }
  return map;
}

// ── Aggregate alert count (used by Panel.setCount) ─────────────────────────

export function totalAlertCount(input: {
  regimes: readonly ActiveSanctionsRegime[];
  designations: readonly NewlyDesignated[];
  evasions: readonly EvasionSignal[];
  nowMs: number;
}): number {
  return (
    countComprehensiveRegimes(input.regimes) +
    countRecentDesignations(input.designations, input.nowMs) +
    highConfidenceEvasionCount(input.evasions)
  );
}

// ── Seed snapshots (illustrative, deterministic fixtures) ────────────────

const Y = (y: number, m: number, d: number): number => Date.UTC(y, m, d);

export const ACTIVE_REGIMES: ActiveSanctionsRegime[] = [
  { country: 'Russia',       iso3: 'RUS', body: 'OFAC',       regimeName: 'Ukraine/Russia-Related',     scope: 'comprehensive', sinceYear: 2014 },
  { country: 'Russia',       iso3: 'RUS', body: 'EU',         regimeName: 'Council Regulation 833/2014', scope: 'comprehensive', sinceYear: 2014 },
  { country: 'Iran',         iso3: 'IRN', body: 'OFAC',       regimeName: 'Iranian Transactions',        scope: 'comprehensive', sinceYear: 1995 },
  { country: 'Iran',         iso3: 'IRN', body: 'EU',         regimeName: 'EU Iran Sanctions',           scope: 'sectoral',      sinceYear: 2010 },
  { country: 'North Korea',  iso3: 'PRK', body: 'UN',         regimeName: 'UNSC 1718 Committee',         scope: 'comprehensive', sinceYear: 2006 },
  { country: 'North Korea',  iso3: 'PRK', body: 'OFAC',       regimeName: 'North Korea Sanctions',       scope: 'comprehensive', sinceYear: 2008 },
  { country: 'Cuba',         iso3: 'CUB', body: 'OFAC',       regimeName: 'Cuban Assets Control',        scope: 'comprehensive', sinceYear: 1963 },
  { country: 'Syria',        iso3: 'SYR', body: 'OFAC',       regimeName: 'Syrian Sanctions',            scope: 'sectoral',      sinceYear: 2004 },
  { country: 'Venezuela',    iso3: 'VEN', body: 'OFAC',       regimeName: 'Venezuela-Related',           scope: 'sectoral',      sinceYear: 2015 },
  { country: 'Myanmar',      iso3: 'MMR', body: 'UK-OFSI',    regimeName: 'Burma Regulations',           scope: 'targeted',      sinceYear: 2021 },
  { country: 'Belarus',      iso3: 'BLR', body: 'EU',         regimeName: 'Council Regulation 765/2006', scope: 'sectoral',      sinceYear: 2006 },
  { country: 'China',        iso3: 'CHN', body: 'OFAC',       regimeName: 'Xinjiang-Related Entity List',scope: 'targeted',      sinceYear: 2020 },
  { country: 'Sudan',        iso3: 'SDN', body: 'UN',         regimeName: 'UNSC 1591 Committee',         scope: 'targeted',      sinceYear: 2005 },
  { country: 'Hong Kong',    iso3: 'HKG', body: 'OFAC',       regimeName: 'Hong Kong-Related',           scope: 'secondary-risk',sinceYear: 2020 },
  { country: 'Türkiye',      iso3: 'TUR', body: 'OFAC',       regimeName: 'CAATSA Section 231',          scope: 'secondary-risk',sinceYear: 2020 },
];

/**
 * Seed designations are timestamped relative to the panel's reference
 * "now" (2026-05-18). Tests pass `nowMs = REFERENCE_NOW_MS` so the
 * 30-day window stays stable across CI runs.
 */
export const REFERENCE_NOW_MS = Y(2026, 4, 18);

export const NEW_DESIGNATIONS: NewlyDesignated[] = [
  { name: 'Promsvyazbank Subsidiary LLC',  type: 'entity',         country: 'Russia',     designator: 'OFAC', sectoralProgram: 'Russia EO 14024', designatedAt: Y(2026, 4, 10) },
  { name: 'Capt. Alexey Petrov',           type: 'individual',     country: 'Russia',     designator: 'EU',   sectoralProgram: 'Russia 833/2014', designatedAt: Y(2026, 4, 14) },
  { name: 'M/T Sirius Bright (IMO 9457***)',type: 'vessel',         country: 'Iran',       designator: 'OFAC', sectoralProgram: 'IRGC Oil Export', designatedAt: Y(2026, 4, 2) },
  { name: 'Bitcoin Address 1A2b…F9',       type: 'crypto-address', country: 'North Korea',designator: 'OFAC', sectoralProgram: 'Cyber-Related',   designatedAt: Y(2026, 3, 27) },
  { name: 'Far East Air Cargo',            type: 'entity',         country: 'North Korea',designator: 'UN',   sectoralProgram: 'UNSC 1718',       designatedAt: Y(2026, 3, 28) },
  { name: 'IL-76 Reg. RA-78843',           type: 'aircraft',       country: 'Russia',     designator: 'UK-OFSI', sectoralProgram: 'Aerospace',    designatedAt: Y(2026, 2, 8) },
  { name: 'Damascus Trading Hub Ltd.',     type: 'entity',         country: 'Syria',      designator: 'OFAC', sectoralProgram: 'Syria EO 13582',  designatedAt: Y(2026, 1, 12) },
];

export const EVASION_SIGNALS: EvasionSignal[] = [
  { pattern: 'dark-fleet',         target: 'Iran oil exports',     confidence: 'confirmed', notes: 'AIS gaps + STS transfers off Lakonikos Gulf',          observedAt: Y(2026, 4, 8) },
  { pattern: 'shell-company',      target: 'Russia electronics',   confidence: 'strong',    notes: 'UAE re-export chain via 3 LLCs registered 2025-Q4',   observedAt: Y(2026, 4, 12) },
  { pattern: 'port-hopping',       target: 'DPRK coal',            confidence: 'strong',    notes: 'Korea Bay → Ningbo loop, 4 vessels rotating flags',   observedAt: Y(2026, 4, 5) },
  { pattern: 'crypto-laundering',  target: 'Lazarus group',        confidence: 'confirmed', notes: 'Tornado Cash forks + Tron-USDT cycles',               observedAt: Y(2026, 3, 30) },
  { pattern: 'front-financier',    target: 'Venezuela PDVSA',      confidence: 'moderate',  notes: 'Panama-domiciled trading desk; payments via Türkiye', observedAt: Y(2026, 3, 24) },
  { pattern: 'trade-mis-invoicing',target: 'Belarus potash',       confidence: 'weak',      notes: 'Pricing 20% below market on China-bound shipments',   observedAt: Y(2026, 2, 18) },
];

export const COUNTRY_EXPOSURE: CountryExposure[] = [
  { country: 'Türkiye',  iso3: 'TUR', tradeShareWithTarget: 0.22, financialChannels: 4, riskNotes: 'CAATSA exposure on aerospace dual-use'   },
  { country: 'UAE',      iso3: 'ARE', tradeShareWithTarget: 0.31, financialChannels: 6, riskNotes: 'Free-zone shell-company hub'              },
  { country: 'China',    iso3: 'CHN', tradeShareWithTarget: 0.18, financialChannels: 5, riskNotes: 'CIPS clearing for Russia + Iran trade'    },
  { country: 'Kazakhstan',iso3:'KAZ', tradeShareWithTarget: 0.14, financialChannels: 3, riskNotes: 'Re-export corridor; EAEU customs ties'    },
  { country: 'Armenia',  iso3: 'ARM', tradeShareWithTarget: 0.09, financialChannels: 2, riskNotes: 'Electronics re-export pivot since 2023'   },
  { country: 'India',    iso3: 'IND', tradeShareWithTarget: 0.07, financialChannels: 3, riskNotes: 'Discounted-crude clearing via rupee trade'},
  { country: 'Singapore',iso3: 'SGP', tradeShareWithTarget: 0.04, financialChannels: 2, riskNotes: 'Trading-desk relocations from London'     },
];

export const TRADE_CORRIDORS: TradeCorridor[] = [
  { from: 'Russia',     to: 'India',     commodity: 'Crude oil',        monthlyVolumeUsdM: 3200, status: 'active'    },
  { from: 'Russia',     to: 'China',     commodity: 'Crude oil + LNG',  monthlyVolumeUsdM: 4100, status: 'active'    },
  { from: 'Iran',       to: 'China',     commodity: 'Crude oil',        monthlyVolumeUsdM: 1900, status: 'active'    },
  { from: 'Russia',     to: 'Türkiye',   commodity: 'Steel + grain',    monthlyVolumeUsdM:  860, status: 'disrupted' },
  { from: 'North Korea',to: 'China',     commodity: 'Coal',             monthlyVolumeUsdM:  240, status: 'active'    },
  { from: 'Venezuela',  to: 'China',     commodity: 'Crude oil',        monthlyVolumeUsdM:  720, status: 'active'    },
  { from: 'Russia',     to: 'EU',        commodity: 'Diamonds',         monthlyVolumeUsdM:   45, status: 'hardened'  },
  { from: 'Belarus',    to: 'China',     commodity: 'Potash',           monthlyVolumeUsdM:  310, status: 'disrupted' },
];

export const FROZEN_ASSETS: FrozenAssets[] = [
  { jurisdiction: 'EU',           originCountry: 'Russia',     assetType: 'financial',   valueUsdBn: 215, program: 'CBR reserves'         },
  { jurisdiction: 'United States',originCountry: 'Russia',     assetType: 'financial',   valueUsdBn:  38, program: 'CBR reserves'         },
  { jurisdiction: 'Switzerland',  originCountry: 'Russia',     assetType: 'financial',   valueUsdBn:   8.4, program: 'CBR reserves'         },
  { jurisdiction: 'United Kingdom',originCountry:'Russia',     assetType: 'real-estate', valueUsdBn:   1.3, program: 'Oligarch UWO'         },
  { jurisdiction: 'United States',originCountry: 'Iran',       assetType: 'financial',   valueUsdBn:   1.7, program: 'IRGC blocked'         },
  { jurisdiction: 'France',       originCountry: 'Russia',     assetType: 'luxury',      valueUsdBn:   0.6, program: 'Oligarch yacht/villa' },
  { jurisdiction: 'Italy',        originCountry: 'Russia',     assetType: 'vessel',      valueUsdBn:   1.1, program: 'Yacht seizure'        },
  { jurisdiction: 'Canada',       originCountry: 'Belarus',    assetType: 'aircraft',    valueUsdBn:   0.2, program: 'CAATSA-Belarus'       },
];
