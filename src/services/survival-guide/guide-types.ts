/**
 * Survival Guide — static reference content types.
 *
 * Pure data contract. No DOM, no fetch, no globals. Guides are hand-authored
 * from public-domain US guidance (Ready.gov / FEMA / NWS / CDC) and read
 * offline. See docs/superpowers/specs/2026-07-16-survival-guide-design.md.
 */

export type GuideId =
  // hazards (17)
  | 'tornado'
  | 'flood'
  | 'hurricane'
  | 'severe_thunderstorm'
  | 'winter_storm'
  | 'extreme_heat'
  | 'wildfire'
  | 'wildfire_smoke'
  | 'earthquake'
  | 'power_grid_outage'
  | 'fuel_shortage'
  | 'food_shortage'
  | 'disease_outbreak'
  | 'cyber_banking_outage'
  | 'civil_unrest'
  | 'armed_conflict'
  | 'nuclear_radiological'
  // preparedness basics (7)
  | 'go_bag'
  | 'water_storage'
  | 'food_storage'
  | 'family_comms_plan'
  | 'first_aid_basics'
  | 'evacuation_planning'
  | 'shelter_in_place';

export type GuideKind = 'hazard' | 'preparedness';

export interface ChecklistItem {
  /** Globally unique + stable forever. Persistence keys on this, never index. */
  id: string;
  label: string;
  detail?: string;
  /** Importance weight; readiness scoring honors it. */
  weight: 1 | 2 | 3;
}

export interface GuideStep {
  /** Imperative, execution order. */
  label: string;
  /** The "why"/how-to depth the terse playbooks lack. */
  detail?: string;
}

export interface SurvivalGuide {
  id: GuideId;
  kind: GuideKind;
  title: string;
  /** One paragraph: what this is, why it's dangerous. */
  summary: string;
  /** Early indicators / how you'll know. */
  signs: string[];
  /** Days-to-hours ahead. */
  prepare: GuideStep[];
  /** Act-now, most-urgent-first. */
  during: GuideStep[];
  /** First minutes-to-hours after. */
  after: GuideStep[];
  /** Days-to-weeks. */
  recovery: string[];
  /** Deadly mistakes to avoid (rendered loud). */
  mistakes: string[];
  /** Supplies/prep; may be empty for pure-response hazards. */
  checklist: ChecklistItem[];
  relatedGuides: GuideId[];
  /** Provenance — e.g. 'Ready.gov — Tornadoes', 'NWS', 'FEMA P-320', 'CDC'. */
  sources: string[];
}

export interface GuideReadiness {
  guideId: GuideId;
  percent: number;
  checkedWeight: number;
  totalWeight: number;
  checkedCount: number;
  totalCount: number;
}

export interface OverallReadiness {
  percent: number;
  weakest: GuideId | null;
}
