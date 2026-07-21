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
import { buildCalibrationReport, buildDomainReportCard } from './calibration-report-view';
import type { CalibrationReportView, DomainReportCard } from './calibration-report-view';
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
  constructor() {
    super({
      id: 'belief-calibration',
      title: 'Belief Calibration',
      showCount: false,
      trackActivity: true,
      infoTooltip:
        'The AI-2 BeliefValue probability type: the ICD 203 estimative-probability lexicon, the production scores now carrying a confidence interval, and a staleness demo.',
    });
    this.render();
  }

  private render(): void {
    this.setContent(
      [
        this.buildLexiconSection(),
        this.buildCalibrationReportSection(),
        this.buildMigratedSection(),
        this.buildStalenessSection(),
      ].join(''),
    );
  }

  private buildCalibrationReportSection(): string {
    let view: CalibrationReportView;
    let domainCard: DomainReportCard = { rows: [] };
    try {
      const records = getCalibrationStore().all();
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
      view = { headline: 'Calibration report unavailable', rows: [], hasOperatorData: false };
    }

    const rows = view.rows
      .map(
        (r) => `
        <tr>
          <td style="text-align:right;font-variant-numeric:tabular-nums;">${Math.round(r.predicted * 100)}%</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums;">${Math.round(r.observed * 100)}%</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums;">${escapeHtml(String(r.count))}</td>
        </tr>`,
      )
      .join('');

    const rowsTable = view.rows.length > 0
      ? `
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="opacity:0.6;text-align:left;">
              <th style="text-align:right;">Predicted</th>
              <th style="text-align:right;">Observed</th>
              <th style="text-align:right;">Count</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`
      : `<p style="margin:0;font-size:11px;opacity:0.6;">No resolved forecasts yet.</p>`;

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
      <section style="margin-bottom:18px;">
        <h3 style="margin:0 0 6px;font-size:13px;">Per-domain report card</h3>
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
      </section>`
      : '';

    return `
      <section style="margin-bottom:18px;">
        <h3 style="margin:0 0 6px;font-size:13px;">${escapeHtml(view.headline)}</h3>
        <p style="margin:0 0 8px;font-size:11px;opacity:0.7;">
          Live per-domain reliability curve: for forecasts predicted at each band,
          how often did they actually happen?
        </p>
        ${rowsTable}
        ${operatorRow}
      </section>
      ${domainReportCard}`;
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
