/**
 * Temporal Anomaly Detector Panel — surfaces the running anomaly
 * ledger from TemporalAnomalyDetectorService with per-row Acknowledge
 * action and domain/strength filter chips.
 *
 * Vanilla TS — subscribes to the service for push-driven refresh and
 * also falls back to a 10s timer.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getTemporalAnomalyDetectorService,
  type AnomalyFilter,
  type AnomalyStrength,
  type AnomalySummary,
  type TemporalAnomaly,
  type TemporalPattern,
} from '@/services/intelligence/temporal-anomaly-detector';

const REFRESH_MS = 10_000;
const RECENT_LIMIT = 80;

const ALL_STRENGTHS: readonly AnomalyStrength[] = ['mild', 'moderate', 'strong', 'extreme'];

const STRENGTH_COLOR: Record<AnomalyStrength, string> = {
  mild: 'var(--severity-info,#22c55e)',
  moderate: 'var(--severity-medium,#facc15)',
  strong: 'var(--severity-high,#f87171)',
  extreme: 'var(--severity-critical,#dc2626)',
};

const PATTERN_LABEL: Record<TemporalPattern, string> = {
  hourly: 'hour-of-day',
  daily: 'day-of-week',
  weekly: 'week-of-year',
};

const DAY_OF_WEEK_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export class TemporalAnomalyDetectorPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  // 'all' is encoded as the literal string sentinel.
  private filterDomain = 'all';
  private filterStrength: AnomalyStrength | 'all' = 'all';

  constructor() {
    super({
      id: 'temporal-anomaly-detector',
      title: 'Temporal Anomaly Detector',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Detects when events happen at anomalous times relative to per-domain hourly/daily/weekly baselines. Reports z-score, expected vs observed rate, and the bucket that fired.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = getTemporalAnomalyDetectorService().subscribe(() => this.render());
    this.attachHandlers();
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

  // ── Rendering ──────────────────────────────────────────────────────

  private render(): void {
    try {
      const svc = getTemporalAnomalyDetectorService();
      const summary = svc.getSummary();
      this.setCount(summary.unacknowledged);
      const filter: AnomalyFilter = {};
      if (this.filterDomain !== 'all') filter.domain = this.filterDomain;
      if (this.filterStrength !== 'all') filter.strength = this.filterStrength;
      const recent = svc.getAnomalies(filter, RECENT_LIMIT);
      const domains = this.uniqueDomains(svc.getAnomalies({}, MAX_DOMAINS_SCAN));
      this.setContent(this.buildHtml(summary, recent, domains));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Temporal anomaly render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private uniqueDomains(anomalies: readonly TemporalAnomaly[]): string[] {
    const set = new Set<string>();
    for (const a of anomalies) set.add(a.domain);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  private buildHtml(summary: AnomalySummary, recent: readonly TemporalAnomaly[], domains: readonly string[]): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;font-size:12px;">
      ${this.renderSummary(summary)}
      ${this.renderFilters(summary, domains)}
      ${this.renderList(recent)}
    </div>`;
  }

  private renderSummary(s: AnomalySummary): string {
    const top = s.topDomain ?? '—';
    return `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;font-size:11px;color:var(--text-secondary,#aaa);">
      <span><strong style="color:var(--text-primary,#fff);font-size:14px;">${s.total}</strong> total</span>
      <span><strong style="color:var(--severity-high,#f87171);font-size:14px;">${s.unacknowledged}</strong> unack</span>
      <span>top: <strong style="color:var(--text-primary,#fff);">${escapeHtml(top)}</strong></span>
      <span style="margin-left:auto;display:flex;gap:8px;">
        ${ALL_STRENGTHS.map((str) =>
          `<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${STRENGTH_COLOR[str]};margin-right:4px;"></span>${s.byStrength[str]}</span>`,
        ).join('')}
      </span>
    </div>`;
  }

  private renderFilters(summary: AnomalySummary, domains: readonly string[]): string {
    const strengthChips = [
      this.renderFilterChip('strength', 'all', `All (${summary.total})`, this.filterStrength === 'all'),
      ...ALL_STRENGTHS.map((s) =>
        this.renderFilterChip('strength', s, `${s} (${summary.byStrength[s]})`, this.filterStrength === s)),
    ].join('');
    const domainChips = [
      this.renderFilterChip('domain', 'all', 'All domains', this.filterDomain === 'all'),
      ...domains.map((d) => this.renderFilterChip('domain', d, d, this.filterDomain === d)),
    ].join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${strengthChips}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${domainChips}</div>
    </div>`;
  }

  private renderFilterChip(kind: 'strength' | 'domain', value: string, label: string, active: boolean): string {
    const bg = active ? 'var(--accent,#4a9eff)' : 'rgba(255,255,255,0.04)';
    const fg = active ? '#fff' : 'var(--text-secondary,#aaa)';
    return `<button class="tan-filter" data-kind="${escapeHtml(kind)}" data-value="${escapeHtml(value)}" style="padding:3px 8px;font-size:10px;border:1px solid var(--border-subtle,#333);background:${bg};color:${fg};border-radius:3px;cursor:pointer;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">${escapeHtml(label)}</button>`;
  }

  private renderList(anomalies: readonly TemporalAnomaly[]): string {
    if (anomalies.length === 0) {
      return `<div style="padding:14px;text-align:center;font-size:12px;color:var(--text-secondary,#aaa);border-top:1px solid var(--border-subtle,#333);">No anomalies match the current filter.</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;max-height:360px;overflow-y:auto;">
      ${anomalies.map((a) => this.renderRow(a)).join('')}
    </div>`;
  }

  private renderRow(a: TemporalAnomaly): string {
    const sevColor = STRENGTH_COLOR[a.strength];
    const ack = a.acknowledged
      ? `<span style="font-size:10px;color:var(--severity-info,#22c55e);text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">ACK</span>`
      : `<button class="tan-ack" data-id="${escapeHtml(a.id)}" style="padding:2px 8px;font-size:10px;border:1px solid var(--border-subtle,#333);background:rgba(34,197,94,0.10);color:#22c55e;border-radius:3px;cursor:pointer;">Ack</button>`;
    const when = new Date(a.detectedAt).toLocaleTimeString();
    return `<div style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:rgba(255,255,255,0.02);${a.acknowledged ? 'opacity:0.55;' : ''}">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${sevColor}22;color:${sevColor};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(a.strength)}</span>
        <strong style="font-size:12px;">${escapeHtml(a.domain)}</strong>
        <span style="font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(PATTERN_LABEL[a.pattern])} ${escapeHtml(bucketLabel(a.pattern, a.bucketIndex))}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(when)}</span>
        ${ack}
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">
        z = <strong style="color:${sevColor};">${a.zScore.toFixed(2)}</strong>
        — observed <strong>${a.observedCount}</strong> vs expected <strong>${a.expectedRate.toFixed(2)}</strong>
        (obs ${escapeHtml(a.observationId)})
      </div>
    </div>`;
  }

  // ── Events ────────────────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const ack = target.closest<HTMLElement>('.tan-ack');
    if (ack) {
      event.stopPropagation();
      const id = ack.dataset.id;
      if (id) {
        getTemporalAnomalyDetectorService().acknowledge(id);
        this.render();
      }
      return;
    }
    const chip = target.closest<HTMLElement>('.tan-filter');
    if (chip) {
      event.stopPropagation();
      const kind = chip.dataset.kind;
      const value = chip.dataset.value;
      if (!kind || !value) return;
      if (kind === 'strength') {
        this.filterStrength = value as AnomalyStrength | 'all';
      } else if (kind === 'domain') {
        this.filterDomain = value;
      }
      this.render();
    }
  }
}

const MAX_DOMAINS_SCAN = 1000;

function bucketLabel(pattern: TemporalPattern, index: number): string {
  if (pattern === 'hourly') {
    const hh = String(index).padStart(2, '0');
    return `(${hh}:00 UTC)`;
  }
  if (pattern === 'daily') {
    const label = DAY_OF_WEEK_LABEL[index] ?? `day ${index}`;
    return `(${label})`;
  }
  return `(week ${index + 1})`;
}
