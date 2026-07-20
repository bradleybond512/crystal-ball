/**
 * Contradiction Detector Panel (panel id: `contradiction-detector`).
 *
 * Lists open contradictions grouped by conflict type. Each card shows
 * the two conflicting observations side-by-side with a severity-delta
 * indicator, the detected confidence, and Resolve / Dismiss buttons.
 * A second tab shows resolved + dismissed history.
 */

import { Panel } from './Panel';
import {
  getContradictionDetector,
  type Contradiction,
  type ConflictType,
} from '@/services/intelligence/contradiction-detector';
import { escapeHtml } from '@/utils/sanitize';
import { statLine } from './ui/statLine';
import { formatDurationMinutes } from '@/utils/format-duration';

const REFRESH_MS = 15_000;

const TYPE_LABEL: Record<ConflictType, string> = {
  'severity-mismatch': 'Severity mismatch',
  'status-conflict': 'Status conflict',
  'location-conflict': 'Location conflict',
  'trend-reversal': 'Trend reversal',
  'source-disagreement': 'Source disagreement',
};

const TYPE_COLOR: Record<ConflictType, string> = {
  'severity-mismatch': '#e94f37',
  'status-conflict': '#a626a4',
  'location-conflict': '#4a9eff',
  'trend-reversal': '#f5a524',
  'source-disagreement': '#9b59b6',
};

type Tab = 'open' | 'history';

export class ContradictionDetectorPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listener: ((items: Contradiction[]) => void) | null = null;
  private tab: Tab = 'open';
  private dismissingId: string | null = null;

  constructor() {
    super({
      id: 'contradiction-detector',
      title: 'Contradictions',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Flags when feeds or sources report conflicting world states about the same entity or region. 5 conflict types: severity-mismatch, status-conflict, location-conflict, trend-reversal, source-disagreement.',
    });
    const svc = getContradictionDetector();
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
      getContradictionDetector().unsubscribe(this.listener);
      this.listener = null;
    }
    super.destroy();
  }

  private render(): void {
    const svc = getContradictionDetector();
    const open = svc.getOpen();
    const all = svc.getAll();
    this.setCount(open.length);
    this.setContent(this.buildHtml(open, all, svc.stats()), () => this.wireHandlers());
  }

  private buildHtml(
    open: Contradiction[],
    all: Contradiction[],
    stats: ReturnType<ReturnType<typeof getContradictionDetector>['stats']>,
  ): string {
    const history = all.filter((c) => c.status !== 'open')
      .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
    const showing = this.tab === 'open' ? open : history;
    const grouped = groupByType(showing);

    return `<div class="cd-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderHeader(stats)}
      ${this.renderTabs(open.length, history.length)}
      ${showing.length === 0
        ? renderEmptyState(this.tab)
        : grouped.map(([type, items]) => this.renderGroup(type, items)).join('')}
    </div>`;
  }

  private renderHeader(
    stats: ReturnType<ReturnType<typeof getContradictionDetector>['stats']>,
  ): string {
    return `<div style="font-size:11px;color:var(--text-secondary,#bbb);">
      ${statLine([
        { value: stats.openCount, label: 'open', valueColor: 'var(--accent,#4a9eff)' },
        { value: stats.totalDetected, label: 'total' },
        { value: formatDurationMinutes(stats.avgResolutionMinutes), label: 'avg resolution', labelFirst: true },
      ])}
    </div>`;
  }

  private renderTabs(openCount: number, historyCount: number): string {
    return `<div style="display:flex;gap:4px;">
      ${tabBtnHtml('open', this.tab, 'Open', openCount)}
      ${tabBtnHtml('history', this.tab, 'History', historyCount)}
    </div>`;
  }

  private renderGroup(type: ConflictType, items: Contradiction[]): string {
    const color = TYPE_COLOR[type];
    return `<section>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:${color};font-weight:700;margin-bottom:4px;">${escapeHtml(TYPE_LABEL[type])} <span style="opacity:0.55;font-weight:400;">(${items.length})</span></div>
      <div style="display:flex;flex-direction:column;gap:6px;">${items.map((c) => this.renderCard(c)).join('')}</div>
    </section>`;
  }

  private renderCard(c: Contradiction): string {
    const color = TYPE_COLOR[c.conflictType];
    const ts = ageLabel(new Date(c.detectedAt), Date.now());
    const statusBadge = renderStatusBadge(c.status);
    const dismissForm = this.dismissingId === c.id ? this.renderDismissForm(c.id) : '';
    const actions = c.status === 'open' && this.dismissingId !== c.id
      ? `<div style="display:flex;gap:4px;justify-content:flex-end;">
          <button class="cd-resolve" data-id="${escapeHtml(c.id)}" type="button" style="padding:2px 8px;background:rgba(46,194,126,0.18);color:#2ec27e;border:1px solid rgba(46,194,126,0.4);border-radius:2px;cursor:pointer;font-size:10px;">Resolve</button>
          <button class="cd-dismiss" data-id="${escapeHtml(c.id)}" type="button" style="padding:2px 8px;background:transparent;color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:2px;cursor:pointer;font-size:10px;">Dismiss…</button>
        </div>`
      : '';
    const dismissReason = c.dismissReason
      ? `<div style="font-size:10px;opacity:0.6;margin-top:4px;font-style:italic;">Dismissed: ${escapeHtml(c.dismissReason)}</div>`
      : '';

    return `<div data-id="${escapeHtml(c.id)}" style="border-left:3px solid ${color};background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;padding:6px 8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="background:rgba(74,158,255,0.18);color:#4a9eff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(c.domain)}</span>
          <span style="font-size:11px;color:#ddd;">${escapeHtml(c.region)}</span>
          ${statusBadge}
        </div>
        <span style="font-size:10px;opacity:0.55;">${ts} · Δ${c.severityDelta} · ${(c.confidence * 100).toFixed(0)}%</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:4px;">
        ${renderObsCell(c.observationA, 'A')}
        ${renderObsCell(c.observationB, 'B')}
      </div>
      ${dismissReason}
      ${actions}
      ${dismissForm}
    </div>`;
  }

  private renderDismissForm(id: string): string {
    return `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:4px;">
      <textarea class="cd-dismiss-reason" data-id="${escapeHtml(id)}" placeholder="Reason (e.g. known noisy source)" style="background:#222;color:#ddd;border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:4px;font-size:11px;font-family:inherit;resize:vertical;min-height:36px;"></textarea>
      <div style="display:flex;gap:4px;justify-content:flex-end;">
        <button class="cd-dismiss-cancel" data-id="${escapeHtml(id)}" type="button" style="padding:2px 8px;background:transparent;color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:2px;cursor:pointer;font-size:10px;">Cancel</button>
        <button class="cd-dismiss-submit" data-id="${escapeHtml(id)}" type="button" style="padding:2px 8px;background:rgba(155,89,182,0.18);color:#9b59b6;border:1px solid rgba(155,89,182,0.4);border-radius:2px;cursor:pointer;font-size:10px;">Submit dismiss</button>
      </div>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const svc = getContradictionDetector();

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.cd-tab')) {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tab;
        if (t === 'open' || t === 'history') {
          this.tab = t;
          this.render();
        }
      });
    }

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.cd-resolve')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (id) svc.resolve(id);
      });
    }
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.cd-dismiss')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (!id) return;
        this.dismissingId = id;
        this.render();
      });
    }
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.cd-dismiss-cancel')) {
      btn.addEventListener('click', () => {
        this.dismissingId = null;
        this.render();
      });
    }
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.cd-dismiss-submit')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (!id) return;
        const reason = root.querySelector<HTMLTextAreaElement>(`.cd-dismiss-reason[data-id="${id}"]`)?.value
          ?? 'no reason given';
        svc.dismiss(id, reason || 'no reason given');
        this.dismissingId = null;
      });
    }
  }
}

function renderStatusBadge(status: Contradiction['status']): string {
  if (status === 'open') return '';
  const color = status === 'resolved' ? '#2ec27e' : '#9ca3af';
  return `<span style="background:${color};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${status}</span>`;
}

function tabBtnHtml(key: Tab, activeKey: Tab, label: string, count: number): string {
  const isActive = activeKey === key;
  const bg = isActive ? 'rgba(74,158,255,0.18)' : 'transparent';
  const borderAlpha = isActive ? '0.4' : '0.15';
  return `<button class="cd-tab" data-tab="${key}" type="button"
    style="padding:3px 10px;background:${bg};color:inherit;border:1px solid rgba(74,158,255,${borderAlpha});border-radius:3px;cursor:pointer;font-size:11px;">${escapeHtml(label)} (${count})</button>`;
}

function renderEmptyState(tab: Tab): string {
  const msg = tab === 'open'
    ? 'No open contradictions — feeds and sources agree on observed world state.'
    : 'No resolved or dismissed contradictions yet.';
  return `<div style="padding:14px;text-align:center;opacity:0.55;font-size:12px;">${msg}</div>`;
}

function renderObsCell(obs: { sourceId: string; severity: string; title: string }, label: string): string {
  return `<div style="border:1px solid rgba(255,255,255,0.08);border-radius:3px;padding:5px 6px;">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.04em;opacity:0.55;">${label} · ${escapeHtml(obs.sourceId)}</div>
    <div style="font-size:11px;color:#ddd;margin-top:2px;">${escapeHtml(obs.title)}</div>
    <div style="font-size:10px;opacity:0.65;margin-top:2px;">severity ${escapeHtml(obs.severity)}</div>
  </div>`;
}

function groupByType(items: readonly Contradiction[]): [ConflictType, Contradiction[]][] {
  const out = new Map<ConflictType, Contradiction[]>();
  for (const c of items) {
    const arr = out.get(c.conflictType);
    if (arr) arr.push(c);
    else out.set(c.conflictType, [c]);
  }
  return [...out.entries()];
}

function ageLabel(then: Date, now: number): string {
  const ms = now - then.getTime();
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s ago`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}h ago`;
  return `${Math.round(ms / (24 * 60 * 60_000))}d ago`;
}
