// migration-crisis-helpers.ts — pure deterministic helpers

export type MigrantType = 'refugee' | 'asylum-seeker' | 'economic' | 'climate-displaced' | 'stateless';
export type CapacityStrain = 'critical' | 'high' | 'medium' | 'low';
export type PushFactor = 'conflict' | 'climate' | 'economic' | 'persecution' | 'natural-disaster';

export interface MigrationRoute {
  id: string;
  origin: string;
  destination: string;
  monthlyFlow: number; // persons/month
  primaryPushFactor: PushFactor;
  routeRiskLevel: number; // 0-100
}

export interface DisplacementEvent {
  region: string;
  displacedCount: number;
  pushFactor: PushFactor;
  date: string;
  trend: 'increasing' | 'stable' | 'decreasing';
}

export interface HostCapacityData {
  country: string;
  currentArrivals: number; // per month
  maxCapacity: number;
  strainIndex: number; // 0-100
}

const MOCK_ROUTES: MigrationRoute[] = [
  { id: 'central-med', origin: 'Libya/Tunisia', destination: 'Italy/Malta', monthlyFlow: 8500, primaryPushFactor: 'conflict', routeRiskLevel: 88 },
  { id: 'western-balkans', origin: 'Turkey/Greece', destination: 'Western Europe', monthlyFlow: 12_000, primaryPushFactor: 'persecution', routeRiskLevel: 55 },
  { id: 'us-southern-border', origin: 'Central America/Venezuela', destination: 'USA', monthlyFlow: 180_000, primaryPushFactor: 'economic', routeRiskLevel: 45 },
  { id: 'rohingya-bay', origin: 'Myanmar', destination: 'Bangladesh/Malaysia', monthlyFlow: 3200, primaryPushFactor: 'persecution', routeRiskLevel: 82 },
  { id: 'sahel-north', origin: 'Mali/Niger/Chad', destination: 'Libya/Algeria', monthlyFlow: 7000, primaryPushFactor: 'conflict', routeRiskLevel: 78 },
  { id: 'afghan-pakistan', origin: 'Afghanistan', destination: 'Pakistan/Iran', monthlyFlow: 25_000, primaryPushFactor: 'conflict', routeRiskLevel: 60 },
  { id: 'venezuela-colombia', origin: 'Venezuela', destination: 'Colombia/Peru/Chile', monthlyFlow: 45_000, primaryPushFactor: 'economic', routeRiskLevel: 40 },
  { id: 'ukraine-europe', origin: 'Ukraine', destination: 'Poland/Germany/EU', monthlyFlow: 28_000, primaryPushFactor: 'conflict', routeRiskLevel: 30 },
];

const MOCK_EVENTS: DisplacementEvent[] = [
  { region: 'Sudan', displacedCount: 8_700_000, pushFactor: 'conflict', date: '2026-05-20', trend: 'increasing' },
  { region: 'Ukraine', displacedCount: 6_200_000, pushFactor: 'conflict', date: '2026-05-15', trend: 'stable' },
  { region: 'Afghanistan', displacedCount: 5_800_000, pushFactor: 'conflict', date: '2026-05-10', trend: 'stable' },
  { region: 'Myanmar', displacedCount: 2_100_000, pushFactor: 'persecution', date: '2026-05-18', trend: 'increasing' },
  { region: 'Somalia', displacedCount: 3_400_000, pushFactor: 'conflict', date: '2026-05-12', trend: 'decreasing' },
  { region: 'DRC', displacedCount: 6_900_000, pushFactor: 'conflict', date: '2026-05-22', trend: 'increasing' },
  { region: 'Venezuela', displacedCount: 7_700_000, pushFactor: 'economic', date: '2026-05-08', trend: 'stable' },
  { region: 'Sahel', displacedCount: 4_200_000, pushFactor: 'conflict', date: '2026-05-25', trend: 'increasing' },
];

export function scoreDisplacementRisk(event: DisplacementEvent): number {
  let trendBonus: number;
  if (event.trend === 'increasing') {
    trendBonus = 15;
  } else if (event.trend === 'decreasing') {
    trendBonus = -10;
  } else {
    trendBonus = 0;
  }
  const factorWeight: Record<PushFactor, number> = { conflict: 30, persecution: 25, climate: 20, economic: 15, 'natural-disaster': 10 };
  const base = Math.min(100, (event.displacedCount / 100_000) + factorWeight[event.pushFactor]);
  return Math.max(0, Math.min(100, Math.round(base + trendBonus)));
}

export function computeFlowVolume(routes: MigrationRoute[], timeWindowMonths: number): number {
  return routes.reduce((sum, r) => sum + r.monthlyFlow * timeWindowMonths, 0);
}

export function categorizeMigrant(primaryFactor: PushFactor): MigrantType {
  const map: Record<PushFactor, MigrantType> = {
    conflict: 'refugee',
    persecution: 'asylum-seeker',
    economic: 'economic',
    climate: 'climate-displaced',
    'natural-disaster': 'climate-displaced',
  };
  return map[primaryFactor];
}

export function assessHostCapacity(data: HostCapacityData): CapacityStrain {
  const utilization = data.currentArrivals / data.maxCapacity;
  if (utilization >= 0.9) return 'critical';
  if (utilization >= 0.7) return 'high';
  if (utilization >= 0.4) return 'medium';
  return 'low';
}

export function detectCrisisHotspots(routes: MigrationRoute[], baselineMultiplier = 2): MigrationRoute[] {
  const avgFlow = routes.reduce((s, r) => s + r.monthlyFlow, 0) / routes.length;
  return routes.filter(r => r.monthlyFlow > avgFlow * baselineMultiplier);
}

export function estimatePushFactors(events: DisplacementEvent[]): Record<PushFactor, number> {
  const totals: Record<PushFactor, number> = { conflict: 0, climate: 0, economic: 0, persecution: 0, 'natural-disaster': 0 };
  for (const e of events) totals[e.pushFactor] += e.displacedCount;
  return totals;
}

export function rankRoutesByRisk(routes: MigrationRoute[]): MigrationRoute[] {
  return [...routes].sort((a, b) => b.routeRiskLevel - a.routeRiskLevel);
}

export function rankEventsByScale(events: DisplacementEvent[]): DisplacementEvent[] {
  return [...events].sort((a, b) => b.displacedCount - a.displacedCount);
}

export function buildRenderData(): {
  routes: MigrationRoute[];
  events: DisplacementEvent[];
  totalDisplaced: number;
  hotspots: MigrationRoute[];
  pushFactorTotals: Record<PushFactor, number>;
} {
  return {
    routes: rankRoutesByRisk(MOCK_ROUTES),
    events: rankEventsByScale(MOCK_EVENTS),
    totalDisplaced: MOCK_EVENTS.reduce((s, e) => s + e.displacedCount, 0),
    hotspots: detectCrisisHotspots(MOCK_ROUTES),
    pushFactorTotals: estimatePushFactors(MOCK_EVENTS),
  };
}
