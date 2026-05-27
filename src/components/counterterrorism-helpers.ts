/**
 * Pure helpers for CounterterrorismPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 *
 * Sections:
 *   1. Terrorism incident trends by region/quarter
 *   2. Active threat groups by region
 *   3. Attack vector analysis
 *   4. Country threat level assessments
 *   5. High-impact recent events
 */

import { escapeHtml } from '@/utils/sanitize';

// ── Types ─────────────────────────────────────────────────────────────────

export type ThreatLevel = 'low' | 'moderate' | 'substantial' | 'severe' | 'critical';
export type AttackVector =
  | 'vehicle'
  | 'ied'
  | 'cbrn'
  | 'cyber_enabled'
  | 'active_shooter'
  | 'suicide_bombing'
  | 'kidnapping'
  | 'arson';
export type GroupAffiliation =
  | 'isis_isil'
  | 'al_qaeda'
  | 'domestic_extremist'
  | 'separatist'
  | 'narco_terrorist'
  | 'lone_wolf'
  | 'state_sponsored';
export type IncidentDomain =
  | 'europe'
  | 'middle_east'
  | 'africa'
  | 'south_asia'
  | 'southeast_asia'
  | 'americas'
  | 'central_asia';
export type ActivityTrend = 'increasing' | 'stable' | 'decreasing' | 'resurgent' | 'dormant';

export interface TerrorismIncidentTrend {
  domain: IncidentDomain;
  quarter: string;
  incidentCount: number;
  fatalityCount: number;
  dominantVector: AttackVector;
  trend: ActivityTrend;
  notes: string;
}

export interface ThreatGroup {
  name: string;
  affiliation: GroupAffiliation;
  primaryRegion: string;
  activeInRegions: string[];
  activityTrend: ActivityTrend;
  estimatedStrength: number;
  lastKnownActivity: string;
  threatLevel: ThreatLevel;
  notes: string;
}

export interface AttackVectorStat {
  vector: AttackVector;
  incidentsPast12Months: number;
  fatalitiesPast12Months: number;
  percentOfTotal: number;
  trend: ActivityTrend;
  primaryRegion: string;
}

export interface CountryThreatAssessment {
  country: string;
  iso3: string;
  threatLevel: ThreatLevel;
  primaryThreatGroup: string;
  incidentsPast12Months: number;
  fatalitiesPast12Months: number;
  notes: string;
}

export interface HighImpactEvent {
  date: string;
  location: string;
  country: string;
  vector: AttackVector;
  affiliation: GroupAffiliation;
  killed: number;
  wounded: number;
  summary: string;
  significance: ThreatLevel;
}

// ── Color / label tables ──────────────────────────────────────────────────

export function threatLevelColor(level: ThreatLevel): string {
  const colors: Record<ThreatLevel, string> = {
    low:         'var(--severity-low,      #22c55e)',
    moderate:    'var(--severity-info,     #3b82f6)',
    substantial: 'var(--severity-medium,   #f59e0b)',
    severe:      'var(--severity-high,     #fb923c)',
    critical:    'var(--severity-critical, #ef4444)',
  };
  return colors[level];
}

export function threatLevelLabel(level: ThreatLevel): string {
  const labels: Record<ThreatLevel, string> = {
    low:         'Low',
    moderate:    'Moderate',
    substantial: 'Substantial',
    severe:      'Severe',
    critical:    'Critical',
  };
  return labels[level];
}

export function attackVectorLabel(v: AttackVector): string {
  const labels: Record<AttackVector, string> = {
    vehicle:        'Vehicle Attack',
    ied:            'IED / Bombing',
    cbrn:           'CBRN',
    cyber_enabled:  'Cyber-Enabled',
    active_shooter: 'Active Shooter',
    suicide_bombing:'Suicide Bombing',
    kidnapping:     'Kidnapping',
    arson:          'Arson',
  };
  return labels[v];
}

export function groupAffiliationLabel(a: GroupAffiliation): string {
  const labels: Record<GroupAffiliation, string> = {
    isis_isil:          'ISIS/ISIL',
    al_qaeda:           'Al-Qaeda Affiliate',
    domestic_extremist: 'Domestic Extremist',
    separatist:         'Separatist',
    narco_terrorist:    'Narco-Terrorist',
    lone_wolf:          'Lone Wolf',
    state_sponsored:    'State-Sponsored',
  };
  return labels[a];
}

export function incidentDomainLabel(d: IncidentDomain): string {
  const labels: Record<IncidentDomain, string> = {
    europe:         'Europe',
    middle_east:    'Middle East',
    africa:         'Africa',
    south_asia:     'South Asia',
    southeast_asia: 'Southeast Asia',
    americas:       'Americas',
    central_asia:   'Central Asia',
  };
  return labels[d];
}

export function activityTrendLabel(t: ActivityTrend): string {
  const labels: Record<ActivityTrend, string> = {
    increasing: 'Increasing',
    stable:     'Stable',
    decreasing: 'Decreasing',
    resurgent:  'Resurgent',
    dormant:    'Dormant',
  };
  return labels[t];
}

export function activityTrendColor(t: ActivityTrend): string {
  const colors: Record<ActivityTrend, string> = {
    increasing: 'var(--severity-critical, #ef4444)',
    stable:     'var(--severity-medium,   #f59e0b)',
    decreasing: 'var(--severity-low,      #22c55e)',
    resurgent:  'var(--severity-high,     #fb923c)',
    dormant:    'var(--text-secondary,    #9e9e9e)',
  };
  return colors[t];
}

// ── Derived / computed helpers ─────────────────────────────────────────────

export function groupSeverityScore(group: ThreatGroup): number {
  const levelWeights: Record<ThreatLevel, number> = {
    low: 5, moderate: 20, substantial: 40, severe: 65, critical: 90,
  };
  const trendBonus: Record<ActivityTrend, number> = {
    increasing: 10, resurgent: 8, stable: 0, decreasing: -5, dormant: -10,
  };
  const base = levelWeights[group.threatLevel];
  const bonus = trendBonus[group.activityTrend];
  const regionBonus = Math.min(group.activeInRegions.length * 2, 10);
  return Math.max(0, Math.min(100, base + bonus + regionBonus));
}

export function classifyFromIncidentData(
  incidents: number,
  fatalities: number,
): ThreatLevel {
  const score = incidents * 1 + fatalities * 2;
  if (score >= 200) return 'critical';
  if (score >= 100) return 'severe';
  if (score >= 50)  return 'substantial';
  if (score >= 20)  return 'moderate';
  return 'low';
}

export function aggregateIncidents(
  trends: TerrorismIncidentTrend[],
  quarter?: string,
): number {
  const filtered = quarter
    ? trends.filter(t => t.quarter === quarter)
    : trends;
  return filtered.reduce((sum, t) => sum + t.incidentCount, 0);
}

export function aggregateFatalities(
  trends: TerrorismIncidentTrend[],
  quarter?: string,
): number {
  const filtered = quarter
    ? trends.filter(t => t.quarter === quarter)
    : trends;
  return filtered.reduce((sum, t) => sum + t.fatalityCount, 0);
}

export function countActiveThreatGroups(groups: ThreatGroup[]): number {
  return groups.filter(
    g => g.activityTrend === 'increasing' || g.activityTrend === 'resurgent',
  ).length;
}

export function countHighThreatCountries(assessments: CountryThreatAssessment[]): number {
  return assessments.filter(
    a => a.threatLevel === 'severe' || a.threatLevel === 'critical',
  ).length;
}

export function countHighImpactEvents(events: HighImpactEvent[]): number {
  return events.filter(
    e => e.significance === 'severe' || e.significance === 'critical',
  ).length;
}

export function sortGroupsBySeverity(groups: ThreatGroup[]): ThreatGroup[] {
  return [...groups].sort(
    (a, b) => groupSeverityScore(b) - groupSeverityScore(a),
  );
}

export function sortCountriesByIncidents(
  assessments: CountryThreatAssessment[],
): CountryThreatAssessment[] {
  return [...assessments].sort(
    (a, b) => b.incidentsPast12Months - a.incidentsPast12Months,
  );
}

export function sortEventsByCasualties(events: HighImpactEvent[]): HighImpactEvent[] {
  return [...events].sort(
    (a, b) => (b.killed + b.wounded) - (a.killed + a.wounded),
  );
}

export function sortVectorsByIncidents(stats: AttackVectorStat[]): AttackVectorStat[] {
  return [...stats].sort((a, b) => b.incidentsPast12Months - a.incidentsPast12Months);
}

export function dominantVector(stats: AttackVectorStat[]): AttackVector | null {
  if (stats.length === 0) return null;
  return sortVectorsByIncidents(stats)[0]?.vector ?? null;
}

export function formatActiveRegions(group: ThreatGroup): string {
  if (group.activeInRegions.length === 0) return 'Unknown';
  return group.activeInRegions.join(', ');
}

// ── Mock data fixtures ─────────────────────────────────────────────────────

export const INCIDENT_TRENDS: TerrorismIncidentTrend[] = [
  {
    domain: 'middle_east',
    quarter: 'Q1 2025',
    incidentCount: 312,
    fatalityCount: 847,
    dominantVector: 'ied',
    trend: 'stable',
    notes: 'Iraq and Syria remain primary theaters; ISIS affiliate activity persists in rural areas.',
  },
  {
    domain: 'africa',
    quarter: 'Q1 2025',
    incidentCount: 487,
    fatalityCount: 1204,
    dominantVector: 'active_shooter',
    trend: 'increasing',
    notes: 'Sahel corridor expansion continues; JNIM and ISWAP operations escalating.',
  },
  {
    domain: 'south_asia',
    quarter: 'Q1 2025',
    incidentCount: 198,
    fatalityCount: 312,
    dominantVector: 'ied',
    trend: 'decreasing',
    notes: 'TTP operations reduced; Afghanistan relatively stable under Taliban.',
  },
  {
    domain: 'europe',
    quarter: 'Q1 2025',
    incidentCount: 23,
    fatalityCount: 11,
    dominantVector: 'vehicle',
    trend: 'stable',
    notes: 'Domestic lone-wolf attacks dominate; ISIS-inspired plots disrupted in France, Germany.',
  },
  {
    domain: 'southeast_asia',
    quarter: 'Q1 2025',
    incidentCount: 67,
    fatalityCount: 89,
    dominantVector: 'ied',
    trend: 'stable',
    notes: 'Southern Philippines and southern Thailand hotspots remain active.',
  },
  {
    domain: 'americas',
    quarter: 'Q1 2025',
    incidentCount: 41,
    fatalityCount: 58,
    dominantVector: 'active_shooter',
    trend: 'increasing',
    notes: 'Domestic violent extremism in US; narco-terrorist activity in Colombia and Mexico.',
  },
  {
    domain: 'central_asia',
    quarter: 'Q1 2025',
    incidentCount: 14,
    fatalityCount: 22,
    dominantVector: 'ied',
    trend: 'resurgent',
    notes: 'ISKP cross-border operations from Afghanistan into Tajikistan elevated.',
  },
];

export const THREAT_GROUPS: ThreatGroup[] = [
  {
    name: 'ISIS-Sahel (ISWAP)',
    affiliation: 'isis_isil',
    primaryRegion: 'West Africa',
    activeInRegions: ['Nigeria', 'Niger', 'Chad', 'Cameroon'],
    activityTrend: 'increasing',
    estimatedStrength: 5000,
    lastKnownActivity: '2025-05-18',
    threatLevel: 'critical',
    notes: 'Controlling territory in Lake Chad Basin; conducting complex attacks on military bases.',
  },
  {
    name: "JNIM (Jama'at Nusrat al-Islam)",
    affiliation: 'al_qaeda',
    primaryRegion: 'Sahel',
    activeInRegions: ['Mali', 'Burkina Faso', 'Niger'],
    activityTrend: 'increasing',
    estimatedStrength: 8000,
    lastKnownActivity: '2025-05-20',
    threatLevel: 'critical',
    notes: 'Largest terrorist group in Africa; controlling significant rural territory in Mali.',
  },
  {
    name: 'ISIS-Khorasan (ISKP)',
    affiliation: 'isis_isil',
    primaryRegion: 'Afghanistan',
    activeInRegions: ['Afghanistan', 'Tajikistan', 'Pakistan'],
    activityTrend: 'resurgent',
    estimatedStrength: 4000,
    lastKnownActivity: '2025-05-15',
    threatLevel: 'severe',
    notes: 'External operations capability demonstrated; targeting Western interests and regional states.',
  },
  {
    name: 'Al-Shabaab',
    affiliation: 'al_qaeda',
    primaryRegion: 'East Africa',
    activeInRegions: ['Somalia', 'Kenya', 'Ethiopia'],
    activityTrend: 'stable',
    estimatedStrength: 7000,
    lastKnownActivity: '2025-05-19',
    threatLevel: 'severe',
    notes: 'Controls southern Somalia rural areas; conducting complex hotel and base attacks.',
  },
  {
    name: 'ISIS-Iraq/Syria Core',
    affiliation: 'isis_isil',
    primaryRegion: 'Middle East',
    activeInRegions: ['Iraq', 'Syria'],
    activityTrend: 'stable',
    estimatedStrength: 6000,
    lastKnownActivity: '2025-05-17',
    threatLevel: 'severe',
    notes: 'Underground network operational; conducting IED attacks and assassinations.',
  },
  {
    name: 'Domestic Violent Extremists (US)',
    affiliation: 'domestic_extremist',
    primaryRegion: 'Americas',
    activeInRegions: ['United States'],
    activityTrend: 'increasing',
    estimatedStrength: 0,
    lastKnownActivity: '2025-05-22',
    threatLevel: 'substantial',
    notes: 'Racially and ethnically motivated violent extremism remains primary domestic threat.',
  },
  {
    name: 'TTP (Tehrik-i-Taliban Pakistan)',
    affiliation: 'al_qaeda',
    primaryRegion: 'South Asia',
    activeInRegions: ['Pakistan', 'Afghanistan'],
    activityTrend: 'decreasing',
    estimatedStrength: 3000,
    lastKnownActivity: '2025-05-10',
    threatLevel: 'substantial',
    notes: 'Operations reduced following Pakistani military campaign.',
  },
];

export const ATTACK_VECTOR_STATS: AttackVectorStat[] = [
  {
    vector: 'ied',
    incidentsPast12Months: 892,
    fatalitiesPast12Months: 2341,
    percentOfTotal: 38,
    trend: 'stable',
    primaryRegion: 'Middle East / Africa',
  },
  {
    vector: 'active_shooter',
    incidentsPast12Months: 743,
    fatalitiesPast12Months: 1876,
    percentOfTotal: 32,
    trend: 'increasing',
    primaryRegion: 'Africa / Americas',
  },
  {
    vector: 'suicide_bombing',
    incidentsPast12Months: 287,
    fatalitiesPast12Months: 934,
    percentOfTotal: 12,
    trend: 'decreasing',
    primaryRegion: 'South Asia',
  },
  {
    vector: 'vehicle',
    incidentsPast12Months: 134,
    fatalitiesPast12Months: 312,
    percentOfTotal: 6,
    trend: 'stable',
    primaryRegion: 'Europe',
  },
  {
    vector: 'kidnapping',
    incidentsPast12Months: 198,
    fatalitiesPast12Months: 67,
    percentOfTotal: 8,
    trend: 'increasing',
    primaryRegion: 'Africa',
  },
  {
    vector: 'cbrn',
    incidentsPast12Months: 4,
    fatalitiesPast12Months: 0,
    percentOfTotal: 0,
    trend: 'stable',
    primaryRegion: 'Europe',
  },
  {
    vector: 'cyber_enabled',
    incidentsPast12Months: 23,
    fatalitiesPast12Months: 0,
    percentOfTotal: 1,
    trend: 'increasing',
    primaryRegion: 'Global',
  },
  {
    vector: 'arson',
    incidentsPast12Months: 67,
    fatalitiesPast12Months: 18,
    percentOfTotal: 3,
    trend: 'stable',
    primaryRegion: 'Europe / Americas',
  },
];

export const COUNTRY_ASSESSMENTS: CountryThreatAssessment[] = [
  {
    country: 'Mali',
    iso3: 'MLI',
    threatLevel: 'critical',
    primaryThreatGroup: 'JNIM',
    incidentsPast12Months: 234,
    fatalitiesPast12Months: 612,
    notes: 'State authority collapsed in center and north; JNIM controls major rural areas.',
  },
  {
    country: 'Burkina Faso',
    iso3: 'BFA',
    threatLevel: 'critical',
    primaryThreatGroup: 'JNIM / ISWAP',
    incidentsPast12Months: 198,
    fatalitiesPast12Months: 534,
    notes: 'Government controls less than half of territory; humanitarian crisis worsening.',
  },
  {
    country: 'Somalia',
    iso3: 'SOM',
    threatLevel: 'critical',
    primaryThreatGroup: 'Al-Shabaab',
    incidentsPast12Months: 312,
    fatalitiesPast12Months: 723,
    notes: 'Al-Shabaab conducts near-daily attacks; Mogadishu complex attacks continue.',
  },
  {
    country: 'Nigeria',
    iso3: 'NGA',
    threatLevel: 'severe',
    primaryThreatGroup: 'ISWAP / Boko Haram',
    incidentsPast12Months: 187,
    fatalitiesPast12Months: 423,
    notes: 'Northeast remains active conflict zone; Lake Chad Basin operations persist.',
  },
  {
    country: 'Iraq',
    iso3: 'IRQ',
    threatLevel: 'severe',
    primaryThreatGroup: 'ISIS Core',
    incidentsPast12Months: 143,
    fatalitiesPast12Months: 289,
    notes: 'ISIS underground network persists; Sunni rural areas remain vulnerable.',
  },
  {
    country: 'Afghanistan',
    iso3: 'AFG',
    threatLevel: 'severe',
    primaryThreatGroup: 'ISKP',
    incidentsPast12Months: 167,
    fatalitiesPast12Months: 234,
    notes: 'ISKP targets Taliban, minorities, foreign interests; external attack planning ongoing.',
  },
  {
    country: 'Pakistan',
    iso3: 'PAK',
    threatLevel: 'substantial',
    primaryThreatGroup: 'TTP',
    incidentsPast12Months: 134,
    fatalitiesPast12Months: 198,
    notes: 'TTP targeting security forces; cross-border sanctuary in Afghanistan complicates ops.',
  },
  {
    country: 'France',
    iso3: 'FRA',
    threatLevel: 'substantial',
    primaryThreatGroup: 'ISIS-Inspired / DVE',
    incidentsPast12Months: 8,
    fatalitiesPast12Months: 3,
    notes: 'Lone-actor threat remains high; recent disruptions of ISIS-inspired plots.',
  },
];

export const HIGH_IMPACT_EVENTS: HighImpactEvent[] = [
  {
    date: '2025-05-12',
    location: 'Bamako, Mali',
    country: 'Mali',
    vector: 'ied',
    affiliation: 'al_qaeda',
    killed: 23,
    wounded: 41,
    summary: 'JNIM IED attack on military convoy near Bamako perimeter kills 23 soldiers.',
    significance: 'critical',
  },
  {
    date: '2025-05-08',
    location: 'Maiduguri, Nigeria',
    country: 'Nigeria',
    vector: 'suicide_bombing',
    affiliation: 'isis_isil',
    killed: 18,
    wounded: 67,
    summary: 'ISWAP suicide bomber targets displaced persons camp; civilian mass casualty event.',
    significance: 'critical',
  },
  {
    date: '2025-04-28',
    location: 'Kabul, Afghanistan',
    country: 'Afghanistan',
    vector: 'ied',
    affiliation: 'isis_isil',
    killed: 12,
    wounded: 34,
    summary: 'ISKP vehicle-borne IED targets foreign diplomatic convoy in central Kabul.',
    significance: 'severe',
  },
  {
    date: '2025-04-19',
    location: 'Ouagadougou, Burkina Faso',
    country: 'Burkina Faso',
    vector: 'active_shooter',
    affiliation: 'al_qaeda',
    killed: 31,
    wounded: 18,
    summary: 'Coordinated JNIM assault on military headquarters; significant materiel seized.',
    significance: 'critical',
  },
  {
    date: '2025-04-11',
    location: 'Mogadishu, Somalia',
    country: 'Somalia',
    vector: 'suicide_bombing',
    affiliation: 'al_qaeda',
    killed: 9,
    wounded: 22,
    summary: 'Al-Shabaab complex attack on Mogadishu hotel frequented by government officials.',
    significance: 'severe',
  },
];

// ── Section styles ─────────────────────────────────────────────────────────

const SECTION_STYLE =
  'margin-bottom:12px;background:var(--panel-bg-secondary,rgba(255,255,255,0.04));' +
  'border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.06)';
const HEADER_STYLE =
  'padding:7px 10px;font-size:11px;font-weight:600;letter-spacing:.06em;' +
  'text-transform:uppercase;color:#9e9e9e;background:rgba(255,255,255,0.04);' +
  'border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:6px';
const TABLE_STYLE = 'width:100%;border-collapse:collapse;font-size:12px';
const CELL_STYLE = 'padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:top';

function sectionHeader(title: string, badge?: string): string {
  return `<div style="${HEADER_STYLE}" data-section-header="${escapeHtml(title)}">${escapeHtml(title)}${badge ?? ''}</div>`;
}

function badgeEl(text: string, color = '#b71c1c'): string {
  return `<span style="margin-left:6px;font-size:10px;background:${color};color:#fff;border-radius:10px;padding:1px 6px">${escapeHtml(text)}</span>`;
}

function threatBadge(level: ThreatLevel): string {
  return `<span style="font-size:10px;background:${threatLevelColor(level)};color:#fff;border-radius:10px;padding:1px 6px;font-weight:600">${escapeHtml(threatLevelLabel(level))}</span>`;
}

function trendBadge(trend: ActivityTrend): string {
  return `<span style="font-size:10px;background:${activityTrendColor(trend)};color:#fff;border-radius:10px;padding:1px 6px">${escapeHtml(activityTrendLabel(trend))}</span>`;
}

// ── Render functions ───────────────────────────────────────────────────────

export function renderIncidentTrendsSection(trends: TerrorismIncidentTrend[]): string {
  const totalIncidents = aggregateIncidents(trends);
  const totalFatalities = aggregateFatalities(trends);
  const criticalDomains = trends.filter(
    t => t.trend === 'increasing' || t.trend === 'resurgent',
  ).length;

  const header = sectionHeader(
    'Global Incident Trends',
    criticalDomains > 0 ? badgeEl(`${criticalDomains} escalating`, '#b71c1c') : '',
  );

  const summary = `<div style="padding:6px 10px;font-size:11px;color:#9e9e9e;border-bottom:1px solid rgba(255,255,255,0.04)">` +
    `${totalIncidents.toLocaleString()} incidents · ${totalFatalities.toLocaleString()} fatalities across all domains` +
    `</div>`;

  const rows = trends
    .slice()
    .sort((a, b) => b.incidentCount - a.incidentCount)
    .map(t => {
      const tColor = activityTrendColor(t.trend);
      return `<tr>` +
        `<td style="${CELL_STYLE};font-weight:600;color:#e5e5e5">${escapeHtml(incidentDomainLabel(t.domain))}</td>` +
        `<td style="${CELL_STYLE};color:#facc15">${escapeHtml(t.quarter)}</td>` +
        `<td style="${CELL_STYLE};text-align:right">${t.incidentCount.toLocaleString()}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:#fb923c">${t.fatalityCount.toLocaleString()}</td>` +
        `<td style="${CELL_STYLE}"><span style="color:${tColor}">${escapeHtml(activityTrendLabel(t.trend))}</span></td>` +
        `</tr>`;
    })
    .join('');

  return `<div style="${SECTION_STYLE}">${header}${summary}` +
    `<table style="${TABLE_STYLE}">` +
    `<thead><tr>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Domain</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Quarter</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500;text-align:right">Incidents</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500;text-align:right">Fatalities</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Trend</th>` +
    `</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderThreatGroupsSection(groups: ThreatGroup[]): string {
  const active = countActiveThreatGroups(groups);
  const sorted = sortGroupsBySeverity(groups);

  const header = sectionHeader(
    'Active Threat Groups',
    active > 0 ? badgeEl(`${active} active`, '#b71c1c') : '',
  );

  const rows = sorted.map(g => {
    const score = groupSeverityScore(g);
    const affiliationLabel = groupAffiliationLabel(g.affiliation);
    return `<tr>` +
      `<td style="${CELL_STYLE};font-weight:600;color:#e5e5e5">${escapeHtml(g.name)}</td>` +
      `<td style="${CELL_STYLE};color:#9e9e9e;font-size:11px">${escapeHtml(affiliationLabel)}</td>` +
      `<td style="${CELL_STYLE}">${threatBadge(g.threatLevel)}</td>` +
      `<td style="${CELL_STYLE}">${trendBadge(g.activityTrend)}</td>` +
      `<td style="${CELL_STYLE};color:#9e9e9e;font-size:11px">${escapeHtml(formatActiveRegions(g))}</td>` +
      `<td style="${CELL_STYLE};text-align:right;color:#facc15;font-weight:600">${score}</td>` +
      `</tr>`;
  }).join('');

  return `<div style="${SECTION_STYLE}">${header}` +
    `<table style="${TABLE_STYLE}">` +
    `<thead><tr>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Group</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Affiliation</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Threat</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Trend</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Active Regions</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500;text-align:right">Score</th>` +
    `</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderAttackVectorsSection(stats: AttackVectorStat[]): string {
  const sorted = sortVectorsByIncidents(stats);
  const totalIncidents = stats.reduce((s, v) => s + v.incidentsPast12Months, 0);

  const header = sectionHeader('Attack Vectors (Past 12 Months)');

  const rows = sorted.map(v => {
    const barWidth = Math.round(v.percentOfTotal);
    const tColor = activityTrendColor(v.trend);
    return `<tr>` +
      `<td style="${CELL_STYLE};font-weight:600;color:#e5e5e5">${escapeHtml(attackVectorLabel(v.vector))}</td>` +
      `<td style="${CELL_STYLE};text-align:right">${v.incidentsPast12Months.toLocaleString()}</td>` +
      `<td style="${CELL_STYLE};text-align:right;color:#fb923c">${v.fatalitiesPast12Months.toLocaleString()}</td>` +
      `<td style="${CELL_STYLE}">` +
        `<div style="display:flex;align-items:center;gap:4px">` +
        `<div style="width:${barWidth}px;height:6px;background:var(--severity-high,#fb923c);border-radius:3px;min-width:2px"></div>` +
        `<span style="font-size:10px;color:#9e9e9e">${v.percentOfTotal}%</span>` +
        `</div>` +
      `</td>` +
      `<td style="${CELL_STYLE};color:${tColor};font-size:11px">${escapeHtml(activityTrendLabel(v.trend))}</td>` +
      `</tr>`;
  }).join('');

  const footer = `<div style="padding:6px 10px;font-size:11px;color:#666;border-top:1px solid rgba(255,255,255,0.04)">` +
    `Total: ${totalIncidents.toLocaleString()} incidents tracked across ${stats.length} vectors</div>`;

  return `<div style="${SECTION_STYLE}">${header}` +
    `<table style="${TABLE_STYLE}">` +
    `<thead><tr>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Vector</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500;text-align:right">Incidents</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500;text-align:right">Fatalities</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Share</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Trend</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>${footer}</div>`;
}

export function renderCountryAssessmentsSection(assessments: CountryThreatAssessment[]): string {
  const highThreat = countHighThreatCountries(assessments);
  const sorted = sortCountriesByIncidents(assessments);

  const header = sectionHeader(
    'Country Threat Levels',
    highThreat > 0 ? badgeEl(`${highThreat} high threat`, '#b71c1c') : '',
  );

  const rows = sorted.map(a => {
    return `<tr>` +
      `<td style="${CELL_STYLE};font-weight:600;color:#e5e5e5">${escapeHtml(a.country)}</td>` +
      `<td style="${CELL_STYLE};color:#666;font-size:11px">${escapeHtml(a.iso3)}</td>` +
      `<td style="${CELL_STYLE}">${threatBadge(a.threatLevel)}</td>` +
      `<td style="${CELL_STYLE};color:#9e9e9e;font-size:11px">${escapeHtml(a.primaryThreatGroup)}</td>` +
      `<td style="${CELL_STYLE};text-align:right">${a.incidentsPast12Months.toLocaleString()}</td>` +
      `<td style="${CELL_STYLE};text-align:right;color:#fb923c">${a.fatalitiesPast12Months.toLocaleString()}</td>` +
      `</tr>`;
  }).join('');

  return `<div style="${SECTION_STYLE}">${header}` +
    `<table style="${TABLE_STYLE}">` +
    `<thead><tr>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Country</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">ISO</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Threat Level</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Primary Group</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500;text-align:right">Incidents</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500;text-align:right">Fatalities</th>` +
    `</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderHighImpactEventsSection(events: HighImpactEvent[]): string {
  const highImpact = countHighImpactEvents(events);
  const sorted = sortEventsByCasualties(events);

  const header = sectionHeader(
    'High-Impact Recent Events',
    highImpact > 0 ? badgeEl(`${highImpact} critical`, '#b71c1c') : '',
  );

  const rows = sorted.map(e => {
    return `<tr>` +
      `<td style="${CELL_STYLE};color:#9e9e9e;font-size:11px;white-space:nowrap">${escapeHtml(e.date)}</td>` +
      `<td style="${CELL_STYLE};font-weight:600;color:#e5e5e5">${escapeHtml(e.location)}</td>` +
      `<td style="${CELL_STYLE}">${threatBadge(e.significance)}</td>` +
      `<td style="${CELL_STYLE};color:#9e9e9e;font-size:11px">${escapeHtml(attackVectorLabel(e.vector))}</td>` +
      `<td style="${CELL_STYLE};text-align:right;color:#ef4444;font-weight:600">${e.killed}</td>` +
      `<td style="${CELL_STYLE};text-align:right;color:#fb923c">${e.wounded}</td>` +
      `<td style="${CELL_STYLE};font-size:11px;color:#9e9e9e;max-width:200px">${escapeHtml(e.summary)}</td>` +
      `</tr>`;
  }).join('');

  return `<div style="${SECTION_STYLE}">${header}` +
    `<table style="${TABLE_STYLE}">` +
    `<thead><tr>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Date</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Location</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Level</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Vector</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500;text-align:right">Killed</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500;text-align:right">Wounded</th>` +
    `<th style="${CELL_STYLE};color:#666;font-weight:500">Summary</th>` +
    `</tr></thead><tbody>${rows}</tbody></table></div>`;
}
