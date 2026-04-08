import { Panel } from './Panel';
import type { SpaceLaunch } from '@/services/space-launches';
import { launchSeverityClass, launchCategoryLabel } from '@/services/space-launches';
import { escapeHtml } from '@/utils/sanitize';

export class SpaceLaunchesPanel extends Panel {
  private launches: SpaceLaunch[] = [];
  private lastUpdated: Date | null = null;

  constructor() {
 super({
 id: 'space-launches',
 title: 'Space Launches',
 showCount: true,
 trackActivity: false,
 infoTooltip: 'Upcoming space launches in the next 30 days — Launch Library 2 API. Highlights adversary-nation launches.',
 });
 this.showLoading('Fetching launch schedule...');
  }

  public update(launches: SpaceLaunch[]): void {
 this.launches = launches;
 this.lastUpdated = new Date();
 this.setCount(launches.length);
 this.render();
  }

  private render(): void {
 if (this.launches.length === 0) {
 this.setContent('<div class="panel-empty">No upcoming launches in the next 30 days.</div>');
 return;
 }

 const rows = this.launches.map(l => {
 const cls = launchSeverityClass(l.severity);
 const cat = launchCategoryLabel(l.category);
 const net = formatDate(l.netTime);
 const prob = l.probability !== null ? `${l.probability}%` : '—';
 const adversaryBadge = l.isAdversary
 ? `<span class="sev-badge" style="background:rgba(220,50,50,0.25);color:#f87171">ADVERSARY</span> `
 : '';
 return `<tr class="${cls}">
 <td class="sl-net" style="white-space:nowrap;font-size:11px">${net}</td>
 <td class="sl-name">
 ${adversaryBadge}<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer"
 style="color:inherit;text-decoration:none;font-weight:600">${escapeHtml(l.name)}</a>
 <div style="opacity:0.55;font-size:10px">${escapeHtml(l.vehicle)} · ${escapeHtml(l.launchSite)}</div>
 </td>
 <td class="sl-cat" style="white-space:nowrap;font-size:11px">${cat}</td>
 <td class="sl-prob" style="text-align:right;font-size:11px">${prob}</td>
 </tr>`;
 }).join('');

 const updatedStr = this.lastUpdated ? timeAgo(this.lastUpdated) : 'never';

 this.setContent(`
 <div class="sl-panel-content">
 <table class="eq-table">
 <thead>
 <tr>
 <th>NET</th>
 <th>Launch</th>
 <th>Type</th>
 <th style="text-align:right">P(go)</th>
 </tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer">
 <span class="fires-source">Launch Library 2 API</span>
 <span class="fires-updated">Updated ${updatedStr}</span>
 </div>
 </div>
 `);
  }
}

function formatDate(d: Date): string {
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const mo = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const prefix = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : `${mo}/${day}`;
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  return `${prefix} ${hh}:${mm}Z`;
}

function timeAgo(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}
