// src/services/survival/survival-types.ts
import type { ThreatLevel, WeatherHazardKind, NwsAlertMinimal, SavedPlace } from '../weather/weather-threat-types.ts';
import type { ConfidenceBreakdown, AlgorithmExplanation } from '../intelligence/types.ts';

// ── Axes ──────────────────────────────────────────────────────────────────
export type SurvivalAxis =
  | 'physical_safety' | 'supply' | 'financial' | 'mobility'
  | 'comms' | 'health' | 'energy_water' | 'security';

export const SURVIVAL_AXES: readonly SurvivalAxis[] = [
  'physical_safety', 'supply', 'financial', 'mobility',
  'comms', 'health', 'energy_water', 'security',
];

const AXIS_LABELS: Record<SurvivalAxis, string> = {
  physical_safety: 'Physical safety',
  supply: 'Supply',
  financial: 'Financial',
  mobility: 'Mobility',
  comms: 'Comms',
  health: 'Health',
  energy_water: 'Energy & water',
  security: 'Security',
};

export function axisLabel(axis: SurvivalAxis): string {
  return AXIS_LABELS[axis];
}

// ── Band ladder ─────────────────────────────────────────────────────────────
export type SurvivalBand = 'secure' | 'guarded' | 'elevated' | 'high' | 'critical';
const BAND_ORDER: readonly SurvivalBand[] = ['secure', 'guarded', 'elevated', 'high', 'critical'];

export function bandRank(b: SurvivalBand): number {
  return BAND_ORDER.indexOf(b);
}

export function bandForLevel(level: number): SurvivalBand {
  if (level >= 80) return 'critical';
  if (level >= 60) return 'high';
  if (level >= 40) return 'elevated';
  if (level >= 20) return 'guarded';
  return 'secure';
}

export function threatLevelToSeverity(level: ThreatLevel): number {
  switch (level) {
    case 'none': { return 0;
    }
    case 'watch': { return 30;
    }
    case 'advisory': { return 50;
    }
    case 'warning': { return 75;
    }
    case 'emergency': { return 95;
    }
  }
}

export function severityToThreatLevel(severity: number): ThreatLevel {
  if (severity >= 95) return 'emergency';
  if (severity >= 75) return 'warning';
  if (severity >= 50) return 'advisory';
  if (severity >= 30) return 'watch';
  return 'none';
}

// ── Posture data ────────────────────────────────────────────────────────────
export interface PostureThreat {
  /** Alert id this threat came from. */
  sourceEventId: string;
  axis: SurvivalAxis;
  /** 0–100, higher = more threatened. */
  severity: number;
  threatLevel: ThreatLevel;
  hazardKind: WeatherHazardKind;
  /** NWS event string, e.g. "Tornado Warning". */
  hazardLabel: string;
  /** Minutes until earliest plausible impact; null if unknown. */
  timeToImpactMins: number | null;
  /** Pre-formatted arrival label ("35-55 min") or null. */
  arrivalLabel: string | null;
  /** Plain-language reason from the matcher. */
  why: string;
  confidenceLabel: 'low' | 'medium' | 'high';
}

export interface AxisState {
  axis: SurvivalAxis;
  /** 0–100, higher = worse. */
  level: number;
  band: SurvivalBand;
  trend: 'improving' | 'steady' | 'worsening';
  threats: PostureThreat[];
  confidence: ConfidenceBreakdown;
  explanation: AlgorithmExplanation;
  drivers: string[];
}

export function buildHeadline(worst: AxisState): string {
  if (worst.level === 0) return 'All clear — survival posture secure across all domains.';
  return `${axisLabel(worst.axis)} at ${worst.band} — ${worst.drivers[0] ?? 'active threat'}.`;
}

export type MoveCost = 'free' | 'low' | 'medium' | 'high';

export interface PostureDelta {
  axis: SurvivalAxis;
  /** Signed change to axis level. Negative = improves posture. */
  deltaLevel: number;
  rationale: string;
}

export interface SurvivalMove {
  id: string;
  label: string;
  detail: string;
  affects: SurvivalAxis[];
  cost: MoveCost;
  leadTimeMins: number;
  /** Why this move is being offered. */
  trigger: string;
  /** Modeled effect on posture if committed. */
  effect: PostureDelta[];
  /** Pointer to the source preparedness action id. */
  playbookRef?: string;
}

export interface CommittedMove {
  moveId: string;
  committedAtMs: number;
  status: 'planned' | 'in_progress' | 'done' | 'skipped';
}

export interface SurvivalPlan {
  committed: CommittedMove[];
}

export interface SurvivalPosture {
  axes: AxisState[];
  overallLevel: number;
  overallBand: SurvivalBand;
  worstAxis: SurvivalAxis;
  headline: string;
  capturedAtMs: number;
  staleInputs: string[];
}

// ── Snapshot (the save file) ──────────────────────────────────────────────
export type SnapshotDomain = 'weather';

export interface DomainFreshness {
  domain: SnapshotDomain;
  fetchedAtMs: number;
  ageMs: number;
  ok: boolean;
}

export interface WorldSnapshot {
  version: number;
  capturedAtMs: number;
  freshness: DomainFreshness[];
  weatherAlerts: NwsAlertMinimal[];
  savedPlaces: SavedPlace[];
  posture: SurvivalPosture;
  plan: SurvivalPlan;
}
