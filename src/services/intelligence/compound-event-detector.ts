/**
 * CompoundEventDetectorService — detects when multiple domains are
 * simultaneously elevated. Two domains elevated = watch, 3-4 = warning,
 * 5+ = emergency. Historically compound events are more dangerous than
 * single-domain incidents.
 *
 * Pure deterministic; no DOM, no fetch. Injectable Storage + clock keep
 * tests hermetic.
 */

// ── Public types ─────────────────────────────────────────────────────

export type CompoundSeverity = 'watch' | 'warning' | 'emergency';

export interface ElevatedDomain {
  domain: string;
  activeSituationCount: number;
  highestSeverity: string;
  situationIds: string[];
}

export interface CompoundEvent {
  id: string;
  elevatedDomains: ElevatedDomain[];
  compoundSeverity: CompoundSeverity;
  domainCount: number;
  detectedAt: number;
  resolvedAt?: number;
  active: boolean;
  description: string;
}

export interface CompoundEventSummary {
  activeEvents: CompoundEvent[];
  resolvedToday: number;
  maxDomainsEver: number;
  currentElevatedDomains: string[];
}

export type CompoundEventListener = (event: CompoundEvent) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CompoundEventDetectorServiceOptions {
  storage?: StorageLike | null;
  now?: () => number;
  maxEvents?: number;
}

// ── Constants ────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-compound-events';
export const MAX_EVENTS = 200;
const RESOLVED_TODAY_WINDOW_MS = 24 * 60 * 60 * 1000;

// ── Engine ──────────────────────────────────────────────────────────

interface PersistedState {
  events: CompoundEvent[];
  activeId: string | null;
}

export class CompoundEventDetectorService {
  private readonly storage: StorageLike | null;
  private readonly clock: () => number;
  private readonly maxEvents: number;
  private readonly events: CompoundEvent[] = [];
  private activeId: string | null = null;
  private readonly subscribers = new Set<CompoundEventListener>();
  private idCounter = 0;

  constructor(opts: CompoundEventDetectorServiceOptions = {}) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.clock = opts.now ?? Date.now;
    this.maxEvents = opts.maxEvents ?? MAX_EVENTS;
    this.hydrate();
  }

  update(elevations: readonly ElevatedDomain[]): void {
    const now = this.clock();
    const filtered = [...elevations].sort((a, b) => a.domain.localeCompare(b.domain));
    const active = this.findActiveEvent();

    if (filtered.length < 2) {
      if (active) this.resolveEvent(active, now);
      return;
    }

    if (!active) {
      this.createEvent(filtered, now);
      return;
    }

    if (sameDomainSet(active.elevatedDomains, filtered)) {
      // No-op: identical domain set.
      return;
    }

    this.updateEvent(active, filtered);
  }

  getActive(): CompoundEvent | null {
    const active = this.findActiveEvent();
    return active ? cloneEvent(active) : null;
  }

  getHistory(limit?: number): CompoundEvent[] {
    const reversed: CompoundEvent[] = [];
    for (let i = this.events.length - 1; i >= 0; i--) {
      reversed.push(cloneEvent(this.events[i]!));
      if (limit && reversed.length >= limit) break;
    }
    return reversed;
  }

  getSummary(): CompoundEventSummary {
    const now = this.clock();
    const activeEvents: CompoundEvent[] = [];
    let resolvedToday = 0;
    let maxDomainsEver = 0;
    for (const e of this.events) {
      if (e.active) activeEvents.push(cloneEvent(e));
      if (e.resolvedAt !== undefined && now - e.resolvedAt <= RESOLVED_TODAY_WINDOW_MS) {
        resolvedToday += 1;
      }
      if (e.domainCount > maxDomainsEver) maxDomainsEver = e.domainCount;
    }
    const active = this.findActiveEvent();
    const currentElevatedDomains = active
      ? active.elevatedDomains.map((d) => d.domain)
      : [];
    return { activeEvents, resolvedToday, maxDomainsEver, currentElevatedDomains };
  }

  subscribe(cb: CompoundEventListener): () => void {
    this.subscribers.add(cb);
    return () => { this.subscribers.delete(cb); };
  }

  unsubscribe(cb: CompoundEventListener): void {
    this.subscribers.delete(cb);
  }

  clear(): void {
    this.events.length = 0;
    this.activeId = null;
    this.persist();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private findActiveEvent(): CompoundEvent | undefined {
    if (this.activeId === null) return undefined;
    return this.events.find((e) => e.id === this.activeId && e.active);
  }

  private createEvent(elevations: ElevatedDomain[], now: number): void {
    this.idCounter++;
    const event: CompoundEvent = {
      id: `compound-${now}-${this.idCounter}`,
      elevatedDomains: elevations.map((e) => cloneElevated(e)),
      compoundSeverity: severityFromCount(elevations.length),
      domainCount: elevations.length,
      detectedAt: now,
      active: true,
      description: buildDescription(elevations),
    };
    this.events.push(event);
    while (this.events.length > this.maxEvents) this.events.shift();
    this.activeId = event.id;
    this.persist();
    this.emit(event);
  }

  private updateEvent(active: CompoundEvent, elevations: ElevatedDomain[]): void {
    active.elevatedDomains = elevations.map((e) => cloneElevated(e));
    active.domainCount = elevations.length;
    active.compoundSeverity = severityFromCount(elevations.length);
    active.description = buildDescription(elevations);
    this.persist();
    this.emit(active);
  }

  private resolveEvent(active: CompoundEvent, now: number): void {
    active.active = false;
    active.resolvedAt = now;
    this.activeId = null;
    this.persist();
    this.emit(active);
  }

  private emit(event: CompoundEvent): void {
    const snapshot = cloneEvent(event);
    for (const cb of this.subscribers) cb(snapshot);
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed && Array.isArray(parsed.events)) {
        for (const e of parsed.events) this.events.push(e);
        while (this.events.length > this.maxEvents) this.events.shift();
      }
      this.activeId = parsed?.activeId ?? null;
    } catch {
      this.events.length = 0;
      this.activeId = null;
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const serial: PersistedState = { events: this.events, activeId: this.activeId };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(serial));
    } catch {
      // non-fatal
    }
  }
}

// ── Lazy singleton ──────────────────────────────────────────────────

let singleton: CompoundEventDetectorService | undefined;

export function getCompoundEventDetectorService(): CompoundEventDetectorService {
  singleton ??= new CompoundEventDetectorService();
  return singleton;
}

export function resetForTests(): void {
  singleton = undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────

function severityFromCount(count: number): CompoundSeverity {
  if (count >= 5) return 'emergency';
  if (count >= 3) return 'warning';
  return 'watch';
}

function buildDescription(elevations: readonly ElevatedDomain[]): string {
  const names = elevations.map((e) => e.domain);
  return `${elevations.length}-domain compound event: ${names.join(' + ')}`;
}

function sameDomainSet(a: readonly ElevatedDomain[], b: readonly ElevatedDomain[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a.map((e) => e.domain));
  for (const eb of b) if (!setA.has(eb.domain)) return false;
  // Also detect when activeSituationCount or severity changed for matching domains
  const aByDomain = new Map(a.map((e) => [e.domain, e]));
  for (const eb of b) {
    const ea = aByDomain.get(eb.domain);
    if (!ea) return false;
    if (ea.activeSituationCount !== eb.activeSituationCount) return false;
    if (ea.highestSeverity !== eb.highestSeverity) return false;
  }
  return true;
}

function cloneElevated(e: ElevatedDomain): ElevatedDomain {
  return {
    domain: e.domain,
    activeSituationCount: e.activeSituationCount,
    highestSeverity: e.highestSeverity,
    situationIds: [...e.situationIds],
  };
}

function cloneEvent(e: CompoundEvent): CompoundEvent {
  return {
    ...e,
    elevatedDomains: e.elevatedDomains.map((d) => cloneElevated(d)),
  };
}

function defaultStorage(): StorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
  return ls ?? null;
}
