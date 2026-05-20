/**
 * Conflict domain mission bridges.
 *
 * Normalizes ACLED armed conflict events, armed group movement reports, and
 * ceasefire violation notifications into NormalizedFeedEvent shape. All three
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

// ── ACLED Fatality Event Bridge ───────────────────────────────────────────
//
// Fatality thresholds calibrated to ACLED severity definitions:
//   ≥100 fatalities → mass casualty (4), ≥25 → major (3),
//   ≥5 → significant (2), any → minor (1)
// Event type provides a floor: explosion/armed clash ≥ 2.

const ACLED_EVENT_FLOOR: Record<string, FeedSeverity> = {
  'battles':              2,
  'explosions/remote violence': 2,
  'violence against civilians': 2,
  'riots':                1,
  'protests':             0,
  'strategic developments': 1,
};

function fatalityToSeverity(fatalities: number): FeedSeverity {
  if (fatalities >= 100) return 4;
  if (fatalities >= 25)  return 3;
  if (fatalities >= 5)   return 2;
  if (fatalities >= 1)   return 1;
  return 0;
}

export class ACLEDFatalityBridge extends MissionBridgeBase {
  readonly domain = 'conflict';
  readonly feedId  = 'acled-fatalities';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const fatalities = num(raw.fatalities, 0);
    const eventType = str(raw.eventType).toLowerCase();
    const fromFatalities = fatalityToSeverity(fatalities);
    const floor = ACLED_EVENT_FLOOR[eventType] ?? 0;
    const severity = Math.max(fromFatalities, floor) as FeedSeverity;
    const location = str(raw.location) || str(raw.country) || 'unknown location';
    const description =
      str(raw.description) ||
      `${eventType || 'conflict event'} near ${location}: ${fatalities} fatalities`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Armed Group Movement Bridge ───────────────────────────────────────────
//
// Movement type reflects operational escalation:
//   offensive_advance → 4, flanking_maneuver → 3,
//   defensive_regroup → 2, patrol/presence → 1

const MOVEMENT_TYPE_SEVERITY: Record<string, FeedSeverity> = {
  offensive_advance:   4,
  breakthrough:        4,
  flanking_maneuver:   3,
  encirclement:        3,
  defensive_regroup:   2,
  withdrawal:          2,
  patrol:              1,
  presence:            1,
};

export class ArmedGroupMovementBridge extends MissionBridgeBase {
  readonly domain = 'conflict';
  readonly feedId  = 'armed-group-movements';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const movementType = str(raw.movementType).toLowerCase().replace(/\s+/g, '_');
    const severity: FeedSeverity = MOVEMENT_TYPE_SEVERITY[movementType] ?? 1;
    const group = str(raw.groupName) || str(raw.actor) || 'unknown group';
    const area = str(raw.area) || str(raw.location) || 'unknown area';
    const description =
      str(raw.description) ||
      `${group}: ${movementType.replace(/_/g, ' ') || 'movement'} near ${area}`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Ceasefire Violation Bridge ────────────────────────────────────────────
//
// Violation severity tracks weaponry and intent escalation:
//   heavy_artillery/airstrike → 4, mortar_shelling → 3,
//   small_arms → 2, incursion/observation → 1

const VIOLATION_TYPE_SEVERITY: Record<string, FeedSeverity> = {
  heavy_artillery: 4,
  airstrike:       4,
  rocket_attack:   3,
  mortar_shelling: 3,
  sniper_fire:     2,
  small_arms:      2,
  incursion:       1,
  observation:     1,
};

export class CeasefireViolationBridge extends MissionBridgeBase {
  readonly domain = 'conflict';
  readonly feedId  = 'ceasefire-violations';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const violationType = str(raw.violationType).toLowerCase().replace(/\s+/g, '_');
    const severity: FeedSeverity = VIOLATION_TYPE_SEVERITY[violationType] ?? 1;
    const zone = str(raw.zone) || str(raw.location) || 'unknown zone';
    const description =
      str(raw.description) ||
      `Ceasefire violation: ${violationType.replace(/_/g, ' ') || 'incident'} in ${zone}`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Auto-registration ─────────────────────────────────────────────────────

getMissionBridgeRegistry().register(new ACLEDFatalityBridge());
getMissionBridgeRegistry().register(new ArmedGroupMovementBridge());
getMissionBridgeRegistry().register(new CeasefireViolationBridge());
