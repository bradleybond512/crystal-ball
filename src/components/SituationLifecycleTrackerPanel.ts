/**
 * SituationLifecycleTrackerPanel — surfaces per-domain lifecycle stats
 * (avg time-to-escalate, avg time-to-resolve, phase distribution) plus
 * recent situations with a current-phase badge, lifecycle duration
 * bar, and an expandable transition timeline.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getSituationLifecycleTrackerService,
  KNOWN_PHASES,
  type LifecyclePhase,
  type LifecycleStats,
  type PhaseTransition,
  type SituationLifecycle,
  type SituationLifecycleTrackerService,
} from '@/services/intelligence/situation-lifecycle-tracker';

const REFRESH_MS = 30_000;
const RECENT_LIMIT = 20;

const PHASE_COLOR: Record<LifecyclePhase, string> = {
  detected: 'var(--severity-low, #60a5fa)',
  escalated: 'var(--severity-medium, #facc15)',
  investigated: 'var(--severity-high, #fb923c)',
  mitigated: 'var(--accent, #4ade80)',
  resolved: 'var(--severity-ok, #4ade80)',
  closed: 'var(--text-secondary, #888)',
};

export class SituationLifecycleTrackerPanel extends Panel {
  private readonly service: SituationLifecycleTrackerService;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private filterDomain: string | null = null;
  private filterPhase: LifecyclePhase | null = null;
  private expandedSituationId: string | null = null;

  constructor() {
    super({
      id: 'situation-lifecycle-tracker',
      title: 'Lifecycle Tracker',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Per-situation lifecycle history. Tracks every phase transition (detected → escalated → investigated → mitigated → resolved → closed) and computes avg time-to-escalate / time-to-resolve per domain.',
    });
    this.service = getSituationLifecycleTrackerService();
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = this.service.subscribe(() => this.render());
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

  private render(): void {
    try {
      const filterArg = this.filterDomain || this.filterPhase
        ? { ...(this.filterDomain ? { domain: this.filterDomain } : {}), ...(this.filterPhase ? { currentPhase: this.filterPhase } : {}) }
        : undefined;
      const lifecycles = this.service.getAll(filterArg, RECENT_LIMIT);
      const stats = this.service.getStats(this.filterDomain ?? undefined);
      this.setCount(lifecycles.length);
      this.setContent(this.buildHtml(stats, lifecycles), () => this.wireHandlers());
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Lifecycle panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(stats: readonly LifecycleStats[], lifecycles: readonly SituationLifecycle[]): string {
    return `${this.renderControls(stats)}
      <div style="padding:14px 16px;max-height:560px;overflow:auto;">
        ${renderStatsTable(stats)}
        ${this.renderLifecyclesList(lifecycles)}
      </div>`;
  }

  private renderControls(stats: readonly LifecycleStats[]): string {
    const domains = [...new Set(stats.map((s) => s.domain))].sort((a, b) => a.localeCompare(b));
    const domainOptions = `<option value="">All domains</option>` + domains.map((d) =>
      `<option value="${escapeHtml(d)}"${this.filterDomain === d ? ' selected' : ''}>${escapeHtml(d)}</option>`,
    ).join('');
    const phaseOptions = `<option value="">All phases</option>` + KNOWN_PHASES.map((p) =>
      `<option value="${escapeHtml(p)}"${this.filterPhase === p ? ' selected' : ''}>${escapeHtml(p)}</option>`,
    ).join('');
    return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <select class="lc-domain" style="font-size:11px;padding:3px 6px;background:transparent;color:var(--text-primary,#ddd);border:1px solid var(--border-subtle,#333);border-radius:3px;">${domainOptions}</select>
      <select class="lc-phase" style="font-size:11px;padding:3px 6px;background:transparent;color:var(--text-primary,#ddd);border:1px solid var(--border-subtle,#333);border-radius:3px;">${phaseOptions}</select>
    </div>`;
  }

  private renderLifecyclesList(lifecycles: readonly SituationLifecycle[]): string {
    if (lifecycles.length === 0) {
      return `<div style="font-size:11px;color:var(--text-secondary,#888);font-style:italic;padding:18px 0;text-align:center;">No matching lifecycles tracked yet.</div>`;
    }
    const rows = lifecycles.map((lc) => this.renderLifecycleRow(lc)).join('');
    return `<section style="margin-top:14px;">
      <h3 style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Recent Lifecycles</h3>
      <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;">${rows}</ul>
    </section>`;
  }

  private renderLifecycleRow(lc: SituationLifecycle): string {
    const color = PHASE_COLOR[lc.currentPhase];
    const expanded = this.expandedSituationId === lc.situationId;
    const dur = lc.totalDurationMs ?? (Date.now() - lc.detectedAt);
    const durBar = renderDurationBar(lc);
    const timeline = expanded ? renderTransitionTimeline(lc.transitions) : '';
    return `<li class="lc-row" data-id="${escapeHtml(lc.situationId)}" style="padding:8px 10px;background:rgba(255,255,255,0.03);border-left:3px solid ${color};border-radius:3px;cursor:pointer;">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;">
        <div style="display:flex;gap:8px;align-items:baseline;">
          <span style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:${color};">[${escapeHtml(lc.currentPhase)}]</span>
          <span style="font-size:12px;font-weight:600;">${escapeHtml(lc.situationId)}</span>
          <span style="font-size:10px;color:var(--text-secondary,#888);">— ${escapeHtml(lc.domain)}</span>
        </div>
        <span style="font-size:10px;color:var(--text-secondary,#aaa);font-variant-numeric:tabular-nums;">${formatDuration(dur)}</span>
      </div>
      ${durBar}
      ${timeline}
    </li>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const domainSel = root.querySelector<HTMLSelectElement>('.lc-domain');
    domainSel?.addEventListener('change', () => {
      this.filterDomain = domainSel.value || null;
      this.render();
    });
    const phaseSel = root.querySelector<HTMLSelectElement>('.lc-phase');
    phaseSel?.addEventListener('change', () => {
      this.filterPhase = (phaseSel.value as LifecyclePhase | '') || null;
      this.render();
    });
    const rows = root.querySelectorAll<HTMLElement>('.lc-row');
    rows.forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.dataset.id ?? null;
        this.expandedSituationId = this.expandedSituationId === id ? null : id;
        this.render();
      });
    });
  }
}

function renderStatsTable(stats: readonly LifecycleStats[]): string {
  if (stats.length === 0) {
    return `<div style="font-size:11px;color:var(--text-secondary,#888);font-style:italic;">No domain stats yet.</div>`;
  }
  const rows = stats.map((s) => `<tr>
    <td style="padding:4px 8px;font-size:11px;">${escapeHtml(s.domain)}</td>
    <td style="padding:4px 8px;font-size:11px;text-align:right;font-variant-numeric:tabular-nums;">${s.sampleCount}</td>
    <td style="padding:4px 8px;font-size:11px;text-align:right;font-variant-numeric:tabular-nums;">${formatMaybe(s.avgTimeToEscalateMs)}</td>
    <td style="padding:4px 8px;font-size:11px;text-align:right;font-variant-numeric:tabular-nums;">${formatMaybe(s.avgTimeToResolveMs)}</td>
    <td style="padding:4px 8px;font-size:10px;color:var(--text-secondary,#aaa);">${renderPhaseDots(s)}</td>
  </tr>`).join('');
  return `<section style="margin-bottom:14px;">
    <h3 style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Domain Stats</h3>
    <table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead><tr style="border-bottom:1px solid var(--border-subtle,#333);">
        <th style="padding:4px 8px;text-align:left;font-weight:600;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.06em;font-size:10px;">Domain</th>
        <th style="padding:4px 8px;text-align:right;font-weight:600;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.06em;font-size:10px;">n</th>
        <th style="padding:4px 8px;text-align:right;font-weight:600;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.06em;font-size:10px;">Avg → Escalate</th>
        <th style="padding:4px 8px;text-align:right;font-weight:600;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.06em;font-size:10px;">Avg → Resolve</th>
        <th style="padding:4px 8px;text-align:left;font-weight:600;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.06em;font-size:10px;">Phases</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function renderPhaseDots(s: LifecycleStats): string {
  const parts: string[] = [];
  for (const phase of KNOWN_PHASES) {
    const count = s.phaseDistribution[phase];
    if (count === 0) continue;
    parts.push(`<span style="color:${PHASE_COLOR[phase]};">●</span><span style="color:var(--text-secondary,#aaa);">${count}</span>`);
  }
  return parts.join(' ');
}

function renderDurationBar(lc: SituationLifecycle): string {
  if (lc.transitions.length < 2) return '';
  const start = lc.detectedAt;
  const end = lc.closedAt ?? lc.resolvedAt ?? (lc.transitions[lc.transitions.length - 1]?.transitionedAt ?? start);
  const total = Math.max(1, end - start);
  const segs: string[] = [];
  for (let i = 0; i < lc.transitions.length; i++) {
    const t = lc.transitions[i]!;
    const next = lc.transitions[i + 1];
    const segEnd = next ? next.transitionedAt : end;
    const width = ((segEnd - t.transitionedAt) / total) * 100;
    if (width <= 0) continue;
    segs.push(`<div title="${escapeHtml(t.toPhase)}" style="width:${width.toFixed(2)}%;background:${PHASE_COLOR[t.toPhase]};"></div>`);
  }
  return `<div style="display:flex;height:4px;border-radius:2px;overflow:hidden;background:rgba(255,255,255,0.05);margin-top:6px;">${segs.join('')}</div>`;
}

function renderTransitionTimeline(transitions: readonly PhaseTransition[]): string {
  if (transitions.length === 0) return '';
  const rows = transitions.map((t) => {
    const color = PHASE_COLOR[t.toPhase];
    const ts = new Date(t.transitionedAt).toISOString().slice(11, 19);
    const dur = t.durationInPriorPhase === null ? '—' : formatDuration(t.durationInPriorPhase);
    const from = t.fromPhase ? `${t.fromPhase} → ` : '';
    return `<li style="padding:3px 0;font-size:10px;color:var(--text-secondary,#aaa);">
      <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#888);">${escapeHtml(ts)}</span>
      <span style="color:${color};font-weight:600;"> ${escapeHtml(from)}${escapeHtml(t.toPhase)}</span>
      <span style="color:var(--text-secondary,#888);"> · prior: ${escapeHtml(dur)}</span>
    </li>`;
  }).join('');
  return `<ul style="margin:6px 0 0;padding:0 0 0 6px;list-style:none;border-left:1px solid var(--border-subtle,#333);">${rows}</ul>`;
}

function formatMaybe(ms: number | null): string {
  return ms === null ? '—' : formatDuration(ms);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h`;
  const days = Math.round(hr / 24);
  return `${days}d`;
}
