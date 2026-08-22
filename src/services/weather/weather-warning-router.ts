/**
 * Weather warning router — end-to-end integration of the weather
 * services into a single dispatch decision.
 *
 * Per docs/MISSED_FEATURES_FOR_CLAUDE.md item 1 ("Weather Warning
 * End-to-End Integration"): saved-place NWS polygon matching wired
 * into urgency scoring + storm-mode payload + diagnostic trace, all
 * in one call. The existing `notification-router.ts` is shaped for
 * cyber-reactor alerts; this module gives the weather pipeline its
 * own clean integration surface.
 *
 * Pure deterministic. No DOM, no fetch.
 *
 * Single entry point:
 *   routeWeatherAlert(alert, places, options) → WeatherDispatchDecision
 *
 * The result includes the polygon match, the urgency decision, the
 * storm-mode payload (when applicable), the diagnostic trace, and a
 * `dispatchActions` list ready for the notification dispatcher.
 */

import {
  buildWeatherSavedPlaceActionTarget,
  type NwsAlertMinimal,
  type PolygonMatchResult,
  type SavedPlace,
  type WeatherSavedPlaceActionTarget,
} from './weather-threat-types';
import { matchAlertToPlace } from './nws-polygon-match';
import {
  urgencyFor,
  type WeatherDeliveryPriority,
  type WeatherUrgencyDecision,
  type PreviousDelivery,
} from './weather-urgency';
import { buildStormModePayload, type StormModePayload, type StormModeOptions } from './personal-storm-mode';
import {
  diagnoseAlert,
  type DiagnosticTrace,
  type WeatherDiagnostic,
} from './weather-warning-diagnostics';
import { recordAlgorithmEvaluation } from '@/services/algorithms/record-evaluation';

/**
 * Time the urgency call and emit one evaluation record into the
 * algorithm ledger. Records the priority + acknowledgement-required
 * flag + match kind as compact detail; ground-truth outcome (warning
 * landed before impact / dismissed by user / etc.) is appended later
 * by the closed-loop layer once the mission resolves.
 */
function recordWeatherUrgency(
  match: PolygonMatchResult,
  invoke: () => WeatherUrgencyDecision,
  now: number,
): WeatherUrgencyDecision {
  const startedAt = Date.now();
  const decision = invoke();
  const durationMs = Date.now() - startedAt;
  recordAlgorithmEvaluation('weather-urgency', {
    durationMs,
    at: now,
    label: decision.priority,
    detail: {
      matchKind: match.matchKind,
      threatLevel: match.threatLevel,
      hazardKind: match.hazardKind,
      persistentInApp: decision.persistentInApp,
    },
  });
  return decision;
}

// ── Public types ─────────────────────────────────────────────────────────

/** What the dispatcher should actually do. The list is ordered: items
 *  earlier in the array MUST happen before items later in the array. */
export type DispatchAction =
  | 'badge'                  // app icon badge / unread count
  | 'inbox'                  // add to alert inbox
  | 'toast'                  // in-app toast
  | 'banner'                 // macOS Notification Center banner
  | 'sound'                  // audible alert (paired with banner)
  | 'persistent_strip'       // in-app persistent critical strip
  | 'menu_bar_status'        // mac menu bar dot/label
  | 'imessage'               // optional iMessage contact
  | 'wake_app'               // bring the app forward
  | 'request_acknowledgment' // start the ack-or-escalate timer
  | 'digest';                // include in next morning/evening digest

export interface WeatherDispatchDecision {
  /** Stable id (the underlying alert id). */
  alertId: string;
  /** Which saved place produced the strongest match (when any). */
  matchedPlaceId?: string;
  matchedPlaceLabel?: string;
  /** Exact place identity captured with the warning decision. A click must
   * revalidate this before opening location-specific disaster resources. */
  matchedPlaceAction?: WeatherSavedPlaceActionTarget;
  /** The polygon match for the strongest place (or `undefined` when
   *  there were no places to evaluate). */
  match?: PolygonMatchResult;
  /** The urgency decision (only present when match isn't `no_match`). */
  urgency?: WeatherUrgencyDecision;
  /** Storm Mode payload (only when urgency.priority is banner+). */
  payload?: StormModePayload;
  /** "Why didn't I get warned?" diagnostic — always emitted, even on
   *  delivered alerts, so the UI can show "this is why you got it". */
  diagnostic: WeatherDiagnostic;
  /** Concrete actions for the dispatcher, in execution order. */
  dispatchActions: DispatchAction[];
  /** True when the dispatcher should suppress this alert (matches a
   *  no-op verdict from diagnostic + no urgency). */
  shouldSuppress: boolean;
  /** Plain-text reason for the dispatch decision (for the UI's
   *  "why am I being notified?" surface). Plan invariant. */
  reason: string;
}

// ── Top-level entry point ───────────────────────────────────────────────

export interface RouteWeatherOptions {
  /** Defaults to Date.now(). Inject for tests. */
  now?: number;
  /** Persisted previous-delivery state for repeat-suppression. Keyed by
   *  alertId; the dispatcher loads this before each call and writes it
   *  back after delivery. */
  previousDelivery?: PreviousDelivery;
  /** Storm-motion data when available (forward-looking arrival window). */
  stormMode?: StormModeOptions;
  /** When true, the user has the "weather quiet-hours bypass" setting on. */
  quietHoursBypassEnabled?: boolean;
  /** True when the user is currently in macOS quiet hours / DND. */
  quietHoursActive?: boolean;
  /** Pass-through to the urgency mapper. */
  quietHoursBypassHazards?: Parameters<typeof urgencyFor>[2] extends infer T
    ? T extends { quietHoursBypassHazards?: infer U } ? U : never
    : never;
  /** When the relevance engine has scored the alert below threshold,
   *  pass the score so the diagnostic can explain. */
  relevanceScore?: number;
  relevanceBelowThreshold?: boolean;
}

export function routeWeatherAlert(
  alert: NwsAlertMinimal,
  places: readonly SavedPlace[],
  options: RouteWeatherOptions = {},
): WeatherDispatchDecision {
  const now = options.now ?? Date.now();

  // Step 1: find the strongest match across all saved places.
  const strongest = pickStrongestMatch(alert, places, now);

  // Step 2: when we have any match, derive urgency. Recording the
  // urgency decision into the algorithm-evaluation ledger lets the
  // closed-loop diagnostics surface "weather-urgency fired N times,
  // mean priority X, last-seen at T" without coupling the pure
  // urgency engine to the ledger.
  const urgency = strongest && strongest.match.matchKind !== 'no_match'
    ? recordWeatherUrgency(
        strongest.match,
        () => urgencyFor(strongest.match, options.previousDelivery, {
          now,
          quietHoursBypassHazards: options.quietHoursBypassHazards,
        }),
        now,
      )
    : undefined;

  // Step 3: when urgency is at banner+, build the Storm Mode payload.
  let payload: StormModePayload | undefined;
  if (urgency && shouldBuildPayload(urgency.priority)) {
    const _smStart = Date.now();
    payload = buildStormModePayload(strongest!.match, strongest!.place.label, {
      now,
      ...options.stormMode,
    });
    const _smScore = { high: 1, medium: 0.6, low: 0.3 }[payload.confidenceLabel] ?? 0.3;
    try {
      recordAlgorithmEvaluation('personal-storm-mode', {
        durationMs: Date.now() - _smStart,
        score: _smScore,
        label: payload.activation,
        detail: { threatLevel: payload.threatLevel, hazardKind: payload.primaryHazard },
      });
    } catch { /* ledger unavailable */ }
  }

  // Step 4: dispatch actions derived from urgency + quiet-hours state.
  const { dispatchActions, suppressed } = deriveDispatchActions(
    urgency,
    options,
  );

  // Step 5: diagnostic trace covering what would happen end-to-end.
  const diagnostic = diagnoseAlert(buildDiagnosticTrace(alert, places, strongest, urgency, options, suppressed, now));

  const reason = buildReason(strongest, urgency, suppressed, options);

  return {
    alertId: alert.id,
    matchedPlaceId: strongest?.place.id,
    matchedPlaceLabel: strongest?.place.label,
    matchedPlaceAction: strongest
      ? buildWeatherSavedPlaceActionTarget(strongest.place)
      : undefined,
    match: strongest?.match,
    urgency,
    payload,
    diagnostic,
    dispatchActions,
    shouldSuppress: suppressed,
    reason,
  };
}

// ── Match selection ─────────────────────────────────────────────────────

interface PlaceAndMatch {
  place: SavedPlace;
  match: PolygonMatchResult;
}

function pickStrongestMatch(
  alert: NwsAlertMinimal,
  places: readonly SavedPlace[],
  now: number,
): PlaceAndMatch | undefined {
  if (places.length === 0) return undefined;
  let best: PlaceAndMatch | undefined;
  for (const place of places) {
    const _t0 = performance.now();
    const match = matchAlertToPlace(alert, place, { now });
    try {
      recordAlgorithmEvaluation('nws-polygon-match', {
        durationMs: performance.now() - _t0,
        score: MATCH_KIND_RANK[match.matchKind] / 4, // 0..1 (inside_polygon=1)
        label: match.matchKind,
        detail: { threatLevel: match.threatLevel, hazardKind: match.hazardKind },
      });
    } catch { /* ledger unavailable */ }
    if (!best) { best = { place, match }; continue; }
    if (matchStrength(match) > matchStrength(best.match)) best = { place, match };
  }
  return best;
}

const MATCH_KIND_RANK: Record<PolygonMatchResult['matchKind'], number> = {
  inside_polygon: 4,
  inside_zone: 3,
  near_polygon: 2,
  no_match: 0,
};

const THREAT_LEVEL_RANK: Record<PolygonMatchResult['threatLevel'], number> = {
  emergency: 4,
  warning: 3,
  watch: 2,
  advisory: 1,
  none: 0,
};

function matchStrength(m: PolygonMatchResult): number {
  // inside_polygon > inside_zone > near_polygon > no_match.
  // Within each tier, an emergency outranks a warning, etc.
  return MATCH_KIND_RANK[m.matchKind] * 10 + THREAT_LEVEL_RANK[m.threatLevel];
}

// ── Dispatch action derivation ──────────────────────────────────────────

function shouldBuildPayload(priority: WeatherDeliveryPriority): boolean {
  return priority === 'banner' ||
    priority === 'persistent_critical' ||
    priority === 'persistent_critical_with_imessage';
}

function deriveDispatchActions(
  urgency: WeatherUrgencyDecision | undefined,
  options: RouteWeatherOptions,
): { dispatchActions: DispatchAction[]; suppressed: boolean } {
  if (!urgency) {
    return { dispatchActions: [], suppressed: true };
  }

  // Quiet-hours suppression — except for hazards that bypass.
  const quietBlocks = options.quietHoursActive === true &&
    !options.quietHoursBypassEnabled &&
    !urgency.bypassQuietHours;

  if (urgency.priority === 'background' || quietBlocks) {
    return { dispatchActions: ['badge', 'inbox'], suppressed: true };
  }

  switch (urgency.priority) {
    case 'digest': {
      return { dispatchActions: ['badge', 'inbox', 'digest'], suppressed: false };
    }
    case 'watch_window': {
      return { dispatchActions: ['badge', 'inbox', 'toast'], suppressed: false };
    }
    case 'banner': {
      return { dispatchActions: ['badge', 'inbox', 'toast', 'banner', 'sound'], suppressed: false };
    }
    case 'persistent_critical': {
      const actions: DispatchAction[] = ['badge', 'inbox', 'toast', 'banner', 'sound', 'persistent_strip', 'menu_bar_status'];
      if (urgency.requiresAcknowledgment) actions.push('request_acknowledgment');
      return { dispatchActions: actions, suppressed: false };
    }
    case 'persistent_critical_with_imessage': {
      return {
        dispatchActions: ['badge', 'inbox', 'toast', 'banner', 'sound', 'persistent_strip', 'menu_bar_status', 'wake_app', 'imessage', 'request_acknowledgment'],
        suppressed: false,
      };
    }
  }
}

// ── Diagnostic trace assembly ──────────────────────────────────────────

function buildDiagnosticTrace(
  alert: NwsAlertMinimal,
  places: readonly SavedPlace[],
  strongest: PlaceAndMatch | undefined,
  urgency: WeatherUrgencyDecision | undefined,
  options: RouteWeatherOptions,
  suppressed: boolean,
  now: number,
): DiagnosticTrace {
  return {
    alertId: alert.id,
    alertReceived: true,
    alertReceivedAt: now,
    sidecarStored: true,
    normalized: true,
    polygonMatch: strongest?.match,
    placesEvaluated: places,
    routerDispatched: !suppressed,
    routerReason: routerReasonFor(urgency, options, suppressed),
    quietHoursActive: options.quietHoursActive,
    quietHoursBypassEnabled: options.quietHoursBypassEnabled,
    locationMissing: places.length === 0,
    relevanceBelowThreshold: options.relevanceBelowThreshold,
    relevanceScore: options.relevanceScore,
  };
}

function routerReasonFor(
  urgency: WeatherUrgencyDecision | undefined,
  options: RouteWeatherOptions,
  suppressed: boolean,
): string {
  if (!urgency) return 'No matching saved place';
  if (suppressed && options.quietHoursActive && !options.quietHoursBypassEnabled && !urgency.bypassQuietHours) {
    return 'Quiet hours active and weather bypass disabled';
  }
  if (suppressed) return urgency.reason;
  return urgency.reason;
}

// ── Reason string ──────────────────────────────────────────────────────

function buildReason(
  strongest: PlaceAndMatch | undefined,
  urgency: WeatherUrgencyDecision | undefined,
  suppressed: boolean,
  options: RouteWeatherOptions,
): string {
  if (!strongest) return 'No saved-place match — alert not personalized';
  if (!urgency) return strongest.match.reason;
  if (suppressed) {
    if (options.quietHoursActive && !options.quietHoursBypassEnabled && !urgency.bypassQuietHours) {
      return `Suppressed: quiet hours active. ${urgency.reason}`;
    }
    return `Suppressed: ${urgency.reason}`;
  }
  // Plan invariant: every weather notification should say why.
  // Pull from urgency.reason which already includes the place + tier.
  // (`diagnostic` is available to callers via decision.diagnostic.)
  return urgency.reason;
}
