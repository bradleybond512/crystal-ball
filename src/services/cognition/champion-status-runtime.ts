import { getChampionRegistry, type ChampionEntry } from './champion-registry';
import {
  buildChampionStatusView,
  type ChampionStatusView,
} from './champion-status-view';
import {
  evaluatePromotionGate,
  safetyEvidenceFromBaselineRegression,
} from './promotion-gate';
import { collectJoinedEvidence, RUN_IDS } from './shadow-rollout';
import { runReplay } from '@/services/ops/replay-harness';
import { buildCatalogReplayFixtures } from '@/services/ops/replay-fixtures-catalog';
import type { ReplayBaseline } from '@/services/ops/replay-baseline';
import replayBaseline from '@/services/ops/replay-baseline.json';
import type { FactDomain } from '@/services/intelligence/types';

export type KnownModel =
  | 'production'
  | 'superforecast'
  | 'hierarchical-base-rate'
  | 'persistence-baseline'
  | 'momentum-baseline'
  | 'unknown';

export type EvaluationMetricV1 =
  | { status: 'ok'; sampleSize: number; value: number }
  | { status: 'insufficient_evidence'; sampleSize: number; minSampleSize: number }
  | { status: 'unavailable' };

export interface ChallengerProjectionV1 {
  model: KnownModel;
  status: 'promotable' | 'rejected' | 'insufficient_evidence';
  evidenceCount: number;
  proxyShare: number;
  perDomain: { domain: FactDomain; count: number }[];
  deltas: {
    metric: 'brier' | 'logLoss';
    delta: number;
    ciLow: number;
    ciHigh: number;
  }[];
}

export interface PromotionProjectionV1 {
  at: number;
  kind: 'initial' | 'promotion' | 'rollback';
  model: KnownModel;
}

export interface EvaluationReportProjectionV1 {
  schemaVersion: 1;
  generatedAt: number;
  forecast: {
    total: number;
    resolved: number;
    pending: number;
    overduePending: number;
    expired: number;
    resolutionCoverage: number | null;
    expirationRate: number | null;
    metrics: {
      brier: EvaluationMetricV1;
      logLoss: EvaluationMetricV1;
      brierSkill: EvaluationMetricV1;
      equalMassEce: EvaluationMetricV1;
    };
    largestVersionLossShare: number | null;
    quarantinedCount: number;
  };
  champion: {
    availability: 'available' | 'unavailable';
    active: { model: KnownModel; version: string | null; activatedAt: number } | null;
    challengers: ChallengerProjectionV1[];
    promotions: PromotionProjectionV1[];
    rejectionHistory: {
      availability: 'unavailable';
      reasonCode: 'no_runtime_rejection_history';
    };
  };
}

export interface ChampionStatusRuntimeSnapshot {
  view: ChampionStatusView;
  history: readonly ChampionEntry[];
}

const CHAMPION_SLOT = 'forecast-primary';
const MAX_COUNT = 1_000_000_000;
const MAX_CHALLENGERS = 4;
const MAX_DELTAS = 2;
const MAX_PROMOTIONS = 6;
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const SAFE_VERSION = /^[A-Za-z0-9._-]{1,32}$/;

const KNOWN_MODELS = new Set<KnownModel>([
  'production',
  'superforecast',
  'hierarchical-base-rate',
  'persistence-baseline',
  'momentum-baseline',
  'unknown',
]);

const FACT_DOMAINS: readonly FactDomain[] = [
  'weather',
  'cyber',
  'aviation',
  'maritime',
  'markets',
  'conflict',
  'humanitarian',
  'space',
  'infra',
  'macro',
  'other',
];

const CHALLENGER_RUNS = [
  { runId: RUN_IDS.SUPERFORECAST, challengerId: 'superforecast' },
  { runId: RUN_IDS.BASELINE_HIERARCHICAL, challengerId: 'hierarchical-base-rate' },
  { runId: RUN_IDS.BASELINE_PERSISTENCE, challengerId: 'persistence-baseline' },
  { runId: RUN_IDS.BASELINE_MOMENTUM, challengerId: 'momentum-baseline' },
] as const;

export function composeChampionStatusRuntime(): ChampionStatusRuntimeSnapshot {
  const registry = getChampionRegistry();
  const active = registry.getActiveChampion(CHAMPION_SLOT);
  const history = registry.getHistory(CHAMPION_SLOT);
  const fixtures = buildCatalogReplayFixtures();
  const safety = safetyEvidenceFromBaselineRegression(
    runReplay({ fixtures }),
    fixtures,
    replayBaseline as ReplayBaseline,
  );
  const incumbentId = active?.modelId ?? 'production';
  const challengers = CHALLENGER_RUNS.map(({ runId, challengerId }) => {
    const pairs = collectJoinedEvidence(runId);
    const decision = evaluatePromotionGate({
      challengerId,
      incumbentId,
      pairs,
      enabledDomains: [],
      safety,
      evaluatedAt: Date.now(),
    });
    return { runId, challengerId, pairs, decision };
  });
  return {
    view: buildChampionStatusView({
      slot: CHAMPION_SLOT,
      ...(active === undefined ? {} : { active }),
      history,
      challengers,
    }),
    history,
  };
}

export function buildEvaluationReportProjectionV1(
  source: unknown,
  clock: () => number = Date.now,
): EvaluationReportProjectionV1 | null {
  try {
    const input = recordOf(source);
    if (input === null) return null;
    const generatedAt = epochOf(input.generatedAt);
    const now = epochOf(clock());
    const forecast = forecastProjection(input.forecast);
    if (
      generatedAt === null
      || now === null
      || generatedAt > now + MAX_FUTURE_SKEW_MS
      || forecast === null
    ) return null;
    return {
      schemaVersion: 1,
      generatedAt,
      forecast,
      champion: championProjection(input.champion),
    };
  } catch {
    return null;
  }
}

function forecastProjection(source: unknown): EvaluationReportProjectionV1['forecast'] | null {
  const input = recordOf(source);
  if (input === null) return null;
  const total = countOf(input.total);
  const resolved = countOf(input.resolved);
  const pending = countOf(input.pending);
  const overduePending = countOf(input.overduePending);
  const expired = countOf(input.expired);
  const quarantinedCount = countOf(input.quarantinedCount);
  if (
    total === null
    || resolved === null
    || pending === null
    || overduePending === null
    || expired === null
    || quarantinedCount === null
  ) return null;
  const metrics = recordOf(input.metrics);
  return {
    total,
    resolved,
    pending,
    overduePending,
    expired,
    resolutionCoverage: nullableRatioOf(input.resolutionCoverage),
    expirationRate: nullableRatioOf(input.expirationRate),
    metrics: {
      brier: metricProjection(metrics?.brier, 0, 1),
      logLoss: metricProjection(metrics?.logLoss, 0, 100),
      brierSkill: metricProjection(metrics?.brierSkill, -10, 1),
      equalMassEce: metricProjection(metrics?.equalMassEce, 0, 1),
    },
    largestVersionLossShare: nullableRatioOf(input.largestVersionLossShare),
    quarantinedCount,
  };
}

function metricProjection(
  source: unknown,
  minimum: number,
  maximum: number,
): EvaluationMetricV1 {
  const input = recordOf(source);
  if (input === null) return { status: 'unavailable' };
  if (input.status === 'ok') {
    const sampleSize = countOf(input.sampleSize);
    const value = boundedNumberOf(input.value, minimum, maximum);
    if (sampleSize !== null && value !== null) return { status: 'ok', sampleSize, value };
  }
  if (input.status === 'insufficient_evidence') {
    const sampleSize = countOf(input.sampleSize);
    const minSampleSize = countOf(input.minSampleSize);
    if (sampleSize !== null && minSampleSize !== null) {
      return { status: 'insufficient_evidence', sampleSize, minSampleSize };
    }
  }
  return { status: 'unavailable' };
}

function championProjection(source: unknown): EvaluationReportProjectionV1['champion'] {
  const unavailable = (): EvaluationReportProjectionV1['champion'] => ({
    availability: 'unavailable',
    active: null,
    challengers: [],
    promotions: [],
    rejectionHistory: {
      availability: 'unavailable',
      reasonCode: 'no_runtime_rejection_history',
    },
  });
  try {
    const runtime = recordOf(source);
    const view = recordOf(runtime?.view);
    if (runtime === null || view === null) return unavailable();
    const challengers = challengerProjections(view.challengers);
    const promotions = promotionProjections(runtime.history);
    if (challengers === null || promotions === null) return unavailable();
    const active = activeProjection(view);
    if (active === undefined) return unavailable();
    return {
      availability: 'available',
      active,
      challengers,
      promotions,
      rejectionHistory: {
        availability: 'unavailable',
        reasonCode: 'no_runtime_rejection_history',
      },
    };
  } catch {
    return unavailable();
  }
}

function activeProjection(
  view: Record<string, unknown>,
): EvaluationReportProjectionV1['champion']['active'] | undefined {
  if (view.championId === undefined) return null;
  const activatedAt = epochOf(view.championActivatedAt);
  if (activatedAt === null) return undefined;
  return {
    model: knownModelOf(view.championId),
    version: safeVersionOf(view.championVersion),
    activatedAt,
  };
}

function challengerProjections(source: unknown): ChallengerProjectionV1[] | null {
  if (!Array.isArray(source)) return null;
  const projections: ChallengerProjectionV1[] = [];
  for (const candidate of source.slice(0, MAX_CHALLENGERS)) {
    const input = recordOf(candidate);
    if (input === null) return null;
    const status = challengerStatusOf(input.status);
    if (status === null) return null;
    const evidenceCount = countOf(input.evidenceCount);
    const proxyShare = ratioOf(input.proxyShare);
    const perDomain = domainProjections(input.perDomainCounts);
    const deltas = deltaProjections(input.deltas);
    if (evidenceCount === null || proxyShare === null || perDomain === null || deltas === null) return null;
    projections.push({
      model: knownModelOf(input.challengerId),
      status,
      evidenceCount,
      proxyShare,
      perDomain,
      deltas,
    });
  }
  return projections;
}

function domainProjections(source: unknown): { domain: FactDomain; count: number }[] | null {
  const counts = recordOf(source);
  if (counts === null) return null;
  const domains: { domain: FactDomain; count: number }[] = [];
  for (const domain of FACT_DOMAINS) {
    if (!Object.prototype.hasOwnProperty.call(counts, domain)) continue;
    const count = countOf(counts[domain]);
    if (count === null) return null;
    domains.push({ domain, count });
  }
  return domains;
}

function deltaProjections(source: unknown): ChallengerProjectionV1['deltas'] | null {
  if (!Array.isArray(source)) return null;
  const deltas: ChallengerProjectionV1['deltas'] = [];
  for (const candidate of source.slice(0, MAX_DELTAS)) {
    const input = recordOf(candidate);
    if (input === null) return null;
    let metric: 'brier' | 'logLoss' | null = null;
    if (input.metric === 'brier') metric = 'brier';
    else if (input.metric === 'log-loss') metric = 'logLoss';
    const delta = boundedNumberOf(input.delta, -100, 100);
    const ciLow = boundedNumberOf(input.ciLow, -100, 100);
    const ciHigh = boundedNumberOf(input.ciHigh, -100, 100);
    if (metric === null || delta === null || ciLow === null || ciHigh === null) return null;
    deltas.push({ metric, delta, ciLow, ciHigh });
  }
  return deltas;
}

function promotionProjections(source: unknown): PromotionProjectionV1[] | null {
  if (!Array.isArray(source)) return null;
  const promotions: PromotionProjectionV1[] = [];
  const recent = source.slice(-MAX_PROMOTIONS).reverse();
  for (const candidate of recent) {
    const input = recordOf(candidate);
    if (input === null || !isPromotionKind(input.reason)) return null;
    const at = epochOf(input.activatedAt);
    if (at === null) return null;
    promotions.push({ at, kind: input.reason, model: knownModelOf(input.modelId) });
  }
  return promotions;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function countOf(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_COUNT
    ? value
    : null;
}

function boundedNumberOf(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function ratioOf(value: unknown): number | null {
  return boundedNumberOf(value, 0, 1);
}

function nullableRatioOf(value: unknown): number | null {
  return value === null ? null : ratioOf(value);
}

function epochOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function knownModelOf(value: unknown): KnownModel {
  return typeof value === 'string' && KNOWN_MODELS.has(value as KnownModel)
    ? value as KnownModel
    : 'unknown';
}

function safeVersionOf(value: unknown): string | null {
  return typeof value === 'string' && SAFE_VERSION.test(value) ? value : null;
}

function challengerStatusOf(
  value: unknown,
): ChallengerProjectionV1['status'] | null {
  if (value === 'promotable' || value === 'rejected') return value;
  if (value === 'insufficient-evidence') return 'insufficient_evidence';
  return null;
}

function isPromotionKind(value: unknown): value is PromotionProjectionV1['kind'] {
  return value === 'initial' || value === 'promotion' || value === 'rollback';
}
