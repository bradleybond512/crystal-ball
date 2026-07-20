// src/services/survival/personal-lens.ts
/**
 * The World Stage personal lens (Grand-Strategy Survival OS, E4 — "world stage,
 * personal lens"). A pure, global scoring filter that tints/prioritizes board
 * items by *survival relevance to the user*, so the God's Vision board can light
 * up what matters and dim the rest.
 *
 * It is a FUSION layer over engines that already exist — it does not re-implement
 * proximity / watchlist / portfolio / route matching:
 *   1. Personal exposure — from `mapEventsToPersonalImpact` (is this event near my
 *      places, on my tickers, on my routes/utilities?).
 *   2. Survival-posture axis heat — the E4-specific dimension: an event whose
 *      domain maps to a currently-hot survival axis matters more (a market shock
 *      while the financial axis is already elevated is board-critical).
 *   3. Raw event severity.
 *
 * Output per event: a 0–1 relevance, a board tier, the survival axis it belongs
 * to, and plain-English drivers. Pure: no fetch/DOM/state.
 */
import type { SurvivalAxis, SurvivalPosture } from './survival-types.ts';
import type {
  IncomingEvent,
  PersonalProfile,
  ImpactCategory,
} from '../personal/personal-impact.ts';
import { mapEventsToPersonalImpact } from '../personal/personal-impact.ts';

export type LensTier = 'core' | 'elevated' | 'ambient' | 'background';

export interface LensView {
  eventId: string;
  /** 0–1 survival relevance to the user. */
  relevance: number;
  tier: LensTier;
  /** The survival axis this event's domain maps to. */
  axis: SurvivalAxis;
  /** Plain-English reasons the item is lit up (or dimmed) on the board. */
  drivers: string[];
}

/** A board render hint per tier — the board maps these to marker styling. */
export interface LensTint {
  /** Fill opacity 0–1: core items are opaque, background items fade out. */
  opacity: number;
  /** Higher renders on top / sorts first. */
  priority: number;
  /** Whether the item should be labeled by default at this tier. */
  labeled: boolean;
}

// Event-domain → survival axis. Domains are free-text from upstream signals, so
// this normalizes common aliases; unknown domains fall back to physical_safety
// (the "is this dangerous to me right now" axis).
const DOMAIN_AXIS: Record<string, SurvivalAxis> = {
  weather: 'physical_safety',
  storm: 'physical_safety',
  disaster: 'physical_safety',
  earthquake: 'physical_safety',
  wildfire: 'physical_safety',
  market: 'financial',
  markets: 'financial',
  finance: 'financial',
  financial: 'financial',
  economy: 'financial',
  shortage: 'supply',
  commodity: 'supply',
  supply: 'supply',
  food: 'supply',
  cyber: 'security',
  conflict: 'security',
  military: 'security',
  war: 'security',
  security: 'security',
  terrorism: 'security',
  disease: 'health',
  outbreak: 'health',
  health: 'health',
  pandemic: 'health',
  comms: 'comms',
  internet: 'comms',
  outage: 'comms',
  telecom: 'comms',
  energy: 'energy_water',
  grid: 'energy_water',
  power: 'energy_water',
  water: 'energy_water',
  infra: 'energy_water',
  infrastructure: 'energy_water',
  macro: 'financial',
  maritime: 'mobility',
  shipping: 'mobility',
  chokepoint: 'mobility',
  aviation: 'mobility',
  transport: 'mobility',
};

export function axisForDomain(domain: string): SurvivalAxis {
  return DOMAIN_AXIS[domain.trim().toLowerCase()] ?? 'physical_safety';
}

// The personal dimension weights by the KIND of exposure (life/home > utility >
// travel/finance), which `decideCategory` derives from exposure type only — NOT
// from event severity. Severity is scored as its own separate dimension, so
// keying the personal weight off category avoids double-counting it.
const CATEGORY_WEIGHT: Record<ImpactCategory, number> = {
  immediate_risk: 1,
  family_place: 1,
  utility: 0.85,
  travel: 0.7,
  financial: 0.7,
  dormant: 0,
};

export interface LensWeights {
  /** Weight on personal exposure (by category; severity-independent). */
  personal: number;
  /** Weight on the survival-posture axis heat. */
  axisHeat: number;
  /** Weight on raw event severity. */
  severity: number;
}

const DEFAULT_WEIGHTS: LensWeights = { personal: 0.5, axisHeat: 0.3, severity: 0.2 };

export interface LensOptions {
  now?: () => number;
  weights?: Partial<LensWeights>;
  /** Match radius passed through to the personal-impact engine. */
  defaultMatchRadiusKm?: number;
}

function tierForRelevance(relevance: number): LensTier {
  if (relevance >= 0.7) return 'core';
  if (relevance >= 0.45) return 'elevated';
  if (relevance >= 0.2) return 'ambient';
  return 'background';
}

const TIER_TINT: Record<LensTier, LensTint> = {
  core: { opacity: 1, priority: 3, labeled: true },
  elevated: { opacity: 0.85, priority: 2, labeled: true },
  ambient: { opacity: 0.55, priority: 1, labeled: false },
  background: { opacity: 0.25, priority: 0, labeled: false },
};

/** Board render hint for a lens tier. Pure lookup, exported for the board. */
export function lensTint(tier: LensTier): LensTint {
  return TIER_TINT[tier];
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Score every event through the personal lens against the user's profile and
 * current survival posture. Returns one `LensView` per event, sorted by
 * relevance desc (ties broken by eventId for determinism).
 */
export function applyPersonalLens(
  events: readonly IncomingEvent[],
  profile: PersonalProfile,
  posture: SurvivalPosture,
  options: LensOptions = {},
): LensView[] {
  const w = { ...DEFAULT_WEIGHTS, ...options.weights };
  const weightSum = w.personal + w.axisHeat + w.severity || 1;

  const report = mapEventsToPersonalImpact(profile, events, {
    now: options.now,
    defaultMatchRadiusKm: options.defaultMatchRadiusKm,
    // Score every event on the board, including sub-floor ones (they become
    // 'dormant'/'background') so nothing silently vanishes from the board.
    dormantSeverityFloor: 0,
  });
  const impactByEvent = new Map(report.impacts.map((i) => [i.eventId, i]));

  const axisLevel = new Map<SurvivalAxis, number>(posture.axes.map((a) => [a.axis, a.level]));

  const views: LensView[] = events.map((event) => {
    const axis = axisForDomain(event.domain);
    const impact = impactByEvent.get(event.eventId);
    // Personal dimension = actual personal exposure (near a saved place, on a
    // held ticker, on a route/utility), weighted by exposure category (severity-
    // independent — see CATEGORY_WEIGHT). Raw event severity is scored separately.
    const hasExposure = impact != null && impact.exposures.length > 0;
    const personalWeight = hasExposure ? CATEGORY_WEIGHT[impact.category] : 0;
    const axisHeat = clamp01((axisLevel.get(axis) ?? 0) / 100);
    const severityWeight = clamp01(event.severity / 100);

    const relevance = clamp01(
      (w.personal * personalWeight + w.axisHeat * axisHeat + w.severity * severityWeight) / weightSum,
    );
    const tier = tierForRelevance(relevance);

    const drivers: string[] = [];
    if (hasExposure) {
      drivers.push(impact.reason);
    }
    if (axisHeat >= 0.3) {
      drivers.push(`On elevated ${axis.replace('_', '/')} axis (${Math.round(axisHeat * 100)})`);
    }
    if (severityWeight >= 0.5) {
      drivers.push(`High signal severity (${Math.round(event.severity)})`);
    }
    if (drivers.length === 0) {
      drivers.push('No personal exposure or axis heat — ambient board context');
    }

    return { eventId: event.eventId, relevance, tier, axis, drivers };
  });

  views.sort((a, b) => b.relevance - a.relevance || a.eventId.localeCompare(b.eventId));
  return views;
}
