import type { Correlation, ObservationEvent, ObservationStoreReader } from './observation-types.ts';

// ── Types ─────────────────────────────────────────────────────────────────

export interface CorrelationChain {
  id: string;
  chainType: string;
  events: ObservationEvent[];
  /** 0–1, decays 0.1 per domain hop, floor 0.3 */
  confidence: number;
  detectedAt: number;
  /** Human-readable summary of the causal sequence */
  title: string;
}

interface DomainTransition {
  from: string;
  fromTag?: string;
  to: string;
  toTag?: string;
  chainType: string;
  /** Max ms between events for this transition to be valid */
  windowMs: number;
}

// ── Causal chain rules ────────────────────────────────────────────────────

const TRANSITIONS: DomainTransition[] = [
  // Seismic → tsunami → evacuation
  { from: 'earthquake', to: 'tsunami',    chainType: 'seismic-cascade',    windowMs: 15 * 60 * 1000 },
  { from: 'tsunami',    to: 'evacuation', chainType: 'seismic-cascade',    windowMs: 30 * 60 * 1000 },
  // Wildfire → air quality → health
  { from: 'wildfire',   to: 'air-quality', chainType: 'wildfire-cascade',  windowMs: 6 * 60 * 60 * 1000 },
  { from: 'air-quality',to: 'health',      chainType: 'wildfire-cascade',  windowMs: 6 * 60 * 60 * 1000 },
  // Hurricane → supply disruption → commodity shortage
  { from: 'weather',    to: 'supply-chain', chainType: 'hurricane-cascade', windowMs: 6 * 60 * 60 * 1000 },
  { from: 'supply-chain',to: 'commodity',  chainType: 'hurricane-cascade', windowMs: 24 * 60 * 60 * 1000 },
  // Cyber → infrastructure → economic
  { from: 'cyber',      to: 'infrastructure', chainType: 'cyber-cascade',  windowMs: 60 * 60 * 1000 },
  { from: 'infrastructure', to: 'economic',   chainType: 'cyber-cascade',  windowMs: 6 * 60 * 60 * 1000 },
  // Conflict → displacement → humanitarian
  { from: 'conflict',   to: 'displacement',   chainType: 'conflict-cascade', windowMs: 24 * 60 * 60 * 1000 },
  { from: 'displacement', to: 'humanitarian', chainType: 'conflict-cascade', windowMs: 24 * 60 * 60 * 1000 },
  // Generic cross-domain pairs for spatial/temporal correlations
  { from: 'maritime',   to: 'economic',     chainType: 'maritime-economic', windowMs: 6 * 60 * 60 * 1000 },
  { from: 'aviation',   to: 'conflict',     chainType: 'aviation-conflict', windowMs: 60 * 60 * 1000 },
];

// ── Helpers ───────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function spatialScore(a: ObservationEvent, b: ObservationEvent, radiusKm: number): number {
  if (a.lat === undefined || a.lon === undefined || b.lat === undefined || b.lon === undefined) return 0;
  const dist = haversineKm(a.lat, a.lon, b.lat, b.lon);
  if (dist > radiusKm) return 0;
  return 1 - (dist / radiusKm) * 0.6;
}

function temporalScore(a: ObservationEvent, b: ObservationEvent, windowMs: number): number {
  const delta = Math.abs(a.occurredAt - b.occurredAt);
  if (delta > windowMs) return 0;
  return 1 - (delta / windowMs) * 0.5;
}

function entityScore(a: ObservationEvent, b: ObservationEvent): number {
  const shared = a.entities.filter(e => b.entities.includes(e));
  return shared.length > 0 ? 0.8 : 0;
}

function pairConfidence(a: ObservationEvent, b: ObservationEvent, windowMs: number, radiusKm = 500): number {
  const spatial = spatialScore(a, b, radiusKm);
  const temporal = temporalScore(a, b, windowMs);
  const entity = entityScore(a, b);
  // weighted blend: spatial + temporal + entity bonus
  const base = spatial > 0
    ? spatial * 0.5 + temporal * 0.3 + entity * 0.2
    : temporal * 0.6 + entity * 0.4;
  return Math.max(0.3, Math.min(1, base > 0 ? base : 0.35));
}

function chainId(events: ObservationEvent[]): string {
  return `chain|${events.map(e => e.id).sort((a, b) => a.localeCompare(b)).join('|')}`;
}

function degrade(confidence: number, hops: number): number {
  return Math.max(0.3, confidence - hops * 0.1);
}

// ── V2 Engine ─────────────────────────────────────────────────────────────

export class CorrelatorV2 {
  private store: ObservationStoreReader;
  private radiusKm: number;
  private chains = new Map<string, CorrelationChain>();
  /** eventId → chainId(s) for de-duplication */
  private eventIndex = new Map<string, string>();

  constructor(store: ObservationStoreReader, options: { radiusKm?: number } = {}) {
    this.store = store;
    this.radiusKm = options.radiusKm ?? 500;
  }

  run(): CorrelationChain[] {
    const events = this.store.getEvents().filter(e => e.active);
    const now = Date.now();
    const detected: CorrelationChain[] = [];

    for (const transition of TRANSITIONS) {
      const anchors = events.filter(e => e.domain === transition.from);
      const targets = events.filter(e => e.domain === transition.to);
      for (const anchor of anchors) {
        for (const target of targets) {
          const added = this.processTransitionPair(anchor, target, transition, now);
          if (added) detected.push(added);
        }
      }
    }

    this.pruneResolved();
    return detected;
  }

  private processTransitionPair(
    anchor: ObservationEvent,
    target: ObservationEvent,
    transition: DomainTransition,
    now: number,
  ): CorrelationChain | null {
    const timeDelta = Math.abs(anchor.occurredAt - target.occurredAt);
    if (timeDelta > transition.windowMs) return null;
    if (target.occurredAt < anchor.occurredAt) return null;

    const conf = pairConfidence(anchor, target, transition.windowMs, this.radiusKm);
    if (conf < 0.3) return null;

    const existingIdA = this.eventIndex.get(anchor.id);
    const existingIdB = this.eventIndex.get(target.id);
    const existingChain = this.resolveExistingChain(existingIdA, existingIdB);

    if (existingChain?.chainType === transition.chainType) {
      this.tryExtendChain(existingChain, target);
      return null;
    }

    return this.buildOrReplaceChain(anchor, target, transition, conf, existingIdA, existingIdB, now);
  }

  private resolveExistingChain(idA: string | undefined, idB: string | undefined): CorrelationChain | undefined {
    if (idA !== undefined) return this.chains.get(idA);
    if (idB !== undefined) return this.chains.get(idB);
    return undefined;
  }

  private tryExtendChain(existingChain: CorrelationChain, target: ObservationEvent): void {
    if (existingChain.events.some(e => e.id === target.id)) return;
    const hops = existingChain.events.length - 1;
    const extended: CorrelationChain = {
      ...existingChain,
      events: [...existingChain.events, target],
      confidence: degrade(existingChain.confidence, hops + 1),
      title: buildTitle([...existingChain.events, target], existingChain.chainType),
    };
    this.chains.set(existingChain.id, extended);
    this.eventIndex.set(target.id, existingChain.id);
  }

  private buildOrReplaceChain(
    anchor: ObservationEvent,
    target: ObservationEvent,
    transition: DomainTransition,
    conf: number,
    existingIdA: string | undefined,
    existingIdB: string | undefined,
    now: number,
  ): CorrelationChain | null {
    const id = chainId([anchor, target]);
    const chain: CorrelationChain = {
      id,
      chainType: transition.chainType,
      events: [anchor, target],
      confidence: degrade(conf, 1),
      detectedAt: this.chains.get(id)?.detectedAt ?? now,
      title: buildTitle([anchor, target], transition.chainType),
    };

    if (existingIdA !== undefined) {
      const existing = this.chains.get(existingIdA);
      if (existing && existing.confidence >= chain.confidence) return null;
      this.chains.delete(existingIdA);
    }
    if (existingIdB !== undefined) {
      const existing = this.chains.get(existingIdB);
      if (existing && existing.confidence >= chain.confidence) return null;
      this.chains.delete(existingIdB);
    }

    this.chains.set(chain.id, chain);
    this.eventIndex.set(anchor.id, chain.id);
    this.eventIndex.set(target.id, chain.id);
    return chain;
  }

  private pruneResolved(): void {
    for (const [id, chain] of this.chains) {
      if (chain.events.every(e => !e.active)) {
        this.chains.delete(id);
        for (const e of chain.events) this.eventIndex.delete(e.id);
      }
    }
  }

  getActiveChains(): CorrelationChain[] {
    return [...this.chains.values()].sort((a, b) => b.confidence - a.confidence);
  }

  getCorrelationsForEvent(eventId: string): CorrelationChain[] {
    return [...this.chains.values()].filter(c => c.events.some(e => e.id === eventId));
  }

  /** Convert active chains to v1-compatible Correlation objects for backward compatibility. */
  toCorrelations(): Correlation[] {
    return this.getActiveChains().map(chain => ({
      id: chain.id,
      events: chain.events,
      type: 'entity' as const,
      confidence: chain.confidence,
      title: chain.title,
      detectedAt: chain.detectedAt,
    }));
  }
}

// ── Module-level singleton cycle ──────────────────────────────────────────

let _instance: CorrelatorV2 | null = null;
let _timer: ReturnType<typeof setInterval> | null = null;

export function startV2Cycle(store: ObservationStoreReader, intervalMs = 5 * 60 * 1000): CorrelatorV2 {
  _instance = new CorrelatorV2(store);
  _instance.run();
  _timer = setInterval(() => _instance!.run(), intervalMs);
  return _instance;
}

export function stopV2Cycle(): void {
  if (_timer !== null) {
    clearInterval(_timer);
    _timer = null;
  }
  _instance = null;
}

export function getActiveChains(): CorrelationChain[] {
  return _instance?.getActiveChains() ?? [];
}

export function getCorrelationsForEvent(eventId: string): CorrelationChain[] {
  return _instance?.getCorrelationsForEvent(eventId) ?? [];
}

// ── Internal helpers ──────────────────────────────────────────────────────

function buildTitle(events: ObservationEvent[], chainType: string): string {
  const domains = events.map(e => e.domain).join(' → ');
  const label = chainType.replace(/-/g, ' ');
  return `${label}: ${events[0]?.title ?? domains}`;
}
