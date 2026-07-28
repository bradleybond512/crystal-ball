/**
 * Smoke callout bridge — makes the app CALL OUT smoke unprompted (PR 3).
 *
 * Subscribes to the smoke engine and, whenever conditions cross the callout
 * floor (AQI ≥ 101 at the primary place, or active smoke alerts):
 *  1. publishes a `smoke-<placeId>` IncomingEvent into insights-state, which
 *     the Home Shell critical band (floor 70) and Command Center both read —
 *     no bespoke UI needed; and
 *  2. fires ONE native notification per worsening (edge-triggered on the
 *     category ladder, never per refresh), gated by the user's 'wildfire'
 *     notification settings (threshold + quiet hours; critical bypasses
 *     quiet hours per settings-service semantics).
 *
 * When conditions drop below the floor, the smoke event is withdrawn and the
 * edge memory resets so the next episode notifies again.
 */
import { getRecentEvents, setRecentEvents } from '@/services/insights/insights-state';
import { shouldNotify } from '@/services/notifications/notification-settings-service';
import type { IncomingEvent } from '@/services/personal/personal-impact';
import type { SmokeSnapshot, AqiCategory } from './smoke-types';
import { buildSmokeHeadline } from './smoke-headline';
import { subscribeSmoke, getSmokeSnapshots } from './smoke-state';

/** Edge-memory localStorage key. Exported so the AirNow Action-Day producer can
 *  read the last DELIVERED smoke rank and avoid firing a duplicate "air is bad"
 *  native notification for the same episode (unified air-quality dedupe). */
export const SMOKE_NOTIFIED_EDGE_KEY = 'cb-smoke-notified-category';
const EDGE_KEY = SMOKE_NOTIFIED_EDGE_KEY;

/** Category rank for edge-triggering — notify only when this worsens.
 *  Rank ≥ 3 means the smoke callout has surfaced Unhealthy-or-worse. */
export const SMOKE_UNHEALTHY_RANK = 3;
const CATEGORY_RANK: Record<AqiCategory, number> = {
  good: 0, moderate: 1, unknown: 1, usg: 2, unhealthy: 3, very_unhealthy: 4, hazardous: 5,
};

function readEdge(): number {
  try { return Number.parseInt(localStorage.getItem(EDGE_KEY) ?? '0', 10) || 0; } catch { return 0; }
}
function writeEdge(rank: number): void {
  try { localStorage.setItem(EDGE_KEY, String(rank)); } catch { /* quota */ }
}

/** Count of active wildfire_smoke alerts — supplied by the Air & Smoke panel's
 *  loader (it already classifies them); kept here so the bridge has no fetch. */
let activeSmokeAlertCount = 0;
export function setActiveSmokeAlertCount(n: number): void {
  activeSmokeAlertCount = n;
  publishSmokeCallout(getSmokeSnapshots());
}

function notifySeverity(severity: number): 'high' | 'critical' {
  return severity >= 85 ? 'critical' : 'high';
}

/** Exported for tests: merge/withdraw the smoke event in a recent-events list. */
export function mergeSmokeEvent(
  events: readonly IncomingEvent[],
  snap: SmokeSnapshot | undefined,
  smokeAlerts: number,
  now: number,
): { events: IncomingEvent[]; headlineSeverity: number | null; category: AqiCategory | null } {
  const withoutSmoke = events.filter((e) => !e.eventId.startsWith('smoke-'));
  if (!snap) return { events: withoutSmoke, headlineSeverity: null, category: null };
  const headline = buildSmokeHeadline(snap, smokeAlerts);
  if (!headline) return { events: withoutSmoke, headlineSeverity: null, category: null };
  const event: IncomingEvent = {
    eventId: headline.eventId,
    description: headline.description,
    domain: 'weather',
    severity: headline.severity,
    at: now,
    location: { latitude: snap.lat, longitude: snap.lon, radiusKm: 50 },
  };
  return { events: [...withoutSmoke, event], headlineSeverity: headline.severity, category: headline.category };
}

/** Pure edge policy, exported for tests: with a live headline of this
 *  category rank, the stored edge may only FALL to the observed rank —
 *  it never rises without a delivered notification. */
export function settleEdge(observedRank: number, storedEdge: number): number {
  return Math.min(observedRank, storedEdge);
}

function fireNotification(body: string, sev: 'high' | 'critical'): void {
  new Notification('Air quality — wildfire smoke', {
    body,
    tag: 'cb-smoke-callout',
    requireInteraction: sev === 'critical',
  });
}

let permissionRequested = false;

function publishSmokeCallout(snapshots: readonly SmokeSnapshot[]): void {
  const snap = snapshots[0];
  const merged = mergeSmokeEvent(getRecentEvents(), snap, activeSmokeAlertCount, Date.now());
  setRecentEvents(merged.events);

  // Edge memory tracks the DELIVERED rank (not merely observed) so a
  // worsening blocked by quiet hours / thresholds retries on the next
  // refresh once the gate opens, instead of being silently consumed.
  if (merged.headlineSeverity === null || merged.category === null) {
    writeEdge(0); // episode over — the next one notifies again
    return;
  }
  const rank = CATEGORY_RANK[merged.category];
  const edge = readEdge();
  if (rank <= edge) {
    // Improvement while an advisory-grade headline is still live (active
    // NWS alert, or the incoming-smoke forecast advisory): the delivered
    // episode is over even though the headline isn't null, so ratchet the
    // edge DOWN to the observed rank. Without this the predictive advisory
    // would hold the old edge open and swallow the next episode's native
    // notification (independent-review finding #2).
    const settled = settleEdge(rank, edge);
    if (settled !== edge) writeEdge(settled);
    return;
  }
  const sev = notifySeverity(merged.headlineSeverity);
  if (!shouldNotify('wildfire', sev)) return; // retry after quiet hours / settings change
  const body =
    merged.events.find((e) => e.eventId.startsWith('smoke-'))?.description ??
    'Smoke conditions have worsened near your saved place.';
  try {
    if (typeof Notification === 'undefined') { writeEdge(rank); return; } // never deliverable here
    if (Notification.permission === 'granted') {
      fireNotification(body, sev);
      writeEdge(rank);
      return;
    }
    if (Notification.permission === 'denied') { writeEdge(rank); return; } // user opted out
    // permission === 'default': ask once per session; deliver on grant.
    if (permissionRequested) return; // await the earlier prompt's outcome via a later refresh
    permissionRequested = true;
    Notification.requestPermission()
      .then((perm) => {
        if (perm === 'granted') fireNotification(body, sev);
        // Granted → delivered; denied/dismissed → don't re-prompt this episode.
        writeEdge(rank);
      })
      .catch(() => writeEdge(rank));
  } catch {
    writeEdge(rank); // notification API broken in this environment — don't loop
  }
}

let started = false;

/** Boot wiring — subscribe once; the smoke engine's refresh cadence drives us. */
export function startSmokeCalloutBridge(): void {
  if (started) return;
  started = true;
  subscribeSmoke((snapshots) => publishSmokeCallout(snapshots));
}
