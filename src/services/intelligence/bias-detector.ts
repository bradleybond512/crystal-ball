/**
 * Cognitive bias detector — scans Crystal Ball's own output patterns
 * for signs that the model is anchoring on early evidence, over-
 * representing recent dramatic events, ignoring contradicting signals,
 * drifting upward without new corroboration, neglecting a chronically
 * dismissed domain, or being overconfident relative to its outcomes.
 *
 * Each detector is a pure function so unit tests can call it directly
 * without touching storage. The service wraps the detectors with a
 * persisted signal ring + acknowledgement workflow + subscriber fan-out.
 */

// ── Public types ─────────────────────────────────────────────────────────

export type BiasType =
  | 'anchoring' | 'availability' | 'confirmation'
  | 'recency' | 'domain-neglect' | 'overconfidence';

export type BiasSeverity = 'advisory' | 'warning' | 'alert';

export type BiasRisk = 'low' | 'medium' | 'high';

export interface BiasSignal {
  id: string;
  type: BiasType;
  domain: string;
  severity: BiasSeverity;
  description: string;
  evidence: string;
  recommendation: string;
  affectedTargetIds: string[];
  detectedAt: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
}

export interface BiasReport {
  generatedAt: Date;
  signals: BiasSignal[];
  dominantBias: BiasType | null;
  overallBiasRisk: BiasRisk;
  recommendation: string;
}

export interface BiasDriverScore {
  observationId: string;
  situationId?: string;
  domain: string;
  finalScore: number;
  derivedSeverity?: 'low' | 'medium' | 'high' | 'critical';
  observedAt?: Date;
}

export interface BiasSituation {
  id: string;
  domain: string;
  confidence: number;
  latestConfidenceDelta: number;
  addedObservationsInLastUpdate: number;
  updatedAt: Date;
}

export interface BiasHypothesisSet {
  id: string;
  domain: string;
  leadingPosterior: number;
  contradictingObservationCount: number;
  createdAt: Date;
}

export interface BiasOutcomeRecord {
  domain: string;
  actualOutcome:
    | 'dismissed' | 'acted-on' | 'confirmed-real'
    | 'marked-false-positive' | 'escalated' | 'de-escalated';
  predictedSeverity: 'low' | 'medium' | 'high' | 'critical';
  recordedAt: Date;
}

export interface BiasMetaConfidence {
  domain: string;
  metaConfidence: number;
}

export interface BiasScanInput {
  situations: BiasSituation[];
  driverScores: BiasDriverScore[];
  hypothesisSets: BiasHypothesisSet[];
  outcomeRecords: BiasOutcomeRecord[];
  metaEstimates: BiasMetaConfidence[];
  /** Domain → 30d rolling mean finalScore. Caller-supplied so the
   *  detector stays pure and doesn't track its own history. */
  domainRollingAverages?: Record<string, number>;
  now?: Date;
}

export interface BiasStats {
  total: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  acknowledgedRate: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BiasDetectorService {
  scan(input: BiasScanInput): BiasReport;
  acknowledge(signalId: string): void;
  getActive(): BiasSignal[];
  getHistory(sinceMs?: number, now?: Date): BiasSignal[];
  stats(): BiasStats;
  subscribe(cb: (signals: BiasSignal[]) => void): () => void;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-bias-signals';
export const MAX_SIGNALS = 500;

const ANCHORING_WARNING_RATIO = 2;
const ANCHORING_ALERT_RATIO = 3;
const AVAILABILITY_WARNING_RATIO = 1.5;
const AVAILABILITY_ALERT_RATIO = 2;
const CONFIRMATION_AGE_MS = 12 * 60 * 60_000;
const CONFIRMATION_POSTERIOR_WARN = 0.7;
const CONFIRMATION_POSTERIOR_ALERT = 0.85;
const RECENCY_WARN_DELTA = 0.15;
const RECENCY_ALERT_DELTA = 0.25;
const DOMAIN_NEGLECT_MIN = 5;
const DOMAIN_NEGLECT_WARN = 0.6;
const DOMAIN_NEGLECT_ALERT = 0.8;
const OVERCONF_META_MIN = 0.8;
const OVERCONF_GAP_WARN = 0.3;
const OVERCONF_GAP_ALERT = 0.5;
const OVERCONF_MIN_SAMPLES = 5;

// ── Helpers ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(type: BiasType): string {
  _idCounter += 1;
  return `bias-${type}-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}

function groupBy<T, K extends string>(items: readonly T[], key: (t: T) => K | undefined): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    const arr = out.get(k);
    if (arr) arr.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

const SEVERITY_RANK: Record<BiasSeverity, number> = { advisory: 0, warning: 1, alert: 2 };

function bandFromRatio(ratio: number, warnAt: number, alertAt: number): BiasSeverity {
  if (ratio >= alertAt) return 'alert';
  if (ratio >= warnAt) return 'warning';
  return 'advisory';
}

function bandFromDelta(delta: number, warnAt: number, alertAt: number): BiasSeverity {
  return bandFromRatio(delta, warnAt, alertAt);
}

// ── Detectors (pure) ─────────────────────────────────────────────────────

export function detectAnchoring(
  driverScores: readonly BiasDriverScore[],
  now: Date,
): BiasSignal[] {
  const groups = groupBy(driverScores, (d) => d.situationId);
  const signals: BiasSignal[] = [];
  for (const [situationId, group] of groups) {
    if (group.length < 3) continue;
    const sorted = [...group].sort((a, b) => {
      const aTime = a.observedAt ? a.observedAt.getTime() : 0;
      const bTime = b.observedAt ? b.observedAt.getTime() : 0;
      return aTime - bTime;
    });
    const first = sorted[0]!.finalScore;
    const restMean = mean(sorted.slice(1).map((d) => d.finalScore));
    if (restMean <= 0) continue;
    const ratio = first / restMean;
    if (ratio < ANCHORING_WARNING_RATIO) continue;
    signals.push({
      id: nextId('anchoring'),
      type: 'anchoring',
      domain: sorted[0]!.domain,
      severity: bandFromRatio(ratio, ANCHORING_WARNING_RATIO, ANCHORING_ALERT_RATIO),
      description: `Anchoring detected: first observation weight ${ratio.toFixed(1)}× higher than subsequent ones.`,
      evidence: `Situation ${situationId}: first score ${first.toFixed(2)} vs mean ${restMean.toFixed(2)} across ${sorted.length - 1} later observations.`,
      recommendation: 'Re-run analysis with the first observation excluded, or weight it down toward the mean.',
      affectedTargetIds: [situationId],
      detectedAt: now,
      acknowledged: false,
    });
  }
  return signals;
}

export function detectAvailability(
  driverScores: readonly BiasDriverScore[],
  rollingAverages: Readonly<Record<string, number>>,
  now: Date,
): BiasSignal[] {
  const byDomain = groupBy(driverScores, (d) => d.domain);
  const signals: BiasSignal[] = [];
  for (const [domain, group] of byDomain) {
    const baseline = rollingAverages[domain];
    if (baseline === undefined || baseline <= 0) continue;
    const currentMean = mean(group.map((d) => d.finalScore));
    const ratio = currentMean / baseline;
    if (ratio < AVAILABILITY_WARNING_RATIO) continue;
    signals.push({
      id: nextId('availability'),
      type: 'availability',
      domain,
      severity: bandFromRatio(ratio, AVAILABILITY_WARNING_RATIO, AVAILABILITY_ALERT_RATIO),
      description: `Availability bias: ${domain} scores running ${((ratio - 1) * 100).toFixed(0)}% above 30-day average.`,
      evidence: `Current mean finalScore ${currentMean.toFixed(2)} vs 30-day baseline ${baseline.toFixed(2)}.`,
      recommendation: 'Discount recency in the next aggregation pass and confirm whether new data justifies the lift.',
      affectedTargetIds: group.map((g) => g.observationId),
      detectedAt: now,
      acknowledged: false,
    });
  }
  return signals;
}

export function detectConfirmation(
  hypothesisSets: readonly BiasHypothesisSet[],
  now: Date,
): BiasSignal[] {
  const out: BiasSignal[] = [];
  for (const set of hypothesisSets) {
    if (set.contradictingObservationCount > 0) continue;
    if (set.leadingPosterior < CONFIRMATION_POSTERIOR_WARN) continue;
    const ageMs = now.getTime() - set.createdAt.getTime();
    if (ageMs < CONFIRMATION_AGE_MS) continue;
    out.push({
      id: nextId('confirmation'),
      type: 'confirmation',
      domain: set.domain,
      severity: set.leadingPosterior >= CONFIRMATION_POSTERIOR_ALERT ? 'alert' : 'warning',
      description: `Confirmation bias: hypothesis ${set.id} has run ${Math.round(ageMs / 60_000 / 60)}h without a single contradicting observation while posterior ${set.leadingPosterior.toFixed(2)} climbs.`,
      evidence: `0 contradicting observations recorded; posterior ${set.leadingPosterior.toFixed(2)}.`,
      recommendation: 'Actively look for counter-evidence; run the skeptic prompt or flip-the-script analysis.',
      affectedTargetIds: [set.id],
      detectedAt: now,
      acknowledged: false,
    });
  }
  return out;
}

export function detectRecency(
  situations: readonly BiasSituation[],
  now: Date,
): BiasSignal[] {
  const out: BiasSignal[] = [];
  for (const sit of situations) {
    if (sit.addedObservationsInLastUpdate > 0) continue;
    if (sit.latestConfidenceDelta < RECENCY_WARN_DELTA) continue;
    out.push({
      id: nextId('recency'),
      type: 'recency',
      domain: sit.domain,
      severity: bandFromDelta(sit.latestConfidenceDelta, RECENCY_WARN_DELTA, RECENCY_ALERT_DELTA),
      description: `Recency drift: situation ${sit.id} confidence rose by ${sit.latestConfidenceDelta.toFixed(2)} without new corroborating observations.`,
      evidence: `Confidence delta ${sit.latestConfidenceDelta.toFixed(2)} during the last update; 0 new observations added.`,
      recommendation: 'Decay confidence on time alone; require fresh observations to sustain elevation.',
      affectedTargetIds: [sit.id],
      detectedAt: now,
      acknowledged: false,
    });
  }
  return out;
}

const DISMISS_ACTIONS: ReadonlySet<BiasOutcomeRecord['actualOutcome']> = new Set([
  'dismissed', 'marked-false-positive',
]);
const SUCCESS_ACTIONS: ReadonlySet<BiasOutcomeRecord['actualOutcome']> = new Set([
  'acted-on', 'confirmed-real',
]);

function severityAtLeastMedium(s: BiasDriverScore['derivedSeverity']): boolean {
  return s === 'medium' || s === 'high' || s === 'critical';
}

export function detectDomainNeglect(
  outcomeRecords: readonly BiasOutcomeRecord[],
  driverScores: readonly BiasDriverScore[],
  now: Date,
): BiasSignal[] {
  const out: BiasSignal[] = [];
  const byDomain = groupBy(outcomeRecords, (r) => r.domain);
  for (const [domain, group] of byDomain) {
    if (group.length < DOMAIN_NEGLECT_MIN) continue;
    const dismissed = group.filter((r) => DISMISS_ACTIONS.has(r.actualOutcome)).length;
    const rate = dismissed / group.length;
    if (rate < DOMAIN_NEGLECT_WARN) continue;
    const hasMediumPlus = driverScores.some(
      (d) => d.domain === domain && severityAtLeastMedium(d.derivedSeverity),
    );
    if (!hasMediumPlus) continue;
    out.push({
      id: nextId('domain-neglect'),
      type: 'domain-neglect',
      domain,
      severity: rate >= DOMAIN_NEGLECT_ALERT ? 'alert' : 'warning',
      description: `Domain neglect: ${(rate * 100).toFixed(0)}% of recent ${domain} outcomes were dismissed, yet scores remain medium or higher.`,
      evidence: `${dismissed} of ${group.length} recent outcomes dismissed.`,
      recommendation: 'Either tighten the domain weights or stop surfacing medium-and-higher alerts from this source.',
      affectedTargetIds: [domain],
      detectedAt: now,
      acknowledged: false,
    });
  }
  return out;
}

export function detectOverconfidence(
  metaEstimates: readonly BiasMetaConfidence[],
  outcomeRecords: readonly BiasOutcomeRecord[],
  now: Date,
): BiasSignal[] {
  const out: BiasSignal[] = [];
  const byDomain = groupBy(outcomeRecords, (r) => r.domain);
  for (const m of metaEstimates) {
    if (m.metaConfidence < OVERCONF_META_MIN) continue;
    const records = byDomain.get(m.domain) ?? [];
    if (records.length < OVERCONF_MIN_SAMPLES) continue;
    const successes = records.filter((r) => SUCCESS_ACTIONS.has(r.actualOutcome)).length;
    const accuracy = successes / records.length;
    if (accuracy >= 0.5) continue;
    const gap = m.metaConfidence - accuracy;
    out.push({
      id: nextId('overconfidence'),
      type: 'overconfidence',
      domain: m.domain,
      severity: bandFromDelta(gap, OVERCONF_GAP_WARN, OVERCONF_GAP_ALERT),
      description: `Overconfidence: meta-confidence ${m.metaConfidence.toFixed(2)} but observed accuracy ${accuracy.toFixed(2)}.`,
      evidence: `${successes} of ${records.length} outcomes succeeded; meta-confidence reports ${m.metaConfidence.toFixed(2)}.`,
      recommendation: 'Recalibrate the meta-confidence estimator against this domain; trust its self-assessment less for now.',
      affectedTargetIds: [m.domain],
      detectedAt: now,
      acknowledged: false,
    });
  }
  return out;
}

// ── Aggregation ──────────────────────────────────────────────────────────

export function computeOverallRisk(signals: readonly BiasSignal[]): BiasRisk {
  let maxRank = 0;
  for (const s of signals) {
    if (s.acknowledged) continue;
    const rank = SEVERITY_RANK[s.severity];
    if (rank > maxRank) maxRank = rank;
  }
  if (maxRank >= SEVERITY_RANK.alert) return 'high';
  if (maxRank >= SEVERITY_RANK.warning) return 'medium';
  return 'low';
}

export function computeDominantBias(signals: readonly BiasSignal[]): BiasType | null {
  const counts = new Map<BiasType, number>();
  for (const s of signals) {
    if (s.acknowledged) continue;
    counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
  }
  let best: BiasType | null = null;
  let bestCount = 0;
  for (const [t, c] of counts) {
    if (c > bestCount) { best = t; bestCount = c; }
  }
  return best;
}

// ── Persistence + service ────────────────────────────────────────────────

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function serializeSignal(s: BiasSignal): unknown {
  return {
    ...s,
    detectedAt: s.detectedAt.toISOString(),
    acknowledgedAt: s.acknowledgedAt ? s.acknowledgedAt.toISOString() : undefined,
  };
}

function deserializeSignal(raw: unknown): BiasSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.type !== 'string') return null;
  const detectedAtRaw = r.detectedAt;
  const detectedAt = typeof detectedAtRaw === 'string' ? new Date(detectedAtRaw) : null;
  if (!detectedAt || Number.isNaN(detectedAt.getTime())) return null;
  const ackRaw = r.acknowledgedAt;
  let acknowledgedAt: Date | undefined;
  if (typeof ackRaw === 'string') {
    const d = new Date(ackRaw);
    if (!Number.isNaN(d.getTime())) acknowledgedAt = d;
  }
  return {
    id: r.id,
    type: r.type as BiasType,
    domain: typeof r.domain === 'string' ? r.domain : 'unknown',
    severity: (r.severity === 'advisory' || r.severity === 'warning' || r.severity === 'alert')
      ? r.severity : 'advisory',
    description: typeof r.description === 'string' ? r.description : '',
    evidence: typeof r.evidence === 'string' ? r.evidence : '',
    recommendation: typeof r.recommendation === 'string' ? r.recommendation : '',
    affectedTargetIds: Array.isArray(r.affectedTargetIds) ? r.affectedTargetIds.map(String) : [],
    detectedAt,
    acknowledged: !!r.acknowledged,
    acknowledgedAt,
  };
}

function rehydrate(storage: StorageLike | null): BiasSignal[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); }
  catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: BiasSignal[] = [];
  for (const p of parsed) {
    const s = deserializeSignal(p);
    if (s) out.push(s);
  }
  return out;
}

function recommendation(dominant: BiasType | null, risk: BiasRisk): string {
  if (!dominant || risk === 'low') {
    return 'No active bias signals — model output patterns look balanced.';
  }
  switch (dominant) {
    case 'anchoring': { return 'Down-weight or re-run analysis without the first observation.';
    }
    case 'availability': { return 'Apply a recency discount to the dominant domain.';
    }
    case 'confirmation': { return 'Run the skeptic prompt to surface counter-evidence.';
    }
    case 'recency': { return 'Decay confidence on time alone; require fresh observations.';
    }
    case 'domain-neglect': { return 'Either tighten weights or stop surfacing medium-and-higher alerts for the affected domain.';
    }
    case 'overconfidence': { return 'Recalibrate meta-confidence; trust its self-assessment less for now.';
    }
  }
}

export interface BiasDetectorOptions {
  storage?: StorageLike | null;
}

export function createBiasDetectorService(options: BiasDetectorOptions = {}): BiasDetectorService {
  const storage = resolveLocalStorage(options.storage);
  let signals: BiasSignal[] = rehydrate(storage);
  const listeners = new Set<(s: BiasSignal[]) => void>();

  function persist(): void {
    if (!storage) return;
    try {
      const payload = signals.map((s) => serializeSignal(s));
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { /* quota / private-mode — non-critical */ }
  }

  function notify(): void {
    const snapshot = signals.map((s) => ({ ...s,
      detectedAt: new Date(s.detectedAt),
      acknowledgedAt: s.acknowledgedAt ? new Date(s.acknowledgedAt) : undefined }));
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  function pushAndCap(newSignals: BiasSignal[]): BiasSignal[] {
    signals = [...signals, ...newSignals];
    if (signals.length > MAX_SIGNALS) {
      signals.splice(0, signals.length - MAX_SIGNALS);
    }
    return newSignals;
  }

  return {
    scan(input): BiasReport {
      const now = input.now ?? new Date();
      const fresh: BiasSignal[] = [
        ...detectAnchoring(input.driverScores, now),
        ...detectAvailability(input.driverScores, input.domainRollingAverages ?? {}, now),
        ...detectConfirmation(input.hypothesisSets, now),
        ...detectRecency(input.situations, now),
        ...detectDomainNeglect(input.outcomeRecords, input.driverScores, now),
        ...detectOverconfidence(input.metaEstimates, input.outcomeRecords, now),
      ];
      const stored = pushAndCap(fresh);
      const active = signals.filter((s) => !s.acknowledged);
      const dominantBias = computeDominantBias(active);
      const overallBiasRisk = computeOverallRisk(active);
      persist();
      notify();
      return {
        generatedAt: now,
        signals: stored.map((s) => ({ ...s, detectedAt: new Date(s.detectedAt) })),
        dominantBias,
        overallBiasRisk,
        recommendation: recommendation(dominantBias, overallBiasRisk),
      };
    },

    acknowledge(signalId): void {
      const found = signals.find((s) => s.id === signalId);
      if (!found || found.acknowledged) return;
      found.acknowledged = true;
      found.acknowledgedAt = new Date();
      persist();
      notify();
    },

    getActive(): BiasSignal[] {
      return signals.filter((s) => !s.acknowledged).map((s) => ({ ...s,
        detectedAt: new Date(s.detectedAt) }));
    },

    getHistory(sinceMs, now): BiasSignal[] {
      if (sinceMs === undefined) return signals.map((s) => ({ ...s,
        detectedAt: new Date(s.detectedAt) }));
      const floor = (now ?? new Date()).getTime() - sinceMs;
      return signals
        .filter((s) => s.detectedAt.getTime() >= floor)
        .map((s) => ({ ...s, detectedAt: new Date(s.detectedAt) }));
    },

    stats(): BiasStats {
      const byType: Record<string, number> = {};
      const bySeverity: Record<string, number> = {};
      let acked = 0;
      for (const s of signals) {
        byType[s.type] = (byType[s.type] ?? 0) + 1;
        bySeverity[s.severity] = (bySeverity[s.severity] ?? 0) + 1;
        if (s.acknowledged) acked += 1;
      }
      return {
        total: signals.length,
        byType,
        bySeverity,
        acknowledgedRate: signals.length === 0 ? 0 : acked / signals.length,
      };
    },

    subscribe(cb): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}

// ── Lazy singleton ───────────────────────────────────────────────────────

let _singleton: BiasDetectorService | null = null;

export function getBiasDetectorService(): BiasDetectorService {
  _singleton ??= createBiasDetectorService();
  return _singleton;
}

export function _resetBiasDetectorSingletonForTests(): void {
  _singleton = null;
}
