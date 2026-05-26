/**
 * Pure helpers for UrbanSecurityPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type UnrestType = 'protest' | 'riot' | 'looting' | 'strike' | 'siege';
export type UnrestIntensity = 'low' | 'moderate' | 'high' | 'severe';
export type EventOutcome = 'ongoing' | 'dispersed' | 'escalated' | 'suppressed' | 'resolved';
export type TerritoryControl = 'state' | 'contested' | 'criminal' | 'fragmented' | 'no-go';
export type TrendDirection = 'improving' | 'stable' | 'deteriorating';
export type TensionTrajectory = 'rising' | 'stable' | 'falling';
export type IncidentCategory = 'violent-crime' | 'property-crime' | 'civil-disorder' | 'terrorism' | 'trafficking';
export type AlertLevel = 0 | 1 | 2 | 3 | 4;

export interface UnrestHotspot {
  city: string;
  country: string;
  unrestType: UnrestType;
  intensity: UnrestIntensity;
  participants: number;
  daysActive: number;
  trigger: string;
}

export interface ProtestEvent {
  city: string;
  country: string;
  date: string;
  participants: number;
  outcome: EventOutcome;
  casualties: number;
  description: string;
}

export interface GangTerritoryIndicator {
  city: string;
  country: string;
  controlType: TerritoryControl;
  activeFactions: number;
  homicidePer100k: number;
  trend: TrendDirection;
  factionNote: string;
}

export interface UrbanViolenceIndex {
  city: string;
  country: string;
  score: number;
  globalRank: number;
  trend: TrendDirection;
  dominantDriver: string;
}

export interface PoliceIncidentFeed {
  city: string;
  country: string;
  incidentCategory: IncidentCategory;
  dailyAverage: number;
  hotspotDistrict: string;
  alertLevel: AlertLevel;
}

export interface SocialTensionScore {
  metro: string;
  country: string;
  tensionScore: number;
  trajectory: TensionTrajectory;
  drivers: string[];
}

// ── Unrest type helpers ───────────────────────────────────────────────────

export function unrestTypeColor(t: UnrestType): string {
  const colors: Record<UnrestType, string> = {
    protest: 'var(--severity-medium,   #facc15)',
    strike:  'var(--severity-medium,   #facc15)',
    riot:    'var(--severity-high,     #fb923c)',
    looting: 'var(--severity-high,     #fb923c)',
    siege:   'var(--severity-critical, #ef4444)',
  };
  return colors[t];
}

export function unrestTypeLabel(t: UnrestType): string {
  const labels: Record<UnrestType, string> = {
    protest: 'Protest',
    strike:  'Strike',
    riot:    'Riot',
    looting: 'Looting',
    siege:   'Siege',
  };
  return labels[t];
}

// ── Unrest intensity helpers ──────────────────────────────────────────────

export function unrestIntensityColor(i: UnrestIntensity): string {
  const colors: Record<UnrestIntensity, string> = {
    low:      'var(--severity-low,      #4caf50)',
    moderate: 'var(--severity-medium,   #facc15)',
    high:     'var(--severity-high,     #fb923c)',
    severe:   'var(--severity-critical, #ef4444)',
  };
  return colors[i];
}

export function unrestIntensityLabel(i: UnrestIntensity): string {
  const labels: Record<UnrestIntensity, string> = {
    low:      'Low',
    moderate: 'Moderate',
    high:     'High',
    severe:   'Severe',
  };
  return labels[i];
}

// ── Event outcome helpers ─────────────────────────────────────────────────

export function eventOutcomeColor(o: EventOutcome): string {
  const colors: Record<EventOutcome, string> = {
    resolved:   'var(--severity-low,      #4caf50)',
    dispersed:  'var(--severity-medium,   #facc15)',
    ongoing:    'var(--severity-medium,   #facc15)',
    suppressed: 'var(--severity-high,     #fb923c)',
    escalated:  'var(--severity-critical, #ef4444)',
  };
  return colors[o];
}

export function eventOutcomeLabel(o: EventOutcome): string {
  const labels: Record<EventOutcome, string> = {
    resolved:   'Resolved',
    dispersed:  'Dispersed',
    ongoing:    'Ongoing',
    suppressed: 'Suppressed',
    escalated:  'Escalated',
  };
  return labels[o];
}

// ── Territory control helpers ─────────────────────────────────────────────

export function territoryControlColor(c: TerritoryControl): string {
  const colors: Record<TerritoryControl, string> = {
    state:      'var(--severity-low,      #4caf50)',
    fragmented: 'var(--severity-medium,   #facc15)',
    contested:  'var(--severity-high,     #fb923c)',
    criminal:   'var(--severity-critical, #ef4444)',
    'no-go':    'var(--severity-critical, #ef4444)',
  };
  return colors[c];
}

export function territoryControlLabel(c: TerritoryControl): string {
  const labels: Record<TerritoryControl, string> = {
    state:      'State Control',
    fragmented: 'Fragmented',
    contested:  'Contested',
    criminal:   'Criminal Control',
    'no-go':    'No-Go Zone',
  };
  return labels[c];
}

// ── Trend direction helpers ───────────────────────────────────────────────

export function trendDirectionColor(t: TrendDirection): string {
  const colors: Record<TrendDirection, string> = {
    improving:    'var(--severity-low,    #4caf50)',
    stable:       'var(--severity-none,   #9e9e9e)',
    deteriorating: 'var(--severity-critical, #ef4444)',
  };
  return colors[t];
}

export function trendDirectionLabel(t: TrendDirection): string {
  const labels: Record<TrendDirection, string> = {
    improving:    'Improving',
    stable:       'Stable',
    deteriorating: 'Deteriorating',
  };
  return labels[t];
}

// ── Tension trajectory helpers ────────────────────────────────────────────

export function tensionTrajectoryColor(t: TensionTrajectory): string {
  const colors: Record<TensionTrajectory, string> = {
    rising:  'var(--severity-critical, #ef4444)',
    stable:  'var(--severity-none,     #9e9e9e)',
    falling: 'var(--severity-low,      #4caf50)',
  };
  return colors[t];
}

export function tensionTrajectoryLabel(t: TensionTrajectory): string {
  const labels: Record<TensionTrajectory, string> = {
    rising:  'Rising',
    stable:  'Stable',
    falling: 'Falling',
  };
  return labels[t];
}

// ── Incident category helpers ─────────────────────────────────────────────

export function incidentCategoryColor(c: IncidentCategory): string {
  const colors: Record<IncidentCategory, string> = {
    terrorism:       'var(--severity-critical, #ef4444)',
    'violent-crime': 'var(--severity-high,     #fb923c)',
    'civil-disorder': 'var(--severity-high,    #fb923c)',
    trafficking:     'var(--severity-medium,   #facc15)',
    'property-crime': 'var(--severity-low,     #4caf50)',
  };
  return colors[c];
}

export function incidentCategoryLabel(c: IncidentCategory): string {
  const labels: Record<IncidentCategory, string> = {
    terrorism:       'Terrorism',
    'violent-crime': 'Violent Crime',
    'civil-disorder': 'Civil Disorder',
    trafficking:     'Trafficking',
    'property-crime': 'Property Crime',
  };
  return labels[c];
}

// ── Alert level helpers ───────────────────────────────────────────────────

export function alertLevelColor(l: AlertLevel): string {
  const colors: Record<AlertLevel, string> = {
    0: 'var(--severity-none,     #9e9e9e)',
    1: 'var(--severity-low,      #4caf50)',
    2: 'var(--severity-medium,   #facc15)',
    3: 'var(--severity-high,     #fb923c)',
    4: 'var(--severity-critical, #ef4444)',
  };
  return colors[l];
}

export function alertLevelLabel(l: AlertLevel): string {
  const labels: Record<AlertLevel, string> = {
    0: 'None',
    1: 'Low',
    2: 'Elevated',
    3: 'High',
    4: 'Critical',
  };
  return labels[l];
}

// ── Score-based color helpers ─────────────────────────────────────────────

export function violenceScoreColor(score: number): string {
  if (score >= 8) return 'var(--severity-critical, #ef4444)';
  if (score >= 6) return 'var(--severity-high,     #fb923c)';
  if (score >= 4) return 'var(--severity-medium,   #facc15)';
  return 'var(--severity-low, #4caf50)';
}

export function tensionScoreColor(score: number): string {
  return violenceScoreColor(score);
}

// ── Count helpers ─────────────────────────────────────────────────────────

export function countHighIntensityHotspots(hotspots: UnrestHotspot[]): number {
  return hotspots.filter((h) => h.intensity === 'high' || h.intensity === 'severe').length;
}

export function countNoGoZones(territories: GangTerritoryIndicator[]): number {
  return territories.filter(
    (t) => t.controlType === 'no-go' || t.controlType === 'criminal',
  ).length;
}

export function countHighAlertCities(feeds: PoliceIncidentFeed[]): number {
  return feeds.filter((f) => f.alertLevel >= 3).length;
}

export function countRisingTensionCities(scores: SocialTensionScore[]): number {
  return scores.filter((s) => s.trajectory === 'rising').length;
}

export function countEscalatedEvents(events: ProtestEvent[]): number {
  return events.filter((e) => e.outcome === 'escalated').length;
}

// ── Static data ───────────────────────────────────────────────────────────

export const UNREST_HOTSPOTS: UnrestHotspot[] = [
  {
    city:         'Port-au-Prince',
    country:      'Haiti',
    unrestType:   'siege',
    intensity:    'severe',
    participants: 0,
    daysActive:   180,
    trigger:      'Gang coalition (Viv Ansanm) controls 85% of city; government paralysis; UN MSS deploying',
  },
  {
    city:         'Nairobi',
    country:      'Kenya',
    unrestType:   'riot',
    intensity:    'severe',
    participants: 15_000,
    daysActive:   4,
    trigger:      'Finance Bill tax hikes; Gen Z–led protests turned violent; parliament stormed June 2024 sequel',
  },
  {
    city:         'Tbilisi',
    country:      'Georgia',
    unrestType:   'protest',
    intensity:    'high',
    participants: 30_000,
    daysActive:   14,
    trigger:      'Ruling party foreign agent law; EU membership aspirations; police pepper spray response',
  },
  {
    city:         'Paris',
    country:      'France',
    unrestType:   'protest',
    intensity:    'high',
    participants: 50_000,
    daysActive:   8,
    trigger:      'Pre-election pension reform tensions; RN vs. left-wing street clashes; 3rd arrondissement blockades',
  },
  {
    city:         'Buenos Aires',
    country:      'Argentina',
    unrestType:   'protest',
    intensity:    'moderate',
    participants: 75_000,
    daysActive:   12,
    trigger:      'Milei austerity — university funding cuts, pensioner benefit reductions, peso depreciation',
  },
  {
    city:         'Mexico City',
    country:      'Mexico',
    unrestType:   'strike',
    intensity:    'moderate',
    participants: 20_000,
    daysActive:   5,
    trigger:      'CNTE teachers union strike; judicial reform opposition; Zócalo blockade ongoing',
  },
];

export const PROTEST_EVENTS: ProtestEvent[] = [
  {
    city:         'Dhaka',
    country:      'Bangladesh',
    date:         '2026-05-20',
    participants: 100_000,
    outcome:      'escalated',
    casualties:   3,
    description:  'Student protests over civil service quota reform turn violent; security forces deploy tear gas',
  },
  {
    city:         'Seoul',
    country:      'South Korea',
    date:         '2026-05-23',
    participants: 60_000,
    outcome:      'ongoing',
    casualties:   0,
    description:  'Opposition impeachment rally; Constitutional Court decision pending; Gwanghwamun Plaza occupied',
  },
  {
    city:         'São Paulo',
    country:      'Brazil',
    date:         '2026-05-22',
    participants: 45_000,
    outcome:      'dispersed',
    casualties:   0,
    description:  'Anti-Lula rally organized by Bolsonaristas; peaceful dispersal; PT counter-protest same day',
  },
  {
    city:         'Bogotá',
    country:      'Colombia',
    date:         '2026-05-18',
    participants: 25_000,
    outcome:      'suppressed',
    casualties:   2,
    description:  'Coca farmer paro civico; ESMAD deployed; Caquetá / Putumayo rural highways blocked',
  },
  {
    city:         'Lagos',
    country:      'Nigeria',
    date:         '2026-05-21',
    participants: 15_000,
    outcome:      'resolved',
    casualties:   1,
    description:  '#EndBadGovernance 2 — economic hardship protest; government dialogue offer accepted by organizers',
  },
];

export const GANG_TERRITORY_INDICATORS: GangTerritoryIndicator[] = [
  {
    city:            'Port-au-Prince',
    country:         'Haiti',
    controlType:     'no-go',
    activeFactions:  9,
    homicidePer100k: 143,
    trend:           'deteriorating',
    factionNote:     'G9/GPep merger into Viv Ansanm; Jimmy Chérizier (Barbecue) commands coalition',
  },
  {
    city:            'Culiacán',
    country:         'Mexico',
    controlType:     'contested',
    activeFactions:  3,
    homicidePer100k: 89,
    trend:           'deteriorating',
    factionNote:     'Los Chapitos vs. Ismael Zambada factions; internal CDS civil war since 2023 arrest',
  },
  {
    city:            'Cape Town',
    country:         'South Africa',
    controlType:     'criminal',
    activeFactions:  7,
    homicidePer100k: 67,
    trend:           'deteriorating',
    factionNote:     'Cape Flats — Americans / Hard Livings / Fancy Boys / Terrible Josters rivalry active',
  },
  {
    city:            'Baltimore',
    country:         'USA',
    controlType:     'contested',
    activeFactions:  12,
    homicidePer100k: 52,
    trend:           'stable',
    factionNote:     'East vs. West side street crews; Key Bridge collapse disrupted trafficking routes',
  },
  {
    city:            'Medellín',
    country:         'Colombia',
    controlType:     'fragmented',
    activeFactions:  6,
    homicidePer100k: 38,
    trend:           'stable',
    factionNote:     'La Oficina parceling to AGC / La Sierra; total paz total deal partially holding',
  },
];

export const URBAN_VIOLENCE_INDEX: UrbanViolenceIndex[] = [
  {
    city:          'Port-au-Prince',
    country:       'Haiti',
    score:         9.8,
    globalRank:    1,
    trend:         'deteriorating',
    dominantDriver: 'Total gang state capture; UN force deployment delayed',
  },
  {
    city:          'Culiacán',
    country:       'Mexico',
    score:         8.4,
    globalRank:    5,
    trend:         'deteriorating',
    dominantDriver: 'Cartel civil war — Sinaloa internal fragmentation',
  },
  {
    city:          'Cape Town',
    country:       'South Africa',
    score:         7.1,
    globalRank:    12,
    trend:         'stable',
    dominantDriver: 'Gang warfare, SAPS capacity gaps, social inequality',
  },
  {
    city:          'Baltimore',
    country:       'USA',
    score:         6.2,
    globalRank:    22,
    trend:         'stable',
    dominantDriver: 'Firearms proliferation, poverty concentration, policing capacity',
  },
  {
    city:          'Nairobi',
    country:       'Kenya',
    score:         5.6,
    globalRank:    31,
    trend:         'deteriorating',
    dominantDriver: 'Youth unemployment, protest spillover, Mathare / Kibera hotspots',
  },
  {
    city:          'Medellín',
    country:       'Colombia',
    score:         5.2,
    globalRank:    35,
    trend:         'improving',
    dominantDriver: 'Partial dismantling of La Oficina; social urbanism legacy',
  },
];

export const POLICE_INCIDENT_FEEDS: PoliceIncidentFeed[] = [
  {
    city:             'Karachi',
    country:          'Pakistan',
    incidentCategory: 'violent-crime',
    dailyAverage:     210,
    hotspotDistrict:  'Lyari / Orangi Town',
    alertLevel:       4,
  },
  {
    city:             'Rio de Janeiro',
    country:          'Brazil',
    incidentCategory: 'civil-disorder',
    dailyAverage:     89,
    hotspotDistrict:  'Complexo do Alemão / Maré',
    alertLevel:       4,
  },
  {
    city:             'Chicago',
    country:          'USA',
    incidentCategory: 'violent-crime',
    dailyAverage:     145,
    hotspotDistrict:  'South Side / Englewood',
    alertLevel:       3,
  },
  {
    city:             'London',
    country:          'UK',
    incidentCategory: 'trafficking',
    dailyAverage:     34,
    hotspotDistrict:  'Stratford / East End',
    alertLevel:       2,
  },
  {
    city:             'Marseille',
    country:          'France',
    incidentCategory: 'trafficking',
    dailyAverage:     28,
    hotspotDistrict:  '13ème / 14ème arrondissement',
    alertLevel:       2,
  },
];

export const SOCIAL_TENSION_SCORES: SocialTensionScore[] = [
  {
    metro:        'Nairobi',
    country:      'Kenya',
    tensionScore: 8.1,
    trajectory:   'rising',
    drivers:      ['youth unemployment 35%', 'cost-of-living shock', 'political exclusion', 'Gen Z mobilization'],
  },
  {
    metro:        'Tbilisi',
    country:      'Georgia',
    tensionScore: 7.5,
    trajectory:   'rising',
    drivers:      ['EU integration backlash', 'ruling party authoritarianism', 'foreign agent law', 'media crackdown'],
  },
  {
    metro:        'Paris',
    country:      'France',
    tensionScore: 7.2,
    trajectory:   'rising',
    drivers:      ['pension conflict', 'immigration polarization', 'RN electoral surge', 'banlieue frustration'],
  },
  {
    metro:        'Buenos Aires',
    country:      'Argentina',
    tensionScore: 6.8,
    trajectory:   'stable',
    drivers:      ['inflation 270%', 'austerity fatigue', 'Milei opposition', 'peso depreciation'],
  },
  {
    metro:        'Chicago',
    country:      'USA',
    tensionScore: 5.9,
    trajectory:   'stable',
    drivers:      ['gun violence epidemic', 'racial equity gap', 'policing reform stall', 'fiscal pressure'],
  },
];
