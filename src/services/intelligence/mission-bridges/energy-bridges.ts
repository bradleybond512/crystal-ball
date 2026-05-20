/**
 * Energy/infrastructure domain mission bridges.
 *
 * Normalizes power outage reports, oil/gas pipeline disruption alerts, and
 * refinery incident notifications into NormalizedFeedEvent shape. All three
 * bridges self-register with MissionBridgeRegistry at module load.
 *
 * Severity logic is calibrated to Crystal Ball's shortage forecast models:
 * energy events that threaten supply chains score higher earlier.
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

// ── Power Outage Bridge ───────────────────────────────────────────────────
//
// Customers-affected thresholds follow NERC/EIA reportable event tiers:
//   ≥500,000 → severe (4), ≥100,000 → major (3),
//   ≥10,000 → significant (2), any → minor (1)

function outageSeverity(customers: number): FeedSeverity {
  if (customers >= 500_000) return 4;
  if (customers >= 100_000) return 3;
  if (customers >= 10_000) return 2;
  return 1;
}

export class PowerOutageBridge extends MissionBridgeBase {
  readonly domain = 'energy';
  readonly feedId  = 'power-outages';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const customers = num(raw.customersAffected, 0);
    const severity = customers > 0 ? outageSeverity(customers) : 1;
    const region = str(raw.region) || 'unknown region';
    const description =
      str(raw.description) ||
      `Power outage: ${customers.toLocaleString()} customers affected in ${region}`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Pipeline Disruption Bridge ─────────────────────────────────────────────
//
// Severity tracks supply impact, not just physical damage:
//   full_rupture/explosion → 4, major_leak → 3,
//   partial_shutdown → 2, pressure_anomaly → 1

const PIPELINE_STATUS_SEVERITY: Record<string, FeedSeverity> = {
  full_rupture:      4,
  explosion:         4,
  major_leak:        3,
  fire:              3,
  partial_shutdown:  2,
  reduced_flow:      2,
  pressure_anomaly:  1,
};

export class PipelineDisruptionBridge extends MissionBridgeBase {
  readonly domain = 'energy';
  readonly feedId  = 'pipeline-disruptions';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const status = str(raw.status).toLowerCase().replace(/\s+/g, '_');
    const severity: FeedSeverity = PIPELINE_STATUS_SEVERITY[status] ?? 1;
    const pipeline = str(raw.pipelineName) || str(raw.name) || 'unknown pipeline';
    const description =
      str(raw.description) ||
      `${pipeline}: ${status.replace(/_/g, ' ') || 'disruption'}`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Refinery Incident Bridge ──────────────────────────────────────────────
//
// Severity tracks production loss (barrels per day):
//   ≥500,000 bpd → critical (4), ≥100,000 → major (3),
//   ≥10,000 → significant (2), any loss → minor (1)
// If capacity loss % is provided, it overrides bpd when higher.

function refineryCapLossSeverity(pct: number): FeedSeverity {
  if (pct >= 75) return 4;
  if (pct >= 40) return 3;
  if (pct >= 15) return 2;
  return 1;
}

function refineryBpdSeverity(bpd: number): FeedSeverity {
  if (bpd >= 500_000) return 4;
  if (bpd >= 100_000) return 3;
  if (bpd >= 10_000) return 2;
  return 1;
}

export class RefineryIncidentBridge extends MissionBridgeBase {
  readonly domain = 'energy';
  readonly feedId  = 'refinery-incidents';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const capLossPct = num(raw.capacityLossPct, -1);
    const lostBpd = num(raw.lostBpd, 0);
    let severity: FeedSeverity;
    if (capLossPct >= 0) {
      const fromPct = refineryCapLossSeverity(capLossPct);
      const fromBpd = lostBpd > 0 ? refineryBpdSeverity(lostBpd) : 1;
      severity = Math.max(fromPct, fromBpd) as FeedSeverity;
    } else {
      severity = lostBpd > 0 ? refineryBpdSeverity(lostBpd) : 1;
    }
    const refinery = str(raw.refineryName) || str(raw.name) || 'unknown refinery';
    const lossDetail = capLossPct >= 0
      ? `${capLossPct.toFixed(0)}% capacity offline`
      : `${lostBpd.toLocaleString()} bpd offline`;
    const description = str(raw.description) || `${refinery}: ${lossDetail}`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Auto-registration ─────────────────────────────────────────────────────

getMissionBridgeRegistry().register(new PowerOutageBridge());
getMissionBridgeRegistry().register(new PipelineDisruptionBridge());
getMissionBridgeRegistry().register(new RefineryIncidentBridge());
