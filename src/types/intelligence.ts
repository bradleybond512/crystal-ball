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
