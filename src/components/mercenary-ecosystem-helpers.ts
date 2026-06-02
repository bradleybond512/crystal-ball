// mercenary-ecosystem-helpers.ts — pure deterministic helpers

export type PMCStatus = 'active' | 'sanctioned' | 'disbanded' | 'rebranded';
export type OperationType = 'combat' | 'training' | 'logistics' | 'intelligence' | 'security' | 'hybrid';
export type SponsorNation = 'Russia' | 'UAE' | 'China' | 'USA' | 'Saudi Arabia' | 'Qatar' | 'Turkey' | 'non-state';

export interface PMCGroup {
  id: string;
  name: string;
  sponsor: SponsorNation;
  status: PMCStatus;
  estimatedStrength: number; // personnel
  activeTheaters: string[];
  operationTypes: OperationType[];
  humanRightsFlags: number; // 0-10 documented incidents
  revenueMUSD: number; // millions USD annually
  governmentAffiliation: number; // 0-100 (100 = quasi-state)
}

export interface PMCIncident {
  id: string;
  groupId: string;
  date: string;
  country: string;
  type: 'atrocity' | 'combat-loss' | 'mutiny' | 'sanction' | 'defection';
  description: string;
  severity: number; // 0-10
}

const MOCK_GROUPS: PMCGroup[] = [
  { id: 'wagner', name: 'Wagner Group / Africa Corps', sponsor: 'Russia', status: 'rebranded', estimatedStrength: 50_000, activeTheaters: ['Ukraine', 'Mali', 'Libya', 'Sudan', 'CAR', 'Niger'], operationTypes: ['combat', 'training', 'intelligence'], humanRightsFlags: 9, revenueMUSD: 3500, governmentAffiliation: 95 },
  { id: 'redion', name: 'Redion / RossTech', sponsor: 'Russia', status: 'active', estimatedStrength: 8000, activeTheaters: ['Ukraine', 'Syria'], operationTypes: ['combat', 'logistics'], humanRightsFlags: 5, revenueMUSD: 600, governmentAffiliation: 85 },
  { id: 'msd', name: 'Mahad Al-Arabiya / MSD', sponsor: 'UAE', status: 'active', estimatedStrength: 15_000, activeTheaters: ['Yemen', 'Libya', 'Somalia'], operationTypes: ['combat', 'training', 'security'], humanRightsFlags: 7, revenueMUSD: 1200, governmentAffiliation: 70 },
  { id: 'sterling', name: 'Sterling Global Operations', sponsor: 'USA', status: 'active', estimatedStrength: 3000, activeTheaters: ['Iraq', 'Jordan', 'Colombia'], operationTypes: ['training', 'security', 'intelligence'], humanRightsFlags: 2, revenueMUSD: 450, governmentAffiliation: 40 },
  { id: 'sadat', name: 'SADAT A.Ş.', sponsor: 'Turkey', status: 'active', estimatedStrength: 5000, activeTheaters: ['Libya', 'Syria', 'Somalia', 'Qatar'], operationTypes: ['training', 'combat', 'logistics'], humanRightsFlags: 4, revenueMUSD: 280, governmentAffiliation: 80 },
  { id: 'sinaloa-sec', name: 'Blackwater Successor (ACADEMI)', sponsor: 'USA', status: 'active', estimatedStrength: 20_000, activeTheaters: ['Iraq', 'Afghanistan', 'UAE'], operationTypes: ['security', 'training', 'logistics'], humanRightsFlags: 3, revenueMUSD: 2000, governmentAffiliation: 30 },
  { id: 'lotus', name: 'Lotus Defense (Chinese PMC)', sponsor: 'China', status: 'active', estimatedStrength: 3500, activeTheaters: ['South Sudan', 'Iraq', 'Pakistan'], operationTypes: ['security', 'training'], humanRightsFlags: 1, revenueMUSD: 180, governmentAffiliation: 60 },
  { id: 'ntc-lib', name: 'NTC Libyan Militias', sponsor: 'non-state', status: 'active', estimatedStrength: 25_000, activeTheaters: ['Libya'], operationTypes: ['combat', 'security'], humanRightsFlags: 8, revenueMUSD: 400, governmentAffiliation: 20 },
];

const MOCK_INCIDENTS: PMCIncident[] = [
  { id: 'i1', groupId: 'wagner', date: '2023-08-23', country: 'Russia', type: 'mutiny', description: 'Prigozhin mutiny and march on Moscow', severity: 10 },
  { id: 'i2', groupId: 'wagner', date: '2021-03-28', country: 'CAR', type: 'atrocity', description: 'Documented massacre of civilians in Bangui region', severity: 9 },
  { id: 'i3', groupId: 'msd', date: '2022-01-15', country: 'Yemen', type: 'atrocity', description: 'Reported detention facility abuses', severity: 7 },
  { id: 'i4', groupId: 'wagner', date: '2023-06-05', country: 'Mali', type: 'atrocity', description: 'Moura massacre — 500+ civilian deaths', severity: 10 },
  { id: 'i5', groupId: 'sadat', date: '2020-06-10', country: 'Libya', type: 'combat-loss', description: '12 personnel KIA in Tripoli offensive', severity: 5 },
  { id: 'i6', groupId: 'redion', date: '2024-02-17', country: 'Ukraine', type: 'sanction', description: 'EU/US sanctions imposed on leadership', severity: 6 },
];

export function scorePMCThreat(g: PMCGroup): number {
  const hrPenalty = g.humanRightsFlags * 4;
  const strengthFactor = Math.min(30, g.estimatedStrength / 2000);
  return Math.min(100, Math.round(g.governmentAffiliation * 0.35 + (g.revenueMUSD / 100) * 0.2 + hrPenalty * 0.3 + strengthFactor * 0.15));
}

export function rankBySponsor(groups: PMCGroup[]): Record<SponsorNation, PMCGroup[]> {
  const out = {} as Record<SponsorNation, PMCGroup[]>;
  for (const g of groups) {
    if (!out[g.sponsor]) out[g.sponsor] = [];
    out[g.sponsor].push(g);
  }
  return out;
}

export function filterByStatus(groups: PMCGroup[], status: PMCStatus): PMCGroup[] {
  return groups.filter(g => g.status === status);
}

export function filterByTheater(groups: PMCGroup[], country: string): PMCGroup[] {
  return groups.filter(g => g.activeTheaters.includes(country));
}

export function computeTotalStrength(groups: PMCGroup[]): number {
  return groups.reduce((s, g) => s + g.estimatedStrength, 0);
}

export function rankGroupsByThreat(groups: PMCGroup[]): PMCGroup[] {
  return [...groups].sort((a, b) => scorePMCThreat(b) - scorePMCThreat(a));
}

export function getMostActiveTheater(groups: PMCGroup[]): string {
  const counts: Record<string, number> = {};
  for (const g of groups) {
    for (const t of g.activeTheaters) {
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  return Object.entries(counts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'unknown';
}

export function getHumanRightsViolators(groups: PMCGroup[], minFlags = 5): PMCGroup[] {
  return groups.filter(g => g.humanRightsFlags >= minFlags).sort((a, b) => b.humanRightsFlags - a.humanRightsFlags);
}

export function computeRecentIncidentRate(incidents: PMCIncident[], lookbackDays = 365): number {
  const cutoff = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
  return incidents.filter(i => i.date >= cutoff).length;
}

export function buildRenderData(): {
  groups: PMCGroup[];
  recentIncidents: PMCIncident[];
  totalStrength: number;
  mostActiveTheater: string;
  humanRightsViolators: PMCGroup[];
} {
  return {
    groups: rankGroupsByThreat(MOCK_GROUPS),
    recentIncidents: [...MOCK_INCIDENTS].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    totalStrength: computeTotalStrength(MOCK_GROUPS),
    mostActiveTheater: getMostActiveTheater(MOCK_GROUPS),
    humanRightsViolators: getHumanRightsViolators(MOCK_GROUPS),
  };
}
