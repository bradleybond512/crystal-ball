/**
 * Mission Ledger Bridge Panel — visibility into the closed-loop
 * wiring between mission-state transitions and the intelligence
 * OutcomeLedger.
 *
 * Vanilla TS panel. Subscribes to MissionLedgerBridge events for
 * live updates and polls every 10 s as a safety net.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getMissionLedgerBridge,
  type BridgedEntry,
} from '@/services/intelligence/mission-ledger-bridge';
import type { OutcomeAction } from '@/services/intelligence/outcome-ledger';

const ACTION_COLOR: Record<OutcomeAction, string> = {
  'acted-on': 'var(--severity-ok,#22c55e)',
  'confirmed-real': 'var(--severity-ok,#22c55e)',
  escalated: 'var(--severity-high,#f87171)',
  'de-escalated': '#60a5fa',
  dismissed: 'var(--text-secondary,#aaa)',
  'marked-false-positive': 'var(--severity-medium,#facc15)',
};

const ACTION_LABEL: Record<OutcomeAction, string> = {
  'acted-on': 'ACTED ON',
  'confirmed-real': 'CONFIRMED',
  escalated: 'ESCALATED',
  'de-escalated': 'DE-ESCALATED',
  dismissed: 'DISMISSED',
  'marked-false-positive': 'FALSE POSITIVE',
};

const REFRESH_MS = 10_000;
const RECENT_LIMIT = 5;

export class MissionLedgerBridgePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'mission-ledger-bridge',
      title: 'Mission Ledger Bridge',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Closes the learning loop: every mission state transition is recorded as an OutcomeLedger entry so per-domain calibration learns from real-world outcomes.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = getMissionLedgerBridge().subscribe(() => this.render());
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

  // ── Rendering ────────────────────────────────────────────────────

  private render(): void {
    try {
      const bridge = getMissionLedgerBridge();
      const stats = bridge.stats();
      const recent = bridge.getRecent(RECENT_LIMIT);
      this.setCount(stats.todayRecorded);
      this.setContent(this.buildHtml(stats, recent, bridge.isConnected()));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Bridge render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(
    stats: ReturnType<ReturnType<typeof getMissionLedgerBridge>['stats']>,
    recent: readonly BridgedEntry[],
    connected: boolean,
  ): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;font-size:12px;">
      ${this.renderHeader(stats, connected)}
      ${this.renderActionBreakdown(stats.byAction)}
      ${this.renderRecent(recent)}
    </div>`;
  }

  private renderHeader(
    stats: ReturnType<ReturnType<typeof getMissionLedgerBridge>['stats']>,
    connected: boolean,
  ): string {
    const statusColor = connected ? 'var(--severity-ok,#22c55e)' : 'var(--text-secondary,#aaa)';
    const statusLabel = connected ? 'CONNECTED' : 'DISCONNECTED';
    const lastSeen = stats.lastRecordedAt
      ? new Date(stats.lastRecordedAt).toLocaleString()
      : 'never';
    return `<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;">
      <div>
        <div style="font-size:24px;font-weight:700;">${stats.todayRecorded}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">recorded today</div>
      </div>
      <div>
        <div style="font-size:24px;font-weight:700;">${stats.totalRecorded}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">total</div>
      </div>
      <div style="margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
        <span style="font-size:10px;font-weight:700;color:${statusColor};text-transform:uppercase;letter-spacing:0.05em;">${statusLabel}</span>
        <span style="font-size:10px;color:var(--text-secondary,#aaa);">last entry: ${escapeHtml(lastSeen)}</span>
      </div>
    </div>`;
  }

  private renderActionBreakdown(byAction: Record<OutcomeAction, number>): string {
    const total = Object.values(byAction).reduce((acc, n) => acc + n, 0);
    const rows = (Object.keys(byAction) as OutcomeAction[]).map((action) => {
      const count = byAction[action];
      const pct = total === 0 ? 0 : Math.round((count / total) * 100);
      const color = ACTION_COLOR[action];
      return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;">
        <span style="min-width:120px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(ACTION_LABEL[action])}</span>
        <div style="flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${color};"></div>
        </div>
        <span style="min-width:48px;text-align:right;">${count}</span>
      </div>`;
    }).join('');
    return `<div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);margin-bottom:6px;">Breakdown by action</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderRecent(recent: readonly BridgedEntry[]): string {
    if (recent.length === 0) {
      return '<div style="font-size:11px;color:var(--text-secondary,#aaa);">No bridge entries recorded yet.</div>';
    }
    const rows = recent.map((e) => this.renderRow(e)).join('');
    return `<div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);margin-bottom:4px;">Last ${recent.length} entries</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr style="color:var(--text-secondary,#aaa);text-align:left;">
            <th style="padding:4px 6px;font-weight:600;">When</th>
            <th style="padding:4px 6px;font-weight:600;">Domain</th>
            <th style="padding:4px 6px;font-weight:600;">Action</th>
            <th style="padding:4px 6px;font-weight:600;">Mission</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  private renderRow(entry: BridgedEntry): string {
    const when = entry.outcome.recordedAt.toLocaleTimeString();
    const action = entry.outcome.actualOutcome;
    const color = ACTION_COLOR[action];
    return `<tr style="border-top:1px solid var(--border-subtle,#222);">
      <td style="padding:4px 6px;font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);">${escapeHtml(when)}</td>
      <td style="padding:4px 6px;">${escapeHtml(entry.outcome.domain)}</td>
      <td style="padding:4px 6px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(ACTION_LABEL[action])}</td>
      <td style="padding:4px 6px;font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);">${escapeHtml(truncate(entry.missionId, 24))}</td>
    </tr>`;
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
