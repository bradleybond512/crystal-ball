import {
  MissionBridgeBase,
  getMissionBridgeRegistry,
  type FeedSeverity,
  type NormalizedFeedEvent,
} from './mission-bridge-core';

export class NWSAlertsBridge extends MissionBridgeBase {
  readonly domain = 'weather';
  readonly feedId = 'nws-alerts';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const type = typeof raw['type'] === 'string' ? raw['type'].toLowerCase() : '';
    let severity: FeedSeverity;
    if (type.includes('tornado warning')) {
      severity = 4;
    } else if (type.includes('severe thunderstorm warning')) {
      severity = 3;
    } else if (type.includes('winter storm warning')) {
      severity = 2;
    } else if (type.includes('advisory')) {
      severity = 1;
    } else {
      severity = 0;
    }
    return {
      id: typeof raw['id'] === 'string' ? raw['id'] : String(raw['id'] ?? ''),
      severity,
      description: typeof raw['type'] === 'string' ? raw['type'] : '',
      timestamp: Date.now(),
      raw,
    };
  }
}

export class NHCHurricaneBridge extends MissionBridgeBase {
  readonly domain = 'weather';
  readonly feedId = 'nhc-hurricane';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const cat = typeof raw['category'] === 'number'
      ? raw['category']
      : Number(raw['category'] ?? 0);
    let severity: FeedSeverity;
    if (cat >= 5) {
      severity = 4;
    } else if (cat === 4) {
      severity = 3;
    } else if (cat === 3) {
      severity = 2;
    } else if (cat === 1 || cat === 2) {
      severity = 1;
    } else {
      severity = 0;
    }
    return {
      id: typeof raw['id'] === 'string' ? raw['id'] : String(raw['id'] ?? ''),
      severity,
      description: `Category ${isNaN(cat) ? 0 : cat} hurricane`,
      timestamp: Date.now(),
      raw,
    };
  }
}

export class NIFCWildfireBridge extends MissionBridgeBase {
  readonly domain = 'weather';
  readonly feedId = 'nifc-wildfire';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const pct = typeof raw['containmentPct'] === 'number' ? raw['containmentPct'] : 100;
    let severity: FeedSeverity;
    if (pct === 0) {
      severity = 4;
    } else if (pct < 25) {
      severity = 3;
    } else if (pct < 75) {
      severity = 2;
    } else if (pct < 100) {
      severity = 1;
    } else {
      severity = 0;
    }
    return {
      id: typeof raw['id'] === 'string' ? raw['id'] : String(raw['id'] ?? ''),
      severity,
      description: `Wildfire ${pct}% contained`,
      timestamp: Date.now(),
      raw,
    };
  }
}

getMissionBridgeRegistry().register(new NWSAlertsBridge());
getMissionBridgeRegistry().register(new NHCHurricaneBridge());
getMissionBridgeRegistry().register(new NIFCWildfireBridge());
