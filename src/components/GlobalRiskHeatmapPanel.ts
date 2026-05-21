/**
 * Global Risk Heatmap Panel — at-a-glance region × domain severity matrix.
 *
 * Rows  = 9 world regions (North America → Arctic).
 * Cols  = 9 domains (weather, seismic, health, cyber, …).
 * Cells = colored 0–4 severity bucket from the highest-severity recent
 *         observation that lands in that (region, domain) pair.
 *
 * All taxonomy + aggregation logic lives in
 * `./global-risk-heatmap-utils.ts` so it can be unit-tested without
 * pulling in the Panel base class and its transitive imports.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { getRecent } from '@/services/intelligence/observation-store';
import {
  REGION_KEYS,
  DOMAIN_KEYS,
  REGION_LABEL,
  DOMAIN_LABEL,
  aggregateHeatmap,
  totalEventCount,
  bucketLabel,
  type HeatmapCell,
  type HeatmapMatrix,
  type SeverityBucket,
} from './global-risk-heatmap-utils';
import type { ObservationEvent } from '@/types/intelligence';

const REFRESH_MS = 15_000;
const MAX_EVENTS = 500;

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export class GlobalRiskHeatmapPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastUpdatedAt = 0;
  private boundClickHandler: ((ev: MouseEvent) => void) | null = null;

  constructor() {
    super({
      id: 'global-risk-heatmap',
      title: 'Global Risk Heatmap',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'At-a-glance global risk: 9 regions × 9 domains, colored by the highest severity observed in the last batch. Hover any cell for event count + severity label.',
    });
    this.start();
  }

  private start(): void {
    this.renderMatrix();
    this.refreshTimer = setInterval(() => this.renderMatrix(), REFRESH_MS);
    if (typeof document !== 'undefined') {
      this.boundClickHandler = (ev) => this.onClick(ev);
      this.content.addEventListener('click', this.boundClickHandler);
    }
  }

  public dispose(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.boundClickHandler) {
      this.content.removeEventListener('click', this.boundClickHandler);
      this.boundClickHandler = null;
    }
  }

  private onClick(ev: MouseEvent): void {
    const target = (ev.target as Element | null)?.closest('[data-heatmap-action]');
    if (!target) return;
    if (target.getAttribute('data-heatmap-action') === 'refresh') {
      this.renderMatrix();
    }
  }

  /** Test seam — re-runs the read + render cycle deterministically. */
  public renderMatrix(): void {
    const events = safe(() => getRecent(MAX_EVENTS), [] as ObservationEvent[]);
    const matrix = aggregateHeatmap(events);
    const total = totalEventCount(matrix);
    this.lastUpdatedAt = Date.now();
    this.setCount(total);
    replaceChildren(this.content, this.buildRoot(matrix, total));
  }

  private buildRoot(matrix: HeatmapMatrix, total: number): HTMLElement {
    return h(
      'div',
      { className: 'global-risk-heatmap', style: 'padding:10px;display:flex;flex-direction:column;gap:10px;font-size:11px;' },
      this.buildHeader(total),
      this.buildGrid(matrix),
      this.buildLegend(),
    );
  }

  private buildHeader(total: number): HTMLElement {
    const stamp = this.lastUpdatedAt > 0 ? new Date(this.lastUpdatedAt).toISOString().slice(11, 19) : '—';
    return h(
      'div',
      { className: 'global-risk-heatmap-header', style: 'display:flex;align-items:center;gap:10px;' },
      h('span', { style: 'color:var(--text-secondary,#888);' }, `${total} events · last updated ${stamp}`),
      h('span', { style: 'flex:1;' }),
      h(
        'button',
        {
          type: 'button',
          dataset: { heatmapAction: 'refresh' },
          style: 'font-size:10px;padding:3px 8px;border:1px solid var(--border-subtle,#444);border-radius:3px;background:transparent;color:var(--text-secondary,#aaa);cursor:pointer;',
        },
        'Refresh',
      ),
    );
  }

  private buildGrid(matrix: HeatmapMatrix): HTMLElement {
    const gridStyle = `display:grid;grid-template-columns:120px repeat(${DOMAIN_KEYS.length}, 1fr);gap:2px;`;
    const grid = h('div', { className: 'global-risk-heatmap-grid', style: gridStyle, role: 'table' });

    // Header row
    grid.append(h('div', { style: 'font-size:10px;color:var(--text-secondary,#888);' }, ''));
    for (const d of DOMAIN_KEYS) {
      grid.append(h(
        'div',
        {
          className: 'global-risk-heatmap-col-label',
          style: 'font-size:10px;color:var(--text-secondary,#888);text-align:center;padding:3px 0;text-transform:uppercase;letter-spacing:0.04em;',
          role: 'columnheader',
        },
        DOMAIN_LABEL[d],
      ));
    }

    // Data rows
    for (const r of REGION_KEYS) {
      grid.append(h(
        'div',
        {
          className: 'global-risk-heatmap-row-label',
          style: 'font-size:11px;color:var(--text-primary,#ddd);padding:4px 6px;text-align:right;',
          role: 'rowheader',
        },
        REGION_LABEL[r],
      ));
      for (const d of DOMAIN_KEYS) {
        const cell = matrix[r][d];
        grid.append(this.buildCell(cell));
      }
    }

    return grid;
  }

  private buildCell(cell: HeatmapCell): HTMLElement {
    const sevLabel = bucketLabel(cell.severity);
    const plural = cell.count === 1 ? '' : 's';
    const title = `${REGION_LABEL[cell.region]} · ${DOMAIN_LABEL[cell.domain]}: ${cell.count} event${plural} (${sevLabel})`;
    return h('div', {
      className: 'global-risk-heatmap-cell',
      role: 'cell',
      title,
      dataset: { region: cell.region, domain: cell.domain, severity: String(cell.severity), count: String(cell.count) },
      style: `background:var(--severity-${cell.severity});height:24px;border-radius:2px;`,
    });
  }

  private buildLegend(): HTMLElement {
    const legend = h('div', {
      className: 'global-risk-heatmap-legend',
      style: 'display:flex;align-items:center;gap:8px;font-size:10px;color:var(--text-secondary,#888);padding-top:4px;border-top:1px solid var(--border-subtle,#222);',
    }, h('span', null, 'Severity:'));
    for (const b of [0, 1, 2, 3, 4] as SeverityBucket[]) {
      legend.append(
        h('span', {
          className: 'global-risk-heatmap-legend-swatch',
          dataset: { severity: String(b) },
          style: `width:12px;height:12px;border-radius:2px;background:var(--severity-${b});display:inline-block;`,
        }),
        h('span', null, bucketLabel(b)),
      );
    }
    return legend;
  }
}
