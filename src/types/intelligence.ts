/**
 * ObservationEvent — the normalized unit produced by each domain adapter
 * before facts enter the intelligence pipeline.
 *
 * Severity uses uppercase to distinguish from the existing lowercase `Severity`
 * type in src/services/intelligence/types.ts (which is for scored TruthScore
 * outputs). These are raw observation levels, not scored confidence labels.
 */

export type ObservationSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ObservationLocation {
  lat: number;
  lon: number;
  /** Approximate radius of uncertainty / event footprint in km. */
  radiusKm?: number;
}

// ── Playbook types ────────────────────────────────────────────────────────

export type PlaybookStepCategory = 'monitor' | 'notify' | 'prepare' | 'act' | 'verify';

export interface PlaybookStep {
  order: number;
  /** Human-readable instruction shown to the operator. */
  action: string;
  category: PlaybookStepCategory;
  /** True when Crystal Ball can execute this step without user interaction. */
  automated: boolean;
  /** Name of the automation function to invoke when automated === true. */
  automationFn?: string;
}

export interface Playbook {
  id: string;
  name: string;
  /** Event domains that trigger this playbook. Use '*' to match any domain. */
  triggerDomains: string[];
  /** At least one of these tags must appear on the event (empty = any tags). */
  triggerTags: string[];
  triggerSeverity: ObservationSeverity[];
  steps: PlaybookStep[];
}

// ── ObservationEvent ──────────────────────────────────────────────────────

export interface ObservationEvent {
  /** Stable identifier — should survive duplicate ingestion of the same event. */
  id: string;
  /** Provider/adapter that produced this observation, e.g. 'usgs-earthquake'. */
  sourceId: string;
  /** Domain matching FactDomain values from intelligence/types.ts. */
  domain: string;
  /** Unix epoch ms when the event occurred (not when it was ingested). */
  timestamp: number;
  location?: ObservationLocation;
  severity: ObservationSeverity;
  /** Short human-readable summary, e.g. "M5.8 earthquake near Tokyo". */
  title: string;
  /** Original provider payload, preserved for debugging and provenance. */
  raw: unknown;
  /** Entity IDs referenced by this event (MMSI, ICAO hex, country code, etc.). */
  entityIds: string[];
  /** Free-form classifier tags ('earthquake', 'tsunami-risk', 'ais-gap', etc.). */
  tags: string[];
}

/**
 * Situation — the primary intelligence product. Aggregates one or more
 * ObservationEvents and Correlations into a named, named-and-tracked
 * incident the user can monitor (e.g. "Hurricane Milton — Florida Coast").
 *
 * Severity uses the lowercase scoring scale from
 * `src/services/intelligence/types.ts` so it composes cleanly with the
 * truth-score / cluster-severity pipeline. The auto-creator in
 * `situation-detector.ts` maps uppercase ObservationSeverity to the
 * matching lowercase level when seeding a new Situation.
 */
export type SituationStatus = 'active' | 'monitoring' | 'resolved';

export type SituationSeverity = 'info' | 'low' | 'moderate' | 'high' | 'critical';

export interface SituationLocation {
  lat: number;
  lon: number;
  /** Radius of the situation footprint in km — used by `findNear` queries. */
  radiusKm: number;
}

export interface Situation {
  id: string;
  /** Human-readable name, e.g. "Hurricane Milton — Florida Coast". */
  name: string;
  status: SituationStatus;
  severity: SituationSeverity;
  /** Domain matching ObservationEvent.domain so cross-domain compound risks
   *  can still link multiple Situations together. */
  domain: string;
  /** ms since epoch when the situation was created. */
  startedAt: number;
  /** ms since epoch of the latest update (linked event, status change, …). */
  updatedAt: number;
  /** ObservationEvent ids that contributed evidence. */
  observationIds: string[];
  /** Correlation ids that referenced this situation. */
  correlationIds: string[];
  /** Generated 1-2 sentence summary shown in the panel + briefings. */
  summary: string;
  location?: SituationLocation;
  tags: string[];
  /** 0–1 confidence the situation is real / current. */
  confidence: number;
}
