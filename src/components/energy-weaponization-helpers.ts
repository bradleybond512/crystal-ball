// energy-weaponization-helpers.ts
// Pure logic for EnergyWeaponizationPanel — no DOM, no Panel imports

export type EnergyCommodity = 'Natural Gas' | 'Oil' | 'Coal' | 'Electricity' | 'Uranium';
export type DependencyRisk = 'Low' | 'Medium' | 'High' | 'Critical';
export type CoercionAction = 'Supply Cut' | 'Price Spike' | 'Transit Disruption' | 'Infrastructure Attack' | 'Embargo' | 'Weaponized Pricing';

export interface EnergyDependency {
  id: string;
  importer: string;
  exporter: string;
  commodity: EnergyCommodity;
  dependencyPct: number; // % of total supply from this source
  riskLevel: DependencyRisk;
  alternativeExists: boolean;
  annualVolume: string; // human-readable e.g. "150 BCM/yr"
}

export interface EnergyCoercionEvent {
  id: string;
  date: string;
  actor: string;
  target: string;
  action: CoercionAction;
  commodity: string;
  severityScore: number; // 1-10
  description: string;
  ongoing: boolean;
  estimatedImpactBn: number; // economic impact $B
}

export interface EnergyRiskData {
  dependencies: EnergyDependency[];
  events: EnergyCoercionEvent[];
  globalEnergyRiskIndex: number; // 0-100
  ongoingCoercionCount: number;
  highRiskDyads: EnergyDependency[];
  totalHistoricImpactBn: number;
  criticalDependencyCount: number;
}

const DEPENDENCIES: EnergyDependency[] = [
  { id: 'D001', importer: 'Germany', exporter: 'Russia', commodity: 'Natural Gas', dependencyPct: 55, riskLevel: 'Critical', alternativeExists: true, annualVolume: '~55 BCM/yr (pre-2022)' },
  { id: 'D002', importer: 'Europe (avg)', exporter: 'Russia', commodity: 'Natural Gas', dependencyPct: 40, riskLevel: 'Critical', alternativeExists: true, annualVolume: '~150 BCM/yr (pre-2022)' },
  { id: 'D003', importer: 'China', exporter: 'Russia', commodity: 'Oil', dependencyPct: 18, riskLevel: 'Medium', alternativeExists: true, annualVolume: '~2.2 Mb/d' },
  { id: 'D004', importer: 'Japan', exporter: 'Middle East', commodity: 'Oil', dependencyPct: 88, riskLevel: 'High', alternativeExists: false, annualVolume: '~3.0 Mb/d' },
  { id: 'D005', importer: 'South Korea', exporter: 'Russia', commodity: 'Coal', dependencyPct: 22, riskLevel: 'Medium', alternativeExists: true, annualVolume: '~25 Mt/yr' },
  { id: 'D006', importer: 'Moldova', exporter: 'Russia', commodity: 'Natural Gas', dependencyPct: 100, riskLevel: 'Critical', alternativeExists: false, annualVolume: '~3 BCM/yr' },
  { id: 'D007', importer: 'Hungary', exporter: 'Russia', commodity: 'Natural Gas', dependencyPct: 65, riskLevel: 'Critical', alternativeExists: true, annualVolume: '~10 BCM/yr' },
  { id: 'D008', importer: 'Australia', exporter: 'China', commodity: 'Coal exports', dependencyPct: 70, riskLevel: 'High', alternativeExists: true, annualVolume: '~80 Mt/yr (coal exports)' },
  { id: 'D009', importer: 'United States', exporter: 'Canada', commodity: 'Oil', dependencyPct: 60, riskLevel: 'Low', alternativeExists: true, annualVolume: '~4.0 Mb/d' },
  { id: 'D010', importer: 'Finland', exporter: 'Russia', commodity: 'Natural Gas', dependencyPct: 95, riskLevel: 'Critical', alternativeExists: false, annualVolume: '~2.5 BCM/yr (pre-2022)' },
];

const EVENTS: EnergyCoercionEvent[] = [
  { id: 'E001', date: '2022-03', actor: 'Russia', target: 'Europe', action: 'Supply Cut', commodity: 'Natural Gas', severityScore: 10, description: 'Russia reduced and ultimately cut Nord Stream gas flows following Ukraine invasion; triggered European energy crisis.', ongoing: false, estimatedImpactBn: 300 },
  { id: 'E002', date: '1973-10', actor: 'OAPEC', target: 'USA/Netherlands/Western allies', action: 'Embargo', commodity: 'Oil', severityScore: 9, description: 'Arab oil embargo following Yom Kippur War; oil price quadrupled, causing global recession.', ongoing: false, estimatedImpactBn: 900 },
  { id: 'E003', date: '2006-01', actor: 'Russia', target: 'Ukraine', action: 'Supply Cut', commodity: 'Natural Gas', severityScore: 7, description: 'Gazprom cut gas to Ukraine over pricing dispute; briefly affected European transit volumes.', ongoing: false, estimatedImpactBn: 3 },
  { id: 'E004', date: '2009-01', actor: 'Russia', target: 'Ukraine / Europe', action: 'Transit Disruption', commodity: 'Natural Gas', severityScore: 8, description: '13-day gas cutoff through Ukraine during winter; affected 18 EU member states.', ongoing: false, estimatedImpactBn: 8 },
  { id: 'E005', date: '2020-10', actor: 'China', target: 'Australia', action: 'Embargo', commodity: 'Coal / Barley / Wine', severityScore: 6, description: 'China imposed informal bans on Australian coal, barley, wine, and beef in economic retaliation for COVID inquiry demands.', ongoing: false, estimatedImpactBn: 20 },
  { id: 'E006', date: '2022-09', actor: 'Unknown (attributed Russia)', target: 'Germany / EU', action: 'Infrastructure Attack', commodity: 'Natural Gas', severityScore: 9, description: 'Nord Stream 1 and 2 pipelines sabotaged by underwater explosives; removed future Russian gas leverage.', ongoing: false, estimatedImpactBn: 15 },
  { id: 'E007', date: '2021-12', actor: 'Russia', target: 'Moldova', action: 'Weaponized Pricing', commodity: 'Natural Gas', severityScore: 7, description: 'Gazprom threatened to cut gas unless Moldova paid pre-Soviet debt; state of emergency declared.', ongoing: false, estimatedImpactBn: 1 },
  { id: 'E008', date: '2024-01', actor: 'Russia', target: 'Hungary / Slovakia (via Ukraine transit)', action: 'Transit Disruption', commodity: 'Natural Gas', severityScore: 6, description: 'Ukraine refused to renew transit contract; Russian gas through Ukraine to EU ended Jan 2025.', ongoing: true, estimatedImpactBn: 5 },
  { id: 'E009', date: '2023-03', actor: 'Saudi Arabia / OPEC+', target: 'Global', action: 'Price Spike', commodity: 'Oil', severityScore: 5, description: 'Surprise 1.16 Mb/d production cut pushed Brent above $87; timed to coincide with US bank failures.', ongoing: false, estimatedImpactBn: 40 },
  { id: 'E010', date: '2024-06', actor: 'Russia', target: 'Estonia / Baltic states', action: 'Weaponized Pricing', commodity: 'Electricity', severityScore: 4, description: 'Desynchronization of Baltic grid from Russian BRELL ring completed; new undersea cables to Finland commissioned.', ongoing: false, estimatedImpactBn: 2 },
];

export function computeGlobalEnergyRiskIndex(deps: EnergyDependency[], events: EnergyCoercionEvent[]): number {
  if (!deps.length && !events.length) return 0;
  const depScore = deps.length
    ? deps.reduce((s, d) => {
        const w = { Critical: 1.0, High: 0.7, Medium: 0.4, Low: 0.1 }[d.riskLevel] ?? 0.1;
        return s + (d.dependencyPct / 100) * w;
      }, 0) / deps.length * 60
    : 0;
  const ongoingEvents = events.filter(e => e.ongoing);
  const eventScore = ongoingEvents.length > 0
    ? Math.min(40, ongoingEvents.reduce((s, e) => s + e.severityScore, 0) * 2)
    : 0;
  return Math.min(100, Math.round(depScore + eventScore));
}

export function getHighRiskDependencies(deps: EnergyDependency[]): EnergyDependency[] {
  return deps.filter(d => d.riskLevel === 'High' || d.riskLevel === 'Critical');
}

export function getOngoingCoercion(events: EnergyCoercionEvent[]): EnergyCoercionEvent[] {
  return events.filter(e => e.ongoing);
}

export function getTotalHistoricImpactBn(events: EnergyCoercionEvent[]): number {
  return events.reduce((s, e) => s + e.estimatedImpactBn, 0);
}

export function getCriticalDependencies(deps: EnergyDependency[]): EnergyDependency[] {
  return deps.filter(d => d.riskLevel === 'Critical');
}

export function rankBySeverity(events: EnergyCoercionEvent[]): EnergyCoercionEvent[] {
  return [...events].sort((a, b) => b.severityScore - a.severityScore);
}

export function riskLevelClass(level: DependencyRisk): string {
  const map: Record<DependencyRisk, string> = { Critical: 'risk-critical', High: 'risk-high', Medium: 'risk-medium', Low: 'risk-low' };
  return map[level] ?? 'risk-low';
}

export function actionClass(action: CoercionAction): string {
  const map: Record<CoercionAction, string> = {
    'Supply Cut': 'action-cut',
    'Price Spike': 'action-price',
    'Transit Disruption': 'action-transit',
    'Infrastructure Attack': 'action-attack',
    'Embargo': 'action-embargo',
    'Weaponized Pricing': 'action-price',
  };
  return map[action] ?? 'action-cut';
}

export function buildRenderData(): EnergyRiskData {
  return {
    dependencies: DEPENDENCIES,
    events: EVENTS,
    globalEnergyRiskIndex: computeGlobalEnergyRiskIndex(DEPENDENCIES, EVENTS),
    ongoingCoercionCount: getOngoingCoercion(EVENTS).length,
    highRiskDyads: getHighRiskDependencies(DEPENDENCIES),
    totalHistoricImpactBn: getTotalHistoricImpactBn(EVENTS),
    criticalDependencyCount: getCriticalDependencies(DEPENDENCIES).length,
  };
}
