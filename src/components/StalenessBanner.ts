/**
 * StalenessBanner — visual warning when data feeds are stale or offline.
 *
 * Checks data freshness every 60 seconds and renders a fixed banner at the
 * top of the viewport (below the titlebar, above panels).
 *
 * Banner states:
 * hidden — >80% of enabled sources are fresh
 * warn — 50-80% fresh, or any critical source stale >2h
 * critical — <50% fresh, or ALL sources stale >4h
 * offline  — navigator.onLine === false
 */

import {
  dataFreshness,
  getStatusColor,
  getStatusIcon,
  type FreshnessStatus,
} from '@/services/data-freshness';
import type { DataSourceState } from '@/services/data-freshness';
import { escapeHtml } from '@/utils/sanitize';

type BannerLevel = 'hidden' | 'warn' | 'critical' | 'offline';

const CHECK_INTERVAL_MS = 60_000;
const DISMISS_REAPPEAR_MS = 10 * 60 * 1000; // 10 minutes

let instance: StalenessBanner | null = null;

export class StalenessBanner {
  private el: HTMLElement;
  private detailsEl: HTMLElement;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private expanded = false;
  private dismissedAt: number | null = null;
  private dismissedLevel: BannerLevel = 'hidden';
  private currentLevel: BannerLevel = 'hidden';
  // Named bound references so they can be removed in destroy().
  private readonly _onOnline = (): void => { this.evaluate(); };
  private readonly _onOffline = (): void => { this.evaluate(); };

  private constructor(parent: HTMLElement = document.body) {
 this.el = document.createElement('div');
 this.el.className = 'staleness-banner staleness-banner-hidden';
 this.el.setAttribute('role', 'status');
 this.el.setAttribute('aria-live', 'polite');

 this.detailsEl = document.createElement('div');
 this.detailsEl.className = 'staleness-details';
 this.detailsEl.style.display = 'none';

 this.el.addEventListener('click', (e) => {
 const target = e.target as HTMLElement;
 if (target.closest('.staleness-dismiss')) {
 this.dismiss();
 return;
 }
 if (target.closest('.staleness-details')) return; // don't toggle when clicking table
 this.toggleDetails();
 });

 // Both banner and its collapsible details flow inside the same parent so
 // the NotificationStack ResizeObserver picks up the expanded height.
 parent.append(this.el);
 parent.append(this.detailsEl);

 // Named handlers stored on instance so destroy() can remove them.
 window.addEventListener('online', this._onOnline);
 window.addEventListener('offline', this._onOffline);

 // Subscribe to freshness changes (immediate re-evaluation)
 this.unsubscribe = dataFreshness.subscribe(() => this.evaluate());

 // Periodic check
 this.intervalId = setInterval(() => this.evaluate(), CHECK_INTERVAL_MS);

 // Initial evaluation
 this.evaluate();
  }

  static mount(parent?: HTMLElement): StalenessBanner {
 instance ??= new StalenessBanner(parent);
 return instance;
  }

  destroy(): void {
 if (this.intervalId) clearInterval(this.intervalId);
 if (this.unsubscribe) this.unsubscribe();
 window.removeEventListener('online', this._onOnline);
 window.removeEventListener('offline', this._onOffline);
 this.el.remove();
 this.detailsEl.remove();
 instance = null;
  }

  // ── evaluation ────────────────────────────────────────────

  private evaluate(): void {
 const level = this.computeLevel();
 this.currentLevel = level;

 // Check if dismissed and whether we should still honour the dismiss
 if (this.dismissedAt) {
 const elapsed = Date.now() - this.dismissedAt;
 const worsened =
 (this.dismissedLevel === 'warn' && (level === 'critical' || level === 'offline')) ||
 (this.dismissedLevel === 'critical' && level === 'offline');

 if (elapsed >= DISMISS_REAPPEAR_MS || worsened) {
 this.dismissedAt = null;
 } else {
 this.hide();
 return;
 }
 }

 this.render(level);
  }

  private computeLevel(): BannerLevel {
 if (!navigator.onLine) return 'offline';

 const sources = dataFreshness.getAllSources();
 const enabled = sources.filter((s) => s.enabled);
 if (enabled.length === 0) return 'hidden';

 const fresh = enabled.filter((s) => s.status === 'fresh');
 const freshPercent = (fresh.length / enabled.length) * 100;

 // Check critical-source staleness (requiredForRisk sources stale > 2h)
 const criticalSources = enabled.filter((s) => s.requiredForRisk);
 const anyCriticalStale2h = criticalSources.some((s) => {
 if (!s.lastUpdate) return s.status !== 'fresh' && s.status !== 'disabled';
 return Date.now() - s.lastUpdate.getTime() > 2 * 60 * 60 * 1000;
 });

 // All enabled sources stale > 4h
 const allStale4h = enabled.every((s) => {
 if (!s.lastUpdate) return true;
 return Date.now() - s.lastUpdate.getTime() > 4 * 60 * 60 * 1000;
 });

 if (freshPercent < 50 || allStale4h) return 'critical';
 if (freshPercent < 80 || anyCriticalStale2h) return 'warn';
 return 'hidden';
  }

  // ── rendering ─────────────────────────────────────────────

  private render(level: BannerLevel): void {
 if (level === 'hidden') {
 this.hide();
 return;
 }

 // OfflineStalenessBanner covers the same stale state with better UX —
 // suppress this banner when it's already visible to avoid redundancy.
 const osbActive = document.querySelector('.cb-offline-staleness-banner[data-status]');
 if (osbActive) {
 this.hide();
 return;
 }

 this.el.style.display = '';
 let levelClass: string;
 if (level === 'warn') levelClass = 'warn';
 else if (level === 'critical') levelClass = 'critical';
 else levelClass = 'offline';
 this.el.className = `staleness-banner staleness-banner-${levelClass}`;
 document.body.classList.add('has-staleness-banner');

 const summary = dataFreshness.getSummary();
 const timeText = this.formatOldestAge(summary.oldestUpdate);

 let message: string;
 switch (level) {
 case 'offline': {
 message = '<span class="staleness-pulse-dot"></span> OFFLINE — showing cached data. Connect to update.';
 break;
 }
 case 'critical': {
 message = `\u{1F534} Data feeds paused — viewing cached data from ${escapeHtml(timeText)}`;
 break;
 }
 case 'warn': {
 message = `\u26A0 Some data sources are stale — last update ${escapeHtml(timeText)}`;
 break;
 }
 default: {
 message = '';
 }
 }

 // safe-html: timeText comes from date formatting, message is built from constants
 this.el.innerHTML = `
 <div class="staleness-message">${message}</div>
 <button class="staleness-reset" aria-label="Reset cache and reload" title="Clear local cache + service worker, then reload">Reset cache</button>
 <button class="staleness-dismiss" aria-label="Dismiss staleness banner">\u00D7</button>
 `;
 // Recovery button: stuck-banner reports usually trace back to a stale
 // service-worker bundle from before a deploy that fixed the underlying
 // fetch failures. Unregister every SW + purge every cache + reload.
 const resetBtn = this.el.querySelector<HTMLButtonElement>('.staleness-reset');
 resetBtn?.addEventListener('click', () => {
 void (async () => {
 resetBtn.disabled = true;
 resetBtn.textContent = 'Clearing\u2026';
 try {
 const regs = await navigator.serviceWorker?.getRegistrations();
 await Promise.all((regs ?? []).map((r) => r.unregister()));
 const keys = await caches.keys();
 await Promise.all(keys.map((k) => caches.delete(k)));
 } catch { /* best-effort */ }
 location.reload();
 })();
 });

 // Update details if expanded
 if (this.expanded) {
 this.renderDetails();
 }
  }

  private hide(): void {
 this.el.style.display = 'none';
 this.detailsEl.style.display = 'none';
 this.expanded = false;
 document.body.classList.remove('has-staleness-banner');
  }

  private toggleDetails(): void {
 this.expanded = !this.expanded;
 if (this.expanded) {
 this.renderDetails();
 this.detailsEl.style.display = '';
 } else {
 this.detailsEl.style.display = 'none';
 }
  }

  private renderDetails(): void {
 const sources = dataFreshness.getAllSources()
 .filter((s) => s.enabled)
 .sort((a, b) => {
 const order: Record<FreshnessStatus, number> = {
 error: 0, very_stale: 1, stale: 2, no_data: 3, fresh: 4, disabled: 5,
 };
 return (order[a.status] ?? 5) - (order[b.status] ?? 5);
 });

 const rows = sources.map((s) => this.renderSourceRow(s)).join('');

 // safe-html: rows are built from escapeHtml'd source names and date formatting
 this.detailsEl.innerHTML = `
 <table class="staleness-details-table">
 <thead>
 <tr><th>Source</th><th>Last Update</th><th>Status</th></tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 `;
  }

  private renderSourceRow(s: DataSourceState): string {
 const icon = getStatusIcon(s.status);
 const color = getStatusColor(s.status);
 const lastUpdate = s.lastUpdate
 ? dataFreshness.getTimeSince(s.id)
 : 'never';

 return `<tr>
 <td>${escapeHtml(s.name)}</td>
 <td>${escapeHtml(lastUpdate)}</td>
 <td><span style="color:${escapeHtml(color)}">${escapeHtml(icon)}</span> ${escapeHtml(s.status)}</td>
 </tr>`;
  }

  private dismiss(): void {
 this.dismissedAt = Date.now();
 this.dismissedLevel = this.currentLevel;
 this.hide();
  }

  private formatOldestAge(oldest: Date | null): string {
 if (!oldest) return 'unknown';
 const ms = Date.now() - oldest.getTime();
 if (ms < 60_000) return 'just now';
 if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
 return `${Math.floor(ms / 3_600_000)} hours ago`;
  }
}
