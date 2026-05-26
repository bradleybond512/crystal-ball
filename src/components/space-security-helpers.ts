/**
 * Pure helpers for SpaceSecurityPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type AsatEventType = 'direct-ascent' | 'co-orbital' | 'cyber' | 'jamming' | 'debris-event';
export type ThreatLevel = 'low' | 'medium' | 'high' | 'critical';
export type ConstellationHealth = 'nominal' | 'degraded' | 'impaired' | 'critical';
export type FlareClass = 'A' | 'B' | 'C' | 'M' | 'X';
export type PayloadType = 'military' | 'dual-use' | 'civilian' | 'classified';
export type OrbitRegime = 'LEO' | 'MEO' | 'GEO' | 'HEO' | 'Cislunar';
export type OrbitalRisk = 0 | 1 | 2 | 3 | 4;

export interface AsatThreat {
  actor: string;
  eventType: AsatEventType;
  altitudeKm: number;
  debrisCount: number;
  threatLevel: ThreatLevel;
  description: string;
}

export interface ConstellationStatus {
  name: string;
  operator: string;
  activeSats: number;
  degradedCount: number;
  anomaly: string;
  health: ConstellationHealth;
}

export interface SpaceWeatherEvent {
  parameter: string;
  currentValue: string;
  flareClass?: FlareClass;
  affectedSystems: string;
  forecast: string;
}

export interface LaunchActivity {
  nation: string;
  payloadType: PayloadType;
  orbit: OrbitRegime;
  notableAspect: string;
}

export interface OrbitalDomain {
  regime: OrbitRegime;
  risk: OrbitalRisk;
}

// ── ASAT / orbital threat helpers ─────────────────────────────────────────

export function asatEventTypeLabel(t: AsatEventType): string {
  const labels: Record<AsatEventType, string> = {
    'direct-ascent': 'Direct Ascent',
    'co-orbital':    'Co-orbital',
    cyber:           'Cyber',
    jamming:         'Jamming',
    'debris-event':  'Debris Event',
  };
  return labels[t];
}

export function asatEventTypeColor(t: AsatEventType): string {
  const colors: Record<AsatEventType, string> = {
    'direct-ascent': 'var(--severity-critical, #ef4444)',
    'co-orbital':    'var(--severity-critical, #ef4444)',
    cyber:           'var(--severity-high,     #fb923c)',
    jamming:         'var(--severity-medium,   #facc15)',
    'debris-event':  'var(--severity-high,     #fb923c)',
  };
  return colors[t];
}

export function threatLevelColor(t: ThreatLevel): string {
  const colors: Record<ThreatLevel, string> = {
    low:      'var(--severity-low,      #4caf50)',
    medium:   'var(--severity-medium,   #facc15)',
    high:     'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[t];
}

export function threatLevelLabel(t: ThreatLevel): string {
  const labels: Record<ThreatLevel, string> = {
    low:      'Low',
    medium:   'Medium',
    high:     'High',
    critical: 'Critical',
  };
  return labels[t];
}

// ── Constellation health helpers ──────────────────────────────────────────

export function constellationHealthColor(h: ConstellationHealth): string {
  const colors: Record<ConstellationHealth, string> = {
    nominal:  'var(--severity-low,      #4caf50)',
    degraded: 'var(--severity-medium,   #facc15)',
    impaired: 'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[h];
}

export function constellationHealthLabel(h: ConstellationHealth): string {
  const labels: Record<ConstellationHealth, string> = {
    nominal:  'Nominal',
    degraded: 'Degraded',
    impaired: 'Impaired',
    critical: 'Critical',
  };
  return labels[h];
}

// ── Space weather helpers ─────────────────────────────────────────────────

export function flareClassColor(c: FlareClass): string {
  const colors: Record<FlareClass, string> = {
    A: 'var(--severity-none,     #9e9e9e)',
    B: 'var(--severity-low,      #4caf50)',
    C: 'var(--severity-medium,   #facc15)',
    M: 'var(--severity-high,     #fb923c)',
    X: 'var(--severity-critical, #ef4444)',
  };
  return colors[c];
}

export function flareClassLabel(c: FlareClass): string {
  const labels: Record<FlareClass, string> = {
    A: 'A-class (minimal)',
    B: 'B-class (minor)',
    C: 'C-class (moderate)',
    M: 'M-class (strong)',
    X: 'X-class (extreme)',
  };
  return labels[c];
}

export function kpIndexColor(kp: number): string {
  if (kp >= 8)  return 'var(--severity-critical, #ef4444)';
  if (kp >= 6)  return 'var(--severity-high,     #fb923c)';
  if (kp >= 4)  return 'var(--severity-medium,   #facc15)';
  return 'var(--severity-low, #4caf50)';
}

// ── Launch activity helpers ───────────────────────────────────────────────

export function payloadTypeColor(p: PayloadType): string {
  const colors: Record<PayloadType, string> = {
    military:   'var(--severity-critical, #ef4444)',
    classified: 'var(--severity-high,     #fb923c)',
    'dual-use': 'var(--severity-medium,   #facc15)',
    civilian:   'var(--severity-low,      #4caf50)',
  };
  return colors[p];
}

export function payloadTypeLabel(p: PayloadType): string {
  const labels: Record<PayloadType, string> = {
    military:   'Military',
    'dual-use': 'Dual-Use',
    civilian:   'Civilian',
    classified: 'Classified',
  };
  return labels[p];
}

// ── Orbital risk helpers ──────────────────────────────────────────────────

export function orbitalRiskColor(r: OrbitalRisk): string {
  const colors: Record<OrbitalRisk, string> = {
    0: 'var(--severity-none,     #9e9e9e)',
    1: 'var(--severity-low,      #4caf50)',
    2: 'var(--severity-medium,   #facc15)',
    3: 'var(--severity-high,     #fb923c)',
    4: 'var(--severity-critical, #ef4444)',
  };
  return colors[r];
}

export function orbitalRiskLabel(r: OrbitalRisk): string {
  const labels: Record<OrbitalRisk, string> = {
    0: 'Minimal',
    1: 'Low',
    2: 'Moderate',
    3: 'High',
    4: 'Severe',
  };
  return labels[r];
}

// ── Count helpers ─────────────────────────────────────────────────────────

export function countHighThreats(threats: AsatThreat[]): number {
  return threats.filter((t) => t.threatLevel === 'high' || t.threatLevel === 'critical').length;
}

export function countDegradedConstellations(constellations: ConstellationStatus[]): number {
  return constellations.filter(
    (c) => c.health === 'degraded' || c.health === 'impaired' || c.health === 'critical',
  ).length;
}

export function countMilitaryLaunches(launches: LaunchActivity[]): number {
  return launches.filter((l) => l.payloadType === 'military' || l.payloadType === 'classified').length;
}

export function totalDebrisCount(threats: AsatThreat[]): number {
  return threats.reduce((sum, t) => sum + t.debrisCount, 0);
}

// ── Static data ───────────────────────────────────────────────────────────

export const ASAT_THREATS: AsatThreat[] = [
  {
    actor:        'Russia',
    eventType:    'direct-ascent',
    altitudeKm:   485,
    debrisCount:  1500,
    threatLevel:  'critical',
    description:  'Nudol DA-ASAT test (Nov 2021) — destroyed Kosmos 1408; debris field still active in LEO 480–850 km',
  },
  {
    actor:        'China',
    eventType:    'direct-ascent',
    altitudeKm:   865,
    debrisCount:  3000,
    threatLevel:  'critical',
    description:  'SC-19 test (Jan 2007) — destroyed FY-1C; largest single debris-creating event in history',
  },
  {
    actor:        'China',
    eventType:    'co-orbital',
    altitudeKm:   36_000,
    debrisCount:  0,
    threatLevel:  'high',
    description:  'SJ-21 tug satellite demonstrated grappling of defunct Beidou sat; GEO rendezvous-and-proximity ops',
  },
  {
    actor:        'Russia',
    eventType:    'jamming',
    altitudeKm:   0,
    debrisCount:  0,
    threatLevel:  'high',
    description:  'GPS/Galileo jamming across Eastern Europe and Eastern Mediterranean since Feb 2022',
  },
  {
    actor:        'China',
    eventType:    'cyber',
    altitudeKm:   0,
    debrisCount:  0,
    threatLevel:  'medium',
    description:  'Targeting of satellite ground stations and command links via spear-phishing (NSA/CISA advisory)',
  },
];

export const CONSTELLATION_STATUS: ConstellationStatus[] = [
  {
    name:          'Starlink',
    operator:      'SpaceX (USA)',
    activeSats:    6200,
    degradedCount: 12,
    anomaly:       'Solar storm-induced drag increase; orbital decay on ~12 sats',
    health:        'degraded',
  },
  {
    name:          'GPS (NAVSTAR)',
    operator:      'USSF (USA)',
    activeSats:    31,
    degradedCount: 0,
    anomaly:       'None — all operational. Block III modernisation on schedule',
    health:        'nominal',
  },
  {
    name:          'Galileo',
    operator:      'ESA / EU',
    activeSats:    24,
    degradedCount: 2,
    anomaly:       '2 sats in maintenance mode; full accuracy service maintained',
    health:        'degraded',
  },
  {
    name:          'GLONASS',
    operator:      'Roscosmos (Russia)',
    activeSats:    24,
    degradedCount: 4,
    anomaly:       'Modernisation stalled by sanctions; 4 ageing sats at reduced accuracy',
    health:        'impaired',
  },
  {
    name:          'BeiDou-3',
    operator:      'CNSA (China)',
    activeSats:    35,
    degradedCount: 0,
    anomaly:       'None — system fully operational. Expanding global precision services',
    health:        'nominal',
  },
  {
    name:          'ISS',
    operator:      'NASA / Roscosmos',
    activeSats:    1,
    degradedCount: 0,
    anomaly:       'Propellant leak in Soyuz MS-22; Progress MS-26 mitigation docked',
    health:        'degraded',
  },
];

export const SPACE_WEATHER: SpaceWeatherEvent[] = [
  {
    parameter:       'Kp Geomagnetic Index',
    currentValue:    '5',
    affectedSystems: 'HF radio, GPS accuracy, LEO drag',
    forecast:        'Declining to Kp 3 over 24h; G1 watch lifted',
  },
  {
    parameter:       'Solar X-ray Flux (GOES)',
    currentValue:    'M2.4',
    flareClass:      'M',
    affectedSystems: 'Shortwave radio fadeout, ionospheric disruption',
    forecast:        'Active region 3664 still on-disk; M-class probability 55%',
  },
  {
    parameter:       'Proton Flux (>10 MeV)',
    currentValue:    '8 pfu',
    affectedSystems: 'Polar LEO satellites, crewed spacecraft',
    forecast:        'Below S1 storm threshold; elevated but non-critical',
  },
];

export const LAUNCH_ACTIVITY: LaunchActivity[] = [
  {
    nation:        'USA',
    payloadType:   'military',
    orbit:         'GEO',
    notableAspect: 'SBIRS GEO-6 — missile warning sensor; hardened against jamming',
  },
  {
    nation:        'China',
    payloadType:   'classified',
    orbit:         'LEO',
    notableAspect: 'Shijian-24 — "technology experiment" with uncharacterised maneuvering',
  },
  {
    nation:        'Russia',
    payloadType:   'military',
    orbit:         'HEO',
    notableAspect: 'Kosmos-2576 series — signals intelligence, Molniya orbit',
  },
  {
    nation:        'SpaceX (USA)',
    payloadType:   'civilian',
    orbit:         'LEO',
    notableAspect: 'Starlink Group 10-4 — 22 v2 mini sats, direct-to-cell capability',
  },
  {
    nation:        'India',
    payloadType:   'dual-use',
    orbit:         'LEO',
    notableAspect: 'EMISAT EW satellite; signals intelligence for IAF',
  },
];

export const ORBITAL_RISK_INDEX: OrbitalDomain[] = [
  { regime: 'LEO',      risk: 4 },
  { regime: 'GEO',      risk: 3 },
  { regime: 'MEO',      risk: 2 },
  { regime: 'HEO',      risk: 2 },
  { regime: 'Cislunar', risk: 1 },
];
