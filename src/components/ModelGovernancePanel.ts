/**
 * Model Governance Panel (panel id: `model-governance`).
 *
 * Card-grid view of every Crystal Ball intelligence algorithm with its
 * model card: purpose, inputs, outputs, limitations, known failure
 * modes, version, audit date, status. Search bar + status filter
 * chips up top; click a card to expand the full detail.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getModelGovernanceService,
  type ModelCard,
  type ModelStatus,
} from '@/services/intelligence/model-governance';
import { escapeHtml } from '@/utils/sanitize';

const STATUS_COLOR: Record<ModelStatus, string> = {
  active: '#2ec27e',
  experimental: '#f5a524',
  deprecated: '#9ca3af',
};

type StatusFilter = 'all' | ModelStatus;

interface PanelState {
  query: string;
  filter: StatusFilter;
  expandedId: string | null;
}

export class ModelGovernancePanel extends Panel {
  private unsubscribe: ((cb: (cards: ModelCard[]) => void) => void) | null = null;
  private listener: ((cards: ModelCard[]) => void) | null = null;
  private state: PanelState = { query: '', filter: 'all', expandedId: null };

  constructor() {
    super({
      id: 'model-governance',
      title: 'Model Governance',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Versioned model cards for every Crystal Ball intelligence algorithm: purpose, inputs, outputs, limitations, known failure modes, last audit date, status.',
    });
    const svc = getModelGovernanceService();
    this.listener = () => this.render();
    svc.subscribe(this.listener);
    this.unsubscribe = (cb) => svc.unsubscribe(cb);
    this.render();
  }

  public override destroy(): void {
    if (this.listener && this.unsubscribe) {
      this.unsubscribe(this.listener);
      this.listener = null;
      this.unsubscribe = null;
    }
    super.destroy();
  }

  private render(): void {
    const svc = getModelGovernanceService();
    const all = svc.getAllCards();
    this.setCount(all.length);
    const visible = this.applyFilters(all);
    this.setContent(this.buildHtml(visible, all));
    queueMicrotask(() => this.wireHandlers());
  }

  private applyFilters(cards: ModelCard[]): ModelCard[] {
    const svc = getModelGovernanceService();
    let working = this.state.query ? svc.searchCards(this.state.query) : cards;
    if (this.state.filter !== 'all') {
      working = working.filter((c) => c.status === this.state.filter);
    }
    return working;
  }

  private buildHtml(visible: ModelCard[], all: ModelCard[]): string {
    return `<div class="mg-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderSearch()}
      ${this.renderFilters(all)}
      ${visible.length === 0
        ? `<div style="padding:14px;text-align:center;opacity:0.55;font-size:12px;">No model cards match the current filter.</div>`
        : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;">${visible.map((c) => this.renderCard(c)).join('')}</div>`}
    </div>`;
  }

  private renderSearch(): string {
    return `<input type="search" class="mg-search" placeholder="Search by name, purpose, or tag…"
      value="${escapeHtml(this.state.query)}"
      style="background:rgba(255,255,255,0.04);color:#ddd;border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:5px 8px;font-size:12px;font-family:inherit;">`;
  }

  private renderFilters(all: ModelCard[]): string {
    const counts: Record<StatusFilter, number> = {
      all: all.length,
      active: all.filter((c) => c.status === 'active').length,
      experimental: all.filter((c) => c.status === 'experimental').length,
      deprecated: all.filter((c) => c.status === 'deprecated').length,
    };
    const chips: StatusFilter[] = ['all', 'active', 'experimental', 'deprecated'];
    return `<div style="display:flex;gap:4px;flex-wrap:wrap;">${chips.map((c) => this.renderChip(c, counts[c])).join('')}</div>`;
  }

  private renderChip(filter: StatusFilter, count: number): string {
    const isActive = this.state.filter === filter;
    const bg = isActive ? 'rgba(74,158,255,0.18)' : 'transparent';
    const borderAlpha = isActive ? '0.4' : '0.15';
    const label = filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1);
    return `<button class="mg-chip" data-filter="${filter}" type="button"
      style="padding:3px 10px;background:${bg};color:inherit;border:1px solid rgba(74,158,255,${borderAlpha});border-radius:14px;cursor:pointer;font-size:11px;">${escapeHtml(label)} (${count})</button>`;
  }

  private renderCard(card: ModelCard): string {
    const expanded = this.state.expandedId === card.id;
    const color = STATUS_COLOR[card.status];
    const purposeTrim = card.purpose.length > 110 ? `${card.purpose.slice(0, 110)}…` : card.purpose;
    const tags = card.tags.slice(0, 4).map((t) =>
      `<span style="background:rgba(155,89,182,0.18);color:#9b59b6;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(t)}</span>`,
    ).join(' ');
    const detail = expanded ? this.renderCardDetail(card) : '';
    return `<div class="mg-card" data-id="${escapeHtml(card.id)}" style="border-left:3px solid ${color};background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;padding:8px 10px;cursor:pointer;display:flex;flex-direction:column;gap:4px;${expanded ? 'grid-column:1 / -1;' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:6px;">
        <span style="font-weight:600;color:#ddd;">${escapeHtml(card.name)}</span>
        <span style="background:${color};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${card.status}</span>
      </div>
      <div style="font-size:10px;opacity:0.55;font-family:ui-monospace,monospace;">v${escapeHtml(card.version)}</div>
      <div style="font-size:11px;opacity:0.85;">${escapeHtml(purposeTrim)}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">${tags}</div>
      ${detail}
    </div>`;
  }

  private renderCardDetail(card: ModelCard): string {
    const auditDate = new Date(card.lastAuditDate).toISOString().slice(0, 10);
    const section = (label: string, items: readonly string[]): string =>
      `<div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;margin-bottom:2px;">${escapeHtml(label)}</div>
        <ul style="margin:0;padding-left:16px;font-size:11px;color:#ddd;">${items.map((i) =>
          `<li>${escapeHtml(i)}</li>`).join('')}</ul>
      </div>`;
    return `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:6px;">
      <div style="font-size:11px;color:#ddd;">${escapeHtml(card.purpose)}</div>
      ${section('Inputs', card.inputs)}
      ${section('Outputs', card.outputs)}
      ${section('Limitations', card.limitations)}
      ${section('Known failure modes', card.knownFailureModes)}
      <div style="font-size:10px;opacity:0.55;">Last audited: ${escapeHtml(auditDate)}</div>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();

    const searchEl = root.querySelector<HTMLInputElement>('.mg-search');
    searchEl?.addEventListener('input', () => {
      this.state.query = searchEl.value;
      this.render();
      // restore focus + caret position
      const reSearchEl = this.getContentElement().querySelector<HTMLInputElement>('.mg-search');
      if (reSearchEl) {
        reSearchEl.focus();
        const len = reSearchEl.value.length;
        reSearchEl.setSelectionRange(len, len);
      }
    });

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.mg-chip')) {
      btn.addEventListener('click', () => {
        const f = btn.dataset.filter;
        if (f === 'all' || f === 'active' || f === 'experimental' || f === 'deprecated') {
          this.state.filter = f;
          this.render();
        }
      });
    }

    for (const card of root.querySelectorAll<HTMLElement>('.mg-card')) {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        if (!id) return;
        this.state.expandedId = this.state.expandedId === id ? null : id;
        this.render();
      });
    }
  }
}
