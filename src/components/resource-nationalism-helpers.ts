// resource-nationalism-helpers.ts
// Pure logic for ResourceNationalismPanel -- no DOM, no Panel imports

export type EventType =
  | 'Nationalization'
  | 'Export Ban'
  | 'Seizure'
  | 'Windfall Tax'
  | 'Forced Divestiture'
  | 'License Revocation'
  | 'State Equity Demand';

export type NationalizationOutcome =
  | 'Completed'
  | 'Ongoing'
  | 'Reversed'
  | 'Negotiated Settlement';

export type NationalismRiskLevel = 'Low' | 'Moderate' | 'High' | 'Critical';

export interface NationalizationEvent {
  id: string;
  date: string;
  country: string;
  resource: string;
  eventType: EventType;
  description: string;
  outcome: NationalizationOutcome;
  economicImpactBn: number;
  affectedCompanies: string[];
  severity: number;
}

export interface CriticalResource {
  id: string;
  name: string;
  primaryProducers: string[];
  topProducerSharePct: number;
  supplyConcentrationHHI: number;
  weaponizationRisk: NationalismRiskLevel;
  strategicUse: string;
  priceVolatility: 'Low' | 'Moderate' | 'High' | 'Extreme';
}

export interface CountryRiskProfile {
  id: string;
  country: string;
  region: string;
  nationalismScore: number;
  riskLevel: NationalismRiskLevel;
  keyResources: string[];
  recentActions: number;
  trend: 'Decreasing' | 'Stable' | 'Increasing' | 'Escalating';
  notes: string;
}

export interface ResourceRenderData {
  events: NationalizationEvent[];
  resources: CriticalResource[];
  countries: CountryRiskProfile[];
  globalNationalismIndex: number;
  criticalEventCount: number;
  highRiskResourceCount: number;
  highRiskCountryCount: number;
  mostRiskyResources: CriticalResource[];
}

const EVENTS: NationalizationEvent[] = [
  { id: 'N001', date: '2023-10-21', country: 'Bolivia', resource: 'Lithium', eventType: 'Nationalization', description: `Arce government fully nationalized lithium sector; rescinded Uranium One JV and expelled foreign operators from Salar de Uyuni, the world's largest lithium reserve.`, outcome: 'Completed', economicImpactBn: 2.1, affectedCompanies: ['Uranium One', 'ACISA'], severity: 9 },
  { id: 'N002', date: '2021-06-01', country: 'DRC', resource: 'Cobalt', eventType: 'State Equity Demand', description: 'DRC revised mining code requiring state-owned Gecamines to hold minimum 10% equity in all cobalt and coltan operations; renegotiated several contracts under threat of revocation.', outcome: 'Completed', economicImpactBn: 3.8, affectedCompanies: ['Glencore', 'China Molybdenum', 'Ivanhoe Mines'], severity: 8 },
  { id: 'N003', date: '2023-04-20', country: 'Chile', resource: 'Lithium', eventType: 'Nationalization', description: `President Boric announced national lithium strategy granting CODELCO and SQM a new partnership framework; future concessions require majority state participation via CODELCO.`, outcome: 'Ongoing', economicImpactBn: 1.4, affectedCompanies: ['SQM', 'Albemarle'], severity: 7 },
  { id: 'N004', date: '2023-09-12', country: 'Zambia', resource: 'Copper', eventType: 'Forced Divestiture', description: 'Zambian government placed Mopani Copper Mines under ZCCM-IH state control after Glencore exit; sought new strategic partners under revised resource ownership terms.', outcome: 'Completed', economicImpactBn: 1.1, affectedCompanies: ['Glencore'], severity: 7 },
  { id: 'N005', date: '2022-05-05', country: 'Kazakhstan', resource: 'Oil', eventType: 'License Revocation', description: `Kazakh authorities halted Tengizchevroil expansion; levied $150B backdated damages claim against TengizChevroil consortium -- widely seen as resource-nationalism leverage.`, outcome: 'Negotiated Settlement', economicImpactBn: 5.2, affectedCompanies: ['Chevron', 'ExxonMobil', 'Shell', 'KazMunayGas'], severity: 8 },
  { id: 'N006', date: '2020-10-01', country: 'Mexico', resource: 'Oil & Gas', eventType: 'Nationalization', description: 'AMLO government halted new oil & gas auctions, reversed fracking permits, and redirected PEMEX subsidies; 2022 electricity reform attempted to restore CFE dominance over private generators.', outcome: 'Completed', economicImpactBn: 4.5, affectedCompanies: ['Shell', 'Total', 'BP', 'private IPP operators'], severity: 8 },
  { id: 'N007', date: '2023-07-26', country: 'Niger', resource: 'Uranium', eventType: 'License Revocation', description: 'Post-coup military junta revoked Orano uranium mining permits at Imouraren and suspended operations; junta cited sovereignty and colonial-era profit extraction.', outcome: 'Ongoing', economicImpactBn: 0.9, affectedCompanies: ['Orano'], severity: 9 },
  { id: 'N008', date: '2022-12-14', country: 'Zimbabwe', resource: 'Lithium', eventType: 'Export Ban', description: 'Zimbabwe banned raw lithium ore exports to force domestic value-add processing; mandated that miners build refineries within 12 months or cease operations.', outcome: 'Completed', economicImpactBn: 0.4, affectedCompanies: ['Bikita Minerals', 'Prospect Resources'], severity: 6 },
  { id: 'N009', date: '2020-01-01', country: 'Indonesia', resource: 'Nickel', eventType: 'Export Ban', description: 'Indonesia banned unprocessed nickel ore exports effective January 2020; a 2023 expansion extended restrictions to bauxite. WTO ruled against the ban but Indonesia maintained it.', outcome: 'Completed', economicImpactBn: 12.0, affectedCompanies: ['Vale Indonesia', 'Nickel Industries', 'Chinese smelters (benefited)'], severity: 9 },
  { id: 'N010', date: '2021-03-01', country: 'Saudi Arabia', resource: 'Oil', eventType: 'Windfall Tax', description: `Saudi government raised Aramco's minimum dividend obligation and increased royalty rates, extracting windfall capital; international minority shareholders absorbed dilutive effects.`, outcome: 'Completed', economicImpactBn: 8.0, affectedCompanies: ['Saudi Aramco minority shareholders'], severity: 6 },
  { id: 'N011', date: '2024-03-01', country: 'DRC', resource: 'Coltan', eventType: 'Seizure', description: 'DRC army and state miners seized artisanal coltan mining zones in North Kivu; armed escorts mandated for all tantalum exports routed through state checkpoints. UN panel flagged systematic diversion.', outcome: 'Ongoing', economicImpactBn: 0.6, affectedCompanies: ['artisanal miners', 'downstream tantalum processors'], severity: 8 },
  { id: 'N012', date: '2024-01-15', country: 'China', resource: 'Rare Earths', eventType: 'Export Ban', description: 'China imposed export controls on gallium, germanium, and graphite -- critical rare-earth-adjacent materials -- citing national security; signaling readiness to weaponize mineral dominance.', outcome: 'Completed', economicImpactBn: 2.3, affectedCompanies: ['global semiconductor firms', 'EV battery makers'], severity: 10 },
];

const RESOURCES: CriticalResource[] = [
  { id: 'RC001', name: 'Lithium', primaryProducers: ['Australia', 'Chile', 'Argentina'], topProducerSharePct: 47, supplyConcentrationHHI: 2800, weaponizationRisk: 'High', strategicUse: 'EV batteries, grid storage, consumer electronics', priceVolatility: 'Extreme' },
  { id: 'RC002', name: 'Cobalt', primaryProducers: ['DRC', 'Russia', 'Australia'], topProducerSharePct: 74, supplyConcentrationHHI: 5600, weaponizationRisk: 'Critical', strategicUse: 'EV battery cathodes, aerospace superalloys, medical devices', priceVolatility: 'Extreme' },
  { id: 'RC003', name: 'Rare Earths', primaryProducers: ['China', 'USA', 'Myanmar'], topProducerSharePct: 60, supplyConcentrationHHI: 4200, weaponizationRisk: 'Critical', strategicUse: 'Magnets, defense electronics, wind turbines, EV motors', priceVolatility: 'High' },
  { id: 'RC004', name: 'Nickel', primaryProducers: ['Indonesia', 'Philippines', 'Russia'], topProducerSharePct: 48, supplyConcentrationHHI: 3100, weaponizationRisk: 'High', strategicUse: 'Stainless steel, EV battery cathodes, aerospace alloys', priceVolatility: 'High' },
  { id: 'RC005', name: 'Polysilicon', primaryProducers: ['China', 'Germany', 'USA'], topProducerSharePct: 79, supplyConcentrationHHI: 6400, weaponizationRisk: 'Critical', strategicUse: 'Solar panels, semiconductors, fiber optics', priceVolatility: 'Moderate' },
  { id: 'RC006', name: 'Uranium', primaryProducers: ['Kazakhstan', 'Canada', 'Namibia'], topProducerSharePct: 43, supplyConcentrationHHI: 2600, weaponizationRisk: 'High', strategicUse: 'Nuclear power generation, naval propulsion, medical isotopes', priceVolatility: 'High' },
  { id: 'RC007', name: 'Copper', primaryProducers: ['Chile', 'Peru', 'DRC'], topProducerSharePct: 28, supplyConcentrationHHI: 1400, weaponizationRisk: 'Moderate', strategicUse: 'Electrical wiring, EVs, renewables infrastructure', priceVolatility: 'Moderate' },
  { id: 'RC008', name: 'Palladium', primaryProducers: ['Russia', 'South Africa', 'Canada'], topProducerSharePct: 44, supplyConcentrationHHI: 2900, weaponizationRisk: 'High', strategicUse: 'Automotive catalytic converters, electronics, hydrogen production', priceVolatility: 'Extreme' },
];

const COUNTRIES: CountryRiskProfile[] = [
  { id: 'CR001', country: 'Bolivia', region: 'Latin America', nationalismScore: 88, riskLevel: 'Critical', keyResources: ['Lithium', 'Tin', 'Silver'], recentActions: 2, trend: 'Escalating', notes: 'MAS government ideology centers on state ownership of natural wealth; repeated contract reversals.' },
  { id: 'CR002', country: 'DRC', region: 'Sub-Saharan Africa', nationalismScore: 82, riskLevel: 'Critical', keyResources: ['Cobalt', 'Coltan', 'Copper'], recentActions: 3, trend: 'Escalating', notes: 'Tshisekedi government aggressively renegotiating Chinese Belt-and-Road mining deals.' },
  { id: 'CR003', country: 'Indonesia', region: 'Southeast Asia', nationalismScore: 78, riskLevel: 'High', keyResources: ['Nickel', 'Bauxite', 'Coal'], recentActions: 2, trend: 'Increasing', notes: 'Systematic downstream processing mandate; WTO-defiant export bans.' },
  { id: 'CR004', country: 'China', region: 'East Asia', nationalismScore: 85, riskLevel: 'Critical', keyResources: ['Rare Earths', 'Polysilicon', 'Gallium', 'Germanium'], recentActions: 2, trend: 'Escalating', notes: 'Uses mineral export controls as geopolitical lever in technology trade wars.' },
  { id: 'CR005', country: 'Niger', region: 'West Africa', nationalismScore: 90, riskLevel: 'Critical', keyResources: ['Uranium', 'Gold'], recentActions: 1, trend: 'Escalating', notes: 'Post-coup junta expelled French operators; aligning with Russia for resource management.' },
  { id: 'CR006', country: 'Mexico', region: 'Latin America', nationalismScore: 72, riskLevel: 'High', keyResources: ['Oil & Gas', 'Silver', 'Lithium'], recentActions: 2, trend: 'Increasing', notes: 'Energy renationalization under AMLO; Claudia Sheinbaum expected to continue statist energy policy.' },
  { id: 'CR007', country: 'Chile', region: 'Latin America', nationalismScore: 65, riskLevel: 'High', keyResources: ['Lithium', 'Copper'], recentActions: 1, trend: 'Increasing', notes: 'Boric government pursuing state partnership model rather than outright nationalization.' },
  { id: 'CR008', country: 'Zambia', region: 'Sub-Saharan Africa', nationalismScore: 60, riskLevel: 'High', keyResources: ['Copper', 'Cobalt'], recentActions: 1, trend: 'Stable', notes: 'Hichilema government more pragmatic than predecessors but reasserted state control of Mopani.' },
  { id: 'CR009', country: 'Zimbabwe', region: 'Sub-Saharan Africa', nationalismScore: 70, riskLevel: 'High', keyResources: ['Lithium', 'Platinum', 'Chrome'], recentActions: 1, trend: 'Increasing', notes: 'Indigenization policy revived; export bans on raw minerals accelerating.' },
  { id: 'CR010', country: 'Kazakhstan', region: 'Central Asia', nationalismScore: 58, riskLevel: 'Moderate', keyResources: ['Uranium', 'Oil', 'Chromite'], recentActions: 1, trend: 'Stable', notes: 'Occasional rent-extraction via regulatory pressure; generally honors contracts after negotiation.' },
  { id: 'CR011', country: 'Saudi Arabia', region: 'Middle East', nationalismScore: 55, riskLevel: 'Moderate', keyResources: ['Oil', 'Natural Gas'], recentActions: 1, trend: 'Stable', notes: `Aramco dividend policies favor state; production decisions weaponized through OPEC+.` },
  { id: 'CR012', country: 'Russia', region: 'Eurasia', nationalismScore: 80, riskLevel: 'Critical', keyResources: ['Palladium', 'Nickel', 'Oil', 'Natural Gas'], recentActions: 1, trend: 'Escalating', notes: 'Energy weaponization against Europe; Norilsk Nickel under state pressure; sanctions exposure.' },
];

export function computeGlobalNationalismIndex(countries: CountryRiskProfile[]): number {
  if (!countries.length) return 0;
  const avg = countries.reduce((s, c) => s + c.nationalismScore, 0) / countries.length;
  return Math.min(100, Math.round(avg));
}

export function getByResource(events: NationalizationEvent[], resource: string): NationalizationEvent[] {
  return events.filter(e => e.resource.toLowerCase().includes(resource.toLowerCase()));
}

export function getHighRiskCountries(countries: CountryRiskProfile[], levels: NationalismRiskLevel[] = ['High', 'Critical']): CountryRiskProfile[] {
  return countries.filter(c => levels.includes(c.riskLevel));
}

export function getRecentEvents(events: NationalizationEvent[], afterYear = 2022): NationalizationEvent[] {
  return events.filter(e => parseInt(e.date.slice(0, 4), 10) >= afterYear);
}

export function resourceConcentrationScore(resource: CriticalResource): number {
  const hhiNorm = Math.min(100, Math.round(resource.supplyConcentrationHHI / 100));
  const shareNorm = resource.topProducerSharePct;
  return Math.min(100, Math.round((hhiNorm + shareNorm) / 2));
}

export function nationalismClass(level: NationalismRiskLevel): string {
  const map: Record<NationalismRiskLevel, string> = { Low: 'nm-low', Moderate: 'nm-moderate', High: 'nm-high', Critical: 'nm-critical' };
  return map[level] ?? 'nm-moderate';
}

export function eventTypeClass(eventType: EventType): string {
  const map: Record<EventType, string> = { Nationalization: 'et-nationalization', 'Export Ban': 'et-export-ban', Seizure: 'et-seizure', 'Windfall Tax': 'et-windfall', 'Forced Divestiture': 'et-divestiture', 'License Revocation': 'et-revocation', 'State Equity Demand': 'et-equity-demand' };
  return map[eventType] ?? 'et-nationalization';
}

export function outcomeClass(outcome: NationalizationOutcome): string {
  const map: Record<NationalizationOutcome, string> = { Completed: 'oc-completed', Ongoing: 'oc-ongoing', Reversed: 'oc-reversed', 'Negotiated Settlement': 'oc-settled' };
  return map[outcome] ?? 'oc-ongoing';
}

export function volatilityClass(v: CriticalResource['priceVolatility']): string {
  const map: Record<CriticalResource['priceVolatility'], string> = { Low: 'vol-low', Moderate: 'vol-moderate', High: 'vol-high', Extreme: 'vol-extreme' };
  return map[v] ?? 'vol-moderate';
}

export function buildRenderData(): ResourceRenderData {
  const criticalEvents = EVENTS.filter(e => e.severity >= 8);
  const highRiskResources = RESOURCES.filter(r => r.weaponizationRisk === 'High' || r.weaponizationRisk === 'Critical');
  const highRiskCountries = getHighRiskCountries(COUNTRIES);
  const mostRiskyResources = [...RESOURCES].sort((a, b) => resourceConcentrationScore(b) - resourceConcentrationScore(a)).slice(0, 4);
  return {
    events: EVENTS,
    resources: RESOURCES,
    countries: COUNTRIES,
    globalNationalismIndex: computeGlobalNationalismIndex(COUNTRIES),
    criticalEventCount: criticalEvents.length,
    highRiskResourceCount: highRiskResources.length,
    highRiskCountryCount: highRiskCountries.length,
    mostRiskyResources,
  };
}
