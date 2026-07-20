/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Outcome Ledger Panel — Phase 3 Learn-stage diagnostic UI.
 *
 * Read-only surface over the OutcomeLedger + AttentionAllocator.
 * Shows the user how their dismiss/escalate/confirm history has shaped
 * per-domain attention multipliers, and previews recommended weight
 * changes that downstream scorers can opt to honour.
 */

import { Panel } from './Panel';
import {
  getOutcomeLedger,
  type DomainCalibration,
  type OutcomeAction,
  type OutcomeRecord,
} from '@/services/intelligence/outcome-ledger';
import { getAttentionAllocator } from '@/services/intelligence/attention-allocator';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 15_000;
const RECENT_TIMELINE_LIMIT = 20;

const ACTION_LABELS: Record<OutcomeAction, string> = {
  dismissed: 'Dismissed',
  'acted-on': 'Acted on',
  escalated: 'Escalated',
  'de-escalated': 'De-escalated',
  'confirmed-real': 'Confirmed real',
  'marked-false-positive': 'False positive',
};

const ACTION_COLORS: Record<OutcomeAction, string> = {
  dismissed: '#9e9e9e',
  'acted-on': '#4caf50',
  escalated: '#ff9800',
  'de-escalated': '#4a9eff',
  'confirmed-real': '#4caf50',
  'marked-false-positive': '#ff453a',
};

export class OutcomeLedgerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubLedger: (() => void) | null = null;

  constructor() {
    super({
      id: 'outcome-ledger',
      title: 'Outcome Ledger',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Phase 3 Learn stage. Records dismiss / acted-on / escalated / confirmed-real / false-positive feedback per domain and recommends attention multipliers. Recommendations are never auto-applied.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubLedger = getOutcomeLedger().subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsubLedger) {
      this.unsubLedger();
      this.unsubLedger = null;
    }
  }

  private render(): void {
    const ledger = getOutcomeLedger();
    const allocator = getAttentionAllocator();
    allocator.recompute();
    const allocation = allocator.getAllocation();
    const calibrations = ledger.getAllCalibrations();
    const stats = ledger.stats();
    // Newest first. tsc target lib is es2020 → no Array#toReversed.
    // eslint-disable-next-line unicorn/no-array-reverse
    const recent = ledger.list().slice(-RECENT_TIMELINE_LIMIT).reverse();

    this.setCount(stats.total);

    const escalationLeader = topEscalator(calibrations);
    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${renderOverall(stats, escalationLeader)}
      ${renderCalibrationTable(calibrations, allocation)}
      ${renderAllocationBars(allocation)}
      ${renderRecentTimeline(recent)}
    </div>`;
    this.setContent(html);
  }
}

function topEscalator(calibrations: readonly DomainCalibration[]): DomainCalibration | undefined {
  const eligible = calibrations.filter((c) => c.escalationRate > 0);
  if (eligible.length === 0) return undefined;
  const ranked = [...eligible];
  ranked.sort((a, b) => b.escalationRate - a.escalationRate);
  return ranked[0];
}

function renderOverall(
  stats: ReturnType<ReturnType<typeof getOutcomeLedger>['stats']>,
  escalationLeader: DomainCalibration | undefined,
): string {
  const fpPct = (stats.overallFalsePositiveRate * 100).toFixed(0);
  const leaderText = escalationLeader
    ? `${escapeHtml(escalationLeader.domain)} (${(escalationLeader.escalationRate * 100).toFixed(0)}%)`
    : '<span style="color:var(--text-secondary,#aaa);">no escalations yet</span>';
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Overall</div>
    <div style="display:flex;flex-wrap:wrap;gap:14px;font-size:12px;">
      <div><strong>${stats.total}</strong> outcomes</div>
      <div>false-positive rate <strong>${fpPct}%</strong></div>
      <div>top escalated: <strong>${leaderText}</strong></div>
    </div>
  </div>`;
}

function renderCalibrationTable(
  calibrations: readonly DomainCalibration[],
  allocation: Readonly<Record<string, number>>,
): string {
  if (calibrations.length === 0) {
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Per-domain calibration</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">No outcomes recorded yet.</div>
    </div>`;
  }
  const rows = calibrations.map((c) => {
    const mult = allocation[c.domain] ?? 1;
    const arrow = recommendationArrow(c.suggestedWeightDelta);
    const arrowColor = recommendationColor(c.suggestedWeightDelta);
    return `<tr>
      <td style="padding:4px 8px;">${escapeHtml(c.domain)}</td>
      <td style="padding:4px 8px;text-align:right;">${c.totalOutcomes}</td>
      <td style="padding:4px 8px;text-align:right;">${(c.falsePositiveRate * 100).toFixed(0)}%</td>
      <td style="padding:4px 8px;text-align:right;">${(c.escalationRate * 100).toFixed(0)}%</td>
      <td style="padding:4px 8px;text-align:right;">${(c.severityAccuracy * 100).toFixed(0)}%</td>
      <td style="padding:4px 8px;text-align:right;">${mult.toFixed(2)}×</td>
      <td style="padding:4px 8px;text-align:right;color:${arrowColor};font-family:ui-monospace,monospace;">${arrow}</td>
    </tr>`;
  }).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Per-domain calibration</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;font-family:ui-monospace,monospace;">
      <thead>
        <tr style="color:var(--text-secondary,#aaa);text-align:left;">
          <th style="padding:4px 8px;font-weight:600;">Domain</th>
          <th style="padding:4px 8px;font-weight:600;text-align:right;">n</th>
          <th style="padding:4px 8px;font-weight:600;text-align:right;">FP</th>
          <th style="padding:4px 8px;font-weight:600;text-align:right;">Esc</th>
          <th style="padding:4px 8px;font-weight:600;text-align:right;">Acc</th>
          <th style="padding:4px 8px;font-weight:600;text-align:right;">Mult</th>
          <th style="padding:4px 8px;font-weight:600;text-align:right;">Rec</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function recommendationArrow(delta: number): string {
  if (delta > 0.05) return '↑';
  if (delta < -0.05) return '↓';
  return '→';
}

function recommendationColor(delta: number): string {
  if (delta > 0) return '#4caf50';
  if (delta < 0) return '#ff453a';
  return '#9e9e9e';
}

function allocationBarColor(mult: number): string {
  if (mult > 1) return '#4caf50';
  if (mult < 1) return '#ff453a';
  return '#9e9e9e';
}

function renderAllocationBars(allocation: Readonly<Record<string, number>>): string {
  const entries = Object.entries(allocation);
  if (entries.length === 0) {
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Attention allocation</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">Neutral — no domain has enough outcomes yet.</div>
    </div>`;
  }
  const sortedEntries: [string, number][] = [...entries];
  sortedEntries.sort((a, b) => b[1] - a[1]);
  const bars = sortedEntries
    .map(([domain, mult]) => {
      // 2.0× = full bar, 0.0× = empty; the 1.0× neutral line is the
      // reference users compare against.
      const fillPct = Math.min(100, Math.max(0, (mult / 2) * 100));
      const color = allocationBarColor(mult);
      return `<div style="display:flex;align-items:center;gap:8px;">
        <div style="width:90px;font-size:11px;font-family:ui-monospace,monospace;">${escapeHtml(domain)}</div>
        <div style="flex:1;height:8px;background:var(--surface-2,#1a1a1a);border-radius:2px;position:relative;overflow:hidden;">
          <div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.2);"></div>
          <div style="height:100%;width:${fillPct.toFixed(1)}%;background:${color};"></div>
        </div>
        <div style="width:48px;text-align:right;font-size:11px;font-family:ui-monospace,monospace;">${mult.toFixed(2)}×</div>
      </div>`;
    })
    .join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Attention allocation</div>
    <div style="display:flex;flex-direction:column;gap:4px;">${bars}</div>
  </div>`;
}

function renderRecentTimeline(records: readonly OutcomeRecord[]): string {
  if (records.length === 0) {
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Recent outcomes</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">No outcomes recorded yet.</div>
    </div>`;
  }
  const now = Date.now();
  const items = records
    .map((r) => {
      const color = ACTION_COLORS[r.actualOutcome];
      const label = ACTION_LABELS[r.actualOutcome];
      const ageMs = now - r.recordedAt.getTime();
      return `<li style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,0.05));font-size:12px;">
        <span style="display:inline-block;padding:2px 6px;border-radius:3px;background:${color}26;color:${color};font-size:10px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(label)}</span>
        <span style="font-family:ui-monospace,monospace;color:var(--text-primary,#fff);">${escapeHtml(r.domain)}</span>
        <span style="color:var(--text-secondary,#aaa);">${escapeHtml(r.predictedSeverity)}</span>
        <span style="color:var(--text-secondary,#aaa);margin-left:auto;">${formatAgo(ageMs)}</span>
      </li>`;
    })
    .join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;margin-bottom:6px;">Recent outcomes</div>
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
