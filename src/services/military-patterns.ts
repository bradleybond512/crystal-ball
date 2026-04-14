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
