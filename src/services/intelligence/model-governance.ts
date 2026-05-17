/**
 * Model Governance — versioned model cards for each Crystal Ball
 * intelligence algorithm. Documents purpose, inputs, outputs, known
 * limitations, and failure modes so operators can audit what each
 * algorithm is supposed to do (and where it has historically failed)
 * without reading source.
 *
 * Pure store with injectable Storage so unit tests don't need a DOM.
 * Built-in cards seed the registry; the operator can override
 * individual fields (e.g. flip status to deprecated, update audit
 * date) through `upsertCard`. Overrides persist to localStorage and
 * merge with the built-in catalog at construction time.
 */

// ── Public types ─────────────────────────────────────────────────────────

export type ModelStatus = 'active' | 'experimental' | 'deprecated';

export interface ModelCard {
  id: string;
  name: string;
  version: string;
  purpose: string;
  inputs: string[];
  outputs: string[];
  limitations: string[];
  knownFailureModes: string[];
  lastAuditDate: number;
  status: ModelStatus;
  tags: string[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ModelGovernanceOptions {
  storage?: StorageLike | null;
}

export interface ModelGovernanceService {
  getCard(id: string): ModelCard | undefined;
  getAllCards(): ModelCard[];
  getByStatus(status: ModelStatus): ModelCard[];
  searchCards(query: string): ModelCard[];
  upsertCard(card: ModelCard): void;
  reset(): void;
  subscribe(cb: (cards: ModelCard[]) => void): void;
  unsubscribe(cb: (cards: ModelCard[]) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-model-governance';

const AUDIT_DATE = new Date('2026-05-16T00:00:00Z').getTime();

// ── Built-in model cards ────────────────────────────────────────────────

export const BUILTIN_MODEL_CARDS: readonly ModelCard[] = [
  {
    id: 'correlate-engine',
    name: 'Correlate Engine',
    version: '2.1.0',
    purpose: 'Detects cross-domain correlations (causal candidates, co-location, temporal adjacency, contradictions) across observation events to seed Situations.',
    inputs: ['ObservationEvent[]', 'CorrelationRule[]', 'clock'],
    outputs: ['CorrelatedPair[]', 'EdgeType per pair'],
    limitations: [
      'Pure pairwise rules — does not detect multi-hop causal chains.',
      'No semantic understanding; relies on tag/domain heuristics from rule definitions.',
      'Performance degrades quadratically with observation volume.',
    ],
    knownFailureModes: [
      'False causal-candidate edges when two unrelated events share a coarse tag.',
      'Misses correlations that span more than the configured time window.',
      'Rule overlap can produce duplicate edges between the same pair.',
    ],
    lastAuditDate: AUDIT_DATE,
    status: 'active',
    tags: ['correlation', 'situation-creation', 'pure'],
  },
  {
    id: 'driver-scoring-engine',
    name: 'Driver Scoring Engine',
    version: '1.4.0',
    purpose: 'Computes per-observation severity by combining domain-specific driver scores with attention multipliers and edge bonuses from the situation graph.',
    inputs: ['ObservationEvent', 'ScoringDriver[]', 'AttentionAllocator', 'EvidenceEdges'],
    outputs: ['EvidenceScore (finalScore + derivedSeverity + explanation)'],
    limitations: [
      'Driver weights are hand-tuned and re-normalized to sum to 1.0 within a domain.',
      'Edge bonus is a flat additive — no learned weighting of edge type.',
      'Attention multipliers smooth slowly; sudden domain shifts take 5–10 outcomes to register.',
    ],
    knownFailureModes: [
      'Score inflation when many low-weight drivers all fire at once.',
      'Underweighting of novel attributes that no driver was authored for.',
      'Cold-start: domains with <5 outcomes use a neutral 1.0 attention multiplier.',
    ],
    lastAuditDate: AUDIT_DATE,
    status: 'active',
    tags: ['scoring', 'severity', 'core'],
  },
  {
    id: 'hypothesis-engine',
    name: 'Competitive Hypothesis Engine',
    version: '1.0.0',
    purpose: 'Generates 2–3 competing explanations for an active Situation and tracks their posterior probabilities as evidence arrives.',
    inputs: ['Situation', 'ObservationEvent[]', 'HypothesisTemplate[]'],
    outputs: ['HypothesisSet with leadingPosterior and contradictingObservationCount'],
    limitations: [
      'Hypotheses come from a hand-curated template library — novel framings need a template.',
      'Posterior updates use a simplified Bayes step with a fixed likelihood model.',
      'No formal rivalry score — leading vs runner-up gap is computed but not normalized.',
    ],
    knownFailureModes: [
      'Confirmation drift when one hypothesis keeps adding supporting observations.',
      'Posterior pegs at 0.99 / 0.01 after many one-sided observations; needs damping.',
      'Two equally-plausible hypotheses cause noisy oscillation around 0.5.',
    ],
    lastAuditDate: AUDIT_DATE,
    status: 'active',
    tags: ['hypothesis', 'bayesian', 'situation-analysis'],
  },
  {
    id: 'meta-confidence-estimator',
    name: 'Meta-Confidence Estimator',
    version: '0.3.0',
    purpose: 'Estimates how confident the system should be in its own confidence — a second-order calibration signal for the operator.',
    inputs: ['Situation', 'EvidenceScore[]', 'HypothesisSet', 'historical accuracy'],
    outputs: ['MetaConfidence in [0,1]', 'rationale strings'],
    limitations: [
      'Currently a heuristic ensemble of evidence quality + recency + agreement.',
      'No learned model — every term has a hand-set weight.',
      'Does not account for cross-domain dependencies between situations.',
    ],
    knownFailureModes: [
      'Stuck-high meta-confidence when accuracy slips below 0.5 (overconfidence).',
      'Stuck-low after a single high-profile miss; needs many wins to recover.',
      'No signal for situations the system has never seen before.',
    ],
    lastAuditDate: AUDIT_DATE,
    status: 'experimental',
    tags: ['meta', 'calibration', 'experimental'],
  },
  {
    id: 'bias-detector',
    name: 'Bias Detector',
    version: '1.0.0',
    purpose: 'Scans the system\'s own output patterns for anchoring, availability, confirmation, recency drift, domain neglect, and overconfidence biases.',
    inputs: ['EvidenceScore[]', 'Situation[]', 'HypothesisSet[]', 'OutcomeRecord[]', 'MetaConfidenceEstimate[]'],
    outputs: ['BiasReport (signals[], dominantBias, overallBiasRisk)'],
    limitations: [
      'Thresholds are hand-tuned; high-FP rate threshold of 0.6 may be too strict for low-volume domains.',
      'Domain-rolling-average input is caller-supplied — accuracy depends on the source.',
      'Cannot detect biases that compound across domains (e.g. anchoring AND availability).',
    ],
    knownFailureModes: [
      'False anchoring signal when first observation is genuinely the highest-severity one.',
      'False availability signal when a domain legitimately spikes (e.g. earthquake swarm).',
      'Misses subtle confirmation bias when contradicting observations exist but are weak.',
    ],
    lastAuditDate: AUDIT_DATE,
    status: 'active',
    tags: ['bias', 'self-audit', 'governance'],
  },
  {
    id: 'backtest-engine',
    name: 'Backtest Engine',
    version: '0.5.0',
    purpose: 'Replays algorithm changes against historical observation streams to validate that proposed changes preserve or improve detection accuracy.',
    inputs: ['HistoricalObservationStream', 'ProposedAlgorithmChange', 'EvaluationMetric'],
    outputs: ['BacktestReport (pre-change accuracy, post-change accuracy, delta)'],
    limitations: [
      'Historical streams are anonymized and re-played, not re-fetched from sources.',
      'Cannot evaluate effects of changes that depend on real-time signals (e.g. fresh feed health).',
      'Replay timing is approximate — clock skew between events may shift correlations.',
    ],
    knownFailureModes: [
      'False-pass when the historical stream is short relative to detection window.',
      'False-fail when stream is dominated by a single past event (overfits to it).',
      'Metric drift if the EvaluationMetric definition has changed since the stream was captured.',
    ],
    lastAuditDate: AUDIT_DATE,
    status: 'experimental',
    tags: ['backtest', 'validation', 'experimental'],
  },
  {
    id: 'counterfactual-engine',
    name: 'Counterfactual Engine',
    version: '0.4.0',
    purpose: 'Computes "what would have to be false for this conclusion to flip" — the minimal change in inputs that would invalidate a Situation or driver score.',
    inputs: ['Situation', 'EvidenceScore', 'EvidenceGraph'],
    outputs: ['CounterfactualAnalysis (robustness, flip-causing changes)'],
    limitations: [
      'Single-attribute counterfactuals only — does not search over combinations of changes.',
      'Robustness score depends on driver weight definitions; not normalized across domains.',
      'No path-counting; some flips require coordinated changes that the engine can\'t enumerate.',
    ],
    knownFailureModes: [
      'High robustness reported when the actual flip requires changing 3+ drivers together.',
      'Low robustness reported when one fragile driver dominates an otherwise stable score.',
      'No counterfactual produced for situations with only one supporting observation.',
    ],
    lastAuditDate: AUDIT_DATE,
    status: 'experimental',
    tags: ['counterfactual', 'robustness', 'experimental'],
  },
  {
    id: 'shadow-runner',
    name: 'Shadow Runner',
    version: '0.2.0',
    purpose: 'Runs proposed algorithm versions in parallel with production, compares outputs, and flags divergence — non-blocking pre-deployment validation.',
    inputs: ['ProductionAlgorithmOutput', 'CandidateAlgorithmOutput', 'DivergenceThreshold'],
    outputs: ['ShadowReport (divergence per observation, summary statistics)'],
    limitations: [
      'Adds CPU + memory overhead proportional to the number of shadowed algorithms.',
      'Divergence threshold is global — does not adapt per-domain.',
      'Shadow outputs are not user-visible; gathered for offline review only.',
    ],
    knownFailureModes: [
      'Missed divergence when both algorithms are wrong in the same direction.',
      'False-positive divergence when the candidate uses a different random seed.',
      'No coverage of error-path behavior unless errors are explicitly injected.',
    ],
    lastAuditDate: AUDIT_DATE,
    status: 'experimental',
    tags: ['shadow', 'validation', 'experimental'],
  },
  {
    id: 'failure-prediction-engine',
    name: 'Failure Prediction Engine',
    version: '0.3.0',
    purpose: 'Predicts which feeds, algorithms, or downstream services are likely to fail in the next N hours based on early warning signals.',
    inputs: ['FeedHealthHistory', 'AlgorithmRunHistory', 'SystemMetricSnapshot'],
    outputs: ['FailurePrediction (target, probability, predictedAt)'],
    limitations: [
      'Heuristic rules — no learned model, no calibration against past predictions.',
      'Lookback window is fixed at 24h; cannot predict slow-build failures.',
      'No per-target priors; treats all feeds as equally likely a priori.',
    ],
    knownFailureModes: [
      'Cries-wolf on feeds with naturally bursty error rates.',
      'Silent on slow-degrade failures that stay just under the threshold.',
      'No prediction when fewer than 12 hours of history is available.',
    ],
    lastAuditDate: AUDIT_DATE,
    status: 'experimental',
    tags: ['failure-prediction', 'reliability', 'experimental'],
  },
  {
    id: 'assumption-tracker',
    name: 'Assumption Tracker',
    version: '1.1.0',
    purpose: 'Annotates every model output with the assumptions that produced it (e.g. "wastewater signals are unbiased samples", "AIS data is complete for class A vessels") and flags violations.',
    inputs: ['AnnotatedOutput', 'AssumptionLibrary'],
    outputs: ['Assumption[] per output', 'ViolationRisk per assumption'],
    limitations: [
      'Assumptions are author-supplied; coverage depends on developer discipline.',
      'No automatic discovery of implicit assumptions.',
      'ViolationRisk is heuristic — no statistical test of assumption validity.',
    ],
    knownFailureModes: [
      'False-clean when an output uses an unannotated assumption.',
      'Risk inflation when many low-impact assumptions stack.',
      'No deduplication across overlapping assumptions.',
    ],
    lastAuditDate: AUDIT_DATE,
    status: 'active',
    tags: ['assumptions', 'transparency', 'governance'],
  },
  {
    id: 'algo-eval-ledger',
    name: 'Algorithm Evaluation Ledger',
    version: '1.0.0',
    purpose: 'Records every algorithm prediction at decision time so accuracy can be measured against subsequent outcomes — live A/B for algorithm changes.',
    inputs: ['AlgorithmId', 'PredictionPayload', 'GroundTruthOutcome (when resolved)'],
    outputs: ['EvalRecord[]', 'per-algorithm accuracy / Brier / calibration'],
    limitations: [
      'Ground truth requires explicit reviewer action or downstream outcome; missing for unresolved predictions.',
      'No segmentation by domain or input class.',
      'Ledger grows unbounded unless caller prunes; current limit 2000.',
    ],
    knownFailureModes: [
      'Accuracy reads as low when many predictions are unresolved.',
      'No detection of distribution shift between training and live inputs.',
      'Brier score is sensitive to outliers when sample size is small.',
    ],
    lastAuditDate: AUDIT_DATE,
    status: 'active',
    tags: ['evaluation', 'calibration', 'core'],
  },
  {
    id: 'outcome-ledger',
    name: 'Outcome Ledger',
    version: '1.2.0',
    purpose: 'Records what the user actually did with each alert or situation (dismissed, acted on, escalated, confirmed real, marked false-positive) so domain calibration can adapt.',
    inputs: ['AlertId or SituationId', 'OutcomeAction', 'predictedSeverity', 'driverScores'],
    outputs: ['OutcomeRecord[]', 'DomainCalibration per domain'],
    limitations: [
      'Self-selection bias: users record outcomes for alerts they noticed, not all alerts.',
      'No outcome aggregation across organizations.',
      'No time-decay on old outcomes; calibration is uniform over the lookback window.',
    ],
    knownFailureModes: [
      'Domain weights skew toward whoever clicks the most.',
      'No outcome for alerts that were silently suppressed.',
      'Confirmed-real rate can collapse to 0 when the user is busy / on vacation.',
    ],
    lastAuditDate: AUDIT_DATE,
    status: 'active',
    tags: ['feedback', 'calibration', 'core'],
  },
  {
    id: 'attention-allocator',
    name: 'Attention Allocator',
    version: '1.0.0',
    purpose: 'Computes per-domain attention multipliers from the outcome ledger and applies them in driver scoring — automatic priority recalibration.',
    inputs: ['DomainCalibration', 'baseline attention'],
    outputs: ['AttentionMultiplier per domain (clamped [0.5, 2.0])'],
    limitations: [
      'Multipliers update only when adjustQuotas runs (default daily).',
      'Cold-start uses 1.0 until MIN_CALIBRATION_SAMPLES (5) outcomes accrue.',
      'No anti-windup: rapid outcome shifts can chase noise.',
    ],
    knownFailureModes: [
      'Whipsaw between high and low attention when outcomes alternate.',
      'Permanent low attention on domains with a single bad week.',
      'Underweight on novel domains with no outcomes yet.',
    ],
    lastAuditDate: AUDIT_DATE,
    status: 'active',
    tags: ['attention', 'calibration', 'core'],
  },
  {
    id: 'trust-budget',
    name: 'Trust Budget',
    version: '1.0.0',
    purpose: 'Per-domain rolling alert quota that auto-tightens when false-positive rate is high and loosens when alerts get acted on — prevents alert fatigue.',
    inputs: ['DomainBudget', 'OutcomeStats per domain'],
    outputs: ['canSend(domain): boolean', 'currentQuota per domain (clamped [0.5, 10])'],
    limitations: [
      'Reduction factor (0.7) is steeper than increase (1.3) — trust is lost faster than earned.',
      'Quota is per-hour rolling — burst traffic at the top of an hour cuts off the rest.',
      'No coordination across domains; cannot redistribute budget from quiet to busy.',
    ],
    knownFailureModes: [
      'Domain locked at QUOTA_MIN if a streak of false-positives occurs early.',
      'Recharge timing race: an alert arriving mid-recharge may see stale exhausted=true.',
      'No backpressure to upstream producers when quota is exhausted.',
    ],
    lastAuditDate: AUDIT_DATE,
    status: 'active',
    tags: ['rate-limit', 'governance', 'core'],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function cloneCard(c: ModelCard): ModelCard {
  return {
    ...c,
    inputs: [...c.inputs],
    outputs: [...c.outputs],
    limitations: [...c.limitations],
    knownFailureModes: [...c.knownFailureModes],
    tags: [...c.tags],
  };
}

function isModelCard(raw: unknown): raw is ModelCard {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return typeof r.id === 'string'
    && typeof r.name === 'string'
    && typeof r.version === 'string'
    && typeof r.purpose === 'string'
    && Array.isArray(r.inputs)
    && Array.isArray(r.outputs)
    && Array.isArray(r.limitations)
    && Array.isArray(r.knownFailureModes)
    && typeof r.lastAuditDate === 'number'
    && (r.status === 'active' || r.status === 'experimental' || r.status === 'deprecated')
    && Array.isArray(r.tags);
}

function rehydrate(storage: StorageLike | null): Map<string, ModelCard> {
  const out = new Map<string, ModelCard>();
  for (const card of BUILTIN_MODEL_CARDS) out.set(card.id, cloneCard(card));
  if (!storage) return out;
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); }
  catch { return out; }
  if (!raw) return out;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return out; }
  if (!Array.isArray(parsed)) return out;
  for (const item of parsed) {
    if (isModelCard(item)) out.set(item.id, cloneCard(item));
  }
  return out;
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createModelGovernanceService(
  options: ModelGovernanceOptions = {},
): ModelGovernanceService {
  const storage = resolveLocalStorage(options.storage);
  let cards = rehydrate(storage);
  const listeners = new Set<(cards: ModelCard[]) => void>();

  function persist(): void {
    if (!storage) return;
    try {
      // Persist only overrides (cards that differ from built-in defaults).
      // A simple approach: write everything; rehydrate merges over defaults.
      const payload = [...cards.values()].map((c) => cloneCard(c));
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function notify(): void {
    const snapshot = [...cards.values()].map((c) => cloneCard(c));
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  return {
    getCard(id): ModelCard | undefined {
      const c = cards.get(id);
      return c ? cloneCard(c) : undefined;
    },

    getAllCards(): ModelCard[] {
      return [...cards.values()].map((c) => cloneCard(c));
    },

    getByStatus(status): ModelCard[] {
      return [...cards.values()]
        .filter((c) => c.status === status)
        .map((c) => cloneCard(c));
    },

    searchCards(query): ModelCard[] {
      const q = query.trim().toLowerCase();
      if (!q) return [...cards.values()].map((c) => cloneCard(c));
      const matches: ModelCard[] = [];
      for (const c of cards.values()) {
        const hay = `${c.name} ${c.purpose} ${c.tags.join(' ')}`.toLowerCase();
        if (hay.includes(q)) matches.push(cloneCard(c));
      }
      return matches;
    },

    upsertCard(card): void {
      cards.set(card.id, cloneCard(card));
      persist();
      notify();
    },

    reset(): void {
      cards = new Map();
      for (const c of BUILTIN_MODEL_CARDS) cards.set(c.id, cloneCard(c));
      persist();
      notify();
    },

    subscribe(cb): void {
      listeners.add(cb);
    },

    unsubscribe(cb): void {
      listeners.delete(cb);
    },
  };
}

// ── Lazy singleton ───────────────────────────────────────────────────────

let _singleton: ModelGovernanceService | null = null;

export function getModelGovernanceService(): ModelGovernanceService {
  _singleton ??= createModelGovernanceService();
  return _singleton;
}

export function _resetModelGovernanceSingletonForTests(): void {
  _singleton = null;
}
