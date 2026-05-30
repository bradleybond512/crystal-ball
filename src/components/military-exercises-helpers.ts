/**
 * Pure helpers for MilitaryExercisesPanel.
 *
 * Tracks major military exercises as geopolitical signals. Scale, location,
 * and timing of exercises reveal strategic intent and readiness.
 *
 * No DOM, no fetch — safe to import in Node.js tests.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExerciseType   = 'Joint' | 'Naval' | 'Air' | 'Ground' | 'Cyber';
export type ExerciseRegion = 'Pacific' | 'Europe' | 'Middle East' | 'South Asia' | 'Arctic';
export type ThreatLevel    = 'routine' | 'elevated' | 'high' | 'critical';
export type SignalType =
  | 'deterrence'
  | 'coercion'
  | 'alliance_solidarity'
  | 'power_projection'
  | 'readiness'
  | 'intimidation';

export interface MilitaryExercise {
  id:           string;
  name:         string;
  leadNation:   string;
  participants: string[];
  location:     string;
  region:       ExerciseRegion;
  troops:       number;
  type:         ExerciseType;
  date:         string;
  signal:       string;
  signalType:   SignalType;
  threatLevel:  ThreatLevel;
}

export interface RegionalIntensity {
  region:             ExerciseRegion;
  exerciseCount:      number;
  totalTroops:        number;
  largeExerciseCount: number;
  intensityScore:     number; // 0–100 composite
  level:              ThreatLevel;
}

// ── Static Data ───────────────────────────────────────────────────────────────

export const EXERCISES: MilitaryExercise[] = [
  {
    id:           'rimpac-2024',
    name:         'RIMPAC 2024',
    leadNation:   'USA',
    participants: ['USA', 'Japan', 'Australia', 'Canada', 'UK', 'South Korea', '+22 others'],
    location:     'Hawaii & Eastern Pacific',
    region:       'Pacific',
    troops:       25000,
    type:         'Naval',
    date:         'June–August 2024',
    signal:       'Largest multinational naval exercise; demonstrates US-led Pacific maritime dominance and coalition interoperability against Chinese naval expansion.',
    signalType:   'deterrence',
    threatLevel:  'elevated',
  },
  {
    id:           'steadfast-defender-2024',
    name:         'NATO Steadfast Defender 2024',
    leadNation:   'NATO',
    participants: ['USA', 'Germany', 'UK', 'Poland', 'France', '+27 NATO allies'],
    location:     'Northern & Eastern Europe',
    region:       'Europe',
    troops:       90000,
    type:         'Joint',
    date:         'January–May 2024',
    signal:       'Largest NATO exercise since the Cold War; Article 5 collective-defense rehearsal along the eastern flank in direct response to the Russian invasion of Ukraine.',
    signalType:   'alliance_solidarity',
    threatLevel:  'high',
  },
  {
    id:           'joint-sword-2024a',
    name:         'PLA Joint Sword 2024',
    leadNation:   'China',
    participants: ['China (PLA)'],
    location:     'Taiwan Strait',
    region:       'Pacific',
    troops:       60000,
    type:         'Joint',
    date:         'April 2024',
    signal:       "Second Taiwan encirclement exercise in 18 months; simulates blockade and fire-strike operations against Taiwan following Lai Ching-te's inauguration.",
    signalType:   'coercion',
    threatLevel:  'critical',
  },
  {
    id:           'joint-sword-2024b',
    name:         'PLA Joint Sword-2024B',
    leadNation:   'China',
    participants: ['China (PLA)'],
    location:     'Taiwan Strait & East China Sea',
    region:       'Pacific',
    troops:       50000,
    type:         'Joint',
    date:         'October 2024',
    signal:       'Third Taiwan encirclement; pattern of graduated coercion establishes new operational norms; includes coast-guard interdiction scenarios, signaling blockade capability.',
    signalType:   'intimidation',
    threatLevel:  'critical',
  },
  {
    id:           'zapad-2023',
    name:         'Zapad-2023',
    leadNation:   'Russia',
    participants: ['Russia', 'Belarus'],
    location:     'Western Russia & Belarus',
    region:       'Europe',
    troops:       70000,
    type:         'Joint',
    date:         'September 2023',
    signal:       'Western strategic-direction exercise validates operational concepts against NATO; probes the Suwalki Gap linking Belarus to Kaliningrad.',
    signalType:   'power_projection',
    threatLevel:  'high',
  },
  {
    id:           'vostok-2023',
    name:         'Vostok-2023',
    leadNation:   'Russia',
    participants: ['Russia', 'China', 'Mongolia', 'Laos', 'Nicaragua'],
    location:     'Russian Far East',
    region:       'Pacific',
    troops:       50000,
    type:         'Joint',
    date:         'September 2023',
    signal:       "Signals deepening Russia-China defense alignment; China's participation validates the no-limits partnership and Pacific strategic coordination.",
    signalType:   'alliance_solidarity',
    threatLevel:  'elevated',
  },
  {
    id:           'freedom-shield-2024',
    name:         'US-ROK Freedom Shield 2024',
    leadNation:   'USA',
    participants: ['USA', 'South Korea'],
    location:     'Korean Peninsula',
    region:       'Pacific',
    troops:       11000,
    type:         'Joint',
    date:         'March 2024',
    signal:       'Annual combined-defense exercise signals sustained US extended deterrence on the peninsula following North Korean hypersonic and ICBM test series.',
    signalType:   'deterrence',
    threatLevel:  'elevated',
  },
  {
    id:           'balikatan-2024',
    name:         'Balikatan 2024',
    leadNation:   'USA',
    participants: ['USA', 'Philippines'],
    location:     'Philippines (Luzon, Batanes, Palawan)',
    region:       'Pacific',
    troops:       16000,
    type:         'Joint',
    date:         'April–May 2024',
    signal:       'Largest-ever US-Philippines exercise; dramatic scope expansion signals renewed alliance depth and US commitment to defend the Philippines in South China Sea disputes.',
    signalType:   'deterrence',
    threatLevel:  'elevated',
  },
  {
    id:           'yudh-abhyas-2023',
    name:         'Yudh Abhyas 2023',
    leadNation:   'India',
    participants: ['India', 'USA'],
    location:     'Uttarakhand, India (high altitude)',
    region:       'South Asia',
    troops:       600,
    type:         'Ground',
    date:         'November 2023',
    signal:       'High-altitude joint training deepens US-India defense ties; signals strategic hedging by India amid ongoing China border tensions in Ladakh.',
    signalType:   'alliance_solidarity',
    threatLevel:  'routine',
  },
  {
    id:           'iron-wolf-2024',
    name:         'NATO Iron Wolf 2024',
    leadNation:   'NATO',
    participants: ['Germany', 'Lithuania', 'USA', 'Netherlands', 'Belgium'],
    location:     'Lithuania & Baltic states',
    region:       'Europe',
    troops:       8000,
    type:         'Ground',
    date:         'June 2024',
    signal:       "Validates NATO Baltic defense concept and German brigade deployment to Lithuania; signals commitment to forward defense of the alliance's most exposed members.",
    signalType:   'alliance_solidarity',
    threatLevel:  'elevated',
  },
  {
    id:           'pla-russia-naval-2024',
    name:         'PLA–Russia Naval Pacific 2024',
    leadNation:   'China',
    participants: ['China', 'Russia'],
    location:     'Western Pacific / Sea of Japan',
    region:       'Pacific',
    troops:       3000,
    type:         'Naval',
    date:         'September 2024',
    signal:       'Joint naval patrol approaching Alaskan waters demonstrates Russia-China maritime axis and tests US Pacific response cadence; strategically timed near the RIMPAC cycle.',
    signalType:   'power_projection',
    threatLevel:  'elevated',
  },
  {
    id:           'inherent-resolve-air-2024',
    name:         'OIR Air Component Exercises',
    leadNation:   'USA',
    participants: ['USA', 'France', 'UK', 'Jordan', 'UAE'],
    location:     'Middle East (Iraq, Syria, Jordan)',
    region:       'Middle East',
    troops:       5000,
    type:         'Air',
    date:         'Ongoing 2024',
    signal:       'Persistent air-component exercises maintain counter-ISIS posture while signaling capacity to respond rapidly to Iranian-backed militia escalation across the region.',
    signalType:   'readiness',
    threatLevel:  'elevated',
  },
];

// ── Classifier functions ───────────────────────────────────────────────────────

export function threatLevelColor(level: ThreatLevel): string {
  switch (level) {
    case 'critical':  return 'var(--severity-critical, #ef4444)';
    case 'high':      return 'var(--severity-high,     #f97316)';
    case 'elevated':  return 'var(--severity-medium,   #facc15)';
    case 'routine':   return 'var(--severity-low,      #22c55e)';
  }
}

export function threatLevelLabel(level: ThreatLevel): string {
  switch (level) {
    case 'critical':  return 'Critical';
    case 'high':      return 'High';
    case 'elevated':  return 'Elevated';
    case 'routine':   return 'Routine';
  }
}

export function signalTypeLabel(signalType: SignalType): string {
  switch (signalType) {
    case 'deterrence':          return 'Deterrence';
    case 'coercion':            return 'Coercion';
    case 'alliance_solidarity': return 'Alliance solidarity';
    case 'power_projection':    return 'Power projection';
    case 'readiness':           return 'Readiness';
    case 'intimidation':        return 'Intimidation';
  }
}

export function signalTypeColor(signalType: SignalType): string {
  switch (signalType) {
    case 'coercion':
    case 'intimidation':        return '#ef4444';
    case 'power_projection':    return '#f97316';
    case 'deterrence':          return '#facc15';
    case 'readiness':           return '#60a5fa';
    case 'alliance_solidarity': return '#22c55e';
  }
}

export function exerciseTypeColor(type: ExerciseType): string {
  switch (type) {
    case 'Joint':   return '#a78bfa';
    case 'Naval':   return '#38bdf8';
    case 'Air':     return '#60a5fa';
    case 'Ground':  return '#86efac';
    case 'Cyber':   return '#fb923c';
  }
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export function getByRegion(exercises: MilitaryExercise[], region: ExerciseRegion): MilitaryExercise[] {
  return exercises.filter((e) => e.region === region);
}

export function getLargeExercises(exercises: MilitaryExercise[], minTroops = 10000): MilitaryExercise[] {
  return exercises.filter((e) => e.troops >= minTroops);
}

export function getRecentExercises(exercises: MilitaryExercise[], afterYear: number): MilitaryExercise[] {
  return exercises.filter((e) => {
    const match = e.date.match(/\d{4}/);
    if (!match) return false;
    return parseInt(match[0]!, 10) >= afterYear;
  });
}

export function getBySignalType(exercises: MilitaryExercise[], signalType: SignalType): MilitaryExercise[] {
  return exercises.filter((e) => e.signalType === signalType);
}

export function getByThreatLevel(exercises: MilitaryExercise[], level: ThreatLevel): MilitaryExercise[] {
  return exercises.filter((e) => e.threatLevel === level);
}

export function getCriticalAndHigh(exercises: MilitaryExercise[]): MilitaryExercise[] {
  return exercises.filter((e) => e.threatLevel === 'critical' || e.threatLevel === 'high');
}

export function getCoerciveExercises(exercises: MilitaryExercise[]): MilitaryExercise[] {
  return exercises.filter((e) => e.signalType === 'coercion' || e.signalType === 'intimidation');
}

// ── Aggregation ────────────────────────────────────────────────────────────────

/**
 * Compute a regional intensity score (0-100) based on exercise count,
 * total troops, and proportion of high/critical exercises.
 *
 * Scoring weights:
 *   50%  troops normalised to MAX_TROOPS ceiling
 *   25%  exercise count (10 pts per exercise, capped at 100)
 *   25%  fraction that are high/critical
 */
export function computeRegionalIntensity(exercises: MilitaryExercise[]): RegionalIntensity[] {
  const REGIONS: ExerciseRegion[] = ['Pacific', 'Europe', 'Middle East', 'South Asia', 'Arctic'];
  const MAX_TROOPS = 300_000;

  return REGIONS.map((region) => {
    const subset             = getByRegion(exercises, region);
    const totalTroops        = subset.reduce((s, e) => s + e.troops, 0);
    const largeExerciseCount = getLargeExercises(subset).length;
    const highCount          = getCriticalAndHigh(subset).length;

    const troopScore = Math.min(100, (totalTroops / MAX_TROOPS) * 100) * 0.50;
    const countScore = Math.min(100, subset.length * 10)              * 0.25;
    const highScore  = subset.length > 0 ? (highCount / subset.length) * 100 * 0.25 : 0;

    const intensityScore = Math.round(troopScore + countScore + highScore);

    let level: ThreatLevel;
    if      (intensityScore >= 70) level = 'critical';
    else if (intensityScore >= 45) level = 'high';
    else if (intensityScore >= 20) level = 'elevated';
    else                           level = 'routine';

    return { region, exerciseCount: subset.length, totalTroops, largeExerciseCount, intensityScore, level };
  });
}

export function totalTroopsInExercises(exercises: MilitaryExercise[]): number {
  return exercises.reduce((s, e) => s + e.troops, 0);
}

export function formatTroops(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}

// ── Render helpers (pure HTML strings — no DOM dependency) ────────────────────

function escHtml(s: string): string {
  return s
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

export function renderExercisesTable(exercises: MilitaryExercise[]): string {
  if (exercises.length === 0) {
    return '<div data-section="exercises-table" style="color:#9e9e9e;font-size:12px;padding:8px">No exercises tracked.</div>';
  }
  const rows = exercises.map((e) => {
    const tColor = threatLevelColor(e.threatLevel);
    const sColor = signalTypeColor(e.signalType);
    const eColor = exerciseTypeColor(e.type);
    return [
      `<tr data-exercise-id="${escHtml(e.id)}">`,
      `<td style="padding:3px 6px;font-size:12px;font-weight:600">${escHtml(e.name)}</td>`,
      `<td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escHtml(e.date)}</td>`,
      `<td style="padding:3px 6px;font-size:11px;color:${eColor}">${escHtml(e.type)}</td>`,
      `<td style="padding:3px 6px;font-size:11px;color:#facc15;text-align:right">${escHtml(formatTroops(e.troops))}</td>`,
      `<td style="padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor}">${escHtml(signalTypeLabel(e.signalType))}</td>`,
      `<td style="padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor};text-align:right">${escHtml(threatLevelLabel(e.threatLevel))}</td>`,
      '</tr>',
    ].join('');
  }).join('');
  return `<div data-section="exercises-table"><table style="width:100%;border-collapse:collapse"><tbody>${rows}</tbody></table></div>`;
}

export function renderRegionalIntensitySection(intensities: RegionalIntensity[]): string {
  if (intensities.length === 0) {
    return '<div data-section="regional-intensity" style="color:#9e9e9e;font-size:12px;padding:8px">No regional intensity data.</div>';
  }
  const rows = intensities
    .filter((r) => r.exerciseCount > 0)
    .sort((a, b) => b.intensityScore - a.intensityScore)
    .map((r) => {
      const tColor = threatLevelColor(r.level);
      return [
        '<tr>',
        `<td style="padding:3px 6px;font-size:12px;font-weight:600;color:${tColor}">${escHtml(r.region)}</td>`,
        `<td style="padding:3px 6px;font-size:11px;color:#9e9e9e;text-align:right">${r.exerciseCount} exercises</td>`,
        `<td style="padding:3px 6px;font-size:11px;color:#facc15;text-align:right">${escHtml(formatTroops(r.totalTroops))}</td>`,
        `<td style="padding:3px 6px;font-size:11px;text-align:right;color:${tColor}">${r.intensityScore}/100</td>`,
        '</tr>',
      ].join('');
    }).join('');
  return `<div data-section="regional-intensity"><table style="width:100%;border-collapse:collapse"><tbody>${rows}</tbody></table></div>`;
}

export function buildRenderData(exercises: MilitaryExercise[]) {
  return {
    intensities:       computeRegionalIntensity(exercises),
    large:             getLargeExercises(exercises),
    coercive:          getCoerciveExercises(exercises),
    criticalHighCount: getCriticalAndHigh(exercises).length,
    totalTroops:       totalTroopsInExercises(exercises),
    pacificExercises:  getByRegion(exercises, 'Pacific'),
    europeExercises:   getByRegion(exercises, 'Europe'),
    otherExercises:    exercises.filter((e) => e.region !== 'Pacific' && e.region !== 'Europe'),
  };
}
