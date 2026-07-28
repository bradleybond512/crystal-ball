/**
 * Belief Calibration Panel — a diagnostics surface for the AI-2 BeliefValue
 * probability type (`src/types/belief.ts`).
 *
 * Three sections:
 *  1. The ICD 203 estimative-probability lexicon — the fixed vocabulary
 *     (`getProbabilityLabel`) mapped to its numeric bands, so a reader can see
 *     exactly where "likely" ends and "very-likely" begins.
 *  2. The migrated components — the three production scores that now carry a
 *     first-class `BeliefValue` alongside their legacy number (truth score,
 *     driver severity, correlation location confidence).
 *  3. A staleness demo — one belief shown fresh and again after its inputs
 *     expire, to make the interval-widening behaviour visible.
 *
 * Pure read-only render; no live data dependency. The numbers in sections 2-3
 * are illustrative point estimates run through the real belief-helpers so the
 * panel always reflects the actual math.
 */

import { Panel } from './Panel';
import {
  createBelief,
  formatBelief,
  applyStalenessDegradation,
  getProbabilityLabel,
  fromLegacySeverity,
  intervalWidth,
} from './belief-helpers';
import type { BeliefValue, ProbabilityLabel } from '@/types/belief';
import { escapeHtml } from '@/utils/sanitize';
import { formatDurationMs } from '@/utils/format-duration';
import {
  buildCalibrationReport,
  buildDomainReportCard,
  buildForecastWorkbench,
  createForecastWorkbenchState,
} from './calibration-report-view';
import type {
  CalibrationReportView,
  DomainReportCard,
  ForecastFilterOption,
  ForecastReliabilityView,
  ForecastWorkbenchMetric,
  ForecastWorkbenchRow,
  ForecastWorkbenchSortField,
  ForecastWorkbenchState,
  ForecastWorkbenchView,
} from './calibration-report-view';
import { getCalibrationStore } from '@/services/intelligence/forecast-calibration-adapter';
import { brierScore } from '@/services/intelligence/forecast-calibration';
import { buildCurve } from '@/services/cognition/recalibration';
import { conformalInterval } from '@/services/cognition/conformal';
import { getOperatorBrier, getOperatorCurve } from '@/services/cognition/forecast-journal';
import type { CalibrationComparison } from '@/services/cognition/forecast-journal';

interface LabelBand {
  label: ProbabilityLabel;
  range: string;
  example: number;
}

/** Mirrors the bands in `getProbabilityLabel`, top (most likely) first. */
const LABEL_BANDS: LabelBand[] = [
  { label: 'almost-certainly', range: '95–100%', example: 0.97 },
  { label: 'very-likely', range: '85–95%', example: 0.9 },
  { label: 'likely', range: '55–85%', example: 0.72 },
  { label: 'roughly-even', range: '45–55%', example: 0.5 },
  { label: 'unlikely', range: '30–45%', example: 0.38 },
  { label: 'very-unlikely', range: '10–30%', example: 0.2 },
  { label: 'almost-certainly-not', range: '0–10%', example: 0.05 },
];

interface MigratedComponent {
  name: string;
  source: string;
  belief: BeliefValue;
  note: string;
}

function stalenessRow(caption: string, b: BeliefValue): string {
  return `
      <tr>
        <td style="font-weight:600;white-space:nowrap;">${escapeHtml(caption)}</td>
        <td>${escapeHtml(formatBelief(b))}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;">
          width ${(intervalWidth(b) * 100).toFixed(0)}%
        </td>
      </tr>`;
}

export class BeliefCalibrationPanel extends Panel {
  private readonly workbenchState: ForecastWorkbenchState = createForecastWorkbenchState();

  constructor() {
    super({
      id: 'belief-calibration',
      title: 'Belief Calibration',
      showCount: false,
      className: 'panel-wide',
      trackActivity: true,
      infoTooltip:
        'Audit forecast calibration by cohort, inspect individual errors, and review the AI-2 BeliefValue probability vocabulary and confidence intervals.',
    });
    this.content.addEventListener(
      'change',
      (event) => this.handleWorkbenchFilter(event),
      { signal: this.signal },
    );
    this.content.addEventListener(
      'click',
      (event) => this.handleWorkbenchSort(event),
      { signal: this.signal },
    );
    this.render();
  }

  private render(): void {
    this.setContent(
      [
        this.buildCalibrationReportSection(),
        this.buildLexiconSection(),
        this.buildMigratedSection(),
        this.buildStalenessSection(),
      ].join(''),
    );
  }

  private buildCalibrationReportSection(): string {
    let workbench: ForecastWorkbenchView;
    let view: CalibrationReportView;
    let domainCard: DomainReportCard = { rows: [] };
    try {
      const records = getCalibrationStore().all();
      workbench = buildForecastWorkbench(records, this.workbenchState);
      const curve = buildCurve(records);
      const interval = conformalInterval(0.5, 'global', records);
      const coveragePct = Math.round((1 - interval.alpha) * 100);

      let comparison: CalibrationComparison | null = null;
      try {
        const operator = getOperatorBrier();
        if (operator.n > 0) {
          const system = brierScore(records);
          comparison = {
            domain: 'global',
            operator: { brier: operator.brier, n: operator.n, curve: getOperatorCurve() },
            system: { brier: system.score, n: system.resolvedCount, curve },
            humanEdge: null,
            explanation: '',
          };
        }
      } catch { /* operator journal unavailable — fall back to system-only */ }

      view = buildCalibrationReport({ curve, coveragePct, comparison });
      domainCard = buildDomainReportCard(records);
    } catch {
      workbench = buildForecastWorkbench([], this.workbenchState);
      view = { headline: 'Calibration report unavailable', rows: [], hasOperatorData: false };
    }

    const operatorRow = view.hasOperatorData
      ? `<p style="margin:8px 0 0;font-size:11px;opacity:0.8;">${escapeHtml(view.operatorLine!)}</p>`
      : `<p style="margin:8px 0 0;font-size:11px;opacity:0.6;">Log your own forecasts to compare (coming soon).</p>`;

    const domainRows = domainCard.rows
      .map(
        (r) => `
        <tr>
          <td style="text-align:left;">${escapeHtml(r.domain)}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(String(r.total))}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(String(r.resolved))}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums;">${
            r.brier === null
              ? '<span title="needs ≥5 resolved">—</span>'
              : escapeHtml(r.brier.toFixed(4))
          }</td>
        </tr>`,
      )
      .join('');

    const domainReportCard = domainCard.rows.length > 0
      ? `
      <div style="margin-top:10px;">
        <h4 style="margin:0 0 6px;font-size:12px;">Per-domain report card</h4>
        <p style="margin:0 0 8px;font-size:11px;opacity:0.7;">
          Predictions logged and resolved per domain, with the resolved-set Brier
          score once there is enough evidence to trust it.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="opacity:0.6;text-align:left;">
              <th>Domain</th>
              <th style="text-align:right;">Predictions</th>
              <th style="text-align:right;">Resolved</th>
              <th style="text-align:right;">Brier</th>
            </tr>
          </thead>
          <tbody>${domainRows}</tbody>
        </table>
      </div>`
      : '';

    return `
      ${this.renderForecastWorkbench(workbench)}
      <details style="margin:0 0 18px;">
        <summary style="cursor:pointer;font-size:12px;font-weight:600;">
          Legacy benchmark · ${escapeHtml(view.headline)}
        </summary>
        ${operatorRow}
        ${domainReportCard}
      </details>`;
  }

  private renderForecastWorkbench(view: ForecastWorkbenchView): string {
    const controls = [
      this.renderFilter('source', 'Source', view.filterOptions.sources),
      this.renderFilter('domain', 'Domain', view.filterOptions.domains),
      this.renderFilter('horizon', 'Horizon', view.filterOptions.horizons),
      this.renderFilter('version', 'Version', view.filterOptions.versions),
      this.renderFilter(
        'resolutionMethod',
        'Resolution',
        view.filterOptions.resolutionMethods,
      ),
    ].join('');
    const proxyCount = view.comparison.selected.proxyLabelsExcluded;
    const proxyNoun = proxyCount === 1 ? 'label' : 'labels';
    const proxyExclusions = proxyCount > 0
      ? ` ${proxyCount} proxy ${proxyNoun} excluded from metrics.`
      : '';
    const visibleRows = view.rows.slice(0, 100);

    return `
      <section data-forecast-workbench
        data-total-records="${view.totalRecords}"
        data-matching-records="${view.totalMatching}"
        data-reliability-status="${view.reliability.status}"
        style="margin-bottom:18px;">
        <h3 style="margin:0 0 4px;font-size:13px;">Forecast evaluation workbench</h3>
        <p style="margin:0 0 10px;font-size:11px;opacity:0.72;">
          Audit every forecast and compare the selected cohort against the fixed
          60/40 chronological holdout. Aggregate metrics use direct and manual
          labels only.${escapeHtml(proxyExclusions)}
        </p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(108px,1fr));gap:6px;margin-bottom:10px;">
          ${controls}
        </div>
        ${this.renderCohortComparison(view)}
        ${this.renderLossAttribution(view)}
        ${this.renderReliabilityChart(view.reliability)}
        ${this.renderDrilldowns(view)}
        <div style="overflow-x:auto;margin-top:10px;">
          <table style="width:100%;min-width:760px;border-collapse:collapse;font-size:11px;">
            <thead>
              <tr style="opacity:0.7;text-align:left;">
                ${this.renderSortHeader('target', 'Target')}
                ${this.renderSortHeader('probability', 'Probability', 'right')}
                <th style="padding:4px;text-align:right;">Observed</th>
                ${this.renderSortHeader('brier', 'Brier', 'right')}
                ${this.renderSortHeader('evidenceAge', 'Evidence age', 'right')}
                <th style="padding:4px;">Resolution</th>
              </tr>
            </thead>
            <tbody>${visibleRows.map((row) => this.renderForecastRow(row)).join('')}</tbody>
          </table>
        </div>
        ${this.renderRowsStatus(view, visibleRows.length)}
      </section>`;
  }

  private renderFilter(
    key: keyof ForecastWorkbenchState['filters'],
    label: string,
    options: readonly ForecastFilterOption[],
  ): string {
    const current = this.workbenchState.filters[key];
    const id = `belief-calibration-filter-${key}`;
    const optionRows = options.map((option) => `
      <option value="${escapeHtml(option.value)}"${
        option.value === current ? ' selected' : ''
      }>${escapeHtml(option.value)} (${option.count})</option>`).join('');
    return `
      <label for="${id}" style="display:grid;gap:3px;font-size:10px;opacity:0.82;">
        ${escapeHtml(label)}
        <select id="${id}" name="${id}" data-workbench-filter="${escapeHtml(key)}"
          style="min-width:0;padding:4px;background:var(--surface-elevated,#171717);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:4px;font-size:11px;">
          <option value="all"${current === 'all' ? ' selected' : ''}>All</option>
          ${optionRows}
        </select>
      </label>`;
  }

  private renderCohortComparison(view: ForecastWorkbenchView): string {
    const selectedLabel = view.hasActiveFilters ? 'Selected' : 'Selected (all)';
    return `
      <div style="overflow-x:auto;margin-bottom:10px;">
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <caption style="text-align:left;font-weight:600;margin-bottom:4px;">
            Holdout cohort comparison
          </caption>
          <thead>
            <tr style="opacity:0.65;text-align:right;">
              <th style="text-align:left;padding:3px;">Metric</th>
              <th style="padding:3px;">Overall</th>
              <th style="padding:3px;">${escapeHtml(selectedLabel)}</th>
            </tr>
          </thead>
          <tbody>
            ${this.renderComparisonRow(
              'Resolved labels',
              String(view.comparison.overall.scored),
              String(view.comparison.selected.scored),
            )}
            ${this.renderComparisonRow(
              'Brier ↓',
              this.formatWorkbenchMetric(view.comparison.overall.brier),
              this.formatWorkbenchMetric(view.comparison.selected.brier),
            )}
            ${this.renderComparisonRow(
              'ECE ↓',
              this.formatWorkbenchMetric(view.comparison.overall.ece),
              this.formatWorkbenchMetric(view.comparison.selected.ece),
            )}
          </tbody>
        </table>
      </div>`;
  }

  private renderComparisonRow(label: string, overall: string, selected: string): string {
    return `
      <tr style="border-top:1px solid var(--border-subtle,#2a2a2a);">
        <th scope="row" style="padding:4px 3px;text-align:left;font-weight:500;">${escapeHtml(label)}</th>
        <td style="padding:4px 3px;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(overall)}</td>
        <td style="padding:4px 3px;text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(selected)}</td>
      </tr>`;
  }

  private renderLossAttribution(view: ForecastWorkbenchView): string {
    const attribution = view.lossAttribution;
    if (attribution.sampleSize === 0) {
      return `
        <div data-brier-loss-attribution style="margin-bottom:10px;font-size:11px;opacity:0.7;">
          Brier loss attribution needs resolved direct or manual holdout labels.
        </div>`;
    }
    const dimensions = [
      ['Source', attribution.bySource],
      ['Domain', attribution.byDomain],
      ['Horizon', attribution.byHorizon],
      ['Version', attribution.byAlgorithmVersion],
    ] as const;
    const rows = dimensions.flatMap(([dimension, contributions]) =>
      contributions.slice(0, 3).map((contribution) => `
        <tr style="border-top:1px solid var(--border-subtle,#2a2a2a);">
          <td style="padding:4px 3px;">${escapeHtml(dimension)}</td>
          <th scope="row" style="padding:4px 3px;text-align:left;font-weight:500;">${escapeHtml(contribution.key)}</th>
          <td style="padding:4px 3px;text-align:right;font-variant-numeric:tabular-nums;">${(contribution.shareOfBrierLoss * 100).toFixed(1)}%</td>
          <td style="padding:4px 3px;text-align:right;font-variant-numeric:tabular-nums;">${contribution.meanBrier.toFixed(3)}</td>
          <td style="padding:4px 3px;text-align:right;font-variant-numeric:tabular-nums;">${contribution.highConfidenceMisses}</td>
        </tr>`),
    ).join('');
    return `
      <div data-brier-loss-attribution style="overflow-x:auto;margin-bottom:10px;">
        <table style="width:100%;border-collapse:collapse;font-size:11px;">
          <caption style="text-align:left;font-weight:600;margin-bottom:4px;">
            Brier loss attribution (${attribution.sampleSize} scored)
          </caption>
          <thead>
            <tr style="opacity:0.65;text-align:right;">
              <th style="padding:3px;text-align:left;">Dimension</th>
              <th style="padding:3px;text-align:left;">Slice</th>
              <th style="padding:3px;">Loss share</th>
              <th style="padding:3px;">Mean Brier</th>
              <th style="padding:3px;">High-confidence misses</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  private formatWorkbenchMetric(metric: ForecastWorkbenchMetric): string {
    return metric.status === 'ok'
      ? `${metric.value!.toFixed(3)} (n=${metric.sampleSize})`
      : `Need ${metric.minSampleSize} (n=${metric.sampleSize})`;
  }

  private renderReliabilityChart(reliability: ForecastReliabilityView): string {
    if (reliability.status === 'insufficient_evidence') {
      return `
        <div role="status" style="padding:8px;border:1px solid var(--border-subtle,#333);border-radius:5px;font-size:11px;margin-bottom:10px;">
          <strong>Reliability chart: insufficient evidence.</strong>
          ${reliability.sampleSize} resolved holdout label${
            reliability.sampleSize === 1 ? '' : 's'
          }; ${reliability.minSampleSize} required.
        </div>`;
    }
    const left = 28;
    const bottom = 148;
    const width = 264;
    const height = 120;
    const points = reliability.bins.map((bin) => {
      const x = left + bin.predictedMean * width;
      const y = bottom - bin.observedFrequency * height;
      const ciTop = bottom - bin.ciHigh * height;
      const ciBottom = bottom - bin.ciLow * height;
      return `
        <line x1="${x.toFixed(2)}" y1="${ciTop.toFixed(2)}" x2="${x.toFixed(2)}" y2="${ciBottom.toFixed(2)}"
          stroke="currentColor" opacity="0.45" />
        <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${Math.min(8, 3 + Math.sqrt(bin.count)).toFixed(2)}"
          fill="var(--accent-primary,#60a5fa)">
          <title>Predicted ${(bin.predictedMean * 100).toFixed(0)}%, observed ${(bin.observedFrequency * 100).toFixed(0)}%, n=${bin.count}</title>
        </circle>`;
    }).join('');
    return `
      <figure style="margin:0 0 10px;">
        <figcaption style="font-size:11px;font-weight:600;margin-bottom:3px;">
          Holdout reliability · ECE ${reliability.value.toFixed(3)}
        </figcaption>
        <svg viewBox="0 0 320 170" role="img"
          aria-label="Reliability chart comparing predicted probability with observed frequency"
          style="display:block;width:100%;max-height:170px;color:var(--text-secondary,#aaa);">
          <line x1="${left}" y1="${bottom}" x2="${left + width}" y2="${bottom - height}"
            stroke="currentColor" opacity="0.3" stroke-dasharray="4 4" />
          <line x1="${left}" y1="${bottom}" x2="${left + width}" y2="${bottom}"
            stroke="currentColor" opacity="0.45" />
          <line x1="${left}" y1="${bottom}" x2="${left}" y2="${bottom - height}"
            stroke="currentColor" opacity="0.45" />
          ${points}
          <text x="${left}" y="164" font-size="9" fill="currentColor">0%</text>
          <text x="${left + width - 18}" y="164" font-size="9" fill="currentColor">100%</text>
          <text x="2" y="${bottom}" font-size="9" fill="currentColor">0%</text>
          <text x="2" y="${bottom - height + 4}" font-size="9" fill="currentColor">100%</text>
          <text x="118" y="164" font-size="9" fill="currentColor">Predicted</text>
          <text x="9" y="104" font-size="9" fill="currentColor" transform="rotate(-90 9 104)">Observed</text>
        </svg>
      </figure>`;
  }

  private renderDrilldowns(view: ForecastWorkbenchView): string {
    return `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;">
        ${this.renderDrilldown(
          'Worst errors',
          view.worstErrors,
          'No resolved forecasts in this cohort.',
        )}
        ${this.renderDrilldown(
          'High-confidence misses',
          view.highConfidenceMisses,
          'No ≥80% confidence misses in this cohort.',
        )}
      </div>`;
  }

  private renderDrilldown(
    title: string,
    rows: readonly ForecastWorkbenchRow[],
    empty: string,
  ): string {
    const items = rows.length > 0
      ? rows.map((row) => `
          <li style="margin:3px 0;">
            <span title="${escapeHtml(row.claim)}">${escapeHtml(row.target)}</span>
            <span style="float:right;font-variant-numeric:tabular-nums;">${row.brierContribution!.toFixed(3)}</span>
          </li>`).join('')
      : `<li style="opacity:0.62;">${escapeHtml(empty)}</li>`;
    return `
      <details>
        <summary style="cursor:pointer;font-size:11px;font-weight:600;">${escapeHtml(title)} (${rows.length})</summary>
        <ol style="margin:5px 0 0;padding-left:18px;font-size:10px;">${items}</ol>
      </details>`;
  }

  private renderSortHeader(
    field: ForecastWorkbenchSortField,
    label: string,
    align: 'left' | 'right' = 'left',
  ): string {
    const active = this.workbenchState.sort.field === field;
    const direction = active ? this.workbenchState.sort.direction : 'desc';
    let arrow = '';
    let ariaSort = 'none';
    if (active) {
      arrow = direction === 'asc' ? ' ↑' : ' ↓';
      ariaSort = direction === 'asc' ? 'ascending' : 'descending';
    }
    return `
      <th aria-sort="${ariaSort}"
        style="padding:4px;text-align:${align};">
        <button type="button" data-workbench-sort="${field}"
          style="border:0;background:transparent;color:inherit;padding:0;cursor:pointer;font:inherit;font-weight:600;">
          ${escapeHtml(label + arrow)}
        </button>
      </th>`;
  }

  private renderForecastRow(row: ForecastWorkbenchRow): string {
    const probability = row.probability === null
      ? '—'
      : `${Math.round(row.probability * 100)}%`;
    let outcome = '—';
    if (row.outcome !== null) outcome = row.outcome === 1 ? 'Yes' : 'No';
    const brier = row.brierContribution === null ? '—' : row.brierContribution.toFixed(3);
    const evidenceAge = row.evidenceAgeMs === null
      ? '—'
      : formatDurationMs(row.evidenceAgeMs);
    const note = row.resolutionNote || 'No resolution note';
    const metricExclusion = row.excludedFromMetrics
      ? `<span title="${escapeHtml(this.metricExclusionLabel(row))}"
          aria-label="${escapeHtml(this.metricExclusionLabel(row))}"> †</span>`
      : '';
    const brierValue = row.brierContribution === null
      ? ''
      : row.brierContribution.toFixed(6);
    return `
      <tr data-forecast-id="${escapeHtml(row.id)}"
        data-resolution-method="${row.resolutionMethod}"
        data-metric-excluded="${row.excludedFromMetrics}"
        data-metric-exclusion-reason="${row.metricExclusionReason ?? ''}"
        data-brier="${brierValue}"
        style="border-top:1px solid var(--border-subtle,#2a2a2a);vertical-align:top;">
        <td style="padding:5px 4px;max-width:260px;">
          <div title="${escapeHtml(row.claim)}">${escapeHtml(row.target)}</div>
          <div style="font-size:9px;opacity:0.58;">
            ${escapeHtml(row.source)} · ${escapeHtml(row.domain)} ·
            ${escapeHtml(row.horizon)} · ${escapeHtml(row.version)}
          </div>
        </td>
        <td style="padding:5px 4px;text-align:right;font-variant-numeric:tabular-nums;">${probability}</td>
        <td style="padding:5px 4px;text-align:right;">${outcome}</td>
        <td style="padding:5px 4px;text-align:right;font-variant-numeric:tabular-nums;">${brier}${metricExclusion}</td>
        <td title="Time between newest resolution evidence and the recorded outcome"
          style="padding:5px 4px;text-align:right;white-space:nowrap;">${escapeHtml(evidenceAge)}</td>
        <td style="padding:5px 4px;max-width:230px;">
          <span style="font-size:9px;text-transform:uppercase;opacity:0.65;">${escapeHtml(row.resolutionMethod)}</span>
          <div title="${escapeHtml(note)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(note)}</div>
        </td>
      </tr>`;
  }

  private metricExclusionLabel(row: ForecastWorkbenchRow): string {
    switch (row.metricExclusionReason) {
      case 'training': {
        return 'Excluded from aggregate metrics: training cohort';
      }
      case 'proxy': {
        return 'Excluded from aggregate metrics: proxy label';
      }
      case 'unscored': {
        return 'Excluded from aggregate metrics: unresolved or invalid forecast';
      }
      case null: {
        return '';
      }
    }
  }

  private renderRowsStatus(view: ForecastWorkbenchView, visible: number): string {
    if (view.totalRecords === 0) {
      return '<p role="status" style="margin:8px 0 0;font-size:11px;opacity:0.65;">No forecasts logged yet.</p>';
    }
    if (view.totalMatching === 0) {
      return '<p role="status" style="margin:8px 0 0;font-size:11px;opacity:0.65;">No forecasts match these filters.</p>';
    }
    const capped = visible < view.totalMatching
      ? ` Showing the first ${visible}.`
      : '';
    return `
      <p style="margin:6px 0 0;font-size:10px;opacity:0.6;">
        ${view.totalMatching} of ${view.totalRecords} forecasts match.${escapeHtml(capped)}
        † excluded from aggregate metrics.
      </p>`;
  }

  private handleWorkbenchFilter(event: Event): void {
    const select = (event.target as Element | null)?.closest<HTMLSelectElement>(
      '[data-workbench-filter]',
    );
    const key = select?.dataset.workbenchFilter;
    if (!select || !key) return;
    switch (key) {
      case 'source': {
        this.workbenchState.filters.source = select.value;
        break;
      }
      case 'domain': {
        this.workbenchState.filters.domain = select.value;
        break;
      }
      case 'horizon': {
        this.workbenchState.filters.horizon = select.value;
        break;
      }
      case 'version': {
        this.workbenchState.filters.version = select.value;
        break;
      }
      case 'resolutionMethod': {
        this.workbenchState.filters.resolutionMethod = select.value;
        break;
      }
      default: {
        return;
      }
    }
    this.render();
  }

  private handleWorkbenchSort(event: MouseEvent): void {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
      '[data-workbench-sort]',
    );
    const field = button?.dataset.workbenchSort;
    if (!button || !isWorkbenchSortField(field)) return;
    if (this.workbenchState.sort.field === field) {
      this.workbenchState.sort.direction =
        this.workbenchState.sort.direction === 'asc' ? 'desc' : 'asc';
    } else {
      this.workbenchState.sort = {
        field,
        direction: field === 'target' ? 'asc' : 'desc',
      };
    }
    this.render();
  }

  private buildLexiconSection(): string {
    const rows = LABEL_BANDS.map((band) => {
      // Round-trip the example through the real labeler to prove the band.
      const derived = getProbabilityLabel(band.example);
      const match = derived === band.label;
      return `
        <tr>
          <td style="font-weight:600;">${escapeHtml(band.label)}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(band.range)}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums;">${Math.round(band.example * 100)}%</td>
          <td style="text-align:center;">${match ? '✓' : '✗'}</td>
        </tr>`;
    }).join('');

    return `
      <section style="margin-bottom:18px;">
        <h3 style="margin:0 0 6px;font-size:13px;">ICD 203 estimative-probability lexicon</h3>
        <p style="margin:0 0 8px;font-size:11px;opacity:0.7;">
          The Intelligence Community's "Words of Estimative Probability" — a fixed
          vocabulary so "likely" means the same thing to every reader.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="opacity:0.6;text-align:left;">
              <th>Label</th>
              <th style="text-align:right;">Band</th>
              <th style="text-align:right;">Example</th>
              <th style="text-align:center;">Maps</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }

  private buildMigratedSection(): string {
    const components: MigratedComponent[] = [
      {
        name: 'Truth score',
        source: 'intelligence/truth-score.ts → TruthScore.belief',
        belief: createBelief(0.82, { provenance: ['usgs', 'emsc'] }),
        note: 'Multi-source fact score, now with provenance + CI.',
      },
      {
        name: 'Driver severity',
        source: 'intelligence/driver-scores.ts → EvidenceScore.belief',
        belief: createBelief(0.64, { provenance: ['obs-4821'] }),
        note: 'Evidence-weighted severity, point + interval.',
      },
      {
        name: 'Location confidence',
        source: 'correlation-engine.ts → NormalizedLocation.confidenceBelief',
        belief: createBelief(0.95, { provenance: ['acled'] }),
        note: 'Geocode confidence carried as a belief.',
      },
    ];

    const rows = components
      .map(
        (c) => `
        <tr>
          <td style="font-weight:600;white-space:nowrap;">${escapeHtml(c.name)}</td>
          <td>${escapeHtml(formatBelief(c.belief))}</td>
          <td style="font-size:10px;opacity:0.6;">${escapeHtml(c.source)}</td>
        </tr>`,
      )
      .join('');

    return `
      <section style="margin-bottom:18px;">
        <h3 style="margin:0 0 6px;font-size:13px;">Migrated components</h3>
        <p style="margin:0 0 8px;font-size:11px;opacity:0.7;">
          Three production scores now carry a first-class BeliefValue alongside
          their legacy number — point estimate, 90% CI, and source provenance.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }

  private buildStalenessSection(): string {
    // A belief whose inputs expired a day ago: the point holds, the band blows out.
    const fresh = createBelief(0.7, { staleAt: '2026-06-09T00:00:00.000Z' });
    const stale = applyStalenessDegradation(fresh, '2026-06-10T12:00:00.000Z');
    const legacy = fromLegacySeverity(7, 'nws');

    return `
      <section>
        <h3 style="margin:0 0 6px;font-size:13px;">Staleness &amp; legacy adapters</h3>
        <p style="margin:0 0 8px;font-size:11px;opacity:0.7;">
          Stale inputs widen the interval toward [0,1] without moving the point —
          confidence decays, the estimate doesn't lie. A legacy 0–10 severity
          score adapts in via <code>fromLegacySeverity</code>.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <tbody>
            ${stalenessRow('Fresh', fresh)}
            ${stalenessRow('After staleAt (+36h)', stale)}
            ${stalenessRow('Legacy severity 7 → belief', legacy)}
          </tbody>
        </table>
      </section>`;
  }
}

function isWorkbenchSortField(
  value: string | undefined,
): value is ForecastWorkbenchSortField {
  return value === 'brier'
    || value === 'probability'
    || value === 'evidenceAge'
    || value === 'target';
}
