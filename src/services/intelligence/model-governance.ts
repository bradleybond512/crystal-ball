/**
 * Model Governance Service — versioned model cards for Crystal Ball
 * intelligence algorithms. Documents purpose, inputs, outputs, known
 * biases, performance metrics, and change history so operators can
 * audit algorithm provenance without reading source.
 *
 * Pure store: injectable Storage + clock. Cards persist in a 200-card
 * ring buffer (oldest by insertion order) under `wm-model-governance`.
 * Ten built-in seed cards are registered at construction time and are
 * idempotent: constructing twice will not create duplicates.
 */

// ── Public types ─────────────────────────────────────────────────────────

export interface ModelChange {
  timestamp: number;
  description: string;
  changedBy: string;
}

export interface ModelCard {
  id: string;
  name: string;
  version: string;
  description: string;
  purpose: string;
  inputTypes: string[];
  outputTypes: string[];
  knownBiases: string[];
  performanceMetrics: Record<string, number>;
  lastAuditedAt: number;
  status: 'active' | 'deprecated' | 'experimental';
  changeLog: ModelChange[];
}

export interface ModelGovernanceStats {
  total: number;
  active: number;
  deprecated: number;
  experimental: number;
  avgAuditAgeDays: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ModelGovernanceOptions {
  storage?: StorageLike | null;
  now?: () => number;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-model-governance';
export const MAX_CARDS = 200;

// ── Seed data ────────────────────────────────────────────────────────────

const SEED_CARDS: Omit<ModelCard, 'changeLog'>[] = [
  {
    id: 'correlation-engine',
    name: 'Correlation Engine',
    version: '3.0.0',
    description: 'Detects spatial, temporal, and entity correlations across multi-domain observation streams.',
    purpose: 'Surface hidden relationships between independent data sources to improve compound-risk scoring.',
    inputTypes: ['ObservationEvent[]', 'CorrelationConfig'],
    outputTypes: ['Correlation[]'],
    knownBiases: ['Favours high-frequency domains with dense observation coverage', 'May over-correlate temporally adjacent events'],
    performanceMetrics: { precisionAt10: 0.82, recallAt10: 0.74, f1: 0.78 },
    lastAuditedAt: new Date('2026-04-01').getTime(),
    status: 'active',
  },
  {
    id: 'driver-scorer',
    name: 'Driver Scorer',
    version: '2.1.0',
    description: 'Scores shortage and risk drivers across seven weighted buckets per commodity or domain.',
    purpose: 'Translate raw driver signals into a unified 0–1 risk score with confidence and data-gap annotations.',
    inputTypes: ['ShortageInputBag', 'DriverWeights'],
    outputTypes: ['ShortageForecast'],
    knownBiases: ['Bucket weights were tuned on 2020–2024 data; pre-pandemic baselines may skew scores'],
    performanceMetrics: { mae: 0.09, rmse: 0.14, calibrationError: 0.06 },
    lastAuditedAt: new Date('2026-03-15').getTime(),
    status: 'active',
  },
  {
    id: 'evidence-graph',
    name: 'Evidence Graph',
    version: '1.4.0',
    description: 'Maintains a typed directed graph of NormalizedFacts and their derivation relationships.',
    purpose: 'Provide provenance tracing and independent-source counting for truth-score calculation.',
    inputTypes: ['NormalizedFact', 'EvidenceEdge'],
    outputTypes: ['EvidenceGraph', 'IndependentSourceCount'],
    knownBiases: ['Independent-source count saturates at 5; does not distinguish primary vs. secondary sources'],
    performanceMetrics: { graphBuildLatencyMs: 4.2, independentSourceAccuracy: 0.91 },
    lastAuditedAt: new Date('2026-02-28').getTime(),
    status: 'active',
  },
  {
    id: 'outcome-ledger',
    name: 'Outcome Ledger',
    version: '1.2.0',
    description: 'Records forecast outcomes against ground-truth observations using Brier scoring.',
    purpose: 'Enable per-domain and per-source calibration multipliers for the truth-score pipeline.',
    inputTypes: ['ForecastRecord', 'GroundTruthObservation'],
    outputTypes: ['BrierScore', 'CalibrationMultiplier'],
    knownBiases: ['Ground truth labelling is manual for geopolitical and biosurveillance domains'],
    performanceMetrics: { avgBrierScore: 0.18, domainCoverage: 0.7 },
    lastAuditedAt: new Date('2026-04-10').getTime(),
    status: 'active',
  },
  {
    id: 'attention-allocator',
    name: 'Attention Allocator',
    version: '1.0.0',
    description: 'Ranks active situations by compound risk × confidence × relevance to route analyst attention.',
    purpose: 'Ensure the analyst loop focuses limited LLM budget on the highest-impact hypotheses.',
    inputTypes: ['Situation[]', 'RelevanceResult[]', 'CompoundRiskResult'],
    outputTypes: ['RankedSituation[]'],
    knownBiases: ['Breaking-news recency bias may over-weight newly detected situations'],
    performanceMetrics: { ndcg: 0.79, topKPrecision: 0.85 },
    lastAuditedAt: new Date('2026-01-20').getTime(),
    status: 'experimental',
  },
  {
    id: 'trust-budget',
    name: 'Trust Budget',
    version: '2.0.0',
    description: 'Enforces daily cloud-LLM call caps with race-safe reservation and per-persona accounting.',
    purpose: 'Prevent runaway inference costs while guaranteeing capacity for safety-critical analyst loops.',
    inputTypes: ['BudgetConfig', 'ReservationRequest'],
    outputTypes: ['BudgetDecision'],
    knownBiases: ['Fixed daily cap does not adapt to event-driven surges; manual override required in crises'],
    performanceMetrics: { reservationSuccessRate: 0.98, overageRate: 0.002 },
    lastAuditedAt: new Date('2026-03-01').getTime(),
    status: 'active',
  },
  {
    id: 'meta-confidence',
    name: 'Meta-Confidence',
    version: '1.1.0',
    description: 'Aggregates per-source calibration multipliers, staleness penalties, and cross-domain consensus into a single output confidence score.',
    purpose: 'Give every scored claim an honest confidence estimate that accounts for data quality, age, and disagreement.',
    inputTypes: ['TruthScore', 'ConfidenceBreakdown', 'CalibrationMultiplier[]'],
    outputTypes: ['NormalizedConfidence'],
    knownBiases: ['Staleness decay is linear; non-linear decay may better model rapidly evolving domains'],
    performanceMetrics: { expectedCalibrationError: 0.07, sharpness: 0.61 },
    lastAuditedAt: new Date('2026-04-05').getTime(),
    status: 'active',
  },
  {
    id: 'experiment-manager',
    name: 'Experiment Manager',
    version: '0.9.0',
    description: 'Tracks A/B experiments on algorithm parameters, records outcomes, and proposes winning variants.',
    purpose: 'Enable safe parameter tuning with statistical significance gating before promotion to production.',
    inputTypes: ['ExperimentConfig', 'ObservationSample'],
    outputTypes: ['ExperimentResult', 'VariantProposal'],
    knownBiases: ['Sample-size requirements assume IID; correlated crisis-event streams may inflate significance'],
    performanceMetrics: { experimentCycleCompletionRate: 0.72 },
    lastAuditedAt: new Date('2026-01-05').getTime(),
    status: 'experimental',
  },
  {
    id: 'cognitive-bias-detector',
    name: 'Cognitive Bias Detector',
    version: '1.0.0',
    description: 'Scans analyst hypotheses for confirmation bias, anchoring, and availability heuristic patterns.',
    purpose: 'Surface systematic reasoning errors before they propagate to auto-briefs or action recommendations.',
    inputTypes: ['HypothesisThread[]', 'BiasSignatureLibrary'],
    outputTypes: ['BiasFlag[]'],
    knownBiases: ['Library covers 12 known biases; novel biases outside library are invisible to detector'],
    performanceMetrics: { detectionRecall: 0.68, falsePositiveRate: 0.12 },
    lastAuditedAt: new Date('2026-02-14').getTime(),
    status: 'experimental',
  },
  {
    id: 'competitive-hypothesis-engine',
    name: 'Competitive Hypothesis Engine',
    version: '1.3.0',
    description: 'Maintains rival explanations for each situation and prunes hypotheses as evidence accumulates.',
    purpose: 'Prevent premature convergence on a single narrative by forcing explicit evaluation of alternatives.',
    inputTypes: ['Situation', 'EvidenceGraph', 'HypothesisThread[]'],
    outputTypes: ['RankedHypothesis[]', 'PrunedHypothesis[]'],
    knownBiases: ['Pruning threshold (confidence > 0.85) may prune valid long-tail hypotheses in ambiguous situations'],
    performanceMetrics: { hypothesisSurvivalRate: 0.34, avgRankCorrelation: 0.72 },
    lastAuditedAt: new Date('2026-03-20').getTime(),
    status: 'active',
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
    inputTypes: [...c.inputTypes],
    outputTypes: [...c.outputTypes],
    knownBiases: [...c.knownBiases],
    performanceMetrics: { ...c.performanceMetrics },
    changeLog: c.changeLog.map((ch) => ({ ...ch })),
  };
}

function deserialize(raw: unknown): ModelCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;
  if (typeof r.name !== 'string') return null;
  if (typeof r.version !== 'string') return null;
  if (typeof r.description !== 'string') return null;
  if (typeof r.purpose !== 'string') return null;
  if (!Array.isArray(r.inputTypes)) return null;
  if (!Array.isArray(r.outputTypes)) return null;
  if (!Array.isArray(r.knownBiases)) return null;
  if (typeof r.performanceMetrics !== 'object' || !r.performanceMetrics || Array.isArray(r.performanceMetrics)) return null;
  if (typeof r.lastAuditedAt !== 'number') return null;
  if (r.status !== 'active' && r.status !== 'deprecated' && r.status !== 'experimental') return null;
  const rawLog = Array.isArray(r.changeLog) ? r.changeLog : [];
  const changeLog: ModelChange[] = rawLog
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .filter((e) => typeof e.timestamp === 'number' && typeof e.description === 'string' && typeof e.changedBy === 'string')
    .map((e) => ({ timestamp: e.timestamp as number, description: e.description as string, changedBy: e.changedBy as string }));
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    description: r.description,
    purpose: r.purpose,
    inputTypes: (r.inputTypes as unknown[]).filter((v): v is string => typeof v === 'string'),
    outputTypes: (r.outputTypes as unknown[]).filter((v): v is string => typeof v === 'string'),
    knownBiases: (r.knownBiases as unknown[]).filter((v): v is string => typeof v === 'string'),
    performanceMetrics: Object.fromEntries(
      Object.entries(r.performanceMetrics as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => [k, v as number]),
    ),
    lastAuditedAt: r.lastAuditedAt,
    status: r.status,
    changeLog,
  };
}

function rehydrate(storage: StorageLike | null): ModelCard[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: ModelCard[] = [];
  for (const item of parsed) {
    const card = deserialize(item);
    if (card) out.push(card);
  }
  return out;
}

// ── Class ────────────────────────────────────────────────────────────────

export class ModelGovernanceService {
  private static _instance: ModelGovernanceService | null = null;

  static getInstance(): ModelGovernanceService {
    ModelGovernanceService._instance ??= new ModelGovernanceService();
    return ModelGovernanceService._instance;
  }

  static _resetSingletonForTests(): void {
    ModelGovernanceService._instance = null;
  }

  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  /** Ordered by insertion time (index 0 = oldest) */
  private readonly cards: ModelCard[];
  /** Tracks insertion order for ring buffer: oldest id first */
  private readonly insertionOrder: string[];

  constructor(options: ModelGovernanceOptions = {}) {
    this.storage = resolveLocalStorage(options.storage);
    this.clock = options.now ?? (() => Date.now());
    this.cards = rehydrate(this.storage);
    this.insertionOrder = this.cards.map((c) => c.id);
    for (const seed of SEED_CARDS) {
      this.registerModel(seed);
    }
  }

  registerModel(card: Omit<ModelCard, 'changeLog'>): ModelCard {
    const existing = this.findCard(card.id);
    if (existing) return cloneCard(existing);
    const full: ModelCard = { ...card, inputTypes: [...card.inputTypes], outputTypes: [...card.outputTypes], knownBiases: [...card.knownBiases], performanceMetrics: { ...card.performanceMetrics }, changeLog: [] };
    this.cards.push(full);
    this.insertionOrder.push(card.id);
    this.capRingBuffer();
    this.persist();
    return cloneCard(full);
  }

  updateMetrics(id: string, metrics: Record<string, number>): void {
    const card = this.findCard(id);
    if (!card) return;
    Object.assign(card.performanceMetrics, metrics);
    this.persist();
  }

  addChange(id: string, description: string, changedBy: string): void {
    const card = this.findCard(id);
    if (!card) return;
    card.changeLog.push({ timestamp: this.clock(), description, changedBy });
    this.persist();
  }

  deprecate(id: string): void {
    const card = this.findCard(id);
    if (!card) return;
    card.status = 'deprecated';
    this.persist();
  }

  getActive(): ModelCard[] {
    return this.cards
      .filter((c) => c.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => cloneCard(c));
  }

  getCard(id: string): ModelCard | undefined {
    const card = this.findCard(id);
    return card ? cloneCard(card) : undefined;
  }

  getAll(): ModelCard[] {
    return this.cards.map((c) => cloneCard(c));
  }

  getStats(): ModelGovernanceStats {
    const total = this.cards.length;
    let active = 0;
    let deprecated = 0;
    let experimental = 0;
    let totalAgeDays = 0;
    const nowMs = this.clock();
    for (const c of this.cards) {
      if (c.status === 'active') active += 1;
      else if (c.status === 'deprecated') deprecated += 1;
      else experimental += 1;
      totalAgeDays += (nowMs - c.lastAuditedAt) / 86_400_000;
    }
    return {
      total,
      active,
      deprecated,
      experimental,
      avgAuditAgeDays: total === 0 ? 0 : totalAgeDays / total,
    };
  }

  private findCard(id: string): ModelCard | undefined {
    return this.cards.find((c) => c.id === id);
  }

  private capRingBuffer(): void {
    while (this.cards.length > MAX_CARDS) {
      const oldestId = this.insertionOrder.shift();
      const idx = this.cards.findIndex((c) => c.id === oldestId);
      if (idx !== -1) this.cards.splice(idx, 1);
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.cards));
    } catch { /* quota / private-mode — non-critical */ }
  }
}
