/**
 * Maritime domain mission bridges.
 *
 * Normalizes AIS vessel events, maritime incident reports, and port
 * disruption alerts into NormalizedFeedEvent shape. All three bridges
 * self-register with MissionBridgeRegistry at module load.
 */

import { MissionBridgeBase, getMissionBridgeRegistry, type FeedSeverity, type NormalizedFeedEvent } from './mission-bridge-core';

// ── AIS Vessel Bridge ─────────────────────────────────────────────────

const AIS_STATUS_SEVERITY: Record<string, FeedSeverity> = {
  sanctioned_waters: 4,
  dark:              3,
  spoofing:          3,
  normal:            0,
};

export class AISVesselBridge extends MissionBridgeBase {
  readonly domain = 'maritime';
  readonly feedId  = 'ais-vessels';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    const status = typeof raw.status === 'string' ? raw.status : 'normal';
    const severity: FeedSeverity = AIS_STATUS_SEVERITY[status] ?? 0;
    const description = typeof raw.description === 'string'
      ? raw.description
      : `Vessel ${id} — ${status}`;
    const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
    return { id, severity, description, timestamp, raw };
  }
}

// ── Maritime Incident Bridge ──────────────────────────────────────────

const INCIDENT_TYPE_SEVERITY: Record<string, FeedSeverity> = {
  piracy_attack:       4,
  suspicious_approach: 2,
  mechanical_distress: 1,
};

export class MaritimeIncidentBridge extends MissionBridgeBase {
  readonly domain = 'maritime';
  readonly feedId  = 'maritime-incidents';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    const type = typeof raw.type === 'string' ? raw.type : '';
    const severity: FeedSeverity = INCIDENT_TYPE_SEVERITY[type] ?? 0;
    const description = typeof raw.description === 'string'
      ? raw.description
      : `Maritime incident ${id} — ${type || 'unknown'}`;
    const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
    return { id, severity, description, timestamp, raw };
  }
}

// ── Port Disruption Bridge ────────────────────────────────────────────

const PORT_CLOSURE_SEVERITY: Record<string, FeedSeverity> = {
  closed:    4,
  congested: 2,
  delayed:   1,
  normal:    0,
};

export class PortDisruptionBridge extends MissionBridgeBase {
  readonly domain = 'maritime';
  readonly feedId  = 'port-disruptions';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    const closureStatus = typeof raw.closureStatus === 'string' ? raw.closureStatus : 'normal';
    const severity: FeedSeverity = PORT_CLOSURE_SEVERITY[closureStatus] ?? 0;
    const description = typeof raw.description === 'string'
      ? raw.description
      : `Port ${id} — ${closureStatus}`;
    const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
    return { id, severity, description, timestamp, raw };
  }
}

// ── Auto-registration ─────────────────────────────────────────────────

getMissionBridgeRegistry().register(new AISVesselBridge());
getMissionBridgeRegistry().register(new MaritimeIncidentBridge());
getMissionBridgeRegistry().register(new PortDisruptionBridge());
