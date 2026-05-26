/**
 * Pure helpers for ArcticMonitoringPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type IceTrend = 'declining' | 'stable' | 'recovering';
export type RouteStatus = 'open' | 'seasonal' | 'closed';
export type LegalStatus = 'ICJ' | 'UNCLOS' | 'bilateral' | 'unresolved';
export type TensionLevel = 'low' | 'medium' | 'high' | 'critical';
export type ActivityTrend = 'increasing' | 'stable' | 'decreasing';
export type ResourceType = 'oil/gas' | 'minerals' | 'fishing' | 'wind';
export type DevStatus = 'exploration' | 'development' | 'operational' | 'suspended';
export type EnvConcern = 'low' | 'medium' | 'high' | 'extreme';

export interface IceEnvironment {
  parameter: string;
  currentValue: string;
  deviation: string;
  trend: IceTrend;
  anomalyScore: number;
}

export interface ShippingRoute {
  name: string;
  status: RouteStatus;
  transitCountYTD: number;
  avgTransitDays: number;
  iceConditions: string;
}

export interface TerritorialClaim {
  area: string;
  claimants: string;
  legalStatus: LegalStatus;
  tensionLevel: TensionLevel;
  areaKm2: number;
}

export interface MilitaryPosture {
  country: string;
  recentActivity: string;
  basingActivity: string;
  trend: ActivityTrend;
}

export interface ResourceProject {
  project: string;
  resourceType: ResourceType;
  countries: string;
  devStatus: DevStatus;
  envConcern: EnvConcern;
}

// ── Ice / environment helpers ─────────────────────────────────────────────

export function iceTrendColor(t: IceTrend): string {
  const colors: Record<IceTrend, string> = {
    declining:  'var(--severity-critical, #ef4444)',
    stable:     'var(--severity-medium,   #facc15)',
    recovering: 'var(--severity-low,      #4caf50)',
  };
  return colors[t];
}

export function iceTrendLabel(t: IceTrend): string {
  const labels: Record<IceTrend, string> = {
    declining:  'Declining',
    stable:     'Stable',
    recovering: 'Recovering',
  };
  return labels[t];
}

export function anomalyColor(score: number): string {
  if (score >= 3)  return 'var(--severity-critical, #ef4444)';
  if (score >= 2)  return 'var(--severity-high,     #fb923c)';
  if (score >= 1)  return 'var(--severity-medium,   #facc15)';
  return 'var(--severity-low,      #4caf50)';
}

// ── Shipping route helpers ────────────────────────────────────────────────

export function routeStatusColor(s: RouteStatus): string {
  const colors: Record<RouteStatus, string> = {
    open:     'var(--severity-low,      #4caf50)',
    seasonal: 'var(--severity-medium,   #facc15)',
    closed:   'var(--severity-none,     #9e9e9e)',
  };
  return colors[s];
}

export function routeStatusLabel(s: RouteStatus): string {
  const labels: Record<RouteStatus, string> = {
    open:     'Open',
    seasonal: 'Seasonal',
    closed:   'Closed',
  };
  return labels[s];
}

// ── Territorial claim helpers ─────────────────────────────────────────────

export function legalStatusLabel(s: LegalStatus): string {
  const labels: Record<LegalStatus, string> = {
    ICJ:        'ICJ',
    UNCLOS:     'UNCLOS',
    bilateral:  'Bilateral',
    unresolved: 'Unresolved',
  };
  return labels[s];
}

export function tensionColor(t: TensionLevel): string {
  const colors: Record<TensionLevel, string> = {
    low:      'var(--severity-low,      #4caf50)',
    medium:   'var(--severity-medium,   #facc15)',
    high:     'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[t];
}

export function tensionLabel(t: TensionLevel): string {
  const labels: Record<TensionLevel, string> = {
    low:      'Low',
    medium:   'Medium',
    high:     'High',
    critical: 'Critical',
  };
  return labels[t];
}

// ── Military posture helpers ──────────────────────────────────────────────

export function activityTrendColor(t: ActivityTrend): string {
  const colors: Record<ActivityTrend, string> = {
    increasing:  'var(--severity-high,     #fb923c)',
    stable:      'var(--severity-medium,   #facc15)',
    decreasing:  'var(--severity-low,      #4caf50)',
  };
  return colors[t];
}

export function activityTrendLabel(t: ActivityTrend): string {
  const labels: Record<ActivityTrend, string> = {
    increasing:  'Increasing',
    stable:      'Stable',
    decreasing:  'Decreasing',
  };
  return labels[t];
}

// ── Resource competition helpers ──────────────────────────────────────────

export function resourceTypeLabel(r: ResourceType): string {
  const labels: Record<ResourceType, string> = {
    'oil/gas':  'Oil / Gas',
    minerals:   'Minerals',
    fishing:    'Fishing',
    wind:       'Wind Energy',
  };
  return labels[r];
}

export function devStatusColor(s: DevStatus): string {
  const colors: Record<DevStatus, string> = {
    exploration:  'var(--severity-low,      #4caf50)',
    development:  'var(--severity-medium,   #facc15)',
    operational:  'var(--severity-high,     #fb923c)',
    suspended:    'var(--severity-none,     #9e9e9e)',
  };
  return colors[s];
}

export function devStatusLabel(s: DevStatus): string {
  const labels: Record<DevStatus, string> = {
    exploration:  'Exploration',
    development:  'Development',
    operational:  'Operational',
    suspended:    'Suspended',
  };
  return labels[s];
}

export function envConcernColor(c: EnvConcern): string {
  const colors: Record<EnvConcern, string> = {
    low:     'var(--severity-low,      #4caf50)',
    medium:  'var(--severity-medium,   #facc15)',
    high:    'var(--severity-high,     #fb923c)',
    extreme: 'var(--severity-critical, #ef4444)',
  };
  return colors[c];
}

export function envConcernLabel(c: EnvConcern): string {
  const labels: Record<EnvConcern, string> = {
    low:     'Low',
    medium:  'Medium',
    high:    'High',
    extreme: 'Extreme',
  };
  return labels[c];
}

// ── Count helpers ─────────────────────────────────────────────────────────

export function countHighTensionClaims(claims: TerritorialClaim[]): number {
  return claims.filter((c) => c.tensionLevel === 'high' || c.tensionLevel === 'critical').length;
}

export function countIncreasingMilitary(postures: MilitaryPosture[]): number {
  return postures.filter((p) => p.trend === 'increasing').length;
}

export function countOpenRoutes(routes: ShippingRoute[]): number {
  return routes.filter((r) => r.status === 'open' || r.status === 'seasonal').length;
}

// ── Static data ───────────────────────────────────────────────────────────

export const ICE_ENVIRONMENT: IceEnvironment[] = [
  {
    parameter:    'Arctic Sea Ice Extent',
    currentValue: '11.2M km²',
    deviation:    '−1.8M km² vs 1981–2010',
    trend:        'declining',
    anomalyScore: 3,
  },
  {
    parameter:    'Arctic Surface Temperature Anomaly',
    currentValue: '+3.4°C',
    deviation:    '+3.4°C above baseline',
    trend:        'declining',
    anomalyScore: 3,
  },
  {
    parameter:    'Permafrost Stability Index',
    currentValue: '0.58 / 1.0',
    deviation:    '−0.14 vs 2000 baseline',
    trend:        'declining',
    anomalyScore: 2,
  },
  {
    parameter:    'Greenland Ice Mass',
    currentValue: '−280 Gt/yr',
    deviation:    '−95 Gt/yr vs 1992–2001',
    trend:        'declining',
    anomalyScore: 2,
  },
];

export const SHIPPING_ROUTES: ShippingRoute[] = [
  {
    name:             'Northern Sea Route (NSR)',
    status:           'seasonal',
    transitCountYTD:  47,
    avgTransitDays:   21,
    iceConditions:    'Class 2–3 ice; icebreaker escort required Aug–Oct',
  },
  {
    name:             'Northwest Passage (NWP)',
    status:           'seasonal',
    transitCountYTD:  8,
    avgTransitDays:   28,
    iceConditions:    'Variable; multi-year ice persists in M\'Clure Strait',
  },
  {
    name:             'Transpolar Route',
    status:           'closed',
    transitCountYTD:  0,
    avgTransitDays:   0,
    iceConditions:    'Perennial ice; commercially unnavigable without nuclear icebreaker',
  },
];

export const TERRITORIAL_CLAIMS: TerritorialClaim[] = [
  {
    area:         'Lomonosov Ridge',
    claimants:    'Russia / Denmark / Canada',
    legalStatus:  'UNCLOS',
    tensionLevel: 'high',
    areaKm2:      1_200_000,
  },
  {
    area:         'Hans Island',
    claimants:    'Canada / Denmark',
    legalStatus:  'bilateral',
    tensionLevel: 'low',
    areaKm2:       1,
  },
  {
    area:         'Svalbard EEZ',
    claimants:    'Norway / Russia',
    legalStatus:  'bilateral',
    tensionLevel: 'medium',
    areaKm2:      800_000,
  },
  {
    area:         'Northwest Passage Waters',
    claimants:    'Canada / USA',
    legalStatus:  'unresolved',
    tensionLevel: 'medium',
    areaKm2:      470_000,
  },
  {
    area:         'Beaufort Sea Boundary',
    claimants:    'Canada / USA',
    legalStatus:  'unresolved',
    tensionLevel: 'low',
    areaKm2:       21_000,
  },
];

export const MILITARY_POSTURE: MilitaryPosture[] = [
  {
    country:        'Russia',
    recentActivity: 'Northern Fleet exercise; Tu-160 bomber patrols resumed',
    basingActivity: 'Renovated 14 Arctic bases; new S-400 deployments on Kotelny Island',
    trend:          'increasing',
  },
  {
    country:        'USA',
    recentActivity: 'ICEX submarine exercise under Arctic ice; F-35 forward deployment to Eielson AFB',
    basingActivity: 'Thule (Pituffik) upgrades; NORAD modernization',
    trend:          'increasing',
  },
  {
    country:        'Norway',
    recentActivity: 'Cold Response 2024: 20,000-troop NATO exercise',
    basingActivity: 'Expanded Evenes naval base; P-8A Poseidon acquisitions',
    trend:          'increasing',
  },
  {
    country:        'Canada',
    recentActivity: 'Operation NANOOK; Arctic Offshore Patrol Ship deployments',
    basingActivity: 'Nanisivik Naval Facility expansion underway',
    trend:          'stable',
  },
  {
    country:        'China',
    recentActivity: 'Xuelong 2 research voyages; "Near-Arctic State" scientific claim',
    basingActivity: 'No Arctic bases; satellite ground stations in Svalbard (Iceland)',
    trend:          'increasing',
  },
];

export const RESOURCE_PROJECTS: ResourceProject[] = [
  {
    project:      'Yamal LNG / Arctic LNG 2',
    resourceType: 'oil/gas',
    countries:    'Russia',
    devStatus:    'operational',
    envConcern:   'high',
  },
  {
    project:      'Voisey\'s Bay Nickel–Cobalt',
    resourceType: 'minerals',
    countries:    'Canada',
    devStatus:    'operational',
    envConcern:   'medium',
  },
  {
    project:      'Prirazlomnoye Oil Platform',
    resourceType: 'oil/gas',
    countries:    'Russia',
    devStatus:    'operational',
    envConcern:   'extreme',
  },
  {
    project:      'Arctic Fishing Moratorium Zone',
    resourceType: 'fishing',
    countries:    'US / Canada / Russia / Norway / Denmark / EU / China / Japan / Iceland / South Korea',
    devStatus:    'suspended',
    envConcern:   'high',
  },
  {
    project:      'Baffinland Iron Mine',
    resourceType: 'minerals',
    countries:    'Canada',
    devStatus:    'development',
    envConcern:   'high',
  },
  {
    project:      'Nomedalsvann Wind Farm (Svalbard)',
    resourceType: 'wind',
    countries:    'Norway',
    devStatus:    'exploration',
    envConcern:   'medium',
  },
];
