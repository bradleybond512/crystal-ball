/* eslint-disable sonarjs/no-nested-template-literals, @typescript-eslint/no-misused-promises, no-console */
/**
 * System Diagnostic Panel — per
 * docs/DIAGNOSTICS_OBSERVABILITY_ENHANCEMENT_PLAN.md PR 6.
 *
 * Tabbed surface that joins the diagnostics registries (panel,
 * feature, notification trace, sentinel feed audit, self-test) into
 * one place the user can answer "is the app healthy right now?".
 *
 * Auto-refreshes every 5 s. Click a tab to switch view; click "Run
 * self-test" to fire the standard nine probes.
 */

import { Panel } from './Panel';
import {
  attachDisclosureClickDelegation,
  renderDisclosureSwitcherHtml,
} from './DisclosureContainer';
import { disclosureService } from '@/services/ui/progressive-disclosure';
import {
  getDiagnosticEventBus,
  getFeatureHealthRegistry,
  getFeedSentinels,
  getNotificationTraceRegistry,
  getPanelHealthRegistry,
} from '@/services/diagnostics/diagnostics-state';
import {
  aggregateSystemHealth,
  contextFromSnapshots,
} from '@/services/diagnostics/system-health';
import { getLiveDiagnosticsSnapshot } from '@/services/diagnostics/live-diagnostics-snapshot';
import { diagnosticsHeartbeatAgeMs } from '@/services/diagnostics/diagnostics-heartbeat';
import { getApiBaseUrl } from '@/services/runtime';
import { getSavedPlaces } from '@/services/saved-places';
import { runNwsPolygonSelfTestFixture } from '@/services/weather/self-test-fixture';
import { PROVIDER_DEFINITIONS } from '@/services/providers/provider-registry';
import { getProviderRedundancyReport } from '@/services/insights/insights-state';
import { buildRedundancyView, corroborationSummary, type RedundancyTone } from '@/services/diagnostics/provider-redundancy-view';
import { getActiveQualityDebt } from '@/services/quality/quality-debt-state';
import {
  auditFeeds,
  type FeedAuditEntry,
} from '@/services/diagnostics/sentinel-feed-audit';
import {
  runSelfTests,
  standardSelfTestDefinitions,
  type SelfTestReport,
} from '@/services/diagnostics/self-test';
import {
  VERDICT_BADGE,
  fetchSidecarSelfTest,
  formatLatency,
  overallVerdict,
  type SidecarSelfTestResult,
  type SidecarSelfTestSummary,
} from '@/services/diagnostics/sidecar-self-test';
import type {
  FeatureHealth,
  HealthStatus,
  PanelHealth,
} from '@/services/diagnostics/system-health-types';
import { escapeHtml } from '@/utils/sanitize';
import {
  getMissionState,
  type MissionState,
} from '@/services/diagnostics/mission-state-service';

const REFRESH_MS = 5000;

type Tab = 'overview' | 'features' | 'panels' | 'notifications' | 'feeds' | 'quality_debt' | 'self_test';

const STATUS_COLOR: Record<HealthStatus, string> = {
  healthy: 'var(--severity-ok)',
  degraded: 'var(--severity-medium)',
  stale:   'var(--severity-high)',
  failing: 'var(--severity-high)',
  unsafe:  'var(--severity-critical)',
  blind:   'var(--severity-info)',
  unknown: 'var(--severity-info)',
};

const STATUS_ICON: Record<HealthStatus, string> = {
  healthy: '✓',
  degraded: '~',
  stale: '·',
  failing: '✗',
  unsafe: '!',
  blind: '○',
  unknown: '?',
};

export class SystemDiagnosticPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private detachDisclosure: (() => void) | null = null;
  private unsubscribeDisclosure: (() => void) | null = null;
  private activeTab: Tab = 'overview';
  private selfTestRunning = false;
  private selfTestReport: SelfTestReport | undefined;
  private sidecarSelfTest: {
    running: boolean;
    asOf: string | null;
    results: SidecarSelfTestResult[];
    summary: SidecarSelfTestSummary | null;
    error: string | null;
  } = { running: false, asOf: null, results: [], summary: null, error: null };

  constructor() {
    super({
      id: 'system-diagnostic',
      title: 'System Diagnostic',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Unified health view: features, panels, notifications, feeds, and an on-demand self-test. Use this to answer "why didn\'t I get warned?".',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
    this.detachDisclosure = attachDisclosureClickDelegation(this.content, 'system-diagnostic');
    this.unsubscribeDisclosure = disclosureService.subscribe('system-diagnostic', () => this.render());
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.detachDisclosure?.();
    this.detachDisclosure = null;
    this.unsubscribeDisclosure?.();
    this.unsubscribeDisclosure = null;
    super.destroy();
  }

  private render(): void {
    try {
      const html = this.buildHtml();
      this.setContent(html, () => this.wireHandlers());
    } catch (error) {
      console.warn('[SystemDiagnosticPanel] render failed:', error);
      this.setContent(`<div style="padding:12px;color:var(--severity-critical);">Diagnostic render error: ${escapeHtml(String(error))}</div>`);
    }
  }

  private buildHtml(): string {
    const ctx = this.collect();
    this.setCount(ctx.unhealthyCount);
    const switcher = renderDisclosureSwitcherHtml('system-diagnostic', { showRaw: true });
    const switcherRow = `<div style="display:flex;justify-content:flex-end;padding:6px 12px 0;">${switcher}</div>`;
    const level = disclosureService.getLevel('system-diagnostic');

    if (level === 'raw') {
      const bundle = {
        status: ctx.report.status,
        summary: ctx.report.summary,
        recommendations: ctx.report.recommendations,
        unhealthyCount: ctx.unhealthyCount,
        features: ctx.features.map((f) => ({ featureId: f.featureId, label: f.label, status: f.status, reason: f.reason })),
        panels: ctx.panels.map((p) => ({ panelId: p.panelId, status: p.status, label: p.label })),
        feedAudit: ctx.feedAudit.entries,
        recentEvents: ctx.recentEvents,
      };
      return `${switcherRow}<pre style="margin:0 12px 12px;padding:8px;font-size:11px;background:rgba(0,0,0,0.25);border:1px solid var(--border-subtle,#333);border-radius:4px;overflow:auto;max-height:520px;">${escapeHtml(JSON.stringify(bundle, null, 2))}</pre>`;
    }

    if (level === 'summary') {
      const status = ctx.report.status;
      const color = STATUS_COLOR[status];
      return `${switcherRow}<div style="padding:18px 14px;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${color};"></span>
          <span style="font-weight:700;color:${color};text-transform:uppercase;font-size:14px;">${escapeHtml(status)}</span>
        </div>
        <div style="font-size:12px;color:var(--text-secondary,#aaa);">${escapeHtml(ctx.report.summary)}</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">${ctx.unhealthyCount} feature${ctx.unhealthyCount === 1 ? '' : 's'} unhealthy · switch to Detail for the full report</div>
      </div>`;
    }

    return `${switcherRow}${this.renderHeader(ctx)}${this.renderTabs()}${this.renderActiveTab(ctx)}`;
  }

  private collect(): DiagnosticContext {
    // Pull the live snapshot — sources, providers, sidecar, feeds,
    // notifications, panels, and recent events all in one place.
    // Until PR roadmap-04-29, this method passed sources:[], providers:[]
    // and a hard-coded unknown sidecar, which made the diagnostic surface
    // less truthful than the underlying services.
    const snapshot = getLiveDiagnosticsSnapshot();
    const featureReg = getFeatureHealthRegistry();
    const sentinels = getFeedSentinels();

    const featureContext = contextFromSnapshots({
      panels: snapshot.panels,
      sources: snapshot.sources,
      providers: snapshot.providers,
    });
    const features = featureReg.all(featureContext);
    const report = aggregateSystemHealth({
      panels: snapshot.panels,
      features,
      sources: snapshot.sources,
      providers: snapshot.providers,
      notifications: snapshot.notificationSummary,
      sidecar: snapshot.sidecar,
    });
    const feedAudit = auditFeeds({ sentinels, snapshots: snapshot.feedSnapshots });
    const recentEvents = snapshot.recentEvents.slice(-20);
    const unhealthyCount =
      features.filter((f) => f.status !== 'healthy' && f.status !== 'unknown').length +
      snapshot.panels.filter((p) => p.status === 'failing' || p.status === 'unsafe').length;

    return {
      report,
      features,
      panels: [...snapshot.panels],
      notifSummary: snapshot.notificationSummary,
      feedAudit,
      recentEvents,
      unhealthyCount,
    };
  }

  private renderHeader(ctx: DiagnosticContext): string {
    const status = ctx.report.status;
    const color = STATUS_COLOR[status];
    const ms = getMissionState();
    const msBadgeColor = missionStateColor(ms);
    return `<div class="syd-header" style="padding:8px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;justify-content:space-between;align-items:center;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};"></span>
        <span style="font-weight:700;color:${color};text-transform:uppercase;font-size:12px;">${status}</span>
        <span style="color:var(--text-secondary,#aaa);font-size:12px;">${escapeHtml(ctx.report.summary)}</span>
        <span class="syd-mission-badge" title="Feed-staleness mission state" style="font-size:9px;padding:2px 5px;background:${msBadgeColor};color:#fff;border-radius:3px;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(ms)}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <button class="syd-export" title="Download the full diagnostic bundle (panel health, situations, correlations, algorithm trace, self-test, mission state) as JSON" style="font-size:11px;padding:3px 8px;background:transparent;color:var(--text-secondary,#aaa);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Export Full Bundle</button>
        <button class="syd-refresh" style="font-size:11px;padding:3px 8px;background:transparent;color:var(--text-secondary,#aaa);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Refresh</button>
      </div>
    </div>`;
  }

  private renderTabs(): string {
    const tabs: { id: Tab; label: string }[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'features', label: 'Features' },
      { id: 'panels', label: 'Panels' },
      { id: 'notifications', label: 'Notifications' },
      { id: 'feeds', label: 'Feeds' },
      { id: 'quality_debt', label: 'Quality Debt' },
      { id: 'self_test', label: 'Self-Test' },
    ];
    return `<div class="syd-tabs" style="display:flex;gap:0;border-bottom:1px solid var(--border-subtle,#333);">
      ${tabs.map((t) => {
        const isActive = t.id === this.activeTab;
        return `<button data-tab="${t.id}" class="syd-tab" style="flex:1;padding:6px 8px;font-size:11px;background:${isActive ? 'var(--bg-elevated,#1a1a1a)' : 'transparent'};color:${isActive ? 'var(--text-primary,#fff)' : 'var(--text-secondary,#aaa)'};border:none;border-bottom:2px solid ${isActive ? 'var(--accent,#4a9eff)' : 'transparent'};cursor:pointer;">${escapeHtml(t.label)}</button>`;
      }).join('')}
    </div>`;
  }

  private renderActiveTab(ctx: DiagnosticContext): string {
    switch (this.activeTab) {
      case 'overview': {
        return this.renderOverview(ctx);
      }
      case 'features': {
        return this.renderFeatures(ctx);
      }
      case 'panels': {
        return this.renderPanels(ctx);
      }
      case 'notifications': {
        return this.renderNotifications(ctx);
      }
      case 'feeds': {
        return this.renderFeeds(ctx);
      }
      case 'quality_debt': {
        return this.renderQualityDebt();
      }
      case 'self_test': {
        return this.renderSelfTest();
      }
    }
  }

  private renderQualityDebt(): string {
    const debt = getActiveQualityDebt();
    if (debt.length === 0) {
      return `<div style="padding:12px;color:var(--text-secondary,#aaa);font-size:12px;">No active quality debt — diagnostics surface is clean.</div>`;
    }
    const SEV_COLOR: Record<string, string> = {
      critical: 'var(--severity-critical)',
      high:     'var(--severity-high)',
      medium:   'var(--severity-medium)',
      low:      'var(--severity-info)',
    };
    const rows = debt.slice(0, 25).map((d) => {
      const color = SEV_COLOR[d.severity] ?? 'var(--severity-info)';
      return `<div style="border-left:3px solid ${color};padding:6px 10px;margin-bottom:6px;background:rgba(255,255,255,0.02);">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;">
          <strong>${escapeHtml(d.category)}</strong>
          <span style="color:${color};text-transform:uppercase;font-size:9px;letter-spacing:0.05em;">${escapeHtml(d.severity)}</span>
        </div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:3px;">${escapeHtml(d.impact)}</div>
        ${d.recommendedFix ? `<div style="font-size:11px;color:#4a9eff;margin-top:3px;">→ ${escapeHtml(d.recommendedFix)}</div>` : ''}
        <div style="font-size:10px;color:var(--text-secondary,#888);margin-top:3px;font-family:ui-monospace,monospace;">id=${escapeHtml(d.id)} owner=${escapeHtml(d.ownerArea)}</div>
      </div>`;
    }).join('');
    const more = debt.length > 25
      ? `<div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:8px;">+ ${debt.length - 25} more not shown.</div>`
      : '';
    return `<div style="padding:12px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-bottom:8px;">${debt.length} active item(s) · sorted by impact</div>
      ${rows}${more}
    </div>`;
  }

  private renderOverview(ctx: DiagnosticContext): string {
    const recs = ctx.report.recommendations;
    const recHtml = recs.length === 0
      ? `<div style="color:var(--text-secondary,#aaa);font-size:12px;">No recommendations — all clear.</div>`
      : `<ul style="margin:0;padding-left:18px;">${recs.map((r) => `<li style="font-size:12px;margin:3px 0;">${escapeHtml(r)}</li>`).join('')}</ul>`;
    // eslint-disable-next-line unicorn/no-array-reverse -- reversing a fresh copy, not the original.
    const recentEvents = [...ctx.recentEvents].reverse().slice(0, 5);
    const eventHtml = recentEvents.length === 0
      ? `<div style="color:var(--text-secondary,#aaa);font-size:11px;">No recent diagnostic events.</div>`
      : recentEvents.map((e) => `<div style="font-family:ui-monospace,monospace;font-size:11px;padding:2px 0;border-bottom:1px dotted var(--border-subtle,#222);"><span style="color:${this.severityColor(e.severity)};">[${escapeHtml(e.severity)}]</span> <span style="color:var(--text-secondary,#aaa);">${escapeHtml(e.kind)}</span> ${escapeHtml(e.message)}</div>`).join('');

    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      <div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recommendations</div>
        ${recHtml}
      </div>
      ${this.renderTallyRow(ctx)}
      <div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent events (last 5)</div>
        ${eventHtml}
      </div>
    </div>`;
  }

  private renderTallyRow(ctx: DiagnosticContext): string {
    const featureCount = ctx.features.reduce<Record<HealthStatus, number>>((acc, f) => {
      acc[f.status] = (acc[f.status] ?? 0) + 1;
      return acc;
    }, { healthy: 0, degraded: 0, stale: 0, failing: 0, unsafe: 0, blind: 0, unknown: 0 });
    const panelCount = ctx.panels.reduce<Record<HealthStatus, number>>((acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    }, { healthy: 0, degraded: 0, stale: 0, failing: 0, unsafe: 0, blind: 0, unknown: 0 });
    const totalFeed = ctx.feedAudit.entries.length;
    const freshFeeds = ctx.feedAudit.entries.filter((e) => e.level === 'fresh').length;
    return `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
      ${this.renderTallyCell('Features', featureCount.healthy, ctx.features.length)}
      ${this.renderTallyCell('Panels', panelCount.healthy, ctx.panels.length)}
      ${this.renderTallyCell('Feeds', freshFeeds, totalFeed)}
      ${this.renderTallyCell('Notifications', ctx.notifSummary.dispatched, ctx.notifSummary.candidates)}
    </div>`;
  }

  private renderTallyCell(label: string, healthy: number, total: number): string {
    const color = pickTallyColor(healthy, total);
    const display = total === 0 ? '—' : `${healthy}/${total}`;
    return `<div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px;text-align:center;">
      <div style="font-size:18px;font-weight:700;color:${color};">${escapeHtml(display)}</div>
      <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-top:3px;">${escapeHtml(label)}</div>
    </div>`;
  }

  private renderFeatures(ctx: DiagnosticContext): string {
    if (ctx.features.length === 0) {
      return `<div style="padding:12px;color:var(--text-secondary,#aaa);">No features registered.</div>`;
    }
    const rows = [...ctx.features]
      .sort((a, b) => severityRank(b.status) - severityRank(a.status) || a.featureId.localeCompare(b.featureId))
      .map((f) => this.renderFeatureRow(f));
    return `<div style="padding:8px 12px;display:flex;flex-direction:column;gap:6px;">${rows.join('')}</div>`;
  }

  private renderFeatureRow(f: FeatureHealth): string {
    const color = STATUS_COLOR[f.status];
    const icon = STATUS_ICON[f.status];
    const userImpact = f.userImpact ? `<div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:3px;">${escapeHtml(f.userImpact)}</div>` : '';
    const action = f.recommendedAction ? `<div style="font-size:11px;color:var(--accent,#4a9eff);margin-top:3px;">→ ${escapeHtml(f.recommendedAction)}</div>` : '';
    const criticalBadge = f.critical ? `<span style="font-size:9px;padding:1px 4px;background:var(--severity-critical);color:#fff;border-radius:2px;margin-left:6px;">CRITICAL</span>` : '';
    return `<div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px 10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="color:${color};font-weight:700;width:14px;">${icon}</span>
          <span style="font-weight:600;">${escapeHtml(f.label)}</span>
          ${criticalBadge}
        </div>
        <span style="font-size:10px;color:${color};text-transform:uppercase;">${escapeHtml(f.status)}</span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(f.reason)}</div>
      ${userImpact}
      ${action}
    </div>`;
  }

  private renderPanels(ctx: DiagnosticContext): string {
    if (ctx.panels.length === 0) {
      return `<div style="padding:12px;color:var(--text-secondary,#aaa);">No panels registered yet.</div>`;
    }
    const rows = [...ctx.panels]
      .sort((a, b) => severityRank(b.status) - severityRank(a.status) || a.panelId.localeCompare(b.panelId))
      .map((p) => this.renderPanelRow(p));
    return `<div style="padding:8px 12px;display:flex;flex-direction:column;gap:4px;">${rows.join('')}</div>`;
  }

  private renderPanelRow(p: PanelHealth): string {
    const color = STATUS_COLOR[p.status];
    const icon = STATUS_ICON[p.status];
    const ageStr = p.staleAgeMs === undefined ? '—' : formatAge(p.staleAgeMs);
    const errorStr = p.lastError ? ` · err: ${escapeHtml(p.lastError)}` : '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 6px;border-bottom:1px dotted var(--border-subtle,#222);font-size:12px;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="color:${color};width:14px;">${icon}</span>
        <span>${escapeHtml(p.label ?? p.panelId)}</span>
        <span style="color:var(--text-secondary,#aaa);font-size:10px;">${p.mounted ? '' : ' (unmounted)'}</span>
      </div>
      <div style="color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;font-size:11px;">${ageStr}${errorStr}</div>
    </div>`;
  }

  private renderNotifications(ctx: DiagnosticContext): string {
    const s = ctx.notifSummary;
    const reasons = Object.entries(s.suppressedByReason).sort((a, b) => b[1] - a[1]);
    const reasonHtml = reasons.length === 0
      ? `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No suppressions recorded.</div>`
      : `<ul style="margin:0;padding-left:18px;font-size:12px;">${reasons.map(([r, n]) => `<li><strong>${n}</strong> · ${escapeHtml(r)}</li>`).join('')}</ul>`;
    const unsafeHtml = s.unsafeSuppressions.length === 0
      ? ''
      : `<div style="margin-top:10px;padding:8px;background:#3a0000;border-left:3px solid var(--severity-critical);border-radius:3px;">
        <div style="font-size:11px;text-transform:uppercase;color:#ff6666;margin-bottom:4px;">Unsafe suppressions</div>
        ${s.unsafeSuppressions.map((u) => `<div style="font-size:11px;color:#fff;">${escapeHtml(u.candidateId)} · ${escapeHtml(u.reason)}</div>`).join('')}
      </div>`;
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
        ${this.renderTallyCell('Candidates', s.candidates, s.candidates)}
        ${this.renderTallyCell('Dispatched', s.dispatched, s.candidates)}
        ${this.renderTallyCell('Unsafe', s.unsafeSuppressions.length, s.candidates)}
      </div>
      <div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Suppressed by reason</div>
        ${reasonHtml}
      </div>
      ${unsafeHtml}
    </div>`;
  }

  private renderFeeds(ctx: DiagnosticContext): string {
    const corroboration = this.renderSourceCorroboration();
    if (ctx.feedAudit.entries.length === 0) {
      return `${corroboration}<div style="padding:12px;color:var(--text-secondary,#aaa);">No feeds configured.</div>`;
    }
    const rows = [...ctx.feedAudit.entries]
      .sort((a, b) => Number(b.safetyCritical) - Number(a.safetyCritical) || severityRankFeed(b.level) - severityRankFeed(a.level))
      .map((e) => this.renderFeedRow(e));
    return `${corroboration}<div style="padding:8px 12px;display:flex;flex-direction:column;gap:6px;">${rows.join('')}</div>`;
  }

  /** Per-domain source-corroboration verdicts from the provider-redundancy
   *  report — "verified by N independent sources" vs "single source / disagree". */
  private renderSourceCorroboration(): string {
    let vm;
    try {
      vm = buildRedundancyView(getProviderRedundancyReport());
    } catch {
      return '';
    }
    if (vm.rows.length === 0) return '';
    const rows = vm.rows.map((r) => {
      const color = redundancyToneColor(r.tone);
      const corro = corroborationSummary(r);
      const remediation = r.remediation
        ? `<div style="font-size:11px;color:var(--accent,#4a9eff);margin-top:3px;">→ ${escapeHtml(r.remediation)}</div>`
        : '';
      return `<div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px 10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="color:${color};font-weight:600;">${escapeHtml(r.label)}</span>
            <span style="font-weight:600;">${escapeHtml(r.domain)}</span>
          </div>
          <span style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(corro)} · conf ${r.confidencePct}%</span>
        </div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(r.detail)}</div>
        ${remediation}
      </div>`;
    }).join('');
    return `<div style="padding:8px 12px;display:flex;flex-direction:column;gap:6px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;">Source corroboration — ${escapeHtml(vm.headline)}</div>
      ${rows}
    </div>`;
  }

  private renderFeedRow(e: FeedAuditEntry): string {
    const color = feedColor(e.level);
    const safety = e.safetyCritical ? `<span style="font-size:9px;padding:1px 4px;background:var(--severity-critical);color:#fff;border-radius:2px;margin-left:6px;">SAFETY</span>` : '';
    const remediation = e.remediation ? `<div style="font-size:11px;color:var(--accent,#4a9eff);margin-top:3px;">→ ${escapeHtml(e.remediation)}</div>` : '';
    return `<div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px 10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="color:${color};">${escapeHtml(e.level.toUpperCase())}</span>
          <span style="font-weight:600;">${escapeHtml(e.label)}</span>
          ${safety}
        </div>
        <span style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(e.purpose)}</span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(e.reason)}</div>
      ${remediation}
    </div>`;
  }

  private renderSelfTest(): string {
    const reportHtml = this.selfTestReport
      ? this.renderSelfTestResults(this.selfTestReport)
      : `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No self-test report yet. Click below to run.</div>`;
    const btnLabel = this.selfTestRunning ? 'Running…' : 'Run self-test';
    const btnDisabled = this.selfTestRunning ? 'disabled' : '';
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      <div>
        <button class="syd-self-test" ${btnDisabled} style="padding:6px 10px;background:var(--accent,#4a9eff);color:#fff;border:none;border-radius:3px;cursor:${this.selfTestRunning ? 'wait' : 'pointer'};font-size:12px;">${btnLabel}</button>
      </div>
      ${reportHtml}
      <div style="border-top:1px solid var(--border-subtle,#222);padding-top:10px;">
        ${this.renderSidecarSelfTest()}
      </div>
    </div>`;
  }

  private renderSidecarSelfTest(): string {
    const sst = this.sidecarSelfTest;
    const btnLabel = sst.running ? 'Running sidecar probe…' : 'Run sidecar self-test';
    const btnDisabled = sst.running ? 'disabled' : '';
    const header = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted,#888);letter-spacing:0.05em;">Sidecar fan-out probe</div>
      <button class="syd-sidecar-self-test" ${btnDisabled}
        style="padding:6px 10px;background:transparent;color:var(--text);border:1px solid var(--border-strong,#444);border-radius:3px;cursor:${sst.running ? 'wait' : 'pointer'};font-size:11px;">${btnLabel}</button>
    </div>`;
    if (sst.error && sst.results.length === 0) {
      return `${header}<div style="color:var(--severity-high);font-size:11px;">⚠ ${escapeHtml(sst.error)}</div>`;
    }
    if (sst.results.length === 0 && !sst.summary) {
      return `${header}<div style="font-size:11px;color:var(--text-secondary,#aaa);">Probes /api/health, /api/spaceweather/status, /api/freight-stress, /api/security/cves, and 6 more — reports pass/fail + latency per route.</div>`;
    }
    return `${header}${this.renderSidecarSelfTestResults(sst.results, sst.summary)}`;
  }

  private renderSidecarSelfTestResults(
    results: SidecarSelfTestResult[],
    summary: SidecarSelfTestSummary | null,
  ): string {
    const top = summary ? `<div style="font-size:11px;font-weight:700;color:${VERDICT_BADGE[overallVerdict(summary)].color};margin-bottom:6px;">
      ${VERDICT_BADGE[overallVerdict(summary)].icon} ${summary.ok} ok · ${summary.degraded} degraded · ${summary.fail} fail · ${summary.total} total
    </div>` : '';
    const rows = results.map((r) => {
      const badge = VERDICT_BADGE[r.verdict];
      const errLine = r.error
        ? `<span style="color:var(--severity-high);font-size:10px;margin-left:8px;">${escapeHtml(r.error)}</span>`
        : '';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 6px;border-bottom:1px dotted var(--border-subtle,#222);font-size:11px;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <span style="color:${badge.color};font-weight:700;width:54px;display:inline-block;">${badge.icon} ${escapeHtml(badge.label)}</span>
          <code style="color:var(--text);font-family:ui-monospace,monospace;font-size:10px;">${escapeHtml(r.route)}</code>
          ${errLine}
        </div>
        <div style="color:var(--text-secondary,#aaa);font-size:10px;font-variant-numeric:tabular-nums;white-space:nowrap;">
          HTTP ${r.status === 0 ? '—' : r.status} · ${escapeHtml(formatLatency(r.latencyMs))}
        </div>
      </div>`;
    }).join('');
    return `<div>${top}${rows}</div>`;
  }

  private renderSelfTestResults(r: SelfTestReport): string {
    const overallColor = selfTestStatusColor(r.status);
    const rows = r.results.map((res: SelfTestReport['results'][number]) => {
      const c = selfTestStatusColor(res.status);
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 6px;border-bottom:1px dotted var(--border-subtle,#222);font-size:12px;">
        <div><span style="color:${c};font-weight:700;text-transform:uppercase;font-size:10px;width:54px;display:inline-block;">${escapeHtml(res.status)}</span> ${escapeHtml(res.label)}</div>
        <div style="color:var(--text-secondary,#aaa);font-size:11px;">${escapeHtml(res.reason)}</div>
      </div>`;
    }).join('');
    return `<div>
      <div style="font-size:12px;color:${overallColor};font-weight:700;margin-bottom:6px;">${escapeHtml(r.summary)}</div>
      ${rows}
    </div>`;
  }

  private severityColor(severity: string): string {
    if (severity === 'critical' || severity === 'error') return 'var(--severity-critical)';
    if (severity === 'warning') return 'var(--severity-high)';
    if (severity === 'info') return 'var(--severity-ok)';
    return 'var(--severity-info)';
  }

  private async exportDiagnosticsJson(): Promise<void> {
    try {
      const { composeFrontendDiagnosticsExport } = await import(
        '@/services/diagnostics/frontend-export-composer'
      );
      const g = globalThis as unknown as { __APP_VERSION__?: string; __APP_VARIANT__?: string; __TAURI_INTERNALS__?: unknown };
      const app = {
        variant: g.__APP_VARIANT__ ?? 'full',
        version: g.__APP_VERSION__ ?? '0.0.0',
        runtime: (g.__TAURI_INTERNALS__ === undefined ? 'web' : 'desktop') as 'web' | 'desktop',
      };
      const { bundle } = composeFrontendDiagnosticsExport({ app });
      const { exportBundleToJson } = await import('@/services/diagnostics/export-bundle');
      const json = exportBundleToJson(bundle);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `crystal-ball-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.warn('[SystemDiagnosticPanel] export failed:', error);
    }
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    for (const tabBtn of root.querySelectorAll<HTMLButtonElement>('.syd-tab')) {
      tabBtn.addEventListener('click', () => {
        const next = tabBtn.dataset.tab as Tab | undefined;
        if (next && next !== this.activeTab) {
          this.activeTab = next;
          this.render();
        }
      });
    }
    const refresh = root.querySelector<HTMLButtonElement>('.syd-refresh');
    refresh?.addEventListener('click', () => this.render());
    const sidecarBtn = root.querySelector<HTMLButtonElement>('.syd-sidecar-self-test');
    sidecarBtn?.addEventListener('click', async () => {
      if (this.sidecarSelfTest.running) return;
      this.sidecarSelfTest = { ...this.sidecarSelfTest, running: true, error: null };
      this.render();
      try {
        const resp = await fetchSidecarSelfTest();
        this.sidecarSelfTest = {
          running: false,
          asOf: resp.asOf,
          results: resp.results,
          summary: resp.summary,
          error: resp.error ?? null,
        };
      } catch (error) {
        this.sidecarSelfTest = {
          running: false,
          asOf: new Date().toISOString(),
          results: [],
          summary: null,
          error: String((error as Error)?.message ?? error),
        };
      } finally {
        this.render();
      }
    });
    const exportBtn = root.querySelector<HTMLButtonElement>('.syd-export');
    exportBtn?.addEventListener('click', () => void this.exportDiagnosticsJson());
    const stBtn = root.querySelector<HTMLButtonElement>('.syd-self-test');
    stBtn?.addEventListener('click', async () => {
      if (this.selfTestRunning) return;
      this.selfTestRunning = true;
      this.render();
      try {
        const defs = standardSelfTestDefinitions({
          // Sidecar reachability — fetch /api/diag (relative on web).
          fetchSidecarDiag: async () => {
            try {
              const r = await fetch(`${getApiBaseUrl()}/api/diag`);
              if (!r.ok) return { ok: false, reason: `/api/diag returned ${r.status}` };
              const detail = (await r.json().catch(() => undefined)) as Record<string, unknown> | undefined;
              return { ok: true, detail };
            } catch (error) {
              return { ok: false, reason: error instanceof Error ? error.message : String(error) };
            }
          },
          // SAFETY: "can critical alerts reach me?" — the headline probe.
          checkNotificationPermission: () => {
            if (typeof Notification === 'undefined') return Promise.resolve('unsupported' as const);
            const p = Notification.permission;
            let state: 'granted' | 'denied' | 'default';
            if (p === 'granted') state = 'granted';
            else if (p === 'denied') state = 'denied';
            else state = 'default';
            return Promise.resolve(state);
          },
          countSavedPlaces: () => getSavedPlaces().length,
          // Proves the NWS point-in-polygon matcher actually works.
          runNwsPolygonFixture: () => Promise.resolve(runNwsPolygonSelfTestFixture()),
          // Static provider catalog (not live health — empty pre-fetch would false-fail).
          countProviderRegistry: () => PROVIDER_DEFINITIONS.length,
          isStorageAvailable: () => ({
            indexedDb: typeof indexedDB !== 'undefined',
            localStorage: (() => {
              try {
                const k = '__cb_selftest__';
                localStorage.setItem(k, '1');
                localStorage.removeItem(k);
                return true;
              } catch {
                return false;
              }
            })(),
          }),
          probeDataSources: () => {
            const sources = getLiveDiagnosticsSnapshot().sources;
            let healthy = 0;
            let degraded = 0;
            let failing = 0;
            for (const s of sources) {
              if (s.status === 'healthy') healthy++;
              else if (s.status === 'degraded' || s.status === 'stale') degraded++;
              else if (s.status === 'failing' || s.status === 'unsafe' || s.status === 'blind') failing++;
            }
            return Promise.resolve({ healthy, degraded, failing, detail: { total: sources.length } });
          },
          countMountedPanels: () => {
            const all = getPanelHealthRegistry().all();
            return { mounted: all.filter((p) => p.mounted).length, total: all.length };
          },
          countRecentRendererErrors: (windowMs: number) => {
            const events = getDiagnosticEventBus().query();
            const now = Date.now();
            return events.filter(
              (e) => (e.severity === 'error' || e.severity === 'critical') && now - e.at <= windowMs,
            ).length;
          },
        });
        // Deadman: the registries above are only trustworthy while the 60s
        // degradation tick keeps refreshing them. If it stops, they freeze on
        // their last value and read green — so fail loudly when the heartbeat
        // is stale (> 3× the 60s tick).
        defs.push(
          {
            id: 'diagnostics_liveness',
            label: 'Diagnostics liveness',
            probe: () => {
              const ageMs = diagnosticsHeartbeatAgeMs();
              if (!Number.isFinite(ageMs)) {
                return { status: 'warn' as const, reason: 'Diagnostics tick has not run yet (still booting).' };
              }
              if (ageMs > 180_000) {
                return {
                  status: 'fail' as const,
                  reason: `Diagnostics tick last ran ${Math.round(ageMs / 1000)}s ago — health registries may be frozen (their green is stale).`,
                };
              }
              return { status: 'pass' as const, reason: `Diagnostics tick fresh (${Math.round(ageMs / 1000)}s ago).` };
            },
          },
          {
            id: 'webcam_sources',
            label: 'Webcam sources',
            probe: async () => {
              let json: { sourceHealth?: { source: string; status: string }[] };
              try {
                const res = await fetch(`${getApiBaseUrl()}/api/webcams`);
                if (!res.ok) {
                  return { status: 'fail' as const, reason: `/api/webcams returned ${res.status}` };
                }
                json = (await res.json()) as typeof json;
              } catch (error) {
                return {
                  status: 'fail' as const,
                  reason: error instanceof Error ? error.message : String(error),
                };
              }
              const sources = json.sourceHealth ?? [];
              const ok = sources.filter((s) => s.status === 'ok');
              const degraded = sources.filter(
                (s) => s.status === 'missing_key' || s.status === 'down' || s.status === 'rate_limited',
              );
              if (ok.length >= 1) {
                return {
                  status: 'pass' as const,
                  reason: `${ok.length} webcam source${ok.length === 1 ? '' : 's'} healthy.`,
                };
              }
              if (degraded.length > 0) {
                return {
                  status: 'warn' as const,
                  reason: `Degraded webcam sources: ${degraded.map((s) => `${s.source}(${s.status})`).join(', ')}.`,
                };
              }
              return { status: 'fail' as const, reason: 'All webcam sources are down or none reported.' };
            },
          },
        );
        this.selfTestReport = await runSelfTests(defs);
      } finally {
        this.selfTestRunning = false;
        this.render();
      }
    });
  }
}

interface DiagnosticContext {
  report: ReturnType<typeof aggregateSystemHealth>;
  features: FeatureHealth[];
  panels: PanelHealth[];
  notifSummary: ReturnType<ReturnType<typeof getNotificationTraceRegistry>['summary']>;
  feedAudit: ReturnType<typeof auditFeeds>;
  recentEvents: ReturnType<ReturnType<typeof getDiagnosticEventBus>['query']>;
  unhealthyCount: number;
}

const SEVERITY_RANK: Record<HealthStatus, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  stale: 3,
  blind: 4,
  failing: 5,
  unsafe: 6,
};

function severityRank(s: HealthStatus): number {
  return SEVERITY_RANK[s];
}

const FEED_RANK = { fresh: 0, unknown: 1, stale: 2, late: 3, silent: 4 } as const;

function severityRankFeed(level: keyof typeof FEED_RANK): number {
  return FEED_RANK[level];
}

function feedColor(level: keyof typeof FEED_RANK): string {
  switch (level) {
    case 'fresh': {   return 'var(--severity-ok)';
    }
    case 'stale': {   return 'var(--severity-high)';
    }
    case 'late': {    return 'var(--severity-high)';
    }
    case 'silent': {  return 'var(--severity-critical)';
    }
    case 'unknown': { return 'var(--severity-info)';
    }
  }
}

function redundancyToneColor(tone: RedundancyTone): string {
  switch (tone) {
    case 'good': { return 'var(--severity-ok)';
    }
    case 'warn': { return 'var(--severity-high)';
    }
    case 'bad': {  return 'var(--severity-critical)';
    }
    case 'neutral': { return 'var(--severity-info)';
    }
  }
}

function pickTallyColor(healthy: number, total: number): string {
  if (total === 0) return 'var(--severity-high)';
  if (healthy === total) return 'var(--severity-ok)';
  if (healthy === 0) return 'var(--severity-critical)';
  return 'var(--severity-high)';
}

function selfTestStatusColor(status: string): string {
  if (status === 'pass') return 'var(--severity-ok)';
  if (status === 'warn') return 'var(--severity-high)';
  if (status === 'fail') return 'var(--severity-critical)';
  return 'var(--severity-info)';
}

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${(ms / (60 * 60_000)).toFixed(1)}h ago`;
  return `${(ms / (24 * 60 * 60_000)).toFixed(1)}d ago`;
}

function missionStateColor(state: MissionState): string {
  if (state === 'CRITICAL') return 'var(--severity-critical)';
  if (state === 'DEGRADED') return 'var(--severity-high)';
  return 'var(--severity-ok)';
}

