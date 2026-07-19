/**
 * AirNow Action-Day callout bridge.
 *
 * The smoke callout bridge already alerts on MEASURED AQI crossing into
 * Unhealthy (Open-Meteo), and push-notifier does the same. The one signal
 * neither has is the agency-declared **Air Quality Action Day** — a forward
 * looking advisory that today/tomorrow will be bad. This bridge owns exactly
 * that: per saved place, when an Action Day is declared, it
 *   1. publishes an `airnow-actionday-<placeId>` IncomingEvent into
 *      insights-state (Command Center / Home Shell read it — no bespoke UI), and
 *   2. fires ONE native notification per declared episode, gated by the user's
 *      'wildfire' notification settings.
 *
 * Dedupe is UNIFIED with the smoke engine: if the smoke callout has already
 * delivered an Unhealthy-or-worse native notification for the current episode,
 * the user already knows the air is bad, so the Action-Day native notification
 * is suppressed (the in-app event is still published). This prevents two
 * "air quality" notifications for one worsening.
 *
 * The bridge takes fed data (no fetch), mirroring smoke-callout-bridge, so the
 * decision core is pure + fixture-testable.
 */
import { getRecentEvents, setRecentEvents } from '@/services/insights/insights-state';
import { shouldNotify } from '@/services/notifications/notification-settings-service';
import type { IncomingEvent } from '@/services/personal/personal-impact';
import { SMOKE_NOTIFIED_EDGE_KEY, SMOKE_UNHEALTHY_RANK } from '@/services/smoke/smoke-callout-bridge';

const EDGE_KEY = 'cb-airnow-actionday-notified';
const EVENT_PREFIX = 'airnow-actionday-';

/** Per-place Action-Day input (from the AirNow forecast service). */
export interface ActionDayInput {
  placeId: string;
  placeName: string;
  lat: number;
  lon: number;
  actionDay: boolean;
  /** Peak forecast AQI (drives severity), or null. */
  peakAqi: number | null;
  /** Agency headline / discussion, if any. */
  headline?: string;
  reportingArea?: string;
  source: 'airnow' | 'enviroflash-cap';
  /** Epoch ms the action day applies to. */
  at: number;
}

/** placeId → the marker for the active Action-Day run already delivered.
 *  Presence (not equality) is what suppresses a repeat: an Action Day is
 *  edge-triggered, so one ping fires per continuous run and the edge is
 *  cleared only when the declaration lifts (see decideActionDayNotifications).
 *  Keying on the run rather than a calendar day avoids re-notifying at UTC
 *  midnight for a still-active multi-day Action Day. */
export type ActionDayEdgeState = Record<string, string>;

/** Observability marker for the current run (the comparison is presence-based;
 *  the value is only for debugging the persisted edge). */
export function episodeMarker(input: Pick<ActionDayInput, 'source' | 'peakAqi'>): string {
  return `${input.source}:${input.peakAqi ?? 'na'}`;
}

function severityFor(peakAqi: number | null): 'high' | 'critical' {
  return peakAqi != null && peakAqi >= 300 ? 'critical' : 'high';
}

function severityScore(peakAqi: number | null): number {
  if (peakAqi == null) return 75;
  if (peakAqi >= 301) return 95;
  if (peakAqi >= 201) return 90;
  if (peakAqi >= 151) return 80;
  return 72;
}

function calloutMessage(input: ActionDayInput): string {
  const where = input.reportingArea?.trim() ? input.reportingArea : input.placeName;
  const aqiPart = input.peakAqi == null ? '' : ` (forecast AQI ${input.peakAqi})`;
  const headline = input.headline?.trim();
  if (headline) return headline;
  return `Air Quality Action Day declared for ${where}${aqiPart}. Limit prolonged outdoor exertion.`;
}

/** Pure: merge the Action-Day events for the CURRENT inputs into an existing
 *  recent-events list — one `airnow-actionday-<placeId>` per active Action Day.
 *  Fail-soft: only events for places present in `inputs` (i.e. successfully
 *  fetched this cycle) are re-derived; a place whose fetch failed keeps its last
 *  known event rather than being silently withdrawn as if it had cleared. */
export function mergeActionDayEvents(
  existing: readonly IncomingEvent[],
  inputs: readonly ActionDayInput[],
  now: number,
): IncomingEvent[] {
  const fetched = new Set(inputs.map((i) => i.placeId));
  const kept = existing.filter(
    (e) => !e.eventId.startsWith(EVENT_PREFIX) || !fetched.has(e.eventId.slice(EVENT_PREFIX.length)),
  );
  const events: IncomingEvent[] = [];
  for (const input of inputs) {
    if (!input.actionDay) continue;
    events.push({
      eventId: `${EVENT_PREFIX}${input.placeId}`,
      description: calloutMessage(input),
      domain: 'weather',
      severity: severityScore(input.peakAqi),
      at: now,
      location: { latitude: input.lat, longitude: input.lon, radiusKm: 50 },
    });
  }
  return [...kept, ...events];
}

export interface ActionDayCandidate {
  placeId: string;
  placeName: string;
  message: string;
  severity: 'high' | 'critical';
  marker: string;
}

export interface ActionDayDecision {
  /** Places warranting a NEW native notification. The runtime writes each one's
   *  edge marker only AFTER the notification is actually delivered (or is
   *  terminally undeliverable) — a quiet-hours block leaves it absent so the
   *  next refresh retries, mirroring the smoke callout bridge. */
  toNotify: ActionDayCandidate[];
  /** Edge changes to persist immediately regardless of delivery: cleared places
   *  (Action Day lifted) and smoke-covered episodes (marked handled, no ping). */
  baseEdge: ActionDayEdgeState;
}

/**
 * Pure: decide which places warrant a NEW native notification.
 * - Edge-triggered: fires once per continuous Action-Day run (presence in the
 *   edge suppresses repeats); the edge is cleared when the run lifts so the
 *   next, separate declaration re-notifies.
 * - Suppresses the native notification (but marks the run handled in baseEdge)
 *   when the smoke callout already delivered Unhealthy+ — unified dedupe.
 */
export function decideActionDayNotifications(
  inputs: readonly ActionDayInput[],
  prevEdge: ActionDayEdgeState,
  smokeRank: number,
): ActionDayDecision {
  const baseEdge: ActionDayEdgeState = { ...prevEdge };
  const toNotify: ActionDayCandidate[] = [];
  const smokeAlreadyCovered = smokeRank >= SMOKE_UNHEALTHY_RANK;

  for (const input of inputs) {
    if (!input.actionDay) {
      delete baseEdge[input.placeId]; // run over — the next declaration re-notifies
      continue;
    }
    if (input.placeId in prevEdge) continue; // already handled this active run
    const marker = episodeMarker(input);
    if (smokeAlreadyCovered) {
      baseEdge[input.placeId] = marker; // smoke already told the user; mark handled, no ping
      continue;
    }
    toNotify.push({
      placeId: input.placeId,
      placeName: input.placeName,
      message: calloutMessage(input),
      severity: severityFor(input.peakAqi),
      marker,
    });
  }
  return { toNotify, baseEdge };
}

// ── Runtime (impure) glue ─────────────────────────────────────────────────

function readEdge(): ActionDayEdgeState {
  try {
    const raw = localStorage.getItem(EDGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ActionDayEdgeState : {};
  } catch { return {}; }
}

function writeEdge(state: ActionDayEdgeState): void {
  try { localStorage.setItem(EDGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
}

function readSmokeRank(): number {
  try { return Number.parseInt(localStorage.getItem(SMOKE_NOTIFIED_EDGE_KEY) ?? '0', 10) || 0; } catch { return 0; }
}

let permissionRequested = false;

function fireNotification(placeName: string, message: string, sev: 'high' | 'critical'): void {
  new Notification(`Air Quality Action Day — ${placeName}`, {
    body: message,
    tag: `cb-airnow-actionday-${placeName}`,
    requireInteraction: sev === 'critical',
  });
}

/** Process a fresh batch of per-place Action-Day inputs: publish events, then
 *  fire de-duplicated, gated notifications. Called by the forecast service. */
export function processActionDayInputs(inputs: readonly ActionDayInput[], now: number = Date.now()): void {
  setRecentEvents(mergeActionDayEvents(getRecentEvents(), inputs, now));

  const { toNotify, baseEdge } = decideActionDayNotifications(inputs, readEdge(), readSmokeRank());
  // Persist the base edge (clears + smoke-covered marks) immediately; the
  // to-notify markers are committed only once delivery actually happens so a
  // quiet-hours/settings block retries next refresh (mirrors the smoke bridge).
  const edge: ActionDayEdgeState = { ...baseEdge };
  writeEdge(edge);
  if (toNotify.length === 0) return;

  const commitAll = (): void => {
    for (const n of toNotify) edge[n.placeId] = n.marker;
    writeEdge(edge);
  };
  // No deliverable channel here (headless / API missing / user opted out):
  // mark the run handled so we don't spin, exactly as the smoke bridge does.
  if (typeof Notification === 'undefined') { commitAll(); return; }
  if (Notification.permission === 'denied') { commitAll(); return; }

  const deliverGranted = (): void => {
    for (const n of toNotify) {
      if (!shouldNotify('wildfire', n.severity)) continue; // blocked → leave edge absent, retry next refresh
      try { fireNotification(n.placeName, n.message, n.severity); } catch { /* notification API unavailable */ }
      edge[n.placeId] = n.marker; // delivered (or attempted) → commit
    }
    writeEdge(edge);
  };

  if (Notification.permission === 'granted') { deliverGranted(); return; }
  // permission === 'default': ask once per session; deliver on grant. If an
  // earlier prompt was dismissed (permission stays 'default'), later runs
  // intentionally do NOT commit the edge — like the smoke bridge, we keep the
  // run pending so a subsequent user grant still delivers. The in-app event is
  // already published, so nothing is lost meanwhile; it self-heals on grant/deny.
  if (permissionRequested) return;
  permissionRequested = true;
  Notification.requestPermission()
    .then((perm) => { if (perm === 'granted') deliverGranted(); else commitAll(); })
    .catch(() => commitAll());
}
