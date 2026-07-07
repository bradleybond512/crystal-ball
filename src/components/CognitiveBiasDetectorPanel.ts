/**
 * Cognitive Bias Detector Panel — operator view onto the bias
 * detection ledger. Shows the BiasReport summary (counts by type as
 * bar chart, unacknowledged badge) plus a scrollable list of recent
 * detections with an Acknowledge button per row.
 *
 * Vanilla TS panel, no React. Subscribes to the service so new
 * detections refresh the view without polling.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getCognitiveBiasDetectorService,
  type BiasDetection,
  type BiasReport,
  type BiasSeverity,
  type BiasType,
} from '@/services/intelligence/cognitive-bias-detector';
import { statLine } from './ui/statLine';
import { dejargonProse, entityRefHtml, installEntityIdCopyHandler } from './ui/entityRef';

const REFRESH_MS = 10_000;
const RECENT_LIMIT = 50;

const BIAS_LABEL: Record<BiasType, string> = {
  anchoring: 'Anchoring',
  availability: 'Availability',
  confirmation: 'Confirmation',
  recency: 'Recency',
  overconfidence: 'Overconfidence',
  groupthink: 'Groupthink',
};

const SEVERITY_COLOR: Record<BiasSeverity, string> = {
  low: 'var(--severity-info,#22c55e)',
  medium: 'var(--severity-medium,#facc15)',
  high: 'var(--severity-high,#f87171)',
};

const BIAS_BAR_COLOR: Record<BiasType, string> = {
  anchoring: '#4a9eff',
  availability: '#a78bfa',
  confirmation: '#facc15',
  recency: '#fb923c',
  overconfidence: '#f87171',
  groupthink: '#94a3b8',
};

const ALL_BIAS_TYPES: readonly BiasType[] = [
  'anchoring', 'availability', 'confirmation', 'recency', 'overconfidence', 'groupthink',
];

/** Count badges cap at "99+" so a runaway ledger can't blow out the layout. */
function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

export class CognitiveBiasDetectorPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private filterBiasType: BiasType | 'all' = 'all';
  /** True while an Ack-all batch runs, so per-ack notifications don't re-render 1000×. */
  private bulkAcking = false;

  constructor() {
    super({
      id: 'cognitive-bias-detector',
      title: 'Cognitive Bias Detector',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Flags intelligence outputs that look skewed by known cognitive biases — anchoring, availability, confirmation, recency, overconfidence, groupthink. Advisory only; never blocks the underlying claim.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
    this.unsubscribe = getCognitiveBiasDetectorService().subscribe(() => {
      if (!this.bulkAcking) this.render();
    });
    this.attachHandlers();
    installEntityIdCopyHandler();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }

  /** Panel-header badge caps at "99+" like every other count in this panel. */
  public override setCount(count: number): void {
    if (this.countEl) {
      this.countEl.textContent = formatBadgeCount(count);
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────

  private render(): void {
    try {
      const svc = getCognitiveBiasDetectorService();
      const report = svc.getReport();
      this.setCount(report.unacknowledgedCount);
      const filter = this.filterBiasType === 'all' ? {} : { biasType: this.filterBiasType };
      const recent = svc.getDetections(filter, RECENT_LIMIT);
      this.setContent(this.buildHtml(report, recent));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Bias detector render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(report: BiasReport, recent: readonly BiasDetection[]): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;font-size:12px;">
      ${this.renderSummary(report)}
      ${this.renderBarChart(report)}
      ${this.renderFilterBar(report)}
      ${this.renderDetectionList(recent)}
    </div>`;
  }

  private renderSummary(report: BiasReport): string {
    const topLabel = report.topBiasType ? BIAS_LABEL[report.topBiasType] : '—';
    const stats = statLine([
      { value: report.totalDetections, label: 'total' },
      { value: formatBadgeCount(report.unacknowledgedCount), label: 'unack', valueColor: 'var(--severity-high,#f87171)', title: `${report.unacknowledgedCount} unacknowledged` },
      { value: topLabel, label: 'top:', labelFirst: true },
    ]);
    return `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:baseline;font-size:11px;color:var(--text-secondary,#aaa);">
      <span>${stats}</span>
      <span style="margin-left:auto;display:flex;gap:8px;">
        <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${SEVERITY_COLOR.high};margin-right:4px;"></span>${formatBadgeCount(report.bySeverity.high)}</span>
        <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${SEVERITY_COLOR.medium};margin-right:4px;"></span>${formatBadgeCount(report.bySeverity.medium)}</span>
        <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${SEVERITY_COLOR.low};margin-right:4px;"></span>${formatBadgeCount(report.bySeverity.low)}</span>
      </span>
    </div>`;
  }

  private renderBarChart(report: BiasReport): string {
    const maxCount = Math.max(1, ...ALL_BIAS_TYPES.map((t) => report.byType[t]));
    const rows = ALL_BIAS_TYPES.map((t) => {
      const count = report.byType[t];
      const pct = (count / maxCount) * 100;
      const color = BIAS_BAR_COLOR[t];
      return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;">
        <span style="width:96px;color:var(--text-secondary,#aaa);">${escapeHtml(BIAS_LABEL[t])}</span>
        <div style="flex:1;height:10px;background:rgba(255,255,255,0.04);border-radius:2px;overflow:hidden;">
          <div style="width:${pct.toFixed(1)}%;height:100%;background:${color};"></div>
        </div>
        <span style="width:30px;text-align:right;color:var(--text-primary,#fff);font-weight:600;" title="${count}">${formatBadgeCount(count)}</span>
      </div>`;
    }).join('');
    return `<div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;">${rows}</div>`;
  }

  private renderFilterBar(report: BiasReport): string {
    const chips = [
      { value: 'all' as const, label: `All (${formatBadgeCount(report.totalDetections)})` },
      ...ALL_BIAS_TYPES.map((t) => ({ value: t, label: `${BIAS_LABEL[t]} (${formatBadgeCount(report.byType[t])})` })),
    ];
    return `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;border-top:1px solid var(--border-subtle,#333);padding-top:10px;">
      ${chips.map((c) => this.renderFilterChip(c.value, c.label)).join('')}
      ${this.renderAckAllButton()}
    </div>`;
  }

  private renderAckAllButton(): string {
    const svc = getCognitiveBiasDetectorService();
    const filter = this.filterBiasType === 'all'
      ? { acknowledged: false as const }
      : { biasType: this.filterBiasType, acknowledged: false as const };
    const pendingCount = svc.getDetections(filter).length;
    if (pendingCount === 0) return '';
    const scope = this.filterBiasType === 'all' ? 'all' : BIAS_LABEL[this.filterBiasType];
    return `<button class="bias-ack-all" title="Acknowledge every unacknowledged ${escapeHtml(scope)} detection" style="margin-left:auto;padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:var(--sev-low-bg,rgba(34,197,94,0.10));color:var(--sev-low,#22c55e);border-radius:3px;cursor:pointer;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Ack all (${formatBadgeCount(pendingCount)})</button>`;
  }

  private renderFilterChip(value: BiasType | 'all', label: string): string {
    const active = this.filterBiasType === value;
    const bg = active ? 'var(--mac-accent,#4a9eff)' : 'rgba(255,255,255,0.04)';
    const fg = active ? '#fff' : 'var(--text-secondary,#aaa)';
    return `<button class="bias-filter" data-value="${escapeHtml(value)}" style="padding:3px 8px;font-size:11px;border:1px solid var(--border-subtle,#333);background:${bg};color:${fg};border-radius:3px;cursor:pointer;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">${escapeHtml(label)}</button>`;
  }

  private renderDetectionList(detections: readonly BiasDetection[]): string {
    if (detections.length === 0) {
      const filterSuffix = this.filterBiasType === 'all'
        ? ''
        : ` for "${escapeHtml(BIAS_LABEL[this.filterBiasType])}"`;
      return `<div style="padding:14px;text-align:center;font-size:12px;color:var(--text-secondary,#aaa);border-top:1px solid var(--border-subtle,#333);">No detections${filterSuffix}.</div>`;
    }
    const rows = detections.map((d) => this.renderDetectionRow(d)).join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;max-height:340px;overflow-y:auto;">${rows}</div>`;
  }

  private renderDetectionRow(d: BiasDetection): string {
    const sevColor = SEVERITY_COLOR[d.severity];
    const ackButton = d.acknowledged
      ? `<span style="font-size:10px;color:var(--severity-info,#22c55e);text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">ACK</span>`
      : `<button class="bias-ack" data-id="${escapeHtml(d.id)}" style="padding:2px 8px;font-size:10px;border:1px solid var(--border-subtle,#333);background:var(--sev-low-bg,rgba(34,197,94,0.10));color:var(--sev-low,#22c55e);border-radius:3px;cursor:pointer;">Ack</button>`;
    const when = new Date(d.detectedAt).toLocaleTimeString();
    return `<div style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:rgba(255,255,255,0.02);${d.acknowledged ? 'opacity:0.55;' : ''}">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${sevColor}22;color:${sevColor};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(d.severity)}</span>
        <strong style="font-size:12px;">${escapeHtml(BIAS_LABEL[d.biasType])}</strong>
        <span style="font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(d.targetType)} ${entityRefHtml(d.targetId)}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(when)}</span>
        ${ackButton}
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">${dejargonProse(d.evidence)}</div>
    </div>`;
  }

  // ── Events ────────────────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const ackBtn = target.closest<HTMLElement>('.bias-ack');
    if (ackBtn) {
      event.stopPropagation();
      const id = ackBtn.dataset.id;
      if (id) {
        getCognitiveBiasDetectorService().acknowledge(id);
        this.render();
      }
      return;
    }
    const ackAllBtn = target.closest<HTMLElement>('.bias-ack-all');
    if (ackAllBtn) {
      event.stopPropagation();
      this.acknowledgeAllFiltered();
      return;
    }
    const filterBtn = target.closest<HTMLElement>('.bias-filter');
    if (filterBtn) {
      event.stopPropagation();
      const value = filterBtn.dataset.value as BiasType | 'all' | undefined;
      if (value) {
        this.filterBiasType = value;
        this.render();
      }
    }
  }

  /** Acknowledge every unacknowledged detection in the current filter, batched into one re-render. */
  private acknowledgeAllFiltered(): void {
    const svc = getCognitiveBiasDetectorService();
    const filter = this.filterBiasType === 'all'
      ? { acknowledged: false as const }
      : { biasType: this.filterBiasType, acknowledged: false as const };
    const pending = svc.getDetections(filter);
    this.bulkAcking = true;
    try {
      for (const detection of pending) {
        svc.acknowledge(detection.id);
      }
    } finally {
      this.bulkAcking = false;
    }
    this.render();
  }
}
