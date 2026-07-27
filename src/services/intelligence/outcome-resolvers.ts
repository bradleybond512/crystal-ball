import type { ObservationEvent } from '@/types/intelligence';
import type {
  ForecastCalibrationStore,
  MarketMoveCriteria,
  PredictionRecord,
  ResolutionMetadata,
  WarningVerificationCriteria,
} from './forecast-calibration';
import { RESOLVER_EXPIRY_GRACE_MS } from './forecast-calibration';
import type { SpotPriceObservation } from '../market/spot-price-store';
import { pointInPolygon } from '../weather/nws-polygon-match';

export const MARKET_DEADLINE_COVERAGE_MS = 20 * 60 * 1000;

export interface StormReportObservation {
  id: string;
  type: string;
  lat: number;
  lon: number;
  reportedAt: number;
}

export interface StormReportBatch {
  reports: readonly StormReportObservation[];
  fetchedAt: number;
  coverageStart: number;
  coverageEnd: number;
  complete: boolean;
}

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
  stormReportBatch?(): StormReportBatch | null;
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

const VALID_REPORT_TYPES = new Set([
  'tornado',
  'hail',
  'wind',
  'flooding',
]);
const ALL_STORM_REPORT_TYPES = new Set([...VALID_REPORT_TYPES, 'other']);
const MAX_WARNING_POLYGON_RINGS = 8;
const MAX_WARNING_RING_POINTS = 32;

function warningRingHasArea(ring: readonly unknown[]): boolean {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index] as readonly number[];
    const next = ring[(index + 1) % ring.length] as readonly number[];
    twiceArea += current[0]! * next[1]! - next[0]! * current[1]!;
  }
  return Math.abs(twiceArea) > 1e-10;
}

function validWarningCriteria(
  prediction: PredictionRecord,
  criteria: WarningVerificationCriteria,
): boolean {
  const polygon = criteria.polygon as unknown;
  const rings = polygon !== null
    && typeof polygon === 'object'
    && Array.isArray((polygon as { rings?: unknown }).rings)
      ? (polygon as { rings: unknown[] }).rings
      : null;
  if (
    prediction.domain !== 'weather'
    || !Number.isFinite(prediction.predictedAt)
    || !Number.isFinite(prediction.resolveBy)
    || prediction.resolveBy <= prediction.predictedAt
    || !Number.isFinite(criteria.sentAt)
    || criteria.sentAt > prediction.predictedAt
    || !Array.isArray(criteria.reportTypes)
    || criteria.reportTypes.length === 0
    || !criteria.reportTypes.every((type: unknown) =>
      typeof type === 'string' && VALID_REPORT_TYPES.has(type))
    || !rings
    || rings.length === 0
    || rings.length > MAX_WARNING_POLYGON_RINGS
  ) {
    return false;
  }
  return rings.every((ring) =>
    Array.isArray(ring)
    && ring.length >= 3
    && ring.length <= MAX_WARNING_RING_POINTS
    && ring.every((coordinate) =>
      Array.isArray(coordinate)
      && coordinate.length >= 2
      && Number.isFinite(coordinate[0])
      && coordinate[0] >= -180
      && coordinate[0] <= 180
      && Number.isFinite(coordinate[1])
      && coordinate[1] >= -90
      && coordinate[1] <= 90)
    && warningRingHasArea(ring));
}

function validStormReport(report: unknown): report is StormReportObservation {
  if (report === null || typeof report !== 'object') return false;
  const candidate = report as Partial<StormReportObservation>;
  return typeof candidate.id === 'string'
    && candidate.id.length > 0
    && candidate.id.length <= 512
    && !/[\u0000-\u001F\u007F]/.test(candidate.id)
    && typeof candidate.type === 'string'
    && ALL_STORM_REPORT_TYPES.has(candidate.type)
    && Number.isFinite(candidate.lat)
    && candidate.lat! >= -90
    && candidate.lat! <= 90
    && Number.isFinite(candidate.lon)
    && candidate.lon! >= -180
    && candidate.lon! <= 180
    && Number.isFinite(candidate.reportedAt);
}

function warningDirectVerdict(
  report: StormReportObservation,
): ResolverVerdict {
  return {
    outcome: true,
    metadata: {
      note: `direct:warning_verification ${report.type} report ${report.id} at ${report.reportedAt} matched warning polygon`,
      provenance: {
        resolverId: 'warning-verification-v1',
        kind: 'direct',
        evidence: [{
          sourceIds: ['iowa-state-lsr'],
          observedAt: report.reportedAt,
          reference: report.id,
        }],
      },
    },
  };
}

function hasCompleteStormReportCoverage(
  batch: StormReportBatch,
  prediction: PredictionRecord,
  now: number,
): boolean {
  return batch.complete === true
    && batch.reports.every((report) => validStormReport(report))
    && Number.isFinite(batch.fetchedAt)
    && Number.isFinite(batch.coverageStart)
    && Number.isFinite(batch.coverageEnd)
    && batch.fetchedAt >= prediction.resolveBy
    && batch.fetchedAt <= now
    && batch.coverageStart <= prediction.predictedAt
    && batch.coverageEnd >= prediction.resolveBy
    && batch.coverageEnd <= batch.fetchedAt;
}

export const warningVerificationResolver: OutcomeResolver = {
  id: 'warning-verification-v1',
  canResolve: (prediction) =>
    prediction.criteria?.kind === 'warning_verification',
  resolve(prediction, context) {
    const criteria = prediction.criteria;
    if (
      criteria?.kind !== 'warning_verification'
      || !validWarningCriteria(prediction, criteria)
      || !Number.isFinite(context.now)
    ) {
      return null;
    }
    const batch = context.stormReportBatch?.();
    if (!batch || !Array.isArray(batch.reports)) return null;

    const eligibleReports: StormReportObservation[] = [];
    for (const report of batch.reports) {
      if (
        !validStormReport(report)
        || !criteria.reportTypes.includes(report.type)
        || report.reportedAt < prediction.predictedAt
        || report.reportedAt > prediction.resolveBy
        || report.reportedAt > context.now
      ) {
        continue;
      }
      eligibleReports.push(report);
    }
    eligibleReports.sort((a, b) => a.reportedAt - b.reportedAt);
    const match = eligibleReports.find((report) =>
      pointInPolygon([report.lon, report.lat], criteria.polygon));
    if (match) return warningDirectVerdict(match);

    if (
      context.now < prediction.resolveBy
      || !hasCompleteStormReportCoverage(batch, prediction, context.now)
    ) {
      return null;
    }
    return {
      outcome: false,
      metadata: {
        note: `proxy:warning_verification no matching ${criteria.reportTypes.join('/')} report from ${prediction.predictedAt} to ${prediction.resolveBy}; complete LSR coverage ${batch.coverageStart}-${batch.coverageEnd}`,
        provenance: {
          resolverId: 'warning-verification-v1',
          kind: 'proxy',
          evidence: [{
            sourceIds: ['iowa-state-lsr'],
            observedAt: batch.fetchedAt,
            reference: `coverage:${batch.coverageStart}-${batch.coverageEnd}`,
          }],
        },
      },
    };
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
