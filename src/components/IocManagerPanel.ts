/**
 * Indicator of Compromise (IOC) Manager Panel
 *
 * Centralized IOC management workspace. Track, search, and export
 * indicators across multiple threat intelligence feeds.
 *
 * Inspired by Palantir Gotham IOC workspace.
 */

import { Panel } from './Panel';
import { getIocs, getIocStats, type IocEntry } from '@/services/ioc-manager';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const TYPE_ICONS: Record<string, string> = {
  ip: '\uD83C\uDF10', // 🌐
  domain: '\uD83C\uDF10', // 🌐
  url: '\uD83D\uDD17', // 🔗
  hash_md5: '#\uFE0F\u20E3',
  hash_sha1: '#\uFE0F\u20E3',
  hash_sha256: '#\uFE0F\u20E3',
  email: '\u2709\uFE0F', // ✉️
  cve: '\uD83D\uDEE1\uFE0F', // 🛡️
  mutex: '\uD83D\uDD12', // 🔒
  registry_key: '\uD83D\uDCDD', // 📝
};

const TLP_COLORS: Record<string, string> = {
  white: '#f7f7f7',
  green: '#38a169',
  amber: '#ed8936',
  red: '#e53e3e',
};

export class IocManagerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'ioc-manager',
 title: 'IOC Manager',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Centralized Indicator of Compromise management. Aggregates IOCs (IPs, domains, hashes, CVEs) from threat intel feeds with confidence scoring, TLP classification, and STIX export capability.',
 });
 this.showLoading('Loading IOC database\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 2 * 60 * 1000);
  }

  private render(): void {
 const stats = getIocStats();
 const iocs = getIocs({ limit: 30 });

 this.setCount(stats.totalIocs);

 if (stats.totalIocs === 0) {
 this.setContent(`
 <div class="panel-empty">
 No indicators of compromise tracked. IOCs will be populated as threat intelligence feeds report indicators (IPs, domains, hashes, CVEs).
 </div>
 `);
 return;
 }

 const statsHtml = `<div class="ioc-stats">
 <span>\uD83D\uDCCA ${stats.totalIocs} IOCs</span>
 <span class="ioc-sep">\u2502</span>
 <span>\uD83C\uDD95 ${stats.recentlyAdded24h} new (24h)</span>
 <span class="ioc-sep">\u2502</span>
 <span>\u2705 ${stats.highConfidence} high-conf</span>
 </div>`;

 const typeBreakdown = Object.entries(stats.byType)
 .filter(([, count]) => count > 0)
 .map(([type, count]) => `<span class="ioc-type-chip">${type}: ${count}</span>`)
 .join('');

 const iocList = iocs.map(ioc => this.renderIoc(ioc)).join('');

 this.setContent(`
 <div style="padding:8px 12px;">
 ${statsHtml}
 <div class="ioc-type-breakdown">${typeBreakdown}</div>
 <div class="ioc-list">${iocList}</div>
 </div>
 `);
  }

  private renderIoc(ioc: IocEntry): string {
 const icon = TYPE_ICONS[ioc.type] ?? '\u2753';
 const tlpColor = TLP_COLORS[ioc.tlp] ?? '#888';
 const val = escapeHtml(ioc.value.length > 60 ? ioc.value.slice(0, 57) + '\u2026' : ioc.value);
 const src = escapeHtml(ioc.source);
 const time = formatTime(new Date(ioc.lastSeen));
 const tags = ioc.tags.slice(0, 3).map(t => `<span class="ioc-tag">${escapeHtml(t)}</span>`).join('');

 return `<div class="ioc-card">
 <div class="ioc-card-header">
 <span>${icon}</span>
 <span class="ioc-value">${val}</span>
 <span class="ioc-tlp" style="background:${tlpColor}">TLP:${ioc.tlp.toUpperCase()}</span>
 </div>
 <div class="ioc-card-meta">
 <span class="ioc-conf">${ioc.confidence}% conf</span>
 <span class="ioc-sightings">${ioc.sightings} sighting${ioc.sightings !== 1 ? 's' : ''}</span>
 <span class="ioc-source">${src}</span>
 <span class="ioc-time">${time}</span>
 </div>
 ${tags ? `<div class="ioc-tags">${tags}</div>` : ''}
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
