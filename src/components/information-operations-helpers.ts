/**
 * Pure helpers for InformationOperationsPanel.
 *
 * STRICTLY ANALYTICAL / DEFENSIVE FRAMING.
 *
 * Every helper here treats its inputs as detection signals, attribution
 * assessments, or analytic observations *about* information operations
 * — never as instructions or playbooks for running them. The panel is a
 * monitoring surface, not an operational tool.
 *
 * No DOM, no fetch, no globals — safe to import in Node tests.
 *
 * Six analytical domains:
 *   1. computeInfoThreatIndex          — composite 0..100 + band + top driver
 *   2. summarizeCibEvents              — coordinated inauthentic behavior
 *   3. summarizeForeignMediaCampaigns  — foreign state media influence
 *   4. summarizeNarrativeRegions       — narrative warfare by region
 *   5. summarizeManipulationSignals    — social-media manipulation signals
 *   6. summarizeStateActorCampaigns    — strategic-comms campaigns observed
 *   7. summarizeAttributionAssessments — disinformation attribution confidence
 */

// ── Composite threat index ─────────────────────────────────────────────

export type InfoThreatBand = 'low' | 'moderate' | 'elevated' | 'severe' | 'critical';

/** Component scores feeding the composite. Each is a `[0, 100]` value
 *  computed upstream. Callers may pass out-of-range values; the helper
 *  clamps. */
export interface InfoThreatInput {
  cibScore: number;
  foreignMediaScore: number;
  narrativeWarfareScore: number;
  manipulationSignalScore: number;
  stateActorCampaignScore: number;
  attributionConfidenceScore: number;
}

/** Weights sum to 1.0. CIB and narrative warfare are weighted highest
 *  because they map most directly to observable downstream harm
 *  (election interference, ethnic violence, public-health denial).
 *  Attribution confidence is weighted lowest because it modulates the
 *  *interpretation* of the other signals rather than being a harm itself.
 */
export const INFO_THREAT_WEIGHTS: Readonly<Record<keyof InfoThreatInput, number>> = {
  cibScore: 0.25,
  foreignMediaScore: 0.15,
  narrativeWarfareScore: 0.25,
  manipulationSignalScore: 0.15,
  stateActorCampaignScore: 0.15,
  attributionConfidenceScore: 0.05,
};

export const INFO_THREAT_COMPONENT_LABEL: Readonly<Record<keyof InfoThreatInput, string>> = {
  cibScore: 'Coordinated Inauthentic Behavior',
  foreignMediaScore: 'Foreign State Media',
  narrativeWarfareScore: 'Narrative Warfare',
  manipulationSignalScore: 'Manipulation Signals',
  stateActorCampaignScore: 'State Actor Campaigns',
  attributionConfidenceScore: 'Attribution Confidence',
};

export interface InfoThreatIndex {
  score: number;
  band: InfoThreatBand;
  /** Largest weighted contribution. `null` only when every component
   *  is exactly zero. */
  topDriver: string | null;
  weightedContributions: Readonly<Record<keyof InfoThreatInput, number>>;
}

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function computeInfoThreatIndex(input: InfoThreatInput): InfoThreatIndex {
  const contributions: Record<keyof InfoThreatInput, number> = {
    cibScore: 0,
    foreignMediaScore: 0,
    narrativeWarfareScore: 0,
    manipulationSignalScore: 0,
    stateActorCampaignScore: 0,
    attributionConfidenceScore: 0,
  };
  let score = 0;
  let topKey: keyof InfoThreatInput | null = null;
  let topValue = 0;
  for (const key of Object.keys(INFO_THREAT_WEIGHTS) as (keyof InfoThreatInput)[]) {
    const clamped = clamp100(input[key]);
    const contribution = clamped * INFO_THREAT_WEIGHTS[key];
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
    band: bandForInfoThreat(rounded),
    topDriver: topKey === null ? null : INFO_THREAT_COMPONENT_LABEL[topKey],
    weightedContributions: contributions,
  };
}

export function bandForInfoThreat(score: number): InfoThreatBand {
  if (score < 20) return 'low';
  if (score < 40) return 'moderate';
  if (score < 60) return 'elevated';
  if (score < 80) return 'severe';
  return 'critical';
}

export function infoThreatBandColor(band: InfoThreatBand): string {
  const colors: Record<InfoThreatBand, string> = {
    low:      'var(--severity-low,      #4caf50)',
    moderate: 'var(--severity-medium,   #facc15)',
    elevated: 'var(--severity-high,     #fb923c)',
    severe:   'var(--severity-critical, #ef4444)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[band];
}

// ── Severity scale shared by row helpers ───────────────────────────────

export type InfoSeverity = 'low' | 'moderate' | 'high' | 'critical';

const SEVERITY_RANK: Record<InfoSeverity, number> = {
  critical: 3, high: 2, moderate: 1, low: 0,
};

export function severityColor(s: InfoSeverity): string {
  const colors: Record<InfoSeverity, string> = {
    low:      'var(--severity-low,      #4caf50)',
    moderate: 'var(--severity-medium,   #facc15)',
    high:     'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function severityLabel(s: InfoSeverity): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Coordinated Inauthentic Behavior (CIB) ─────────────────────────────

/** "Coordinated Inauthentic Behavior" is the term platforms use in
 *  their public takedown reports for networks of fake accounts acting
 *  in concert. The panel ingests *analytic descriptions* of takedowns —
 *  not operational instructions for running such networks. */
export interface CibEvent {
  id: string;
  /** Reporting platform (Meta, X, TikTok, YouTube, etc.) */
  platform: string;
  /** Suspected origin state, or `'unattributed'` when the takedown
   *  report did not name an actor. */
  attribution: string;
  /** Number of accounts/assets taken down in this network. */
  accountCount: number;
  /** Region or audience the network was targeting. */
  targetAudience: string;
  /** Plain-language description of the network's observed behavior. */
  narrative: string;
  /** Attribution confidence as reported by the takedown source, `[0, 1]`. */
  confidence: number;
  observedAt: number;
}

export interface CibRow {
  id: string;
  platform: string;
  attribution: string;
  accountCount: number;
  targetAudience: string;
  narrative: string;
  confidence: number;
  severity: InfoSeverity;
  ageLabel: string;
}

/** Severity rules:
 *  - >= 1000 accounts → critical
 *  - >= 200 accounts → high
 *  - >= 20 accounts → moderate
 *  - otherwise low
 *  Low-confidence takedowns (< 0.4) are capped at `moderate` since the
 *  attribution and even the takedown itself may not survive review.
 */
export function severityForCibEvent(accountCount: number, confidence: number): InfoSeverity {
  let base: InfoSeverity;
  if (accountCount >= 1000) base = 'critical';
  else if (accountCount >= 200) base = 'high';
  else if (accountCount >= 20) base = 'moderate';
  else base = 'low';
  if (clamp01(confidence) < 0.4 && SEVERITY_RANK[base] > SEVERITY_RANK.moderate) {
    return 'moderate';
  }
  return base;
}

export function summarizeCibEvents(events: readonly CibEvent[], nowMs: number): CibRow[] {
  const rows: CibRow[] = events.map((e) => ({
    id: e.id,
    platform: e.platform,
    attribution: e.attribution,
    accountCount: e.accountCount,
    targetAudience: e.targetAudience,
    narrative: e.narrative,
    confidence: clamp01(e.confidence),
    severity: severityForCibEvent(e.accountCount, e.confidence),
    ageLabel: formatAge(e.observedAt, nowMs),
  }));
  rows.sort((a, b) => {
    const sevDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sevDelta !== 0) return sevDelta;
    const ae = events.find((x) => x.id === a.id)?.observedAt ?? 0;
    const be = events.find((x) => x.id === b.id)?.observedAt ?? 0;
    return be - ae;
  });
  return rows;
}

// ── Foreign state media influence campaigns ────────────────────────────

export type CampaignTrajectory = 'escalating' | 'steady' | 'declining';

/** Public reporting on a foreign-state-affiliated media outlet's
 *  observed influence campaign. Source is typically the outlet's own
 *  output volume + academic / OSINT analysis of theme alignment. */
export interface ForeignMediaCampaign {
  id: string;
  /** Originating state (the state aligned with the outlet). */
  originState: string;
  outlet: string;
  /** Plain-language theme the campaign appears to be pushing. */
  theme: string;
  /** Regions or audiences observed receiving the campaign. */
  regionsTargeted: readonly string[];
  /** 1..5 — observed campaign intensity (volume + reach). */
  intensity: number;
  trajectory: CampaignTrajectory;
  observedAt: number;
}

export interface ForeignMediaCampaignRow {
  id: string;
  originState: string;
  outlet: string;
  theme: string;
  regionsTargeted: readonly string[];
  intensity: number;
  intensityLabel: string;
  trajectory: CampaignTrajectory;
  ageLabel: string;
}

export function clampIntensity(n: number): number {
  if (!Number.isFinite(n)) return 1;
  if (n < 1) return 1;
  if (n > 5) return 5;
  return Math.round(n);
}

export function intensityLabel(intensity: number): string {
  const n = clampIntensity(intensity);
  switch (n) {
    case 1: { return 'Background';
    }
    case 2: { return 'Modest';
    }
    case 3: { return 'Sustained';
    }
    case 4: { return 'Heavy';
    }
    case 5: { return 'Saturation';
    }
    default: { return 'Unknown';
    }
  }
}

export function trajectoryColor(t: CampaignTrajectory): string {
  const colors: Record<CampaignTrajectory, string> = {
    escalating: 'var(--severity-critical, #ef4444)',
    steady:     'var(--severity-medium,   #facc15)',
    declining:  'var(--severity-low,      #4caf50)',
  };
  return colors[t];
}

export function trajectoryLabel(t: CampaignTrajectory): string {
  const labels: Record<CampaignTrajectory, string> = {
    escalating: '↑ Escalating',
    steady:     '→ Steady',
    declining:  '↓ Declining',
  };
  return labels[t];
}

export function summarizeForeignMediaCampaigns(
  campaigns: readonly ForeignMediaCampaign[],
  nowMs: number,
): ForeignMediaCampaignRow[] {
  const rows: ForeignMediaCampaignRow[] = campaigns.map((c) => ({
    id: c.id,
    originState: c.originState,
    outlet: c.outlet,
    theme: c.theme,
    regionsTargeted: c.regionsTargeted,
    intensity: clampIntensity(c.intensity),
    intensityLabel: intensityLabel(c.intensity),
    trajectory: c.trajectory,
    ageLabel: formatAge(c.observedAt, nowMs),
  }));
  rows.sort((a, b) => {
    if (a.intensity !== b.intensity) return b.intensity - a.intensity;
    const ae = campaigns.find((x) => x.id === a.id)?.observedAt ?? 0;
    const be = campaigns.find((x) => x.id === b.id)?.observedAt ?? 0;
    return be - ae;
  });
  return rows;
}

// ── Narrative warfare by region ────────────────────────────────────────

export type PolarizationBand = 'cohesive' | 'divided' | 'polarized' | 'fractured';

export interface NarrativeRegion {
  region: string;
  /** Plain-language description of the most prominent contested
   *  narrative in this region (e.g. "election legitimacy"). */
  topNarrative: string;
  /** 0..100 — observed narrative-warfare intensity. */
  intensity: number;
  /** 0..100 — observed audience polarization on this narrative. */
  polarization: number;
  /** 24-hour volume of related public posts (or other observation
   *  count, depending on data source). */
  volume24h: number;
  /** Approximate source mix percentages on the relevant signal.
   *  Should sum to ~100 but the helper tolerates noisy inputs. */
  sourceMix: {
    stateAlignedPct: number;
    partisanMediaPct: number;
    organicPct: number;
  };
}

export interface NarrativeRegionRow {
  region: string;
  topNarrative: string;
  intensity: number;
  polarization: number;
  polarizationBand: PolarizationBand;
  volume24h: number;
  sourceMix: NarrativeRegion['sourceMix'];
  dominantSource: 'state-aligned' | 'partisan-media' | 'organic';
}

export function polarizationBand(polarization: number): PolarizationBand {
  const p = clamp100(polarization);
  if (p < 25) return 'cohesive';
  if (p < 50) return 'divided';
  if (p < 75) return 'polarized';
  return 'fractured';
}

export function polarizationBandColor(b: PolarizationBand): string {
  const colors: Record<PolarizationBand, string> = {
    cohesive:  'var(--severity-low,      #4caf50)',
    divided:   'var(--severity-medium,   #facc15)',
    polarized: 'var(--severity-high,     #fb923c)',
    fractured: 'var(--severity-critical, #ef4444)',
  };
  return colors[b];
}

export function polarizationBandLabel(b: PolarizationBand): string {
  return b.charAt(0).toUpperCase() + b.slice(1);
}

function dominantSourceOf(mix: NarrativeRegion['sourceMix']): NarrativeRegionRow['dominantSource'] {
  const entries: readonly [NarrativeRegionRow['dominantSource'], number][] = [
    ['state-aligned',  Math.max(0, mix.stateAlignedPct)],
    ['partisan-media', Math.max(0, mix.partisanMediaPct)],
    ['organic',        Math.max(0, mix.organicPct)],
  ];
  return entries.reduce((acc, cur) => (cur[1] > acc[1] ? cur : acc))[0];
}

export function summarizeNarrativeRegions(
  regions: readonly NarrativeRegion[],
): NarrativeRegionRow[] {
  const rows: NarrativeRegionRow[] = regions.map((r) => ({
    region: r.region,
    topNarrative: r.topNarrative,
    intensity: clamp100(r.intensity),
    polarization: clamp100(r.polarization),
    polarizationBand: polarizationBand(r.polarization),
    volume24h: Math.max(0, Math.trunc(r.volume24h)),
    sourceMix: r.sourceMix,
    dominantSource: dominantSourceOf(r.sourceMix),
  }));
  rows.sort((a, b) => {
    if (a.intensity !== b.intensity) return b.intensity - a.intensity;
    return b.polarization - a.polarization;
  });
  return rows;
}

// ── Social-media manipulation signals (defensive detection) ────────────

/** Detection-side signal types, NOT operational instructions. */
export type ManipulationKind =
  | 'bot_amplification'
  | 'hashtag_manipulation'
  | 'deepfake_detected'
  | 'cross_platform_coordination'
  | 'astroturf_pattern'
  | 'compromised_account_cluster';

export interface ManipulationSignal {
  id: string;
  platform: string;
  kind: ManipulationKind;
  /** 0..100 — strength of the *detection* signal. */
  magnitude: number;
  /** 0..1 — detector's self-reported confidence. */
  confidence: number;
  /** Plain-language description of what was observed. */
  description: string;
  detectedAt: number;
}

export interface ManipulationSignalRow {
  id: string;
  platform: string;
  kind: ManipulationKind;
  kindLabel: string;
  magnitude: number;
  confidence: number;
  severity: InfoSeverity;
  description: string;
  ageLabel: string;
}

export function manipulationKindLabel(k: ManipulationKind): string {
  const labels: Record<ManipulationKind, string> = {
    bot_amplification:           'Bot amplification',
    hashtag_manipulation:        'Hashtag manipulation',
    deepfake_detected:           'Deepfake detected',
    cross_platform_coordination: 'Cross-platform coordination',
    astroturf_pattern:           'Astroturf pattern',
    compromised_account_cluster: 'Compromised account cluster',
  };
  return labels[k];
}

/** Deepfake detections and compromised-account clusters are inherently
 *  higher severity at the same magnitude because the *kind* of signal
 *  is harder to reproduce by accident. Bot-amplification and hashtag
 *  manipulation are common enough that we require higher magnitude to
 *  reach the same severity rung. Low-confidence detections (< 0.4) are
 *  capped at moderate.
 */
export function severityForManipulationSignal(
  kind: ManipulationKind,
  magnitude: number,
  confidence: number,
): InfoSeverity {
  const mag = clamp100(magnitude);
  const conf = clamp01(confidence);
  const elevated = kind === 'deepfake_detected'
    || kind === 'compromised_account_cluster'
    || kind === 'cross_platform_coordination';
  let base: InfoSeverity;
  if (elevated) {
    if (mag >= 70) base = 'critical';
    else if (mag >= 40) base = 'high';
    else if (mag >= 20) base = 'moderate';
    else base = 'low';
  } else if (mag >= 80) base = 'critical';
  else if (mag >= 60) base = 'high';
  else if (mag >= 30) base = 'moderate';
  else base = 'low';
  if (conf < 0.4 && SEVERITY_RANK[base] > SEVERITY_RANK.moderate) return 'moderate';
  return base;
}

export function summarizeManipulationSignals(
  signals: readonly ManipulationSignal[],
  nowMs: number,
): ManipulationSignalRow[] {
  const rows: ManipulationSignalRow[] = signals.map((s) => ({
    id: s.id,
    platform: s.platform,
    kind: s.kind,
    kindLabel: manipulationKindLabel(s.kind),
    magnitude: clamp100(s.magnitude),
    confidence: clamp01(s.confidence),
    severity: severityForManipulationSignal(s.kind, s.magnitude, s.confidence),
    description: s.description,
    ageLabel: formatAge(s.detectedAt, nowMs),
  }));
  rows.sort((a, b) => {
    const sevDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sevDelta !== 0) return sevDelta;
    const ae = signals.find((x) => x.id === a.id)?.detectedAt ?? 0;
    const be = signals.find((x) => x.id === b.id)?.detectedAt ?? 0;
    return be - ae;
  });
  return rows;
}

// ── Strategic communication campaigns by state actor (observed) ────────

export interface StateActorCampaign {
  id: string;
  /** Observed state actor (e.g. country or named state-affiliated outlet). */
  actor: string;
  /** Plain-language campaign name. */
  campaign: string;
  /** Theme or message the campaign appears to be pushing. */
  theme: string;
  /** Observed target audience (e.g. "Russian diaspora", "voters in Region X"). */
  targetAudience: string;
  /** Observed mediums of distribution. */
  mediums: readonly ('tv' | 'radio' | 'social' | 'diaspora' | 'state_outlet' | 'satellite' | 'print')[];
  /** Analytic inference of the campaign's likely intent. Plain-language
   *  description, not a controlled vocabulary — we want analysts to be
   *  able to express nuance here. */
  intentInference: string;
  observedAt: number;
}

export interface StateActorCampaignRow {
  id: string;
  actor: string;
  campaign: string;
  theme: string;
  targetAudience: string;
  mediums: readonly string[];
  mediumCount: number;
  intentInference: string;
  ageLabel: string;
}

export function summarizeStateActorCampaigns(
  campaigns: readonly StateActorCampaign[],
  nowMs: number,
): StateActorCampaignRow[] {
  const rows: StateActorCampaignRow[] = campaigns.map((c) => ({
    id: c.id,
    actor: c.actor,
    campaign: c.campaign,
    theme: c.theme,
    targetAudience: c.targetAudience,
    mediums: c.mediums,
    mediumCount: c.mediums.length,
    intentInference: c.intentInference,
    ageLabel: formatAge(c.observedAt, nowMs),
  }));
  rows.sort((a, b) => {
    if (a.mediumCount !== b.mediumCount) return b.mediumCount - a.mediumCount;
    const ae = campaigns.find((x) => x.id === a.id)?.observedAt ?? 0;
    const be = campaigns.find((x) => x.id === b.id)?.observedAt ?? 0;
    return be - ae;
  });
  return rows;
}

// ── Disinformation attribution confidence ──────────────────────────────

export type AttributionMethod =
  | 'technical'
  | 'behavioral'
  | 'linguistic'
  | 'distribution'
  | 'multi_method';

export type AttributionTier = 'unverified' | 'low' | 'moderate' | 'likely' | 'high';

export interface AttributionAssessment {
  id: string;
  /** Plain-language description of the disinformation claim under
   *  assessment. */
  claim: string;
  /** Suspected actor (state or non-state). `'unattributed'` when no
   *  actor is named. */
  suspectedActor: string;
  method: AttributionMethod;
  /** 0..1 — the analyst's confidence in the attribution. */
  confidence: number;
  /** Number of independent corroborating analyses. */
  corroborationCount: number;
  /** True when at least one credible dissenting analysis exists.
   *  Surfacing dissent in the row keeps contradictions from being
   *  averaged away. */
  dissent: boolean;
  assessedAt: number;
}

export interface AttributionAssessmentRow {
  id: string;
  claim: string;
  suspectedActor: string;
  method: AttributionMethod;
  methodLabel: string;
  confidence: number;
  tier: AttributionTier;
  corroborationCount: number;
  dissent: boolean;
  ageLabel: string;
}

export function attributionMethodLabel(m: AttributionMethod): string {
  const labels: Record<AttributionMethod, string> = {
    technical:    'Technical',
    behavioral:   'Behavioral',
    linguistic:   'Linguistic',
    distribution: 'Distribution',
    multi_method: 'Multi-method',
  };
  return labels[m];
}

/** Tier ladder:
 *  - < 0.2 → unverified
 *  - < 0.4 → low
 *  - < 0.6 → moderate
 *  - < 0.8 → likely
 *  - otherwise → high
 *  A dissenting analysis demotes the tier by one rung (capped at
 *  `unverified`). Multi-method attributions promote by one rung
 *  (capped at `high`).
 */
export function attributionTier(
  confidence: number,
  method: AttributionMethod,
  dissent: boolean,
): AttributionTier {
  const c = clamp01(confidence);
  const ladder: AttributionTier[] = ['unverified', 'low', 'moderate', 'likely', 'high'];
  let idx: number;
  if (c < 0.2) idx = 0;
  else if (c < 0.4) idx = 1;
  else if (c < 0.6) idx = 2;
  else if (c < 0.8) idx = 3;
  else idx = 4;
  if (method === 'multi_method') idx = Math.min(ladder.length - 1, idx + 1);
  if (dissent) idx = Math.max(0, idx - 1);
  return ladder[idx] as AttributionTier;
}

export function attributionTierColor(t: AttributionTier): string {
  const colors: Record<AttributionTier, string> = {
    unverified: 'var(--text-secondary,    #9e9e9e)',
    low:        'var(--severity-medium,   #facc15)',
    moderate:   'var(--severity-high,     #fb923c)',
    likely:     'var(--severity-critical, #ef4444)',
    high:       'var(--severity-critical, #ef4444)',
  };
  return colors[t];
}

export function attributionTierLabel(t: AttributionTier): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function summarizeAttributionAssessments(
  assessments: readonly AttributionAssessment[],
  nowMs: number,
): AttributionAssessmentRow[] {
  const rows: AttributionAssessmentRow[] = assessments.map((a) => ({
    id: a.id,
    claim: a.claim,
    suspectedActor: a.suspectedActor,
    method: a.method,
    methodLabel: attributionMethodLabel(a.method),
    confidence: clamp01(a.confidence),
    tier: attributionTier(a.confidence, a.method, a.dissent),
    corroborationCount: Math.max(0, Math.trunc(a.corroborationCount)),
    dissent: a.dissent,
    ageLabel: formatAge(a.assessedAt, nowMs),
  }));
  const TIER_RANK: Record<AttributionTier, number> = {
    high: 4, likely: 3, moderate: 2, low: 1, unverified: 0,
  };
  rows.sort((a, b) => {
    const tierDelta = TIER_RANK[b.tier] - TIER_RANK[a.tier];
    if (tierDelta !== 0) return tierDelta;
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    const ae = assessments.find((x) => x.id === a.id)?.assessedAt ?? 0;
    const be = assessments.find((x) => x.id === b.id)?.assessedAt ?? 0;
    return be - ae;
  });
  return rows;
}

// ── Counts / aggregators for header badge ──────────────────────────────

export function countCriticalCib(rows: readonly CibRow[]): number {
  return rows.filter((r) => r.severity === 'critical').length;
}

export function countEscalatingForeignCampaigns(rows: readonly ForeignMediaCampaignRow[]): number {
  return rows.filter((r) => r.trajectory === 'escalating').length;
}

export function countFracturedRegions(rows: readonly NarrativeRegionRow[]): number {
  return rows.filter((r) => r.polarizationBand === 'fractured').length;
}

export function countHighSeverityManipulation(rows: readonly ManipulationSignalRow[]): number {
  return rows.filter((r) => r.severity === 'critical' || r.severity === 'high').length;
}

export function countLikelyOrHighAttribution(rows: readonly AttributionAssessmentRow[]): number {
  return rows.filter((r) => r.tier === 'likely' || r.tier === 'high').length;
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
