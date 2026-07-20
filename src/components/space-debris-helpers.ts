/**
 * Space Debris helpers — pure logic, no DOM, no fetch.
 * Safe for Node.js tests.
 *
 * Covers the orbital debris crisis as a geopolitical security issue:
 * ASAT test events, Kessler syndrome risk index, mega-constellation
 * conjunctions, debris removal missions, and space governance gaps.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type OrbitRegime = 'LEO' | 'MEO' | 'GEO' | 'HEO';
export type DebrisSeverity = 0 | 1 | 2 | 3 | 4;
export type ASATStatus = 'demonstrated' | 'suspected' | 'developing' | 'none';
export type KesslerRisk = 'low' | 'moderate' | 'elevated' | 'critical';
export type MissionStatus = 'operational' | 'planned' | 'development' | 'cancelled';
export type ConstellationStatus = 'deployed' | 'deploying' | 'planned' | 'approved';

export interface DebrisEvent {
  id: string;
  year: number;
  name: string;
  actor: string;
  orbit: OrbitRegime;
  trackedFragments: number;
  stillInOrbit: boolean;
  forcedISSManeuver: boolean;
  geopoliticalNotes: string;
  severity: DebrisSeverity;
}

export interface OrbitStats {
  regime: OrbitRegime;
  altitudeKmRange: string;
  trackedObjects: number;
  activeSatellites: number;
  debrisFragments: number;
  kesslerRisk: KesslerRisk;
  notes: string;
}

export interface ASATNation {
  code: string;
  name: string;
  status: ASATStatus;
  testsPerformed: number;
  latestTestYear: number | null;
  totalDebrisGenerated: number;
  notes: string;
}

export interface DebrisRemovalMission {
  name: string;
  agency: string;
  targetYear: number;
  status: MissionStatus;
  objective: string;
}

export interface MegaConstellation {
  operator: string;
  country: string;
  plannedCount: number;
  deployedCount: number;
  status: ConstellationStatus;
  percentOfTraffic: string;
  geopoliticalNote: string;
}

export interface GovernanceGap {
  title: string;
  description: string;
  severity: DebrisSeverity;
}

export interface GlobalDebrisStats {
  trackedObjectsAbove10cm: number;
  estimatedObjects1to10cm: number;
  estimatedObjectsBelow1cm: number;
  activeSatellites: number;
  debrisGrowthRateYoY: string;
}

export interface DebrisRenderData {
  globalStats: GlobalDebrisStats;
  events: DebrisEvent[];
  orbitStats: OrbitStats[];
  asatNations: ASATNation[];
  removalMissions: DebrisRemovalMission[];
  megaConstellations: MegaConstellation[];
  governanceGaps: GovernanceGap[];
  kesslerRiskIndex: number;
}

// ── Data constants ─────────────────────────────────────────────────────────────

export const DEBRIS_EVENTS: DebrisEvent[] = [
  {
    id: 'fengyun-1c-2007',
    year: 2007,
    name: 'China ASAT — Fengyun-1C',
    actor: 'China',
    orbit: 'LEO',
    trackedFragments: 3537,
    stillInOrbit: true,
    forcedISSManeuver: false,
    severity: 4,
    geopoliticalNotes:
      'Most destructive single debris event on record. DN-1 KE-ASAT struck FY-1C at 865 km. No advance warning; cloud still traverses ISS orbital band every 90 min. US, Russia, Japan formally protested.',
  },
  {
    id: 'iridium-cosmos-2009',
    year: 2009,
    name: 'Iridium 33 / Cosmos 2251 collision',
    actor: 'Commercial / Russia',
    orbit: 'LEO',
    trackedFragments: 2296,
    stillInOrbit: true,
    forcedISSManeuver: false,
    severity: 4,
    geopoliticalNotes:
      'First hypervelocity collision between two intact satellites. ~2,000 pieces from Iridium 33 and ~2,000 from Cosmos 2251 at 789 km. Demonstrated abandoned military satellites pose active collision risk.',
  },
  {
    id: 'burnt-frost-2008',
    year: 2008,
    name: 'USA Operation Burnt Frost (USA-193)',
    actor: 'USA',
    orbit: 'LEO',
    trackedFragments: 174,
    stillInOrbit: false,
    forcedISSManeuver: false,
    severity: 2,
    geopoliticalNotes:
      'SM-3 missile destroyed NRO sat USA-193 at 247 km (humanitarian framing: hydrazine hazard). Demonstrated low-orbit ASAT capability. Debris decayed within months due to low altitude.',
  },
  {
    id: 'cosmos-1408-2021',
    year: 2021,
    name: 'Russia ASAT — Cosmos 1408',
    actor: 'Russia',
    orbit: 'LEO',
    trackedFragments: 1500,
    stillInOrbit: true,
    forcedISSManeuver: true,
    severity: 4,
    geopoliticalNotes:
      'Nudol DA-ASAT struck Cosmos 1408 at 480 km. ISS crew sheltered in Soyuz/Dragon for 6+ hours; station performed emergency maneuver. US, UK, NATO condemned as reckless. Russia called test routine.',
  },
  {
    id: 'mission-shakti-2019',
    year: 2019,
    name: 'India ASAT — Mission Shakti',
    actor: 'India',
    orbit: 'LEO',
    trackedFragments: 400,
    stillInOrbit: false,
    forcedISSManeuver: false,
    severity: 3,
    geopoliticalNotes:
      'PDV Mk-II interceptor struck Microsat-R at ~283 km. Test announced publicly; altitude chosen to minimize debris lifetime. ~400 fragments decayed within months. India now chairs UN COPUOS debris subgroup.',
  },
  {
    id: 'starlink-megaconstellation',
    year: 2019,
    name: 'SpaceX Starlink Mega-Constellation',
    actor: 'SpaceX / USA',
    orbit: 'LEO',
    trackedFragments: 0,
    stillInOrbit: true,
    forcedISSManeuver: false,
    severity: 3,
    geopoliticalNotes:
      '~5,800 operational satellites — 57% of all tracked active satellites. Conjunction rate with other operators rising sharply. Starlink executed >50,000 avoidance maneuvers. Russia designated Starlink a military target in 2022.',
  },
  {
    id: 'kuiper-oneweb-guowang',
    year: 2023,
    name: 'Kuiper / OneWeb / Guowang mega-constellations',
    actor: 'US / UK / China',
    orbit: 'LEO',
    trackedFragments: 0,
    stillInOrbit: false,
    forcedISSManeuver: false,
    severity: 3,
    geopoliticalNotes:
      'Amazon Kuiper: 3,236 authorized; OneWeb: 648 (expanding); Guowang: 12,992 approved. Combined could push LEO active count past 25,000 by 2030. ITU filing disputes between US and China ongoing.',
  },
  {
    id: 'russia-starlink-target-2022',
    year: 2022,
    name: 'Russia Declares Starlink a Military Target',
    actor: 'Russia',
    orbit: 'LEO',
    trackedFragments: 0,
    stillInOrbit: false,
    forcedISSManeuver: false,
    severity: 4,
    geopoliticalNotes:
      'Russian Deputy FM declared Starlink satellites legitimate military targets after Ukraine used Starlink for artillery coordination. An ASAT strike on ~5,800 Starlink sats would be the worst Kessler trigger in history.',
  },
];

export const ORBIT_STATS: OrbitStats[] = [
  {
    regime: 'LEO',
    altitudeKmRange: '160-2,000 km',
    trackedObjects: 27_000,
    activeSatellites: 9200,
    debrisFragments: 17_800,
    kesslerRisk: 'critical',
    notes:
      'ISS at ~408 km sits within the most congested band. Orbital decay takes years to decades. All known kinetic ASAT tests targeted this regime.',
  },
  {
    regime: 'MEO',
    altitudeKmRange: '2,000-35,786 km',
    trackedObjects: 3400,
    activeSatellites: 600,
    debrisFragments: 2800,
    kesslerRisk: 'moderate',
    notes:
      'GPS/GNSS constellations (US GPS, GLONASS, Galileo, BeiDou). Debris persists for centuries. GNSS disruption would paralyze global navigation, logistics, and precision-guided munitions.',
  },
  {
    regime: 'GEO',
    altitudeKmRange: '35,786 km (geostationary)',
    trackedObjects: 1200,
    activeSatellites: 570,
    debrisFragments: 630,
    kesslerRisk: 'elevated',
    notes:
      'Premium orbital slots are finite; retired sats moved to graveyard orbit 300 km above GEO. Debris lifetime effectively infinite. High-value comms, weather, and early-warning satellites reside here.',
  },
  {
    regime: 'HEO',
    altitudeKmRange: 'Highly elliptical (variable)',
    trackedObjects: 900,
    activeSatellites: 120,
    debrisFragments: 780,
    kesslerRisk: 'low',
    notes:
      'Molniya orbits favored by Russia for Arctic coverage. HEO debris traverses LEO and MEO bands, raising cross-regime conjunction risk.',
  },
];

export const ASAT_NATIONS: ASATNation[] = [
  {
    code: 'US',
    name: 'United States',
    status: 'demonstrated',
    testsPerformed: 4,
    latestTestYear: 2008,
    totalDebrisGenerated: 174,
    notes:
      'Burnt Frost 2008; legacy F-15 ASAT (1985). Developing DRACO co-orbital and Rapid Dragon air-launched systems. Pledged no further destructive ASAT tests Nov 2021.',
  },
  {
    code: 'RU',
    name: 'Russia',
    status: 'demonstrated',
    testsPerformed: 7,
    latestTestYear: 2021,
    totalDebrisGenerated: 1500,
    notes:
      'Cosmos 1408 2021 generated the most recent major debris cloud. Nudol PL-19 declared operational. Tested Cosmos 2543 co-orbital inspector (2020) and EW-ASAT systems.',
  },
  {
    code: 'CN',
    name: 'China',
    status: 'demonstrated',
    testsPerformed: 5,
    latestTestYear: 2015,
    totalDebrisGenerated: 3537,
    notes:
      'FY-1C 2007 created worst debris cloud in history. DN-2 test 2013 reached GEO altitude — first nation to demonstrate GEO-range ASAT. SC-19 system operational.',
  },
  {
    code: 'IN',
    name: 'India',
    status: 'demonstrated',
    testsPerformed: 1,
    latestTestYear: 2019,
    totalDebrisGenerated: 400,
    notes:
      'Mission Shakti 2019 used PDV Mk-II exo-atmospheric interceptor. Low-altitude test minimized debris longevity. DRDO developing follow-on systems.',
  },
  {
    code: 'KP',
    name: 'North Korea',
    status: 'suspected',
    testsPerformed: 0,
    latestTestYear: null,
    totalDebrisGenerated: 0,
    notes:
      'Intelligence assessments suggest DPRK developing co-orbital ASAT using modified Kwangmyongsong bus. Malligyong-1 and -2 in LEO provide targeting infrastructure.',
  },
];

export const REMOVAL_MISSIONS: DebrisRemovalMission[] = [
  {
    name: 'ClearSpace-1',
    agency: 'ESA / ClearSpace SA',
    targetYear: 2026,
    status: 'development',
    objective:
      'Capture and deorbit VESPA rocket adapter (112 kg) at 800 km using 4-arm robotic gripper. First ever active debris removal mission. ESA contract 86M EUR.',
  },
  {
    name: 'ELSA-d',
    agency: 'Astroscale (Japan)',
    targetYear: 2024,
    status: 'operational',
    objective:
      'Demonstrated magnetic docking and release with cooperative target Feb-Sep 2022. ELSA-M next targets uncooperative debris. First commercial debris-removal service validated.',
  },
  {
    name: 'ADRAS-J',
    agency: 'Astroscale / JAXA',
    targetYear: 2025,
    status: 'operational',
    objective:
      'Approached H-IIA upper stage (~3 tonnes) at 650 km for proximity inspection. First uncooperative debris rendezvous by a commercial vehicle. Deorbit phase planned.',
  },
  {
    name: 'D-Orbit Ion',
    agency: 'D-Orbit (Italy/US)',
    targetYear: 2025,
    status: 'planned',
    objective:
      'Precision deployment and last-mile logistics vehicle for deorbiting satellite clusters at end of life. Multiple launches flown; debris-removal contract pipeline building.',
  },
];

export const MEGA_CONSTELLATIONS: MegaConstellation[] = [
  {
    operator: 'SpaceX Starlink',
    country: 'USA',
    plannedCount: 42_000,
    deployedCount: 5800,
    status: 'deploying',
    percentOfTraffic: '57%',
    geopoliticalNote:
      'Dominant operator. Ukraine conflict showed military utility; Russia and China protested at UN COPUOS. ITU filings for 42,000 sats.',
  },
  {
    operator: 'Amazon Kuiper',
    country: 'USA',
    plannedCount: 3236,
    deployedCount: 27,
    status: 'deploying',
    percentOfTraffic: '<1%',
    geopoliticalNote:
      'FCC authorized; first batch launched 2024. Deployment ramp begins 2025-2026. ITU filing disputes with Telesat and OneWeb ongoing.',
  },
  {
    operator: 'OneWeb (Eutelsat)',
    country: 'UK / France',
    plannedCount: 648,
    deployedCount: 648,
    status: 'deployed',
    percentOfTraffic: '3%',
    geopoliticalNote:
      'Post-Russia-invasion ownership shift: SoftBank to UK Govt + Bharti Airtel. Eutelsat merger 2023. Serving NATO military terminals in Ukraine.',
  },
  {
    operator: 'Guowang (SatNet)',
    country: 'China',
    plannedCount: 12_992,
    deployedCount: 18,
    status: 'deploying',
    percentOfTraffic: '<1%',
    geopoliticalNote:
      'State-backed Starlink rival. ITU filings lodged to preempt Western operators in key orbital slots. Military dual-use architecture assessed by US Space Command.',
  },
];

export const GOVERNANCE_GAPS: GovernanceGap[] = [
  {
    title: 'No binding ASAT test ban',
    severity: 4,
    description:
      'Outer Space Treaty (1967) prohibits WMDs in space but does not ban kinetic ASAT tests. US unilateral moratorium (2021) not mirrored by Russia or China. UN 2022 vote: Russia and China voted against — result not binding.',
  },
  {
    title: 'Voluntary-only debris mitigation',
    severity: 3,
    description:
      'IADC and ITU guidelines (25-year deorbit rule) are voluntary. Compliance: ESA ~90%, commercial ~60%, some national programs <30%. No enforcement mechanism exists.',
  },
  {
    title: 'Liability Convention gaps',
    severity: 3,
    description:
      'Liability Convention (1972) covers damage on Earth or to aircraft. Orbital debris damage to third-party satellites is legally grey; no successful inter-state orbital liability claim has ever been adjudicated.',
  },
  {
    title: 'ITU spectrum and slot disputes',
    severity: 3,
    description:
      'ITU allocates orbital slots first-come, first-served. US and Chinese mega-constellations filing for overlapping LEO altitudes. No multilateral agreement on constellation size limits exists.',
  },
  {
    title: 'RPO technology proliferation unregulated',
    severity: 4,
    description:
      'Rendezvous-and-proximity operations (RPO) tech used for debris removal (Astroscale, ClearSpace) is physically identical to co-orbital ASAT systems. No treaty restricts RPO technology transfer or deployment.',
  },
];

// ── Helper functions ───────────────────────────────────────────────────────────

export function getByOrbitRegime(events: DebrisEvent[], regime: OrbitRegime): DebrisEvent[] {
  return events.filter((e) => e.orbit === regime);
}

export function getHighRiskEvents(events: DebrisEvent[]): DebrisEvent[] {
  return events.filter((e) => e.severity >= 3);
}

export function getASATCapableNations(nations: ASATNation[]): ASATNation[] {
  return nations.filter((n) => n.status === 'demonstrated' || n.status === 'suspected');
}

/**
 * Composite Kessler risk index 0-100.
 *
 * Weights:
 *   40 pts — LEO object density  (trackedObjects / 30_000 x 40)
 *   30 pts — high-severity events still in orbit  (count x 7.5, capped)
 *   20 pts — total fragments still in orbit  (fragments / 7_000 x 20, capped)
 *   10 pts — recent destructive ASAT (year >= 2019, fragments > 100, stillInOrbit)
 */
export function computeKesslerRiskIndex(
  orbitStats: OrbitStats[],
  events: DebrisEvent[],
): number {
  const leo = orbitStats.find((o) => o.regime === 'LEO');
  const leoDensity = leo ? Math.min(40, (leo.trackedObjects / 30_000) * 40) : 0;

  const highSeverityInOrbit = events.filter((e) => e.severity >= 3 && e.stillInOrbit).length;
  const eventScore = Math.min(30, highSeverityInOrbit * 7.5);

  const totalFragments = events
    .filter((e) => e.stillInOrbit)
    .reduce((sum, e) => sum + e.trackedFragments, 0);
  const fragScore = Math.min(20, (totalFragments / 7000) * 20);

  const recentASAT = events.some(
    (e) => e.year >= 2019 && e.trackedFragments > 100 && e.stillInOrbit,
  );
  const asatScore = recentASAT ? 10 : 0;

  return Math.round(leoDensity + eventScore + fragScore + asatScore);
}

export function kesslerRiskLabel(index: number): KesslerRisk {
  if (index >= 80) return 'critical';
  if (index >= 55) return 'elevated';
  if (index >= 30) return 'moderate';
  return 'low';
}

export function debrisSeverityClass(severity: DebrisSeverity): string {
  switch (severity) {
    case 0: {  return 'debris-sev-minimal';
    }
    case 1: {  return 'debris-sev-low';
    }
    case 2: {  return 'debris-sev-moderate';
    }
    case 3: {  return 'debris-sev-high';
    }
    case 4: {  return 'debris-sev-critical';
    }
  }
}

export function riskClass(risk: KesslerRisk): string {
  switch (risk) {
    case 'low': {      return 'risk-low';
    }
    case 'moderate': { return 'risk-moderate';
    }
    case 'elevated': { return 'risk-elevated';
    }
    case 'critical': { return 'risk-critical';
    }
  }
}

export function severityColor(severity: DebrisSeverity): string {
  switch (severity) {
    case 0: { return '#9e9e9e';
    }
    case 1: { return '#4caf50';
    }
    case 2: { return '#ffeb3b';
    }
    case 3: { return '#ff9800';
    }
    case 4: { return '#ff453a';
    }
  }
}

export function formatFragments(n: number): string {
  if (n === 0) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function asatStatusLabel(status: ASATStatus): string {
  switch (status) {
    case 'demonstrated': { return 'Demonstrated';
    }
    case 'suspected': {    return 'Suspected';
    }
    case 'developing': {   return 'Developing';
    }
    case 'none': {         return 'None';
    }
  }
}

export function missionStatusLabel(status: MissionStatus): string {
  switch (status) {
    case 'operational': { return 'Operational';
    }
    case 'planned': {     return 'Planned';
    }
    case 'development': { return 'In Development';
    }
    case 'cancelled': {   return 'Cancelled';
    }
  }
}

export function constellationStatusLabel(status: ConstellationStatus): string {
  switch (status) {
    case 'deployed': {  return 'Deployed';
    }
    case 'deploying': { return 'Deploying';
    }
    case 'planned': {   return 'Planned';
    }
    case 'approved': {  return 'Approved';
    }
  }
}

export function buildRenderData(): DebrisRenderData {
  return {
    globalStats: {
      trackedObjectsAbove10cm: 36_500,
      estimatedObjects1to10cm: 1_000_000,
      estimatedObjectsBelow1cm: 130_000_000,
      activeSatellites: 9200,
      debrisGrowthRateYoY: '+3.7%',
    },
    events: DEBRIS_EVENTS,
    orbitStats: ORBIT_STATS,
    asatNations: ASAT_NATIONS,
    removalMissions: REMOVAL_MISSIONS,
    megaConstellations: MEGA_CONSTELLATIONS,
    governanceGaps: GOVERNANCE_GAPS,
    kesslerRiskIndex: computeKesslerRiskIndex(ORBIT_STATS, DEBRIS_EVENTS),
  };
}
