// food-systems-geopolitics-helpers.ts
// Pure logic for FoodSystemsGeopoliticsPanel — no DOM, no Panel imports

export type FoodWeaponizationMechanism =
  | 'Export Ban'
  | 'Grain Blockade'
  | 'Fertilizer Cutoff'
  | 'Trade Coercion'
  | 'Sanctions Impact'
  | 'Infrastructure Attack';

export type ChokepointRisk = 'Low' | 'Medium' | 'High' | 'Critical';
export type VolatilityLevel = 'Low' | 'Medium' | 'High' | 'Extreme';

export interface FoodWeaponizationEvent {
  id: string;
  date: string;
  actor: string;
  target: string;
  mechanism: FoodWeaponizationMechanism;
  commodity: string;
  /** People affected in millions */
  impactM: number;
  /** Price spike as a percentage (e.g. 30 = 30%) */
  priceSpikesPct: number;
  description: string;
  ongoing: boolean;
  /** Geopolitical significance 1-10 */
  significance: number;
}

export interface FoodSupplyConcentration {
  commodity: string;
  topProducers: string[];
  top3SharePct: number;
  chokepointRisk: ChokepointRisk;
  recentDisruption: string;
  priceVolatility: VolatilityLevel;
}

export interface FoodGeopoliticsData {
  events: FoodWeaponizationEvent[];
  concentrations: FoodSupplyConcentration[];
  globalFoodSecurityIndex: number;
  weaponizationRiskScore: number;
  mostVulnerableRegions: string[];
  fertilizer_dependency_alert: boolean;
}

export const WEAPONIZATION_EVENTS: FoodWeaponizationEvent[] = [
  {
    id: 'FW001',
    date: '2022-02',
    actor: 'Russia',
    target: 'Global / Ukraine',
    mechanism: 'Grain Blockade',
    commodity: 'Wheat, Corn, Sunflower Oil',
    impactM: 400,
    priceSpikesPct: 30,
    description: 'Russian invasion of Ukraine blocked Black Sea grain exports, triggering a global food-price shock and famine risk across Africa and the Middle East.',
    ongoing: true,
    significance: 10,
  },
  {
    id: 'FW002',
    date: '2023-07',
    actor: 'Russia',
    target: 'Ukraine / Global',
    mechanism: 'Grain Blockade',
    commodity: 'Wheat, Corn',
    impactM: 345,
    priceSpikesPct: 18,
    description: 'Russia withdrew from the UN-brokered Black Sea Grain Initiative in July 2023, ending the deal that had allowed 33 Mt of Ukrainian grain to reach markets and threatening food supplies to 45+ countries.',
    ongoing: true,
    significance: 9,
  },
  {
    id: 'FW003',
    date: '2022-05',
    actor: 'Russia',
    target: 'India',
    mechanism: 'Trade Coercion',
    commodity: 'Wheat',
    impactM: 35,
    priceSpikesPct: 12,
    description: 'Russia pressured India to reject Western sanctions and continue wheat imports. India then restricted its own wheat exports, amplifying global price pressure.',
    ongoing: false,
    significance: 7,
  },
  {
    id: 'FW004',
    date: '2020-08',
    actor: 'China',
    target: 'Australia',
    mechanism: 'Export Ban',
    commodity: 'Barley, Wine, Beef',
    impactM: 5,
    priceSpikesPct: 8,
    description: 'China imposed 80% tariffs on Australian barley and banned beef from multiple abattoirs in retaliation for Australia calling for a COVID-19 inquiry — a textbook use of agricultural trade as geopolitical coercion.',
    ongoing: false,
    significance: 7,
  },
  {
    id: 'FW005',
    date: '2022-01',
    actor: 'Russia / Belarus',
    target: 'Global agriculture',
    mechanism: 'Fertilizer Cutoff',
    commodity: 'Potash, Nitrogen, Phosphate',
    impactM: 250,
    priceSpikesPct: 70,
    description: 'Western sanctions on Belarus combined with Russian export restrictions severed roughly 30% of global potash supply, causing fertilizer prices to spike and threatening crop yields worldwide.',
    ongoing: true,
    significance: 8,
  },
  {
    id: 'FW006',
    date: '2022-04',
    actor: 'Russia',
    target: 'Ukraine',
    mechanism: 'Infrastructure Attack',
    commodity: 'Grain storage/processing',
    impactM: 80,
    priceSpikesPct: 5,
    description: 'Russian forces destroyed grain silos and port infrastructure at Mariupol, deliberately targeting Ukraine food production and export capacity as a tool of economic warfare.',
    ongoing: true,
    significance: 8,
  },
  {
    id: 'FW007',
    date: '2023-08',
    actor: 'India',
    target: 'Global rice importers',
    mechanism: 'Export Ban',
    commodity: 'Non-basmati white rice',
    impactM: 200,
    priceSpikesPct: 22,
    description: 'India banned non-basmati white rice exports — roughly 40% of global rice trade — due to domestic supply concerns, triggering price spikes and stockpiling panics across Sub-Saharan Africa and Southeast Asia.',
    ongoing: false,
    significance: 8,
  },
  {
    id: 'FW008',
    date: '2022-03',
    actor: 'Ukraine (defensive)',
    target: 'Black Sea shipping',
    mechanism: 'Grain Blockade',
    commodity: 'Wheat, Corn, Sunflower Oil',
    impactM: 120,
    priceSpikesPct: 15,
    description: 'Ukrainian naval mines in Black Sea shipping lanes to deter Russian amphibious attacks inadvertently restricted commercial vessel movement, compounding the grain-export blockade as a collateral effect of sea-denial operations.',
    ongoing: false,
    significance: 8,
  },
  {
    id: 'FW009',
    date: '2021-07',
    actor: 'Ethiopian Government',
    target: 'Tigray population',
    mechanism: 'Grain Blockade',
    commodity: 'Food aid, Grain',
    impactM: 6,
    priceSpikesPct: 40,
    description: 'Ethiopian federal forces blockaded Tigray, halting food aid convoys and precipitating a man-made famine assessed by the UN as the worst in a decade, with IPC Phase 5 Famine conditions in pockets of the region.',
    ongoing: false,
    significance: 9,
  },
  {
    id: 'FW010',
    date: '2022-03',
    actor: 'Egypt (panic-buying)',
    target: 'Global wheat market',
    mechanism: 'Sanctions Impact',
    commodity: 'Wheat',
    impactM: 30,
    priceSpikesPct: 25,
    description: 'Egypt — the world largest wheat importer sourcing ~80% from Russia and Ukraine — triggered a global panic-buying cascade as governments rushed to stockpile, accelerating price spikes across North Africa and the Levant.',
    ongoing: false,
    significance: 7,
  },
];

export const SUPPLY_CONCENTRATIONS: FoodSupplyConcentration[] = [
  {
    commodity: 'Wheat',
    topProducers: ['Russia', 'Ukraine', 'Canada'],
    top3SharePct: 45,
    chokepointRisk: 'Critical',
    recentDisruption: 'Russia-Ukraine war; Black Sea blockade 2022-ongoing',
    priceVolatility: 'Extreme',
  },
  {
    commodity: 'Corn (Maize)',
    topProducers: ['USA', 'China', 'Brazil'],
    top3SharePct: 58,
    chokepointRisk: 'High',
    recentDisruption: 'Ukraine war reduced exports; La Nina drought 2022-23',
    priceVolatility: 'High',
  },
  {
    commodity: 'Potash Fertilizer',
    topProducers: ['Russia', 'Belarus', 'Canada'],
    top3SharePct: 72,
    chokepointRisk: 'Critical',
    recentDisruption: 'Belarus sanctions 2022; Russian export curbs 2022-23',
    priceVolatility: 'High',
  },
  {
    commodity: 'Phosphate Rock',
    topProducers: ['Morocco', 'China', 'Russia'],
    top3SharePct: 68,
    chokepointRisk: 'High',
    recentDisruption: 'China export restrictions 2021; trade tensions ongoing',
    priceVolatility: 'Medium',
  },
  {
    commodity: 'Nitrogen Fertilizer',
    topProducers: ['Russia', 'China'],
    top3SharePct: 37,
    chokepointRisk: 'High',
    recentDisruption: 'Russian gas supply cuts drove European plant shutdowns 2022',
    priceVolatility: 'High',
  },
  {
    commodity: 'Soybeans',
    topProducers: ['USA', 'Brazil', 'Argentina'],
    top3SharePct: 83,
    chokepointRisk: 'Medium',
    recentDisruption: 'Argentina drought 2023; La Nina crop losses',
    priceVolatility: 'Medium',
  },
  {
    commodity: 'Rice',
    topProducers: ['India', 'China', 'Thailand'],
    top3SharePct: 55,
    chokepointRisk: 'High',
    recentDisruption: 'India export ban August 2023; El Nino heat stress 2023',
    priceVolatility: 'High',
  },
  {
    commodity: 'Palm Oil',
    topProducers: ['Indonesia', 'Malaysia'],
    top3SharePct: 83,
    chokepointRisk: 'High',
    recentDisruption: 'Indonesia temporary export ban April-May 2022',
    priceVolatility: 'High',
  },
];

export function getOngoingEvents(events: FoodWeaponizationEvent[]): FoodWeaponizationEvent[] {
  return events.filter((e) => e.ongoing);
}

export function getHighImpact(
  events: FoodWeaponizationEvent[],
  thresholdM = 200,
): FoodWeaponizationEvent[] {
  return events.filter((e) => e.impactM >= thresholdM);
}

export function getCriticalConcentrations(
  concentrations: FoodSupplyConcentration[],
): FoodSupplyConcentration[] {
  return concentrations.filter((c) => c.chokepointRisk === 'Critical');
}

export function computeGlobalFoodSecurityIndex(
  events: FoodWeaponizationEvent[],
  concentrations: FoodSupplyConcentration[],
): number {
  const ongoing = getOngoingEvents(events);
  const criticalChokepoints = getCriticalConcentrations(concentrations).length;
  const avgSig =
    ongoing.length > 0
      ? ongoing.reduce((s, e) => s + e.significance, 0) / ongoing.length
      : 0;
  const score = 100 - ongoing.length * 8 - criticalChokepoints * 6 - avgSig * 1.5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function computeWeaponizationRiskScore(events: FoodWeaponizationEvent[]): number {
  const ongoing = getOngoingEvents(events);
  const highSig = events.filter((e) => e.significance >= 8).length;
  const score = ongoing.length * 12 + highSig * 5;
  return Math.min(100, score);
}

export function mechanismClass(mechanism: FoodWeaponizationMechanism): string {
  const map: Record<FoodWeaponizationMechanism, string> = {
    'Export Ban': 'export-ban',
    'Grain Blockade': 'grain-blockade',
    'Fertilizer Cutoff': 'fertilizer-cutoff',
    'Trade Coercion': 'trade-coercion',
    'Sanctions Impact': 'sanctions-impact',
    'Infrastructure Attack': 'infrastructure-attack',
  };
  return map[mechanism] ?? 'unknown';
}

export function concentrationRiskClass(risk: ChokepointRisk): string {
  const map: Record<ChokepointRisk, string> = {
    Low: 'risk-low',
    Medium: 'risk-medium',
    High: 'risk-high',
    Critical: 'risk-critical',
  };
  return map[risk] ?? 'risk-unknown';
}

export function volatilityClass(volatility: VolatilityLevel): string {
  const map: Record<VolatilityLevel, string> = {
    Low: 'vol-low',
    Medium: 'vol-medium',
    High: 'vol-high',
    Extreme: 'vol-extreme',
  };
  return map[volatility] ?? 'vol-unknown';
}

export function mechanismLabel(mechanism: FoodWeaponizationMechanism): string {
  return mechanism;
}

export function getMostVulnerableRegions(events: FoodWeaponizationEvent[]): string[] {
  const ongoing = getOngoingEvents(events);
  const targets = [...ongoing]
    .sort((a, b) => b.significance - a.significance)
    .map((e) => e.target)
    .slice(0, 5);
  return [...new Set(targets)];
}

export function hasFertilizerDependencyAlert(events: FoodWeaponizationEvent[]): boolean {
  return events.some((e) => e.mechanism === 'Fertilizer Cutoff' && e.ongoing);
}

export function buildRenderData(
  events: FoodWeaponizationEvent[] = WEAPONIZATION_EVENTS,
  concentrations: FoodSupplyConcentration[] = SUPPLY_CONCENTRATIONS,
): FoodGeopoliticsData {
  const sorted = [...events].sort((a, b) => b.significance - a.significance);
  return {
    events: sorted,
    concentrations,
    globalFoodSecurityIndex: computeGlobalFoodSecurityIndex(events, concentrations),
    weaponizationRiskScore: computeWeaponizationRiskScore(events),
    mostVulnerableRegions: getMostVulnerableRegions(events),
    fertilizer_dependency_alert: hasFertilizerDependencyAlert(events),
  };
}
