import type { ObservationEvent } from '@/types/intelligence';
import {
  MissionBridgeBase,
  getMissionBridgeRegistry,
  type FeedSeverity,
  type NormalizedFeedEvent,
} from './mission-bridge-core.ts';

// ── Shared helpers ────────────────────────────────────────────────────────

const FEED_TO_OBS_SEVERITY = {
  0: 'INFO',
  1: 'LOW',
  2: 'MEDIUM',
  3: 'HIGH',
  4: 'CRITICAL',
} as const satisfies Record<FeedSeverity, ObservationEvent['severity']>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Extends MissionBridgeBase with processCycle() — converts a batch of raw
 * feed payloads into ObservationEvents ready for the intelligence pipeline.
 */
abstract class SpaceBridgeBase extends MissionBridgeBase {
  processCycle(raws: Record<string, unknown>[]): ObservationEvent[] {
    const results: ObservationEvent[] = [];
    for (const raw of raws) {
      const norm = this.normalize(raw);
      if (norm === null) continue;
      results.push({
        id: norm.id,
        sourceId: this.feedId,
        domain: this.domain,
        timestamp: norm.timestamp,
        severity: FEED_TO_OBS_SEVERITY[norm.severity],
        title: norm.description,
        raw: norm.raw,
        entityIds: [],
        tags: [this.domain, this.feedId],
      });
    }
    return results;
  }
}

// ── SolarFlareBridge ──────────────────────────────────────────────────────

const FLARE_CLASS_SEVERITY: Record<string, FeedSeverity> = {
  X: 4,
  M: 3,
  C: 2,
  B: 1,
};

export class SolarFlareBridge extends SpaceBridgeBase {
  readonly domain = 'space';
  readonly feedId = 'solar-flare';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    const flareClass = str(raw.flare_class);
    const classLetter = flareClass.charAt(0).toUpperCase();
    const severity: FeedSeverity = FLARE_CLASS_SEVERITY[classLetter] ?? 0;
    const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
    return {
      id,
      severity,
      description: `Solar flare ${flareClass || 'unknown class'}`,
      timestamp,
      raw,
    };
  }
}

// ── CMEImpactBridge ───────────────────────────────────────────────────────

function cmeSeverity(kp: number): FeedSeverity {
  if (kp >= 8) return 4;
  if (kp >= 6) return 3;
  if (kp >= 5) return 2;
  return 1;
}

export class CMEImpactBridge extends SpaceBridgeBase {
  readonly domain = 'space';
  readonly feedId = 'cme-impact';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    const kp = typeof raw.kp_index === 'number' ? raw.kp_index : 0;
    const severity = cmeSeverity(kp);
    const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
    return {
      id,
      severity,
      description: `CME geomagnetic impact — Kp ${kp}`,
      timestamp,
      raw,
    };
  }
}

// ── SpaceDebrisBridge ─────────────────────────────────────────────────────

function debrisSeverity(missKm: number): FeedSeverity {
  if (missKm < 0.1) return 4;
  if (missKm < 1)   return 3;
  if (missKm < 10)  return 2;
  return 1;
}

export class SpaceDebrisBridge extends SpaceBridgeBase {
  readonly domain = 'space';
  readonly feedId = 'space-debris';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = raw.id;
    if (typeof id !== 'string' || id.length === 0) return null;
    const missKm = typeof raw.miss_distance_km === 'number' ? raw.miss_distance_km : Infinity;
    const severity = debrisSeverity(missKm);
    const object = str(raw.object_name) || 'unknown object';
    const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Date.now();
    return {
      id,
      severity,
      description: `Debris conjunction — ${object} at ${missKm} km miss distance`,
      timestamp,
      raw,
    };
  }
}

// ── Auto-register at module load ──────────────────────────────────────────

export function registerSpaceBridges(): void {
  getMissionBridgeRegistry().register(new SolarFlareBridge());
  getMissionBridgeRegistry().register(new CMEImpactBridge());
  getMissionBridgeRegistry().register(new SpaceDebrisBridge());
}

registerSpaceBridges();
