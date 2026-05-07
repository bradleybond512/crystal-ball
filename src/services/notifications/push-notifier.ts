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

export interface GeomagneticEvent {
  kind: 'geomagnetic';
  /** NOAA SWPC Kp index 0–9. G4 = Kp 8, G5 = Kp 9. */
  kpIndex: number;
  observedAt?: string;
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
  nifc?: { name: string; state: string; containment: number };
}

export type NotifiableEvent =
  | SeismicEvent
  | GeomagneticEvent
  | CapEvent
  | HurricaneEvent
  | WildfireEvent;

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
    | 'kp-below-threshold'
    | 'cap-not-extreme-immediate'
    | 'hurricane-below-cat3'
    | 'wildfire-containment-above-threshold'
    | 'todo-data-feed-pending'
    | 'unknown-event-kind';
}

const SOUND_BY_LEVEL: Record<NotificationThreatLevel, string> = {
  critical: 'Basso',
  high: 'Sosumi',
  medium: 'Ping',
  low: 'Tink',
};

function decideSeismic(event: SeismicEvent): NotificationDecision {
  const tier = tierForMagnitude(event.magnitude);
  if (tier === null || tier === 'TIER_2') {
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

function decideGeomagnetic(event: GeomagneticEvent): NotificationDecision {
  if (typeof event.kpIndex !== 'number' || event.kpIndex < 8) {
    return { shouldFire: false, reason: 'kp-below-threshold' };
  }
  const gLevel = event.kpIndex >= 9 ? 'G5' : 'G4';
  return {
    shouldFire: true,
    payload: {
      title: `Crystal Ball — Geomagnetic ${gLevel}`,
      body: `Geomagnetic storm ${gLevel} (Kp ${event.kpIndex}) — possible HF radio + GPS impact`,
      sound: SOUND_BY_LEVEL.high,
      threatType: 'geomagnetic_g4',
      threatLevel: gLevel === 'G5' ? 'critical' : 'high',
      dedupeKey: `geomag:${gLevel}:${event.observedAt ?? Math.floor(Date.now() / 60_000)}`,
      meta: { kpIndex: event.kpIndex, observedAt: event.observedAt },
    },
  };
}

function decideCap(event: CapEvent): NotificationDecision {
  if (event.severity !== 'Extreme' || event.urgency !== 'Immediate') {
    return { shouldFire: false, reason: 'cap-not-extreme-immediate' };
  }
  return {
    shouldFire: true,
    payload: {
      title: `Crystal Ball — ${event.event || 'Emergency Alert'}`,
      body: `${event.headline || event.event}${event.areaDesc ? ` — ${event.areaDesc}` : ''}`,
      sound: SOUND_BY_LEVEL.critical,
      threatType: 'cap_extreme',
      threatLevel: 'critical',
      dedupeKey: `cap:${event.alertId ?? `${event.event}:${event.areaDesc}`}`,
      meta: { event: event.event, severity: event.severity, urgency: event.urgency, areaDesc: event.areaDesc },
    },
  };
}

function decideHurricane(event: HurricaneEvent): NotificationDecision {
  // TODO: NHC feed wires up in parallel session. When present, gate on
  // category >= 3.
  if (!event.nhcStorm) {
    return { shouldFire: false, reason: 'todo-data-feed-pending' };
  }
  if (event.nhcStorm.category < 3) {
    return { shouldFire: false, reason: 'hurricane-below-cat3' };
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
  // TODO: NIFC feed wires up in parallel session. When present, gate on
  // containment < 10.
  if (!event.nifc) {
    return { shouldFire: false, reason: 'todo-data-feed-pending' };
  }
  if (event.nifc.containment >= 10) {
    return { shouldFire: false, reason: 'wildfire-containment-above-threshold' };
  }
  return {
    shouldFire: true,
    payload: {
      title: `Crystal Ball — Wildfire ${event.nifc.name}`,
      body: `Wildfire ${event.nifc.name} (${event.nifc.state}) — ${event.nifc.containment}% contained`,
      sound: SOUND_BY_LEVEL.high,
      threatType: 'wildfire_extreme',
      threatLevel: 'high',
      dedupeKey: `wildfire:${event.nifc.name}:${event.nifc.state}`,
      meta: { ...event.nifc },
    },
  };
}

export function decideNotification(event: NotifiableEvent): NotificationDecision {
  switch (event.kind) {
    case 'seismic': { return decideSeismic(event);
    }
    case 'geomagnetic': { return decideGeomagnetic(event);
    }
    case 'cap': { return decideCap(event);
    }
    case 'hurricane': { return decideHurricane(event);
    }
    case 'wildfire': { return decideWildfire(event);
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
  opts: FirePushOptions = {},
): Promise<{ fired: boolean; entry?: NotificationLedgerEntry; reason?: string }> {
  const decision = decideNotification(event);
  if (!decision.shouldFire || !decision.payload) {
    return { fired: false, reason: decision.reason };
  }
  const send = opts.send ?? defaultSend;
  await send(decision.payload);
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
  return { fired: true, entry };
}
