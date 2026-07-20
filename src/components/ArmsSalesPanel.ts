/**
 * ArmsSalesPanel (panel id: `arms-sales`).
 *
 * Tracks major conventional arms transfers as a geopolitical alignment
 * indicator (SIPRI-inspired data). Arms flows reveal alliances, dependencies,
 * and strategic intentions — who supplies whom is one of the clearest signals
 * of great-power alignment.
 *
 * Four sections:
 *   1. Global Arms Trade Index
 *   2. Top Arms Exporters (2019-2023)
 *   3. Major Transfer Deals (2022-2024)
 *   4. Major Importer Profiles
 *
 * Pure logic lives in `arms-sales-helpers.ts`.
 */
import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildRenderData,
  exporterShareClass,
  dealTypeClass,
  dealTypeLabel,
  dealCategoryLabel,
  dealStatusColor,
  trendLabel,
  trendColor,
  globalIndexColor,
  dominanceRiskColor,
  formatUsdB,
  formatShare,
  type ArmsExporter,
  type ArmsDeal,
  type ImporterProfile,
  type GlobalArmsIndex,
} from './arms-sales-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', { className: 'app-section-header' }, title);
  if (badge) header.append(badge);
  return header;
}

function countBadge(count: number, label: string): HTMLElement {
  return h('span', {
    style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
  }, `${count} ${label}`);
}

export class ArmsSalesPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'arms-sales',
      title: 'Arms Sales & Transfers',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks major conventional arms transfers as a geopolitical alignment indicator. ' +
        'SIPRI-inspired data: top 10 exporters (2019-2023 share), 12 major deals (2022-2024), ' +
        'importer profiles, and a composite global arms trade index. Arms flows reveal alliances, ' +
        'dependencies, and strategic intentions.',
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
    if (!data) return;

    this.setCount(data.activeDeals + data.controversialDeals);

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'app-root' },
        this.buildIndexSection(data.globalIndex, data.totalDealValueUsdB),
        this.buildExportersSection(data.exporters),
        this.buildDealsSection(data.deals, data.activeDeals, data.controversialDeals),
        this.buildImportersSection(data.importers),
      ),
    );
  }

  // ── Section 1: Global Arms Trade Index ───────────────────────────────────

  private buildIndexSection(idx: GlobalArmsIndex, totalUsdB: number): HTMLElement {
    const scoreColor = globalIndexColor(idx.score);
    const riskColor  = dominanceRiskColor(idx.usaDominanceRisk);

    return h('div', { className: 'app-section' },
      sectionHeader('Global Arms Trade Index'),
      h('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;padding:6px 0' },
        h('div', { style: 'flex:1;min-width:120px' },
          h('div', { style: `font-size:28px;font-weight:700;color:${scoreColor}` }, String(idx.score)),
          h('div', { style: 'font-size:10px;color:#9e9e9e;text-transform:uppercase' }, 'Composite Score / 100'),
        ),
        h('div', { style: 'flex:2;min-width:180px;display:flex;flex-direction:column;gap:4px' },
          h('div', { style: 'font-size:12px;color:#ccc' },
            'Trend: ',
            h('span', { style: `color:${trendColor(idx.trend)};font-weight:600` }, trendLabel(idx.trend)),
          ),
          h('div', { style: 'font-size:12px;color:#ccc' },
            'Post-Ukraine uplift: ',
            h('span', { style: 'color:#facc15;font-weight:600' }, `+${idx.postUkraineUplift}%`),
          ),
          h('div', { style: 'font-size:12px;color:#ccc' },
            'USA dominance risk: ',
            h('span', { style: `color:${riskColor};font-weight:600;text-transform:uppercase` },
              idx.usaDominanceRisk,
            ),
          ),
          h('div', { style: 'font-size:12px;color:#ccc' },
            'Deal portfolio: ',
            h('span', { style: 'color:#facc15;font-weight:600' }, formatUsdB(totalUsdB)),
          ),
        ),
      ),
    );
  }

  // ── Section 2: Top Arms Exporters ────────────────────────────────────────

  private buildExportersSection(exporters: ArmsExporter[]): HTMLElement {
    const tbody = h('tbody');
    exporters.forEach((e, i) => {
      const shareStyle = exporterShareClass(e.share2019_2023);
      const tColor     = trendColor(e.trend);
      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e' }, String(i + 1)),
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;${shareStyle}` }, e.country),
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:700;text-align:right;${shareStyle}` },
            formatShare(e.share2019_2023),
          ),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tColor};text-align:right` },
            trendLabel(e.trend),
          ),
          cell(e.primaryRecipients.slice(0, 3).join(', '), 'color:#9e9e9e;font-size:11px'),
        ),
      );
    });

    return h('div', { className: 'app-section' },
      sectionHeader('Top Arms Exporters', countBadge(exporters.length, '2019-23')),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Rank · exporter · SIPRI share · trend · primary recipients',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: Major Transfer Deals ──────────────────────────────────────

  private buildDealsSection(
    deals: ArmsDeal[],
    activeCount: number,
    controversialCount: number,
  ): HTMLElement {
    const badge = (activeCount + controversialCount) > 0
      ? countBadge(activeCount + controversialCount, 'active/controversial')
      : undefined;

    const tbody = h('tbody');
    for (const d of deals) {
      const sColor = dealStatusColor(d.status);
      const tColor = dealTypeClass(d.dealType);
      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' },
            `${d.exporterCode} → ${d.recipientCode}`,
          ),
          cell(dealCategoryLabel(d.category), 'color:#ccc'),
          h('td', { style: `padding:3px 6px;font-size:11px;${tColor}` },
            dealTypeLabel(d.dealType),
          ),
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:700;color:#facc15;text-align:right' },
            formatUsdB(d.valueUsdB),
          ),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` },
            d.status,
          ),
        ),
      );
      tbody.append(
        h('tr',
          h('td', { colSpan: 5, style: 'padding:0 6px 5px 24px;font-size:11px;color:#9e9e9e;border-bottom:1px solid #1e1e1e' },
            d.notes,
          ),
        ),
      );
    }

    const total = deals.reduce((s, d) => s + d.valueUsdB, 0);

    return h('div', { className: 'app-section' },
      sectionHeader('Major Arms Transfer Deals (2022-2024)', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        `Exporter → recipient · category · type · value · status · total: ${formatUsdB(total)}`,
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 4: Major Importer Profiles ───────────────────────────────────

  private buildImportersSection(importers: ImporterProfile[]): HTMLElement {
    const tbody = h('tbody');
    for (const imp of importers) {
      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600;color:#facc15' },
            imp.country,
          ),
          cell(imp.mainSuppliers.join(', '), 'color:#60a5fa'),
          cell(imp.keySystems.slice(0, 3).join(', '), 'color:#ccc;font-size:11px'),
        ),
      );
      tbody.append(
        h('tr',
          h('td', { colSpan: 3, style: 'padding:0 6px 5px 24px;font-size:11px;color:#9e9e9e;border-bottom:1px solid #1e1e1e' },
            imp.strategicNote,
          ),
        ),
      );
    }

    return h('div', { className: 'app-section' },
      sectionHeader('Major Importer Profiles'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Country · main suppliers · key systems · strategic context',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}
