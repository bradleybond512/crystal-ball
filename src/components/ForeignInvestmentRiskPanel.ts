import { Panel } from './Panel';
import {
  buildRenderData,
  statusBadgeClass,
  riskClass,
  getCriticalSectors,
  rankSectorsByExposure,
  type FDITransaction,
  type SectorExposure,
} from './foreign-investment-risk-helpers';

const REFRESH_MS = 15 * 60 * 1000; // 15 minutes

function h(tag: string, attrs: Record<string, string>, ...children: (string | Node)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) {
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

function safeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class ForeignInvestmentRiskPanel extends Panel {
  static panelId = 'foreign-investment-risk';
  static title = 'Foreign Investment Risk';

  constructor() {
    super(ForeignInvestmentRiskPanel.panelId, ForeignInvestmentRiskPanel.title, REFRESH_MS);
  }

  protected async refresh(): Promise<void> {
    const data = safe(() => buildRenderData());
    if (!data) {
      this.replaceChildren(h('div', { class: 'error' }, 'Data unavailable'));
      return;
    }

    const { transactions, sectorExposures, blockRate, approvalRate, pendingCount, highRiskCount, totalValueBn, totalValueBlockedBn } = data;

    // Header metrics
    const header = h('div', { class: 'fdi-header' },
      h('div', { class: 'fdi-metric' },
        h('span', { class: 'fdi-metric-label' }, 'Block Rate'),
        h('span', { class: 'fdi-metric-value risk-high' }, `${blockRate}%`),
      ),
      h('div', { class: 'fdi-metric' },
        h('span', { class: 'fdi-metric-label' }, 'Approval Rate'),
        h('span', { class: 'fdi-metric-value status-ok' }, `${approvalRate}%`),
      ),
      h('div', { class: 'fdi-metric' },
        h('span', { class: 'fdi-metric-label' }, 'Pending Review'),
        h('span', { class: 'fdi-metric-value status-warn' }, String(pendingCount)),
      ),
      h('div', { class: 'fdi-metric' },
        h('span', { class: 'fdi-metric-label' }, 'High Risk'),
        h('span', { class: 'fdi-metric-value risk-critical' }, String(highRiskCount)),
      ),
      h('div', { class: 'fdi-metric' },
        h('span', { class: 'fdi-metric-label' }, 'Blocked Value'),
        h('span', { class: 'fdi-metric-value risk-high' }, `$${totalValueBlockedBn.toFixed(0)}B`),
      ),
    );

    // Transaction table
    const txSection = h('div', { class: 'fdi-section' },
      h('h3', { class: 'fdi-section-title' }, 'Notable FDI Reviews'),
    );
    for (const tx of transactions) {
      const row = h('div', { class: `fdi-tx-row ${riskClass(tx.riskLevel)}` },
        h('div', { class: 'fdi-tx-main' },
          h('span', { class: 'fdi-tx-acquirer' }, safeHtml(tx.acquirer)),
          h('span', { class: 'fdi-tx-arrow' }, ' -> '),
          h('span', { class: 'fdi-tx-target' }, safeHtml(tx.target)),
          h('span', { class: `fdi-tx-status ${statusBadgeClass(tx.status)}` }, safeHtml(tx.status)),
        ),
        h('div', { class: 'fdi-tx-meta' },
          h('span', { class: 'fdi-tx-sector' }, safeHtml(tx.targetSector)),
          h('span', { class: 'fdi-tx-body' }, safeHtml(tx.reviewBody)),
          h('span', { class: 'fdi-tx-year' }, String(tx.year)),
          tx.dealValueBn > 0 ? h('span', { class: 'fdi-tx-value' }, `$${tx.dealValueBn}B`) : h('span', {}),
        ),
        h('div', { class: 'fdi-tx-notes' }, safeHtml(tx.notes)),
      );
      txSection.appendChild(row);
    }

    // Sector exposure
    const sectorSection = h('div', { class: 'fdi-section' },
      h('h3', { class: 'fdi-section-title' }, 'Sector Exposure'),
    );
    for (const sec of rankSectorsByExposure(sectorExposures)) {
      const row = h('div', { class: `fdi-sector-row ${riskClass(sec.sensitivityLevel)}` },
        h('span', { class: 'fdi-sector-name' }, safeHtml(sec.sector)),
        h('span', { class: 'fdi-sector-pct' }, `${sec.foreignOwnershipPct}% foreign`),
        h('span', { class: `fdi-sector-sens ${riskClass(sec.sensitivityLevel)}` }, safeHtml(sec.sensitivityLevel)),
        h('span', { class: 'fdi-sector-actors' }, safeHtml(sec.topForeignActors.join(', '))),
      );
      sectorSection.appendChild(row);
    }

    this.replaceChildren(header, txSection, sectorSection);
  }
}
