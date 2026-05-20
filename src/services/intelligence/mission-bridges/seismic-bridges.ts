/**
 * Seismic domain mission bridges.
 *
 * Normalizes USGS earthquake events, PTWC/NTWC tsunami warnings, and
 * volcanic alert notifications into NormalizedFeedEvent shape. All three
 * bridges self-register with MissionBridgeRegistry at module load.
 */

import {
  MissionBridgeBase,
  getMissionBridgeRegistry,
  type FeedSeverity,
  type NormalizedFeedEvent,
} from './mission-bridge-core';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

// ── USGS Earthquake Bridge ─────────────────────────────────────────────
//
// Magnitude thresholds follow USGS felt/damage classifications:
//   ≥7.0 → major (4), ≥6.0 → strong (3), ≥4.5 → moderate (2),
//   ≥2.5 → minor (1), <2.5 → micro (0)

function magnitudeToSeverity(mag: number): FeedSeverity {
  if (mag >= 7) return 4;
  if (mag >= 6) return 3;
  if (mag >= 4.5) return 2;
  if (mag >= 2.5) return 1;
  return 0;
}

export class USGSEarthquakeBridge extends MissionBridgeBase {
  readonly domain = 'seismic';
  readonly feedId  = 'usgs-earthquakes';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const mag = num(raw.magnitude, 0);
    const severity = magnitudeToSeverity(mag);
    const place = str(raw.place) || 'unknown location';
    const description = str(raw.description) || `M${mag.toFixed(1)} earthquake near ${place}`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Tsunami Warning Bridge ─────────────────────────────────────────────
//
// Warning level hierarchy (PTWC/NTWC official levels):
//   warning → 4, advisory → 3, watch → 2, information → 1, none → 0

const TSUNAMI_LEVEL_SEVERITY: Record<string, FeedSeverity> = {
  warning:     4,
  advisory:    3,
  watch:       2,
  information: 1,
};

export class TsunamiWarningBridge extends MissionBridgeBase {
  readonly domain = 'seismic';
  readonly feedId  = 'tsunami-warnings';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const level = str(raw.level).toLowerCase();
    const severity: FeedSeverity = TSUNAMI_LEVEL_SEVERITY[level] ?? 0;
    const region = str(raw.region) || 'unknown region';
    const description = str(raw.description) || `Tsunami ${level || 'notification'} for ${region}`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Volcanic Alert Bridge ─────────────────────────────────────────────
//
// USGS Volcanic Alert Level (VAL) + Aviation Color Code:
//   warning/red → 4, watch/orange → 3, advisory/yellow → 2,
//   normal/green → 1, unassigned → 0

const VOLCANIC_ALERT_SEVERITY: Record<string, FeedSeverity> = {
  warning:  4,
  red:      4,
  watch:    3,
  orange:   3,
  advisory: 2,
  yellow:   2,
  normal:   1,
  green:    1,
};

export class VolcanicAlertBridge extends MissionBridgeBase {
  readonly domain = 'seismic';
  readonly feedId  = 'volcanic-alerts';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const alertLevel = str(raw.alertLevel).toLowerCase();
    const severity: FeedSeverity = VOLCANIC_ALERT_SEVERITY[alertLevel] ?? 0;
    const volcano = str(raw.volcanoName) || str(raw.name) || 'unknown volcano';
    const description = str(raw.description) || `${volcano}: alert level ${alertLevel || 'unassigned'}`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Auto-registration ─────────────────────────────────────────────────

getMissionBridgeRegistry().register(new USGSEarthquakeBridge());
getMissionBridgeRegistry().register(new TsunamiWarningBridge());
getMissionBridgeRegistry().register(new VolcanicAlertBridge());
