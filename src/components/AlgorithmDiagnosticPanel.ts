/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Algorithm Diagnostic Panel — Algorithm Self-Improvement PR 6 UI.
 *
 * Surfaces the Algorithm Health Aggregator + Safe Adjustment proposals
 * for each registered algorithm. Pure composition over the existing
 * pure-deterministic registries (PRs 2-4 of the plan).
 */

import { Panel } from './Panel';
import {
  getAlgorithmEvaluationLedger,
  getAlgorithmDefinitions,
} from '@/services/algorithms/algorithms-state';
import {
  aggregateAlgorithmHealth,
  type AlgorithmHealth,
  type AlgorithmHealthStatus,
} from '@/services/algorithms/algorithm-health';
import { summarizeCalibration } from '@/services/algorithms/algorithm-evaluation-ledger';
import { proposeAdjustments, type AdjustmentProposal } from '@/services/algorithms/safe-adjustment';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 15_000;

const STATUS_COLOR: Record<AlgorithmHealthStatus, string> = {
  healthy: '#4caf50',
  degraded: '#ffeb3b',
  failing: '#f44336',
  unsafe: '#d50000',
  unknown: '#9e9e9e',
};

export class AlgorithmDiagnosticPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'algorithm-diagnostic',
      title: 'Algorithm Diagnostic',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Hit-rate / latency / drift report for each algorithm. Surfaces safe-adjustment proposals — never auto-applied; always a recommendation.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
  }

  public dispose(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private render(): void {
    const ledger = getAlgorithmEvaluationLedger();
    const definitions = getAlgorithmDefinitions();
    const calibrations = summarizeCalibration(ledger.all());
    const report = aggregateAlgorithmHealth({ definitions, calibrations });
    const proposals = proposeAdjustments({ reports: [...report.algorithms], tunings: [] });
    const proposalsById = new Map<string, AdjustmentProposal>();
    for (const p of proposals) proposalsById.set(p.algorithmId, p);

    const concerning = report.algorithms.filter((a) => a.status !== 'healthy' && a.status !== 'unknown');
    this.setCount(concerning.length);

    const recHtml = report.recommendations.length === 0
      ? `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No adjustments needed.</div>`
      : `<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5;">${report.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`;

    const rows = [...report.algorithms]
      .sort((a, b) => severityRank(b.status) - severityRank(a.status) || a.algorithmId.localeCompare(b.algorithmId))
      .map((a) => this.renderRow(a, proposalsById.get(a.algorithmId)))
      .join('');

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      <div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Overall</div>
        <div style="font-size:14px;font-weight:700;color:${STATUS_COLOR[report.status]};">${escapeHtml(report.status.toUpperCase())} — ${escapeHtml(report.summary)}</div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Recommendations</div>
        ${recHtml}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">${rows}</div>
    </div>`;
    this.setContent(html);
  }

  private renderRow(a: AlgorithmHealth, proposal: AdjustmentProposal | undefined): string {
    const color = STATUS_COLOR[a.status];
    const cal = a.calibration;
    const calStr = cal
      ? `n=${cal.graded} · hit ${(cal.hitRate * 100).toFixed(0)}% · weighted ${(cal.weightedHitRate * 100).toFixed(0)}% · ${cal.meanDurationMs.toFixed(0)} ms`
      : 'no graded samples';
    const criticalBadge = renderCriticalityBadge(a.criticality);
    const proposalHtml = renderProposalHtml(proposal);
    return `<div style="border:1px solid var(--border-subtle,#333);border-radius:4px;padding:8px 10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-weight:600;">${escapeHtml(a.label)}</span>
          ${criticalBadge}
        </div>
        <span style="font-size:10px;color:${color};text-transform:uppercase;">${escapeHtml(a.status)}</span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;font-family:ui-monospace,monospace;">${escapeHtml(calStr)}</div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:3px;">${escapeHtml(a.reason)}</div>
      ${a.recommendedAdjustment ? `<div style="font-size:11px;color:#ff9800;margin-top:3px;">→ ${escapeHtml(a.recommendedAdjustment)}</div>` : ''}
      ${proposalHtml}
    </div>`;
  }
}

function renderProposalHtml(proposal: AdjustmentProposal | undefined): string {
  if (!proposal || proposal.verdict === 'noop' || proposal.verdict === 'no_tunable') return '';
  const effect = proposal.predictedEffect
    ? `<div style="margin-top:3px;">${escapeHtml(proposal.predictedEffect)}</div>`
    : '';
  return `<div style="font-size:11px;color:var(--accent,#4a9eff);margin-top:6px;padding:6px 8px;background:rgba(74,158,255,0.07);border-radius:3px;">
    <strong>${escapeHtml(proposal.verdict.toUpperCase())}:</strong> ${escapeHtml(proposal.rationale)}
    ${effect}
  </div>`;
}

function renderCriticalityBadge(criticality: string): string {
  if (criticality === 'safety') {
    return `<span style="font-size:9px;padding:1px 4px;background:#d50000;color:#fff;border-radius:2px;margin-left:6px;">SAFETY</span>`;
  }
  if (criticality === 'high') {
    return `<span style="font-size:9px;padding:1px 4px;background:#ff9800;color:#000;border-radius:2px;margin-left:6px;">HIGH</span>`;
  }
  return '';
}

function severityRank(s: AlgorithmHealthStatus): number {
  switch (s) {
    case 'healthy': {
      return 0;
    }
    case 'unknown': {
      return 1;
    }
    case 'degraded': {
      return 2;
    }
    case 'failing': {
      return 3;
    }
    case 'unsafe': {
      return 4;
    }
  }
}
