// Push-notification dispatch.
//
// `decideNotification` is pure — given an event payload it returns
// {shouldFire, payload, reason}. `firePushForEvent` wraps that with the
// existing `send_notification` Tauri Rust command (no plugin install)
// and appends to the notification ledger.
/* eslint-disable sonarjs/no-nested-template-literals -- short notification body interpolation; refactoring to intermediate vars hurts readability more than it helps */
/* eslint-disable sonarjs/todo-tag -- intentional placeholders; NHC + NIFC feeds land in parallel sessions per spec */

import { tryInvokeTauri } from '@/services/tauri-bridge';
import { isDesktopRuntime } from '@/services/runtime';
import { tierForMagnitude } from './eew-tiers';
import { loadThresholds, type ThresholdConfig } from '@/services/config/alert-thresholds';
import { fireVoiceForEvent, getVoiceSettings } from './voice-alerter';
import {
  record as recordHistory,
  domainForThreatType,
} from './notification-history-service';
import {
  type NotificationChannel,
  type NotificationLedger,
  type NotificationLedgerEntry,
  type NotificationThreatLevel,
  type NotificationThreatType,
} from './notification-ledger';

export interface SeismicEvent {
  kind: 'seismic';
  magnitude: number;
  place: string;
  /** Optional — included in dedupe key + ledger meta when known. */
  eventId?: string;
  lat?: number;
  lon?: number;
  /** ETA seconds until S-waves reach the user, when computed. */
  etaSeconds?: number;
}

export interface WildfireFrpEvent {
  kind: 'wildfire-frp';
  /** Fire Radiative Power in megawatts. */
  frpMw: number;
  lat: number;
  lon: number;
  /** Distance from the user's saved place in km — or null when unknown. */
  distanceKm: number | null;
  detectedAt?: string;
  source?: 'firms-modis' | 'firms-viirs' | 'inciweb' | 'nifc';
  detectionId?: string;
}

export interface AirQualityEvent {
  kind: 'air-quality';
  /** US AQI (0–500). */
  aqi: number;
  pollutant?: 'pm2_5' | 'pm10' | 'ozone' | 'nitrogen_dioxide' | 'unknown';
  observedAt?: string;
  station?: string;
}

export interface MarketEvent {
  kind: 'market';
  /** Current VIX value. */
  vix?: number;
  /** OFR Financial Stress Index z-score. */
  ofrFsiSigmas?: number;
  observedAt?: string;
}

export interface GeomagneticEvent {
  kind: 'geomagnetic';
  /** NOAA SWPC Kp index 0–9. G4 = Kp 8, G5 = Kp 9. */
  kpIndex: number;
  observedAt?: string;
}

export interface SolarFlareEvent {
  kind: 'solar_flare';
  /** Flare class. We only fire on X (peak X-ray flux ≥ 1e-4 W/m²). */
  peakClass: 'X' | 'M' | 'C' | 'B' | 'A';
  /** Numeric label like 'X2.7', 'M5.4' — surfaced in the body. */
  peakLabel: string;
  /** ISO timestamp of the flare peak. */
  peakAt?: string;
}

export interface CapEvent {
  kind: 'cap';
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  urgency: 'Immediate' | 'Expected' | 'Future' | 'Past' | 'Unknown';
  event: string;
  headline: string;
  areaDesc: string;
  alertId?: string;
}

export interface HurricaneEvent {
  kind: 'hurricane';
  nhcStorm?: { name: string; category: number; projectedLandfall?: string };
}

export interface WildfireEvent {
  kind: 'wildfire';
  /** NIFC perimeter snapshot. `acres` was added when the perimeter
   *  feed wired in — older callers without acreage will be gated out
   *  by the size threshold. */
  nifc?: { name: string; state: string; containment: number; acres?: number };
}

/** Wildfire firing rule: acres > 10 000 AND containment < 10 %. The
 *  acres threshold suppresses the long tail of small fires that already
 *  populate the panel. Sourced from the user's Live Notification spec. */
export const WILDFIRE_MIN_ACRES = 10_000;
export const WILDFIRE_MAX_CONTAINMENT_PCT = 10;

export type NotifiableEvent =
  | SeismicEvent
  | GeomagneticEvent
  | SolarFlareEvent
  | CapEvent
  | HurricaneEvent
  | WildfireEvent
  | WildfireFrpEvent
  | AirQualityEvent
  | MarketEvent;

export interface NotificationPayload {
  title: string;
  body: string;
  sound: string;
  threatType: NotificationThreatType;
  threatLevel: NotificationThreatLevel;
  /** Stable id used for ledger dedupe across repeats. */
  dedupeKey: string;
  meta?: Record<string, unknown>;
}

export interface NotificationDecision {
  shouldFire: boolean;
  payload?: NotificationPayload;
  reason?:
    | 'tier-below-threshold'
    | 'magnitude-below-threshold'
    | 'kp-below-threshold'
    | 'cap-not-extreme-immediate'
    | 'hurricane-below-cat3'
    | 'hurricane-below-threshold'
    | 'wildfire-containment-above-threshold'
    | 'wildfire-below-acre-threshold'
    | 'wildfire-frp-below-threshold'
    | 'wildfire-out-of-radius'
    | 'aqi-below-threshold'
    | 'market-below-threshold'
    | 'todo-data-feed-pending'
    | 'unknown-event-kind';
}

const SOUND_BY_LEVEL: Record<NotificationThreatLevel, string> = {
  critical: 'Basso',
  high: 'Sosumi',
  medium: 'Ping',
  low: 'Tink',
};

function decideSeismic(event: SeismicEvent, thresholds: ThresholdConfig): NotificationDecision {
  if (typeof event.magnitude !== 'number'
    || event.magnitude < thresholds.seismic.pushMinMagnitude) {
    return { shouldFire: false, reason: 'magnitude-below-threshold' };
  }
  const tier = tierForMagnitude(event.magnitude);
  if (tier === null) {
    return { shouldFire: false, reason: 'tier-below-threshold' };
  }
  const threatType = (`seismic_${tier.toLowerCase().replace('_', '')}` as NotificationThreatType);
  const threatLevel: NotificationThreatLevel = tier === 'TIER_5' ? 'critical' : 'high';
  const magStr = event.magnitude.toFixed(1);
  return {
    shouldFire: true,
    payload: {
      title: `Crystal Ball — M${magStr} earthquake`,
      body: `M${magStr} near ${event.place || 'unknown'}${event.etaSeconds ? ` — ${event.etaSeconds}s to S-waves` : ''}`,
      sound: SOUND_BY_LEVEL[threatLevel],
      threatType,
      threatLevel,
      dedupeKey: event.eventId ? `seismic:${event.eventId}` : `seismic:${magStr}:${event.place}`,
      meta: { magnitude: event.magnitude, place: event.place, lat: event.lat, lon: event.lon, tier },
    },
  };
}

function gLevelForKp(kp: number): 'G2' | 'G3' | 'G4' | 'G5' {
  if (kp >= 9) return 'G5';
  if (kp >= 8) return 'G4';
  if (kp >= 7) return 'G3';
  return 'G2';
}

function geomagThreatLevel(kp: number): NotificationThreatLevel {
  if (kp >= 9) return 'critical';
  if (kp >= 8) return 'high';
  return 'medium';
}

function decideSolarFlare(event: SolarFlareEvent): NotificationDecision {
  // Only X-class is loud enough to wake the user — M-class auroras are
  // already covered by the geomagnetic ladder once they trigger Kp.
  if (event.peakClass !== 'X') {
    return { shouldFire: false, reason: 'kp-below-threshold' };
  }
  return {
    shouldFire: true,
    payload: {
      title: `Crystal Ball — ${event.peakLabel} Solar Flare`,
      body: `${event.peakLabel} solar flare — possible HF radio blackout + GPS disruption`,
      sound: SOUND_BY_LEVEL.high,
      threatType: 'solar_flare_x',
      threatLevel: 'high',
      dedupeKey: `flare:${event.peakLabel}:${event.peakAt ?? Math.floor(Date.now() / 60_000)}`,
      meta: { peakClass: event.peakClass, peakLabel: event.peakLabel, peakAt: event.peakAt },
    },
  };
}

function decideGeomagnetic(event: GeomagneticEvent, thresholds: ThresholdConfig): NotificationDecision {
  if (typeof event.kpIndex !== 'number'
    || event.kpIndex < thresholds.geomagnetic.pushMinKp) {
    return { shouldFire: false, reason: 'kp-below-threshold' };
  }
  // Severity ladder: Kp 5-6 = G2 (medium), 7 = G3 (medium), 8 = G4 (high),
  // 9 = G5 (critical). The threshold gate above lets the user dial in the
  // floor (e.g. only fire on Kp >= 7); the level/type below report the
  // actual storm class so the body matches what NOAA published.
  const kp = event.kpIndex;
  const gLevel = gLevelForKp(kp);
  const threatType: NotificationThreatType = kp >= 8 ? 'geomagnetic_g4' : 'geomagnetic_g3';
  const threatLevel = geomagThreatLevel(kp);
  return {
    shouldFire: true,
    payload: {
      title: `Crystal Ball — Geomagnetic ${gLevel}`,
      body: `Geomagnetic storm ${gLevel} (Kp ${kp}) — possible HF radio + GPS impact`,
      sound: SOUND_BY_LEVEL[threatLevel],
      threatType,
      threatLevel,
      dedupeKey: `geomag:${gLevel}:${event.observedAt ?? Math.floor(Date.now() / 60_000)}`,
      meta: { kpIndex: kp, observedAt: event.observedAt, gLevel },
    },
  };
}

function decideCap(event: CapEvent): NotificationDecision {
  if (event.urgency !== 'Immediate') {
    return { shouldFire: false, reason: 'cap-not-extreme-immediate' };
  }
  // Spec: NWS Extreme/Severe CAP alerts → notification ladder. Extreme
  // wakes the user (critical), Severe is a high-priority push without
  // the loudest sound.
  if (event.severity !== 'Extreme' && event.severity !== 'Severe') {
    return { shouldFire: false, reason: 'cap-not-extreme-immediate' };
  }
  const isExtreme = event.severity === 'Extreme';
  const threatLevel: NotificationThreatLevel = isExtreme ? 'critical' : 'high';
  const threatType: NotificationThreatType = isExtreme ? 'cap_extreme' : 'cap_severe';
  return {
    shouldFire: true,
    payload: {
      title: `Crystal Ball — ${event.event || 'Emergency Alert'}`,
      body: `${event.headline || event.event}${event.areaDesc ? ` — ${event.areaDesc}` : ''}`,
      sound: SOUND_BY_LEVEL[threatLevel],
      threatType,
      threatLevel,
      dedupeKey: `cap:${event.alertId ?? `${event.event}:${event.areaDesc}`}`,
      meta: { event: event.event, severity: event.severity, urgency: event.urgency, areaDesc: event.areaDesc },
    },
  };
}

function decideHurricane(event: HurricaneEvent, thresholds: ThresholdConfig): NotificationDecision {
  if (!event.nhcStorm) {
    return { shouldFire: false, reason: 'todo-data-feed-pending' };
  }
  if (event.nhcStorm.category < thresholds.hurricane.pushMinCategory) {
    return {
      shouldFire: false,
      reason: thresholds.hurricane.pushMinCategory === 3
        ? 'hurricane-below-cat3'
        : 'hurricane-below-threshold',
    };
  }
  return {
    shouldFire: true,
    payload: {
      title: `Crystal Ball — Hurricane ${event.nhcStorm.name} Cat ${event.nhcStorm.category}`,
      body: `Hurricane ${event.nhcStorm.name} Category ${event.nhcStorm.category}${event.nhcStorm.projectedLandfall ? ` — landfall ${event.nhcStorm.projectedLandfall}` : ''}`,
      sound: SOUND_BY_LEVEL.critical,
      threatType: 'hurricane_cat3',
      threatLevel: event.nhcStorm.category >= 4 ? 'critical' : 'high',
      dedupeKey: `hurricane:${event.nhcStorm.name}:${event.nhcStorm.category}`,
      meta: { ...event.nhcStorm },
    },
  };
}

function decideWildfire(event: WildfireEvent): NotificationDecision {
  if (!event.nifc) {
    return { shouldFire: false, reason: 'todo-data-feed-pending' };
  }
  if (event.nifc.containment >= WILDFIRE_MAX_CONTAINMENT_PCT) {
    return { shouldFire: false, reason: 'wildfire-containment-above-threshold' };
  }
  // Spec: large fires only — under-10k-acre fires get filtered even when
  // weakly contained (most stay short-lived). When acreage is unknown the
  // bridge layer is responsible for back-filling; we bail on missing data
  // rather than guessing.
  const acres = typeof event.nifc.acres === 'number' ? event.nifc.acres : null;
  if (acres === null || acres < WILDFIRE_MIN_ACRES) {
    return { shouldFire: false, reason: 'wildfire-below-acre-threshold' };
  }
  return {
    shouldFire: true,
    payload: {
      title: `Crystal Ball — Wildfire ${event.nifc.name}`,
      body: `Wildfire ${event.nifc.name} (${event.nifc.state}) — ${acres.toLocaleString()} acres, ${event.nifc.containment}% contained`,
      sound: SOUND_BY_LEVEL.high,
      threatType: 'wildfire_extreme',
      threatLevel: 'high',
      dedupeKey: `wildfire:${event.nifc.name}:${event.nifc.state}`,
      meta: { ...event.nifc },
    },
  };
}

function decideWildfireFrp(event: WildfireFrpEvent, thresholds: ThresholdConfig): NotificationDecision {
  if (typeof event.frpMw !== 'number' || event.frpMw < thresholds.wildfire.pushMinFRP) {
    return { shouldFire: false, reason: 'wildfire-frp-below-threshold' };
  }
  if (event.distanceKm !== null && event.distanceKm > thresholds.wildfire.radiusKm) {
    return { shouldFire: false, reason: 'wildfire-out-of-radius' };
  }
  const distanceLabel = event.distanceKm === null ? 'unknown distance' : `${event.distanceKm.toFixed(0)} km`;
  return {
    shouldFire: true,
    payload: {
      title: `Crystal Ball — Wildfire detected`,
      body: `Active fire ${distanceLabel} away — FRP ${Math.round(event.frpMw)} MW`,
      sound: SOUND_BY_LEVEL.high,
      threatType: 'wildfire_extreme',
      threatLevel: 'high',
      dedupeKey: `wildfire-frp:${event.detectionId ?? `${event.lat.toFixed(2)},${event.lon.toFixed(2)}`}`,
      meta: { frpMw: event.frpMw, lat: event.lat, lon: event.lon, distanceKm: event.distanceKm,
        source: event.source, detectedAt: event.detectedAt },
    },
  };
}

function aqiToLevel(aqi: number): NotificationThreatLevel {
  if (aqi >= 300) return 'critical';
  if (aqi >= 200) return 'high';
  return 'medium';
}

function decideAirQuality(event: AirQualityEvent, thresholds: ThresholdConfig): NotificationDecision {
  if (typeof event.aqi !== 'number' || event.aqi < thresholds.airQuality.pushMinAQI) {
    return { shouldFire: false, reason: 'aqi-below-threshold' };
  }
  const level: NotificationThreatLevel = aqiToLevel(event.aqi);
  return {
    shouldFire: true,
    payload: {
      title: `Crystal Ball — AQI ${event.aqi}`,
      body: `Air quality unhealthy${event.pollutant ? ` (${event.pollutant})` : ''}${event.station ? ` near ${event.station}` : ''}`,
      sound: SOUND_BY_LEVEL[level],
      threatType: 'air_quality_unhealthy',
      threatLevel: level,
      dedupeKey: `aqi:${event.station ?? 'unknown'}:${Math.floor(event.aqi / 25)}`,
      meta: { aqi: event.aqi, pollutant: event.pollutant, station: event.station,
        observedAt: event.observedAt },
    },
  };
}

function decideMarket(event: MarketEvent, thresholds: ThresholdConfig): NotificationDecision {
  const vixHit = typeof event.vix === 'number' && event.vix >= thresholds.economic.pushMinVIX;
  const ofrHit = typeof event.ofrFsiSigmas === 'number'
    && event.ofrFsiSigmas >= thresholds.economic.ofrFsiSigmas;
  if (!vixHit && !ofrHit) {
    return { shouldFire: false, reason: 'market-below-threshold' };
  }
  const parts: string[] = [];
  if (vixHit && typeof event.vix === 'number') parts.push(`VIX ${event.vix.toFixed(1)}`);
  if (ofrHit && typeof event.ofrFsiSigmas === 'number') parts.push(`OFR FSI ${event.ofrFsiSigmas.toFixed(1)}σ`);
  return {
    shouldFire: true,
    payload: {
      title: `Crystal Ball — Market stress`,
      body: parts.join(' · '),
      sound: SOUND_BY_LEVEL.high,
      threatType: 'market_stress',
      threatLevel: 'high',
      dedupeKey: `market:${event.observedAt ?? Math.floor(Date.now() / (5 * 60_000))}`,
      meta: { vix: event.vix, ofrFsiSigmas: event.ofrFsiSigmas, observedAt: event.observedAt },
    },
  };
}

export interface DecideOptions {
  /** Override the persisted thresholds. Pure code paths (tests) should
   *  pass an explicit ThresholdConfig; production code can omit this and
   *  the helper will pull the latest persisted values via loadThresholds(). */
  thresholds?: ThresholdConfig;
}

export function decideNotification(
  event: NotifiableEvent,
  options: DecideOptions = {},
): NotificationDecision {
  const thresholds = options.thresholds ?? loadThresholds();
  switch (event.kind) {
    case 'seismic': { return decideSeismic(event, thresholds);
    }
    case 'geomagnetic': { return decideGeomagnetic(event, thresholds);
    }
    case 'solar_flare': { return decideSolarFlare(event);
    }
    case 'cap': { return decideCap(event);
    }
    case 'hurricane': { return decideHurricane(event, thresholds);
    }
    case 'wildfire': { return decideWildfire(event);
    }
    case 'wildfire-frp': { return decideWildfireFrp(event, thresholds);
    }
    case 'air-quality': { return decideAirQuality(event, thresholds);
    }
    case 'market': { return decideMarket(event, thresholds);
    }
    default: { return { shouldFire: false, reason: 'unknown-event-kind' };
    }
  }
}

// ── Side-effecting dispatch ──────────────────────────────────────────────────

export interface FirePushOptions {
  ledger?: NotificationLedger;
  /** Override for tests; defaults to the Tauri invoke path. */
  send?: (payload: NotificationPayload) => Promise<void>;
  /** When `true` (the default), every decision — fired or suppressed —
   *  is appended to the notification history ring (see
   *  notification-history-service.ts). Tests pass `false` so the ring
   *  doesn't accumulate noise across files. */
  recordHistory?: boolean;
  /** Producer label written to `NotificationHistoryEntry.source`. */
  source?: string;
}

async function defaultSend(payload: NotificationPayload): Promise<void> {
  if (!isDesktopRuntime()) return;
  await tryInvokeTauri<void>('send_notification', {
    title: payload.title,
    body: payload.body,
    sound: payload.sound,
  });
}

export async function firePushForEvent(
  event: NotifiableEvent,
  opts: FirePushOptions & DecideOptions = {},
): Promise<{ fired: boolean; entry?: NotificationLedgerEntry; reason?: string }> {
  const decision = decideNotification(event, { thresholds: opts.thresholds });
  const source = opts.source ?? 'push-notifier';
  const shouldRecord = opts.recordHistory !== false;
  if (!decision.shouldFire || !decision.payload) {
    if (shouldRecord) {
      recordHistory({
        domain: domainForThreatType(undefined),
        source,
        action: 'suppressed',
        title: `${event.kind} (suppressed)`,
        body: decision.reason ?? 'no payload',
        severity: 'low',
        suppressedReason: decision.reason,
        ruleId: `default-${event.kind}`,
        payload: event as unknown as Record<string, unknown>,
      });
    }
    return { fired: false, reason: decision.reason };
  }
  const send = opts.send ?? defaultSend;
  await send(decision.payload);
  try {
    await fireVoiceForEvent(event, getVoiceSettings());
  } catch { /* voice is best-effort; never break the notification path */ }
  let entry: NotificationLedgerEntry | undefined;
  if (opts.ledger) {
    entry = opts.ledger.append({
      channel: 'push' satisfies NotificationChannel,
      threatType: decision.payload.threatType,
      threatLevel: decision.payload.threatLevel,
      title: decision.payload.title,
      body: decision.payload.body,
      dedupeKey: decision.payload.dedupeKey,
      meta: decision.payload.meta,
    });
  }
  if (shouldRecord) {
    recordHistory({
      domain: domainForThreatType(decision.payload.threatType),
      source,
      action: 'fired',
      title: decision.payload.title,
      body: decision.payload.body,
      severity: decision.payload.threatLevel,
      ruleId: `default-${event.kind}`,
      payload: { ...decision.payload.meta, event },
    });
  }
  return { fired: true, entry };
}
