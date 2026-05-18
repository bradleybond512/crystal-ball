/**
 * Feed Watchdog Panel — health overview (counts by status), per-feed
 * rows sorted by status severity, and a recent-alerts feed with
 * per-row Acknowledge buttons.
 *
 * Vanilla TS — subscribes to the service for push-driven refresh and
 * also falls back to a 10s timer.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getFeedWatchdogService,
  type FeedHealth,
  type FeedStatus,
  type WatchdogAlert,
  type WatchdogAlertType,
  type WatchdogSummary,
} from '@/services/intelligence/feed-watchdog';

const REFRESH_MS = 10_000;
const RECENT_ALERT_LIMIT = 30;

const STATUS_COLOR: Record<FeedStatus, string> = {
  healthy: 'var(--severity-info,#22c55e)',
  degraded: 'var(--severity-medium,#facc15)',
  stale: 'var(--severity-high,#f87171)',
  offline: 'var(--severity-critical,#dc2626)',
};

const ALERT_COLOR: Record<WatchdogAlertType, string> = {
  'went-stale': 'var(--severity-high,#f87171)',
  'went-offline': 'var(--severity-critical,#dc2626)',
  'error-spike': 'var(--severity-medium,#facc15)',
  recovered: 'var(--severity-info,#22c55e)',
};

const ALERT_LABEL: Record<WatchdogAlertType, string> = {
  'went-stale': 'STALE',
  'went-offline': 'OFFLINE',
  'error-spike': 'ERR-SPIKE',
  recovered: 'RECOVERED',
};

export class FeedWatchdogPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'feed-watchdog',
      title: 'Feed Watchdog',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Watches active data feeds for staleness, error rates, and quality degradation. Fires alerts on transitions across healthy / degraded / stale / offline.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.tickAndRender(), REFRESH_MS);
    this.unsubscribe = getFeedWatchdogService().subscribe(() => this.render());
    this.attachHandlers();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }

  // ── Rendering ──────────────────────────────────────────────────────

  private tickAndRender(): void {
    try {
      getFeedWatchdogService().tick();
    } catch { /* tolerate transient errors */ }
    this.render();
  }

  private render(): void {
    try {
      const svc = getFeedWatchdogService();
      const summary = svc.getSummary();
      const feeds = svc.getHealth();
      const alerts = svc.getAlerts({}, RECENT_ALERT_LIMIT);
      this.setCount(summary.unacknowledgedAlerts);
      this.setContent(this.buildHtml(summary, feeds, alerts));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Feed watchdog render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(summary: WatchdogSummary, feeds: readonly FeedHealth[], alerts: readonly WatchdogAlert[]): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;font-size:12px;">
      ${this.renderSummary(summary)}
      ${this.renderFeeds(feeds)}
      ${this.renderAlerts(alerts)}
    </div>`;
  }

  private renderSummary(s: WatchdogSummary): string {
    return `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;font-size:11px;color:var(--text-secondary,#aaa);">
      <span><strong style="color:var(--text-primary,#fff);font-size:14px;">${s.total}</strong> feeds</span>
      <span><strong style="color:var(--severity-high,#f87171);font-size:14px;">${s.unacknowledgedAlerts}</strong> unack alerts</span>
      <span style="margin-left:auto;display:flex;gap:8px;">
        ${this.renderStatusSwatch('healthy', s.healthy)}
        ${this.renderStatusSwatch('degraded', s.degraded)}
        ${this.renderStatusSwatch('stale', s.stale)}
        ${this.renderStatusSwatch('offline', s.offline)}
      </span>
    </div>`;
  }

  private renderStatusSwatch(status: FeedStatus, count: number): string {
    const color = STATUS_COLOR[status];
    return `<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:4px;"></span>${count} ${escapeHtml(status)}</span>`;
  }

  private renderFeeds(feeds: readonly FeedHealth[]): string {
    if (feeds.length === 0) {
      return `<div style="padding:14px;text-align:center;font-size:12px;color:var(--text-secondary,#aaa);border-top:1px solid var(--border-subtle,#333);">No feeds registered.</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;max-height:280px;overflow-y:auto;">
      ${feeds.map((f) => this.renderFeedRow(f)).join('')}
    </div>`;
  }

  private renderFeedRow(f: FeedHealth): string {
    const color = STATUS_COLOR[f.status];
    const age = relativeAge(this.clockNow() - f.lastSeenAt);
    const errorRatePct = errorRatePercent(f);
    return `<div style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:rgba(255,255,255,0.02);">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${color}22;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(f.status)}</span>
        <strong style="font-size:12px;">${escapeHtml(f.feedId)}</strong>
        <span style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(f.domain)}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--text-secondary,#aaa);">last seen <strong style="color:var(--text-primary,#fff);">${escapeHtml(age)}</strong></span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">
        ${f.successCount} ok · ${f.errorCount} err (${errorRatePct}%) · ${f.consecutiveFailures} consec-fail · expected every ${formatInterval(f.expectedIntervalMs)}
      </div>
    </div>`;
  }

  private renderAlerts(alerts: readonly WatchdogAlert[]): string {
    if (alerts.length === 0) {
      return `<div style="padding:12px;text-align:center;font-size:11px;color:var(--text-secondary,#aaa);border-top:1px solid var(--border-subtle,#333);">No recent alerts.</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;max-height:240px;overflow-y:auto;">
      ${alerts.map((a) => this.renderAlertRow(a)).join('')}
    </div>`;
  }

  private renderAlertRow(a: WatchdogAlert): string {
    const color = ALERT_COLOR[a.alertType];
    const label = ALERT_LABEL[a.alertType];
    const ack = a.acknowledged
      ? `<span style="font-size:10px;color:var(--severity-info,#22c55e);text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">ACK</span>`
      : `<button class="fwd-ack" data-id="${escapeHtml(a.id)}" style="padding:2px 8px;font-size:10px;border:1px solid var(--border-subtle,#333);background:rgba(34,197,94,0.10);color:#22c55e;border-radius:3px;cursor:pointer;">Ack</button>`;
    const when = new Date(a.detectedAt).toLocaleTimeString();
    return `<div style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:rgba(255,255,255,0.02);${a.acknowledged ? 'opacity:0.55;' : ''}">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${color}22;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(label)}</span>
        <strong style="font-size:12px;">${escapeHtml(a.feedId)}</strong>
        <span style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(a.domain)}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(when)}</span>
        ${ack}
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(a.message)}</div>
    </div>`;
  }

  // ── Events ────────────────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const ack = target.closest<HTMLElement>('.fwd-ack');
    if (!ack) return;
    event.stopPropagation();
    const id = ack.dataset.id;
    if (id) {
      getFeedWatchdogService().acknowledge(id);
      this.render();
    }
  }

  private clockNow(): number {
    return Date.now();
  }
}

function errorRatePercent(f: FeedHealth): string {
  const total = f.successCount + f.errorCount;
  if (total === 0) return '0';
  return ((f.errorCount / total) * 100).toFixed(0);
}

function formatInterval(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

function relativeAge(deltaMs: number): string {
  if (deltaMs < 0) return 'in the future';
  if (deltaMs < 1000) return 'just now';
  if (deltaMs < 60_000) return `${Math.round(deltaMs / 1000)}s ago`;
  if (deltaMs < 3_600_000) return `${Math.round(deltaMs / 60_000)}m ago`;
  if (deltaMs < 86_400_000) return `${Math.round(deltaMs / 3_600_000)}h ago`;
  return `${Math.round(deltaMs / 86_400_000)}d ago`;
}
