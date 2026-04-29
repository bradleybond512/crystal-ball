/* eslint-disable unicorn/no-nested-ternary, sonarjs/no-nested-conditional */
/**
 * Compound threat engine — Phase 5 of
 * docs/CLAUDE_HIGH_IMPACT_EVENT_INTELLIGENCE_VISION_2026-04-29.md.
 *
 * Pure deterministic. Detects when multiple cross-domain Situations
 * combine into a bigger event and merges them into a single compound
 * Situation that explains the cascade.
 *
 * Documented cascade pairs from the vision doc:
 *   - hurricane + port closure + fuel price spike
 *   - military escalation + cyber attacks on infrastructure
 *   - geomagnetic storm + grid stress + aviation disruption
 *   - heat wave + wildfire smoke + hospital strain
 *   - conflict + shipping chokepoint + commodity shock
 *   - severe weather + airport disruption + user travel exposure
 */

import {
  rankingScore,
  type Situation,
  type SituationSeverity,
} from './situation-types';

// ── Public API ──────────────────────────────────────────────────────────

export type CascadePathId =
  | 'hurricane_port_fuel'
  | 'mil_cyber_infra'
  | 'geomagnetic_grid_aviation'
  | 'heatwave_smoke_hospital'
  | 'conflict_chokepoint_commodity'
  | 'weather_airport_travel';

export interface CascadePathDefinition {
  id: CascadePathId;
  /** Human-readable name. */
  name: string;
  /** Domain combinations that count as a match (need at least one
   *  Situation per domain). Order in this list defines the cascade
   *  chain — first is the primary driver. */
  domainChain: readonly Situation['domain'][];
  /** Free-text explanation of the cascade path used in the
   *  compound situation summary. */
  cascadeExplanation: string;
}

/** Default cascade catalog from the vision doc. The host can override
 *  this per domain mix later. */
export const DEFAULT_CASCADE_PATHS: readonly CascadePathDefinition[] = [
  {
    id: 'hurricane_port_fuel',
    name: 'Hurricane → Port closure → Fuel price shock',
    domainChain: ['weather', 'compound'],
    cascadeExplanation:
      'A hurricane track overlaps Gulf energy infrastructure and major ports; expect fuel and shipping disruption.',
  },
  {
    id: 'mil_cyber_infra',
    name: 'Military escalation → Cyber attack on infrastructure',
    domainChain: ['military', 'cyber'],
    cascadeExplanation:
      'Geopolitical escalation in a watched theater is correlating with cyber activity against critical infrastructure.',
  },
  {
    id: 'geomagnetic_grid_aviation',
    name: 'Geomagnetic storm → Grid stress → Aviation disruption',
    domainChain: ['weather', 'cyber'],
    cascadeExplanation:
      'A geomagnetic event is stressing the power grid and may disrupt aviation comms / GPS.',
  },
  {
    id: 'heatwave_smoke_hospital',
    name: 'Heat wave → Wildfire smoke → Hospital strain',
    domainChain: ['weather', 'compound'],
    cascadeExplanation:
      'Sustained heat plus regional wildfire smoke is increasing hospital load.',
  },
  {
    id: 'conflict_chokepoint_commodity',
    name: 'Conflict → Shipping chokepoint → Commodity shock',
    domainChain: ['military', 'compound'],
    cascadeExplanation:
      'A conflict near a strategic shipping chokepoint may disrupt commodity flow.',
  },
  {
    id: 'weather_airport_travel',
    name: 'Severe weather → Airport disruption → Travel exposure',
    domainChain: ['weather', 'compound'],
    cascadeExplanation:
      'Severe weather over a hub airport may disrupt user travel.',
  },
];

export interface CompoundDetectionInput {
  /** Active situations to consider for merging. */
  situations: readonly Situation[];
  /** Optional ms timestamp; defaults to now(). */
  now?: () => number;
  /** Optional cascade catalog override. */
  cascadePaths?: readonly CascadePathDefinition[];
  /** Optional minimum severity floor — situations below this don't
   *  contribute to compound detection. Default 'elevated'. */
  minSeverity?: SituationSeverity;
}

export interface CompoundDetectionResult {
  /** Newly emitted compound situations (one per matched cascade). */
  compounds: readonly Situation[];
  /** Ids of constituent situations that were rolled up into a
   *  compound. The host should suppress these in command-center
   *  display so the user sees one story instead of three. */
  suppressedIds: readonly string[];
}

/** Walk the situation list and emit compound situations for any
 *  matched cascade. */
export function detectCompoundThreats(input: CompoundDetectionInput): CompoundDetectionResult {
  const now = (input.now ?? Date.now)();
  const minSeverity = input.minSeverity ?? 'elevated';
  const minRank = severityRank(minSeverity);
  const paths = input.cascadePaths ?? DEFAULT_CASCADE_PATHS;

  // Filter active + above-threshold situations.
  const eligible = input.situations.filter(
    (s) => s.phase !== 'resolved' && severityRank(s.severity) >= minRank,
  );

  const compounds: Situation[] = [];
  const suppressedIds = new Set<string>();

  for (const path of paths) {
    // For each domain in the chain, find the highest-ranking
    // situation in that domain that hasn't already been claimed.
    const claimed: Situation[] = [];
    let satisfies = true;
    const usedIds = new Set<string>();
    for (const requiredDomain of new Set(path.domainChain)) {
      const candidate = eligible
        .filter((s) => s.domain === requiredDomain && !usedIds.has(s.id))
        .sort((a, b) => rankingScore(b) - rankingScore(a))[0];
      if (!candidate) {
        satisfies = false;
        break;
      }
      claimed.push(candidate);
      usedIds.add(candidate.id);
    }
    if (!satisfies || claimed.length < 2) continue;

    compounds.push(buildCompoundSituation(path, claimed, now));
    for (const c of claimed) suppressedIds.add(c.id);
  }

  return {
    compounds,
    suppressedIds: [...suppressedIds],
  };
}

// ── Internals ───────────────────────────────────────────────────────────

function severityRank(s: SituationSeverity): number {
  return ['fyi', 'watch', 'elevated', 'critical', 'emergency'].indexOf(s);
}

function buildCompoundSituation(
  path: CascadePathDefinition,
  claimed: readonly Situation[],
  ts: number,
): Situation {
  // Merge: severity is the max constituent severity bumped one tier
  // (the vision doc treats compound events as "bigger than the sum").
  // Confidence is the average of constituents (compound stories
  // should be conservative). Urgency / userExposure take the max.
  const maxSev = claimed.reduce<SituationSeverity>(
    (best, s) => (severityRank(s.severity) > severityRank(best) ? s.severity : best),
    'fyi',
  );
  const compoundSev = bumpOneTier(maxSev);
  const avgConfidence = Number(
    (claimed.reduce((acc, s) => acc + s.confidence, 0) / claimed.length).toFixed(2),
  );
  const maxUrgency = Math.max(...claimed.map((s) => s.urgency));
  const maxExposure = Math.max(...claimed.map((s) => s.userExposure));

  // Combined evidence + agreement.
  const evidence = claimed.flatMap((s) => s.evidence);
  const agreeing = unique(claimed.flatMap((s) => s.sourceAgreement.agreeing));
  const disagreeing = unique(claimed.flatMap((s) => s.sourceAgreement.disagreeing));
  const independentSourceCount = agreeing.length;

  // Title naming: cascade name + primary driver.
  const primary = claimed[0]!;
  const title = `Compound: ${path.name}`;
  const summary = `${path.cascadeExplanation} Primary driver: ${primary.title}.`;

  // Recommended actions: take immediate-urgency actions from each
  // constituent, deduped by text.
  const actions = unique(
    claimed.flatMap((s) =>
      s.recommendedActions.filter((a) => a.urgency === 'immediate' || a.urgency === 'soon').map((a) => a.text),
    ),
  ).slice(0, 5).map((text, i) => ({
    id: `compound:${path.id}:action:${i}`,
    text,
    urgency: i < 2 ? ('immediate' as const) : ('soon' as const),
  }));

  // What changed — name the constituents.
  const whatChanged = [
    {
      ts,
      text: `Compound formed from ${claimed.length} constituent situations: ${claimed.map((c) => c.id).join(', ')}`,
      source: 'compound-engine',
    },
  ];

  return {
    id: `compound:${path.id}`,
    domain: 'compound',
    title,
    summary,
    severity: compoundSev,
    confidence: avgConfidence,
    urgency: maxUrgency,
    userExposure: maxExposure,
    personalImpact: {
      summary: claimed.find((s) => s.userExposure >= 0.6)?.personalImpact.summary
        ?? `Cross-domain cascade in progress (${path.name}).`,
      level:
        maxExposure >= 0.85 ? 'severe'
        : maxExposure >= 0.6 ? 'high'
        : maxExposure >= 0.35 ? 'medium'
        : maxExposure >= 0.15 ? 'low'
        : 'none',
      reasons: unique(claimed.flatMap((s) => s.personalImpact.reasons)).slice(0, 4),
    },
    evidence,
    sourceAgreement: { agreeing, disagreeing, independentSourceCount },
    whatChanged,
    expectedNextSignals: claimed
      .flatMap((s) => s.expectedNextSignals)
      .slice(0, 6),
    invalidationSignals: claimed
      .flatMap((s) => s.invalidationSignals)
      .slice(0, 4),
    recommendedActions: actions.length > 0
      ? actions
      : [
          {
            id: `compound:${path.id}:monitor`,
            text: `Monitor the cascade across ${path.domainChain.join(', ')} domains.`,
            urgency: 'soon',
          },
        ],
    timeline: claimed.flatMap((s) => s.timeline).sort((a, b) => a.ts - b.ts),
    diagnosticsTrace: {
      createdReason: `Cascade '${path.name}' matched: ${claimed.map((c) => c.id).join(' + ')}`,
      severityRationale: `Max constituent severity '${maxSev}' bumped one tier → '${compoundSev}'`,
      confidenceRationale: `Average of ${claimed.length} constituent confidences = ${avgConfidence}`,
      exposureRationale: `Max constituent userExposure ${maxExposure.toFixed(2)}`,
      sourceContributions: Object.fromEntries(
        agreeing.map((src) => [src, 1 / Math.max(1, agreeing.length)]),
      ),
      thresholdsCrossed: [
        `cascade:${path.id}`,
        ...claimed.map((c) => `constituent:${c.id}`),
      ],
    },
    predictionOutcome: {},
    phase: 'active',
    firstSeen: Math.min(...claimed.map((c) => c.firstSeen)),
    lastUpdated: ts,
  };
}

function bumpOneTier(s: SituationSeverity): SituationSeverity {
  const order: SituationSeverity[] = ['fyi', 'watch', 'elevated', 'critical', 'emergency'];
  const idx = order.indexOf(s);
  return order[Math.min(order.length - 1, idx + 1)] ?? 'emergency';
}

function unique<T>(arr: readonly T[]): T[] {
  return [...new Set(arr)];
}

// Re-exports for convenience.
export { rankingScore, severityFromScore } from './situation-types';
