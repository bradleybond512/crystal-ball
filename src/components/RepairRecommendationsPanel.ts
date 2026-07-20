/**
 * Repair Recommendations Panel — surface the autonomous repair queue.
 *
 * Vanilla TS, extends Panel. Subscribes to RepairEngine for live
 * updates and renders priority-sorted recommendations with expandable
 * action steps + mark-in-progress / resolve / dismiss buttons.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getRepairEngine,
  type RepairPriority,
  type RepairRecommendation,
  type RepairStatus,
} from '@/services/intelligence/repair-engine';

const PRIORITY_COLOR: Record<RepairPriority, string> = {
  critical: 'var(--severity-critical,#dc2626)',
  high: 'var(--severity-high,#f87171)',
  medium: 'var(--severity-medium,#facc15)',
  low: '#60a5fa',
};

const PRIORITY_LABEL: Record<RepairPriority, string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

const STATUS_LABEL: Record<RepairStatus, string> = {
  open: 'OPEN',
  'in-progress': 'IN PROGRESS',
  resolved: 'RESOLVED',
  dismissed: 'DISMISSED',
};

const STATUS_COLOR: Record<RepairStatus, string> = {
  open: 'var(--text-secondary,#aaa)',
  'in-progress': '#60a5fa',
  resolved: 'var(--severity-ok,#22c55e)',
  dismissed: 'var(--text-secondary,#666)',
};

const REFRESH_MS = 10_000;
const PRIORITY_ORDER: readonly RepairPriority[] = ['critical', 'high', 'medium', 'low'];
const STATUS_ORDER: readonly RepairStatus[] = ['open', 'in-progress', 'resolved', 'dismissed'];

type PriorityFilter = RepairPriority | 'all';
type StatusFilter = RepairStatus | 'all';

interface PanelState {
  priority: PriorityFilter;
  status: StatusFilter;
  domain: string | null;
  expandedId: string | null;
}

export class RepairRecommendationsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private state: PanelState = { priority: 'all', status: 'all', domain: null, expandedId: null };

  constructor() {
    super({
      id: 'repair-recommendations',
      title: 'Repair Recommendations',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Actionable, step-by-step recommendations generated when safety properties fail or domain scorecards drop. Track open / in-progress / resolved.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = getRepairEngine().subscribe(() => this.render());
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
      const engine = getRepairEngine();
      const all = engine.getAll();
      const filtered = this.applyFilters(all);
      this.setCount(engine.getOpen().length);
      this.setContent(this.buildHtml(engine.stats(), filtered, this.availableDomains(all)));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Repair panel render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private applyFilters(recs: readonly RepairRecommendation[]): RepairRecommendation[] {
    const filtered = recs.filter((r) => {
      if (this.state.priority !== 'all' && r.priority !== this.state.priority) return false;
      if (this.state.status !== 'all' && r.status !== this.state.status) return false;
      if (this.state.domain && r.domain !== this.state.domain) return false;
      return true;
    });
    return filtered.sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
  }

  private availableDomains(recs: readonly RepairRecommendation[]): string[] {
    const set = new Set<string>();
    for (const r of recs) if (r.domain) set.add(r.domain);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  private buildHtml(
    stats: ReturnType<ReturnType<typeof getRepairEngine>['stats']>,
    rows: readonly RepairRecommendation[],
    domains: readonly string[],
  ): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;font-size:12px;">
      ${this.renderHeader(stats)}
      ${this.renderFilters(domains)}
      ${this.renderList(rows)}
    </div>`;
  }

  private renderHeader(
    stats: ReturnType<ReturnType<typeof getRepairEngine>['stats']>,
  ): string {
    return `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
      <span style="padding:3px 8px;border-radius:10px;background:rgba(220,38,38,0.10);color:var(--severity-critical,#dc2626);font-weight:700;font-size:11px;">${stats.open} open</span>
      <span style="padding:3px 8px;border-radius:10px;background:rgba(96,165,250,0.10);color:#60a5fa;font-weight:700;font-size:11px;">${stats.inProgress} in progress</span>
      <span style="padding:3px 8px;border-radius:10px;background:rgba(34,197,94,0.10);color:var(--severity-ok,#22c55e);font-weight:700;font-size:11px;">${stats.resolved} resolved</span>
      <span style="padding:3px 8px;border-radius:10px;background:rgba(255,255,255,0.04);color:var(--text-secondary,#aaa);font-weight:700;font-size:11px;">${stats.dismissed} dismissed</span>
      <span style="margin-left:auto;display:flex;gap:6px;">
        <button class="rr-action" data-action="generate-scorecards" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(96,165,250,0.10);color:#60a5fa;border-radius:3px;cursor:pointer;">Generate from Scorecards</button>
      </span>
    </div>`;
  }

  private renderFilters(domains: readonly string[]): string {
    const priorityChips = (['all', ...PRIORITY_ORDER] as PriorityFilter[]).map((p) => {
      const active = this.state.priority === p;
      const label = p === 'all' ? 'All' : PRIORITY_LABEL[p];
      const color = p === 'all' ? 'inherit' : PRIORITY_COLOR[p];
      return `<button class="rr-filter" data-filter="priority" data-value="${p}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};color:${color};border-radius:10px;cursor:pointer;">${escapeHtml(label)}</button>`;
    }).join('');
    const statusChips = (['all', ...STATUS_ORDER] as StatusFilter[]).map((s) => {
      const active = this.state.status === s;
      const label = s === 'all' ? 'All' : STATUS_LABEL[s];
      return `<button class="rr-filter" data-filter="status" data-value="${s}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:10px;cursor:pointer;">${escapeHtml(label)}</button>`;
    }).join('');
    const domainChips = this.renderDomainChipsBlock(domains);
    return `<div style="display:flex;flex-direction:column;gap:6px;">
      <div style="display:flex;gap:4px;flex-wrap:wrap;">${priorityChips}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">${statusChips}</div>
      ${domainChips}
    </div>`;
  }

  private renderDomainChipsBlock(domains: readonly string[]): string {
    if (domains.length === 0) return '';
    const activeAll = this.state.domain === null;
    const allChip = `<button class="rr-filter" data-filter="domain" data-value="" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:${activeAll ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:10px;cursor:pointer;">all</button>`;
    const chips = domains.map((d) => {
      const active = this.state.domain === d;
      const bg = active ? 'rgba(96,165,250,0.18)' : 'transparent';
      return `<button class="rr-filter" data-filter="domain" data-value="${escapeHtml(d)}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:${bg};color:inherit;border-radius:10px;cursor:pointer;">${escapeHtml(d)}</button>`;
    }).join('');
    return `<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
      <span style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-right:4px;">Domain</span>
      ${allChip}
      ${chips}
    </div>`;
  }

  private renderList(rows: readonly RepairRecommendation[]): string {
    if (rows.length === 0) {
      return '<div style="font-size:12px;color:var(--text-secondary,#aaa);padding:8px 0;">No recommendations match the current filters.</div>';
    }
    return `<div style="display:flex;flex-direction:column;gap:8px;">
      ${rows.map((r) => this.renderRow(r)).join('')}
    </div>`;
  }

  private renderRow(r: RepairRecommendation): string {
    const expanded = this.state.expandedId === r.id;
    const priorityColor = PRIORITY_COLOR[r.priority];
    const statusColor = STATUS_COLOR[r.status];
    const domainChip = r.domain
      ? `<span style="font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(255,255,255,0.06);color:var(--text-secondary,#aaa);">${escapeHtml(r.domain)}</span>`
      : '';
    const expandedBlock = expanded ? this.renderExpansion(r) : '';
    return `<div class="rr-row" data-id="${escapeHtml(r.id)}" style="padding:10px 12px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${priorityColor};border-radius:4px;background:rgba(255,255,255,0.02);cursor:pointer;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${priorityColor}22;color:${priorityColor};font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(PRIORITY_LABEL[r.priority])}</span>
        <strong style="font-size:13px;">${escapeHtml(r.title)}</strong>
        ${domainChip}
        <span style="margin-left:auto;font-size:10px;font-weight:700;color:${statusColor};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(STATUS_LABEL[r.status])}</span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${escapeHtml(r.summary)}</div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">
        <span style="font-family:ui-monospace,monospace;">${escapeHtml(r.triggerSource)}</span>
      </div>
      <div style="font-size:11px;color:#60a5fa;margin-top:4px;">${escapeHtml(r.estimatedImpact)}</div>
      ${expandedBlock}
    </div>`;
  }

  private renderExpansion(r: RepairRecommendation): string {
    const steps = r.actions.map((a) => `<li style="font-size:12px;margin:4px 0;display:flex;gap:6px;align-items:baseline;">
      <span style="flex:0 0 18px;height:14px;border:1px solid var(--border-subtle,#333);border-radius:3px;display:inline-block;background:rgba(255,255,255,0.04);"></span>
      <span>${escapeHtml(a.description)}${a.automated ? ' <span style="font-size:10px;color:#22c55e;">[auto]</span>' : ''}</span>
    </li>`).join('');
    const buttons = renderActionButtons(r);
    return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle,#333);">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary,#aaa);margin-bottom:4px;">Action steps</div>
      <ol style="margin:0;padding:0 0 0 4px;list-style:none;">${steps}</ol>
      <div style="margin-top:8px;">${buttons}</div>
    </div>`;
  }

  // ── Event handlers ────────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const actionBtn = target.closest<HTMLElement>('.rr-action');
    if (actionBtn) {
      event.stopPropagation();
      this.handleAction(actionBtn);
      return;
    }
    const filterBtn = target.closest<HTMLElement>('.rr-filter');
    if (filterBtn) {
      event.stopPropagation();
      this.applyFilterClick(filterBtn);
      return;
    }
    const row = target.closest<HTMLElement>('.rr-row');
    if (!row) return;
    const id = row.dataset.id ?? null;
    this.state.expandedId = this.state.expandedId === id ? null : id;
    this.render();
  }

  private handleAction(btn: HTMLElement): void {
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const engine = getRepairEngine();
    if (action === 'generate-scorecards') {
      // No-op stub — the panel doesn't have direct access to the
      // scorecard service; this hook exists so a host can wire one
      // up later. We keep the button for discoverability.
      this.render();
      return;
    }
    if (!action || !id) return;
    if (action === 'in-progress') engine.markInProgress(id);
    else if (action === 'resolve') engine.resolve(id);
    else if (action === 'dismiss') {
      const reason = typeof window !== 'undefined' && typeof window.prompt === 'function'
        ? window.prompt('Reason for dismissing this recommendation?', '') ?? ''
        : 'dismissed';
      engine.dismiss(id, reason);
    }
    this.render();
  }

  private applyFilterClick(btn: HTMLElement): void {
    const filter = btn.dataset.filter;
    const value = btn.dataset.value;
    if (!filter || value === undefined) return;
    if (filter === 'priority' && isPriorityFilter(value)) {
      this.state.priority = value;
    } else if (filter === 'status' && isStatusFilter(value)) {
      this.state.status = value;
    } else if (filter === 'domain') {
      this.state.domain = value === '' ? null : value;
    } else {
      return;
    }
    this.render();
  }
}

function priorityRank(p: RepairPriority): number {
  switch (p) {
    case 'critical': { return 4;
    }
    case 'high': {     return 3;
    }
    case 'medium': {   return 2;
    }
    case 'low': {      return 1;
    }
  }
}

function isPriorityFilter(value: string): value is PriorityFilter {
  return value === 'all' || value === 'critical' || value === 'high' || value === 'medium' || value === 'low';
}

function isStatusFilter(value: string): value is StatusFilter {
  return value === 'all' || value === 'open' || value === 'in-progress' || value === 'resolved' || value === 'dismissed';
}

function renderTerminalNote(r: RepairRecommendation): string {
  if (r.status === 'dismissed') {
    const suffix = r.dismissedReason ? ': ' + r.dismissedReason : '';
    return `<div style="font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml('Dismissed' + suffix)}</div>`;
  }
  return '<div style="font-size:11px;color:var(--text-secondary,#aaa);">Resolved</div>';
}

function renderInProgressButton(id: string): string {
  return `<button class="rr-action" data-action="in-progress" data-id="${escapeHtml(id)}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(96,165,250,0.10);color:#60a5fa;border-radius:3px;cursor:pointer;">Mark In Progress</button>`;
}

function renderActionButtons(r: RepairRecommendation): string {
  if (r.status === 'resolved' || r.status === 'dismissed') {
    return renderTerminalNote(r);
  }
  const inProgress = r.status === 'open' ? renderInProgressButton(r.id) : '';
  const resolve = `<button class="rr-action" data-action="resolve" data-id="${escapeHtml(r.id)}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(34,197,94,0.10);color:#22c55e;border-radius:3px;cursor:pointer;">Resolve</button>`;
  const dismiss = `<button class="rr-action" data-action="dismiss" data-id="${escapeHtml(r.id)}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:rgba(248,113,113,0.10);color:#f87171;border-radius:3px;cursor:pointer;">Dismiss</button>`;
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;">${inProgress}${resolve}${dismiss}</div>`;
}
