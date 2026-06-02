/**
 * Pure helpers for BorderIncidentsPanel.
 *
 * Tracks militarized interstate disputes (MIDs) across active friction
 * zones as early-warning escalation signals. All static data is a
 * synthetic illustrative seed for deterministic rendering and testing.
 *
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type IncidentType = 'Fire' | 'Maneuver' | 'Display' | 'Blockade' | 'Seizure';
export type TrendType = 'escalating' | 'stable' | 'de-escalating';

export interface BorderFrictionZone {
  id: string;
  parties: string[];
  region: string;
  incidentType: IncidentType[];
  /** Approximate monthly incident count (300 = continuous/active-war). */
  monthlyFrequency: number;
  trend: TrendType;
  nuclearRisk: boolean;
  /** 1 (negligible) – 10 (imminent conflict). */
  escalationPotential: number;
  description: string;
  lastIncident: string;
}

export interface MIDRenderData {
  zones: BorderFrictionZone[];
  globalMIDIndex: number;
  highIntensityCount: number;
  escalatingCount: number;
  nuclearRiskCount: number;
}

// ── Static data ───────────────────────────────────────────────────────────────

export const BORDER_FRICTION_ZONES: BorderFrictionZone[] = [
  {
    id: 'china-taiwan-adiz',
    parties: ['China', 'Taiwan'],
    region: 'Asia-Pacific',
    incidentType: ['Display', 'Maneuver'],
    monthlyFrequency: 45,
    trend: 'escalating',
    nuclearRisk: true,
    escalationPotential: 9,
    description:
      'PLA Air Force sorties into Taiwan ADIZ; record 153 aircraft October 2024. Frequency accelerating post-elections.',
    lastIncident: '2024-10',
  },
  {
    id: 'china-india-lac',
    parties: ['China', 'India'],
    region: 'South Asia',
    incidentType: ['Maneuver'],
    monthlyFrequency: 8,
    trend: 'stable',
    nuclearRisk: true,
    escalationPotential: 7,
    description:
      'Post-Galwan patrol standoffs along Line of Actual Control; buffer zones holding under 2021 disengagement agreement.',
    lastIncident: '2024-09',
  },
  {
    id: 'india-pakistan-loc',
    parties: ['India', 'Pakistan'],
    region: 'South Asia',
    incidentType: ['Fire', 'Display'],
    monthlyFrequency: 15,
    trend: 'escalating',
    nuclearRisk: true,
    escalationPotential: 8,
    description:
      'Post-Pahalgam 2025 mobilization elevated cross-LoC firing incidents and fighter deployments to crisis levels.',
    lastIncident: '2025-05',
  },
  {
    id: 'china-philippines-scs',
    parties: ['China', 'Philippines'],
    region: 'Asia-Pacific',
    incidentType: ['Seizure', 'Blockade'],
    monthlyFrequency: 12,
    trend: 'escalating',
    nuclearRisk: false,
    escalationPotential: 7,
    description:
      'Water-cannon attacks on Philippine resupply missions to Second Thomas Shoal; harassment of BRP Sierra Madre ongoing.',
    lastIncident: '2025-04',
  },
  {
    id: 'russia-ukraine-frontline',
    parties: ['Russia', 'Ukraine'],
    region: 'Europe',
    incidentType: ['Fire'],
    monthlyFrequency: 300,
    trend: 'stable',
    nuclearRisk: true,
    escalationPotential: 8,
    description:
      'Active war; continuous artillery exchanges along ~1,000 km front. Nuclear risk indirect — escalatory rhetoric from Kremlin.',
    lastIncident: '2025-05',
  },
  {
    id: 'north-korea-south-korea-dmz',
    parties: ['North Korea', 'South Korea'],
    region: 'Asia-Pacific',
    incidentType: ['Display', 'Fire'],
    monthlyFrequency: 6,
    trend: 'escalating',
    nuclearRisk: true,
    escalationPotential: 7,
    description:
      'GPS jamming, propaganda balloon campaigns, and brief small-arms exchanges along DMZ throughout 2024.',
    lastIncident: '2024-10',
  },
  {
    id: 'russia-finland-baltic',
    parties: ['Russia', 'Finland'],
    region: 'Europe',
    incidentType: ['Maneuver'],
    monthlyFrequency: 3,
    trend: 'escalating',
    nuclearRisk: false,
    escalationPotential: 5,
    description:
      'Post-NATO accession air and naval maneuvers near Finnish border and Baltic airspace; undersea infrastructure incidents.',
    lastIncident: '2025-03',
  },
  {
    id: 'armenia-azerbaijan',
    parties: ['Armenia', 'Azerbaijan'],
    region: 'Eurasia',
    incidentType: ['Display'],
    monthlyFrequency: 2,
    trend: 'de-escalating',
    nuclearRisk: false,
    escalationPotential: 5,
    description:
      'Ongoing border demarcation disputes following 2023 Karabakh resolution; tension reduced but legal status unresolved.',
    lastIncident: '2025-02',
  },
  {
    id: 'serbia-kosovo',
    parties: ['Serbia', 'Kosovo'],
    region: 'Europe',
    incidentType: ['Display'],
    monthlyFrequency: 3,
    trend: 'stable',
    nuclearRisk: false,
    escalationPotential: 6,
    description:
      'Recurring border standoffs; NATO KFOR maintains stabilizing presence along administrative boundary line.',
    lastIncident: '2025-01',
  },
  {
    id: 'saudi-arabia-yemen',
    parties: ['Saudi Arabia', 'Yemen (Houthi)'],
    region: 'Middle East',
    incidentType: ['Fire'],
    monthlyFrequency: 20,
    trend: 'stable',
    nuclearRisk: false,
    escalationPotential: 6,
    description:
      'Ongoing cross-border exchanges; Houthi drone and ballistic missile fire persists despite intermittent ceasefire efforts.',
    lastIncident: '2025-05',
  },
  {
    id: 'ethiopia-eritrea',
    parties: ['Ethiopia', 'Eritrea'],
    region: 'Africa',
    incidentType: ['Maneuver'],
    monthlyFrequency: 4,
    trend: 'escalating',
    nuclearRisk: false,
    escalationPotential: 6,
    description:
      'Renewed 2024 troop build-ups along shared border; post-Tigray tensions re-emerging with land-access disputes.',
    lastIncident: '2024-12',
  },
  {
    id: 'ecuador-colombia',
    parties: ['Ecuador', 'Colombia'],
    region: 'Latin America',
    incidentType: ['Fire'],
    monthlyFrequency: 2,
    trend: 'stable',
    nuclearRisk: false,
    escalationPotential: 4,
    description:
      'FARC dissident cross-border incursions; low-level fire exchanges in Putumayo and Esmeraldas border zones.',
    lastIncident: '2025-01',
  },
];

// ── Helper functions ──────────────────────────────────────────────────────────

/**
 * Returns zones with monthlyFrequency > 10 OR escalationPotential >= 8.
 * Represents the most acute near-term risks in the MID dataset.
 */
export function getHighIntensity(zones: BorderFrictionZone[]): BorderFrictionZone[] {
  return zones.filter((z) => z.monthlyFrequency > 10 || z.escalationPotential >= 8);
}

/** Returns zones currently on an escalating trend. */
export function getEscalating(zones: BorderFrictionZone[]): BorderFrictionZone[] {
  return zones.filter((z) => z.trend === 'escalating');
}

/** Returns zones filtered to a specific region string. */
export function getByRegion(zones: BorderFrictionZone[], region: string): BorderFrictionZone[] {
  return zones.filter((z) => z.region === region);
}

/** Returns zones with the nuclear-risk flag set. */
export function getNuclearRisk(zones: BorderFrictionZone[]): BorderFrictionZone[] {
  return zones.filter((z) => z.nuclearRisk);
}

/**
 * Computes a composite Global MID Index on a 0–100 scale.
 *
 * Formula:
 *   baseScore       = mean(escalationPotential) × 10
 *   nuclearBonus    = (nuclearRiskCount / n) × 10
 *   escalatingBonus = (escalatingCount / n) × 10
 *   result          = clamp(round(base + nuclearBonus + escalatingBonus), 0, 100)
 */
export function computeGlobalMIDIndex(zones: BorderFrictionZone[]): number {
  if (zones.length === 0) return 0;
  const n = zones.length;
  const meanPotential = zones.reduce((s, z) => s + z.escalationPotential, 0) / n;
  const nuclearBonus = (zones.filter((z) => z.nuclearRisk).length / n) * 10;
  const escalatingBonus = (zones.filter((z) => z.trend === 'escalating').length / n) * 10;
  return Math.min(100, Math.round(meanPotential * 10 + nuclearBonus + escalatingBonus));
}

/** CSS class token for an incident type (used for colour-coding badges). */
export function incidentTypeClass(type: IncidentType): string {
  switch (type) {
    case 'Fire': {     return 'mid-type--fire';
    }
    case 'Maneuver': { return 'mid-type--maneuver';
    }
    case 'Display': {  return 'mid-type--display';
    }
    case 'Blockade': { return 'mid-type--blockade';
    }
    case 'Seizure': {  return 'mid-type--seizure';
    }
  }
}

/** CSS class token for a zone's intensity level. */
export function intensityClass(zone: BorderFrictionZone): string {
  if (zone.escalationPotential >= 8 || zone.monthlyFrequency > 50) return 'mid-intensity--critical';
  if (zone.escalationPotential >= 6 || zone.monthlyFrequency > 10)  return 'mid-intensity--high';
  if (zone.escalationPotential >= 4 || zone.monthlyFrequency > 3)   return 'mid-intensity--medium';
  return 'mid-intensity--low';
}

/**
 * Assembles the full render payload for BorderIncidentsPanel.
 * Zones are sorted by escalationPotential descending.
 */
export function buildRenderData(
  zones: BorderFrictionZone[] = BORDER_FRICTION_ZONES,
): MIDRenderData {
  const sorted = [...zones].sort((a, b) => b.escalationPotential - a.escalationPotential);
  return {
    zones: sorted,
    globalMIDIndex: computeGlobalMIDIndex(zones),
    highIntensityCount: getHighIntensity(zones).length,
    escalatingCount: getEscalating(zones).length,
    nuclearRiskCount: getNuclearRisk(zones).length,
  };
}
