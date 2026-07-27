import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  PredictionRecord,
  WarningVerificationCriteria,
} from '../../intelligence/forecast-calibration.ts';
import type { AlertPolygon, NwsAlertMinimal } from '../weather-threat-types.ts';
import {
  MAX_OPEN_WARNING_RECORDS,
  MAX_POLYGON_RINGS,
  MAX_RING_POINTS,
  recordWarningPredictions,
} from '../warning-verification-bridge.ts';

const NOW = Date.parse('2026-07-21T00:05:00Z');
const EXPIRES = Date.parse('2026-07-21T01:00:00Z');

function denseRing(
  centerLon: number = -97,
  centerLat: number = 35,
  points: number = 200,
): readonly (readonly [number, number])[] {
  return Array.from({ length: points }, (_, index) => {
    const angle = (index / (points - 1)) * Math.PI * 2;
    return [
      centerLon + Math.cos(angle),
      centerLat + Math.sin(angle),
    ] as const;
  });
}

function warning(
  id: string,
  overrides: Partial<NwsAlertMinimal> = {},
): NwsAlertMinimal {
  return {
    id,
    event: 'Tornado Warning',
    sent: '2026-07-21T00:00:00Z',
    expires: '2026-07-21T01:00:00Z',
    polygon: { rings: [denseRing()] },
    messageType: 'alert',
    ...overrides,
  };
}

function localDeps(initial: readonly PredictionRecord[] = []) {
  const records = [...initial];
  return {
    records,
    deps: {
      all: () => records.map((record) => ({ ...record })),
      recordMany: (incoming: readonly PredictionRecord[]) => {
        records.push(...incoming);
      },
    },
  };
}

test('records a warning with bounded polygon criteria and expiry grace', () => {
  const { records, deps } = localDeps();

  assert.equal(recordWarningPredictions([warning('NWS-1')], NOW, deps), 1);
  const record = records[0];
  assert.equal(record?.id, 'nwswarn:NWS-1');
  assert.equal(record?.predictedAt, NOW);
  assert.equal(record?.resolveBy, EXPIRES + 30 * 60_000);
  assert.equal(record?.probability, 0.7);
  const criteria = record?.criteria as WarningVerificationCriteria;
  assert.equal(criteria.kind, 'warning_verification');
  assert.deepEqual(criteria.reportTypes, ['tornado']);
  assert.ok(criteria.polygon.rings.length <= MAX_POLYGON_RINGS);
  assert.ok(criteria.polygon.rings.every(
    (ring) => ring.length >= 3 && ring.length <= MAX_RING_POINTS,
  ));
});

test('records only supported warning classes with valid polygons and windows', () => {
  const { records, deps } = localDeps();
  const alerts = [
    warning('tornado'),
    warning('severe', {
      event: 'Severe Thunderstorm Warning',
      messageType: 'update',
    }),
    warning('flood', { event: 'Flash Flood Warning' }),
    warning('watch', { event: 'Tornado Watch' }),
    warning('malformed-event', { event: null as unknown as string }),
    warning('malformed-id', { id: null as unknown as string }),
    warning('missing-polygon', { polygon: undefined }),
    warning('cancelled', { messageType: 'cancel' }),
    warning('bad-date', { expires: 'not-a-date' }),
    warning('future-sent', { sent: '2026-07-21T00:06:00Z' }),
    warning('already-over', { expires: '2026-07-20T23:00:00Z' }),
    warning('invalid-coordinate', {
      polygon: { rings: [[[-181, 35], [-180, 36], [-179, 35]]] },
    }),
    warning('degenerate-polygon', {
      polygon: { rings: [[[-98, 35], [-97, 35], [-96, 35]]] },
    }),
    warning('malformed-coordinate', {
      polygon: {
        rings: [[null, [-180, 36], [-179, 35]]] as unknown as AlertPolygon['rings'],
      },
    }),
  ];

  assert.equal(recordWarningPredictions(alerts, NOW, deps), 3);
  assert.deepEqual(
    records.map((record) => [
      record.id,
      (record.criteria as WarningVerificationCriteria).reportTypes,
    ]),
    [
      ['nwswarn:tornado', ['tornado']],
      ['nwswarn:severe', ['hail', 'wind']],
      ['nwswarn:flood', ['flooding']],
    ],
  );
});

test('deduplicates re-ingest and respects the nationwide pending-record cap', () => {
  const pending = Array.from(
    { length: MAX_OPEN_WARNING_RECORDS - 1 },
    (_, index): PredictionRecord => ({
      id: `nwswarn:existing-${index}`,
      sourceId: 'nws-warning',
      domain: 'weather',
      claim: 'existing',
      probability: 0.7,
      predictedAt: NOW,
      resolveBy: EXPIRES,
      status: 'pending',
    }),
  );
  const { records, deps } = localDeps(pending);

  assert.equal(
    recordWarningPredictions(
      [warning('new-1'), warning('new-1'), warning('new-2')],
      NOW,
      deps,
    ),
    1,
  );
  assert.equal(
    records.filter((record) =>
      record.id.startsWith('nwswarn:') && record.status === 'pending').length,
    MAX_OPEN_WARNING_RECORDS,
  );
});

test('caps rings and serialized criteria size under nationwide load', () => {
  const { records, deps } = localDeps();
  const polygon = {
    rings: Array.from(
      { length: MAX_POLYGON_RINGS + 4 },
      (_, index) => denseRing(-110 + index, 35, 300),
    ),
  };
  const alerts = Array.from(
    { length: MAX_OPEN_WARNING_RECORDS + 10 },
    (_, index) => warning(`bulk-${index}`, { polygon }),
  );

  assert.equal(
    recordWarningPredictions(alerts, NOW, deps),
    MAX_OPEN_WARNING_RECORDS,
  );
  assert.ok(records.every((record) => {
    const criteria = record.criteria as WarningVerificationCriteria;
    return criteria.polygon.rings.length <= MAX_POLYGON_RINGS
      && criteria.polygon.rings.every((ring) => ring.length <= MAX_RING_POINTS);
  }));
  assert.ok(JSON.stringify(records).length < 750_000);
});
