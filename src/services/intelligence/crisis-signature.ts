/**
 * Crisis Signature Library (Phase 4).
 *
 * Fingerprints recurring crisis patterns and scores incoming
 * observation clusters against the catalog for early detection.
 *
 * Each `CrisisSignature` lists the pattern features (rapid severity
 * escalation, multi-source corroboration, geographic clustering,
 * domain cascades, temporal clustering, entity recurrence) that the
 * crisis exhibits. `matchObservations()` scores every signature
 * against the supplied observations and returns a ranked list of
 * `SignatureMatch` rows.
 *
 * Pure module — no DOM, no fetch, no globals at import time. The
 * 200 most-recent matches persist to `localStorage 'wm-crisis-signatures'`
 * so the panel can re-render across reloads.
 */

import type { ObservationEvent, ObservationSeverity } from './observation-adapters';
import { getCorrelationStore, type CorrelationStore } from './correlation-store';

// ── Public types ──────────────────────────────────────────────────────

export type PatternFeatureType =
  | 'rapid-severity-escalation'
  | 'multi-source-corroboration'
  | 'geographic-clustering'
  | 'domain-cascade'
  | 'temporal-clustering'
  | 'entity-recurrence';

export interface PatternFeature {
  featureType: PatternFeatureType;
  weight: number;
  required: boolean;
}

export interface CascadeRisk {
  targetDomain: string;
  probability: number;
  delayHours: number;
}

export interface CrisisSignature {
  id: string;
  name: string;
  description: string;
  domain: string;
  patternFeatures: PatternFeature[];
  historicalExamples: string[];
  avgDurationHours: number;
  peakSeverity: string;
  cascadeRisk: CascadeRisk[];
  confidenceThreshold: number;
}

export type MatchConfidence = 'low' | 'medium' | 'high';

export interface SignatureMatch {
  signatureId: string;
  signatureName: string;
  matchScore: number;
  matchedFeatures: string[];
  missingFeatures: string[];
  confidence: MatchConfidence;
  detectedAt: number;
}

export type CrisisSignatureListener = (matches: SignatureMatch[]) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-crisis-signatures';
const MAX_RECENT_MATCHES = 200;
const EARTH_KM = 6371;
const DEG2RAD = Math.PI / 180;

const GEOGRAPHIC_CLUSTER_RADIUS_KM = 500;
const GEOGRAPHIC_CLUSTER_MIN_OBS = 3;
const RAPID_ESCALATION_WINDOW_MS = 2 * 60 * 60 * 1000;
const RAPID_ESCALATION_MIN_BANDS = 2;
const MULTI_SOURCE_MIN = 3;
const TEMPORAL_CLUSTER_MIN_OBS = 5;
const TEMPORAL_CLUSTER_WINDOW_MS = 60 * 60 * 1000;
const ENTITY_RECURRENCE_MIN = 3;

const SEVERITY_BAND_INDEX: Record<ObservationSeverity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const CONFIDENCE_HIGH = 0.8;
const CONFIDENCE_MEDIUM = 0.5;

// ── Built-in signature catalog ────────────────────────────────────────

const BUILT_IN_SIGNATURES: CrisisSignature[] = [
  {
    id: 'pacific-tsunami-precursor',
    name: 'Pacific tsunami precursor',
    description: 'M≥6.5 subduction-zone quake followed by rapid coastal water-level alerts. Cascades into evacuation orders within hours.',
    domain: 'earthquake',
    patternFeatures: [
      { featureType: 'rapid-severity-escalation', weight: 1, required: true },
      { featureType: 'geographic-clustering', weight: 0.9, required: false },
      { featureType: 'domain-cascade', weight: 1, required: true },
      { featureType: 'multi-source-corroboration', weight: 0.8, required: false },
    ],
    historicalExamples: ['2011 Tōhoku', '2004 Indian Ocean', '1960 Valdivia'],
    avgDurationHours: 12,
    peakSeverity: 'CRITICAL',
    cascadeRisk: [
      { targetDomain: 'weather', probability: 0.9, delayHours: 1 },
      { targetDomain: 'infrastructure', probability: 0.7, delayHours: 4 },
    ],
    confidenceThreshold: 0.7,
  },
  {
    id: 'pandemic-emergence',
    name: 'Pandemic emergence',
    description: 'Clusters of unexplained respiratory illness across multiple locales with growing source corroboration and entity (pathogen) recurrence.',
    domain: 'biosurveillance',
    patternFeatures: [
      { featureType: 'multi-source-corroboration', weight: 1, required: true },
      { featureType: 'entity-recurrence', weight: 1, required: true },
      { featureType: 'geographic-clustering', weight: 0.6, required: false },
      { featureType: 'temporal-clustering', weight: 0.7, required: false },
    ],
    historicalExamples: ['SARS 2003', 'H1N1 2009', 'COVID-19 2019'],
    avgDurationHours: 240,
    peakSeverity: 'CRITICAL',
    cascadeRisk: [
      { targetDomain: 'travel', probability: 0.8, delayHours: 48 },
      { targetDomain: 'finance', probability: 0.6, delayHours: 72 },
    ],
    confidenceThreshold: 0.6,
  },
  {
    id: 'major-earthquake-cascade',
    name: 'Major earthquake cascade',
    description: 'M≥7 quake followed by aftershocks, infrastructure damage reports, and grid stress within a tight geographic cluster.',
    domain: 'earthquake',
    patternFeatures: [
      { featureType: 'rapid-severity-escalation', weight: 1, required: true },
      { featureType: 'temporal-clustering', weight: 0.9, required: true },
      { featureType: 'geographic-clustering', weight: 0.9, required: true },
      { featureType: 'domain-cascade', weight: 0.7, required: false },
    ],
    historicalExamples: ['2010 Haiti', '2023 Türkiye-Syria', '2008 Sichuan'],
    avgDurationHours: 72,
    peakSeverity: 'CRITICAL',
    cascadeRisk: [
      { targetDomain: 'infrastructure', probability: 0.85, delayHours: 2 },
      { targetDomain: 'travel', probability: 0.6, delayHours: 12 },
    ],
    confidenceThreshold: 0.7,
  },
  {
    id: 'infrastructure-cyberattack',
    name: 'Infrastructure cyberattack',
    description: 'Coordinated cyber events targeting power / water / comms with same-entity recurrence and rapid escalation.',
    domain: 'cyber',
    patternFeatures: [
      { featureType: 'entity-recurrence', weight: 1, required: true },
      { featureType: 'domain-cascade', weight: 1, required: true },
      { featureType: 'rapid-severity-escalation', weight: 0.8, required: false },
      { featureType: 'multi-source-corroboration', weight: 0.7, required: false },
    ],
    historicalExamples: ['2015 Ukraine power grid', '2021 Colonial Pipeline', '2022 Viasat'],
    avgDurationHours: 48,
    peakSeverity: 'HIGH',
    cascadeRisk: [
      { targetDomain: 'infrastructure', probability: 0.9, delayHours: 1 },
      { targetDomain: 'finance', probability: 0.5, delayHours: 6 },
    ],
    confidenceThreshold: 0.65,
  },
  {
    id: 'maritime-conflict-escalation',
    name: 'Maritime conflict escalation',
    description: 'Rapid sequence of vessel incidents + air defense + AIS gaps + multi-flag claims in a chokepoint.',
    domain: 'maritime',
    patternFeatures: [
      { featureType: 'geographic-clustering', weight: 1, required: true },
      { featureType: 'temporal-clustering', weight: 0.8, required: true },
      { featureType: 'multi-source-corroboration', weight: 0.7, required: false },
      { featureType: 'domain-cascade', weight: 0.7, required: false },
    ],
    historicalExamples: ['2019 Strait of Hormuz incidents', '2024 Red Sea Houthi attacks'],
    avgDurationHours: 96,
    peakSeverity: 'HIGH',
    cascadeRisk: [
      { targetDomain: 'travel', probability: 0.5, delayHours: 24 },
      { targetDomain: 'energy', probability: 0.7, delayHours: 12 },
    ],
    confidenceThreshold: 0.6,
  },
  {
    id: 'wildfire-firestorm',
    name: 'Wildfire firestorm',
    description: 'Red-flag warnings + multiple active perimeters + low humidity + rapid intensification. Cascades into evacuation + AQI alerts.',
    domain: 'wildfire',
    patternFeatures: [
      { featureType: 'geographic-clustering', weight: 1, required: true },
      { featureType: 'rapid-severity-escalation', weight: 1, required: true },
      { featureType: 'temporal-clustering', weight: 0.8, required: false },
      { featureType: 'domain-cascade', weight: 0.7, required: false },
    ],
    historicalExamples: ['2018 Camp Fire', '2020 California complex', '2023 Maui (Lahaina)'],
    avgDurationHours: 72,
    peakSeverity: 'CRITICAL',
    cascadeRisk: [
      { targetDomain: 'travel', probability: 0.6, delayHours: 6 },
      { targetDomain: 'weather', probability: 0.7, delayHours: 2 },
    ],
    confidenceThreshold: 0.65,
  },
  {
    id: 'solar-geomagnetic-storm',
    name: 'Solar / geomagnetic storm',
    description: 'X-class flare + CME arrival + Kp index spike + HF radio degradation + grid stress reports.',
    domain: 'space',
    patternFeatures: [
      { featureType: 'rapid-severity-escalation', weight: 1, required: true },
      { featureType: 'multi-source-corroboration', weight: 0.9, required: true },
      { featureType: 'domain-cascade', weight: 0.8, required: false },
    ],
    historicalExamples: ['2003 Halloween storms', '2024 Mother\'s Day storm', '1989 Quebec blackout'],
    avgDurationHours: 36,
    peakSeverity: 'HIGH',
    cascadeRisk: [
      { targetDomain: 'infrastructure', probability: 0.6, delayHours: 12 },
      { targetDomain: 'travel', probability: 0.4, delayHours: 6 },
    ],
    confidenceThreshold: 0.6,
  },
  {
    id: 'financial-contagion',
    name: 'Financial contagion',
    description: 'Sudden volatility cluster + counterparty stress + cross-asset correlation breakdown + venue/exchange outages.',
    domain: 'finance',
    patternFeatures: [
      { featureType: 'temporal-clustering', weight: 1, required: true },
      { featureType: 'rapid-severity-escalation', weight: 0.9, required: true },
      { featureType: 'multi-source-corroboration', weight: 0.7, required: false },
      { featureType: 'domain-cascade', weight: 0.6, required: false },
    ],
    historicalExamples: ['2008 GFC', '2020 COVID crash', '2023 SVB collapse'],
    avgDurationHours: 168,
    peakSeverity: 'CRITICAL',
    cascadeRisk: [
      { targetDomain: 'finance', probability: 0.9, delayHours: 0 },
      { targetDomain: 'energy', probability: 0.4, delayHours: 48 },
    ],
    confidenceThreshold: 0.55,
  },
];

// ── Feature detectors ────────────────────────────────────────────────

function severityIndex(severity: ObservationSeverity | undefined): number {
  return severity ? SEVERITY_BAND_INDEX[severity] : 0;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function detectRapidEscalation(observations: readonly ObservationEvent[]): boolean {
  if (observations.length < 2) return false;
  const sorted = [...observations].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j]!;
      const dt = b.timestamp - a.timestamp;
      if (dt > RAPID_ESCALATION_WINDOW_MS) break;
      if (severityIndex(b.severity) - severityIndex(a.severity) >= RAPID_ESCALATION_MIN_BANDS) {
        return true;
      }
    }
  }
  return false;
}

function detectMultiSourceCorroboration(observations: readonly ObservationEvent[]): boolean {
  const sources = new Set<string>();
  for (const o of observations) sources.add(o.sourceId);
  return sources.size >= MULTI_SOURCE_MIN;
}

function detectGeographicClustering(observations: readonly ObservationEvent[]): boolean {
  const located = observations.filter((o) => !!o.location);
  if (located.length < GEOGRAPHIC_CLUSTER_MIN_OBS) return false;
  for (let i = 0; i < located.length; i += 1) {
    const a = located[i]!.location!;
    let nearby = 1;
    for (const [j, element] of located.entries()) {
      if (i === j) continue;
      const b = element!.location!;
      if (haversineKm(a.lat, a.lon, b.lat, b.lon) <= GEOGRAPHIC_CLUSTER_RADIUS_KM) {
        nearby += 1;
      }
    }
    if (nearby >= GEOGRAPHIC_CLUSTER_MIN_OBS) return true;
  }
  return false;
}

function detectDomainCascade(
  observations: readonly ObservationEvent[],
  store: CorrelationStore,
): boolean {
  const domains = new Set<string>();
  for (const o of observations) domains.add(o.domain);
  if (domains.size < 2) return false;
  const matches = store.getByDomains([...domains]);
  return matches.length > 0;
}

function detectTemporalClustering(observations: readonly ObservationEvent[]): boolean {
  if (observations.length < TEMPORAL_CLUSTER_MIN_OBS) return false;
  const sorted = [...observations].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 0; i < sorted.length; i += 1) {
    const window = sorted[i]!.timestamp + TEMPORAL_CLUSTER_WINDOW_MS;
    let count = 0;
    for (let j = i; j < sorted.length; j += 1) {
      if (sorted[j]!.timestamp <= window) count += 1;
      else break;
    }
    if (count >= TEMPORAL_CLUSTER_MIN_OBS) return true;
  }
  return false;
}

function detectEntityRecurrence(observations: readonly ObservationEvent[]): boolean {
  const counts = new Map<string, number>();
  for (const o of observations) {
    for (const id of o.entityIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  for (const n of counts.values()) {
    if (n >= ENTITY_RECURRENCE_MIN) return true;
  }
  return false;
}

interface FeatureDetectionContext {
  observations: readonly ObservationEvent[];
  correlationStore: CorrelationStore;
}

function detectFeature(featureType: PatternFeatureType, ctx: FeatureDetectionContext): boolean {
  switch (featureType) {
    case 'rapid-severity-escalation': { return detectRapidEscalation(ctx.observations);
    }
    case 'multi-source-corroboration': { return detectMultiSourceCorroboration(ctx.observations);
    }
    case 'geographic-clustering': { return detectGeographicClustering(ctx.observations);
    }
    case 'domain-cascade': { return detectDomainCascade(ctx.observations, ctx.correlationStore);
    }
    case 'temporal-clustering': { return detectTemporalClustering(ctx.observations);
    }
    case 'entity-recurrence': { return detectEntityRecurrence(ctx.observations);
    }
  }
}

function confidenceFor(score: number): MatchConfidence {
  if (score >= CONFIDENCE_HIGH) return 'high';
  if (score >= CONFIDENCE_MEDIUM) return 'medium';
  return 'low';
}

function scoreSignature(
  signature: CrisisSignature,
  ctx: FeatureDetectionContext,
  now: number,
): SignatureMatch | null {
  const matched: string[] = [];
  const missing: string[] = [];
  let matchedWeight = 0;
  let totalWeight = 0;
  let requiredMissing = false;
  for (const feature of signature.patternFeatures) {
    totalWeight += Math.max(0, feature.weight);
    if (detectFeature(feature.featureType, ctx)) {
      matched.push(feature.featureType);
      matchedWeight += Math.max(0, feature.weight);
    } else {
      missing.push(feature.featureType);
      if (feature.required) requiredMissing = true;
    }
  }
  const score = totalWeight === 0 ? 0 : matchedWeight / totalWeight;
  // Required features missing pin the score below the signature's
  // own confidence threshold so the match is always "low".
  const effectiveScore = requiredMissing ? Math.min(score, CONFIDENCE_MEDIUM - 0.01) : score;
  if (matched.length === 0) return null;
  return {
    signatureId: signature.id,
    signatureName: signature.name,
    matchScore: Number(effectiveScore.toFixed(4)),
    matchedFeatures: matched,
    missingFeatures: missing,
    confidence: confidenceFor(effectiveScore),
    detectedAt: now,
  };
}

// ── Library ──────────────────────────────────────────────────────────

export interface CrisisSignatureLibraryOptions {
  signatures?: readonly CrisisSignature[];
  correlationStore?: CorrelationStore;
  clock?: () => number;
}

export class CrisisSignatureLibrary {
  private signatures: CrisisSignature[];
  private recentMatches: SignatureMatch[] = [];
  private listeners = new Set<CrisisSignatureListener>();
  private hydrated = false;
  private correlationStore?: CorrelationStore;
  private clock: () => number;

  constructor(options: CrisisSignatureLibraryOptions = {}) {
    this.signatures = (options.signatures ?? BUILT_IN_SIGNATURES).map((s) => cloneSignature(s));
    this.correlationStore = options.correlationStore;
    this.clock = options.clock ?? (() => Date.now());
  }

  // ── Public API ──────────────────────────────────────────────────

  matchObservations(observations: readonly ObservationEvent[]): SignatureMatch[] {
    this.ensureHydrated();
    const ctx: FeatureDetectionContext = {
      observations,
      correlationStore: this.correlationStore ?? getCorrelationStore(),
    };
    const now = this.clock();
    const matches: SignatureMatch[] = [];
    for (const signature of this.signatures) {
      const match = scoreSignature(signature, ctx, now);
      if (match) matches.push(match);
    }
    matches.sort((a, b) => b.matchScore - a.matchScore);
    if (matches.length > 0) {
      this.recordMatches(matches);
      this.notify(matches);
    }
    return matches.map((m) => cloneMatch(m));
  }

  getRecentMatches(limit = 10): SignatureMatch[] {
    this.ensureHydrated();
    if (limit <= 0) return [];
    const tail = this.recentMatches.slice(-limit);
    const reversed: SignatureMatch[] = [];
    for (let i = tail.length - 1; i >= 0; i -= 1) reversed.push(tail[i]!);
    return reversed.map((m) => cloneMatch(m));
  }

  getSignature(id: string): CrisisSignature | undefined {
    const s = this.signatures.find((sig) => sig.id === id);
    return s ? cloneSignature(s) : undefined;
  }

  getAllSignatures(): CrisisSignature[] {
    return this.signatures.map((s) => cloneSignature(s));
  }

  subscribe(listener: CrisisSignatureListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  resetForTesting(): void {
    this.recentMatches = [];
    this.listeners.clear();
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }

  // ── Internal ────────────────────────────────────────────────────

  private recordMatches(matches: readonly SignatureMatch[]): void {
    for (const m of matches) this.recentMatches.push({ ...m });
    if (this.recentMatches.length > MAX_RECENT_MATCHES) {
      this.recentMatches.splice(0, this.recentMatches.length - MAX_RECENT_MATCHES);
    }
    this.persist();
  }

  private notify(matches: readonly SignatureMatch[]): void {
    const snapshot = matches.map((m) => cloneMatch(m));
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* isolate */ }
    }
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
      const parsed = JSON.parse(raw) as SignatureMatch[] | null;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        if (entry && typeof entry.signatureId === 'string') {
          this.recentMatches.push({ ...entry, matchedFeatures: [...(entry.matchedFeatures ?? [])], missingFeatures: [...(entry.missingFeatures ?? [])] });
        }
      }
    } catch {
      // corrupt blob — leave empty
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(this.recentMatches));
    } catch {
      // best effort
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function cloneSignature(s: CrisisSignature): CrisisSignature {
  return {
    ...s,
    patternFeatures: s.patternFeatures.map((f) => ({ ...f })),
    historicalExamples: [...s.historicalExamples],
    cascadeRisk: s.cascadeRisk.map((c) => ({ ...c })),
  };
}

function cloneMatch(m: SignatureMatch): SignatureMatch {
  return {
    ...m,
    matchedFeatures: [...m.matchedFeatures],
    missingFeatures: [...m.missingFeatures],
  };
}

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let _singleton: CrisisSignatureLibrary | null = null;

export function getCrisisSignatureLibrary(): CrisisSignatureLibrary {
  _singleton ??= new CrisisSignatureLibrary();
  return _singleton;
}

export function __resetCrisisSignatureLibrarySingleton(): void {
  _singleton = null;
}

export const __internals = {
  BUILT_IN_SIGNATURES,
  detectRapidEscalation,
  detectMultiSourceCorroboration,
  detectGeographicClustering,
  detectDomainCascade,
  detectTemporalClustering,
  detectEntityRecurrence,
  confidenceFor,
  scoreSignature,
  haversineKm,
  GEOGRAPHIC_CLUSTER_RADIUS_KM,
  GEOGRAPHIC_CLUSTER_MIN_OBS,
  RAPID_ESCALATION_WINDOW_MS,
  RAPID_ESCALATION_MIN_BANDS,
  MULTI_SOURCE_MIN,
  TEMPORAL_CLUSTER_MIN_OBS,
  TEMPORAL_CLUSTER_WINDOW_MS,
  ENTITY_RECURRENCE_MIN,
  MAX_RECENT_MATCHES,
  CONFIDENCE_HIGH,
  CONFIDENCE_MEDIUM,
};
