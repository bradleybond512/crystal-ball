/**
 * Cross-Domain Contradiction Detector Panel
 * (panel id: `cross-domain-contradiction-detector`).
 *
 * Shows active cross-domain contradictions — pairs of domains
 * reporting conflicting severities for the same region — with
 * severity badge, region tag, description, and a Resolve button.
 * Stats strip at the top breaks down totals + active + per-domain
 * involvement.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  CrossDomainContradictionDetector,
  type ContradictionRecord,
  type ContradictionSeverity,
} from '@/services/intelligence/cross-domain-contradiction-detector';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;

const SEVERITY_COLOR: Record<ContradictionSeverity, string> = {
  high: '#e94f37',
  medium: '#f5a524',
  low: '#9ca3af',
};

export class CrossDomainContradictionDetectorPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'cross-domain-contradiction-detector',
      title: 'Cross-Domain Conflicts',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Flags pairs of domains reporting conflicting severities for the same region within a 2-hour window.',
    });
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private render(): void {
    const det = CrossDomainContradictionDetector.getInstance();
    const stats = det.getStats();
    const active = det.getActive();
    this.setCount(stats.active);
    this.setContent(this.buildHtml(stats, active), () => this.wireHandlers());
  }

  private buildHtml(
    stats: { total: number; active: number; byDomain: Record<string, number> },
    active: readonly ContradictionRecord[],
  ): string {
    return `<div class="xdc-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderStats(stats)}
      ${this.renderActive(active)}
    </div>`;
  }

  private renderStats(stats: { total: number; active: number; byDomain: Record<string, number> }): string {
    const domains = Object.entries(stats.byDomain)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    return `<div style="display:flex;flex-direction:column;gap:5px;padding:6px 8px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:4px;">
      <div style="display:flex;justify-content:space-between;font-size:11px;">
        <span>${stats.active} active</span>
        <span style="opacity:0.75;font-family:ui-monospace,monospace;">${stats.total} total</span>
      </div>
      ${domains.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:3px;">${domains.map(([domain, count]) => `<span style="font-size:9px;background:rgba(74,158,255,0.15);color:#9ec5ff;padding:1px 6px;border-radius:2px;font-family:ui-monospace,monospace;">${escapeHtml(domain)} · ${count}</span>`).join('')}</div>` : ''}
    </div>`;
  }

  private renderActive(active: readonly ContradictionRecord[]): string {
    if (active.length === 0) {
      return `<div style="font-size:11px;opacity:0.55;padding:6px 0;text-align:center;">No active cross-domain contradictions.</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:5px;">${active.map((r) => this.renderRecord(r)).join('')}</div>`;
  }

  private renderRecord(r: ContradictionRecord): string {
    const color = SEVERITY_COLOR[r.severity];
    return `<div data-record-id="${escapeHtml(r.id)}" style="border-left:3px solid ${color};background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;padding:6px 8px;display:flex;flex-direction:column;gap:3px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <span style="font-family:ui-monospace,monospace;font-size:11px;color:#ddd;">${escapeHtml(r.domainA)} ↔ ${escapeHtml(r.domainB)}</span>
        <span style="font-size:9px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(r.severity)}</span>
      </div>
      ${r.region ? `<div style="font-size:10px;opacity:0.75;font-family:ui-monospace,monospace;">region: ${escapeHtml(r.region)}</div>` : ''}
      <div style="font-size:10.5px;opacity:0.85;">${escapeHtml(r.description)}</div>
      <div style="display:flex;justify-content:flex-end;">
        <button class="xdc-resolve" type="button" style="padding:2px 8px;background:rgba(46,194,126,0.18);color:#2ec27e;border:1px solid rgba(46,194,126,0.45);border-radius:2px;cursor:pointer;font-size:10px;font-family:inherit;">Resolve</button>
      </div>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const det = CrossDomainContradictionDetector.getInstance();
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.xdc-resolve')) {
      btn.addEventListener('click', () => {
        const row = btn.closest<HTMLElement>('[data-record-id]');
        const id = row?.getAttribute('data-record-id');
        if (!id) return;
        det.resolve(id, 'operator');
        this.render();
      });
    }
  }
}
