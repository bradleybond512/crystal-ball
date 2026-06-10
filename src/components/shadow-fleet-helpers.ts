// shadow-fleet-helpers.ts — pure deterministic helpers (no DOM, no fetch, no globals)
//
// The "shadow fleet" (a.k.a. "dark fleet" / "ghost fleet") is a loose collection
// of ~600 aging tankers and bulk carriers used to move oil and refined products
// out of sanctioned states — Russia, Iran, Venezuela, North Korea, and others.
// Operators rely on AIS spoofing, flags of convenience, ship-to-ship transfers,
// and opaque ownership chains to evade the G7 oil price cap and OFAC designations.

export type VesselType = 'tanker' | 'bulk-carrier' | 'container' | 'lng';
export type SanctionTarget = 'russia' | 'iran' | 'venezuela' | 'north-korea' | 'multiple' | 'unknown';
export type AisStatus = 'spoofing' | 'dark' | 'intermittent' | 'active';
export type RiskLevel = 'critical' | 'high' | 'medium';

export interface ShadowVessel {
  id: string;
  name: string;
  vesselType: VesselType;
  flagState: string; // country of registration
  estimatedOwner: string; // operator/beneficial owner if known
  sanctionTarget: SanctionTarget;
  aisStatus: AisStatus;
  lastKnownPort: string;
  estimatedCargoType: string;
  riskLevel: RiskLevel;
  yearAdded: number; // year vessel joined dark fleet
  detectionEvents: number; // times detected violating sanctions
  notes: string;
}

export interface ShadowFleetStat {
  sanctionTarget: string;
  estimatedVessels: number;
  estimatedBpdCapacity: number; // barrels per day
  primaryFlagStates: string[];
  keyTransshipmentZones: string[];
}

export interface ShadowFleetData {
  vessels: ShadowVessel[];
  stats: ShadowFleetStat[];
  lastUpdated: string;
  totalEstimatedFleetSize: number;
  globalEvasionRiskIndex: number; // 0-100
}

export const SHADOW_VESSELS: ShadowVessel[] = [
  {
    id: 'pablo',
    name: 'Pablo',
    vesselType: 'tanker',
    flagState: 'Gabon',
    estimatedOwner: 'Unknown Russian entity',
    sanctionTarget: 'russia',
    aisStatus: 'dark',
    lastKnownPort: 'Primorsk, Russia',
    estimatedCargoType: 'Crude oil (Urals blend)',
    riskLevel: 'critical',
    yearAdded: 2022,
    detectionEvents: 8,
    notes: 'Frequently goes dark in Baltic; suspected ship-to-ship transfers near Danish straits',
  },
  {
    id: 'ns-century',
    name: 'NS Century',
    vesselType: 'tanker',
    flagState: 'Cameroon',
    estimatedOwner: 'Sovcomflot subsidiary',
    sanctionTarget: 'russia',
    aisStatus: 'spoofing',
    lastKnownPort: 'Ust-Luga, Russia',
    estimatedCargoType: 'Crude oil',
    riskLevel: 'critical',
    yearAdded: 2022,
    detectionEvents: 12,
    notes: 'Multiple AIS manipulation events detected by Windward/MarineTraffic',
  },
  {
    id: 'lana',
    name: 'Lana',
    vesselType: 'tanker',
    flagState: 'Marshall Islands',
    estimatedOwner: 'NITC front company',
    sanctionTarget: 'iran',
    aisStatus: 'dark',
    lastKnownPort: 'Kharg Island, Iran',
    estimatedCargoType: 'Iranian crude',
    riskLevel: 'critical',
    yearAdded: 2019,
    detectionEvents: 15,
    notes: 'Seized briefly near Greece 2022; core Iran fleet vessel',
  },
  {
    id: 'happiness-i',
    name: 'Happiness I',
    vesselType: 'tanker',
    flagState: 'Panama',
    estimatedOwner: 'Frontline shell corp',
    sanctionTarget: 'iran',
    aisStatus: 'intermittent',
    lastKnownPort: 'Port Said, Egypt',
    estimatedCargoType: 'Iranian condensate',
    riskLevel: 'high',
    yearAdded: 2020,
    detectionEvents: 6,
    notes: 'Involved in STS transfers off Malaysia',
  },
  {
    id: 'endeavour',
    name: 'Endeavour',
    vesselType: 'tanker',
    flagState: 'Palau',
    estimatedOwner: 'Unknown',
    sanctionTarget: 'venezuela',
    aisStatus: 'dark',
    lastKnownPort: 'Jose Terminal, Venezuela',
    estimatedCargoType: 'Venezuelan crude (Merey)',
    riskLevel: 'high',
    yearAdded: 2020,
    detectionEvents: 4,
    notes: 'Part of PDVSA shadow fleet; Palau flag of convenience',
  },
  {
    id: 'new-prosperity',
    name: 'New Prosperity',
    vesselType: 'tanker',
    flagState: 'Cook Islands',
    estimatedOwner: 'Unknown Chinese entity',
    sanctionTarget: 'north-korea',
    aisStatus: 'spoofing',
    lastKnownPort: 'Unknown — last seen Yellow Sea',
    estimatedCargoType: 'Petroleum products',
    riskLevel: 'critical',
    yearAdded: 2018,
    detectionEvents: 9,
    notes: 'UN Panel of Experts flagged; suspected DPRK fuel deliveries',
  },
  {
    id: 'gulf-stallion',
    name: 'Gulf Stallion',
    vesselType: 'tanker',
    flagState: 'Tuvalu',
    estimatedOwner: 'Arabian front company',
    sanctionTarget: 'iran',
    aisStatus: 'intermittent',
    lastKnownPort: 'Fujairah, UAE',
    estimatedCargoType: 'Iranian crude blended',
    riskLevel: 'high',
    yearAdded: 2021,
    detectionEvents: 5,
    notes: 'Blending operations suspected at Fujairah STS zone',
  },
  {
    id: 'sun-ship',
    name: 'Sun Ship',
    vesselType: 'tanker',
    flagState: 'St Kitts and Nevis',
    estimatedOwner: 'Sovcomflot linked',
    sanctionTarget: 'russia',
    aisStatus: 'dark',
    lastKnownPort: 'Novorossiysk, Russia',
    estimatedCargoType: 'Black Sea crude',
    riskLevel: 'high',
    yearAdded: 2022,
    detectionEvents: 7,
    notes: 'Part of LUKOIL bypass chain through Turkish straits',
  },
  {
    id: 'arctic-navigator',
    name: 'Arctic Navigator',
    vesselType: 'lng',
    flagState: 'Liberia',
    estimatedOwner: 'Arctic LNG 2 entity',
    sanctionTarget: 'russia',
    aisStatus: 'intermittent',
    lastKnownPort: 'Sabetta, Russia',
    estimatedCargoType: 'LNG (Yamal Peninsula)',
    riskLevel: 'high',
    yearAdded: 2023,
    detectionEvents: 3,
    notes: 'Arctic LNG 2 evasion; STS transfers in Murman fjord area',
  },
  {
    id: 'ocean-prima',
    name: 'Ocean Prima',
    vesselType: 'tanker',
    flagState: 'Cameroon',
    estimatedOwner: 'Unknown',
    sanctionTarget: 'multiple',
    aisStatus: 'spoofing',
    lastKnownPort: 'Unknown — AIS last: Strait of Malacca',
    estimatedCargoType: 'Mixed crude blend',
    riskLevel: 'high',
    yearAdded: 2022,
    detectionEvents: 10,
    notes: 'Flagged by OFAC watch list; services multiple sanctioned sources',
  },
  {
    id: 'kpz-tanker',
    name: 'KPZ Tanker',
    vesselType: 'tanker',
    flagState: 'Mongolia',
    estimatedOwner: 'KTZE (Kazakhstan transit entity)',
    sanctionTarget: 'russia',
    aisStatus: 'active',
    lastKnownPort: 'Aktau, Kazakhstan',
    estimatedCargoType: 'Caspian crude blend',
    riskLevel: 'medium',
    yearAdded: 2023,
    detectionEvents: 2,
    notes: 'Part of Kazakhstan-based bypass route; still being investigated',
  },
  {
    id: 'pioneer',
    name: 'Pioneer',
    vesselType: 'tanker',
    flagState: 'Gabon',
    estimatedOwner: 'Unknown Russian entity',
    sanctionTarget: 'russia',
    aisStatus: 'dark',
    lastKnownPort: 'Primorsk, Russia',
    estimatedCargoType: 'Urals crude',
    riskLevel: 'critical',
    yearAdded: 2022,
    detectionEvents: 11,
    notes: 'Runs Baltic route frequently; dark for long stretches',
  },
];

export const SHADOW_FLEET_STATS: ShadowFleetStat[] = [
  {
    sanctionTarget: 'Russia',
    estimatedVessels: 250,
    estimatedBpdCapacity: 3_200_000,
    primaryFlagStates: ['Gabon', 'Cameroon', 'Palau', 'Tuvalu', 'Liberia'],
    keyTransshipmentZones: ['Danish Straits', 'Gibraltar', 'Turkish Straits', 'Cape of Good Hope'],
  },
  {
    sanctionTarget: 'Iran',
    estimatedVessels: 120,
    estimatedBpdCapacity: 1_500_000,
    primaryFlagStates: ['Marshall Islands', 'Panama', 'Cook Islands', 'Tuvalu'],
    keyTransshipmentZones: ['Strait of Hormuz', 'Fujairah STS zone', 'Straits of Malacca', 'South China Sea'],
  },
  {
    sanctionTarget: 'Venezuela',
    estimatedVessels: 50,
    estimatedBpdCapacity: 600_000,
    primaryFlagStates: ['Panama', 'Palau', 'Marshall Islands', 'St Kitts'],
    keyTransshipmentZones: ['Caribbean transshipment', 'West Africa STS', 'Gulf of Mexico approaches'],
  },
  {
    sanctionTarget: 'North Korea',
    estimatedVessels: 35,
    estimatedBpdCapacity: 150_000,
    primaryFlagStates: ['Cook Islands', 'Mongolia', 'Palau', 'Tonga'],
    keyTransshipmentZones: ['Yellow Sea', 'East China Sea', 'Southeast Asian hub ports'],
  },
  {
    sanctionTarget: 'Multiple',
    estimatedVessels: 80,
    estimatedBpdCapacity: 800_000,
    primaryFlagStates: ['Liberia', 'Cameroon', 'Gabon', 'St Kitts'],
    keyTransshipmentZones: ['Strait of Malacca', 'Indian Ocean STS zones', 'Red Sea approacheses'],
  },
];

export function getBySanctionTarget(vessels: ShadowVessel[], target: SanctionTarget): ShadowVessel[] {
  return vessels.filter(v => v.sanctionTarget === target);
}

export function getByRiskLevel(vessels: ShadowVessel[], riskLevel: RiskLevel): ShadowVessel[] {
  return vessels.filter(v => v.riskLevel === riskLevel);
}

export function getDarkOrSpoofing(vessels: ShadowVessel[]): ShadowVessel[] {
  return vessels.filter(v => v.aisStatus === 'dark' || v.aisStatus === 'spoofing');
}

export function getByFlagState(vessels: ShadowVessel[], flagState: string): ShadowVessel[] {
  return vessels.filter(v => v.flagState === flagState);
}

// Weighted composite (0-100) over three independent evasion signals:
//   1. Fleet scale       — how many hulls are operating outside the lawful market
//   2. Detection density — average sanction-violation detections per known vessel
//   3. Risk severity     — share of vessels at critical/high risk, weighted
// Each component is normalized to 0-100 and combined with fixed weights so the
// index is fully deterministic and reproducible from static inputs.
export function computeGlobalEvasionRiskIndex(vessels: ShadowVessel[], stats: ShadowFleetStat[]): number {
  if (vessels.length === 0 && stats.length === 0) return 0;

  const fleetSize = stats.reduce((s, st) => s + st.estimatedVessels, 0);
  // Reference fleet of ~600 hulls maps to a saturated scale component.
  const fleetComponent = Math.min(100, (fleetSize / 600) * 100);

  const totalDetections = vessels.reduce((s, v) => s + v.detectionEvents, 0);
  const avgDetections = vessels.length > 0 ? totalDetections / vessels.length : 0;
  // 15+ detections on a single vessel is treated as a saturated signal.
  const detectionComponent = Math.min(100, (avgDetections / 15) * 100);

  const riskWeight: Record<RiskLevel, number> = { critical: 1, high: 0.6, medium: 0.3 };
  const riskScore = vessels.reduce((s, v) => s + riskWeight[v.riskLevel], 0);
  const riskComponent = vessels.length > 0 ? Math.min(100, (riskScore / vessels.length) * 100) : 0;

  const composite = fleetComponent * 0.4 + detectionComponent * 0.3 + riskComponent * 0.3;
  return Math.max(0, Math.min(100, Math.round(composite)));
}

export function riskLevelClass(level: RiskLevel): string {
  return `sf-risk-${level}`;
}

export function aisStatusClass(status: AisStatus): string {
  return `sf-ais-${status}`;
}

export function buildRenderData(): ShadowFleetData {
  const totalEstimatedFleetSize = SHADOW_FLEET_STATS.reduce((s, st) => s + st.estimatedVessels, 0);
  return {
    vessels: SHADOW_VESSELS,
    stats: SHADOW_FLEET_STATS,
    lastUpdated: '2026-06-10',
    totalEstimatedFleetSize,
    globalEvasionRiskIndex: computeGlobalEvasionRiskIndex(SHADOW_VESSELS, SHADOW_FLEET_STATS),
  };
}
