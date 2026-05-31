import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { AlertFatigueDetector } from '@/services/intelligence/alert-fatigue-detector';
import type { FatigueRecommendation } from '@/services/intelligence/alert-fatigue-detector';
import {
  fatigueColor,
  fatiguePercent,
  recommendationLabel,
  recommendationDesc,
  recommendationIcon,
  trendDirection,
  trendArrow,
  domainBreakdown,
  previousWindowRate,
  formatRate,
  formatAckRate,
} from './alert-fatigue-dashboard-helpers';

// ── Constants ─────────────────────────────────────────────────────────────

const REFRESH_MS = 30_000;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

// ── Helpers ───────────────────────────────────────────────────────────────

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

// ── Panel ─────────────────────────────────────────────────────────────────

export class AlertFatigueDashboardPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'alert-fatigue-dashboard', title: 'Alert Fatigue', showCount: true, trackActivity: true });
    this.render();
    if (typeof setInterval !== 'undefined') {
      this.refreshTimer = setInterval(() => { this.render(); }, REFRESH_MS);
    }
  }

  private render(): void {
    const detector = safe(() => AlertFatigueDetector.getInstance());
    const report   = safe(() => detector?.getFatigueReport(WINDOW_MS)) ?? {
      fatigueScore: 0, recommendation: 'none' as FatigueRecommendation,
      alertCount: 0, ackRate: 0, topDomain: '', windowMs: WINDOW_MS,
    };
    const rate     = safe(() => detector?.getAlertRate(WINDOW_MS)) ?? 0;
    const alerts   = safe(() => detector?.getAllAlerts()) ?? [];
    const domains  = safe(() => domainBreakdown(alerts, WINDOW_MS, Date.now())) ?? [];
    const prevRate = safe(() => previousWindowRate(alerts, WINDOW_MS, Date.now())) ?? 0;

    this.setContent(this.buildHtml({ report, rate, prevRate, domains }));
    this.setCount(report.alertCount);
    this.markFresh();
  }

  buildHtml(ctx: {
    report: { fatigueScore: number; recommendation: FatigueRecommendation; alertCount: number; ackRate: number };
    rate: number;
    prevRate: number;
    domains: { domain: string; count: number; acked: number }[];
  }): string {
    const { report, rate, prevRate, domains } = ctx;
    return `<div class="afp-dashboard">
      ${this.buildGaugeSection(report.fatigueScore, report.recommendation)}
      ${this.buildRateSection(rate, prevRate, report.ackRate)}
      ${this.buildDomainSection(domains)}
      ${this.buildRecommendationSection(report.recommendation)}
    </div>`;
  }

  private buildGaugeSection(score: number, rec: FatigueRecommendation): string {
    const pct   = fatiguePercent(score);
    const color = fatigueColor(score);
    const label = recommendationLabel(rec).toUpperCase();
    return `<section class="afp-section afp-gauge-section">
      <h3>Fatigue Score</h3>
      <div class="afp-gauge-track">
        <div class="afp-gauge-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <div class="afp-gauge-meta">
        <span class="afp-score" style="color:${color}">${pct}%</span>
        <span class="afp-tier-badge" style="color:${color}">${escapeHtml(label)}</span>
      </div>
    </section>`;
  }

  private buildRateSection(rate: number, prevRate: number, ackRate: number): string {
    const dir   = trendDirection(rate, prevRate);
    const arrow = trendArrow(dir);
    return `<section class="afp-section afp-rate-section">
      <h3>Alert Rate</h3>
      <div class="afp-rate-value">
        ${escapeHtml(formatRate(rate))}
        <span class="afp-trend afp-trend-${escapeHtml(dir)}">${escapeHtml(arrow)}</span>
      </div>
      <div class="afp-ack-rate">Acknowledgment rate: ${escapeHtml(formatAckRate(ackRate))}</div>
    </section>`;
  }

  private buildDomainSection(domains: { domain: string; count: number; acked: number }[]): string {
    const items = domains.length === 0
      ? '<div class="afp-empty">No alerts in current window</div>'
      : domains.map(d => `
        <div class="afp-domain-row">
          <span class="afp-domain-name">${escapeHtml(d.domain)}</span>
          <span class="afp-domain-count">${d.count}</span>
          <span class="afp-domain-ack">${d.acked}/${d.count} acked</span>
        </div>`).join('');
    return `<section class="afp-section afp-domain-section">
      <h3>Domain Breakdown</h3>
      ${items}
    </section>`;
  }

  private buildRecommendationSection(rec: FatigueRecommendation): string {
    const REC_SCORE: Record<FatigueRecommendation, number> = { none: 0, batch: 0.35, 'suppress-low': 0.55, 'escalate-only': 0.85 };
    const color = fatigueColor(REC_SCORE[rec] ?? 0);
    const icon  = recommendationIcon(rec);
    const label = recommendationLabel(rec);
    const desc  = recommendationDesc(rec);
    return `<section class="afp-section afp-rec-section">
      <h3>Recommendation</h3>
      <div class="afp-rec-banner" style="border-left:4px solid ${color}">
        <span class="afp-rec-icon">${escapeHtml(icon)}</span>
        <div class="afp-rec-body">
          <strong class="afp-rec-label">${escapeHtml(label)}</strong>
          <p class="afp-rec-desc">${escapeHtml(desc)}</p>
        </div>
      </div>
    </section>`;
  }

  override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }
}
