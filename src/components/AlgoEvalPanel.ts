/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Algorithm Evaluation Panel — Phase 4 Learn-stage accuracy surface.
 *
 * Read-only view of the AlgoEvalLedger. Shows per-(algorithm, domain)
 * accuracy stats, trend direction, and the oldest pending predictions
 * waiting on a resolution from the OutcomeLedger.
 */

import { Panel } from './Panel';
import {
  getAlgoEvalLedger,
  type AlgorithmPrediction,
  type AlgorithmStats,
  type TrendDirection,
} from '@/services/intelligence/algo-eval-ledger';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 15_000;
const PENDING_LIMIT = 10;

const TREND_LABEL: Record<TrendDirection, string> = {
  improving: '↑',
  stable: '→',
  degrading: '↓',
};

const TREND_COLOR: Record<TrendDirection, string> = {
  improving: '#4caf50',
  stable: '#9e9e9e',
  degrading: '#f44336',
};

export class AlgoEvalPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;

  constructor() {
    super({
      id: 'algo-eval',
      title: 'Algorithm Evaluation',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Phase 4 Learn stage. Records every algorithm prediction and resolves it against user outcomes from the OutcomeLedger. Surfaces MAE / accuracy and a last-30 vs prior-30 trend.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
    this.unsub = getAlgoEvalLedger().subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private render(): void {
    const ledger = getAlgoEvalLedger();
    const stats = ledger.getAllStats();
    const unresolved = ledger.getUnresolved();
    const sortedPending = [...unresolved];
    sortedPending.sort((a, b) => a.predictedAt.getTime() - b.predictedAt.getTime());
    const oldestPending = sortedPending.slice(0, PENDING_LIMIT);

    // Panel count: how many predictions are still waiting on a resolution.
    this.setCount(unresolved.length);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${renderOverall(stats, unresolved.length)}
      ${renderStatsTable(stats)}
      ${renderPendingList(oldestPending)}
    </div>`;
    this.setContent(html);
  }
}

function renderOverall(stats: readonly AlgorithmStats[], unresolvedCount: number): string {
  const total = stats.reduce((s, r) => s + r.totalPredictions, 0);
  const resolved = stats.reduce((s, r) => s + r.resolvedCount, 0);
  const resolvedPct = total === 0 ? 0 : (resolved / total) * 100;
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Overall</div>
    <div style="display:flex;flex-wrap:wrap;gap:14px;font-size:12px;">
      <div><strong>${total}</strong> predictions</div>
      <div><strong>${resolved}</strong> resolved (${resolvedPct.toFixed(0)}%)</div>
      <div><strong>${unresolvedCount}</strong> pending</div>
    </div>
  </div>`;
}

function formatMetric(s: AlgorithmStats): string {
  if (s.meanAbsoluteError !== undefined) return `MAE ${s.meanAbsoluteError.toFixed(3)}`;
  if (s.accuracy !== undefined) return `${(s.accuracy * 100).toFixed(0)}%`;
  return '—';
}

function renderStatsTable(stats: readonly AlgorithmStats[]): string {
  if (stats.length === 0) {
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Per-algorithm accuracy</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">No predictions recorded yet.</div>
    </div>`;
  }
  const rows = stats.map((s) => {
    const metric = formatMetric(s);
    const trendLabel = TREND_LABEL[s.trend];
    const trendColor = TREND_COLOR[s.trend];
    return `<tr>
      <td style="padding:4px 8px;">${escapeHtml(s.algorithmId)}</td>
      <td style="padding:4px 8px;color:var(--text-secondary,#aaa);">${escapeHtml(s.domain)}</td>
      <td style="padding:4px 8px;text-align:right;">${s.totalPredictions}</td>
      <td style="padding:4px 8px;text-align:right;">${s.resolvedCount}</td>
      <td style="padding:4px 8px;text-align:right;font-family:ui-monospace,monospace;">${escapeHtml(metric)}</td>
      <td style="padding:4px 8px;text-align:right;color:${trendColor};font-family:ui-monospace,monospace;">${trendLabel}</td>
    </tr>`;
  }).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Per-algorithm accuracy</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;font-family:ui-monospace,monospace;">
      <thead>
        <tr style="color:var(--text-secondary,#aaa);text-align:left;">
          <th style="padding:4px 8px;font-weight:600;">Algorithm</th>
          <th style="padding:4px 8px;font-weight:600;">Domain</th>
          <th style="padding:4px 8px;font-weight:600;text-align:right;">Total</th>
          <th style="padding:4px 8px;font-weight:600;text-align:right;">Resolved</th>
          <th style="padding:4px 8px;font-weight:600;text-align:right;">Metric</th>
          <th style="padding:4px 8px;font-weight:600;text-align:right;">Trend</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderPendingList(pending: readonly AlgorithmPrediction[]): string {
  if (pending.length === 0) {
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Pending resolution</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">No pending predictions.</div>
    </div>`;
  }
  const now = Date.now();
  const items = pending.map((p) => {
    const ageMs = now - p.predictedAt.getTime();
    return `<li style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,0.05));font-size:12px;">
      <span style="font-family:ui-monospace,monospace;color:var(--text-primary,#fff);">${escapeHtml(p.algorithmId)}</span>
      <span style="color:var(--text-secondary,#aaa);">${escapeHtml(p.domain)}</span>
      <span style="color:var(--text-secondary,#aaa);">predicted ${escapeHtml(String(p.predictedValue))}</span>
      <span style="color:var(--text-secondary,#aaa);margin-left:auto;">${formatAgo(ageMs)}</span>
    </li>`;
  }).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Pending resolution</div>
    <ul style="margin:0;padding:0;list-style:none;">${items}</ul>
  </div>`;
}

function formatAgo(ms: number): string {
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
