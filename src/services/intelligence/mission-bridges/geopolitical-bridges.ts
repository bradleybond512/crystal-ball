import {
  MissionBridgeBase,
  getMissionBridgeRegistry,
  type FeedSeverity,
  type NormalizedFeedEvent,
} from './mission-bridge-core.ts';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// ── ACLEDConflictBridge ───────────────────────────────────────────────────

const ACLED_EVENT_SEVERITY: Record<string, FeedSeverity> = {
  battle: 3,
  explosion: 2,
};

export class ACLEDConflictBridge extends MissionBridgeBase {
  readonly domain = 'geopolitical';
  readonly feedId = 'acled-conflict';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const eventType = str(raw.event_type);
    const fatalities = typeof raw.fatalities === 'number' ? raw.fatalities : 0;
    const base: FeedSeverity = ACLED_EVENT_SEVERITY[eventType] ?? 1;
    const severity = Math.min(4, base + (fatalities > 100 ? 1 : 0)) as FeedSeverity;
    return {
      id: str(raw.id),
      severity,
      description: `ACLED ${eventType || 'event'}: ${fatalities} fatalities`,
      timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
      raw,
    };
  }
}

// ── OFACSanctionsBridge ───────────────────────────────────────────────────

const OFAC_ENTITY_SEVERITY: Record<string, FeedSeverity> = {
  country: 3,
  organization: 2,
};

export class OFACSanctionsBridge extends MissionBridgeBase {
  readonly domain = 'geopolitical';
  readonly feedId = 'ofac-sdn';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const entityType = str(raw.entity_type);
    const severity: FeedSeverity = OFAC_ENTITY_SEVERITY[entityType] ?? 1;
    return {
      id: str(raw.id),
      severity,
      description: `OFAC SDN ${entityType || 'entity'}: ${str(raw.name)}`,
      timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
      raw,
    };
  }
}

// ── GDELTEventBridge ──────────────────────────────────────────────────────

function gdeltSeverity(goldstein: number): FeedSeverity {
  if (goldstein < -7) return 4;
  if (goldstein < -4) return 3;
  if (goldstein < 0) return 2;
  if (goldstein < 3) return 1;
  return 0;
}

export class GDELTEventBridge extends MissionBridgeBase {
  readonly domain = 'geopolitical';
  readonly feedId = 'gdelt-events';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const goldstein = typeof raw.goldstein_scale === 'number' ? raw.goldstein_scale : 0;
    const severity = gdeltSeverity(goldstein);
    return {
      id: str(raw.id),
      severity,
      description: `GDELT event (Goldstein ${goldstein}): ${str(raw.actor1)} / ${str(raw.actor2)}`,
      timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
      raw,
    };
  }
}

// ── Auto-register at module load ──────────────────────────────────────────

export function registerGeopoliticalBridges(): void {
  getMissionBridgeRegistry().register(new ACLEDConflictBridge());
  getMissionBridgeRegistry().register(new OFACSanctionsBridge());
  getMissionBridgeRegistry().register(new GDELTEventBridge());
}

registerGeopoliticalBridges();
