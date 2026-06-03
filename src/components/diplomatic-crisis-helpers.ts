/**
 * Pure helpers shared by DiplomaticCrisisPanel — extracted so tests
 * can import them without dragging in the Panel base class / i18n /
 * Vite glob machinery.
 *
 * No DOM imports, no fetch, no globals. Every helper takes the data
 * it needs as a parameter so it can be exercised with deterministic
 * fixtures.
 *
 * Seven domains:
 *   1. computeDiplomaticHeatIndex   — composite 0..100 + band + top driver
 *   2. summarizeExpulsions          — ambassador / diplomat expulsions
 *   3. summarizeEmbassyClosures     — closures / suspensions
 *   4. summarizeDisputes            — bilateral dispute escalation ladder
 *   5. summarizeUnscSessions        — UN Security Council emergency sessions
 *   6. summarizeTradeWarSignals     — tariffs / sanctions / export controls
 *   7. summarizeTreatyEvents        — treaty suspensions / withdrawals
 *   + summarizeBackchannelActivity  — back-channel direction roll-up
 */

// ── Composite heat index ──────────────────────────────────────────────

export type HeatBand = 'low' | 'moderate' | 'elevated' | 'severe' | 'critical';

/** Component scores feeding the composite heat index. Each is a
 *  `[0, 100]` value sourced upstream. Callers may pass out-of-range
 *  values; the helper clamps. */
export interface DiplomaticHeatInput {
  expulsionScore: number;
  embassyClosureScore: number;
  disputeEscalationScore: number;
  unscEmergencyScore: number;
  tradeWarScore: number;
  treatyActionScore: number;
  backchannelEscalationScore: number;
}

/** Weights sum to 1.0. Back-channels are weighted lowest because they
 *  are the noisiest signal — leaks and rumours are common, hard
 *  diplomatic actions are not. */
export const HEAT_WEIGHTS: Readonly<Record<keyof DiplomaticHeatInput, number>> = {
  expulsionScore: 0.2,
  embassyClosureScore: 0.2,
  disputeEscalationScore: 0.2,
  unscEmergencyScore: 0.1,
  tradeWarScore: 0.15,
  treatyActionScore: 0.1,
  backchannelEscalationScore: 0.05,
};

export const HEAT_COMPONENT_LABEL: Readonly<Record<keyof DiplomaticHeatInput, string>> = {
  expulsionScore: 'Expulsions',
  embassyClosureScore: 'Embassy closures',
  disputeEscalationScore: 'Bilateral disputes',
  unscEmergencyScore: 'UN Security Council',
  tradeWarScore: 'Trade war',
  treatyActionScore: 'Treaty actions',
  backchannelEscalationScore: 'Back-channels',
};

export interface DiplomaticHeatIndex {
  score: number;
  band: HeatBand;
  /** Largest weighted contribution (`weight * clampedScore`). `null`
   *  only when every component is exactly zero. */
  topDriver: string | null;
  weightedContributions: Readonly<Record<keyof DiplomaticHeatInput, number>>;
}

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

export function computeDiplomaticHeatIndex(input: DiplomaticHeatInput): DiplomaticHeatIndex {
  const contributions: Record<keyof DiplomaticHeatInput, number> = {
    expulsionScore: 0,
    embassyClosureScore: 0,
    disputeEscalationScore: 0,
    unscEmergencyScore: 0,
    tradeWarScore: 0,
    treatyActionScore: 0,
    backchannelEscalationScore: 0,
  };
  let score = 0;
  let topKey: keyof DiplomaticHeatInput | null = null;
  let topValue = 0;
  for (const key of Object.keys(HEAT_WEIGHTS) as (keyof DiplomaticHeatInput)[]) {
    const clamped = clamp100(input[key]);
    const contribution = clamped * HEAT_WEIGHTS[key];
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
    band: bandForHeatScore(rounded),
    topDriver: topKey === null ? null : HEAT_COMPONENT_LABEL[topKey],
    weightedContributions: contributions,
  };
}

export function bandForHeatScore(score: number): HeatBand {
  if (score < 20) return 'low';
  if (score < 40) return 'moderate';
  if (score < 60) return 'elevated';
  if (score < 80) return 'severe';
  return 'critical';
}

// ── Ambassador / diplomat expulsions ─────────────────────────────────

export type DiplomaticRank = 'chargé' | 'attaché' | 'diplomat' | 'consul' | 'ambassador';

export type ExpulsionSeverity = 'low' | 'moderate' | 'severe';

export interface ExpulsionEvent {
  id: string;
  hostCountry: string;
  sendingCountry: string;
  rank: DiplomaticRank;
  /** Number of officials expelled in this incident. */
  count: number;
  /** True when the action is in retaliation for a prior expulsion. */
  reciprocal: boolean;
  observedAt: number;
}

export interface ExpulsionRow {
  id: string;
  hostCountry: string;
  sendingCountry: string;
  rank: DiplomaticRank;
  count: number;
  reciprocal: boolean;
  severity: ExpulsionSeverity;
  ageLabel: string;
}

const RANK_WEIGHT: Record<DiplomaticRank, number> = {
  ambassador: 5,
  consul: 3,
  diplomat: 2,
  attaché: 2,
  chargé: 4,
};

/** Severity rules:
 *  - ambassador expulsion → always severe
 *  - chargé expulsion or >= 5 lower-ranked → severe
 *  - any expulsion with reciprocal flag bumps one tier
 *  - otherwise moderate (single expulsion) / low (count ≤ 0 or unknown)
 */
export function severityForExpulsion(rank: DiplomaticRank, count: number, reciprocal: boolean): ExpulsionSeverity {
  if (count <= 0) return 'low';
  let base: ExpulsionSeverity = 'moderate';
  if (rank === 'ambassador' || rank === 'chargé' || count >= 5) base = 'severe';
  if (reciprocal) return 'severe';
  return base;
}

const EXPULSION_SEVERITY_RANK: Record<ExpulsionSeverity, number> = {
  severe: 2, moderate: 1, low: 0,
};

/** Sorted severe-first, then most-recent-first. */
export function summarizeExpulsions(
  events: readonly ExpulsionEvent[],
  nowMs: number,
): ExpulsionRow[] {
  const rows: ExpulsionRow[] = events.map((e) => ({
    id: e.id,
    hostCountry: e.hostCountry,
    sendingCountry: e.sendingCountry,
    rank: e.rank,
    count: e.count,
    reciprocal: e.reciprocal,
    severity: severityForExpulsion(e.rank, e.count, e.reciprocal),
    ageLabel: formatAge(e.observedAt, nowMs),
  }));
  rows.sort((a, b) => {
    const ra = EXPULSION_SEVERITY_RANK[a.severity];
    const rb = EXPULSION_SEVERITY_RANK[b.severity];
    if (ra !== rb) return rb - ra;
    const ae = events.find((x) => x.id === a.id)?.observedAt ?? 0;
    const be = events.find((x) => x.id === b.id)?.observedAt ?? 0;
    return be - ae;
  });
  return rows;
}

export { RANK_WEIGHT as __RANK_WEIGHT_INTERNAL };

// ── Embassy closures ──────────────────────────────────────────────────

export type EmbassyClosureType =
  | 'partial_suspension'
  | 'consular_only'
  | 'evacuated'
  | 'fully_closed';

export interface EmbassyClosureEvent {
  id: string;
  hostCountry: string;
  sendingCountry: string;
  type: EmbassyClosureType;
  observedAt: number;
}

export interface EmbassyClosureRow {
  id: string;
  hostCountry: string;
  sendingCountry: string;
  type: EmbassyClosureType;
  severity: ExpulsionSeverity;
  ageLabel: string;
}

const CLOSURE_SEVERITY: Record<EmbassyClosureType, ExpulsionSeverity> = {
  partial_suspension: 'moderate',
  consular_only: 'moderate',
  evacuated: 'severe',
  fully_closed: 'severe',
};

export function summarizeEmbassyClosures(
  events: readonly EmbassyClosureEvent[],
  nowMs: number,
): EmbassyClosureRow[] {
  const rows: EmbassyClosureRow[] = events.map((e) => ({
    id: e.id,
    hostCountry: e.hostCountry,
    sendingCountry: e.sendingCountry,
    type: e.type,
    severity: CLOSURE_SEVERITY[e.type],
    ageLabel: formatAge(e.observedAt, nowMs),
  }));
  rows.sort((a, b) => {
    const ra = EXPULSION_SEVERITY_RANK[a.severity];
    const rb = EXPULSION_SEVERITY_RANK[b.severity];
    if (ra !== rb) return rb - ra;
    const ae = events.find((x) => x.id === a.id)?.observedAt ?? 0;
    const be = events.find((x) => x.id === b.id)?.observedAt ?? 0;
    return be - ae;
  });
  return rows;
}

// ── Bilateral dispute escalation ladder ──────────────────────────────

export type DisputeStage =
  | 'protest'
  | 'recall_consultations'
  | 'expel_diplomat'
  | 'expel_ambassador'
  | 'sever_relations';

export interface BilateralDispute {
  id: string;
  countryA: string;
  countryB: string;
  topic: string;
  stage: DisputeStage;
  updatedAt: number;
}

export interface DisputeRow {
  id: string;
  countryA: string;
  countryB: string;
  topic: string;
  stage: DisputeStage;
  stageRank: number;
  nextStage: DisputeStage | null;
  ageLabel: string;
}

/** Numeric rank for the Vienna-Convention escalation ladder. Higher
 *  numbers = closer to severance. */
export function escalationRankForStage(stage: DisputeStage): number {
  switch (stage) {
    case 'protest': { return 1;
    }
    case 'recall_consultations': { return 2;
    }
    case 'expel_diplomat': { return 3;
    }
    case 'expel_ambassador': { return 4;
    }
    case 'sever_relations': { return 5;
    }
  }
}

const LADDER: readonly DisputeStage[] = [
  'protest',
  'recall_consultations',
  'expel_diplomat',
  'expel_ambassador',
  'sever_relations',
];

/** Returns the next stage in the escalation ladder, or `null` if the
 *  dispute is already at the top rung. */
export function nextEscalationRung(stage: DisputeStage): DisputeStage | null {
  const idx = LADDER.indexOf(stage);
  if (idx === -1 || idx === LADDER.length - 1) return null;
  return LADDER[idx + 1] ?? null;
}

export function summarizeDisputes(
  disputes: readonly BilateralDispute[],
  nowMs: number,
): DisputeRow[] {
  const rows: DisputeRow[] = disputes.map((d) => ({
    id: d.id,
    countryA: d.countryA,
    countryB: d.countryB,
    topic: d.topic,
    stage: d.stage,
    stageRank: escalationRankForStage(d.stage),
    nextStage: nextEscalationRung(d.stage),
    ageLabel: formatAge(d.updatedAt, nowMs),
  }));
  rows.sort((a, b) => {
    if (a.stageRank !== b.stageRank) return b.stageRank - a.stageRank;
    const ae = disputes.find((x) => x.id === a.id)?.updatedAt ?? 0;
    const be = disputes.find((x) => x.id === b.id)?.updatedAt ?? 0;
    return be - ae;
  });
  return rows;
}

// ── UN Security Council emergency sessions ───────────────────────────

export type UnscOutcome =
  | 'resolution_passed'
  | 'statement'
  | 'no_action'
  | 'vetoed';

export interface UnscSession {
  id: string;
  agenda: string;
  requestingMember: string;
  outcome: UnscOutcome;
  vetoedBy: string | null;
  observedAt: number;
}

export interface UnscSessionRow {
  id: string;
  agenda: string;
  requestingMember: string;
  outcome: UnscOutcome;
  vetoedBy: string | null;
  riskWeight: number;
  ageLabel: string;
}

/** Asymmetric weights: a vetoed or no-action outcome signals deeper
 *  crisis than a passed resolution because the dispute was deadlocked
 *  at the highest international body. */
export function outcomeRiskWeight(outcome: UnscOutcome): number {
  switch (outcome) {
    case 'vetoed': { return 1;
    }
    case 'no_action': { return 1;
    }
    case 'statement': { return 0.5;
    }
    case 'resolution_passed': { return 0.3;
    }
  }
}

export function summarizeUnscSessions(
  sessions: readonly UnscSession[],
  nowMs: number,
): UnscSessionRow[] {
  const rows: UnscSessionRow[] = sessions.map((s) => ({
    id: s.id,
    agenda: s.agenda,
    requestingMember: s.requestingMember,
    outcome: s.outcome,
    vetoedBy: s.vetoedBy,
    riskWeight: outcomeRiskWeight(s.outcome),
    ageLabel: formatAge(s.observedAt, nowMs),
  }));
  rows.sort((a, b) => {
    if (a.riskWeight !== b.riskWeight) return b.riskWeight - a.riskWeight;
    const ae = sessions.find((x) => x.id === a.id)?.observedAt ?? 0;
    const be = sessions.find((x) => x.id === b.id)?.observedAt ?? 0;
    return be - ae;
  });
  return rows;
}

// ── Trade war escalation signals ─────────────────────────────────────

export type TradeWarSignalKind = 'tariff' | 'sanction' | 'export_control';

export interface TradeWarSignal {
  id: string;
  imposer: string;
  target: string;
  kind: TradeWarSignalKind;
  /** Tariff: percentage points. Sanction: 1 for entity list, 2 for
   *  sectoral, 3 for secondary. Export control: 1 dual-use, 2
   *  advanced-tech, 3 chip-level. */
  magnitude: number;
  sector: string;
  observedAt: number;
}

export interface TradeWarRow {
  id: string;
  imposer: string;
  target: string;
  kind: TradeWarSignalKind;
  magnitude: number;
  severity: ExpulsionSeverity;
  sector: string;
  ageLabel: string;
}

/** Tariff severity: `< 10 → low`, `< 25 → moderate`, `>= 25 → severe`. */
export function severityForTariff(percentagePoints: number): ExpulsionSeverity {
  if (percentagePoints < 10) return 'low';
  if (percentagePoints < 25) return 'moderate';
  return 'severe';
}

function severityForMagnitude(magnitude: number): ExpulsionSeverity {
  if (magnitude >= 3) return 'severe';
  if (magnitude >= 2) return 'moderate';
  return 'low';
}

function severityForSignal(signal: TradeWarSignal): ExpulsionSeverity {
  switch (signal.kind) {
    case 'tariff': { return severityForTariff(signal.magnitude);
    }
    case 'sanction': { return severityForMagnitude(signal.magnitude);
    }
    case 'export_control': { return severityForMagnitude(signal.magnitude);
    }
  }
}

export function summarizeTradeWarSignals(
  signals: readonly TradeWarSignal[],
  nowMs: number,
): TradeWarRow[] {
  const rows: TradeWarRow[] = signals.map((s) => ({
    id: s.id,
    imposer: s.imposer,
    target: s.target,
    kind: s.kind,
    magnitude: s.magnitude,
    severity: severityForSignal(s),
    sector: s.sector,
    ageLabel: formatAge(s.observedAt, nowMs),
  }));
  rows.sort((a, b) => {
    const ra = EXPULSION_SEVERITY_RANK[a.severity];
    const rb = EXPULSION_SEVERITY_RANK[b.severity];
    if (ra !== rb) return rb - ra;
    const ae = signals.find((x) => x.id === a.id)?.observedAt ?? 0;
    const be = signals.find((x) => x.id === b.id)?.observedAt ?? 0;
    return be - ae;
  });
  return rows;
}

// ── Treaty actions ───────────────────────────────────────────────────

export type TreatyAction =
  | 'reservation_added'
  | 'suspended'
  | 'denounced'
  | 'withdrew';

export interface TreatyEvent {
  id: string;
  treaty: string;
  party: string;
  action: TreatyAction;
  effectiveAt: number;
}

export interface TreatyEventRow {
  id: string;
  treaty: string;
  party: string;
  action: TreatyAction;
  actionRank: number;
  ageLabel: string;
}

/** Rank from least → most permanent rejection of the treaty regime. */
export function actionRiskRank(action: TreatyAction): number {
  switch (action) {
    case 'reservation_added': { return 1;
    }
    case 'suspended': { return 2;
    }
    case 'denounced': { return 3;
    }
    case 'withdrew': { return 4;
    }
  }
}

export function summarizeTreatyEvents(
  events: readonly TreatyEvent[],
  nowMs: number,
): TreatyEventRow[] {
  const rows: TreatyEventRow[] = events.map((e) => ({
    id: e.id,
    treaty: e.treaty,
    party: e.party,
    action: e.action,
    actionRank: actionRiskRank(e.action),
    ageLabel: formatAge(e.effectiveAt, nowMs),
  }));
  rows.sort((a, b) => {
    if (a.actionRank !== b.actionRank) return b.actionRank - a.actionRank;
    const ae = events.find((x) => x.id === a.id)?.effectiveAt ?? 0;
    const be = events.find((x) => x.id === b.id)?.effectiveAt ?? 0;
    return be - ae;
  });
  return rows;
}

// ── Back-channel activity ────────────────────────────────────────────

export type BackchannelType =
  | 'third_party_mediator'
  | 'secret_talks'
  | 'summit_floated'
  | 'envoy_dispatched'
  | 'leaked_communique'
  | 'track_two';

export type BackchannelDirection = 'de_escalation' | 'maintenance' | 'escalation';

export interface BackchannelIndicator {
  id: string;
  pair: string;
  type: BackchannelType;
  direction: BackchannelDirection;
  /** `[0, 1]` — drives the weight on the overall direction pick. */
  confidence: number;
  rationale: string;
  observedAt: number;
}

export interface BackchannelSummary {
  overall: BackchannelDirection;
  /** Average confidence across input indicators, `[0, 1]`. `0` when
   *  no input. */
  confidence: number;
  indicators: readonly BackchannelIndicator[];
}

const DIRECTION_SCORE: Record<BackchannelDirection, number> = {
  de_escalation: -1,
  maintenance: 0,
  escalation: 1,
};

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Weighted by confidence: each indicator contributes `confidence *
 *  DIRECTION_SCORE[direction]`. Net normalized score above `+0.3` →
 *  escalation, below `-0.3` → de-escalation, else maintenance. */
export function summarizeBackchannelActivity(
  indicators: readonly BackchannelIndicator[],
): BackchannelSummary {
  if (indicators.length === 0) {
    return { overall: 'maintenance', confidence: 0, indicators: [] };
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
  let overall: BackchannelDirection;
  if (normalized > 0.3) overall = 'escalation';
  else if (normalized < -0.3) overall = 'de_escalation';
  else overall = 'maintenance';
  return {
    overall,
    confidence: Math.round(avgConf * 1000) / 1000,
    indicators,
  };
}

// ── Shared formatter ─────────────────────────────────────────────────

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

// ── Display constants ────────────────────────────────────────────────

export const HEAT_BAND_COLOR: Record<HeatBand, string> = {
  low: 'var(--severity-ok, #4ade80)',
  moderate: 'var(--severity-info, #69a)',
  elevated: 'var(--severity-medium, #facc15)',
  severe: 'var(--severity-high, #fb923c)',
  critical: 'var(--severity-critical, #ef4444)',
};

export const SEVERITY_COLOR: Record<ExpulsionSeverity, string> = {
  low: 'var(--severity-ok, #4ade80)',
  moderate: 'var(--severity-medium, #facc15)',
  severe: 'var(--severity-critical, #ef4444)',
};

export const RANK_LABEL: Record<DiplomaticRank, string> = {
  ambassador: 'Ambassador',
  consul: 'Consul',
  chargé: 'Chargé d\'affaires',
  diplomat: 'Diplomat',
  attaché: 'Attaché',
};

export const EMBASSY_CLOSURE_TYPE_LABEL: Record<EmbassyClosureType, string> = {
  partial_suspension: 'Partial suspension',
  consular_only: 'Consular only',
  evacuated: 'Evacuated',
  fully_closed: 'Fully closed',
};

export const DISPUTE_STAGE_LABEL: Record<DisputeStage, string> = {
  protest: 'Formal protest',
  recall_consultations: 'Recalled for consultations',
  expel_diplomat: 'Expelled diplomat',
  expel_ambassador: 'Expelled ambassador (PNG)',
  sever_relations: 'Severed relations',
};

export const DISPUTE_STAGE_COLOR: Record<DisputeStage, string> = {
  protest: 'var(--severity-ok, #4ade80)',
  recall_consultations: 'var(--severity-info, #69a)',
  expel_diplomat: 'var(--severity-medium, #facc15)',
  expel_ambassador: 'var(--severity-high, #fb923c)',
  sever_relations: 'var(--severity-critical, #ef4444)',
};

export const UNSC_OUTCOME_LABEL: Record<UnscOutcome, string> = {
  resolution_passed: 'Resolution passed',
  statement: 'Presidential statement',
  no_action: 'No action',
  vetoed: 'Vetoed',
};

export const UNSC_OUTCOME_COLOR: Record<UnscOutcome, string> = {
  resolution_passed: 'var(--severity-ok, #4ade80)',
  statement: 'var(--severity-info, #69a)',
  no_action: 'var(--severity-high, #fb923c)',
  vetoed: 'var(--severity-critical, #ef4444)',
};

export const TRADE_WAR_KIND_LABEL: Record<TradeWarSignalKind, string> = {
  tariff: 'Tariff',
  sanction: 'Sanction',
  export_control: 'Export control',
};

export const TREATY_ACTION_LABEL: Record<TreatyAction, string> = {
  reservation_added: 'Reservation added',
  suspended: 'Suspended',
  denounced: 'Denounced',
  withdrew: 'Withdrew',
};

export const TREATY_ACTION_COLOR: Record<TreatyAction, string> = {
  reservation_added: 'var(--severity-info, #69a)',
  suspended: 'var(--severity-medium, #facc15)',
  denounced: 'var(--severity-high, #fb923c)',
  withdrew: 'var(--severity-critical, #ef4444)',
};

export const BACKCHANNEL_TYPE_LABEL: Record<BackchannelType, string> = {
  third_party_mediator: 'Third-party mediator',
  secret_talks: 'Secret talks',
  summit_floated: 'Summit floated',
  envoy_dispatched: 'Envoy dispatched',
  leaked_communique: 'Leaked communiqué',
  track_two: 'Track-two dialogue',
};

export const BACKCHANNEL_DIRECTION_GLYPH: Record<BackchannelDirection, string> = {
  de_escalation: '▼',
  maintenance: '→',
  escalation: '▲',
};

export const BACKCHANNEL_DIRECTION_LABEL: Record<BackchannelDirection, string> = {
  de_escalation: 'De-escalation',
  maintenance: 'Maintenance',
  escalation: 'Escalation',
};
