import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  statusClass,
  leverageClass,
} from './debt-trap-diplomacy-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class DebtTrapDiplomacyPanel extends Panel {
  static readonly panelId = 'debt-trap-diplomacy';
  static readonly title = 'Debt Trap Diplomacy';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: DebtTrapDiplomacyPanel.panelId,
      title: DebtTrapDiplomacyPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks BRI debt trap diplomacy, sovereign debt vulnerability, and financial coercion ' +
        'dynamics. Monitors 12 high-risk debtor nations (Sri Lanka, Zambia, Pakistan, Kenya, ' +
        'Ecuador, Montenegro, Laos, Angola, Tanzania, Ethiopia, Argentina, Cambodia) with ' +
        'Chinese debt exposure, strategic assets at risk, and current debt status.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    const data = safe(() => buildRenderData());
    if (!data) {
      replaceChildren(
        this.getContentElement(),
        h('div', { className: 'panel-empty' }, 'Data unavailable'),
      );
      return;
    }

    const { debtors, stats, atRiskCount, defaultedCount, restructuringCount } = data;
    this.setCount(atRiskCount + defaultedCount + restructuringCount);

    let idxClass: string;
    if (stats.vulnerabilityIndex >= 70) {
      idxClass = 'dtd-critical';
    } else if (stats.vulnerabilityIndex >= 50) {
      idxClass = 'dtd-high';
    } else if (stats.vulnerabilityIndex >= 30) {
      idxClass = 'dtd-moderate';
    } else {
      idxClass = 'dtd-low';
    }

    const header = h('div', { className: 'dtd-header' },
      h('div', { className: 'dtd-metric' },
        h('span', { className: 'dtd-label' }, 'Vulnerability Index'),
        h('span', { className: 'dtd-value ' + idxClass }, String(stats.vulnerabilityIndex) + '/100'),
      ),
      h('div', { className: 'dtd-metric' },
        h('span', { className: 'dtd-label' }, 'At Risk'),
        h('span', { className: 'dtd-value dtd-at-risk' }, String(atRiskCount)),
      ),
      h('div', { className: 'dtd-metric' },
        h('span', { className: 'dtd-label' }, 'Defaulted'),
        h('span', { className: 'dtd-value dtd-defaulted' }, String(defaultedCount)),
      ),
      h('div', { className: 'dtd-metric' },
        h('span', { className: 'dtd-label' }, 'Restructuring'),
        h('span', { className: 'dtd-value dtd-restructuring' }, String(restructuringCount)),
      ),
    );

    const lendingBar = h('div', { className: 'dtd-lending' },
      h('div', { className: 'dtd-lending-title' }, 'China Overseas Lending vs. World Bank / IMF'),
      h('div', { className: 'dtd-lending-row' },
        h('span', { className: 'dtd-lender-china' }, 'China: $' + String(stats.chinaOverseasLendingBn) + 'B'),
        h('span', { className: 'dtd-lender-wb' }, 'World Bank+IMF: $' + String(stats.worldBankImfCombinedBn) + 'B'),
        h('span', { className: 'dtd-total-debt' }, 'BRI Tracked: $' + stats.totalBriDebtBn.toFixed(1) + 'B'),
      ),
    );

    const countriesSection = h('div', { className: 'dtd-countries' });

    const statusOrder: Record<string, number> = {
      Defaulted: 0, Restructuring: 1, 'At Risk': 2, Repaying: 3,
    };
    const sorted = [...debtors].sort((a, b) => {
      const od = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
      return od === 0 ? b.debtToChinaBn - a.debtToChinaBn : od;
    });

    for (const d of sorted) {
      const sc = statusClass(d.status);
      const lc = leverageClass(d.leverageType);
      const row = h('div', { className: 'dtd-country-row ' + sc },
        h('div', { className: 'dtd-country-header' },
          h('span', { className: 'dtd-country-name' }, d.country),
          h('span', { className: 'dtd-status-badge ' + sc }, d.status),
          h('span', { className: 'dtd-leverage-badge ' + lc }, d.leverageType),
          h('span', { className: 'dtd-debt-amount' }, '$' + String(d.debtToChinaBn) + 'B'),
          h('span', { className: 'dtd-gdp-pct' }, String(d.chineseDebtToGdpPct) + '% GDP'),
        ),
        h('div', { className: 'dtd-strategic-asset' }, d.strategicAsset),
        h('div', { className: 'dtd-notes' }, d.notes),
      );
      countriesSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, lendingBar, countriesSection);
  }
}
