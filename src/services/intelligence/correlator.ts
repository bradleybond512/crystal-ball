import type { Correlation, ObservationStoreReader } from './observation-types.ts';

interface CorrelationEngineOptions {
  maxCorrelations?: number;
  windowMs?: number;
  radiusKm?: number;
}

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function stableId(type: string, idA: string, idB: string): string {
  return `${type}|${[idA, idB].sort((a, b) => a.localeCompare(b)).join('|')}`;
}

export class CorrelationEngine {
  private store: ObservationStoreReader;
  private maxCorrelations: number;
  private windowMs: number;
  private radiusKm: number;
  private correlations = new Map<string, Correlation>();

  constructor(store: ObservationStoreReader, options: CorrelationEngineOptions = {}) {
    this.store = store;
    this.maxCorrelations = options.maxCorrelations ?? 50;
    this.windowMs = options.windowMs ?? 2 * 60 * 60 * 1000;
    this.radiusKm = options.radiusKm ?? 500;
  }

  get correlationCount(): number {
    return this.correlations.size;
  }

  run(): Correlation[] {
    const events = this.store.getEvents().filter(e => e.active);
    const now = Date.now();
    const detected: Correlation[] = [];

    for (let i = 0; i < events.length; i++) {
      const a = events[i];
      if (!a) continue;
      for (let j = i + 1; j < events.length; j++) {
        const b = events[j];
        if (!b || a.domain === b.domain) continue;
        this.detectPair(a, b, now, detected);
      }
    }

    for (const corr of detected) {
      this.correlations.set(corr.id, corr);
    }

    if (this.correlations.size > this.maxCorrelations) {
      const sorted = [...this.correlations.values()].sort((a, b) => b.detectedAt - a.detectedAt);
      this.correlations = new Map(sorted.slice(0, this.maxCorrelations).map(c => [c.id, c]));
    }

    return detected;
  }

  private detectPair(
    a: import('./observation-types.ts').ObservationEvent,
    b: import('./observation-types.ts').ObservationEvent,
    now: number,
    out: Correlation[],
  ): void {
    const timeDelta = Math.abs(a.occurredAt - b.occurredAt);
    const withinWindow = timeDelta <= this.windowMs;
    this.detectSpatial(a, b, now, withinWindow, out);
    this.detectTemporal(a, b, now, withinWindow, out);
    this.detectEntity(a, b, now, out);
  }

  private detectSpatial(
    a: import('./observation-types.ts').ObservationEvent,
    b: import('./observation-types.ts').ObservationEvent,
    now: number,
    withinWindow: boolean,
    out: Correlation[],
  ): void {
    if (!withinWindow || a.lat === undefined || a.lon === undefined || b.lat === undefined || b.lon === undefined) return;
    const distKm = haversineKm(a.lat, a.lon, b.lat, b.lon);
    if (distKm > this.radiusKm) return;
    const id = stableId('spatial', a.id, b.id);
    out.push({
      id,
      events: [a, b],
      type: 'spatial',
      confidence: 1 - (distKm / this.radiusKm) * 0.4,
      title: `${a.title} near ${b.title} — ${a.domain} + ${b.domain} correlation`,
      detectedAt: this.correlations.get(id)?.detectedAt ?? now,
    });
  }

  private detectTemporal(
    a: import('./observation-types.ts').ObservationEvent,
    b: import('./observation-types.ts').ObservationEvent,
    now: number,
    withinWindow: boolean,
    out: Correlation[],
  ): void {
    if (!withinWindow || a.lat !== undefined || a.lon !== undefined || b.lat !== undefined || b.lon !== undefined) return;
    const id = stableId('temporal', a.id, b.id);
    out.push({
      id,
      events: [a, b],
      type: 'temporal',
      confidence: 0.4,
      title: `${a.title} + ${b.title} — concurrent ${a.domain}/${b.domain} events`,
      detectedAt: this.correlations.get(id)?.detectedAt ?? now,
    });
  }

  private detectEntity(
    a: import('./observation-types.ts').ObservationEvent,
    b: import('./observation-types.ts').ObservationEvent,
    now: number,
    out: Correlation[],
  ): void {
    const shared = a.entities.filter(e => b.entities.includes(e));
    if (shared.length === 0) return;
    const id = stableId('entity', a.id, b.id);
    out.push({
      id,
      events: [a, b],
      type: 'entity',
      confidence: 0.7,
      title: `${a.title} + ${b.title} — shared entity: ${shared[0]}`,
      detectedAt: this.correlations.get(id)?.detectedAt ?? now,
    });
  }

  getCorrelations(since?: number, limit?: number): Correlation[] {
    let result = [...this.correlations.values()].sort((a, b) => b.detectedAt - a.detectedAt);
    if (since !== undefined) {
      result = result.filter(c => c.detectedAt >= since);
    }
    if (limit !== undefined) {
      result = result.slice(0, limit);
    }
    return result;
  }

  startCycle(intervalMs = 5 * 60 * 1000): () => void {
    this.run();
    const id = setInterval(() => this.run(), intervalMs);
    return () => clearInterval(id);
  }
}
