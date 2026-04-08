/**
 * Situation Awareness Engine — Type Definitions
 *
 * Core loop: Observe → Verify → Correlate → Forecast → Personalize → Recommend → Reassess
 *
 * A "Situation" is a named, evolving cluster of correlated signals that together
 * describe an unfolding real-world event. Situations have lifecycles, produce
 * forecasts (Scenarios), and generate user-specific ActionCards.
 */

import type { EvidencePack } from './evidence-pack';

// ── Situation Lifecycle ──────────────────────────────────────────────────────

export type SituationPhase =
  | 'emerging' // weak signals clustering, low confidence
  | 'developing' // multiple corroborating signals, confidence rising
  | 'active' // high-confidence, actionable situation
  | 'de-escalating'  // signals fading, confidence dropping
  | 'resolved'; // no new signals for cooldown period

export type SituationDomain =
  | 'military'
  | 'economic'
  | 'natural_hazard'
  | 'cyber'
  | 'infrastructure'
  | 'health'
  | 'civil_unrest'
  | 'compound'; // cross-domain (most dangerous)

// ── Situation ────────────────────────────────────────────────────────────────

export interface SituationGeo {
  /** Primary latitude */
  lat: number;
  /** Primary longitude */
  lon: number;
  /** Human label: country, region, or specific location */
  label: string;
  /** ISO 3166-1 alpha-3 codes involved */
  countries: string[];
  /** Radius of effect in km */
  radiusKm: number;
}

export type VerificationVerdict = 'verified' | 'likely' | 'unverified' | 'contradicted';

export interface VerificationDetails {
  /** Count of distinct source types (e.g. RSS, GDACS, NWS, ACLED, correlation-signal, cyber) */
  independentSources: number;
  /** Whether signals from different sources arrived within a tight window (< 30 min) */
  temporalCorroboration: boolean;
  /** Whether signals span 2+ distinct domains */
  crossDomainVerified: boolean;
  /** Whether signals contain conflicting severity assessments */
  hasContradictions: boolean;
  /** 0–1 freshness score (1 = very fresh, decays with staleness) */
  freshnessScore: number;
  /** Overall verification verdict */
  overallVerdict: VerificationVerdict;
}

export interface Situation {
  id: string;
  /** Short human-readable title, e.g. "Taiwan Strait Military Buildup" */
  title: string;
  /** 1–2 sentence summary of what's happening */
  summary: string;
  phase: SituationPhase;
  domain: SituationDomain;
  /** 0–1 composite confidence across all contributing signals */
  confidence: number;
  /** Geographic focus */
  geo: SituationGeo;
  /** IDs of contributing CorrelationSignals */
  signalIds: string[];
  /** Snapshot of key signals for display (avoids re-lookup) */
  signals: SituationSignalSnapshot[];
  /** Cross-domain amplification: how many distinct domains contribute */
  domainDiversity: number;
  /** Evidence aggregated from all contributing signals */
  evidence: EvidencePack | null;
  /** Multi-factor verification details from the OODA verify step */
  verificationDetails?: VerificationDetails;
  /** Projected scenarios (sorted by probability descending) */
  scenarios: Scenario[];
  /** User-specific action recommendations */
  actions: ActionCard[];
  /** Causal chain template that matched, if any */
  causalChainId: string | null;
  /** When this situation was first detected */
  firstSeen: number;
  /** Last signal ingested */
  lastUpdated: number;
  /** How many reassessment cycles this situation has survived */
  reassessmentCount: number;
}

export interface SituationSignalSnapshot {
  id: string;
  type: string;
  title: string;
  confidence: number;
  timestamp: number;
  domain: SituationDomain;
}

// ── Scenario (Forecast) ──────────────────────────────────────────────────────

export type ScenarioSeverity = 'catastrophic' | 'severe' | 'moderate' | 'minor' | 'positive';

export interface Scenario {
  id: string;
  /** Short label, e.g. "Full naval blockade within 72h" */
  label: string;
  /** Longer description of what this outcome looks like */
  description: string;
  /** 0–1 estimated probability */
  probability: number;
  severity: ScenarioSeverity;
  /** Time horizon in hours */
  horizonHours: number;
  /** What indicators would confirm this scenario is unfolding */
  confirmationIndicators: string[];
  /** What indicators would invalidate this scenario */
  invalidationIndicators: string[];
}

// ── Action Card (Personalized Recommendation) ────────────────────────────────

export type ActionUrgency = 'immediate' | 'soon' | 'monitor' | 'fyi';

export type ActionCategory =
  | 'physical_safety'
  | 'financial'
  | 'supply_chain'
  | 'cyber_hygiene'
  | 'communications'
  | 'travel'
  | 'information';

export interface ActionCard {
  id: string;
  /** Imperative headline: "Review Taiwan supply chain exposure" */
  headline: string;
  /** Why this matters to the user specifically */
  rationale: string;
  urgency: ActionUrgency;
  category: ActionCategory;
  /** Concrete steps the user can take */
  steps: string[];
  /** Which situation produced this card */
  situationId: string;
  /** Which scenario this action hedges against (null = general) */
  scenarioId: string | null;
  /** Has the user dismissed this card? */
  dismissed: boolean;
}

// ── Causal Chain Templates ───────────────────────────────────────────────────

export interface CausalLink {
  /** Signal type that triggers this link */
  triggerType: string;
  /** Signal type that follows */
  effectType: string;
  /** Typical delay in hours */
  delayHours: number;
  /** How often this chain fires historically (0–1) */
  historicalRate: number;
  /** Description for UI */
  label: string;
}

export interface CausalTemplate {
  id: string;
  name: string;
  domain: SituationDomain;
  /** Ordered chain of cause → effect links */
  links: CausalLink[];
  /** Scenarios this chain typically produces */
  scenarioTemplates: Omit<Scenario, 'id' | 'probability'>[];
  /** Action templates triggered by this chain */
  actionTemplates: Omit<ActionCard, 'id' | 'situationId' | 'scenarioId' | 'dismissed'>[];
}

// ── Signal Domain Classification ─────────────────────────────────────────────

/** Maps CorrelationSignal types to situation domains */
export const SIGNAL_DOMAIN_MAP: Record<string, SituationDomain> = {
  // Military
  hotspot_escalation: 'military',
  military_surge: 'military',
  geo_convergence: 'military',
  // Economic
  news_leads_markets: 'economic',
  silent_divergence: 'economic',
  flow_price_divergence: 'economic',
  explained_market_move: 'economic',
  sector_cascade: 'economic',
  prediction_leads_news: 'economic',
  // Natural hazard
  flow_drop: 'natural_hazard',
  // Cyber
  // (cyber signals come through unified alerts, not correlation signals)
  // Civil unrest
  velocity_spike: 'civil_unrest',
  keyword_spike: 'civil_unrest',
  convergence: 'civil_unrest',
  triangulation: 'compound',
};

// ── Engine Configuration ─────────────────────────────────────────────────────

export interface SituationEngineConfig {
  /** Max active situations tracked simultaneously */
  maxSituations: number;
  /** Time window (ms) for clustering signals into the same situation */
  clusterWindowMs: number;
  /** Geographic proximity threshold (km) for clustering */
  clusterRadiusKm: number;
  /** Minimum confidence to promote from emerging → developing */
  developingThreshold: number;
  /** Minimum confidence to promote from developing → active */
  activeThreshold: number;
  /** Time without new signals (ms) before de-escalating */
  deescalationTimeoutMs: number;
  /** Time in de-escalating (ms) before resolving */
  resolutionTimeoutMs: number;
  /** Reassessment interval (ms) */
  reassessIntervalMs: number;
}

export const DEFAULT_ENGINE_CONFIG: SituationEngineConfig = {
  maxSituations: 20,
  clusterWindowMs: 6 * 60 * 60 * 1000, // 6 hours
  clusterRadiusKm: 500, // ~500km geographic clustering
  developingThreshold: 0.35,
  activeThreshold: 0.6,
  deescalationTimeoutMs: 30 * 60 * 1000, // 30 min quiet
  resolutionTimeoutMs: 2 * 60 * 60 * 1000,  // 2h in de-escalation → resolved
  reassessIntervalMs: 5 * 60 * 1000, // reassess every 5 min
};
