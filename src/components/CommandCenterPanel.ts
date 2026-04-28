/**
 * Command Center Panel — gameplan's "Mission Control UI" (Big Bet 5).
 *
 * Top-of-app surface that answers: what's the current risk, what
 * matters most, what changed since last look, what to watch next.
 * Reads from the diagnostics registries + provided sentinel feed
 * snapshots — pure composition over the foundation modules.
 */

import { Panel } from './Panel';
import {
  getPanelHealthRegistry,
  getFeatureHealthRegistry,
  getNotificationTraceRegistry,
  getFeedSentinels,
} from '@/services/diagnostics/diagnostics-state';
import {
  aggregateSystemHealth,
  contextFromSnapshots,
} from '@/services/diagnostics/system-health';
import { auditFeeds } from '@/services/diagnostics/sentinel-feed-audit';
import type { FeatureHealth, HealthStatus } from '@/services/diagnostics/system-health-types';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 10_000;

const STATUS_COLOR: Record<HealthStatus, string> = {
  healthy: '#4caf50',
  degraded: '#ffeb3b',
  stale: '#ff9800',
  failing: '#f44336',
  unsafe: '#d50000',
  blind: '#607d8b',
  unknown: '#9e9e9e',
};

const RISK_LABEL: Record<HealthStatus, string> = {
  healthy: 'CALM',
  unknown: 'WARMING',
  degraded: 'ELEVATED',
  stale: 'STALE',
  blind: 'BLIND',
  failing: 'STRESSED',
  unsafe: 'CRITICAL',
};

export class CommandCenterPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'command-center',
      title: 'Command Center',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Top-of-app summary: current risk, what matters most, what changed, what to watch next. Reads from feature / panel / notification registries.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
  }

  public dispose(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private render(): void {
    const html = this.buildHtml();
    this.setContent(html);
  }

  private buildHtml(): string {
    const panelReg = getPanelHealthRegistry();
    const featureReg = getFeatureHealthRegistry();
    const notifReg = getNotificationTraceRegistry();
    const sentinels = getFeedSentinels();

    const panels = panelReg.all();
    const ctx = contextFromSnapshots({ panels, sources: [], providers: [] });
    const features = featureReg.all(ctx);
    const sidecar = {
      status: 'unknown' as HealthStatus,
      authenticated: false,
      reason: 'Sidecar adapter not wired into Command Center yet.',
    };
    const report = aggregateSystemHealth({
      panels,
      features,
      sources: [],
      providers: [],
      notifications: notifReg.summary(),
      sidecar,
    });
    const feedAudit = auditFeeds({ sentinels, snapshots: [] });

    const concerning = features
      .filter((f) => f.status !== 'healthy' && f.status !== 'unknown')
      .sort((a, b) => criticalRank(b) - criticalRank(a));
    this.setCount(concerning.length);

    return `
      <div style="padding:14px;display:flex;flex-direction:column;gap:14px;">
        ${this.renderRiskHeadline(report.status, report.summary)}
        ${this.renderTopThings(concerning)}
        ${this.renderWatchNext(feedAudit.entries.length, feedAudit.entries.filter((e) => e.level !== 'fresh' && e.level !== 'unknown').length)}
        ${this.renderRecommendations(report.recommendations)}
      </div>
    `;
  }

  private renderRiskHeadline(status: HealthStatus, summary: string): string {
    const color = STATUS_COLOR[status];
    const label = RISK_LABEL[status];
    return `<div style="display:flex;flex-direction:column;gap:4px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color}aa;"></span>
        <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.08em;">Current risk</span>
      </div>
      <div style="font-size:28px;font-weight:800;color:${color};letter-spacing:0.04em;">${escapeHtml(label)}</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">${escapeHtml(summary)}</div>
    </div>`;
  }

  private renderTopThings(concerning: readonly FeatureHealth[]): string {
    if (concerning.length === 0) {
      return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
        <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Top things that matter</div>
        <div style="font-size:13px;color:#4caf50;">All features within their calibration floors. No action needed.</div>
      </div>`;
    }
    const top = concerning.slice(0, 3);
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:8px;">Top ${top.length} ${top.length === 1 ? 'thing' : 'things'} that matter</div>
      ${top.map((f, i) => this.renderTopRow(f, i + 1)).join('')}
    </div>`;
  }

  private renderTopRow(f: FeatureHealth, n: number): string {
    const color = STATUS_COLOR[f.status];
    return `<div style="display:flex;gap:10px;padding:8px 10px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;margin-bottom:6px;">
      <div style="font-size:18px;font-weight:800;color:${color};min-width:24px;">${n}</div>
      <div style="flex:1;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-weight:700;font-size:13px;">${escapeHtml(f.label)}</span>
          <span style="font-size:10px;color:${color};text-transform:uppercase;">${escapeHtml(f.status)}</span>
        </div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:3px;">${escapeHtml(f.userImpact || f.reason)}</div>
        ${f.recommendedAction ? `<div style="font-size:11px;color:var(--accent,#4a9eff);margin-top:3px;">→ ${escapeHtml(f.recommendedAction)}</div>` : ''}
      </div>
    </div>`;
  }

  private renderWatchNext(totalFeeds: number, drifting: number): string {
    if (totalFeeds === 0) return '';
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Watch next</div>
      <div style="font-size:12px;">
        ${drifting === 0
          ? `${totalFeeds} feeds fresh — nothing drifting.`
          : `<strong style="color:#ff9800;">${drifting}</strong> of ${totalFeeds} sentinel feeds drifting. See Diagnostic → Feeds.`}
      </div>
    </div>`;
  }

  private renderRecommendations(recs: readonly string[]): string {
    if (recs.length === 0) return '';
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">What you should do</div>
      <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5;">
        ${recs.slice(0, 4).map((r) => `<li>${escapeHtml(r)}</li>`).join('')}
      </ul>
    </div>`;
  }
}

function criticalRank(f: FeatureHealth): number {
  const sev: Record<HealthStatus, number> = {
    healthy: 0,
    unknown: 1,
    degraded: 2,
    stale: 3,
    blind: 4,
    failing: 5,
    unsafe: 6,
  };
  return sev[f.status] + (f.critical ? 10 : 0);
}
