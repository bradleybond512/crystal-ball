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
import { formatDurationMs } from '@/utils/format-duration';

const REFRESH_MS = 15_000;
/** Max groups shown in the pending list. */
const PENDING_GROUP_LIMIT = 30;
/** Max individual predictions revealed inside one expanded group. */
const PENDING_ITEMS_PER_GROUP = 50;

const TREND_LABEL: Record<TrendDirection, string> = {
  improving: '↑',
  stable: '→',
  degrading: '↓',
};

const TREND_COLOR: Record<TrendDirection, string> = {
  improving: 'var(--status-ok, #4caf50)',
  stable: 'var(--text-tertiary, #9e9e9e)',
  degrading: 'var(--status-error, #f44336)',
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

    // Panel count: how many predictions are still waiting on a resolution.
    this.setCount(unresolved.length);

    // Preserve which pending groups the user has expanded across re-renders.
    const openKeys = new Set<string>();
    for (const el of this.content.querySelectorAll<HTMLElement>('details.algo-pending-group[open]')) {
      if (el.dataset.groupKey) openKeys.add(el.dataset.groupKey);
    }

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${renderOverall(stats, unresolved.length)}
      ${renderStatsTable(stats)}
      ${renderPendingList(groupPending(unresolved, Date.now()), openKeys)}
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

/** One (algorithm, domain, predicted band) bucket of pending predictions. */
interface PendingGroup {
  key: string;
  algorithmId: string;
  domain: string;
  predictedValue: string;
  count: number;
  oldestAgeMs: number;
  /** Members sorted oldest-first. */
  items: AlgorithmPrediction[];
}

function groupPending(pending: readonly AlgorithmPrediction[], now: number): PendingGroup[] {
  const groups = new Map<string, PendingGroup>();
  for (const p of pending) {
    const predictedValue = String(p.predictedValue);
    const key = `${p.algorithmId}|${p.domain}|${predictedValue}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, algorithmId: p.algorithmId, domain: p.domain, predictedValue, count: 0, oldestAgeMs: 0, items: [] };
      groups.set(key, group);
    }
    group.count += 1;
    group.items.push(p);
    group.oldestAgeMs = Math.max(group.oldestAgeMs, now - p.predictedAt.getTime());
  }
  const list = [...groups.values()];
  for (const group of list) {
    group.items.sort((a, b) => a.predictedAt.getTime() - b.predictedAt.getTime());
  }
  // Oldest-waiting groups first — those are the ones blocking the Learn loop.
  list.sort((a, b) => b.oldestAgeMs - a.oldestAgeMs);
  return list;
}

function renderPendingList(groups: readonly PendingGroup[], openKeys: ReadonlySet<string>): string {
  if (groups.length === 0) {
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Pending resolution</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">No pending predictions.</div>
    </div>`;
  }
  const now = Date.now();
  const shown = groups.slice(0, PENDING_GROUP_LIMIT);
  const rows = shown.map((g) => renderPendingGroup(g, now, openKeys.has(g.key))).join('');
  const moreGroups = groups.length > shown.length
    ? `<div style="font-size:11px;color:var(--text-secondary,#aaa);padding:4px 0;">…and ${groups.length - shown.length} more groups</div>`
    : '';
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Pending resolution</div>
    <div style="display:flex;flex-direction:column;">${rows}${moreGroups}</div>
  </div>`;
}

function renderPendingGroup(group: PendingGroup, now: number, open: boolean): string {
  const countBadge = group.count > 1
    ? `<span style="color:var(--text-secondary,#aaa);">×${group.count}</span>`
    : '';
  const summary = `<summary style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;cursor:pointer;">
      <span style="font-family:ui-monospace,monospace;color:var(--text-primary,#fff);">${escapeHtml(group.algorithmId)}</span>
      <span style="color:var(--text-secondary,#aaa);">${escapeHtml(group.domain)}</span>
      <span style="color:var(--text-secondary,#aaa);">predicted ${escapeHtml(group.predictedValue)}</span>
      ${countBadge}
      <span style="color:var(--text-secondary,#aaa);margin-left:auto;">oldest ${formatDurationMs(group.oldestAgeMs)}</span>
    </summary>`;
  const shownItems = group.items.slice(0, PENDING_ITEMS_PER_GROUP);
  const items = shownItems.map((p) => {
    const ageMs = now - p.predictedAt.getTime();
    return `<li style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:11px;color:var(--text-secondary,#aaa);">
      <span>predicted ${escapeHtml(String(p.predictedValue))}</span>
      <span style="margin-left:auto;">${formatDurationMs(ageMs)} ago</span>
    </li>`;
  }).join('');
  const moreItems = group.count > shownItems.length
    ? `<li style="padding:3px 0;font-size:11px;color:var(--text-secondary,#aaa);">…and ${group.count - shownItems.length} more</li>`
    : '';
  return `<details class="algo-pending-group" data-group-key="${escapeHtml(group.key)}"${open ? ' open' : ''} style="border-bottom:1px solid var(--border-subtle,rgba(255,255,255,0.05));">
    ${summary}
    <ul style="margin:0 0 6px;padding:0 0 0 18px;list-style:none;">${items}${moreItems}</ul>
  </details>`;
}
