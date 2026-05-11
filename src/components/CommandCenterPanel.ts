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
  getFeatureHealthRegistry,
  getFeedSentinels,
} from '@/services/diagnostics/diagnostics-state';
import {
  aggregateSystemHealth,
  contextFromSnapshots,
} from '@/services/diagnostics/system-health';
import { getLiveDiagnosticsSnapshot } from '@/services/diagnostics/live-diagnostics-snapshot';
import { auditFeeds } from '@/services/diagnostics/sentinel-feed-audit';
import {
  getActiveActionBrief,
  getPersonalImpactReport,
  getProviderRedundancyReport,
} from '@/services/insights/insights-state';
import type { ActionBrief } from '@/services/insights/action-briefs';
import type { PersonalImpact } from '@/services/personal/personal-impact';
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

const ACTION_TIER_COLOR: Record<'monitor' | 'prepare' | 'act_now' | 'shelter', string> = {
  monitor: '#4caf50',
  prepare: '#ffeb3b',
  act_now: '#ff9800',
  shelter: '#d50000',
};

const IMPACT_SEVERITY_COLOR: Record<'critical' | 'elevated' | 'watch' | 'low' | 'none', string> = {
  critical: '#d50000',
  elevated: '#ff9800',
  watch: '#ffeb3b',
  low: '#9e9e9e',
  none: '#616161',
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

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private render(): void {
    const html = this.buildHtml();
    this.setContent(html);
  }

  private buildHtml(): string {
    // Pull live source/provider/sidecar/feed state instead of the empty
    // arrays + hard-coded unknown sidecar that used to drive this panel.
    const snapshot = getLiveDiagnosticsSnapshot();
    const featureReg = getFeatureHealthRegistry();
    const sentinels = getFeedSentinels();

    const panels = snapshot.panels;
    const ctx = contextFromSnapshots({
      panels,
      sources: snapshot.sources,
      providers: snapshot.providers,
    });
    const features = featureReg.all(ctx);
    const report = aggregateSystemHealth({
      panels,
      features,
      sources: snapshot.sources,
      providers: snapshot.providers,
      notifications: snapshot.notificationSummary,
      sidecar: snapshot.sidecar,
    });
    const feedAudit = auditFeeds({ sentinels, snapshots: snapshot.feedSnapshots });

    const concerning = features
      .filter((f) => f.status !== 'healthy' && f.status !== 'unknown')
      .sort((a, b) => criticalRank(b) - criticalRank(a));
    this.setCount(concerning.length);

    const actionBrief = getActiveActionBrief();
    const personalImpact = getPersonalImpactReport();
    const redundancy = getProviderRedundancyReport();

    return `
      <div style="padding:14px;display:flex;flex-direction:column;gap:14px;">
        ${this.renderGlobeNav()}
        ${this.renderRiskHeadline(report.status, report.summary)}
        ${this.renderActionBrief(actionBrief)}
        ${this.renderPersonalImpact(personalImpact.impacts)}
        ${this.renderTopThings(concerning)}
        ${this.renderProviderRedundancy(redundancy)}
        ${this.renderWatchNext(feedAudit.entries.length, feedAudit.entries.filter((e) => e.level !== 'fresh' && e.level !== 'unknown').length)}
        ${this.renderRecommendations(report.recommendations)}
      </div>
    `;
  }

  private renderGlobeNav(): string {
    return `<div style="display:flex;justify-content:flex-end;">
      <button onclick="document.getElementById('godsVisionBtn')?.click()" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--text-secondary,#aaa);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;" title="Open God's Vision 3D globe">🌍 Globe</button>
    </div>`;
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

  private renderActionBrief(brief: ActionBrief | undefined): string {
    if (!brief) return '';
    const tierColor = ACTION_TIER_COLOR[brief.tier];
    const actions = brief.recommendedActions.length === 0
      ? ''
      : `<ul style="margin:6px 0 0 0;padding-left:18px;font-size:12px;line-height:1.5;">
          ${brief.recommendedActions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}
        </ul>`;
    const watch = brief.confirmingSources.length === 0
      ? ''
      : `<div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:6px;">
          <span style="text-transform:uppercase;letter-spacing:0.05em;">Watch next</span> · ${escapeHtml(brief.confirmingSources.slice(0, 4).join(', '))}
        </div>`;
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${tierColor};border-radius:4px;padding:10px 12px;background:rgba(255,255,255,0.02);">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <span style="font-weight:700;font-size:13px;">${escapeHtml(brief.headline)}</span>
        <span style="font-size:10px;color:${tierColor};text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(brief.tier)}</span>
      </div>
      ${actions}
      ${watch}
    </div>`;
  }

  private renderPersonalImpact(impacts: readonly PersonalImpact[]): string {
    const surfacing = impacts.filter((i) => i.severity !== 'none' && i.severity !== 'low').slice(0, 3);
    if (surfacing.length === 0) return '';
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:8px;">Your personal impact</div>
      ${surfacing.map((i) => this.renderImpactRow(i)).join('')}
    </div>`;
  }

  private renderImpactRow(i: PersonalImpact): string {
    const color = IMPACT_SEVERITY_COLOR[i.severity];
    const exposures = i.exposures.length === 0
      ? '<em>no direct personal exposure</em>'
      : i.exposures.slice(0, 2).map((e) => escapeHtml(e.label)).join(', ');
    return `<div style="display:flex;gap:10px;padding:6px 0;">
      <span style="font-size:10px;color:${color};font-weight:700;text-transform:uppercase;min-width:60px;">${escapeHtml(i.severity)}</span>
      <div style="flex:1;font-size:12px;">
        <div>${escapeHtml(i.description)}</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:3px;">${exposures}</div>
        ${i.recommendedAction ? `<div style="font-size:11px;color:var(--accent,#4a9eff);margin-top:3px;">→ ${escapeHtml(i.recommendedAction)}</div>` : ''}
      </div>
    </div>`;
  }

  private renderProviderRedundancy(report: ReturnType<typeof getProviderRedundancyReport>): string {
    if (report.domains.length === 0) return '';
    const stressed = report.domains.filter((d) => d.verdict !== 'redundant_agreement');
    if (stressed.length === 0) return '';
    return `<div style="border-top:1px solid var(--border-subtle,#333);padding-top:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Provider stress</div>
      <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5;">
        ${stressed.slice(0, 3).map((d) => `<li><strong>${escapeHtml(d.domain)}</strong>: ${escapeHtml(d.reason)}</li>`).join('')}
      </ul>
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
