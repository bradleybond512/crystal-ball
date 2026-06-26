/**
 * Weather urgency notification ladder — per
 * docs/WEATHER_WARNING_REMEDIATION_PLAN.md PR 2 (lines 336-345).
 *
 * Maps a `PolygonMatchResult` (from PR 1's nws-polygon-match) into a
 * concrete delivery decision: how loud, how persistent, whether to
 * bypass quiet hours, and a watch window of confirming/invalidating
 * signals to look for.
 *
 * The plan's notification ladder (section 7, lines 183-202):
 *   - macOS banner + sound
 *   - In-app persistent critical strip
 *   - Menu bar status
 *   - Repeat ONLY on meaningful changes
 *   - Snooze 15 min
 *   - "I'm safe" / acknowledge action
 *   - Escalate if user does not acknowledge tornado / flash flood warnings
 *
 * Pure deterministic. No dispatcher / router wiring in this PR — that's
 * PR 3's job and lives in `notification-router.ts`. This module's
 * output is the contract those services consume.
 */

import type {
  PolygonMatchResult,
  ThreatLevel,
  WeatherHazardKind,
  WeatherSeverity,
} from './weather-threat-types';

// ── Public types ─────────────────────────────────────────────────────────

/** Weather-specific delivery rungs. Mirrors (but doesn't import) the
 *  insights matrix's DeliveryPriority so weather can land before the
 *  insights module merges; a small follow-up PR can re-route to a
 *  shared enum without breaking call sites. */
export type WeatherDeliveryPriority =
  | 'background'             // ignore in UI; available if asked
  | 'digest'                 // include in next digest
  | 'watch_window'           // soft alert; no banner
  | 'banner'                 // macOS banner + sound (Notification Center)
  | 'persistent_critical'    // banner + in-app persistent + menu bar
  | 'persistent_critical_with_imessage'; // adds optional iMessage contact

/** Delivery priorities in ascending urgency. */
const DELIVERY_PRIORITY_ORDER: readonly WeatherDeliveryPriority[] = [
  'background', 'digest', 'watch_window', 'banner', 'persistent_critical', 'persistent_critical_with_imessage',
];

/** Numeric urgency rank for a delivery priority (higher = more urgent). Callers
 *  that pick the "highest-priority" decision MUST rank through this rather than
 *  comparing the priority strings directly — lexicographic order does not match
 *  urgency (e.g. 'banner' < 'digest' as strings, but 'banner' is more urgent). */
export function deliveryPriorityRank(priority: WeatherDeliveryPriority): number {
  return Math.max(0, DELIVERY_PRIORITY_ORDER.indexOf(priority));
}

/** What signals would confirm or weaken the threat in the next ~30 min.
 *  Plan section 5 (Weather Watch Windows). */
export interface WeatherWatchWindow {
  /** Window length in minutes the caller should re-evaluate within. */
  durationMinutes: number;
  confirming: string[];
  invalidating: string[];
}

export interface WeatherUrgencyDecision {
  alertId: string;
  placeId: string;
  hazardKind: WeatherHazardKind;
  threatLevel: ThreatLevel;
  /** The notification rung. */
  priority: WeatherDeliveryPriority;
  /** Persist the in-app strip until acknowledged or expiration. */
  persistentInApp: boolean;
  /** Allow override of macOS quiet hours (Do Not Disturb). The plan
   *  section 7 calls for "explicit bypass setting" for critical
   *  weather; we surface it here, the dispatcher decides whether to
   *  honor it based on user preference. */
  bypassQuietHours: boolean;
  /** Minimum interval (ms) before another notification for this same
   *  alert is allowed. Plan invariant: "Repeat only if severity
   *  increases, polygon expands, a saved place enters polygon, or
   *  expiration/arrival time changes meaningfully." */
  minRepeatIntervalMs: number;
  /** True if the dispatcher should escalate to a stronger channel
   *  (iMessage, focus mode) if the user hasn't acknowledged within
   *  `acknowledgmentDeadlineMs` of the first delivery. */
  requiresAcknowledgment: boolean;
  /** Deadline for acknowledgment escalation, in ms. Undefined when
   *  requiresAcknowledgment is false. */
  acknowledgmentDeadlineMs?: number;
  /** Plan invariant: "Every weather notification should say why the
   *  user got it." */
  reason: string;
  /** Watch-window signals (section 5). Empty when threat level ≤ watch. */
  watchWindow?: WeatherWatchWindow;
}

// ── Repeat-suppression input ──────────────────────────────────────────────

/** When the dispatcher already delivered something for this alert,
 *  pass the previous decision in so we can detect "meaningful change"
 *  and either suppress or re-fire. */
export interface PreviousDelivery {
  /** Threat level the user was last notified about. */
  previousThreatLevel: ThreatLevel;
  /** ms timestamp of the last notification. */
  lastDeliveredAt: number;
  /** True if the previous match was inside the polygon. */
  previouslyInside: boolean;
  /** Distance to polygon at last delivery (km). Undefined when the
   *  previous match was inside-polygon or zone-only. */
  previousDistanceKm?: number;
}

// ── Top-level mapper ─────────────────────────────────────────────────────

export interface UrgencyOptions {
  /** Defaults to Date.now(). Inject for tests. */
  now?: number;
  /** Hazards that always bypass quiet hours when threat is warning+.
   *  Defaults to tornado / flash_flood / severe_thunderstorm /
   *  storm_surge / tropical. */
  quietHoursBypassHazards?: readonly WeatherHazardKind[];
}

const DEFAULT_BYPASS_HAZARDS: readonly WeatherHazardKind[] = [
  'tornado',
  'flash_flood',
  'severe_thunderstorm',
  'storm_surge',
  'tropical',
];

export function urgencyFor(
  match: PolygonMatchResult,
  previous?: PreviousDelivery,
  options: UrgencyOptions = {},
): WeatherUrgencyDecision {
  const bypassHazards = options.quietHoursBypassHazards ?? DEFAULT_BYPASS_HAZARDS;
  const priority = mapPriority(match);
  const persistentInApp = priority === 'persistent_critical' ||
    priority === 'persistent_critical_with_imessage';
  const isWarningOrEmergency = match.threatLevel === 'warning' || match.threatLevel === 'emergency';
  const bypassQuietHours = isWarningOrEmergency && bypassHazards.includes(match.hazardKind);
  const requiresAcknowledgment = match.threatLevel === 'emergency' &&
    (match.hazardKind === 'tornado' || match.hazardKind === 'flash_flood');

  const minRepeatIntervalMs = repeatIntervalFor(match.threatLevel, previous, match);
  const reason = buildReason(match, previous);
  const watchWindow = (match.threatLevel === 'none' || match.isCancellation)
    ? undefined
    : watchWindowFor(match.hazardKind);

  return {
    alertId: match.alertId,
    placeId: match.placeId,
    hazardKind: match.hazardKind,
    threatLevel: match.threatLevel,
    priority,
    persistentInApp,
    bypassQuietHours,
    minRepeatIntervalMs,
    requiresAcknowledgment,
    acknowledgmentDeadlineMs: requiresAcknowledgment ? 5 * 60 * 1000 : undefined,
    reason,
    watchWindow,
  };
}

// ── Threat → priority mapping ────────────────────────────────────────────
//
// Plan section 4 (lines 121-126):
//   - Outlook upgrades → digest/watch-level
//   - Watches near saved places → elevated alerts
//   - Warnings inside polygons → critical/emergency

function mapPriority(match: PolygonMatchResult): WeatherDeliveryPriority {
  if (match.isCancellation || match.threatLevel === 'none') return 'background';

  if (match.threatLevel === 'emergency') {
    // Tornado / flash flood emergencies escalate to iMessage path so
    // the user is reached even if focus mode is on. Other emergencies
    // (extreme severity, e.g. blizzard) get persistent critical but
    // not iMessage by default.
    if (match.hazardKind === 'tornado' || match.hazardKind === 'flash_flood') {
      return 'persistent_critical_with_imessage';
    }
    return 'persistent_critical';
  }
  if (match.threatLevel === 'warning') {
    return match.matchKind === 'inside_polygon' || match.matchKind === 'inside_zone'
      ? 'persistent_critical'
      : 'banner';
  }
  if (match.threatLevel === 'watch') return 'watch_window';
  if (match.threatLevel === 'advisory') return 'digest';
  return 'background';
}

// ── Repeat suppression ──────────────────────────────────────────────────

function repeatIntervalFor(
  level: ThreatLevel,
  previous: PreviousDelivery | undefined,
  current: PolygonMatchResult,
): number {
  // Default per-tier repeat intervals (ms). Critical re-fires faster
  // because the situation is more dynamic.
  const baseInterval = (() => {
    if (level === 'emergency') return 10 * 60 * 1000; // 10 min
    if (level === 'warning') return 30 * 60 * 1000;   // 30 min
    if (level === 'watch') return 60 * 60 * 1000;     // 1 hour
    return 6 * 60 * 60 * 1000;                        // 6 hours for advisory/none
  })();

  if (!previous) return baseInterval;

  // Plan invariant: re-fire only on meaningful change. We treat any
  // of the following as meaningful and zero-out the cooldown:
  //   - threat level escalated
  //   - place crossed from outside → inside polygon
  //   - distance shrank by ≥ 5 km (polygon expanded toward us)
  if (escalated(previous.previousThreatLevel, level)) return 0;
  if (!previous.previouslyInside && current.isInside) return 0;
  if (
    previous.previousDistanceKm !== undefined &&
    current.distanceKm !== undefined &&
    previous.previousDistanceKm - current.distanceKm >= 5
  ) return 0;

  return baseInterval;
}

const TIER_ORDER: ThreatLevel[] = ['none', 'advisory', 'watch', 'warning', 'emergency'];
function escalated(prev: ThreatLevel, curr: ThreatLevel): boolean {
  return TIER_ORDER.indexOf(curr) > TIER_ORDER.indexOf(prev);
}

// ── Reason / explanation ────────────────────────────────────────────────

function buildReason(match: PolygonMatchResult, previous: PreviousDelivery | undefined): string {
  const inside = match.matchKind === 'inside_polygon' || match.matchKind === 'inside_zone';
  const tier = match.threatLevel.toUpperCase();
  if (match.isCancellation) {
    return `Alert canceled: ${match.event}`;
  }
  if (previous && escalated(previous.previousThreatLevel, match.threatLevel)) {
    return `${tier}: ${match.event} (escalated from ${previous.previousThreatLevel.toUpperCase()})`;
  }
  if (previous && !previous.previouslyInside && inside) {
    return `${tier}: saved place is now inside the ${match.event} polygon`;
  }
  if (inside) {
    return `${tier}: inside ${match.event} polygon (${describeSeverity(match.severity)})`;
  }
  if (match.matchKind === 'near_polygon' && match.distanceKm !== undefined) {
    return `${tier}: ${match.distanceKm.toFixed(1)} km from ${match.event} polygon`;
  }
  return `${tier}: ${match.event} (${match.matchKind})`;
}

function describeSeverity(s: WeatherSeverity): string {
  if (s === 'extreme') return 'extreme severity';
  if (s === 'severe') return 'severe';
  if (s === 'moderate') return 'moderate';
  if (s === 'minor') return 'minor';
  return 'severity unknown';
}

// ── Watch windows ──────────────────────────────────────────────────────

function watchWindowFor(hazard: WeatherHazardKind): WeatherWatchWindow {
  switch (hazard) {
    case 'tornado': {
      return {
        durationMinutes: 30,
        confirming: [
          'rotation signature on radar',
          'tornado debris signature',
          'spotter confirmation',
          'damage reports',
        ],
        invalidating: [
          'storm dissipating',
          'rotation diminishing',
          'warning canceled',
        ],
      };
    }
    case 'severe_thunderstorm': {
      return {
        durationMinutes: 30,
        confirming: [
          'NWS warning expansion',
          'higher lightning density',
          'stronger radar core',
          'power outage reports nearby',
          'wind damage reports',
        ],
        invalidating: [
          'storm core moves away',
          'cell weakens on radar',
          'warning expires without renewal',
        ],
      };
    }
    case 'flash_flood': {
      return {
        durationMinutes: 60,
        confirming: [
          'creek/stream gauge rising',
          'low-water crossings closed',
          'rainfall rate >2"/hr',
          'water rescue reports',
        ],
        invalidating: [
          'rainfall ending',
          'gauges peaking and falling',
          'NWS cancels warning',
        ],
      };
    }
    case 'flood': {
      return {
        durationMinutes: 120,
        confirming: ['river gauges rising', 'evacuation orders'],
        invalidating: ['gauges peaking', 'rainfall stops upstream'],
      };
    }
    case 'high_wind': {
      return {
        durationMinutes: 60,
        confirming: [
          'gust observations >55 mph',
          'tree/power line down reports',
          'utility outage feeds',
        ],
        invalidating: ['front passes', 'pressure gradient relaxes'],
      };
    }
    case 'tropical':
    case 'storm_surge': {
      return {
        durationMinutes: 180,
        confirming: [
          'storm track shifts toward area',
          'sustained winds increasing',
          'tide gauge surge',
          'evacuation orders',
        ],
        invalidating: ['storm track shifts away', 'storm weakens'],
      };
    }
    case 'blizzard':
    case 'winter_storm':
    case 'ice_storm': {
      return {
        durationMinutes: 180,
        confirming: [
          'snowfall rate increases',
          'visibility falls',
          'road closures',
          'utility outages',
        ],
        invalidating: ['precipitation ends early', 'temperatures rise above freezing'],
      };
    }
    case 'fire_weather': {
      return {
        durationMinutes: 240,
        confirming: ['humidity falls', 'wind gusts increase', 'new ignition reports'],
        invalidating: ['humidity rises', 'wind subsides'],
      };
    }
    default: {
      return {
        durationMinutes: 60,
        confirming: ['NWS update', 'corroborating reports'],
        invalidating: ['warning expires', 'NWS cancels'],
      };
    }
  }
}
