/**
 * Pure helpers for HostageDiplomacyPanel.
 *
 * Tracks state-sanctioned hostage-taking and wrongful detention of foreign
 * nationals used as geopolitical leverage ("hostage diplomacy").
 *
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type DetentionStatus = 'Active' | 'Released' | 'Deceased';

export type DetainingCountry =
  | 'Iran'
  | 'Russia'
  | 'China'
  | 'North Korea'
  | 'Belarus'
  | 'Venezuela';

export type LeverageCategory =
  | 'sanctions-relief'
  | 'prisoner-swap'
  | 'diplomatic-concession'
  | 'espionage-pretext'
  | 'internal-suppression'
  | 'asset-seizure';

export interface HostageCase {
  id: string;
  detainee: string;
  citizenship: string[];
  detainingCountry: DetainingCountry;
  chargeAlleged: string;
  detentionDate: string;      // ISO date
  releaseDate?: string;       // ISO date if released
  status: DetentionStatus;
  leveragePurpose: string;
  leverageCategory: LeverageCategory;
  /** 1 (low) – 10 (critical) */
  severity: number;
  notes?: string;
}

export interface SwapEvent {
  date: string;               // ISO date
  detaineesReleased: string[];
  releasedBy: string;
  receivedBy: string;
  description: string;
}

export interface CountryScore {
  country: DetainingCountry;
  activeCases: number;
  totalCases: number;
  avgSeverity: number;
  /** Composite wrongful-detention score 0–100 */
  score: number;
}

export interface RenderData {
  cases: HostageCase[];
  activeCases: HostageCase[];
  recentReleases: HostageCase[];
  swapEvents: SwapEvent[];
  countryScores: CountryScore[];
  globalIndex: number;
  badgeCount: number;
}

// ── Static seed data ──────────────────────────────────────────────────────

export const HOSTAGE_CASES: HostageCase[] = [
  {
    id: 'IR-001',
    detainee: 'Nazanin Zaghari-Ratcliffe',
    citizenship: ['UK', 'Iran'],
    detainingCountry: 'Iran',
    chargeAlleged: 'Espionage / propaganda against state',
    detentionDate: '2016-04-03',
    releaseDate: '2022-03-16',
    status: 'Released',
    leveragePurpose: 'UK debt repayment (400 M GBP Chieftain tank debt)',
    leverageCategory: 'asset-seizure',
    severity: 8,
    notes: 'Held ~6 years; released after UK settled historic arms debt.',
  },
  {
    id: 'IR-002',
    detainee: 'Morad Tahbaz',
    citizenship: ['UK', 'US', 'Iran'],
    detainingCountry: 'Iran',
    chargeAlleged: 'Espionage / cooperation with hostile government',
    detentionDate: '2018-01-05',
    status: 'Active',
    leveragePurpose: 'Multi-state leverage; US-Iran nuclear negotiations',
    leverageCategory: 'diplomatic-concession',
    severity: 9,
    notes: 'Triple national; furloughed 2023 then recalled to Evin Prison.',
  },
  {
    id: 'IR-003',
    detainee: 'Siamak Namazi',
    citizenship: ['US', 'Iran'],
    detainingCountry: 'Iran',
    chargeAlleged: 'Cooperation with hostile government',
    detentionDate: '2015-10-13',
    releaseDate: '2023-09-18',
    status: 'Released',
    leveragePurpose: 'US frozen assets (6 B USD) repatriation',
    leverageCategory: 'sanctions-relief',
    severity: 9,
    notes: 'Longest-held US citizen in Iran; released in 5-for-5 exchange.',
  },
  {
    id: 'IR-004',
    detainee: 'Cecile Kohler',
    citizenship: ['France'],
    detainingCountry: 'Iran',
    chargeAlleged: 'Espionage / inciting unrest',
    detentionDate: '2022-05-07',
    status: 'Active',
    leveragePurpose: 'French diplomatic concessions; frozen Iranian assets in Europe',
    leverageCategory: 'diplomatic-concession',
    severity: 8,
    notes: 'French teacher and union official; held in Evin Prison.',
  },
  {
    id: 'RU-001',
    detainee: 'Evan Gershkovich',
    citizenship: ['US'],
    detainingCountry: 'Russia',
    chargeAlleged: 'Espionage (denied by WSJ and US government)',
    detentionDate: '2023-03-29',
    releaseDate: '2024-08-01',
    status: 'Released',
    leveragePurpose: 'Prisoner swap for Russian arms dealer Vadim Krasikov',
    leverageCategory: 'prisoner-swap',
    severity: 9,
    notes: 'First US journalist arrested in Russia on espionage charges since Cold War.',
  },
  {
    id: 'RU-002',
    detainee: 'Paul Whelan',
    citizenship: ['US', 'UK', 'Canada', 'Ireland'],
    detainingCountry: 'Russia',
    chargeAlleged: 'Espionage',
    detentionDate: '2018-12-28',
    releaseDate: '2024-08-01',
    status: 'Released',
    leveragePurpose: 'Multi-lateral prisoner swap (Ankara, Aug 2024)',
    leverageCategory: 'prisoner-swap',
    severity: 8,
    notes: 'Held 5.5 years; released alongside Gershkovich in 24-person swap.',
  },
  {
    id: 'RU-003',
    detainee: 'Marc Fogel',
    citizenship: ['US'],
    detainingCountry: 'Russia',
    chargeAlleged: 'Drug smuggling (medical cannabis)',
    detentionDate: '2021-08-14',
    releaseDate: '2023-12-19',
    status: 'Released',
    leveragePurpose: 'Swap for Russian sanctions-evader Vadim Konoshchenok',
    leverageCategory: 'prisoner-swap',
    severity: 6,
    notes: 'US teacher sentenced to 14 years; released in bilateral exchange.',
  },
  {
    id: 'RU-004',
    detainee: 'Brittney Griner',
    citizenship: ['US'],
    detainingCountry: 'Russia',
    chargeAlleged: 'Drug smuggling (cannabis oil cartridges)',
    detentionDate: '2022-02-17',
    releaseDate: '2022-12-08',
    status: 'Released',
    leveragePurpose: 'Swap for arms dealer Viktor Bout',
    leverageCategory: 'prisoner-swap',
    severity: 7,
    notes: 'WNBA star; released after 10 months for high-value Russian national.',
  },
  {
    id: 'CN-001',
    detainee: 'Michael Kovrig',
    citizenship: ['Canada'],
    detainingCountry: 'China',
    chargeAlleged: 'Espionage / stealing state secrets',
    detentionDate: '2018-12-10',
    releaseDate: '2021-09-24',
    status: 'Released',
    leveragePurpose: 'Pressure Canada to release Huawei CFO Meng Wanzhou',
    leverageCategory: 'prisoner-swap',
    severity: 9,
    notes: 'One of the Two Michaels; former Canadian diplomat and ICG analyst.',
  },
  {
    id: 'CN-002',
    detainee: 'Michael Spavor',
    citizenship: ['Canada'],
    detainingCountry: 'China',
    chargeAlleged: 'Espionage / providing state secrets',
    detentionDate: '2018-12-10',
    releaseDate: '2021-09-24',
    status: 'Released',
    leveragePurpose: 'Pressure Canada to release Huawei CFO Meng Wanzhou',
    leverageCategory: 'prisoner-swap',
    severity: 9,
    notes: 'Sentenced to 11 years before release; arrested same day as Kovrig.',
  },
  {
    id: 'KP-001',
    detainee: 'Otto Warmbier',
    citizenship: ['US'],
    detainingCountry: 'North Korea',
    chargeAlleged: 'Hostile acts against the state (removing propaganda poster)',
    detentionDate: '2016-01-02',
    releaseDate: '2017-06-13',
    status: 'Deceased',
    leveragePurpose: 'Diplomatic leverage / propaganda value',
    leverageCategory: 'diplomatic-concession',
    severity: 10,
    notes: 'Returned in vegetative state; died 6 days after release. Age 22.',
  },
  {
    id: 'BY-001',
    detainee: 'Roman Protasevich',
    citizenship: ['Belarus'],
    detainingCountry: 'Belarus',
    chargeAlleged: 'Terrorism / inciting mass unrest',
    detentionDate: '2021-05-23',
    releaseDate: '2023-01-05',
    status: 'Released',
    leveragePurpose: 'Silence opposition; extract intelligence on protest networks',
    leverageCategory: 'internal-suppression',
    severity: 8,
    notes: 'Ryanair flight RZ4978 forced to land; journalist arrested mid-flight.',
  },
];

export const SWAP_EVENTS: SwapEvent[] = [
  {
    date: '2024-08-01',
    detaineesReleased: ['Evan Gershkovich', 'Paul Whelan', 'Vladimir Kara-Murza'],
    releasedBy: 'Russia',
    receivedBy: 'US / Germany / others',
    description: '24-person multilateral exchange in Ankara; largest post-Cold War swap.',
  },
  {
    date: '2023-12-19',
    detaineesReleased: ['Marc Fogel'],
    releasedBy: 'Russia',
    receivedBy: 'US',
    description: 'Bilateral swap for Vadim Konoshchenok, charged with sanctions evasion.',
  },
  {
    date: '2023-09-18',
    detaineesReleased: ['Siamak Namazi', 'Morad Tahbaz (furloughed)', 'Emad Sharghi'],
    releasedBy: 'Iran',
    receivedBy: 'US',
    description: 'Five-for-five exchange; US unfroze 6 B USD in South Korean-held Iranian assets.',
  },
  {
    date: '2022-12-08',
    detaineesReleased: ['Brittney Griner'],
    releasedBy: 'Russia',
    receivedBy: 'US',
    description: 'One-for-one swap: Griner exchanged for Viktor Bout at Abu Dhabi airport.',
  },
  {
    date: '2022-03-16',
    detaineesReleased: ['Nazanin Zaghari-Ratcliffe', 'Anoosheh Ashoori'],
    releasedBy: 'Iran',
    receivedBy: 'UK',
    description: 'Released after UK settled 400 M GBP historic debt for Chieftain tanks.',
  },
  {
    date: '2021-09-24',
    detaineesReleased: ['Michael Kovrig', 'Michael Spavor'],
    releasedBy: 'China',
    receivedBy: 'Canada',
    description: 'Released simultaneously with resolution of Meng Wanzhou extradition case.',
  },
];

// ── Query helpers ─────────────────────────────────────────────────────────

export function getActiveCases(cases: HostageCase[] = HOSTAGE_CASES): HostageCase[] {
  return cases.filter((c) => c.status === 'Active');
}

export function getByDetainingCountry(
  country: DetainingCountry,
  cases: HostageCase[] = HOSTAGE_CASES,
): HostageCase[] {
  return cases.filter((c) => c.detainingCountry === country);
}

export function getHighSeverityCases(
  threshold = 8,
  cases: HostageCase[] = HOSTAGE_CASES,
): HostageCase[] {
  return cases.filter((c) => c.severity >= threshold);
}

export function getMostRecentReleases(
  n = 3,
  cases: HostageCase[] = HOSTAGE_CASES,
): HostageCase[] {
  return cases
    .filter((c) => c.status === 'Released' && c.releaseDate !== undefined)
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''))
    .slice(0, n);
}

export function getDeceasedCases(cases: HostageCase[] = HOSTAGE_CASES): HostageCase[] {
  return cases.filter((c) => c.status === 'Deceased');
}

// ── Duration helpers ──────────────────────────────────────────────────────

/** Returns number of days between detentionDate and releaseDate (or today). */
export function detentionDurationDays(detentionDate: string, releaseDate?: string): number {
  const start = new Date(detentionDate).getTime();
  const end   = releaseDate ? new Date(releaseDate).getTime() : Date.now();
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function formatDuration(days: number): string {
  if (days <= 0)  return '0 days';
  if (days < 30)  return String(days) + 'd';
  if (days < 365) return String(Math.round(days / 30)) + 'mo';
  const years  = Math.floor(days / 365);
  const months = Math.round((days % 365) / 30);
  return months > 0 ? String(years) + 'y ' + String(months) + 'mo' : String(years) + 'y';
}

// ── Classification helpers ────────────────────────────────────────────────

export function statusClass(status: DetentionStatus): string {
  const map: Record<DetentionStatus, string> = {
    Active:   'var(--severity-critical, #ef4444)',
    Released: 'var(--severity-low,      #4caf50)',
    Deceased: 'var(--severity-none,     #9e9e9e)',
  };
  return map[status];
}

export function leverageClass(category: LeverageCategory): string {
  const map: Record<LeverageCategory, string> = {
    'sanctions-relief':      'var(--severity-high,     #fb923c)',
    'prisoner-swap':         'var(--severity-medium,   #facc15)',
    'diplomatic-concession': 'var(--severity-high,     #fb923c)',
    'espionage-pretext':     'var(--severity-critical, #ef4444)',
    'internal-suppression':  'var(--severity-high,     #fb923c)',
    'asset-seizure':         'var(--severity-medium,   #facc15)',
  };
  return map[category];
}

export function severityColor(severity: number): string {
  if (severity >= 9) return 'var(--severity-critical, #ef4444)';
  if (severity >= 7) return 'var(--severity-high,     #fb923c)';
  if (severity >= 5) return 'var(--severity-medium,   #facc15)';
  return                     'var(--severity-low,      #4caf50)';
}

export function leverageCategoryLabel(cat: LeverageCategory): string {
  const map: Record<LeverageCategory, string> = {
    'sanctions-relief':      'Sanctions Relief',
    'prisoner-swap':         'Prisoner Swap',
    'diplomatic-concession': 'Diplomatic Concession',
    'espionage-pretext':     'Espionage Pretext',
    'internal-suppression':  'Internal Suppression',
    'asset-seizure':         'Asset Seizure',
  };
  return map[cat];
}

// ── Scoring ───────────────────────────────────────────────────────────────

/**
 * Composite wrongful-detention score for a country (0–100).
 * Active cases weighted at 1.0x, deceased at 0.9x, released at 0.4x.
 */
export function countryWrongfulDetentionScore(
  country: DetainingCountry,
  cases: HostageCase[] = HOSTAGE_CASES,
): number {
  const cc = getByDetainingCountry(country, cases);
  if (cc.length === 0) return 0;
  let score = 0;
  for (const c of cc) {
    let w = 0.4;
    if (c.status === 'Active') w = 1;
    else if (c.status === 'Deceased') w = 0.9;
    score += c.severity * w;
  }
  return Math.min(100, Math.round((score / cc.length) * 10));
}

/**
 * Global hostage-diplomacy index: average severity of active cases scaled to 0-100.
 */
export function globalHostageDiplomacyIndex(cases: HostageCase[] = HOSTAGE_CASES): number {
  const active = getActiveCases(cases);
  if (active.length === 0) return 0;
  const sum = active.reduce((s, c) => s + c.severity, 0);
  return Math.min(100, Math.round((sum / active.length) * 10));
}

export function buildCountryScores(cases: HostageCase[] = HOSTAGE_CASES): CountryScore[] {
  const countries: DetainingCountry[] = [
    'Iran', 'Russia', 'China', 'North Korea', 'Belarus', 'Venezuela',
  ];
  return countries
    .map((country) => {
      const all    = getByDetainingCountry(country, cases);
      const active = all.filter((c) => c.status === 'Active');
      const avgSev = all.length
        ? Math.round((all.reduce((s, c) => s + c.severity, 0) / all.length) * 10) / 10
        : 0;
      return {
        country,
        activeCases: active.length,
        totalCases:  all.length,
        avgSeverity: avgSev,
        score:       countryWrongfulDetentionScore(country, cases),
      };
    })
    .sort((a, b) => b.score - a.score);
}

// ── Render data ───────────────────────────────────────────────────────────

export function buildRenderData(cases: HostageCase[] = HOSTAGE_CASES): RenderData {
  const activeCases    = getActiveCases(cases);
  const recentReleases = getMostRecentReleases(4, cases);
  const countryScores  = buildCountryScores(cases);
  const globalIndex    = globalHostageDiplomacyIndex(cases);
  const badgeCount     = activeCases.length + getHighSeverityCases(9, cases).length;
  return {
    cases,
    activeCases,
    recentReleases,
    swapEvents: SWAP_EVENTS,
    countryScores,
    globalIndex,
    badgeCount,
  };
}
