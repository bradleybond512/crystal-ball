import type { ObservationEvent } from '@/types/intelligence';
import type {
  ForecastCalibrationStore,
  MarketMoveCriteria,
  PredictionRecord,
  ResolutionMetadata,
} from './forecast-calibration';
import { RESOLVER_EXPIRY_GRACE_MS } from './forecast-calibration';
import type { SpotPriceObservation } from '../market/spot-price-store';

export const MARKET_DEADLINE_COVERAGE_MS = 20 * 60 * 1000;

export interface ResolverContext {
  now: number;
  spotHistoryFor(
    symbol: string,
    sinceExclusive: number,
    untilInclusive: number,
  ): readonly SpotPriceObservation[];
  queryObservations(query: {
    domain?: string;
    since?: number;
    until?: number;
    limit?: number;
  }): readonly ObservationEvent[];
}

export interface ResolverVerdict {
  outcome: boolean;
  metadata: ResolutionMetadata;
}

export interface OutcomeResolver {
  id: string;
  canResolve(prediction: PredictionRecord): boolean;
  resolve(
    prediction: PredictionRecord,
    context: ResolverContext,
  ): ResolverVerdict | null;
}

function validMarketCriteria(
  prediction: PredictionRecord,
  criteria: MarketMoveCriteria,
): boolean {
  return prediction.domain === 'markets'
    && prediction.resolveBy > prediction.predictedAt
    && /^[A-Z0-9][A-Z0-9.=+-]{0,15}$/.test(criteria.symbol)
    && Number.isFinite(criteria.minAbsPct)
    && criteria.minAbsPct > 0
    && Number.isFinite(criteria.basisPrice)
    && criteria.basisPrice > 0
    && Number.isFinite(criteria.basisObservedAt)
    && criteria.basisObservedAt >= 0
    && criteria.basisObservedAt <= prediction.predictedAt;
}

function validSpot(
  sample: SpotPriceObservation,
  symbol: string,
  sinceExclusive: number,
  untilInclusive: number,
): boolean {
  return sample.symbol.toUpperCase() === symbol
    && Number.isFinite(sample.price)
    && sample.price > 0
    && Number.isFinite(sample.observedAt)
    && sample.observedAt > sinceExclusive
    && sample.observedAt <= untilInclusive
    && sample.independentSourceCount >= 1
    && sample.providerIds.length >= 1;
}

function directVerdict(
  criteria: MarketMoveCriteria,
  sample: SpotPriceObservation,
  pct: number,
  outcome: boolean,
): ResolverVerdict {
  const signedPct = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  const sources = sample.providerIds.join(',');
  return {
    outcome,
    metadata: {
      note: `direct:market_move ${criteria.symbol} ${signedPct} vs basis ${criteria.basisPrice} at ${sample.observedAt}; threshold ${criteria.minAbsPct}%; sources ${sources}`,
      provenance: {
        resolverId: 'market-move-v1',
        kind: 'direct',
        evidence: [{
          sourceIds: [...sample.providerIds],
          observedAt: sample.observedAt,
          value: sample.price,
          reference: `${criteria.symbol}:basis@${criteria.basisObservedAt}`,
        }],
      },
    },
  };
}

function deadlineVerdict(
  criteria: MarketMoveCriteria,
  samples: readonly SpotPriceObservation[],
  resolveBy: number,
): ResolverVerdict {
  const firstSample = samples[0]!;
  const finalSample = samples[samples.length - 1]!;
  const evidence = firstSample.observedAt === finalSample.observedAt
    ? [finalSample]
    : [firstSample, finalSample];
  return {
    outcome: false,
    metadata: {
      note: `proxy:market_move ${criteria.symbol} did not cross ${criteria.minAbsPct}% before ${resolveBy}; ${samples.length} covered samples from ${firstSample.observedAt} to ${finalSample.observedAt}`,
      provenance: {
        resolverId: 'market-move-v1',
        kind: 'proxy',
        evidence: evidence.map((sample) => ({
          sourceIds: [...sample.providerIds],
          observedAt: sample.observedAt,
          value: sample.price,
          reference: `${criteria.symbol}:deadline@${resolveBy}`,
        })),
      },
    },
  };
}

function hasContinuousCoverage(
  predictedAt: number,
  resolveBy: number,
  samples: readonly SpotPriceObservation[],
): boolean {
  let cursor = predictedAt;
  for (const sample of samples) {
    if (sample.observedAt - cursor > MARKET_DEADLINE_COVERAGE_MS) return false;
    cursor = sample.observedAt;
  }
  return resolveBy - cursor <= MARKET_DEADLINE_COVERAGE_MS;
}

export const marketMoveResolver: OutcomeResolver = {
  id: 'market-move-v1',
  canResolve: (prediction) => prediction.criteria?.kind === 'market_move',
  resolve(prediction, context) {
    const criteria = prediction.criteria;
    if (
      criteria?.kind !== 'market_move'
      || !validMarketCriteria(prediction, criteria)
      || !Number.isFinite(context.now)
    ) {
      return null;
    }
    const symbol = criteria.symbol.toUpperCase();
    const sinceExclusive = Math.max(
      prediction.predictedAt,
      criteria.basisObservedAt,
    );
    const untilInclusive = Math.min(context.now, prediction.resolveBy);
    if (untilInclusive <= sinceExclusive) return null;
    const samples = context
      .spotHistoryFor(symbol, sinceExclusive, untilInclusive)
      .filter((sample) =>
        validSpot(sample, symbol, sinceExclusive, untilInclusive))
      .sort((a, b) => a.observedAt - b.observedAt);

    for (const sample of samples) {
      const pct = ((sample.price - criteria.basisPrice) / criteria.basisPrice) * 100;
      if (Math.abs(pct) + Number.EPSILON < criteria.minAbsPct) continue;
      const outcome = criteria.direction === 'up' ? pct > 0 : pct < 0;
      return directVerdict(criteria, sample, pct, outcome);
    }

    if (context.now < prediction.resolveBy) return null;
    if (!hasContinuousCoverage(prediction.predictedAt, prediction.resolveBy, samples)) {
      return null;
    }
    return deadlineVerdict(criteria, samples, prediction.resolveBy);
  },
};

export function runOutcomeResolvers(
  store: Pick<ForecastCalibrationStore, 'all' | 'resolve' | 'expire'>,
  context: ResolverContext,
  resolvers: readonly OutcomeResolver[],
): number {
  let resolved = 0;
  for (const prediction of store.all()) {
    if (prediction.status !== 'pending' || !prediction.criteria) continue;
    for (const resolver of resolvers) {
      if (!resolver.canResolve(prediction)) continue;
      const verdict = resolver.resolve(prediction, context);
      if (
        verdict
        && store.resolve(
          prediction.id,
          verdict.outcome,
          context.now,
          verdict.metadata,
        )
      ) {
        resolved += 1;
      } else if (
        !verdict
        && context.now > prediction.resolveBy + RESOLVER_EXPIRY_GRACE_MS
      ) {
        store.expire(
          prediction.id,
          context.now,
          `unresolved:${resolver.id} no in-window verdict after resolver grace`,
        );
      }
      break;
    }
  }
  return resolved;
}
