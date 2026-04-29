/**
 * Military historical pattern matcher — Phase 4 of
 * docs/CLAUDE_HIGH_IMPACT_EVENT_INTELLIGENCE_VISION_2026-04-29.md.
 *
 * Compares current movement signatures against known patterns
 * (air-campaign buildup, naval strike posture, rapid deployment,
 * blockade setup, evacuation precursor, recon surge, multi-front
 * posturing). Each match returns a percentage + evidence + the
 * confirming/invalidating signals.
 *
 * Pure deterministic. No fetch, no DOM. Adapter consumes the host's
 * existing situation-engine outputs and emits structured pattern
 * matches.
 */

// ── Public API ──────────────────────────────────────────────────────────

export type MilitaryPatternId =
  | 'air_campaign_buildup'
  | 'naval_strike_posture'
  | 'rapid_deployment'
  | 'blockade_setup'
  | 'evacuation_precursor'
  | 'recon_surge'
  | 'multi_front_posturing';

export interface MilitaryPatternFeature {
  id: string;
  /** Whether this feature was observed in the current movement
   *  signature. */
  observed: boolean;
  /** Per-feature weight 0..1. Heavier features dominate the match
   *  percentage. */
  weight: number;
  /** Display label for the diagnostics trace. */
  label: string;
}

export interface MilitaryPatternMatch {
  patternId: MilitaryPatternId;
  patternName: string;
  /** 0..1 fraction of weighted features observed. */
  matchPercent: number;
  /** Confidence reflects (a) how many features observed and
   *  (b) how strong the observed features are. Bounded to 0.95. */
  confidence: number;
  /** Features that contributed to the match. */
  observedFeatures: readonly MilitaryPatternFeature[];
  /** Features that would confirm the pattern if observed next. */
  confirmingSignals: readonly string[];
  /** Features that would invalidate the pattern if observed. */
  invalidatingSignals: readonly string[];
}

/** Per-pattern definition: features to look for, what would confirm,
 *  what would invalidate. */
export interface MilitaryPatternDefinition {
  id: MilitaryPatternId;
  name: string;
  features: readonly MilitaryPatternFeature[];
  confirmingSignals: readonly string[];
  invalidatingSignals: readonly string[];
}

/** Default pattern catalog — a starting point that the host can
 *  override per theater later. */
export const DEFAULT_MILITARY_PATTERNS: readonly Omit<MilitaryPatternDefinition, 'features'>[] = [
  {
    id: 'air_campaign_buildup',
    name: 'Air campaign buildup',
    confirmingSignals: ['tanker-surge', 'awacs-presence', 'fighter-deployments', 'NOTAM-massive-airspace'],
    invalidatingSignals: ['withdrawal-announcement', 'tanker-stand-down'],
  },
  {
    id: 'naval_strike_posture',
    name: 'Naval strike posture',
    confirmingSignals: ['carrier-group-positioned', 'submarine-deployment', 'AIS-dark-vessels-spike'],
    invalidatingSignals: ['carrier-departure', 'naval-exercise-conclusion'],
  },
  {
    id: 'rapid_deployment',
    name: 'Rapid deployment',
    confirmingSignals: ['c-17-surge', 'fuel-truck-spike', 'embassy-airlift'],
    invalidatingSignals: ['movement-cancelled', 'troops-recalled'],
  },
  {
    id: 'blockade_setup',
    name: 'Blockade setup',
    confirmingSignals: ['naval-perimeter', 'shipping-rerouting', 'port-closure'],
    invalidatingSignals: ['blockade-lifted', 'ships-cleared'],
  },
  {
    id: 'evacuation_precursor',
    name: 'Evacuation precursor',
    confirmingSignals: ['embassy-charter-flights', 'state-dept-advisory', 'commercial-flight-cancellations'],
    invalidatingSignals: ['advisory-downgraded', 'flights-resumed'],
  },
  {
    id: 'recon_surge',
    name: 'Recon surge',
    confirmingSignals: ['recon-aircraft-spike', 'satellite-tasking', 'NOTAM-ISR-orbits'],
    invalidatingSignals: ['recon-stand-down'],
  },
  {
    id: 'multi_front_posturing',
    name: 'Multi-front posturing',
    confirmingSignals: ['simultaneous-theater-elevations', 'cross-theater-tanker-bridge'],
    invalidatingSignals: ['theater-de-escalation'],
  },
];

export interface MatchInput {
  /** Pattern to evaluate. */
  pattern: MilitaryPatternDefinition;
  /** Confidence floor — patterns below this are not surfaced. */
  minMatch?: number;
}

export function matchMilitaryPattern(input: MatchInput): MilitaryPatternMatch | null {
  const minMatch = input.minMatch ?? 0.3;
  const totalWeight = input.pattern.features.reduce((s, f) => s + f.weight, 0);
  if (totalWeight === 0) return null;
  const observedWeight = input.pattern.features
    .filter((f) => f.observed)
    .reduce((s, f) => s + f.weight, 0);
  const matchPercent = observedWeight / totalWeight;
  if (matchPercent < minMatch) return null;
  // Confidence is the match percent, scaled by how many features
  // we have signals on (more features = stronger evidence). Capped 0.95.
  const observedCount = input.pattern.features.filter((f) => f.observed).length;
  const breadthBonus = Math.min(0.2, observedCount * 0.05);
  const confidence = Math.min(0.95, matchPercent + breadthBonus);

  return {
    patternId: input.pattern.id,
    patternName: input.pattern.name,
    matchPercent: Number(matchPercent.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    observedFeatures: input.pattern.features.filter((f) => f.observed),
    confirmingSignals: input.pattern.confirmingSignals,
    invalidatingSignals: input.pattern.invalidatingSignals,
  };
}

/** Match all default patterns against a feature observation map.
 *  The map is keyed by feature id; missing keys are treated as
 *  unobserved (false). */
export function matchAllMilitaryPatterns(
  observations: Readonly<Record<string, boolean>>,
  patterns: readonly Omit<MilitaryPatternDefinition, 'features'>[] = DEFAULT_MILITARY_PATTERNS,
  minMatch = 0.3,
): MilitaryPatternMatch[] {
  return patterns
    .map((p) => {
      const features: MilitaryPatternFeature[] = [
        ...p.confirmingSignals.map((id) => ({
          id,
          observed: observations[id] ?? false,
          weight: 1,
          label: id.replace(/-/g, ' '),
        })),
      ];
      return matchMilitaryPattern({
        pattern: { ...p, features },
        minMatch,
      });
    })
    .filter((m): m is MilitaryPatternMatch => m !== null)
    .sort((a, b) => b.confidence - a.confidence);
}
