/**
 * political-economy-helpers.ts
 *
 * Pure deterministic helpers for PoliticalEconomyPanel.
 * No DOM, no fetch, no globals — input/output pure.
 * All data is hardcoded per country (mock/static).
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface KleptocracyScore {
  /** 0–100: overall kleptocracy risk */
  overall: number;
  /** 0–100: state asset looting by ruling elite */
  assetLooting: number;
  /** 0–100: judicial capture / rule-of-law erosion */
  judicialCapture: number;
  /** 0–100: offshore wealth / capital flight pressure */
  capitalFlight: number;
  /** 0–100: media suppression enabling impunity */
  mediaSuppression: number;
  /** Human-readable summary */
  summary: string;
}

export interface StateCapacityScore {
  /** 0–100: ability to deliver public goods */
  publicGoodsDelivery: number;
  /** 0–100: tax collection effectiveness */
  fiscalCapacity: number;
  /** 0–100: monopoly on violence / security control */
  securityMonopoly: number;
  /** 0–100: bureaucratic effectiveness */
  bureaucraticCapacity: number;
  /** 0–100: overall state capacity */
  overall: number;
}

export interface InstitutionalQuality {
  /** 0–100: World Bank Voice and Accountability analog */
  voiceAccountability: number;
  /** 0–100: Political Stability analog */
  politicalStability: number;
  /** 0–100: Government Effectiveness analog */
  governmentEffectiveness: number;
  /** 0–100: Regulatory Quality analog */
  regulatoryQuality: number;
  /** 0–100: Rule of Law analog */
  ruleOfLaw: number;
  /** 0–100: Control of Corruption analog */
  controlOfCorruption: number;
}

export type RiskTier = 'critical' | 'high' | 'elevated' | 'moderate' | 'low';

export interface CountryPoliticalProfile {
  country: string;
  iso2: string;
  kleptocracy: KleptocracyScore;
  stateCapacity: StateCapacityScore;
  institutionalQuality: InstitutionalQuality;
  cronyCaptureIndex: number;
  resourceCurseScore: number;
  oligarchConcentration: number;
  sanctionsEvasionRisk: number;
  /** Weighted composite 0–100 */
  overallScore: number;
  tier: RiskTier;
}

export interface PoliticalEconomyRenderData {
  profiles: CountryPoliticalProfile[];
  criticalCount: number;
  highCount: number;
  elevatedCount: number;
  generatedAt: number;
}

// ── Hardcoded country data ─────────────────────────────────────────────────

const RAW_DATA: Record<string, {
  iso2: string;
  kleptocracy: KleptocracyScore;
  stateCapacity: StateCapacityScore;
  institutionalQuality: InstitutionalQuality;
  cronyCapture: number;
  resourceCurse: number;
  oligarchConcentration: number;
  sanctionsEvasion: number;
}> = {
  Russia: {
    iso2: 'RU',
    kleptocracy: { overall: 92, assetLooting: 90, judicialCapture: 95, capitalFlight: 88, mediaSuppression: 95, summary: 'Systemic elite extraction; state assets diverted to oligarch networks aligned with Kremlin.' },
    stateCapacity: { publicGoodsDelivery: 48, fiscalCapacity: 62, securityMonopoly: 82, bureaucraticCapacity: 45, overall: 59 },
    institutionalQuality: { voiceAccountability: 8, politicalStability: 42, governmentEffectiveness: 30, regulatoryQuality: 28, ruleOfLaw: 15, controlOfCorruption: 12 },
    cronyCapture: 91, resourceCurse: 78, oligarchConcentration: 89, sanctionsEvasion: 87,
  },
  Venezuela: {
    iso2: 'VE',
    kleptocracy: { overall: 94, assetLooting: 95, judicialCapture: 93, capitalFlight: 92, mediaSuppression: 88, summary: 'PDVSA looted; narco-state fusion; judiciary fully captured by ruling faction.' },
    stateCapacity: { publicGoodsDelivery: 14, fiscalCapacity: 18, securityMonopoly: 52, bureaucraticCapacity: 16, overall: 25 },
    institutionalQuality: { voiceAccountability: 5, politicalStability: 22, governmentEffectiveness: 8, regulatoryQuality: 7, ruleOfLaw: 6, controlOfCorruption: 5 },
    cronyCapture: 95, resourceCurse: 90, oligarchConcentration: 94, sanctionsEvasion: 82,
  },
  Nigeria: {
    iso2: 'NG',
    kleptocracy: { overall: 78, assetLooting: 75, judicialCapture: 68, capitalFlight: 82, mediaSuppression: 60, summary: 'Oil revenue diversion; endemic contract fraud in federal ministries; NNPC opacity.' },
    stateCapacity: { publicGoodsDelivery: 28, fiscalCapacity: 35, securityMonopoly: 38, bureaucraticCapacity: 30, overall: 33 },
    institutionalQuality: { voiceAccountability: 28, politicalStability: 18, governmentEffectiveness: 20, regulatoryQuality: 22, ruleOfLaw: 19, controlOfCorruption: 14 },
    cronyCapture: 77, resourceCurse: 85, oligarchConcentration: 70, sanctionsEvasion: 58,
  },
  DRC: {
    iso2: 'CD',
    kleptocracy: { overall: 89, assetLooting: 88, judicialCapture: 85, capitalFlight: 80, mediaSuppression: 78, summary: 'Mineral wealth systematically looted by armed factions and state actors; no rule of law.' },
    stateCapacity: { publicGoodsDelivery: 8, fiscalCapacity: 12, securityMonopoly: 14, bureaucraticCapacity: 10, overall: 11 },
    institutionalQuality: { voiceAccountability: 14, politicalStability: 5, governmentEffectiveness: 5, regulatoryQuality: 7, ruleOfLaw: 5, controlOfCorruption: 6 },
    cronyCapture: 82, resourceCurse: 92, oligarchConcentration: 75, sanctionsEvasion: 62,
  },
  Iran: {
    iso2: 'IR',
    kleptocracy: { overall: 85, assetLooting: 82, judicialCapture: 90, capitalFlight: 75, mediaSuppression: 92, summary: 'IRGC economic empire; bonyad foundations divert oil rents to ruling clerical elite.' },
    stateCapacity: { publicGoodsDelivery: 40, fiscalCapacity: 50, securityMonopoly: 75, bureaucraticCapacity: 42, overall: 52 },
    institutionalQuality: { voiceAccountability: 6, politicalStability: 38, governmentEffectiveness: 28, regulatoryQuality: 20, ruleOfLaw: 14, controlOfCorruption: 10 },
    cronyCapture: 86, resourceCurse: 72, oligarchConcentration: 82, sanctionsEvasion: 90,
  },
  'Saudi Arabia': {
    iso2: 'SA',
    kleptocracy: { overall: 68, assetLooting: 65, judicialCapture: 70, capitalFlight: 55, mediaSuppression: 78, summary: 'Royal family extraction via Aramco dividends; Vision 2030 modernizes some rent distribution.' },
    stateCapacity: { publicGoodsDelivery: 62, fiscalCapacity: 70, securityMonopoly: 80, bureaucraticCapacity: 55, overall: 67 },
    institutionalQuality: { voiceAccountability: 12, politicalStability: 60, governmentEffectiveness: 52, regulatoryQuality: 45, ruleOfLaw: 38, controlOfCorruption: 32 },
    cronyCapture: 72, resourceCurse: 80, oligarchConcentration: 78, sanctionsEvasion: 40,
  },
  Turkey: {
    iso2: 'TR',
    kleptocracy: { overall: 65, assetLooting: 60, judicialCapture: 72, capitalFlight: 58, mediaSuppression: 70, summary: 'AKP-aligned business networks capture state contracts; judiciary subordinated post-2016.' },
    stateCapacity: { publicGoodsDelivery: 52, fiscalCapacity: 60, securityMonopoly: 72, bureaucraticCapacity: 50, overall: 59 },
    institutionalQuality: { voiceAccountability: 25, politicalStability: 38, governmentEffectiveness: 42, regulatoryQuality: 40, ruleOfLaw: 32, controlOfCorruption: 34 },
    cronyCapture: 68, resourceCurse: 15, oligarchConcentration: 62, sanctionsEvasion: 45,
  },
  Hungary: {
    iso2: 'HU',
    kleptocracy: { overall: 62, assetLooting: 58, judicialCapture: 68, capitalFlight: 50, mediaSuppression: 72, summary: 'Orbán-aligned oligarchs dominate EU-funded contracts; media ownership consolidated.' },
    stateCapacity: { publicGoodsDelivery: 58, fiscalCapacity: 62, securityMonopoly: 78, bureaucraticCapacity: 55, overall: 63 },
    institutionalQuality: { voiceAccountability: 35, politicalStability: 62, governmentEffectiveness: 48, regulatoryQuality: 50, ruleOfLaw: 38, controlOfCorruption: 40 },
    cronyCapture: 65, resourceCurse: 5, oligarchConcentration: 60, sanctionsEvasion: 30,
  },
  Belarus: {
    iso2: 'BY',
    kleptocracy: { overall: 80, assetLooting: 78, judicialCapture: 85, capitalFlight: 68, mediaSuppression: 90, summary: 'Lukashenko family controls state enterprises; opposition assets seized; total judicial capture.' },
    stateCapacity: { publicGoodsDelivery: 44, fiscalCapacity: 50, securityMonopoly: 80, bureaucraticCapacity: 42, overall: 54 },
    institutionalQuality: { voiceAccountability: 4, politicalStability: 35, governmentEffectiveness: 35, regulatoryQuality: 28, ruleOfLaw: 12, controlOfCorruption: 14 },
    cronyCapture: 82, resourceCurse: 20, oligarchConcentration: 76, sanctionsEvasion: 72,
  },
  Myanmar: {
    iso2: 'MM',
    kleptocracy: { overall: 82, assetLooting: 80, judicialCapture: 88, capitalFlight: 72, mediaSuppression: 85, summary: 'Tatmadaw junta loots jade and teak revenues; state banking system used for sanctions evasion.' },
    stateCapacity: { publicGoodsDelivery: 18, fiscalCapacity: 22, securityMonopoly: 55, bureaucraticCapacity: 20, overall: 29 },
    institutionalQuality: { voiceAccountability: 5, politicalStability: 8, governmentEffectiveness: 14, regulatoryQuality: 10, ruleOfLaw: 7, controlOfCorruption: 8 },
    cronyCapture: 84, resourceCurse: 70, oligarchConcentration: 80, sanctionsEvasion: 78,
  },
  Kazakhstan: {
    iso2: 'KZ',
    kleptocracy: { overall: 74, assetLooting: 72, judicialCapture: 75, capitalFlight: 70, mediaSuppression: 72, summary: 'Nazarbayev-era wealth in offshore accounts; Kazmunaygaz rents captured by elite families.' },
    stateCapacity: { publicGoodsDelivery: 45, fiscalCapacity: 55, securityMonopoly: 70, bureaucraticCapacity: 44, overall: 54 },
    institutionalQuality: { voiceAccountability: 18, politicalStability: 50, governmentEffectiveness: 38, regulatoryQuality: 32, ruleOfLaw: 24, controlOfCorruption: 20 },
    cronyCapture: 76, resourceCurse: 75, oligarchConcentration: 72, sanctionsEvasion: 55,
  },
  Uzbekistan: {
    iso2: 'UZ',
    kleptocracy: { overall: 68, assetLooting: 65, judicialCapture: 70, capitalFlight: 60, mediaSuppression: 68, summary: 'Telecom and cotton sectors captured by ruling families; partial reform underway post-Karimov.' },
    stateCapacity: { publicGoodsDelivery: 42, fiscalCapacity: 48, securityMonopoly: 68, bureaucraticCapacity: 40, overall: 50 },
    institutionalQuality: { voiceAccountability: 14, politicalStability: 52, governmentEffectiveness: 35, regulatoryQuality: 30, ruleOfLaw: 20, controlOfCorruption: 18 },
    cronyCapture: 70, resourceCurse: 52, oligarchConcentration: 68, sanctionsEvasion: 45,
  },
  Azerbaijan: {
    iso2: 'AZ',
    kleptocracy: { overall: 76, assetLooting: 74, judicialCapture: 78, capitalFlight: 72, mediaSuppression: 80, summary: 'Aliyev dynasty controls SOCAR; laundromat-style banking used to route rents offshore.' },
    stateCapacity: { publicGoodsDelivery: 48, fiscalCapacity: 55, securityMonopoly: 72, bureaucraticCapacity: 46, overall: 55 },
    institutionalQuality: { voiceAccountability: 10, politicalStability: 55, governmentEffectiveness: 40, regulatoryQuality: 35, ruleOfLaw: 18, controlOfCorruption: 14 },
    cronyCapture: 78, resourceCurse: 68, oligarchConcentration: 75, sanctionsEvasion: 60,
  },
  Cameroon: {
    iso2: 'CM',
    kleptocracy: { overall: 72, assetLooting: 70, judicialCapture: 72, capitalFlight: 68, mediaSuppression: 65, summary: 'Biya patronage network; oil revenues channelled to presidency; no public audit of SNH.' },
    stateCapacity: { publicGoodsDelivery: 28, fiscalCapacity: 32, securityMonopoly: 45, bureaucraticCapacity: 26, overall: 33 },
    institutionalQuality: { voiceAccountability: 18, politicalStability: 28, governmentEffectiveness: 20, regulatoryQuality: 22, ruleOfLaw: 16, controlOfCorruption: 14 },
    cronyCapture: 74, resourceCurse: 55, oligarchConcentration: 65, sanctionsEvasion: 42,
  },
  Gabon: {
    iso2: 'GA',
    kleptocracy: { overall: 71, assetLooting: 68, judicialCapture: 70, capitalFlight: 72, mediaSuppression: 62, summary: 'Bongo family accumulated offshore wealth; French oil interests shielded from accountability.' },
    stateCapacity: { publicGoodsDelivery: 35, fiscalCapacity: 40, securityMonopoly: 52, bureaucraticCapacity: 32, overall: 40 },
    institutionalQuality: { voiceAccountability: 20, politicalStability: 42, governmentEffectiveness: 30, regulatoryQuality: 28, ruleOfLaw: 20, controlOfCorruption: 16 },
    cronyCapture: 72, resourceCurse: 78, oligarchConcentration: 66, sanctionsEvasion: 48,
  },
};

// ── Overall score computation ──────────────────────────────────────────────

function computeOverallScore(
  kleptocracy: KleptocracyScore,
  stateCapacity: StateCapacityScore,
  institutionalQuality: InstitutionalQuality,
  cronyCapture: number,
  resourceCurse: number,
  oligarchConcentration: number,
  sanctionsEvasion: number,
): number {
  // Higher kleptocracy, lower state capacity, lower IQ → higher risk
  const stateCapacityRisk = 100 - stateCapacity.overall;
  const iqRisk = 100 - (
    institutionalQuality.voiceAccountability +
    institutionalQuality.politicalStability +
    institutionalQuality.governmentEffectiveness +
    institutionalQuality.regulatoryQuality +
    institutionalQuality.ruleOfLaw +
    institutionalQuality.controlOfCorruption
  ) / 6;

  const weighted =
    kleptocracy.overall * 0.30 +
    stateCapacityRisk * 0.15 +
    iqRisk * 0.20 +
    cronyCapture * 0.15 +
    resourceCurse * 0.08 +
    oligarchConcentration * 0.07 +
    sanctionsEvasion * 0.05;

  return Math.round(Math.min(100, Math.max(0, weighted)));
}

// ── Public API ─────────────────────────────────────────────────────────────

export function getKleptocracyScore(country: string): KleptocracyScore {
  const d = RAW_DATA[country];
  if (!d) return { overall: 50, assetLooting: 50, judicialCapture: 50, capitalFlight: 50, mediaSuppression: 50, summary: 'No data available.' };
  return d.kleptocracy;
}

export function getStateCapacityScore(country: string): StateCapacityScore {
  const d = RAW_DATA[country];
  if (!d) return { publicGoodsDelivery: 50, fiscalCapacity: 50, securityMonopoly: 50, bureaucraticCapacity: 50, overall: 50 };
  return d.stateCapacity;
}

export function getInstitutionalQuality(country: string): InstitutionalQuality {
  const d = RAW_DATA[country];
  if (!d) return { voiceAccountability: 50, politicalStability: 50, governmentEffectiveness: 50, regulatoryQuality: 50, ruleOfLaw: 50, controlOfCorruption: 50 };
  return d.institutionalQuality;
}

export function getCronyCaptureIndex(country: string): number {
  return RAW_DATA[country]?.cronyCapture ?? 50;
}

export function getResourceCurseScore(country: string): number {
  return RAW_DATA[country]?.resourceCurse ?? 50;
}

export function getOligarchConcentration(country: string): number {
  return RAW_DATA[country]?.oligarchConcentration ?? 50;
}

export function getSanctionsEvasionRisk(country: string): number {
  return RAW_DATA[country]?.sanctionsEvasion ?? 50;
}

export function getRiskTier(overallScore: number): RiskTier {
  if (overallScore >= 85) return 'critical';
  if (overallScore >= 70) return 'high';
  if (overallScore >= 55) return 'elevated';
  if (overallScore >= 35) return 'moderate';
  return 'low';
}

export function getCountryProfile(country: string): CountryPoliticalProfile {
  const d = RAW_DATA[country];
  const iso2 = d?.iso2 ?? '??';
  const kleptocracy = getKleptocracyScore(country);
  const stateCapacity = getStateCapacityScore(country);
  const institutionalQuality = getInstitutionalQuality(country);
  const cronyCaptureIndex = getCronyCaptureIndex(country);
  const resourceCurseScore = getResourceCurseScore(country);
  const oligarchConcentration = getOligarchConcentration(country);
  const sanctionsEvasionRisk = getSanctionsEvasionRisk(country);
  const overallScore = computeOverallScore(
    kleptocracy, stateCapacity, institutionalQuality,
    cronyCaptureIndex, resourceCurseScore, oligarchConcentration, sanctionsEvasionRisk,
  );
  return {
    country,
    iso2,
    kleptocracy,
    stateCapacity,
    institutionalQuality,
    cronyCaptureIndex,
    resourceCurseScore,
    oligarchConcentration,
    sanctionsEvasionRisk,
    overallScore,
    tier: getRiskTier(overallScore),
  };
}

export const TRACKED_COUNTRIES = [
  'Russia', 'Venezuela', 'Nigeria', 'DRC', 'Iran',
  'Saudi Arabia', 'Turkey', 'Hungary', 'Belarus', 'Myanmar',
  'Kazakhstan', 'Uzbekistan', 'Azerbaijan', 'Cameroon', 'Gabon',
] as const;

export function getAllCountries(): CountryPoliticalProfile[] {
  return TRACKED_COUNTRIES.map(getCountryProfile);
}

export function buildRenderData(): PoliticalEconomyRenderData {
  const profiles = getAllCountries().sort((a, b) => b.overallScore - a.overallScore);
  return {
    profiles,
    criticalCount: profiles.filter((p) => p.tier === 'critical').length,
    highCount: profiles.filter((p) => p.tier === 'high').length,
    elevatedCount: profiles.filter((p) => p.tier === 'elevated').length,
    generatedAt: Date.now(),
  };
}
