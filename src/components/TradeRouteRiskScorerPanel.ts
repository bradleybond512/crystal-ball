/**
 * Trade Route Risk Scorer Panel — risk-level summary badges with the
 * total dollar value of trade at risk, plus a route list sorted by
 * risk with type icon, risk bar, annual trade value, and the rolling
 * contributing-factors snippet.
 *
 * Vanilla TS — subscribes to the service for push-driven refresh and
 * falls back to a 10s timer.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getTradeRouteRiskScorerService,
  type RiskLevel,
  type RouteFilter,
  type RouteRiskSummary,
  type RouteType,
  type TradeRoute,
} from '@/services/intelligence/trade-route-risk-scorer';

const REFRESH_MS = 10_000;

const ALL_RISK_LEVELS: readonly RiskLevel[] = ['minimal', 'elevated', 'high', 'critical'];
const ALL_TYPES: readonly RouteType[] = ['maritime', 'land', 'air'];

const RISK_COLOR: Record<RiskLevel, string> = {
  minimal: 'var(--severity-info,#22c55e)',
  elevated: 'var(--severity-medium,#facc15)',
  high: 'var(--severity-high,#f87171)',
  critical: 'var(--severity-critical,#dc2626)',
};

const TYPE_ICON: Record<RouteType, string> = {
  maritime: 'SEA',
  land: 'LND',
  air: 'AIR',
};

const TYPE_COLOR: Record<RouteType, string> = {
  maritime: '#4a9eff',
  land: '#a78bfa',
  air: '#facc15',
};

export class TradeRouteRiskScorerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private filterType: RouteType | 'all' = 'all';
  private filterRiskLevel: RiskLevel | 'all' = 'all';

  constructor() {
    super({
      id: 'trade-route-risk-scorer',
      title: 'Trade Route Risk Scorer',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks risk scores for 12 strategic global trade routes (maritime / land / air). Each new HIGH or CRITICAL situation nearby pushes the route up; scores decay after 7 days.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = getTradeRouteRiskScorerService().subscribe(() => this.render());
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
      const svc = getTradeRouteRiskScorerService();
      const summary = svc.getSummary();
      const filter: RouteFilter = {};
      if (this.filterType !== 'all') filter.type = this.filterType;
      if (this.filterRiskLevel !== 'all') filter.riskLevel = this.filterRiskLevel;
      const routes = svc.getAllRoutes(filter);
      this.setCount(summary.critical.length + summary.high.length);
      this.setContent(this.buildHtml(summary, routes));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Trade route render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(summary: RouteRiskSummary, routes: readonly TradeRoute[]): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;font-size:12px;">
      ${this.renderSummary(summary)}
      ${this.renderFilters(summary)}
      ${this.renderList(routes)}
    </div>`;
  }

  private renderSummary(s: RouteRiskSummary): string {
    const tradeAtRiskLabel = formatUsd(s.totalTradeAtRiskUsd);
    return `<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;font-size:11px;color:var(--text-secondary,#aaa);">
      <span><strong style="color:${RISK_COLOR.critical};font-size:14px;">${s.critical.length}</strong> critical</span>
      <span><strong style="color:${RISK_COLOR.high};font-size:14px;">${s.high.length}</strong> high</span>
      <span style="margin-left:auto;">trade at risk <strong style="color:var(--text-primary,#fff);">${escapeHtml(tradeAtRiskLabel)}</strong></span>
    </div>`;
  }

  private renderFilters(summary: RouteRiskSummary): string {
    const allRoutesCount = getTradeRouteRiskScorerService().getAllRoutes().length;
    const riskChips = [
      this.renderFilterChip('riskLevel', 'all', `All (${allRoutesCount})`, this.filterRiskLevel === 'all'),
      ...ALL_RISK_LEVELS.map((r) => {
        const label = countLabelFor(r, summary);
        return this.renderFilterChip('riskLevel', r, label, this.filterRiskLevel === r);
      }),
    ].join('');
    const typeChips = [
      this.renderFilterChip('type', 'all', 'All types', this.filterType === 'all'),
      ...ALL_TYPES.map((t) => this.renderFilterChip('type', t, t, this.filterType === t)),
    ].join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${riskChips}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">${typeChips}</div>
    </div>`;
  }

  private renderFilterChip(kind: 'riskLevel' | 'type', value: string, label: string, active: boolean): string {
    const bg = active ? 'var(--accent,#4a9eff)' : 'rgba(255,255,255,0.04)';
    const fg = active ? '#fff' : 'var(--text-secondary,#aaa)';
    return `<button class="trr-filter" data-kind="${escapeHtml(kind)}" data-value="${escapeHtml(value)}" style="padding:3px 8px;font-size:10px;border:1px solid var(--border-subtle,#333);background:${bg};color:${fg};border-radius:3px;cursor:pointer;text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">${escapeHtml(label)}</button>`;
  }

  private renderList(routes: readonly TradeRoute[]): string {
    if (routes.length === 0) {
      return `<div style="padding:14px;text-align:center;font-size:12px;color:var(--text-secondary,#aaa);border-top:1px solid var(--border-subtle,#333);">No routes match the current filter.</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;max-height:420px;overflow-y:auto;">
      ${routes.map((r) => this.renderRow(r)).join('')}
    </div>`;
  }

  private renderRow(r: TradeRoute): string {
    const riskColor = RISK_COLOR[r.riskLevel];
    const typeColor = TYPE_COLOR[r.type];
    const pct = Math.round(r.riskScore * 100);
    return `<div style="padding:8px 10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:rgba(255,255,255,0.02);">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:${typeColor}22;color:${typeColor};font-weight:700;letter-spacing:0.04em;">${escapeHtml(TYPE_ICON[r.type])}</span>
        <strong style="font-size:12px;">${escapeHtml(r.name)}</strong>
        <span style="font-size:10px;padding:1px 6px;border-radius:3px;background:${riskColor}22;color:${riskColor};font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(r.riskLevel)}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(formatUsd(r.annualTradeUsd))} / yr</span>
      </div>
      <div style="margin-top:5px;display:flex;gap:8px;align-items:center;">
        <div style="flex:1;height:6px;background:rgba(255,255,255,0.04);border-radius:2px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${riskColor};"></div>
        </div>
        <span style="font-size:11px;font-weight:700;color:var(--text-primary,#fff);width:36px;text-align:right;">${pct}%</span>
      </div>
      ${this.renderFactors(r.contributingFactors)}
    </div>`;
  }

  private renderFactors(factors: readonly string[]): string {
    if (factors.length === 0) return '';
    return `<div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:5px;display:flex;gap:4px;flex-wrap:wrap;">
      ${factors.map((f) => `<span style="padding:1px 5px;background:rgba(255,255,255,0.04);border-radius:3px;">${escapeHtml(f)}</span>`).join('')}
    </div>`;
  }

  // ── Events ────────────────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const chip = target.closest<HTMLElement>('.trr-filter');
    if (!chip) return;
    event.stopPropagation();
    const kind = chip.dataset.kind;
    const value = chip.dataset.value;
    if (!kind || !value) return;
    if (kind === 'riskLevel') {
      this.filterRiskLevel = value as RiskLevel | 'all';
    } else if (kind === 'type') {
      this.filterType = value as RouteType | 'all';
    }
    this.render();
  }
}

function countLabelFor(level: RiskLevel, summary: RouteRiskSummary): string {
  if (level === 'critical') return `critical (${summary.critical.length})`;
  if (level === 'high') return `high (${summary.high.length})`;
  return level;
}

function formatUsd(value: number): string {
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(0)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  return `$${value.toFixed(0)}`;
}
