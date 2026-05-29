import { Panel } from './Panel';
import { replaceChildren, h } from '@/utils/dom-utils';
import { buildRenderData, classifyRiskLevel } from './foreign-investment-risk-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function safeText(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class ForeignInvestmentRiskPanel extends Panel {
  static readonly panelId = 'foreign-investment-risk';
  static readonly title = 'Foreign Investment Risk Monitor';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: ForeignInvestmentRiskPanel.panelId,
      title: ForeignInvestmentRiskPanel.title,
      trackActivity: true,
      infoTooltip: 'CFIUS-style strategic FDI screening: tracks foreign acquisitions of critical sectors, block rates, and national security review outcomes.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private render(): void {
    const data = safe(() => buildRenderData());
    if (!data) {
      replaceChildren(this.content, h('div', { className: 'fir-error' }, 'Data unavailable'));
      this.invalidateContentCache();
      return;
    }

    const header = h('div', { className: 'fir-header' });
    const blockSpan = h('span', {});
    blockSpan.textContent = ;
    const pendingSpan = h('span', {});
    pendingSpan.textContent = ;
    const valueSpan = h('span', {});
    valueSpan.textContent = ;
    header.append(blockSpan, pendingSpan, valueSpan);

    const rows = data.transactions.slice(0, 8).map((t) => {
      const row = h('div', { className:  });

      const acq = h('span', { className: 'acquirer' });
      acq.textContent = t.acquirer.length > 20 ? t.acquirer.slice(0, 20) + '…' : t.acquirer;

      const nat = h('span', { className: 'nation' });
      nat.textContent = t.acquirerNation;

      const sec = h('span', { className: 'sector' });
      sec.textContent = t.targetSector;

      const val = h('span', { className: 'value' });
      val.textContent = ;

      const out = h('span', { className: 'outcome' });
      out.textContent = t.outcome;

      const risk = h('span', { className: 'risk' });
      risk.textContent = String(t.riskScore);

      row.append(acq, nat, sec, val, out, risk);
      return row;
    });

    replaceChildren(this.content, header, ...rows);
    this.invalidateContentCache();
    this.markFresh();
  }
}
