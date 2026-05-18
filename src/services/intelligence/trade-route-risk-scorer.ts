/**
 * Trade Route Risk Scorer — maintains risk scores for key global
 * maritime / land / air trade routes based on proximity to active
 * situations. When a HIGH or CRITICAL situation is detected near a
 * strategic chokepoint, that route's risk score rises.
 *
 *   impactScore = severityNum/4 * clamp(1 - distanceKm/radiusKm, 0, 1)
 *   riskScore   = max of the most recent 5 impactScores newer than 7d
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * route records to `wm-trade-routes` (one per route) and risk update
 * events to `wm-route-risk-updates` (LIFO ring buffer, max 1000).
 */

// ── Public types ──────────────────────────────────────────────────────

export type RouteType = 'maritime' | 'land' | 'air';

export type RiskLevel = 'minimal' | 'elevated' | 'high' | 'critical';

export interface TradeRoute {
  id: string;
  name: string;
  type: RouteType;
  lat: number;
  lon: number;
  radiusKm: number;
  annualTradeUsd: number;
  riskScore: number;
  riskLevel: RiskLevel;
  lastUpdatedAt: number;
  contributingFactors: string[];
}

export interface RouteRiskUpdate {
  id: string;
  routeId: string;
  situationId: string;
  domain: string;
  severity: string;
  distanceKm: number;
  impactScore: number;
  recordedAt: number;
}

export interface RouteRiskSummary {
  critical: TradeRoute[];
  high: TradeRoute[];
  /** Sum of annualTradeUsd for routes at riskLevel 'high' or 'critical'. */
  totalTradeAtRiskUsd: number;
}

export interface RouteFilter {
  type?: RouteType;
  riskLevel?: RiskLevel;
}

export type RouteRiskListener = (route: TradeRoute, update: RouteRiskUpdate) => void;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface TradeRouteRiskScorerOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const ROUTES_STORAGE_KEY = 'wm-trade-routes';
export const UPDATES_STORAGE_KEY = 'wm-route-risk-updates';
export const MAX_UPDATES = 1000;

export const ROLLING_WINDOW_SIZE = 5;
export const FACTOR_TTL_MS = 7 * 24 * 60 * 60_000;

export const SEVERITY_NUM: Record<string, number> = {
  low: 1, medium: 2, high: 3, critical: 4,
};

export const RISK_LEVEL_FLOORS: readonly { floor: number; level: RiskLevel }[] = [
  { floor: 0.75, level: 'critical' },
  { floor: 0.5, level: 'high' },
  { floor: 0.25, level: 'elevated' },
  { floor: 0, level: 'minimal' },
];

const RISK_LEVEL_RANK: Record<RiskLevel, number> = {
  minimal: 0, elevated: 1, high: 2, critical: 3,
};

// ── Seed catalog ──────────────────────────────────────────────────────

interface SeedRoute {
  id: string;
  name: string;
  type: RouteType;
  lat: number;
  lon: number;
  radiusKm: number;
  annualTradeUsd: number;
}

const SEED_ROUTES: readonly SeedRoute[] = [
  { id: 'suez-canal', name: 'Suez Canal', type: 'maritime', lat: 30.4, lon: 32.5, radiusKm: 50, annualTradeUsd: 1_000_000_000_000 },
  { id: 'strait-of-hormuz', name: 'Strait of Hormuz', type: 'maritime', lat: 26.5, lon: 56, radiusKm: 50, annualTradeUsd: 700_000_000_000 },
  { id: 'strait-of-malacca', name: 'Strait of Malacca', type: 'maritime', lat: 3, lon: 100.5, radiusKm: 100, annualTradeUsd: 3_400_000_000_000 },
  { id: 'south-china-sea', name: 'South China Sea', type: 'maritime', lat: 15, lon: 115, radiusKm: 500, annualTradeUsd: 3_400_000_000_000 },
  { id: 'panama-canal', name: 'Panama Canal', type: 'maritime', lat: 9, lon: -79.7, radiusKm: 30, annualTradeUsd: 270_000_000_000 },
  { id: 'bab-el-mandeb', name: 'Bab-el-Mandeb', type: 'maritime', lat: 12.6, lon: 43.3, radiusKm: 30, annualTradeUsd: 700_000_000_000 },
  { id: 'cape-of-good-hope', name: 'Cape of Good Hope', type: 'maritime', lat: -34.4, lon: 18.5, radiusKm: 100, annualTradeUsd: 500_000_000_000 },
  { id: 'turkish-straits', name: 'Turkish Straits', type: 'maritime', lat: 41, lon: 29, radiusKm: 30, annualTradeUsd: 100_000_000_000 },
  { id: 'dover-strait', name: 'Dover Strait', type: 'maritime', lat: 50.9, lon: 1.5, radiusKm: 30, annualTradeUsd: 600_000_000_000 },
  { id: 'trans-siberian-railway', name: 'Trans-Siberian Railway', type: 'land', lat: 55, lon: 80, radiusKm: 500, annualTradeUsd: 50_000_000_000 },
  { id: 'china-europe-rail-belt', name: 'China-Europe Rail Belt', type: 'land', lat: 45, lon: 70, radiusKm: 500, annualTradeUsd: 75_000_000_000 },
  { id: 'north-atlantic-air-corridor', name: 'North Atlantic Air Corridor', type: 'air', lat: 50, lon: -30, radiusKm: 1000, annualTradeUsd: 200_000_000_000 },
];

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

function cloneRoute(r: TradeRoute): TradeRoute {
  return { ...r, contributingFactors: [...r.contributingFactors] };
}

function cloneUpdate(u: RouteRiskUpdate): RouteRiskUpdate {
  return { ...u };
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function classifyRiskLevel(score: number): RiskLevel {
  for (const band of RISK_LEVEL_FLOORS) {
    if (score >= band.floor) return band.level;
  }
  return 'minimal';
}

export function computeImpactScore(severity: string, distanceKm: number, radiusKm: number): number {
  const severityNum = SEVERITY_NUM[severity.toLowerCase()] ?? 0;
  if (severityNum === 0) return 0;
  if (radiusKm <= 0) return 0;
  const proximityFactor = clamp01(1 - distanceKm / radiusKm);
  return Number(((severityNum / 4) * proximityFactor).toFixed(4));
}

// ── Service ───────────────────────────────────────────────────────────

interface FactorEntry {
  impactScore: number;
  description: string;
  recordedAt: number;
}

function describeUpdate(update: Pick<RouteRiskUpdate, 'domain' | 'severity' | 'distanceKm' | 'impactScore'>): string {
  return `${update.domain}/${update.severity} @ ${update.distanceKm.toFixed(0)}km (impact ${update.impactScore.toFixed(2)})`;
}

export class TradeRouteRiskScorerService {
  private routes = new Map<string, TradeRoute>();
  private factors = new Map<string, FactorEntry[]>();
  private updates: RouteRiskUpdate[] = [];
  private listeners = new Set<RouteRiskListener>();
  private storage: StorageLike | null;
  private clock: () => number;
  private hydrated = false;
  private idSeq = 0;

  constructor(options: TradeRouteRiskScorerOptions = {}) {
    this.storage = safeStorage(options.storage);
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Update / read ──────────────────────────────────────────────────

  updateRisk(
    routeId: string,
    situationId: string,
    domain: string,
    severity: string,
    distanceKm: number,
  ): RouteRiskUpdate | undefined {
    this.ensureHydrated();
    const route = this.routes.get(routeId);
    if (!route) return undefined;
    const now = this.clock();
    this.idSeq += 1;
    const impactScore = computeImpactScore(severity, distanceKm, route.radiusKm);
    const update: RouteRiskUpdate = {
      id: `trr-${now.toString(36)}-${this.idSeq}`,
      routeId, situationId, domain, severity,
      distanceKm: Number(distanceKm.toFixed(3)),
      impactScore,
      recordedAt: now,
    };
    const description = describeUpdate(update);
    this.appendFactor(routeId, { impactScore, description, recordedAt: now });
    const factors = this.recentFactors(routeId, now);
    route.riskScore = factors.length === 0
      ? 0
      : Number(Math.max(...factors.map((f) => f.impactScore)).toFixed(4));
    route.riskLevel = classifyRiskLevel(route.riskScore);
    route.lastUpdatedAt = now;
    route.contributingFactors = factors.map((f) => f.description);
    this.updates.push(update);
    if (this.updates.length > MAX_UPDATES) {
      this.updates.splice(0, this.updates.length - MAX_UPDATES);
    }
    this.persistRoutes();
    this.persistUpdates();
    const routeSnapshot = cloneRoute(route);
    const updateSnapshot = cloneUpdate(update);
    for (const l of this.listeners) {
      try { l(routeSnapshot, updateSnapshot); } catch { /* isolate */ }
    }
    return cloneUpdate(update);
  }

  getRisk(routeId: string): TradeRoute | undefined {
    this.ensureHydrated();
    const r = this.routes.get(routeId);
    return r ? cloneRoute(r) : undefined;
  }

  getAllRoutes(filter: RouteFilter = {}): TradeRoute[] {
    this.ensureHydrated();
    return [...this.routes.values()]
      .filter((r) => {
        if (filter.type && r.type !== filter.type) return false;
        if (filter.riskLevel && r.riskLevel !== filter.riskLevel) return false;
        return true;
      })
      .sort((a, b) => b.riskScore - a.riskScore)
      .map((r) => cloneRoute(r));
  }

  getSummary(): RouteRiskSummary {
    this.ensureHydrated();
    const critical: TradeRoute[] = [];
    const high: TradeRoute[] = [];
    let totalTradeAtRiskUsd = 0;
    for (const r of this.routes.values()) {
      if (r.riskLevel === 'critical') {
        critical.push(cloneRoute(r));
        totalTradeAtRiskUsd += r.annualTradeUsd;
      } else if (r.riskLevel === 'high') {
        high.push(cloneRoute(r));
        totalTradeAtRiskUsd += r.annualTradeUsd;
      }
    }
    critical.sort((a, b) => b.riskScore - a.riskScore);
    high.sort((a, b) => b.riskScore - a.riskScore);
    return { critical, high, totalTradeAtRiskUsd };
  }

  getUpdates(routeId?: string, limit?: number): RouteRiskUpdate[] {
    this.ensureHydrated();
    const matched = routeId === undefined
      ? this.updates
      : this.updates.filter((u) => u.routeId === routeId);
    const ordered: RouteRiskUpdate[] = [];
    for (let i = matched.length - 1; i >= 0; i -= 1) ordered.push(matched[i]!);
    const capped = typeof limit === 'number' ? ordered.slice(0, Math.max(0, limit)) : ordered;
    return capped.map((u) => cloneUpdate(u));
  }

  subscribe(listener: RouteRiskListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  unsubscribe(listener: RouteRiskListener): void {
    this.listeners.delete(listener);
  }

  /** Test seam — clears state and re-seeds the catalog. */
  resetForTesting(): void {
    this.routes.clear();
    this.factors.clear();
    this.updates = [];
    this.listeners.clear();
    this.idSeq = 0;
    this.hydrated = true;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(ROUTES_STORAGE_KEY); } catch { /* ignore */ }
      try { this.storage.removeItem(UPDATES_STORAGE_KEY); } catch { /* ignore */ }
    }
    this.seedDefaultRoutes();
  }

  // ── Internal ───────────────────────────────────────────────────────

  private appendFactor(routeId: string, entry: FactorEntry): void {
    const list = this.factors.get(routeId) ?? [];
    list.push(entry);
    this.factors.set(routeId, list);
  }

  private recentFactors(routeId: string, now: number): FactorEntry[] {
    const cutoff = now - FACTOR_TTL_MS;
    const list = this.factors.get(routeId) ?? [];
    const fresh = list.filter((f) => f.recordedAt >= cutoff);
    const trimmed = fresh.slice(-ROLLING_WINDOW_SIZE);
    this.factors.set(routeId, trimmed);
    return trimmed;
  }

  private seedDefaultRoutes(): void {
    const now = this.clock();
    for (const seed of SEED_ROUTES) {
      if (this.routes.has(seed.id)) continue;
      this.routes.set(seed.id, {
        id: seed.id, name: seed.name, type: seed.type,
        lat: seed.lat, lon: seed.lon, radiusKm: seed.radiusKm,
        annualTradeUsd: seed.annualTradeUsd,
        riskScore: 0, riskLevel: 'minimal',
        lastUpdatedAt: now,
        contributingFactors: [],
      });
    }
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    this.seedDefaultRoutes();
    if (!this.storage) return;
    this.hydrateRoutes();
    this.hydrateUpdates();
    this.rebuildFactorsFromUpdates();
  }

  private hydrateRoutes(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(ROUTES_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: TradeRoute[] | null;
    try { parsed = JSON.parse(raw) as TradeRoute[] | null; }
    catch { return; }
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (!entry || typeof entry.id !== 'string') continue;
      // Re-classify the level so a future threshold change doesn't
      // leave stale tier strings frozen in localStorage.
      const riskLevel = classifyRiskLevel(entry.riskScore);
      this.routes.set(entry.id, { ...entry, riskLevel, contributingFactors: [...entry.contributingFactors] });
    }
  }

  private hydrateUpdates(): void {
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(UPDATES_STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: RouteRiskUpdate[] | null;
    try { parsed = JSON.parse(raw) as RouteRiskUpdate[] | null; }
    catch { return; }
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (entry && typeof entry.id === 'string') this.updates.push({ ...entry });
    }
  }

  private rebuildFactorsFromUpdates(): void {
    // After hydrate, re-derive the in-memory rolling-window from the
    // persisted update log so future updateRisk calls see the right
    // recent history.
    for (const u of this.updates) {
      this.appendFactor(u.routeId, {
        impactScore: u.impactScore,
        description: describeUpdate(u),
        recordedAt: u.recordedAt,
      });
    }
  }

  private persistRoutes(): void {
    if (!this.storage) return;
    const payload = [...this.routes.values()];
    try {
      this.storage.setItem(ROUTES_STORAGE_KEY, JSON.stringify(payload));
    } catch { /* best effort */ }
  }

  private persistUpdates(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(UPDATES_STORAGE_KEY, JSON.stringify(this.updates));
    } catch { /* best effort */ }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: TradeRouteRiskScorerService | null = null;

export function getTradeRouteRiskScorerService(): TradeRouteRiskScorerService {
  _singleton ??= new TradeRouteRiskScorerService();
  return _singleton;
}

export function __resetTradeRouteRiskScorerServiceSingleton(): void {
  _singleton = null;
}

export const __internals = {
  SEED_ROUTES,
  SEVERITY_NUM,
  RISK_LEVEL_FLOORS,
  RISK_LEVEL_RANK,
  ROLLING_WINDOW_SIZE,
  FACTOR_TTL_MS,
  MAX_UPDATES,
  describeUpdate,
};
