import type { ObservationEvent } from '@/types/intelligence';
import type {
  EventOccurrenceCriteria,
  ForecastCalibrationStore,
  MarketMoveCriteria,
  PredictionRecord,
  ResolutionMetadata,
  WarningVerificationCriteria,
} from './forecast-calibration';
import { RESOLVER_EXPIRY_GRACE_MS } from './forecast-calibration';
import type { SpotPriceObservation } from '../market/spot-price-store';
import { pointInPolygon } from '../weather/nws-polygon-match';
import { slugifyEntity } from './entity-slug';
import {
  EVENT_OCCURRENCE_DOMAINS,
  EVENT_OCCURRENCE_TYPES,
  EVENT_REGION_TAG_PREFIX,
  EVENT_TYPE_TAG_PREFIX,
  type EventOccurrenceType,
} from './event-occurrence-contract';

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

const EVENT_QUERY_LIMIT_PER_DOMAIN = 200;
const EVENT_DOMAIN_SET = new Set<string>(EVENT_OCCURRENCE_DOMAINS);
const EVENT_TYPE_SET = new Set<string>(EVENT_OCCURRENCE_TYPES);
const OBSERVATION_SEVERITIES = new Set([
  'INFO',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
]);

function canonicalSlug(value: unknown, maxLength = 80): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function validEventCriteria(
  prediction: PredictionRecord,
  criteria: EventOccurrenceCriteria,
): boolean {
  return prediction.domain === 'conflict'
    && Number.isFinite(prediction.predictedAt)
    && Number.isFinite(prediction.resolveBy)
    && prediction.resolveBy > prediction.predictedAt
    && Array.isArray(criteria.domains)
    && criteria.domains.length > 0
    && criteria.domains.length <= EVENT_OCCURRENCE_DOMAINS.length
    && new Set(criteria.domains).size === criteria.domains.length
    && criteria.domains.every((domain: unknown) =>
      typeof domain === 'string' && EVENT_DOMAIN_SET.has(domain))
    && Array.isArray(criteria.eventTypes)
    && criteria.eventTypes.length > 0
    && criteria.eventTypes.length <= EVENT_OCCURRENCE_TYPES.length
    && new Set(criteria.eventTypes).size === criteria.eventTypes.length
    && criteria.eventTypes.every((eventType: unknown) =>
      typeof eventType === 'string' && EVENT_TYPE_SET.has(eventType))
    && Array.isArray(criteria.entitySlugs)
    && criteria.entitySlugs.length > 0
    && criteria.entitySlugs.length <= 8
    && new Set(criteria.entitySlugs).size === criteria.entitySlugs.length
    && criteria.entitySlugs.every((entity: unknown) => canonicalSlug(entity))
    && canonicalSlug(criteria.region)
    && Number.isInteger(criteria.minEvidence)
    && criteria.minEvidence >= 2
    && criteria.minEvidence <= 4;
}

function valuesForTagPrefix(
  tags: readonly string[],
  prefix: string,
): string[] {
  return tags
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => tag.slice(prefix.length));
}

function validOccurrenceObservation(
  observation: unknown,
): observation is ObservationEvent {
  if (observation === null || typeof observation !== 'object') return false;
  const candidate = observation as Partial<ObservationEvent>;
  return typeof candidate.id === 'string'
    && candidate.id.length > 0
    && candidate.id.length <= 256
    && !/[\u0000-\u001F\u007F]/.test(candidate.id)
    && typeof candidate.sourceId === 'string'
    && /^[a-z0-9][a-z0-9:-]{0,127}$/.test(candidate.sourceId)
    && typeof candidate.domain === 'string'
    && EVENT_DOMAIN_SET.has(candidate.domain)
    && Number.isFinite(candidate.timestamp)
    && typeof candidate.title === 'string'
    && candidate.title.length > 0
    && candidate.title.length <= 512
    && typeof candidate.severity === 'string'
    && OBSERVATION_SEVERITIES.has(candidate.severity)
    && Array.isArray(candidate.entityIds)
    && candidate.entityIds.length > 0
    && candidate.entityIds.length <= 32
    && candidate.entityIds.every((entity: unknown) =>
      typeof entity === 'string' && entity.length > 0 && entity.length <= 128)
    && Array.isArray(candidate.tags)
    && candidate.tags.length > 0
    && candidate.tags.length <= 32
    && candidate.tags.every((tag: unknown) =>
      typeof tag === 'string' && tag.length > 0 && tag.length <= 128)
    && (
      candidate.location === undefined
      || (
        Number.isFinite(candidate.location.lat)
        && candidate.location.lat >= -90
        && candidate.location.lat <= 90
        && Number.isFinite(candidate.location.lon)
        && candidate.location.lon >= -180
        && candidate.location.lon <= 180
      )
    );
}

interface MatchedOccurrence {
  observation: ObservationEvent;
  eventType: EventOccurrenceType;
}

function matchOccurrence(
  observation: ObservationEvent,
  prediction: PredictionRecord,
  criteria: EventOccurrenceCriteria,
  now: number,
): MatchedOccurrence | null {
  if (
    observation.timestamp <= prediction.predictedAt
    || observation.timestamp > prediction.resolveBy
    || observation.timestamp > now
    || !criteria.domains.includes(observation.domain)
  ) {
    return null;
  }
  const eventTypes = valuesForTagPrefix(
    observation.tags,
    EVENT_TYPE_TAG_PREFIX,
  );
  if (
    eventTypes.length !== 1
    || !criteria.eventTypes.includes(eventTypes[0]!)
    || !EVENT_TYPE_SET.has(eventTypes[0]!)
  ) {
    return null;
  }
  const regions = valuesForTagPrefix(
    observation.tags,
    EVENT_REGION_TAG_PREFIX,
  );
  if (
    regions.length === 0
    || regions.length > 4
    || !regions.every((region) => canonicalSlug(region))
    || !regions.includes(criteria.region)
  ) {
    return null;
  }
  const observedEntities = new Set(
    observation.entityIds
      .map((entity) => slugifyEntity(entity))
      .filter(Boolean),
  );
  if (!criteria.entitySlugs.some((entity) => observedEntities.has(entity))) {
    return null;
  }
  return {
    observation,
    eventType: eventTypes[0] as EventOccurrenceType,
  };
}

function collectOccurrenceMatches(
  prediction: PredictionRecord,
  criteria: EventOccurrenceCriteria,
  context: ResolverContext,
  until: number,
): MatchedOccurrence[] {
  const seenObservations = new Set<string>();
  const matches: MatchedOccurrence[] = [];
  for (const domain of criteria.domains) {
    const queried = context.queryObservations({
      domain,
      since: prediction.predictedAt,
      until,
      limit: EVENT_QUERY_LIMIT_PER_DOMAIN,
    });
    if (!Array.isArray(queried)) continue;
    for (const observation of queried.slice(0, EVENT_QUERY_LIMIT_PER_DOMAIN)) {
      if (!validOccurrenceObservation(observation)) continue;
      const identity = `${observation.sourceId}\u0000${observation.id}`;
      if (seenObservations.has(identity)) continue;
      seenObservations.add(identity);
      const match = matchOccurrence(
        observation,
        prediction,
        criteria,
        context.now,
      );
      if (match) matches.push(match);
    }
  }
  return matches.sort((a, b) =>
    a.observation.timestamp - b.observation.timestamp
    || a.observation.sourceId.localeCompare(b.observation.sourceId)
    || a.observation.id.localeCompare(b.observation.id));
}

function earliestOccurrencesBySource(
  matches: readonly MatchedOccurrence[],
): MatchedOccurrence[] {
  const bySource = new Map<string, MatchedOccurrence>();
  for (const match of matches) {
    if (!bySource.has(match.observation.sourceId)) {
      bySource.set(match.observation.sourceId, match);
    }
  }
  return [...bySource.values()];
}

function eventOccurrenceVerdict(
  criteria: EventOccurrenceCriteria,
  evidence: readonly MatchedOccurrence[],
): ResolverVerdict {
  const eventTypes = [...new Set(evidence.map((item) => item.eventType))]
    .sort((a, b) => a.localeCompare(b));
  const corroboratedAt = Math.max(
    ...evidence.map((item) => item.observation.timestamp),
  );
  return {
    outcome: true,
    metadata: {
      note: `proxy:event_occurrence ${eventTypes.join('/')} matched entity ${criteria.entitySlugs.join('/')} in ${criteria.region} with ${evidence.length} independent sources by ${corroboratedAt}`,
      provenance: {
        resolverId: 'event-occurrence-v1',
        kind: 'proxy',
        evidence: evidence.map(({ observation, eventType }) => ({
          sourceIds: [observation.sourceId],
          observedAt: observation.timestamp,
          reference: `observation:${observation.id}:${eventType}`,
        })),
      },
    },
  };
}

export const eventOccurrenceResolver: OutcomeResolver = {
  id: 'event-occurrence-v1',
  canResolve: (prediction) =>
    prediction.criteria?.kind === 'event_occurrence',
  resolve(prediction, context) {
    const criteria = prediction.criteria;
    if (
      criteria?.kind !== 'event_occurrence'
      || !validEventCriteria(prediction, criteria)
      || !Number.isFinite(context.now)
    ) {
      return null;
    }
    const until = Math.min(context.now, prediction.resolveBy);
    if (until <= prediction.predictedAt) return null;
    const independentMatches = earliestOccurrencesBySource(
      collectOccurrenceMatches(prediction, criteria, context, until),
    );
    if (independentMatches.length < criteria.minEvidence) return null;
    return eventOccurrenceVerdict(
      criteria,
      independentMatches.slice(0, criteria.minEvidence),
    );
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
