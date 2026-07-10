/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Assumption Tracker Panel — Phase 4 surface for the v2
 * AssumptionTrackerService. Top row shows total / active /
 * violated / confirmed counts and the live violation rate.
 * Filter bar narrows by domain / status. Violations feed (most
 * recent first) sits below. Each assumption row expands inline
 * to show rationale, confidence, full status history, and any
 * violations linked to it.
 */

import { Panel } from './Panel';
import {
  getAssumptionTrackerService,
  type Assumption,
  type AssumptionConfidence,
  type AssumptionStatus,
  type AssumptionSummary,
  type AssumptionViolation,
  type ViolationSeverity,
} from '@/services/intelligence/assumption-tracker-v2';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const ASSUMPTIONS_DISPLAY_LIMIT = 50;

const STATUS_COLOR: Record<AssumptionStatus, string> = {
  active: '#4a9eff',
  confirmed: '#4caf50',
  violated: '#f44336',
  expired: '#9e9e9e',
};

const CONFIDENCE_COLOR: Record<AssumptionConfidence, string> = {
  high: '#4caf50',
  medium: '#ffb74d',
  low: '#f44336',
};

const SEVERITY_COLOR: Record<ViolationSeverity, string> = {
  critical: '#f44336',
  significant: '#ffb74d',
  minor: '#9e9e9e',
};

interface PanelState {
  domainFilter: string;
  statusFilter: AssumptionStatus | 'all';
  expandedId: string | null;
}

export class AssumptionTrackerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private state: PanelState = {
    domainFilter: 'all',
    statusFilter: 'all',
    expandedId: null,
  };

  constructor() {
    super({
      id: 'assumption-tracker-v2',
      title: 'Assumption Tracker',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Phase 4 assumption tracker (v2). Annotates intelligence outputs with the assumptions they rely on, transitions them through active → confirmed / violated / expired, and surfaces live violation rate alongside the recent-violations feed.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsub = getAssumptionTrackerService().subscribe(() => this.render());
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

  private filteredAssumptions(): Assumption[] {
    const svc = getAssumptionTrackerService();
    const filter: Parameters<typeof svc.getAssumptions>[0] = {};
    if (this.state.domainFilter !== 'all') filter.domain = this.state.domainFilter;
    if (this.state.statusFilter !== 'all') filter.status = this.state.statusFilter;
    return svc.getAssumptions(filter, ASSUMPTIONS_DISPLAY_LIMIT);
  }

  private collectDomains(all: readonly Assumption[]): string[] {
    const set = new Set<string>();
    for (const a of all) set.add(a.domain);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  private render(): void {
    const svc = getAssumptionTrackerService();
    const summary = svc.getSummary();
    const allAssumptions = svc.getAssumptions(undefined, ASSUMPTIONS_DISPLAY_LIMIT);
    const domains = this.collectDomains(allAssumptions);
    const filteredAssumptions = this.filteredAssumptions();

    // Panel chip count = currently-violated assumptions; that's what
    // the safety surface actually cares about.
    this.setCount(summary.byStatus.violated);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      ${renderSummaryRow(summary)}
      ${this.renderFilterBar(domains)}
      ${renderRecentViolations(summary.recentViolations)}
      ${this.renderAssumptionsList(filteredAssumptions)}
    </div>`;
    this.setContent(html, () => this.wireHandlers());
  }

  private renderFilterBar(domains: readonly string[]): string {
    const domainOpts = ['all', ...domains].map((d) =>
      `<option value="${escapeHtml(d)}"${d === this.state.domainFilter ? ' selected' : ''}>${escapeHtml(d === 'all' ? 'All domains' : d)}</option>`,
    ).join('');
    const statusOpts = (['all', 'active', 'confirmed', 'violated', 'expired'] as const).map((s) =>
      `<option value="${s}"${s === this.state.statusFilter ? ' selected' : ''}>${s === 'all' ? 'All statuses' : s}</option>`,
    ).join('');
    return `<div style="display:flex;align-items:center;gap:12px;font-size:11px;">
      <label style="display:flex;align-items:center;gap:6px;color:var(--text-secondary,#aaa);">
        Domain
        <select id="assumptionDomainFilter" style="padding:4px 8px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;">${domainOpts}</select>
      </label>
      <label style="display:flex;align-items:center;gap:6px;color:var(--text-secondary,#aaa);">
        Status
        <select id="assumptionStatusFilter" style="padding:4px 8px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;">${statusOpts}</select>
      </label>
    </div>`;
  }

  private renderAssumptionsList(assumptions: readonly Assumption[]): string {
    if (assumptions.length === 0) {
      return `<div style="font-size:12px;color:var(--text-secondary,#aaa);padding:16px;text-align:center;border:1px dashed var(--border-subtle,#333);border-radius:4px;">No assumptions match the current filter.</div>`;
    }
    const svc = getAssumptionTrackerService();
    const items = assumptions.map((a) => {
      const expanded = a.id === this.state.expandedId;
      const linkedViolations = expanded ? svc.getViolations(a.id, 5) : [];
      return renderAssumptionRow(a, expanded, linkedViolations);
    }).join('');
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Assumptions</div>
      <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;">${items}</ul>
    </div>`;
  }

  private wireHandlers(): void {
    setTimeout(() => {
      const root = this.content;
      const domainSel = root.querySelector<HTMLSelectElement>('#assumptionDomainFilter');
      domainSel?.addEventListener('change', () => {
        this.state.domainFilter = domainSel.value;
        this.render();
      });
      const statusSel = root.querySelector<HTMLSelectElement>('#assumptionStatusFilter');
      statusSel?.addEventListener('change', () => {
        this.state.statusFilter = statusSel.value as PanelState['statusFilter'];
        this.render();
      });
      root.querySelectorAll<HTMLElement>('[data-assumption-row]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.dataset.assumptionRow;
          if (!id) return;
          this.state.expandedId = this.state.expandedId === id ? null : id;
          this.render();
        });
      });
    }, 0);
  }
}

// ── Rendering helpers ───────────────────────────────────────────────

function renderSummaryRow(summary: AssumptionSummary): string {
  const ratePct = (summary.violationRate * 100).toFixed(1);
  return `<div style="display:flex;gap:18px;font-size:12px;font-family:ui-monospace,monospace;flex-wrap:wrap;">
    <span><strong>${summary.total}</strong> total</span>
    <span><strong style="color:${STATUS_COLOR.active};">${summary.byStatus.active}</strong> active</span>
    <span><strong style="color:${STATUS_COLOR.confirmed};">${summary.byStatus.confirmed}</strong> confirmed</span>
    <span><strong style="color:${STATUS_COLOR.violated};">${summary.byStatus.violated}</strong> violated</span>
    <span><strong style="color:${STATUS_COLOR.expired};">${summary.byStatus.expired}</strong> expired</span>
    <span>violation rate <strong>${ratePct}%</strong></span>
  </div>`;
}

function renderRecentViolations(violations: readonly AssumptionViolation[]): string {
  if (violations.length === 0) {
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Recent violations</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">None recorded.</div>
    </div>`;
  }
  const items = violations.map((v) => {
    const color = SEVERITY_COLOR[v.severity];
    return `<li style="display:flex;align-items:flex-start;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,0.05));font-size:11px;line-height:1.5;">
      <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${color}26;color:${color};text-transform:uppercase;letter-spacing:0.04em;flex-shrink:0;">${escapeHtml(v.severity)}</span>
      <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);flex-shrink:0;">${escapeHtml(v.assumptionId)}</span>
      <span style="flex:1;">${escapeHtml(v.evidence)}</span>
      <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);flex-shrink:0;">${formatAgo(Date.now() - v.detectedAt)}</span>
    </li>`;
  }).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Recent violations</div>
    <ul style="margin:0;padding:0;list-style:none;">${items}</ul>
  </div>`;
}

function renderAssumptionRow(
  a: Assumption,
  expanded: boolean,
  linkedViolations: readonly AssumptionViolation[],
): string {
  const statusColor = STATUS_COLOR[a.status];
  const confidenceColor = CONFIDENCE_COLOR[a.confidence];
  const arrow = expanded ? '▾' : '▸';
  return `<li data-assumption-row="${escapeHtml(a.id)}" style="cursor:pointer;border:1px solid var(--border-subtle,#333);border-left:3px solid ${statusColor};border-radius:3px;background:var(--surface-2,#1a1a1a);padding:8px 10px;display:flex;flex-direction:column;gap:4px;">
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
      <span style="color:var(--text-secondary,#aaa);width:12px;">${arrow}</span>
      <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${statusColor}26;color:${statusColor};text-transform:uppercase;letter-spacing:0.04em;">${a.status}</span>
      <span style="font-weight:600;flex:1;">${escapeHtml(a.label)}</span>
      <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${confidenceColor}26;color:${confidenceColor};text-transform:uppercase;letter-spacing:0.04em;">${a.confidence}</span>
      <span style="font-size:11px;font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);">${escapeHtml(a.domain)}</span>
    </div>
    ${expanded ? renderAssumptionExpansion(a, linkedViolations) : ''}
  </li>`;
}

function renderAssumptionExpansion(
  a: Assumption,
  linkedViolations: readonly AssumptionViolation[],
): string {
  const rows: string[] = [
    `<div><span style="color:var(--text-secondary,#aaa);">Rationale:</span> ${escapeHtml(a.rationale)}</div>`,
    `<div><span style="color:var(--text-secondary,#aaa);">Algorithm:</span> <span style="font-family:ui-monospace,monospace;">${escapeHtml(a.algorithmId)}</span> · <span style="color:var(--text-secondary,#aaa);">output:</span> <span style="font-family:ui-monospace,monospace;">${escapeHtml(a.outputId)}</span></div>`,
    `<div><span style="color:var(--text-secondary,#aaa);">Created:</span> <span style="font-family:ui-monospace,monospace;">${escapeHtml(new Date(a.createdAt).toISOString())}</span></div>`,
    ...(a.validatedAt === undefined ? [] : [`<div><span style="color:var(--text-secondary,#aaa);">Validated:</span> <span style="font-family:ui-monospace,monospace;">${escapeHtml(new Date(a.validatedAt).toISOString())}</span></div>`]),
    ...(a.violatedAt === undefined ? [] : [`<div><span style="color:var(--text-secondary,#aaa);">Violated:</span> <span style="font-family:ui-monospace,monospace;">${escapeHtml(new Date(a.violatedAt).toISOString())}</span></div>`]),
    ...(a.expiresAt === undefined ? [] : [`<div><span style="color:var(--text-secondary,#aaa);">Expires:</span> <span style="font-family:ui-monospace,monospace;">${escapeHtml(new Date(a.expiresAt).toISOString())}</span></div>`]),
  ];
  let violationsBlock = '';
  if (linkedViolations.length > 0) {
    const items = linkedViolations.map((v) => {
      const color = SEVERITY_COLOR[v.severity];
      return `<li style="font-size:11px;line-height:1.5;"><span style="font-size:9px;padding:1px 5px;border-radius:3px;background:${color}26;color:${color};text-transform:uppercase;margin-right:6px;">${escapeHtml(v.severity)}</span>${escapeHtml(v.evidence)}</li>`;
    }).join('');
    violationsBlock = `<div style="margin-top:4px;"><span style="color:var(--text-secondary,#aaa);">Violations:</span><ul style="margin:2px 0 0;padding-left:14px;">${items}</ul></div>`;
  }
  return `<div style="display:flex;flex-direction:column;gap:3px;font-size:11px;padding-top:4px;border-top:1px solid var(--border-subtle,#333);">
    ${rows.join('')}
    ${violationsBlock}
  </div>`;
}

function formatAgo(ms: number): string {
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
