/**
 * IntelligenceTrustBudgetPanel — per-domain alert quota status with
 * Reset and adjustmentFactor display. Distinct from
 * src/components/TrustBudgetPanel.ts (which surfaces the
 * notifications-layer budget); this panel reads the intelligence-layer
 * TrustBudgetService.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getIntelligenceTrustBudgetService,
  type BudgetStatus,
  type TrustBudgetService,
} from '@/services/intelligence/trust-budget';

const REFRESH_MS = 30_000;
const KNOWN_DOMAINS = [
  'earthquake', 'biosurv', 'weather', 'maritime',
  'aviation', 'geopolitical', 'cyber', 'wildfire',
];

export class IntelligenceTrustBudgetPanel extends Panel {
  private readonly service: TrustBudgetService;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'intelligence-trust-budget',
      title: 'Intelligence Trust Budget',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Per-domain alert quota self-throttle. Domains with high false-positive rates get smaller quotas; low-FPR domains earn larger ones.',
    });
    this.service = getIntelligenceTrustBudgetService();
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
      // Surface the well-known 8 domains even before they've been used.
      for (const d of KNOWN_DOMAINS) this.service.getStatus(d);
      const statuses = [...this.service.getAllStatuses()].sort((a, b) => a.domain.localeCompare(b.domain));
      const suppressedCount = statuses.filter((s) => s.suppressionActive).length;
      this.setCount(suppressedCount);
      this.setContent(this.buildHtml(statuses), () => this.wireHandlers());
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Trust-budget panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(statuses: readonly BudgetStatus[]): string {
    const now = Date.now();
    const totalConsumed = statuses.reduce((sum, s) => sum + s.consumed, 0);
    const suppressedDomains = statuses.filter((s) => s.suppressionActive).map((s) => s.domain);
    const header = `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Domains tracked</span>
      <span style="font-size:14px;font-weight:700;">${statuses.length}</span>
      <span style="font-size:11px;color:var(--text-secondary,#aaa);">${totalConsumed} alert${totalConsumed === 1 ? '' : 's'} consumed this window</span>
      <span style="margin-left:auto;font-size:11px;color:${suppressedDomains.length > 0 ? 'var(--severity-critical, #ef4444)' : 'var(--text-secondary,#aaa)'};">${suppressedDomains.length} domain${suppressedDomains.length === 1 ? '' : 's'} suppressed</span>
    </div>`;
    if (statuses.length === 0) {
      return `${header}<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">
        No domains tracked yet.
      </div>`;
    }
    const rows = statuses.map((s) => this.renderRow(s, now)).join('');
    return `${header}<div style="max-height:480px;overflow:auto;">${rows}</div>`;
  }

  private renderRow(status: BudgetStatus, now: number): string {
    const config = this.service.getConfig(status.domain);
    const consumedPct = status.quota === 0 ? 0 : Math.round((status.consumed / status.quota) * 100);
    const barColor = pickBarColor(consumedPct, status.suppressionActive);
    const secondsToReset = Math.max(0, Math.round((status.resetsAt - now) / 1000));
    const resetLabel = formatResetCountdown(secondsToReset);
    const warning = status.suppressionActive
      ? `<div style="margin-top:4px;font-size:10px;color:var(--severity-critical, #ef4444);font-weight:600;">⚠ Suppression active — alerts queued but not delivered until window reset</div>`
      : '';
    return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:9px;font-weight:600;padding:2px 5px;background:rgba(255,255,255,0.06);border-radius:3px;text-transform:uppercase;">${escapeHtml(status.domain)}</span>
        <span style="font-size:11px;color:var(--text-secondary,#bbb);">factor ${config ? config.adjustmentFactor.toFixed(2) : '1.00'}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">resets in ${escapeHtml(resetLabel)}</span>
      </div>
      <div style="margin-top:6px;display:flex;align-items:center;gap:8px;font-size:10px;">
        <span style="min-width:90px;color:var(--text-secondary,#aaa);">${status.consumed} / ${status.quota}</span>
        <div style="flex:1;height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${Math.min(100, consumedPct)}%;background:${barColor};"></div>
        </div>
        <button data-action="reset" data-domain="${escapeHtml(status.domain)}" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--text-secondary,#ccc);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Reset</button>
      </div>
      ${warning}
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-action="reset"]')) {
      button.addEventListener('click', () => {
        const domain = button.dataset.domain;
        if (!domain) return;
        this.service.resetWindow(domain);
        this.render();
      });
    }
  }
}

function pickBarColor(consumedPct: number, suppressionActive: boolean): string {
  if (suppressionActive) return 'var(--severity-critical, #ef4444)';
  if (consumedPct >= 80) return 'var(--severity-high, #fb923c)';
  if (consumedPct >= 50) return 'var(--severity-medium, #facc15)';
  return 'var(--severity-ok, #4ade80)';
}

function formatResetCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
