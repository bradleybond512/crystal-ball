/**
 * STIX/TAXII Feed Manager Panel
 *
 * Manages TAXII threat intelligence feed subscriptions and displays
 * ingested STIX 2.1 objects with type breakdown and search.
 */

import { Panel } from './Panel';
import {
  getFeeds,
  getFeedStats,
  getStixObjects,
  getObjectTypeBreakdown,
  type TaxiiFeed,
  type StixObject,
} from '@/services/stix-taxii';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const FEED_STATUS_ICONS: Record<string, string> = {
  active: '\uD83D\uDFE2',
  paused: '\u23F8\uFE0F',
  error: '\uD83D\uDD34',
};

const STIX_TYPE_ICONS: Record<string, string> = {
  indicator: '\uD83D\uDEA9', // 🚩
  'threat-actor': '\uD83D\uDC64',  // 👤
  malware: '\uD83E\uDDA0', // 🦠
  'attack-pattern': '\u2694\uFE0F', // ⚔️
  vulnerability: '\uD83D\uDEE1\uFE0F', // 🛡️
  campaign: '\uD83C\uDFAF', // 🎯
  identity: '\uD83C\uDFAD', // 🎭
  tool: '\uD83D\uDD27', // 🔧
  relationship: '\uD83D\uDD17', // 🔗
};

export class StixTaxiiPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'stix-taxii',
 title: 'STIX/TAXII Feeds',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'STIX/TAXII threat intelligence feed manager. Subscribe to TAXII servers, ingest STIX 2.1 bundles, and browse threat actors, indicators, malware, and attack patterns from standardized feeds.',
 });
 this.showLoading('Loading threat intel feeds\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 3 * 60 * 1000);
  }

  private render(): void {
 const stats = getFeedStats();
 const feeds = getFeeds();
 const typeBreakdown = getObjectTypeBreakdown();

 this.setCount(stats.totalObjects);

 if (feeds.length === 0) {
 this.setContent(`
 <div class="panel-empty">
 No TAXII feeds configured. Add STIX/TAXII threat intelligence feed subscriptions to ingest standardized threat data (indicators, threat actors, malware, attack patterns).
 </div>
 `);
 return;
 }

 const statsHtml = `<div class="stix-stats">
 <span>\uD83D\uDCE1 ${stats.totalFeeds} feeds (${stats.activeFeeds} active)</span>
 <span class="stix-sep">\u2502</span>
 <span>\uD83D\uDCCA ${stats.totalObjects} objects</span>
 </div>`;

 const typeChips = [...typeBreakdown.entries()]
 .sort(([, a], [, b]) => b - a)
 .map(([type, count]) => {
 const icon = STIX_TYPE_ICONS[type] ?? '\uD83D\uDCC4';
 return `<span class="stix-type-chip">${icon} ${type}: ${count}</span>`;
 }).join('');

 const feedCards = feeds.map(f => this.renderFeed(f)).join('');

 const objects = getStixObjects({ limit: 15 });
 const objectList = objects.length > 0 ? `
 <div class="stix-section-title">RECENT OBJECTS</div>
 <div class="stix-objects">${objects.map(o => this.renderObject(o)).join('')}</div>
 ` : '';

 this.setContent(`
 <div style="padding:8px 12px;">
 ${statsHtml}
 ${typeChips ? `<div class="stix-type-breakdown">${typeChips}</div>` : ''}
 <div class="stix-section-title">FEEDS</div>
 <div class="stix-feeds">${feedCards}</div>
 ${objectList}
 </div>
 `);
  }

  private renderFeed(f: TaxiiFeed): string {
 const icon = FEED_STATUS_ICONS[f.status] ?? '\u2753';
 const name = escapeHtml(f.name);
 const lastPoll = f.lastPoll ? formatTime(new Date(f.lastPoll)) : 'never';
 const error = f.errorMessage ? `<div class="stix-feed-error">${escapeHtml(f.errorMessage)}</div>` : '';

 return `<div class="stix-feed-card">
 <div class="stix-feed-header">
 <span>${icon}</span>
 <span class="stix-feed-name">${name}</span>
 <span class="stix-feed-count">${f.objectCount} objects</span>
 </div>
 <div class="stix-feed-meta">Last poll: ${lastPoll}</div>
 ${error}
 </div>`;
  }

  private renderObject(o: StixObject): string {
 const icon = STIX_TYPE_ICONS[o.type] ?? '\uD83D\uDCC4';
 const name = escapeHtml(o.name ?? o.id);
 const desc = o.description
 ? escapeHtml(o.description.length > 80 ? o.description.slice(0, 77) + '\u2026' : o.description)
 : '';
 const src = escapeHtml(o.source);
 const conf = o.confidence != null ? `${o.confidence}%` : '';

 return `<div class="stix-object-row">
 <span>${icon}</span>
 <span class="stix-obj-type">${o.type}</span>
 <span class="stix-obj-name">${name}</span>
 ${conf ? `<span class="stix-obj-conf">${conf}</span>` : ''}
 <span class="stix-obj-source">${src}</span>
 ${desc ? `<div class="stix-obj-desc">${desc}</div>` : ''}
 </div>`;
  }

  public override destroy(): void {
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }
}
