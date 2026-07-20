/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Notification History Panel — full-featured view backed by the
 * NotificationProvenanceService (the canonical 500-record provenance
 * store). Header row shows total / delivered / suppressed counts;
 * filter bar narrows by domain and "suppressed only"; the sortable
 * table renders relative timestamp, domain + severity badges, status
 * icon, and the trigger observation's domain as the provenance source.
 * Clicking a row expands the full title + trigger id + suppression
 * reason + absolute timestamp inline.
 */

import { Panel } from './Panel';
import {
  getNotificationProvenanceService,
  type NotificationProvenanceStats,
  type ProvenanceRecord,
} from '@/services/notifications/notification-provenance';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const TITLE_TRUNCATE = 60;

interface PanelState {
  domainFilter: string;
  suppressedOnly: boolean;
  expandedId: string | null;
}

const SEVERITY_FROM_SCORE: { min: number; label: string; color: string }[] = [
  { min: 0.8, label: 'critical', color: '#ff453a' },
  { min: 0.6, label: 'high', color: '#ffb74d' },
  { min: 0.35, label: 'medium', color: '#4a9eff' },
  { min: 0, label: 'low', color: '#9e9e9e' },
];

export class NotificationHistoryPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private state: PanelState = {
    domainFilter: 'all',
    suppressedOnly: false,
    expandedId: null,
  };

  constructor() {
    super({
      id: 'notification-history',
      title: 'Notification History',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Full-featured history backed by the NotificationProvenanceService (last 500 notifications with provenance). Filter by domain or "suppressed only"; click a row to expand the trigger observation, suppression reason, and full timestamp.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsub = getNotificationProvenanceService().subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private filteredRecords(): ProvenanceRecord[] {
    const svc = getNotificationProvenanceService();
    const base = this.state.domainFilter === 'all'
      ? svc.getAll()
      : svc.getByDomain(this.state.domainFilter);
    if (!this.state.suppressedOnly) return base;
    return base.filter((r) => r.suppressedByQuietHours || r.suppressedByTrustBudget);
  }

  private render(): void {
    const svc = getNotificationProvenanceService();
    const stats = svc.getStats();
    const records = this.filteredRecords();
    this.setCount(records.length);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      ${renderHeaderStats(stats)}
      ${this.renderFilterBar(stats)}
      ${renderTable(records, this.state.expandedId)}
    </div>`;
    this.setContent(html, () => this.wireHandlers());
  }

  private renderFilterBar(stats: NotificationProvenanceStats): string {
    const domains = ['all', ...Object.keys(stats.byDomain).sort((a, b) => a.localeCompare(b))];
    const options = domains.map((d) =>
      `<option value="${escapeHtml(d)}"${d === this.state.domainFilter ? ' selected' : ''}>${escapeHtml(d === 'all' ? 'All domains' : d)}</option>`,
    ).join('');
    const checked = this.state.suppressedOnly ? ' checked' : '';
    return `<div style="display:flex;align-items:center;gap:12px;font-size:11px;">
      <label style="display:flex;align-items:center;gap:6px;color:var(--text-secondary,#aaa);">
        Domain
        <select id="historyDomainFilter" style="padding:4px 8px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;">${options}</select>
      </label>
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input id="historySuppressedOnly" type="checkbox"${checked} style="cursor:pointer;">
        Suppressed only
      </label>
    </div>`;
  }

  private wireHandlers(): void {
    setTimeout(() => {
      const root = this.content;
      const domainSel = root.querySelector<HTMLSelectElement>('#historyDomainFilter');
      domainSel?.addEventListener('change', () => {
        this.state.domainFilter = domainSel.value;
        this.render();
      });
      const suppToggle = root.querySelector<HTMLInputElement>('#historySuppressedOnly');
      suppToggle?.addEventListener('change', () => {
        this.state.suppressedOnly = suppToggle.checked;
        this.render();
      });
      root.querySelectorAll<HTMLElement>('[data-history-row]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.dataset.historyRow;
          if (!id) return;
          this.state.expandedId = this.state.expandedId === id ? null : id;
          this.render();
        });
      });
    }, 0);
  }
}

// ── Rendering helpers ───────────────────────────────────────────────

function renderHeaderStats(stats: NotificationProvenanceStats): string {
  return `<div style="display:flex;gap:18px;font-size:12px;font-family:ui-monospace,monospace;">
    <span><strong>${stats.total}</strong> total</span>
    <span><strong style="color:#4caf50;">${stats.delivered}</strong> delivered</span>
    <span><strong style="color:#ffb74d;">${stats.suppressed}</strong> suppressed</span>
  </div>`;
}

function severityFromScore(score: number): { label: string; color: string } {
  for (const band of SEVERITY_FROM_SCORE) {
    if (score >= band.min) return { label: band.label, color: band.color };
  }
  return { label: 'low', color: '#9e9e9e' };
}

function renderTable(records: readonly ProvenanceRecord[], expandedId: string | null): string {
  if (records.length === 0) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);padding:16px;text-align:center;border:1px dashed var(--border-subtle,#333);border-radius:4px;">No notification history yet.</div>`;
  }
  const rows = records.map((r) => renderRow(r, r.notificationId === expandedId)).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead>
      <tr style="text-align:left;color:var(--text-secondary,#aaa);font-size:10px;text-transform:uppercase;letter-spacing:0.05em;border-bottom:1px solid var(--border-subtle,#333);">
        <th style="padding:6px 8px;font-weight:600;width:80px;">Time</th>
        <th style="padding:6px 8px;font-weight:600;">Domain</th>
        <th style="padding:6px 8px;font-weight:600;">Severity</th>
        <th style="padding:6px 8px;font-weight:600;">Title</th>
        <th style="padding:6px 8px;font-weight:600;width:60px;text-align:center;">Status</th>
        <th style="padding:6px 8px;font-weight:600;">Source</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderRow(r: ProvenanceRecord, expanded: boolean): string {
  const sev = severityFromScore(r.finalScore);
  const isSuppressed = r.suppressedByQuietHours || r.suppressedByTrustBudget;
  const statusIcon = isSuppressed ? '⊘' : '✓';
  const statusColor = isSuppressed ? '#ffb74d' : '#4caf50';
  const statusTitle = isSuppressed ? 'Suppressed' : 'Delivered';
  const truncated = r.title.length > TITLE_TRUNCATE ? `${r.title.slice(0, TITLE_TRUNCATE - 1)}…` : r.title;
  const source = r.triggerObservation?.domain ?? 'unknown';
  const ago = formatAgo(Date.now() - r.sentAt);
  const baseRow = `<tr data-history-row="${escapeHtml(r.notificationId)}" style="cursor:pointer;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,0.05));">
    <td style="padding:6px 8px;font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);">${escapeHtml(ago)}</td>
    <td style="padding:6px 8px;"><span style="font-size:10px;padding:1px 6px;border-radius:3px;background:var(--surface-3,#222);color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">${escapeHtml(r.domain)}</span></td>
    <td style="padding:6px 8px;"><span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${sev.color}26;color:${sev.color};text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(sev.label)}</span></td>
    <td style="padding:6px 8px;" title="${escapeHtml(r.title)}">${escapeHtml(truncated)}</td>
    <td style="padding:6px 8px;text-align:center;color:${statusColor};" title="${escapeHtml(statusTitle)}">${statusIcon}</td>
    <td style="padding:6px 8px;font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);">${escapeHtml(source)}</td>
  </tr>`;
  if (!expanded) return baseRow;
  return baseRow + renderExpansion(r);
}

function renderExpansion(r: ProvenanceRecord): string {
  const isSuppressed = r.suppressedByQuietHours || r.suppressedByTrustBudget;
  const reasons: string[] = [];
  if (r.suppressedByQuietHours) reasons.push('quiet hours');
  if (r.suppressedByTrustBudget) reasons.push('trust budget');
  const reason = isSuppressed ? reasons.join(' + ') : 'not suppressed';
  const absTime = new Date(r.sentAt).toISOString();
  return `<tr style="border-bottom:1px solid var(--border-subtle,rgba(255,255,255,0.05));">
    <td colspan="6" style="padding:8px 12px;background:var(--surface-2,#1a1a1a);font-size:11px;">
      <div style="display:flex;flex-direction:column;gap:4px;">
        <div><span style="color:var(--text-secondary,#aaa);">Full title:</span> ${escapeHtml(r.title)}</div>
        <div><span style="color:var(--text-secondary,#aaa);">Trigger observation:</span> <span style="font-family:ui-monospace,monospace;">${escapeHtml(r.triggerObservation?.id ?? 'unknown')}</span></div>
        <div><span style="color:var(--text-secondary,#aaa);">Suppression:</span> ${escapeHtml(reason)}</div>
        <div><span style="color:var(--text-secondary,#aaa);">Sent at:</span> <span style="font-family:ui-monospace,monospace;">${escapeHtml(absTime)}</span></div>
      </div>
    </td>
  </tr>`;
}

function formatAgo(ms: number): string {
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
