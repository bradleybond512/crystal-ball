import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  exporterShareClass,
  dealStatusClass,
} from './arms-sales-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class ArmsSalesPanel extends Panel {
  static readonly panelId = 'arms-sales';
  static readonly title = 'Arms Sales';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: ArmsSalesPanel.panelId,
      title: ArmsSalesPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks major conventional arms transfers (2022-2024) as a geopolitical alignment indicator. ' +
        'Data inspired by SIPRI methodology. Shows exporter market share and major active deals.',
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
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
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

    const { exporters, deals, globalArmsIndex, usaDominanceScore, totalValueB } = data;

    // Count significant deals (significance >= 8)
    const highSigCount = deals.filter(d => d.significance >= 8).length;
    this.setCount(highSigCount);

    // ── Summary header ───────────────────────────────────────────────────────
    const header = h('div', { className: 'as-header' },
      h('div', { className: 'as-metric' },
        h('span', { className: 'as-label' }, 'Arms Market Index'),
        h('span', { className: 'as-value as-value-highlight' }, `${globalArmsIndex}/100`),
      ),
      h('div', { className: 'as-metric' },
        h('span', { className: 'as-label' }, 'USA Dominance'),
        h('span', { className: 'as-value share-dominant' }, `${usaDominanceScore}%`),
      ),
      h('div', { className: 'as-metric' },
        h('span', { className: 'as-label' }, 'Total Deal Value'),
        h('span', { className: 'as-value' }, `$${totalValueB.toFixed(0)}B`),
      ),
      h('div', { className: 'as-metric' },
        h('span', { className: 'as-label' }, 'Active Exporters'),
        h('span', { className: 'as-value' }, String(exporters.length)),
      ),
    );

    // ── Exporter table ───────────────────────────────────────────────────────
    const exporterSection = h('div', { className: 'as-section' },
      h('h3', { className: 'as-section-title' }, 'Global Arms Exporter Rankings'),
    );

    const exporterTable = h('table', { className: 'as-table' },
      h('thead', {},
        h('tr', {},
          h('th', {}, 'Exporter'),
          h('th', {}, 'Share'),
          h('th', {}, 'Trend'),
          h('th', {}, 'Top Recipients'),
        ),
      ),
    );
    const tbody = h('tbody', {});

    for (const exp of [...exporters].sort((a, b) => b.globalSharePct - a.globalSharePct)) {
      const trendSymbol = exp.trend === 'rising' ? '↑' : exp.trend === 'declining' ? '↓' : '→';
      const trendCls = exp.trend === 'rising' ? 'trend-up' : exp.trend === 'declining' ? 'trend-down' : 'trend-flat';
      const row = h('tr', { className: 'as-exporter-row' },
        h('td', { className: 'as-country' }, exp.country),
        h('td', {},
          h('span', { className: `as-share-badge ${exporterShareClass(exp.globalSharePct)}` },
            `${exp.globalSharePct}%`,
          ),
        ),
        h('td', { className: trendCls }, trendSymbol),
        h('td', { className: 'as-recipients' }, exp.topRecipients.slice(0, 3).join(', ')),
      );
      tbody.append(row);
    }
    exporterTable.append(tbody);
    exporterSection.append(exporterTable);

    // ── Major deals ──────────────────────────────────────────────────────────
    const dealSection = h('div', { className: 'as-section' },
      h('h3', { className: 'as-section-title' }, 'Major Arms Deals 2022-2024'),
    );

    const sortedDeals = [...deals].sort((a, b) => b.significance - a.significance);
    for (const deal of sortedDeals) {
      const row = h('div', { className: `as-deal-row ${dealStatusClass(deal.status)}` },
        h('div', { className: 'as-deal-header' },
          h('span', { className: 'as-deal-route' }, `${deal.exporter} → ${deal.recipient}`),
          h('span', { className: `as-status-badge ${dealStatusClass(deal.status)}` }, deal.status),
          h('span', { className: 'as-deal-value' }, `$${deal.valueB}B`),
          h('span', { className: 'as-deal-year' }, String(deal.year)),
          h('span', { className: 'as-sig-score' }, `Sig: ${deal.significance}/10`),
        ),
        h('div', { className: 'as-deal-system' }, deal.systemType),
        h('div', { className: 'as-deal-desc' }, deal.description),
      );
      dealSection.append(row);
    }

    replaceChildren(this.getContentElement(), header, exporterSection, dealSection);
  }
}
