/**
 * Earthquake action guidance — Phase 3 mission-bridge MVP.
 *
 * Pure function that turns a felt earthquake (magnitude, depth, distance to
 * the user, tsunami flag, population density) into a calm, proportionate
 * `ActionBrief`. Tiers run P1 (life-safety, shelter) → P5 (follow-up).
 *
 * The output shape matches `ActionBrief` exactly so the Command Center can
 * render it through the same path as weather briefs via
 * `insights-state.setActiveActionBrief`.
 *
 * Pure deterministic. No DOM, no fetch, no globals.
 */

import type { ActionBrief, ActionTier } from '../insights/action-briefs';

export interface EarthquakeActionContext {
  /** Coarse population exposure near the epicenter. */
  populationDensity?: 'low' | 'medium' | 'high';
  /** Whether an active tsunami warning covers the user's coastline. */
  tsunamiWarning?: boolean;
}

interface TieredAction {
  priority: 1 | 2 | 3 | 4 | 5;
  text: string;
  include: boolean;
}

const CONFIRMING_SOURCES = [
  'USGS earthquake feed',
  'NOAA / NWS tsunami bulletins',
  'Local emergency management',
  'ShakeMap intensity reports',
];

const INVALIDATING_SOURCES = [
  'USGS downgrades magnitude',
  'Tsunami warning canceled',
  'No aftershocks within 6 hours',
];

const RECOMMENDED_PANELS = ['Hazard Alerts', 'Weather', 'Family Tracker'];

/**
 * Build the action brief for a felt earthquake.
 *
 * @param magnitude    USGS moment magnitude.
 * @param depth        Hypocenter depth in km (shallow quakes shake harder).
 * @param distanceKm   Great-circle distance from the user to the epicenter.
 * @param opts         Tsunami flag + population-density context.
 */
export function actionsForEarthquake(
  magnitude: number,
  depth: number,
  distanceKm: number,
  opts: EarthquakeActionContext = {},
): ActionBrief {
  const tsunami = opts.tsunamiWarning === true;
  const shallow = depth <= 70;
  const tier = tierFor(magnitude, tsunami, distanceKm);

  const candidates: TieredAction[] = [
    // ── P1 — life safety ──────────────────────────────────────────────
    {
      priority: 1,
      text: 'Move to high ground immediately — do not wait for official confirmation',
      include: tsunami,
    },
    {
      priority: 1,
      text: 'Drop, cover, and hold on until the shaking stops',
      include: magnitude >= 6.5 || tsunami,
    },
    // ── P2 — immediate hazard control ─────────────────────────────────
    {
      priority: 2,
      text: 'Shut off the gas if you smell gas or hear hissing',
      include: magnitude >= 5.5,
    },
    {
      priority: 2,
      text: 'Check the building for cracks, leaning, or fallen debris before re-entering',
      include: magnitude >= 4.5,
    },
    // ── P3 — short-term resilience ────────────────────────────────────
    {
      priority: 3,
      text: 'Prepare for aftershocks — stay clear of damaged structures and heavy objects',
      include: magnitude >= 4.0,
    },
    {
      priority: 3,
      text: 'Store drinking water in case the supply is disrupted',
      include: magnitude >= 4.5,
    },
    // ── P4 — recovery + coordination ──────────────────────────────────
    {
      priority: 4,
      text: 'Document any damage with photos for insurance',
      include: magnitude >= 5.0,
    },
    {
      priority: 4,
      text: 'Check in with emergency contacts and family',
      include: magnitude >= 4.0,
    },
    // ── P5 — follow-up inspection ─────────────────────────────────────
    {
      priority: 5,
      text: 'Schedule a professional structural inspection',
      include: magnitude >= 5.0,
    },
  ];

  const recommendedActions = candidates
    .filter((c) => c.include)
    .sort((a, b) => a.priority - b.priority)
    .map((c) => c.text);

  if (recommendedActions.length === 0) {
    recommendedActions.push('Monitor USGS for aftershock updates');
  }

  return {
    situationId: `seismic-m${magnitude.toFixed(1)}-${Math.round(distanceKm)}km`,
    tier,
    headline: buildHeadline(magnitude, distanceKm, tier, tsunami),
    recommendedActions,
    confirmingSources: [...CONFIRMING_SOURCES],
    invalidatingSources: [...INVALIDATING_SOURCES],
    recommendedPanels: [...RECOMMENDED_PANELS],
    reason: buildReason(magnitude, depth, distanceKm, opts, shallow, tier),
  };
}

function tierFor(magnitude: number, tsunami: boolean, distanceKm: number): ActionTier {
  if (tsunami || magnitude >= 6.5) return 'shelter';
  // A large quake far away is felt but not a shelter-now event for the user.
  if (distanceKm > 300 && magnitude < 6.5) {
    if (magnitude >= 5.5) return 'prepare';
    return 'monitor';
  }
  if (magnitude >= 5.5) return 'act_now';
  if (magnitude >= 4.5) return 'prepare';
  return 'monitor';
}

function buildHeadline(
  magnitude: number,
  distanceKm: number,
  tier: ActionTier,
  tsunami: boolean,
): string {
  const where = `${Math.round(distanceKm)} km away`;
  const head = `M${magnitude.toFixed(1)} earthquake ${where}`;
  if (tsunami) return `${head} — tsunami warning, move to high ground`;
  if (tier === 'shelter') return `${head} — shelter now`;
  if (tier === 'act_now') return `${head} — act now`;
  if (tier === 'prepare') return `${head} — prepare`;
  return `${head} — monitor`;
}

function buildReason(
  magnitude: number,
  depth: number,
  distanceKm: number,
  opts: EarthquakeActionContext,
  shallow: boolean,
  tier: ActionTier,
): string {
  const parts = [
    `${capitalize(tier.replace(/_/g, ' '))} tier`,
    `M${magnitude.toFixed(1)}`,
    `${Math.round(depth)} km deep${shallow ? ' (shallow — stronger shaking)' : ''}`,
    `${Math.round(distanceKm)} km from you`,
  ];
  if (opts.tsunamiWarning) parts.push('tsunami warning active');
  if (opts.populationDensity) parts.push(`${opts.populationDensity}-density area`);
  return parts.join(', ');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
