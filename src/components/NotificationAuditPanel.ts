/**
 * Notification Audit Panel (panel id: `notification-audit`).
 *
 * Filterable timeline of every notification — sent or suppressed — with
 * provenance: producer name, alertId, situationId, ruleId, channel set,
 * and (when suppressed) the structured suppression reason.
 *
 * Reads from the localStorage-backed NotificationAuditService. The older
 * notification-history-service (IDB-backed) coexists at the
 * `notification-history` panel id.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getNotificationAuditService,
  type NotificationRecord,
  type Severity,
} from '@/services/notifications/notification-audit';
import { escapeHtml } from '@/utils/sanitize';

const DOMAINS: { value: string; label: string }[] = [
  { value: 'all', label: 'All domains' },
  { value: 'earthquake', label: 'Earthquakes' },
  { value: 'weather', label: 'Weather' },
  { value: 'wildfire', label: 'Wildfire' },
  { value: 'maritime', label: 'Maritime' },
  { value: 'aviation', label: 'Aviation' },
  { value: 'biosurveillance', label: 'Biosurveillance' },
  { value: 'space-weather', label: 'Space Weather' },
  { value: 'cyber', label: 'Cyber' },
  { value: 'sanctions', label: 'Sanctions' },
  { value: 'intelligence', label: 'Intelligence' },
];
const SEVERITIES: ('all' | Severity)[] = ['all', 'low', 'medium', 'high', 'critical'];
const SEVERITY_COLOR: Record<Severity, string> = {
  low: '#9ca3af', medium: '#f5a524', high: '#e94f37', critical: '#a626a4',
};
const TIME_RANGES: { value: string; label: string; ms: number }[] = [
  { value: '1h', label: 'Last 1h', ms: 60 * 60_000 },
  { value: '6h', label: 'Last 6h', ms: 6 * 60 * 60_000 },
  { value: '24h', label: 'Last 24h', ms: 24 * 60 * 60_000 },
  { value: '7d', label: 'Last 7d', ms: 7 * 24 * 60 * 60_000 },
];

interface PanelState {
  domain: string;
  severity: 'all' | Severity;
  showSuppressed: boolean;
  rangeMs: number;
  expanded: Set<string>;
}

export class NotificationAuditPanel extends Panel {
  private unsubscribe: (() => void) | null = null;
  private state: PanelState = {
    domain: 'all',
    severity: 'all',
    showSuppressed: true,
    rangeMs: 24 * 60 * 60_000,
    expanded: new Set<string>(),
  };

  constructor() {
    super({
      id: 'notification-audit',
      title: 'Notification Audit',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Provenance-tracked timeline of every notification sent or suppressed. Filter by domain, severity, or time range; click a row to see alert / situation / rule linkage.',
    });
    this.unsubscribe = getNotificationAuditService().subscribe(() => this.render());
    this.render();
  }

  public override destroy(): void {
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    super.destroy();
  }

  private filteredRecords(): NotificationRecord[] {
    const svc = getNotificationAuditService();
    let recs = svc.getRecent(this.state.rangeMs);
    if (this.state.domain !== 'all') {
      recs = recs.filter((r) => r.domain === this.state.domain);
    }
    if (this.state.severity !== 'all') {
      recs = recs.filter((r) => r.severity === this.state.severity);
    }
    if (!this.state.showSuppressed) {
      recs = recs.filter((r) => !r.wasSuppressed);
    }
    return recs;
  }

  private render(): void {
    const svc = getNotificationAuditService();
    this.setCount(svc.unreadCount());
    this.setContent(this.buildHtml());
    queueMicrotask(() => this.wireHandlers());
  }

  private buildHtml(): string {
    const svc = getNotificationAuditService();
    const records = this.filteredRecords();
    const stats = svc.stats(this.state.rangeMs);
    return `<div class="na-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderHeader(svc.unreadCount())}
      ${this.renderFilters()}
      ${this.renderStats(stats)}
      ${this.renderTimeline(records)}
    </div>`;
  }

  private renderHeader(unread: number): string {
    const badge = unread > 0
      ? `<span style="background:#4a9eff;color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;">${unread} unread</span>`
      : '';
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;">Timeline</span>
        ${badge}
      </div>
      <div style="display:flex;gap:6px;">
        <button class="na-mark-all" type="button" style="padding:3px 8px;background:rgba(74,158,255,0.18);color:inherit;border:1px solid rgba(74,158,255,0.4);border-radius:3px;cursor:pointer;font-size:11px;">Mark all read</button>
        <button class="na-clear" type="button" style="padding:3px 8px;background:transparent;color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:3px;cursor:pointer;font-size:11px;">Clear</button>
      </div>
    </div>`;
  }

  private renderFilters(): string {
    const domainOpts = DOMAINS.map((d) =>
      `<option value="${escapeHtml(d.value)}"${d.value === this.state.domain ? ' selected' : ''}>${escapeHtml(d.label)}</option>`,
    ).join('');
    const sevOpts = SEVERITIES.map((s) =>
      `<option value="${s}"${s === this.state.severity ? ' selected' : ''}>${s === 'all' ? 'All severities' : s}</option>`,
    ).join('');
    const rangeOpts = TIME_RANGES.map((r) =>
      `<option value="${r.value}"${r.ms === this.state.rangeMs ? ' selected' : ''}>${escapeHtml(r.label)}</option>`,
    ).join('');
    const selStyle = 'background:rgba(255,255,255,0.04);color:inherit;border:1px solid rgba(255,255,255,0.12);border-radius:3px;padding:3px 5px;font-size:11px;';
    return `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px;background:rgba(255,255,255,0.03);border-radius:3px;">
      <select class="na-filter-domain" style="${selStyle}">${domainOpts}</select>
      <select class="na-filter-severity" style="${selStyle}">${sevOpts}</select>
      <select class="na-filter-range" style="${selStyle}">${rangeOpts}</select>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:#ccc;cursor:pointer;">
        <input type="checkbox" class="na-filter-suppressed" ${this.state.showSuppressed ? 'checked' : ''}
          style="accent-color:#4a9eff;cursor:pointer;">
        Show suppressed
      </label>
    </div>`;
  }

  private renderStats(stats: ReturnType<ReturnType<typeof getNotificationAuditService>['stats']>): string {
    const topDomainEntry = Object.entries(stats.byDomain).sort((a, b) => b[1] - a[1])[0];
    const topDomain = topDomainEntry ? `${topDomainEntry[0]} (${topDomainEntry[1]})` : '—';
    return `<div style="display:flex;gap:14px;font-size:11px;color:#bbb;padding:0 6px;">
      <span><strong style="color:#2ec27e;">${stats.sent}</strong> sent</span>
      <span><strong style="color:#e94f37;">${stats.suppressed}</strong> suppressed</span>
      <span>Top: <strong>${escapeHtml(topDomain)}</strong></span>
    </div>`;
  }

  private renderTimeline(records: NotificationRecord[]): string {
    if (records.length === 0) {
      return `<div style="padding:14px;text-align:center;opacity:0.55;font-size:12px;">No notifications in the selected time range.</div>`;
    }
    const rows = records.map((r) => this.renderRow(r)).join('');
    return `<div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>`;
  }

  private renderRow(r: NotificationRecord): string {
    const expanded = this.state.expanded.has(r.id);
    const sevColor = SEVERITY_COLOR[r.severity];
    const ts = ageLabel(r.sentAt, Date.now());
    const titleStyle = r.wasSuppressed ? 'text-decoration:line-through;opacity:0.7;' : '';
    const bodyTrim = r.body.length > 140 ? `${r.body.slice(0, 140)}…` : r.body;
    const unreadMark = r.readAt
      ? ''
      : '<span style="width:5px;height:5px;border-radius:50%;background:#4a9eff;display:inline-block;margin-right:4px;"></span>';
    const suppressedBadge = r.wasSuppressed
      ? `<span style="background:rgba(233,79,55,0.18);color:#e94f37;border:1px solid rgba(233,79,55,0.4);font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(r.suppressedBy ?? 'suppressed')}</span>`
      : '';
    const channels = r.channels.map((c) =>
      `<span style="background:rgba(255,255,255,0.08);font-size:9px;padding:1px 5px;border-radius:2px;color:#ddd;">${escapeHtml(c)}</span>`,
    ).join(' ');

    return `<div class="na-row" data-id="${escapeHtml(r.id)}" style="border-left:3px solid ${sevColor};padding:6px 8px;background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;cursor:pointer;">
      <div style="display:flex;justify-content:space-between;gap:6px;align-items:start;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            ${unreadMark}
            <span style="background:rgba(74,158,255,0.18);color:#4a9eff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(r.domain)}</span>
            <span style="color:${sevColor};font-size:9px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${r.severity}</span>
            ${suppressedBadge}
          </div>
          <div style="font-size:12px;font-weight:600;margin-top:3px;${titleStyle}">${escapeHtml(r.title)}</div>
          <div style="font-size:11px;opacity:0.75;margin-top:1px;${titleStyle}">${escapeHtml(bodyTrim)}</div>
          <div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap;">${channels}</div>
          <div style="font-size:10px;opacity:0.55;margin-top:2px;">${escapeHtml(r.producerName)}</div>
        </div>
        <span style="font-size:10px;opacity:0.6;white-space:nowrap;">${ts}</span>
      </div>
      ${expanded ? this.renderRowDetail(r) : ''}
    </div>`;
  }

  private renderRowDetail(r: NotificationRecord): string {
    const fullBody = `<div style="font-size:11px;color:#ddd;white-space:pre-wrap;padding:6px 0;">${escapeHtml(r.body)}</div>`;
    const linkLine = (label: string, value: string | undefined): string => value
      ? `<div style="font-size:11px;display:flex;gap:6px;padding:1px 0;"><span style="opacity:0.55;width:80px;flex-shrink:0;">${label}:</span><span style="font-family:ui-monospace,monospace;">${escapeHtml(value)}</span></div>`
      : '';
    return `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);">
      ${fullBody}
      ${linkLine('Alert ID', r.alertId)}
      ${linkLine('Situation', r.situationId)}
      ${linkLine('Rule ID', r.ruleId)}
      ${linkLine('Sent at', r.sentAt.toISOString())}
      ${r.readAt ? linkLine('Read at', r.readAt.toISOString()) : ''}
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const svc = getNotificationAuditService();

    root.querySelector<HTMLButtonElement>('.na-mark-all')?.addEventListener('click', () => svc.markAllRead());
    root.querySelector<HTMLButtonElement>('.na-clear')?.addEventListener('click', () => svc.clear());

    const domSel = root.querySelector<HTMLSelectElement>('.na-filter-domain');
    domSel?.addEventListener('change', () => { this.state.domain = domSel.value; this.render(); });

    const sevSel = root.querySelector<HTMLSelectElement>('.na-filter-severity');
    sevSel?.addEventListener('change', () => {
      this.state.severity = sevSel.value as PanelState['severity'];
      this.render();
    });

    const rangeSel = root.querySelector<HTMLSelectElement>('.na-filter-range');
    rangeSel?.addEventListener('change', () => {
      const match = TIME_RANGES.find((t) => t.value === rangeSel.value);
      if (match) this.state.rangeMs = match.ms;
      this.render();
    });

    const suppCheck = root.querySelector<HTMLInputElement>('.na-filter-suppressed');
    suppCheck?.addEventListener('change', () => {
      this.state.showSuppressed = suppCheck.checked;
      this.render();
    });

    for (const row of root.querySelectorAll<HTMLElement>('.na-row')) {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        if (!id) return;
        if (this.state.expanded.has(id)) this.state.expanded.delete(id);
        else { this.state.expanded.add(id); svc.markRead(id); }
        this.render();
      });
    }
  }
}

function ageLabel(then: Date, now: number): string {
  const ms = now - then.getTime();
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s ago`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}h ago`;
  return `${Math.round(ms / (24 * 60 * 60_000))}d ago`;
}
