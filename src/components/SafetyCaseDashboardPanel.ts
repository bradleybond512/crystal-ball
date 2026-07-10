/**
 * Safety Case Dashboard Panel (panel id: `safety-case-dashboard`).
 *
 * Overall pass-rate gauge + per-property row with pass-rate bar,
 * trend arrow, last-checked age. A "Run All Checks" button fires
 * the 8 heuristics against a stub Situation so the panel is useful
 * even before the upstream wiring lands. Recent failures expand
 * into a list at the bottom.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getSafetyCaseDashboardService,
  type SafetyCaseSummary,
  type SafetyPropertySummary,
  type SafetyTrend,
} from '@/services/intelligence/safety-case-dashboard';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;

const TREND_ICON: Record<SafetyTrend, string> = {
  improving: '↑',
  stable: '→',
  degrading: '↓',
};
const TREND_COLOR: Record<SafetyTrend, string> = {
  improving: '#2ec27e',
  stable: '#9ca3af',
  degrading: '#e94f37',
};

export class SafetyCaseDashboardPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listener: ((summary: SafetyCaseSummary) => void) | null = null;
  private failuresExpanded = false;

  constructor() {
    super({
      id: 'safety-case-dashboard',
      title: 'Safety Case',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        '8 safety-property checks across active Situations. Pass-rate gauge + per-property trend. Run All Checks fires the heuristics on demand.',
    });
    const svc = getSafetyCaseDashboardService();
    this.listener = () => this.render();
    svc.subscribe(this.listener);
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.listener) {
      getSafetyCaseDashboardService().unsubscribe(this.listener);
      this.listener = null;
    }
    super.destroy();
  }

  private render(): void {
    const svc = getSafetyCaseDashboardService();
    const summary = svc.getSummary();
    // Badge count reflects only real failures, not not_implemented stubs.
    this.setCount(summary.criticalFailures.length);
    this.setContent(this.buildHtml(summary), () => this.wireHandlers());
  }

  private buildHtml(summary: SafetyCaseSummary): string {
    return `<div class="sc-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderHeader(summary)}
      ${this.renderProperties(summary.propertySummaries)}
      ${this.renderFailures(summary.criticalFailures, summary.notImplementedCount)}
    </div>`;
  }

  private renderHeader(summary: SafetyCaseSummary): string {
    const pct = summary.overallPassRate * 100;
    const color = pctColor(pct);
    return `<div style="display:flex;flex-direction:column;gap:5px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;">Overall pass rate</span>
        <button class="sc-run-all" type="button" style="padding:3px 10px;background:rgba(74,158,255,0.18);color:inherit;border:1px solid rgba(74,158,255,0.4);border-radius:3px;cursor:pointer;font-size:11px;">Run All Checks</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="flex:1;height:10px;border-radius:5px;background:rgba(255,255,255,0.06);overflow:hidden;">
          <div style="width:${pct.toFixed(0)}%;height:100%;background:${color};"></div>
        </div>
        <span style="font-size:13px;color:${color};font-weight:700;">${pct.toFixed(0)}%</span>
      </div>
      <div style="font-size:10px;opacity:0.6;">${summary.totalChecks} total checks · ${summary.criticalFailures.length} recent failure${summary.criticalFailures.length === 1 ? '' : 's'}${summary.notImplementedCount > 0 ? ` · ${summary.notImplementedCount} not implemented` : ''}</div>
    </div>`;
  }

  private renderProperties(props: readonly SafetyPropertySummary[]): string {
    return `<div style="display:flex;flex-direction:column;gap:4px;">${props.map((p) => this.renderPropertyRow(p)).join('')}</div>`;
  }

  private renderPropertyRow(p: SafetyPropertySummary): string {
    const allNotImplemented = p.totalChecks > 0 && p.notImplementedCount === p.totalChecks;
    const pct = p.passRate * 100;
    const color = (p.totalChecks === 0 || allNotImplemented) ? '#666' : pctColor(pct);
    const trendIcon = TREND_ICON[p.trend];
    const trendColor = TREND_COLOR[p.trend];
    const last = p.lastCheckedAt
      ? ageLabel(new Date(p.lastCheckedAt), Date.now())
      : '—';
    const statusLabel = allNotImplemented
      ? 'not implemented'
      : `${p.passCount}/${p.totalChecks - p.notImplementedCount}`;
    return `<div style="border-left:3px solid ${color};background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;padding:5px 8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <span style="font-family:ui-monospace,monospace;font-size:11px;color:#ddd;">${escapeHtml(p.propertyId)}</span>
        <span style="display:flex;align-items:center;gap:6px;font-size:10px;opacity:0.7;">
          <span style="${allNotImplemented ? 'color:#9ca3af;font-style:italic;' : ''}">${escapeHtml(statusLabel)}</span>
          <span style="color:${trendColor};font-size:13px;">${trendIcon}</span>
          <span>last ${escapeHtml(last)}</span>
        </span>
      </div>
      <div style="height:4px;border-radius:2px;background:rgba(255,255,255,0.06);overflow:hidden;margin-top:3px;">
        <div style="width:${(p.totalChecks === 0 || allNotImplemented) ? 0 : pct.toFixed(0)}%;height:100%;background:${color};"></div>
      </div>
    </div>`;
  }

  private renderFailures(failures: readonly SafetyCheckResult[], notImplementedCount: number): string {
    if (failures.length === 0) {
      if (notImplementedCount > 0) {
        return `<div style="font-size:11px;opacity:0.55;padding:6px 0;text-align:center;">No failures in implemented checks · ${notImplementedCount} check${notImplementedCount === 1 ? '' : 's'} not yet implemented.</div>`;
      }
      return `<div style="font-size:11px;opacity:0.55;padding:6px 0;text-align:center;">No recent failures — invariants holding.</div>`;
    }
    const toggleLabel = this.failuresExpanded ? '▼ Hide' : `▶ Show recent failures (${failures.length})`;
    if (!this.failuresExpanded) {
      return `<button class="sc-toggle-failures" type="button" style="background:transparent;border:none;color:#e94f37;cursor:pointer;font-family:inherit;font-size:11px;text-align:left;padding:4px 0;">${escapeHtml(toggleLabel)}</button>`;
    }
    const rows = failures.map((f) => {
      const ts = ageLabel(new Date(f.checkedAt), Date.now());
      return `<div style="display:flex;gap:6px;font-size:11px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
        <span style="font-family:ui-monospace,monospace;color:#e94f37;width:140px;flex-shrink:0;">${escapeHtml(f.propertyId)}</span>
        <span style="opacity:0.65;flex:1;min-width:0;">${escapeHtml(f.evidence)}</span>
        <span style="opacity:0.55;flex-shrink:0;">${escapeHtml(ts)}</span>
      </div>`;
    }).join('');
    return `<div>
      <button class="sc-toggle-failures" type="button" style="background:transparent;border:none;color:#e94f37;cursor:pointer;font-family:inherit;font-size:11px;text-align:left;padding:4px 0;">${escapeHtml(toggleLabel)}</button>
      <div style="display:flex;flex-direction:column;">${rows}</div>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const svc = getSafetyCaseDashboardService();

    root.querySelector<HTMLButtonElement>('.sc-run-all')?.addEventListener('click', () => {
      svc.runChecks({
        id: `stub-${Date.now().toString(36)}`,
        severity: 'medium',
        domain: 'system',
        signals: [{ sourceId: 'self-test' }, { sourceId: 'panel-stub' }],
      });
    });

    root.querySelector<HTMLButtonElement>('.sc-toggle-failures')?.addEventListener('click', () => {
      this.failuresExpanded = !this.failuresExpanded;
      this.render();
    });
  }
}

interface SafetyCheckResult {
  propertyId: string;
  evidence: string;
  checkedAt: number;
}

function pctColor(pct: number): string {
  if (pct >= 90) return '#2ec27e';
  if (pct >= 70) return '#f5a524';
  return '#e94f37';
}

function ageLabel(then: Date, now: number): string {
  const ms = now - then.getTime();
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s ago`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}h ago`;
  return `${Math.round(ms / (24 * 60 * 60_000))}d ago`;
}
