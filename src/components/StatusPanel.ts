import { SITE_VARIANT } from '@/config';
import { h } from '@/utils/dom-utils'; // kept for Panel base class compat

export type StatusLevel = 'ok' | 'warning' | 'error' | 'disabled';

export interface FeedStatus {
  name: string;
  lastUpdate: Date | null;
  status: StatusLevel;
  itemCount: number;
  errorMessage?: string;
}

export interface ApiStatus {
  name: string;
  status: StatusLevel;
  latency?: number;
}

// Allowlists for each variant
const TECH_FEEDS = new Set([
  'Tech', 'Ai', 'Startups', 'Vcblogs', 'RegionalStartups',
  'Unicorns', 'Accelerators', 'Security', 'Policy', 'Layoffs',
  'Finance', 'Hardware', 'Cloud', 'Dev', 'Tech Events', 'Crypto',
  'Markets', 'Events', 'Producthunt', 'Funding', 'Polymarket',
  'Cyber Threats'
]);
const TECH_APIS = new Set([
  'RSS Proxy', 'Finnhub', 'CoinGecko', 'Tech Events API', 'Service Status', 'Polymarket',
  'Cyber Threats API'
]);

const WORLD_FEEDS = new Set([
  'Politics', 'Middleeast', 'Tech', 'Ai', 'Finance',
  'Gov', 'Intel', 'Layoffs', 'Thinktanks', 'Energy',
  'Polymarket', 'Weather', 'NetBlocks', 'Shipping', 'Military',
  'Cyber Threats', 'GPS Jam'
]);
const WORLD_APIS = new Set([
  'RSS2JSON', 'Finnhub', 'CoinGecko', 'Polymarket', 'USGS', 'FRED',
  'AISStream', 'GDELT Doc', 'EIA', 'USASpending', 'PizzINT', 'FIRMS',
  'Cyber Threats API', 'BIS', 'WTO', 'SupplyChain'
]);

/**
 * Human display names for feed keys whose canonical id doesn't read well.
 * Keys stay untouched — the allowlists above, updateFeed(name) callers and
 * all source logic keep using the canonical key; this map is applied at
 * render time only.
 */
export const FEED_DISPLAY_NAMES: Record<string, string> = {
  Middleeast: 'Middle East',
  Ai: 'AI',
  Vcblogs: 'VC Blogs',
  RegionalStartups: 'Regional Startups',
  Producthunt: 'Product Hunt',
  Thinktanks: 'Think Tanks',
};

export function feedDisplayName(key: string): string {
  return FEED_DISPLAY_NAMES[key] ?? key;
}

import { t } from '../services/i18n';
import { Panel } from './Panel';

export class StatusPanel extends Panel {
  private feeds = new Map<string, FeedStatus>();
  private apis = new Map<string, ApiStatus>();
  private allowedFeeds!: Set<string>;
  private allowedApis!: Set<string>;
  public onUpdate: (() => void) | null = null;

  constructor() {
 super({ id: 'status', title: t('panels.status') });
 this.init();
  }

  private init(): void {
 this.allowedFeeds = SITE_VARIANT === 'tech' ? TECH_FEEDS : WORLD_FEEDS;
 this.allowedApis = SITE_VARIANT === 'tech' ? TECH_APIS : WORLD_APIS;

 this.element = h('div', { className: 'status-panel-container' });
 this.initDefaultStatuses();
  }

  private initDefaultStatuses(): void {
 this.allowedFeeds.forEach(name => {
 this.feeds.set(name, { name, lastUpdate: null, status: 'disabled', itemCount: 0 });
 });
 this.allowedApis.forEach(name => {
 this.apis.set(name, { name, status: 'disabled' });
 });
  }

  public getFeeds(): Map<string, FeedStatus> { return this.feeds; }
  public getApis(): Map<string, ApiStatus> { return this.apis; }

  public updateFeed(name: string, status: Partial<FeedStatus>): void {
 if (!this.allowedFeeds.has(name)) return;
 const existing = this.feeds.get(name) ?? { name, lastUpdate: null, status: 'ok' as const, itemCount: 0 };
 this.feeds.set(name, { ...existing, ...status, lastUpdate: new Date() });
 this.onUpdate?.();
  }

  public updateApi(name: string, status: Partial<ApiStatus>): void {
 if (!this.allowedApis.has(name)) return;
 const existing = this.apis.get(name) ?? { name, status: 'ok' as const };
 this.apis.set(name, { ...existing, ...status });
 this.onUpdate?.();
  }

  public setFeedDisabled(name: string): void {
 const existing = this.feeds.get(name);
 if (existing) {
 this.feeds.set(name, { ...existing, status: 'disabled', itemCount: 0, lastUpdate: null });
 this.onUpdate?.();
 }
  }

  public setApiDisabled(name: string): void {
 const existing = this.apis.get(name);
 if (existing) {
 this.apis.set(name, { ...existing, status: 'disabled' });
 this.onUpdate?.();
 }
  }

  public formatTime(date: Date): string {
 const now = Date.now();
 const diff = now - date.getTime();
 if (diff < 60_000) return 'just now';
 if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
 const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
 // A bare clock time implies "today". Once the timestamp is from a
 // different calendar day (or >24h old), prepend the date so days-old
 // data can never masquerade as fresh: "Jun 30 · 10:30 PM".
 const sameCalendarDay = new Date(now).toDateString() === date.toDateString();
 if (diff < 86_400_000 && sameCalendarDay) return time;
 const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
 return `${day} · ${time}`;
  }

  public getElement(): HTMLElement {
 return this.element;
  }
}
