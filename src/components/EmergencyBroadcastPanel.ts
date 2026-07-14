/**
 * Emergency Broadcast Panel
 *
 * Monitors CAP-style emergency alerts from multiple agencies. Displays
 * broadcast statistics, extreme alerts, and active broadcasts.
 */

import { Panel } from './Panel';
import {
  getActiveBroadcasts,
  getBroadcastStats,
  getExtremeAlerts,
  type BroadcastCategory,
} from '@/services/emergency-broadcast';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const CATEGORY_ICONS: Record<BroadcastCategory, string> = {
  geo: '\uD83C\uDF0B',
  met: '\u26C8\uFE0F',
  safety: '\uD83D\uDEA8',
  security: '\uD83D\uDD12',
  rescue: '\uD83D\uDE91',
  fire: '\uD83D\uDD25',
  health: '\uD83C\uDFE5',
  env: '\uD83C\uDF0D',
  transport: '\uD83D\uDE82',
  infra: '\uD83C\uDFD7\uFE0F',
  cbrne: '\u2622\uFE0F',
  other: '\u2139\uFE0F',
};

const SEVERITY_COLORS: Record<string, string> = {
  extreme: '#b71c1c',
  severe: '#ff453a',
  moderate: '#ff9800',
  minor: '#ffc107',
  unknown: '#9e9e9e',
};

export class EmergencyBroadcastPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'emergency-broadcast',
 title: 'Emergency Broadcasts',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'CAP-style emergency alert monitoring — aggregates alerts from weather services, civil agencies, and hazard systems worldwide.',
 });
 this.showLoading('Scanning broadcasts\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 30_000);
  }

  private render(): void {
 const broadcasts = getActiveBroadcasts();
 const stats = getBroadcastStats();
 const extreme = getExtremeAlerts();

 this.setCount(stats.totalActive);

 const statsHtml = `<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-subtle,#333);">
 <div style="text-align:center;flex:1;"><span style="font-size:18px;font-weight:700;">${stats.totalActive}</span><br><span style="font-size:10px;color:var(--text-muted,#888);">Active</span></div>
 <div style="text-align:center;flex:1;"><span style="font-size:18px;font-weight:700;color:#b71c1c;">${stats.extremeCount}</span><br><span style="font-size:10px;color:var(--text-muted,#888);">Extreme</span></div>
 </div>`;

 const extremeHtml = extreme.length > 0 ? `
 <div style="margin-top:8px;">
 <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;color:#b71c1c;">Extreme Alerts</div>
 ${extreme.slice(0, 5).map(a => {
 const icon = CATEGORY_ICONS[a.category] ?? CATEGORY_ICONS.other;
 return `<div style="border-left:3px solid #b71c1c;padding:6px 8px;margin-bottom:6px;background:rgba(183,28,28,0.1);border-radius:0 4px 4px 0;">
 <div style="font-size:12px;font-weight:600;">${icon} ${escapeHtml(a.headline)}</div>
 <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${escapeHtml(a.agency)} \u2022 ${escapeHtml(a.areaDesc)} \u2022 ${formatTime(new Date(a.effective))}</div>
 </div>`;
 }).join('')}
 </div>
 ` : '';

 const listHtml = broadcasts.length > 0 ? `
 <div style="margin-top:8px;">
 <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Active Broadcasts</div>
 ${broadcasts.slice(0, 20).map(b => {
 const icon = CATEGORY_ICONS[b.category] ?? CATEGORY_ICONS.other;
 const sevColor = SEVERITY_COLORS[b.severity] ?? '#9e9e9e';
 return `<div style="border-left:3px solid ${sevColor};padding:4px 8px;margin-bottom:4px;border-radius:0 4px 4px 0;">
 <div style="font-size:11px;font-weight:600;">${icon} ${escapeHtml(b.headline)}</div>
 <div style="display:flex;gap:4px;margin-top:2px;">
 <span style="font-size:9px;padding:1px 4px;border-radius:2px;background:${sevColor};color:#fff;">${escapeHtml(b.severity.toUpperCase())}</span>
 <span style="font-size:9px;padding:1px 4px;border-radius:2px;background:var(--bg-tertiary,#222);">${escapeHtml(b.urgency)}</span>
 </div>
 <div style="font-size:10px;color:var(--text-muted,#888);margin-top:2px;">${escapeHtml(b.agency)} \u2022 ${escapeHtml(b.areaDesc)}</div>
 </div>`;
 }).join('')}
 </div>
 ` : '<div class="panel-empty">No active broadcasts.</div>';

 this.setContent(`<div style="padding:8px 12px;">${statsHtml}${extremeHtml}${listHtml}</div>`);
  }

  public override destroy(): void {
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }
}
