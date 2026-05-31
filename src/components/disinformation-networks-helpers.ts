/**
 * Pure helpers for DisinformationNetworksPanel.
 *
 * Tracks coordinated inauthentic behaviour (CIB), state-linked bot farms,
 * and platform takedowns.  Distinct from PropagandaTracking (which covers
 * overt state media); this module focuses on covert platform manipulation.
 *
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type ActorOrigin =
  | 'Russia'
  | 'China'
  | 'Iran'
  | 'Bangladesh'
  | 'Myanmar'
  | 'EU-enforcement'
  | 'unattributed';

export type NetworkScale = 'small' | 'medium' | 'large' | 'massive';

export type TakedownPlatform =
  | 'Meta'
  | 'Twitter/X'
  | 'Google/YouTube'
  | 'TikTok'
  | 'EU-DSA';

export type NetworkStatus = 'disrupted' | 'active' | 'restricted' | 'monitoring';

export type NarrativeTrend = 'escalating' | 'steady' | 'declining';

export type ActiveThreatLevel = 'low' | 'moderate' | 'high' | 'critical';

export interface CibTakedown {
  id: string;
  name: string;
  platform: TakedownPlatform;
  actor: string;
  actorOrigin: ActorOrigin;
  /** Primary accounts removed or actioned. */
  accountCount: number;
  /** Number of distinct platforms affected (for cross-platform ops). */
  platformsAffected: number;
  targetRegion: string;
  objective: string;
  /** ISO date string: YYYY-MM-DD */
  date: string;
  status: NetworkStatus;
  notableDetail: string;
}

export interface ActiveNetworkProfile {
  id: string;
  name: string;
  actorOrigin: ActorOrigin;
  estimatedAccounts: number;
  platforms: string[];
  primaryObjective: string;
  active: boolean;
  lastObserved: string;
  threat: ActiveThreatLevel;
}

export interface QuarterlyCibData {
  quarter: string;
  year: number;
  accountsRemoved: number;
  takedownCount: number;
}

export interface NarrativeHotspot {
  id: string;
  topic: string;
  regions: string[];
  intensity: number;
  primaryActors: ActorOrigin[];
  trend: NarrativeTrend;
}

// ── Static seed data ────────────────────────────────────────────────────────

export const CIB_TAKEDOWNS: CibTakedown[] = [
  {
    id: 'meta-ira-2024',
    name: 'Russian IRA Successor Network',
    platform: 'Meta',
    actor: 'IRA Successors (GRU-linked)',
    actorOrigin: 'Russia',
    accountCount: 60_000,
    platformsAffected: 4,
    targetRegion: 'US, EU elections',
    objective: 'Electoral interference, anti-Western sentiment',
    date: '2024-03-15',
    status: 'disrupted',
    notableDetail: 'Largest Russian CIB operation removed by Meta in a single action',
  },
  {
    id: 'meta-dragonbridge-2024',
    name: 'Dragonbridge (2024)',
    platform: 'Meta',
    actor: 'Dragonbridge (PRC-linked)',
    actorOrigin: 'China',
    accountCount: 7_704,
    platformsAffected: 15,
    targetRegion: 'Global — Taiwan, US, Tibetan communities',
    objective: 'Pro-PRC narratives, suppress dissent, Taiwan messaging',
    date: '2024-01-22',
    status: 'disrupted',
    notableDetail: 'Largest-ever single CIB takedown across 15 platforms',
  },
  {
    id: 'meta-iran-2023',
    name: 'Iranian CIB Network (Israel/US)',
    platform: 'Meta',
    actor: 'MOIS-linked operators',
    actorOrigin: 'Iran',
    accountCount: 1_400,
    platformsAffected: 2,
    targetRegion: 'Israel, United States',
    objective: 'Anti-Israel messaging, exploit Gaza conflict narrative',
    date: '2023-11-08',
    status: 'disrupted',
    notableDetail: 'Operated fake personas across Facebook and Instagram',
  },
  {
    id: 'meta-russia-europe-2023',
    name: 'Russian Anti-Ukraine Europe Network',
    platform: 'Meta',
    actor: 'Russian state-linked operators',
    actorOrigin: 'Russia',
    accountCount: 4_800,
    platformsAffected: 3,
    targetRegion: 'Germany, France, Italy, Poland',
    objective: 'Erode European support for Ukraine, amplify war fatigue',
    date: '2023-05-31',
    status: 'disrupted',
    notableDetail: 'Used fake news sites and translated RT content as cover',
  },
  {
    id: 'twitter-china-2023',
    name: 'Chinese State-Linked Twitter Network',
    platform: 'Twitter/X',
    actor: '50-cent army operators',
    actorOrigin: 'China',
    accountCount: 900,
    platformsAffected: 1,
    targetRegion: 'Tibet, Xinjiang, Hong Kong diaspora',
    objective: 'Suppress Uyghur and Tibetan rights narratives',
    date: '2023-06-01',
    status: 'disrupted',
    notableDetail: 'Accounts used coordinated replies to drown out activists',
  },
  {
    id: 'google-russia-youtube-2022',
    name: 'Russian YouTube Channel Network',
    platform: 'Google/YouTube',
    actor: 'Russian state media proxies',
    actorOrigin: 'Russia',
    accountCount: 1_080,
    platformsAffected: 1,
    targetRegion: 'Europe, North America',
    objective: 'Pro-Russia Ukraine war propaganda, anti-NATO messaging',
    date: '2022-07-14',
    status: 'disrupted',
    notableDetail: 'Over 1,000 channels removed; content justified Ukraine invasion',
  },
  {
    id: 'meta-bangladesh-2024',
    name: 'Bangladeshi Domestic Influence Network',
    platform: 'Meta',
    actor: 'Domestic political operators',
    actorOrigin: 'Bangladesh',
    accountCount: 2_900,
    platformsAffected: 1,
    targetRegion: 'Bangladesh',
    objective: 'Manufacture domestic political consensus, suppress opposition',
    date: '2024-02-07',
    status: 'disrupted',
    notableDetail: 'Operated fake local news pages and celebrity accounts',
  },
  {
    id: 'meta-myanmar-ongoing',
    name: 'Myanmar Military Network',
    platform: 'Meta',
    actor: 'Tatmadaw / SAC-linked operators',
    actorOrigin: 'Myanmar',
    accountCount: 425,
    platformsAffected: 1,
    targetRegion: 'Myanmar domestic population',
    objective: 'Legitimise military rule, demonise ethnic minorities',
    date: '2022-09-30',
    status: 'restricted',
    notableDetail: 'Meta maintains ongoing restrictions; network rebuilt multiple times',
  },
  {
    id: 'eu-dsa-x-2024',
    name: 'EU DSA Enforcement vs. X/Twitter',
    platform: 'EU-DSA',
    actor: 'X Corp (platform liability)',
    actorOrigin: 'EU-enforcement',
    accountCount: 0,
    platformsAffected: 1,
    targetRegion: 'European Union',
    objective: 'Regulatory action for failure to remove Russian disinformation',
    date: '2024-07-12',
    status: 'monitoring',
    notableDetail: 'First major DSA enforcement action; formal proceedings against X',
  },
  {
    id: 'tiktok-china-taiwan-2024',
    name: 'China-Linked Taiwan Influence Network',
    platform: 'TikTok',
    actor: 'PRC-aligned operators',
    actorOrigin: 'China',
    accountCount: 640,
    platformsAffected: 1,
    targetRegion: 'Taiwan, Taiwanese diaspora',
    objective: 'Undermine Taiwan election confidence, promote unification',
    date: '2024-01-05',
    status: 'disrupted',
    notableDetail: 'Removed before 2024 Taiwan presidential election',
  },
];

export const ACTIVE_NETWORK_PROFILES: ActiveNetworkProfile[] = [
  {
    id: 'ira-successors',
    name: 'IRA Successor Networks',
    actorOrigin: 'Russia',
    estimatedAccounts: 15_000,
    platforms: ['Telegram', 'X', 'Truth Social', 'local news sites'],
    primaryObjective: 'Election interference, EU fracture, pro-Russia sentiment',
    active: true,
    lastObserved: '2024-10-01',
    threat: 'critical',
  },
  {
    id: 'dragonbridge',
    name: 'Dragonbridge',
    actorOrigin: 'China',
    estimatedAccounts: 3_500,
    platforms: ['YouTube', 'Facebook', 'X', 'Reddit', 'Medium'],
    primaryObjective: 'Pro-PRC global narrative, Taiwan messaging, anti-US',
    active: true,
    lastObserved: '2024-09-15',
    threat: 'high',
  },
  {
    id: 'mois-network',
    name: 'Iranian MOIS Network',
    actorOrigin: 'Iran',
    estimatedAccounts: 800,
    platforms: ['Instagram', 'Facebook', 'X'],
    primaryObjective: 'Anti-Israel, pro-Hamas, exploit US domestic divisions',
    active: true,
    lastObserved: '2024-08-20',
    threat: 'high',
  },
  {
    id: '50-cent-army',
    name: 'Chinese 50-Cent Army (Wumao)',
    actorOrigin: 'China',
    estimatedAccounts: 50_000,
    platforms: ['Weibo', 'WeChat', 'X', 'YouTube'],
    primaryObjective: 'Domestic opinion management, international pro-PRC spam',
    active: true,
    lastObserved: '2024-10-05',
    threat: 'moderate',
  },
];

export const QUARTERLY_CIB_DATA: QuarterlyCibData[] = [
  { quarter: 'Q1 2022', year: 2022, accountsRemoved: 18_500, takedownCount: 4 },
  { quarter: 'Q2 2022', year: 2022, accountsRemoved: 22_300, takedownCount: 5 },
  { quarter: 'Q3 2022', year: 2022, accountsRemoved: 31_000, takedownCount: 7 },
  { quarter: 'Q4 2022', year: 2022, accountsRemoved: 28_700, takedownCount: 6 },
  { quarter: 'Q1 2023', year: 2023, accountsRemoved: 35_400, takedownCount: 8 },
  { quarter: 'Q2 2023', year: 2023, accountsRemoved: 41_200, takedownCount: 9 },
  { quarter: 'Q3 2023', year: 2023, accountsRemoved: 38_800, takedownCount: 8 },
  { quarter: 'Q4 2023', year: 2023, accountsRemoved: 52_100, takedownCount: 11 },
  { quarter: 'Q1 2024', year: 2024, accountsRemoved: 78_900, takedownCount: 14 },
  { quarter: 'Q2 2024', year: 2024, accountsRemoved: 63_500, takedownCount: 12 },
];

export const NARRATIVE_HOTSPOTS: NarrativeHotspot[] = [
  {
    id: 'elections-2024',
    topic: 'Election Integrity',
    regions: ['US', 'EU', 'Taiwan', 'India'],
    intensity: 92,
    primaryActors: ['Russia', 'China', 'Iran'],
    trend: 'escalating',
  },
  {
    id: 'ukraine-war',
    topic: 'Ukraine War Narrative',
    regions: ['Europe', 'US', 'Global South'],
    intensity: 88,
    primaryActors: ['Russia'],
    trend: 'steady',
  },
  {
    id: 'gaza-conflict',
    topic: 'Gaza / Israel-Palestine',
    regions: ['MENA', 'US', 'EU', 'Southeast Asia'],
    intensity: 84,
    primaryActors: ['Iran', 'Russia'],
    trend: 'steady',
  },
  {
    id: 'taiwan-strait',
    topic: 'Taiwan Strait',
    regions: ['Taiwan', 'APAC', 'US'],
    intensity: 79,
    primaryActors: ['China'],
    trend: 'escalating',
  },
  {
    id: 'climate-denial',
    topic: 'Climate / Energy Policy',
    regions: ['US', 'EU', 'Australia'],
    intensity: 61,
    primaryActors: ['Russia', 'unattributed'],
    trend: 'declining',
  },
];

// ── Helper functions ────────────────────────────────────────────────────────

/** Filter takedowns by actor origin. */
export function getByActor(
  takedowns: CibTakedown[],
  actor: ActorOrigin,
): CibTakedown[] {
  return takedowns.filter((t) => t.actorOrigin === actor);
}

/**
 * Filter takedowns whose account count is at or above `threshold`.
 * Defaults to 1 000 — "large" by typical platform transparency standards.
 */
export function getLargeNetworks(
  takedowns: CibTakedown[],
  threshold = 1_000,
): CibTakedown[] {
  return takedowns.filter((t) => t.accountCount >= threshold);
}

/** Return only active network profiles. */
export function getActiveNetworks(
  profiles: ActiveNetworkProfile[],
): ActiveNetworkProfile[] {
  return profiles.filter((p) => p.active);
}

/**
 * Find a narrative hotspot whose topic matches `topic` (case-insensitive
 * substring search).  Returns the first match or undefined.
 */
export function getByTargetNarrative(
  hotspots: NarrativeHotspot[],
  topic: string,
): NarrativeHotspot | undefined {
  const needle = topic.toLowerCase();
  return hotspots.find((h) => h.topic.toLowerCase().includes(needle));
}

/**
 * Classify an account count into a semantic scale bucket.
 *   < 500         => small
 *   500-4 999     => medium
 *   5 000-49 999  => large
 *   >= 50 000     => massive
 */
export function networkScaleClass(accountCount: number): NetworkScale {
  if (accountCount >= 50_000) return 'massive';
  if (accountCount >= 5_000) return 'large';
  if (accountCount >= 500) return 'medium';
  return 'small';
}

/**
 * Return a CSS colour variable string for the given actor origin.
 */
export function actorClass(origin: ActorOrigin): string {
  const map: Record<ActorOrigin, string> = {
    Russia: 'var(--actor-russia, #ef4444)',
    China: 'var(--actor-china, #f97316)',
    Iran: 'var(--actor-iran, #a855f7)',
    Bangladesh: 'var(--actor-regional, #3b82f6)',
    Myanmar: 'var(--actor-regional, #3b82f6)',
    'EU-enforcement': 'var(--actor-eu, #22c55e)',
    unattributed: 'var(--actor-unknown, #9e9e9e)',
  };
  return map[origin] ?? map['unattributed'];
}

/** Colour for a network status badge. */
export function statusColor(status: NetworkStatus): string {
  const map: Record<NetworkStatus, string> = {
    disrupted:  'var(--severity-low,      #4caf50)',
    active:     'var(--severity-critical, #ef4444)',
    restricted: 'var(--severity-medium,   #facc15)',
    monitoring: 'var(--severity-high,     #fb923c)',
  };
  return map[status];
}

/** Human-readable label for a NetworkScale. */
export function networkScaleLabel(scale: NetworkScale): string {
  const map: Record<NetworkScale, string> = {
    small:   'Small',
    medium:  'Medium',
    large:   'Large',
    massive: 'Massive',
  };
  return map[scale];
}

/** Colour for a narrative trend. */
export function trendColor(trend: NarrativeTrend): string {
  const map: Record<NarrativeTrend, string> = {
    escalating: 'var(--severity-critical, #ef4444)',
    steady:     'var(--severity-medium,   #facc15)',
    declining:  'var(--severity-low,      #4caf50)',
  };
  return map[trend];
}

/** Arrow + label for a narrative trend. */
export function trendLabel(trend: NarrativeTrend): string {
  const map: Record<NarrativeTrend, string> = {
    escalating: 'up Escalating',
    steady:     'right Steady',
    declining:  'down Declining',
  };
  return map[trend];
}

/** Colour for an active-threat-level badge. */
export function threatLevelColor(threat: ActiveThreatLevel): string {
  const map: Record<ActiveThreatLevel, string> = {
    critical: 'var(--severity-critical, #ef4444)',
    high:     'var(--severity-high,     #fb923c)',
    moderate: 'var(--severity-medium,   #facc15)',
    low:      'var(--severity-low,      #4caf50)',
  };
  return map[threat];
}

/** Formats a large number compactly (e.g. 60_000 => "60 k"). */
export function formatAccountCount(n: number): string {
  if (n === 0) return 'N/A';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} k`;
  return String(n);
}

// ── RenderData types ────────────────────────────────────────────────────────

export interface TakedownRow {
  id: string;
  name: string;
  platform: TakedownPlatform;
  actorLabel: string;
  actorColor: string;
  scaleLabel: string;
  scaleClass: NetworkScale;
  accountLabel: string;
  targetRegion: string;
  objective: string;
  date: string;
  statusLabel: string;
  statusColor: string;
  notableDetail: string;
}

export interface ProfileRow {
  id: string;
  name: string;
  actorColor: string;
  accountLabel: string;
  platformList: string;
  objective: string;
  threatLabel: string;
  threatColor: string;
  lastObserved: string;
  active: boolean;
}

export interface HotspotRow {
  id: string;
  topic: string;
  regionList: string;
  intensity: number;
  actorList: string;
  trendLabel: string;
  trendColor: string;
}

export interface CibRenderData {
  takedownRows: TakedownRow[];
  profileRows: ProfileRow[];
  quarterlyData: QuarterlyCibData[];
  hotspotRows: HotspotRow[];
  totalAccountsRemoved: number;
  totalTakedowns: number;
  activeNetworkCount: number;
  criticalHotspotCount: number;
}

/**
 * Assemble all render-ready data in one call.  Keeps the Panel class free
 * of business logic.
 */
export function buildRenderData(
  takedowns: CibTakedown[],
  profiles: ActiveNetworkProfile[],
  quarterly: QuarterlyCibData[],
  hotspots: NarrativeHotspot[],
): CibRenderData {
  const takedownRows: TakedownRow[] = takedowns.map((t) => ({
    id: t.id,
    name: t.name,
    platform: t.platform,
    actorLabel: t.actor,
    actorColor: actorClass(t.actorOrigin),
    scaleLabel: networkScaleLabel(networkScaleClass(t.accountCount)),
    scaleClass: networkScaleClass(t.accountCount),
    accountLabel: formatAccountCount(t.accountCount),
    targetRegion: t.targetRegion,
    objective: t.objective,
    date: t.date,
    statusLabel: t.status.toUpperCase(),
    statusColor: statusColor(t.status),
    notableDetail: t.notableDetail,
  }));

  const profileRows: ProfileRow[] = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    actorColor: actorClass(p.actorOrigin),
    accountLabel: formatAccountCount(p.estimatedAccounts),
    platformList: p.platforms.join(', '),
    objective: p.primaryObjective,
    threatLabel: p.threat.toUpperCase(),
    threatColor: threatLevelColor(p.threat),
    lastObserved: p.lastObserved,
    active: p.active,
  }));

  const hotspotRows: HotspotRow[] = hotspots
    .slice()
    .sort((a, b) => b.intensity - a.intensity)
    .map((h) => ({
      id: h.id,
      topic: h.topic,
      regionList: h.regions.join(', '),
      intensity: h.intensity,
      actorList: h.primaryActors.join(', '),
      trendLabel: trendLabel(h.trend),
      trendColor: trendColor(h.trend),
    }));

  const totalAccountsRemoved = quarterly.reduce((s, q) => s + q.accountsRemoved, 0);
  const totalTakedowns = quarterly.reduce((s, q) => s + q.takedownCount, 0);
  const activeNetworkCount = getActiveNetworks(profiles).length;
  const criticalHotspotCount = hotspots.filter((h) => h.intensity >= 80).length;

  return {
    takedownRows,
    profileRows,
    quarterlyData: quarterly,
    hotspotRows,
    totalAccountsRemoved,
    totalTakedowns,
    activeNetworkCount,
    criticalHotspotCount,
  };
}
