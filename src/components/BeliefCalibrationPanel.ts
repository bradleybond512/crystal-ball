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
        this.buildMigratedSection(),
        this.buildStalenessSection(),
      ].join(''),
    );
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

    const row = (caption: string, b: BeliefValue): string => `
      <tr>
        <td style="font-weight:600;white-space:nowrap;">${escapeHtml(caption)}</td>
        <td>${escapeHtml(formatBelief(b))}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;">
          width ${(intervalWidth(b) * 100).toFixed(0)}%
        </td>
      </tr>`;

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
            ${row('Fresh', fresh)}
            ${row('After staleAt (+36h)', stale)}
            ${row('Legacy severity 7 → belief', legacy)}
          </tbody>
        </table>
      </section>`;
  }
}
