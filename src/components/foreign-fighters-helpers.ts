/**
 * Pure helpers for ForeignFightersPanel.
 *
 * Tracks transnational foreign fighter flows: recruitment hotspots, active
 * conflicts drawing foreign fighters, estimated combatant counts, origin
 * countries, ideological/factional affiliation, and travel ban effectiveness.
 *
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type FlowStatus = 'active' | 'declining' | 'concluded';
export type TrendDirection = 'increasing' | 'stable' | 'decreasing';

export type Ideology =
  | 'jihadist-sunni'
  | 'jihadist-shia'
  | 'nationalist'
  | 'pro-western'
  | 'mercenary'
  | 'ethnic-nationalist';

export type RecruitmentMethod =
  | 'social-media'
  | 'diaspora-networks'
  | 'official-channel'
  | 'proxy-state'
  | 'in-person';

export type TravelBanEffectiveness = 'low' | 'moderate' | 'high';

export type RecruitmentSignificance = 'low' | 'moderate' | 'high' | 'critical';

export interface ConflictZone {
  id: string;
  name: string;
  region: string;
  status: FlowStatus;
  /** Estimated total foreign fighters currently present. */
  estimatedFighters: number;
  /** Top source countries (2-4). */
  majorOriginCountries: string[];
  ideology: Ideology;
  /** Primary armed faction drawing foreign fighters. */
  faction: string;
  travelBanEffectiveness: TravelBanEffectiveness;
  /** Calendar year of peak foreign fighter presence. */
  peakYear: number;
  notes: string;
}

export interface RecruitmentIncident {
  id: string;
  /** ISO YYYY-MM. */
  date: string;
  title: string;
  actor: string;
  method: RecruitmentMethod;
  targetRegion: string;
  estimatedRecruits: number;
  ideology: Ideology;
  significance: RecruitmentSignificance;
}

export interface GlobalForeignFighterIndex {
  totalEstimated: number;
  activeConflicts: number;
  majorSourceRegions: string[];
  trendDirection: TrendDirection;
  highestVolumeConflict: string;
  asOf: string;
}

export interface RenderData {
  index: GlobalForeignFighterIndex;
  ranked: ConflictZone[];
  activeZones: ConflictZone[];
  highVolume: ConflictZone[];
  incidents: RecruitmentIncident[];
  totalFighters: number;
}

// ── Label / color helpers ─────────────────────────────────────────────────────

export function statusLabel(s: FlowStatus): string {
  const labels: Record<FlowStatus, string> = {
    active:    'Active',
    declining: 'Declining',
    concluded: 'Concluded',
  };
  return labels[s];
}

export function statusClass(s: FlowStatus): string {
  const colors: Record<FlowStatus, string> = {
    active:    'var(--severity-critical, #ef4444)',
    declining: 'var(--severity-medium,   #facc15)',
    concluded: 'var(--severity-none,     #9e9e9e)',
  };
  return colors[s];
}

export function ideologyLabel(i: Ideology): string {
  const labels: Record<Ideology, string> = {
    'jihadist-sunni':     'Jihadist (Sunni)',
    'jihadist-shia':      'Jihadist (Shia)',
    'nationalist':        'Nationalist',
    'pro-western':        'Pro-Western',
    'mercenary':          'Mercenary',
    'ethnic-nationalist': 'Ethnic Nationalist',
  };
  return labels[i];
}

export function ideologyClass(i: Ideology): string {
  const colors: Record<Ideology, string> = {
    'jihadist-sunni':     'var(--severity-critical, #ef4444)',
    'jihadist-shia':      'var(--severity-high,     #fb923c)',
    'nationalist':        'var(--severity-medium,   #facc15)',
    'pro-western':        'var(--severity-low,      #4caf50)',
    'mercenary':          'var(--severity-none,     #9e9e9e)',
    'ethnic-nationalist': '#a78bfa',
  };
  return colors[i];
}

export function travelBanLabel(e: TravelBanEffectiveness): string {
  const labels: Record<TravelBanEffectiveness, string> = {
    low:      'Low',
    moderate: 'Moderate',
    high:     'High',
  };
  return labels[e];
}

export function travelBanColor(e: TravelBanEffectiveness): string {
  const colors: Record<TravelBanEffectiveness, string> = {
    low:      'var(--severity-critical, #ef4444)',
    moderate: 'var(--severity-medium,   #facc15)',
    high:     'var(--severity-low,      #4caf50)',
  };
  return colors[e];
}

export function significanceLabel(s: RecruitmentSignificance): string {
  const labels: Record<RecruitmentSignificance, string> = {
    low:      'Low',
    moderate: 'Moderate',
    high:     'High',
    critical: 'Critical',
  };
  return labels[s];
}

export function significanceColor(s: RecruitmentSignificance): string {
  const colors: Record<RecruitmentSignificance, string> = {
    low:      'var(--severity-low,      #4caf50)',
    moderate: 'var(--severity-medium,   #facc15)',
    high:     'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function recruitmentMethodLabel(m: RecruitmentMethod): string {
  const labels: Record<RecruitmentMethod, string> = {
    'social-media':      'Social Media',
    'diaspora-networks': 'Diaspora Networks',
    'official-channel':  'Official Channel',
    'proxy-state':       'Proxy State',
    'in-person':         'In-Person',
  };
  return labels[m];
}

export function trendLabel(t: 'increasing' | 'stable' | 'decreasing'): string {
  const labels = { increasing: 'Increasing', stable: 'Stable', decreasing: 'Decreasing' };
  return labels[t];
}

export function trendColor(t: 'increasing' | 'stable' | 'decreasing'): string {
  const colors = {
    increasing: 'var(--severity-critical, #ef4444)',
    stable:     'var(--severity-medium,   #facc15)',
    decreasing: 'var(--severity-low,      #4caf50)',
  };
  return colors[t];
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatFighters(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000)  return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

// ── Aggregation / filter helpers ──────────────────────────────────────────────

/** Returns conflict zones with status === 'active'. */
export function getActiveFlows(zones: ConflictZone[]): ConflictZone[] {
  return zones.filter((z) => z.status === 'active');
}

/** Returns conflict zones matching the given ideology. */
export function getByIdeology(zones: ConflictZone[], ideology: Ideology): ConflictZone[] {
  return zones.filter((z) => z.ideology === ideology);
}

/**
 * Returns conflict zones where estimatedFighters > threshold.
 * Defaults to 500.
 */
export function getHighVolume(zones: ConflictZone[], threshold = 500): ConflictZone[] {
  return zones.filter((z) => z.estimatedFighters > threshold);
}

/** Sum of estimatedFighters across all zones. */
export function totalForeignFighters(zones: ConflictZone[]): number {
  return zones.reduce((acc, z) => acc + z.estimatedFighters, 0);
}

/** Returns zones sorted by estimatedFighters descending. */
export function rankByVolume(zones: ConflictZone[]): ConflictZone[] {
  return [...zones].sort((a, b) => b.estimatedFighters - a.estimatedFighters);
}

/** Returns the conflict zone with the highest estimatedFighters, or null for empty. */
export function topConflict(zones: ConflictZone[]): ConflictZone | null {
  if (zones.length === 0) return null;
  return rankByVolume(zones)[0]!;
}

/** Count zones by status. */
export function countByStatus(zones: ConflictZone[], status: FlowStatus): number {
  return zones.filter((z) => z.status === status).length;
}

/** Count recruitment incidents by significance level. */
export function countBySignificance(
  incidents: RecruitmentIncident[],
  significance: RecruitmentSignificance,
): number {
  return incidents.filter((i) => i.significance === significance).length;
}

/** Count high+critical significance incidents. */
export function countHighSignificance(incidents: RecruitmentIncident[]): number {
  return incidents.filter(
    (i) => i.significance === 'high' || i.significance === 'critical',
  ).length;
}

/** Compute ideology breakdown across zones, sorted by fighter count desc. */
export function ideologyBreakdown(
  zones: ConflictZone[],
): { ideology: Ideology; count: number; fighters: number }[] {
  const map = new Map<Ideology, { count: number; fighters: number }>();
  for (const z of zones) {
    const existing = map.get(z.ideology) ?? { count: 0, fighters: 0 };
    map.set(z.ideology, {
      count:    existing.count + 1,
      fighters: existing.fighters + z.estimatedFighters,
    });
  }
  return [...map.entries()]
    .map(([ideology, data]) => ({ ideology, ...data }))
    .sort((a, b) => b.fighters - a.fighters);
}

/** Assemble the full render-ready data object. */
export function buildRenderData(
  zones: ConflictZone[],
  incidents: RecruitmentIncident[],
  index: GlobalForeignFighterIndex,
): RenderData {
  return {
    index,
    ranked:        rankByVolume(zones),
    activeZones:   getActiveFlows(zones),
    highVolume:    getHighVolume(zones),
    incidents,
    totalFighters: totalForeignFighters(zones),
  };
}

// ── Static seed data (synthetic / illustrative) ───────────────────────────────

export const CONFLICT_ZONES: ConflictZone[] = [
  {
    id: 'syria-hts',
    name: 'Syria (HTS-controlled territory)',
    region: 'Middle East',
    status: 'active',
    estimatedFighters: 12_000,
    majorOriginCountries: ['Uzbekistan', 'Kazakhstan', 'Tajikistan', 'Russia', 'Morocco'],
    ideology: 'jihadist-sunni',
    faction: 'Hayat Tahrir al-Sham (HTS)',
    travelBanEffectiveness: 'low',
    peakYear: 2015,
    notes: 'Post-Assad consolidation has drawn continued Central Asian jihadist migration.',
  },
  {
    id: 'ukraine-russian',
    name: 'Ukraine (Russian-aligned)',
    region: 'Europe',
    status: 'active',
    estimatedFighters: 17_500,
    majorOriginCountries: ['North Korea', 'Burkina Faso', 'Mali', 'Serbia', 'Nepal'],
    ideology: 'nationalist',
    faction: 'Russian Armed Forces / Wagner successor units',
    travelBanEffectiveness: 'low',
    peakYear: 2024,
    notes: 'North Korean troop deployment represents a qualitative shift; African recruitment via Wagner successor networks.',
  },
  {
    id: 'ukraine-ukrainian',
    name: 'Ukraine (Ukrainian Foreign Legion)',
    region: 'Europe',
    status: 'active',
    estimatedFighters: 3500,
    majorOriginCountries: ['USA', 'UK', 'Canada', 'Poland', 'Georgia'],
    ideology: 'pro-western',
    faction: 'Ukrainian International Legion of Defense',
    travelBanEffectiveness: 'high',
    peakYear: 2022,
    notes: 'Formalized volunteer structure; Western governments have implemented travel advisories.',
  },
  {
    id: 'gaza-factions',
    name: 'Gaza (Palestinian factions)',
    region: 'Middle East',
    status: 'active',
    estimatedFighters: 1800,
    majorOriginCountries: ['Lebanon', 'Iran', 'Iraq', 'Yemen'],
    ideology: 'jihadist-sunni',
    faction: 'Hamas / Palestinian Islamic Jihad',
    travelBanEffectiveness: 'moderate',
    peakYear: 2023,
    notes: 'Primarily Hezbollah-linked and Iranian-proxy fighters channeled through Lebanon and Syria corridors.',
  },
  {
    id: 'yemen-houthis',
    name: 'Yemen (Houthi forces)',
    region: 'Middle East',
    status: 'active',
    estimatedFighters: 3200,
    majorOriginCountries: ['Iraq', 'Lebanon', 'Afghanistan', 'Somalia'],
    ideology: 'jihadist-shia',
    faction: 'Ansarallah (Houthis)',
    travelBanEffectiveness: 'low',
    peakYear: 2017,
    notes: 'Iran-facilitated Shia fighter networks; Iraqi Popular Mobilization Units provide experienced cadre.',
  },
  {
    id: 'sahel-jihadist',
    name: 'Sahel (Mali / Niger / Burkina Faso)',
    region: 'Sub-Saharan Africa',
    status: 'active',
    estimatedFighters: 2400,
    majorOriginCountries: ['Mauritania', 'Senegal', 'Nigeria', 'Chad'],
    ideology: 'jihadist-sunni',
    faction: 'JNIM / ISGS (IS-Sahel)',
    travelBanEffectiveness: 'low',
    peakYear: 2022,
    notes: 'French withdrawal created vacuum; Wagner-linked and JNIM expansion accelerated regional recruitment.',
  },
  {
    id: 'sudan-rsf',
    name: 'Sudan (RSF / SAF conflict)',
    region: 'Sub-Saharan Africa',
    status: 'active',
    estimatedFighters: 2800,
    majorOriginCountries: ['Chad', 'CAR', 'Libya', 'Niger'],
    ideology: 'mercenary',
    faction: 'Rapid Support Forces (RSF)',
    travelBanEffectiveness: 'low',
    peakYear: 2024,
    notes: 'RSF drawing on established Janjaweed cross-border networks and UAE-linked contractor pipelines.',
  },
  {
    id: 'myanmar-tnla',
    name: 'Myanmar (ethnic armed alliances)',
    region: 'Southeast Asia',
    status: 'active',
    estimatedFighters: 900,
    majorOriginCountries: ['China (diaspora)', 'India (Manipur)', 'Thailand', 'Bangladesh'],
    ideology: 'ethnic-nationalist',
    faction: 'Three Brotherhood Alliance / PDF',
    travelBanEffectiveness: 'moderate',
    peakYear: 2023,
    notes: 'Primarily ethnic-diaspora motivated; Chinese-background fighters in Kokang/Shan networks.',
  },
  {
    id: 'somalia-alshabaab',
    name: 'Somalia (al-Shabaab)',
    region: 'Sub-Saharan Africa',
    status: 'declining',
    estimatedFighters: 2100,
    majorOriginCountries: ['Kenya', 'Tanzania', 'Ethiopia', 'Sudan'],
    ideology: 'jihadist-sunni',
    faction: 'Harakat al-Shabaab al-Mujahideen',
    travelBanEffectiveness: 'moderate',
    peakYear: 2011,
    notes: 'AMISOM/ATMIS military pressure has reduced foreign intake; diaspora financing remains significant.',
  },
  {
    id: 'iraq-is-remnants',
    name: 'Iraq (IS remnants)',
    region: 'Middle East',
    status: 'declining',
    estimatedFighters: 1600,
    majorOriginCountries: ['Syria', 'Libya', 'Tunisia', 'Egypt'],
    ideology: 'jihadist-sunni',
    faction: 'Islamic State (IS) Iraq Province',
    travelBanEffectiveness: 'moderate',
    peakYear: 2014,
    notes: 'Persistent IS sleeper cells in Kirkuk/Diyala; cross-border flows from Syria remain the primary intake route.',
  },
];

export const RECRUITMENT_INCIDENTS: RecruitmentIncident[] = [
  {
    id: 'ri-001',
    date: '2023-04',
    title: 'ISIS Syria Resurgence Recruitment Drive',
    actor: 'Islamic State Central',
    method: 'social-media',
    targetRegion: 'Central Asia',
    estimatedRecruits: 800,
    ideology: 'jihadist-sunni',
    significance: 'critical',
  },
  {
    id: 'ri-002',
    date: '2023-06',
    title: 'Wagner Group African Fighter Recruitment',
    actor: 'Wagner Group / Russia MoD',
    method: 'in-person',
    targetRegion: 'Sub-Saharan Africa',
    estimatedRecruits: 2500,
    ideology: 'mercenary',
    significance: 'critical',
  },
  {
    id: 'ri-003',
    date: '2023-09',
    title: 'Ukrainian Foreign Legion Expansion Campaign',
    actor: 'Ukrainian Ministry of Defense',
    method: 'official-channel',
    targetRegion: 'North America / Western Europe',
    estimatedRecruits: 1200,
    ideology: 'pro-western',
    significance: 'high',
  },
  {
    id: 'ri-004',
    date: '2023-11',
    title: 'HTS Foreign Fighter Consolidation Vetting',
    actor: 'Hayat Tahrir al-Sham',
    method: 'diaspora-networks',
    targetRegion: 'Central Asia / Europe',
    estimatedRecruits: 450,
    ideology: 'jihadist-sunni',
    significance: 'high',
  },
  {
    id: 'ri-005',
    date: '2023-12',
    title: 'RSF Sudan Mercenary Procurement Network',
    actor: 'Rapid Support Forces',
    method: 'proxy-state',
    targetRegion: 'Sahel / Chad Basin',
    estimatedRecruits: 1800,
    ideology: 'mercenary',
    significance: 'critical',
  },
  {
    id: 'ri-006',
    date: '2024-01',
    title: 'Houthi Social Media Recruitment Campaign',
    actor: 'Ansarallah Media Wing',
    method: 'social-media',
    targetRegion: 'East Africa / Horn',
    estimatedRecruits: 300,
    ideology: 'jihadist-shia',
    significance: 'moderate',
  },
  {
    id: 'ri-007',
    date: '2024-03',
    title: 'Russia MoD Formal African Volunteer Scheme',
    actor: 'Russian Ministry of Defense',
    method: 'official-channel',
    targetRegion: 'Francophone Africa',
    estimatedRecruits: 3200,
    ideology: 'nationalist',
    significance: 'critical',
  },
  {
    id: 'ri-008',
    date: '2024-06',
    title: 'JNIM Cross-Border Diaspora Recruitment',
    actor: 'Jamaat Nusrat al-Islam wal-Muslimin',
    method: 'diaspora-networks',
    targetRegion: 'Sahel / West Africa',
    estimatedRecruits: 560,
    ideology: 'jihadist-sunni',
    significance: 'high',
  },
];

export const GLOBAL_INDEX: GlobalForeignFighterIndex = {
  totalEstimated: 47_800,
  activeConflicts: 8,
  majorSourceRegions: ['Central Asia', 'Sub-Saharan Africa', 'Western Europe', 'North Africa'],
  trendDirection: 'increasing',
  highestVolumeConflict: 'Ukraine (Russian-aligned)',
  asOf: '2024-Q3',
};
