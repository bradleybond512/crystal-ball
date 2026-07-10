/**
 * AssumptionPanel — vanilla TS panel that surfaces every assumption
 * the model is currently relying on, grouped by output.
 *
 * Reads from the AssumptionTracker singleton. Auto-refreshes every 5s
 * via subscribe().
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getAssumptionTracker,
  type Assumption,
  type AssumptionCategory,
  type OutputType,
} from '@/services/intelligence/assumption-tracker';

const REFRESH_MS = 5000;

const CATEGORY_LABEL: Record<AssumptionCategory, string> = {
  'data-quality': 'Data quality',
  completeness: 'Completeness',
  causality: 'Causality',
  baseline: 'Baseline',
  model: 'Model',
  geospatial: 'Geospatial',
};

const RISK_COLOR: Record<'low' | 'medium' | 'high', string> = {
  low: 'var(--severity-ok, #6c8)',
  medium: 'var(--severity-medium, #ea0)',
  high: 'var(--severity-critical, #e44)',
};

interface PanelFilters {
  category: AssumptionCategory | 'all';
  outputType: OutputType | 'all';
  criticalOnly: boolean;
}

export class AssumptionPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeTracker: (() => void) | null = null;
  private selectedAssumptionId: string | null = null;
  private filters: PanelFilters = {
    category: 'all',
    outputType: 'all',
    criticalOnly: false,
  };

  constructor() {
    super({
      id: 'assumption-tracker',
      title: 'Assumption Audit',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Every score, situation, and alert annotated with the assumptions it rests on. Critical assumptions reduce the system\'s overall confidence.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribeTracker = getAssumptionTracker().subscribe(() => this.render());
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.unsubscribeTracker?.();
    this.unsubscribeTracker = null;
    super.destroy();
  }

  private render(): void {
    try {
      const html = this.buildHtml();
      this.setContent(html, () => this.wireHandlers());
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Assumption panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(): string {
    const tracker = getAssumptionTracker();
    const stats = tracker.stats();
    const allAssumptions = collectAssumptions(tracker);
    const filtered = this.applyFilters(allAssumptions);
    this.setCount(stats.criticalCount);

    const healthy = stats.criticalCount === 0 && stats.highRiskCount === 0;
    const summary = healthy
      ? `<div style="padding:14px 16px;border-bottom:1px solid var(--border-subtle,#333);background:rgba(96,200,140,0.08);">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--severity-ok,#6c8);"></span>
            <span style="font-weight:600;">No high-risk critical assumptions in flight</span>
          </div>
          <div style="margin-top:4px;color:var(--text-secondary,#aaa);font-size:11px;">${stats.totalAssumptions} non-critical assumption${pluralS(stats.totalAssumptions)} across ${stats.totalOutputs} output${pluralS(stats.totalOutputs)} · avg confidence ${stats.avgConfidence.toFixed(2)}</div>
        </div>`
      : `<div style="padding:14px 16px;border-bottom:1px solid var(--border-subtle,#333);">
          <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;">
            <span><strong>${stats.totalAssumptions}</strong> assumption${pluralS(stats.totalAssumptions)}</span>
            <span style="color:${RISK_COLOR.high};"><strong>${stats.criticalCount}</strong> critical</span>
            <span style="color:${RISK_COLOR.high};"><strong>${stats.highRiskCount}</strong> high-risk</span>
            <span style="color:var(--text-secondary,#aaa);">avg confidence ${stats.avgConfidence.toFixed(2)}</span>
            <span style="color:var(--text-secondary,#aaa);">${stats.totalOutputs} output${pluralS(stats.totalOutputs)}</span>
          </div>
        </div>`;

    const filterBar = this.renderFilters(stats.byCategory);
    const list = renderAssumptionList(filtered, this.selectedAssumptionId);

    return `${summary}${filterBar}${list}`;
  }

  private renderFilters(byCategory: Record<AssumptionCategory, number>): string {
    const categoryOptions: (AssumptionCategory | 'all')[] = [
      'all', 'data-quality', 'completeness', 'causality', 'baseline', 'model', 'geospatial',
    ];
    const outputOptions: (OutputType | 'all')[] = ['all', 'score', 'situation', 'alert', 'correlation'];
    const catSelect = categoryOptions.map((c) => {
      const count = c === 'all' ? '' : ` (${byCategory[c] ?? 0})`;
      const label = c === 'all' ? 'All categories' : CATEGORY_LABEL[c];
      return `<option value="${c}"${this.filters.category === c ? ' selected' : ''}>${escapeHtml(label + count)}</option>`;
    }).join('');
    const outSelect = outputOptions.map((o) => {
      const label = o === 'all' ? 'All outputs' : o;
      return `<option value="${o}"${this.filters.outputType === o ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
    return `<div style="padding:8px 16px;border-bottom:1px solid var(--border-subtle,#333);display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <select class="ap-filter-category" style="font-size:11px;padding:3px 6px;background:transparent;color:var(--text-primary,#ddd);border:1px solid var(--border-subtle,#333);">${catSelect}</select>
      <select class="ap-filter-output" style="font-size:11px;padding:3px 6px;background:transparent;color:var(--text-primary,#ddd);border:1px solid var(--border-subtle,#333);">${outSelect}</select>
      <label style="font-size:11px;display:flex;gap:4px;align-items:center;">
        <input type="checkbox" class="ap-filter-critical"${this.filters.criticalOnly ? ' checked' : ''}/> critical only
      </label>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const cat = root.querySelector<HTMLSelectElement>('.ap-filter-category');
    const out = root.querySelector<HTMLSelectElement>('.ap-filter-output');
    const crit = root.querySelector<HTMLInputElement>('.ap-filter-critical');
    cat?.addEventListener('change', () => {
      this.filters.category = cat.value as AssumptionCategory | 'all';
      this.render();
    });
    out?.addEventListener('change', () => {
      this.filters.outputType = out.value as OutputType | 'all';
      this.render();
    });
    crit?.addEventListener('change', () => {
      this.filters.criticalOnly = crit.checked;
      this.render();
    });
    for (const row of root.querySelectorAll<HTMLElement>('.ap-row')) {
      row.addEventListener('click', () => {
        const id = row.dataset.assumptionId ?? null;
        this.selectedAssumptionId = this.selectedAssumptionId === id ? null : id;
        this.render();
      });
    }
  }

  private applyFilters(rows: AssumptionRow[]): AssumptionRow[] {
    return rows.filter((r) => {
      if (this.filters.category !== 'all' && r.assumption.category !== this.filters.category) return false;
      if (this.filters.outputType !== 'all' && r.outputType !== this.filters.outputType) return false;
      if (this.filters.criticalOnly && !r.assumption.isCritical) return false;
      return true;
    });
  }
}

interface AssumptionRow {
  assumption: Assumption;
  outputId: string;
  outputType: OutputType;
}

function collectAssumptions(tracker: ReturnType<typeof getAssumptionTracker>): AssumptionRow[] {
  const out: AssumptionRow[] = [];
  // The tracker exposes per-category and per-criticality views, but we
  // need the (assumption, outputType) join to build the panel — so walk
  // every category once and look up the originating annotation.
  const seenIds = new Set<string>();
  for (const cat of ['data-quality', 'completeness', 'causality', 'baseline', 'model', 'geospatial'] as AssumptionCategory[]) {
    for (const a of tracker.getByCategory(cat)) {
      if (seenIds.has(a.id)) continue;
      seenIds.add(a.id);
      const ann = a.affectedOutputIds[0] ? tracker.getAnnotation(a.affectedOutputIds[0]) : undefined;
      out.push({
        assumption: a,
        outputId: a.affectedOutputIds[0] ?? '?',
        outputType: ann?.outputType ?? 'score',
      });
    }
  }
  out.sort((a, b) => b.assumption.detectedAt.getTime() - a.assumption.detectedAt.getTime());
  return out;
}

function renderAssumptionList(rows: readonly AssumptionRow[], selectedId: string | null): string {
  if (rows.length === 0) {
    return `<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;">No assumptions match the current filters.</div>`;
  }
  const items = rows.map((r) => renderRow(r, r.assumption.id === selectedId)).join('');
  return `<div class="ap-list" style="overflow:auto;max-height:520px;">${items}</div>`;
}

function renderRow(row: AssumptionRow, expanded: boolean): string {
  const a = row.assumption;
  const confidencePct = Math.round(a.confidence * 100);
  const riskColor = RISK_COLOR[a.violationRisk];
  const criticalBadge = a.isCritical
    ? `<span style="font-size:9px;font-weight:700;padding:2px 5px;background:${RISK_COLOR.high};color:#fff;border-radius:3px;text-transform:uppercase;">critical</span>`
    : '';
  const detail = expanded
    ? `<div style="margin-top:6px;padding:8px 10px;background:rgba(0,0,0,0.18);border-radius:4px;font-size:11px;">
        <div><strong>Output:</strong> <code>${escapeHtml(row.outputId)}</code> (${escapeHtml(row.outputType)})</div>
        <div style="margin-top:4px;"><strong>Affected:</strong> ${a.affectedOutputIds.map((id) => `<code>${escapeHtml(id)}</code>`).join(', ')}</div>
        <div style="margin-top:4px;color:var(--text-secondary,#aaa);">Detected ${escapeHtml(a.detectedAt.toISOString())}</div>
      </div>`
    : '';
  return `<div class="ap-row" data-assumption-id="${escapeHtml(a.id)}" style="padding:10px 16px;border-bottom:1px solid var(--border-subtle,#333);cursor:pointer;">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:9px;font-weight:600;padding:2px 5px;background:rgba(255,255,255,0.06);border-radius:3px;text-transform:uppercase;">${escapeHtml(CATEGORY_LABEL[a.category])}</span>
      ${criticalBadge}
      <span style="font-size:9px;font-weight:600;padding:2px 5px;background:${riskColor};color:#fff;border-radius:3px;text-transform:uppercase;">risk ${escapeHtml(a.violationRisk)}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--text-secondary,#aaa);">conf ${confidencePct}%</span>
    </div>
    <div style="margin-top:6px;font-size:12px;line-height:1.4;">${escapeHtml(a.statement)}</div>
    <div style="margin-top:6px;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
      <div style="height:100%;width:${confidencePct}%;background:${riskColor};"></div>
    </div>
    ${detail}
  </div>`;
}

function pluralS(n: number): string {
  return n === 1 ? '' : 's';
}
