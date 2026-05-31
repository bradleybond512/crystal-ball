/**
 * Nuclear/radiological domain mission bridges.
 *
 * Three bridges cover the full nuclear threat spectrum:
 *   - IAEA INES-graded facility incidents (NuclearIncidentBridge)
 *   - Field radiation releases by dose rate and contaminated area (RadiationReleaseBridge)
 *   - Nuclear/radiological threat intelligence (NuclearThreatBridge)
 *
 * All self-register with MissionBridgeRegistry at module load.
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

function normalizeType(raw: unknown): string {
  return str(raw).toLowerCase().replace(/[\s-]+/g, '_');
}

// ── INES scale → FeedSeverity ─────────────────────────────────────────────
//
// International Nuclear Event Scale (IAEA):
//   7 (Major accident — Chernobyl/Fukushima) → CRITICAL (4)
//   5–6 (Accident with off-site risk)         → HIGH     (3)
//   3–4 (Incident / accident without off-site risk) → MEDIUM (2)
//   1–2 (Anomaly / incident)                  → LOW      (1)
//   0   (Deviation — no safety significance)  → INFO     (0)

function inesSeverity(level: number): FeedSeverity {
  if (level >= 7) return 4;
  if (level >= 5) return 3;
  if (level >= 3) return 2;
  if (level >= 1) return 1;
  return 0;
}

// ── NuclearIncidentBridge ─────────────────────────────────────────────────
//
// Severity is the maximum of the INES-derived score and the type-derived
// score so that a reported INES level never understates a known event type.

const INCIDENT_TYPE_SEVERITY: Record<string, FeedSeverity> = {
  meltdown:     4,
  criticality:  4,
  coolant_loss: 3,
  fire:         3,
  fuel_damage:  2,
  release:      2,
  anomaly:      1,
  shutdown:     1,
};

export class NuclearIncidentBridge extends MissionBridgeBase {
  readonly domain = 'nuclear';
  readonly feedId = 'nuclear-incidents';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (!id) return null;
    const type = normalizeType(raw.type);
    if (!type) return null;

    const inesLevel = num(raw.inesLevel, 0);
    const iSev = inesSeverity(inesLevel);
    const tSev: FeedSeverity = INCIDENT_TYPE_SEVERITY[type] ?? 1;
    const severity = Math.max(iSev, tSev) as FeedSeverity;

    const facility = str(raw.facility) || str(raw.name) || 'unknown facility';
    const description =
      str(raw.description) ||
      `INES-${inesLevel} ${type.replace(/_/g, ' ')} at ${facility}`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── RadiationReleaseBridge ────────────────────────────────────────────────
//
// Two independent severity axes; the higher score wins:
//   Dose rate (µSv/h): ≥100 → 4, ≥10 → 3, ≥1 → 2, >0 → 1
//   Affected area (km²): ≥1000 → 4, ≥100 → 3, ≥10 → 2, ≥1 → 1

function doseSeverity(doseUSvH: number): FeedSeverity {
  if (doseUSvH >= 100) return 4;
  if (doseUSvH >= 10)  return 3;
  if (doseUSvH >= 1)   return 2;
  if (doseUSvH > 0)    return 1;
  return 0;
}

function areaSeverity(areaKm2: number): FeedSeverity {
  if (areaKm2 >= 1000) return 4;
  if (areaKm2 >= 100)  return 3;
  if (areaKm2 >= 10)   return 2;
  if (areaKm2 >= 1)    return 1;
  return 0;
}

export class RadiationReleaseBridge extends MissionBridgeBase {
  readonly domain = 'nuclear';
  readonly feedId = 'radiation-releases';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (!id) return null;

    const doseRate = num(raw.doseRateMicroSvH, 0);
    // affected_area_km2 matches the external feed's snake_case field name
    const areaKm2 = num(raw.affected_area_km2 as number, 0);

    const dSev = doseSeverity(doseRate);
    const aSev = areaSeverity(areaKm2);
    const severity = Math.max(dSev, aSev) as FeedSeverity;

    const location = str(raw.location) || 'unknown location';
    const description =
      str(raw.description) ||
      `Radiation release at ${location}: ${doseRate} µSv/h`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── NuclearThreatBridge ───────────────────────────────────────────────────
//
// Severity reflects operational threat level:
//   detonation/test → 4, deployment/transport → 3,
//   threat/acquisition → 2, rhetoric/concern → 1
//
// Description prefix distinguishes radiological (dirty bomb) from nuclear:
//   type === dirty_bomb | radiological → [RADIOLOGICAL]
//   otherwise                         → [NUCLEAR]

const THREAT_TYPE_SEVERITY: Record<string, FeedSeverity> = {
  detonation:  4,
  test:        4,
  deployment:  3,
  transport:   3,
  threat:      2,
  acquisition: 2,
  rhetoric:    1,
  concern:     1,
};

const RADIOLOGICAL_TYPES = new Set(['dirty_bomb', 'radiological']);

export class NuclearThreatBridge extends MissionBridgeBase {
  readonly domain = 'nuclear';
  readonly feedId = 'nuclear-threats';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (!id) return null;
    const type = normalizeType(raw.type);
    if (!type) return null;

    const severity: FeedSeverity = THREAT_TYPE_SEVERITY[type] ?? 1;
    const prefix = RADIOLOGICAL_TYPES.has(type) ? '[RADIOLOGICAL]' : '[NUCLEAR]';
    const actor = str(raw.actor) || str(raw.country) || 'unknown actor';
    const description =
      str(raw.description) ||
      `${prefix} ${type.replace(/_/g, ' ')} — ${actor}`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Auto-registration ─────────────────────────────────────────────────────

getMissionBridgeRegistry().register(new NuclearIncidentBridge());
getMissionBridgeRegistry().register(new RadiationReleaseBridge());
getMissionBridgeRegistry().register(new NuclearThreatBridge());
