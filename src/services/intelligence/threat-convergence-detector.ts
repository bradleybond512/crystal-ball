/**
 * Threat Convergence Detector — watches elevations across multiple
 * domain feeds simultaneously and fires a "perfect storm" alert when
 * three or more domains elevate within a short time window.
 *
 * The detector is purely additive over `recordElevation()` calls; it
 * does not infer elevations from raw observations on its own. Wire
 * the upstream domains' "I am elevated" signal into the detector and
 * call `detect()` whenever you want a snapshot of the current
 * convergence picture.
 *
 *   score = (matchingDomains / totalDomains) * (avgSeverity / 4)
 *   label:
 *     score > 0.7  → CRITICAL CONVERGENCE
 *     score > 0.4  → THREAT CONVERGENCE
 *     otherwise    → ELEVATED CONVERGENCE
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * the elevation ring + event ring to `wm-threat-convergence`
 * (capped at MAX_ELEVATIONS + MAX_EVENTS).
 */

// ── Public types ──────────────────────────────────────────────────────

export interface DomainElevation {
  domain: string;
  severity: number;
  timestamp: number;
}

export interface ConvergenceEvent {
  id: string;
  detectedAt: number;
  domains: string[];
  minSeverity: number;
  windowMs: number;
  /** 0-1; see formula in the module docstring. */
  score: number;
  label: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface ThreatConvergenceDetectorOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-threat-convergence';
export const MAX_ELEVATIONS = 500;
export const MAX_EVENTS = 200;

export const DEFAULT_WINDOW_MS = 60 * 60_000;
export const DEFAULT_MIN_SEVERITY = 2;
export const DEFAULT_MIN_DOMAINS = 3;

export const CRITICAL_FLOOR = 0.7;
export const THREAT_FLOOR = 0.4;

// ── Helpers ───────────────────────────────────────────────────────────

function safeStorage(injected?: StorageLike | null): StorageLike | null {
  if (injected !== undefined) return injected;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function cloneElevation(e: DomainElevation): DomainElevation {
  return { ...e };
}

function cloneEvent(e: ConvergenceEvent): ConvergenceEvent {
  return { ...e, domains: [...e.domains] };
}

export function labelForScore(score: number): string {
  if (score > CRITICAL_FLOOR) return 'CRITICAL CONVERGENCE';
  if (score > THREAT_FLOOR) return 'THREAT CONVERGENCE';
  return 'ELEVATED CONVERGENCE';
}

interface PersistShape {
  elevations: DomainElevation[];
  events: ConvergenceEvent[];
}

function isValidElevation(entry: unknown): entry is DomainElevation {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Partial<DomainElevation>;
  return typeof e.domain === 'string'
    && typeof e.severity === 'number'
    && typeof e.timestamp === 'number';
}

function isValidEvent(entry: unknown): entry is ConvergenceEvent {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Partial<ConvergenceEvent>;
  return typeof e.id === 'string' && Array.isArray(e.domains);
}

function readPersistedBlob(storage: StorageLike): PersistShape | null {
  let raw: string | null = null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return null; }
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Partial<PersistShape>;
  const elevations = Array.isArray(obj.elevations)
    ? obj.elevations
        .filter((entry): entry is DomainElevation => isValidElevation(entry))
        .map((entry) => ({ ...entry }))
    : [];
  const events = Array.isArray(obj.events)
    ? obj.events
        .filter((entry): entry is ConvergenceEvent => isValidEvent(entry))
        .map((entry) => ({ ...entry, domains: [...entry.domains] }))
    : [];
  return { elevations, events };
}

// ── Service ───────────────────────────────────────────────────────────

export class ThreatConvergenceDetector {
  private static _singleton: ThreatConvergenceDetector | null = null;

  private elevations: DomainElevation[] = [];
  private events: ConvergenceEvent[] = [];
  private storage: StorageLike | null;
  private clock: () => number;
  private hydrated = false;
  private idSeq = 0;

  constructor(options: ThreatConvergenceDetectorOptions = {}) {
    this.storage = safeStorage(options.storage);
    this.clock = options.clock ?? (() => Date.now());
  }

  static getInstance(): ThreatConvergenceDetector {
    ThreatConvergenceDetector._singleton ??= new ThreatConvergenceDetector();
    return ThreatConvergenceDetector._singleton;
  }

  static _resetForTests(): void {
    ThreatConvergenceDetector._singleton = null;
  }

  // ── Recording ──────────────────────────────────────────────────────

  recordElevation(domain: string, severity: number, timestamp?: number): DomainElevation {
    this.ensureHydrated();
    const elevation: DomainElevation = {
      domain,
      severity,
      timestamp: typeof timestamp === 'number' ? timestamp : this.clock(),
    };
    this.elevations.push(elevation);
    if (this.elevations.length > MAX_ELEVATIONS) {
      this.elevations.splice(0, this.elevations.length - MAX_ELEVATIONS);
    }
    this.persist();
    return cloneElevation(elevation);
  }

  // ── Detection ──────────────────────────────────────────────────────

  detect(
    windowMs: number = DEFAULT_WINDOW_MS,
    minSeverity: number = DEFAULT_MIN_SEVERITY,
    minDomains: number = DEFAULT_MIN_DOMAINS,
  ): ConvergenceEvent | null {
    this.ensureHydrated();
    const now = this.clock();
    const cutoff = now - windowMs;
    // Group elevations within the window by domain, keeping the
    // strongest severity seen per domain.
    const bestByDomain = new Map<string, number>();
    for (const e of this.elevations) {
      if (e.timestamp < cutoff) continue;
      if (e.severity < minSeverity) continue;
      const prior = bestByDomain.get(e.domain);
      if (prior === undefined || e.severity > prior) {
        bestByDomain.set(e.domain, e.severity);
      }
    }
    if (bestByDomain.size < minDomains) return null;
    const matchingDomains = [...bestByDomain.keys()].sort((a, b) => a.localeCompare(b));
    const severities = [...bestByDomain.values()];
    const avgSeverity = severities.reduce((acc, s) => acc + s, 0) / severities.length;
    const totalDomains = this.uniqueDomainCount();
    const denom = Math.max(totalDomains, matchingDomains.length);
    const ratio = matchingDomains.length / denom;
    const score = Number((ratio * (avgSeverity / 4)).toFixed(4));
    this.idSeq += 1;
    const event: ConvergenceEvent = {
      id: `tcd-${now.toString(36)}-${this.idSeq}`,
      detectedAt: now,
      domains: matchingDomains,
      minSeverity,
      windowMs,
      score,
      label: labelForScore(score),
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
    this.persist();
    return cloneEvent(event);
  }

  // ── Reads ──────────────────────────────────────────────────────────

  getHistory(limit?: number): ConvergenceEvent[] {
    this.ensureHydrated();
    // Newest first.
    const ordered: ConvergenceEvent[] = [];
    for (let i = this.events.length - 1; i >= 0; i -= 1) ordered.push(this.events[i]!);
    const capped = typeof limit === 'number' ? ordered.slice(0, Math.max(0, limit)) : ordered;
    return capped.map((e) => cloneEvent(e));
  }

  getElevations(): DomainElevation[] {
    this.ensureHydrated();
    return this.elevations.map((e) => cloneElevation(e));
  }

  /** Test seam — clears state + persisted blob. */
  resetForTesting(): void {
    this.elevations = [];
    this.events = [];
    this.idSeq = 0;
    this.hydrated = true;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  private uniqueDomainCount(): number {
    const set = new Set<string>();
    for (const e of this.elevations) set.add(e.domain);
    return set.size;
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.storage) return;
    const parsed = readPersistedBlob(this.storage);
    if (!parsed) return;
    for (const entry of parsed.elevations) this.elevations.push(entry);
    for (const entry of parsed.events) this.events.push(entry);
  }

  private persist(): void {
    if (!this.storage) return;
    const payload: PersistShape = {
      elevations: this.elevations,
      events: this.events,
    };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { /* best effort */ }
  }
}

// ── Convenience accessor ──────────────────────────────────────────────

export function getThreatConvergenceDetector(): ThreatConvergenceDetector {
  return ThreatConvergenceDetector.getInstance();
}

export const __internals = {
  CRITICAL_FLOOR,
  THREAT_FLOOR,
  DEFAULT_WINDOW_MS,
  DEFAULT_MIN_SEVERITY,
  DEFAULT_MIN_DOMAINS,
  MAX_ELEVATIONS,
  MAX_EVENTS,
  labelForScore,
};
