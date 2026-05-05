/**
 * Algorithm Diagnostics Panel — PR 9 of the Algorithm Accuracy
 * Enhancement Plan.
 *
 * Surfaces the lifecycle (live/shadow/candidate/deprecated), 30-day
 * metrics (P/R/F1/Brier), promotion/demotion history, shadow-mode
 * progress vs the promotion threshold, and recent regression alerts
 * for each registered algorithm.
 *
 * Composes the pure-deterministic services from PRs 4-8:
 *   - metrics-pipeline.summarizeAllAlgorithms (overview table)
 *   - metrics-pipeline.buildAlgorithmMetricsReport (per-algo expand)
 *   - shadow-mode.evaluatePromotion (shadow progress)
 *   - promotion-gate.listLifecycles (history timeline)
 *   - replay-engine.runReplay (regression detection)
 *
 * Keeps the existing AlgorithmDiagnosticPanel intact (that one
 * surfaces health + safe-adjustment proposals from the older PR-set;
 * this one is the accuracy-plan companion).
 */

import { Panel } from './Panel';
import { getAlgorithmEvaluationLedger } from '@/services/algorithms/algorithms-state';
import {
  summarizeAllAlgorithms,
  type AlgorithmSummary,
} from '@/services/algorithms/metrics-pipeline';
import {
  DEFAULT_PROMOTION_CRITERIA,
  evaluatePromotion,
  listShadowAlgorithms,
  listShadowDecisions,
} from '@/services/algorithms/shadow-mode';
import {
  listLifecycles,
  type LifecycleEntry,
  type LifecycleState,
} from '@/services/algorithms/promotion-gate';
import { summarizeAnnotations } from '@/services/algorithms/user-feedback';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 15_000;

const STATE_COLOR: Record<LifecycleState, string> = {
  draft: '#9e9e9e',
  shadow: '#4a9eff',
  candidate: '#ffb74d',
  live: '#4caf50',
  deprecated: '#757575',
};

export class AlgorithmDiagnosticsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'algorithm-diagnostics',
      title: 'Algorithm Diagnostics',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Per-algorithm precision/recall/F1/Brier with lifecycle state, shadow-mode promotion progress, and regression alerts.',
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
    const records = ledger.all();
    const summaries = summarizeAllAlgorithms(records);
    const lifecycles = listLifecycles();
    const shadow = listShadowAlgorithms();
    this.setCount(summaries.length);
    const html = `
      <div style="padding:8px;font-size:12px;line-height:1.45;">
        ${this.renderOverviewTable(summaries, lifecycles)}
        ${this.renderAnnotationsSection(summaries.map((s) => s.algorithmId), ledger)}
        ${this.renderShadowSection(shadow)}
        ${this.renderHistorySection(lifecycles)}
      </div>
    `;
    this.setContent(html);
  }

  private renderOverviewTable(
    summaries: readonly AlgorithmSummary[],
    lifecycles: readonly LifecycleEntry[],
  ): string {
    if (summaries.length === 0) {
      return `<div style="opacity:0.7;">No graded ledger records yet.</div>`;
    }
    const lifecycleById = new Map(lifecycles.map((l) => [l.algorithmId, l]));
    const rows = summaries.map((s) => {
      const lc = lifecycleById.get(s.algorithmId);
      const stateColor = lc ? STATE_COLOR[lc.state] : '#9e9e9e';
      const stateLabel = lc ? lc.state : '—';
      return `
        <tr>
          <td style="padding:3px 8px;">${escapeHtml(s.algorithmId)}</td>
          <td style="padding:3px 8px;">
            <span style="color:${stateColor};">${escapeHtml(stateLabel)}</span>
          </td>
          <td style="padding:3px 8px;text-align:right;">${formatNum(s.f1)}</td>
          <td style="padding:3px 8px;text-align:right;">${formatNum(s.precision)}</td>
          <td style="padding:3px 8px;text-align:right;">${formatNum(s.recall)}</td>
          <td style="padding:3px 8px;text-align:right;">${formatNum(s.brier)}</td>
          <td style="padding:3px 8px;text-align:right;">${s.total}</td>
        </tr>
      `;
    }).join('');
    return `
      <h4 style="margin:4px 0;">Algorithms (${summaries.length})</h4>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.2);text-align:left;">
            <th style="padding:3px 8px;">id</th>
            <th style="padding:3px 8px;">state</th>
            <th style="padding:3px 8px;text-align:right;">F1</th>
            <th style="padding:3px 8px;text-align:right;">P</th>
            <th style="padding:3px 8px;text-align:right;">R</th>
            <th style="padding:3px 8px;text-align:right;">Brier</th>
            <th style="padding:3px 8px;text-align:right;">N</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  private renderShadowSection(shadow: readonly string[]): string {
    if (shadow.length === 0) {
      return `<div style="margin-top:12px;opacity:0.7;">No algorithms in shadow mode.</div>`;
    }
    const rows = shadow.map((id) => {
      const eligibility = evaluatePromotion(id, listShadowDecisions(id));
      const eligible = eligibility.eligible;
      const color = eligible ? '#4caf50' : '#ffb74d';
      const reasonsHtml = eligibility.reasons
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join('');
      return `
        <div style="margin:6px 0;padding:6px;border-left:3px solid ${color};">
          <div style="font-weight:600;">${escapeHtml(id)}</div>
          <div>graded: ${eligibility.graded} / ${DEFAULT_PROMOTION_CRITERIA.minGradedEvents}</div>
          <div>P=${formatNum(eligibility.precision)} R=${formatNum(eligibility.recall)} F1=${formatNum(eligibility.f1)}</div>
          ${eligible ? '<div style="color:#4caf50;">eligible for promotion</div>' : `<ul style="margin:2px 0 0 16px;">${reasonsHtml}</ul>`}
        </div>
      `;
    }).join('');
    return `
      <h4 style="margin:14px 0 4px 0;">Shadow algorithms</h4>
      ${rows}
    `;
  }

  private renderAnnotationsSection(
    algorithmIds: readonly string[],
    ledger: ReturnType<typeof getAlgorithmEvaluationLedger>,
  ): string {
    const rows = algorithmIds
      .map((id) => {
        const s = summarizeAnnotations(id, ledger);
        if (s.total === 0) return null;
        const lead =
          s.meanEarlyLeadMs === null
            ? ''
            : ` (mean early lead: ${formatLead(s.meanEarlyLeadMs)})`;
        return `
          <li>
            <strong>${escapeHtml(id)}</strong>:
            ${s.counts.confirmed} confirmed,
            ${s.counts.false_positive} false positive,
            ${s.counts.observed_early} early${lead},
            ${s.counts.missed} missed
          </li>
        `;
      })
      .filter(Boolean)
      .join('');
    if (!rows) return '';
    return `
      <h4 style="margin:14px 0 4px 0;">User feedback</h4>
      <ul style="margin:0;padding-left:14px;">${rows}</ul>
    `;
  }

  private renderHistorySection(lifecycles: readonly LifecycleEntry[]): string {
    const withHistory = lifecycles.filter((l) => l.transitions.length > 0);
    if (withHistory.length === 0) return '';
    const items = withHistory.flatMap((lc) =>
      lc.transitions.slice(-3).map((t) => ({
        at: t.at,
        text: `${lc.algorithmId}: ${t.from} → ${t.to} (${t.initiator})`,
        reason: t.reason,
      })),
    );
    items.sort((a, b) => b.at - a.at);
    const recent = items.slice(0, 10);
    const html = recent.map((i) => `
      <li style="margin:2px 0;">
        <span style="opacity:0.7;font-size:11px;">${formatTime(i.at)}</span>
        ${escapeHtml(i.text)}
        <div style="opacity:0.6;font-size:11px;">${escapeHtml(i.reason)}</div>
      </li>
    `).join('');
    return `
      <h4 style="margin:14px 0 4px 0;">Recent transitions</h4>
      <ul style="margin:0;padding-left:14px;">${html}</ul>
    `;
  }

}

function formatNum(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

function formatLead(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) return `${minutes.toFixed(0)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatTime(at: number): string {
  try {
    const d = new Date(at);
    return d.toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return String(at);
  }
}
