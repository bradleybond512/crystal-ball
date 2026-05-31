/**
 * Aviation domain mission bridges.
 *
 * Normalizes FAA Temporary Flight Restrictions, aircraft emergency
 * squawk events, and NOTAM airspace closures into NormalizedFeedEvent
 * shape. All three bridges self-register with MissionBridgeRegistry at
 * module load, matching the convention used by sibling domain files
 * (maritime, cyber, weather, …).
 */

import {
  MissionBridgeBase,
  getMissionBridgeRegistry,
  type FeedSeverity,
  type NormalizedFeedEvent,
} from './mission-bridge-core';

// ── FAA Temporary Flight Restriction Bridge ───────────────────────────

const TFR_TYPE_SEVERITY: Record<string, FeedSeverity> = {
  presidential: 4,
  security:     4,
  disaster:     3,
  vip:          3,
  stadium:      2,
};

export class FaaTfrBridge extends MissionBridgeBase {
  readonly domain = 'aviation';
  readonly feedId = 'faa-tfr';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
    const severity: FeedSeverity = TFR_TYPE_SEVERITY[type] ?? 1;
    const description = typeof raw.description === 'string'
      ? raw.description
      : `FAA TFR ${id} — ${type || 'unspecified'}`;
    const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
    return { id, severity, description, timestamp, raw };
  }
}

// ── Aircraft Emergency Squawk Bridge ──────────────────────────────────

// ICAO Annex 10 squawk codes: 7500 = unlawful interference,
// 7600 = comms loss, 7700 = general emergency.
const SQUAWK_SEVERITY: Record<string, FeedSeverity> = {
  '7500': 4,
  '7700': 3,
  '7600': 2,
};

export class AircraftEmergencyBridge extends MissionBridgeBase {
  readonly domain = 'aviation';
  readonly feedId = 'aircraft-emergency';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    const squawk = normalizeSquawk(raw.squawk);
    if (squawk === null) return null;
    const severity: FeedSeverity = SQUAWK_SEVERITY[squawk] ?? 0;
    const description = typeof raw.description === 'string'
      ? raw.description
      : `Aircraft ${id} squawking ${squawk}`;
    const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
    return { id, severity, description, timestamp, raw };
  }
}

function normalizeSquawk(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'string') return value.trim() || null;
  return null;
}

// ── NOTAM Airspace Closure Bridge ─────────────────────────────────────

export class AirspaceClosureBridge extends MissionBridgeBase {
  readonly domain = 'aviation';
  readonly feedId = 'airspace-closure';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    const radiusNm = typeof raw.radiusNm === 'number' && Number.isFinite(raw.radiusNm)
      ? raw.radiusNm
      : 0;
    const severity = severityForRadius(radiusNm);
    const description = typeof raw.description === 'string'
      ? raw.description
      : `Airspace closure ${id} — ${formatRadius(radiusNm)}`;
    const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
    return { id, severity, description, timestamp, raw };
  }
}

export function severityForRadius(radiusNm: number): FeedSeverity {
  if (!Number.isFinite(radiusNm) || radiusNm <= 0) return 1;
  if (radiusNm > 100) return 4;
  if (radiusNm > 50) return 3;
  if (radiusNm > 20) return 2;
  return 1;
}

function formatRadius(radiusNm: number): string {
  if (!Number.isFinite(radiusNm) || radiusNm <= 0) return 'radius unknown';
  return `${radiusNm.toFixed(0)}nm radius`;
}

// ── Auto-registration ─────────────────────────────────────────────────

getMissionBridgeRegistry().register(new FaaTfrBridge());
getMissionBridgeRegistry().register(new AircraftEmergencyBridge());
getMissionBridgeRegistry().register(new AirspaceClosureBridge());
