/**
 * Health domain mission bridges.
 *
 * Normalizes CDC wastewater surveillance, WHO outbreak risk assessments, and
 * biosurveillance R-value proxy signals into NormalizedFeedEvent shape. All
 * three bridges self-register with MissionBridgeRegistry at module load.
 */

import {
  MissionBridgeBase,
  getMissionBridgeRegistry,
  type FeedSeverity,
  type NormalizedFeedEvent,
} from './mission-bridge-core';

// ── CDC Wastewater Surveillance Bridge ────────────────────────────────────

const SIGNAL_LEVEL_SEVERITY: Record<string, FeedSeverity> = {
  very_high: 4,
  high:      3,
  moderate:  2,
  low:       1,
  minimal:   0,
};

export class CDCWastewaterBridge extends MissionBridgeBase {
  readonly domain = 'health';
  readonly feedId  = 'cdc-nwss';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    const signalLevel = typeof raw.signalLevel === 'string' ? raw.signalLevel : '';
    const severity: FeedSeverity = SIGNAL_LEVEL_SEVERITY[signalLevel] ?? 0;
    const description = typeof raw.description === 'string'
      ? raw.description
      : `CDC wastewater ${id} — ${signalLevel || 'unknown'}`;
    const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
    return { id, severity, description, timestamp, raw };
  }
}

// ── WHO Outbreak Bridge ───────────────────────────────────────────────────

const WHO_RISK_SEVERITY: Record<string, FeedSeverity> = {
  very_high: 4,
  high:      3,
  moderate:  2,
  low:       1,
};

export class WHOOutbreakBridge extends MissionBridgeBase {
  readonly domain = 'health';
  readonly feedId  = 'who-outbreaks';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    const riskAssessment = typeof raw.riskAssessment === 'string' ? raw.riskAssessment : '';
    const severity: FeedSeverity = WHO_RISK_SEVERITY[riskAssessment] ?? 0;
    const description = typeof raw.description === 'string'
      ? raw.description
      : `WHO outbreak ${id} — ${riskAssessment || 'unknown'}`;
    const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
    return { id, severity, description, timestamp, raw };
  }
}

// ── Biodisaster Signal Bridge ─────────────────────────────────────────────

function rValueSeverity(r: number): FeedSeverity {
  if (r > 3) return 4;
  if (r > 2) return 3;
  if (r > 1.5) return 2;
  if (r > 1) return 1;
  return 0;
}

function biodisasterDescription(id: string, rValue: number | null): string {
  if (rValue === null) return `Biosurveillance signal ${id}`;
  return `Biosurveillance signal ${id} — R=${rValue}`;
}

export class BiodisasterSignalBridge extends MissionBridgeBase {
  readonly domain = 'health';
  readonly feedId  = 'biosurv-signals';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    const rValue = typeof raw.rValue === 'number' ? raw.rValue : null;
    const severity: FeedSeverity = rValue === null ? 0 : rValueSeverity(rValue);
    const description = typeof raw.description === 'string'
      ? raw.description
      : biodisasterDescription(id, rValue);
    const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
    return { id, severity, description, timestamp, raw };
  }
}

// ── Auto-registration ─────────────────────────────────────────────────────

getMissionBridgeRegistry().register(new CDCWastewaterBridge());
getMissionBridgeRegistry().register(new WHOOutbreakBridge());
getMissionBridgeRegistry().register(new BiodisasterSignalBridge());
