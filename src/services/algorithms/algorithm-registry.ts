/**
 * Algorithm registry — per
 * docs/ALGORITHM_DIAGNOSTICS_SELF_IMPROVEMENT_PLAN.md PR 1 (lines 369-378).
 *
 * Catalog of every algorithm in the app, what it depends on, what it
 * outputs, and how safety-critical it is. Pure data + lookup helpers.
 *
 * Plan invariant: a single source of truth for "what algorithms run
 * here?" so PRs 2-5 (ledger, health aggregator, safe adjustment, wiring)
 * have a stable target to read from.
 *
 * Pure deterministic. No DOM, no fetch.
 */

// ── Public types ────────────────────────────────────────────────────────

export type AlgorithmOutputKind =
  | 'risk_score'
  | 'forecast'
  | 'notification_decision'
  | 'ranking'
  | 'situation'
  | 'brief';

export type AlgorithmCriticality = 'low' | 'medium' | 'high' | 'safety';

/** Constrained health-aggregator domain tag. Mirrors `AlgorithmDomain`
 *  in `algorithm-evaluation-ledger.ts`; redeclared locally so this
 *  module stays pure-data and doesn't import from the ledger. The two
 *  enums are kept in sync by a unit test. */
export type AlgorithmHealthDomain =
  | 'truth_score'
  | 'evidence_graph'
  | 'situation_clustering'
  | 'baseline_deviation'
  | 'compound_risk'
  | 'forecast_calibration'
  | 'watchlist_relevance'
  | 'negative_evidence'
  | 'shortage_score'
  | 'weather_polygon'
  | 'weather_urgency'
  | 'reasoning_hypothesis'
  | 'other';

export interface AlgorithmDependencies {
  sources: readonly string[];
  providers: readonly string[];
  services: readonly string[];
}

export interface AlgorithmDefinition {
  /** Stable id, kebab-case. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Semantic version. Bump on behavioral change so the ledger
   *  doesn't pollute new-model stats with old-model predictions. */
  version: string;
  /** Domain tag — matches `FactDomain` from intelligence/types where
   *  applicable, but kept free-form for cross-cutting algorithms. */
  domain: string;
  /** Constrained health-aggregator domain. The diagnostics surface
   *  (`algorithms-state.ts` + `algorithm-health.ts`) groups algorithms
   *  by this field; missing entries default to 'other'. */
  healthDomain?: AlgorithmHealthDomain;
  /** Owning feature id (joins with the diagnostics feature registry). */
  ownerFeature: string;
  dependencies: AlgorithmDependencies;
  outputs: readonly AlgorithmOutputKind[];
  criticality: AlgorithmCriticality;
}

// ── Initial registry ─────────────────────────────────────────────────────
//
// Plan section 'Initial algorithms to register' lists the 18 algorithms
// the first registry should cover. We populate exactly those.

const REGISTRY_INITIAL: readonly AlgorithmDefinition[] = [
  // Weather warning chain — all safety-critical.
  {
    id: 'nws-polygon-match',
    label: 'NWS polygon matching',
    version: '1.0.0',
    domain: 'weather',
    healthDomain: 'weather_polygon',
    ownerFeature: 'weather_warning',
    dependencies: { sources: ['weather'], providers: ['nws-alerts'], services: [] },
    outputs: ['ranking'],
    criticality: 'safety',
  },
  {
    id: 'weather-urgency',
    label: 'Weather urgency',
    version: '1.0.0',
    domain: 'weather',
    healthDomain: 'weather_urgency',
    ownerFeature: 'weather_warning',
    dependencies: { sources: ['weather'], providers: ['nws-alerts'], services: ['nws-polygon-match'] },
    outputs: ['notification_decision'],
    criticality: 'safety',
  },
  {
    id: 'personal-storm-mode',
    label: 'Personal Storm Mode payload',
    version: '1.0.0',
    domain: 'weather',
    healthDomain: 'weather_urgency',
    ownerFeature: 'weather_warning',
    dependencies: { sources: ['weather'], providers: ['nws-alerts'], services: ['weather-urgency', 'nws-polygon-match'] },
    outputs: ['brief'],
    criticality: 'safety',
  },

  // Insights / notifications layer.
  {
    id: 'big-event-detector',
    label: 'Big Event Detector',
    version: '1.0.0',
    domain: 'insights',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'big_events',
    dependencies: { sources: [], providers: [], services: ['truth-score'] },
    outputs: ['ranking', 'notification_decision'],
    criticality: 'high',
  },
  {
    id: 'confidence-urgency-matrix',
    label: 'Confidence × Urgency matrix',
    version: '1.0.0',
    domain: 'insights',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'big_events',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['notification_decision'],
    criticality: 'high',
  },
  // Algorithm intelligence layer.
  {
    id: 'truth-score',
    label: 'Truth scoring',
    version: '1.0.0',
    domain: 'intelligence',
    healthDomain: 'truth_score',
    ownerFeature: 'intelligence',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['risk_score'],
    criticality: 'high',
  },
  {
    id: 'negative-evidence',
    label: 'Negative evidence engine',
    version: '1.0.0',
    domain: 'intelligence',
    healthDomain: 'negative_evidence',
    ownerFeature: 'intelligence',
    dependencies: { sources: [], providers: [], services: ['truth-score'] },
    outputs: ['risk_score'],
    criticality: 'medium',
  },
  {
    id: 'compound-risk',
    label: 'Compound risk index',
    version: '1.0.0',
    domain: 'intelligence',
    healthDomain: 'compound_risk',
    ownerFeature: 'intelligence',
    dependencies: { sources: [], providers: [], services: ['truth-score'] },
    outputs: ['risk_score', 'ranking'],
    criticality: 'high',
  },

  // Shortage forecast models.
  {
    id: 'shortage-wheat',
    label: 'Wheat shortage risk',
    version: '1.0.0',
    domain: 'food',
    healthDomain: 'shortage_score',
    ownerFeature: 'shortage_forecast',
    dependencies: { sources: ['shortage'], providers: ['usda', 'fao', 'noaa'], services: [] },
    outputs: ['forecast', 'risk_score'],
    criticality: 'medium',
  },
  {
    id: 'shortage-diesel',
    label: 'Diesel shortage risk',
    version: '1.0.0',
    domain: 'energy',
    healthDomain: 'shortage_score',
    ownerFeature: 'shortage_forecast',
    dependencies: { sources: ['shortage'], providers: ['eia', 'cme'], services: [] },
    outputs: ['forecast', 'risk_score'],
    criticality: 'medium',
  },

  // Feedback / learning loops (the targets of the safe adjustment engine
  // in plan PR 4).
  {
    id: 'relevance-learner',
    label: 'Relevance learner',
    version: '1.0.0',
    domain: 'learning',
    healthDomain: 'watchlist_relevance',
    ownerFeature: 'analyst',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['ranking'],
    criticality: 'low',
  },
  {
    id: 'source-feedback',
    label: 'Source feedback',
    version: '1.0.0',
    domain: 'learning',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'analyst',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['ranking'],
    criticality: 'low',
  },
  {
    id: 'correlation-feedback',
    label: 'Correlation feedback',
    version: '1.0.0',
    domain: 'learning',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'analyst',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['ranking'],
    criticality: 'low',
  },
  {
    id: 'threat-classifier',
    label: 'AI threat classifier',
    version: '1.0.0',
    domain: 'classification',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'threat_classifier',
    dependencies: { sources: [], providers: ['anthropic', 'groq', 'openrouter'], services: [] },
    outputs: ['ranking', 'notification_decision'],
    criticality: 'medium',
  },
  {
    id: 'hypothesis-accuracy',
    label: 'Hypothesis accuracy tracker',
    version: '1.0.0',
    domain: 'learning',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'analyst',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['ranking'],
    criticality: 'medium',
  },
  {
    id: 'competitive-hypothesis',
    label: 'Competitive hypothesis engine',
    version: '1.1.0',
    domain: 'reasoning',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'analyst',
    dependencies: { sources: [], providers: [], services: ['situation-store-v2'] },
    outputs: ['ranking'],
    criticality: 'medium',
  },
  // Phase 4B epistemic layer.
  {
    id: 'meta-confidence',
    label: 'Meta-Confidence Estimator',
    version: '1.0.0',
    domain: 'intelligence',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'intelligence',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['risk_score'],
    criticality: 'medium',
  },
  {
    id: 'counterfactual-reasoning',
    label: 'Counterfactual Reasoning',
    version: '1.0.0',
    domain: 'intelligence',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'intelligence',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['ranking'],
    criticality: 'low',
  },
  {
    id: 'cognitive-bias-detector',
    label: 'Cognitive Bias Detector',
    version: '1.0.0',
    domain: 'intelligence',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'intelligence',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['risk_score'],
    criticality: 'low',
  },
  {
    id: 'bias-detector',
    label: 'Bias Detector (batch scan)',
    version: '1.0.0',
    domain: 'intelligence',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'intelligence',
    dependencies: { sources: [], providers: [], services: [] },
    outputs: ['risk_score'],
    criticality: 'low',
  },

  // Cognition layer (docs/COGNITIVE_ENHANCEMENT_PLAN.md Part D PR 12).
  // Registering these plugs the cognition outputs into evaluation-ledger
  // grading, hit-rate tracking, drift watch, and the diagnostics panel.
  // Grading is deterministic (cognition/self-tuning.ts), not LLM-based.
  {
    id: 'episodic-analog',
    label: 'Episodic analog scoring',
    version: '1.0.0',
    domain: 'cognition',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'analyst',
    dependencies: { sources: [], providers: [], services: ['episodic-memory'] },
    outputs: ['risk_score'],
    criticality: 'medium',
  },
  {
    id: 'recalibration',
    label: 'Closed-loop recalibration',
    version: '1.0.0',
    domain: 'cognition',
    healthDomain: 'forecast_calibration',
    ownerFeature: 'analyst',
    dependencies: { sources: [], providers: [], services: ['forecast-calibration'] },
    outputs: ['forecast'],
    criticality: 'medium',
  },
  {
    id: 'superforecast',
    label: 'Superforecaster pipeline',
    version: '1.0.0',
    domain: 'cognition',
    healthDomain: 'forecast_calibration',
    ownerFeature: 'analyst',
    dependencies: { sources: [], providers: ['anthropic', 'groq', 'openrouter'], services: ['recalibration', 'episodic-analog'] },
    outputs: ['forecast'],
    criticality: 'medium',
  },
  {
    id: 'operator-ranking',
    label: 'Operator-model ranking personalization',
    version: '1.0.0',
    domain: 'cognition',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'analyst',
    dependencies: { sources: [], providers: [], services: ['operator-model'] },
    outputs: ['ranking'],
    criticality: 'low',
  },
  {
    id: 'entity-trajectory',
    label: 'Entity trajectory detection',
    version: '1.0.0',
    domain: 'cognition',
    healthDomain: 'reasoning_hypothesis',
    ownerFeature: 'analyst',
    dependencies: { sources: [], providers: [], services: ['entity-dossier'] },
    outputs: ['risk_score'],
    criticality: 'medium',
  },
];

const registry = new Map<string, AlgorithmDefinition>(
  REGISTRY_INITIAL.map((a) => [a.id, a]),
);

// ── Public API ──────────────────────────────────────────────────────────

export function getAlgorithm(id: string): AlgorithmDefinition | undefined {
  return registry.get(id);
}

export function listAlgorithms(): AlgorithmDefinition[] {
  return [...registry.values()];
}

export function listByDomain(domain: string): AlgorithmDefinition[] {
  return listAlgorithms().filter((a) => a.domain === domain);
}

export function listByCriticality(criticality: AlgorithmCriticality): AlgorithmDefinition[] {
  return listAlgorithms().filter((a) => a.criticality === criticality);
}

export function listByOutput(output: AlgorithmOutputKind): AlgorithmDefinition[] {
  return listAlgorithms().filter((a) => a.outputs.includes(output));
}

export function listByOwnerFeature(featureId: string): AlgorithmDefinition[] {
  return listAlgorithms().filter((a) => a.ownerFeature === featureId);
}

/** Register a new algorithm at runtime. Throws when the id collides
 *  unless `replace` is true. Returning the registered definition
 *  makes it useful for fluent setups. */
export function registerAlgorithm(
  definition: AlgorithmDefinition,
  options: { replace?: boolean } = {},
): AlgorithmDefinition {
  if (registry.has(definition.id) && !options.replace) {
    throw new Error(`Algorithm "${definition.id}" already registered. Pass replace:true to override.`);
  }
  registry.set(definition.id, { ...definition });
  return definition;
}

/** Reset the registry to its initial state. Tests use this; app code
 *  does not. */
export function resetAlgorithmRegistry(): void {
  registry.clear();
  for (const a of REGISTRY_INITIAL) registry.set(a.id, a);
}
