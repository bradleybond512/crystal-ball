/**
 * Pure helpers for CyberIncidentResponsePanel.
 *
 * No DOM, no fetch — safe to import in Node.js tests. The panel
 * (`CyberIncidentResponsePanel.ts`) is the thin DOM layer; everything
 * scoreable, sortable, or thresholdable lives here so tests can
 * exercise it without spinning up the Panel base class.
 */

import type { ObservationEvent } from '@/types/intelligence';

// ── Types ─────────────────────────────────────────────────────────────

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ApTActivity = 'dormant' | 'active' | 'campaign' | 'imminent';
export type IcsSector =
  | 'energy' | 'water' | 'health' | 'financial'
  | 'transport' | 'comms' | 'manufacturing';
export type IntelFeedSource = 'CISA-KEV' | 'OTX' | 'AbuseIPDB' | 'NVD' | 'MISP';
export type RansomwareTrend = 'rising' | 'falling' | 'flat';

export interface CveExploit {
  cveId: string;
  cvssScore: number;
  product: string;
  vendor: string;
  inKevCatalog: boolean;
  exploitedInWild: boolean;
  firstSeenAt: number;
  description: string;
}

export interface RansomwareCampaign {
  group: string;
  victimsLast7d: number;
  victimsLast30d: number;
  primarySector: IcsSector;
  trend: RansomwareTrend;
  notableVictim?: string;
}

export interface ApTGroup {
  name: string;
  attribution: string;
  primaryTargets: IcsSector[];
  activity: ApTActivity;
  recentEventCount: number;
  notableTtps: string[];
}

export interface IcsIndicator {
  sector: IcsSector;
  region: string;
  observedTtps: string[];
  severity: IncidentSeverity;
  detectedAt: number;
}

export interface IntelFeedRow {
  source: IntelFeedSource;
  newIndicators: number;
  highSeverityShare: number; // 0–1
  lastFetchedAt: number;
}

export interface CyberIncidentScore {
  /** 0–100 composite. */
  total: number;
  level: IncidentSeverity;
  contributions: {
    activeExploits: number;
    ransomware: number;
    apt: number;
    ics: number;
    feedActivity: number;
  };
}

// ── Color + label helpers ────────────────────────────────────────────

export function severityColor(s: IncidentSeverity): string {
  const map: Record<IncidentSeverity, string> = {
    low:      'var(--severity-low,      #4caf50)',
    medium:   'var(--severity-medium,   #facc15)',
    high:     'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return map[s];
}

export function severityLabel(s: IncidentSeverity): string {
  const map: Record<IncidentSeverity, string> = {
    low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
  };
  return map[s];
}

export function apTActivityColor(a: ApTActivity): string {
  const map: Record<ApTActivity, string> = {
    dormant:  'var(--severity-none,     #9e9e9e)',
    active:   'var(--severity-low,      #4caf50)',
    campaign: 'var(--severity-medium,   #facc15)',
    imminent: 'var(--severity-critical, #ef4444)',
  };
  return map[a];
}

export function apTActivityLabel(a: ApTActivity): string {
  const map: Record<ApTActivity, string> = {
    dormant: 'Dormant', active: 'Active', campaign: 'Campaign', imminent: 'Imminent',
  };
  return map[a];
}

export function icsSectorLabel(s: IcsSector): string {
  const map: Record<IcsSector, string> = {
    energy:        'Energy / Grid',
    water:         'Water / Utility',
    health:        'Healthcare',
    financial:     'Financial',
    transport:     'Transport',
    comms:         'Telecom',
    manufacturing: 'Manufacturing',
  };
  return map[s];
}

export function ransomwareTrendArrow(t: RansomwareTrend): string {
  const map: Record<RansomwareTrend, string> = { rising: '▲', falling: '▼', flat: '→' };
  return map[t];
}

export function ransomwareTrendColor(t: RansomwareTrend): string {
  const map: Record<RansomwareTrend, string> = {
    rising:  'var(--severity-critical, #ef4444)',
    falling: 'var(--severity-low,      #4caf50)',
    flat:    'var(--severity-none,     #9e9e9e)',
  };
  return map[t];
}

export function intelFeedColor(source: IntelFeedSource): string {
  const map: Record<IntelFeedSource, string> = {
    'CISA-KEV':  'var(--severity-critical, #ef4444)',
    OTX:         'var(--accent,            #4a9eff)',
    AbuseIPDB:   'var(--severity-high,     #fb923c)',
    NVD:         'var(--severity-medium,   #facc15)',
    MISP:        'var(--severity-low,      #4caf50)',
  };
  return map[source];
}

// ── Relative time ────────────────────────────────────────────────────

export function timeAgo(ts: number, now: number = Date.now()): string {
  const deltaMs = now - ts;
  if (deltaMs < 0) return 'future';
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Score math ───────────────────────────────────────────────────────

const CVE_ID_PATTERN = /CVE-\d{4}-\d{4,}/i;

function lowercaseSeverity(raw: string | undefined): IncidentSeverity {
  switch ((raw ?? '').toLowerCase()) {
    case 'critical': { return 'critical'; }
    case 'high':     { return 'high'; }
    case 'medium':   { return 'medium'; }
    default:         { return 'low'; }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export function levelForScore(score: number): IncidentSeverity {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

/** Composite 0–100 cyber-incident severity score. Each input is a
 *  saturating count → percentage contribution; weights sum to 100. */
export function computeIncidentScore(input: {
  activeExploits: number;
  ransomwareVictims7d: number;
  imminentAptGroups: number;
  criticalIcsIndicators: number;
  highSeverityFeedIndicators: number;
}): CyberIncidentScore {
  const activeExploits = clamp(input.activeExploits / 10, 0, 1) * 30;
  const ransomware     = clamp(input.ransomwareVictims7d / 50, 0, 1) * 20;
  const apt            = clamp(input.imminentAptGroups / 5, 0, 1) * 20;
  const ics            = clamp(input.criticalIcsIndicators / 10, 0, 1) * 20;
  const feedActivity   = clamp(input.highSeverityFeedIndicators / 200, 0, 1) * 10;
  const total = Math.round(activeExploits + ransomware + apt + ics + feedActivity);
  return {
    total,
    level: levelForScore(total),
    contributions: {
      activeExploits: Math.round(activeExploits),
      ransomware:     Math.round(ransomware),
      apt:            Math.round(apt),
      ics:            Math.round(ics),
      feedActivity:   Math.round(feedActivity),
    },
  };
}

// ── Live observation derivations ─────────────────────────────────────

/** Pull CVE exploits from cyber-domain events. Recognises a CVE id in
 *  either the title or any tag of form `cve:CVE-…`. */
export function deriveCveExploits(events: readonly ObservationEvent[], now: number = Date.now()): CveExploit[] {
  const out: CveExploit[] = [];
  const seen = new Set<string>();
  for (const o of events) {
    if (o.domain !== 'cyber') continue;
    if (now - o.timestamp > 14 * 24 * 60 * 60 * 1000) continue; // 14d window
    const cveId = extractCveId(o);
    if (!cveId) continue;
    if (seen.has(cveId)) continue;
    seen.add(cveId);
    const raw = (o.raw ?? {}) as Record<string, unknown>;
    out.push({
      cveId,
      cvssScore: typeof raw.cvss === 'number' ? raw.cvss : cvssFromSeverity(lowercaseSeverity(o.severity)),
      product:   typeof raw.product === 'string' ? raw.product : 'unknown',
      vendor:    typeof raw.vendor === 'string'  ? raw.vendor  : 'unknown',
      inKevCatalog:      o.tags.includes('kev')      || o.tags.includes('cisa-kev'),
      exploitedInWild:   o.tags.includes('exploited') || o.tags.includes('in-the-wild'),
      firstSeenAt:       o.timestamp,
      description:       o.title,
    });
  }
  out.sort((a, b) => Number(b.exploitedInWild) - Number(a.exploitedInWild) || b.cvssScore - a.cvssScore);
  return out.slice(0, 12);
}

function extractCveId(o: ObservationEvent): string | null {
  for (const t of o.tags) {
    if (t.startsWith('cve:')) {
      const id = t.slice('cve:'.length);
      if (CVE_ID_PATTERN.test(id)) return id.toUpperCase();
    }
  }
  const match = o.title.match(CVE_ID_PATTERN);
  return match ? match[0].toUpperCase() : null;
}

function cvssFromSeverity(s: IncidentSeverity): number {
  const map: Record<IncidentSeverity, number> = { low: 3.5, medium: 5.5, high: 7.5, critical: 9.5 };
  return map[s];
}

/** Count critical-ICS indicators across last 7 d. */
export function countCriticalIcsIndicators(indicators: readonly IcsIndicator[], now: number = Date.now()): number {
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  return indicators.filter((i) => i.severity === 'critical' && i.detectedAt >= cutoff).length;
}

/** Count ransomware victims hit in the last 7 d across all groups. */
export function totalRansomwareVictims7d(campaigns: readonly RansomwareCampaign[]): number {
  return campaigns.reduce((acc, c) => acc + c.victimsLast7d, 0);
}

/** Count APT groups currently flagged imminent. */
export function countImminentApT(groups: readonly ApTGroup[]): number {
  return groups.filter((g) => g.activity === 'imminent').length;
}

/** Sum high-severity indicators reported across all intel feeds today. */
export function sumHighSeverityFeedIndicators(feeds: readonly IntelFeedRow[]): number {
  return feeds.reduce((acc, f) => acc + Math.round(f.newIndicators * f.highSeverityShare), 0);
}

// ── Static reference catalogues ──────────────────────────────────────

export const RANSOMWARE_CAMPAIGNS: RansomwareCampaign[] = [
  { group: 'LockBit',         victimsLast7d: 18, victimsLast30d: 64, primarySector: 'manufacturing', trend: 'rising',  notableVictim: 'Tier-1 auto supplier (DE)' },
  { group: 'ALPHV/BlackCat',  victimsLast7d: 11, victimsLast30d: 39, primarySector: 'health',        trend: 'rising',  notableVictim: 'Regional hospital network (US)' },
  { group: 'Cl0p',            victimsLast7d:  6, victimsLast30d: 22, primarySector: 'financial',    trend: 'flat',    notableVictim: 'Mid-size bank (LATAM)' },
  { group: 'Royal',           victimsLast7d:  4, victimsLast30d: 18, primarySector: 'transport',    trend: 'falling' },
  { group: 'BlackBasta',      victimsLast7d:  8, victimsLast30d: 27, primarySector: 'manufacturing', trend: 'rising' },
  { group: 'Akira',           victimsLast7d:  5, victimsLast30d: 16, primarySector: 'comms',        trend: 'rising' },
];

export const APT_GROUPS: ApTGroup[] = [
  { name: 'APT29 (Cozy Bear)',     attribution: 'Russia SVR',      primaryTargets: ['energy', 'comms'],        activity: 'campaign',  recentEventCount: 9,  notableTtps: ['credential theft', 'cloud token abuse'] },
  { name: 'APT28 (Fancy Bear)',    attribution: 'Russia GRU',      primaryTargets: ['comms'],                   activity: 'campaign',  recentEventCount: 6,  notableTtps: ['phishing', 'router compromise'] },
  { name: 'Volt Typhoon',          attribution: 'PRC MSS',          primaryTargets: ['energy', 'water'],        activity: 'imminent',  recentEventCount: 14, notableTtps: ['LOTL', 'fortinet exploitation'] },
  { name: 'Salt Typhoon',          attribution: 'PRC MSS',          primaryTargets: ['comms'],                   activity: 'campaign',  recentEventCount: 11, notableTtps: ['telco backbone access', 'lawful-intercept abuse'] },
  { name: 'Lazarus Group',         attribution: 'DPRK',             primaryTargets: ['financial'],              activity: 'campaign',  recentEventCount: 8,  notableTtps: ['supply-chain', 'cryptocurrency theft'] },
  { name: 'APT34 (OilRig)',        attribution: 'Iran MOIS',        primaryTargets: ['energy'],                  activity: 'active',    recentEventCount: 4,  notableTtps: ['DNS tunnelling', 'malicious LinkedIn outreach'] },
  { name: 'Sandworm',              attribution: 'Russia GRU',      primaryTargets: ['energy'],                  activity: 'imminent',  recentEventCount: 12, notableTtps: ['wiper deployment', 'ICS protocol abuse'] },
  { name: 'Mustang Panda',         attribution: 'PRC',              primaryTargets: ['manufacturing'],          activity: 'active',    recentEventCount: 5,  notableTtps: ['PlugX', 'USB worm'] },
];

export const ICS_INDICATORS_BASE: readonly IcsIndicator[] = [
  { sector: 'energy', region: 'US East', observedTtps: ['LOTL persistence', 'OT credential dump'],      severity: 'critical', detectedAt: Date.now() - 12 * 60 * 60 * 1000 },
  { sector: 'water',  region: 'EU',      observedTtps: ['unauth ICS protocol writes'],                  severity: 'critical', detectedAt: Date.now() -  6 * 60 * 60 * 1000 },
  { sector: 'health', region: 'US Midwest', observedTtps: ['ransomware lateral movement'],              severity: 'high',     detectedAt: Date.now() - 36 * 60 * 60 * 1000 },
  { sector: 'energy', region: 'EU',      observedTtps: ['Fortinet exploit attempt', 'SMB brute force'], severity: 'high',     detectedAt: Date.now() - 18 * 60 * 60 * 1000 },
  { sector: 'comms',  region: 'APAC',    observedTtps: ['BGP hijack attempt'],                          severity: 'medium',   detectedAt: Date.now() - 48 * 60 * 60 * 1000 },
  { sector: 'transport', region: 'EU',   observedTtps: ['rail signalling probe'],                       severity: 'medium',   detectedAt: Date.now() - 30 * 60 * 60 * 1000 },
];

export const INTEL_FEEDS_BASE: readonly IntelFeedRow[] = [
  { source: 'CISA-KEV',  newIndicators: 12,  highSeverityShare: 1.00, lastFetchedAt: Date.now() -  5 * 60 * 1000 },
  { source: 'OTX',       newIndicators: 412, highSeverityShare: 0.22, lastFetchedAt: Date.now() -  9 * 60 * 1000 },
  { source: 'AbuseIPDB', newIndicators: 980, highSeverityShare: 0.31, lastFetchedAt: Date.now() -  8 * 60 * 1000 },
  { source: 'NVD',       newIndicators: 26,  highSeverityShare: 0.42, lastFetchedAt: Date.now() - 17 * 60 * 1000 },
  { source: 'MISP',      newIndicators: 215, highSeverityShare: 0.27, lastFetchedAt: Date.now() - 11 * 60 * 1000 },
];
