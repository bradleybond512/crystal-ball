/**
 * Shadow Comparison Panel — operator view of the
 * ShadowModeAlgorithmService A/B ledger. Lists registered runs with
 * per-run divergence rates, enable/disable toggles, and expandable
 * comparison rows showing the live vs shadow output diff.
 *
 * Distinct from the older ShadowModePanel (built-in scoring variants).
 * This panel is the generic A/B ledger surface — any caller can
 * register a shadow run and post comparisons.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { renderPanelEmpty } from './ui/PanelStates';
import {
  getShadowModeAlgorithmService,
  type ShadowComparison,
  type ShadowRunConfig,
} from '@/services/intelligence/shadow-mode';

const REFRESH_MS = 10_000;
const RECENT_LIMIT = 20;

interface PanelState {
  expandedComparisonId: string | null;
  algorithmFilter: string;
}

export class ShadowComparisonPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private state: PanelState = { expandedComparisonId: null, algorithmFilter: 'all' };

  constructor() {
    super({
      id: 'shadow-comparison',
      title: 'Shadow Algorithm Comparison',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Generic A/B ledger: any caller can register a shadow algorithm and post (live, shadow) output pairs. The panel shows divergence rate per run and per-comparison diffs.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = getShadowModeAlgorithmService().subscribe(() => this.render());
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
      const svc = getShadowModeAlgorithmService();
      const runs = svc.getAllRuns();
      const stats = svc.stats();
      this.setCount(stats.enabledRuns);
      const filterAlgos = uniqueAlgorithms(runs);
      const recent = svc.getComparisons(
        this.state.algorithmFilter === 'all' ? {} : { algorithmId: this.state.algorithmFilter },
        RECENT_LIMIT,
      );
      this.setContent(this.buildHtml(runs, recent, stats, filterAlgos));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Shadow-mode render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(
    runs: readonly ShadowRunConfig[],
    recent: readonly ShadowComparison[],
    stats: ReturnType<ReturnType<typeof getShadowModeAlgorithmService>['stats']>,
    filterAlgos: readonly string[],
  ): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;font-size:12px;">
      ${this.renderHeader(stats)}
      ${this.renderRuns(runs)}
      ${this.renderFilter(filterAlgos)}
      ${this.renderRecent(recent)}
    </div>`;
  }

  private renderHeader(
    stats: ReturnType<ReturnType<typeof getShadowModeAlgorithmService>['stats']>,
  ): string {
    const overall = Math.round(stats.divergenceRate * 100);
    return `<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;">
      <div>
        <div style="font-size:22px;font-weight:700;">${stats.enabledRuns}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">enabled runs</div>
      </div>
      <div>
        <div style="font-size:22px;font-weight:700;">${stats.totalRuns}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">total runs</div>
      </div>
      <div>
        <div style="font-size:22px;font-weight:700;">${stats.totalComparisons}</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">comparisons logged</div>
      </div>
      <div>
        <div style="font-size:22px;font-weight:700;color:${rateColor(stats.divergenceRate)};">${overall}%</div>
        <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">overall divergence</div>
      </div>
    </div>`;
  }

  private renderRuns(runs: readonly ShadowRunConfig[]): string {
    if (runs.length === 0) {
      return renderPanelEmpty({
        message: 'No shadow runs yet',
        hint: 'Enable a shadow algorithm to start an A/B comparison',
      });
    }
    const svc = getShadowModeAlgorithmService();
    const rows = runs.map((r) => {
      const rate = svc.getDivergenceRate(r.id);
      return this.renderRunRow(r, rate);
    }).join('');
    return `<div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);margin-bottom:4px;">Runs</div>
      <div style="display:flex;flex-direction:column;gap:6px;">${rows}</div>
    </div>`;
  }

  private renderRunRow(run: ShadowRunConfig, rate: number): string {
    const pct = Math.round(rate * 100);
    const color = rateColor(rate);
    const toggleLabel = run.enabled ? 'Disable' : 'Enable';
    const toggleColor = run.enabled ? 'var(--severity-high,#f87171)' : 'var(--severity-ok,#22c55e)';
    const toggleBg = run.enabled ? 'rgba(248,113,113,0.10)' : 'rgba(34,197,94,0.10)';
    const action = run.enabled ? 'disable' : 'enable';
    const enabledBadge = run.enabled
      ? '<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(34,197,94,0.12);color:var(--severity-ok,#22c55e);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">ENABLED</span>'
      : '<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(255,255,255,0.06);color:var(--text-secondary,#aaa);font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">DISABLED</span>';
    return `<div style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:4px;background:rgba(255,255,255,0.02);">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        ${enabledBadge}
        <strong>${escapeHtml(run.algorithmId)}</strong>
        <span style="font-family:ui-monospace,monospace;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(run.id)}</span>
        <span style="margin-left:auto;font-size:11px;font-weight:700;color:${color};">${pct}% divergence</span>
        <button class="sc-action" data-action="${action}" data-id="${escapeHtml(run.id)}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:${toggleBg};color:${toggleColor};border-radius:3px;cursor:pointer;">${toggleLabel}</button>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(run.description)}</div>
      <div style="height:5px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden;margin-top:6px;">
        <div style="width:${pct}%;height:100%;background:${color};"></div>
      </div>
    </div>`;
  }

  private renderFilter(filterAlgos: readonly string[]): string {
    if (filterAlgos.length === 0) return '';
    const chips = (['all', ...filterAlgos] as const).map((id) => {
      const active = this.state.algorithmFilter === id;
      const label = id === 'all' ? 'All algorithms' : id;
      const bg = active ? 'rgba(96,165,250,0.18)' : 'transparent';
      return `<button class="sc-filter" data-id="${escapeHtml(id)}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:${bg};color:inherit;border-radius:10px;cursor:pointer;">${escapeHtml(label)}</button>`;
    }).join('');
    return `<div style="display:flex;gap:4px;flex-wrap:wrap;">${chips}</div>`;
  }

  private renderRecent(recent: readonly ShadowComparison[]): string {
    if (recent.length === 0) {
      return '<div style="font-size:11px;color:var(--text-secondary,#aaa);">No comparisons logged yet for the current filter.</div>';
    }
    const rows = recent.map((c) => this.renderComparisonRow(c)).join('');
    return `<div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);margin-bottom:4px;">Recent comparisons (newest ${recent.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderComparisonRow(c: ShadowComparison): string {
    const expanded = this.state.expandedComparisonId === c.id;
    const color = c.diverged ? 'var(--severity-high,#f87171)' : 'var(--severity-ok,#22c55e)';
    const label = c.diverged ? 'DIVERGED' : 'MATCH';
    const pct = Math.round(c.divergenceScore * 100);
    const when = new Date(c.timestamp).toLocaleTimeString();
    return `<div class="sc-comparison" data-id="${escapeHtml(c.id)}" style="padding:6px 10px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:4px;background:rgba(255,255,255,0.02);cursor:pointer;font-size:11px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:10px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${label}</span>
        <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);">${escapeHtml(c.algorithmId)}</span>
        <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);">hash ${escapeHtml(c.inputHash)}</span>
        <span style="margin-left:auto;color:${color};">${pct}% diff</span>
        <span style="color:var(--text-secondary,#aaa);">${escapeHtml(when)}</span>
      </div>
      ${expanded ? this.renderDiff(c) : ''}
    </div>`;
  }

  private renderDiff(c: ShadowComparison): string {
    const liveJson = safeStringify(c.liveOutput);
    const shadowJson = safeStringify(c.shadowOutput);
    return `<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border-subtle,#333);display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);margin-bottom:2px;">Live</div>
        <pre style="margin:0;padding:6px;font-size:10px;background:rgba(0,0,0,0.25);border:1px solid var(--border-subtle,#222);border-radius:3px;overflow:auto;max-height:160px;">${escapeHtml(liveJson)}</pre>
      </div>
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);margin-bottom:2px;">Shadow</div>
        <pre style="margin:0;padding:6px;font-size:10px;background:rgba(0,0,0,0.25);border:1px solid var(--border-subtle,#222);border-radius:3px;overflow:auto;max-height:160px;">${escapeHtml(shadowJson)}</pre>
      </div>
    </div>`;
  }

  // ── Event handling ────────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const filter = target?.closest<HTMLElement>('.sc-filter');
    if (filter) {
      event.stopPropagation();
      const id = filter.dataset.id;
      if (id) {
        this.state.algorithmFilter = id;
        this.render();
      }
      return;
    }
    const action = target?.closest<HTMLElement>('.sc-action');
    if (action) {
      event.stopPropagation();
      const svc = getShadowModeAlgorithmService();
      const id = action.dataset.id;
      const verb = action.dataset.action;
      if (!id || !verb) return;
      if (verb === 'enable') svc.enable(id);
      else if (verb === 'disable') svc.disable(id);
      this.render();
      return;
    }
    const row = target?.closest<HTMLElement>('.sc-comparison');
    if (!row) return;
    const id = row.dataset.id ?? null;
    this.state.expandedComparisonId = this.state.expandedComparisonId === id ? null : id;
    this.render();
  }
}

function rateColor(rate: number): string {
  if (rate >= 0.5) return 'var(--severity-critical,#dc2626)';
  if (rate >= 0.2) return 'var(--severity-medium,#facc15)';
  return 'var(--severity-ok,#22c55e)';
}

function uniqueAlgorithms(runs: readonly ShadowRunConfig[]): string[] {
  const set = new Set<string>();
  for (const r of runs) set.add(r.algorithmId);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function safeStringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2); }
  catch { return '[unstringifiable]'; }
}
