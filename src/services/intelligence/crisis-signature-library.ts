/**
 * Crisis Signature Library — fingerprints recurring crisis patterns
 * to enable early detection.
 *
 * Each known signature carries a list of feature predicates that
 * historical crises of that shape exhibited (e.g. "domain X elevated
 * past threshold Y", "entity Z spiking in N observations", "geo
 * cluster of >= N observations within R km", "rapid time-clustering
 * of >= N observations in a tight window"). At call time, the
 * library scores every signature against the incoming observation
 * window; matches with score >= 0.4 are returned ranked highest
 * first.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Custom
 * (operator-defined) signatures persist to localStorage at
 * `wm-crisis-signature-library` (the deliberately-distinct key
 * avoids stomping the older `crisis-signature.ts` module's match
 * ledger). Capped at 100 entries.
 */

import type { ObservationEvent, ObservationSeverity } from '@/types/intelligence';

// ── Public types ──────────────────────────────────────────────────────

export type SignatureFeatureType =
  | 'domain-elevation'
  | 'entity-spike'
  | 'geo-cluster'
  | 'time-pattern';

export interface SignatureFeature {
  featureType: SignatureFeatureType;
  weight: number;
  params: Record<string, unknown>;
}

export interface CrisisSignature {
  id: string;
  name: string;
  domain: string;
  fingerprint: SignatureFeature[];
  historicalExamples: string[];
  avgLeadTimeHours: number;
  /** 0-1 prior confidence that the signature, when matched, is a
   *  genuine early indicator rather than coincidence. */
  confidence: number;
}

export interface SignatureMatch {
  signature: CrisisSignature;
  /** Sum of matched-feature weights / total signature weight, in [0, 1]. */
  score: number;
  matchedFeatures: SignatureFeature[];
  /** Estimated hours of lead time before the full crisis manifests.
   *  Higher score → less lead time (we're closer to onset). */
  leadTimeEstimateHours: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface CrisisSignatureLibraryOptions {
  storage?: StorageLike | null;
  clock?: () => number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-crisis-signature-library';
export const MAX_CUSTOM_SIGNATURES = 100;
export const MATCH_THRESHOLD = 0.4;

const SEVERITY_RANK: Record<ObservationSeverity, number> = {
  INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};

const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;

// ── Built-in signatures ──────────────────────────────────────────────

function feature(
  type: SignatureFeatureType,
  weight: number,
  params: Record<string, unknown>,
): SignatureFeature {
  return { featureType: type, weight, params };
}

const BUILT_IN_SIGNATURES: readonly CrisisSignature[] = [
  {
    id: 'builtin-financial-contagion',
    name: 'Financial contagion',
    domain: 'finance',
    fingerprint: [
      feature('domain-elevation', 0.4, { domain: 'finance', minCount: 5, minSeverity: 'HIGH' }),
      feature('time-pattern', 0.3, { windowMinutes: 240, minCount: 4 }),
      feature('entity-spike', 0.3, { minCount: 3 }),
    ],
    historicalExamples: ['2008 GFC', '2010 European debt crisis', '2023 SVB collapse'],
    avgLeadTimeHours: 48,
    confidence: 0.7,
  },
  {
    id: 'builtin-pandemic-emergence',
    name: 'Pandemic emergence',
    domain: 'biosurv',
    fingerprint: [
      feature('domain-elevation', 0.35, { domain: 'biosurv', minCount: 6, minSeverity: 'MEDIUM' }),
      feature('geo-cluster', 0.35, { minCount: 4, radiusKm: 500 }),
      feature('time-pattern', 0.3, { windowMinutes: 60 * 24 * 7, minCount: 6 }),
    ],
    historicalExamples: ['2003 SARS', '2014 Ebola', '2019 COVID-19'],
    avgLeadTimeHours: 168,
    confidence: 0.65,
  },
  {
    id: 'builtin-coup-pattern',
    name: 'Coup pattern',
    domain: 'geopolitical',
    fingerprint: [
      feature('domain-elevation', 0.4, { domain: 'geopolitical', minCount: 4, minSeverity: 'HIGH' }),
      feature('geo-cluster', 0.35, { minCount: 3, radiusKm: 50 }),
      feature('time-pattern', 0.25, { windowMinutes: 60 * 6, minCount: 4 }),
    ],
    historicalExamples: ['2021 Myanmar', '2023 Niger', '2023 Gabon'],
    avgLeadTimeHours: 24,
    confidence: 0.55,
  },
  {
    id: 'builtin-regional-conflict-escalation',
    name: 'Regional conflict escalation',
    domain: 'geopolitical',
    fingerprint: [
      feature('domain-elevation', 0.4, { domain: 'geopolitical', minCount: 8, minSeverity: 'HIGH' }),
      feature('entity-spike', 0.3, { minCount: 4 }),
      feature('time-pattern', 0.3, { windowMinutes: 60 * 12, minCount: 6 }),
    ],
    historicalExamples: ['2022 Ukraine invasion run-up', '2023 Israel-Gaza onset'],
    avgLeadTimeHours: 12,
    confidence: 0.7,
  },
  {
    id: 'builtin-supply-chain-cascade',
    name: 'Supply chain cascade',
    domain: 'maritime',
    fingerprint: [
      feature('domain-elevation', 0.35, { domain: 'maritime', minCount: 5, minSeverity: 'MEDIUM' }),
      feature('geo-cluster', 0.35, { minCount: 4, radiusKm: 200 }),
      feature('entity-spike', 0.3, { minCount: 3 }),
    ],
    historicalExamples: ['2021 Ever Given Suez', '2024 Red Sea attacks'],
    avgLeadTimeHours: 72,
    confidence: 0.6,
  },
  {
    id: 'builtin-cyber-infrastructure-attack',
    name: 'Cyber infrastructure attack',
    domain: 'cyber',
    fingerprint: [
      feature('domain-elevation', 0.45, { domain: 'cyber', minCount: 4, minSeverity: 'HIGH' }),
      feature('entity-spike', 0.3, { minCount: 3 }),
      feature('time-pattern', 0.25, { windowMinutes: 60, minCount: 5 }),
    ],
    historicalExamples: ['2017 NotPetya', '2021 Colonial Pipeline', '2024 CrowdStrike'],
    avgLeadTimeHours: 6,
    confidence: 0.75,
  },
  {
    id: 'builtin-natural-disaster-compound',
    name: 'Natural disaster compound',
    domain: 'disaster',
    fingerprint: [
      feature('domain-elevation', 0.35, { domain: 'disaster', minCount: 3, minSeverity: 'HIGH' }),
      feature('geo-cluster', 0.4, { minCount: 4, radiusKm: 300 }),
      feature('time-pattern', 0.25, { windowMinutes: 60 * 24, minCount: 5 }),
    ],
    historicalExamples: ['2011 Tohoku quake+tsunami+meltdown', '2024 Hurricane Helene compound flooding'],
    avgLeadTimeHours: 4,
    confidence: 0.65,
  },
  {
    id: 'builtin-social-unrest-spread',
    name: 'Social unrest spread',
    domain: 'osint',
    fingerprint: [
      feature('domain-elevation', 0.35, { domain: 'osint', minCount: 6, minSeverity: 'MEDIUM' }),
      feature('geo-cluster', 0.3, { minCount: 5, radiusKm: 100 }),
      feature('time-pattern', 0.35, { windowMinutes: 60 * 24, minCount: 8 }),
    ],
    historicalExamples: ['2011 Arab Spring', '2019 Hong Kong protests'],
    avgLeadTimeHours: 36,
    confidence: 0.55,
  },
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

function cloneFeature(f: SignatureFeature): SignatureFeature {
  return { ...f, params: { ...f.params } };
}

function cloneSignature(s: CrisisSignature): CrisisSignature {
  return {
    ...s,
    fingerprint: s.fingerprint.map((f) => cloneFeature(f)),
    historicalExamples: [...s.historicalExamples],
  };
}

function cloneMatch(m: SignatureMatch): SignatureMatch {
  return {
    signature: cloneSignature(m.signature),
    score: m.score,
    matchedFeatures: m.matchedFeatures.map((f) => cloneFeature(f)),
    leadTimeEstimateHours: m.leadTimeEstimateHours,
  };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getNumberParam(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function getStringParam(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === 'string' ? v : undefined;
}

function severityRankFromParam(params: Record<string, unknown>, key: string): number {
  const v = params[key];
  if (typeof v !== 'string') return 0;
  const upper = v.toUpperCase() as ObservationSeverity;
  return SEVERITY_RANK[upper] ?? 0;
}

// ── Feature evaluators ────────────────────────────────────────────────

function matchesDomainElevation(feature: SignatureFeature, observations: readonly ObservationEvent[]): boolean {
  const domain = getStringParam(feature.params, 'domain');
  if (!domain) return false;
  const minCount = getNumberParam(feature.params, 'minCount', 1);
  const minRank = severityRankFromParam(feature.params, 'minSeverity');
  let hits = 0;
  for (const o of observations) {
    if (o.domain !== domain) continue;
    if (SEVERITY_RANK[o.severity] < minRank) continue;
    hits += 1;
    if (hits >= minCount) return true;
  }
  return false;
}

function matchesEntitySpike(feature: SignatureFeature, observations: readonly ObservationEvent[]): boolean {
  const minCount = getNumberParam(feature.params, 'minCount', 1);
  const targetEntity = getStringParam(feature.params, 'entityId');
  const counts = new Map<string, number>();
  for (const o of observations) {
    for (const id of o.entityIds) {
      if (targetEntity && id !== targetEntity) continue;
      const next = (counts.get(id) ?? 0) + 1;
      counts.set(id, next);
      if (next >= minCount) return true;
    }
  }
  return false;
}

interface GeoPoint { lat: number; lon: number }

function countWithinRadius(centre: GeoPoint, points: readonly GeoPoint[], radiusKm: number): number {
  let hits = 0;
  for (const p of points) {
    if (haversineKm(centre.lat, centre.lon, p.lat, p.lon) <= radiusKm) hits += 1;
  }
  return hits;
}

function matchesGeoCluster(feature: SignatureFeature, observations: readonly ObservationEvent[]): boolean {
  const minCount = getNumberParam(feature.params, 'minCount', 1);
  const radiusKm = getNumberParam(feature.params, 'radiusKm', 100);
  const fixedLat = feature.params.lat;
  const fixedLon = feature.params.lon;
  const points: GeoPoint[] = observations
    .filter((o) => o.location !== undefined)
    .map((o) => ({ lat: o.location!.lat, lon: o.location!.lon }));
  if (points.length < minCount) return false;
  if (typeof fixedLat === 'number' && typeof fixedLon === 'number') {
    return countWithinRadius({ lat: fixedLat, lon: fixedLon }, points, radiusKm) >= minCount;
  }
  // Anchor each point in turn and look for a cluster around it.
  return points.some((anchor) => countWithinRadius(anchor, points, radiusKm) >= minCount);
}

function matchesTimePattern(feature: SignatureFeature, observations: readonly ObservationEvent[]): boolean {
  const minCount = getNumberParam(feature.params, 'minCount', 1);
  const windowMinutes = getNumberParam(feature.params, 'windowMinutes', 60);
  if (observations.length < minCount) return false;
  const sorted = [...observations].sort((a, b) => a.timestamp - b.timestamp);
  const windowMs = windowMinutes * 60_000;
  let left = 0;
  for (let right = 0; right < sorted.length; right += 1) {
    while (sorted[right]!.timestamp - sorted[left]!.timestamp > windowMs) left += 1;
    if (right - left + 1 >= minCount) return true;
  }
  return false;
}

function evaluateFeature(feature: SignatureFeature, observations: readonly ObservationEvent[]): boolean {
  switch (feature.featureType) {
    case 'domain-elevation': { return matchesDomainElevation(feature, observations); }
    case 'entity-spike': { return matchesEntitySpike(feature, observations); }
    case 'geo-cluster': { return matchesGeoCluster(feature, observations); }
    case 'time-pattern': { return matchesTimePattern(feature, observations); }
  }
}

// ── Service ───────────────────────────────────────────────────────────

export class CrisisSignatureLibrary {
  private static _singleton: CrisisSignatureLibrary | null = null;
  private custom = new Map<string, CrisisSignature>();
  private storage: StorageLike | null;
  private hydrated = false;

  constructor(options: CrisisSignatureLibraryOptions = {}) {
    this.storage = safeStorage(options.storage);
    // `options.clock` is accepted but unused today; reserved for the
    // upcoming temporal-weighting follow-up so the constructor
    // signature matches the rest of the intelligence services.
  }

  static getInstance(): CrisisSignatureLibrary {
    CrisisSignatureLibrary._singleton ??= new CrisisSignatureLibrary();
    return CrisisSignatureLibrary._singleton;
  }

  static _resetForTests(): void {
    CrisisSignatureLibrary._singleton = null;
  }

  // ── Registry CRUD ──────────────────────────────────────────────────

  addSignature(signature: CrisisSignature): CrisisSignature {
    this.ensureHydrated();
    const stored = cloneSignature(signature);
    this.custom.set(stored.id, stored);
    this.enforceCustomCap();
    this.persist();
    return cloneSignature(stored);
  }

  removeSignature(id: string): boolean {
    this.ensureHydrated();
    const removed = this.custom.delete(id);
    if (removed) this.persist();
    return removed;
  }

  getSignatures(): CrisisSignature[] {
    this.ensureHydrated();
    return [
      ...BUILT_IN_SIGNATURES.map((s) => cloneSignature(s)),
      ...[...this.custom.values()].map((s) => cloneSignature(s)),
    ];
  }

  getSignature(id: string): CrisisSignature | undefined {
    this.ensureHydrated();
    const builtIn = BUILT_IN_SIGNATURES.find((s) => s.id === id);
    if (builtIn) return cloneSignature(builtIn);
    const custom = this.custom.get(id);
    return custom ? cloneSignature(custom) : undefined;
  }

  // ── Matching ───────────────────────────────────────────────────────

  matchSignatures(observations: readonly ObservationEvent[]): SignatureMatch[] {
    this.ensureHydrated();
    const matches: SignatureMatch[] = [];
    for (const signature of this.iterSignatures()) {
      const match = this.scoreSignature(signature, observations);
      if (match) matches.push(match);
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.map((m) => cloneMatch(m));
  }

  /** Test seam — clears custom signatures + persisted blob. */
  resetForTesting(): void {
    this.custom.clear();
    this.hydrated = true;
    if (this.storage?.removeItem) {
      try { this.storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  private *iterSignatures(): Iterable<CrisisSignature> {
    for (const s of BUILT_IN_SIGNATURES) yield s;
    for (const s of this.custom.values()) yield s;
  }

  private scoreSignature(signature: CrisisSignature, observations: readonly ObservationEvent[]): SignatureMatch | null {
    let totalWeight = 0;
    let matchedWeight = 0;
    const matchedFeatures: SignatureFeature[] = [];
    for (const feature of signature.fingerprint) {
      totalWeight += feature.weight;
      if (evaluateFeature(feature, observations)) {
        matchedWeight += feature.weight;
        matchedFeatures.push(feature);
      }
    }
    if (totalWeight <= 0) return null;
    const score = Number((matchedWeight / totalWeight).toFixed(4));
    if (score < MATCH_THRESHOLD) return null;
    const leadTimeEstimateHours = Number(
      Math.max(0, signature.avgLeadTimeHours * (1 - score)).toFixed(2),
    );
    return { signature, score, matchedFeatures, leadTimeEstimateHours };
  }

  private enforceCustomCap(): void {
    if (this.custom.size <= MAX_CUSTOM_SIGNATURES) return;
    const overflow = this.custom.size - MAX_CUSTOM_SIGNATURES;
    const ids = [...this.custom.keys()].slice(0, overflow);
    for (const id of ids) this.custom.delete(id);
  }

  private ensureHydrated(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.storage) return;
    let raw: string | null = null;
    try { raw = this.storage.getItem(STORAGE_KEY); } catch { return; }
    if (!raw) return;
    let parsed: CrisisSignature[] | null;
    try { parsed = JSON.parse(raw) as CrisisSignature[] | null; }
    catch { return; }
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (!entry || typeof entry.id !== 'string' || !Array.isArray(entry.fingerprint)) continue;
      this.custom.set(entry.id, cloneSignature(entry));
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify([...this.custom.values()]));
    } catch { /* best effort */ }
  }
}

// ── Convenience accessor ──────────────────────────────────────────────

export function getCrisisSignatureLibrary(): CrisisSignatureLibrary {
  return CrisisSignatureLibrary.getInstance();
}

export const __internals = {
  BUILT_IN_SIGNATURES,
  SEVERITY_RANK,
  MATCH_THRESHOLD,
  MAX_CUSTOM_SIGNATURES,
  haversineKm,
};
