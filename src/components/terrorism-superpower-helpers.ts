/**
 * Pure helpers for TerrorismSuperpowerPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 */

import type { ObservationEvent } from '@/types/intelligence';

// ── Types ─────────────────────────────────────────────────────────────────

export type AttackMethod = 'bombing' | 'shooting' | 'vehicle' | 'cyber' | 'chemical';
export type GroupActivityLevel = 'dormant' | 'active' | 'elevated' | 'critical';
export type RadicalizationSignalType = 'recruitment' | 'propaganda' | 'financing' | 'training';
export type ThreatLevel = 0 | 1 | 2 | 3 | 4;
export type AttackTrend = 'rising' | 'falling' | 'flat';
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SignalConfidence = 'low' | 'medium' | 'high';

export interface ActiveThreat {
  id: string;
  group: string;
  location: string;
  attackType: AttackMethod;
  severity: IncidentSeverity;
  /** Epoch ms when the incident was detected/reported. */
  detectedAt: number;
}

export interface AttackPatternRow {
  method: AttackMethod;
  count: number;
  trend: AttackTrend;
}

export interface GroupActivity {
  name: string;
  region: string;
  activityLevel: GroupActivityLevel;
  recentEventCount: number;
}

export type ThreatZoneName =
  | 'Western Europe' | 'Eastern Europe' | 'Middle East' | 'North Africa'
  | 'Sub-Saharan Africa' | 'South Asia' | 'Southeast Asia' | 'Americas';

export interface ThreatZone {
  region: ThreatZoneName;
  level: ThreatLevel;
  rationale: string;
}

export interface RadicalizationSignal {
  signalType: RadicalizationSignalType;
  region: string;
  confidence: SignalConfidence;
  severity: IncidentSeverity;
  note: string;
}

// ── Color + label helpers ────────────────────────────────────────────────

export function severityColor(level: IncidentSeverity): string {
  const map: Record<IncidentSeverity, string> = {
    low:      'var(--severity-low,      #4caf50)',
    medium:   'var(--severity-medium,   #facc15)',
    high:     'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return map[level];
}

export function severityLabel(level: IncidentSeverity): string {
  const map: Record<IncidentSeverity, string> = {
    low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
  };
  return map[level];
}

export function attackMethodLabel(m: AttackMethod): string {
  const map: Record<AttackMethod, string> = {
    bombing: 'Bombing / IED',
    shooting: 'Armed Assault',
    vehicle: 'Vehicle Ramming',
    cyber: 'Cyber Attack',
    chemical: 'Chemical / Biological',
  };
  return map[m];
}

export function attackMethodColor(m: AttackMethod): string {
  const map: Record<AttackMethod, string> = {
    bombing:  'var(--severity-critical, #ef4444)',
    shooting: 'var(--severity-high,     #fb923c)',
    vehicle:  'var(--severity-medium,   #facc15)',
    cyber:    'var(--accent,            #4a9eff)',
    chemical: 'var(--severity-critical, #b71c1c)',
  };
  return map[m];
}

export function trendArrow(t: AttackTrend): string {
  const map: Record<AttackTrend, string> = { rising: '▲', falling: '▼', flat: '→' };
  return map[t];
}

export function trendColor(t: AttackTrend): string {
  const map: Record<AttackTrend, string> = {
    rising:  'var(--severity-critical, #ef4444)',
    falling: 'var(--severity-low,      #4caf50)',
    flat:    'var(--severity-none,     #9e9e9e)',
  };
  return map[t];
}

export function activityColor(level: GroupActivityLevel): string {
  const map: Record<GroupActivityLevel, string> = {
    dormant:  'var(--severity-none,     #9e9e9e)',
    active:   'var(--severity-low,      #4caf50)',
    elevated: 'var(--severity-medium,   #facc15)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return map[level];
}

export function activityLabel(level: GroupActivityLevel): string {
  const map: Record<GroupActivityLevel, string> = {
    dormant: 'Dormant', active: 'Active', elevated: 'Elevated', critical: 'Critical',
  };
  return map[level];
}

export function threatLevelColor(level: ThreatLevel): string {
  const map: Record<ThreatLevel, string> = {
    0: 'var(--severity-none,     #9e9e9e)',
    1: 'var(--severity-low,      #4caf50)',
    2: 'var(--severity-medium,   #facc15)',
    3: 'var(--severity-high,     #fb923c)',
    4: 'var(--severity-critical, #ef4444)',
  };
  return map[level];
}

export function threatLevelLabel(level: ThreatLevel): string {
  const map: Record<ThreatLevel, string> = {
    0: 'Minimal', 1: 'Low', 2: 'Moderate', 3: 'High', 4: 'Severe',
  };
  return map[level];
}

export function signalTypeLabel(s: RadicalizationSignalType): string {
  const map: Record<RadicalizationSignalType, string> = {
    recruitment: 'Recruitment',
    propaganda:  'Propaganda',
    financing:   'Financing',
    training:    'Training Camp',
  };
  return map[s];
}

export function confidenceLabel(c: SignalConfidence): string {
  const map: Record<SignalConfidence, string> = {
    low: 'Low conf', medium: 'Med conf', high: 'High conf',
  };
  return map[c];
}

export function confidenceWidthPct(c: SignalConfidence): number {
  const map: Record<SignalConfidence, number> = { low: 33, medium: 66, high: 100 };
  return map[c];
}

// ── Relative time ─────────────────────────────────────────────────────────

/** Format `(now - ts)` as a short "Xm ago" / "Xh ago" / "Xd ago" string.
 *  Returns "now" when delta is < 60 s. Future timestamps return "future". */
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

// ── Derivations from live ObservationEvents ──────────────────────────────

/** Order severities by escalation so we can sort highest-first. */
const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  low: 1, medium: 2, high: 3, critical: 4,
};

function lowercaseSeverity(raw: string | undefined): IncidentSeverity {
  switch ((raw ?? '').toLowerCase()) {
    case 'critical': { return 'critical'; }
    case 'high':     { return 'high'; }
    case 'medium':   { return 'medium'; }
    default:         { return 'low'; }
  }
}

function classifyAttackMethod(tags: readonly string[], title: string): AttackMethod | null {
  const haystack = `${title} ${tags.join(' ')}`.toLowerCase();
  if (/(bomb|ied|explosi|grenade|suicide)/.test(haystack)) return 'bombing';
  if (/(shoot|gunman|armed assault|gunfire|massacre|firearm)/.test(haystack)) return 'shooting';
  if (/(vehicle|ramming|truck attack|car attack)/.test(haystack)) return 'vehicle';
  if (/(cyber|hack|ransomware|ddos)/.test(haystack)) return 'cyber';
  if (/(chemical|biolog|nerve agent|sarin|anthrax)/.test(haystack)) return 'chemical';
  return null;
}

function extractGroupName(tags: readonly string[], title: string): string {
  // Tags prefixed `group:Foo` win; otherwise scan title for known group names.
  for (const t of tags) {
    if (t.startsWith('group:')) return t.slice('group:'.length);
  }
  const known = ['ISIS', 'Al-Qaeda', 'JNIM', 'Boko Haram', 'Hamas', 'Hezbollah', 'Al-Shabaab', 'TTP'];
  for (const k of known) {
    if (title.toLowerCase().includes(k.toLowerCase())) return k;
  }
  return 'Unattributed';
}

function locationFromObservation(o: ObservationEvent): string {
  if (o.location && typeof o.location.lat === 'number' && typeof o.location.lon === 'number') {
    return `${o.location.lat.toFixed(2)}, ${o.location.lon.toFixed(2)}`;
  }
  return 'Unknown';
}

/** Build the Active Threat Monitor rows from terrorism-domain observations.
 *  Sorted highest-severity-first, then newest-first. Cap at 10 rows. */
export function deriveActiveThreats(events: readonly ObservationEvent[], now: number = Date.now()): ActiveThreat[] {
  const rows: ActiveThreat[] = [];
  for (const o of events) {
    if (o.domain !== 'terrorism') continue;
    const method = classifyAttackMethod(o.tags, o.title);
    if (!method) continue;
    const severity = lowercaseSeverity(o.severity);
    if (now - o.timestamp > 48 * 60 * 60 * 1000) continue; // only last 48h
    rows.push({
      id: o.id,
      group: extractGroupName(o.tags, o.title),
      location: locationFromObservation(o),
      attackType: method,
      severity,
      detectedAt: o.timestamp,
    });
  }
  rows.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.detectedAt - a.detectedAt;
  });
  return rows.slice(0, 10);
}

/** Group last-30-day terrorism events by attack method. Trend compares the
 *  most recent 7 days against the prior 7 days. */
export function deriveAttackPatterns(events: readonly ObservationEvent[], now: number = Date.now()): AttackPatternRow[] {
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const sevenDayCutoff = now - 7 * 24 * 60 * 60 * 1000;
  const fourteenDayCutoff = now - 14 * 24 * 60 * 60 * 1000;
  const buckets = new Map<AttackMethod, { total: number; recent: number; prior: number }>();
  const methods: AttackMethod[] = ['bombing', 'shooting', 'vehicle', 'cyber', 'chemical'];
  for (const m of methods) buckets.set(m, { total: 0, recent: 0, prior: 0 });
  for (const o of events) {
    if (o.domain !== 'terrorism') continue;
    if (o.timestamp < cutoff) continue;
    const method = classifyAttackMethod(o.tags, o.title);
    if (!method) continue;
    const bucket = buckets.get(method)!;
    bucket.total += 1;
    if (o.timestamp >= sevenDayCutoff) bucket.recent += 1;
    else if (o.timestamp >= fourteenDayCutoff) bucket.prior += 1;
  }
  const rows: AttackPatternRow[] = [];
  for (const m of methods) {
    const b = buckets.get(m)!;
    let trend: AttackTrend = 'flat';
    if (b.recent > b.prior * 1.2) trend = 'rising';
    else if (b.recent < b.prior * 0.8) trend = 'falling';
    rows.push({ method: m, count: b.total, trend });
  }
  return rows;
}

// ── Static reference catalogues ──────────────────────────────────────────

export const DESIGNATED_GROUPS: GroupActivity[] = [
  { name: 'ISIS / ISIL',  region: 'Iraq / Syria / Africa', activityLevel: 'critical', recentEventCount: 42 },
  { name: 'Al-Qaeda',     region: 'Yemen / Maghreb',       activityLevel: 'elevated', recentEventCount: 18 },
  { name: 'JNIM',         region: 'Sahel',                 activityLevel: 'critical', recentEventCount: 36 },
  { name: 'Boko Haram',   region: 'Lake Chad Basin',       activityLevel: 'elevated', recentEventCount: 21 },
  { name: 'Al-Shabaab',   region: 'Somalia / Kenya',       activityLevel: 'critical', recentEventCount: 28 },
  { name: 'Hamas',        region: 'Gaza / Israel',         activityLevel: 'elevated', recentEventCount: 15 },
  { name: 'Hezbollah',    region: 'Lebanon / Syria',       activityLevel: 'active',   recentEventCount: 6 },
  { name: 'TTP',          region: 'Pakistan / Afghanistan', activityLevel: 'elevated', recentEventCount: 19 },
  { name: 'PKK',          region: 'Turkey / Iraq',         activityLevel: 'active',   recentEventCount: 4 },
  { name: 'Houthis',      region: 'Yemen / Red Sea',       activityLevel: 'elevated', recentEventCount: 12 },
  { name: 'FARC dissidents', region: 'Colombia',          activityLevel: 'active',   recentEventCount: 3 },
  { name: 'NPA',          region: 'Philippines',           activityLevel: 'dormant',  recentEventCount: 1 },
];

export const THREAT_ZONES: ThreatZone[] = [
  { region: 'Western Europe',     level: 2, rationale: 'Lone-actor risk from returning fighters and propaganda' },
  { region: 'Eastern Europe',     level: 2, rationale: 'War-driven extremist recruitment and weapons flow' },
  { region: 'Middle East',        level: 4, rationale: 'Active hostilities and multiple high-capability groups' },
  { region: 'North Africa',       level: 3, rationale: 'Border instability and porous Sahel boundary' },
  { region: 'Sub-Saharan Africa', level: 4, rationale: 'JNIM, ISWAP, Al-Shabaab expansion across the Sahel' },
  { region: 'South Asia',         level: 3, rationale: 'TTP resurgence and Afghan instability' },
  { region: 'Southeast Asia',     level: 1, rationale: 'Diminished group capability; sporadic plots' },
  { region: 'Americas',           level: 1, rationale: 'Lone-actor risk; limited transnational group presence' },
];

export const RADICALIZATION_SIGNALS: RadicalizationSignal[] = [
  { signalType: 'propaganda',  region: 'Sahel',           confidence: 'high',   severity: 'high',     note: 'Surge in JNIM video releases across encrypted channels' },
  { signalType: 'recruitment', region: 'Western Europe',  confidence: 'medium', severity: 'medium',   note: 'Tier-2 platform takedowns reveal active recruiter networks' },
  { signalType: 'financing',   region: 'Levant',          confidence: 'medium', severity: 'high',     note: 'Crypto inflows to suspected ISIS-K wallets up 3x QoQ' },
  { signalType: 'training',    region: 'Northern Syria',  confidence: 'high',   severity: 'critical', note: 'Reactivation of camps near former ISIS strongholds' },
  { signalType: 'recruitment', region: 'Horn of Africa',  confidence: 'high',   severity: 'high',     note: 'Al-Shabaab youth wing aggressive cross-border outreach' },
  { signalType: 'propaganda',  region: 'South Asia',      confidence: 'medium', severity: 'medium',   note: 'TTP rebrand campaign across Telegram + Rocketchat' },
];

// ── Aggregations ─────────────────────────────────────────────────────────

export function countCriticalGroups(groups: GroupActivity[]): number {
  return groups.filter((g) => g.activityLevel === 'critical' || g.activityLevel === 'elevated').length;
}

export function countSevereZones(zones: ThreatZone[]): number {
  return zones.filter((z) => z.level >= 3).length;
}

export function countCriticalSignals(signals: RadicalizationSignal[]): number {
  return signals.filter((s) => s.severity === 'critical' || s.severity === 'high').length;
}
