/**
 * Shadow-Mode Panel — surfaces every registered ShadowAlgorithm and
 * its current ShadowReport (agreement rate, avg delta, recommendation).
 *
 * Vanilla TS panel, no React. Subscribes to ShadowRunner events so
 * promote / retire / new-comparison events refresh the view without
 * polling.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getShadowRunner,
  type ShadowAlgorithm,
  type ShadowComparison,
  type ShadowRecommendation,
  type ShadowReport,
} from '@/services/intelligence/shadow-runner';

const RECOMMENDATION_COLOR: Record<ShadowRecommendation, string> = {
  promote: 'var(--severity-ok,#22c55e)',
  retire: 'var(--severity-high,#f87171)',
  'continue-monitoring': 'var(--severity-medium,#facc15)',
};

const RECOMMENDATION_LABEL: Record<ShadowRecommendation, string> = {
  promote: 'PROMOTE',
  retire: 'RETIRE',
  'continue-monitoring': 'MONITOR',
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--severity-critical,#dc2626)',
  high: 'var(--severity-high,#f87171)',
  medium: 'var(--severity-medium,#facc15)',
  low: 'var(--severity-info,#22c55e)',
};

const REFRESH_MS = 10_000;
const RECENT_COMPARISON_LIMIT = 15;

export class ShadowModePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private selectedAlgorithmId: string | null = null;

  constructor() {
    super({
      id: 'shadow-mode',
      title: 'Shadow Algorithms',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Runs experimental scoring variants in parallel with production. Compares agreement rate + delta to decide whether to promote a variant. Never affects live alerts.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = getShadowRunner().subscribe(() => this.render());
    this.attachHandlers();
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
      const runner = getShadowRunner();
      const algorithms = runner.getAllAlgorithms();
      const active = algorithms.filter((a) => a.isActive && !a.promotedAt && !a.retiredAt);
      this.setCount(active.length);
      if (algorithms.length === 0) {
        this.setContent(this.renderEmpty());
        return;
      }
      this.ensureSelection(algorithms);
      const reports = runner.getAllReports();
      const selectedReport = this.selectedAlgorithmId
        ? reports.find((r) => r.shadowAlgorithmId === this.selectedAlgorithmId)
        : undefined;
      const recent = this.selectedAlgorithmId
        ? this.sortRecent(runner.getComparisons(this.selectedAlgorithmId))
          .slice(0, RECENT_COMPARISON_LIMIT)
        : [];
      this.setContent(this.buildHtml(algorithms, reports, selectedReport, recent));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Shadow-mode render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private ensureSelection(algorithms: readonly ShadowAlgorithm[]): void {
    if (this.selectedAlgorithmId && algorithms.some((a) => a.id === this.selectedAlgorithmId)) return;
    this.selectedAlgorithmId = algorithms[0]?.id ?? null;
  }

  private sortRecent(comparisons: readonly ShadowComparison[]): ShadowComparison[] {
    return [...comparisons].sort((a, b) => b.comparedAt.getTime() - a.comparedAt.getTime());
  }

  private renderEmpty(): string {
    return `<div style="padding:16px;display:flex;flex-direction:column;gap:8px;font-size:12px;color:var(--text-secondary,#aaa);">
      <div style="font-size:13px;font-weight:600;color:var(--text-primary,#fff);">No shadow algorithms registered</div>
      <div>Register a ShadowAlgorithm via <code>getShadowRunner().registerAlgorithm()</code> to see comparisons here.</div>
    </div>`;
  }

  private buildHtml(
    algorithms: readonly ShadowAlgorithm[],
    reports: readonly ShadowReport[],
    selectedReport: ShadowReport | undefined,
    recent: readonly ShadowComparison[],
  ): string {
    const reportById = new Map(reports.map((r) => [r.shadowAlgorithmId, r]));
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;font-size:12px;">
      ${this.renderAlgorithmsList(algorithms, reportById)}
      ${selectedReport ? this.renderSelectedReport(selectedReport, recent) : ''}
    </div>`;
  }

  private renderAlgorithmsList(
    algorithms: readonly ShadowAlgorithm[],
    reportById: ReadonlyMap<string, ShadowReport>,
  ): string {
    const rows = algorithms.map((a) => this.renderAlgorithmRow(a, reportById.get(a.id))).join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;">${rows}</div>`;
  }

  private renderAlgorithmRow(algo: ShadowAlgorithm, report?: ShadowReport): string {
    const isSelected = algo.id === this.selectedAlgorithmId;
    const recommendation = report?.recommendation ?? 'continue-monitoring';
    const recColor = RECOMMENDATION_COLOR[recommendation];
    const recLabel = RECOMMENDATION_LABEL[recommendation];
    const { status, statusColor } = lifecycleBadge(algo);
    const agreementPct = report ? Math.round(report.agreementRate * 100) : 0;
    const avgDelta = report ? report.avgDelta.toFixed(3) : '0.000';
    const buttons = algo.promotedAt || algo.retiredAt
      ? ''
      : `<button class="shadow-action" data-action="promote" data-id="${escapeHtml(algo.id)}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(34,197,94,0.10);color:#22c55e;border-radius:3px;cursor:pointer;">Promote</button>
         <button class="shadow-action" data-action="retire" data-id="${escapeHtml(algo.id)}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(248,113,113,0.10);color:#f87171;border-radius:3px;cursor:pointer;">Retire</button>`;
    return `<div class="shadow-algo" data-id="${escapeHtml(algo.id)}" style="padding:10px 12px;border:1px solid ${isSelected ? 'var(--accent,#4a9eff)' : 'var(--border-subtle,#333)'};border-radius:4px;background:rgba(255,255,255,0.02);cursor:pointer;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <strong style="font-size:13px;">${escapeHtml(algo.name)}</strong>
        <span style="font-family:ui-monospace,monospace;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(algo.id)}@${escapeHtml(algo.version)}</span>
        <span style="font-size:10px;color:${statusColor};font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(status)}</span>
        <span style="margin-left:auto;font-size:10px;padding:1px 6px;border-radius:3px;background:${recColor}22;color:${recColor};font-weight:700;letter-spacing:0.04em;">${escapeHtml(recLabel)}</span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(algo.description)}</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;font-size:11px;margin-top:8px;">
        <span><strong>${report?.totalComparisons ?? 0}</strong> comparisons</span>
        <span><strong>${agreementPct}%</strong> agreement</span>
        <span><strong>Δ ${avgDelta}</strong></span>
        ${buttons ? `<span style="margin-left:auto;display:flex;gap:6px;">${buttons}</span>` : ''}
      </div>
    </div>`;
  }

  private renderSelectedReport(report: ShadowReport, recent: readonly ShadowComparison[]): string {
    return `<div style="display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;">
      ${this.renderDomainBreakdown(report)}
      ${this.renderRecent(recent)}
    </div>`;
  }

  private renderDomainBreakdown(report: ShadowReport): string {
    const entries = Object.entries(report.domainBreakdown);
    if (entries.length === 0) {
      return '<div style="font-size:11px;color:var(--text-secondary,#aaa);">No domain comparisons recorded yet.</div>';
    }
    const sorted = [...entries].sort((a, b) => b[1].count - a[1].count);
    const rows = sorted.map(([domain, entry]) => {
      const pct = Math.round(entry.agreementRate * 100);
      return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;">
        <span style="width:110px;color:var(--text-secondary,#aaa);text-overflow:ellipsis;white-space:nowrap;overflow:hidden;" title="${escapeHtml(domain)}">${escapeHtml(domain)}</span>
        <div style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:#60a5fa;"></div>
        </div>
        <span style="min-width:40px;text-align:right;">${pct}%</span>
        <span style="min-width:80px;text-align:right;color:var(--text-secondary,#aaa);">Δ ${entry.avgDelta.toFixed(3)} · ${entry.count}</span>
      </div>`;
    }).join('');
    return `<div style="display:flex;flex-direction:column;gap:4px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);">Domain breakdown</div>
      ${rows}
    </div>`;
  }

  private renderRecent(recent: readonly ShadowComparison[]): string {
    if (recent.length === 0) {
      return '<div style="font-size:11px;color:var(--text-secondary,#aaa);">No comparisons recorded yet.</div>';
    }
    const rows = recent.map((c) => this.renderComparisonRow(c)).join('');
    return `<div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);margin-bottom:4px;">Recent comparisons (latest ${recent.length})</div>
      <div style="display:flex;flex-direction:column;gap:3px;">${rows}</div>
    </div>`;
  }

  private renderComparisonRow(c: ShadowComparison): string {
    const prodColor = SEVERITY_COLOR[c.productionSeverity] ?? '#888';
    const shadowColor = SEVERITY_COLOR[c.shadowSeverity] ?? '#888';
    const agreement = c.agreement ? '✓' : '✗';
    const agreementColor = c.agreement ? 'var(--severity-ok,#22c55e)' : 'var(--severity-high,#f87171)';
    const deltaStr = (c.delta >= 0 ? '+' : '') + c.delta.toFixed(3);
    return `<div style="display:flex;align-items:center;gap:6px;font-size:11px;padding:3px 6px;background:rgba(255,255,255,0.02);border-radius:3px;">
      <span style="min-width:80px;font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);" title="${escapeHtml(c.domain)}">${escapeHtml(truncate(c.domain, 12))}</span>
      <span style="color:${prodColor};text-transform:uppercase;font-weight:700;min-width:60px;">${escapeHtml(c.productionSeverity)}</span>
      <span style="color:var(--text-secondary,#aaa);">→</span>
      <span style="color:${shadowColor};text-transform:uppercase;font-weight:700;min-width:60px;">${escapeHtml(c.shadowSeverity)}</span>
      <span style="margin-left:auto;color:var(--text-secondary,#aaa);">${deltaStr}</span>
      <span style="color:${agreementColor};font-weight:700;width:14px;text-align:right;">${agreement}</span>
    </div>`;
  }

  // ── Event handlers ───────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const actionBtn = target.closest<HTMLElement>('.shadow-action');
    if (actionBtn) {
      event.stopPropagation();
      this.handleAction(actionBtn);
      return;
    }
    const row = target.closest<HTMLElement>('.shadow-algo');
    if (!row) return;
    const id = row.dataset.id;
    if (id) {
      this.selectedAlgorithmId = id;
      this.render();
    }
  }

  private handleAction(btn: HTMLElement): void {
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (!action || !id) return;
    const runner = getShadowRunner();
    if (action === 'promote') {
      const confirmed = typeof window === 'undefined'
        || typeof window.confirm !== 'function'
        || window.confirm(`Promote ${id}? This marks the variant for production rollout and stops further shadow comparisons.`);
      if (!confirmed) return;
      runner.promoteAlgorithm(id);
    } else if (action === 'retire') {
      const confirmed = typeof window === 'undefined'
        || typeof window.confirm !== 'function'
        || window.confirm(`Retire ${id}? This stops shadow comparisons for this variant.`);
      if (!confirmed) return;
      runner.retireAlgorithm(id);
    }
    this.render();
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function lifecycleBadge(algo: ShadowAlgorithm): { status: string; statusColor: string } {
  if (algo.promotedAt) {
    return { status: 'PROMOTED', statusColor: 'var(--severity-ok,#22c55e)' };
  }
  if (algo.retiredAt) {
    return { status: 'RETIRED', statusColor: 'var(--severity-high,#f87171)' };
  }
  if (algo.isActive) {
    return { status: 'ACTIVE', statusColor: 'var(--text-secondary,#aaa)' };
  }
  return { status: 'INACTIVE', statusColor: 'var(--text-secondary,#aaa)' };
}
