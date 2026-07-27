import {
  getCalibrationStore,
  recordPredictions,
} from '../intelligence/forecast-calibration-adapter';
import {
  RESOLVER_EXPIRY_GRACE_MS,
  type PredictionRecord,
} from '../intelligence/forecast-calibration';
import type {
  AlertPolygon,
  Coord,
  NwsAlertMinimal,
} from './weather-threat-types';

export const MAX_OPEN_WARNING_RECORDS = 50;
export const MAX_POLYGON_RINGS = 8;
export const MAX_RING_POINTS = 32;

const MAX_ALERT_ID_LENGTH = 512;
const WARNING_PROBABILITY = 0.7;
const WARNING_TYPES = new Map<string, readonly string[]>([
  ['tornado warning', ['tornado']],
  ['severe thunderstorm warning', ['hail', 'wind']],
  ['flash flood warning', ['flooding']],
]);

interface WarningRecordDeps {
  all(): readonly PredictionRecord[];
  recordMany(records: readonly PredictionRecord[]): void;
}

const defaultDeps: WarningRecordDeps = {
  all: () => getCalibrationStore().all(),
  recordMany: recordPredictions,
};

function validCoordinate(value: unknown): value is Coord {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(value[0])
    && value[0]! >= -180
    && value[0]! <= 180
    && Number.isFinite(value[1])
    && value[1]! >= -90
    && value[1]! <= 90;
}

function hasUsableArea(ring: readonly Coord[]): boolean {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(twiceArea) > 1e-10;
}

function boundedRing(ring: readonly Coord[]): Coord[] | null {
  if (ring.length < 3) return null;
  if (!ring.every((coordinate) => validCoordinate(coordinate))) return null;
  if (ring.length <= MAX_RING_POINTS) {
    const copied = ring.map(([lon, lat]) => [lon, lat] as const);
    return hasUsableArea(copied) ? copied : null;
  }
  const sampled = Array.from({ length: MAX_RING_POINTS }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (ring.length - 1)) / (MAX_RING_POINTS - 1),
    );
    const [lon, lat] = ring[sourceIndex]!;
    return [lon, lat] as const;
  });
  return hasUsableArea(sampled) ? sampled : null;
}

function boundedPolygon(polygon: AlertPolygon | undefined): AlertPolygon | null {
  if (!polygon || !Array.isArray(polygon.rings)) return null;
  const rings: Coord[][] = [];
  for (const ring of polygon.rings.slice(0, MAX_POLYGON_RINGS)) {
    if (!Array.isArray(ring)) continue;
    const bounded = boundedRing(ring);
    if (bounded) rings.push(bounded);
  }
  return rings.length > 0 ? { rings } : null;
}

function alertRecord(
  alert: NwsAlertMinimal,
  now: number,
): PredictionRecord | null {
  if (
    typeof alert.event !== 'string'
    || typeof alert.id !== 'string'
    || typeof alert.sent !== 'string'
    || typeof alert.expires !== 'string'
  ) {
    return null;
  }
  const event = alert.event.trim().toLowerCase();
  const reportTypes = WARNING_TYPES.get(event);
  if (!reportTypes) return null;
  if (alert.messageType !== undefined
    && alert.messageType !== 'alert'
    && alert.messageType !== 'update') {
    return null;
  }
  const id = alert.id.trim();
  if (
    id.length === 0
    || id.length > MAX_ALERT_ID_LENGTH
    || /[\u0000-\u001F\u007F]/.test(id)
  ) {
    return null;
  }
  const sentAt = Date.parse(alert.sent);
  const expiresAt = Date.parse(alert.expires);
  if (
    !Number.isFinite(sentAt)
    || !Number.isFinite(expiresAt)
    || sentAt > now
    || expiresAt <= sentAt
    || expiresAt <= now
  ) {
    return null;
  }
  const polygon = boundedPolygon(alert.polygon);
  if (!polygon) return null;

  return {
    id: `nwswarn:${id}`,
    sourceId: 'nws-warning',
    targetKey: `nws-warning:${id}`,
    domain: 'weather',
    claim: `${alert.event.trim()} produces a matching local storm report`,
    probability: WARNING_PROBABILITY,
    predictedAt: now,
    resolveBy: expiresAt + RESOLVER_EXPIRY_GRACE_MS,
    status: 'pending',
    criteria: {
      kind: 'warning_verification',
      polygon,
      reportTypes: [...reportTypes],
      sentAt,
    },
    algorithmVersion: '1.0.0',
  };
}

export function recordWarningPredictions(
  alerts: readonly NwsAlertMinimal[],
  now: number = Date.now(),
  deps: WarningRecordDeps = defaultDeps,
): number {
  if (!Number.isFinite(now)) return 0;
  const existing = deps.all();
  const ids = new Set(existing.map((record) => record.id));
  let available = MAX_OPEN_WARNING_RECORDS - existing.filter(
    (record) =>
      record.status === 'pending' && record.id.startsWith('nwswarn:'),
  ).length;
  if (available <= 0) return 0;

  const records: PredictionRecord[] = [];
  for (const alert of alerts) {
    const record = alertRecord(alert, now);
    if (!record || ids.has(record.id)) continue;
    ids.add(record.id);
    records.push(record);
    available -= 1;
    if (available === 0) break;
  }
  deps.recordMany(records);
  return records.length;
}
