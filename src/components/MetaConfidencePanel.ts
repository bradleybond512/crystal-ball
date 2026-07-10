/**
 * Meta-Confidence Panel — shows the reliability distribution across
 * every score / situation / hypothesis the renderer has logged via
 * `MetaConfidenceService.estimate()`.
 *
 * Vanilla TS, no preview / DOM dependencies beyond the existing Panel
 * base class.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getMetaConfidenceService,
  type ConfidenceReliability,
  type MetaConfidenceEstimate,
  type MetaConfidenceTargetType,
} from '@/services/intelligence/meta-confidence';

const RELIABILITY_COLOR: Record<ConfidenceReliability, string> = {
  anchored: 'var(--severity-ok,#22c55e)',
  moderate: '#60a5fa',
  provisional: 'var(--severity-medium,#facc15)',
  speculative: 'var(--severity-high,#f87171)',
};

const RELIABILITY_LABEL: Record<ConfidenceReliability, string> = {
  anchored: 'Anchored',
  moderate: 'Moderate',
  provisional: 'Provisional',
  speculative: 'Speculative',
};

const TARGET_TYPE_COLOR: Record<MetaConfidenceTargetType, string> = {
  score: '#60a5fa',
  situation: '#a78bfa',
  hypothesis: '#22c55e',
};

const REFRESH_MS = 10_000;
const RECENT_LIMIT = 20;
const RELIABILITY_ORDER: readonly ConfidenceReliability[] = [
  'anchored', 'moderate', 'provisional', 'speculative',
];

type ReliabilityFilter = ConfidenceReliability | 'all';
type TargetTypeFilter = MetaConfidenceTargetType | 'all';

interface PanelState {
  reliability: ReliabilityFilter;
  targetType: TargetTypeFilter;
  expandedId: string | null;
}

export class MetaConfidencePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private state: PanelState = { reliability: 'all', targetType: 'all', expandedId: null };

  constructor() {
    super({
      id: 'meta-confidence',
      title: 'Meta-Confidence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'How reliable is each confidence value? Combines evidence breadth, consistency, temporal stability, and critical-assumption penalties into a 4-tier reliability band.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = getMetaConfidenceService().subscribe(() => this.render());
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
      const service = getMetaConfidenceService();
      const all = service.getAllEstimates();
      const filtered = this.applyFilters(all);
      const recent = this.sortRecent(filtered).slice(0, RECENT_LIMIT);
      this.setCount(filtered.length);
      this.setContent(this.buildHtml(service.stats(), recent, all.length));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Meta-confidence render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private applyFilters(estimates: readonly MetaConfidenceEstimate[]): MetaConfidenceEstimate[] {
    return estimates.filter((e) => {
      if (this.state.reliability !== 'all' && e.reliability !== this.state.reliability) return false;
      if (this.state.targetType !== 'all' && e.targetType !== this.state.targetType) return false;
      return true;
    });
  }

  private sortRecent(estimates: readonly MetaConfidenceEstimate[]): MetaConfidenceEstimate[] {
    return [...estimates].sort((a, b) => b.computedAt.getTime() - a.computedAt.getTime());
  }

  private buildHtml(
    stats: ReturnType<ReturnType<typeof getMetaConfidenceService>['stats']>,
    recent: readonly MetaConfidenceEstimate[],
    totalUnfiltered: number,
  ): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;font-size:12px;">
      ${this.renderSummary(stats)}
      ${this.renderFilters()}
      ${this.renderList(recent, totalUnfiltered)}
    </div>`;
  }

  private renderSummary(
    stats: ReturnType<ReturnType<typeof getMetaConfidenceService>['stats']>,
  ): string {
    if (stats.totalEstimates === 0) {
      return '<div style="font-size:12px;color:var(--text-secondary,#aaa);">No meta-confidence estimates recorded yet. Estimates will appear here as upstream pipelines call estimate().</div>';
    }
    const pills = RELIABILITY_ORDER.map((r) => {
      const count = stats.byReliability[r];
      return `<span style="padding:3px 8px;border-radius:10px;background:${RELIABILITY_COLOR[r]}22;color:${RELIABILITY_COLOR[r]};font-weight:700;font-size:11px;">${escapeHtml(RELIABILITY_LABEL[r])} · ${count}</span>`;
    }).join('');
    return `<div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">${pills}</div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:6px;">
        ${stats.totalEstimates} estimates · avg meta ${Math.round(stats.avgMetaConfidence * 100)}% · avg reported ${Math.round(stats.avgReportedConfidence * 100)}%
      </div>
    </div>`;
  }

  private renderFilters(): string {
    const reliabilityChips = (['all', ...RELIABILITY_ORDER] as ReliabilityFilter[]).map((r) => {
      const active = this.state.reliability === r;
      const label = r === 'all' ? 'All' : RELIABILITY_LABEL[r];
      return `<button class="mc-filter" data-filter="reliability" data-value="${r}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:10px;cursor:pointer;">${escapeHtml(label)}</button>`;
    }).join('');
    const typeChips = (['all', 'score', 'situation', 'hypothesis'] as TargetTypeFilter[]).map((t) => {
      const active = this.state.targetType === t;
      const label = t === 'all' ? 'All types' : t;
      return `<button class="mc-filter" data-filter="targetType" data-value="${t}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:10px;cursor:pointer;">${escapeHtml(label)}</button>`;
    }).join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;gap:4px;flex-wrap:wrap;">${reliabilityChips}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">${typeChips}</div>
    </div>`;
  }

  private renderList(
    recent: readonly MetaConfidenceEstimate[],
    totalUnfiltered: number,
  ): string {
    if (recent.length === 0) {
      const empty = totalUnfiltered === 0
        ? 'No estimates yet.'
        : 'No estimates match the current filters.';
      return `<div style="font-size:12px;color:var(--text-secondary,#aaa);padding:8px 0;">${empty}</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:6px;">
      ${recent.map((e) => this.renderRow(e)).join('')}
    </div>`;
  }

  private renderRow(e: MetaConfidenceEstimate): string {
    const expanded = this.state.expandedId === e.targetId;
    const color = RELIABILITY_COLOR[e.reliability];
    const reportedPct = Math.round(e.reportedConfidence * 100);
    const metaPct = Math.round(e.metaConfidence * 100);
    const ciLo = Math.round(e.confidenceInterval[0] * 100);
    const ciHi = Math.round(e.confidenceInterval[1] * 100);
    const typeColor = TARGET_TYPE_COLOR[e.targetType];
    const expandedBlock = expanded ? this.renderExpansion(e) : '';
    return `<div class="mc-row" data-id="${escapeHtml(e.targetId)}" style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:4px;background:rgba(255,255,255,0.02);cursor:pointer;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${typeColor}22;color:${typeColor};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(e.targetType)}</span>
        <span style="font-family:ui-monospace,monospace;font-size:11px;">${escapeHtml(truncate(e.targetId, 32))}</span>
        <span style="font-size:11px;color:var(--text-secondary,#aaa);">reported ${reportedPct}%</span>
        <span style="margin-left:auto;font-size:11px;color:${color};font-weight:700;">${escapeHtml(RELIABILITY_LABEL[e.reliability])}</span>
      </div>
      <div style="height:5px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden;margin-top:6px;">
        <div style="width:${metaPct}%;height:100%;background:${color};"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">
        <span><strong style="color:${color};">${metaPct}%</strong> meta · 90% CI [${ciLo}–${ciHi}%]</span>
        <span>${e.sampleSize} obs</span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(e.explanation)}</div>
      ${expandedBlock}
    </div>`;
  }

  private renderExpansion(e: MetaConfidenceEstimate): string {
    return `<div style="margin-top:8px;padding:8px;border-top:1px solid var(--border-subtle,#333);display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:11px;">
      ${this.renderMetric('Breadth', e.evidenceBreadth)}
      ${this.renderMetric('Consistency', e.evidenceConsistency)}
      ${this.renderMetric('Stability', e.temporalStability)}
    </div>`;
  }

  private renderMetric(label: string, value: number): string {
    const pct = Math.round(value * 100);
    return `<div>
      <div style="color:var(--text-secondary,#aaa);text-transform:uppercase;font-size:10px;letter-spacing:0.05em;">${escapeHtml(label)}</div>
      <div style="font-weight:700;font-size:13px;">${pct}%</div>
      <div style="height:3px;border-radius:2px;background:rgba(255,255,255,0.06);overflow:hidden;margin-top:2px;">
        <div style="width:${pct}%;height:100%;background:#60a5fa;"></div>
      </div>
    </div>`;
  }

  // ── Event handling ────────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const filterBtn = target.closest<HTMLElement>('.mc-filter');
    if (filterBtn) {
      this.applyFilterClick(filterBtn);
      return;
    }
    const row = target.closest<HTMLElement>('.mc-row');
    if (!row) return;
    const id = row.dataset.id ?? null;
    this.state.expandedId = this.state.expandedId === id ? null : id;
    this.render();
  }

  private applyFilterClick(btn: HTMLElement): void {
    const filter = btn.dataset.filter;
    const value = btn.dataset.value;
    if (!filter || !value) return;
    if (filter === 'reliability' && isReliabilityFilter(value)) {
      this.state.reliability = value;
      this.render();
      return;
    }
    if (filter === 'targetType' && isTargetTypeFilter(value)) {
      this.state.targetType = value;
      this.render();
    }
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function isReliabilityFilter(value: string): value is ReliabilityFilter {
  return value === 'all'
    || value === 'anchored' || value === 'moderate'
    || value === 'provisional' || value === 'speculative';
}

function isTargetTypeFilter(value: string): value is TargetTypeFilter {
  return value === 'all' || value === 'score' || value === 'situation' || value === 'hypothesis';
}
