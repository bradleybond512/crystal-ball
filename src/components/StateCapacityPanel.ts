/**
 * State Capacity Panel
 *
 * Tracks government effectiveness, rule-of-law, institutional resilience,
 * service delivery, and overall fragility for 15 fragile/failing states.
 *
 * Refresh: every hour (data is structural, not real-time).
 * Layout: sortable list of countries with fragility score, tier badge,
 *         and key indicator scores.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildAllCountriesRenderData,
  sortCountriesByIndicator,
  getCapacityTierColor,
  getCapacityTierLabel,
  getTopFragileStates,
  type CountryRenderData,
  type CapacityTier,
  type CapacitySortKey,
} from './state-capacity-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

const TREND_ARROW: Record<CountryRenderData['trend'], string> = {
  deteriorating: '↓',
  stable:        '→',
  improving:     '↑',
};

const TREND_COLOR: Record<CountryRenderData['trend'], string> = {
  deteriorating: '#ef4444',
  stable:        '#9e9e9e',
  improving:     '#22c55e',
};

type SortKey = CapacitySortKey;

export class StateCapacityPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private sortKey: SortKey = 'fragility';
  private sortAsc = false; // fragility: high first by default

  constructor() {
    super({
      id: 'state-capacity',
      title: 'State Capacity',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Governance effectiveness, rule-of-law, institutional resilience, and fragility index for 15 fragile states. Higher fragility = more at risk of collapse.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', this.onSortClick);
    }
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('click', this.onSortClick);
    }
  }

  private readonly onSortClick = (ev: Event): void => {
    const target = ev.target as Element | null;
    const btn = target?.closest('[data-scp-sort]');
    if (!btn) return;
    const key = btn.getAttribute('data-scp-sort') as SortKey | null;
    if (!key) return;
    if (this.sortKey === key) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortKey = key;
      this.sortAsc = key !== 'fragility';
    }
    this.render();
  };

  private getSortedRows(): CountryRenderData[] {
    return sortCountriesByIndicator(buildAllCountriesRenderData(), this.sortKey, this.sortAsc);
  }

  private render(): void {
    try {
      const rows = this.getSortedRows();
      const collapsedCount = rows.filter((r) => r.tier === 'collapsed').length;
      const fragileCount = rows.filter((r) => r.tier === 'fragile').length;
      this.setCount(collapsedCount + fragileCount);
      this.setContent(this.buildHtml(rows));
    } catch {
      this.setContent('<div style="padding:12px;color:var(--text-secondary,#888);">State capacity data unavailable.</div>');
    }
  }

  private buildHtml(rows: CountryRenderData[]): string {
    const top3 = getTopFragileStates(3);
    const summaryBanner = this.buildSummaryBanner(rows, top3);
    const table = this.buildTable(rows);
    return `${summaryBanner}${table}`;
  }

  private buildSummaryBanner(rows: CountryRenderData[], top3: CountryRenderData[]): string {
    const tierCounts: Record<CapacityTier, number> = {
      collapsed: 0, fragile: 0, weak: 0, moderate: 0, functional: 0,
    };
    for (const r of rows) tierCounts[r.tier]++;

    const chips = (
      Object.entries(tierCounts) as [CapacityTier, number][]
    )
      .filter(([, n]) => n > 0)
      .map(([tier, n]) => {
        const color = getCapacityTierColor(tier);
        const label = getCapacityTierLabel(tier);
        return `<span style="background:${escapeHtml(color)}22;color:${escapeHtml(color)};border:1px solid ${escapeHtml(color)}44;border-radius:3px;padding:1px 6px;font-size:11px;font-weight:600;">${escapeHtml(label)} ${n}</span>`;
      })
      .join(' ');

    const topNames = top3.map((r) => escapeHtml(r.countryName)).join(', ');

    return `
      <div style="padding:8px 10px;background:var(--bg-secondary,#1a1a1a);border-bottom:1px solid var(--border-subtle,#333);">
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;">${chips}</div>
        <div style="font-size:11px;color:var(--text-secondary,#888);">
          Most fragile: ${topNames}
        </div>
      </div>`;
  }

  private sortArrow(key: SortKey): string {
    if (this.sortKey !== key) return ' ↕';
    return this.sortAsc ? ' ↑' : ' ↓';
  }

  private buildTable(rows: CountryRenderData[]): string {
    const thStyle = 'padding:5px 8px;font-weight:600;font-size:11px;color:var(--text-secondary,#888);cursor:pointer;user-select:none;white-space:nowrap;';

    const header = `
      <tr style="border-bottom:1px solid var(--border-subtle,#333);text-align:left;">
        <th style="${thStyle}" data-scp-sort="fragility" scope="col">Country${this.sortArrow('fragility')}</th>
        <th style="${thStyle};text-align:center;" data-scp-sort="fragility" scope="col">Fragility${this.sortArrow('fragility')}</th>
        <th style="${thStyle};text-align:center;" data-scp-sort="governance" scope="col">Gov${this.sortArrow('governance')}</th>
        <th style="${thStyle};text-align:center;" data-scp-sort="ruleOfLaw" scope="col">RoL${this.sortArrow('ruleOfLaw')}</th>
        <th style="${thStyle};text-align:center;" data-scp-sort="serviceDelivery" scope="col">SvD${this.sortArrow('serviceDelivery')}</th>
        <th style="${thStyle};text-align:center;" data-scp-sort="resilience" scope="col">Res${this.sortArrow('resilience')}</th>
        <th style="${thStyle};text-align:center;" scope="col">Trend</th>
      </tr>`;

    const bodyRows = rows.map((r) => this.buildRow(r)).join('');

    return `
      <table role="table" style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>${header}</thead>
        <tbody>${bodyRows}</tbody>
      </table>`;
  }

  private buildRow(r: CountryRenderData): string {
    const tdStyle = 'padding:5px 8px;border-bottom:1px solid var(--border-subtle,#222);';
    const tdCenter = `${tdStyle}text-align:center;`;

    const badge = `<span style="background:${escapeHtml(r.tierColor)}22;color:${escapeHtml(r.tierColor)};border:1px solid ${escapeHtml(r.tierColor)}44;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:600;">${escapeHtml(r.tierLabel)}</span>`;

    const trend = TREND_ARROW[r.trend];
    const trendColor = TREND_COLOR[r.trend];

    const regionLabel = `<div style="font-size:10px;color:var(--text-secondary,#888);">${escapeHtml(r.region)}</div>`;
    const noteTitle = r.trendNote ? ` title="${escapeHtml(r.trendNote)}"` : '';

    return `
      <tr${noteTitle} style="vertical-align:middle;" tabindex="0">
        <td style="${tdStyle}">
          <div style="font-weight:600;font-size:12px;">${escapeHtml(r.countryName)}</div>
          ${regionLabel}
          ${badge}
        </td>
        <td style="${tdCenter}font-weight:700;color:${escapeHtml(r.tierColor)};">${escapeHtml(r.formattedFragility)}</td>
        <td style="${tdCenter}">${r.governanceScore.toFixed(1)}</td>
        <td style="${tdCenter}">${r.ruleOfLawScore.toFixed(1)}</td>
        <td style="${tdCenter}">${r.serviceDeliveryScore.toFixed(1)}</td>
        <td style="${tdCenter}">${r.institutionalResilienceScore.toFixed(1)}</td>
        <td style="${tdCenter}font-size:14px;color:${escapeHtml(trendColor)};" aria-label="${escapeHtml(r.trend)}">${trend}</td>
      </tr>`;
  }
}
