import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { HibpBreach, TorMetrics } from '@/services/osint/dark-web';

const SECTION_HEADING_STYLE = 'font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;margin:10px 0 6px;';

export class DarkWebPanel extends Panel {
  constructor() {
 super({
 id: 'dark-web',
 title: 'Dark Web',
 showCount: true,
 infoTooltip: 'HaveIBeenPwned recent breach timeline and Tor network relay statistics.',
 });
 this.showLoading('Loading dark web intelligence...');
  }

  public update(data: { breaches: HibpBreach[]; tor: TorMetrics | null }): void {
 const { breaches, tor } = data;

 this.setCount(breaches.length);

 this.setContent(`<div style="padding:12px;">
 ${this.renderBreaches(breaches)}
 ${this.renderTor(tor)}
 </div>`);
  }

  private renderBreaches(breaches: HibpBreach[]): string {
 const heading = `<h4 style="${SECTION_HEADING_STYLE}">Recent Breaches</h4>`;

 const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
 const recent = breaches.filter(b => {
 if (!b.breachDate) return false;
 return new Date(b.breachDate).getTime() >= thirtyDaysAgo;
 });

 const totalPwned = recent.reduce((sum, b) => sum + (b.pwnCount ?? 0), 0);

 const summary = `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">
 ${totalPwned.toLocaleString()} accounts exposed in last 30 days
 </div>`;

 const top = [...breaches]
 .sort((a, b) => {
 const da = a.breachDate ? new Date(a.breachDate).getTime() : 0;
 const db = b.breachDate ? new Date(b.breachDate).getTime() : 0;
 return db - da;
 })
 .slice(0, 10);

 if (top.length === 0) {
 return heading + summary + `<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">No recent breaches found</div>`;
 }

 const items = top.map(b => {
 const name = b.name ?? b.title ?? '—';
 const date = b.breachDate ?? '—';
 const count = b.pwnCount != null ? b.pwnCount.toLocaleString() : '—';
 return `<div style="padding:3px 0;border-bottom:1px solid var(--border-subtle);font-size:11px;display:flex;gap:6px;align-items:baseline;">
 <span style="color:var(--text-primary);flex:1;">${escapeHtml(name)}</span>
 <span style="color:var(--text-muted);">${escapeHtml(date)}</span>
 <span style="color:var(--text-secondary);">${escapeHtml(count)}</span>
 </div>`;
 }).join('');

 return `${heading}${summary}<div style="margin-bottom:8px;">${items}</div>`;
  }

  private renderTor(tor: TorMetrics | null): string {
 const heading = `<h4 style="${SECTION_HEADING_STYLE}">Tor Network</h4>`;

 if (!tor) {
 return heading + `<div style="font-size:11px;color:var(--text-muted);">Tor metrics unavailable</div>`;
 }

 const stats = `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">
 <span>${tor.totalRelays.toLocaleString()} total relays</span> · <span>${tor.exitNodes.toLocaleString()} exit nodes</span>
 </div>`;

 const topCountries = Object.entries(tor.byCountry)
 .sort(([, a], [, b]) => b - a)
 .slice(0, 5);

 const maxCount = topCountries[0]?.[1] ?? 1;

 const countryRows = topCountries.map(([code, count]) => {
 const pct = Math.round((count / maxCount) * 100);
 return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;">
 <span style="width:24px;font-size:11px;color:var(--text-primary);">${escapeHtml(code)}</span>
 <div style="flex:1;height:4px;background:var(--bg-tertiary);border-radius:2px;overflow:hidden;">
 <div style="width:${pct}%;height:100%;background:var(--accent-primary);border-radius:2px;"></div>
 </div>
 <span style="width:36px;text-align:right;font-size:11px;color:var(--text-secondary);">${count.toLocaleString()}</span>
 </div>`;
 }).join('');

 return `${heading}${stats}<div>${countryRows}</div>`;
  }
}
