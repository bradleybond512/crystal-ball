/**
 * Threat Horizon Scanner — Phase 4 24/48/72 h forward-looking detector.
 *
 * Fuses signals from four upstream engines:
 *   - FailurePredictionEngine  — escalation risks at 1 h / 6 h / 24 h
 *   - GlobalRhythmEngine        — anomaly scores against learned baselines
 *   - CrisisTrajectoryProjector — multi-horizon projected severities
 *   - CrisisSignatureLibrary    — high-confidence pattern matches
 *
 * Each contributor is bucketed onto a coarse 24 h / 48 h / 72 h horizon
 * (with trajectory points choosing the closest bucket), then merged by
 * (domain, region). The merged HorizonThreat record carries the union
 * of contributing basis labels + early warning signal strings + a
 * per-domain recommended action template.
 *
 * Pure module — no DOM, no fetch, no globals at import time. Persists
 * the most-recent 200 threats under `wm-threat-horizon` (ring buffer,
 * oldest evicted first).
 */

import type { AnomalyScore } from './global-rhythm';
import type { CrisisTrajectory, TrajectoryPoint } from './crisis-trajectory';
import type { EscalationRisk } from './failure-prediction';
import type { SignatureMatch } from './crisis-signature';
import type { ObservationEvent } from './observation-adapters';

// ── Public types ──────────────────────────────────────────────────────

export type ThreatHorizon = '24h' | '48h' | '72h';

export type ThreatStatus = 'watching' | 'escalating' | 'dismissed';

export type ThreatBasis =
  | 'failure-prediction'
  | 'global-rhythm'
  | 'crisis-trajectory'
  | 'crisis-signature';

export interface HorizonThreat {
  id: string;
  domain: string;
  region: string;
  currentSeverity: string;
  projectedSeverity: string;
  horizon: ThreatHorizon;
  /** 0..1 max across contributing signals. */
  probability: number;
  /** Set of source engines that contributed to this threat. */
  basis: ThreatBasis[];
  earlyWarningSignals: string[];
  recommendedActions: string[];
  detectedAt: number;
  status: ThreatStatus;
}

export interface ThreatProviders {
  failurePrediction?: () => readonly EscalationRisk[];
  globalRhythm?: () => readonly AnomalyScore[];
  crisisTrajectory?: () => readonly CrisisTrajectory[];
  crisisSignature?: () => readonly SignatureMatch[];
  /** Resolves a signature id to its domain. Optional — when absent
   *  signature matches default to the 'unknown' domain. */
  signatureDomainLookup?: (signatureId: string) => string | undefined;
}

export type HorizonListener = (threats: HorizonThreat[]) => void;

// ── Constants ─────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-threat-horizon';
const MAX_THREATS = 200;
const DEFAULT_REGION = 'global';
const UNKNOWN_DOMAIN = 'unknown';
const UNKNOWN_SEVERITY = 'unknown';

const ALL_HORIZONS: readonly ThreatHorizon[] = ['24h', '48h', '72h'];

/** Per-domain recommended-action templates. The 'default' entry seeds
 *  anything the lookup doesn't recognise. */
export const RECOMMENDED_ACTION_TEMPLATES: Readonly<Record<string, readonly string[]>> = {
  earthquake: [
    'Pre-position aftershock monitoring + ground-shaking observers',
    'Verify SAR + medical readiness in the affected region',
    'Alert downstream infrastructure operators (power, water, transit)',
  ],
  biosurveillance: [
    'Coordinate with WHO / CDC reporting partners',
    'Validate outbreak surveillance feeds + lab confirmation',
    'Pre-position medical surge capacity + diagnostic supplies',
  ],
  weather: [
    'Activate severe weather watch protocols',
    'Verify NWS / regional advisory chain',
    'Notify aviation + maritime operators in projected path',
  ],
  maritime: [
    'Validate AIS coverage for affected chokepoints',
    'Cross-check with port-state advisories + naval movements',
    'Alert vessel operators routing through the zone',
  ],
  cyber: [
    'Notify IT / OT defenders of observed indicators',
    'Validate IDS / EDR signatures against the pattern',
    'Coordinate with CISA / sector ISAC partners',
  ],
  wildfire: [
    'Validate fire-weather forecast + fuel-moisture observations',
    'Pre-position suppression + evacuation resources',
    'Notify air-quality + utility operators along projected path',
  ],
  default: [
    'Monitor the affected domain closely',
    'Verify upstream feed quality + provenance',
    'Notify domain stakeholders of the emerging signal',
  ],
};

// ── Storage helper ────────────────────────────────────────────────────

function safeStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

// ── Signal mapping helpers ───────────────────────────────────────────

interface SignalDraft {
  domain: string;
  region: string;
  horizon: ThreatHorizon;
  probability: number;
  currentSeverity: string;
  projectedSeverity: string;
  basis: ThreatBasis;
  earlyWarning: string;
}

function regionForObservation(obs: ObservationEvent | undefined): string {
  if (!obs) return DEFAULT_REGION;
  if (obs.entityIds.length > 0) {
    const head = obs.entityIds[0]!;
    if (/^[A-Z0-9-]{2,8}$/.test(head)) return head;
  }
  if (obs.tags.length > 0) return obs.tags[0]!;
  if (obs.location) {
    const lat = obs.location.lat.toFixed(0);
    const lon = obs.location.lon.toFixed(0);
    return `${lat},${lon}`;
  }
  return DEFAULT_REGION;
}

/** Severity-strength map for global-rhythm anomalies. Mirrors the
 *  documented anomaly band table. */
const ANOMALY_PROBABILITY: Record<AnomalyScore['anomalyStrength'], number> = {
  none: 0.05,
  mild: 0.3,
  moderate: 0.55,
  strong: 0.8,
};

/** Confidence-label-to-probability map for crisis signatures. */
const SIGNATURE_CONFIDENCE_PROBABILITY: Record<SignatureMatch['confidence'], number> = {
  low: 0.3,
  medium: 0.55,
  high: 0.8,
};

function failureRiskToDraft(
  risk: EscalationRisk,
  observationsById: ReadonlyMap<string, ObservationEvent>,
): SignalDraft {
  const obs = observationsById.get(risk.observationId);
  return {
    domain: risk.domain || UNKNOWN_DOMAIN,
    region: regionForObservation(obs),
    horizon: '24h',
    probability: Math.max(0, Math.min(1, risk.probability)),
    currentSeverity: risk.currentSeverity,
    projectedSeverity: risk.predictedSeverity,
    basis: 'failure-prediction',
    earlyWarning: `Escalation risk ${(risk.probability * 100).toFixed(0)}% (${risk.horizon}): ${risk.factors[0] ?? 'unspecified factor'}`,
  };
}

function anomalyToDraft(
  anomaly: AnomalyScore,
  observationsById: ReadonlyMap<string, ObservationEvent>,
): SignalDraft {
  const obs = observationsById.get(anomaly.observationId);
  return {
    domain: anomaly.domain || UNKNOWN_DOMAIN,
    region: regionForObservation(obs),
    horizon: '24h',
    probability: ANOMALY_PROBABILITY[anomaly.anomalyStrength],
    currentSeverity: obs?.severity ?? UNKNOWN_SEVERITY,
    projectedSeverity: obs?.severity ?? UNKNOWN_SEVERITY,
    basis: 'global-rhythm',
    earlyWarning: `Rhythm anomaly ${anomaly.anomalyStrength} (Δ ${anomaly.deviation.toFixed(2)})`,
  };
}

function trajectoryPointHorizon(point: TrajectoryPoint): ThreatHorizon {
  if (point.hoursFromNow <= 24) return '24h';
  if (point.hoursFromNow <= 48) return '48h';
  return '72h';
}

function trajectoryToDrafts(t: CrisisTrajectory): SignalDraft[] {
  if (t.trajectoryPoints.length === 0) return [];
  // Pick the highest-severity projection per horizon bucket so the
  // panel highlights the worst-case per window.
  const byHorizon = new Map<ThreatHorizon, TrajectoryPoint>();
  for (const point of t.trajectoryPoints) {
    const horizon = trajectoryPointHorizon(point);
    const existing = byHorizon.get(horizon);
    if (!existing || point.projectedSeverityNum > existing.projectedSeverityNum) {
      byHorizon.set(horizon, point);
    }
  }
  const out: SignalDraft[] = [];
  for (const [horizon, point] of byHorizon) {
    out.push({
      domain: t.domain || UNKNOWN_DOMAIN,
      region: DEFAULT_REGION,
      horizon,
      probability: Math.max(0, Math.min(1, point.confidence)),
      currentSeverity: severityLabel(t.currentSeverityNum),
      projectedSeverity: point.projectedSeverityLabel,
      basis: 'crisis-trajectory',
      earlyWarning: `Trajectory ${point.projectedSeverityLabel} at +${point.hoursFromNow}h (${(point.confidence * 100).toFixed(0)}% conf)`,
    });
  }
  return out;
}

function signatureMatchToDraft(
  match: SignatureMatch,
  lookup: (id: string) => string | undefined,
): SignalDraft {
  const domain = lookup(match.signatureId) ?? UNKNOWN_DOMAIN;
  return {
    domain,
    region: DEFAULT_REGION,
    horizon: '24h',
    probability: Math.max(SIGNATURE_CONFIDENCE_PROBABILITY[match.confidence], match.matchScore),
    currentSeverity: UNKNOWN_SEVERITY,
    projectedSeverity: UNKNOWN_SEVERITY,
    basis: 'crisis-signature',
    earlyWarning: `Pattern match "${match.signatureName}" (${match.confidence}, score ${(match.matchScore * 100).toFixed(0)}%)`,
  };
}

function severityLabel(num: number): string {
  if (num >= 3.5) return 'critical';
  if (num >= 2.5) return 'high';
  if (num >= 1.5) return 'medium';
  if (num >= 0.5) return 'low';
  return 'info';
}

function severityRank(label: string): number {
  switch (label) {
    case 'critical': { return 4;
    }
    case 'high': {     return 3;
    }
    case 'medium': {   return 2;
    }
    case 'low': {      return 1;
    }
    case 'info': {     return 0;
    }
    default: {         return -1;
    }
  }
}

function recommendedActionsFor(domain: string): string[] {
  const tmpl = RECOMMENDED_ACTION_TEMPLATES[domain] ?? RECOMMENDED_ACTION_TEMPLATES.default!;
  return [...tmpl];
}

function unionBasis(a: readonly ThreatBasis[], b: ThreatBasis): ThreatBasis[] {
  return a.includes(b) ? [...a] : [...a, b];
}

// ── Service ───────────────────────────────────────────────────────────

export interface ThreatHorizonOptions {
  clock?: () => number;
  providers?: ThreatProviders;
}

export class ThreatHorizonScanner {
  private threats: HorizonThreat[] = [];
  private listeners = new Set<HorizonListener>();
  private hydrated = false;
  private clock: () => number;
  private providers: ThreatProviders;
  private idCounter = 0;

  constructor(options: ThreatHorizonOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.providers = options.providers ?? {};
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
      const parsed: unknown = JSON.parse(raw);
      this.threats = deserialize(parsed);
    } catch {
      // Corrupt blob — start clean.
    }
  }

  private persist(): void {
    const store = safeStorage();
    if (!store) return;
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(this.threats));
    } catch {
      // Quota or disabled — best-effort.
    }
  }

  private notify(): void {
    const snapshot = this.threats.map((t) => cloneThreat(t));
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  private nextId(domain: string, region: string, horizon: ThreatHorizon, now: number): string {
    this.idCounter += 1;
    return `th-${domain}-${region}-${horizon}-${now.toString(36)}-${this.idCounter}`;
  }

  /** Pull signals from all wired providers, bucket onto 24h/48h/72h,
   *  merge by (domain, region, horizon), and persist the resulting
   *  HorizonThreats. Existing threats with the same (domain, region,
   *  horizon) key are replaced in place so the panel never shows
   *  multiple stale entries for the same forward window. */
  scan(observations: readonly ObservationEvent[]): HorizonThreat[] {
    this.ensureHydrated();
    const now = this.clock();
    const observationsById = new Map<string, ObservationEvent>();
    for (const o of observations) observationsById.set(o.id, o);
    const drafts = this.collectDrafts(observationsById);
    const merged = this.mergeDrafts(drafts, now);
    this.applyMergedThreats(merged);
    this.enforceCapacity();
    this.persist();
    this.notify();
    return this.threats.map((t) => cloneThreat(t));
  }

  private collectDrafts(observationsById: ReadonlyMap<string, ObservationEvent>): SignalDraft[] {
    const drafts: SignalDraft[] = [];
    const { failurePrediction, globalRhythm, crisisTrajectory, crisisSignature } = this.providers;
    if (failurePrediction) {
      for (const r of failurePrediction()) drafts.push(failureRiskToDraft(r, observationsById));
    }
    if (globalRhythm) {
      for (const a of globalRhythm()) {
        if (a.isAnomaly) drafts.push(anomalyToDraft(a, observationsById));
      }
    }
    if (crisisTrajectory) {
      for (const t of crisisTrajectory()) drafts.push(...trajectoryToDrafts(t));
    }
    if (crisisSignature) {
      const lookup = this.providers.signatureDomainLookup ?? (() => undefined);
      for (const m of crisisSignature()) drafts.push(signatureMatchToDraft(m, lookup));
    }
    return drafts;
  }

  private applyMergedThreats(merged: readonly HorizonThreat[]): void {
    for (const fresh of merged) {
      const existing = this.threats.findIndex(
        (t) => t.domain === fresh.domain && t.region === fresh.region && t.horizon === fresh.horizon,
      );
      if (existing === -1) {
        this.threats.push(fresh);
        continue;
      }
      const prior = this.threats[existing]!;
      // Operator dismissed this combo — keep the prior dismissed row,
      // suppress the freshly-emitted threat.
      if (prior.status === 'dismissed') continue;
      fresh.status = prior.status;
      fresh.id = prior.id;
      this.threats.splice(existing, 1);
      this.threats.push(fresh);
    }
  }

  private mergeDrafts(drafts: readonly SignalDraft[], now: number): HorizonThreat[] {
    const byKey = new Map<string, HorizonThreat>();
    for (const draft of drafts) {
      const key = `${draft.domain}::${draft.region}::${draft.horizon}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.probability = Math.max(existing.probability, draft.probability);
        existing.basis = unionBasis(existing.basis, draft.basis);
        if (!existing.earlyWarningSignals.includes(draft.earlyWarning)) {
          existing.earlyWarningSignals.push(draft.earlyWarning);
        }
        // Promote currentSeverity / projectedSeverity to the stronger
        // value when a contributor reports one.
        if (severityRank(draft.currentSeverity) > severityRank(existing.currentSeverity)) {
          existing.currentSeverity = draft.currentSeverity;
        }
        if (severityRank(draft.projectedSeverity) > severityRank(existing.projectedSeverity)) {
          existing.projectedSeverity = draft.projectedSeverity;
        }
        continue;
      }
      byKey.set(key, {
        id: this.nextId(draft.domain, draft.region, draft.horizon, now),
        domain: draft.domain,
        region: draft.region,
        currentSeverity: draft.currentSeverity,
        projectedSeverity: draft.projectedSeverity,
        horizon: draft.horizon,
        probability: draft.probability,
        basis: [draft.basis],
        earlyWarningSignals: [draft.earlyWarning],
        recommendedActions: recommendedActionsFor(draft.domain),
        detectedAt: now,
        status: 'watching',
      });
    }
    return [...byKey.values()];
  }

  private enforceCapacity(): void {
    if (this.threats.length <= MAX_THREATS) return;
    this.threats.splice(0, this.threats.length - MAX_THREATS);
  }

  /** All persisted threats (newest last). */
  getThreats(): HorizonThreat[] {
    this.ensureHydrated();
    return this.threats.map((t) => cloneThreat(t));
  }

  /** Threats filtered to a single horizon, ordered by probability desc. */
  getByHorizon(horizon: ThreatHorizon): HorizonThreat[] {
    this.ensureHydrated();
    return this.threats
      .filter((t) => t.horizon === horizon)
      .sort((a, b) => b.probability - a.probability)
      .map((t) => cloneThreat(t));
  }

  /** Operator action — mark this threat as dismissed. Subsequent
   *  scans for the same (domain, region, horizon) won't resurface it. */
  dismiss(id: string, reason?: string): void {
    this.ensureHydrated();
    const target = this.threats.find((t) => t.id === id);
    if (!target) return;
    target.status = 'dismissed';
    if (reason && reason.length > 0) {
      target.earlyWarningSignals.push(`Dismissed: ${reason}`);
    }
    this.persist();
    this.notify();
  }

  /** Operator action — escalate a watching threat so downstream
   *  consumers (alerts / panels) treat it as active. */
  markEscalating(id: string): void {
    this.ensureHydrated();
    const target = this.threats.find((t) => t.id === id);
    if (!target) return;
    target.status = 'escalating';
    this.persist();
    this.notify();
  }

  subscribe(listener: HorizonListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test seam — empties threats + drops listeners + clears storage. */
  resetForTesting(): void {
    this.threats = [];
    this.listeners.clear();
    this.idCounter = 0;
    this.hydrated = true;
    const store = safeStorage();
    if (store) {
      try { store.removeItem(STORAGE_KEY); } catch { /* best effort */ }
    }
  }
}

// ── Persistence helpers ──────────────────────────────────────────────

function cloneThreat(t: HorizonThreat): HorizonThreat {
  return {
    ...t,
    basis: [...t.basis],
    earlyWarningSignals: [...t.earlyWarningSignals],
    recommendedActions: [...t.recommendedActions],
  };
}

function asValidThreat(entry: unknown): HorizonThreat | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as HorizonThreat;
  if (typeof e.id !== 'string' || typeof e.domain !== 'string' || typeof e.region !== 'string') return undefined;
  if (typeof e.probability !== 'number' || typeof e.detectedAt !== 'number') return undefined;
  if (!Array.isArray(e.basis) || !Array.isArray(e.earlyWarningSignals) || !Array.isArray(e.recommendedActions)) return undefined;
  if (!ALL_HORIZONS.includes(e.horizon)) return undefined;
  if (e.status !== 'watching' && e.status !== 'escalating' && e.status !== 'dismissed') return undefined;
  return cloneThreat(e);
}

function deserialize(raw: unknown): HorizonThreat[] {
  if (!Array.isArray(raw)) return [];
  const out: HorizonThreat[] = [];
  for (const entry of raw) {
    const valid = asValidThreat(entry);
    if (valid) out.push(valid);
  }
  return out;
}

// ── Singleton ─────────────────────────────────────────────────────────

let _singleton: ThreatHorizonScanner | null = null;

export function getThreatHorizonScanner(): ThreatHorizonScanner {
  _singleton ??= new ThreatHorizonScanner();
  return _singleton;
}

/** Test seam — replaces the singleton with a fresh instance. */
export function __resetThreatHorizonSingleton(): void {
  _singleton = null;
}

export const __internals = {
  STORAGE_KEY,
  MAX_THREATS,
  ALL_HORIZONS,
  ANOMALY_PROBABILITY,
  SIGNATURE_CONFIDENCE_PROBABILITY,
  regionForObservation,
  trajectoryPointHorizon,
  severityRank,
  severityLabel,
  recommendedActionsFor,
};
