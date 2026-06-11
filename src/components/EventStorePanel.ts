/**
 * Event Store Panel — read-only health view over the Temporal World Store.
 *
 * The append-only event log lives in the sidecar (events.db, node:sqlite).
 * This panel polls GET /api/events/health every 60s and renders the totals,
 * the time span covered, on-disk size, retention setting, and a per-domain
 * breakdown bar. All formatting/derivation is delegated to the pure,
 * unit-tested helpers in event-store-helpers.ts — the panel is just the view.
 *
 * Degrades honestly: a 503 (store failed to initialise) or a network error
 * renders an explicit "unavailable" state rather than a misleading empty log.
 */

import { Panel } from './Panel';
import {
  summarizeHealth,
  buildDomainBars,
  type EventStoreHealth,
} from './event-store-helpers';
import { getApiBaseUrl } from '../services/runtime';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 60 * 1000; // 60s per spec

interface HealthResponse extends EventStoreHealth {
  byDomain?: Record<string, number>;
  retentionMonths?: number;
}

const DOMAIN_COLORS = [
  '#4caf50', '#2196f3', '#ff9800', '#9c27b0',
  '#00bcd4', '#ffeb3b', '#e91e63', '#8bc34a',
];

export class EventStorePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'event-store',
      title: 'Event Store',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Health of the Temporal World Store — the append-only event log (observations, situation transitions) persisted to SQLite in the sidecar. Polls every 60s. Retention auto-prunes events older than the configured window.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private start(): void {
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  private async refresh(): Promise<void> {
    let health: HealthResponse | null = null;
    try {
      const base = getApiBaseUrl();
      const resp = await fetch(`${base}/api/events/health`, {
        signal: AbortSignal.timeout(4000),
      });
      if (!resp.ok) {
        const reason = resp.status === 503
          ? 'The event store failed to initialise in the sidecar.'
          : `Health endpoint returned ${resp.status}.`;
        this.renderUnavailable(reason);
        return;
      }
      health = (await resp.json()) as HealthResponse;
    } catch {
      this.renderUnavailable('Could not reach the sidecar event store.');
      return;
    }
    this.renderHealth(health);
  }

  private renderUnavailable(reason: string): void {
    this.setCount(0);
    this.setDataBadge('unavailable');
    this.setContent(`<div style="padding:16px;color:var(--text-secondary,#888);font-size:12px;line-height:1.5;">
      <div style="font-weight:600;color:var(--text-primary,#ccc);margin-bottom:4px;">Event store unavailable</div>
      ${escapeHtml(reason)}
    </div>`);
  }

  private renderHealth(health: HealthResponse): void {
    const summary = summarizeHealth(health);
    this.setCount(summary.totalEvents);
    this.setDataBadge('live');

    const bars = buildDomainBars(health.byDomain ?? {});
    const months = health.retentionMonths;
    let retention = '—';
    if (typeof months === 'number') {
      retention = `${months} month${months === 1 ? '' : 's'}`;
    }

    this.setContent(`
      <div style="padding:12px 14px;display:flex;flex-direction:column;gap:14px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;">
          ${this.statCard('Total events', summary.totalEvents.toLocaleString())}
          ${this.statCard('On disk', summary.dbSizeLabel)}
          ${this.statCard('Partitions', String(summary.partitions.length))}
          ${this.statCard('Retention', retention)}
        </div>
        <div style="font-size:11px;color:var(--text-secondary,#888);line-height:1.6;">
          <div>Oldest: <span style="font-family:ui-monospace,monospace;color:var(--text-primary,#ccc);">${escapeHtml(this.fmtTime(summary.oldestEvent))}</span></div>
          <div>Latest: <span style="font-family:ui-monospace,monospace;color:var(--text-primary,#ccc);">${escapeHtml(this.fmtTime(summary.latestEvent))}</span></div>
        </div>
        ${this.buildDomainSection(bars)}
      </div>
    `);
  }

  private statCard(label: string, value: string): string {
    return `<div style="background:var(--bg-elevated,rgba(255,255,255,0.03));border:1px solid var(--border-subtle,#222);border-radius:6px;padding:8px 10px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-secondary,#888);margin-bottom:3px;">${escapeHtml(label)}</div>
      <div style="font-size:17px;font-weight:700;font-family:ui-monospace,monospace;color:var(--text-primary,#eee);">${escapeHtml(value)}</div>
    </div>`;
  }

  private buildDomainSection(bars: ReturnType<typeof buildDomainBars>): string {
    if (bars.length === 0) {
      return `<div style="font-size:11px;color:var(--text-secondary,#777);">No events recorded yet.</div>`;
    }
    const rows = bars.map((b, i) => {
      const color = DOMAIN_COLORS[i % DOMAIN_COLORS.length];
      return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;">
        <div style="width:84px;flex:0 0 auto;color:var(--text-secondary,#aaa);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(b.domain)}">${escapeHtml(b.domain)}</div>
        <div style="flex:1 1 auto;height:8px;background:var(--border-subtle,#222);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${b.pct}%;background:${color};"></div>
        </div>
        <div style="width:64px;flex:0 0 auto;text-align:right;font-family:ui-monospace,monospace;color:var(--text-primary,#ccc);">${b.count.toLocaleString()} · ${b.pct}%</div>
      </div>`;
    }).join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#888);">Events by domain</div>
      ${rows}
    </div>`;
  }

  private fmtTime(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  }
}
