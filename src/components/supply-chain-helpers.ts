/**
 * Pure helpers shared by SupplyChainResiliencePanel — extracted so tests
 * can import them without dragging in the Panel base class / i18n / Vite
 * glob machinery.
 *
 * No DOM imports, no fetch, no globals. Every helper takes the data it
 * needs as a parameter so it can be exercised with deterministic fixtures.
 *
 * Seven domains:
 *   1. computeStressIndex        — composite 0..100 + band + top driver
 *   2. summarizeSemiconductorShortages — per-node lead-time severity
 *   3. summarizeScarcity         — critical-goods rows (severity + age)
 *   4. summarizeFactoryShutdowns — shutdown events sorted by impact
 *   5. detectFreightAnomalies    — lane-level rate deviation classification
 *   6. computeJitRisk            — days-of-cover vs safety threshold
 *   7. summarizeNearshoring      — sector direction + confidence-weighted overall
 */

// ── Stress index ─────────────────────────────────────────────────────

export type StressBand = 'low' | 'moderate' | 'elevated' | 'severe' | 'critical';

/** Component scores feeding the composite stress index. Each is a
 *  `[0, 100]` value sourced upstream (each domain's own service produces
 *  one). Callers may pass values outside the range; the helper clamps. */
export interface StressInput {
  freightAnomalyScore: number;
  factoryShutdownScore: number;
  semisShortageScore: number;
  scarcityScore: number;
  jitRiskScore: number;
}

/** Weights sum to 1.0. Factory shutdowns are weighted heaviest because
 *  they are already-observed disruptions rather than leading signals. */
export const STRESS_WEIGHTS: Readonly<Record<keyof StressInput, number>> = {
  factoryShutdownScore: 0.25,
  freightAnomalyScore: 0.2,
  semisShortageScore: 0.2,
  scarcityScore: 0.2,
  jitRiskScore: 0.15,
};

/** Human label for each input field — used by `topDriver`. */
export const STRESS_COMPONENT_LABEL: Readonly<Record<keyof StressInput, string>> = {
  freightAnomalyScore: 'Freight',
  factoryShutdownScore: 'Factory shutdowns',
  semisShortageScore: 'Semiconductors',
  scarcityScore: 'Critical-goods scarcity',
  jitRiskScore: 'Just-in-time inventory',
};

export interface StressIndex {
  score: number;
  band: StressBand;
  /** Human-labelled name of the component with the largest weighted
   *  contribution (`weight * clampedScore`). `null` only when every
   *  component is exactly zero. */
  topDriver: string | null;
  /** Per-component weighted contribution. Sums to `score`. */
  weightedContributions: Readonly<Record<keyof StressInput, number>>;
}

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

export function computeStressIndex(input: StressInput): StressIndex {
  const contributions: Record<keyof StressInput, number> = {
    freightAnomalyScore: 0,
    factoryShutdownScore: 0,
    semisShortageScore: 0,
    scarcityScore: 0,
    jitRiskScore: 0,
  };
  let score = 0;
  let topKey: keyof StressInput | null = null;
  let topValue = 0;
  for (const key of Object.keys(STRESS_WEIGHTS) as (keyof StressInput)[]) {
    const clamped = clamp100(input[key]);
    const contribution = clamped * STRESS_WEIGHTS[key];
    contributions[key] = Math.round(contribution * 100) / 100;
    score += contribution;
    if (contribution > topValue) {
      topValue = contribution;
      topKey = key;
    }
  }
  const rounded = Math.round(score);
  return {
    score: rounded,
    band: bandForStressScore(rounded),
    topDriver: topKey === null ? null : STRESS_COMPONENT_LABEL[topKey],
    weightedContributions: contributions,
  };
}

export function bandForStressScore(score: number): StressBand {
  if (score < 20) return 'low';
  if (score < 40) return 'moderate';
  if (score < 60) return 'elevated';
  if (score < 80) return 'severe';
  return 'critical';
}

// ── Semiconductor shortages ──────────────────────────────────────────

export type ProcessNode = '28nm' | '14nm' | '7nm' | '5nm' | '3nm' | 'legacy';

export type ShortageSeverity = 'low' | 'moderate' | 'severe';

export interface SemiconductorSnapshot {
  node: ProcessNode;
  leadTimeWeeks: number;
  baselineLeadTimeWeeks: number;
  affectedSectors: readonly string[];
}

export interface SemiconductorShortageRow {
  node: ProcessNode;
  leadTimeWeeks: number;
  baselineLeadTimeWeeks: number;
  ratio: number;
  weeksOverBaseline: number;
  severity: ShortageSeverity;
  affectedSectors: readonly string[];
}

/** Severity from the ratio of current → baseline lead time. A `1.0`
 *  ratio means lead times match baseline (low). A `2.0` means lead
 *  times have doubled (severe). */
export function severityForLeadTime(currentWeeks: number, baselineWeeks: number): ShortageSeverity {
  if (baselineWeeks <= 0 || !Number.isFinite(baselineWeeks)) return 'low';
  const ratio = currentWeeks / baselineWeeks;
  if (ratio >= 2) return 'severe';
  if (ratio >= 1.25) return 'moderate';
  return 'low';
}

const SHORTAGE_SEVERITY_RANK: Record<ShortageSeverity, number> = {
  severe: 2, moderate: 1, low: 0,
};

/** Sorted severe-first, then by weeks-over-baseline desc. */
export function summarizeSemiconductorShortages(
  snapshots: readonly SemiconductorSnapshot[],
): SemiconductorShortageRow[] {
  const rows: SemiconductorShortageRow[] = snapshots.map((s) => {
    const ratio = s.baselineLeadTimeWeeks > 0
      ? s.leadTimeWeeks / s.baselineLeadTimeWeeks
      : 1;
    return {
      node: s.node,
      leadTimeWeeks: s.leadTimeWeeks,
      baselineLeadTimeWeeks: s.baselineLeadTimeWeeks,
      ratio: Math.round(ratio * 100) / 100,
      weeksOverBaseline: Math.max(0, s.leadTimeWeeks - s.baselineLeadTimeWeeks),
      severity: severityForLeadTime(s.leadTimeWeeks, s.baselineLeadTimeWeeks),
      affectedSectors: s.affectedSectors,
    };
  });
  rows.sort((a, b) => {
    const ra = SHORTAGE_SEVERITY_RANK[a.severity];
    const rb = SHORTAGE_SEVERITY_RANK[b.severity];
    if (ra !== rb) return rb - ra;
    return b.weeksOverBaseline - a.weeksOverBaseline;
  });
  return rows;
}

// ── Critical-goods scarcity ──────────────────────────────────────────

export type ScarcitySeverity = 'low' | 'moderate' | 'severe';

export interface ScarcitySignal {
  good: string;
  severity: ScarcitySeverity;
  region: string;
  observedAt: number;
  source: string;
}

export interface ScarcityRow {
  good: string;
  severity: ScarcitySeverity;
  region: string;
  ageLabel: string;
  source: string;
}

const SCARCITY_SEVERITY_RANK: Record<ScarcitySeverity, number> = {
  severe: 2, moderate: 1, low: 0,
};

/** Sorted severe-first, then most-recently-observed first. */
export function summarizeScarcity(
  signals: readonly ScarcitySignal[],
  nowMs: number,
): ScarcityRow[] {
  const rows = signals.map((s) => ({
    good: s.good,
    severity: s.severity,
    region: s.region,
    ageLabel: formatAge(s.observedAt, nowMs),
    source: s.source,
  }));
  rows.sort((a, b) => {
    const ra = SCARCITY_SEVERITY_RANK[a.severity];
    const rb = SCARCITY_SEVERITY_RANK[b.severity];
    if (ra !== rb) return rb - ra;
    // Tiebreak: more recent (smaller ageLabel) first — done at source
    // input level since rows have already lost the numeric timestamp.
    const ai = signals.findIndex((x) => x.good === a.good && x.region === a.region && x.source === a.source);
    const bi = signals.findIndex((x) => x.good === b.good && x.region === b.region && x.source === b.source);
    return (signals[bi]?.observedAt ?? 0) - (signals[ai]?.observedAt ?? 0);
  });
  return rows;
}

// ── Factory shutdowns ────────────────────────────────────────────────

export type ShutdownCause =
  | 'weather'
  | 'unrest'
  | 'power'
  | 'strike'
  | 'cyber'
  | 'fire'
  | 'other';

export interface FactoryShutdown {
  id: string;
  facility: string;
  region: string;
  cause: ShutdownCause;
  startedAt: number;
  /** Hours the shutdown is expected to last. `null` when unknown. */
  expectedDurationHours: number | null;
  /** Caller-supplied impact score `[0, 100]` (clamped). */
  impactScore: number;
}

export interface FactoryShutdownRow {
  id: string;
  facility: string;
  region: string;
  cause: ShutdownCause;
  ageLabel: string;
  durationLabel: string;
  impactScore: number;
}

/** Sorted by impactScore desc, then most-recent first. */
export function summarizeFactoryShutdowns(
  shutdowns: readonly FactoryShutdown[],
  nowMs: number,
): FactoryShutdownRow[] {
  const rows = shutdowns.map((s) => ({
    id: s.id,
    facility: s.facility,
    region: s.region,
    cause: s.cause,
    ageLabel: formatAge(s.startedAt, nowMs),
    durationLabel: s.expectedDurationHours === null
      ? 'unknown'
      : formatDuration(s.expectedDurationHours * 3_600_000),
    impactScore: clamp100(s.impactScore),
  }));
  rows.sort((a, b) => {
    if (a.impactScore !== b.impactScore) return b.impactScore - a.impactScore;
    const sa = shutdowns.find((x) => x.id === a.id)?.startedAt ?? 0;
    const sb = shutdowns.find((x) => x.id === b.id)?.startedAt ?? 0;
    return sb - sa;
  });
  return rows;
}

// ── Freight rate anomalies ───────────────────────────────────────────

export type FreightClassification = 'spike' | 'normal' | 'depressed';

export interface FreightLaneSnapshot {
  lane: string;
  currentRateUsd: number;
  baselineRateUsd: number;
}

export interface FreightAnomaly {
  lane: string;
  currentRateUsd: number;
  baselineRateUsd: number;
  /** Percentage delta vs baseline, rounded to one decimal. `+50.0`
   *  means rates are 1.5× baseline. */
  percentDelta: number;
  classification: FreightClassification;
  severity: ShortageSeverity;
}

/** Bands: `|pct| < 15 → normal`, `pct >= 15 → spike`, `pct <= -15 → depressed`. */
export function classifyFreightDelta(percentDelta: number): FreightClassification {
  if (percentDelta >= 15) return 'spike';
  if (percentDelta <= -15) return 'depressed';
  return 'normal';
}

/** Severity based on absolute deviation: `<25 → low`, `<50 → moderate`,
 *  `>=50 → severe`. Inputs are percentage deltas, not ratios. */
export function severityForFreightDelta(percentDelta: number): ShortageSeverity {
  const abs = Math.abs(percentDelta);
  if (abs >= 50) return 'severe';
  if (abs >= 25) return 'moderate';
  return 'low';
}

/** Returns one anomaly entry per lane. Lanes with baseline `<= 0` are
 *  omitted entirely (can't compute a deviation). */
export function detectFreightAnomalies(
  snapshots: readonly FreightLaneSnapshot[],
): FreightAnomaly[] {
  const out: FreightAnomaly[] = [];
  for (const s of snapshots) {
    if (s.baselineRateUsd <= 0 || !Number.isFinite(s.baselineRateUsd)) continue;
    const pct = ((s.currentRateUsd - s.baselineRateUsd) / s.baselineRateUsd) * 100;
    const rounded = Math.round(pct * 10) / 10;
    out.push({
      lane: s.lane,
      currentRateUsd: s.currentRateUsd,
      baselineRateUsd: s.baselineRateUsd,
      percentDelta: rounded,
      classification: classifyFreightDelta(rounded),
      severity: severityForFreightDelta(rounded),
    });
  }
  out.sort((a, b) => Math.abs(b.percentDelta) - Math.abs(a.percentDelta));
  return out;
}

// ── Just-in-time inventory risk ──────────────────────────────────────

export type JitBand = 'safe' | 'watch' | 'at_risk' | 'critical';

export interface JitInventorySnapshot {
  sector: string;
  daysOfCover: number;
  safetyThresholdDays: number;
}

export interface JitRiskRow {
  sector: string;
  daysOfCover: number;
  safetyThresholdDays: number;
  shortfallDays: number;
  riskBand: JitBand;
}

/** Bands:
 *  - `safe`     — daysOfCover >= safety
 *  - `watch`    — shortfall <= 25 % of safety
 *  - `at_risk`  — shortfall <= 60 % of safety
 *  - `critical` — shortfall > 60 % of safety, or daysOfCover <= 0
 */
export function bandForJitRisk(daysOfCover: number, safetyThresholdDays: number): JitBand {
  if (safetyThresholdDays <= 0 || !Number.isFinite(safetyThresholdDays)) return 'safe';
  if (daysOfCover <= 0) return 'critical';
  if (daysOfCover >= safetyThresholdDays) return 'safe';
  const shortfall = safetyThresholdDays - daysOfCover;
  const pct = shortfall / safetyThresholdDays;
  if (pct <= 0.25) return 'watch';
  if (pct <= 0.6) return 'at_risk';
  return 'critical';
}

const JIT_BAND_RANK: Record<JitBand, number> = {
  critical: 3, at_risk: 2, watch: 1, safe: 0,
};

/** Sorted worst-first. Sectors at parity tiebreak by shortfall desc. */
export function computeJitRisk(snapshots: readonly JitInventorySnapshot[]): JitRiskRow[] {
  const rows: JitRiskRow[] = snapshots.map((s) => ({
    sector: s.sector,
    daysOfCover: s.daysOfCover,
    safetyThresholdDays: s.safetyThresholdDays,
    shortfallDays: Math.max(0, s.safetyThresholdDays - s.daysOfCover),
    riskBand: bandForJitRisk(s.daysOfCover, s.safetyThresholdDays),
  }));
  rows.sort((a, b) => {
    const ra = JIT_BAND_RANK[a.riskBand];
    const rb = JIT_BAND_RANK[b.riskBand];
    if (ra !== rb) return rb - ra;
    return b.shortfallDays - a.shortfallDays;
  });
  return rows;
}

// ── Nearshoring trend ────────────────────────────────────────────────

export type NearshoringDirection = 'accelerating' | 'stable' | 'reversing';

export interface NearshoringIndicator {
  sector: string;
  direction: NearshoringDirection;
  /** `[0, 1]`. Confidence drives the weight on the overall pick. */
  confidence: number;
  rationale: string;
}

export interface NearshoringTrend {
  overall: NearshoringDirection;
  /** Average confidence across input sectors, `[0, 1]`. `0` when no
   *  inputs. */
  confidence: number;
  bySector: readonly NearshoringIndicator[];
}

const DIRECTION_SCORE: Record<NearshoringDirection, number> = {
  accelerating: 1, stable: 0, reversing: -1,
};

/** Weighted by confidence: each indicator contributes `confidence *
 *  DIRECTION_SCORE[direction]`. Net score above `+0.3` → accelerating,
 *  below `-0.3` → reversing, else stable. */
export function summarizeNearshoring(
  indicators: readonly NearshoringIndicator[],
): NearshoringTrend {
  if (indicators.length === 0) {
    return { overall: 'stable', confidence: 0, bySector: [] };
  }
  let net = 0;
  let confSum = 0;
  for (const i of indicators) {
    const conf = clampUnit(i.confidence);
    net += conf * DIRECTION_SCORE[i.direction];
    confSum += conf;
  }
  const avgConf = confSum / indicators.length;
  const normalized = net / indicators.length;
  let overall: NearshoringDirection;
  if (normalized > 0.3) overall = 'accelerating';
  else if (normalized < -0.3) overall = 'reversing';
  else overall = 'stable';
  return {
    overall,
    confidence: Math.round(avgConf * 1000) / 1000,
    bySector: indicators,
  };
}

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ── Shared formatters (mirror intelligence-quality-debt-helpers) ─────

/** Compact age label. Returns `"-"` when the event is in the future. */
export function formatAge(observedAt: number, nowMs: number): string {
  const diff = nowMs - observedAt;
  if (diff < 0) return '-';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

/** Pretty-print a duration in ms as "Xh Ym" or "Xd Yh". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes - hours * 60;
  if (hours < 24) return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHr = hours - days * 24;
  return remHr > 0 ? `${days}d ${remHr}h` : `${days}d`;
}

// ── Display constants ────────────────────────────────────────────────

export const STRESS_BAND_COLOR: Record<StressBand, string> = {
  low: 'var(--severity-ok, #4ade80)',
  moderate: 'var(--severity-info, #69a)',
  elevated: 'var(--severity-medium, #facc15)',
  severe: 'var(--severity-high, #fb923c)',
  critical: 'var(--severity-critical, #ef4444)',
};

export const SHORTAGE_SEVERITY_COLOR: Record<ShortageSeverity, string> = {
  low: 'var(--severity-ok, #4ade80)',
  moderate: 'var(--severity-medium, #facc15)',
  severe: 'var(--severity-critical, #ef4444)',
};

export const SHUTDOWN_CAUSE_LABEL: Record<ShutdownCause, string> = {
  weather: 'Weather',
  unrest: 'Civil unrest',
  power: 'Power outage',
  strike: 'Labor strike',
  cyber: 'Cyber incident',
  fire: 'Fire',
  other: 'Other',
};

export const FREIGHT_CLASSIFICATION_COLOR: Record<FreightClassification, string> = {
  spike: 'var(--severity-critical, #ef4444)',
  normal: 'var(--severity-ok, #4ade80)',
  depressed: 'var(--severity-info, #69a)',
};

export const JIT_BAND_COLOR: Record<JitBand, string> = {
  safe: 'var(--severity-ok, #4ade80)',
  watch: 'var(--severity-medium, #facc15)',
  at_risk: 'var(--severity-high, #fb923c)',
  critical: 'var(--severity-critical, #ef4444)',
};

export const NEARSHORING_DIRECTION_GLYPH: Record<NearshoringDirection, string> = {
  accelerating: '▲',
  stable: '→',
  reversing: '▼',
};

export const NEARSHORING_DIRECTION_LABEL: Record<NearshoringDirection, string> = {
  accelerating: 'Accelerating',
  stable: 'Stable',
  reversing: 'Reversing',
};
