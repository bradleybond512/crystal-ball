/**
 * Pure helpers for GlobalHealthSecurityPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 *
 * All `render*` helpers return HTML strings. Field values that originate as
 * free-form text are passed through `escapeHtml` at the render boundary.
 */

import { escapeHtml } from '@/utils/sanitize';

// ── Types ─────────────────────────────────────────────────────────────────

export type PheicStatus = 'active' | 'monitoring' | 'expired';

export type TransmissionMode =
  | 'human-to-human'
  | 'animal-to-human'
  | 'vector-borne'
  | 'foodborne'
  | 'unknown';

export type OutbreakTrend = 'rising' | 'plateau' | 'declining' | 'contained';

export type AmrSeverity = 'watch' | 'concerning' | 'serious' | 'urgent';

export type CapacityStatus = 'nominal' | 'strained' | 'critical' | 'overwhelmed';

export type CoverageStatus = 'on-track' | 'at-risk' | 'gap' | 'severe-gap';

export type NetworkStatus = 'operational' | 'degraded' | 'partial-outage' | 'offline';

export type PreparednessTier =
  | 'leader'
  | 'capable'
  | 'developing'
  | 'limited'
  | 'least-prepared';

export interface PheicEvent {
  name: string;
  declarationDate: string;
  status: PheicStatus;
  regions: string;
  notes: string;
}

export interface OutbreakEvent {
  pathogen: string;
  region: string;
  cases: number;
  deaths: number;
  transmission: TransmissionMode;
  trend: OutbreakTrend;
  notes: string;
}

export interface AmrHotspot {
  country: string;
  pathogen: string;
  drugClass: string;
  resistancePct: number;
  severity: AmrSeverity;
}

export interface CapacityStress {
  region: string;
  icuOccupancyPct: number;
  hcwShortagePct: number;
  supplyStatus: string;
  status: CapacityStatus;
}

export interface CoverageGap {
  country: string;
  antigen: string;
  coveragePct: number;
  zeroDoseClusters: number;
  status: CoverageStatus;
}

export interface BiosurveillanceNetwork {
  name: string;
  scope: string;
  lastUpdateHours: number;
  geographicGap: string;
  status: NetworkStatus;
}

export interface PreparednessScore {
  country: string;
  overall: number;
  prevention: number;
  detection: number;
  response: number;
  healthSystem: number;
  tier: PreparednessTier;
}

// ── PHEIC helpers ─────────────────────────────────────────────────────────

export function pheicStatusColor(s: PheicStatus): string {
  const colors: Record<PheicStatus, string> = {
    active:     '#ef4444',
    monitoring: '#f59e0b',
    expired:    '#9e9e9e',
  };
  return colors[s];
}

export function pheicStatusLabel(s: PheicStatus): string {
  const labels: Record<PheicStatus, string> = {
    active:     'Active',
    monitoring: 'Monitoring',
    expired:    'Expired',
  };
  return labels[s];
}

// ── Outbreak helpers ──────────────────────────────────────────────────────

export function transmissionLabel(t: TransmissionMode): string {
  const labels: Record<TransmissionMode, string> = {
    'human-to-human':  'Human → Human',
    'animal-to-human': 'Animal → Human',
    'vector-borne':    'Vector-borne',
    foodborne:         'Foodborne',
    unknown:           'Unknown',
  };
  return labels[t];
}

export function outbreakTrendColor(t: OutbreakTrend): string {
  const colors: Record<OutbreakTrend, string> = {
    rising:    '#ef4444',
    plateau:   '#f59e0b',
    declining: '#3b82f6',
    contained: '#22c55e',
  };
  return colors[t];
}

export function outbreakTrendLabel(t: OutbreakTrend): string {
  const labels: Record<OutbreakTrend, string> = {
    rising:    'Rising',
    plateau:   'Plateau',
    declining: 'Declining',
    contained: 'Contained',
  };
  return labels[t];
}

// ── AMR helpers ───────────────────────────────────────────────────────────

export function amrSeverityColor(s: AmrSeverity): string {
  const colors: Record<AmrSeverity, string> = {
    watch:       '#22c55e',
    concerning:  '#f59e0b',
    serious:     '#fb923c',
    urgent:      '#ef4444',
  };
  return colors[s];
}

export function amrSeverityLabel(s: AmrSeverity): string {
  const labels: Record<AmrSeverity, string> = {
    watch:       'Watch',
    concerning:  'Concerning',
    serious:     'Serious',
    urgent:      'Urgent',
  };
  return labels[s];
}

// ── Capacity helpers ──────────────────────────────────────────────────────

export function capacityColor(s: CapacityStatus): string {
  const colors: Record<CapacityStatus, string> = {
    nominal:      '#22c55e',
    strained:     '#f59e0b',
    critical:     '#fb923c',
    overwhelmed:  '#ef4444',
  };
  return colors[s];
}

export function capacityLabel(s: CapacityStatus): string {
  const labels: Record<CapacityStatus, string> = {
    nominal:      'Nominal',
    strained:     'Strained',
    critical:     'Critical',
    overwhelmed:  'Overwhelmed',
  };
  return labels[s];
}

// ── Coverage helpers ──────────────────────────────────────────────────────

export function coverageColor(s: CoverageStatus): string {
  const colors: Record<CoverageStatus, string> = {
    'on-track':    '#22c55e',
    'at-risk':     '#f59e0b',
    gap:           '#fb923c',
    'severe-gap':  '#ef4444',
  };
  return colors[s];
}

export function coverageLabel(s: CoverageStatus): string {
  const labels: Record<CoverageStatus, string> = {
    'on-track':    'On Track',
    'at-risk':     'At Risk',
    gap:           'Gap',
    'severe-gap':  'Severe Gap',
  };
  return labels[s];
}

// ── Network helpers ───────────────────────────────────────────────────────

export function networkStatusColor(s: NetworkStatus): string {
  const colors: Record<NetworkStatus, string> = {
    operational:     '#22c55e',
    degraded:        '#f59e0b',
    'partial-outage':'#fb923c',
    offline:         '#ef4444',
  };
  return colors[s];
}

export function networkStatusLabel(s: NetworkStatus): string {
  const labels: Record<NetworkStatus, string> = {
    operational:     'Operational',
    degraded:        'Degraded',
    'partial-outage':'Partial Outage',
    offline:         'Offline',
  };
  return labels[s];
}

// ── Preparedness helpers ──────────────────────────────────────────────────

export function preparednessTierColor(t: PreparednessTier): string {
  const colors: Record<PreparednessTier, string> = {
    leader:           '#22c55e',
    capable:          '#3b82f6',
    developing:       '#f59e0b',
    limited:          '#fb923c',
    'least-prepared': '#ef4444',
  };
  return colors[t];
}

export function preparednessTierLabel(t: PreparednessTier): string {
  const labels: Record<PreparednessTier, string> = {
    leader:           'Leader',
    capable:          'Capable',
    developing:       'Developing',
    limited:          'Limited',
    'least-prepared': 'Least Prepared',
  };
  return labels[t];
}

// ── Count helpers ─────────────────────────────────────────────────────────

export function countActivePheics(events: PheicEvent[]): number {
  return events.filter((e) => e.status === 'active').length;
}

export function countActiveOutbreaks(events: OutbreakEvent[]): number {
  return events.filter((e) => e.trend === 'rising' || e.trend === 'plateau').length;
}

export function countAmrFlaggedCountries(rows: AmrHotspot[]): number {
  return rows.filter((r) => r.severity === 'serious' || r.severity === 'urgent').length;
}

export function countCapacityStressed(rows: CapacityStress[]): number {
  return rows.filter((r) => r.status === 'critical' || r.status === 'overwhelmed').length;
}

export function countCoverageGapCountries(rows: CoverageGap[]): number {
  return rows.filter((r) => r.status === 'gap' || r.status === 'severe-gap').length;
}

export function countDegradedNetworks(rows: BiosurveillanceNetwork[]): number {
  return rows.filter(
    (r) => r.status === 'degraded' || r.status === 'partial-outage' || r.status === 'offline',
  ).length;
}

export function countLowPreparednessCountries(rows: PreparednessScore[]): number {
  return rows.filter((r) => r.tier === 'limited' || r.tier === 'least-prepared').length;
}

// ── Sort helpers ──────────────────────────────────────────────────────────

export function sortOutbreaksBySeverity(rows: OutbreakEvent[]): OutbreakEvent[] {
  const trendRank: Record<OutbreakTrend, number> = {
    rising: 0, plateau: 1, declining: 2, contained: 3,
  };
  return [...rows].sort((a, b) => {
    const t = trendRank[a.trend] - trendRank[b.trend];
    if (t !== 0) return t;
    return b.cases - a.cases;
  });
}

export function sortPreparednessAscending(rows: PreparednessScore[]): PreparednessScore[] {
  return [...rows].sort((a, b) => a.overall - b.overall);
}

// ── Static data ───────────────────────────────────────────────────────────

export const PHEIC_EVENTS: PheicEvent[] = [
  {
    name:            'Mpox clade I outbreak',
    declarationDate: '2024-08-14',
    status:          'active',
    regions:         'DRC, Burundi, Rwanda, Uganda, Kenya, CAR',
    notes:           'Clade Ib human-to-human chains; sexual transmission documented',
  },
  {
    name:            'Polio (cVDPV2)',
    declarationDate: '2014-05-05',
    status:          'active',
    regions:         'Afghanistan, Pakistan, Yemen, multi-country Africa',
    notes:           'Continued international spread; circulating vaccine-derived strains',
  },
  {
    name:            'COVID-19',
    declarationDate: '2020-01-30',
    status:          'expired',
    regions:         'Global',
    notes:           'PHEIC ended 2023-05-05; ongoing variant surveillance',
  },
  {
    name:            'Avian influenza A(H5N1)',
    declarationDate: '2024-04-01',
    status:          'monitoring',
    regions:         'Global wild birds; US dairy cattle; sporadic human cases',
    notes:           'Bovine spillover documented in 14 US states; one symptomatic farmworker',
  },
];

export const OUTBREAK_EVENTS: OutbreakEvent[] = [
  {
    pathogen:     'Marburg virus disease',
    region:       'Rwanda',
    cases:        66,
    deaths:       15,
    transmission: 'human-to-human',
    trend:        'declining',
    notes:        'Healthcare worker cluster; ring vaccination underway',
  },
  {
    pathogen:     'H5N1 (bovine)',
    region:       'United States',
    cases:        66,
    deaths:       0,
    transmission: 'animal-to-human',
    trend:        'rising',
    notes:        'Dairy farmworker exposures; D1.1 genotype detected in poultry workers',
  },
  {
    pathogen:     'Mpox clade Ib',
    region:       'DRC + neighbors',
    cases:        24_800,
    deaths:       643,
    transmission: 'human-to-human',
    trend:        'plateau',
    notes:        'Sexual transmission chains; pediatric burden in eastern DRC',
  },
  {
    pathogen:     'Nipah virus',
    region:       'Bangladesh',
    cases:        3,
    deaths:       2,
    transmission: 'animal-to-human',
    trend:        'contained',
    notes:        'Date palm sap exposure; no onward human transmission detected',
  },
  {
    pathogen:     'Oropouche virus',
    region:       'Brazil, Cuba',
    cases:        13_400,
    deaths:       4,
    transmission: 'vector-borne',
    trend:        'rising',
    notes:        'Vertical transmission cases under investigation',
  },
  {
    pathogen:     'MERS-CoV',
    region:       'Saudi Arabia',
    cases:        9,
    deaths:       3,
    transmission: 'animal-to-human',
    trend:        'plateau',
    notes:        'Hospital-acquired cluster; dromedary contact confirmed for 4 index cases',
  },
];

export const AMR_HOTSPOTS: AmrHotspot[] = [
  {
    country:       'India',
    pathogen:      'Salmonella Typhi',
    drugClass:     'fluoroquinolones',
    resistancePct: 95,
    severity:      'urgent',
  },
  {
    country:       'Pakistan',
    pathogen:      'Salmonella Typhi (XDR)',
    drugClass:     'ceftriaxone',
    resistancePct: 72,
    severity:      'urgent',
  },
  {
    country:       'Greece',
    pathogen:      'Klebsiella pneumoniae',
    drugClass:     'carbapenems',
    resistancePct: 66,
    severity:      'urgent',
  },
  {
    country:       'Italy',
    pathogen:      'Acinetobacter baumannii',
    drugClass:     'carbapenems',
    resistancePct: 80,
    severity:      'urgent',
  },
  {
    country:       'United States',
    pathogen:      'MRSA',
    drugClass:     'methicillin',
    resistancePct: 31,
    severity:      'serious',
  },
  {
    country:       'South Africa',
    pathogen:      'M. tuberculosis (MDR/XDR)',
    drugClass:     'rifampicin + isoniazid',
    resistancePct: 14,
    severity:      'serious',
  },
  {
    country:       'Philippines',
    pathogen:      'Neisseria gonorrhoeae',
    drugClass:     'azithromycin',
    resistancePct: 19,
    severity:      'concerning',
  },
];

export const CAPACITY_STRESS: CapacityStress[] = [
  {
    region:          'Sudan (conflict zone)',
    icuOccupancyPct: 0,
    hcwShortagePct:  78,
    supplyStatus:    '70% of health facilities non-functional; chronic oxygen + antibiotic shortage',
    status:          'overwhelmed',
  },
  {
    region:          'Gaza',
    icuOccupancyPct: 0,
    hcwShortagePct:  85,
    supplyStatus:    'Only 17 of 36 hospitals partially functional; critical PPE + insulin shortfall',
    status:          'overwhelmed',
  },
  {
    region:          'Eastern DRC',
    icuOccupancyPct: 95,
    hcwShortagePct:  62,
    supplyStatus:    'Mpox response strained; cold chain gaps for vaccine deployment',
    status:          'critical',
  },
  {
    region:          'Yemen',
    icuOccupancyPct: 88,
    hcwShortagePct:  55,
    supplyStatus:    'Half of facilities partially or non-functional; cholera kits depleted',
    status:          'critical',
  },
  {
    region:          'Haiti',
    icuOccupancyPct: 82,
    hcwShortagePct:  48,
    supplyStatus:    'Gang-controlled supply routes; oxygen rationing in Port-au-Prince',
    status:          'critical',
  },
  {
    region:          'Northern Europe (winter respiratory)',
    icuOccupancyPct: 78,
    hcwShortagePct:  18,
    supplyStatus:    'Seasonal RSV + flu pressure; antiviral stockpiles adequate',
    status:          'strained',
  },
  {
    region:          'United States (baseline)',
    icuOccupancyPct: 71,
    hcwShortagePct:  12,
    supplyStatus:    'Stable PPE; intermittent IV-fluid shortage; nursing vacancies in rural systems',
    status:          'nominal',
  },
];

export const COVERAGE_GAPS: CoverageGap[] = [
  {
    country:          'Afghanistan',
    antigen:          'DTP3',
    coveragePct:      66,
    zeroDoseClusters: 38,
    status:           'severe-gap',
  },
  {
    country:          'Yemen',
    antigen:          'MCV1',
    coveragePct:      71,
    zeroDoseClusters: 26,
    status:           'severe-gap',
  },
  {
    country:          'Nigeria',
    antigen:          'DTP3',
    coveragePct:      62,
    zeroDoseClusters: 54,
    status:           'severe-gap',
  },
  {
    country:          'Ethiopia',
    antigen:          'OPV3',
    coveragePct:      74,
    zeroDoseClusters: 33,
    status:           'gap',
  },
  {
    country:          'DRC',
    antigen:          'MCV1',
    coveragePct:      69,
    zeroDoseClusters: 41,
    status:           'severe-gap',
  },
  {
    country:          'Somalia',
    antigen:          'DTP3',
    coveragePct:      47,
    zeroDoseClusters: 29,
    status:           'severe-gap',
  },
  {
    country:          'Indonesia',
    antigen:          'MCV1',
    coveragePct:      85,
    zeroDoseClusters: 14,
    status:           'at-risk',
  },
  {
    country:          'Brazil',
    antigen:          'MCV1',
    coveragePct:      90,
    zeroDoseClusters: 7,
    status:           'on-track',
  },
];

export const BIOSURVEILLANCE_NETWORKS: BiosurveillanceNetwork[] = [
  {
    name:             'GOARN (Global Outbreak Alert & Response Network)',
    scope:            'WHO field deployment network · 250+ partners',
    lastUpdateHours:  6,
    geographicGap:    'Coverage thin in conflict-affected Sahel + Sudan',
    status:           'operational',
  },
  {
    name:             'EIOS (Epidemic Intelligence from Open Sources)',
    scope:            'Open-source media + signal aggregation',
    lastUpdateHours:  1,
    geographicGap:    'Underweighted local-language coverage in Central Asia',
    status:           'operational',
  },
  {
    name:             'ProMED-mail',
    scope:            'Volunteer moderator network · disease reports',
    lastUpdateHours:  3,
    geographicGap:    'Funding-driven moderator attrition in 2024',
    status:           'degraded',
  },
  {
    name:             'GISAID',
    scope:            'Pathogen genomic sequence sharing',
    lastUpdateHours:  4,
    geographicGap:    'Africa + South Asia sequencing capacity below WHO targets',
    status:           'operational',
  },
  {
    name:             'GLEWS+ (zoonotic early warning)',
    scope:            'WHO / FAO / WOAH joint zoonotic surveillance',
    lastUpdateHours:  12,
    geographicGap:    'Wildlife surveillance under-resourced outside OECD',
    status:           'operational',
  },
  {
    name:             'WHO Disease Outbreak News (DON)',
    scope:            'Verified WHO bulletin stream',
    lastUpdateHours:  18,
    geographicGap:    'Lag between event verification and DON publication averages 11 days',
    status:           'degraded',
  },
];

export const PREPAREDNESS_SCORES: PreparednessScore[] = [
  {
    country:      'United States',
    overall:      75.9,
    prevention:   65.2,
    detection:    81.4,
    response:     72.8,
    healthSystem: 79.3,
    tier:         'leader',
  },
  {
    country:      'Australia',
    overall:      71.1,
    prevention:   60.8,
    detection:    76.5,
    response:     68.2,
    healthSystem: 80.1,
    tier:         'leader',
  },
  {
    country:      'United Kingdom',
    overall:      67.2,
    prevention:   58.4,
    detection:    72.1,
    response:     63.7,
    healthSystem: 76.5,
    tier:         'capable',
  },
  {
    country:      'Germany',
    overall:      65.5,
    prevention:   54.1,
    detection:    70.2,
    response:     60.4,
    healthSystem: 79.8,
    tier:         'capable',
  },
  {
    country:      'Brazil',
    overall:      55,
    prevention:   42.6,
    detection:    65.1,
    response:     52.3,
    healthSystem: 58.7,
    tier:         'developing',
  },
  {
    country:      'India',
    overall:      42.8,
    prevention:   38.2,
    detection:    51.4,
    response:     45.6,
    healthSystem: 41.8,
    tier:         'developing',
  },
  {
    country:      'Nigeria',
    overall:      34.2,
    prevention:   28.1,
    detection:    37.4,
    response:     33,
    healthSystem: 30.8,
    tier:         'limited',
  },
  {
    country:      'Somalia',
    overall:      16.6,
    prevention:   12.4,
    detection:    18.7,
    response:     17.2,
    healthSystem: 14.1,
    tier:         'least-prepared',
  },
];

// ── Render helpers ────────────────────────────────────────────────────────

const TH_STYLE = 'padding:3px 6px;font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);text-align:left';
const TD_STYLE = 'padding:3px 6px;font-size:12px';
const SUBTITLE_STYLE = 'font-size:11px;color:var(--text-secondary,#aaa);margin-bottom:4px';
const SECTION_HEADER_STYLE = 'font-size:12px;font-weight:600;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:.06em;margin:10px 0 4px 0';
const EMPTY_STYLE = 'padding:6px;font-size:11px;color:var(--text-secondary,#aaa);font-style:italic';
const TABLE_STYLE = 'width:100%;border-collapse:collapse';
const ROW_BORDER = 'border-bottom:1px solid var(--border-subtle,#333)';

function badgeSpan(text: string, color: string): string {
  return `<span style="font-size:10px;text-transform:uppercase;color:${color};font-weight:600">${escapeHtml(text)}</span>`;
}

function sectionHeader(title: string, badge?: string): string {
  const badgeHtml = badge
    ? `<span style="margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px">${escapeHtml(badge)}</span>`
    : '';
  return `<div data-section="${escapeHtml(title)}" style="${SECTION_HEADER_STYLE}">${escapeHtml(title)}${badgeHtml}</div>`;
}

export function renderPheicSection(events: PheicEvent[]): string {
  if (events.length === 0) {
    return `${sectionHeader('WHO PHEIC Tracker')}<div style="${EMPTY_STYLE}">No active PHEICs reported.</div>`;
  }

  const activeCount = countActivePheics(events);
  const badge = activeCount > 0 ? `${activeCount} active` : undefined;
  const rows = events.map((e) => {
    const color = pheicStatusColor(e.status);
    const label = pheicStatusLabel(e.status);
    return `
      <tr style="${ROW_BORDER}">
        <td style="${TD_STYLE};font-weight:600;color:${color}">${escapeHtml(e.name)}</td>
        <td style="${TD_STYLE};color:#ccc">${escapeHtml(e.declarationDate)}</td>
        <td style="${TD_STYLE};color:#ccc">${escapeHtml(e.regions)}</td>
        <td style="${TD_STYLE};text-align:right">${badgeSpan(label, color)}</td>
      </tr>
      <tr><td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:var(--text-secondary,#aaa)">${escapeHtml(e.notes)}</td></tr>
    `;
  }).join('');

  return `
    ${sectionHeader('WHO PHEIC Tracker', badge)}
    <div style="${SUBTITLE_STYLE}">Declaration · date · affected regions · status</div>
    <table style="${TABLE_STYLE}"><tbody>${rows}</tbody></table>
  `;
}

export function renderOutbreakSection(events: OutbreakEvent[]): string {
  if (events.length === 0) {
    return `${sectionHeader('Outbreak Event Monitor')}<div style="${EMPTY_STYLE}">No outbreak events reported.</div>`;
  }

  const sorted = sortOutbreaksBySeverity(events);
  const activeCount = countActiveOutbreaks(events);
  const badge = activeCount > 0 ? `${activeCount} active` : undefined;
  const rows = sorted.map((e) => {
    const tColor = outbreakTrendColor(e.trend);
    const tLabel = outbreakTrendLabel(e.trend);
    const tmLabel = transmissionLabel(e.transmission);
    const cfr = e.cases > 0 ? `${((e.deaths / e.cases) * 100).toFixed(1)}% CFR` : 'No fatalities';
    return `
      <tr style="${ROW_BORDER}">
        <td style="${TD_STYLE};font-weight:600;color:${tColor}">${escapeHtml(e.pathogen)}</td>
        <td style="${TD_STYLE};color:#ccc">${escapeHtml(e.region)}</td>
        <td style="${TD_STYLE};color:#facc15;text-align:right">${e.cases.toLocaleString()}</td>
        <td style="${TD_STYLE};color:#ccc;text-align:right">${escapeHtml(cfr)}</td>
        <td style="${TD_STYLE};color:#9e9e9e">${escapeHtml(tmLabel)}</td>
        <td style="${TD_STYLE};text-align:right">${badgeSpan(tLabel, tColor)}</td>
      </tr>
      <tr><td colspan="6" style="padding:0 6px 4px 6px;font-size:10px;color:var(--text-secondary,#aaa)">${escapeHtml(e.notes)}</td></tr>
    `;
  }).join('');

  return `
    ${sectionHeader('Outbreak Event Monitor', badge)}
    <div style="${SUBTITLE_STYLE}">Pathogen · region · cases · CFR · transmission · trend</div>
    <table style="${TABLE_STYLE}">
      <thead><tr>
        <th style="${TH_STYLE}">Pathogen</th>
        <th style="${TH_STYLE}">Region</th>
        <th style="${TH_STYLE};text-align:right">Cases</th>
        <th style="${TH_STYLE};text-align:right">CFR</th>
        <th style="${TH_STYLE}">Transmission</th>
        <th style="${TH_STYLE};text-align:right">Trend</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function renderAmrSection(rows: AmrHotspot[]): string {
  if (rows.length === 0) {
    return `${sectionHeader('Antimicrobial Resistance Hotspots')}<div style="${EMPTY_STYLE}">No AMR hotspots reported.</div>`;
  }

  const flagged = countAmrFlaggedCountries(rows);
  const badge = flagged > 0 ? `${flagged} urgent/serious` : undefined;
  const body = rows.map((r) => {
    const color = amrSeverityColor(r.severity);
    const label = amrSeverityLabel(r.severity);
    return `
      <tr style="${ROW_BORDER}">
        <td style="${TD_STYLE};font-weight:600;color:${color}">${escapeHtml(r.country)}</td>
        <td style="${TD_STYLE};color:#ccc">${escapeHtml(r.pathogen)}</td>
        <td style="${TD_STYLE};color:#9e9e9e">${escapeHtml(r.drugClass)}</td>
        <td style="${TD_STYLE};color:#facc15;text-align:right">${r.resistancePct}%</td>
        <td style="${TD_STYLE};text-align:right">${badgeSpan(label, color)}</td>
      </tr>
    `;
  }).join('');

  return `
    ${sectionHeader('Antimicrobial Resistance Hotspots', badge)}
    <div style="${SUBTITLE_STYLE}">Country · pathogen · drug class · resistance % · severity</div>
    <table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>
  `;
}

export function renderCapacitySection(rows: CapacityStress[]): string {
  if (rows.length === 0) {
    return `${sectionHeader('Health System Capacity Stress')}<div style="${EMPTY_STYLE}">No capacity data available.</div>`;
  }

  const stressed = countCapacityStressed(rows);
  const badge = stressed > 0 ? `${stressed} critical/overwhelmed` : undefined;
  const body = rows.map((r) => {
    const color = capacityColor(r.status);
    const label = capacityLabel(r.status);
    const icu = r.icuOccupancyPct > 0 ? `${r.icuOccupancyPct}% ICU` : 'ICU n/a';
    return `
      <tr style="${ROW_BORDER}">
        <td style="${TD_STYLE};font-weight:600;color:${color}">${escapeHtml(r.region)}</td>
        <td style="${TD_STYLE};color:#facc15;text-align:right">${escapeHtml(icu)}</td>
        <td style="${TD_STYLE};color:#fb923c;text-align:right">${r.hcwShortagePct}% HCW gap</td>
        <td style="${TD_STYLE};text-align:right">${badgeSpan(label, color)}</td>
      </tr>
      <tr><td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:var(--text-secondary,#aaa)">${escapeHtml(r.supplyStatus)}</td></tr>
    `;
  }).join('');

  return `
    ${sectionHeader('Health System Capacity Stress', badge)}
    <div style="${SUBTITLE_STYLE}">Region · ICU occupancy · HCW shortage · supply chain · status</div>
    <table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>
  `;
}

export function renderCoverageSection(rows: CoverageGap[]): string {
  if (rows.length === 0) {
    return `${sectionHeader('Vaccine Coverage Gaps')}<div style="${EMPTY_STYLE}">No coverage data available.</div>`;
  }

  const gapCount = countCoverageGapCountries(rows);
  const badge = gapCount > 0 ? `${gapCount} gap/severe` : undefined;
  const body = rows.map((r) => {
    const color = coverageColor(r.status);
    const label = coverageLabel(r.status);
    return `
      <tr style="${ROW_BORDER}">
        <td style="${TD_STYLE};font-weight:600;color:${color}">${escapeHtml(r.country)}</td>
        <td style="${TD_STYLE};color:#ccc">${escapeHtml(r.antigen)}</td>
        <td style="${TD_STYLE};color:#facc15;text-align:right">${r.coveragePct}%</td>
        <td style="${TD_STYLE};color:#fb923c;text-align:right">${r.zeroDoseClusters} zero-dose clusters</td>
        <td style="${TD_STYLE};text-align:right">${badgeSpan(label, color)}</td>
      </tr>
    `;
  }).join('');

  return `
    ${sectionHeader('Vaccine Coverage Gaps', badge)}
    <div style="${SUBTITLE_STYLE}">Country · antigen · coverage % · zero-dose clusters · status</div>
    <table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>
  `;
}

export function renderNetworkSection(rows: BiosurveillanceNetwork[]): string {
  if (rows.length === 0) {
    return `${sectionHeader('Biosurveillance Network Status')}<div style="${EMPTY_STYLE}">No network data available.</div>`;
  }

  const degraded = countDegradedNetworks(rows);
  const badge = degraded > 0 ? `${degraded} degraded` : undefined;
  const body = rows.map((r) => {
    const color = networkStatusColor(r.status);
    const label = networkStatusLabel(r.status);
    return `
      <tr style="${ROW_BORDER}">
        <td style="${TD_STYLE};font-weight:600;color:${color}">${escapeHtml(r.name)}</td>
        <td style="${TD_STYLE};color:#ccc">${escapeHtml(r.scope)}</td>
        <td style="${TD_STYLE};color:#facc15;text-align:right">${r.lastUpdateHours}h ago</td>
        <td style="${TD_STYLE};text-align:right">${badgeSpan(label, color)}</td>
      </tr>
      <tr><td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:var(--text-secondary,#aaa)">${escapeHtml(r.geographicGap)}</td></tr>
    `;
  }).join('');

  return `
    ${sectionHeader('Biosurveillance Network Status', badge)}
    <div style="${SUBTITLE_STYLE}">Network · scope · last update · status · geographic coverage gap</div>
    <table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>
  `;
}

export function renderPreparednessSection(rows: PreparednessScore[]): string {
  if (rows.length === 0) {
    return `${sectionHeader('Pandemic Preparedness Index')}<div style="${EMPTY_STYLE}">No preparedness data available.</div>`;
  }

  const sorted = sortPreparednessAscending(rows);
  const lowCount = countLowPreparednessCountries(rows);
  const badge = lowCount > 0 ? `${lowCount} limited` : undefined;
  const body = sorted.map((r) => {
    const color = preparednessTierColor(r.tier);
    const label = preparednessTierLabel(r.tier);
    return `
      <tr style="${ROW_BORDER}">
        <td style="${TD_STYLE};font-weight:600;color:${color}">${escapeHtml(r.country)}</td>
        <td style="${TD_STYLE};color:#facc15;text-align:right">${r.overall.toFixed(1)}</td>
        <td style="${TD_STYLE};color:#ccc;text-align:right">P ${r.prevention.toFixed(0)} · D ${r.detection.toFixed(0)} · R ${r.response.toFixed(0)} · H ${r.healthSystem.toFixed(0)}</td>
        <td style="${TD_STYLE};text-align:right">${badgeSpan(label, color)}</td>
      </tr>
    `;
  }).join('');

  return `
    ${sectionHeader('Pandemic Preparedness Index', badge)}
    <div style="${SUBTITLE_STYLE}">Country · GHS Index overall · prevention/detection/response/health-system · tier</div>
    <table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>
  `;
}
