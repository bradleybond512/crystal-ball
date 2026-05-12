/**
 * Notification History Panel — shows the last 200 notifications the
 * producer pipeline made a decision about. Filter bar (domain / severity
 * / time range), expandable rows for the raw payload, and a Clear button.
 *
 * Reads from the in-memory ring exposed by
 * `src/services/notifications/notification-history-service.ts`; the
 * service handles its own IndexedDB persistence so this panel only
 * worries about rendering.
 */
/* eslint-disable sonarjs/no-nested-template-literals -- short row markup */

import { Panel } from './Panel';
import {
  ACTION_BADGE,
  DOMAIN_ICON,
  SEVERITY_BADGE,
  clear as clearHistory,
  getHistory,
  hydrateFromIdb,
  type HistoryAction,
  type HistoryDomain,
  type HistorySeverity,
  type NotificationHistoryEntry,
} from '@/services/notifications/notification-history-service';
import {
  TIME_RANGES,
  formatPayload,
  formatTimestamp,
  sinceMsForRange,
  type TimeRangePreset,
} from './notification-history-helpers';
import { escapeHtml } from '@/utils/sanitize';

// Spec calls for 30s auto-refresh — the history ring is appended to by
// the producer pipeline and persisted to IDB, so we don't need to poll
// faster than the user's expected glance cadence.
const REFRESH_MS = 30_000;

interface PanelState {
  domain: HistoryDomain | 'all';
  severity: HistorySeverity | 'all';
  action: HistoryAction | 'all';
  range: TimeRangePreset['id'];
  expandedId: string | null;
}

const DOMAIN_OPTIONS: { id: HistoryDomain | 'all'; label: string }[] = [
  { id: 'all', label: 'All domains' },
  { id: 'seismic', label: 'Seismic' },
  { id: 'geomagnetic', label: 'Geomagnetic' },
  { id: 'solar_flare', label: 'Solar Flare' },
  { id: 'cap', label: 'CAP' },
  { id: 'hurricane', label: 'Hurricane' },
  { id: 'wildfire', label: 'Wildfire' },
  { id: 'air_quality', label: 'Air Quality' },
  { id: 'market', label: 'Market' },
  { id: 'cyber', label: 'Cyber' },
];

const SEVERITY_OPTIONS: { id: HistorySeverity | 'all'; label: string }[] = [
  { id: 'all', label: 'All severities' },
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

const ACTION_OPTIONS: { id: HistoryAction | 'all'; label: string }[] = [
  { id: 'all', label: 'All actions' },
  { id: 'fired', label: 'Fired' },
  { id: 'suppressed', label: 'Suppressed' },
  { id: 'escalated', label: 'Escalated' },
];

export class NotificationHistoryPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private state: PanelState = {
    domain: 'all',
    severity: 'all',
    action: 'all',
    range: 'h24',
    expandedId: null,
  };

  constructor() {
    super({
      id: 'notification-history',
      title: 'Notification History',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Last 200 notifications the producer pipeline made a decision about. Filter by domain / severity / time range, click any row to expand the raw payload.',
    });
    this.showLoading('Loading notification history…');
    queueMicrotask(() => {
      void hydrateFromIdb().finally(() => this.render());
    });
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
  }

  override destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private render(): void {
    const rows = this.queryRows();
    this.setCount(rows.length);
    this.setContent(this.buildHtml(rows));
    this.attachHandlers();
  }

  private queryRows(): NotificationHistoryEntry[] {
    return getHistory({
      domain: this.state.domain,
      severity: this.state.severity,
      action: this.state.action,
      sinceMs: sinceMsForRange(this.state.range),
    });
  }

  private buildHtml(rows: NotificationHistoryEntry[]): string {
    return `<div class="nh-panel">
      ${this.renderFilterBar()}
      ${this.renderRows(rows)}
      ${this.renderFooter(rows.length)}
    </div>`;
  }

  private renderFilterBar(): string {
    const rangeOptions = TIME_RANGES.map((r) => ({ id: r.id, label: r.label }));
    return `<div class="nh-filter-bar">
      ${this.renderFilterSelect('domain', DOMAIN_OPTIONS)}
      ${this.renderFilterSelect('severity', SEVERITY_OPTIONS)}
      ${this.renderFilterSelect('action', ACTION_OPTIONS)}
      ${this.renderFilterSelect('range', rangeOptions)}
      <button class="nh-clear-btn" type="button">Clear history</button>
    </div>`;
  }

  private renderFilterSelect(name: keyof PanelState, options: { id: string; label: string }[]): string {
    const current = this.state[name];
    return `<select class="nh-select" data-nh-filter="${escapeHtml(String(name))}">
      ${options.map((o) => `<option value="${escapeHtml(o.id)}"${o.id === current ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>`;
  }

  private renderRows(rows: NotificationHistoryEntry[]): string {
    if (rows.length === 0) {
      return '<div class="panel-empty">No notifications match the current filter.</div>';
    }
    const items = rows.map((r) => this.renderRow(r)).join('');
    return `<div class="nh-rows">${items}</div>`;
  }

  private renderRow(r: NotificationHistoryEntry): string {
    const expanded = this.state.expandedId === r.id;
    const sev = SEVERITY_BADGE[r.severity];
    const action = ACTION_BADGE[r.action];
    return `<div class="nh-row${expanded ? ' nh-row-expanded' : ''}" data-nh-id="${escapeHtml(r.id)}">
      <div class="nh-row-summary">
        <span class="nh-row-icon" aria-hidden="true">${DOMAIN_ICON[r.domain]}</span>
        <span class="nh-row-title">${escapeHtml(r.title)}</span>
        <span class="nh-row-source">${escapeHtml(r.source)}</span>
        <span class="nh-row-badges">
          <span class="nh-badge" style="color:${sev.color};">${escapeHtml(sev.label)}</span>
          <span class="nh-badge" style="color:${action.color};">${escapeHtml(action.label)}</span>
        </span>
        <span class="nh-row-time">${escapeHtml(formatTimestamp(r.recordedAt))}</span>
      </div>
      ${expanded ? this.renderRowDetail(r) : ''}
    </div>`;
  }

  private renderRowDetail(r: NotificationHistoryEntry): string {
    const ruleLine = r.ruleId
      ? `<div class="nh-detail-line"><strong>Rule:</strong> ${escapeHtml(r.ruleId)}</div>`
      : '';
    const reasonLine = r.suppressedReason
      ? `<div class="nh-detail-line"><strong>Suppressed because:</strong> ${escapeHtml(r.suppressedReason)}</div>`
      : `<div class="nh-detail-line"><strong>Fired:</strong> all preconditions met (no suppression).</div>`;
    return `<div class="nh-row-detail">
      <div class="nh-detail-line"><strong>Body:</strong> ${escapeHtml(r.body)}</div>
      ${ruleLine}
      ${reasonLine}
      <div class="nh-detail-line"><strong>Payload</strong></div>
      <pre class="nh-detail-payload">${escapeHtml(formatPayload(r.payload))}</pre>
    </div>`;
  }

  private renderFooter(count: number): string {
    return `<div class="nh-footer">${count} notification${count === 1 ? '' : 's'} · last 200 retained</div>`;
  }

  private attachHandlers(): void {
    const root = this.getContentElement();

    for (const select of root.querySelectorAll<HTMLSelectElement>('[data-nh-filter]')) {
      select.addEventListener('change', () => {
        const key = select.dataset.nhFilter as keyof PanelState | undefined;
        if (!key) return;
        // Type-narrow per filter — each filter has its own union.
        (this.state as unknown as Record<string, unknown>)[key] = select.value;
        this.state.expandedId = null;
        this.render();
      });
    }

    const clearBtn = root.querySelector<HTMLButtonElement>('.nh-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('Clear all notification history? This cannot be undone.')) return;
        clearHistory();
        this.state.expandedId = null;
        this.render();
      });
    }

    for (const row of root.querySelectorAll<HTMLElement>('[data-nh-id]')) {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('select, button')) return;
        const id = row.dataset.nhId ?? null;
        this.state.expandedId = this.state.expandedId === id ? null : id;
        this.render();
      });
    }
  }
}
