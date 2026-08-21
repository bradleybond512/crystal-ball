/**
 * Feed Health Panel.
 *
 * One row per external data feed Crystal Ball polls. Shows endpoint,
 * last-poll age, and a 🟢 / 🟡 / 🔴 status indicator computed from the
 * feed's poll interval and either:
 *   1. data-freshness state (for feeds with a registered DataSourceId), or
 *   2. /api/health.feeds[] (for sidecar-only feeds that don't surface
 *      through data-freshness).
 *
 * Refreshes every 10s. No DOM mutation outside Panel.setContent.
 */
/* eslint-disable sonarjs/no-nested-template-literals -- short status row markup */

import { Panel } from './Panel';
import {
  FEED_CATALOG,
  buildFeedRows,
  summarizeFeedHealth,
  formatLastPoll,
  type FeedHealth,
  type FeedRow,
  type FeedSnapshot,
} from '@/services/diagnostics/feed-catalog';
import {
  collectDataFreshnessSnapshots,
  groupBy,
  mergeFeedSnapshotsByAttempt,
  mergeLifelineProviderHealth,
  mergeSidecarFeeds,
  parseLifelineProviderHealthEvent,
  shortenEndpoint,
  type SidecarFeedStatus,
} from './feed-health-helpers';
import { getApiBaseUrl } from '@/services/runtime';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;

const STATUS_BADGE: Record<FeedHealth, { icon: string; color: string; label: string }> = {
  fresh: { icon: '🟢', color: '#4caf50', label: 'fresh' },
  stale: { icon: '🟡', color: '#ffeb3b', label: 'stale' },
  error: { icon: '🔴', color: '#ff453a', label: 'error' },
  never: { icon: '⚪', color: '#9e9e9e', label: 'never' },
};

interface SidecarHealthResponse {
  feeds?: SidecarFeedStatus[];
}

export class FeedHealthPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private snapshots: Record<string, FeedSnapshot> = {};
  private lastFetchAt: number | null = null;
  private lastFetchError: string | null = null;
  private readonly lifelinesUpdated = (event: Event): void => {
    const providers = parseLifelineProviderHealthEvent((event as CustomEvent<unknown>).detail);
    if (providers.length === 0) return;
    this.snapshots = mergeFeedSnapshotsByAttempt(
      this.snapshots,
      mergeLifelineProviderHealth(providers),
    );
    this.render();
  };

  constructor() {
    super({
      id: 'feed-health',
      title: 'Feed Health',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Status of every external data feed Crystal Ball polls. 🟢 fresh = last success within 2× poll interval; 🟡 stale = within 10×; 🔴 error = last fetch failed or feed beyond 10× interval.',
    });
    document.addEventListener('wm:local-logistics-updated', this.lifelinesUpdated);
    this.refreshNow();
    this.refreshTimer = setInterval(() => this.refreshNow(), REFRESH_MS);
  }

  override destroy(): void {
    document.removeEventListener('wm:local-logistics-updated', this.lifelinesUpdated);
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  /** Public for tests — apply snapshots directly without polling. */
  applySnapshots(snapshots: Record<string, FeedSnapshot>): void {
    this.snapshots = { ...this.snapshots, ...snapshots };
    this.render();
  }

  private refreshNow(): void {
    const dfSnapshots = collectDataFreshnessSnapshots(FEED_CATALOG);
    this.snapshots = { ...this.snapshots, ...dfSnapshots };
    this.render();
    void this.fetchSidecarHealth();
  }

  private async fetchSidecarHealth(): Promise<void> {
    try {
      const resp = await fetch(`${getApiBaseUrl()}/api/health`, {
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) {
        this.lastFetchError = `HTTP ${resp.status}`;
        this.render();
        return;
      }
      const body = (await resp.json()) as SidecarHealthResponse;
      if (Array.isArray(body.feeds)) {
        this.snapshots = mergeFeedSnapshotsByAttempt(
          this.snapshots,
          mergeSidecarFeeds(body.feeds, FEED_CATALOG),
        );
      }
      this.lastFetchAt = Date.now();
      this.lastFetchError = null;
    } catch (error) {
      this.lastFetchError = String((error as Error)?.message ?? error);
    }
    this.render();
  }

  private render(): void {
    const rows = buildFeedRows(FEED_CATALOG, this.snapshots, Date.now());
    const summary = summarizeFeedHealth(rows);
    this.setCount(summary.error + summary.never);
    this.setContent(this.buildHtml(rows, summary));
  }

  private buildHtml(rows: FeedRow[], summary: ReturnType<typeof summarizeFeedHealth>): string {
    const grouped = groupBy(rows, (r) => r.category);
    const sections = [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => this.renderSection(category, items))
      .join('');
    const summaryRow = `
      <div class="feed-health-summary">
        <span style="color:${STATUS_BADGE.fresh.color};">${STATUS_BADGE.fresh.icon} ${summary.fresh} fresh</span>
        <span style="color:${STATUS_BADGE.stale.color};">${STATUS_BADGE.stale.icon} ${summary.stale} stale</span>
        <span style="color:${STATUS_BADGE.error.color};">${STATUS_BADGE.error.icon} ${summary.error} error</span>
        <span style="color:${STATUS_BADGE.never.color};">${STATUS_BADGE.never.icon} ${summary.never} never</span>
        <span class="feed-health-total">/ ${summary.total} total</span>
      </div>`;
    const footer = this.renderFooter();
    return `<div class="feed-health-panel">${summaryRow}${sections}${footer}</div>`;
  }

  private renderSection(category: string, rows: FeedRow[]): string {
    const items = rows.map((r) => this.renderRow(r)).join('');
    return `
      <div class="feed-health-section">
        <div class="feed-health-section-title">${escapeHtml(category.toUpperCase())}</div>
        <table class="feed-health-table">
          <thead><tr>
            <th>Feed</th>
            <th>Endpoint</th>
            <th>Last Poll</th>
            <th>Status</th>
          </tr></thead>
          <tbody>${items}</tbody>
        </table>
      </div>`;
  }

  private renderRow(row: FeedRow): string {
    const badge = STATUS_BADGE[row.status];
    const lastPoll = formatLastPoll(row, Date.now());
    const errorTitle = row.lastError ? ` title="${escapeHtml(row.lastError)}"` : '';
    const endpointShort = shortenEndpoint(row.endpoint);
    return `
      <tr class="feed-health-row feed-health-${row.status}"${errorTitle}>
        <td class="feed-health-name">${escapeHtml(row.name)}</td>
        <td class="feed-health-endpoint" title="${escapeHtml(row.endpoint)}">${escapeHtml(endpointShort)}</td>
        <td class="feed-health-age">${escapeHtml(lastPoll)}</td>
        <td class="feed-health-status" style="color:${badge.color};">
          <span class="feed-health-icon">${badge.icon}</span>
          <span class="feed-health-label">${escapeHtml(badge.label)}</span>
        </td>
      </tr>`;
  }

  private renderFooter(): string {
    if (this.lastFetchError) {
      return `<div class="feed-health-footer feed-health-error-msg">⚠ Sidecar /api/health: ${escapeHtml(this.lastFetchError)}</div>`;
    }
    if (this.lastFetchAt === null) {
      return `<div class="feed-health-footer">Awaiting sidecar /api/health…</div>`;
    }
    const ageMs = Date.now() - this.lastFetchAt;
    const ago = ageMs < 60_000 ? 'just now' : `${Math.floor(ageMs / 60_000)}m ago`;
    return `<div class="feed-health-footer">Sidecar reachable · last ${escapeHtml(ago)}</div>`;
  }
}
