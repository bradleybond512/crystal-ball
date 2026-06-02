// economic-espionage-helpers.ts — pure deterministic helpers

export type EspionageVector = 'cyber-intrusion' | 'insider-threat' | 'academic-infiltration' | 'supply-chain-compromise' | 'recruitment' | 'front-company';
export type TargetSector = 'semiconductor' | 'aerospace' | 'pharma' | 'ai-ml' | 'energy' | 'defense' | 'finance' | 'telecom';
export type ActorCountry = 'China' | 'Russia' | 'Iran' | 'North Korea';

export interface EspionageOperation {
  id: string;
  actor: ActorCountry;
  targetCountry: string;
  targetSector: TargetSector;
  vector: EspionageVector;
  estimatedValueUSD: number;
  detectionDate: string;
  indictments: number;
  sophisticationScore: number; // 0-100
}

export interface SectorRisk {
  sector: TargetSector;
  attackFrequency: number; // operations per year
  avgValueStolen: number;
  primaryActors: ActorCountry[];
  riskScore: number; // 0-100
}

const MOCK_OPS: EspionageOperation[] = [
  { id: 'apt10-managed', actor: 'China', targetCountry: 'USA', targetSector: 'semiconductor', vector: 'cyber-intrusion', estimatedValueUSD: 500_000_000, detectionDate: '2026-03-01', indictments: 2, sophisticationScore: 92 },
  { id: 'huawei-recruit', actor: 'China', targetCountry: 'USA', targetSector: 'telecom', vector: 'recruitment', estimatedValueUSD: 200_000_000, detectionDate: '2026-02-15', indictments: 0, sophisticationScore: 78 },
  { id: 'cozy-bear-pharma', actor: 'Russia', targetCountry: 'UK', targetSector: 'pharma', vector: 'cyber-intrusion', estimatedValueUSD: 120_000_000, detectionDate: '2026-04-10', indictments: 0, sophisticationScore: 85 },
  { id: 'cn-academic', actor: 'China', targetCountry: 'USA', targetSector: 'ai-ml', vector: 'academic-infiltration', estimatedValueUSD: 300_000_000, detectionDate: '2026-05-01', indictments: 3, sophisticationScore: 70 },
  { id: 'iran-energy', actor: 'Iran', targetCountry: 'USA', targetSector: 'energy', vector: 'cyber-intrusion', estimatedValueUSD: 80_000_000, detectionDate: '2026-01-20', indictments: 1, sophisticationScore: 65 },
  { id: 'dprk-crypto', actor: 'North Korea', targetCountry: 'South Korea', targetSector: 'finance', vector: 'cyber-intrusion', estimatedValueUSD: 1_500_000_000, detectionDate: '2026-04-25', indictments: 0, sophisticationScore: 88 },
  { id: 'cn-aerospace', actor: 'China', targetCountry: 'USA', targetSector: 'aerospace', vector: 'insider-threat', estimatedValueUSD: 400_000_000, detectionDate: '2026-03-22', indictments: 4, sophisticationScore: 75 },
  { id: 'ru-supply', actor: 'Russia', targetCountry: 'Germany', targetSector: 'defense', vector: 'supply-chain-compromise', estimatedValueUSD: 250_000_000, detectionDate: '2026-05-12', indictments: 0, sophisticationScore: 80 },
];

const MOCK_SECTOR_RISKS: SectorRisk[] = [
  { sector: 'semiconductor', attackFrequency: 45, avgValueStolen: 350_000_000, primaryActors: ['China'], riskScore: 95 },
  { sector: 'ai-ml', attackFrequency: 38, avgValueStolen: 280_000_000, primaryActors: ['China', 'Russia'], riskScore: 90 },
  { sector: 'aerospace', attackFrequency: 32, avgValueStolen: 420_000_000, primaryActors: ['China', 'Russia'], riskScore: 88 },
  { sector: 'finance', attackFrequency: 28, avgValueStolen: 800_000_000, primaryActors: ['North Korea'], riskScore: 85 },
  { sector: 'defense', attackFrequency: 40, avgValueStolen: 300_000_000, primaryActors: ['China', 'Russia', 'Iran'], riskScore: 92 },
  { sector: 'pharma', attackFrequency: 22, avgValueStolen: 150_000_000, primaryActors: ['China', 'Russia'], riskScore: 75 },
  { sector: 'energy', attackFrequency: 18, avgValueStolen: 90_000_000, primaryActors: ['Russia', 'Iran'], riskScore: 70 },
  { sector: 'telecom', attackFrequency: 25, avgValueStolen: 180_000_000, primaryActors: ['China'], riskScore: 78 },
];

export function scoreOperationImpact(op: EspionageOperation): number {
  const valueFactor = Math.min(50, op.estimatedValueUSD / 30_000_000);
  return Math.min(100, Math.round(op.sophisticationScore * 0.5 + valueFactor * 0.5));
}

export function getTopActorByValue(ops: EspionageOperation[]): ActorCountry {
  const totals: Record<ActorCountry, number> = { China: 0, Russia: 0, Iran: 0, 'North Korea': 0 };
  for (const op of ops) totals[op.actor] += op.estimatedValueUSD;
  return (Object.entries(totals).sort(([,a],[,b]) => b-a)[0]![0]!) as ActorCountry;
}

export function filterByActor(ops: EspionageOperation[], actor: ActorCountry): EspionageOperation[] {
  return ops.filter(o => o.actor === actor);
}

export function filterBySector(ops: EspionageOperation[], sector: TargetSector): EspionageOperation[] {
  return ops.filter(o => o.targetSector === sector);
}

export function computeTotalValueStolen(ops: EspionageOperation[]): number {
  return ops.reduce((s, o) => s + o.estimatedValueUSD, 0);
}

export function rankSectorsByRisk(sectors: SectorRisk[]): SectorRisk[] {
  return [...sectors].sort((a, b) => b.riskScore - a.riskScore);
}

export function getVectorDistribution(ops: EspionageOperation[]): Record<EspionageVector, number> {
  const dist: Record<EspionageVector, number> = { 'cyber-intrusion': 0, 'insider-threat': 0, 'academic-infiltration': 0, 'supply-chain-compromise': 0, 'recruitment': 0, 'front-company': 0 };
  for (const op of ops) dist[op.vector]++;
  return dist;
}

export function buildRenderData(): {
  topSectors: SectorRisk[];
  recentOps: EspionageOperation[];
  totalValueStolen: number;
  topActor: ActorCountry;
  vectorDistribution: Record<EspionageVector, number>;
} {
  return {
    topSectors: rankSectorsByRisk(MOCK_SECTOR_RISKS),
    recentOps: [...MOCK_OPS].sort((a,b) => b.detectionDate.localeCompare(a.detectionDate)).slice(0,6),
    totalValueStolen: computeTotalValueStolen(MOCK_OPS),
    topActor: getTopActorByValue(MOCK_OPS),
    vectorDistribution: getVectorDistribution(MOCK_OPS),
  };
}
