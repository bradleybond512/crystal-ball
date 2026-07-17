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

const EDGE_KEY = 'cb-smoke-notified-category';

/** Category rank for edge-triggering — notify only when this worsens. */
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

function publishSmokeCallout(snapshots: readonly SmokeSnapshot[]): void {
  const snap = snapshots[0];
  const merged = mergeSmokeEvent(getRecentEvents(), snap, activeSmokeAlertCount, Date.now());
  setRecentEvents(merged.events);

  // Edge-triggered native notification: fire only when the category rank
  // worsens past what we last notified for; reset when below the floor.
  if (merged.headlineSeverity === null || merged.category === null) {
    writeEdge(0);
    return;
  }
  const rank = CATEGORY_RANK[merged.category];
  if (rank <= readEdge()) return;
  const sev = notifySeverity(merged.headlineSeverity);
  if (!shouldNotify('wildfire', sev)) { writeEdge(rank); return; }
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const smoke = merged.events.find((e) => e.eventId.startsWith('smoke-'));
      new Notification('Air quality — wildfire smoke', {
        body: smoke?.description ?? 'Smoke conditions have worsened near your saved place.',
        tag: 'cb-smoke-callout',
        requireInteraction: sev === 'critical',
      });
    }
  } catch { /* notifications unavailable in this environment */ }
  writeEdge(rank);
}

let started = false;

/** Boot wiring — subscribe once; the smoke engine's refresh cadence drives us. */
export function startSmokeCalloutBridge(): void {
  if (started) return;
  started = true;
  subscribeSmoke((snapshots) => publishSmokeCallout(snapshots));
}
