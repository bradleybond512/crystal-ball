import { Panel } from './Panel';
import {
  type SanctionsDataset,
  type SanctionsStats,
  aggregateStats,
  formatDatasetName,
  getFreshnessLabel,
  getFreshnessStatus,
  mostStaleDataset,
} from './open-sanctions-helpers';
import { escapeHtml } from '@/utils/sanitize';

const FRESHNESS_ICON = { fresh: '✓', aging: '◷', stale: '⚠' } as const;
const FRESHNESS_COLOR = { fresh: '#4ade80', aging: '#fbbf24', stale: '#f87171' } as const;

export class OpenSanctionsPanel extends Panel {
  private stats: SanctionsStats | null = null;

  constructor() {
    super({
      id: 'opensanctions',
      title: 'Global Sanctions & PEP Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Consolidated global sanctions & PEP coverage from OpenSanctions — 150+ watchlists (OFAC, EU, UK OFSI, UN, BIS) with per-dataset freshness.',
    });
    this.showLoading('Fetching sanctions coverage...');
  }

  public update(datasets: SanctionsDataset[]): void {
    this.stats = datasets.length > 0 ? aggregateStats(datasets) : null;
    this.setCount(this.stats?.totalDatasets ?? 0);
    this.render();
  }

  private render(): void {
    const stats = this.stats;
    if (!stats || stats.totalDatasets === 0) {
      this.setContent('<div class="panel-empty">No sanctions coverage data available.</div>');
      return;
    }

    const num = (n: number): string => n.toLocaleString('en-US');

    const coverage = [
      ['Datasets', `${num(stats.totalDatasets)} sources`],
      ['Entities', `${num(stats.totalEntities)} sanctioned individuals & orgs`],
      ...(stats.vessels > 0 ? [['Vessels', `${num(stats.vessels)} flagged ships`]] : []),
      ...(stats.aircraft > 0 ? [['Aircraft', `${num(stats.aircraft)} flagged aircraft`]] : []),
    ]
      .map(
        ([label, value]) =>
          `<div class="os-stat" style="display:flex;justify-content:space-between;gap:8px;padding:2px 0"><span class="os-stat-label" style="opacity:0.6">${escapeHtml(label!)}</span><span class="os-stat-value">${escapeHtml(value!)}</span></div>`,
      )
      .join('');

    const topDatasets = [...stats.datasets]
      .sort((a, b) => (b.entityCount || 0) - (a.entityCount || 0))
      .slice(0, 8);

    const rows = topDatasets
      .map((d) => {
        const status = getFreshnessStatus(d.lastUpdated);
        const icon = FRESHNESS_ICON[status];
        const name = formatDatasetName(d.name) || d.title;
        return `<tr>
          <td class="os-fresh os-fresh-${status}" style="color:${FRESHNESS_COLOR[status]}">${icon}</td>
          <td>${escapeHtml(name)}</td>
          <td style="opacity:0.6;white-space:nowrap">${escapeHtml(getFreshnessLabel(d.lastUpdated))}</td>
          <td style="text-align:right;opacity:0.7">${num(d.entityCount || 0)}</td>
        </tr>`;
      })
      .join('');

    const stale = mostStaleDataset(stats.datasets);
    const agingOrStale = stats.datasets.filter((d) => getFreshnessStatus(d.lastUpdated) !== 'fresh');
    const freshnessLine =
      agingOrStale.length === 0
        ? '<span style="color:#4ade80">✓</span> All datasets fresh (&lt;7 days)'
        : `${agingOrStale.length} of ${stats.totalDatasets} datasets aging or stale`;
    const staleLine = stale
      ? `Most stale: ${escapeHtml(formatDatasetName(stale.name) || stale.title)} (${escapeHtml(getFreshnessLabel(stale.lastUpdated))})`
      : '';

    this.setContent(`
      <div class="ct-panel-content os-panel">
        <div class="os-section-title" style="font-size:0.7rem;letter-spacing:0.05em;opacity:0.5;text-transform:uppercase;margin:4px 0">Consolidated Watchlist Coverage</div>
        <div class="os-coverage">${coverage}</div>

        <div class="os-section-title" style="font-size:0.7rem;letter-spacing:0.05em;opacity:0.5;text-transform:uppercase;margin:8px 0 4px">Dataset Status</div>
        <table class="eq-table ct-table os-dataset-table">
          <tbody>${rows}</tbody>
        </table>

        <div class="os-freshness" style="margin-top:8px;font-size:0.8rem">
          <div>${freshnessLine}</div>
          ${staleLine ? `<div style="opacity:0.7">${staleLine}</div>` : ''}
        </div>

        <div class="fires-footer">
          <span class="fires-source">OpenSanctions · CC-BY 4.0</span>
        </div>
      </div>
    `);
  }
}
