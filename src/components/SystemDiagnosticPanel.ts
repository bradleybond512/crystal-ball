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
import {
  auditFeeds,
  type FeedAuditEntry,
} from '@/services/diagnostics/sentinel-feed-audit';
import {
  runSelfTests,
  standardSelfTestDefinitions,
  type SelfTestReport,
} from '@/services/diagnostics/self-test';
import type {
  FeatureHealth,
  HealthStatus,
  PanelHealth,
} from '@/services/diagnostics/system-health-types';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 5000;

type Tab = 'overview' | 'features' | 'panels' | 'notifications' | 'feeds' | 'self_test';

const STATUS_COLOR: Record<HealthStatus, string> = {
  healthy: '#4caf50',
  degraded: '#ffeb3b',
  stale: '#ff9800',
  failing: '#f44336',
  unsafe: '#d50000',
  blind: '#607d8b',
  unknown: '#9e9e9e',
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
  private activeTab: Tab = 'overview';
  private selfTestRunning = false;
  private selfTestReport: SelfTestReport | undefined;

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
  }

  public dispose(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private render(): void {
    try {
      const html = this.buildHtml();
      this.setContent(html);
      queueMicrotask(() => this.wireHandlers());
    } catch (error) {
      console.warn('[SystemDiagnosticPanel] render failed:', error);
      this.setContent(`<div style="padding:12px;color:#f44336;">Diagnostic render error: ${escapeHtml(String(error))}</div>`);
    }
  }

  private buildHtml(): string {
    const ctx = this.collect();
    this.setCount(ctx.unhealthyCount);
    return `${this.renderHeader(ctx)}${this.renderTabs()}${this.renderActiveTab(ctx)}`;
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
    return `<div class="syd-header" style="padding:8px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;justify-content:space-between;align-items:center;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};"></span>
        <span style="font-weight:700;color:${color};text-transform:uppercase;font-size:12px;">${status}</span>
        <span style="color:var(--text-secondary,#aaa);font-size:12px;">${escapeHtml(ctx.report.summary)}</span>
      </div>
      <button class="syd-refresh" style="font-size:11px;padding:3px 8px;background:transparent;color:var(--text-secondary,#aaa);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Refresh</button>
    </div>`;
  }

  private renderTabs(): string {
    const tabs: { id: Tab; label: string }[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'features', label: 'Features' },
      { id: 'panels', label: 'Panels' },
      { id: 'notifications', label: 'Notifications' },
      { id: 'feeds', label: 'Feeds' },
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
      case 'self_test': {
        return this.renderSelfTest();
      }
    }
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
    const criticalBadge = f.critical ? `<span style="font-size:9px;padding:1px 4px;background:#d50000;color:#fff;border-radius:2px;margin-left:6px;">CRITICAL</span>` : '';
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
      : `<div style="margin-top:10px;padding:8px;background:#3a0000;border-left:3px solid #d50000;border-radius:3px;">
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
    if (ctx.feedAudit.entries.length === 0) {
      return `<div style="padding:12px;color:var(--text-secondary,#aaa);">No feeds configured.</div>`;
    }
    const rows = [...ctx.feedAudit.entries]
      .sort((a, b) => Number(b.safetyCritical) - Number(a.safetyCritical) || severityRankFeed(b.level) - severityRankFeed(a.level))
      .map((e) => this.renderFeedRow(e));
    return `<div style="padding:8px 12px;display:flex;flex-direction:column;gap:6px;">${rows.join('')}</div>`;
  }

  private renderFeedRow(e: FeedAuditEntry): string {
    const color = feedColor(e.level);
    const safety = e.safetyCritical ? `<span style="font-size:9px;padding:1px 4px;background:#d50000;color:#fff;border-radius:2px;margin-left:6px;">SAFETY</span>` : '';
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
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:10px;">
      <div>
        <button class="syd-self-test" ${btnDisabled} style="padding:6px 10px;background:var(--accent,#4a9eff);color:#fff;border:none;border-radius:3px;cursor:${this.selfTestRunning ? 'wait' : 'pointer'};font-size:12px;">${btnLabel}</button>
      </div>
      ${reportHtml}
    </div>`;
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
    if (severity === 'critical' || severity === 'error') return '#f44336';
    if (severity === 'warning') return '#ff9800';
    if (severity === 'info') return '#4caf50';
    return '#9e9e9e';
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
    const stBtn = root.querySelector<HTMLButtonElement>('.syd-self-test');
    stBtn?.addEventListener('click', async () => {
      if (this.selfTestRunning) return;
      this.selfTestRunning = true;
      this.render();
      try {
        const defs = standardSelfTestDefinitions({
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
    case 'fresh': {
      return '#4caf50';
    }
    case 'stale': {
      return '#ff9800';
    }
    case 'late': {
      return '#f44336';
    }
    case 'silent': {
      return '#d50000';
    }
    case 'unknown': {
      return '#9e9e9e';
    }
  }
}

function pickTallyColor(healthy: number, total: number): string {
  if (total === 0) return '#ff9800';
  if (healthy === total) return '#4caf50';
  if (healthy === 0) return '#f44336';
  return '#ff9800';
}

function selfTestStatusColor(status: string): string {
  if (status === 'pass') return '#4caf50';
  if (status === 'warn') return '#ff9800';
  if (status === 'fail') return '#f44336';
  return '#9e9e9e';
}

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${(ms / (60 * 60_000)).toFixed(1)}h ago`;
  return `${(ms / (24 * 60 * 60_000)).toFixed(1)}d ago`;
}
