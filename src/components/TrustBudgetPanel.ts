/**
 * Trust Budget Panel (panel id: `trust-budget`).
 *
 * Per-domain alert quota gauges. Each row shows used / quota, a colored
 * fill bar, exhausted state, and the most recent quota adjustment
 * reason. Header shows the global pool (sum of domain quotas) plus the
 * minutes-until-recharge countdown. "Adjust quotas" button forces
 * re-application of the outcome-driven calibrations on demand.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getTrustBudgetService,
  type DomainBudget,
  type TrustBudgetSnapshot,
} from '@/services/notifications/trust-budget';
import { escapeHtml } from '@/utils/sanitize';

const WINDOW_MS = 60 * 60_000;
const REFRESH_MS = 15_000;

const COLORS = {
  ok: '#2ec27e',
  warn: '#f5a524',
  exhausted: '#e94f37',
  track: 'rgba(255,255,255,0.06)',
};

function colorForPct(pct: number): string {
  if (pct >= 100) return COLORS.exhausted;
  if (pct >= 75) return COLORS.warn;
  return COLORS.ok;
}

export class TrustBudgetPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'trust-budget',
      title: 'Trust Budget',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Per-domain hourly alert quota that auto-tightens when false-positive rate is high and loosens when alerts are valuable. Each row shows used / current quota, exhausted state, and the most recent adjustment reason.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = getTrustBudgetService().subscribe(() => this.render());
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    super.destroy();
  }

  private render(): void {
    const snap = getTrustBudgetService().getSnapshot();
    this.setCount(snap.exhaustedDomains.length);
    this.setContent(this.buildHtml(snap), () => this.wireHandlers());
  }

  private buildHtml(snap: TrustBudgetSnapshot): string {
    const sortedDomains = [...snap.domains].sort((a, b) => {
      if (a.exhausted !== b.exhausted) return a.exhausted ? -1 : 1;
      const aUtil = a.currentQuota > 0 ? a.used / a.currentQuota : 0;
      const bUtil = b.currentQuota > 0 ? b.used / b.currentQuota : 0;
      return bUtil - aUtil;
    });

    return `<div class="tb-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderHeader(snap)}
      ${this.renderGlobalBar(snap)}
      ${sortedDomains.length === 0
        ? '<div style="padding:14px;text-align:center;opacity:0.55;font-size:12px;">No domains have consumed budget yet.</div>'
        : `<div style="display:flex;flex-direction:column;gap:6px;">${sortedDomains.map((d) => this.renderRow(d, snap.takenAt)).join('')}</div>`}
      ${this.renderFooter(snap)}
    </div>`;
  }

  private renderHeader(snap: TrustBudgetSnapshot): string {
    const exhaustedBadge = snap.exhaustedDomains.length > 0
      ? `<span style="background:${COLORS.exhausted};color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;">${snap.exhaustedDomains.length} exhausted</span>`
      : '';
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;">Hourly pool</span>
        ${exhaustedBadge}
      </div>
      <button class="tb-adjust" type="button" style="padding:3px 8px;background:rgba(74,158,255,0.18);color:inherit;border:1px solid rgba(74,158,255,0.4);border-radius:3px;cursor:pointer;font-size:11px;">Adjust quotas</button>
    </div>`;
  }

  private renderGlobalBar(snap: TrustBudgetSnapshot): string {
    const used = snap.globalUsed;
    const total = snap.globalQuota > 0 ? snap.globalQuota : 1;
    const pct = Math.min(100, (used / total) * 100);
    const color = colorForPct(pct);
    return `<div style="display:flex;flex-direction:column;gap:4px;">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:#bbb;">
        <span>Global usage</span>
        <span>${used.toFixed(0)} / ${snap.globalQuota.toFixed(1)} per hour</span>
      </div>
      <div style="height:8px;border-radius:4px;background:${COLORS.track};overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};"></div>
      </div>
    </div>`;
  }

  private renderRow(d: DomainBudget, now: Date): string {
    const ratio = d.currentQuota > 0 ? d.used / d.currentQuota : 1;
    const pct = Math.min(100, ratio * 100);
    const color = d.exhausted ? COLORS.exhausted : colorForPct(pct);
    const tint = d.exhausted ? 'background:rgba(233,79,55,0.07);' : '';
    const rechargeMin = Math.max(0, Math.ceil((d.windowStartMs + WINDOW_MS - now.getTime()) / 60_000));
    const exhaustedBadge = d.exhausted
      ? `<span style="background:${COLORS.exhausted};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">exhausted</span>`
      : '';

    return `<div style="border-left:3px solid ${color};${tint}padding:6px 8px;border-radius:0 3px 3px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-weight:600;color:#ddd;">${escapeHtml(d.domain)}</span>
          ${exhaustedBadge}
        </div>
        <span style="font-size:10px;opacity:0.6;font-family:ui-monospace,monospace;">
          ${d.used.toFixed(0)} / ${d.currentQuota.toFixed(1)} · recharge ${rechargeMin}m
        </span>
      </div>
      <div style="height:6px;border-radius:3px;background:${COLORS.track};overflow:hidden;margin-top:4px;">
        <div style="width:${pct}%;height:100%;background:${color};"></div>
      </div>
      <div style="font-size:10px;opacity:0.55;margin-top:3px;">${escapeHtml(d.adjustmentReason)}</div>
    </div>`;
  }

  private renderFooter(snap: TrustBudgetSnapshot): string {
    const lastAdjusted = snap.domains.length > 0
      ? snap.domains.reduce((max, b) => b.lastAdjustedAt.getTime() > max.getTime() ? b.lastAdjustedAt : max, snap.domains[0]!.lastAdjustedAt)
      : null;
    const label = lastAdjusted
      ? `Last adjustment: ${lastAdjusted.toISOString().replace('T', ' ').slice(0, 19)}Z`
      : '';
    return `<div style="font-size:10px;opacity:0.5;text-align:right;">${escapeHtml(label)}</div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    root.querySelector<HTMLButtonElement>('.tb-adjust')?.addEventListener('click', () => {
      getTrustBudgetService().adjustQuotas();
    });
  }
}
