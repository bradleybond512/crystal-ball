import assert from 'node:assert/strict';
import test from 'node:test';
import { createForecastCalibrationStore } from '../forecast-calibration.ts';
import type {
  EventOccurrenceCriteria,
  MarketMoveCriteria,
  PredictionRecord,
  WarningVerificationCriteria,
} from '../forecast-calibration.ts';
import {
  eventOccurrenceResolver,
  MARKET_DEADLINE_COVERAGE_MS,
  marketMoveResolver,
  runOutcomeResolvers,
  warningVerificationResolver,
} from '../outcome-resolvers.ts';
import type { SpotPriceObservation } from '../../market/spot-price-store.ts';
import type { ObservationEvent } from '../../../types/intelligence.ts';

const HOUR = 60 * 60 * 1000;
const RESOLVE_BY = 2 * HOUR;

function prediction(overrides: Partial<MarketMoveCriteria> = {}): PredictionRecord {
  return {
    id: 'hyp:aapl:1',
    sourceId: 'analyst-loop',
    targetKey: 'hypothesis:aapl',
    domain: 'markets',
    claim: 'AAPL rallies',
    probability: 0.6,
    predictedAt: 0,
    resolveBy: RESOLVE_BY,
    status: 'pending',
    criteria: {
      kind: 'market_move',
      symbol: 'AAPL',
      direction: 'up',
      minAbsPct: 3,
      basisPrice: 100,
      basisObservedAt: 0,
      ...overrides,
    },
  };
}

function spot(price: number, observedAt: number): SpotPriceObservation {
  return {
    symbol: 'AAPL',
    price,
    observedAt,
    providerIds: ['yahoo-finance', 'finnhub'],
    independentSourceCount: 2,
    confidence: 0.82,
  };
}

function context(samples: readonly SpotPriceObservation[], now: number) {
  return {
    now,
    spotHistoryFor: (_symbol: string, sinceExclusive: number, untilInclusive: number) =>
      samples.filter((sample) =>
        sample.observedAt > sinceExclusive && sample.observedAt <= untilInclusive),
    queryObservations: () => [],
  };
}

function warningPrediction(
  overrides: Partial<WarningVerificationCriteria> = {},
): PredictionRecord {
  return {
    id: 'nwswarn:test',
    sourceId: 'nws-warning',
    domain: 'weather',
    claim: 'Tornado Warning produces a matching local storm report',
    probability: 0.7,
    predictedAt: 1_000,
    resolveBy: 10_000,
    status: 'pending',
    criteria: {
      kind: 'warning_verification',
      polygon: {
        rings: [[
          [-98, 34],
          [-96, 34],
          [-96, 36],
          [-98, 36],
          [-98, 34],
        ]],
      },
      reportTypes: ['tornado'],
      sentAt: 500,
      ...overrides,
    },
  };
}

function weatherContext(
  now: number,
  reports: readonly {
    id: string;
    type: string;
    lat: number;
    lon: number;
    reportedAt: number;
  }[],
  coverage: {
    fetchedAt?: number;
    coverageStart?: number;
    coverageEnd?: number;
    complete?: boolean;
  } = {},
) {
  return {
    ...context([], now),
    stormReportBatch: () => ({
      reports,
      fetchedAt: coverage.fetchedAt ?? now,
      coverageStart: coverage.coverageStart ?? 0,
      coverageEnd: coverage.coverageEnd ?? now,
      complete: coverage.complete ?? true,
    }),
  };
}

function eventPrediction(
  overrides: Partial<EventOccurrenceCriteria> = {},
): PredictionRecord {
  return {
    id: 'hyp:ukraine:1',
    sourceId: 'analyst-loop',
    targetKey: 'hypothesis:ukraine',
    domain: 'conflict',
    claim: 'Escalation continues in Ukraine',
    probability: 0.7,
    predictedAt: 1_000,
    resolveBy: 10_000,
    status: 'pending',
    criteria: {
      kind: 'event_occurrence',
      domains: ['conflict', 'military', 'security'],
      eventTypes: ['armed-conflict'],
      entitySlugs: ['ukr'],
      region: 'ukraine',
      minEvidence: 2,
      ...overrides,
    },
  };
}

function eventObservation(
  id: string,
  sourceId: string,
  overrides: Partial<ObservationEvent> = {},
): ObservationEvent {
  return {
    id,
    sourceId,
    domain: 'conflict',
    timestamp: 2_000,
    severity: 'HIGH',
    title: 'Confirmed fighting in Ukraine',
    raw: null,
    entityIds: ['UKR'],
    tags: ['event-type:armed-conflict', 'region:ukraine'],
    ...overrides,
  };
}

function eventContext(
  observations: readonly ObservationEvent[],
  now: number,
) {
  return {
    ...context([], now),
    queryObservations: (query: {
      domain?: string;
      since?: number;
      until?: number;
      limit?: number;
    }) => observations
      .filter((observation) =>
        (!query.domain || observation.domain === query.domain)
        && (query.since === undefined || observation.timestamp >= query.since)
        && (query.until === undefined || observation.timestamp <= query.until))
      .slice(0, query.limit),
  };
}

test('first threshold cross in the predicted direction resolves true with direct provenance', () => {
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context([spot(101, 10), spot(103.5, 20)], 20),
  );

  assert.equal(verdict?.outcome, true);
  assert.match(verdict?.metadata.note ?? '', /^direct:market_move/);
  assert.deepEqual(verdict?.metadata.provenance.evidence[0]?.sourceIds, [
    'yahoo-finance',
    'finnhub',
  ]);
  assert.equal(verdict?.metadata.provenance.evidence[0]?.observedAt, 20);
});

test('first threshold cross against the predicted direction resolves false', () => {
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context([spot(96.5, 20)], 20),
  );

  assert.equal(verdict?.outcome, false);
  assert.match(verdict?.metadata.note ?? '', /^direct:market_move/);
});

test('first crossing wins instead of cherry-picking a later reversal', () => {
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context([spot(96, 10), spot(104, 20)], 20),
  );

  assert.equal(verdict?.outcome, false);
  assert.equal(verdict?.metadata.provenance.evidence[0]?.observedAt, 10);
});

test('no cross before the deadline stays pending', () => {
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context([spot(101, HOUR)], HOUR),
  );
  assert.equal(verdict, null);
});

test('post-deadline samples are ignored and cannot create look-ahead leakage', () => {
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context([spot(104, RESOLVE_BY + 1)], RESOLVE_BY + HOUR),
  );
  assert.equal(verdict, null);
});

test('deadline miss requires fresh in-window coverage and is proxy-marked', () => {
  const covered = Array.from(
    { length: RESOLVE_BY / (10 * 60_000) },
    (_, index) => spot(101, (index + 1) * 10 * 60_000),
  );
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context(covered, RESOLVE_BY + 1),
  );

  assert.equal(verdict?.outcome, false);
  assert.match(verdict?.metadata.note ?? '', /^proxy:market_move/);
  assert.equal(verdict?.metadata.provenance.kind, 'proxy');
});

test('deadline miss stays ungraded when the final observation is too old', () => {
  const stale = spot(101, RESOLVE_BY - MARKET_DEADLINE_COVERAGE_MS - 1);
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context([stale], RESOLVE_BY + HOUR),
  );
  assert.equal(verdict, null);
});

test('deadline miss stays ungraded when the in-window history has a coverage gap', () => {
  const verdict = marketMoveResolver.resolve(
    prediction(),
    context([
      spot(100.5, 10 * 60_000),
      spot(101, RESOLVE_BY - 5 * 60_000),
    ], RESOLVE_BY + 1),
  );
  assert.equal(verdict, null);
});

test('dispatcher skips legacy records, resolves once, and persists resolution metadata', () => {
  const store = createForecastCalibrationStore();
  store.record(prediction());
  store.record({ ...prediction(), id: 'legacy', criteria: undefined });
  const ctx = context([spot(104, 20)], 20);

  assert.equal(runOutcomeResolvers(store, ctx, [marketMoveResolver]), 1);
  assert.equal(runOutcomeResolvers(store, ctx, [marketMoveResolver]), 0);
  assert.equal(store.get('hyp:aapl:1')?.status, 'resolved_true');
  assert.equal(store.get('hyp:aapl:1')?.resolutionProvenance?.resolverId, 'market-move-v1');
  assert.equal(store.get('legacy')?.status, 'pending');
});

test('dispatcher explicitly expires resolver-owned records that lack evidence after grace', () => {
  const store = createForecastCalibrationStore();
  store.record(prediction());
  const now = RESOLVE_BY + 31 * 60_000;

  assert.equal(
    runOutcomeResolvers(store, context([], now), [marketMoveResolver]),
    0,
  );
  assert.equal(store.get('hyp:aapl:1')?.status, 'expired');
  assert.match(store.get('hyp:aapl:1')?.resolutionNote ?? '', /^unresolved:market-move-v1/);
});

test('malformed criteria fail closed instead of producing a label', () => {
  const malformed = prediction({ basisPrice: 0 });
  assert.equal(
    marketMoveResolver.resolve(malformed, context([spot(104, 20)], 20)),
    null,
  );
});

test('matching post-prediction storm report resolves a warning true', () => {
  const verdict = warningVerificationResolver.resolve(
    warningPrediction(),
    weatherContext(2_000, [{
      id: 'lsr-1',
      type: 'tornado',
      lat: 35,
      lon: -97,
      reportedAt: 1_500,
    }], { complete: false }),
  );

  assert.equal(verdict?.outcome, true);
  assert.match(verdict?.metadata.note ?? '', /^direct:warning_verification/);
  assert.deepEqual(verdict?.metadata.provenance, {
    resolverId: 'warning-verification-v1',
    kind: 'direct',
    evidence: [{
      sourceIds: ['iowa-state-lsr'],
      observedAt: 1_500,
      reference: 'lsr-1',
      supportsOutcome: true,
    }],
  });
});

test('warning resolver ignores look-ahead leaks, wrong types, and outside reports', () => {
  const reports = [
    { id: 'before', type: 'tornado', lat: 35, lon: -97, reportedAt: 999 },
    { id: 'wrong', type: 'hail', lat: 35, lon: -97, reportedAt: 1_500 },
    { id: 'outside', type: 'tornado', lat: 40, lon: -97, reportedAt: 1_500 },
    { id: 'late', type: 'tornado', lat: 35, lon: -97, reportedAt: 10_001 },
  ];

  assert.equal(
    warningVerificationResolver.resolve(
      warningPrediction(),
      weatherContext(9_000, reports),
    ),
    null,
  );
});

test('warning miss resolves false only with complete end-to-end report coverage', () => {
  const verdict = warningVerificationResolver.resolve(
    warningPrediction(),
    weatherContext(10_001, [{
      id: 'unrelated',
      type: 'other',
      lat: 35,
      lon: -97,
      reportedAt: 5_000,
    }], {
      fetchedAt: 10_001,
      coverageStart: 0,
      coverageEnd: 10_001,
      complete: true,
    }),
  );

  assert.equal(verdict?.outcome, false);
  assert.match(verdict?.metadata.note ?? '', /^proxy:warning_verification/);
  assert.equal(verdict?.metadata.provenance.kind, 'proxy');
});

test('warning miss stays ungraded when report coverage is incomplete or too narrow', () => {
  for (const coverage of [
    { complete: false, coverageStart: 0, coverageEnd: 10_001 },
    { complete: true, coverageStart: 1_001, coverageEnd: 10_001 },
    { complete: true, coverageStart: 0, coverageEnd: 9_999 },
    { complete: true, coverageStart: 0, coverageEnd: 10_001, fetchedAt: 9_999 },
  ]) {
    assert.equal(
      warningVerificationResolver.resolve(
        warningPrediction(),
        weatherContext(10_001, [], coverage),
      ),
      null,
    );
  }
});

test('warning resolver rejects malformed criteria and report rows', () => {
  const malformed = warningPrediction({
    polygon: { rings: [[[-181, 35], [-180, 36], [-179, 35]]] },
  });
  assert.equal(
    warningVerificationResolver.resolve(
      malformed,
      weatherContext(2_000, [{
        id: 'bad-report',
        type: 'tornado',
        lat: Number.NaN,
        lon: -97,
        reportedAt: 1_500,
      }]),
    ),
    null,
  );
  const structurallyMalformed = warningPrediction({
    polygon: { rings: [[null, [-180, 36], [-179, 35]]] } as unknown as WarningVerificationCriteria['polygon'],
  });
  assert.equal(
    warningVerificationResolver.resolve(
      structurallyMalformed,
      weatherContext(2_000, []),
    ),
    null,
  );
  const degenerate = warningPrediction({
    polygon: { rings: [[[-98, 35], [-97, 35], [-96, 35]]] },
  });
  assert.equal(
    warningVerificationResolver.resolve(
      degenerate,
      weatherContext(10_001, []),
    ),
    null,
  );
});

test('corroborated conflict event resolves true with durable proxy provenance', () => {
  const verdict = eventOccurrenceResolver.resolve(
    eventPrediction(),
    eventContext([
      eventObservation('acled-1', 'acled', { timestamp: 2_000 }),
      eventObservation('news-1', 'news:reuters', { timestamp: 2_500 }),
    ], 3_000),
  );

  assert.equal(verdict?.outcome, true);
  assert.match(verdict?.metadata.note ?? '', /^proxy:event_occurrence/);
  assert.deepEqual(verdict?.metadata.provenance, {
    resolverId: 'event-occurrence-v1',
    kind: 'proxy',
    evidence: [
      {
        sourceIds: ['acled'],
        observedAt: 2_000,
        reference: 'observation:acled-1:armed-conflict',
        supportsOutcome: true,
      },
      {
        sourceIds: ['news:reuters'],
        observedAt: 2_500,
        reference: 'observation:news-1:armed-conflict',
        supportsOutcome: true,
      },
    ],
  });
});

test('conflict resolver requires independent sources instead of duplicate rows', () => {
  const verdict = eventOccurrenceResolver.resolve(
    eventPrediction(),
    eventContext([
      eventObservation('acled-1', 'acled'),
      eventObservation('acled-2', 'acled', { timestamp: 2_500 }),
    ], 3_000),
  );

  assert.equal(verdict, null);
});

test('conflict resolver rejects near entity, region, event-type, and domain joins', () => {
  const valid = eventObservation('valid', 'acled');
  const falseJoins = [
    eventObservation('near-entity', 'news:entity', { entityIds: ['UKR-east'] }),
    eventObservation('near-region', 'news:region', {
      tags: ['event-type:armed-conflict', 'region:eastern-ukraine'],
    }),
    eventObservation('wrong-type', 'news:type', {
      tags: ['event-type:airstrike', 'region:ukraine'],
    }),
    eventObservation('wrong-domain', 'news:domain', { domain: 'humanitarian' }),
  ];

  for (const falseJoin of falseJoins) {
    assert.equal(
      eventOccurrenceResolver.resolve(
        eventPrediction(),
        eventContext([valid, falseJoin], 3_000),
      ),
      null,
      falseJoin.id,
    );
  }
});

test('conflict resolver enforces prediction, horizon, and current-time boundaries', () => {
  const valid = eventObservation('valid', 'acled');
  const outOfWindow = [
    eventObservation('before', 'news:before', { timestamp: 999 }),
    eventObservation('at-prediction', 'news:at', { timestamp: 1_000 }),
    eventObservation('after-horizon', 'news:late', { timestamp: 10_001 }),
  ];

  for (const observation of outOfWindow) {
    assert.equal(
      eventOccurrenceResolver.resolve(
        eventPrediction(),
        eventContext([valid, observation], 11_000),
      ),
      null,
      observation.id,
    );
  }
  assert.equal(
    eventOccurrenceResolver.resolve(
      eventPrediction(),
      eventContext([
        valid,
        eventObservation('future', 'news:future', { timestamp: 3_001 }),
      ], 3_000),
    ),
    null,
  );
});

test('conflict resolver fails closed on malformed criteria and observations', () => {
  const malformedObservation = eventObservation('malformed', 'news:bad', {
    entityIds: null as unknown as string[],
  });
  assert.equal(
    eventOccurrenceResolver.resolve(
      eventPrediction(),
      eventContext([
        eventObservation('valid', 'acled'),
        malformedObservation,
      ], 3_000),
    ),
    null,
  );
  assert.equal(
    eventOccurrenceResolver.resolve(
      eventPrediction({ minEvidence: 1 }),
      eventContext([
        eventObservation('a', 'acled'),
        eventObservation('b', 'news:reuters'),
      ], 3_000),
    ),
    null,
  );
});

test('conflict misses stay unresolved at the deadline and expire without a false label', () => {
  assert.equal(
    eventOccurrenceResolver.resolve(
      eventPrediction(),
      eventContext([], 10_001),
    ),
    null,
  );

  const store = createForecastCalibrationStore();
  store.record(eventPrediction());
  const now = 10_000 + 31 * 60_000;
  assert.equal(
    runOutcomeResolvers(
      store,
      eventContext([], now),
      [eventOccurrenceResolver],
    ),
    0,
  );
  assert.equal(store.get('hyp:ukraine:1')?.status, 'expired');
  assert.match(
    store.get('hyp:ukraine:1')?.resolutionNote ?? '',
    /^unresolved:event-occurrence-v1/,
  );
});
