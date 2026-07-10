import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  FeedHealthTracker,
  STALE_WARN_MS,
  STALE_CRIT_MS,
  type FeedRecord,
  type ErrorLogEntry,
} from '@/services/intelligence/feed-health-tracker';
export { formatAge } from './feed-health-dashboard-helpers';
import { formatAge } from './feed-health-dashboard-helpers';

const REFRESH_MS = 10_000;

const STATUS_COLOR: Record<FeedRecord['status'], string> = {
  ok: '#4caf50',
  stale: '#ff9800',
  error: '#f44336',
  offline: '#9e9e9e',
};

const STATUS_LABEL: Record<FeedRecord['status'], string> = {
  ok: 'OK',
  stale: 'STALE',
  error: 'ERROR',
  offline: 'OFFLINE',
};

export class FeedHealthDashboardPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'feed-health-dashboard',
      title: 'Feed Health Dashboard',
      showCount: true,
      trackActivity: true,
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  override destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private render(): void {
    const tracker = FeedHealthTracker.getInstance();
    const records = tracker.getAll();
    const errorLog = tracker.getErrorLog().slice(0, 10);
    const healthScore = tracker.getHealthScore();
    const now = Date.now();
    const staleWarnIds = new Set(tracker.getStaleFeedIds(STALE_WARN_MS, now));
    const staleCritIds = new Set(tracker.getStaleFeedIds(STALE_CRIT_MS, now));

    this.setCount(records.filter(r => r.status !== 'ok').length);
    this.setContent(this.buildHtml(records, errorLog, healthScore, staleWarnIds, staleCritIds, now));
  }

  private buildHtml(
    records: FeedRecord[],
    errorLog: ErrorLogEntry[],
    healthScore: number,
    staleWarnIds: Set<string>,
    staleCritIds: Set<string>,
    now: number,
  ): string {
    const total = records.length;
    const okCount = records.filter(r => r.status === 'ok').length;
    const degradedCount = records.filter(r => r.status === 'stale' || r.status === 'error').length;
    const offlineCount = records.filter(r => r.status === 'offline').length;

    let scoreColor = '#f44336';
    if (healthScore > 80) scoreColor = '#4caf50';
    else if (healthScore >= 50) scoreColor = '#ff9800';

    const summary = `
      <div class="feed-health-summary-section">
        <div class="feed-health-section-title">Health Summary</div>
        <div class="feed-health-summary-row">
          <span class="feed-summary-item">Total: <strong>${total}</strong></span>
          <span class="feed-summary-item" style="color:#4caf50;">OK: <strong>${okCount}</strong></span>
          <span class="feed-summary-item" style="color:#ff9800;">Degraded: <strong>${degradedCount}</strong></span>
          <span class="feed-summary-item" style="color:#9e9e9e;">Offline: <strong>${offlineCount}</strong></span>
          <span class="feed-summary-item">Score: <strong style="color:${scoreColor}">${healthScore}%</strong></span>
        </div>
      </div>`;

    const staleSection = this.buildStaleAlertSection(records, staleWarnIds, staleCritIds);
    const grid = this.buildFeedGrid(records, staleWarnIds, staleCritIds, now);
    const errors = this.buildErrorLog(errorLog);

    return `<div class="feed-health-dashboard">${summary}${staleSection}${grid}${errors}</div>`;
  }

  private buildStaleAlertSection(
    records: FeedRecord[],
    staleWarnIds: Set<string>,
    staleCritIds: Set<string>,
  ): string {
    const staleRecords = records.filter(r => staleWarnIds.has(r.feedId) || staleCritIds.has(r.feedId));
    if (staleRecords.length === 0) return '';

    const items = staleRecords.map(r => {
      const isCrit = staleCritIds.has(r.feedId);
      const color = isCrit ? '#f44336' : '#ff9800';
      return `<span class="stale-feed-name" style="color:${color}">${escapeHtml(r.feedId)}</span>`;
    }).join(', ');

    return `
      <div class="feed-stale-alert-section">
        <div class="feed-health-section-title">Stale Feed Alert</div>
        <div class="feed-stale-alert-body">${items}</div>
      </div>`;
  }

  private buildFeedGrid(
    records: FeedRecord[],
    staleWarnIds: Set<string>,
    staleCritIds: Set<string>,
    now: number,
  ): string {
    if (records.length === 0) {
      return `
        <div class="feed-status-grid-section">
          <div class="feed-health-section-title">Feed Status Grid</div>
          <div class="feed-grid-empty">No feeds tracked yet.</div>
        </div>`;
    }

    const rows = records.map(r => {
      const color = STATUS_COLOR[r.status];
      const label = STATUS_LABEL[r.status];
      const age = escapeHtml(formatAge(r.lastSeenAt, now));
      let rowClass = 'feed-row';
      if (staleCritIds.has(r.feedId)) rowClass += ' feed-row-crit';
      else if (staleWarnIds.has(r.feedId)) rowClass += ' feed-row-warn';
      return `<div class="${rowClass}">` +
        `<span class="feed-name">${escapeHtml(r.feedId)}</span>` +
        `<span class="feed-domain">${escapeHtml(r.domain)}</span>` +
        `<span class="status-badge status-${r.status}" style="color:${color}">${label}</span>` +
        `<span class="feed-age">${age}</span>` +
        `<span class="feed-latency">${r.latencyMs}ms</span>` +
        `</div>`;
    }).join('');

    return `
      <div class="feed-status-grid-section">
        <div class="feed-health-section-title">Feed Status Grid</div>
        <div class="feed-grid">${rows}</div>
      </div>`;
  }

  private buildErrorLog(errorLog: ErrorLogEntry[]): string {
    if (errorLog.length === 0) return '';

    const rows = errorLog.map(e => {
      const ts = new Date(e.timestamp).toISOString().replace('T', ' ').slice(0, 19);
      return `<div class="error-log-row">` +
        `<span class="error-log-ts">${escapeHtml(ts)}</span>` +
        `<span class="error-log-feed">${escapeHtml(e.feedId)}</span>` +
        `<span class="error-log-msg">${escapeHtml(e.message)}</span>` +
        `</div>`;
    }).join('');

    return `
      <div class="feed-error-log-section">
        <div class="feed-health-section-title">Error Log</div>
        <div class="feed-error-log">${rows}</div>
      </div>`;
  }
}
