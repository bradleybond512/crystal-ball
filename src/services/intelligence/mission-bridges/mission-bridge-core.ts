/**
 * MissionBridgeBase + MissionBridgeRegistry.
 *
 * Pure module — no DOM, no fetch. Concrete bridges extend
 * MissionBridgeBase and self-register at module load via
 * getMissionBridgeRegistry().register(...).
 */

export type FeedSeverity = 0 | 1 | 2 | 3 | 4;

export interface NormalizedFeedEvent {
  id: string;
  severity: FeedSeverity;
  description: string;
  timestamp: number;
  raw: Record<string, unknown>;
}

export abstract class MissionBridgeBase {
  abstract readonly domain: string;
  abstract readonly feedId: string;
  abstract normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null;
}

export class MissionBridgeRegistry {
  private readonly bridges = new Map<string, MissionBridgeBase>();

  register(bridge: MissionBridgeBase): void {
    this.bridges.set(`${bridge.domain}:${bridge.feedId}`, bridge);
  }

  get(domain: string, feedId: string): MissionBridgeBase | undefined {
    return this.bridges.get(`${domain}:${feedId}`);
  }

  has(domain: string, feedId: string): boolean {
    return this.bridges.has(`${domain}:${feedId}`);
  }

  all(): MissionBridgeBase[] {
    return [...this.bridges.values()];
  }

  getByDomain(domain: string): MissionBridgeBase[] {
    return [...this.bridges.values()].filter(b => b.domain === domain);
  }
}

let _registry: MissionBridgeRegistry | null = null;

export function getMissionBridgeRegistry(): MissionBridgeRegistry {
  _registry ??= new MissionBridgeRegistry();
  return _registry;
}

export function __resetMissionBridgeRegistry(): void {
  _registry = null;
}
