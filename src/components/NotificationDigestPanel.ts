/**
 * Notification Digest Panel
 *
 * Displays AI-summarized alert digests grouped by source and priority.
 * Shows digest history timeline and allows frequency configuration.
 * Falls back to rule-based grouping when no AI provider is available.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getRecentDigests,
  subscribeDigest,
  generateDigest,
  getDigestFrequency,
  setDigestFrequency,
  getPendingCount,
  initNotificationDigest,
} from '@/services/notification-digest';
import type {
  NotificationDigest,
  DigestGroup,
  DigestFrequency,
  DigestPriority,
} from '@/services/notification-digest';

// ── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<DigestPriority, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#6b7280',
};

const PRIORITY_ICONS: Record<DigestPriority, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '⚪',
};

const FREQUENCY_LABELS: Record<DigestFrequency, string> = {
  '5m': '5 min',
  '15m': '15 min',
  '30m': '30 min',
  '1h': '1 hour',
};

// ── Panel ─────────────────────────────────────────────────────────────────────

export class NotificationDigestPanel extends Panel {
  private unsubscribe: (() => void) | null = null;
  private initialized = false;
  private pendingTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({ id: 'notification-digest', title: 'Notification Digest' });
 this.renderInitial();
  }

  private renderInitial(): void {
 this.content.innerHTML = `
 <div class="digest-panel" style="padding:12px;font-size:13px;color:var(--text-secondary);">
 <div class="digest-controls" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
 <div style="display:flex;align-items:center;gap:8px;">
 <label style="font-size:11px;color:var(--text-tertiary);">Frequency:</label>
 <select class="digest-freq-select" style="background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;padding:2px 6px;font-size:11px;">
 ${(Object.keys(FREQUENCY_LABELS) as DigestFrequency[]).map(f =>
 `<option value="${f}" ${f === getDigestFrequency() ? 'selected' : ''}>${FREQUENCY_LABELS[f]}</option>`
 ).join('')}
 </select>
 </div>
 <div style="display:flex;align-items:center;gap:8px;">
 <span class="digest-pending" style="font-size:11px;color:var(--text-tertiary);"></span>
 <button class="digest-generate-btn" style="background:var(--accent-color);color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;">Generate Now</button>
 </div>
 </div>
 <div class="digest-list"></div>
 </div>
 `;

 const select = this.content.querySelector('.digest-freq-select') as HTMLSelectElement;
 select?.addEventListener('change', () => {
 setDigestFrequency(select.value as DigestFrequency);
 });

 const btn = this.content.querySelector('.digest-generate-btn') as HTMLButtonElement;
 btn?.addEventListener('click', () => {
 btn.disabled = true;
 btn.textContent = 'Generating...';
 void generateDigest().then(() => {
 btn.disabled = false;
 btn.textContent = 'Generate Now';
 this.renderDigests();
 });
 });

 if (!this.initialized) {
 initNotificationDigest();
 this.initialized = true;
 }

 this.unsubscribe = subscribeDigest(() => {
 this.renderDigests();
 });

 this.renderDigests();
 this.updatePendingCount();
 this.pendingTimer = setInterval(() => this.updatePendingCount(), 10_000);
  }

  private updatePendingCount(): void {
 const el = this.content.querySelector('.digest-pending');
 if (el) {
 const count = getPendingCount();
 el.textContent = count > 0 ? `${count} pending` : '';
 }
  }

  private renderDigests(): void {
 const list = this.content.querySelector('.digest-list');
 if (!list) return;

 const digests = getRecentDigests(10);

 if (digests.length === 0) {
 list.innerHTML = `
 <div style="text-align:center;padding:24px;color:var(--text-tertiary);font-size:12px;">
 No digests yet. Alerts will be batched and summarized automatically.
 </div>
 `;
 return;
 }

 list.innerHTML = digests
 .reverse()
 .map(d => this.renderDigest(d))
 .join('');
  }

  private renderDigest(digest: NotificationDigest): string {
 const time = new Date(digest.generatedAt);
 const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
 const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' });

 return `
 <div class="digest-card" style="background:var(--bg-secondary);border-radius:8px;padding:10px 12px;margin-bottom:8px;border:1px solid var(--border-color);">
 <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
 <span style="font-weight:600;font-size:12px;color:var(--text-primary);">${this.esc(digest.headline)}</span>
 <span style="font-size:10px;color:var(--text-tertiary);white-space:nowrap;margin-left:8px;">${dateStr} ${timeStr}</span>
 </div>
 <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;">
 <span style="font-size:10px;background:var(--bg-tertiary);padding:1px 6px;border-radius:3px;color:var(--text-tertiary);">${digest.totalAlerts} alert${digest.totalAlerts !== 1 ? 's' : ''}</span>
 <span style="font-size:10px;background:var(--bg-tertiary);padding:1px 6px;border-radius:3px;color:var(--text-tertiary);">${digest.groups.length} group${digest.groups.length !== 1 ? 's' : ''}</span>
 <span style="font-size:10px;background:var(--bg-tertiary);padding:1px 6px;border-radius:3px;color:var(--text-tertiary);">via ${this.esc(digest.provider)}</span>
 </div>
 ${digest.groups.map(g => this.renderGroup(g)).join('')}
 </div>
 `;
  }

  private renderGroup(group: DigestGroup): string {
 const color = PRIORITY_COLORS[group.priority];
 const icon = PRIORITY_ICONS[group.priority];
 return `
 <div style="padding:4px 0;border-top:1px solid var(--border-color);">
 <div style="display:flex;align-items:center;gap:4px;">
 <span>${icon}</span>
 <span style="font-size:11px;font-weight:500;color:${color};">${this.esc(group.category)}</span>
 <span style="font-size:10px;color:var(--text-tertiary);">(${group.count})</span>
 </div>
 <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;padding-left:20px;">${this.esc(group.summary)}</div>
 </div>
 `;
  }

  private esc(str: string): string {
 return escapeHtml(str);
  }

  override destroy(): void {
 if (this.pendingTimer) {
 clearInterval(this.pendingTimer);
 this.pendingTimer = null;
 }
 if (this.unsubscribe) {
 this.unsubscribe();
 this.unsubscribe = null;
 }
 super.destroy();
  }
}
