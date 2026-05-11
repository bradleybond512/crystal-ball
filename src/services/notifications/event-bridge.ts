/**
 * Live-data → NotifiableEvent bridge.
 *
 * Pure conversion layer between the four real data sources we already
 * fetch and the dispatcher in `push-notifier.ts`:
 *
 *   - NWS hazard alerts          (`weather/nws-hazards.ts`)
 *   - NHC tropical storms        (same module: `parseNhcStorms`)
 *   - NIFC active perimeters     (`wildfires/fire-intel-service.ts`)
 *   - NOAA SWPC space weather    (`spaceweather/swpc-monitor.ts`)
 *
 * The bridge returns `NotifiableEvent[]` only — running the dispatcher
 * (`firePushForEvent`, `fireImessageForPayload`, `fireVoiceForEvent`)
 * is the caller's responsibility. Keeping the conversion separate
 * means tests can pin the source-shape mapping without spinning up
 * notification side effects, and the host can decide whether to
 * dedupe / batch / suppress before dispatch.
 *
 * No DOM, no fetch, no globals at import time.
 */

import type {
  CapEvent,
  GeomagneticEvent,
  HurricaneEvent,
  NotifiableEvent,
  SeismicEvent,
  SolarFlareEvent,
  WildfireEvent,
} from './push-notifier';
import {
  WILDFIRE_MAX_CONTAINMENT_PCT,
  WILDFIRE_MIN_ACRES,
} from './push-notifier';
import type {
  NhcStorm,
  NwsHazardAlert,
  TropicalCategory,
} from '../weather/nws-hazards';
import type { ActiveFirePerimeter } from '../wildfires/fire-intel-service';
import type { SpaceWxStatus } from '../spaceweather/swpc-monitor';

// ── NWS hazard alerts ──────────────────────────────────────────────────

/**
 * Convert NWS active alerts → CapEvents. Only Severe + Extreme alerts
 * with Immediate urgency survive — the dispatcher applies the same
 * filter, but pre-filtering here keeps the result list small.
 */
export function bridgeNwsAlertsToEvents(
  alerts: readonly NwsHazardAlert[],
): CapEvent[] {
  const out: CapEvent[] = [];
  for (const alert of alerts) {
    if (alert.severity !== 'Extreme' && alert.severity !== 'Severe') continue;
    if (alert.urgency !== 'Immediate') continue;
    out.push({
      kind: 'cap',
      severity: alert.severity,
      urgency: alert.urgency,
      event: alert.event,
      headline: alert.headline,
      areaDesc: alert.areaDesc,
      alertId: alert.id,
    });
  }
  return out;
}

// ── NHC tropical storms ────────────────────────────────────────────────

const TROPICAL_TO_CATEGORY: Record<TropicalCategory, number> = {
  TD: 0,
  TS: 0,
  HU1: 1,
  HU2: 2,
  HU3: 3,
  HU4: 4,
  HU5: 5,
  PT: 0,
  unknown: 0,
};

/** NHC storms → HurricaneEvents. Filters to Cat 3+ per spec. */
export function bridgeNhcStormsToEvents(
  storms: readonly NhcStorm[],
): HurricaneEvent[] {
  const out: HurricaneEvent[] = [];
  for (const storm of storms) {
    const category = TROPICAL_TO_CATEGORY[storm.category];
    if (category < 3) continue;
    out.push({
      kind: 'hurricane',
      nhcStorm: {
        name: storm.name,
        category,
      },
    });
  }
  return out;
}

// ── NIFC active perimeters ─────────────────────────────────────────────

/**
 * Active fire perimeters → WildfireEvents. The push-notifier requires
 * acres > 10 000 AND containment < 10 %; we apply the same filter here
 * so the bridge result is already action-ready.
 */
export function bridgeNifcPerimetersToEvents(
  perimeters: readonly ActiveFirePerimeter[],
): WildfireEvent[] {
  const out: WildfireEvent[] = [];
  for (const p of perimeters) {
    if (typeof p.acres !== 'number' || p.acres < WILDFIRE_MIN_ACRES) continue;
    if (typeof p.containmentPct !== 'number' || p.containmentPct >= WILDFIRE_MAX_CONTAINMENT_PCT) continue;
    out.push({
      kind: 'wildfire',
      nifc: {
        name: p.name,
        state: p.state ?? 'XX',
        containment: p.containmentPct,
        acres: p.acres,
      },
    });
  }
  return out;
}

// ── SWPC space weather ─────────────────────────────────────────────────

/**
 * Space weather status → up-to-two notifiable events: a geomagnetic
 * event when Kp≥7, and a solar-flare event when an X-class flare
 * peaked in the SWPC window. Both can fire from a single status push;
 * caller dispatches each independently.
 */
export function bridgeSpaceWxToEvents(
  status: SpaceWxStatus,
): (GeomagneticEvent | SolarFlareEvent)[] {
  const out: (GeomagneticEvent | SolarFlareEvent)[] = [];

  // Geomagnetic — fire on the latest observed Kp; the dispatcher's
  // ladder (G3/G4/G5) picks the threat level.
  const geomag = status.geomag;
  if (geomag && typeof geomag.kp === 'number' && geomag.kp >= 7) {
    out.push({
      kind: 'geomagnetic',
      kpIndex: geomag.kp,
      observedAt: geomag.observedAt,
    });
  }

  // X-class flare — only fire when peak is X (M-class is too noisy
  // and gets attention via Kp anyway when it triggers a storm).
  const xray = status.xray;
  if (xray?.peakClass === 'X') {
    out.push({
      kind: 'solar_flare',
      peakClass: 'X',
      peakLabel: xray.peakLabel,
      peakAt: xray.peakAt,
    });
  }

  return out;
}

// ── USGS earthquake passthrough (lightweight wrapper for symmetry) ─────

/** Magnitude/place pair from any USGS-shaped row. Used by the seismic
 *  bridge so callers can pass earthquake feeds alongside the others. */
export interface SeismicSourceRow {
  magnitude: number;
  place?: string;
  eventId?: string;
  lat?: number;
  lon?: number;
}

/**
 * USGS rows → SeismicEvents. The dispatcher's tier ladder filters
 * <M5 events; we forward everything ≥M4.5 to keep tier-2 candidates
 * around for downstream debug surfaces.
 */
export function bridgeSeismicRowsToEvents(
  rows: readonly SeismicSourceRow[],
): SeismicEvent[] {
  const out: SeismicEvent[] = [];
  for (const row of rows) {
    if (typeof row.magnitude !== 'number' || !Number.isFinite(row.magnitude)) continue;
    if (row.magnitude < 4.5) continue;
    out.push({
      kind: 'seismic',
      magnitude: row.magnitude,
      place: row.place ?? '',
      eventId: row.eventId,
      lat: row.lat,
      lon: row.lon,
    });
  }
  return out;
}

// ── Aggregator ─────────────────────────────────────────────────────────

export interface BridgeInput {
  nwsAlerts?: readonly NwsHazardAlert[];
  nhcStorms?: readonly NhcStorm[];
  nifcPerimeters?: readonly ActiveFirePerimeter[];
  spaceWeather?: SpaceWxStatus | null;
  seismicRows?: readonly SeismicSourceRow[];
}

/**
 * Run all bridges in one shot. Returns a flat NotifiableEvent[] in a
 * stable order: seismic, geomagnetic + flare, CAP, hurricane, wildfire.
 * The host calls firePushForEvent on each and decides per-channel
 * escalation (iMessage / voice).
 */
export function bridgeAllToEvents(input: BridgeInput): NotifiableEvent[] {
  const out: NotifiableEvent[] = [];
  if (input.seismicRows) out.push(...bridgeSeismicRowsToEvents(input.seismicRows));
  if (input.spaceWeather) out.push(...bridgeSpaceWxToEvents(input.spaceWeather));
  if (input.nwsAlerts) out.push(...bridgeNwsAlertsToEvents(input.nwsAlerts));
  if (input.nhcStorms) out.push(...bridgeNhcStormsToEvents(input.nhcStorms));
  if (input.nifcPerimeters) out.push(...bridgeNifcPerimetersToEvents(input.nifcPerimeters));
  return out;
}
