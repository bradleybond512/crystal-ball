/**
 * Insurgency Tracker — pure helpers (no DOM, no fetch, no globals).
 *
 * A static, fixture-tested model of 10 major active insurgencies. The panel
 * layer (InsurgencyTrackerPanel.ts) renders the output of buildRenderData();
 * every function here is input-output pure so it can be unit-tested with the
 * static INSURGENCIES fixture.
 */

export interface Insurgency {
  id: string;
  name: string;
  country: string;
  region: string;
  group: string;
  status: 'active' | 'declining' | 'escalating' | 'ceasefire';
  strength: 'low' | 'medium' | 'high' | 'very-high';
  startYear: number;
  territory: string;
  annualFatalities: number;
  displacedPersons: number; // displaced in thousands
  governmentControl: number; // 0-100
  externalSupport: string | null;
  ideologyType: 'jihadist' | 'separatist' | 'communist' | 'nationalist' | 'criminal' | 'mixed';
  trend: 'intensifying' | 'stable' | 'waning';
  lastUpdate: string;
}

export interface InsurgencyData {
  insurgencies: Insurgency[];
  lastUpdated: string;
  globalInsurgencyIndex: number;
}

export const INSURGENCIES: Insurgency[] = [
  {
    id: 'isis-sahel',
    name: 'ISIS Sahel Province',
    country: 'Mali/Burkina Faso/Niger',
    region: 'West Africa',
    group: 'ISWAP/JNIM',
    status: 'escalating',
    strength: 'high',
    startYear: 2015,
    territory: 'Tri-border rural zones',
    annualFatalities: 4500,
    displacedPersons: 2800,
    governmentControl: 45,
    externalSupport: 'al-Qaeda network',
    ideologyType: 'jihadist',
    trend: 'intensifying',
    lastUpdate: '2024-Q4',
  },
  {
    id: 'myanmar-civil-war',
    name: 'Myanmar Post-Coup Civil War',
    country: 'Myanmar',
    region: 'Southeast Asia',
    group: 'PDF/EAOs',
    status: 'escalating',
    strength: 'high',
    startYear: 2021,
    territory: 'Border regions and towns',
    annualFatalities: 3200,
    displacedPersons: 3100,
    governmentControl: 40,
    externalSupport: null,
    ideologyType: 'nationalist',
    trend: 'intensifying',
    lastUpdate: '2024-Q4',
  },
  {
    id: 'nigeria-boko-haram',
    name: 'Boko Haram/ISWAP Nigeria',
    country: 'Nigeria',
    region: 'West Africa',
    group: 'ISWAP/JAS',
    status: 'active',
    strength: 'high',
    startYear: 2009,
    territory: 'Northeast + Lake Chad basin',
    annualFatalities: 2100,
    displacedPersons: 2200,
    governmentControl: 60,
    externalSupport: null,
    ideologyType: 'jihadist',
    trend: 'stable',
    lastUpdate: '2024-Q4',
  },
  {
    id: 'somalia-al-shabaab',
    name: 'al-Shabaab Somalia',
    country: 'Somalia',
    region: 'East Africa',
    group: 'al-Shabaab',
    status: 'active',
    strength: 'high',
    startYear: 2006,
    territory: 'Rural south/central Somalia',
    annualFatalities: 1800,
    displacedPersons: 1400,
    governmentControl: 35,
    externalSupport: null,
    ideologyType: 'jihadist',
    trend: 'stable',
    lastUpdate: '2024-Q4',
  },
  {
    id: 'ukraine-russia-war',
    name: 'Russia-Ukraine War',
    country: 'Ukraine',
    region: 'Eastern Europe',
    group: 'Russian Armed Forces',
    status: 'active',
    strength: 'very-high',
    startYear: 2014,
    territory: 'Occupied eastern/southern oblasts',
    annualFatalities: 45_000,
    displacedPersons: 6500,
    governmentControl: 80,
    externalSupport: 'Russia state-sponsored',
    ideologyType: 'nationalist',
    trend: 'stable',
    lastUpdate: '2024-Q4',
  },
  {
    id: 'ethiopia-amhara',
    name: 'Ethiopia Amhara/Tigray Conflict',
    country: 'Ethiopia',
    region: 'East Africa',
    group: 'Fano/TDF',
    status: 'active',
    strength: 'medium',
    startYear: 2020,
    territory: 'Amhara region and Tigray',
    annualFatalities: 900,
    displacedPersons: 1200,
    governmentControl: 60,
    externalSupport: null,
    ideologyType: 'nationalist',
    trend: 'stable',
    lastUpdate: '2024-Q4',
  },
  {
    id: 'mozambique-cabo',
    name: 'Mozambique Cabo Delgado Insurgency',
    country: 'Mozambique',
    region: 'Southern Africa',
    group: 'al-Shabaab Mozambique',
    status: 'active',
    strength: 'medium',
    startYear: 2017,
    territory: 'Northern coastal Cabo Delgado',
    annualFatalities: 800,
    displacedPersons: 900,
    governmentControl: 55,
    externalSupport: null,
    ideologyType: 'jihadist',
    trend: 'stable',
    lastUpdate: '2024-Q4',
  },
  {
    id: 'iraq-isis',
    name: 'ISIS Iraq Rural Insurgency',
    country: 'Iraq',
    region: 'Middle East',
    group: 'ISIS',
    status: 'active',
    strength: 'medium',
    startYear: 2017,
    territory: 'Remote Anbar/Kirkuk desert',
    annualFatalities: 600,
    displacedPersons: 200,
    governmentControl: 78,
    externalSupport: null,
    ideologyType: 'jihadist',
    trend: 'stable',
    lastUpdate: '2024-Q4',
  },
  {
    id: 'colombia-eln',
    name: 'Colombia ELN Insurgency',
    country: 'Colombia',
    region: 'Latin America',
    group: 'ELN',
    status: 'active',
    strength: 'medium',
    startYear: 1964,
    territory: 'Border regions and rural corridors',
    annualFatalities: 350,
    displacedPersons: 180,
    governmentControl: 70,
    externalSupport: 'Venezuela partial',
    ideologyType: 'communist',
    trend: 'stable',
    lastUpdate: '2024-Q4',
  },
  {
    id: 'philippines-npa',
    name: 'Philippine CPP-NPA',
    country: 'Philippines',
    region: 'Southeast Asia',
    group: 'NPA/CPP',
    status: 'declining',
    strength: 'low',
    startYear: 1969,
    territory: 'Rural Luzon/Mindanao pockets',
    annualFatalities: 150,
    displacedPersons: 50,
    governmentControl: 85,
    externalSupport: null,
    ideologyType: 'communist',
    trend: 'waning',
    lastUpdate: '2024-Q4',
  },
];

const STRENGTH_WEIGHT: Record<Insurgency['strength'], number> = {
  'very-high': 4,
  high: 3,
  medium: 2,
  low: 1,
};

const STRENGTH_CLASS: Record<Insurgency['strength'], string> = {
  'very-high': 'severity-critical',
  high: 'severity-high',
  medium: 'severity-medium',
  low: 'severity-low',
};

const STATUS_CLASS: Record<Insurgency['status'], string> = {
  escalating: 'status-escalating',
  active: 'status-active',
  declining: 'status-declining',
  ceasefire: 'status-ceasefire',
};

const INTENSIFYING_MULTIPLIER = 1.5;
const MAX_WEIGHT = STRENGTH_WEIGHT['very-high'];

export function getByStatus(data: Insurgency[], status: Insurgency['status']): Insurgency[] {
  return data.filter((i) => i.status === status);
}

export function getByStrength(data: Insurgency[], strength: Insurgency['strength']): Insurgency[] {
  return data.filter((i) => i.strength === strength);
}

export function getByRegion(data: Insurgency[], region: string): Insurgency[] {
  return data.filter((i) => i.region === region);
}

export function getEscalating(data: Insurgency[]): Insurgency[] {
  return data.filter((i) => i.trend === 'intensifying');
}

export function computeGlobalInsurgencyIndex(data: Insurgency[]): number {
  if (data.length === 0) return 0;
  let sum = 0;
  for (const i of data) {
    const weight = STRENGTH_WEIGHT[i.strength];
    sum += i.trend === 'intensifying' ? weight * INTENSIFYING_MULTIPLIER : weight;
  }
  const maxPossibleSum = data.length * MAX_WEIGHT * INTENSIFYING_MULTIPLIER;
  const index = Math.round((sum / maxPossibleSum) * 100);
  return Math.max(0, Math.min(100, index));
}

export function strengthClass(s: Insurgency['strength']): string {
  return STRENGTH_CLASS[s];
}

export function statusClass(s: Insurgency['status']): string {
  return STATUS_CLASS[s];
}

export function buildRenderData(): InsurgencyData {
  const insurgencies = [...INSURGENCIES];
  return {
    insurgencies,
    lastUpdated: '2024-Q4',
    globalInsurgencyIndex: computeGlobalInsurgencyIndex(INSURGENCIES),
  };
}
