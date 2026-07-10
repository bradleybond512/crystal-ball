/**
 * AlertEscalationPanel — surfaces the AlertEscalationService state.
 * Shows summary counts (pending / escalated), per-domain counts,
 * pending alert list with time-until-escalation countdown, escalated
 * list with level badge + time-since-escalation, and acknowledge
 * buttons.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getAlertEscalationService,
  type AlertEscalationService,
  type EscalationRecord,
  type EscalationSummary,
} from '@/services/intelligence/alert-escalation';

const REFRESH_MS = 15_000;
const TICK_MS = 30_000;
const LIST_LIMIT = 25;

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--severity-critical, #ef4444)',
  high: 'var(--severity-high, #fb923c)',
  medium: 'var(--severity-medium, #facc15)',
  low: 'var(--severity-low, #60a5fa)',
};

const LEVEL_COLOR: Record<number, string> = {
  1: 'var(--severity-low, #60a5fa)',
  2: 'var(--severity-medium, #facc15)',
  3: 'var(--severity-critical, #ef4444)',
};

export class AlertEscalationPanel extends Panel {
  private readonly service: AlertEscalationService;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'alert-escalation',
      title: 'Alert Escalation',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Auto-escalates unacknowledged alerts after a severity-based timeout. Critical alerts escalate in 5min, high in 15min, medium in 1hr, low in 4hr. Max 3 levels before expiry.',
    });
    this.service = getAlertEscalationService();
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.tickTimer = setInterval(() => { this.service.tick(); }, TICK_MS);
    this.unsubscribe = this.service.subscribe(() => this.render());
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }

  private render(): void {
    try {
      const summary = this.service.getSummary();
      const pending = this.service.getRecords({ status: 'pending' }, LIST_LIMIT);
      const escalated = this.service.getRecords({ status: 'escalated' }, LIST_LIMIT);
      this.setCount(summary.pending + summary.escalated);
      this.setContent(this.buildHtml(summary, pending, escalated), () => this.wireHandlers());
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Escalation panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(
    summary: EscalationSummary,
    pending: readonly EscalationRecord[],
    escalated: readonly EscalationRecord[],
  ): string {
    return `<div style="padding:14px 16px;max-height:560px;overflow:auto;">
      ${renderSummary(summary)}
      ${renderEscalatedList(escalated)}
      ${renderPendingList(pending, Date.now())}
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    root.querySelectorAll<HTMLButtonElement>('.esc-ack').forEach((btn) => {
      btn.addEventListener('click', () => {
        const alertId = btn.dataset.alertId;
        if (alertId) {
          this.service.acknowledge(alertId);
          this.render();
        }
      });
    });
    const tickBtn = root.querySelector<HTMLButtonElement>('.esc-tick');
    tickBtn?.addEventListener('click', () => {
      this.service.tick();
      this.render();
    });
  }
}

function renderSummary(summary: EscalationSummary): string {
  const avgText = summary.avgTimeToEscalateMs === null ? '—' : formatDuration(summary.avgTimeToEscalateMs);
  const domainEntries = Object.entries(summary.byDomain).sort((a, b) => b[1] - a[1]);
  const domainHtml = domainEntries.length === 0
    ? `<span style="color:var(--text-secondary,#888);font-style:italic;font-size:11px;">No alerts registered</span>`
    : domainEntries.map(([domain, count]) =>
        `<span style="padding:2px 8px;background:rgba(255,255,255,0.05);border-radius:10px;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(domain)}: <strong style="color:var(--text-primary,#ddd);">${count}</strong></span>`,
      ).join(' ');
  return `<section style="margin-bottom:16px;">
    <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
      ${renderStatCard('Pending', summary.pending, 'var(--severity-medium,#facc15)')}
      ${renderStatCard('Escalated', summary.escalated, 'var(--severity-critical,#ef4444)')}
      ${renderStatCard('Avg time', avgText, 'var(--text-secondary,#aaa)')}
      <button class="esc-tick" style="margin-left:auto;font-size:11px;padding:4px 12px;background:var(--severity-ok,#4ade80);color:#000;border:none;border-radius:3px;cursor:pointer;font-weight:600;">Run Tick</button>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">${domainHtml}</div>
  </section>`;
}

function renderStatCard(label: string, value: number | string, color: string): string {
  return `<div style="text-align:center;min-width:60px;">
    <div style="font-size:22px;font-weight:700;line-height:1;color:${color};">${typeof value === 'number' ? value : escapeHtml(value)}</div>
    <div style="font-size:9px;color:var(--text-secondary,#888);text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;">${escapeHtml(label)}</div>
  </div>`;
}

function renderEscalatedList(escalated: readonly EscalationRecord[]): string {
  if (escalated.length === 0) {
    return `<section style="margin-bottom:14px;">
      <h3 style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Escalated</h3>
      <div style="font-size:11px;color:var(--text-secondary,#888);font-style:italic;">(none)</div>
    </section>`;
  }
  const rows = escalated.map((r) => renderEscalatedRow(r)).join('');
  return `<section style="margin-bottom:16px;">
    <h3 style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Escalated</h3>
    <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;">${rows}</ul>
  </section>`;
}

function renderEscalatedRow(r: EscalationRecord): string {
  const sevColor = SEVERITY_COLOR[r.severity] ?? 'var(--text-secondary,#888)';
  const lvlColor = LEVEL_COLOR[r.escalationLevel] ?? 'var(--severity-critical,#ef4444)';
  const since = r.escalatedAt ? formatDuration(Date.now() - r.escalatedAt) : '—';
  return `<li style="padding:8px 10px;background:rgba(255,68,68,0.05);border-left:3px solid ${sevColor};border-radius:3px;">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
      <div style="display:flex;gap:8px;align-items:baseline;">
        <span style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:${sevColor};">[${escapeHtml(r.severity)}]</span>
        <span style="font-size:11px;color:${lvlColor};font-weight:600;">L${r.escalationLevel}</span>
        <span style="font-size:12px;font-weight:600;">${escapeHtml(r.alertId)}</span>
        <span style="font-size:10px;color:var(--text-secondary,#888);">— ${escapeHtml(r.domain)}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <span style="font-size:10px;color:var(--text-secondary,#aaa);">escalated ${escapeHtml(since)} ago</span>
        <button class="esc-ack" data-alert-id="${escapeHtml(r.alertId)}" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--text-secondary,#ccc);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Ack</button>
      </div>
    </div>
  </li>`;
}

function renderPendingList(pending: readonly EscalationRecord[], now: number): string {
  if (pending.length === 0) {
    return `<section>
      <h3 style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Pending</h3>
      <div style="font-size:11px;color:var(--text-secondary,#888);font-style:italic;">(none)</div>
    </section>`;
  }
  const rows = pending.map((r) => renderPendingRow(r, now)).join('');
  return `<section>
    <h3 style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Pending</h3>
    <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;">${rows}</ul>
  </section>`;
}

function renderPendingRow(r: EscalationRecord, now: number): string {
  const sevColor = SEVERITY_COLOR[r.severity] ?? 'var(--text-secondary,#888)';
  const remaining = r.expiresAt - now;
  const countdown = remaining <= 0 ? 'overdue' : `in ${formatDuration(remaining)}`;
  const countdownColor = remaining <= 0 ? 'var(--severity-critical,#ef4444)' : 'var(--text-secondary,#aaa)';
  return `<li style="padding:8px 10px;background:rgba(255,255,255,0.03);border-left:3px solid ${sevColor};border-radius:3px;">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;">
      <div style="display:flex;gap:8px;align-items:baseline;">
        <span style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:${sevColor};">[${escapeHtml(r.severity)}]</span>
        <span style="font-size:12px;font-weight:600;">${escapeHtml(r.alertId)}</span>
        <span style="font-size:10px;color:var(--text-secondary,#888);">— ${escapeHtml(r.domain)}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <span style="font-size:10px;color:${countdownColor};font-variant-numeric:tabular-nums;">${escapeHtml(countdown)}</span>
        <button class="esc-ack" data-alert-id="${escapeHtml(r.alertId)}" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--text-secondary,#ccc);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Ack</button>
      </div>
    </div>
  </li>`;
}

function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 1000) return `${ms}ms`;
  const sec = Math.round(abs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h`;
  const days = Math.round(hr / 24);
  return `${days}d`;
}
