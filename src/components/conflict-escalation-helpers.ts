/**
 * Pure helpers for ConflictEscalationPanel.
 *
 * Defensive monitoring framing — every helper here takes observed
 * indicators and produces a deterministic assessment. No DOM, no fetch,
 * no globals — safe to import in Node tests.
 *
 * Six analytical domains:
 *   1. computeWarRiskIndex            — composite 0..100 + band + top driver
 *   2. summarizeActiveConflicts       — per-dyad intensity + casualty rate
 *   3. summarizeCeasefires            — status, violations/day, days-holding
 *   4. summarizeIntensityTrends       — 30-day delta direction + magnitude
 *   5. summarizeEscalationLadder      — 7-rung position + step-change flag
 *   6. summarizeDeEscalationSignals   — weighted optimism roll-up
 */

// ── Composite war-risk index ───────────────────────────────────────────

export type WarRiskBand = 'low' | 'guarded' | 'elevated' | 'high' | 'severe';

export interface WarRiskInput {
  activeConflictScore: number;
  ceasefireFragilityScore: number;
  intensityTrendScore: number;
  escalationLadderScore: number;
  /** Inverse signal: higher de-escalation reduces composite. The helper
   *  applies that subtraction internally so callers can keep all six
   *  inputs in `[0, 100]`. */
  deEscalationScore: number;
  /** Cross-domain pressure (sanctions whiplash, large mobilizations,
   *  triggering events from other panels). */
  crossDomainPressureScore: number;
}

/** Weights for the five positive drivers sum to 1.0. The de-escalation
 *  score is applied as a *deduction* after the weighted sum, capped at
 *  the current score (so it can drive the index toward 0 but never
 *  below it). */
export const WAR_RISK_WEIGHTS: Readonly<Record<Exclude<keyof WarRiskInput, 'deEscalationScore'>, number>> = {
  activeConflictScore: 0.25,
  ceasefireFragilityScore: 0.20,
  intensityTrendScore: 0.20,
  escalationLadderScore: 0.25,
  crossDomainPressureScore: 0.10,
};

export const WAR_RISK_COMPONENT_LABEL: Readonly<Record<keyof WarRiskInput, string>> = {
  activeConflictScore: 'Active Conflicts',
  ceasefireFragilityScore: 'Ceasefire Fragility',
  intensityTrendScore: 'Intensity Trend',
  escalationLadderScore: 'Escalation Ladder',
  deEscalationScore: 'De-escalation Signals',
  crossDomainPressureScore: 'Cross-domain Pressure',
};

export interface WarRiskIndex {
  score: number;
  band: WarRiskBand;
  topDriver: string | null;
  /** How many points were deducted by de-escalation. Surfaces in the
   *  panel so users can see what would happen without diplomacy. */
  deEscalationDeduction: number;
  weightedContributions: Readonly<Record<Exclude<keyof WarRiskInput, 'deEscalationScore'>, number>>;
}

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

export function computeWarRiskIndex(input: WarRiskInput): WarRiskIndex {
  const contributions: Record<Exclude<keyof WarRiskInput, 'deEscalationScore'>, number> = {
    activeConflictScore: 0,
    ceasefireFragilityScore: 0,
    intensityTrendScore: 0,
    escalationLadderScore: 0,
    crossDomainPressureScore: 0,
  };
  let raw = 0;
  let topKey: keyof WarRiskInput | null = null;
  let topValue = 0;
  const keys = Object.keys(WAR_RISK_WEIGHTS) as Array<Exclude<keyof WarRiskInput, 'deEscalationScore'>>;
  for (const key of keys) {
    const clamped = clamp100(input[key]);
    const contribution = clamped * WAR_RISK_WEIGHTS[key];
    contributions[key] = Math.round(contribution * 100) / 100;
    raw += contribution;
    if (contribution > topValue) {
      topValue = contribution;
      topKey = key;
    }
  }
  // De-escalation cuts up to 30 points off the composite — a strong
  // diplomatic push can pull a "high" score down to "elevated" but
  // can't on its own reach "low" while real fighting continues.
  const deEscalation = clamp100(input.deEscalationScore);
  const deduction = Math.min(raw, deEscalation * 0.30);
  const score = Math.round(raw - deduction);
  return {
    score,
    band: bandForWarRisk(score),
    topDriver: topKey === null ? null : WAR_RISK_COMPONENT_LABEL[topKey],
    deEscalationDeduction: Math.round(deduction * 100) / 100,
    weightedContributions: contributions,
  };
}

export function bandForWarRisk(score: number): WarRiskBand {
  if (score < 20) return 'low';
  if (score < 40) return 'guarded';
  if (score < 60) return 'elevated';
  if (score < 80) return 'high';
  return 'severe';
}

export function warRiskBandColor(band: WarRiskBand): string {
  const colors: Record<WarRiskBand, string> = {
    low:      'var(--severity-low,      #4caf50)',
    guarded:  'var(--severity-medium,   #facc15)',
    elevated: 'var(--severity-high,     #fb923c)',
    high:     'var(--severity-critical, #ef4444)',
    severe:   'var(--severity-critical, #ef4444)',
  };
  return colors[band];
}

export function warRiskBandLabel(band: WarRiskBand): string {
  return band.charAt(0).toUpperCase() + band.slice(1);
}

// ── Active conflicts (by dyad) ─────────────────────────────────────────

export type ConflictKind = 'interstate' | 'intrastate' | 'internationalized_intrastate' | 'non_state';
export type ConflictIntensity = 'latent' | 'low' | 'medium' | 'high' | 'war';

export interface ConflictDyad {
  id: string;
  /** Plain-language name (e.g. "Country A vs. Country B" or "Country C
   *  government vs. armed group D"). */
  dyad: string;
  region: string;
  kind: ConflictKind;
  intensity: ConflictIntensity;
  /** Reported battle-related deaths in the last 30 days. */
  battleDeaths30d: number;
  /** Civilian casualties in the last 30 days. */
  civilianCasualties30d: number;
  /** When the most recent confirmed incident in this dyad was observed. */
  lastIncidentAt: number;
}

export interface ConflictDyadRow {
  id: string;
  dyad: string;
  region: string;
  kind: ConflictKind;
  kindLabel: string;
  intensity: ConflictIntensity;
  intensityLabel: string;
  battleDeaths30d: number;
  civilianCasualties30d: number;
  totalCasualties30d: number;
  ageLabel: string;
}

const INTENSITY_RANK: Record<ConflictIntensity, number> = {
  war: 4, high: 3, medium: 2, low: 1, latent: 0,
};

export function conflictKindLabel(k: ConflictKind): string {
  const labels: Record<ConflictKind, string> = {
    interstate:                   'Interstate',
    intrastate:                   'Intrastate',
    internationalized_intrastate: 'Internationalized intrastate',
    non_state:                    'Non-state',
  };
  return labels[k];
}

export function intensityLabel(i: ConflictIntensity): string {
  const labels: Record<ConflictIntensity, string> = {
    latent: 'Latent',
    low:    'Low',
    medium: 'Medium',
    high:   'High',
    war:    'Active war',
  };
  return labels[i];
}

export function intensityColor(i: ConflictIntensity): string {
  const colors: Record<ConflictIntensity, string> = {
    latent: 'var(--severity-low,      #4caf50)',
    low:    'var(--severity-medium,   #facc15)',
    medium: 'var(--severity-high,     #fb923c)',
    high:   'var(--severity-critical, #ef4444)',
    war:    'var(--severity-critical, #ef4444)',
  };
  return colors[i];
}

export function summarizeActiveConflicts(
  dyads: readonly ConflictDyad[],
  nowMs: number,
): ConflictDyadRow[] {
  const rows: ConflictDyadRow[] = dyads.map((d) => {
    const battle = Math.max(0, Math.trunc(d.battleDeaths30d));
    const civilian = Math.max(0, Math.trunc(d.civilianCasualties30d));
    return {
      id: d.id,
      dyad: d.dyad,
      region: d.region,
      kind: d.kind,
      kindLabel: conflictKindLabel(d.kind),
      intensity: d.intensity,
      intensityLabel: intensityLabel(d.intensity),
      battleDeaths30d: battle,
      civilianCasualties30d: civilian,
      totalCasualties30d: battle + civilian,
      ageLabel: formatAge(d.lastIncidentAt, nowMs),
    };
  });
  rows.sort((a, b) => {
    const intDelta = INTENSITY_RANK[b.intensity] - INTENSITY_RANK[a.intensity];
    if (intDelta !== 0) return intDelta;
    return b.totalCasualties30d - a.totalCasualties30d;
  });
  return rows;
}

// ── Ceasefire status ───────────────────────────────────────────────────

export type CeasefireStatus = 'holding' | 'fraying' | 'violated_minor' | 'violated_major' | 'collapsed';

export interface Ceasefire {
  id: string;
  dyad: string;
  region: string;
  signedAt: number;
  /** Reported violation count in the last 7 days. */
  violations7d: number;
  /** Reported violation count in the last 24 hours. */
  violations24h: number;
  status: CeasefireStatus;
  observedAt: number;
}

export interface CeasefireRow {
  id: string;
  dyad: string;
  region: string;
  daysHolding: number;
  violations7d: number;
  violations24h: number;
  status: CeasefireStatus;
  statusLabel: string;
  /** True when violations24h is more than 1.5× the trailing 7-day daily
   *  average — a useful "things just got worse today" signal. */
  accelerating: boolean;
  ageLabel: string;
}

const CEASEFIRE_STATUS_RANK: Record<CeasefireStatus, number> = {
  collapsed: 4, violated_major: 3, violated_minor: 2, fraying: 1, holding: 0,
};

export function ceasefireStatusLabel(s: CeasefireStatus): string {
  const labels: Record<CeasefireStatus, string> = {
    holding:        'Holding',
    fraying:        'Fraying',
    violated_minor: 'Minor violations',
    violated_major: 'Major violations',
    collapsed:      'Collapsed',
  };
  return labels[s];
}

export function ceasefireStatusColor(s: CeasefireStatus): string {
  const colors: Record<CeasefireStatus, string> = {
    holding:        'var(--severity-low,      #4caf50)',
    fraying:        'var(--severity-medium,   #facc15)',
    violated_minor: 'var(--severity-medium,   #facc15)',
    violated_major: 'var(--severity-high,     #fb923c)',
    collapsed:      'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function summarizeCeasefires(
  ceasefires: readonly Ceasefire[],
  nowMs: number,
): CeasefireRow[] {
  const rows: CeasefireRow[] = ceasefires.map((c) => {
    const daysHolding = Math.max(0, Math.floor((nowMs - c.signedAt) / 86_400_000));
    const v7 = Math.max(0, Math.trunc(c.violations7d));
    const v24 = Math.max(0, Math.trunc(c.violations24h));
    const dailyAvg = v7 / 7;
    const accelerating = dailyAvg > 0 ? v24 > dailyAvg * 1.5 : v24 >= 2;
    return {
      id: c.id,
      dyad: c.dyad,
      region: c.region,
      daysHolding,
      violations7d: v7,
      violations24h: v24,
      status: c.status,
      statusLabel: ceasefireStatusLabel(c.status),
      accelerating,
      ageLabel: formatAge(c.observedAt, nowMs),
    };
  });
  rows.sort((a, b) => {
    const delta = CEASEFIRE_STATUS_RANK[b.status] - CEASEFIRE_STATUS_RANK[a.status];
    if (delta !== 0) return delta;
    return b.violations24h - a.violations24h;
  });
  return rows;
}

// ── Conflict intensity trends (30-day delta) ───────────────────────────

export type TrendDirection = 'escalating' | 'steady' | 'de_escalating';

export interface ConflictIntensitySample {
  id: string;
  dyad: string;
  region: string;
  /** Score 0..100 from 30 days ago. */
  scoreBaseline: number;
  /** Score 0..100 now. */
  scoreNow: number;
  /** When the comparison was computed. */
  computedAt: number;
}

export interface ConflictIntensityRow {
  id: string;
  dyad: string;
  region: string;
  scoreBaseline: number;
  scoreNow: number;
  delta: number;
  /** Percentage change relative to the baseline. `null` when the
   *  baseline is zero (we can't divide by zero, but we still surface
   *  the absolute delta). */
  pctChange: number | null;
  direction: TrendDirection;
  directionLabel: string;
  ageLabel: string;
}

export function trendDirection(scoreBaseline: number, scoreNow: number): TrendDirection {
  const base = clamp100(scoreBaseline);
  const now = clamp100(scoreNow);
  const delta = now - base;
  // Require at least 5 points of movement to call a trend — keeps
  // small fluctuations from masquerading as escalation.
  if (delta > 5) return 'escalating';
  if (delta < -5) return 'de_escalating';
  return 'steady';
}

export function trendLabel(d: TrendDirection): string {
  const labels: Record<TrendDirection, string> = {
    escalating:    '↑ Escalating',
    steady:        '→ Steady',
    de_escalating: '↓ De-escalating',
  };
  return labels[d];
}

export function trendColor(d: TrendDirection): string {
  const colors: Record<TrendDirection, string> = {
    escalating:    'var(--severity-critical, #ef4444)',
    steady:        'var(--severity-medium,   #facc15)',
    de_escalating: 'var(--severity-low,      #4caf50)',
  };
  return colors[d];
}

export function summarizeIntensityTrends(
  samples: readonly ConflictIntensitySample[],
  nowMs: number,
): ConflictIntensityRow[] {
  const rows: ConflictIntensityRow[] = samples.map((s) => {
    const base = clamp100(s.scoreBaseline);
    const now = clamp100(s.scoreNow);
    const delta = Math.round((now - base) * 100) / 100;
    const dir = trendDirection(base, now);
    return {
      id: s.id,
      dyad: s.dyad,
      region: s.region,
      scoreBaseline: base,
      scoreNow: now,
      delta,
      pctChange: base === 0 ? null : Math.round(((now - base) / base) * 100),
      direction: dir,
      directionLabel: trendLabel(dir),
      ageLabel: formatAge(s.computedAt, nowMs),
    };
  });
  // Sort: escalating first (largest delta first), then steady, then
  // de_escalating (most de-escalation last for emphasis).
  const DIR_RANK: Record<TrendDirection, number> = {
    escalating: 2, steady: 1, de_escalating: 0,
  };
  rows.sort((a, b) => {
    const dirDelta = DIR_RANK[b.direction] - DIR_RANK[a.direction];
    if (dirDelta !== 0) return dirDelta;
    return Math.abs(b.delta) - Math.abs(a.delta);
  });
  return rows;
}

// ── Escalation ladder ──────────────────────────────────────────────────

export type EscalationRung =
  | 'rhetoric'
  | 'posturing'
  | 'mobilization'
  | 'border_incident'
  | 'limited_strikes'
  | 'wider_engagement'
  | 'general_war';

export interface EscalationLadderEntry {
  id: string;
  dyad: string;
  region: string;
  rung: EscalationRung;
  /** The previous rung observed (or `null` if this is the first
   *  observation). Used to detect step-changes. */
  previousRung: EscalationRung | null;
  observedAt: number;
}

export interface EscalationLadderRow {
  id: string;
  dyad: string;
  region: string;
  rung: EscalationRung;
  rungLabel: string;
  rungIndex: number;
  previousRung: EscalationRung | null;
  /** +N or -N rungs since the previous observation. `0` if no change
   *  and `null` if there was no previous observation. */
  stepChange: number | null;
  ageLabel: string;
}

const RUNG_ORDER: readonly EscalationRung[] = [
  'rhetoric',
  'posturing',
  'mobilization',
  'border_incident',
  'limited_strikes',
  'wider_engagement',
  'general_war',
];

export function rungIndex(r: EscalationRung): number {
  return RUNG_ORDER.indexOf(r);
}

export function rungLabel(r: EscalationRung): string {
  const labels: Record<EscalationRung, string> = {
    rhetoric:         '1. Rhetoric',
    posturing:        '2. Posturing',
    mobilization:     '3. Mobilization',
    border_incident:  '4. Border incident',
    limited_strikes:  '5. Limited strikes',
    wider_engagement: '6. Wider engagement',
    general_war:      '7. General war',
  };
  return labels[r];
}

export function rungColor(r: EscalationRung): string {
  const idx = rungIndex(r);
  if (idx < 0) return 'var(--text-secondary, #9e9e9e)';
  if (idx <= 1) return 'var(--severity-low,      #4caf50)';
  if (idx <= 2) return 'var(--severity-medium,   #facc15)';
  if (idx <= 4) return 'var(--severity-high,     #fb923c)';
  return 'var(--severity-critical, #ef4444)';
}

export function summarizeEscalationLadder(
  entries: readonly EscalationLadderEntry[],
  nowMs: number,
): EscalationLadderRow[] {
  const rows: EscalationLadderRow[] = entries.map((e) => {
    const idx = rungIndex(e.rung);
    const prevIdx = e.previousRung === null ? null : rungIndex(e.previousRung);
    return {
      id: e.id,
      dyad: e.dyad,
      region: e.region,
      rung: e.rung,
      rungLabel: rungLabel(e.rung),
      rungIndex: idx,
      previousRung: e.previousRung,
      stepChange: prevIdx === null ? null : idx - prevIdx,
      ageLabel: formatAge(e.observedAt, nowMs),
    };
  });
  rows.sort((a, b) => {
    if (a.rungIndex !== b.rungIndex) return b.rungIndex - a.rungIndex;
    // Within a rung, highlight dyads that just climbed.
    const ac = a.stepChange ?? 0;
    const bc = b.stepChange ?? 0;
    return bc - ac;
  });
  return rows;
}

// ── De-escalation signals ──────────────────────────────────────────────

export type DeEscalationKind =
  | 'talks_announced'
  | 'prisoner_exchange'
  | 'mediation_offered'
  | 'troop_drawdown'
  | 'humanitarian_corridor'
  | 'hostage_release'
  | 'back_channel_active';

export interface DeEscalationSignal {
  id: string;
  dyad: string;
  region: string;
  kind: DeEscalationKind;
  /** 0..1 — analyst confidence the signal is genuine rather than
   *  performative. */
  confidence: number;
  description: string;
  observedAt: number;
}

export interface DeEscalationSignalRow {
  id: string;
  dyad: string;
  region: string;
  kind: DeEscalationKind;
  kindLabel: string;
  /** Positive-weight magnitude derived from kind + confidence. Higher
   *  is more meaningful. */
  weight: number;
  confidence: number;
  description: string;
  ageLabel: string;
}

const DEESCALATION_KIND_WEIGHT: Record<DeEscalationKind, number> = {
  talks_announced:        0.6,
  prisoner_exchange:      0.85,
  mediation_offered:      0.5,
  troop_drawdown:         0.9,
  humanitarian_corridor:  0.7,
  hostage_release:        0.95,
  back_channel_active:    0.55,
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function deEscalationKindLabel(k: DeEscalationKind): string {
  const labels: Record<DeEscalationKind, string> = {
    talks_announced:        'Talks announced',
    prisoner_exchange:      'Prisoner exchange',
    mediation_offered:      'Mediation offered',
    troop_drawdown:         'Troop drawdown',
    humanitarian_corridor:  'Humanitarian corridor',
    hostage_release:        'Hostage release',
    back_channel_active:    'Back-channel active',
  };
  return labels[k];
}

export function summarizeDeEscalationSignals(
  signals: readonly DeEscalationSignal[],
  nowMs: number,
): DeEscalationSignalRow[] {
  const rows: DeEscalationSignalRow[] = signals.map((s) => {
    const conf = clamp01(s.confidence);
    const weight = Math.round(DEESCALATION_KIND_WEIGHT[s.kind] * conf * 100) / 100;
    return {
      id: s.id,
      dyad: s.dyad,
      region: s.region,
      kind: s.kind,
      kindLabel: deEscalationKindLabel(s.kind),
      weight,
      confidence: conf,
      description: s.description,
      ageLabel: formatAge(s.observedAt, nowMs),
    };
  });
  rows.sort((a, b) => {
    if (a.weight !== b.weight) return b.weight - a.weight;
    const ae = signals.find((x) => x.id === a.id)?.observedAt ?? 0;
    const be = signals.find((x) => x.id === b.id)?.observedAt ?? 0;
    return be - ae;
  });
  return rows;
}

/** Roll-up score 0..100 expressing how strong the cumulative
 *  de-escalation signal is. Caps at 100 even when many strong signals
 *  pile up — additional signals contribute with diminishing returns. */
export function deEscalationRollupScore(rows: readonly DeEscalationSignalRow[]): number {
  let acc = 0;
  for (const r of rows) acc += r.weight;
  const score = 100 * (1 - Math.exp(-acc / 1.5));
  return Math.round(score);
}

// ── Counts / aggregators ───────────────────────────────────────────────

export function countActiveWars(rows: readonly ConflictDyadRow[]): number {
  return rows.filter((r) => r.intensity === 'war' || r.intensity === 'high').length;
}

export function countCollapsedCeasefires(rows: readonly CeasefireRow[]): number {
  return rows.filter((r) => r.status === 'collapsed').length;
}

export function countEscalatingTrends(rows: readonly ConflictIntensityRow[]): number {
  return rows.filter((r) => r.direction === 'escalating').length;
}

export function countHighRungs(rows: readonly EscalationLadderRow[]): number {
  return rows.filter((r) => r.rungIndex >= 4).length;
}

// ── Age formatter ──────────────────────────────────────────────────────

export function formatAge(observedAt: number, nowMs: number): string {
  const deltaMs = Math.max(0, nowMs - observedAt);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
