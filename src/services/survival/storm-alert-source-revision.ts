import type { NwsAlertMinimal } from '../weather/weather-threat-types';

export interface StormAlertSourceRevisionEvent {
  sourceRevision: string;
}

function ordinalCompare(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function sortedStrings(values: readonly string[] | undefined): string[] | null {
  if (values === undefined) return null;
  if (!values.every((value) => typeof value === 'string')) throw new Error('invalid alert string list');
  return [...values].sort(ordinalCompare);
}

function canonicalAlert(alert: NwsAlertMinimal): string {
  if (typeof alert.id !== 'string'
    || typeof alert.event !== 'string'
    || typeof alert.sent !== 'string'
    || typeof alert.expires !== 'string') throw new Error('invalid alert identity');
  const rings = alert.polygon === undefined
    ? null
    : alert.polygon.rings.map((ring) => ring.map((coordinate) => {
      if (!Array.isArray(coordinate)
        || coordinate.length !== 2
        || !Number.isFinite(coordinate[0])
        || !Number.isFinite(coordinate[1])) throw new Error('invalid alert coordinate');
      return [coordinate[0], coordinate[1]];
    }));
  return JSON.stringify([
    alert.id,
    alert.event,
    rings,
    alert.sent,
    alert.expires,
    alert.messageType ?? null,
    alert.severity ?? null,
    sortedStrings(alert.references),
    sortedStrings(alert.ugcZones),
    alert.headline ?? null,
  ]);
}

export async function buildStormAlertSourceRevision(
  alerts: readonly NwsAlertMinimal[],
): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const canonical = JSON.stringify(alerts.map((alert) => canonicalAlert(alert)).sort(ordinalCompare));
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

export function createStormAlertRevisionChannel(): {
  seedHydrated(alerts: readonly NwsAlertMinimal[]): Promise<string | null>;
  seedRevision(sourceRevision: string): boolean;
  publishAuthoritative(alerts: readonly NwsAlertMinimal[]): Promise<string | null>;
  publishRevision(sourceRevision: string): boolean;
  current(): string | null;
  subscribe(callback: (event: StormAlertSourceRevisionEvent) => void): () => void;
} {
  let sourceRevision: string | null = null;
  let queue = Promise.resolve();
  const listeners = new Set<(event: StormAlertSourceRevisionEvent) => void>();

  const publishRevision = (nextRevision: string): boolean => {
    if (!/^[a-f0-9]{64}$/.test(nextRevision)) return false;
    const changed = sourceRevision !== nextRevision;
    sourceRevision = nextRevision;
    if (changed) {
      const event = { sourceRevision: nextRevision };
      for (const listener of listeners) {
        try { listener(event); } catch { /* isolate subscribers */ }
      }
    }
    return true;
  };

  const seedRevision = (nextRevision: string): boolean => {
    if (!/^[a-f0-9]{64}$/.test(nextRevision)) return false;
    sourceRevision = nextRevision;
    return true;
  };

  const enqueue = (alerts: readonly NwsAlertMinimal[], publish: boolean): Promise<string | null> => {
    const operation = queue.then(async () => {
      const nextRevision = await buildStormAlertSourceRevision(alerts);
      if (!nextRevision) return null;
      if (publish) publishRevision(nextRevision);
      else seedRevision(nextRevision);
      return nextRevision;
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation;
  };

  return {
    seedHydrated: (alerts) => enqueue(alerts, false),
    seedRevision,
    publishAuthoritative: (alerts) => enqueue(alerts, true),
    publishRevision,
    current: () => sourceRevision,
    subscribe(callback) {
      listeners.add(callback);
      return () => { listeners.delete(callback); };
    },
  };
}
