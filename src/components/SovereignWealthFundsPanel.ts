import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  getLargestFunds,
  getHighRiskFunds,
  transparencyClass,
  riskClass,
} from './sovereign-wealth-funds-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24-hour refresh — data is fundamentally static

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class SovereignWealthFundsPanel extends Panel {
  static readonly panelId = 'sovereign-wealth-funds';
  static readonly title = 'Sovereign Wealth Funds';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: SovereignWealthFundsPanel.panelId,
      title: SovereignWealthFundsPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks 12 major sovereign wealth funds ($8.3T+ combined AUM) as instruments of geopolitical ' +
        'influence and strategic investment. Covers Norway GPFG, China CIC, Abu Dhabi ADIA, Saudi PIF, ' +
        'Kuwait KIA, Singapore GIC & Temasek, Qatar QIA, UAE Mubadala, Russia RDIF (sanctioned), ' +
        'China SAFE, and South Korea KIC. Highlights sports washing, tech acquisition, port/infrastructure ' +
        'plays, media influence, and sanctions evasion patterns.',
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

    const { funds, investments, totalAumTrillions, highRiskCount, sanctionedCount } = data;

    // Badge count = high-risk + sanctioned funds
    this.setCount(highRiskCount + sanctionedCount);

    // ── Summary header ────────────────────────────────────────────────────────
    const header = h('div', { className: 'swf-header' },
      h('div', { className: 'swf-metric' },
        h('span', { className: 'swf-label' }, 'Total AUM'),
        h('span', { className: 'swf-value' }, `$${totalAumTrillions}T`),
      ),
      h('div', { className: 'swf-metric' },
        h('span', { className: 'swf-label' }, 'Funds Tracked'),
        h('span', { className: 'swf-value' }, String(funds.length)),
      ),
      h('div', { className: 'swf-metric' },
        h('span', { className: 'swf-label' }, 'High Geopolitical Risk'),
        h('span', { className: 'swf-value risk-high' }, String(highRiskCount)),
      ),
      h('div', { className: 'swf-metric' },
        h('span', { className: 'swf-label' }, 'Sanctioned'),
        h('span', { className: 'swf-value risk-critical' }, String(sanctionedCount)),
      ),
    );

    // ── Fund rows (sorted by AUM desc) ────────────────────────────────────────
    const fundSection = h('div', { className: 'swf-funds' });
    const sorted = getLargestFunds(funds, funds.length);

    for (const fund of sorted) {
      const tc = transparencyClass(fund.transparency);
      const rc = riskClass(fund.geopoliticalRisk);
      const aumLabel = fund.aumBillions >= 1000
        ? `$${(fund.aumBillions / 1000).toFixed(1)}T`
        : `$${fund.aumBillions}B`;
      const holdingsPreview = fund.notableHoldings.length > 3
        ? `${fund.notableHoldings.slice(0, 3).join(', ')}…`
        : fund.notableHoldings.join(', ');
      const patternsLabel = fund.usePatterns.join(' · ');

      const row = h('div', { className: `swf-fund-row ${rc}` },
        h('div', { className: 'swf-fund-header' },
          h('span', { className: 'swf-fund-name' }, fund.name),
          h('span', { className: 'swf-fund-country' }, fund.country),
          h('span', { className: 'swf-fund-aum' }, aumLabel),
          h('span', { className: `swf-risk-badge ${rc}` }, fund.geopoliticalRisk),
          h('span', { className: `swf-transp-badge ${tc}` }, `Transparency: ${fund.transparency}`),
          ...(fund.sanctioned ? [h('span', { className: 'swf-sanctioned' }, '⚠ SANCTIONED')] : []),
        ),
        h('div', { className: 'swf-fund-focus' },
          `Focus: ${fund.strategicFocus} · ${fund.fundingSource}`,
        ),
        h('div', { className: 'swf-fund-patterns' }, `Patterns: ${patternsLabel}`),
        h('div', { className: 'swf-fund-holdings' }, `Holdings: ${holdingsPreview}`),
        h('div', { className: 'swf-fund-dev' }, fund.recentDevelopment),
      );
      fundSection.append(row);
    }

    // ── Strategic investments section ─────────────────────────────────────────
    const investSection = h('div', { className: 'swf-investments' },
      h('h3', { className: 'swf-section-title' }, 'Notable Strategic Investments (2021-2024)'),
    );

    const byDate = [...investments].sort((a, b) => b.date.localeCompare(a.date));
    for (const inv of byDate) {
      const row = h('div', { className: 'swf-inv-row' },
        h('div', { className: 'swf-inv-header' },
          h('span', { className: 'swf-inv-fund' }, inv.fund),
          h('span', { className: 'swf-inv-target' }, inv.target),
          h('span', { className: 'swf-inv-value' }, inv.value),
          h('span', { className: 'swf-inv-pattern' }, inv.usePattern),
          h('span', { className: 'swf-inv-date' }, inv.date),
        ),
        h('div', { className: 'swf-inv-signal' }, `Signal: ${inv.geopoliticalSignal}`),
      );
      investSection.append(row);
    }

    // ── High-risk spotlight ───────────────────────────────────────────────────
    const highRiskFunds = getHighRiskFunds(funds);
    const riskSpotlight = h('div', { className: 'swf-risk-spotlight' },
      h('h3', { className: 'swf-section-title' }, `High Geopolitical Risk Funds (${highRiskFunds.length})`),
    );
    for (const f of highRiskFunds) {
      const rc2 = riskClass(f.geopoliticalRisk);
      riskSpotlight.append(
        h('div', { className: `swf-risk-row ${rc2}` },
          h('span', { className: 'swf-risk-name' }, f.name),
          h('span', { className: `swf-risk-badge ${rc2}` }, f.geopoliticalRisk),
          h('span', { className: 'swf-risk-patterns' }, f.usePatterns.join(', ')),
        ),
      );
    }

    replaceChildren(this.getContentElement(), header, fundSection, investSection, riskSpotlight);
  }
}
