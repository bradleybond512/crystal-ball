/**
 * Collection Gap Discovery (Phase 4).
 *
 * Systematic audit of which domains have weak observability:
 * stale feeds, sparse coverage, low confidence, geographic blind
 * spots, temporal gaps, single-source brittleness.
 *
 * `scan(observations)` runs all six detectors and returns an
 * `ObservabilityReport` — the live gaps are persisted to
 * `localStorage 'wm-collection-gaps'` so operators see the same
 * audit on reload.
 *
 * Pure module — no DOM / fetch / globals at import time.
 */

import type { ObservationEvent, ObservationSeverity } from './observation-adapters';

// ── Public types ──────────────────────────────────────────────────────

export type GapType =
  | 'stale-feed'
  | 'sparse-coverage'
  | 'missing-source'
  | 'low-confidence'
  | 'geographic-blind-spot'
  | 'temporal-gap';

export type GapSeverity = 'minor' | 'moderate' | 'critical';
export type GapStatus = 'open' | 'acknowledged' | 'resolved';

export interface ObservabilityGap {
  id: string;
  domain: string;
  gapType: GapType;
  severity: GapSeverity;
  description: string;
  affectedRegions: string[];
  lastObservationAt: number | null;
  recommendedAction: string;
  discoveredAt: number;
  status: GapStatus;
}

export interface ObservabilityReport {
  scannedAt: number;
  totalGaps: number;
  criticalCount: number;
  byDomain: Record<string, number>;
  /** 0-100. Percentage of expected domains with NO critical gap. */
  overallCoverage: number;
  worstDomain: string | null;
  gaps: ObservabilityGap[];
}

export type GapListener = (report: ObservabilityReport) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-collection-gaps';
const MAX_GAPS = 500;

const STALE_CRITICAL_MS = 6 * 60 * 60 * 1000;
const STALE_MODERATE_MS = 2 * 60 * 60 * 1000;
const STALE_MINOR_MS = 30 * 60 * 1000;

const SPARSE_WINDOW_MS = 24 * 60 * 60 * 1000;
const SPARSE_MODERATE_MAX = 3;
const SPARSE_CRITICAL_MAX = 1;

const LOW_CONFIDENCE_CRITICAL = 0.4;
const LOW_CONFIDENCE_MODERATE = 0.6;

const BLIND_SPOT_WINDOW_MS = 12 * 60 * 60 * 1000;

const TEMPORAL_GAP_THRESHOLD_MS = 4 * 60 * 60 * 1000;
const CONTINUOUS_COVERAGE_DOMAINS: ReadonlySet<string> = new Set([
  'biosurveillance',
  'health',
  'earthquake',
  'seismic',
  'weather',
]);

/** Canonical domain list used as the "expected" denominator for the
 *  overall-coverage score. Update when new domains come online. */
const TRACKED_DOMAINS: readonly string[] = [
  'weather', 'earthquake', 'cyber', 'maritime', 'aviation',
  'biosurveillance', 'space', 'conflict', 'infra', 'finance',
];

const HIGH_RISK_DOMAINS: ReadonlySet<string> = new Set([
  'weather', 'earthquake', 'biosurveillance', 'cyber', 'conflict',
]);

interface MajorRegion {
  name: string;
  /** Inclusive lat range [low, high]. */
  latRange: [number, number];
  /** Inclusive lon range [low, high]. Handles the antimeridian for
   *  Asia-Pacific by accepting an array of two segments. */
  lonRanges: [number, number][];
}

const MAJOR_REGIONS: readonly MajorRegion[] = [
  { name: 'Asia-Pacific', latRange: [-50, 60], lonRanges: [[60, 180], [-180, -130]] },
  { name: 'Europe',       latRange: [35, 72],  lonRanges: [[-25, 60]] },
  { name: 'Americas',     latRange: [-60, 75], lonRanges: [[-170, -30]] },
  { name: 'Africa',       latRange: [-35, 38], lonRanges: [[-20, 55]] },
  { name: 'Middle-East',  latRange: [12, 42],  lonRanges: [[25, 65]] },
];

const SEVERITY_WEIGHT: Record<ObservationSeverity, number> = {
  CRITICAL: 1,
  HIGH: 0.8,
  MEDIUM: 0.6,
  LOW: 0.4,
  INFO: 0.2,
};

// ── Helpers ──────────────────────────────────────────────────────────

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

function inRegion(lat: number, lon: number, region: MajorRegion): boolean {
  if (lat < region.latRange[0] || lat > region.latRange[1]) return false;
  for (const [lo, hi] of region.lonRanges) {
    if (lon >= lo && lon <= hi) return true;
  }
  return false;
}

function severityToConfidence(severity: ObservationSeverity | undefined): number {
  if (!severity) return 0.5;
  return SEVERITY_WEIGHT[severity] ?? 0.5;
}

function recommendationFor(gapType: GapType, severity: GapSeverity): string {
  switch (gapType) {
    case 'stale-feed': {
      return severity === 'critical'
        ? 'Investigate provider outage immediately; enable fallback source if available.'
        : 'Verify the upstream provider is still publishing; check API key and rate-limit status.';
    }
    case 'sparse-coverage': {
      return severity === 'critical'
        ? 'Domain has no fresh signal — verify ingestion is wired correctly and providers are online.'
        : 'Coverage is below normal — confirm the providers are operational and consider adding a backup source.';
    }
    case 'missing-source': {
      return 'Add at least one redundant source so a single provider outage doesn\'t blind the domain.';
    }
    case 'low-confidence': {
      return severity === 'critical'
        ? 'Low-confidence inputs dominate — review provider quality + consider tightening severity calibration.'
        : 'Several recent observations are low-confidence; verify upstream data quality.';
    }
    case 'geographic-blind-spot': {
      return 'No recent observations from this region — add geographic coverage or verify regional providers.';
    }
    case 'temporal-gap': {
      return 'Continuous-coverage domain has a multi-hour gap; verify the polling loop is alive.';
    }
  }
}

function describeStale(domain: string, ageMs: number): string {
  const hours = (ageMs / (60 * 60 * 1000)).toFixed(1);
  return `${domain}: no observation in the last ${hours}h.`;
}

function describeSparse(domain: string, count: number): string {
  return `${domain}: only ${count} observation${count === 1 ? '' : 's'} in the last 24h.`;
}

function describeMissingSource(domain: string, sourceId: string): string {
  return `${domain}: every recent observation comes from "${sourceId}" — single-point-of-failure.`;
}

function describeLowConfidence(domain: string, avg: number): string {
  return `${domain}: average observation confidence ${(avg * 100).toFixed(0)}% (severity-weighted).`;
}

function describeBlindSpot(region: string): string {
  return `Region "${region}" has no high-risk-domain observations in the last 12h.`;
}

function describeTemporalGap(domain: string, ageMs: number): string {
  const hours = (ageMs / (60 * 60 * 1000)).toFixed(1);
  return `${domain}: ${hours}h gap detected in a continuous-coverage domain.`;
}

// ── Detectors ────────────────────────────────────────────────────────

interface DetectorContext {
  now: number;
  byDomain: Map<string, ObservationEvent[]>;
}

function staleSeverity(age: number): GapSeverity {
  if (age >= STALE_CRITICAL_MS) return 'critical';
  if (age >= STALE_MODERATE_MS) return 'moderate';
  return 'minor';
}

function detectStaleFeeds(ctx: DetectorContext, nextId: () => string): ObservabilityGap[] {
  const gaps: ObservabilityGap[] = [];
  for (const [domain, observations] of ctx.byDomain) {
    if (observations.length === 0) continue;
    const newest = observations.reduce((m, o) => Math.max(m, o.timestamp), 0);
    const age = ctx.now - newest;
    if (age < STALE_MINOR_MS) continue;
    const severity = staleSeverity(age);
    gaps.push(makeGap(nextId(), domain, 'stale-feed', severity,
      describeStale(domain, age), [], newest, ctx.now));
  }
  return gaps;
}

function detectSparseCoverage(ctx: DetectorContext, nextId: () => string): ObservabilityGap[] {
  const gaps: ObservabilityGap[] = [];
  const cutoff = ctx.now - SPARSE_WINDOW_MS;
  for (const domain of TRACKED_DOMAINS) {
    const recent = (ctx.byDomain.get(domain) ?? []).filter((o) => o.timestamp >= cutoff);
    if (recent.length >= SPARSE_MODERATE_MAX) continue;
    const severity: GapSeverity = recent.length < SPARSE_CRITICAL_MAX ? 'critical' : 'moderate';
    const newest = recent.reduce((m, o) => Math.max(m, o.timestamp), 0);
    gaps.push(makeGap(nextId(), domain, 'sparse-coverage', severity,
      describeSparse(domain, recent.length), [], recent.length === 0 ? null : newest, ctx.now));
  }
  return gaps;
}

function detectLowConfidence(ctx: DetectorContext, nextId: () => string): ObservabilityGap[] {
  const gaps: ObservabilityGap[] = [];
  for (const [domain, observations] of ctx.byDomain) {
    if (observations.length === 0) continue;
    const total = observations.reduce((s, o) => s + severityToConfidence(o.severity), 0);
    const avg = total / observations.length;
    if (avg >= LOW_CONFIDENCE_MODERATE) continue;
    const severity: GapSeverity = avg < LOW_CONFIDENCE_CRITICAL ? 'critical' : 'moderate';
    const newest = observations.reduce((m, o) => Math.max(m, o.timestamp), 0);
    gaps.push(makeGap(nextId(), domain, 'low-confidence', severity,
      describeLowConfidence(domain, avg), [], newest, ctx.now));
  }
  return gaps;
}

function detectGeographicBlindSpots(
  observations: readonly ObservationEvent[],
  ctx: DetectorContext,
  nextId: () => string,
): ObservabilityGap[] {
  const cutoff = ctx.now - BLIND_SPOT_WINDOW_MS;
  const highRiskRecent = observations.filter((o) =>
    o.timestamp >= cutoff && HIGH_RISK_DOMAINS.has(o.domain) && !!o.location);
  const covered = new Set<string>();
  for (const obs of highRiskRecent) {
    const loc = obs.location!;
    for (const region of MAJOR_REGIONS) {
      if (inRegion(loc.lat, loc.lon, region)) covered.add(region.name);
    }
  }
  const gaps: ObservabilityGap[] = [];
  for (const region of MAJOR_REGIONS) {
    if (covered.has(region.name)) continue;
    gaps.push(makeGap(
      nextId(),
      'global',
      'geographic-blind-spot',
      'critical',
      describeBlindSpot(region.name),
      [region.name],
      null,
      ctx.now,
    ));
  }
  return gaps;
}

function detectTemporalGaps(ctx: DetectorContext, nextId: () => string): ObservabilityGap[] {
  const gaps: ObservabilityGap[] = [];
  for (const [domain, observations] of ctx.byDomain) {
    if (!CONTINUOUS_COVERAGE_DOMAINS.has(domain)) continue;
    if (observations.length < 2) continue;
    const sorted = [...observations].sort((a, b) => a.timestamp - b.timestamp);
    let worstGap = 0;
    let gapEndAt = 0;
    for (let i = 1; i < sorted.length; i += 1) {
      const delta = sorted[i]!.timestamp - sorted[i - 1]!.timestamp;
      if (delta > worstGap) {
        worstGap = delta;
        gapEndAt = sorted[i]!.timestamp;
      }
    }
    if (worstGap < TEMPORAL_GAP_THRESHOLD_MS) continue;
    gaps.push(makeGap(
      nextId(),
      domain,
      'temporal-gap',
      'moderate',
      describeTemporalGap(domain, worstGap),
      [],
      gapEndAt,
      ctx.now,
    ));
  }
  return gaps;
}

function detectMissingSource(ctx: DetectorContext, nextId: () => string): ObservabilityGap[] {
  const gaps: ObservabilityGap[] = [];
  for (const [domain, observations] of ctx.byDomain) {
    if (observations.length === 0) continue;
    const sources = new Set(observations.map((o) => o.sourceId));
    if (sources.size > 1) continue;
    const onlySource = [...sources][0]!;
    const newest = observations.reduce((m, o) => Math.max(m, o.timestamp), 0);
    gaps.push(makeGap(
      nextId(),
      domain,
      'missing-source',
      'moderate',
      describeMissingSource(domain, onlySource),
      [],
      newest,
      ctx.now,
    ));
  }
  return gaps;
}

function makeGap(
  id: string,
  domain: string,
  gapType: GapType,
  severity: GapSeverity,
  description: string,
  affectedRegions: string[],
  lastObservationAt: number | null,
  discoveredAt: number,
): ObservabilityGap {
  return {
    id,
    domain,
    gapType,
    severity,
    description,
    affectedRegions,
    lastObservationAt,
    recommendedAction: recommendationFor(gapType, severity),
    discoveredAt,
    status: 'open',
  };
}

function groupByDomain(observations: readonly ObservationEvent[]): Map<string, ObservationEvent[]> {
  const out = new Map<string, ObservationEvent[]>();
  for (const obs of observations) {
    const bucket = out.get(obs.domain);
    if (bucket) bucket.push(obs);
    else out.set(obs.domain, [obs]);
  }
  return out;
}

// ── Service ──────────────────────────────────────────────────────────

export interface CollectionGapDiscoveryOptions {
  clock?: () => number;
  /** Override the tracked-domain denominator. Defaults to the
   *  10 canonical Crystal Ball domains. */
  trackedDomains?: readonly string[];
}

export class CollectionGapDiscoveryService {
  private gaps = new Map<string, ObservabilityGap>();
  private insertionOrder: string[] = [];
  private latestReport: ObservabilityReport | undefined;
  private listeners = new Set<GapListener>();
  private clock: () => number;
  private trackedDomains: readonly string[];
  private hydrated = false;
  private idSeq = 0;

  constructor(options: CollectionGapDiscoveryOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.trackedDomains = options.trackedDomains ?? TRACKED_DOMAINS;
  }

  // ── Public API ──────────────────────────────────────────────────

  scan(observations: readonly ObservationEvent[]): ObservabilityReport {
    this.ensureHydrated();
    const now = this.clock();
    const ctx: DetectorContext = {
      now,
      byDomain: groupByDomain(observations),
    };
    const idFactory = (): string => this.nextId(now);
    const fresh = [
      ...detectStaleFeeds(ctx, idFactory),
      ...detectSparseCoverage(ctx, idFactory),
      ...detectLowConfidence(ctx, idFactory),
      ...detectGeographicBlindSpots(observations, ctx, idFactory),
      ...detectTemporalGaps(ctx, idFactory),
      ...detectMissingSource(ctx, idFactory),
    ];
    for (const gap of fresh) this.storeGap(gap);
    const report = this.buildReport(now, fresh);
    this.latestReport = report;
    this.persist();
    this.notify(report);
    return cloneReport(report);
  }

  acknowledge(gapId: string): ObservabilityGap | undefined {
    return this.transition(gapId, (g) => {
      if (g.status === 'resolved') return false;
      g.status = 'acknowledged';
      return true;
    });
  }

  resolve(gapId: string): ObservabilityGap | undefined {
    return this.transition(gapId, (g) => {
      if (g.status === 'resolved') return false;
      g.status = 'resolved';
      return true;
    });
  }

  getOpen(): ObservabilityGap[] {
    this.ensureHydrated();
    return this.insertionOrder
      .map((id) => this.gaps.get(id))
      .filter((g): g is ObservabilityGap => g !== undefined && g.status !== 'resolved')
      .map((g) => ({ ...g, affectedRegions: [...g.affectedRegions] }));
  }

  getAll(): ObservabilityGap[] {
    this.ensureHydrated();
    return this.insertionOrder
      .map((id) => this.gaps.get(id))
      .filter((g): g is ObservabilityGap => g !== undefined)
      .map((g) => ({ ...g, affectedRegions: [...g.affectedRegions] }));
  }

  getLatestReport(): ObservabilityReport | undefined {
    this.ensureHydrated();
    return this.latestReport ? cloneReport(this.latestReport) : undefined;
  }

  subscribe(listener: GapListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  resetForTesting(): void {
    this.gaps.clear();
    this.insertionOrder = [];
    this.latestReport = undefined;
    this.listeners.clear();
    this.idSeq = 0;
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ─────────────────────────────────────────────────────

  private transition(
    gapId: string,
    apply: (g: ObservabilityGap) => boolean,
  ): ObservabilityGap | undefined {
    this.ensureHydrated();
    const current = this.gaps.get(gapId);
    if (!current) return undefined;
    if (!apply(current)) return { ...current };
    this.gaps.set(gapId, current);
    this.persist();
    if (this.latestReport) this.notify(this.latestReport);
    return { ...current };
  }

  private storeGap(gap: ObservabilityGap): void {
    const existing = this.gaps.has(gap.id);
    this.gaps.set(gap.id, gap);
    if (!existing) {
      this.insertionOrder.push(gap.id);
      this.enforceCapacity();
    }
  }

  private enforceCapacity(): void {
    while (this.insertionOrder.length > MAX_GAPS) {
      const oldest = this.insertionOrder.shift();
      if (oldest !== undefined) this.gaps.delete(oldest);
    }
  }

  private buildReport(now: number, freshGaps: readonly ObservabilityGap[]): ObservabilityReport {
    const byDomain: Record<string, number> = {};
    let critical = 0;
    const criticalByDomain = new Set<string>();
    for (const gap of freshGaps) {
      byDomain[gap.domain] = (byDomain[gap.domain] ?? 0) + 1;
      if (gap.severity === 'critical') {
        critical += 1;
        criticalByDomain.add(gap.domain);
      }
    }
    const totalTracked = this.trackedDomains.length;
    const cleanDomains = this.trackedDomains.filter((d) => !criticalByDomain.has(d)).length;
    const overallCoverage = totalTracked === 0 ? 100 : Math.round((cleanDomains / totalTracked) * 100);
    let worstDomain: string | null = null;
    let worstCount = 0;
    for (const [domain, count] of Object.entries(byDomain)) {
      if (count > worstCount) {
        worstCount = count;
        worstDomain = domain;
      }
    }
    return {
      scannedAt: now,
      totalGaps: freshGaps.length,
      criticalCount: critical,
      byDomain,
      overallCoverage,
      worstDomain,
      gaps: freshGaps.map((g) => ({ ...g, affectedRegions: [...g.affectedRegions] })),
    };
  }

  private notify(report: ObservabilityReport): void {
    const snapshot = cloneReport(report);
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* isolate */ }
    }
  }

  private nextId(now: number): string {
    this.idSeq += 1;
    return `gap-${now.toString(36)}-${this.idSeq}`;
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const store = safeStorage();
    if (!store) return;
    let raw: string | null = null;
    try { raw = store.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { gaps?: ObservabilityGap[]; latestReport?: ObservabilityReport } | null;
      if (!parsed) return;
      for (const g of parsed.gaps ?? []) {
        if (!g || typeof g.id !== 'string') continue;
        this.gaps.set(g.id, { ...g, affectedRegions: [...(g.affectedRegions ?? [])] });
        this.insertionOrder.push(g.id);
      }
      if (parsed.latestReport && typeof parsed.latestReport.scannedAt === 'number') {
        this.latestReport = parsed.latestReport;
      }
    } catch {
      // corrupt — leave defaults
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    const payload = {
      gaps: this.insertionOrder
        .map((id) => this.gaps.get(id))
        .filter((g): g is ObservabilityGap => g !== undefined),
      latestReport: this.latestReport,
    };
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // best effort
    }
  }
}

function cloneReport(r: ObservabilityReport): ObservabilityReport {
  return {
    ...r,
    byDomain: { ...r.byDomain },
    gaps: r.gaps.map((g) => ({ ...g, affectedRegions: [...g.affectedRegions] })),
  };
}

// ── Singleton ────────────────────────────────────────────────────────

let _singleton: CollectionGapDiscoveryService | null = null;

export function getCollectionGapDiscoveryService(): CollectionGapDiscoveryService {
  _singleton ??= new CollectionGapDiscoveryService();
  return _singleton;
}

export function __resetCollectionGapDiscoverySingleton(): void {
  _singleton = null;
}

export const __internals = {
  TRACKED_DOMAINS,
  HIGH_RISK_DOMAINS,
  MAJOR_REGIONS,
  CONTINUOUS_COVERAGE_DOMAINS,
  STALE_CRITICAL_MS,
  STALE_MODERATE_MS,
  STALE_MINOR_MS,
  SPARSE_WINDOW_MS,
  SPARSE_MODERATE_MAX,
  SPARSE_CRITICAL_MAX,
  LOW_CONFIDENCE_CRITICAL,
  LOW_CONFIDENCE_MODERATE,
  BLIND_SPOT_WINDOW_MS,
  TEMPORAL_GAP_THRESHOLD_MS,
  MAX_GAPS,
  inRegion,
  severityToConfidence,
};
