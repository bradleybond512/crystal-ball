/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Counterfactual Reasoning Panel — Phase 4 disconfirmatory-evidence
 * surface. Top row shows summary counts (total / open /
 * high-plausibility / refuted rate). Filter bar narrows by domain /
 * status. The per-counterfactual card shows type chip + falsification
 * condition + rationale + plausibility bar + Investigate / Refute /
 * Confirm action buttons.
 */

import { Panel } from './Panel';
import {
  getCounterfactualReasoningService,
  type Counterfactual,
  type CounterfactualStatus,
  type CounterfactualSummary,
  type CounterfactualType,
} from '@/services/intelligence/counterfactual-reasoning';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const DISPLAY_LIMIT = 50;

const TYPE_COLOR: Record<CounterfactualType, string> = {
  'data-quality': '#4a9eff',
  'missing-signal': '#ffb74d',
  'model-bias': '#ff453a',
  'scope-error': '#9c27b0',
  'timing-error': '#9e9e9e',
};

const STATUS_COLOR: Record<CounterfactualStatus, string> = {
  open: '#ffb74d',
  investigated: '#4a9eff',
  refuted: '#4caf50',
  'confirmed-valid': '#ff453a',
};

interface PanelState {
  domainFilter: string;
  statusFilter: CounterfactualStatus | 'all';
  expandedId: string | null;
}

export class CounterfactualReasoningPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private state: PanelState = {
    domainFilter: 'all',
    statusFilter: 'all',
    expandedId: null,
  };

  constructor() {
    super({
      id: 'counterfactual-reasoning',
      title: 'Counterfactual Reasoning',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Phase 4 falsification surface. For each assessment, generates "what would have to be true for this to be wrong?" counter-hypotheses across data-quality / missing-signal / model-bias dimensions. Status lifecycle: open → investigated → refuted / confirmed-valid.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsub = getCounterfactualReasoningService().subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private filteredCounterfactuals(): Counterfactual[] {
    const svc = getCounterfactualReasoningService();
    const filter: Parameters<typeof svc.getAll>[0] = {};
    if (this.state.domainFilter !== 'all') filter.domain = this.state.domainFilter;
    if (this.state.statusFilter !== 'all') filter.status = this.state.statusFilter;
    return svc.getAll(filter, DISPLAY_LIMIT);
  }

  private collectDomains(all: readonly Counterfactual[]): string[] {
    const set = new Set<string>();
    for (const c of all) set.add(c.domain);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  private render(): void {
    const svc = getCounterfactualReasoningService();
    const summary = svc.getSummary();
    const all = svc.getAll(undefined, DISPLAY_LIMIT);
    const filtered = this.filteredCounterfactuals();
    const domains = this.collectDomains(all);

    // Panel chip = currently-open counterfactuals.
    this.setCount(summary.open);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      ${renderSummaryRow(summary)}
      ${this.renderFilterBar(domains)}
      ${this.renderCards(filtered)}
    </div>`;
    this.setContent(html, () => this.wireHandlers());
  }

  private renderFilterBar(domains: readonly string[]): string {
    const domainOpts = ['all', ...domains].map((d) =>
      `<option value="${escapeHtml(d)}"${d === this.state.domainFilter ? ' selected' : ''}>${escapeHtml(d === 'all' ? 'All domains' : d)}</option>`,
    ).join('');
    const statusOpts = (['all', 'open', 'investigated', 'refuted', 'confirmed-valid'] as const).map((s) =>
      `<option value="${s}"${s === this.state.statusFilter ? ' selected' : ''}>${s === 'all' ? 'All statuses' : s}</option>`,
    ).join('');
    return `<div style="display:flex;align-items:center;gap:12px;font-size:11px;">
      <label style="display:flex;align-items:center;gap:6px;color:var(--text-secondary,#aaa);">
        Domain
        <select id="cfReasonDomain" style="padding:4px 8px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;">${domainOpts}</select>
      </label>
      <label style="display:flex;align-items:center;gap:6px;color:var(--text-secondary,#aaa);">
        Status
        <select id="cfReasonStatus" style="padding:4px 8px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;">${statusOpts}</select>
      </label>
    </div>`;
  }

  private renderCards(counterfactuals: readonly Counterfactual[]): string {
    if (counterfactuals.length === 0) {
      return `<div style="font-size:12px;color:var(--text-secondary,#aaa);padding:16px;text-align:center;border:1px dashed var(--border-subtle,#333);border-radius:4px;">No counterfactuals match the current filter.</div>`;
    }
    const cards = counterfactuals.map((c) => renderCard(c, c.id === this.state.expandedId)).join('');
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Counterfactuals</div>
      <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;">${cards}</ul>
    </div>`;
  }

  private wireHandlers(): void {
    setTimeout(() => {
      const root = this.content;
      const domainSel = root.querySelector<HTMLSelectElement>('#cfReasonDomain');
      domainSel?.addEventListener('change', () => {
        this.state.domainFilter = domainSel.value;
        this.render();
      });
      const statusSel = root.querySelector<HTMLSelectElement>('#cfReasonStatus');
      statusSel?.addEventListener('change', () => {
        this.state.statusFilter = statusSel.value as PanelState['statusFilter'];
        this.render();
      });
      root.querySelectorAll<HTMLElement>('[data-cfr-row]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.dataset.cfrRow;
          if (!id) return;
          this.state.expandedId = this.state.expandedId === id ? null : id;
          this.render();
        });
      });
      root.querySelectorAll<HTMLButtonElement>('[data-cfr-investigate]').forEach((el) => {
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          const id = el.dataset.cfrInvestigate;
          if (id) getCounterfactualReasoningService().investigate(id);
        });
      });
      root.querySelectorAll<HTMLButtonElement>('[data-cfr-refute]').forEach((el) => {
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          const id = el.dataset.cfrRefute;
          if (id) getCounterfactualReasoningService().refute(id, 'analyst refuted');
        });
      });
      root.querySelectorAll<HTMLButtonElement>('[data-cfr-confirm]').forEach((el) => {
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          const id = el.dataset.cfrConfirm;
          if (id) getCounterfactualReasoningService().confirm(id, 'analyst confirmed as valid concern');
        });
      });
    }, 0);
  }
}

// ── Rendering helpers ───────────────────────────────────────────────

function renderSummaryRow(summary: CounterfactualSummary): string {
  const refutedPct = (summary.refutedRate * 100).toFixed(0);
  return `<div style="display:flex;gap:18px;font-size:12px;font-family:ui-monospace,monospace;flex-wrap:wrap;">
    <span><strong>${summary.total}</strong> total</span>
    <span><strong style="color:${STATUS_COLOR.open};">${summary.open}</strong> open</span>
    <span><strong style="color:#ff453a;">${summary.highPlausibility}</strong> high-plausibility</span>
    <span>refuted rate <strong>${refutedPct}%</strong></span>
  </div>`;
}

function renderCard(c: Counterfactual, expanded: boolean): string {
  const typeColor = TYPE_COLOR[c.type];
  const statusColor = STATUS_COLOR[c.status];
  const arrow = expanded ? '▾' : '▸';
  const plausPct = Math.min(100, Math.max(0, c.plausibility * 100));
  const isTerminal = c.status === 'refuted' || c.status === 'confirmed-valid';
  return `<li data-cfr-row="${escapeHtml(c.id)}" style="cursor:pointer;border:1px solid var(--border-subtle,#333);border-left:3px solid ${statusColor};border-radius:3px;background:var(--surface-2,#1a1a1a);padding:8px 10px;display:flex;flex-direction:column;gap:6px;">
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
      <span style="color:var(--text-secondary,#aaa);width:12px;">${arrow}</span>
      <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${typeColor}26;color:${typeColor};text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(c.type)}</span>
      <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${statusColor}26;color:${statusColor};text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(c.status)}</span>
      <span style="flex:1;font-weight:600;">${escapeHtml(c.falsificationCondition)}</span>
      <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);">${escapeHtml(c.domain)}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <div style="flex:1;height:6px;background:var(--surface-3,#222);border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:${plausPct.toFixed(1)}%;background:${typeColor};"></div>
      </div>
      <span style="font-size:11px;font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);width:60px;text-align:right;">plaus ${plausPct.toFixed(0)}%</span>
    </div>
    ${expanded ? renderCardExpansion(c, isTerminal) : ''}
  </li>`;
}

function renderResolutionBlock(c: Counterfactual): string {
  if (c.resolvedAt === undefined) return '';
  const noteRow = c.resolutionNote
    ? `<div><span style="color:var(--text-secondary,#aaa);">Note:</span> ${escapeHtml(c.resolutionNote)}</div>`
    : '';
  return `<div><span style="color:var(--text-secondary,#aaa);">Resolved:</span> <span style="font-family:ui-monospace,monospace;">${escapeHtml(new Date(c.resolvedAt).toISOString())}</span></div>
       ${noteRow}`;
}

function renderActions(c: Counterfactual, isTerminal: boolean): string {
  if (isTerminal) return '';
  const investigateBtn = c.status === 'open'
    ? `<button data-cfr-investigate="${escapeHtml(c.id)}" style="padding:4px 10px;font-size:11px;background:#4a9eff26;color:#4a9eff;border:1px solid #4a9eff55;border-radius:3px;cursor:pointer;">Investigate</button>`
    : '';
  return `<div style="display:flex;gap:8px;margin-top:4px;">
        ${investigateBtn}
        <button data-cfr-refute="${escapeHtml(c.id)}" style="padding:4px 10px;font-size:11px;background:#4caf5026;color:#4caf50;border:1px solid #4caf5055;border-radius:3px;cursor:pointer;">Refute</button>
        <button data-cfr-confirm="${escapeHtml(c.id)}" style="padding:4px 10px;font-size:11px;background:#ff453a26;color:#ff453a;border:1px solid #ff453a55;border-radius:3px;cursor:pointer;">Confirm valid</button>
      </div>`;
}

function renderCardExpansion(c: Counterfactual, isTerminal: boolean): string {
  const resolutionBlock = renderResolutionBlock(c);
  const actions = renderActions(c, isTerminal);
  return `<div style="display:flex;flex-direction:column;gap:3px;font-size:11px;padding-top:4px;border-top:1px solid var(--border-subtle,#333);line-height:1.5;">
    <div><span style="color:var(--text-secondary,#aaa);">Rationale:</span> ${escapeHtml(c.rationale)}</div>
    <div><span style="color:var(--text-secondary,#aaa);">Situation:</span> <span style="font-family:ui-monospace,monospace;">${escapeHtml(c.situationId)}</span> · <span style="color:var(--text-secondary,#aaa);">assessment:</span> <span style="font-family:ui-monospace,monospace;">${escapeHtml(c.assessmentId)}</span></div>
    <div><span style="color:var(--text-secondary,#aaa);">Created:</span> <span style="font-family:ui-monospace,monospace;">${escapeHtml(new Date(c.createdAt).toISOString())}</span></div>
    ${resolutionBlock}
    ${actions}
  </div>`;
}
