import type { TheaterPostureSummary, SurgeAlert } from './military-surge';
import type { SignalType } from '@/utils/analysis-constants';

export type { TheaterPostureSummary, SurgeAlert } from './military-surge';
export type { SignalType } from '@/utils/analysis-constants';

// ── Types ──

export interface ConflictPattern {
  id: string;
  name: string;
  description: string;
  signature: {
    minAircraft: number;
    fighterPct: [number, number];
    tankerPct: [number, number];
    transportPct: [number, number];
    requireStrikeCapable: boolean;
    requireAwacs: boolean;
    requireMultiOperator: boolean;
  };
}

export interface PatternMatch {
  patternId: string;
  patternName: string;
  matchScore: number;
  theaterId: string;
  theaterName: string;
  breakdown: Record<string, number>;
}

// ── Pattern Library ──

export const CONFLICT_PATTERNS: ConflictPattern[] = [
  {
    id: 'desert-storm',
    name: 'Coalition Air War',
    description: 'Heavy multi-national force with tanker/AWACS support — mirrors Desert Storm buildup',
    signature: {
      minAircraft: 15,
      fighterPct: [30, 50],
      tankerPct: [10, 25],
      transportPct: [15, 30],
      requireStrikeCapable: true,
      requireAwacs: true,
      requireMultiOperator: true,
    },
  },
  {
    id: 'air-campaign',
    name: 'Air Campaign',
    description: 'Fighter-heavy posture with strike enablers — offensive air operations',
    signature: {
      minAircraft: 10,
      fighterPct: [60, 100],
      tankerPct: [5, 20],
      transportPct: [0, 15],
      requireStrikeCapable: true,
      requireAwacs: true,
      requireMultiOperator: false,
    },
  },
  {
    id: 'airlift-deployment',
    name: 'Airlift/Deployment',
    description: 'Transport-heavy movement — rapid force deployment or evacuation',
    signature: {
      minAircraft: 8,
      fighterPct: [0, 20],
      tankerPct: [0, 15],
      transportPct: [50, 100],
      requireStrikeCapable: false,
      requireAwacs: false,
      requireMultiOperator: false,
    },
  },
  {
    id: 'naval-strike-support',
    name: 'Naval Strike Support',
    description: 'Mixed fighter/tanker posture near maritime theater — carrier group air support',
    signature: {
      minAircraft: 6,
      fighterPct: [30, 50],
      tankerPct: [10, 30],
      transportPct: [0, 20],
      requireStrikeCapable: false,
      requireAwacs: false,
      requireMultiOperator: false,
    },
  },
  {
    id: 'recon-surge',
    name: 'Reconnaissance Surge',
    description: 'ISR-heavy posture — intelligence gathering, not strike',
    signature: {
      minAircraft: 4,
      fighterPct: [0, 20],
      tankerPct: [0, 15],
      transportPct: [0, 20],
      requireStrikeCapable: false,
      requireAwacs: false,
      requireMultiOperator: false,
    },
  },
  {
    id: 'rapid-reaction',
    name: 'Rapid Reaction',
    description: 'Sudden spike from near-zero baseline — emergency response or snap deployment',
    signature: {
      minAircraft: 5,
      fighterPct: [0, 100],
      tankerPct: [0, 100],
      transportPct: [0, 100],
      requireStrikeCapable: false,
      requireAwacs: false,
      requireMultiOperator: false,
    },
  },
];

// ── Per-Theater Calibration ──
// Theaters with naturally high military traffic need raised thresholds so
// routine activity doesn't trigger the same alerts as a low-baseline theater.

interface TheaterCalibration {
  minAircraftMultiplier: number;
  /** Score penalty applied after pattern scoring (0 = no penalty, 15 = needs 15% higher raw score) */
  scorePenalty: number;
  /** Shift percentage ranges outward — widens "normal" band so routine traffic scores lower */
  pctRangeShift: number;
}

const DEFAULT_CALIBRATION: TheaterCalibration = {
  minAircraftMultiplier: 1,
  scorePenalty: 0,
  pctRangeShift: 0,
};

const THEATER_CALIBRATIONS: Record<string, TheaterCalibration> = {
  // Middle East theaters — high baseline traffic from persistent US CENTCOM presence
  'iran-theater':        { minAircraftMultiplier: 1.8, scorePenalty: 12, pctRangeShift: 8 },
  'middle-east':         { minAircraftMultiplier: 1.8, scorePenalty: 12, pctRangeShift: 8 },
  'yemen-redsea-theater': { minAircraftMultiplier: 1.5, scorePenalty: 10, pctRangeShift: 6 },
  'israel-gaza-theater': { minAircraftMultiplier: 1.5, scorePenalty: 10, pctRangeShift: 6 },
  'east-med-theater':    { minAircraftMultiplier: 1.3, scorePenalty: 8, pctRangeShift: 4 },

  // Pacific theaters — moderate baseline from forward-deployed forces
  'pacific-west':        { minAircraftMultiplier: 1.4, scorePenalty: 8, pctRangeShift: 5 },
  'taiwan-theater':      { minAircraftMultiplier: 1.3, scorePenalty: 6, pctRangeShift: 4 },
  'korea-theater':       { minAircraftMultiplier: 1.4, scorePenalty: 8, pctRangeShift: 5 },
  'south-china-sea':     { minAircraftMultiplier: 1.3, scorePenalty: 6, pctRangeShift: 4 },

  // European theaters — lower baseline, more sensitive to changes
  'europe-west':         { minAircraftMultiplier: 1.2, scorePenalty: 4, pctRangeShift: 2 },
  'europe-east':         { minAircraftMultiplier: 1.1, scorePenalty: 2, pctRangeShift: 1 },
  'baltic-theater':      { minAircraftMultiplier: 1.1, scorePenalty: 2, pctRangeShift: 1 },
  'blacksea-theater':    { minAircraftMultiplier: 1.1, scorePenalty: 2, pctRangeShift: 1 },

  // Horn of Africa — moderate persistent presence
  'africa-horn':         { minAircraftMultiplier: 1.3, scorePenalty: 6, pctRangeShift: 3 },
};

function getCalibration(theaterId: string): TheaterCalibration {
  return THEATER_CALIBRATIONS[theaterId] ?? DEFAULT_CALIBRATION;
}

function calibratedRange(range: [number, number], shift: number): [number, number] {
  return [Math.max(0, range[0] - shift), Math.min(100, range[1] + shift)];
}

// ── Cry-Wolf Score Decay ──
// When a pattern fires repeatedly in the same theater without escalation,
// decay its score to reduce alert fatigue.

interface PatternFireEntry {
  fireCount: number;
  lastFired: number;
  escalated: boolean;
}

const FIRE_HISTORY_KEY = 'crystalball-pattern-fire-history-v1';
const FIRE_HISTORY_TTL = 24 * 60 * 60 * 1000; // 24 hours

const patternFireHistory = new Map<string, PatternFireEntry>();

function loadFireHistory(): void {
  try {
    const raw = localStorage.getItem(FIRE_HISTORY_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as [string, PatternFireEntry][];
    const now = Date.now();
    patternFireHistory.clear();
    for (const [key, entry] of entries) {
      if (now - entry.lastFired < FIRE_HISTORY_TTL) {
        patternFireHistory.set(key, entry);
      }
    }
  } catch { /* corrupt data — start fresh */ }
}

function saveFireHistory(): void {
  const now = Date.now();
  const entries: [string, PatternFireEntry][] = [];
  for (const [key, entry] of patternFireHistory) {
    if (now - entry.lastFired < FIRE_HISTORY_TTL) {
      entries.push([key, entry]);
    }
  }
  localStorage.setItem(FIRE_HISTORY_KEY, JSON.stringify(entries));
}

loadFireHistory();

export function recordPatternFire(patternId: string, theaterId: string): void {
  const key = `${patternId}-${theaterId}`;
  const existing = patternFireHistory.get(key);
  if (existing) {
    existing.fireCount++;
    existing.lastFired = Date.now();
  } else {
    patternFireHistory.set(key, { fireCount: 1, lastFired: Date.now(), escalated: false });
  }
  saveFireHistory();
}

export function recordEscalation(theaterId: string): void {
  for (const [key, entry] of patternFireHistory) {
    if (key.endsWith(`-${theaterId}`)) {
      entry.escalated = true;
      entry.fireCount = 1;
    }
  }
  saveFireHistory();
}

function getCryWolfDecay(patternId: string, theaterId: string): number {
  const entry = patternFireHistory.get(`${patternId}-${theaterId}`);
  if (!entry || entry.escalated || entry.fireCount <= 1) return 1;
  return Math.max(0.3, 1 - (entry.fireCount - 1) * 0.15);
}

// ── Matching Logic ──

function pctScore(actual: number, range: [number, number]): number {
  const [lo, hi] = range;
  if (actual >= lo && actual <= hi) return 20;
  const dist = actual < lo ? lo - actual : actual - hi;
  return Math.max(0, Math.round(20 - dist * 0.6));
}

function scoreRequiredFlags(
  pattern: ConflictPattern,
  posture: TheaterPostureSummary,
  surges: SurgeAlert[] | undefined,
  breakdown: Record<string, number>,
): boolean {
  const sig = pattern.signature;

  if (sig.requireStrikeCapable) {
    breakdown.strikeCapable = posture.strikeCapable ? 10 : 0;
  } else {
    breakdown.strikeCapable = 10;
  }
  if (sig.requireAwacs) {
    breakdown.awacs = posture.awacs > 0 ? 10 : 0;
  } else {
    breakdown.awacs = 10;
  }

  if (sig.requireMultiOperator && Object.keys(posture.byOperator).length < 2) return false;
  breakdown.multiOperator = 10;

  if (pattern.id === 'rapid-reaction') {
    const theater = surges?.filter(s => s.theater.id === posture.theaterId) ?? [];
    const maxMultiple = theater.reduce((m, s) => Math.max(m, s.surgeMultiple), 0);
    if (maxMultiple <= 4) return false;
    breakdown.rapidSurge = 10;
  }

  return true;
}

function scorePattern(
  pattern: ConflictPattern,
  posture: TheaterPostureSummary,
  surges: SurgeAlert[] | undefined,
): number {
  const total = posture.totalAircraft;
  const sig = pattern.signature;
  const cal = getCalibration(posture.theaterId);
  const breakdown: Record<string, number> = { strikeCapable: 0, awacs: 0, multiOperator: 0 };

  const fighterPct = total > 0 ? (posture.fighters / total) * 100 : 0;
  const tankerPct = total > 0 ? (posture.tankers / total) * 100 : 0;
  const transportPct = total > 0 ? (posture.transport / total) * 100 : 0;

  breakdown.fighterPct = pctScore(fighterPct, calibratedRange(sig.fighterPct, cal.pctRangeShift));
  breakdown.tankerPct = pctScore(tankerPct, calibratedRange(sig.tankerPct, cal.pctRangeShift));
  breakdown.transportPct = pctScore(transportPct, calibratedRange(sig.transportPct, cal.pctRangeShift));

  if (!scoreRequiredFlags(pattern, posture, surges, breakdown)) return -1;

  if (pattern.id === 'recon-surge') {
    const reconPct = total > 0 ? ((posture.reconnaissance + posture.awacs) / total) * 100 : 0;
    breakdown.reconDominance = reconPct >= 50 ? 10 : Math.round(reconPct / 5);
  }

  const totalPoints = breakdown.fighterPct + breakdown.tankerPct + breakdown.transportPct
    + (breakdown.strikeCapable ?? 0) + (breakdown.awacs ?? 0) + (breakdown.multiOperator ?? 0)
    + (breakdown.rapidSurge ?? 0) + (breakdown.reconDominance ?? 0);
  const maxPoints = 60 + 30
    + (breakdown.rapidSurge === undefined ? 0 : 10)
    + (breakdown.reconDominance === undefined ? 0 : 10);
  const rawScore = Math.round((totalPoints / maxPoints) * 100);
  return Math.max(0, rawScore - cal.scorePenalty);
}

function buildBreakdown(
  pattern: ConflictPattern,
  posture: TheaterPostureSummary,
  surges: SurgeAlert[] | undefined,
): Record<string, number> {
  const total = posture.totalAircraft;
  const sig = pattern.signature;
  const cal = getCalibration(posture.theaterId);
  const breakdown: Record<string, number> = {
    strikeCapable: 0,
    awacs: 0,
    multiOperator: 0,
  };

  const fighterPct = total > 0 ? (posture.fighters / total) * 100 : 0;
  const tankerPct = total > 0 ? (posture.tankers / total) * 100 : 0;
  const transportPct = total > 0 ? (posture.transport / total) * 100 : 0;

  breakdown.fighterPct = pctScore(fighterPct, calibratedRange(sig.fighterPct, cal.pctRangeShift));
  breakdown.tankerPct = pctScore(tankerPct, calibratedRange(sig.tankerPct, cal.pctRangeShift));
  breakdown.transportPct = pctScore(transportPct, calibratedRange(sig.transportPct, cal.pctRangeShift));
  scoreRequiredFlags(pattern, posture, surges, breakdown);

  if (pattern.id === 'recon-surge') {
    const reconPct = total > 0 ? ((posture.reconnaissance + posture.awacs) / total) * 100 : 0;
    breakdown.reconDominance = reconPct >= 50 ? 10 : Math.round(reconPct / 5);
  }

  return breakdown;
}

export function matchPatterns(
  posture: TheaterPostureSummary,
  surges?: SurgeAlert[],
): PatternMatch[] {
  const total = posture.totalAircraft;
  const results: PatternMatch[] = [];

  const cal = getCalibration(posture.theaterId);

  for (const pattern of CONFLICT_PATTERNS) {
    if (total < Math.ceil(pattern.signature.minAircraft * cal.minAircraftMultiplier)) continue;
    const rawScore = scorePattern(pattern, posture, surges);
    if (rawScore < 0) continue;
    const decay = getCryWolfDecay(pattern.id, posture.theaterId);
    const matchScore = Math.round(rawScore * decay);
    if (matchScore < 60) continue;
    results.push({
      patternId: pattern.id,
      patternName: pattern.name,
      matchScore,
      theaterId: posture.theaterId,
      theaterName: posture.theaterName,
      breakdown: buildBreakdown(pattern, posture, surges),
    });
  }

  results.sort((a, b) => b.matchScore - a.matchScore);
  return results;
}

// ── Signal Conversion ──

export function patternMatchToSignal(match: PatternMatch): {
  id: string;
  type: SignalType;
  source: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;
  category: string;
  timestamp: Date;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
} {
  const severity = match.matchScore >= 90 ? 'critical' as const : 'high' as const;
  const pattern = CONFLICT_PATTERNS.find(p => p.id === match.patternId);
  const description = `${match.theaterName} matches "${match.patternName}" profile at ${match.matchScore}% confidence. ${pattern?.description ?? ''}`;
  const metadata = {
    patternId: match.patternId,
    matchScore: match.matchScore,
    theaterId: match.theaterId,
    breakdown: match.breakdown,
  };

  return {
    id: `pattern-${match.patternId}-${match.theaterId}-${Date.now()}`,
    type: 'military_surge' as SignalType,
    source: 'Military Pattern Analysis',
    title: `${match.theaterName} matches ${match.patternName} pattern (${match.matchScore}%)`,
    description,
    severity,
    confidence: match.matchScore / 100,
    category: 'military',
    timestamp: new Date(),
    data: metadata,
    metadata,
  };
}
