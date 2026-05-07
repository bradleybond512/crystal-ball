// Extended iMessage routing — selects which threatTypes from the
// notification dispatch should ALSO send an iMessage, and renders a
// per-type body template using the push payload's `meta`.
//
// Stays decoupled from push-notifier — callers feed the already-decided
// NotificationPayload in. The actual send happens via the existing
// sendImessage(recipient, body) bridge.
/* eslint-disable sonarjs/no-nested-template-literals, sonarjs/no-nested-conditional -- short body interpolation; refactoring to intermediate vars hurts readability more than it helps */

import type { NotificationPayload } from './push-notifier';
import { sendImessage } from '@/services/imessage-bridge';

export type ImessageThreatType =
  | 'seismic_tier3'
  | 'seismic_tier4'
  | 'seismic_tier5'
  | 'geomagnetic_g4'
  | 'wildfire_extreme'
  | 'hurricane_cat3';

const VALID_THREAT_TYPES: ReadonlySet<ImessageThreatType> = new Set([
  'seismic_tier3',
  'seismic_tier4',
  'seismic_tier5',
  'geomagnetic_g4',
  'wildfire_extreme',
  'hurricane_cat3',
]);

export const DEFAULT_IMESSAGE_THREAT_TYPES: readonly ImessageThreatType[] = ['seismic_tier5'];

export interface ImessageExtendedSettings {
  enabled: boolean;
  recipient: string;
  threatTypes: ImessageThreatType[];
}

export interface ImessageRouteDecision {
  send: boolean;
  body?: string;
  reason?:
    | 'disabled'
    | 'missing-recipient'
    | 'threat-type-not-in-whitelist'
    | 'threat-type-not-eligible';
}

function buildSeismicBody(payload: NotificationPayload): string {
  const meta = payload.meta ?? {};
  const mag = typeof meta.magnitude === 'number' ? meta.magnitude.toFixed(1) : null;
  const place = typeof meta.place === 'string' ? meta.place : '';
  if (mag) {
    return `Crystal Ball — M${mag} earthquake${place ? ` near ${place}` : ''}`;
  }
  return payload.title;
}

function buildGeomagneticBody(payload: NotificationPayload): string {
  const meta = payload.meta ?? {};
  const kp = typeof meta.kpIndex === 'number' ? meta.kpIndex : null;
  if (kp == null) return payload.title;
  const gLevel = kp >= 9 ? 'G5' : (kp >= 8 ? 'G4' : `Kp${kp}`);
  return `Crystal Ball — Geomagnetic storm ${gLevel} (Kp ${kp}): aurora visible to mid-latitudes; possible HF radio + GPS impact`;
}

function buildWildfireBody(payload: NotificationPayload): string {
  const meta = payload.meta ?? {};
  const name = typeof meta.name === 'string' ? meta.name : '';
  const state = typeof meta.state === 'string' ? meta.state : '';
  const containment = typeof meta.containment === 'number' ? meta.containment : null;
  if (!name || containment == null) return payload.title;
  return `Crystal Ball — Wildfire ${name}${state ? ` (${state})` : ''}: containment ${containment}%`;
}

function buildHurricaneBody(payload: NotificationPayload): string {
  const meta = payload.meta ?? {};
  const name = typeof meta.name === 'string' ? meta.name : '';
  const category = typeof meta.category === 'number' ? meta.category : null;
  const landfall = typeof meta.projectedLandfall === 'string' ? meta.projectedLandfall : '';
  if (!name || category == null) return payload.title;
  return `Crystal Ball — Hurricane ${name} Cat ${category}${landfall ? `: projected landfall ${landfall}` : ''}`;
}

function bodyForThreatType(payload: NotificationPayload): string {
  switch (payload.threatType) {
    case 'seismic_tier3':
    case 'seismic_tier4':
    case 'seismic_tier5': {
      return buildSeismicBody(payload);
    }
    case 'geomagnetic_g4': {
      return buildGeomagneticBody(payload);
    }
    case 'wildfire_extreme': {
      return buildWildfireBody(payload);
    }
    case 'hurricane_cat3': {
      return buildHurricaneBody(payload);
    }
    default: {
      return payload.title;
    }
  }
}

export function routeAlertToImessage(
  payload: NotificationPayload,
  settings: ImessageExtendedSettings,
): ImessageRouteDecision {
  if (!settings.enabled) return { send: false, reason: 'disabled' };
  if (!settings.recipient.trim()) return { send: false, reason: 'missing-recipient' };

  const threatType = payload.threatType as ImessageThreatType;
  if (!VALID_THREAT_TYPES.has(threatType)) {
    return { send: false, reason: 'threat-type-not-eligible' };
  }
  if (!settings.threatTypes.includes(threatType)) {
    return { send: false, reason: 'threat-type-not-in-whitelist' };
  }
  return { send: true, body: bodyForThreatType(payload) };
}

export function parseImessageThreatTypeList(
  raw: string | null | undefined,
): ImessageThreatType[] {
  if (!raw?.trim()) return [...DEFAULT_IMESSAGE_THREAT_TYPES];
  const tokens = raw.split(',').map(t => t.trim().toLowerCase());
  const out: ImessageThreatType[] = [];
  for (const token of tokens) {
    if (VALID_THREAT_TYPES.has(token as ImessageThreatType)) {
      out.push(token as ImessageThreatType);
    }
  }
  return out;
}

// ── Side-effecting dispatch ──────────────────────────────────────────────────

export interface FireImessageOptions {
  send?: (recipient: string, body: string) => Promise<{ ok: boolean; reason?: string }>;
}

export async function fireImessageForPayload(
  payload: NotificationPayload,
  settings: ImessageExtendedSettings,
  opts: FireImessageOptions = {},
): Promise<{ sent: boolean; reason?: string }> {
  const decision = routeAlertToImessage(payload, settings);
  if (!decision.send || !decision.body) return { sent: false, reason: decision.reason };
  const send = opts.send ?? sendImessage;
  const result = await send(settings.recipient, decision.body);
  return result.ok ? { sent: true } : { sent: false, reason: result.reason };
}
