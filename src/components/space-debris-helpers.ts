/**
 * Pure helpers for SpaceDebrisPanel.
 *
 * Tracks the orbital debris crisis as a geopolitical / space-security issue.
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type OrbitRegimeId = 'LEO' | 'MEO' | 'GEO';

export type EventType = 'ASAT Test' | 'Collision' | 'Explosion' | 'Reentry';

export type DebrisDensity = 'Low' | 'Moderate' | 'High' | 'Critical';

export type CollisionRisk = 'Low' | 'Medium' | 'High' | 'Critical';

export interface DebrisEvent {
  id: string;
  name: string;
  date: string;           // ISO date string or year
  actor: string;
  orbitRegime: OrbitRegimeId;
  fragmentCount: number;
  stillInOrbit: boolean;
  eventType: EventType;
  severity: number;       // 1-10
  description: string;
}

export interface OrbitRegimeStatus {
  regime: string;
  trackedObjects: number;
  debrisDensity: DebrisDensity;
  collisionRisk: CollisionRisk;
  keyThreat: string;
}

export interface ASATCapability {
  country: string;
  confirmed: boolean;
  testYear: number | null;
  fragmentsCreated: number | null;
  status: string;
}

export interface DebrisRenderData {
  events: DebrisEvent[];
  orbitRegimes: OrbitRegimeStatus[];
  asatCapabilities: ASATCapability[];
  kesslerRiskIndex: number;         // 0-100
  totalTrackedObjects: number;
  activeRemovalMissions: number;
}

// ── Static seed data ──────────────────────────────────────────────────────

export const DEBRIS_EVENTS: DebrisEvent[] = [
  {
    id: 'fengyun-1c-2007',
    name: 'Fengyun-1C ASAT Intercept',
    date: '2007-01-11',
    actor: 'China',
    orbitRegime: 'LEO',
    fragmentCount: 3500,
    stillInOrbit: true,
    eventType: 'ASAT Test',
    severity: 10,
    description:
      'China destroyed its own aging weather satellite at 865 km. Created the largest single debris cloud in history; most fragments will persist for decades.',
  },
  {
    id: 'cosmos-iridium-2009',
    name: 'Cosmos 2251 / Iridium 33 Collision',
    date: '2009-02-10',
    actor: 'Russia / USA',
    orbitRegime: 'LEO',
    fragmentCount: 2000,
    stillInOrbit: true,
    eventType: 'Collision',
    severity: 9,
    description:
      'First accidental hypervelocity collision between two intact satellites at ~789 km. Destroyed both spacecraft and generated approximately 2,000 tracked fragments.',
  },
  {
    id: 'cosmos-1408-2021',
    name: 'Cosmos 1408 ASAT Test (NUDOL)',
    date: '2021-11-15',
    actor: 'Russia',
    orbitRegime: 'LEO',
    fragmentCount: 1500,
    stillInOrbit: true,
    eventType: 'ASAT Test',
    severity: 9,
    description:
      'Russia used its direct-ascent NUDOL missile to destroy the defunct Soviet-era ELINT satellite. ISS crew sheltered in Soyuz capsules. Generated 1,500+ trackable fragments at ISS altitude.',
  },
  {
    id: 'mission-shakti-2019',
    name: 'Mission Shakti ASAT Test',
    date: '2019-03-27',
    actor: 'India',
    orbitRegime: 'LEO',
    fragmentCount: 400,
    stillInOrbit: false,
    eventType: 'ASAT Test',
    severity: 7,
    description:
      'India intercepted Microsat-R at ~283 km using modified Prithvi Defence Vehicle. Low-altitude choice expedited atmospheric decay; most fragments re-entered within months.',
  },
  {
    id: 'burnt-frost-2008',
    name: 'Operation Burnt Frost',
    date: '2008-02-21',
    actor: 'USA',
    orbitRegime: 'LEO',
    fragmentCount: 174,
    stillInOrbit: false,
    eventType: 'ASAT Test',
    severity: 5,
    description:
      'US Navy SM-3 intercepted failing spy satellite USA-193 at ~247 km. Framed as hazardous-fuel (hydrazine) removal. Very low orbit ensured rapid debris re-entry.',
  },
  {
    id: 'beidou2-explosion-2016',
    name: 'BeiDou-2 G2 Satellite Explosion',
    date: '2016-03-29',
    actor: 'China',
    orbitRegime: 'MEO',
    fragmentCount: 200,
    stillInOrbit: true,
    eventType: 'Explosion',
    severity: 6,
    description:
      'An aged BeiDou-2 navigation satellite fragmented in MEO, generating 200+ tracked objects in a regime with extremely long orbital lifetimes. Cause attributed to residual propellant.',
  },
  {
    id: 'sj12-debris-2010',
    name: 'SJ-12 Proximity / Debris Cloud',
    date: '2010-08-19',
    actor: 'China',
    orbitRegime: 'LEO',
    fragmentCount: 50,
    stillInOrbit: false,
    eventType: 'Collision',
    severity: 5,
    description:
      'Chinese SJ-12 maneuvering satellite performed an apparent rendezvous with SJ-06F, generating a small debris cloud. Demonstrated co-orbital maneuvering capability.',
  },
  {
    id: 'fengyun-reentry',
    name: 'Fengyun-1C Cloud Ongoing Reentry',
    date: '2007-01-11',
    actor: 'China',
    orbitRegime: 'LEO',
    fragmentCount: 3500,
    stillInOrbit: true,
    eventType: 'Reentry',
    severity: 8,
    description:
      'The Fengyun-1C debris cloud continues to pose conjunction threats. Higher-altitude fragments (>700 km) will persist for 30-50+ years, forcing regular ISS and satellite avoidance maneuvers.',
  },
  {
    id: 'starlink-constellation-2024',
    name: 'Starlink Mega-Constellation Growth',
    date: '2024-01-01',
    actor: 'USA (SpaceX)',
    orbitRegime: 'LEO',
    fragmentCount: 5800,
    stillInOrbit: true,
    eventType: 'Collision',
    severity: 6,
    description:
      'Starlink constitutes ~57% of all active satellites. Conjunction rates are rising sharply. Despite atmospheric disposal design, end-of-life failures and near-misses are increasing systemic risk.',
  },
  {
    id: 'kuiper-oneweb-2024',
    name: 'Amazon Kuiper + OneWeb Deployment',
    date: '2024-06-01',
    actor: 'USA / UK',
    orbitRegime: 'LEO',
    fragmentCount: 648,
    stillInOrbit: true,
    eventType: 'Collision',
    severity: 5,
    description:
      'Parallel mega-constellation deployments are increasing LEO population density. Without binding coordination frameworks, conjunction frequencies are projected to rise 400% by 2030.',
  },
];

export const ORBIT_REGIME_STATUSES: OrbitRegimeStatus[] = [
  {
    regime: 'LEO (200–2,000 km)',
    trackedObjects: 20_000,
    debrisDensity: 'Critical',
    collisionRisk: 'Critical',
    keyThreat: 'ASAT test clouds + mega-constellations driving Kessler cascade risk',
  },
  {
    regime: 'MEO (2,000–35,786 km)',
    trackedObjects: 1_500,
    debrisDensity: 'Moderate',
    collisionRisk: 'Medium',
    keyThreat: 'GNSS satellite explosions; very long debris lifetimes (centuries)',
  },
  {
    regime: 'GEO (35,786 km)',
    trackedObjects: 2_200,
    debrisDensity: 'Moderate',
    collisionRisk: 'Medium',
    keyThreat: 'Zombie satellites and rocket bodies; limited disposal compliance',
  },
  {
    regime: 'GEO Graveyard (>36,000 km)',
    trackedObjects: 300,
    debrisDensity: 'Moderate',
    collisionRisk: 'Low',
    keyThreat: 'Accumulated retired GEO satellites; fragmentation risk from aging hardware',
  },
  {
    regime: 'HEO (Highly Elliptical)',
    trackedObjects: 400,
    debrisDensity: 'Low',
    collisionRisk: 'Low',
    keyThreat: 'Russian Molniya-type debris; crossing multiple altitude bands',
  },
];

export const ASAT_CAPABILITIES: ASATCapability[] = [
  {
    country: 'USA',
    confirmed: true,
    testYear: 2008,
    fragmentsCreated: 174,
    status: 'Active DA-ASAT + co-orbital + directed-energy programs',
  },
  {
    country: 'Russia',
    confirmed: true,
    testYear: 2021,
    fragmentsCreated: 1500,
    status: 'NUDOL direct-ascent operational; Burevestnik co-orbital tests ongoing',
  },
  {
    country: 'China',
    confirmed: true,
    testYear: 2007,
    fragmentsCreated: 3500,
    status: 'SC-19/DN-1/DN-3 systems; most prolific ASAT debris producer',
  },
  {
    country: 'India',
    confirmed: true,
    testYear: 2019,
    fragmentsCreated: 400,
    status: 'PDV Mk-II operational; pursuing next-generation interceptors',
  },
  {
    country: 'North Korea',
    confirmed: false,
    testYear: null,
    fragmentsCreated: null,
    status: 'Suspected developmental program; SLV technology applicable to DA-ASAT',
  },
  {
    country: 'Israel',
    confirmed: false,
    testYear: null,
    fragmentsCreated: null,
    status: 'Suspected capabilities via Arrow-3 BMD system; not publicly acknowledged',
  },
];

// ── Helper functions ──────────────────────────────────────────────────────

/** Return events filtered to a specific orbit regime. */
export function getByOrbitRegime(
  events: DebrisEvent[],
  regime: OrbitRegimeId,
): DebrisEvent[] {
  return events.filter((e) => e.orbitRegime === regime);
}

/** Return events with severity >= 7. */
export function getHighRiskEvents(events: DebrisEvent[]): DebrisEvent[] {
  return events.filter((e) => e.severity >= 7);
}

/** Return ASAT-capable nations (confirmed only by default). */
export function getASATCapableNations(
  capabilities: ASATCapability[],
  confirmedOnly = true,
): ASATCapability[] {
  return confirmedOnly
    ? capabilities.filter((c) => c.confirmed)
    : capabilities;
}

/**
 * Compute a Kessler risk index (0–100) from LEO density, active ASAT
 * programs, and recent test history (last 5 years from reference year).
 */
export function computeKesslerRiskIndex(
  orbitRegimes: OrbitRegimeStatus[],
  capabilities: ASATCapability[],
  referenceYear = 2025,
): number {
  const leo = orbitRegimes.find((r) => r.regime.startsWith('LEO'));
  let score = 0;

  // Density component (0-40)
  const densityWeight: Record<DebrisDensity, number> = {
    Low: 5,
    Moderate: 15,
    High: 30,
    Critical: 40,
  };
  if (leo) score += densityWeight[leo.debrisDensity] ?? 0;

  // Active ASAT programs component (0-30): 5 per confirmed nation, 2 per suspected
  for (const cap of capabilities) {
    score += cap.confirmed ? 5 : 2;
  }

  // Recent test history component (0-30): 10 per confirmed test within 5 years
  for (const cap of capabilities) {
    if (cap.confirmed && cap.testYear != null && referenceYear - cap.testYear <= 5) {
      score += 10;
    }
  }

  return Math.min(100, Math.max(0, score));
}

/** CSS colour token for a severity score 1-10. */
export function debrisSeverityClass(severity: number): string {
  if (severity >= 9) return 'var(--severity-critical, #ef4444)';
  if (severity >= 7) return 'var(--severity-high,     #fb923c)';
  if (severity >= 5) return 'var(--severity-medium,   #facc15)';
  return 'var(--severity-low,      #4caf50)';
}

/** CSS colour token for an orbit regime debris density. */
export function regimeDensityClass(density: DebrisDensity): string {
  const map: Record<DebrisDensity, string> = {
    Critical: 'var(--severity-critical, #ef4444)',
    High:     'var(--severity-high,     #fb923c)',
    Moderate: 'var(--severity-medium,   #facc15)',
    Low:      'var(--severity-low,      #4caf50)',
  };
  return map[density];
}

/** Assemble the full render payload used by SpaceDebrisPanel. */
export function buildRenderData(
  events = DEBRIS_EVENTS,
  orbitRegimes = ORBIT_REGIME_STATUSES,
  asatCapabilities = ASAT_CAPABILITIES,
  referenceYear = 2025,
): DebrisRenderData {
  return {
    events,
    orbitRegimes,
    asatCapabilities,
    kesslerRiskIndex: computeKesslerRiskIndex(orbitRegimes, asatCapabilities, referenceYear),
    totalTrackedObjects: orbitRegimes.reduce((s, r) => s + r.trackedObjects, 0),
    activeRemovalMissions: 3, // ClearSpace-1, ADRAS-J, D-Orbit / Astroscale
  };
}
